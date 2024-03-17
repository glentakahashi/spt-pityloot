import { IStaticLootDetails } from "@spt-aki/models/eft/common/tables/ILootBase";
import { IAkiProfile } from "@spt-aki/models/eft/profile/IAkiProfile";
import { QuestCondition } from "./QuestUtils";
import {
  maxDropRateMultiplier,
  dropRateIncreaseType,
  dropRateIncreasePerRaid,
  dropRateIncreasePerHour,
  increasesStack,
} from "../config/config.json";
import { TrackedRequiredHideoutItem } from "./HideoutUtils";

type MissingItem = {
  itemId: string;
  secondsSinceStarted: number;
  raidsSinceStarted: number;
};

export function getUpdatedLootTables(
  profile: IAkiProfile,
  questConditions: QuestCondition[],
  hideoutUpgrades: TrackedRequiredHideoutItem[],
  loot: Record<string, IStaticLootDetails>
) {
  // For every item, track how many total in our inventory we've found in raid or not
  const itemsInInventory: Record<
    string,
    { foundInRaid: number; notFoundInRaid: number }
  > = {};
  profile.characters.pmc.Inventory.items.forEach((item) => {
    const numItems = item.upd?.StackObjectsCount;
    const foundInRaid = item.upd?.SpawnedInSession;
    const itemRecord = (itemsInInventory[item._tpl] ??= {
      foundInRaid: 0,
      notFoundInRaid: 0,
    });
    if (numItems != null && foundInRaid != null) {
      if (foundInRaid) {
        itemRecord.foundInRaid += numItems;
      } else {
        itemRecord.notFoundInRaid += numItems;
      }
    }
  });

  // TODO: combine the quest conditions and hideout upgrades
  // then sort them in reverse order, so most recent ones are at the front
  // then, iterate in order, filtering out ones that can be completed with items on hand
  // if you find one, subtract those counts from the total, and continue iterating
  // by the end, you'll have the maximal set of pity loot conditions, and can apply the remaining algorithms

  // you have to sort by time/raids depending on config
  // alternatively, you can sort the opposite direction, and get th eminimal set of pity conditions
  // thats probably the easiest thing though

  // or maybe sort by amount required? smallest to largest? That would be the most number of "filterable" conditions

  //either way, the algo is: sort the conditions first, then filter + remove as we go, and then use the remaining for the counters

  // Filter out quest conditions we could complete now with the items we have in our inventory
  const incompletableConditions = questConditions.filter((condition) => {
    const counter =
      profile.characters.pmc.BackendCounters[condition.conditionId];
    const conditionProgress = counter ? counter.value : 0;
    const numMoreNeeded = condition.amountRequired - conditionProgress;
    const itemCount = itemsInInventory[condition.itemId] ?? {
      foundInRaid: 0,
      notFoundInRaid: 0,
    };
    // If the quest requires found in raid items, only count those in our inventory, otherwise also count non-fir
    if (condition.foundInRaid) {
      return itemCount.foundInRaid < numMoreNeeded;
    } else {
      return itemCount.notFoundInRaid + itemCount.foundInRaid < numMoreNeeded;
    }
  });

  // Filter out hideout upgrades we could complete now with the items we have in our inventory
  const incompletableUpgrades = hideoutUpgrades.filter((upgrade) => {
    const itemCount = itemsInInventory[upgrade.id] ?? {
      foundInRaid: 0,
      notFoundInRaid: 0,
    };
    return itemCount.foundInRaid + itemCount.notFoundInRaid < upgrade.count;
  });

  const allIncompletables: MissingItem[] = [
    ...incompletableConditions.map((condition) => ({
      itemId: condition.itemId,
      raidsSinceStarted: condition.raidsSinceStarted,
      secondsSinceStarted: condition.secondsSinceStarted,
    })),
    ...incompletableUpgrades.map((upgrade) => ({
      itemId: upgrade.id,
      raidsSinceStarted: upgrade.raidsSinceStarted,
      secondsSinceStarted: upgrade.secondsSinceStarted,
    })),
  ];

  console.error(
    incompletableConditions,
    incompletableUpgrades,
    allIncompletables
  );

  // With the remaining conditions, calculate the max new drop rate by item type
  const itemDropRateMultipliers: Record<
    string,
    { timeBasedDropRateMultiplier: number; raidBasedDropRateMultiplier: number }
  > = {};
  allIncompletables.forEach((condition) => {
    const stats = (itemDropRateMultipliers[condition.itemId] ??= {
      timeBasedDropRateMultiplier: 1,
      raidBasedDropRateMultiplier: 1,
    });
    // TODO: pull out into helper functions probably
    // time is in seconds, so we convert to hours
    const hoursSinceStarted = Math.round(
      condition.secondsSinceStarted / 60 / 60
    );
    const timeMult =
      hoursSinceStarted * dropRateIncreasePerHour +
      (increasesStack ? stats.timeBasedDropRateMultiplier : 1);
    stats.timeBasedDropRateMultiplier = Math.max(
      stats.timeBasedDropRateMultiplier,
      timeMult
    );
    const raidMult =
      condition.raidsSinceStarted * dropRateIncreasePerRaid +
      (increasesStack ? stats.raidBasedDropRateMultiplier : 1);
    stats.raidBasedDropRateMultiplier = Math.max(
      stats.raidBasedDropRateMultiplier,
      raidMult
    );
  });

  console.dir(itemDropRateMultipliers);

  // Now that we have the drop rate multipliers, calculate new loot tables
  const newLootTables: Record<string, IStaticLootDetails> = {};
  for (const [containerId, container] of Object.entries(loot)) {
    const newLootDistribution = container.itemDistribution.map((dist) => {
      const maybeMult = itemDropRateMultipliers[dist.tpl];
      let newRelativeProbability = dist.relativeProbability;
      if (maybeMult) {
        if (dropRateIncreaseType === "raid") {
          newRelativeProbability *= Math.min(
            maxDropRateMultiplier,
            maybeMult.raidBasedDropRateMultiplier
          );
        } else {
          newRelativeProbability *= Math.min(
            maxDropRateMultiplier,
            maybeMult.timeBasedDropRateMultiplier
          );
        }
        newRelativeProbability = Math.round(newRelativeProbability);
        console.log("Drop rate updated", {
          containerId,
          itemId: dist.tpl,
          oldProb: dist.relativeProbability,
          newProb: newRelativeProbability,
        });
      }
      return {
        tpl: dist.tpl,
        relativeProbability: newRelativeProbability,
      };
    });
    const newContainer: IStaticLootDetails = {
      itemcountDistribution: container.itemcountDistribution,
      itemDistribution: newLootDistribution,
    };
    newLootTables[containerId] = newContainer;
  }
  return newLootTables;
}

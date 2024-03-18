import { IStaticLootDetails } from "@spt-aki/models/eft/common/tables/ILootBase";
import { IAkiProfile } from "@spt-aki/models/eft/profile/IAkiProfile";
import {
  maxDropRateMultiplier,
  dropRateIncreaseType,
  dropRateIncreasePerRaid,
  dropRateIncreasePerHour,
  increasesStack,
  debug,
} from "../config/config.json";
import { ILogger } from "@spt-aki/models/spt/utils/ILogger";

type BaseItemRequirement = {
  itemId: string;
  amountRequired: number;
  secondsSinceStarted: number;
  raidsSinceStarted: number;
};

type QuestItemRequirement = {
  type: "quest";
  conditionId: string;
  foundInRaid: boolean;
} & BaseItemRequirement;

type QuestKeyRequirement = {
  type: "questKey";
} & BaseItemRequirement;

export type HideoutItemRequirement = {
  type: "hideout";
} & BaseItemRequirement;

export type ItemRequirement =
  | QuestItemRequirement
  | QuestKeyRequirement
  | HideoutItemRequirement;

export class LootProbabilityManager {
  constructor(private logger: ILogger) {}

  getUpdatedLootTables(
    profile: IAkiProfile,
    questItemRequirements: ItemRequirement[],
    hideoutItemRequirements: ItemRequirement[],
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
      const count = numItems ?? 1;
      const itemRecord = (itemsInInventory[item._tpl] ??= {
        foundInRaid: 0,
        notFoundInRaid: 0,
      });
      if (foundInRaid) {
        itemRecord.foundInRaid += count;
      } else {
        itemRecord.notFoundInRaid += count;
      }
    });

    // Checks if we have enough items in our inventory, and if so removes them from the inventory and returns true
    // otherwise returns false
    function checkIfHasEnoughAndRemove(
      itemCount: (typeof itemsInInventory)[string],
      amountNeeded: number,
      foundInRaid: boolean
    ): boolean {
      // If its required to be found in raid,
      if (foundInRaid) {
        if (itemCount.foundInRaid >= amountNeeded) {
          itemCount.foundInRaid -= amountNeeded;
          return true;
        }
        return false;
      } else {
        // If we have enough purely from non-fir, use those entirely
        if (itemCount.notFoundInRaid >= amountNeeded) {
          itemCount.notFoundInRaid -= amountNeeded;
          return true;
          // Otherwise use a combo of non-fir then fir
        } else if (
          itemCount.notFoundInRaid + itemCount.foundInRaid >=
          amountNeeded
        ) {
          // Since we know we don't have enough non-fir, subtract that total count from needed, and set it to -1
          amountNeeded -= itemCount.notFoundInRaid;
          itemCount.notFoundInRaid = -1;
          // then subtract the remaining from fir
          itemCount.foundInRaid -= amountNeeded;
          return true;
        }
        return false;
      }
    }

    const allItemRequirements = [
      ...questItemRequirements,
      ...hideoutItemRequirements,
    ];

    // sort requirements by foundInRaid being first priority, then in ascending pity (based on your config)
    // There is no "right" ordering here, we don't know what order people will actually complete in, so this is a sort of heuristic, but thats fine imo
    // Example, you have a 10 raid old (fir) quest and a 5 raid old hideout that require 1 of the same item.
    // If you have 0, with stacking odds you would have 15 pity stacks, or with max odds you would have 10 pity stacks
    // If you have 2, both are 'completable' so you have 0 pity stacks
    // If you have 1, we would filter the quest out, so your pity stacks would be 5 (from the hideout).
    // But the above would be "wrong" if you decide to complete the hideout, and you'd be getting less pity than you should.
    // If you turn in the hideout, the pity stacks would go back to being 10, so it'll fix itself once you turn in anyways.
    // Theres a lot of complicated solutions, and if theres a consistent expectation of the "right" task to complete we could program that
    // but since its based on user preference, I'm just doing this yolo
    allItemRequirements.sort((a, b) => {
      const aFir = a.type === "quest" && a.foundInRaid;
      const bFir = b.type === "quest" && b.foundInRaid;
      if (aFir && !bFir) {
        return -1;
      } else if (bFir && !aFir) {
        return 1;
      } else {
        if (dropRateIncreaseType === "raid") {
          return a.raidsSinceStarted - b.raidsSinceStarted;
        } else {
          return a.secondsSinceStarted - b.secondsSinceStarted;
        }
      }
    });

    // Filter the requirements based on the ordering, removing them from the list and decrementing inventory counts if they meet the requirements
    // Return `false` if we /can/ complete the quest, `true` if we can't and should apply pity conditions
    const incompleteItemRequirements = allItemRequirements.filter((req) => {
      const itemCount = itemsInInventory[req.itemId];
      if (!itemCount) {
        // If we don't have any of the time, its never possible to complete it
        return true;
      }
      if (req.type === "questKey") {
        return !checkIfHasEnoughAndRemove(itemCount, 1, false);
      } else if (req.type === "quest") {
        const counter = profile.characters.pmc.BackendCounters[req.conditionId];
        const conditionProgress = counter ? counter.value : 0;
        const numMoreNeeded = req.amountRequired - conditionProgress;
        return !checkIfHasEnoughAndRemove(
          itemCount,
          numMoreNeeded,
          req.foundInRaid
        );
      } else if (req.type === "hideout") {
        return !checkIfHasEnoughAndRemove(itemCount, req.amountRequired, false);
      }
    });

    debug &&
      incompleteItemRequirements.forEach((req) => {
        this.logger.info(
          `Found incomplete item requirements. type: ${req.type}, itemId: ${req.itemId}, amountRequired: ${req.amountRequired}`
        );
      });

    // With the remaining conditions, calculate the max new drop rate by item type
    const itemDropRateMultipliers: Record<
      string,
      {
        timeBasedDropRateMultiplier: number;
        raidBasedDropRateMultiplier: number;
      }
    > = {};
    incompleteItemRequirements.forEach((req) => {
      const stats = (itemDropRateMultipliers[req.itemId] ??= {
        timeBasedDropRateMultiplier: 1,
        raidBasedDropRateMultiplier: 1,
      });
      // time is in seconds, so we convert to hours
      const hoursSinceStarted = Math.round(req.secondsSinceStarted / 60 / 60);
      const timeMult =
        hoursSinceStarted * dropRateIncreasePerHour +
        (increasesStack ? stats.timeBasedDropRateMultiplier : 1);
      stats.timeBasedDropRateMultiplier = Math.max(
        stats.timeBasedDropRateMultiplier,
        timeMult
      );
      const raidMult =
        req.raidsSinceStarted * dropRateIncreasePerRaid +
        (increasesStack ? stats.raidBasedDropRateMultiplier : 1);
      stats.raidBasedDropRateMultiplier = Math.max(
        stats.raidBasedDropRateMultiplier,
        raidMult
      );
    });

    debug &&
      Object.entries(itemDropRateMultipliers).forEach(([k, v]) => {
        this.logger.info(
          `Calculated new drop rate multiplier for ${k}: ${
            dropRateIncreaseType === "raid"
              ? v.raidBasedDropRateMultiplier
              : v.timeBasedDropRateMultiplier
          }`
        );
      });

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
          debug &&
            this.logger.info(
              `Updated drop rate for item ${dist.tpl} in container ${containerId} from ${dist.relativeProbability} to ${newRelativeProbability}`
            );
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
}

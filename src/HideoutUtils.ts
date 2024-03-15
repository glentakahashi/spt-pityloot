import { IHideoutArea } from "@spt-aki/models/eft/hideout/IHideoutArea";
import { IAkiProfile } from "@spt-aki/models/eft/profile/IAkiProfile";
import { HideoutAreas } from "@spt-aki/models/enums/HideoutAreas";
import { loadPityTrackerDatabase } from "./DatabaseUtils";

function getSkillLevelFromProgress(progress: number): number {
  let xpToLevel = 10;
  let level = 0;
  while (progress > xpToLevel) {
    level += 1;
    progress -= xpToLevel;
    xpToLevel = Math.min(100, xpToLevel + 10);
  }
  return level;
}

type RequiredItem = {
  id: string;
  count: number;
};

type HideoutUpgradeInfo = {
  area: HideoutAreas;
  level: number;
  requiredItems: RequiredItem[];
};

export type TrackedRequiredHideoutItem = RequiredItem & {
  secondsSinceStarted: number;
  raidsSinceStarted: number;
};

export function getAugmentedHideoutUpgrades(
  hideoutAreas: IHideoutArea[],
  profile: IAkiProfile
): TrackedRequiredHideoutItem[] {
  const normalAreas = getPossibleHideoutUpgrades(hideoutAreas, profile);
  const hideoutTracker = loadPityTrackerDatabase().hideout;
  return normalAreas.flatMap((c): TrackedRequiredHideoutItem[] => {
    const tracker = hideoutTracker[c.area];
    const secondsSinceStarted = tracker?.timeAvailable
      ? Math.round((Date.now() - tracker.timeAvailable) / 1000)
      : 0;
    return c.requiredItems.flatMap((q) => ({
      ...q,
      raidsSinceStarted: tracker?.raidsSinceStarted ?? 0,
      secondsSinceStarted,
    }));
  });
}

// Returns a list of hideouts upgrades that you meet all the prerequisites for, and what items are required
export function getPossibleHideoutUpgrades(
  hideoutAreas: IHideoutArea[],
  profile: IAkiProfile
): HideoutUpgradeInfo[] {
  const completedHideoutAreas = Object.fromEntries(
    profile.characters.pmc.Hideout.Areas.filter((h) => !h.constructing).map(
      (h) => [h.type, h.level]
    )
  );
  const traders = profile.characters.pmc.TradersInfo;
  const skillLevels = Object.fromEntries(
    profile.characters.pmc.Skills.Common.map((s) => [
      s.Id,
      getSkillLevelFromProgress(s.Progress),
    ])
  );
  // Get the next hideout upgrade per area
  const possibleUpgrades: HideoutUpgradeInfo[] = [];
  for (const area of hideoutAreas) {
    const currentLevel = completedHideoutAreas[area.type as HideoutAreas] ?? 0;
    const nextStage = area.stages[currentLevel + 1];
    if (nextStage) {
      let canUpgrade = true;
      const requiredItems: RequiredItem[] = [];
      for (const req of nextStage.requirements) {
        switch (req.type) {
          case "Area":
            if (req.areaType == null || req.requiredLevel == null) {
              console.error("missing area details");
              break;
            }
            if (
              (completedHideoutAreas[req.areaType] ?? 0) < req.requiredLevel
            ) {
              canUpgrade = false;
            }
            break;
          case "Skill":
            if (req.skillLevel == null || !req.skillName) {
              console.error("missing skill details");
              break;
            }
            if ((skillLevels[req.skillName] ?? 0) < req.skillLevel) {
              canUpgrade = false;
            }
            break;
          case "TraderLoyalty":
            if (!req.traderId || req.loyaltyLevel == null) {
              console.error("missing trader details");
              break;
            }
            if ((traders[req.traderId]?.loyaltyLevel ?? 0) < req.loyaltyLevel) {
              canUpgrade = false;
            }
            break;
          case "Item":
            if (req.count == null || !req.templateId) {
              console.error("missing item details");
              break;
            }
            requiredItems.push({
              count: req.count,
              id: req.templateId,
            });
            break;
          default:
            console.log("unknown requiremnt");
            break;
        }
      }
      if (canUpgrade) {
        possibleUpgrades.push({
          area: area.type,
          level: currentLevel + 1,
          requiredItems,
        });
      }
    }
  }

  return possibleUpgrades;
}

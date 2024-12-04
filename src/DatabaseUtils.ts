import fs from "fs";
import path from "path";
import { QuestStatus } from "@spt/models/enums/QuestStatus";
import { HideoutAreas } from "@spt/models/enums/HideoutAreas";
import { HideoutUpgradeInfo } from "./HideoutUtils";
import { ISptProfile } from "@spt/models/eft/profile/ISptProfile";

const databaseDir = path.resolve(__dirname, "../database/");

type PityTracker = {
  hideout: HideoutTracker;
  quests: QuestTracker;
};

type HideoutTracker = Partial<
  Record<
    HideoutAreas,
    {
      currentLevel: number;
      timeAvailable: number;
      raidsSinceStarted: number;
    }
  >
>;

type QuestTracker = Record<
  string,
  {
    raidsSinceStarted: number;
  }
>;

export function joinDatabasePath(profileId: string) {
  return path.join(databaseDir, `${profileId}.json`);
}

export function maybeCreatePityTrackerDatabase(profileId: string) {
  if (!fs.existsSync(databaseDir)) {
    fs.mkdirSync(databaseDir, { recursive: true });
  }
  if (!fs.existsSync(joinDatabasePath(profileId))) {
    const emptyTracker: PityTracker = {
      hideout: {},
      quests: {},
    };
    savePityTrackerDatabase(profileId, emptyTracker);
  }
}

export function loadPityTrackerDatabase(profileId: string): PityTracker {
  maybeCreatePityTrackerDatabase(profileId)
  return JSON.parse(fs.readFileSync(joinDatabasePath(profileId), "ascii"));
}

// TODO: probably should support multiple profiles
export function updatePityTracker(
  profile: ISptProfile,
  hideoutUpgrades: HideoutUpgradeInfo[],
  incrementRaidCount: boolean
): void {
  const raidCountIncrease = incrementRaidCount ? 1 : 0;
  const pityTracker = loadPityTrackerDatabase(profile.info.id);
  const newQuestTracker: QuestTracker = {};
  for (const questStatus of profile.characters.pmc.Quests) {
    if (questStatus.status === QuestStatus.Started) {
      const oldStatus = pityTracker.quests[questStatus.qid];
      newQuestTracker[questStatus.qid] = {
        raidsSinceStarted:
          (oldStatus?.raidsSinceStarted ?? 0) + raidCountIncrease,
      };
    }
  }
  const newHideoutTracker: HideoutTracker = {};

  for (const possibleUpgrade of hideoutUpgrades) {
    const oldStatus = pityTracker.hideout[possibleUpgrade.area] ?? {
      currentLevel: 0,
      raidsSinceStarted: 0,
      timeAvailable: Date.now(),
    };
    // if the next upgrade is higher than what we've tracked, that means we upgraded and should reset it
    if (possibleUpgrade.level > oldStatus.currentLevel) {
      newHideoutTracker[possibleUpgrade.area] = {
        currentLevel: possibleUpgrade.level,
        raidsSinceStarted: raidCountIncrease,
        timeAvailable: Date.now(),
      };
    } else {
      newHideoutTracker[possibleUpgrade.area] = {
        ...oldStatus,
        raidsSinceStarted: oldStatus.raidsSinceStarted + raidCountIncrease,
      };
    }
  }
  savePityTrackerDatabase(
    profile.info.id,
    {
      hideout: newHideoutTracker,
      quests: newQuestTracker,
    });
}

export function savePityTrackerDatabase(profileId: string, pityTracker: PityTracker): void {
  fs.writeFileSync(joinDatabasePath(profileId), JSON.stringify(pityTracker, null, 2));
}

import fs from "fs";
import path from "path";
import { QuestStatus } from "@spt/models/enums/QuestStatus";
import { HideoutAreas } from "@spt/models/enums/HideoutAreas";
import { HideoutUpgradeInfo } from "./HideoutUtils";
import { ISptProfile } from "@spt/models/eft/profile/ISptProfile";

const databaseDir = path.resolve(__dirname, "../database/");
const pityTrackerPath = path.join(databaseDir, "pityTracker.json");

type PityTracker = Record<string, UserPityTracker>;

type UserPityTracker = {
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

export function maybeCreatePityTrackerDatabase() {
  if (!fs.existsSync(databaseDir)) {
    fs.mkdirSync(databaseDir, { recursive: true });
  }
  if (!fs.existsSync(pityTrackerPath)) {
    fs.writeFileSync(pityTrackerPath, JSON.stringify({}, null, 2));
  }
}

export function loadPityTracker(): PityTracker {
  return JSON.parse(fs.readFileSync(pityTrackerPath, "ascii"));
}

export function loadProfilePityTracker(profile: ISptProfile): UserPityTracker {
  const pityTracker = loadPityTracker();

  return (
    pityTracker[profile.info.id] ?? {
      hideout: {},
      quests: {},
    }
  );
}

export function updatePityTracker(
  profile: ISptProfile,
  hideoutUpgrades: HideoutUpgradeInfo[],
  incrementRaidCount: boolean
): void {
  const raidCountIncrease = incrementRaidCount ? 1 : 0;
  const pityTracker = loadProfilePityTracker(profile);

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
  savePityTrackerDatabase(profile, {
    hideout: newHideoutTracker,
    quests: newQuestTracker,
  });
}

export function savePityTrackerDatabase(
  profile: ISptProfile,
  userPityTracker: UserPityTracker
): void {
  const pityTracker = loadPityTracker();
  const newPityTracker: PityTracker = {
    ...pityTracker,
    [profile.info.id]: userPityTracker,
  };
  fs.writeFileSync(pityTrackerPath, JSON.stringify(newPityTracker, null, 2));
}

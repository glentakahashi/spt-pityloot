import fs from "fs";
import path from "path";
import { IAkiProfile } from "@spt-aki/models/eft/profile/IAkiProfile";
import { QuestStatus } from "@spt-aki/models/enums/QuestStatus";
import { HideoutAreas } from "@spt-aki/models/enums/HideoutAreas";
import { HideoutUpgradeInfo } from "./HideoutUtils";

const databaseDir = path.resolve(__dirname, "../database/");
const pityTrackerPath = path.join(databaseDir, "pityTracker.json");

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

export function maybeCreatePityTrackerDatabase() {
  if (!fs.existsSync(databaseDir)) {
    fs.mkdirSync(databaseDir, { recursive: true });
  }
  if (!fs.existsSync(pityTrackerPath)) {
    const emptyTracker: PityTracker = {
      hideout: {},
      quests: {},
    };
    savePityTrackerDatabase(emptyTracker);
  }
}

export function loadPityTrackerDatabase(): PityTracker {
  return JSON.parse(fs.readFileSync(pityTrackerPath, "ascii"));
}

// TODO: probably should support multiple profiles
export function updatePityTracker(
  profile: IAkiProfile,
  hideoutUpgrades: HideoutUpgradeInfo[],
  incrementRaidCount: boolean
): void {
  const raidCountIncrease = incrementRaidCount ? 1 : 0;
  const pityTracker = loadPityTrackerDatabase();
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
  savePityTrackerDatabase({
    hideout: newHideoutTracker,
    quests: newQuestTracker,
  });
}

export function savePityTrackerDatabase(pityTracker: PityTracker): void {
  fs.writeFileSync(pityTrackerPath, JSON.stringify(pityTracker, null, 2));
}

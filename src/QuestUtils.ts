import { IQuest } from "@spt-aki/models/eft/common/tables/IQuest";
import { IQuestStatus } from "@spt-aki/models/eft/common/tables/IBotBase";
import { QuestStatus } from "@spt-aki/models/enums/QuestStatus";
import { loadPityTrackerDatabase } from "./DatabaseUtils";
import { IAkiProfile } from "@spt-aki/models/eft/profile/IAkiProfile";
import { includeKeys } from "../config/config.json";
import questKeys from "../config/questKeys.json";
import { ItemRequirement } from "./LootProbabilityManager";
import { ILogger } from "@spt-aki/models/spt/utils/ILogger";

type AugmentedQuestStatus = IQuestStatus & { raidsSinceStarted: number };

export class QuestUtils {
  constructor(private logger: ILogger) {}

  augmentQuestStatusesWithTrackingInfo(
    questStatuses: IQuestStatus[]
  ): AugmentedQuestStatus[] {
    const questTracker = loadPityTrackerDatabase().quests;
    return questStatuses.map((questStatus) => ({
      ...questStatus,
      raidsSinceStarted: questTracker[questStatus.qid]?.raidsSinceStarted ?? 0,
    }));
  }

  getInProgressQuestRequirements(
    profile: IAkiProfile,
    quests: Record<string, IQuest>
  ): ItemRequirement[] {
    // augment inProgress Quests with # of raids since accepted
    const inProgressQuests = this.augmentQuestStatusesWithTrackingInfo(
      profile.characters.pmc.Quests.filter(
        (quest) => quest.status === QuestStatus.Started
      )
    );

    // Find all quest conditions that are not completed
    return inProgressQuests.flatMap((quest) =>
      this.getIncompleteConditionsForQuest(quests, quest)
    );
  }

  getIncompleteConditionsForQuest(
    quests: Record<string, IQuest>,
    questStatus: AugmentedQuestStatus
  ): ItemRequirement[] {
    const quest = quests[questStatus.qid];
    if (!quest) {
      return [];
    }
    // startTime can be 0 for some reason, and if so, try to pull off from statusTimers.
    const startTime =
      questStatus.startTime > 0
        ? questStatus.startTime
        : questStatus.statusTimers?.[QuestStatus.Started];
    // startTime/statusTimes are in seconds, but Date.now() is in millis, so divide by 1000 first
    // If we couldn't find a start time, just assume 0 time has passed
    const secondsSinceStarted = startTime
      ? Math.round(Date.now() / 1000 - startTime)
      : 0;
    const completedConditions = questStatus.completedConditions ?? [];
    const itemConditions = quest.conditions.AvailableForFinish.filter(
      (condition) =>
        condition._parent === "HandoverItem" ||
        condition._parent === "LeaveItemAtLocation"
    );
    const missingItemConditions = itemConditions.filter(
      (condition) => !completedConditions.includes(condition._props.id)
    );
    const conditions: ItemRequirement[] = missingItemConditions.flatMap((c) => {
      const { target, onlyFoundInRaid, value, id } = c._props;
      if (!target || !target[0] || !value) {
        return [];
      }
      return [
        {
          type: "quest",
          conditionId: id,
          itemId: target[0],
          foundInRaid: onlyFoundInRaid ?? false,
          amountRequired: typeof value === "string" ? parseInt(value) : value,
          secondsSinceStarted,
          raidsSinceStarted: questStatus.raidsSinceStarted,
        },
      ];
    });
    if (includeKeys) {
      // TODO: better typing
      const keysForQuest = questKeys[quest._id as keyof typeof questKeys] ?? [];
      for (const keyForQuest of keysForQuest) {
        conditions.push({
          type: "questKey",
          amountRequired: 1,
          itemId: keyForQuest,
          raidsSinceStarted: questStatus.raidsSinceStarted,
          secondsSinceStarted,
        });
      }
    }
    return conditions;
  }
}

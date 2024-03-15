import { IQuest } from "@spt-aki/models/eft/common/tables/IQuest";
import { IQuestStatus } from "@spt-aki/models/eft/common/tables/IBotBase";
import { QuestStatus } from "@spt-aki/models/enums/QuestStatus";
import { loadPityTrackerDatabase } from "./DatabaseUtils";
import { IAkiProfile } from "@spt-aki/models/eft/profile/IAkiProfile";

export type QuestCondition = {
  conditionId: string;
  itemId: string;
  foundInRaid: boolean;
  amountRequired: number;
  secondsSinceStarted: number;
  raidsSinceStarted: number;
};

type AugmentedQuestStatus = IQuestStatus & { raidsSinceStarted: number };

export function augmentQuestStatuesWithTrackingInfo(
  questStatuses: IQuestStatus[]
): AugmentedQuestStatus[] {
  const questTracker = loadPityTrackerDatabase().quests;
  return questStatuses.map((questStatus) => ({
    ...questStatus,
    raidsSinceStarted: questTracker[questStatus.qid]?.raidsSinceStarted ?? 0,
  }));
}

export function getTrackedQuestionConditions(
  profile: IAkiProfile,
  quests: Record<string, IQuest>
): QuestCondition[] {
  // augment inProgress Quests with # of raids since accepted
  const inProgressQuests = augmentQuestStatuesWithTrackingInfo(
    profile.characters.pmc.Quests.filter(
      (quest) => quest.status === QuestStatus.Started
    )
  );

  // Find all quest conditions that are not completed
  return inProgressQuests.flatMap((quest) =>
    getIncompleteConditionsForQuest(quests, quest)
  );
}

export function getIncompleteConditionsForQuest(
  quests: Record<string, IQuest>,
  questStatus: AugmentedQuestStatus
): QuestCondition[] {
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
      condition._parent === "HandoverItem" || condition._parent === "FindItem"
  );
  const missingItemConditions = itemConditions.filter(
    (condition) => !completedConditions.includes(condition._props.id)
  );
  return missingItemConditions.flatMap((c) => {
    const { target, onlyFoundInRaid, value, id } = c._props;
    if (!target || !target[0] || !value) {
      return [];
    }
    return [
      {
        conditionId: id,
        itemId: target[0],
        foundInRaid: onlyFoundInRaid ?? false,
        amountRequired: typeof value === "string" ? parseInt(value) : value,
        secondsSinceStarted,
        raidsSinceStarted: questStatus.raidsSinceStarted,
      },
    ];
  });
}

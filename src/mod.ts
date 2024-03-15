import { DependencyContainer } from "tsyringe";
import { IPreAkiLoadMod } from "@spt-aki/models/external/IPreAkiLoadMod";
import type { StaticRouterModService } from "@spt-aki/services/mod/staticRouter/StaticRouterModService";
import { ProfileHelper } from "@spt-aki/helpers/ProfileHelper";
import { DatabaseServer } from "@spt-aki/servers/DatabaseServer";
import { IQuest } from "@spt-aki/models/eft/common/tables/IQuest";
import { IStaticLootDetails } from "@spt-aki/models/eft/common/tables/ILootBase";
import { getUpdatedLootTables } from "./LootProbabilityManager";
import { ISaveProgressRequestData } from "@spt-aki/models/eft/inRaid/ISaveProgressRequestData";
import {
  enabled,
  includeScavRaids,
  appliesToHideout,
  appliesToQuests,
} from "../config/config.json";
import { IItemEventRouterRequest } from "@spt-aki/models/eft/itemEvent/IItemEventRouterRequest";
import { HideoutEventActions } from "@spt-aki/models/enums/HideoutEventActions";
import { updatePityTracker } from "./DatabaseUtils";
import { getTrackedQuestionConditions } from "./QuestUtils";
import { getAugmentedHideoutUpgrades } from "./HideoutUtils";

class Mod implements IPreAkiLoadMod {
  preAkiLoad(container: DependencyContainer): void {
    if (!enabled) {
      return;
    }
    const profileHelper = container.resolve<ProfileHelper>("ProfileHelper");
    const staticRouterModService = container.resolve<StaticRouterModService>(
      "StaticRouterModService"
    );
    const databaseServer = container.resolve<DatabaseServer>("DatabaseServer");
    let allQuests: Record<string, IQuest> | undefined;
    let originalLootTables: Record<string, IStaticLootDetails> | undefined;

    staticRouterModService.registerStaticRouter(
      "PityLootInit",
      [
        {
          url: "/client/game/start",
          action: (url, info, sessionId, output) => {
            const fullProfile = profileHelper.getFullProfile(sessionId);
            const tables = databaseServer.getTables();
            // Update the pity tracker at startup but don't increment raid count to start tracking when hideout upgrades become available
            updatePityTracker(fullProfile, tables, false);

            // Store quests and loot tables at startup, so that we always get them after all other mods have loaded and possibly changed their settings (e.g. AlgorithmicQuestRandomizer or AllTheLoot)
            // We could try and do this by hooking into postAkiLoad and making this mod last in the load order, but this seems like a more reliable solution
            if (allQuests == null) {
              allQuests = tables.templates?.quests;
            }
            if (originalLootTables == null) {
              // the reason we also store original loot tables only once is so that when calculating new odds, we don't have to do funky math to undo previous increases
              originalLootTables = tables.loot?.staticLoot;
            }

            // TODO: dedupe this shit
            if (allQuests && originalLootTables && tables.loot) {
              tables.loot.staticLoot = getUpdatedLootTables(
                fullProfile,
                appliesToQuests
                  ? getTrackedQuestionConditions(fullProfile, allQuests)
                  : [],
                appliesToHideout && tables.hideout
                  ? getAugmentedHideoutUpgrades(
                      tables.hideout.areas,
                      fullProfile
                    )
                  : [],
                originalLootTables
              );
            }

            return output;
          },
        },
      ],
      "aki"
    );

    staticRouterModService.registerStaticRouter(
      "PityLootPostRaidHooks",
      [
        {
          url: "/raid/profile/save",
          action: (_url, info: ISaveProgressRequestData, sessionId, output) => {
            const fullProfile = profileHelper.getFullProfile(sessionId);
            const tables = databaseServer.getTables();

            if (!info.isPlayerScav || includeScavRaids) {
              updatePityTracker(fullProfile, tables, true);
            }

            if (allQuests && originalLootTables && tables.loot) {
              tables.loot.staticLoot = getUpdatedLootTables(
                fullProfile,
                appliesToQuests
                  ? getTrackedQuestionConditions(fullProfile, allQuests)
                  : [],
                appliesToHideout && tables.hideout
                  ? getAugmentedHideoutUpgrades(
                      tables.hideout.areas,
                      fullProfile
                    )
                  : [],
                originalLootTables
              );
            }
            return output;
          },
        },
      ],
      "aki"
    );

    staticRouterModService.registerStaticRouter(
      "PityLootQuestTurninHooks",
      [
        {
          url: "/client/game/profile/items/moving",
          action: (_url, info: IItemEventRouterRequest, sessionId, output) => {
            let pityStatusChanged = false;
            for (const body of info.data) {
              pityStatusChanged =
                pityStatusChanged ||
                [
                  "QuestComplete",
                  "QuestHandover",
                  HideoutEventActions.HIDEOUT_IMPROVE_AREA,
                  HideoutEventActions.HIDEOUT_UPGRADE,
                  HideoutEventActions.HIDEOUT_UPGRADE_COMPLETE,
                ].includes(body.Action);
            }
            if (!pityStatusChanged) {
              return output;
            }
            // quest has been completed, or partially handed over, re-update odds
            const fullProfile = profileHelper.getFullProfile(sessionId);
            const tables = databaseServer.getTables();

            updatePityTracker(fullProfile, tables, false);

            if (allQuests && originalLootTables && tables.loot) {
              tables.loot.staticLoot = getUpdatedLootTables(
                fullProfile,
                appliesToQuests
                  ? getTrackedQuestionConditions(fullProfile, allQuests)
                  : [],
                appliesToHideout && tables.hideout
                  ? getAugmentedHideoutUpgrades(
                      tables.hideout.areas,
                      fullProfile
                    )
                  : [],
                originalLootTables
              );
            }

            return output;
          },
        },
      ],
      "aki"
    );
  }
}

module.exports = { mod: new Mod() };

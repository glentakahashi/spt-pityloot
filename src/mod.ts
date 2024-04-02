import { DependencyContainer } from "tsyringe";
import { IPreAkiLoadMod } from "@spt-aki/models/external/IPreAkiLoadMod";
import type { StaticRouterModService } from "@spt-aki/services/mod/staticRouter/StaticRouterModService";
import { ProfileHelper } from "@spt-aki/helpers/ProfileHelper";
import { DatabaseServer } from "@spt-aki/servers/DatabaseServer";
import { IQuest } from "@spt-aki/models/eft/common/tables/IQuest";
import { ILootBase } from "@spt-aki/models/eft/common/tables/ILootBase";
import { LootProbabilityManager } from "./LootProbabilityManager";
import { ISaveProgressRequestData } from "@spt-aki/models/eft/inRaid/ISaveProgressRequestData";
import {
  enabled,
  includeScavRaids,
  appliesToHideout,
  appliesToQuests,
  debug,
} from "../config/config.json";
import { IItemEventRouterRequest } from "@spt-aki/models/eft/itemEvent/IItemEventRouterRequest";
import { HideoutEventActions } from "@spt-aki/models/enums/HideoutEventActions";
import {
  maybeCreatePityTrackerDatabase,
  updatePityTracker,
} from "./DatabaseUtils";
import { QuestUtils } from "./QuestUtils";
import { HideoutUtils } from "./HideoutUtils";
import { ILogger } from "@spt-aki/models/spt/utils/ILogger";
import { ILocations } from "@spt-aki/models/spt/server/ILocations";
import { IBots } from "./helpers";

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
    const logger = container.resolve<ILogger>("WinstonLogger");
    const hideoutUtils = new HideoutUtils(logger);
    const questUtils = new QuestUtils(logger);
    const pityLootManager = new LootProbabilityManager(logger);

    let allQuests: Record<string, IQuest> | undefined;
    let originalLootTables: ILootBase | undefined;
    let originalLocations: ILocations | undefined;
    let originalBots: IBots | undefined;

    maybeCreatePityTrackerDatabase();

    function handleStateChange(sessionId: string, incrementRaidCount: boolean) {
      const fullProfile = profileHelper.getFullProfile(sessionId);
      if (!fullProfile.characters.pmc || !fullProfile.characters.pmc.Hideout) {
        debug &&
          logger.info(`Profile not valid yet, skipping initialization for now`);
        return;
      }
      const tables = databaseServer.getTables();

      updatePityTracker(
        fullProfile,
        hideoutUtils.getPossibleHideoutUpgrades(
          tables.hideout?.areas ?? [],
          fullProfile
        ),
        incrementRaidCount
      );

      if (
        allQuests &&
        originalLootTables &&
        originalLocations &&
        originalBots
      ) {
        [tables.loot, tables.locations, tables.bots] =
          pityLootManager.getUpdatedLootTables(
            fullProfile,
            appliesToQuests
              ? questUtils.getInProgressQuestRequirements(
                  fullProfile,
                  allQuests
                )
              : [],
            appliesToHideout && tables.hideout
              ? hideoutUtils.getHideoutRequirements(
                  tables.hideout.areas,
                  fullProfile
                )
              : [],
            originalLootTables,
            originalLocations,
            originalBots
          );
      }
    }

    staticRouterModService.registerStaticRouter(
      "PityLootInit",
      [
        {
          url: "/client/game/start",
          action: (url, info, sessionId, output) => {
            const tables = databaseServer.getTables();

            // Store quests and loot tables at startup, so that we always get them after all other mods have loaded and possibly changed their settings (e.g. AlgorithmicQuestRandomizer or AllTheLoot)
            // We could try and do this by hooking into postAkiLoad and making this mod last in the load order, but this seems like a more reliable solution
            if (allQuests == null) {
              allQuests = tables.templates?.quests;
            }
            // the reason we also store original tables only once is so that when calculating new odds, we don't have to do funky math to undo previous increases
            if (originalLootTables == null) {
              originalLootTables = tables.loot;
            }
            if (originalLocations == null) {
              originalLocations = tables.locations;
            }
            if (originalBots == null) {
              originalBots = tables.bots;
            }
            handleStateChange(sessionId, false);

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
            handleStateChange(
              sessionId,
              !info.isPlayerScav || includeScavRaids
            );
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
            handleStateChange(sessionId, false);
            return output;
          },
        },
      ],
      "aki"
    );
  }
}

module.exports = { mod: new Mod() };

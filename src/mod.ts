import { DependencyContainer } from "tsyringe";
import { IPreSptLoadMod } from "@spt/models/external/IPreSptLoadMod";
import type { StaticRouterModService } from "@spt/services/mod/staticRouter/StaticRouterModService";
import { ProfileHelper } from "@spt/helpers/ProfileHelper";
import { DatabaseServer } from "@spt/servers/DatabaseServer";
import { IQuest } from "@spt/models/eft/common/tables/IQuest";
import { LootProbabilityManager } from "./LootProbabilityManager";
import { ISaveProgressRequestData } from "@spt/models/eft/inRaid/ISaveProgressRequestData";
import {
  enabled,
  includeScavRaids,
  appliesToHideout,
  appliesToQuests,
  debug,
} from "../config/config.json";
import { IItemEventRouterRequest } from "@spt/models/eft/itemEvent/IItemEventRouterRequest";
import { HideoutEventActions } from "@spt/models/enums/HideoutEventActions";
import type { PreSptModLoader } from "@spt/loaders/PreSptModLoader";
import type { LocationController } from "@spt/controllers/LocationController";
import {
  maybeCreatePityTrackerDatabase,
  updatePityTracker,
} from "./DatabaseUtils";
import { QuestUtils } from "./QuestUtils";
import { HideoutUtils } from "./HideoutUtils";
import { ILogger } from "@spt/models/spt/utils/ILogger";
import { ILocations } from "@spt/models/spt/server/ILocations";
import { IBots } from "./helpers";
import { IGetLocationRequestData } from "@spt/models/eft/location/IGetLocationRequestData";
import { ILocationBase } from "@spt/models/eft/common/ILocationBase";

class Mod implements IPreSptLoadMod {
  preSptLoad(container: DependencyContainer): void {
    if (!enabled) {
      return;
    }
    const profileHelper = container.resolve<ProfileHelper>("ProfileHelper");
    const staticRouterModService = container.resolve<StaticRouterModService>(
      "StaticRouterModService"
    );
    const databaseServer = container.resolve<DatabaseServer>("DatabaseServer");
    const logger = container.resolve<ILogger>("WinstonLogger");
    const locationController =
      container.resolve<LocationController>("LocationController");
    const hideoutUtils = new HideoutUtils(logger);
    const questUtils = new QuestUtils(logger);
    const pityLootManager = new LootProbabilityManager(logger);

    let allQuests: Record<string, IQuest> | undefined;
    let originalLocations: ILocations | undefined;
    let originalBots: IBots | undefined;
    let algorithmicLevelingProgressionCompatibility = false;

    const preSptModLoader =
      container.resolve<PreSptModLoader>("PreSptModLoader");
    if (
      preSptModLoader
        .getImportedModsNames()
        .some((mod) => mod.includes("AlgorithmicLevelProgression"))
    ) {
      logger.info(
        "Algorithmic Level Progression detected, updating bot spawns"
      );
      algorithmicLevelingProgressionCompatibility = true;
    }

    container.afterResolution(
      "LocationController",
      (_t, result: LocationController | LocationController[]) => {
        for (const controller of Array.isArray(result) ? result : [result]) {
          controller.get = (
            sessionId: string,
            request: IGetLocationRequestData
          ): ILocationBase => {
            const start = performance.now();

            // profile can be null for scav raids
            const fullProfile = profileHelper.getFullProfile(sessionId);
            if (
              !fullProfile?.characters.pmc ||
              !fullProfile?.characters.pmc.Hideout
            ) {
              logger.warning(
                `Profile not valid yet, skipping initialization for now`
              );
            } else {
              const tables = databaseServer.getTables();

              if (allQuests) {
                const incompleteItemRequirements =
                  pityLootManager.getIncompleteRequirements(
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
                      : []
                  );
                const getNewLootProbability =
                  pityLootManager.createLootProbabilityUpdater(
                    incompleteItemRequirements
                  );

                if (originalLocations) {
                  tables.locations = pityLootManager.getUpdatedLocationLoot(
                    getNewLootProbability,
                    originalLocations,
                    incompleteItemRequirements
                  );
                }
                const end = performance.now();
                debug &&
                  logger.info(
                    `Pity loot location updates took: ${end - start} ms`
                  );
              }
            }
            return locationController.get(sessionId, request);
          };
        }
      },
      { frequency: "Always" }
    );

    maybeCreatePityTrackerDatabase();

    function handlePityChange(sessionId: string, incrementRaidCount: boolean) {
      const fullProfile = profileHelper.getFullProfile(sessionId);
      if (!fullProfile?.characters.pmc || !fullProfile.characters.pmc.Hideout) {
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
    }

    staticRouterModService.registerStaticRouter(
      "PityLootInit",
      [
        {
          url: "/client/game/start",
          action: async (url, info, sessionId, output) => {
            const tables = databaseServer.getTables();

            // Store quests and loot tables at startup, so that we always get them after all other mods have loaded and possibly changed their settings (e.g. AlgorithmicQuestRandomizer or AllTheLoot)
            // We could try and do this by hooking into postSptLoad and making this mod last in the load order, but this seems like a more reliable solution
            if (allQuests == null) {
              allQuests = tables.templates?.quests;
            }
            // the reason we also store original tables only once is so that when calculating new odds, we don't have to do funky math to undo previous increases
            if (originalLocations == null) {
              originalLocations = tables.locations;
            }
            if (originalBots == null) {
              originalBots = tables.bots;
            }
            handlePityChange(sessionId, false);

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
          action: async (
            _url,
            info: ISaveProgressRequestData,
            sessionId,
            output
          ) => {
            handlePityChange(sessionId, !info.isPlayerScav || includeScavRaids);
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
          action: async (
            _url,
            info: IItemEventRouterRequest,
            sessionId,
            output
          ) => {
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
            handlePityChange(sessionId, false);
            return output;
          },
        },
      ],
      "aki"
    );

    staticRouterModService.registerStaticRouter(
      "PityLootPreRaidHooks",
      [
        {
          url: "/client/raid/configuration",
          action: async (_url, _info, sessionId, output) => {
            const start = performance.now();

            const fullProfile = profileHelper.getFullProfile(sessionId);
            if (
              !fullProfile?.characters.pmc ||
              !fullProfile.characters.pmc.Hideout
            ) {
              logger.warning(
                `Profile not valid yet, skipping initialization for now`
              );
            } else {
              const tables = databaseServer.getTables();

              if (allQuests && originalBots && tables.bots) {
                const incompleteItemRequirements =
                  pityLootManager.getIncompleteRequirements(
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
                      : []
                  );
                const getNewLootProbability =
                  pityLootManager.createLootProbabilityUpdater(
                    incompleteItemRequirements
                  );
                tables.bots = pityLootManager.getUpdatedBotTables(
                  getNewLootProbability,
                  algorithmicLevelingProgressionCompatibility
                    ? tables.bots
                    : originalBots
                );
              }
              const end = performance.now();
              debug &&
                logger.info(`Pity loot bot updates took: ${end - start} ms`);
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

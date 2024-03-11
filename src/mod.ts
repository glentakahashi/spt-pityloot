import { DependencyContainer } from "tsyringe";
import { IPostAkiLoadMod } from "@spt-aki/models/external/IPostAkiLoadMod";
import { ILogger } from "@spt-aki/models/spt/utils/ILogger";
import { LogTextColor } from "@spt-aki/models/spt/logging/LogTextColor";
import { LogBackgroundColor } from "@spt-aki/models/spt/logging/LogBackgroundColor";

class Mod implements IPostAkiLoadMod
{
    // This could be postDBLoad, but we put it as postAki because things like AlgorithmicQuestRandomizer use loot tables, and those run in postAKi hooks as well
    postAkiLoad(container: DependencyContainer): void 
    {
        // get the logger from the server container
        const logger = container.resolve<ILogger>("WinstonLogger");
        
        logger.info("I am logging info!");
        logger.warning("I am logging a warning!");
        logger.error("I am logging an error!");
        logger.logWithColor("I am logging with color!", LogTextColor.YELLOW, LogBackgroundColor.RED);
    }
}

module.exports = { mod: new Mod() }
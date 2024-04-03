# Pity Loot

Like playing hardcore tarkov, but tired of not finding the items you need for quests or hideout?
Or just like playing without flea market and don't like having to hoard /every/ item you need for future quests?
Pity loot is a mod that progressively increases the loot odds for items you need based on the # of raids since you started the task, or based on the amount of time (in real world hours) since you started it.

## Configuration

Config options are explained as below

```
{
  "enabled": true,
  "debug": true,
  "appliesToQuests": true, // Whether or not to account for quest items in pity odds
  "appliesToHideout": true, // Whether or not to account for hideout upgrades in pity odds
  "increasesStack": true, // Whether or not drop rate increases stack
                          // e.g. if two quests need the same item and are at 20% and 80% pity
                          // with increasesStack = true, the pity odds are 100%, so drop rate is doubled
                          // with increasesStack = false, it take the maximum of the increases, in this case 80%, and uses that
  "includeScavRaids": true, // whether or not to count Scav Raids as "increasePerRaid"
  "includeKeys": true, // Whether or not to include quest keys (like rusty bloody key, or west wing 216) in pity system
  "keysAdditionalMultiplier": 2.5, // Additional multiplier on top of normal ones.
                                   // If a quest needs items and stuff behind a locked door, and the items are at 80% pity
                                   // The quest key would be at 200% pity (a 3x increase)
  "maxDropRateMultiplier": 10, // Max multiplier for items. E.g. at default 0.2 increase per raid,
                               // after 45 (10-1 / 0.2) raids your loot rate would be 10x normal for that item
  "dropRateIncreaseType": "raid", // `raid` to use raid increase below, `time` to use per hour increase
  "dropRateIncreasePerRaid": 0.2, // Additive multiplier increase per raid (0.2 = 20%), 1 raid = 20%, 2 = 40%, etc.
  "dropRateIncreasePerHour": 0.05 // Same as above but for hours. 1hr = 5% increase, 1 day = 120%
}
```

## TODOS

- Maybe increase scav loot tables too? For things like guns/armor?

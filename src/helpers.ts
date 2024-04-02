import { IBotBase } from "@spt-aki/models/eft/common/tables/IBotBase";
import { IBotCore } from "@spt-aki/models/eft/common/tables/IBotCore";
import { IBotType } from "@spt-aki/models/eft/common/tables/IBotType";

export function assertNever(value: never, noThrow?: boolean): never {
  if (noThrow) {
    return value;
  }

  throw new Error(
    `Unhandled discriminated union member: ${JSON.stringify(value)}`
  );
}

export type IBots = {
  types: Record<string, IBotType>;
  base: IBotBase;
  core: IBotCore;
};

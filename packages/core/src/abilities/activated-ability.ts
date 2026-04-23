// SPDX-License-Identifier: GPL-3.0-or-later
// Activated ability shape (CR 602). Mana abilities (CR 605) use the same
// base shape with isManaAbility=true + kind="mana".
import type { AbilityBase } from "./active-ability.js";

export interface ActivatedAbility extends AbilityBase {
  readonly kind: "activated" | "mana";
  // SP3 parses these strings. SP2 stores them as opaque DSL slots so the
  // type is stable.
  readonly costDsl: string;
  readonly effectDsl: string;
  readonly isManaAbility: boolean;
}

// SPDX-License-Identifier: GPL-3.0-or-later
// Base shape for every ability the registries (Static/Trigger/Replacement)
// hold. SP2 pins the types; SP3 fills implementations.
import type { EntityId, PlayerSeat } from "../ids.js";
import type { ZoneType } from "../zone.js";

export type AbilityKind = "static" | "triggered" | "replacement" | "activated" | "mana";

export interface AbilityBase {
  readonly id: EntityId;
  readonly kind: AbilityKind;
  readonly sourceCardId: EntityId;
  readonly activeInZones: ReadonlySet<ZoneType>;
  readonly timestamp: number;
  readonly controllerSeatAtReg: PlayerSeat | null;
}

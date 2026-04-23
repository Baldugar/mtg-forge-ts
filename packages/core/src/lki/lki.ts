// SPDX-License-Identifier: GPL-3.0-or-later
// Last-Known Information — frozen snapshot of a Card's state captured at
// a specific moment (CR 608.2g, used for leaves-battlefield and dies
// triggers). Triggers that reference "that creature" after it has moved
// zones read the LKI, not the current Card (which may now be in graveyard
// with damage cleared, or re-layered fresh under a new ability set).
//
// Tasks 20-24 store LKI on pending trigger instances. The frozen
// Characteristics here is deep-frozen via Object.freeze + re-copied Sets
// so layer re-walks can't leak into the LKI.
import type { Characteristics } from "../characteristics/characteristics.js";
import type { EntityId, PlayerSeat } from "../ids.js";
import type { ZoneType } from "../zone.js";

export interface LastKnownInfo {
  readonly cardId: EntityId;
  readonly timestamp: number;
  readonly chars: Readonly<Characteristics>;
  readonly zone: ZoneType;
  readonly controllerSeat: PlayerSeat | null;
  readonly tapped: boolean;
  readonly damage: number;
}

export interface LkiInput {
  readonly cardId: EntityId;
  readonly timestamp: number;
  readonly chars: Characteristics;
  readonly zone: ZoneType;
  readonly controllerSeat: PlayerSeat | null;
  readonly tapped: boolean;
  readonly damage: number;
}

export const captureLki = (args: LkiInput): LastKnownInfo => ({
  cardId: args.cardId,
  timestamp: args.timestamp,
  chars: Object.freeze({
    ...args.chars,
    supertypes: new Set(args.chars.supertypes),
    types: new Set(args.chars.types),
    subtypes: new Set(args.chars.subtypes),
    abilities: [...args.chars.abilities],
  }),
  zone: args.zone,
  controllerSeat: args.controllerSeat,
  tapped: args.tapped,
  damage: args.damage,
});

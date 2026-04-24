// SPDX-License-Identifier: GPL-3.0-or-later
// Live in-game Card entity. Distinct from PaperCard (the inventory-level
// identity) — a single PaperCard can instantiate many Cards across turns,
// copies, tokens, etc. Snapshot layer stores paperCardKey + live state;
// GameSnapshot (Task 42) rehydrates Cards by looking PaperCards up in a
// CardDb. Embedding the full PaperCard in every Card would bloat snapshots
// significantly.
import type {
  CounterType,
  EntityId,
  PaperCard,
  PlayerSeat,
  StaticAbility,
  ZoneType,
} from "@mtg-forge-ts/core";
import { paperCardKey } from "@mtg-forge-ts/core";
import type { CopiableCharacteristics } from "./copy/copiable-characteristics.js";

export class Card {
  tapped = false;
  phased = false;
  damage = 0;
  counters = new Map<CounterType, number>();
  attachedTo: EntityId | null = null;
  attachments: EntityId[] = [];
  // SP2 Task 3: Layer 1 copy source (CR 707.2). `faceDown` remains `unknown`
  // until Task 53-54 land the FaceDownState shape.
  copiedFrom: CopiableCharacteristics | null = null;
  faceDown: unknown | null = null;
  // SP2 Task 25: intrinsic static abilities derived from card text. SP3
  // replaces hand-population with PaperCard.definition-driven derivation.
  // `undefined` means "not yet populated"; treated identically to an
  // empty list by getIntrinsicStatics.
  intrinsicStatics?: readonly StaticAbility[] = undefined;

  constructor(
    readonly id: EntityId,
    readonly paperCard: PaperCard,
    public ownerSeat: PlayerSeat,
    public controllerSeat: PlayerSeat,
    public zone: ZoneType,
  ) {}

  toJSON(): {
    id: EntityId;
    paperCardKey: string;
    ownerSeat: PlayerSeat;
    controllerSeat: PlayerSeat;
    zone: ZoneType;
    tapped: boolean;
    phased: boolean;
    damage: number;
    counters: Record<string, number>;
    attachedTo: EntityId | null;
    attachments: EntityId[];
  } {
    return {
      id: this.id,
      paperCardKey: paperCardKey(this.paperCard),
      ownerSeat: this.ownerSeat,
      controllerSeat: this.controllerSeat,
      zone: this.zone,
      tapped: this.tapped,
      phased: this.phased,
      damage: this.damage,
      counters: Object.fromEntries(this.counters),
      attachedTo: this.attachedTo,
      attachments: [...this.attachments],
    };
  }
}

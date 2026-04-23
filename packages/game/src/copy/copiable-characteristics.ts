// SPDX-License-Identifier: GPL-3.0-or-later
// CR 707.2 — the copiable values of an object. Captured at copy-creation
// time from the source's fully-layered Characteristics (Task 55 wires the
// capture). Non-copiable: counters, damage, attachments, "memory" events.
//
// Deep readonly on this side because copies are immutable once captured —
// re-capture happens only if the original changes and the copy re-evaluates,
// which is out of scope for SP2's simple stored copy.
import type { CardType, ColorSet, ManaCost, Supertype } from "@mtg-forge-ts/core";

export interface CopiableCharacteristics {
  readonly name: string;
  readonly manaCost: ManaCost;
  readonly colorIndicator: ColorSet | null;
  readonly supertypes: ReadonlySet<Supertype>;
  readonly types: ReadonlySet<CardType>;
  readonly subtypes: ReadonlySet<string>;
  readonly colors: ColorSet;
  readonly rulesText: string;
  readonly power: number | null;
  readonly toughness: number | null;
  readonly loyalty: number | null;
  readonly defense: number | null;
}

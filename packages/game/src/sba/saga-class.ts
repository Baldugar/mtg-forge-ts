// SPDX-License-Identifier: GPL-3.0-or-later
// CR 704.5v — Saga sacrificed after final chapter resolved.
// CR 704.5 (Class) — Class permanent without a level counter gains level 1.
//
// Saga final-chapter detection:
//   SP3's chapter-ability scripting will set Card.sagaFinalChapterResolved
//   when the last chapter ability leaves the stack (CR 714.5). SP2 reads
//   that flag verbatim; the SBA fires once and the apply handler
//   sacrifices the Saga. No chapter-counter math here — the flag is the
//   authoritative signal.
//
// Class level-gain detection:
//   A Class permanent that has zero level counters (e.g. just entered
//   the battlefield, or had its counters reset) should be promoted to
//   level 1 via a +1 Level counter. Subtype is checked via
//   chars.subtypes.has("Class").
import { CounterType, ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { SbaAction } from "./sba-action.js";

const SUBTYPE_SAGA = "Saga";
const SUBTYPE_CLASS = "Class";

export const collectSagaAndClass = (game: Game, out: SbaAction[]): void => {
  for (const [id, card] of game.cards) {
    if (card.zone !== ZoneType.Battlefield) continue;
    const chars = game.layerEngine.computeCharacteristics(id);

    // Saga sacrificed (CR 704.5v)
    if (chars.subtypes.has(SUBTYPE_SAGA) && card.sagaFinalChapterResolved) {
      out.push({ kind: "sagaSacrificed", cardId: id });
      continue;
    }

    // Class without a Level counter → gain level 1 (+1 Level counter).
    if (chars.subtypes.has(SUBTYPE_CLASS)) {
      const level = card.counters.get(CounterType.Level) ?? 0;
      if (level === 0) {
        out.push({ kind: "classGainLevel", cardId: id });
      }
    }
  }
};

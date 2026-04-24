// SPDX-License-Identifier: GPL-3.0-or-later
// CR 704.5f/g/i/s — permanent-removal SBAs (creatures, planeswalkers, battles).
//
// CR 704.5f — creature with toughness <= 0 goes to graveyard (no regeneration).
// CR 704.5g — creature with damage >= toughness is destroyed (regeneration ok).
// CR 704.5i — planeswalker with 0 loyalty counters goes to graveyard.
// CR 704.5s — battle with 0 defense counters is exiled; on-defeat triggers
//             resolve off the subsequent priority window.
//
// Loyalty / defense are tracked as counters on the card (CR 208.2b, 310.8):
//   effective loyalty = card.counters.get(CounterType.Loyalty) ?? 0
//   effective defense = card.counters.get(CounterType.Defense) ?? 0
// We do not (yet) consult chars.loyalty / chars.defense — SP2 has no
// layered-value pipeline for those base numbers; counters are authoritative
// for SBA purposes.
//
// Toughness comes from the layer engine (computeCharacteristics) — SP2
// derives a real P/T once SP3 wires PaperCard.definition. Until then, base
// toughness remains null; a null toughness yields no SBA.
//
// Indestructible short-circuit (audit I-2) — CR 702.12b: indestructible
// permanents can't be destroyed. 704.5g (lethal damage) and 702.2b
// (deathtouch) are both destruction-based, so skip them for indestructible
// creatures. 704.5f (toughness ≤ 0) is NOT a destruction — it's a "goes to
// the graveyard" rule, which applies to indestructible creatures too.
import { CardType, CounterType, ZoneType } from "@mtg-forge-ts/core";
import { hasKeyword } from "../combat/damage-assignment-helpers.js";
import type { Game } from "../game.js";
import type { SbaAction } from "./sba-action.js";

export const collectCreatureRemoval = (game: Game, out: SbaAction[]): void => {
  for (const [id, card] of game.cards) {
    if (card.zone !== ZoneType.Battlefield) continue;
    const chars = game.layerEngine.computeCharacteristics(id);

    // Creatures (CR 704.5f + 704.5g)
    if (chars.types.has(CardType.Creature)) {
      const toughness = chars.toughness;
      if (typeof toughness === "number") {
        if (toughness <= 0) {
          // 704.5f supersedes 704.5g for the same creature in the same check.
          // Indestructible does NOT save a 0-toughness creature — CR 704.5f
          // is a put-into-graveyard rule, not a destruction. Audit I-2.
          out.push({ kind: "creatureZeroToughness", cardId: id });
          continue;
        }
        // Indestructible creatures ignore both the lethal-damage SBA
        // (CR 704.5g) and the deathtouch-damage SBA (CR 702.2b) because
        // both route through destruction (CR 702.12b).
        const indestructible = hasKeyword(game, id, "indestructible");
        if (card.damage >= toughness) {
          if (!indestructible) {
            out.push({ kind: "creatureLethalDamage", cardId: id });
          }
          continue;
        }
        // SP2 Task 78 (fix 2) — CR 702.2b: a creature dealt any nonzero
        // damage by a source with deathtouch is destroyed by SBA even
        // when damage < toughness. `damagedByDeathtouch` is set by
        // GameAction.damage when the source has the deathtouch keyword
        // and cleared on zone-change off the battlefield.
        if (card.damagedByDeathtouch === true && card.damage > 0 && !indestructible) {
          out.push({ kind: "creatureLethalDamage", cardId: id });
        }
      }
    }

    // Planeswalkers (CR 704.5i)
    if (chars.types.has(CardType.Planeswalker)) {
      const loyalty = card.counters.get(CounterType.Loyalty) ?? 0;
      if (loyalty <= 0) {
        out.push({ kind: "planeswalkerZeroLoyalty", cardId: id });
      }
    }

    // Battles (CR 704.5s)
    if (chars.types.has(CardType.Battle)) {
      const defense = card.counters.get(CounterType.Defense) ?? 0;
      if (defense <= 0) {
        out.push({ kind: "battleZeroDefense", cardId: id });
      }
    }
  }
};

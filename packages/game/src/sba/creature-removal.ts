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
// Indestructible check on CR 704.5g is TODO: until SP3 exposes keyword
// abilities as queryable flags via the layer engine, we don't short-circuit
// the lethal-damage SBA for indestructible creatures. Regeneration runs via
// the GameAction.destroy replacement pipeline as today.
import { CardType, CounterType, ZoneType } from "@mtg-forge-ts/core";
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
          out.push({ kind: "creatureZeroToughness", cardId: id });
          continue;
        }
        if (card.damage >= toughness) {
          // TODO (SP3 keyword surface): skip for indestructible creatures.
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

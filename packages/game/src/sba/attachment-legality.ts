// SPDX-License-Identifier: GPL-3.0-or-later
// CR 704.5n/p/q — attachment legality SBAs.
//   - Aura attached to an illegal object (or to nothing) → graveyard.
//   - Equipment attached to a non-creature → unattaches.
//   - Fortification attached to a non-land → unattaches.
//
// SP2 minimal: "illegal" for an Aura means "target isn't a permanent on
// the battlefield". SP3 adds per-aura enchant-target restrictions (CR
// 303.4) once the DSL surfaces them; until then, a live battlefield
// permanent counts as legal.
import { CardType, ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { SbaAction } from "./sba-action.js";

// Subtype constants — SP2 uses free-form strings for subtypes. Centralize
// the spellings here so tests and the collector agree.
const SUBTYPE_AURA = "Aura";
const SUBTYPE_EQUIPMENT = "Equipment";
const SUBTYPE_FORTIFICATION = "Fortification";

export const collectAttachmentLegality = (game: Game, out: SbaAction[]): void => {
  for (const [id, card] of game.cards) {
    if (card.zone !== ZoneType.Battlefield) continue;
    const chars = game.layerEngine.computeCharacteristics(id);
    const isAura = chars.subtypes.has(SUBTYPE_AURA);
    const isEquipment = chars.subtypes.has(SUBTYPE_EQUIPMENT);
    const isFortification = chars.subtypes.has(SUBTYPE_FORTIFICATION);
    if (!isAura && !isEquipment && !isFortification) continue;

    const attachedTo = card.attachedTo;
    const target = attachedTo !== null ? game.cards.get(attachedTo) : null;
    const targetChars = target ? game.layerEngine.computeCharacteristics(target.id) : null;

    if (isAura) {
      // Aura attached to nothing, or to a card no longer on the
      // battlefield, is illegal → graveyard.
      // EXCEPTION (CR 702.103): a bestowed Aura that becomes unattached
      // does NOT go to the graveyard. Instead it stops being an Aura and
      // becomes a creature again. We push a dedicated SBA action that
      // clears `bestowed` and `attachedTo` while leaving the card on the
      // battlefield. The deriveBaseCharacteristics flip then reverts the
      // type-set to its printed creature form on the next epoch.
      if (attachedTo === null || !target || target.zone !== ZoneType.Battlefield) {
        if (card.bestowed) {
          out.push({ kind: "bestowAuraDetach", cardId: id });
        } else {
          out.push({ kind: "auraUnattachedInvalid", cardId: id });
        }
        continue;
      }
      // SP3 TODO: check the aura's enchant-target restriction against the
      // target's characteristics. For now, any live battlefield target is
      // treated as legal.
    }
    if (isEquipment) {
      // Unattached equipment is legal (it just sits there until equipped).
      if (attachedTo === null) continue;
      if (!target || !targetChars || !targetChars.types.has(CardType.Creature)) {
        out.push({ kind: "equipmentUnattach", cardId: id });
      }
    }
    if (isFortification) {
      if (attachedTo === null) continue;
      if (!target || !targetChars || !targetChars.types.has(CardType.Land)) {
        out.push({ kind: "fortificationUnattach", cardId: id });
      }
    }
  }
};

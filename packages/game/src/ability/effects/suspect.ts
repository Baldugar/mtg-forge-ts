// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 71 — Suspect / CeaseBeingSuspected effects (CR 701.58, Murders at
// Karlov Manor).
//
// CR 701.58a — "To suspect a creature means to apply the following text
// to it for as long as it remains on the battlefield: 'This creature
// has menace and can't block.' "
// CR 701.58d — "A suspected permanent can't become suspected again."
//
// The canonical Forge surface is `AB$ AlterAttribute | Attributes$ Suspected`
// (handled by AlterAttributeEffect in wave-21-effects.ts). This module
// adds two thin convenience handlers — `AB$ Suspect` and
// `AB$ CeaseBeingSuspected` — that resolve the same flag flip without
// requiring a generic AlterAttribute dispatch. Both handlers:
//   - flip card.suspected on each target (sa.targets, falling back to
//     sa.sourceCardId when targets is empty — Defined$ Self semantics);
//   - bump the layer-engine epoch so the menace synthesis in
//     hasKeyword sees the new flag immediately;
//   - emit CardSuspected / CardUnsuspected so trigger handlers can
//     watch suspect lifecycle events.
import { mkEvent } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { canBeSuspected } from "../../statics/wave76-gate-helpers.js";
import { effectRegistry } from "../effect-registry.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class SuspectEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Suspect";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const ids = sa.targets.length > 0 ? sa.targets : [sa.sourceCardId];
    for (const id of ids) {
      const card = game.cards.get(id);
      if (!card) continue;
      // CR 701.58d — already suspected: skip (mirrors Forge's setSuspected
      // guard; not an error path, just a no-op so chained triggers don't
      // get duplicate events).
      if (card.suspected === true) continue;
      // Wave 76 — CantBeSuspected static gate; matched cards refuse the
      // suspect transition (silent rejection — no event, no flag flip).
      if (!canBeSuspected(game, id)) continue;
      card.suspected = true;
      game.layerEngine.bumpEpoch("suspect");
      yield game.emitEvent(
        mkEvent("CardSuspected", game.turn, game.phase, {
          cardId: id,
          sourceId: sa.sourceCardId,
        }),
      );
    }
  }
}

export class CeaseBeingSuspectedEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "CeaseBeingSuspected";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const ids = sa.targets.length > 0 ? sa.targets : [sa.sourceCardId];
    for (const id of ids) {
      const card = game.cards.get(id);
      if (!card) continue;
      if (card.suspected !== true) continue; // not suspected — no-op
      card.suspected = undefined;
      game.layerEngine.bumpEpoch("cease-suspect");
      yield game.emitEvent(
        mkEvent("CardUnsuspected", game.turn, game.phase, {
          cardId: id,
          sourceId: sa.sourceCardId,
        }),
      );
    }
  }
}

effectRegistry.register(SuspectEffect);
effectRegistry.register(CeaseBeingSuspectedEffect);

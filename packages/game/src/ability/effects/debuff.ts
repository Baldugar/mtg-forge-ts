// SPDX-License-Identifier: GPL-3.0-or-later
// DebuffEffect — Forge `DB$ Debuff` (Battle Cry / flanking-style "loses X
// keyword until end of turn"). Despite the name "Debuff", Forge's actual
// usage is keyword removal, not P/T reduction (P/T reduction is handled by
// PumpEffect with negative deltas). Per-corpus: Defined$ + Keywords$ pairs.
//
// Forge DSL examples:
//   SVar:TrigDebuff:DB$ Debuff | Defined$ TriggeredAttackerLKICopy | Keywords$ Flanking
//   SVar:DBDebuff:DB$ Debuff | Defined$ Targeted | Keywords$ Flying
//   SVar:DBDebuff:DB$ Debuff | Defined$ Remembered.Creature | Keywords$ Indestructible
//
// MVP scope: register a Layer 6 ability/keyword removal. Since the keyword
// system stores keywords on Card.keywords (a Set<string>), the simplest
// implementation removes the named keyword(s) from each affected card's
// keyword set until end of turn, restoring at cleanup.
//
// TODO(advanced): Layer 6 ContinuousEffect "remove keyword" via the layer
// engine (so granted keywords from other sources are also stripped). For
// the canonical "loses Flying until end of turn" (the dominant Forge use),
// directly mutating the live keyword set is sufficient.
import type { ContinuousEffect, EntityId } from "@mtg-forge-ts/core";
import { Layer } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

const splitKeywords = (raw: string): readonly string[] =>
  raw
    .split(/[,&]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

const lowerKeyword = (k: string): string => k.toLowerCase().replace(/[\s-]+/g, "_");

export class DebuffEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Debuff";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const keywordsRaw = hasParam(sa, "Keywords") ? evaluateParamRaw(sa, "Keywords") : "";
    const keywordIds = splitKeywords(keywordsRaw).map(lowerKeyword);
    if (keywordIds.length === 0) return;

    // Determine targets: explicit sa.targets first, else Defined$ Targeted
    // is treated as sa.targets (already populated by the cast pipeline).
    const affectedIds: EntityId[] = [];
    if (sa.targets.length > 0) {
      for (const t of sa.targets) affectedIds.push(t);
    }
    if (affectedIds.length === 0) return;

    // For each affected card: remove the named keyword(s) and register a
    // restore hook at end of turn via continuousEffectRegistry cleanup.
    const restoreList: { id: EntityId; restored: string[] }[] = [];
    for (const id of affectedIds) {
      const card = game.cards.get(id);
      if (!card) continue;
      const restored: string[] = [];
      const set = card.keywords;
      if (!set) continue;
      for (const kw of keywordIds) {
        if (set.has(kw)) {
          set.delete(kw);
          restored.push(kw);
        }
      }
      if (restored.length > 0) restoreList.push({ id, restored });
    }

    if (restoreList.length === 0) return;

    const effectId = game.newEntityId();
    const ce: ContinuousEffect = {
      id: effectId,
      sourceCardId: sa.sourceCardId,
      timestamp: game.newEntityId(),
      layer: Layer.L6_Ability,
      duration: { kind: "untilEndOfTurn" },
      payload: { kind: "noop" },
    };
    game.continuousEffectRegistry.register(ce);
    game.continuousEffectRegistry.registerCleanup(effectId, (g) => {
      for (const { id, restored } of restoreList) {
        const card = g.cards.get(id);
        if (!card) continue;
        if (!card.keywords) card.keywords = new Set();
        for (const kw of restored) card.keywords.add(kw);
      }
    });
  }
}

effectRegistry.register(DebuffEffect);

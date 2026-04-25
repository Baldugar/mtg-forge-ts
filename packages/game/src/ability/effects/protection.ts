// SPDX-License-Identifier: GPL-3.0-or-later
// ProtectionEffect — grants protection from a color/type to the target.
//
// Forge DSL:
//   SP$ Protection | ValidTgts$ Creature.YouCtrl | Gains$ red | Until$ EOT
//   SP$ Protection | ValidTgts$ Card.Self | Gains$ white | Until$ EOT
//
// Architecture note (Wave 3 + Wave 9): protection is checked by combat/targeting
// code via `readProtectionTags(game, cardId)` which reads directly from
// `card.keywords` (a mutable Set<string>). The Layer 6 ability-add
// ContinuousEffect pathway adds to `characteristics.abilities`
// (ActiveAbilityRef), NOT to card.keywords — so the Layer 6 pathway would
// require plumbing a new `keywordAdd` AbilityChangeEffect kind through the
// layer engine.
//
// Implementation: directly add `"protection:<tag>"` to card.keywords for
// reader correctness, plus register a ContinuousEffect for observability /
// expiry bookkeeping. Wave 9 — wire the keyword removal via
// `continuousEffectRegistry.registerCleanup(effectId, fn)`: when the registry
// drains the effect at end-of-turn (or explicit unregister), the hook removes
// the keyword from card.keywords. This closes the prior MVP gap where the
// keyword stayed on the card after EOT.
import type { ContinuousEffect } from "@mtg-forge-ts/core";
import { Layer } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import type { AbilityChangeEffect } from "../../layers/layer6-ability.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class ProtectionEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Protection";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const gains = hasParam(sa, "Gains") ? evaluateParamRaw(sa, "Gains").toLowerCase() : "";
    if (!gains) return;

    const durationRaw = hasParam(sa, "Until") ? evaluateParamRaw(sa, "Until") : "EOT";
    const duration: ContinuousEffect["duration"] =
      durationRaw.toLowerCase() === "eot" || durationRaw.toLowerCase() === "endofturns"
        ? { kind: "untilEndOfTurn" }
        : { kind: "permanent" };

    const keyword = `protection:${gains}`;

    for (const targetId of sa.targets) {
      const card = game.cards.get(targetId);
      if (!card) continue;

      // Direct keyword mutation — protection checks read card.keywords directly.
      if (!card.keywords) card.keywords = new Set();
      card.keywords.add(keyword);

      // Register a ContinuousEffect for observability and EOT-expiry bookkeeping.
      // The cleanup hook below removes the keyword from card.keywords when the
      // registry expires the effect (Wave 9 — closes the prior cleanup gap).
      const timestamp = game.newEntityId();
      const abilityEffect: AbilityChangeEffect = {
        kind: "add",
        // Use the effect's own id as abilityId (synthetic — no real ability behind it).
        abilityId: game.newEntityId(),
        grantedBy: sa.sourceCardId,
        origin: "layer6",
        timestamp,
        targetCardId: targetId,
      };
      const effectId = game.newEntityId();
      const continuousEffect: ContinuousEffect = {
        id: effectId,
        sourceCardId: sa.sourceCardId,
        timestamp,
        layer: Layer.L6_Ability,
        duration,
        payload: { kind: "ability", effect: abilityEffect },
      };
      game.continuousEffectRegistry.register(continuousEffect);
      // Schedule keyword removal at expiry. We capture targetId + keyword in
      // the closure so the hook can locate the card and reverse the mutation
      // even if the card has changed zones in the meantime.
      game.continuousEffectRegistry.registerCleanup(effectId, (g) => {
        const c = g.cards.get(targetId);
        if (c?.keywords) c.keywords.delete(keyword);
      });
    }
  }
}

effectRegistry.register(ProtectionEffect);

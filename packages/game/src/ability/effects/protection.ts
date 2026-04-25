// SPDX-License-Identifier: GPL-3.0-or-later
// ProtectionEffect — grants protection from a color/type to the target.
//
// Forge DSL:
//   SP$ Protection | ValidTgts$ Creature.YouCtrl | Gains$ red | Until$ EOT
//   SP$ Protection | ValidTgts$ Card.Self | Gains$ white | Until$ EOT
//
// Architecture note (Wave 3): protection is checked by combat/targeting code
// via `readProtectionTags(game, cardId)` which reads directly from `card.keywords`
// (a mutable Set<string>). The Layer 6 ability-add ContinuousEffect pathway
// adds to `characteristics.abilities` (ActiveAbilityRef), NOT to card.keywords —
// so the Layer 6 pathway would require plumbing a new `keywordAdd` AbilityChangeEffect
// kind through the layer engine.
//
// MVP approach: directly add `"protection:<tag>"` to card.keywords and
// register a ContinuousEffect for EOT-expiry bookkeeping. On expiry the
// ContinuousEffectRegistry fires `removeLayerPayload` which splices the
// AbilityChangeEffect from the layer engine, but card.keywords mutation
// must be reversed explicitly. We use a one-shot ReplacementAbility keyed on
// TurnEnded to clean up (via replacement-on-phase-event pattern is not
// available). For now we emit the ContinuousEffect for observability but also
// schedule keyword removal via a closure registered with the replacement registry
// matching a synthetic "endOfTurnCleanup" intent — EXCEPT that pattern doesn't
// exist either.
//
// FINAL MVP: add keyword directly. Duration=EOT: register the continuous effect
// (visible in game.continuousEffects), and remove the keyword when the
// ContinuousEffectRegistry fires the expiry. Since the expiry hook doesn't
// call back into card.keywords yet, we track the keyword addition as permanent
// for the current turn and accept that cleanup at EOT requires the orchestrator
// (Milestone J) to call registry.drainExpired() → which removes the
// ContinuousEffect from the registry but does NOT remove from card.keywords.
//
// TODO(SP3-Milestone-J): wire ContinuousEffectRegistry.unregister to call
// a `onExpiry` callback per effect so keyword-grant ContinuousEffects can
// remove the keyword from card.keywords on expiry.
//
// Until that wiring lands, ProtectionEffect adds the keyword for the game's
// duration (effectively permanent from card.keywords perspective). Combat
// and targeting protection checks work correctly; EOT cleanup of the keyword
// is deferred.
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

  // biome-ignore lint/correctness/useYield: synchronous keyword mutation — no EngineYield to emit
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
      // When Milestone J's drainExpired() fires, this effect will be removed from
      // the registry (and its payload spliced from the layer engine), but card.keywords
      // is NOT auto-cleaned. TODO(SP3-Milestone-J): add onExpiry callback.
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
      const continuousEffect: ContinuousEffect = {
        id: game.newEntityId(),
        sourceCardId: sa.sourceCardId,
        timestamp,
        layer: Layer.L6_Ability,
        duration,
        payload: { kind: "ability", effect: abilityEffect },
      };
      game.continuousEffectRegistry.register(continuousEffect);
    }
  }
}

effectRegistry.register(ProtectionEffect);

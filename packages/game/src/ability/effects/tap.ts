// SPDX-License-Identifier: GPL-3.0-or-later
import type { EntityId } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import { parseValidTgts } from "../../cast/valid-targets.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";
import { enumerateOverloadedTargets } from "./overload-enumerate.js";

/**
 * M6.39 — Resolve a Defined$ selector to a list of EntityIds (cards) for
 * the Tap effect. Mirrors DealDamage's `resolveDefined` minus player flavours
 * (you can't tap a player). Supports `Self` (sa.sourceCardId) and `Targeted`
 * (alias for sa.targets). Forge's TapEffect maps Defined$ Self → setTapped
 * directly (see worn-powerstone-style scripts).
 */
function resolveDefinedCards(raw: string, sa: SpellAbility): readonly EntityId[] {
  const tok = raw.trim();
  if (tok === "Self") return [sa.sourceCardId];
  if (tok === "Targeted" || tok === "TargetedCard") return sa.targets;
  return [];
}

export class TapEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Tap";
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    // M6.5 — `ETB$ True` (Forge: Mosswort Bridge / Cinder Glade enter-
    // tapped lands). When the tap happens *as part of ETB* the canonical
    // CardTapped event is suppressed (matches Forge's `TapEffect.java`
    // line 74-77: `if (sa.hasParam("ETB"))` calls `setTapped(true)`
    // directly). Tap-watching triggers don't fire (e.g. Hidden Strings)
    // and the parity bridge sees no GameEventCardTapped either.
    const params = (sa as unknown as { ast?: { effect?: { params?: Record<string, { raw?: string }> } } }).ast
      ?.effect?.params;
    const etbRaw = params?.ETB?.raw;
    const isEtbTap = typeof etbRaw === "string" && etbRaw.toLowerCase() === "true";

    // Wave 10 — Overload (CR 702.96): if the cast was overloaded, replace
    // the chosen targets with EVERY object matching the spell's
    // ValidTgts$ filter and apply the effect to each.
    if (sa.tags.has("overloaded")) {
      const ids = enumerateOverloadedTargets(sa, game, parseValidTgts);
      for (const targetId of ids) {
        yield* game.action.tap(targetId, { suppressEvent: isEtbTap });
      }
      return;
    }
    // M6.39 — Defined$ recipient path. When a Tap effect specifies
    // `Defined$ Self` (Worn Powerstone-style ETB self-tap from a TrigTap
    // SVar), use the resolved entity rather than sa.targets (which would
    // be empty since no targeting decision occurred). Mirrors DealDamage's
    // Defined$ handling.
    let targets: readonly EntityId[] = sa.targets;
    if (sa.targets.length === 0 && hasParam(sa, "Defined")) {
      targets = resolveDefinedCards(evaluateParamRaw(sa, "Defined"), sa);
    }
    for (const targetId of targets) {
      yield* game.action.tap(targetId, { suppressEvent: isEtbTap });
    }
  }
}

effectRegistry.register(TapEffect);

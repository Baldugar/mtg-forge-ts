// SPDX-License-Identifier: GPL-3.0-or-later
import type { EngineYield } from "../../action/engine-yield.js";
import { parseValidTgts } from "../../cast/valid-targets.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";
import { enumerateOverloadedTargets } from "./overload-enumerate.js";

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
    for (const targetId of sa.targets) {
      yield* game.action.tap(targetId, { suppressEvent: isEtbTap });
    }
  }
}

effectRegistry.register(TapEffect);

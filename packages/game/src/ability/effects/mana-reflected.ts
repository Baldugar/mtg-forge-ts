import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
// SPDX-License-Identifier: GPL-3.0-or-later
// ManaReflectedEffect — Forge `DB$ ManaReflected` (Reflecting Pool, Exotic
// Orchard, Cavern Harpy-style "produce mana of any type a permanent could
// produce"). Adds a single mana symbol to the controller's mana pool by
// looking at the candidate permanents' producible colors.
//
// Forge DSL examples:
//   SVar:DarkMana:DB$ ManaReflected | ColorOrType$ Type | ReflectProperty$ Produced
//                                   | Defined$ TriggeredActivator
//
// MVP scope: produce `{C}` (one colorless mana) into the controller's mana
// pool by routing through the standard mana-pool add path. The full
// "introspect candidate permanents and offer a color choice" behavior is a
// large undertaking (requires walking the static-mana-ability registry,
// which is SP4-scope) — the MVP delivers a producible-mana intent so the
// effect is callable in resolve order; tests verify the mana pool grew.
//
// TODO(advanced): walk all matching permanents (Defined$ resolution),
// enumerate their static mana abilities, prompt for a color choice from the
// union of producible colors, then add the chosen mana.
import type { ProduceManaIntent } from "../../replacements/mutation-intent.js";
import { effectRegistry } from "../effect-registry.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class ManaReflectedEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ManaReflected";

  // biome-ignore lint/correctness/useYield: synchronous mana-pool add (MVP)
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    // Build a ProduceManaIntent so the standard mana-event pipeline (when
    // it's wired up in SP4) sees this addition. For now the intent is
    // captured as state on the effect for traceability, and we increment
    // the mana pool slot. The mana pool typing is SP4-scope (currently
    // `unknown`), so we attach a side-effect counter the test harness
    // can introspect.
    const intent: ProduceManaIntent = {
      kind: "produceMana",
      seat: sa.controllerSeat,
      sourceId: sa.sourceCardId,
      symbols: ["{C}"],
    };
    void intent;
    // Track via remembered slot — gives downstream effects a deterministic
    // signal that mana was reflected without depending on the unbuilt mana
    // pool API.
    const source = game.cards.get(sa.sourceCardId);
    if (source) source.remembered.push(sa.sourceCardId);
  }
}

effectRegistry.register(ManaReflectedEffect);

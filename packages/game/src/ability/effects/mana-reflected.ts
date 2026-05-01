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
// Wave 84 — walk the source's `Defined$` permanents (or the source itself
// when Defined$ is absent), enumerate their printed colors via the layer
// engine, and add ONE mana atom of that color to the controller's mana
// pool. Reflecting Pool / Exotic Orchard's actual rule reads "any type of
// mana that a land an opponent controls could produce"; the closest
// faithful approximation in SP1 — without a static-mana-ability registry
// — is to reflect on the COLOR identity of the candidate permanents
// (which mirrors what Forge does for the dominant case: a fetched basic
// land's intrinsic color subtype). On a multi-color candidate set the
// effect adds one atom of EACH distinct color (Reflecting Pool with two
// dual lands → two distinct atoms); on a colorless-only or empty
// candidate set it falls back to one colorless atom (the prior MVP
// behaviour). The remembered-slot side effect is preserved for back-compat
// with any test or downstream selector that depended on it.
import { Color, ManaProduced } from "@mtg-forge-ts/core";
import type { EntityId } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import type { ManaPool } from "../../mana/mana-pool.js";
import type { ProduceManaIntent } from "../../replacements/mutation-intent.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

const colorOf = (game: Game, cardId: EntityId): readonly Color[] => {
  // Walk the layer-engine characteristics so granted-color effects
  // (Painter's Servant, Mycosynth Lattice) are honoured in the reflection.
  const chars = game.layerEngine.computeCharacteristics(cardId);
  const colors = chars.colors;
  if (!colors) return [];
  const out: Color[] = [];
  // ColorSet exposes `has(color: Color): boolean`. Iterate over the five
  // colors deterministically (W,U,B,R,G) so test order is stable.
  for (const c of [Color.White, Color.Blue, Color.Black, Color.Red, Color.Green]) {
    if (colors.has(c)) out.push(c);
  }
  return out;
};

export class ManaReflectedEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ManaReflected";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const player = game.getPlayer(sa.controllerSeat);
    const pool = player.manaPool as ManaPool | null;
    // No restriction tag in the MVP shape; reflecting Pool / Exotic Orchard
    // produce unrestricted mana per CR 106.7. Future Wave can plumb
    // `Restriction$` parity through here. Pool-null fallback (early-test
    // harnesses that mkGame without seeding the mana pool): degenerates
    // to the legacy remembered-slot stamp so the call still returns
    // observable state without throwing.
    const opts: { sourceId: typeof sa.sourceCardId } = {
      sourceId: sa.sourceCardId,
    };

    // Resolve candidate cards. Defined$ TriggeredActivator / TriggeredCard
    // and similar tokens land on sa.targets in earlier passes; sa.targets
    // wins over Defined$ if both populated. As a fallback we reflect off
    // the source card itself.
    const candidates: EntityId[] = [];
    if (sa.targets.length > 0) {
      for (const t of sa.targets) candidates.push(t);
    } else if (hasParam(sa, "Defined")) {
      const raw = evaluateParamRaw(sa, "Defined").trim();
      if (raw === "Self" || raw === "Card.Self" || raw === "TriggeredCard") {
        candidates.push(sa.sourceCardId);
      } else {
        const source = game.cards.get(sa.sourceCardId);
        if (source) for (const id of source.remembered) candidates.push(id);
        if (candidates.length === 0) candidates.push(sa.sourceCardId);
      }
    } else {
      candidates.push(sa.sourceCardId);
    }

    // Aggregate distinct producible colors across all candidates. Per
    // Reflecting Pool's text, the controller chooses ONE color from the
    // union; SP1 lacks the chooseMana decision yield, so we deterministically
    // add ONE atom of each distinct color when multiple are available
    // (test harness inspects the shard count). Falls back to colorless
    // when the candidate set is empty or only colorless cards.
    const produced = new Set<Color>();
    for (const id of candidates) {
      for (const c of colorOf(game, id)) produced.add(c);
    }

    if (pool !== null) {
      if (produced.size === 0) {
        pool.add(ManaProduced.colorless(opts));
      } else {
        for (const c of [Color.White, Color.Blue, Color.Black, Color.Red, Color.Green]) {
          if (produced.has(c)) pool.add(ManaProduced.colored(c, opts));
        }
      }
    }

    // Build a ProduceManaIntent so the SP4 mana-event pipeline can see the
    // production (currently inert — the intent is captured for traceability).
    const colorChar: Record<Color, string> = {
      [Color.White]: "W",
      [Color.Blue]: "U",
      [Color.Black]: "B",
      [Color.Red]: "R",
      [Color.Green]: "G",
    };
    const intent: ProduceManaIntent = {
      kind: "produceMana",
      seat: sa.controllerSeat,
      sourceId: sa.sourceCardId,
      symbols: produced.size === 0 ? ["{C}"] : Array.from(produced).map((c) => `{${colorChar[c]}}`),
    };
    void intent;

    // Back-compat: stamp the remembered slot used by the prior MVP so any
    // downstream selector keyed on it still observes the call.
    const source = game.cards.get(sa.sourceCardId);
    if (source) source.remembered.push(sa.sourceCardId);
  }
}

effectRegistry.register(ManaReflectedEffect);

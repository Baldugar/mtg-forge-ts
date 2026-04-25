// SPDX-License-Identifier: GPL-3.0-or-later
// ManaEffect — adds produced mana to the controller's mana pool.
//
// Forge DSL:
//   AB$ Mana | Cost$ T | Produced$ G
//   AB$ Mana | Cost$ T | Produced$ G G       (two green, e.g. Gaea's Cradle workaround)
//   AB$ Mana | Cost$ T | Produced$ Combo R G  (player-choice; MVP: pick first)
//   AB$ Mana | Cost$ T | Produced$ Any        (any color; MVP: colorless)
//
// Supported single-symbol tokens:
//   W U B R G  → colored mana
//   C          → explicit colorless
//   1-9        → generic (colorless) atoms per the digit count
//
// Combo / Any variants are documented as MVP (pick first / colorless).
// Full player-choice wiring requires the decision subsystem (SP3+).
import { Color, ManaProduced } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import type { ManaPool } from "../../mana/mana-pool.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamRaw } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

/** Map a single mana-symbol string to a ManaProduced atom. */
function parseProducedSymbol(
  sym: string,
  sourceId: import("@mtg-forge-ts/core").EntityId | null,
): ManaProduced {
  // exactOptionalPropertyTypes: only spread sourceId when non-null.
  const srcOpt = sourceId !== null ? { sourceId } : {};
  switch (sym.toUpperCase()) {
    case "W":
      return ManaProduced.colored(Color.White, srcOpt);
    case "U":
      return ManaProduced.colored(Color.Blue, srcOpt);
    case "B":
      return ManaProduced.colored(Color.Black, srcOpt);
    case "R":
      return ManaProduced.colored(Color.Red, srcOpt);
    case "G":
      return ManaProduced.colored(Color.Green, srcOpt);
    case "C":
      return ManaProduced.colorless(srcOpt);
    default: {
      // Numeric digit → that many colorless atoms (add them via caller loop).
      // Here we always return one colorless atom; caller handles multi-digit.
      return ManaProduced.colorless(srcOpt);
    }
  }
}

export class ManaEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Mana";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const produced = evaluateParamRaw(sa, "Produced");
    const player = game.getPlayer(sa.controllerSeat);
    const pool = player.manaPool as ManaPool;
    const src = sa.sourceCardId;

    // "Any" → MVP: add one colorless. Full decision support deferred to SP3.
    if (produced === "Any") {
      pool.add(ManaProduced.colorless({ sourceId: src }));
      return;
    }

    // "Combo R G" → MVP: add first listed color. Full choice deferred to SP3.
    if (produced.startsWith("Combo ")) {
      const opts = produced
        .slice(6)
        .split(/\s+/)
        .filter((s) => s !== "");
      const choice = opts[0] ?? "C";
      pool.add(parseProducedSymbol(choice, src));
      return;
    }

    // Standard: space-separated symbols. "G" → 1 green. "G G" → 2 green.
    // Numeric tokens like "1" produce that many colorless atoms.
    for (const sym of produced.split(/\s+/).filter((s) => s !== "")) {
      const n = Number(sym);
      if (!Number.isNaN(n) && n > 0) {
        // Numeric generic mana → n colorless atoms.
        for (let i = 0; i < n; i++) {
          pool.add(ManaProduced.colorless({ sourceId: src }));
        }
      } else {
        pool.add(parseProducedSymbol(sym, src));
      }
    }
  }
}

effectRegistry.register(ManaEffect);

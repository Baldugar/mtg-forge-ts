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
import type { ManaProductionRestriction } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import type { ManaPool } from "../../mana/mana-pool.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

/**
 * Map the `Restriction$ <Tag>` param value to a ManaProductionRestriction.
 * Returns "none" for unknown tags (defensive — we never want to silently
 * change pool semantics on a typo).
 */
const parseRestriction = (raw: string | undefined): ManaProductionRestriction => {
  switch (raw) {
    case "CreatureSpells":
      return "creatureSpells";
    case "OnlyThisTurn":
      return "onlyThisTurn";
    case "MustSpendOrLoseLife":
      return "mustSpendOrLoseLife";
    case "ArtifactSpells":
      return "artifactSpells";
    case "NonCreatureNonActivated":
      return "nonCreatureNonActivated";
    default:
      return "none";
  }
};

/** Map a single mana-symbol string to a ManaProduced atom. */
function parseProducedSymbol(
  sym: string,
  sourceId: import("@mtg-forge-ts/core").EntityId | null,
  restriction: ManaProductionRestriction,
): ManaProduced {
  // exactOptionalPropertyTypes: only spread sourceId when non-null and
  // restriction when non-default.
  const srcOpt = sourceId !== null ? { sourceId } : {};
  const restOpt = restriction !== "none" ? { restriction } : {};
  const opts = { ...srcOpt, ...restOpt };
  switch (sym.toUpperCase()) {
    case "W":
      return ManaProduced.colored(Color.White, opts);
    case "U":
      return ManaProduced.colored(Color.Blue, opts);
    case "B":
      return ManaProduced.colored(Color.Black, opts);
    case "R":
      return ManaProduced.colored(Color.Red, opts);
    case "G":
      return ManaProduced.colored(Color.Green, opts);
    case "C":
      return ManaProduced.colorless(opts);
    default: {
      // Numeric digit → that many colorless atoms (add them via caller loop).
      // Here we always return one colorless atom; caller handles multi-digit.
      return ManaProduced.colorless(opts);
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
    // Wave 53 — Amount$ multiplies Produced$ by N (Mana Reflection-style
    // doublers script `Amount$ X` against Count$Devotion etc.). Default 1.
    const amount = hasParam(sa, "Amount") ? evaluateParamNumber(sa, "Amount", game) : 1;
    // Wave 29 — `Restriction$ <Tag>` (Powerstone, Cabal Coffers, etc.)
    // attaches a ManaProductionRestriction to every atom produced by
    // this ability. Tags read by parseRestriction; "none" preserves
    // pre-Wave-29 unrestricted behaviour for any ability without a
    // Restriction$ param.
    const restriction = parseRestriction(
      hasParam(sa, "Restriction") ? evaluateParamRaw(sa, "Restriction") : undefined,
    );
    const colorlessOpts: { sourceId?: typeof src; restriction?: ManaProductionRestriction } = {
      sourceId: src,
    };
    if (restriction !== "none") colorlessOpts.restriction = restriction;

    // "Any" → MVP: add one colorless. Full decision support deferred to SP3.
    if (produced === "Any") {
      for (let m = 0; m < amount; m++) pool.add(ManaProduced.colorless(colorlessOpts));
      return;
    }

    // "Combo R G" → MVP: add first listed color. Full choice deferred to SP3.
    if (produced.startsWith("Combo ")) {
      const opts = produced
        .slice(6)
        .split(/\s+/)
        .filter((s) => s !== "");
      const choice = opts[0] ?? "C";
      for (let m = 0; m < amount; m++) pool.add(parseProducedSymbol(choice, src, restriction));
      return;
    }

    // Standard: space-separated symbols. "G" → 1 green. "G G" → 2 green.
    // Numeric tokens like "1" produce that many colorless atoms.
    for (let m = 0; m < amount; m++) {
      for (const sym of produced.split(/\s+/).filter((s) => s !== "")) {
        const n = Number(sym);
        if (!Number.isNaN(n) && n > 0) {
          // Numeric generic mana → n colorless atoms.
          for (let i = 0; i < n; i++) {
            pool.add(ManaProduced.colorless(colorlessOpts));
          }
        } else {
          pool.add(parseProducedSymbol(sym, src, restriction));
        }
      }
    }
  }
}

effectRegistry.register(ManaEffect);

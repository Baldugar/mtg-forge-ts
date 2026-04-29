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
//
// Wave 63.B sub-params:
//   - Replace$ <from>:<to>[, <from2>:<to2>...] — color rewrite of the
//     produced atoms BEFORE they hit the pool. Mana Reflection-style
//     "replace any with U" effects script this. Each `from` symbol from
//     the produced list is rewritten to its mapped `to`; the special
//     `Any` token also matches the "Any" branch above so Mana Reflection
//     can re-target the colorless fallback. Symbols not in the map flow
//     through unchanged.
//   - Pool$ True — bypass any "ask which color to produce" decision and
//     produce as specified. The current MVP picks the first listed
//     option for `Combo` deterministically; with `Pool$ True` we
//     additionally force the `Any` branch to skip the future
//     decision-yield path entirely (we go straight to the colorless
//     atom as today). Once the decision subsystem lands a `chooseMana`
//     yield, the `Pool$` flag will be the gate that suppresses it.
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

    // Wave 63.B — Replace$ <from>:<to>[, ...] color rewrite map. Applied
    // to every produced symbol BEFORE it's parsed into a ManaProduced
    // atom. Both `from` and `to` are normalised to single-letter color
    // tokens (W/U/B/R/G/C) when the mapping uses long-form words.
    const replaceMap = parseReplaceMap(hasParam(sa, "Replace") ? evaluateParamRaw(sa, "Replace") : "");
    const remap = (sym: string): string => {
      const norm = REWRITE_NORMALIZE[sym] ?? sym;
      return replaceMap[norm] ?? sym;
    };
    // Wave 63.B — Pool$ True is the explicit gate for "skip the decision".
    // The MVP already produces deterministically; the flag is wired so the
    // future chooseMana decision yield (Combo / Any) can branch on it.
    void (hasParam(sa, "Pool") ? evaluateParamRaw(sa, "Pool") : "");

    // "Any" → MVP: add one colorless. Full decision support deferred to SP3.
    // Wave 63.B — when Replace$ remaps "Any", honour the rewrite (Mana
    // Reflection style "any color → blue").
    if (produced === "Any") {
      const remapped = remap("Any");
      for (let m = 0; m < amount; m++) {
        if (remapped === "Any") {
          pool.add(ManaProduced.colorless(colorlessOpts));
        } else {
          pool.add(parseProducedSymbol(remapped, src, restriction));
        }
      }
      return;
    }

    // "Combo R G" → MVP: add first listed color. Full choice deferred to SP3.
    if (produced.startsWith("Combo ")) {
      const opts = produced
        .slice(6)
        .split(/\s+/)
        .filter((s) => s !== "");
      const choice = opts[0] ?? "C";
      const remapped = remap(choice);
      for (let m = 0; m < amount; m++) pool.add(parseProducedSymbol(remapped, src, restriction));
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
          pool.add(parseProducedSymbol(remap(sym), src, restriction));
        }
      }
    }
  }
}

// Wave 63.B — Replace$ map parser. Accepts "Any:U" or "W:G,B:R"
// (comma-separated pairs). Long-form words (White → W) are normalised so
// callers can write either letter or word forms. Empty strings yield an
// empty map.
const REWRITE_NORMALIZE: Readonly<Record<string, string>> = {
  White: "W",
  Blue: "U",
  Black: "B",
  Red: "R",
  Green: "G",
  Colorless: "C",
};

function parseReplaceMap(raw: string): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  if (raw.trim() === "") return out;
  for (const pair of raw.split(",")) {
    const [fromRaw, toRaw] = pair.split(":");
    if (fromRaw === undefined || toRaw === undefined) continue;
    const from = fromRaw.trim();
    const to = toRaw.trim();
    if (from === "" || to === "") continue;
    const fromKey = REWRITE_NORMALIZE[from] ?? from;
    const toKey = REWRITE_NORMALIZE[to] ?? to;
    out[fromKey] = toKey;
  }
  return out;
}

effectRegistry.register(ManaEffect);

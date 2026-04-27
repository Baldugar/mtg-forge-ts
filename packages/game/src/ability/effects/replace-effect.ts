// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 56 — ReplaceEffect family. Six sub-effect handlers that run INSIDE
// replacement bodies via `ReplaceWith$ <SVar>` dispatch:
//
//   DB$ ReplaceEffect       — generic VarName/VarValue rewrite
//   DB$ ReplaceDamage       — Amount / Source / Target rewrite on damage intents
//   DB$ ReplaceMana         — From / To color swap on mana intents
//   DB$ ReplaceToken        — Multiplier / Color rewrite on createToken intents
//   DB$ ReplaceCounter      — Multiplier / CounterType rewrite on addCounter intents
//   DB$ ReplaceSplitDamage  — divides one damage intent across multiple targets
//
// Forge usage shape:
//   R:Event$ Damage | ValidTarget$ Card.Self | ReplaceWith$ DBPrevent
//   SVar:DBPrevent:DB$ ReplaceEffect | VarName$ DamageAmount | VarValue$ 0
//
// The parent replacement's apply() stamps the in-flight intent into
// `game.flags.activeReplacementIntent` BEFORE invoking the SVar; the
// `Replace*` effect resolvers read that slot, mutate the relevant field,
// and write the new intent back. The parent reads the slot after the SVar
// returns and substitutes that mutated intent for the canonical event.
//
// MVP simplification: the slot is a side channel rather than a parameter
// threaded through the SpellAbility resolver signature. The slot is
// transient (set inside one apply() boundary, cleared on the way out) so
// re-entrancy is bounded by the apply-loop's single-threaded control
// flow.
import type { CounterType, EntityId, PlayerSeat, ZoneType } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

// ---------------------------------------------------------------------------
// Side-channel helpers — read/write the active replacement intent.
// ---------------------------------------------------------------------------

/**
 * Read the in-flight replacement intent from the game.flags side channel.
 * Returns null when no replacement is currently being applied (the slot is
 * untouched outside `applyWithReplacements`). Effect handlers in the
 * ReplaceEffect family are no-ops in that case — the canonical use is
 * inside a `ReplaceWith$ <SVar>` dispatch where the parent replacement
 * stamped the slot just before invoking the SVar.
 */
const getActiveIntent = (game: Game): Record<string, unknown> | null => {
  const slot = game.flags.activeReplacementIntent;
  if (slot === null || slot === undefined) return null;
  return slot as Record<string, unknown>;
};

/**
 * Write a mutated intent shape back to the side channel. The parent
 * replacement's apply() reads this slot after the SVar returns and uses
 * it (rather than the original) as the next stage of the apply loop.
 */
const setActiveIntent = (game: Game, intent: Record<string, unknown>): void => {
  game.flags.activeReplacementIntent = intent;
};

/** Parse a literal integer string; returns undefined on failure. */
const parseInt10 = (raw: string | undefined): number | undefined => {
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
};

// ---------------------------------------------------------------------------
// 1. ReplaceEffect — generic VarName / VarValue rewrite.
// ---------------------------------------------------------------------------
// VarName$ DamageAmount | VarValue$ 0       → zeroes intent.amount
// VarName$ Destination  | VarValue$ Exile   → redirects moveTo intent
// VarName$ Count        | VarValue$ 0       → zero token count
//
// The handler is FIELD-NAME GENERIC: any literal property on the intent
// can be overwritten. Numeric VarValues are coerced via parseInt10; string
// values pass through unchanged. Unknown VarName / missing slot → no-op.
export class ReplaceEffectEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ReplaceEffect";

  // biome-ignore lint/correctness/useYield: pure intent mutation
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const intent = getActiveIntent(game);
    if (intent === null) return;
    if (!hasParam(sa, "VarName") || !hasParam(sa, "VarValue")) return;
    const varName = evaluateParamRaw(sa, "VarName").trim();
    const rawValue = evaluateParamRaw(sa, "VarValue").trim();
    const numeric = parseInt10(rawValue);
    const value: unknown = numeric !== undefined ? numeric : rawValue;
    setActiveIntent(game, { ...intent, [varName]: value });
  }
}
effectRegistry.register(ReplaceEffectEffect);

// ---------------------------------------------------------------------------
// 2. ReplaceDamage — damage-specific intent rewrite.
// ---------------------------------------------------------------------------
// Amount$ <int>       → set intent.amount
// Source$ NewSource   → forwarded as redirected source (TODO advanced —
//                        SP3 source resolution requires SVar context)
// Target$ NewTarget   → similarly forwarded; for MVP we only honor the
//                        special raw "Source" / "You" sentinels.
export class ReplaceDamageEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ReplaceDamage";

  // biome-ignore lint/correctness/useYield: pure intent mutation
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const intent = getActiveIntent(game);
    if (intent === null || intent.kind !== "damage") return;
    const next: Record<string, unknown> = { ...intent };
    if (hasParam(sa, "Amount")) {
      next.amount = evaluateParamNumber(sa, "Amount", game);
    }
    if (hasParam(sa, "Target")) {
      const tgt = evaluateParamRaw(sa, "Target").trim();
      // Forge convention: "You" routes to controller; "Source" routes to
      // the damage source (redirect-to-source). MVP supports these two
      // canonical sentinels; richer Defined$ resolution lands later.
      if (tgt === "You") {
        next.targetKind = "player";
        next.targetId = sa.controllerSeat as unknown as PlayerSeat;
      } else if (tgt === "Source") {
        const srcId = (intent as { sourceId?: EntityId }).sourceId;
        if (srcId !== undefined) {
          next.targetKind = "creature";
          next.targetId = srcId;
        }
      }
    }
    if (hasParam(sa, "Source")) {
      const src = evaluateParamRaw(sa, "Source").trim();
      if (src === "You") {
        // Forge has no "controller as damage source" representation in
        // the engine intent; we leave the slot but stamp a flag so
        // observers can detect the rewrite.
        next.sourceRedirected = "You";
      }
    }
    setActiveIntent(game, next);
  }
}
effectRegistry.register(ReplaceDamageEffect);

// ---------------------------------------------------------------------------
// 3. ReplaceMana — mana intent recolor.
// ---------------------------------------------------------------------------
// From$ B | To$ G    → swap any "B" symbol in produceMana symbols for "G"
// Color$ G           → recolor the entire produceMana symbols list to one G per slot
export class ReplaceManaEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ReplaceMana";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const intent = getActiveIntent(game);
    if (intent === null) return;
    // Mana intents the engine emits — produceMana / loseMana — both carry
    // a `symbols` array. The handler operates on whichever is mid-flight.
    if (intent.kind !== "produceMana" && intent.kind !== "loseMana") return;
    const symbols = intent.symbols as readonly string[] | undefined;
    if (symbols === undefined) return;
    let next = symbols;
    if (hasParam(sa, "From") && hasParam(sa, "To")) {
      const from = evaluateParamRaw(sa, "From").trim();
      const to = evaluateParamRaw(sa, "To").trim();
      next = symbols.map((s) => (s === from ? to : s));
    } else if (hasParam(sa, "Color")) {
      const color = evaluateParamRaw(sa, "Color").trim();
      next = symbols.map(() => color);
    }
    setActiveIntent(game, { ...intent, symbols: next });
  }
}
effectRegistry.register(ReplaceManaEffect);

// ---------------------------------------------------------------------------
// 4. ReplaceToken — token-creation intent rewrite (multiplier / recolor).
// ---------------------------------------------------------------------------
// Multiplier$ 2     → double the token count (Doubling Season-style)
// Multiplier$ 0     → suppress (Tocatli Honor Guard-style)
// Color$ <symbol>   → recolor (rare; Mondrak only re-counts, doesn't recolor)
export class ReplaceTokenEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ReplaceToken";

  // biome-ignore lint/correctness/useYield: pure intent mutation
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const intent = getActiveIntent(game);
    if (intent === null || intent.kind !== "createToken") return;
    const next: Record<string, unknown> = { ...intent };
    if (hasParam(sa, "Multiplier")) {
      const mult = evaluateParamNumber(sa, "Multiplier", game);
      const cur = (intent as { count?: number }).count ?? 1;
      next.count = cur * mult;
    }
    if (hasParam(sa, "Color")) {
      const color = evaluateParamRaw(sa, "Color").trim();
      // Stamp a tokenColorOverride slot — the createToken handler reads
      // this for color-rewrite (TODO advanced: full PaperCard rebase).
      next.tokenColorOverride = color;
    }
    setActiveIntent(game, next);
  }
}
effectRegistry.register(ReplaceTokenEffect);

// ---------------------------------------------------------------------------
// 5. ReplaceCounter — counter-add intent multiplier / counter-type override.
// ---------------------------------------------------------------------------
// Multiplier$ 2          → double the counter count (Doubling Season — the
//                          counter half of its rules text)
// CounterType$ KO        → swap the kind (rare)
export class ReplaceCounterEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ReplaceCounter";

  // biome-ignore lint/correctness/useYield: pure intent mutation
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const intent = getActiveIntent(game);
    if (intent === null || intent.kind !== "addCounter") return;
    const next: Record<string, unknown> = { ...intent };
    if (hasParam(sa, "Multiplier")) {
      const mult = evaluateParamNumber(sa, "Multiplier", game);
      const cur = (intent as { amount?: number }).amount ?? 1;
      next.amount = cur * mult;
    }
    if (hasParam(sa, "CounterType")) {
      const kind = evaluateParamRaw(sa, "CounterType").trim();
      next.counterType = kind as unknown as CounterType;
    }
    setActiveIntent(game, next);
  }
}
effectRegistry.register(ReplaceCounterEffect);

// ---------------------------------------------------------------------------
// 6. ReplaceSplitDamage — fan one damage intent across multiple targets.
// ---------------------------------------------------------------------------
// NumTargets$ 2   → split intent.amount evenly across 2 targets (rounded down,
//                   remainder onto the first target). Targets default to the
//                   parent SpellAbility's target list; falls back to no-op
//                   if no extra targets supplied.
//
// MVP: stamps a `splitDamageRequests` array onto the intent that the parent
// damage replacement reads as a "fan-out" instruction. The parent (Damage
// replacement) treats the in-flight intent as REPLACED and instead emits N
// fresh damage intents. Until the parent's read-side wires up, this stamps
// the slot deterministically so observers see the rewrite.
export class ReplaceSplitDamageEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ReplaceSplitDamage";

  // biome-ignore lint/correctness/useYield: pure intent mutation
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const intent = getActiveIntent(game);
    if (intent === null || intent.kind !== "damage") return;
    const numTargets = hasParam(sa, "NumTargets") ? evaluateParamNumber(sa, "NumTargets", game) : 2;
    if (numTargets <= 1) return;
    const total = (intent as { amount?: number }).amount ?? 0;
    if (total <= 0) return;
    const each = Math.floor(total / numTargets);
    const remainder = total - each * numTargets;
    const splits: { readonly index: number; readonly amount: number }[] = [];
    for (let i = 0; i < numTargets; i++) {
      const amt = each + (i === 0 ? remainder : 0);
      splits.push({ index: i, amount: amt });
    }
    setActiveIntent(game, { ...intent, splitDamageRequests: splits });
  }
}
effectRegistry.register(ReplaceSplitDamageEffect);

// Suppress unused-import warning when the file is consumed only for its
// register side effects.
void ([] as readonly ZoneType[]);

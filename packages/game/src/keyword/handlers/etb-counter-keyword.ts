// SPDX-License-Identifier: GPL-3.0-or-later
// EtbCounterKeywordHandler — handles Forge's parser-extension keyword
// `K:etbCounter:<TYPE>:<NUMBER>[:<Condition>:<TriggerDescription>]`.
//
// Forge encodes "this enters with N <type> counters" as a synthesized
// CR 614 replacement effect on the card. The TS port models the same
// semantics by stamping a per-card slot (`card.etbCounterSpec`) at
// keyword-activation time and consuming it inside `applyEtbStamping`
// (game-action.ts), which already runs synchronously after the
// CardChangedZone event for ETB-time loyalty / defense counter
// placement. This is silent — no AbilityActivated, no trigger queue,
// no SpellCast — exactly mirroring Forge's replacement-style etbCounter
// semantics so the parity trace doesn't see a phantom AbilityActivated.
//
// Handler responsibilities:
//   1. Parse `K:etbCounter:<TYPE>:<NUMBER>` into a CounterType + amount
//      shape.
//   2. Stamp `card.etbCounterSpec` with the parsed pair.
//   3. Add the keyword name to card.keywords for downstream observers.
//
// `applyEtbStamping` (game-action.ts) reads `card.etbCounterSpec` and
// calls addCounter directly when the card lands on the battlefield.
// Variable amounts (`X`) read `card.xValueAtCast` (populated by the
// X-spell cost pipeline); Reanimator-style entries with no cast leave
// xValueAtCast undefined → 0 counters → no-op (matches Forge).
//
// Forge references:
//   - forge.game.card.CardFactory  → "etbCounter" extension
//   - CR 614 — replacement effects (the canonical CR rule for "this
//     enters with N counters" wording)
import type { KeywordAst, ParamValue } from "@mtg-forge-ts/core";
import { CounterType } from "@mtg-forge-ts/core";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

const COUNTER_SHORTHAND: Readonly<Record<string, CounterType>> = {
  P1P1: CounterType.PlusOnePlusOne,
  PLUSONEPLUSONE: CounterType.PlusOnePlusOne,
  PLUS1PLUS1: CounterType.PlusOnePlusOne,
  M1M1: CounterType.MinusOneMinusOne,
  MINUSONEMINUSONE: CounterType.MinusOneMinusOne,
  MINUS1MINUS1: CounterType.MinusOneMinusOne,
  ICE: CounterType.Ice,
  FADE: CounterType.Fade,
  CHARGE: CounterType.Charge,
  LOYALTY: CounterType.Loyalty,
  TIME: CounterType.Time,
  AGE: CounterType.Age,
  STORAGE: CounterType.Storage,
  HATCHLING: CounterType.Hatchling,
  EGG: CounterType.Egg,
  LEVEL: CounterType.Level,
  PETAL: CounterType.Petal,
  PUPA: CounterType.Pupa,
  QUEST: CounterType.Quest,
  STUN: CounterType.Stun,
  GROWTH: CounterType.Growth,
  POISON: CounterType.Poison,
  MUSTER: CounterType.Muster,
  STORY: CounterType.Story,
};

/** Resolve a Forge etbCounter type-token to a CounterType enum value. */
function resolveCounterType(raw: string): CounterType | null {
  if (raw.length === 0) return null;
  const upper = raw.toUpperCase();
  const shorthand = COUNTER_SHORTHAND[upper];
  if (shorthand !== undefined) return shorthand;
  // Fallback: case-insensitive match against CounterType string values.
  const lower = raw.toLowerCase();
  for (const v of Object.values(CounterType)) {
    if (typeof v === "string" && v === lower) return v;
  }
  return null;
}

export class EtbCounterKeywordHandler extends KeywordHandler {
  static override readonly keyword = "etb_counter" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("etb_counter");

    // Parse the detail string. Shape: <TYPE>:<NUMBER>[:<rest...>].
    const detailParam = ast.params?.detail as ParamValue | undefined;
    if (!detailParam || detailParam.kind !== "literal") return;
    const detail = detailParam.raw.trim();
    if (detail.length === 0) return;

    const segments = detail.split(":");
    if (segments.length < 2) return;
    const typeRaw = (segments[0] ?? "").trim();
    const amountRaw = (segments[1] ?? "").trim();
    const counterType = resolveCounterType(typeRaw);
    if (counterType === null) return;

    const isVariable = amountRaw.toUpperCase() === "X";
    const literalN = Number.parseInt(amountRaw, 10);
    const fixedN = !isVariable && Number.isFinite(literalN) && literalN > 0 ? literalN : 0;

    // Stamp the per-card slot consumed by applyEtbStamping. Multiple
    // K:etbCounter lines on the same card are supported by appending to
    // an array — each spec runs at ETB time.
    const slot = card as unknown as {
      etbCounterSpecs?: Array<{
        readonly counterType: CounterType;
        readonly amount: number;
        readonly variable: boolean;
      }>;
    };
    if (!slot.etbCounterSpecs) slot.etbCounterSpecs = [];
    slot.etbCounterSpecs.push({
      counterType,
      amount: fixedN,
      variable: isVariable,
    });
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("etb_counter");
    if (card) {
      (card as unknown as { etbCounterSpecs?: unknown }).etbCounterSpecs = undefined;
    }
  }
}

keywordHandlerRegistry.register(EtbCounterKeywordHandler);

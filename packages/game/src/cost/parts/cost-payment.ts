// SPDX-License-Identifier: GPL-3.0-or-later
// CostPayment orchestrator — parses a combined cost string into a CostPlan
// and drives payment / rollback via the costPartRegistry.
//
// Supported cost segments (split on comma):
//   "T"                                → CostTap
//   "Q"                                → CostUntap (Wave 46)
//   "N life"                           → CostPayLife
//   "Sac <X>"                          → CostSacrifice
//   "Discard"/"Discard CARDNAME"       → CostDiscard
//   "Forage"                           → CostForage
//   "ExileFromGrave"                   → CostExileSelfFromGrave (legacy)
//   "ExileFromGrave<1/CARDNAME>"       → CostExileSelfFromGrave (legacy)
//   "Exile<n/Filter>"                  → CostExile (Wave 46, battlefield)
//   "ExileFromHand<n/Filter>"          → CostExile (Wave 46, hand)
//   "ExileFromGrave<n/Filter>"         → CostExile (Wave 46, graveyard, non-self)
//   "ExileFromTop<n/Filter>"           → CostExile (Wave 46, library)
//   "AddCounter<n/Type>"               → CostPutCounter (Wave 46)
//   "SubCounter<n/Type>"               → CostRemoveCounter (Wave 46)
//   "PayEnergy<n>"                     → CostPayEnergy (Wave 46)
//   "Mill<n>" / "Mill<n/Filter>"       → CostMill (Wave 46)
//   "Draw<n>" / "Draw<n/who>"          → CostDraw (Wave 46)
//   "DamageYou<n>"                     → CostDamage (Wave 46)
//   "Reveal<n/Filter>"                 → CostReveal (Wave 46)
//   "Return<n/Filter>"                 → CostReturn (Wave 46)
//   "tapXType<Filter>"/"tapNType<...>" → CostTapType (Wave 46)
//   mana symbols                       → CostMana (e.g. "R", "2 G", "X")
//   anything else                      → throws unsupported
//
// Import side-effects: each CostPart module self-registers via
// costPartRegistry.register() when imported. The index.ts re-exports all of
// them so a single `import ... from "@mtg-forge-ts/game"` populates the
// registry.
import type { EngineYield } from "../../action/engine-yield.js";
import { costPartRegistry } from "./cost-part-registry.js";
import type { CostPartReceipt, CostPaymentContext } from "./cost-part.js";

// Matches mana cost tokens: digits, X/Y/Z, W/U/B/R/G color letters,
// C (colorless), S (snow), / (hybrid separator), and spaces.
const MANA_SYMBOL_RE = /^[0-9XYZWUBRGCS/\s]+$/;
const LIFE_RE = /^(\d+)\s+life$/i;
// Matches either "Sac <filter>" or "Sacrifice <filter>" (case-insensitive).
const SAC_RE = /^sac(?:rifice)?\s+(.+)$/i;
// Matches "Discard" (bare) or "Discard CARDNAME" / "Discard <self>" — MVP:
// self-discard only (source card). Type-targeted discard is Part D.
const DISCARD_RE = /^discard(?:\s+(?:cardname|self|this\s+card))?$/i;
// Matches the bare "Forage" cost segment (Bloomburrow).
const FORAGE_RE = /^forage$/i;
// Wave 33 — bare "ExileFromGrave" (no <...>). Routes to legacy
// CostExileSelfFromGrave (handlerKey "ExileFromGrave") which exiles the
// source card from its graveyard.
const EXILE_FROM_GRAVE_BARE_RE = /^exilefromgrave$/i;
// Self-only "ExileFromGrave<1/CARDNAME>" — Embalm / Eternalize / Scavenge.
// Kept on the legacy CostExileSelfFromGrave handler ("ExileFromGrave") for
// continuity with Wave 33 keyword handlers.
const EXILE_FROM_GRAVE_SELF_RE = /^ExileFromGrave<1\/(?:CARDNAME|Self|this card)>$/;
// Wave 46 — generalised exile prefixes.
const EXILE_RE = /^Exile<(\d+)\/(.+)>$/;
const EXILE_FROM_HAND_RE = /^ExileFromHand<(\d+)\/(.+)>$/;
const EXILE_FROM_GRAVE_RE = /^ExileFromGrave<(\d+)\/(.+)>$/;
const EXILE_FROM_TOP_RE = /^ExileFromTop<(\d+)\/(.+)>$/;
// Wave 46 — counter / scalar cost prefixes.
const ADD_COUNTER_RE = /^AddCounter<\d+\/[\w+\-/]+>$/;
// M6.18 — `PayLife<N>` shorthand used in synthetic Vampiric Tutor / Imperial
// Seal scenarios (Forge writes "Cost$ B PayLife<2>" for these as compact form
// of "B, 2 life"). Forge's `Cost.java` parser walks tokens splitting on
// whitespace and recognises the bracket syntax; mirror that here so the life
// payment fires its LifeChanged event even when authored in the bracket
// syntax rather than the standard "N life" form.
// M6.19 — Also accept `PayLife<X>` / `PayLife<Y>` where the amount is a
// SVar reference (Toxic Deluge X-cost: "Cost$ 2 B PayLife<X>"). Forge's
// Cost.java accepts identifier amounts and resolves at pay-time via the
// xPaid / xCounter machinery. CostPayLife reads card.xValueAtCast at
// pay-time to resolve the actual life amount.
const PAY_LIFE_BRACKET_RE = /^PayLife<(?:\d+|[A-Z][\w]*)>$/i;
const SUB_COUNTER_RE = /^SubCounter<\d+\/[\w+\-/]+>$/;
const PAY_ENERGY_RE = /^PayEnergy<\d+>$/;
const MILL_RE = /^Mill<\d+(?:\/[^>]*)?>$/;
const DRAW_RE = /^Draw<\d+(?:\/[^>]*)?>$/;
const DAMAGE_YOU_RE = /^DamageYou<\d+>$/;
const REVEAL_RE = /^Reveal<\d+\/(?:.+)>$/;
const RETURN_RE = /^Return<\d+\/(?:.+)>$/;
const TAP_TYPE_RE = /^tap(?:X|\d+)Type<(?:.+)>$/;

export interface CostPlan {
  readonly parts: readonly { readonly handlerKey: string; readonly raw: string }[];
}

/**
 * Parse a combined cost string (e.g. "R, T, 2 life") into a CostPlan.
 * Throws for unsupported cost segments.
 */
// M6.18 — Forge cost strings can mix mana with non-mana tokens separated by
// whitespace ("B PayLife<2>", "1 PayLife<3>"). Only refine when (a) a
// segment contains an angle-bracket token like `Foo<...>` AND (b) at least
// one preceding/trailing whitespace-separated mana token. Avoids breaking
// space-separated multi-word costs like `Sac Creature` / `2 life` /
// `Discard CARDNAME` where the space is internal to the cost.
const ANGLE_BRACKET_RE = /\w+<[^>]*>/;
const MANA_TOKEN_RE = /^[0-9XYZWUBRGCS/]+$/;

const refineSegments = (segments: readonly string[]): readonly string[] => {
  const out: string[] = [];
  for (const seg of segments) {
    // Only refine when segment has a bracket-form token mixed with at least
    // one separate mana-only token. Skip pure mana, pure bracket, and
    // pure-non-bracket multi-word costs.
    if (!ANGLE_BRACKET_RE.test(seg)) {
      out.push(seg);
      continue;
    }
    const tokens = seg.split(/\s+/).filter((t) => t !== "");
    if (tokens.length <= 1) {
      out.push(seg);
      continue;
    }
    // Need at least one mana-only token AND at least one bracket-form token
    // to justify splitting. Otherwise keep the segment as-is.
    let hasMana = false;
    let hasBracket = false;
    for (const tok of tokens) {
      if (MANA_TOKEN_RE.test(tok)) hasMana = true;
      if (/<[^>]*>/.test(tok)) hasBracket = true;
    }
    if (!hasMana || !hasBracket) {
      out.push(seg);
      continue;
    }
    // Split: aggregate consecutive mana tokens, emit bracket tokens
    // independently, and group orphan non-mana / non-bracket tokens
    // together (so "Sac Creature" stays atomic if it ever co-resides
    // with bracket form — extremely rare, but defensive).
    let buf: string[] = [];
    let bufKind: "mana" | "other" | null = null;
    const flush = (): void => {
      if (buf.length > 0) {
        out.push(buf.join(" "));
        buf = [];
        bufKind = null;
      }
    };
    for (const tok of tokens) {
      if (/<[^>]*>/.test(tok)) {
        flush();
        out.push(tok);
        continue;
      }
      const kind: "mana" | "other" = MANA_TOKEN_RE.test(tok) ? "mana" : "other";
      if (bufKind !== null && bufKind !== kind) flush();
      buf.push(tok);
      bufKind = kind;
    }
    flush();
  }
  return out;
};

export const parseCostString = (raw: string): CostPlan => {
  const segments = refineSegments(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== ""),
  );

  if (segments.length === 0) {
    return { parts: [] };
  }

  const parts: { handlerKey: string; raw: string }[] = [];

  for (const seg of segments) {
    if (seg === "T") {
      parts.push({ handlerKey: "Tap", raw: seg });
      continue;
    }
    if (seg === "Q") {
      parts.push({ handlerKey: "Untap", raw: seg });
      continue;
    }
    if (LIFE_RE.test(seg) || PAY_LIFE_BRACKET_RE.test(seg)) {
      parts.push({ handlerKey: "PayLife", raw: seg });
      continue;
    }
    if (SAC_RE.test(seg)) {
      parts.push({ handlerKey: "Sacrifice", raw: seg });
      continue;
    }
    if (DISCARD_RE.test(seg)) {
      parts.push({ handlerKey: "Discard", raw: seg });
      continue;
    }
    if (FORAGE_RE.test(seg)) {
      parts.push({ handlerKey: "Forage", raw: seg });
      continue;
    }
    // Wave 33 legacy paths — keep these BEFORE the generalised Exile patterns
    // so Embalm/Eternalize/Scavenge keep using CostExileSelfFromGrave.
    if (EXILE_FROM_GRAVE_BARE_RE.test(seg) || EXILE_FROM_GRAVE_SELF_RE.test(seg)) {
      parts.push({ handlerKey: "ExileFromGrave", raw: seg });
      continue;
    }
    // Wave 46 — generalised exile, all four zones.
    if (
      EXILE_RE.test(seg) ||
      EXILE_FROM_HAND_RE.test(seg) ||
      EXILE_FROM_GRAVE_RE.test(seg) ||
      EXILE_FROM_TOP_RE.test(seg)
    ) {
      parts.push({ handlerKey: "Exile", raw: seg });
      continue;
    }
    if (ADD_COUNTER_RE.test(seg)) {
      parts.push({ handlerKey: "PutCounter", raw: seg });
      continue;
    }
    if (SUB_COUNTER_RE.test(seg)) {
      parts.push({ handlerKey: "RemoveCounter", raw: seg });
      continue;
    }
    if (PAY_ENERGY_RE.test(seg)) {
      parts.push({ handlerKey: "PayEnergy", raw: seg });
      continue;
    }
    if (MILL_RE.test(seg)) {
      parts.push({ handlerKey: "Mill", raw: seg });
      continue;
    }
    if (DRAW_RE.test(seg)) {
      parts.push({ handlerKey: "Draw", raw: seg });
      continue;
    }
    if (DAMAGE_YOU_RE.test(seg)) {
      parts.push({ handlerKey: "DamageYou", raw: seg });
      continue;
    }
    if (REVEAL_RE.test(seg)) {
      parts.push({ handlerKey: "Reveal", raw: seg });
      continue;
    }
    if (RETURN_RE.test(seg)) {
      parts.push({ handlerKey: "Return", raw: seg });
      continue;
    }
    if (TAP_TYPE_RE.test(seg)) {
      parts.push({ handlerKey: "TapType", raw: seg });
      continue;
    }
    if (MANA_SYMBOL_RE.test(seg)) {
      parts.push({ handlerKey: "Mana", raw: seg });
      continue;
    }
    throw new Error(`parseCostString: unsupported cost segment '${seg}' (deferred to Part D)`);
  }

  return { parts };
};

/**
 * Execute a CostPlan: iterate each part in order, yield from each part's
 * pay generator, accumulate receipts. Returns the full receipt list on
 * success; throws (and does NOT rollback) on any payment failure — callers
 * must call undoCost on partial receipts if needed.
 */
export function* payCost(
  plan: CostPlan,
  ctx: CostPaymentContext,
): Generator<EngineYield, readonly CostPartReceipt[], unknown> {
  const receipts: CostPartReceipt[] = [];

  for (const { handlerKey, raw } of plan.parts) {
    const part = costPartRegistry.lookup(handlerKey);
    if (!part) {
      throw new Error(`payCost: no registered handler for '${handlerKey}'`);
    }
    const partCtx: CostPaymentContext = { ...ctx, raw };
    const receipt = yield* part.pay(partCtx);
    receipts.push(receipt);
  }

  return receipts;
}

/**
 * Roll back a list of receipts in LIFO order (last-paid is first undone).
 */
export function undoCost(receipts: readonly CostPartReceipt[], ctx: CostPaymentContext): void {
  for (let i = receipts.length - 1; i >= 0; i--) {
    const r = receipts[i];
    if (!r) continue;
    const part = costPartRegistry.lookup(r.handlerKey);
    if (part) {
      part.undo(r, { ...ctx, raw: r.raw });
    }
  }
}

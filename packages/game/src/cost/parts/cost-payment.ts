// SPDX-License-Identifier: GPL-3.0-or-later
// CostPayment orchestrator — parses a combined cost string into a CostPlan
// and drives payment / rollback via the costPartRegistry.
//
// Supported cost segments (split on comma):
//   "T"          → CostTap
//   "Q"          → CostUntap (deferred to Part D — throws)
//   "N life"     → CostPayLife
//   "Sac <X>"    → CostSacrifice (M4 stub — pay throws)
//   mana symbols → CostMana (e.g. "R", "2 G", "X")
//   anything else → throws unsupported
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
// Wave 17b — Forge writes both forms; we recognise both as the Sacrifice cost.
const SAC_RE = /^sac(?:rifice)?\s+(.+)$/i;
// Matches "Discard" (bare) or "Discard CARDNAME" / "Discard <self>" — MVP:
// self-discard only (source card). Type-targeted discard is Part D.
const DISCARD_RE = /^discard(?:\s+(?:cardname|self|this\s+card))?$/i;
// Matches the bare "Forage" cost segment (Bloomburrow). The cost has no
// parameters — the choice between exile-3-from-graveyard and sacrifice-Food
// is yielded as a `chooseForageMode` decision inside CostForage.pay.
const FORAGE_RE = /^forage$/i;

export interface CostPlan {
  readonly parts: readonly { readonly handlerKey: string; readonly raw: string }[];
}

/**
 * Parse a combined cost string (e.g. "R, T, 2 life") into a CostPlan.
 * Throws for unsupported cost segments.
 */
export const parseCostString = (raw: string): CostPlan => {
  const segments = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");

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
      throw new Error(`parseCostString: CostUntap "Q" is deferred to Part D (unsupported cost segment)`);
    }
    if (LIFE_RE.test(seg)) {
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

// SPDX-License-Identifier: GPL-3.0-or-later
// CostSacrifice — payment of a sacrifice cost ("Sac <filter>" / "Sacrifice
// <filter>" syntax).
//
// MVP self-sac support (Wave 17b): when the filter resolves to the source
// card itself ("CARDNAME", "Self", or "this token") we drive
// `game.action.sacrifice(sourceCardId)` directly — no target selection
// needed. The canonical artifact-token activated abilities (Treasure /
// Food / Clue / Blood) all sacrifice the source token to themselves; this
// covers their cost without pulling in the full target-filter grammar.
//
// Other sacrifice filters (Sac<Creature>, Sac<Artifact.YouCtrl>, …) still
// throw NotImplemented — Part D wires the target-selection decision yield.
import type { EngineYield } from "../../action/engine-yield.js";
import { costPartRegistry } from "./cost-part-registry.js";
import type { CostPart, CostPartReceipt, CostPaymentContext } from "./cost-part.js";

const SAC_RE = /^sac(?:rifice)?\s+(.+)$/i;

function parseSacFilter(raw: string): string {
  const m = SAC_RE.exec(raw);
  if (!m || !m[1]) throw new Error(`CostSacrifice: cannot parse filter from "${raw}"`);
  return m[1].trim();
}

/**
 * Self-sac filters: the cost names the source card itself rather than
 * requesting target selection. The canonical Forge tokens (Treasure / Food /
 * Clue / Blood) all use this form. We accept the printed shorthand variants
 * verbatim; everything else falls through to the deferred Part D code path.
 */
const SELF_FILTERS: ReadonlySet<string> = new Set(["CARDNAME", "Self", "this token", "this card"]);

const isSelfFilter = (filter: string): boolean => {
  // Forge's `Sac<1/CARDNAME/this token>` form lands here as raw "CARDNAME"
  // (or "Self" / "this token") after the leading-amount slash is stripped
  // upstream by the cost-line preprocessor. We accept either the bare name
  // or the slash-prefixed form so both decompose to a self-sac.
  const trimmed = filter.trim();
  if (SELF_FILTERS.has(trimmed)) return true;
  // Slash form: "1/CARDNAME/this token" — the second segment is the actual
  // ValidCard filter; check whether ANY segment is a self filter.
  if (trimmed.includes("/")) {
    for (const seg of trimmed.split("/")) {
      if (SELF_FILTERS.has(seg.trim())) return true;
    }
  }
  return false;
};

interface SelfSacReceipt {
  readonly self: true;
  readonly cardId: import("@mtg-forge-ts/core").EntityId;
}

export const CostSacrifice: CostPart = {
  handlerKey: "Sacrifice",

  canPay(ctx: CostPaymentContext): boolean {
    const filter = parseSacFilter(ctx.raw);
    // Self-sac: payable as long as the source card still exists in a zone
    // we can locate. The replacement chain on the actual sacrifice may
    // still prevent it (Indestructible-on-sac), but that surfaces inside
    // pay() — canPay is the optimistic gate.
    if (isSelfFilter(filter)) {
      const card = ctx.game.cards.get(ctx.sourceCardId);
      return card !== undefined;
    }
    // Non-self sacrifice cost remains MVP-stub: we don't check target
    // grammar here — the caller surfaces the NotImplemented in pay().
    return true;
  },

  *pay(ctx: CostPaymentContext): Generator<EngineYield, CostPartReceipt, unknown> {
    const filter = parseSacFilter(ctx.raw);
    if (isSelfFilter(filter)) {
      // Drive the canonical sacrifice mutator on the source card itself.
      // The mutator emits CardSacrificed and routes the follow-up moveTo
      // through the replacement chain (Indestructible / Rest in Peace).
      yield* ctx.game.action.sacrifice(ctx.sourceCardId, { sourceId: ctx.sourceCardId });
      const receipt: SelfSacReceipt = { self: true, cardId: ctx.sourceCardId };
      return {
        handlerKey: "Sacrifice",
        raw: ctx.raw,
        payload: receipt,
      };
    }
    throw new Error(
      `CostSacrifice.pay: sacrifice target selection for filter "${filter}" is deferred to Part D — requires target filter grammar`,
    );
  },

  undo(receipt: CostPartReceipt, _ctx: CostPaymentContext): void {
    // Self-sac is irreversible at the engine level — once the card is in
    // the graveyard, the tokenness flag means it ceases to exist on the
    // next SBA sweep. Undo for partial-payment rollback would have to
    // resurrect the card to its pre-pay zone; for MVP we acknowledge
    // CostMana / CostTap can still rollback BEFORE we reach the sacrifice
    // step (parts pay in order), so this branch is only reachable when
    // a downstream cost-part payment fails AFTER the sacrifice was paid,
    // which the existing payCost flow forbids by ordering sacrifice last.
    void receipt;
    throw new Error(
      "CostSacrifice.undo: self-sacrifice is non-reversible; callers must order Sacrifice last in the cost plan",
    );
  },
};

costPartRegistry.register(CostSacrifice);

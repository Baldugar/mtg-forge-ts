// SPDX-License-Identifier: GPL-3.0-or-later
// CostSacrifice — payment of a sacrifice cost ("Sac <filter>" / "Sacrifice
// <filter>" / "Sac<N/Filter>" syntax).
//
// MVP self-sac support (Wave 17b): when the filter resolves to the source
// card itself ("CARDNAME", "Self", or "this token") we drive
// `game.action.sacrifice(sourceCardId)` directly — no target selection
// needed. The canonical artifact-token activated abilities (Treasure /
// Food / Clue / Blood) all sacrifice the source token to themselves; this
// covers their cost without pulling in the full target-filter grammar.
//
// M6.21 — Bracket form `Sac<N/Filter>`. CR 117.4 ("If a cost can't be
// paid, you can't take that action"): canPay/pay must verify the
// sacrificing player has at least N legal sacrifice targets matching the
// filter on their battlefield. When the pool is short, the cast aborts via
// the cast-pipeline catch path (which calls undoCost on partial receipts
// and emits CastAborted). Mirrors Forge's CostSacrifice.canPay which
// returns `getMaxAmountX(...) >= amount`.
//
// MVP target selection: with no controller decision-yield wired yet, when
// the filter is non-self we sacrifice the *first* legal candidate
// deterministically. This is a placeholder — Part D adds the proper
// target-selection decision yield. The engine-correctness bit is the
// canPay precheck + pay-time hard fail when no legal target exists.
import { CardType, Color, ZoneType } from "@mtg-forge-ts/core";
import type { EntityId } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { costPartRegistry } from "./cost-part-registry.js";
import type { CostPart, CostPartReceipt, CostPaymentContext } from "./cost-part.js";

const SAC_RE = /^sac(?:rifice)?\s+(.+)$/i;
const SAC_BRACKET_RE = /^Sac<(\d+)\/([^>]+)>$/i;

interface ParsedSac {
  /** Number of permanents that must be sacrificed. */
  readonly amount: number;
  /** Filter token (e.g. "Creature", "Creature.Green", "CARDNAME"). */
  readonly filter: string;
}

function parseSac(raw: string): ParsedSac {
  const bracket = SAC_BRACKET_RE.exec(raw);
  if (bracket?.[1] && bracket[2]) {
    return { amount: Number.parseInt(bracket[1], 10), filter: bracket[2].trim() };
  }
  const space = SAC_RE.exec(raw);
  if (space?.[1]) {
    // Bare "Sac Creature" / "Sacrifice Creature" defaults to amount 1.
    return { amount: 1, filter: space[1].trim() };
  }
  throw new Error(`CostSacrifice: cannot parse filter from "${raw}"`);
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
  readonly cardId: EntityId;
}

interface FilteredSacReceipt {
  readonly self: false;
  readonly cardIds: readonly EntityId[];
}

/**
 * Find legal sacrifice targets for a non-self filter. Mirrors Forge's
 * CostSacrifice.getMaxAmountX scope: payer's battlefield, filter applied
 * via type+colour tokens. MVP supports the canonical `<Type>` and
 * `<Type>.<Quality>` forms (e.g. "Creature", "Creature.Green",
 * "Artifact.YouCtrl"). Everything matches by lowercase string compare.
 */
function findLegalSacTargets(filter: string, game: Game, payerSeat: number): readonly EntityId[] {
  const tokens = filter.split(".").map((t) => t.trim().toLowerCase());
  const baseType = tokens[0] ?? "card";
  const qualifiers = tokens.slice(1);

  const out: EntityId[] = [];
  for (const [id, card] of game.cards) {
    if (card.zone !== ZoneType.Battlefield) continue;
    if (card.controllerSeat !== payerSeat) continue;
    const chars = game.layerEngine.computeCharacteristics(id);
    if (baseType !== "permanent" && baseType !== "card") {
      if (baseType === "creature" && !chars.types.has(CardType.Creature)) continue;
      if (baseType === "artifact" && !chars.types.has(CardType.Artifact)) continue;
      if (baseType === "enchantment" && !chars.types.has(CardType.Enchantment)) continue;
      if (baseType === "land" && !chars.types.has(CardType.Land)) continue;
      if (baseType === "planeswalker" && !chars.types.has(CardType.Planeswalker)) continue;
    }
    let qualifierFail = false;
    for (const q of qualifiers) {
      if (q === "youctrl") {
        // Already enforced by payerSeat gate above — true by construction.
        continue;
      }
      if (q === "opponentctrl") {
        // payerSeat-controlled cards never satisfy OpponentCtrl.
        qualifierFail = true;
        break;
      }
      // Colour qualifiers — match against the layered ColorSet.
      if (q === "green" || q === "white" || q === "blue" || q === "black" || q === "red") {
        const want =
          q === "green"
            ? Color.Green
            : q === "white"
              ? Color.White
              : q === "blue"
                ? Color.Blue
                : q === "black"
                  ? Color.Black
                  : Color.Red;
        if (!chars.colors.has(want)) {
          qualifierFail = true;
          break;
        }
      }
      // Unrecognised qualifier — be conservative and keep the candidate.
      // (Forge would do a strict ValidCard parse; for the cost-canPay
      // gate, false negatives are worse than false positives — a wrong
      // include is corrected by Forge's actual sacrifice resolution
      // when a real target-selection UI lands.)
    }
    if (qualifierFail) continue;
    out.push(id);
  }
  return out;
}

export const CostSacrifice: CostPart = {
  handlerKey: "Sacrifice",

  canPay(ctx: CostPaymentContext): boolean {
    const { amount, filter } = parseSac(ctx.raw);
    // Self-sac: payable as long as the source card still exists in a zone
    // we can locate. The replacement chain on the actual sacrifice may
    // still prevent it (Indestructible-on-sac), but that surfaces inside
    // pay() — canPay is the optimistic gate.
    if (isSelfFilter(filter)) {
      const card = ctx.game.cards.get(ctx.sourceCardId);
      return card !== undefined;
    }
    // Filter form (Sac<N/Creature>, Sac<1/Creature.Green>, Sacrifice
    // Creature, …). CR 117.4 — verify the legal sacrifice pool meets
    // the required amount.
    const legal = findLegalSacTargets(filter, ctx.game, ctx.payerSeat);
    return legal.length >= amount;
  },

  *pay(ctx: CostPaymentContext): Generator<EngineYield, CostPartReceipt, unknown> {
    const { amount, filter } = parseSac(ctx.raw);
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

    // Filter form — locate legal targets and hard-fail when the pool is
    // short. CR 117.4: an unpayable cost makes the action illegal; the
    // cast pipeline's try/catch converts the throw into a CastAborted
    // (matching Forge's BridgeCastFailed on the bridge side).
    const legal = findLegalSacTargets(filter, ctx.game, ctx.payerSeat);
    if (legal.length < amount) {
      throw new Error(
        `CostSacrifice.pay: cannot sacrifice ${amount} matching "${filter}" — only ${legal.length} legal target(s) controlled by payer (CR 117.4 — cost unpayable)`,
      );
    }
    // MVP target selection: take the first `amount` legal candidates.
    // Part D will replace this with a controller decision-yield; for the
    // cost-correctness fix the deterministic pick suffices because the
    // important behaviour (failure when pool is empty) is fully covered.
    const chosen = legal.slice(0, amount);
    for (const cardId of chosen) {
      yield* ctx.game.action.sacrifice(cardId, { sourceId: ctx.sourceCardId });
    }
    const receipt: FilteredSacReceipt = { self: false, cardIds: chosen };
    return {
      handlerKey: "Sacrifice",
      raw: ctx.raw,
      payload: receipt,
    };
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
      "CostSacrifice.undo: sacrifice is non-reversible; callers must order Sacrifice last in the cost plan",
    );
  },
};

costPartRegistry.register(CostSacrifice);

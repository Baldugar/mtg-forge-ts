// SPDX-License-Identifier: GPL-3.0-or-later
// DraftPlayerController decisions — 7 kinds per SP7 §3 + SP1 plan task 24:
// standard booster pick, jumpstart theme pick, winston-variant pile decisions,
// solomon split-or-choose, grid row/column pick, rochester face-up pick,
// conspiracy-style draft mulligan.
//
// Solomon is asymmetric (one player splits, the other chooses). SP7 lists a
// single `solomonSplit` kind, which is preserved here by discriminating role
// inside the request and carrying a role-tagged response variant. Bumping to
// two separate kinds was considered and rejected — SP7 is the spec, and the
// type system still delivers branch-per-role safety via the nested union on
// the response.

import type { PaperCard } from "../card/paper-card.js";
import type { PlayerSeat } from "../ids.js";

/** One Jumpstart theme half-deck offer in a jumpstartPick request. */
export interface JumpstartThemeOffer {
  readonly themeId: string;
  readonly name: string;
  readonly cards: readonly PaperCard[];
}

/**
 * Winston pile descriptor. Top card is optional because after a player passes
 * on a pile and the pile draws a replacement, the newly-added card is hidden
 * until the next player resumes the round.
 */
export interface WinstonPileInfo {
  readonly id: string;
  readonly count: number;
  readonly topCard?: PaperCard;
}

/**
 * DraftDecisionRequest — 7 kinds per SP7 §3 / SP1 plan task 24.
 */
export type DraftDecisionRequest =
  | {
      readonly kind: "pick";
      readonly playerSeat: PlayerSeat;
      readonly pack: readonly PaperCard[];
      readonly pickNumber: number;
      readonly packNumber: number;
    }
  | {
      readonly kind: "jumpstartPick";
      readonly playerSeat: PlayerSeat;
      readonly themes: readonly JumpstartThemeOffer[];
    }
  | {
      readonly kind: "winstonPile";
      readonly playerSeat: PlayerSeat;
      readonly piles: readonly WinstonPileInfo[];
    }
  | {
      readonly kind: "solomonSplit";
      readonly playerSeat: PlayerSeat;
      // WHY: splitter receives cards + role "splitter"; chooser receives the
      // already-split groups + role "chooser". Keeping it as one kind matches
      // SP7 §3; the role discriminator plus the response union preserves
      // branch-per-role type safety.
      readonly role: "splitter" | "chooser";
      readonly cards: readonly PaperCard[];
      // WHY: populated only when role === "chooser" — the chooser sees the
      // two groups the splitter committed; the engine pairs each request
      // with the appropriate fields.
      readonly groupA?: readonly PaperCard[];
      readonly groupB?: readonly PaperCard[];
    }
  | {
      readonly kind: "gridPick";
      readonly playerSeat: PlayerSeat;
      // WHY: 3x3 for classic Grid Draft; outer array is rows, inner array is
      // cards within a row. Empty cells are represented by missing entries
      // (grid draft removes picked cards without replacement).
      readonly grid: readonly (readonly PaperCard[])[];
    }
  | {
      readonly kind: "rochesterPick";
      readonly playerSeat: PlayerSeat;
      readonly faceUpPack: readonly PaperCard[];
      readonly pickNumber: number;
      readonly packNumber: number;
    }
  | {
      // WHY: Conspiracy Draft specifically introduces rare draft-mulligan
      // mechanics; kept as a general-purpose kind so future draft formats can
      // reuse the request with a different reason string.
      readonly kind: "draftMulligan";
      readonly playerSeat: PlayerSeat;
      readonly reason: string;
    };

/**
 * DraftDecisionResponse — same 7 kinds.
 *
 * solomonSplit's response is a nested union over role so the splitter's two
 * groups and the chooser's side selection are type-distinct but share the
 * discriminator with the request kind.
 */
export type DraftDecisionResponse =
  | { readonly kind: "pick"; readonly chosen: PaperCard }
  | { readonly kind: "jumpstartPick"; readonly themeId: string }
  | {
      readonly kind: "winstonPile";
      // WHY: Winston choices are "take this pile" vs "pass to next pile". If
      // passing on all three piles, player is forced to take the top card of
      // the deck (engine routes that case without a decision).
      readonly action: "take" | "next";
      readonly pileIdIfTake?: string;
    }
  | ({ readonly kind: "solomonSplit" } & (
      | {
          readonly role: "splitter";
          readonly groupA: readonly PaperCard[];
          readonly groupB: readonly PaperCard[];
        }
      | { readonly role: "chooser"; readonly chosenGroup: "a" | "b" }
    ))
  | {
      readonly kind: "gridPick";
      // WHY: exactly one of row / column is set — the discriminator lives
      // inside the payload rather than as a separate kind per SP7 §3. Engine
      // validates exactly-one.
      readonly row?: number;
      readonly column?: number;
    }
  | { readonly kind: "rochesterPick"; readonly chosen: PaperCard }
  | { readonly kind: "draftMulligan"; readonly mulligan: boolean };

export type DraftDecisionRequestKind = DraftDecisionRequest["kind"];
export type DraftDecisionResponseKind = DraftDecisionResponse["kind"];

export const isDraftRequest = <K extends DraftDecisionRequestKind>(
  request: DraftDecisionRequest,
  kind: K,
): request is Extract<DraftDecisionRequest, { kind: K }> => request.kind === kind;

export const isDraftResponse = <K extends DraftDecisionResponseKind>(
  response: DraftDecisionResponse,
  kind: K,
): response is Extract<DraftDecisionResponse, { kind: K }> => response.kind === kind;

// SPDX-License-Identifier: GPL-3.0-or-later
// MatchController decisions — spec §4 lines 198-201 enumerate three kinds
// spanning the whole match lifecycle (sideboarding between games, concede-
// match, accept/decline draw offer). MatchController runs for the duration of
// a match (best-of-3 etc.), distinct from PlayerController which is per-game
// and resets between mulligans.

import type { DeckEntry } from "../deck/deck.js";
import type { PlayerSeat } from "../ids.js";

/**
 * MatchDecisionRequest — engine-yielded match-level request.
 *
 *   sideboard          — between-games deck edit.
 *   concedeMatch       — fire-and-forget concede of the entire match.
 *   acceptDrawOffer    — one player offered a draw; the other accepts / declines.
 */
export type MatchDecisionRequest =
  | {
      readonly kind: "sideboard";
      readonly playerSeat: PlayerSeat;
      readonly mainDeck: readonly DeckEntry[];
      readonly sideboard: readonly DeckEntry[];
      // WHY: format string (e.g. "standard", "modern", "draft-MH3") governs
      // sideboard-size rules + legality; kept as a plain identifier so this
      // module stays independent of @mtg-forge-ts/formats.
      readonly format: string;
    }
  | { readonly kind: "concedeMatch"; readonly playerSeat: PlayerSeat }
  | {
      readonly kind: "acceptDrawOffer";
      readonly playerSeat: PlayerSeat;
      readonly offeredBy: PlayerSeat;
    };

/** MatchDecisionResponse — same discriminator set as MatchDecisionRequest. */
export type MatchDecisionResponse =
  | {
      readonly kind: "sideboard";
      readonly newMainDeck: readonly DeckEntry[];
      readonly newSideboard: readonly DeckEntry[];
    }
  | { readonly kind: "concedeMatch"; readonly concede: boolean }
  | { readonly kind: "acceptDrawOffer"; readonly accept: boolean };

export type MatchDecisionRequestKind = MatchDecisionRequest["kind"];
export type MatchDecisionResponseKind = MatchDecisionResponse["kind"];

export const isMatchRequest = <K extends MatchDecisionRequestKind>(
  request: MatchDecisionRequest,
  kind: K,
): request is Extract<MatchDecisionRequest, { kind: K }> => request.kind === kind;

export const isMatchResponse = <K extends MatchDecisionResponseKind>(
  response: MatchDecisionResponse,
  kind: K,
): response is Extract<MatchDecisionResponse, { kind: K }> => response.kind === kind;

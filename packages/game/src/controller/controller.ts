// SPDX-License-Identifier: GPL-3.0-or-later
// PlayerController + MatchController interfaces. PlayerController runs per-game
// per-seat (22/23 DecisionRequest kinds); MatchController runs per-match
// per-seat (3 MatchDecisionRequest kinds — sideboard, concedeMatch,
// acceptDrawOffer). Keeping both contracts in one module lets SP2/SP5 import
// from a single path and mirrors the controller pairing in the master spec.
import type {
  DecisionRequest,
  DecisionResponse,
  MatchDecisionRequest,
  MatchDecisionResponse,
} from "@mtg-forge-ts/core";

export interface PlayerController {
  decide(req: DecisionRequest): DecisionResponse;
}

export interface MatchController {
  decide(req: MatchDecisionRequest): MatchDecisionResponse;
}

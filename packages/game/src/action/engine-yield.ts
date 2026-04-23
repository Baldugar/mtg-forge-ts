// SPDX-License-Identifier: GPL-3.0-or-later
// EngineYield — the single value shape every engine generator yields. Two
// kinds: "decision" (the engine needs a PlayerController response to
// continue) or "event" (the engine recorded a GameEvent). Callers driving
// the generator forward (PhaseHandler in Task 39, the top-level driver loop
// in SP2) dispatch on `kind` to either forward the event to subscribers or
// ask a controller for a DecisionResponse.
import type { DecisionRequest, GameEvent } from "@mtg-forge-ts/core";

export type EngineYield =
  | { readonly kind: "decision"; readonly request: DecisionRequest }
  | { readonly kind: "event"; readonly event: GameEvent };

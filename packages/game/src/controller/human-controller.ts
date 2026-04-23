// SPDX-License-Identifier: GPL-3.0-or-later
// HumanController — the third library-provided PlayerController alongside
// ScriptedController (replay) and RandomLegalController (AI smoke). SP1 spec
// §4 lists this as a shipped component.
//
// Design: HumanController is a synchronous delegate. It wraps a consumer-
// supplied callback that receives the DecisionRequest and returns the
// DecisionResponse immediately. The engine is sync-generator-based, so the
// async UI round-trip lives on the consumer's side of the generator: the
// consumer runs the game generator in their own driver loop and, upon each
// decision yield, prompts their UI / awaits network input / etc., then calls
// `gen.next(response)` once the answer is available. HumanController itself
// stays sync — the suspension mechanism lives in the generator, not here.
//
// This keeps the controller surface uniform (all three controllers implement
// the same sync `decide` contract) and lets any async UI pattern plug in
// without leaking Promise types into the engine's PlayerController interface.
import type { DecisionRequest, DecisionResponse } from "@mtg-forge-ts/core";
import type { PlayerController } from "./controller.js";

/**
 * Consumer-supplied sync callback. For async UI flows, the caller resolves
 * the engine generator's yield on their side via `gen.next()` after their
 * UI resolves. HumanController itself stays synchronous.
 */
export type HumanDecideCallback = (request: DecisionRequest) => DecisionResponse;

/**
 * Thin sync adapter. The callback receives each DecisionRequest and must
 * return a matching DecisionResponse (same `kind` discriminator). Kind
 * mismatches flow through naturally — the engine validates responses.
 */
export class HumanController implements PlayerController {
  constructor(private readonly callback: HumanDecideCallback) {}

  decide(request: DecisionRequest): DecisionResponse {
    return this.callback(request);
  }
}

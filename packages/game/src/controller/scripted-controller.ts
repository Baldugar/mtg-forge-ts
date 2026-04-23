// SPDX-License-Identifier: GPL-3.0-or-later
// Replay controller backed by a pre-recorded DecisionResponse[]. Used by
// Task 49's integration smoke test and any regression harness that needs
// bit-for-bit reproduction of a recorded game. Kind-mismatch between the
// incoming DecisionRequest and the scripted DecisionResponse is the most
// common source of replay drift, so it surfaces as a DecisionLogCorruptError
// rather than returning an ill-typed response.
import type { DecisionRequest, DecisionResponse } from "@mtg-forge-ts/core";
import { DecisionLogCorruptError } from "@mtg-forge-ts/core";
import type { PlayerController } from "./controller.js";

export class ScriptedController implements PlayerController {
  private i = 0;

  constructor(private readonly script: readonly DecisionResponse[]) {}

  decide(req: DecisionRequest): DecisionResponse {
    const r = this.script[this.i++];
    if (!r) {
      throw new DecisionLogCorruptError(
        `ScriptedController ran out of responses after ${this.i - 1} calls; last request kind: ${req.kind}`,
      );
    }
    if (r.kind !== req.kind) {
      throw new DecisionLogCorruptError(
        `ScriptedController response kind mismatch at index ${this.i - 1}: expected ${req.kind}, got ${r.kind}`,
      );
    }
    return r;
  }

  hasMore(): boolean {
    return this.i < this.script.length;
  }

  remaining(): number {
    return this.script.length - this.i;
  }
}

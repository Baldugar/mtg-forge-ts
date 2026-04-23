// SPDX-License-Identifier: GPL-3.0-or-later
// RandomLegalController — SP1 covers only the two decision kinds Task 49's
// integration smoke test needs: 'priority' (always pass) and 'mulligan'
// (always keep). The remaining 21 DecisionRequest kinds throw an
// IllegalDecisionError with an explicit SP2-coverage message; SP2 expands
// this into a real random-legal strategy over each kind's legal-options set.
// The rng is retained (ignored via `void`) so the constructor signature
// stays stable when SP2 replaces the stub body.
import type { DecisionRequest, DecisionResponse, Rng } from "@mtg-forge-ts/core";
import { IllegalDecisionError } from "@mtg-forge-ts/core";
import type { PlayerController } from "./controller.js";

export class RandomLegalController implements PlayerController {
  constructor(private readonly rng: Rng) {
    void this.rng;
  }

  decide(req: DecisionRequest): DecisionResponse {
    switch (req.kind) {
      case "priority":
        return { kind: "priority", action: { kind: "pass" } };
      case "mulligan":
        return { kind: "mulligan", keep: true };
      default:
        throw new IllegalDecisionError(
          `RandomLegalController: decision kind '${req.kind}' not yet implemented in SP1; SP2 will cover all 23 kinds`,
        );
    }
  }
}

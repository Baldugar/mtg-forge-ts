// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { applyLayer2Control } from "./layer2-control.js";

describe("Layer 2 — Control effects (CR 613.1b)", () => {
  it("is a no-op on Characteristics (control lives on Card, not Characteristics)", () => {
    // applyLayer2Control returns void; calling it should not throw, and the
    // return expression evaluates to undefined at runtime.
    expect(applyLayer2Control()).toBeUndefined();
  });
});

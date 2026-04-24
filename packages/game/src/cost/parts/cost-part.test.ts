// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { costPartRegistry } from "./cost-part-registry.js";
import type { CostPart, CostPartReceipt, CostPaymentContext } from "./cost-part.js";

describe("costPartRegistry", () => {
  it("register + lookup round-trip", () => {
    const fakePart: CostPart = {
      handlerKey: "__test_fake__",
      canPay: (_ctx: CostPaymentContext) => true,
      // biome-ignore lint/correctness/useYield: inspection stub (no decision points)
      *pay(_ctx: CostPaymentContext): Generator<never, CostPartReceipt, unknown> {
        return { handlerKey: "__test_fake__", raw: "", payload: null };
      },
      undo: (_receipt: CostPartReceipt, _ctx: CostPaymentContext) => {
        // no-op
      },
    };

    costPartRegistry.register(fakePart);
    const found = costPartRegistry.lookup("__test_fake__");
    expect(found).toBe(fakePart);
  });

  it("lookup returns undefined for unknown key", () => {
    expect(costPartRegistry.lookup("__nonexistent__")).toBeUndefined();
  });

  it("has returns true for registered key", () => {
    const part: CostPart = {
      handlerKey: "__test_has__",
      canPay: () => false,
      // biome-ignore lint/correctness/useYield: inspection stub (no decision points)
      *pay(): Generator<never, CostPartReceipt, unknown> {
        return { handlerKey: "__test_has__", raw: "", payload: null };
      },
      undo: () => undefined,
    };
    costPartRegistry.register(part);
    expect(costPartRegistry.has("__test_has__")).toBe(true);
    expect(costPartRegistry.has("__nope__")).toBe(false);
  });
});

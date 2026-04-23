// SPDX-License-Identifier: GPL-3.0-or-later
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Cost, CostPart, CostPartRegistry } from "./cost.js";

// Test-local concrete CostPart subclasses. Unique kind prefixes ("test15-")
// avoid polluting the module-global registry for downstream tasks.

class TestCostPayLife extends CostPart {
  readonly kind = "test15-life";
  constructor(readonly amount: number) {
    super();
  }
  toJSON(): { kind: string; amount: number } {
    return { kind: this.kind, amount: this.amount };
  }
}

class TestCostTapSelf extends CostPart {
  readonly kind = "test15-tap";
  toJSON(): { kind: string } {
    return { kind: this.kind };
  }
}

beforeAll(() => {
  CostPartRegistry.register("test15-life", (data) => {
    const amount = data.amount;
    if (typeof amount !== "number") {
      throw new Error(`test15-life: expected numeric amount, got ${String(amount)}`);
    }
    return new TestCostPayLife(amount);
  });
  CostPartRegistry.register("test15-tap", () => new TestCostTapSelf());
});

afterAll(() => {
  // WHY: vitest's module isolation already prevents cross-file pollution today,
  // but we explicitly clean up the test-only kinds so this file is robust to
  // any future change (shared registry module, isolate=false, etc.).
  CostPartRegistry.unregister("test15-life");
  CostPartRegistry.unregister("test15-tap");
});

describe("Cost.of", () => {
  it("collects parts in order and length matches arity", () => {
    const cost = Cost.of(new TestCostPayLife(2), new TestCostTapSelf());
    expect(cost.parts.length).toBe(2);
    expect(cost.parts[0]?.kind).toBe("test15-life");
    expect(cost.parts[1]?.kind).toBe("test15-tap");
  });

  it("produces an empty Cost when called with no parts", () => {
    const cost = Cost.of();
    expect(cost.parts.length).toBe(0);
  });
});

describe("Cost JSON round-trip", () => {
  it("round-trips a multi-part cost through JSON.stringify/parse", () => {
    const original = Cost.of(new TestCostPayLife(3), new TestCostTapSelf());
    const wire = JSON.parse(JSON.stringify(original.toJSON())) as {
      parts: Array<{ kind: string; [k: string]: unknown }>;
    };
    const restored = Cost.fromJSON(wire);

    expect(restored.parts.length).toBe(2);

    const first = restored.parts[0];
    expect(first).toBeInstanceOf(TestCostPayLife);
    expect(first?.kind).toBe("test15-life");
    expect((first as TestCostPayLife).amount).toBe(3);

    const second = restored.parts[1];
    expect(second).toBeInstanceOf(TestCostTapSelf);
    expect(second?.kind).toBe("test15-tap");
  });

  it("round-trips an empty Cost", () => {
    const original = Cost.of();
    const wire = JSON.parse(JSON.stringify(original.toJSON())) as {
      parts: Array<{ kind: string; [k: string]: unknown }>;
    };
    const restored = Cost.fromJSON(wire);
    expect(restored.parts.length).toBe(0);
  });

  it("preserves the polymorphic kind field on each part's wire form", () => {
    const cost = Cost.of(new TestCostPayLife(1), new TestCostTapSelf());
    const json = cost.toJSON();
    expect(json.parts.map((p) => p.kind)).toEqual(["test15-life", "test15-tap"]);
  });
});

describe("CostPartRegistry.hydrate", () => {
  it("throws on an unregistered kind", () => {
    expect(() => CostPartRegistry.hydrate({ kind: "test15-never-registered" })).toThrow(
      /Unknown CostPart kind: test15-never-registered/,
    );
  });

  it("dispatches to the registered constructor for a known kind", () => {
    const part = CostPartRegistry.hydrate({ kind: "test15-life", amount: 7 });
    expect(part).toBeInstanceOf(TestCostPayLife);
    expect((part as TestCostPayLife).amount).toBe(7);
  });
});

describe("CostPartRegistry list/has/unregister", () => {
  it("unregister returns false for an unknown kind", () => {
    expect(CostPartRegistry.unregister("test15-never-registered")).toBe(false);
  });

  it("register/has/unregister/has cycle behaves correctly", () => {
    const kind = "test15-cycle";
    expect(CostPartRegistry.has(kind)).toBe(false);
    class Tmp extends CostPart {
      readonly kind = kind;
      toJSON(): { kind: string } {
        return { kind: this.kind };
      }
    }
    CostPartRegistry.register(kind, () => new Tmp());
    expect(CostPartRegistry.has(kind)).toBe(true);
    expect(CostPartRegistry.list()).toContain(kind);
    expect(CostPartRegistry.unregister(kind)).toBe(true);
    expect(CostPartRegistry.has(kind)).toBe(false);
    // Idempotent: unregister again is a no-op that returns false.
    expect(CostPartRegistry.unregister(kind)).toBe(false);
  });

  it("list() includes the two test kinds registered above", () => {
    const all = CostPartRegistry.list();
    expect(all).toContain("test15-life");
    expect(all).toContain("test15-tap");
  });

  it("re-registering under an existing kind replaces the prior constructor (last-wins)", () => {
    // WHY: documents the Map.set semantics decision (Reviewer C §3.10).
    // Test harnesses rely on this to override production constructors
    // without a dedicated override API; changing to a throw would break
    // that usage pattern silently.
    const kind = "test15-overwrite";
    class First extends CostPart {
      readonly kind = kind;
      readonly tag = "first";
      toJSON(): { kind: string; tag: string } {
        return { kind: this.kind, tag: this.tag };
      }
    }
    class Second extends CostPart {
      readonly kind = kind;
      readonly tag = "second";
      toJSON(): { kind: string; tag: string } {
        return { kind: this.kind, tag: this.tag };
      }
    }
    try {
      CostPartRegistry.register(kind, () => new First());
      const a = CostPartRegistry.hydrate({ kind });
      expect(a).toBeInstanceOf(First);
      // Re-register: last-wins. Prior constructor is silently replaced.
      CostPartRegistry.register(kind, () => new Second());
      const b = CostPartRegistry.hydrate({ kind });
      expect(b).toBeInstanceOf(Second);
      expect(b).not.toBeInstanceOf(First);
      // Re-register once more: still last-wins.
      CostPartRegistry.register(kind, () => new First());
      expect(CostPartRegistry.hydrate({ kind })).toBeInstanceOf(First);
    } finally {
      CostPartRegistry.unregister(kind);
    }
  });
});

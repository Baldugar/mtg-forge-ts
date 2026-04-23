// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { type DepNode, resolveDependencyOrder } from "./dependency-resolver.js";

type N = DepNode<null>;

describe("Dependency resolver (CR 613.8)", () => {
  it("no dependencies → pure timestamp order", () => {
    const fx: N[] = [
      { id: "B", timestamp: 2, dependsOn: [] },
      { id: "A", timestamp: 1, dependsOn: [] },
    ];
    expect(resolveDependencyOrder(fx).map((e) => e.id)).toEqual(["A", "B"]);
  });

  it("A depends on B → B before A regardless of timestamp", () => {
    const fx: N[] = [
      { id: "A", timestamp: 1, dependsOn: ["B"] },
      { id: "B", timestamp: 2, dependsOn: [] },
    ];
    expect(resolveDependencyOrder(fx).map((e) => e.id)).toEqual(["B", "A"]);
  });

  it("cyclic dependency → fall back to pure timestamp order (CR 613.8c)", () => {
    const fx: N[] = [
      { id: "A", timestamp: 1, dependsOn: ["B"] },
      { id: "B", timestamp: 2, dependsOn: ["A"] },
    ];
    expect(resolveDependencyOrder(fx).map((e) => e.id)).toEqual(["A", "B"]);
  });

  it("diamond dependency resolves deterministically", () => {
    const fx: N[] = [
      { id: "D", timestamp: 4, dependsOn: ["B", "C"] },
      { id: "B", timestamp: 2, dependsOn: ["A"] },
      { id: "C", timestamp: 3, dependsOn: ["A"] },
      { id: "A", timestamp: 1, dependsOn: [] },
    ];
    expect(resolveDependencyOrder(fx).map((e) => e.id)).toEqual(["A", "B", "C", "D"]);
  });

  it("dangling dependency refs are ignored (CR-compliant tolerance)", () => {
    const fx: N[] = [
      { id: "A", timestamp: 1, dependsOn: ["NONEXISTENT"] },
      { id: "B", timestamp: 2, dependsOn: [] },
    ];
    expect(resolveDependencyOrder(fx).map((e) => e.id)).toEqual(["A", "B"]);
  });

  it("empty input returns empty", () => {
    expect(resolveDependencyOrder<null, N>([])).toEqual([]);
  });

  it("single input returns single", () => {
    const fx: N[] = [{ id: "A", timestamp: 5, dependsOn: [] }];
    expect(resolveDependencyOrder(fx)).toEqual(fx);
  });

  it("chain of three: C→B→A resolves as [A, B, C]", () => {
    const fx: N[] = [
      { id: "A", timestamp: 3, dependsOn: [] },
      { id: "B", timestamp: 2, dependsOn: ["A"] },
      { id: "C", timestamp: 1, dependsOn: ["B"] },
    ];
    expect(resolveDependencyOrder(fx).map((e) => e.id)).toEqual(["A", "B", "C"]);
  });
});

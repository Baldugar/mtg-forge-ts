// SPDX-License-Identifier: GPL-3.0-or-later
import type { EntityId } from "@mtg-forge-ts/core";
import { mkEntityId } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { TargetChoices } from "./target-system.js";
import { TargetSystem } from "./target-system.js";

describe("TargetSystem", () => {
  it("validateAtCast throws the SP2-required sentinel", () => {
    const sys = new TargetSystem();
    const choices: TargetChoices = { targets: [] };
    expect(() => sys.validateAtCast(choices, mkEntityId(1))).toThrow(
      "TargetSystem.validateAtCast: SP2 target system required",
    );
  });

  it("validateAtResolve throws the SP2-required sentinel", () => {
    const sys = new TargetSystem();
    const choices: TargetChoices = { targets: [] };
    expect(() => sys.validateAtResolve(choices, mkEntityId(1))).toThrow(
      "TargetSystem.validateAtResolve: SP2 target system required",
    );
  });
});

describe("TargetChoices type", () => {
  it("accepts a bare targets list", () => {
    const a: EntityId = mkEntityId(7);
    const b: EntityId = mkEntityId(8);
    const choices: TargetChoices = { targets: [a, b] };
    expect(choices.targets).toHaveLength(2);
    expect(choices.targets[0]).toBe(a);
    expect(choices.divisions).toBeUndefined();
  });

  it("accepts optional divisions for divide-damage spells", () => {
    const choices: TargetChoices = {
      targets: [mkEntityId(1), mkEntityId(2)],
      divisions: { 0: 2, 1: 3 },
    };
    expect(choices.divisions?.[0]).toBe(2);
    expect(choices.divisions?.[1]).toBe(3);
  });
});

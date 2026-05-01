// SPDX-License-Identifier: GPL-3.0-or-later
// Unit tests for the smoke harness. Each test parses a small synthetic
// card source and feeds the resulting CardDefinition through runSmoke,
// asserting on the returned SmokeResult. The tests cover all three
// strategy branches plus the failure-classification path.

import { parseCard } from "@mtg-forge-ts/cards";
import { describe, expect, it } from "vitest";
import { runSmoke } from "./smoke.js";

// ── Fixture helpers ──────────────────────────────────────────────────────────

const VANILLA_BEAR = `Name:Test Bear
ManaCost:1 G
Types:Creature Bear
PT:2/2
Oracle:
`;

const SIMPLE_INSTANT = `Name:Test Bolt
ManaCost:R
Types:Instant
A:SP$ DealDamage | Cost$ R | ValidTgts$ Any | NumDmg$ 3 | SpellDescription$ {This} deals 3 damage to any target.
Oracle:Bolt deals 3 damage to any target.
`;

const TARGETED_AURA = `Name:Test Aura
ManaCost:1 W
Types:Enchantment Aura
K:Enchant creature
A:SP$ Attach | Cost$ 1 W | ValidTgts$ Creature | AILogic$ Pump
Oracle:Enchant creature.
`;

const PLANE_CARD = `Name:Test Plane
Types:Plane Mountain
Oracle:Plane card.
`;

// ── Tests ────────────────────────────────────────────────────────────────────

describe("runSmoke — basic strategy dispatch", () => {
  it("vanilla creature: ETB strategy, returns ok=true", () => {
    const def = parseCard(VANILLA_BEAR, "test://bear");
    const result = runSmoke(def);
    expect(result.strategy).toBe("permanent-etb");
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("simple instant: spell-activate strategy, returns ok=true (no cast in MVP)", () => {
    const def = parseCard(SIMPLE_INSTANT, "test://bolt");
    const result = runSmoke(def);
    expect(result.strategy).toBe("spell-activate");
    expect(result.ok).toBe(true);
  });

  it("aura with required target: still ETB-strategy (smoke doesn't actually cast)", () => {
    // Cards that "would" need targets when cast — but the smoke harness
    // doesn't cast them, it just ETBs them. So an aura without an
    // attached creature shouldn't crash the harness; the registry
    // activation paths handle the AttachedTo state lazily.
    const def = parseCard(TARGETED_AURA, "test://aura");
    const result = runSmoke(def);
    expect(result.strategy).toBe("permanent-etb");
    expect(result.ok).toBe(true);
  });

  it("non-permanent non-spell (Plane): other-activate strategy, returns ok=true", () => {
    const def = parseCard(PLANE_CARD, "test://plane");
    const result = runSmoke(def);
    expect(result.strategy).toBe("other-activate");
    expect(result.ok).toBe(true);
  });
});

describe("runSmoke — failure classification", () => {
  it("synthetic CardDefinition with broken types-line accessor classifies as failure", () => {
    // Construct a CardDefinition where reading `def.types.types` throws —
    // mimicking a parser-shape regression. runSmoke must NOT crash; it
    // must return ok=false with a classified error.
    const broken = {
      name: "Broken Card",
      oracle: "",
      get types(): never {
        throw new TypeError("simulated parser regression");
      },
      manaCost: null,
      abilities: [],
      triggers: [],
      replacements: [],
      statics: [],
      keywords: [],
      svars: new Map(),
    } as unknown as Parameters<typeof runSmoke>[0];

    const result = runSmoke(broken);
    expect(result.ok).toBe(false);
    expect(result.errorClass).toBe("type-error");
    expect(result.error).toContain("simulated parser regression");
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { parseDck } from "./dck.js";
import { validateDeck } from "./legality.js";

describe("parseDck — pure main-deck format", () => {
  it("parses a minimal `[Main]`-only deck with no set codes", () => {
    const text = ["[Main]", "4 Lightning Bolt", "20 Mountain"].join("\n");
    const deck = parseDck(text);
    expect(deck.name).toBeUndefined();
    expect(deck.main).toEqual([
      { count: 4, name: "Lightning Bolt" },
      { count: 20, name: "Mountain" },
    ]);
    expect(deck.sideboard).toBeUndefined();
    expect(deck.commander).toBeUndefined();
  });

  it("treats header-less input as `[Main]`", () => {
    // Forge's DeckRecognizer falls back to mainboard when no section is
    // declared; we mirror that behaviour.
    const text = "4 Counterspell\n20 Island";
    const deck = parseDck(text);
    expect(deck.main).toEqual([
      { count: 4, name: "Counterspell" },
      { count: 20, name: "Island" },
    ]);
  });

  it("captures `[metadata] Name=...`", () => {
    const text = ["[metadata]", "Name=My Burn Deck", "[Main]", "4 Lightning Bolt"].join("\n");
    const deck = parseDck(text);
    expect(deck.name).toBe("My Burn Deck");
    expect(deck.main).toHaveLength(1);
  });
});

describe("parseDck — main + sideboard", () => {
  it("splits cards across `[Main]` and `[Sideboard]`", () => {
    const text = [
      "[Main]",
      "4 Brainstorm",
      "20 Island",
      "[Sideboard]",
      "2 Force of Will",
      "1 Flusterstorm",
    ].join("\n");
    const deck = parseDck(text);
    expect(deck.main).toEqual([
      { count: 4, name: "Brainstorm" },
      { count: 20, name: "Island" },
    ]);
    expect(deck.sideboard).toEqual([
      { count: 2, name: "Force of Will" },
      { count: 1, name: "Flusterstorm" },
    ]);
    expect(deck.commander).toBeUndefined();
  });

  it("does not emit an empty `sideboard` array when the section has no cards", () => {
    // Forge writes empty `[Sideboard]` blocks all the time (see jace.dck).
    const text = ["[Main]", "4 Brainstorm", "[Sideboard]", "", "[Avatar]", ""].join("\n");
    const deck = parseDck(text);
    expect(deck.sideboard).toBeUndefined();
  });
});

describe("parseDck — set codes", () => {
  it("captures the set code from `<count> <name>|<set>|<art>`", () => {
    const text = ["[Main]", "2 Akroma's Memorial|TSR|1", "4 Akroma's Vengeance|C20|1", "1 Sol Ring|MIR"].join(
      "\n",
    );
    const deck = parseDck(text);
    expect(deck.main).toEqual([
      { count: 2, name: "Akroma's Memorial", set: "TSR" },
      { count: 4, name: "Akroma's Vengeance", set: "C20" },
      { count: 1, name: "Sol Ring", set: "MIR" },
    ]);
  });

  it("treats an empty set segment as no set code", () => {
    const text = "[Main]\n1 Black Lotus||";
    const deck = parseDck(text);
    expect(deck.main[0]).toEqual({ count: 1, name: "Black Lotus" });
  });

  it("preserves split-card names containing `//`", () => {
    // `//` at column 0 is a comment, but inside a card name (e.g. "Fire // Ice")
    // it must survive intact.
    const text = "[Main]\n2 Fire // Ice|APC|1";
    const deck = parseDck(text);
    expect(deck.main[0]).toEqual({ count: 2, name: "Fire // Ice", set: "APC" });
  });
});

describe("parseDck — commander section", () => {
  it("populates `commander` with the `commander: true` flag", () => {
    const text = [
      "[metadata]",
      "Name=Starter Commander - Black",
      "[Commander]",
      "1 Tymaret, Chosen from Death|THB|1",
      "[Main]",
      "1 Blood Artist|INR|1",
    ].join("\n");
    const deck = parseDck(text);
    expect(deck.name).toBe("Starter Commander - Black");
    expect(deck.commander).toEqual([
      { count: 1, name: "Tymaret, Chosen from Death", set: "THB", commander: true },
    ]);
    expect(deck.main).toEqual([{ count: 1, name: "Blood Artist", set: "INR" }]);
  });
});

describe("parseDck — comments and whitespace", () => {
  it("ignores `#` and `//` line comments and blank lines", () => {
    const text = [
      "# this is a comment",
      "// another comment",
      "",
      "[Main]",
      "  ",
      "4 Lightning Bolt   # 4 copies",
      "// 99 Mountain (commented out)",
      "20 Mountain",
    ].join("\n");
    const deck = parseDck(text);
    expect(deck.main).toEqual([
      { count: 4, name: "Lightning Bolt" },
      { count: 20, name: "Mountain" },
    ]);
  });

  it("tolerates BOM, mixed line endings, and unknown sections", () => {
    const text = "﻿[Main]\r\n4 Brainstorm\r\n[Avatar]\r\n[Planes]\n[Sideboard]\r2 Daze";
    const deck = parseDck(text);
    expect(deck.main).toEqual([{ count: 4, name: "Brainstorm" }]);
    expect(deck.sideboard).toEqual([{ count: 2, name: "Daze" }]);
  });
});

describe("parseDck — feeds validateDeck", () => {
  it("produces entries that flow into the legality validator", () => {
    // Build a simple Standard-shaped deck and round-trip through validateDeck.
    const text = [
      "[Main]",
      "4 Lightning Strike",
      "4 Shock",
      "4 Play with Fire",
      "4 Burst Lightning",
      "4 Phoenix Chick",
      "4 Monastery Mentor",
      "36 Mountain",
    ].join("\n");
    const deck = parseDck(text);
    const result = validateDeck(deck.main, "standard");
    // We only care that the parsed shape is structurally accepted by
    // validateDeck — we don't assert a specific legality verdict here
    // because the banned-list subset can change independently.
    expect(result).toBeDefined();
    expect(typeof result.legal).toBe("boolean");
  });
});

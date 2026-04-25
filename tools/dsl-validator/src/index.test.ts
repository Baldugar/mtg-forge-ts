// SPDX-License-Identifier: GPL-3.0-or-later
// Unit tests for validateCardSemantically.
//
// Each test builds a minimal card source string, parses it with parseCard,
// and then runs validateCardSemantically with either live registries or a
// custom stub registry to assert the expected outcome.

import { parseCard } from "@mtg-forge-ts/cards";
import { describe, expect, it } from "vitest";
import type { Registries } from "./index.js";
import { validateCardSemantically } from "./index.js";

// ── Stub registry helpers ──────────────────────────────────────────────────────

/** Build a Registries stub where every has() returns true (all-known). */
const allKnown = (): Registries => ({
  effect: { has: () => true },
  trigger: { has: () => true },
  replacement: { has: () => true },
  keyword: { has: () => true },
});

/** Stub registries where the given effect key is unknown. */
const unknownEffect = (key: string): Registries => ({
  ...allKnown(),
  effect: { has: (k) => k !== key },
});

/** Stub registries where the given trigger mode is unknown. */
const unknownTrigger = (mode: string): Registries => ({
  ...allKnown(),
  trigger: { has: (m) => m !== mode },
});

/** Stub registries where the given replacement eventKind is unknown. */
const unknownReplacement = (eventKind: string): Registries => ({
  ...allKnown(),
  replacement: { has: (k) => k !== eventKind },
});

// ── Helper — build a minimal sorcery with one A: line ────────────────────────

const sorcerySource = (abilityLine: string, svars = ""): string =>
  `Name:Test Card\nManaCost:1 R\nTypes:Sorcery\n${abilityLine}\n${svars}\nOracle:Test.\n`;

const creatureSource = (extras = ""): string =>
  `Name:Test Creature\nManaCost:1 G\nTypes:Creature Human\nPT:2/2\n${extras}\nOracle:Test.\n`;

const mdfcSource = (face2extras = ""): string =>
  // Forge DFC format: AlternateMode:X is metadata on the front face; bare
  // ALTERNATE (lexed as AlternateMode with empty content) is the face separator.
  `Name:Test Front\nManaCost:1 U\nTypes:Sorcery\nAlternateMode:Transform\nOracle:Front.\nALTERNATE\nName:Test Back\nTypes:Creature Human\nPT:2/2\n${face2extras}\nOracle:Back.\n`;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("validateCardSemantically", () => {
  describe("ok: true cases", () => {
    it("returns ok for a card with no abilities/triggers/replacements", () => {
      const src = creatureSource();
      const def = parseCard(src, "test.txt");
      const result = validateCardSemantically(def, allKnown());
      expect(result.ok).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it("returns ok when all handler keys are registered (effect)", () => {
      // A:SP$ DealDamage is the canonical 'DealDamage' effect key.
      const src = sorcerySource(
        "A:SP$ DealDamage | Cost$ R | NumDmg$ 3 | ValidTgts$ Any | SpellDescription$ Deal 3 damage.",
      );
      const def = parseCard(src, "test.txt");
      // All-known stub → should be ok.
      const result = validateCardSemantically(def, allKnown());
      expect(result.ok).toBe(true);
    });

    it("returns ok when all trigger modes are registered", () => {
      const src = creatureSource(
        "T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDraw | TriggerDescription$ ETB.\nSVar:TrigDraw:DB$ Draw | NumCards$ 1",
      );
      const def = parseCard(src, "test.txt");
      const result = validateCardSemantically(def, allKnown());
      expect(result.ok).toBe(true);
    });

    it("skips DB-prefixed effect handlerKeys (SVar refs, not registry entries)", () => {
      // The SVar-resolved trigger's Execute$ key is a DB-prefix name.
      // The effect inside the TriggerAst has handlerKey = "TrigDraw" which
      // is an SVar ref, not a DB-prefix name. But the ability DB cases test:
      // a direct A:SP$ DB... is also skipped.
      const src = sorcerySource(
        "A:SP$ DBFoo | Cost$ R | SpellDescription$ Test.\nSVar:DBFoo:DB$ Draw | NumCards$ 1",
      );
      const def = parseCard(src, "test.txt");
      // DB-prefix should be skipped — even if effect registry would miss it.
      const result = validateCardSemantically(def, {
        ...allKnown(),
        effect: { has: () => false }, // nothing in registry
      });
      // 'DBFoo' starts with 'DB', so it must be skipped.
      const effectIssues = result.issues.filter((i) => i.kind === "unknownEffect");
      expect(effectIssues).toHaveLength(0);
    });
  });

  describe("unknownEffect", () => {
    it("reports issue when effect handlerKey is not in registry", () => {
      const src = sorcerySource(
        "A:SP$ DealDamage | Cost$ R | NumDmg$ 3 | ValidTgts$ Any | SpellDescription$ Deal 3.",
      );
      const def = parseCard(src, "test.txt");
      const result = validateCardSemantically(def, unknownEffect("DealDamage"));
      expect(result.ok).toBe(false);
      const issue = result.issues.find((i) => i.kind === "unknownEffect");
      expect(issue).toBeDefined();
      expect(issue?.key).toBe("DealDamage");
    });

    it("path includes the ability index", () => {
      const src = sorcerySource(
        "A:SP$ DealDamage | Cost$ R | NumDmg$ 3 | ValidTgts$ Any | SpellDescription$ Deal 3.",
      );
      const def = parseCard(src, "test.txt");
      const result = validateCardSemantically(def, unknownEffect("DealDamage"));
      const issue = result.issues.find((i) => i.kind === "unknownEffect");
      expect(issue?.path).toContain("abilities[0]");
    });
  });

  describe("unknownTrigger", () => {
    it("reports issue when trigger mode is not in registry", () => {
      const src = creatureSource(
        "T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDraw | TriggerDescription$ ETB.\nSVar:TrigDraw:DB$ Draw | NumCards$ 1",
      );
      const def = parseCard(src, "test.txt");
      const result = validateCardSemantically(def, unknownTrigger("ChangesZone"));
      expect(result.ok).toBe(false);
      const issue = result.issues.find((i) => i.kind === "unknownTrigger");
      expect(issue).toBeDefined();
      expect(issue?.key).toBe("ChangesZone");
    });

    it("path includes the trigger index", () => {
      const src = creatureSource(
        "T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDraw | TriggerDescription$ ETB.\nSVar:TrigDraw:DB$ Draw | NumCards$ 1",
      );
      const def = parseCard(src, "test.txt");
      const result = validateCardSemantically(def, unknownTrigger("ChangesZone"));
      const issue = result.issues.find((i) => i.kind === "unknownTrigger");
      expect(issue?.path).toContain("triggers[0]");
    });
  });

  describe("unknownReplacement", () => {
    // Minimal land card with an ETB-tap replacement (Moved event).
    const landSrc =
      "Name:Test Land\nManaCost:no cost\nTypes:Land\n" +
      "R:Event$ Moved | ValidCard$ Card.Self | Destination$ Battlefield" +
      " | ReplaceWith$ LandTapped | ReplacementResult$ Updated | Description$ Enters tapped.\n" +
      "SVar:LandTapped:DB$ Tap | Defined$ Self | ETB$ True\n" +
      "Oracle:Enters tapped.\n";

    it("reports issue when replacement eventKind is not in registry", () => {
      // 'Moved' is a valid DSL replacement type (passes the structural parser).
      const def = parseCard(landSrc, "test.txt");
      const result = validateCardSemantically(def, unknownReplacement("Moved"));
      expect(result.ok).toBe(false);
      const issue = result.issues.find((i) => i.kind === "unknownReplacement");
      expect(issue).toBeDefined();
      expect(issue?.key).toBe("Moved");
    });

    it("path includes the replacement index", () => {
      const def = parseCard(landSrc, "test.txt");
      const result = validateCardSemantically(def, unknownReplacement("Moved"));
      const issue = result.issues.find((i) => i.kind === "unknownReplacement");
      expect(issue?.path).toContain("replacements[0]");
    });
  });

  describe("multi-face cards", () => {
    it("reports issue in face[0] when the second face has an unknown trigger", () => {
      const src = mdfcSource(
        "T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDraw | TriggerDescription$ ETB.\nSVar:TrigDraw:DB$ Draw | NumCards$ 1",
      );
      const def = parseCard(src, "test.txt");
      const result = validateCardSemantically(def, unknownTrigger("ChangesZone"));
      expect(result.ok).toBe(false);
      const issue = result.issues.find((i) => i.kind === "unknownTrigger");
      expect(issue?.path).toContain("faces[0]");
      expect(issue?.path).toContain("triggers[0]");
    });
  });

  describe("multiple issues", () => {
    it("collects all issues from the same card", () => {
      const src =
        "Name:Test Card\nManaCost:1 R\nTypes:Sorcery\n" +
        "A:SP$ DealDamage | Cost$ R | NumDmg$ 3 | ValidTgts$ Any | SpellDescription$ Deal 3.\n" +
        "A:SP$ Draw | Cost$ 1 U | NumCards$ 1 | SpellDescription$ Draw.\n" +
        "Oracle:Test.\n";
      const def = parseCard(src, "test.txt");
      // Both effects are unknown.
      const result = validateCardSemantically(def, {
        ...allKnown(),
        effect: { has: () => false },
      });
      expect(result.issues.filter((i) => i.kind === "unknownEffect")).toHaveLength(2);
    });
  });
});

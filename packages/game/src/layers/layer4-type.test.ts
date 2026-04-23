// SPDX-License-Identifier: GPL-3.0-or-later
import { CardType, emptyCharacteristics } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { type TypeChangeEffect, applyLayer4Type } from "./layer4-type.js";

describe("Layer 4 — Type-changing effects (CR 613.1d + CR 604.3)", () => {
  it("CDA adds apply before non-CDA", () => {
    const c = emptyCharacteristics();
    const effects: TypeChangeEffect[] = [
      {
        kind: "add",
        cardType: CardType.Artifact,
        isCda: false,
        timestamp: 10,
        sourceAbilityId: null,
      },
      {
        kind: "add",
        cardType: CardType.Creature,
        isCda: true,
        timestamp: 1,
        sourceAbilityId: null,
      },
    ];
    applyLayer4Type(c, effects);
    expect(c.types.has(CardType.Creature)).toBe(true);
    expect(c.types.has(CardType.Artifact)).toBe(true);
  });

  it("remove strips a type", () => {
    const c = emptyCharacteristics();
    c.types.add(CardType.Creature);
    applyLayer4Type(c, [
      {
        kind: "remove",
        cardType: CardType.Creature,
        isCda: false,
        timestamp: 1,
        sourceAbilityId: null,
      },
    ]);
    expect(c.types.has(CardType.Creature)).toBe(false);
  });

  it("becomes replaces the type set entirely", () => {
    const c = emptyCharacteristics();
    c.types.add(CardType.Land);
    applyLayer4Type(c, [
      {
        kind: "becomes",
        types: new Set([CardType.Creature]),
        isCda: false,
        timestamp: 1,
        sourceAbilityId: null,
      },
    ]);
    expect(c.types.has(CardType.Creature)).toBe(true);
    expect(c.types.has(CardType.Land)).toBe(false);
  });

  it("non-CDA applies in timestamp order", () => {
    const c = emptyCharacteristics();
    applyLayer4Type(c, [
      {
        kind: "add",
        cardType: CardType.Artifact,
        isCda: false,
        timestamp: 2,
        sourceAbilityId: null,
      },
      {
        kind: "remove",
        cardType: CardType.Artifact,
        isCda: false,
        timestamp: 3,
        sourceAbilityId: null,
      },
    ]);
    expect(c.types.has(CardType.Artifact)).toBe(false);
  });

  it("CDA becomes wipes, then non-CDA add layers on top", () => {
    const c = emptyCharacteristics();
    c.types.add(CardType.Sorcery);
    applyLayer4Type(c, [
      {
        kind: "becomes",
        types: new Set([CardType.Creature]),
        isCda: true,
        timestamp: 1,
        sourceAbilityId: null,
      },
      {
        kind: "add",
        cardType: CardType.Artifact,
        isCda: false,
        timestamp: 10,
        sourceAbilityId: null,
      },
    ]);
    expect(c.types.has(CardType.Sorcery)).toBe(false);
    expect(c.types.has(CardType.Creature)).toBe(true);
    expect(c.types.has(CardType.Artifact)).toBe(true);
  });

  it("empty effects leaves target unchanged", () => {
    const c = emptyCharacteristics();
    c.types.add(CardType.Enchantment);
    applyLayer4Type(c, []);
    expect(c.types.has(CardType.Enchantment)).toBe(true);
  });
});

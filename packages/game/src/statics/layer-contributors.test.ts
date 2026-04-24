// SPDX-License-Identifier: GPL-3.0-or-later
// Layer-contributor tests (SP2 Task 26). Verify continuous-category
// StaticAbility registration pushes layer effects into the correct
// LayerEngine arrays, and that unregister removes them.
import type {
  CardType,
  LobbyPlayer,
  PaperCard,
  StaticAbility,
  StaticAbilityCategory,
} from "@mtg-forge-ts/core";
import {
  ColorSet,
  DEFAULT_PAPER_CARD_FLAGS,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import type { TextSubstitution } from "../layers/layer3-text.js";
import type { TypeChangeEffect } from "../layers/layer4-type.js";
import type { ColorChangeEffect } from "../layers/layer5-color.js";
import type { AbilityChangeEffect } from "../layers/layer6-ability.js";
import type { Layer7bEffect, Layer7cEffect, Layer7dEffect } from "../layers/layer7-pt.js";
import type { ContinuousPayload } from "./layer-contributors.js";

const alice: LobbyPlayer = { id: "p-alice", name: "Alice", controllerKind: "human" };
const bob: LobbyPlayer = { id: "p-bob", name: "Bob", controllerKind: "ai" };
const rules: GameRules = {
  formatId: "standard",
  startingLife: 20,
  startingHandSize: 7,
  mulliganRule: "london",
  firstPlayerSkipsDraw: true,
  ruleOverrides: [],
  playerCount: { min: 2, max: 2 },
  poisonCountersToLose: 10,
  playForAnte: false,
  manaBurn: false,
  appliedVariants: [],
};
const meta: GameMeta = {
  engineVersion: "0.0.0",
  forgeSha: "abc",
  cardDataSyncedAt: "2026-04-23T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};
const samplePaper: PaperCard = {
  name: "Forest",
  edition: "LEA",
  collectorNumber: "294",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const makeGame = (): Game => new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });

// Build a static that returns the same payload reference across calls —
// required by the stability contract on describe().
const mkContinuousStatic = (opts: {
  id: number;
  sourceCardId: number;
  payload: ContinuousPayload;
  category?: StaticAbilityCategory;
}): StaticAbility => {
  const payload = opts.payload;
  return {
    id: mkEntityId(opts.id),
    kind: "static",
    sourceCardId: mkEntityId(opts.sourceCardId),
    activeInZones: new Set([ZoneType.Battlefield]),
    timestamp: 1,
    controllerSeatAtReg: mkPlayerSeat(0),
    category: opts.category ?? "continuous",
    mode: "Continuous",
    describe: () => payload,
  };
};

describe("contributeToLayers / removeFromLayers (SP2 Task 26)", () => {
  it("registers a type-add effect into typeEffects; unregister removes it", () => {
    const game = makeGame();
    const effect: TypeChangeEffect = {
      kind: "add",
      cardType: "Creature" as CardType,
      isCda: false,
      timestamp: 1,
      sourceAbilityId: mkEntityId(5),
    };
    const s = mkContinuousStatic({ id: 5, sourceCardId: 1, payload: { kind: "type", effect } });
    game.staticEffectRegistry.register(s);
    expect(game.layerEngine.typeEffects).toContain(effect);
    game.staticEffectRegistry.unregister(s.id);
    expect(game.layerEngine.typeEffects).not.toContain(effect);
  });

  it("registers a color effect into colorEffects; unregister removes it", () => {
    const game = makeGame();
    const effect: ColorChangeEffect = {
      kind: "add",
      colors: ColorSet.all(),
      isCda: false,
      timestamp: 1,
      sourceAbilityId: mkEntityId(5),
    };
    const s = mkContinuousStatic({ id: 5, sourceCardId: 1, payload: { kind: "color", effect } });
    game.staticEffectRegistry.register(s);
    expect(game.layerEngine.colorEffects).toContain(effect);
    game.staticEffectRegistry.unregister(s.id);
    expect(game.layerEngine.colorEffects).not.toContain(effect);
  });

  it("registers an ability-grant effect into abilityEffects; unregister removes it", () => {
    const game = makeGame();
    const effect: AbilityChangeEffect = {
      kind: "add",
      abilityId: mkEntityId(99),
      grantedBy: mkEntityId(5),
      origin: "layer6",
      timestamp: 1,
    };
    const s = mkContinuousStatic({ id: 5, sourceCardId: 1, payload: { kind: "ability", effect } });
    game.staticEffectRegistry.register(s);
    expect(game.layerEngine.abilityEffects).toContain(effect);
    game.staticEffectRegistry.unregister(s.id);
    expect(game.layerEngine.abilityEffects).not.toContain(effect);
  });

  it("registers a text-substitution effect into textSubstitutions; unregister removes it", () => {
    const game = makeGame();
    const effect: TextSubstitution = { from: "Forest", to: "Plains", timestamp: 1 };
    const s = mkContinuousStatic({ id: 5, sourceCardId: 1, payload: { kind: "text", effect } });
    game.staticEffectRegistry.register(s);
    expect(game.layerEngine.textSubstitutions).toContain(effect);
    game.staticEffectRegistry.unregister(s.id);
    expect(game.layerEngine.textSubstitutions).not.toContain(effect);
  });

  it("registers a Layer7bEffect into pt7b; unregister removes it", () => {
    const game = makeGame();
    const effect: Layer7bEffect = {
      kind: "set",
      power: 3,
      toughness: 3,
      timestamp: 1,
      sourceAbilityId: mkEntityId(5),
    };
    const s = mkContinuousStatic({ id: 5, sourceCardId: 1, payload: { kind: "pt-set", effect } });
    game.staticEffectRegistry.register(s);
    expect(game.layerEngine.pt7b).toContain(effect);
    game.staticEffectRegistry.unregister(s.id);
    expect(game.layerEngine.pt7b).not.toContain(effect);
  });

  it("registers a Layer7cEffect into pt7c; unregister removes it", () => {
    const game = makeGame();
    const effect: Layer7cEffect = {
      kind: "modify",
      powerDelta: 2,
      toughnessDelta: 0,
      timestamp: 1,
      sourceAbilityId: mkEntityId(5),
    };
    const s = mkContinuousStatic({ id: 5, sourceCardId: 1, payload: { kind: "pt-modify", effect } });
    game.staticEffectRegistry.register(s);
    expect(game.layerEngine.pt7c).toContain(effect);
    game.staticEffectRegistry.unregister(s.id);
    expect(game.layerEngine.pt7c).not.toContain(effect);
  });

  it("registers a Layer7dEffect into pt7d; unregister removes it", () => {
    const game = makeGame();
    const effect: Layer7dEffect = {
      kind: "plusOnePlusOne",
      count: 2,
      timestamp: 1,
      sourceAbilityId: mkEntityId(5),
    };
    const s = mkContinuousStatic({ id: 5, sourceCardId: 1, payload: { kind: "pt-counter", effect } });
    game.staticEffectRegistry.register(s);
    expect(game.layerEngine.pt7d).toContain(effect);
    game.staticEffectRegistry.unregister(s.id);
    expect(game.layerEngine.pt7d).not.toContain(effect);
  });

  it("bumps the layer epoch on register and on unregister", () => {
    const game = makeGame();
    const effect: TypeChangeEffect = {
      kind: "add",
      cardType: "Creature" as CardType,
      isCda: false,
      timestamp: 1,
      sourceAbilityId: mkEntityId(5),
    };
    const s = mkContinuousStatic({ id: 5, sourceCardId: 1, payload: { kind: "type", effect } });
    const e0 = game.layerEngine.currentEpoch;
    game.staticEffectRegistry.register(s);
    expect(game.layerEngine.currentEpoch).toBeGreaterThan(e0);
    const e1 = game.layerEngine.currentEpoch;
    game.staticEffectRegistry.unregister(s.id);
    expect(game.layerEngine.currentEpoch).toBeGreaterThan(e1);
  });

  it("non-continuous static does NOT contribute to any layer", () => {
    const game = makeGame();
    // Use a costModification category — describe() payload shape doesn't
    // matter because contributeToLayers short-circuits before reading it.
    const s: StaticAbility = {
      id: mkEntityId(5),
      kind: "static",
      sourceCardId: mkEntityId(1),
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 1,
      controllerSeatAtReg: mkPlayerSeat(0),
      category: "costModification",
      mode: "ReduceCost",
      describe: () => ({ somePayload: true }),
    };
    game.staticEffectRegistry.register(s);
    expect(game.layerEngine.typeEffects).toHaveLength(0);
    expect(game.layerEngine.colorEffects).toHaveLength(0);
    expect(game.layerEngine.abilityEffects).toHaveLength(0);
    expect(game.layerEngine.textSubstitutions).toHaveLength(0);
    expect(game.layerEngine.pt7b).toHaveLength(0);
    expect(game.layerEngine.pt7c).toHaveLength(0);
    expect(game.layerEngine.pt7d).toHaveLength(0);
  });

  it("end-to-end — continuous add-ability static reflects in computeCharacteristics; unregister reverts", () => {
    const game = makeGame();
    // A live battlefield card whose characteristics we can compute.
    const cardId = mkEntityId(1);
    const card = new Card(cardId, samplePaper, mkPlayerSeat(0), mkPlayerSeat(0), ZoneType.Battlefield);
    game.cards.set(cardId, card);
    const grantedAbilityId = mkEntityId(77);
    const grantedBy = mkEntityId(9);
    const effect: AbilityChangeEffect = {
      kind: "add",
      abilityId: grantedAbilityId,
      grantedBy,
      origin: "layer6",
      timestamp: 1,
    };
    const s = mkContinuousStatic({ id: 9, sourceCardId: 1, payload: { kind: "ability", effect } });
    const before = game.layerEngine.computeCharacteristics(cardId);
    const hadBefore = before.abilities.some((a) => a.id === grantedAbilityId);
    expect(hadBefore).toBe(false);
    game.staticEffectRegistry.register(s);
    const after = game.layerEngine.computeCharacteristics(cardId);
    expect(after.abilities.some((a) => a.id === grantedAbilityId)).toBe(true);
    game.staticEffectRegistry.unregister(s.id);
    const reverted = game.layerEngine.computeCharacteristics(cardId);
    expect(reverted.abilities.some((a) => a.id === grantedAbilityId)).toBe(false);
  });

  it("re-register with same id unwinds the previous contribution (no leak)", () => {
    const game = makeGame();
    const first: TypeChangeEffect = {
      kind: "add",
      cardType: "Creature" as CardType,
      isCda: false,
      timestamp: 1,
      sourceAbilityId: mkEntityId(5),
    };
    const second: TypeChangeEffect = {
      kind: "add",
      cardType: "Artifact" as CardType,
      isCda: false,
      timestamp: 2,
      sourceAbilityId: mkEntityId(5),
    };
    const s1 = mkContinuousStatic({ id: 5, sourceCardId: 1, payload: { kind: "type", effect: first } });
    const s2 = mkContinuousStatic({ id: 5, sourceCardId: 1, payload: { kind: "type", effect: second } });
    game.staticEffectRegistry.register(s1);
    game.staticEffectRegistry.register(s2);
    // first was unwound when s2 took id 5; only the second survives.
    expect(game.layerEngine.typeEffects).not.toContain(first);
    expect(game.layerEngine.typeEffects).toContain(second);
  });
});

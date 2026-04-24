// SPDX-License-Identifier: GPL-3.0-or-later
import type { ContinuousEffect, LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import {
  CardType,
  DEFAULT_PAPER_CARD_FLAGS,
  Layer,
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
import type { TypeChangeEffect } from "../layers/layer4-type.js";
import { evalCondition } from "./condition-evaluator.js";

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

const grizzlyBears: PaperCard = {
  name: "Grizzly Bears",
  edition: "LEA",
  collectorNumber: "195",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const mkGame = (): Game => new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });

const addCreature = (g: Game, id: number, zone = ZoneType.Battlefield): number => {
  const cid = mkEntityId(id);
  const card = new Card(cid, grizzlyBears, mkPlayerSeat(0), mkPlayerSeat(0), zone);
  g.cards.set(cid, card);
  return id;
};

describe("evalCondition (SP2 Task 34)", () => {
  it("always returns true, never returns false", () => {
    const game = mkGame();
    expect(evalCondition({ kind: "always" }, game)).toBe(true);
    expect(evalCondition({ kind: "never" }, game)).toBe(false);
  });

  it("and composes two conditions", () => {
    const game = mkGame();
    expect(evalCondition({ kind: "and", left: { kind: "always" }, right: { kind: "always" } }, game)).toBe(
      true,
    );
    expect(evalCondition({ kind: "and", left: { kind: "always" }, right: { kind: "never" } }, game)).toBe(
      false,
    );
    expect(evalCondition({ kind: "and", left: { kind: "never" }, right: { kind: "always" } }, game)).toBe(
      false,
    );
  });

  it("or composes two conditions", () => {
    const game = mkGame();
    expect(evalCondition({ kind: "or", left: { kind: "never" }, right: { kind: "always" } }, game)).toBe(
      true,
    );
    expect(evalCondition({ kind: "or", left: { kind: "never" }, right: { kind: "never" } }, game)).toBe(
      false,
    );
  });

  it("not inverts a condition", () => {
    const game = mkGame();
    expect(evalCondition({ kind: "not", inner: { kind: "always" } }, game)).toBe(false);
    expect(evalCondition({ kind: "not", inner: { kind: "never" } }, game)).toBe(true);
  });

  it("cardHasType matches a creature once the type is added via Layer 4", () => {
    const game = mkGame();
    addCreature(game, 42);
    // Base characteristics have no types until a Layer 4 effect seeds them.
    game.layerEngine.typeEffects.push({
      kind: "add",
      cardType: CardType.Creature,
      isCda: true,
      timestamp: 1,
      sourceAbilityId: null,
    });
    game.layerEngine.bumpEpoch("seed-creature-type");
    expect(
      evalCondition({ kind: "cardHasType", cardId: mkEntityId(42), cardType: CardType.Creature }, game),
    ).toBe(true);
  });

  it("cardHasType returns false for absent types", () => {
    const game = mkGame();
    addCreature(game, 42);
    expect(
      evalCondition({ kind: "cardHasType", cardId: mkEntityId(42), cardType: CardType.Artifact }, game),
    ).toBe(false);
  });

  it("cardHasType returns false for unknown card id", () => {
    const game = mkGame();
    expect(
      evalCondition({ kind: "cardHasType", cardId: mkEntityId(999), cardType: CardType.Creature }, game),
    ).toBe(false);
  });

  it("cardInZone matches current zone", () => {
    const game = mkGame();
    addCreature(game, 10, ZoneType.Battlefield);
    expect(
      evalCondition({ kind: "cardInZone", cardId: mkEntityId(10), zone: ZoneType.Battlefield }, game),
    ).toBe(true);
    expect(evalCondition({ kind: "cardInZone", cardId: mkEntityId(10), zone: ZoneType.Hand }, game)).toBe(
      false,
    );
  });

  it("cardInZone returns false for unknown card id", () => {
    const game = mkGame();
    expect(
      evalCondition({ kind: "cardInZone", cardId: mkEntityId(999), zone: ZoneType.Battlefield }, game),
    ).toBe(false);
  });

  it("cardTapped mirrors the Card.tapped flag", () => {
    const game = mkGame();
    addCreature(game, 10);
    expect(evalCondition({ kind: "cardTapped", cardId: mkEntityId(10) }, game)).toBe(false);
    const card = game.cards.get(mkEntityId(10));
    if (card) card.tapped = true;
    expect(evalCondition({ kind: "cardTapped", cardId: mkEntityId(10) }, game)).toBe(true);
  });

  it("cardTapped returns false for unknown card id", () => {
    const game = mkGame();
    expect(evalCondition({ kind: "cardTapped", cardId: mkEntityId(999) }, game)).toBe(false);
  });

  it("playerHasLife compares to threshold", () => {
    const game = mkGame();
    expect(evalCondition({ kind: "playerHasLife", seat: mkPlayerSeat(0), atLeast: 20 }, game)).toBe(true);
    expect(evalCondition({ kind: "playerHasLife", seat: mkPlayerSeat(0), atLeast: 21 }, game)).toBe(false);
    const alicePlayer = game.players[0];
    if (!alicePlayer) throw new Error("fixture: alice missing");
    alicePlayer.life = 5;
    expect(evalCondition({ kind: "playerHasLife", seat: mkPlayerSeat(0), atLeast: 5 }, game)).toBe(true);
    expect(evalCondition({ kind: "playerHasLife", seat: mkPlayerSeat(0), atLeast: 6 }, game)).toBe(false);
  });

  it("playerHasLife returns false for unknown seat", () => {
    const game = mkGame();
    expect(evalCondition({ kind: "playerHasLife", seat: mkPlayerSeat(99), atLeast: 1 }, game)).toBe(false);
  });
});

describe("asLongAs integration — epoch-driven expiry (SP2 Task 34)", () => {
  it("asLongAs effect expires when condition flips via Layer 4 type removal", () => {
    const game = mkGame();
    // Seed a card + an add-Creature CDA so the baseline types set contains
    // Creature (deriveBaseCharacteristics pulls from PaperCard.definition
    // which is SP4 work; SP2 tests seed the CDA manually).
    addCreature(game, 42);
    game.layerEngine.typeEffects.push({
      kind: "add",
      cardType: CardType.Creature,
      isCda: true,
      timestamp: 0,
      sourceAbilityId: null,
    });
    game.layerEngine.bumpEpoch("seed-creature-type");
    const xId = mkEntityId(42);
    expect(game.layerEngine.computeCharacteristics(xId).types.has(CardType.Creature)).toBe(true);

    // Register an asLongAs effect gated on cardHasType(42, Creature). The
    // payload is a Layer 7c PT modifier — not relevant to the condition,
    // only used to exercise the layer-dispatch wiring.
    const asLongAsEffect: ContinuousEffect = {
      id: mkEntityId(500),
      sourceCardId: mkEntityId(501),
      timestamp: 1,
      layer: Layer.L7c_PTModify,
      duration: {
        kind: "asLongAs",
        condition: { kind: "cardHasType", cardId: xId, cardType: CardType.Creature },
      },
      payload: {
        kind: "pt-modify",
        effect: {
          layer: Layer.L7c_PTModify,
          timestamp: 1,
          sourceAbilityId: null,
          power: 1,
          toughness: 1,
        } as unknown,
      },
    };
    game.continuousEffectRegistry.register(asLongAsEffect);
    // Still-a-creature: effect remains registered.
    expect(game.continuousEffectRegistry.size()).toBe(1);
    // Drain any buffered (there shouldn't be any) to reset state.
    game.continuousEffectRegistry.drainExpired();

    // Now register a Layer 4 "remove Creature" continuous effect targeting
    // card 42. This bumps the layer epoch; checkEpoch re-evaluates the
    // asLongAs predicate, which now returns false, and the asLongAs effect
    // unregisters.
    const removeCreature: TypeChangeEffect = {
      kind: "remove",
      cardType: CardType.Creature,
      isCda: false,
      timestamp: 2,
      sourceAbilityId: null,
    };
    const typeRemoveEffect: ContinuousEffect = {
      id: mkEntityId(600),
      sourceCardId: mkEntityId(601),
      timestamp: 2,
      layer: Layer.L4_Type,
      duration: { kind: "permanent" },
      payload: { kind: "type", effect: removeCreature },
    };
    game.continuousEffectRegistry.register(typeRemoveEffect);

    // Post-registration: the asLongAs effect should be gone (condition
    // flipped), while the permanent type-remover survives.
    expect(game.continuousEffectRegistry.get(mkEntityId(500))).toBeUndefined();
    expect(game.continuousEffectRegistry.get(mkEntityId(600))).toBeDefined();
    // The expiry landed in the drain buffer.
    const drained = game.continuousEffectRegistry.drainExpired();
    expect(drained).toHaveLength(1);
    expect(drained[0]?.id).toBe(mkEntityId(500));
    // And the card is indeed no longer a creature.
    expect(game.layerEngine.computeCharacteristics(xId).types.has(CardType.Creature)).toBe(false);
  });

  it("asLongAs with always condition survives epoch bumps", () => {
    const game = mkGame();
    const effect: ContinuousEffect = {
      id: mkEntityId(700),
      sourceCardId: null,
      timestamp: 1,
      layer: Layer.L7c_PTModify,
      duration: { kind: "asLongAs", condition: { kind: "always" } },
      payload: {
        kind: "pt-modify",
        effect: {
          layer: Layer.L7c_PTModify,
          timestamp: 1,
          sourceAbilityId: null,
        } as unknown,
      },
    };
    game.continuousEffectRegistry.register(effect);
    game.layerEngine.bumpEpoch("test");
    expect(game.continuousEffectRegistry.size()).toBe(1);
    expect(game.continuousEffectRegistry.drainExpired()).toHaveLength(0);
  });

  it("asLongAs with never condition expires on first epoch check", () => {
    const game = mkGame();
    const effect: ContinuousEffect = {
      id: mkEntityId(800),
      sourceCardId: null,
      timestamp: 1,
      layer: Layer.L7c_PTModify,
      duration: { kind: "asLongAs", condition: { kind: "never" } },
      payload: {
        kind: "pt-modify",
        effect: {
          layer: Layer.L7c_PTModify,
          timestamp: 1,
          sourceAbilityId: null,
        } as unknown,
      },
    };
    // register() bumps epoch, which triggers checkEpoch() — the effect
    // expires immediately.
    game.continuousEffectRegistry.register(effect);
    expect(game.continuousEffectRegistry.size()).toBe(0);
    expect(game.continuousEffectRegistry.drainExpired()).toHaveLength(1);
  });
});

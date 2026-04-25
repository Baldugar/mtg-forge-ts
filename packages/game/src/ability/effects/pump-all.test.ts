// SPDX-License-Identifier: GPL-3.0-or-later
// PumpAllEffect test — board-wide +N/+M UEOT on a ValidCards$ filter.
//
// Layer-architecture note (SP2/SP3): Layer 7c effects are registered globally
// (applyLayer7c applies all registered effects to every card's characteristics
// computation). PumpAll registers ONE L7c effect per matching card so the delta
// semantically "belongs to" each card; the count of registered effects equals
// the count of matched cards. Per-card scoping for L7c (targetCardId filter)
// is deferred to SP4 — the current MVP tests verify filter COUNTS, not per-card
// isolation, which is correct given the architecture.
//
// Layer-seeding note: deriveBaseCharacteristics (SP2) does not yet read
// PaperCard.definition.types or .pt. Tests seed typeEffects and pt7b manually,
// mirroring the pattern in pump.test.ts.
import "../../svar/selectors/number.js";
import "./pump-all.js";
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
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
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { Library } from "../../zone/zones/library.js";
import { SpellAbility } from "../spell-ability.js";

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

const plainPaper: PaperCard = {
  name: "Grizzly Bears",
  edition: "LEA",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
  return game;
};

/** Seed a global Layer 4 "add Creature" so all cards appear as Creature.
 *  Necessary because deriveBaseCharacteristics (SP2) does not read
 *  PaperCard.definition.types — that is deferred to SP4. */
const seedCreatureType = (game: Game): void => {
  game.layerEngine.typeEffects.push({
    kind: "add",
    cardType: CardType.Creature,
    isCda: false,
    timestamp: 0,
    sourceAbilityId: null,
  });
};

/** Seed a global Layer 7b base P/T. */
const seedBasePT = (game: Game, power: number, toughness: number): void => {
  game.layerEngine.pt7b.push({
    kind: "set",
    power,
    toughness,
    timestamp: 0,
    sourceAbilityId: null,
  });
};

const drainGen = (gen: Generator<unknown, void, unknown>): void => {
  let r = gen.next();
  while (!r.done) r = gen.next();
};

describe("PumpAllEffect", () => {
  it("registers one L7c UEOT effect per controller Creature (Creature.YouCtrl filter)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const sourceId = mkEntityId(1);
    const ally1Id = mkEntityId(10);
    const ally2Id = mkEntityId(11);
    const foeId = mkEntityId(20);

    // seat0 has 3 cards (source + 2 allies); seat1 has 1 card.
    game.cards.set(sourceId, new Card(sourceId, plainPaper, seat0, seat0, ZoneType.Battlefield));
    game.cards.set(ally1Id, new Card(ally1Id, plainPaper, seat0, seat0, ZoneType.Battlefield));
    game.cards.set(ally2Id, new Card(ally2Id, plainPaper, seat0, seat0, ZoneType.Battlefield));
    game.cards.set(foeId, new Card(foeId, plainPaper, seat1, seat1, ZoneType.Battlefield));

    // Make all cards appear as Creatures (SP2 layer-seeding workaround).
    seedCreatureType(game);
    seedBasePT(game, 2, 2);

    expect(game.continuousEffectRegistry.size()).toBe(0);

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "PumpAll",
          params: {
            NumAtt: { kind: "literal", raw: "1" },
            NumDef: { kind: "literal", raw: "1" },
            ValidCards: { kind: "literal", raw: "Creature.YouCtrl" },
          },
        },
        cost: { raw: "2 W" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    // Creature.YouCtrl = seat0's 3 cards → 3 registered L7c effects.
    // The opponent's card (foeId) is excluded by the filter.
    expect(game.continuousEffectRegistry.size()).toBe(3);

    for (const eff of game.continuousEffects) {
      expect(eff.layer).toBe(Layer.L7c_PTModify);
      expect(eff.duration.kind).toBe("untilEndOfTurn");
    }
  });

  it("registers one L7c effect per creature when ValidCards$ is plain 'Creature'", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const sourceId = mkEntityId(1);
    const allyId = mkEntityId(10);
    const foeId = mkEntityId(20);

    game.cards.set(sourceId, new Card(sourceId, plainPaper, seat0, seat0, ZoneType.Battlefield));
    game.cards.set(allyId, new Card(allyId, plainPaper, seat0, seat0, ZoneType.Battlefield));
    game.cards.set(foeId, new Card(foeId, plainPaper, seat1, seat1, ZoneType.Battlefield));

    seedCreatureType(game);
    seedBasePT(game, 1, 1);

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "PumpAll",
          params: {
            NumAtt: { kind: "literal", raw: "2" },
            NumDef: { kind: "literal", raw: "0" },
            ValidCards: { kind: "literal", raw: "Creature" },
          },
        },
        cost: { raw: "R" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    // All 3 Creature cards matched (no controller filter) → 3 effects.
    expect(game.continuousEffectRegistry.size()).toBe(3);
    for (const eff of game.continuousEffects) {
      expect(eff.layer).toBe(Layer.L7c_PTModify);
    }
  });

  it("registers zero effects when no cards match (OpponentCtrl with no opponent creatures)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(1);
    const allyId = mkEntityId(10);

    // Only controller's cards — no opponent creatures.
    game.cards.set(sourceId, new Card(sourceId, plainPaper, seat0, seat0, ZoneType.Battlefield));
    game.cards.set(allyId, new Card(allyId, plainPaper, seat0, seat0, ZoneType.Battlefield));

    seedCreatureType(game);
    seedBasePT(game, 2, 2);

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "PumpAll",
          params: {
            NumAtt: { kind: "literal", raw: "1" },
            NumDef: { kind: "literal", raw: "1" },
            ValidCards: { kind: "literal", raw: "Creature.OpponentCtrl" },
          },
        },
        cost: { raw: "W" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    // No opponent creatures → no effects registered.
    expect(game.continuousEffectRegistry.size()).toBe(0);
  });

  it("L7c pump delta is reflected in computeCharacteristics on a single creature", () => {
    // This test verifies the L7c compute path with a single card in scope,
    // avoiding the global-scoping ambiguity of multi-card setups.
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(1);
    const creatureId = mkEntityId(10);

    game.cards.set(sourceId, new Card(sourceId, plainPaper, seat0, seat0, ZoneType.Battlefield));
    game.cards.set(creatureId, new Card(creatureId, plainPaper, seat0, seat0, ZoneType.Battlefield));

    seedCreatureType(game);
    // Base P/T: 2/2 (applies to all cards including source).
    seedBasePT(game, 2, 2);

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "PumpAll",
          params: {
            NumAtt: { kind: "literal", raw: "1" },
            NumDef: { kind: "literal", raw: "1" },
            ValidCards: { kind: "literal", raw: "Creature.YouCtrl" },
          },
        },
        cost: { raw: "2 W" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    // 2 Creature.YouCtrl cards (source + creatureId) → 2 L7c effects registered.
    // Both effects are global so creatureId receives +2 total (2 effects × +1/+1).
    // Base: 2/2. After 2 global +1/+1 effects: 4/4.
    expect(game.continuousEffectRegistry.size()).toBe(2);
    const chars = game.layerEngine.computeCharacteristics(creatureId);
    expect(chars.power).toBe(4); // 2 (base) + 1 (eff1) + 1 (eff2)
    expect(chars.toughness).toBe(4);
  });
});

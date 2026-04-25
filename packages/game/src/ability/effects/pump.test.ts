// SPDX-License-Identifier: GPL-3.0-or-later
// PumpEffect test — Giant Growth (+3/+3 UEOT) on a 2/2 creature should yield
// 5/5 via the LayerEngine after the effect resolves.
import "../../svar/selectors/number.js";
import "./pump.js";
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import {
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
const paper: PaperCard = {
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

const drainGen = (gen: Generator<unknown, void, unknown>): void => {
  let r = gen.next();
  while (!r.done) r = gen.next();
};

describe("PumpEffect", () => {
  it("registers a UEOT +3/+3 Layer7c effect — 2/2 creature becomes 5/5", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const creatureId = mkEntityId(20);

    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    const creature = new Card(creatureId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.cards.set(creatureId, creature);

    // Establish base 2/2 via a Layer7b set effect so applyLayer7c has a non-null base.
    game.layerEngine.pt7b.push({
      kind: "set",
      power: 2,
      toughness: 2,
      timestamp: 0,
      sourceAbilityId: null,
    });

    expect(game.continuousEffectRegistry.size()).toBe(0);

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "Pump",
          params: {
            NumAtt: { kind: "literal", raw: "3" },
            NumDef: { kind: "literal", raw: "3" },
          },
        },
        cost: { raw: "G" },
      },
      sourceId,
      seat0,
      new Map(),
      [creatureId],
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    // One ContinuousEffect should be registered.
    expect(game.continuousEffectRegistry.size()).toBe(1);

    // LayerEngine should reflect the +3/+3 on top of the 2/2 base.
    const chars = game.layerEngine.computeCharacteristics(creatureId);
    expect(chars.power).toBe(5);
    expect(chars.toughness).toBe(5);

    // The registered effect should be Layer7c with untilEndOfTurn duration.
    const effects = game.continuousEffects;
    expect(effects).toHaveLength(1);
    expect(effects[0]?.layer).toBe(Layer.L7c_PTModify);
    expect(effects[0]?.duration.kind).toBe("untilEndOfTurn");
  });

  it("stacks with a second pump — 2/2 + 3/3 + 2/2 = 7/7", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const creatureId = mkEntityId(20);

    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    const creature = new Card(creatureId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.cards.set(creatureId, creature);

    game.layerEngine.pt7b.push({
      kind: "set",
      power: 2,
      toughness: 2,
      timestamp: 0,
      sourceAbilityId: null,
    });

    const mkSa = (att: number, def: number): SpellAbility =>
      new SpellAbility(
        {
          kind: "spell",
          effect: {
            handlerKey: "Pump",
            params: {
              NumAtt: { kind: "literal", raw: String(att) },
              NumDef: { kind: "literal", raw: String(def) },
            },
          },
          cost: { raw: "G" },
        },
        sourceId,
        seat0,
        new Map(),
        [creatureId],
      );

    drainGen(mkSa(3, 3).makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    drainGen(mkSa(2, 2).makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(game.continuousEffectRegistry.size()).toBe(2);
    const chars = game.layerEngine.computeCharacteristics(creatureId);
    expect(chars.power).toBe(7);
    expect(chars.toughness).toBe(7);
  });
});

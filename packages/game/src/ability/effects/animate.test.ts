// SPDX-License-Identifier: GPL-3.0-or-later
// AnimateEffect test — a land (or artifact) that is animated to 3/3 Creature
// until end of turn should have Creature in its type set and power/toughness
// of 3/3 via computeCharacteristics.
import "../../svar/selectors/number.js";
import "./animate.js";
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

/** A minimal Land PaperCard (no definition → base characteristics = Land). */
const landPaper: PaperCard = {
  name: "Mishra's Factory",
  edition: "ATQ",
  collectorNumber: "076",
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

describe("AnimateEffect", () => {
  it("animates a land to 3/3 Creature UEOT — computeCharacteristics returns Creature + 3/3", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const landId = mkEntityId(20);

    // Place source and target on battlefield.
    const source = new Card(sourceId, landPaper, seat0, seat0, ZoneType.Battlefield);
    const land = new Card(landId, landPaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.cards.set(landId, land);

    expect(game.continuousEffectRegistry.size()).toBe(0);

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "Animate",
          params: {
            Power: { kind: "literal", raw: "3" },
            Toughness: { kind: "literal", raw: "3" },
            Duration: { kind: "literal", raw: "untilEndOfTurn" },
          },
        },
        cost: { raw: "T" },
      },
      sourceId,
      seat0,
      new Map(),
      [landId],
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    // Two continuous effects should be registered: L4_Type + L7b_PTSet.
    expect(game.continuousEffectRegistry.size()).toBe(2);

    const effects = game.continuousEffects;
    const layers = effects.map((e) => e.layer);
    expect(layers).toContain(Layer.L4_Type);
    expect(layers).toContain(Layer.L7b_PTSet);
    expect(effects[0]?.duration.kind).toBe("untilEndOfTurn");
    expect(effects[1]?.duration.kind).toBe("untilEndOfTurn");

    // computeCharacteristics for the land should now show Creature type + 3/3 PT.
    const chars = game.layerEngine.computeCharacteristics(landId);
    expect(chars.types.has(CardType.Creature)).toBe(true);
    expect(chars.power).toBe(3);
    expect(chars.toughness).toBe(3);
  });

  it("registers effects as 'permanent' duration when Duration$ is omitted", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const landId = mkEntityId(20);

    game.cards.set(sourceId, new Card(sourceId, landPaper, seat0, seat0, ZoneType.Battlefield));
    game.cards.set(landId, new Card(landId, landPaper, seat0, seat0, ZoneType.Battlefield));

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "Animate",
          params: {
            Power: { kind: "literal", raw: "2" },
            Toughness: { kind: "literal", raw: "2" },
            Duration: { kind: "literal", raw: "permanent" },
          },
        },
        cost: { raw: "" },
      },
      sourceId,
      seat0,
      new Map(),
      [landId],
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    const effects = game.continuousEffects;
    expect(effects[0]?.duration.kind).toBe("permanent");
    expect(effects[1]?.duration.kind).toBe("permanent");
  });
});

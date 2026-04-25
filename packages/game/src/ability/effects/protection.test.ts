// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 3 — ProtectionEffect tests.
// Verifies that ProtectionEffect grants protection:<tag> keyword to the target.
import "./protection.js";
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { EngineYield } from "../../action/engine-yield.js";
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
  name: "Test",
  edition: "LEA",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const mkGame = () => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
  return game;
};

const drainGen = (gen: Generator<unknown, void, unknown>): EngineYield[] => {
  const yields: EngineYield[] = [];
  let r = gen.next();
  while (!r.done) {
    yields.push(r.value as EngineYield);
    r = gen.next();
  }
  return yields;
};

describe("ProtectionEffect — keyword grant (Wave 3)", () => {
  it("grants protection:red keyword to the target card", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(1);
    const targetId = mkEntityId(10);

    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    const target = new Card(targetId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(targetId, target);

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "Protection",
          params: {
            Gains: { kind: "literal", raw: "red" },
            Until: { kind: "literal", raw: "EOT" },
          },
        },
        cost: { raw: "" },
      },
      sourceId,
      seat0,
      new Map(),
      [targetId],
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(target.keywords?.has("protection:red")).toBe(true);
  });

  it("registers a ContinuousEffect with untilEndOfTurn duration", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(1);
    const targetId = mkEntityId(10);

    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    game.cards.set(targetId, new Card(targetId, paper, seat0, seat0, ZoneType.Battlefield));

    const initialEffects = game.continuousEffectRegistry.size();

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "Protection",
          params: {
            Gains: { kind: "literal", raw: "white" },
            Until: { kind: "literal", raw: "EOT" },
          },
        },
        cost: { raw: "" },
      },
      sourceId,
      seat0,
      new Map(),
      [targetId],
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(game.continuousEffectRegistry.size()).toBe(initialEffects + 1);
    const effects = game.continuousEffectRegistry.all();
    const lastEffect = effects[effects.length - 1];
    if (!lastEffect) throw new Error("Expected at least one ContinuousEffect");
    expect(lastEffect.duration.kind).toBe("untilEndOfTurn");
  });

  it("no-op when Gains$ is absent", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(1);
    const targetId = mkEntityId(10);

    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    const target = new Card(targetId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(targetId, target);

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: { handlerKey: "Protection", params: {} },
        cost: { raw: "" },
      },
      sourceId,
      seat0,
      new Map(),
      [targetId],
    );

    expect(() =>
      drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>),
    ).not.toThrow();
    // No keyword added when Gains$ is absent.
    expect(target.keywords?.size ?? 0).toBe(0);
  });
});

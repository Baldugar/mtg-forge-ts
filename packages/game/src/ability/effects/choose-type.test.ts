// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 4 — ChooseTypeEffect decision tests.
// Verifies that ChooseType yields a chooseType decision and stores the
// controller's chosen type on card.chosenTypes.
import "./choose-type.js";
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
  cardDataSyncedAt: "2026-04-24T00:00:00Z",
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

/**
 * Drive a generator, responding to the first `chooseType` decision with
 * the provided type string.
 */
const drainWithChoice = (gen: Generator<unknown, void, unknown>, chosenType: string): EngineYield[] => {
  const yields: EngineYield[] = [];
  let responded = false;
  let r = gen.next();
  while (!r.done) {
    yields.push(r.value as EngineYield);
    const y = r.value as EngineYield;
    if (!responded && y.kind === "decision" && y.request.kind === "chooseType") {
      responded = true;
      r = gen.next({ kind: "chooseType", type: chosenType });
    } else {
      r = gen.next();
    }
  }
  return yields;
};

describe("ChooseTypeEffect — yields chooseType decision (Wave 4)", () => {
  it("yields a chooseType decision with sourceId and typeKind", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "ChooseType",
          params: { Type: { kind: "literal", raw: "Creature" } },
        },
        cost: { raw: "" },
      },
      sourceId,
      seat0,
      new Map(),
      [],
    );

    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    const first = gen.next();
    expect(first.done).toBe(false);
    const y = first.value as EngineYield;
    expect(y.kind).toBe("decision");
    if (y.kind !== "decision") throw new Error("decision expected");
    expect(y.request.kind).toBe("chooseType");
    if (y.request.kind !== "chooseType") throw new Error("chooseType expected");
    expect(y.request.sourceId).toBe(sourceId);
    expect(y.request.typeKind).toBe("Creature");
    // Drain the rest.
    gen.next({ kind: "chooseType", type: "Elf" });
  });

  it("stores the chosen type in card.chosenTypes", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "ChooseType",
          params: { Type: { kind: "literal", raw: "Creature" } },
        },
        cost: { raw: "" },
      },
      sourceId,
      seat0,
      new Map(),
      [],
    );

    drainWithChoice(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>, "Elf");
    expect(source.chosenTypes).toHaveLength(1);
    expect(source.chosenTypes[0]).toBe("Elf");
  });

  it("falls back to 'Goblin' when no decision response is provided", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "ChooseType",
          params: {},
        },
        cost: { raw: "" },
      },
      sourceId,
      seat0,
      new Map(),
      [],
    );

    // Drive without responding → fallback to "Goblin".
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    let r = gen.next();
    while (!r.done) r = gen.next(); // pass undefined as response

    expect(source.chosenTypes).toHaveLength(1);
    expect(source.chosenTypes[0]).toBe("Goblin");
  });

  it("stacks multiple chosen types across resolves", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);

    const mkSa = () =>
      new SpellAbility(
        {
          kind: "spell",
          effect: { handlerKey: "ChooseType", params: {} },
          cost: { raw: "" },
        },
        sourceId,
        seat0,
        new Map(),
        [],
      );

    drainWithChoice(mkSa().makeResolver().resolve(game) as Generator<unknown, void, unknown>, "Goblin");
    drainWithChoice(mkSa().makeResolver().resolve(game) as Generator<unknown, void, unknown>, "Wizard");
    expect(source.chosenTypes).toEqual(["Goblin", "Wizard"]);
  });

  it("uses Type$ param as typeKind hint (Artifact)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "ChooseType",
          params: { Type: { kind: "literal", raw: "Artifact" } },
        },
        cost: { raw: "" },
      },
      sourceId,
      seat0,
      new Map(),
      [],
    );

    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    const first = gen.next();
    const y = first.value as EngineYield;
    if (y.kind !== "decision" || y.request.kind !== "chooseType") throw new Error("chooseType expected");
    expect(y.request.typeKind).toBe("Artifact");
    gen.next({ kind: "chooseType", type: "Equipment" });
  });
});

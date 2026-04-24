// SPDX-License-Identifier: GPL-3.0-or-later
// SP2 Task 62 — tempt() generator tests.
import type { EntityId, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  CardType,
  DEFAULT_PAPER_CARD_FLAGS,
  IllegalDecisionError,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { EngineYield } from "../action/engine-yield.js";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";
import { incrementRingLevel, tempt } from "./temptation.js";

const paper: PaperCard = {
  name: "T",
  edition: "LEA",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

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

const mkGame = (): Game => {
  const lobby: LobbyPlayer[] = [
    { id: "a", name: "A", controllerKind: "human" },
    { id: "b", name: "B", controllerKind: "ai" },
  ];
  const game = new Game({ lobbyPlayers: lobby, rules, meta, rng: new SeededRng(1n) });
  for (const p of game.players) {
    p.zones.set(ZoneType.Library, new Library(ZoneType.Library, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
    p.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p.seat));
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
  }
  return game;
};

const addCreature = (game: Game, owner: PlayerSeat, id: EntityId): Card => {
  const card = new Card(id, paper, owner, owner, ZoneType.Battlefield);
  game.cards.set(id, card);
  const z = game.getPlayer(owner).zones.get(ZoneType.Battlefield);
  if (!z) throw new Error("no battlefield");
  z.add(id);
  // Teach the layer engine this card is a creature: a single add-type effect.
  game.layerEngine.typeEffects.push({
    kind: "add",
    cardType: CardType.Creature,
    isCda: false,
    timestamp: id as unknown as number,
    sourceAbilityId: null,
  });
  game.layerEngine.bumpEpoch("test-seed-creature");
  return card;
};

// Drive a generator forward with a supplied decision responder.
const drive = (
  gen: Generator<EngineYield, void, unknown>,
  onDecision: (y: Extract<EngineYield, { kind: "decision" }>) => unknown,
): EngineYield[] => {
  const seen: EngineYield[] = [];
  let step = gen.next();
  while (!step.done) {
    const y = step.value;
    seen.push(y);
    if (y.kind === "decision") {
      step = gen.next(onDecision(y));
    } else {
      step = gen.next();
    }
  }
  return seen;
};

describe("incrementRingLevel (SP2 Task 62)", () => {
  it("increments 0 → 1 → 2 → 3 → 4", () => {
    expect(incrementRingLevel(0)).toBe(1);
    expect(incrementRingLevel(1)).toBe(2);
    expect(incrementRingLevel(2)).toBe(3);
    expect(incrementRingLevel(3)).toBe(4);
  });
  it("clamps at 4", () => {
    expect(incrementRingLevel(4)).toBe(4);
  });
});

describe("tempt (SP2 Task 62 — CR 701.52)", () => {
  it("initial ringState is undefined; reads default to level 0 / bearer null", () => {
    const game = mkGame();
    expect(game.ringState.get(mkPlayerSeat(0))).toBeUndefined();
  });

  it("first tempt: level 0 → 1, yields chooseRingBearer, records chosen bearer", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const creatureId = mkEntityId(100);
    addCreature(game, seat, creatureId);

    const yields = drive(tempt(game, seat), (y) => {
      if (y.request.kind !== "chooseRingBearer") throw new Error("unexpected decision");
      expect(y.request.playerSeat).toBe(seat);
      expect(y.request.candidateIds).toEqual([creatureId]);
      expect(y.request.currentBearer).toBeNull();
      return { kind: "chooseRingBearer", bearerId: creatureId };
    });

    const state = game.ringState.get(seat);
    expect(state).toEqual({ bearer: creatureId, level: 1 });
    const ringTempted = yields.find((y) => y.kind === "event" && y.event.kind === "RingTempted");
    expect(ringTempted).toBeDefined();
    const levelChanged = yields.find((y) => y.kind === "event" && y.event.kind === "RingLevelChanged");
    expect(levelChanged).toBeDefined();
  });

  it("second tempt: level 1 → 2; re-enumerates candidates", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const c1 = mkEntityId(100);
    addCreature(game, seat, c1);
    drive(tempt(game, seat), () => ({ kind: "chooseRingBearer", bearerId: c1 }));
    drive(tempt(game, seat), () => ({ kind: "chooseRingBearer", bearerId: c1 }));
    expect(game.ringState.get(seat)).toEqual({ bearer: c1, level: 2 });
  });

  it("tempt at level 4 stays at 4", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const c1 = mkEntityId(100);
    addCreature(game, seat, c1);
    for (let i = 0; i < 5; i++) {
      drive(tempt(game, seat), () => ({ kind: "chooseRingBearer", bearerId: c1 }));
    }
    expect(game.ringState.get(seat)?.level).toBe(4);
    // Fifth tempt doesn't emit RingLevelChanged (level unchanged).
    const yields = drive(tempt(game, seat), () => ({ kind: "chooseRingBearer", bearerId: c1 }));
    const changed = yields.find((y) => y.kind === "event" && y.event.kind === "RingLevelChanged");
    expect(changed).toBeUndefined();
    expect(game.ringState.get(seat)?.level).toBe(4);
  });

  it("no creatures controlled: no decision yielded, bearer stays null, level still advances", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    let decisionsYielded = 0;
    const yields = drive(tempt(game, seat), () => {
      decisionsYielded++;
      return undefined;
    });
    expect(decisionsYielded).toBe(0);
    expect(game.ringState.get(seat)).toEqual({ bearer: null, level: 1 });
    expect(yields.some((y) => y.kind === "event" && y.event.kind === "RingTempted")).toBe(true);
  });

  it("null response keeps current bearer if still a valid candidate", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const c1 = mkEntityId(100);
    addCreature(game, seat, c1);
    drive(tempt(game, seat), () => ({ kind: "chooseRingBearer", bearerId: c1 }));
    drive(tempt(game, seat), () => ({ kind: "chooseRingBearer", bearerId: null }));
    expect(game.ringState.get(seat)).toEqual({ bearer: c1, level: 2 });
  });

  it("invalid bearer in response throws IllegalDecisionError", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const c1 = mkEntityId(100);
    addCreature(game, seat, c1);
    const gen = tempt(game, seat);
    const step = gen.next();
    expect(step.done).toBe(false);
    if (step.done || step.value.kind !== "decision") throw new Error("unexpected yield");
    const bogusId = mkEntityId(999);
    expect(() => gen.next({ kind: "chooseRingBearer", bearerId: bogusId })).toThrow(IllegalDecisionError);
  });

  it("only enumerates creatures the target player controls on the battlefield", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const opponent = mkPlayerSeat(1);
    const myCreature = mkEntityId(100);
    const oppCreature = mkEntityId(101);
    addCreature(game, seat, myCreature);
    addCreature(game, opponent, oppCreature);

    drive(tempt(game, seat), (y) => {
      if (y.request.kind !== "chooseRingBearer") throw new Error("bad");
      expect(y.request.candidateIds).toEqual([myCreature]);
      return { kind: "chooseRingBearer", bearerId: myCreature };
    });
  });

  it("RingTempted event carries playerSeat and bearer cardId", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const c1 = mkEntityId(100);
    addCreature(game, seat, c1);
    const yields = drive(tempt(game, seat), () => ({ kind: "chooseRingBearer", bearerId: c1 }));
    const ev = yields.find((y) => y.kind === "event" && y.event.kind === "RingTempted");
    if (!ev || ev.kind !== "event" || ev.event.kind !== "RingTempted") throw new Error("no event");
    expect(ev.event.payload.playerSeat).toBe(seat);
    expect(ev.event.payload.cardId).toBe(c1);
  });

  it("per-seat state is isolated — tempting one player doesn't affect another", () => {
    const game = mkGame();
    const s0 = mkPlayerSeat(0);
    const s1 = mkPlayerSeat(1);
    const c0 = mkEntityId(100);
    const c1 = mkEntityId(200);
    addCreature(game, s0, c0);
    addCreature(game, s1, c1);
    drive(tempt(game, s0), () => ({ kind: "chooseRingBearer", bearerId: c0 }));
    expect(game.ringState.get(s0)?.level).toBe(1);
    expect(game.ringState.get(s1)).toBeUndefined();
    drive(tempt(game, s1), () => ({ kind: "chooseRingBearer", bearerId: c1 }));
    expect(game.ringState.get(s1)?.level).toBe(1);
    expect(game.ringState.get(s0)?.level).toBe(1);
  });
});

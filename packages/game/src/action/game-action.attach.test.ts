// SPDX-License-Identifier: GPL-3.0-or-later
// SP2 Milestone K Task 42 — attach/unattach on GameAction.
//
// Verifies:
//   - attach sets source.attachedTo + target.attachments, emits CardAttached
//   - attach on already-attached source detaches prior target first
//   - unattach clears state + emits CardUnattached
//   - unattach is a no-op on an already-unattached card (no event)
//   - attach with a missing source/target throws
//   - replacement can prevent attach
//   - replacement can redirect attach to a different target
//   - epoch bumps on both
import type {
  EntityId,
  LobbyPlayer,
  MutationIntent,
  PaperCard,
  PlayerSeat,
  ReplacementAbility,
} from "@mtg-forge-ts/core";
import {
  DEFAULT_PAPER_CARD_FLAGS,
  GameStateIntegrityError,
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
import { Battlefield } from "../zone/zones/battlefield.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";
import type { EngineYield } from "./engine-yield.js";

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
  name: "T",
  edition: "LEA",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const seedZones = (game: Game): void => {
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
};

const addCard = (game: Game, seat: PlayerSeat, zone: ZoneType, id: EntityId): Card => {
  const card = new Card(id, paper, seat, seat, zone);
  game.cards.set(id, card);
  const z = game.getPlayer(seat).zones.get(zone);
  if (!z) throw new Error("test: missing zone");
  z.add(id);
  return card;
};

const mkGame = (): Game => {
  const game = new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(1n),
  });
  seedZones(game);
  return game;
};

// WHY `unknown` return: both GameAction methods (void) and sbaEngine.sweep
// (returns SbaAction batches) plug into this driver. The caller never needs
// the generator return value in these tests; typing it as `unknown` avoids
// carrying a secondary generic.
const runAll = (gen: Generator<EngineYield, unknown, unknown>): EngineYield[] => {
  const out: EngineYield[] = [];
  let step = gen.next();
  while (!step.done) {
    const y = step.value;
    out.push(y);
    if (y.kind === "decision" && y.request.kind === "orderReplacements") {
      step = gen.next({ order: [...y.request.replacementIds] });
    } else {
      step = gen.next();
    }
  }
  return out;
};

type Apply = (i: MutationIntent) => MutationIntent | null;
type Matches = (i: MutationIntent) => boolean;
const mkReplacement = (
  id: number,
  sourceCardId: number,
  apply: Apply,
  matches: Matches = () => true,
): ReplacementAbility => ({
  id: mkEntityId(id),
  kind: "replacement",
  sourceCardId: mkEntityId(sourceCardId),
  activeInZones: new Set([ZoneType.Battlefield]),
  timestamp: 1,
  controllerSeatAtReg: mkPlayerSeat(0),
  matches,
  apply: (i) => apply(i),
  isSelfReplacement: false,
  layer: "other",
});

const eventsOfKind = (ys: EngineYield[], kind: string): EngineYield[] =>
  ys.filter((y) => y.kind === "event" && y.event.kind === kind);

describe("GameAction.attach (SP2 Task 42)", () => {
  it("attach sets source.attachedTo + target.attachments and emits CardAttached", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const auraId = mkEntityId(10);
    const creatureId = mkEntityId(11);
    addCard(game, seat, ZoneType.Battlefield, auraId);
    addCard(game, seat, ZoneType.Battlefield, creatureId);

    const ys = runAll(game.action.attach(auraId, creatureId, "cast"));
    expect(game.cards.get(auraId)?.attachedTo).toBe(creatureId);
    expect(game.cards.get(creatureId)?.attachments).toEqual([auraId]);
    const attached = eventsOfKind(ys, "CardAttached");
    expect(attached).toHaveLength(1);
    if (attached[0]?.kind !== "event" || attached[0].event.kind !== "CardAttached") {
      throw new Error("expected CardAttached event");
    }
    expect(attached[0].event.payload.sourceId).toBe(auraId);
    expect(attached[0].event.payload.targetId).toBe(creatureId);
    expect(attached[0].event.payload.cause).toBe("cast");
  });

  it("attach on already-attached source detaches prior target first", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const equipId = mkEntityId(20);
    const creature1 = mkEntityId(21);
    const creature2 = mkEntityId(22);
    addCard(game, seat, ZoneType.Battlefield, equipId);
    addCard(game, seat, ZoneType.Battlefield, creature1);
    addCard(game, seat, ZoneType.Battlefield, creature2);

    runAll(game.action.attach(equipId, creature1, "activated"));
    expect(game.cards.get(equipId)?.attachedTo).toBe(creature1);
    expect(game.cards.get(creature1)?.attachments).toEqual([equipId]);

    runAll(game.action.attach(equipId, creature2, "activated"));
    expect(game.cards.get(equipId)?.attachedTo).toBe(creature2);
    expect(game.cards.get(creature1)?.attachments).toEqual([]);
    expect(game.cards.get(creature2)?.attachments).toEqual([equipId]);
  });

  it("attach bumps the layer engine epoch", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const auraId = mkEntityId(30);
    const creatureId = mkEntityId(31);
    addCard(game, seat, ZoneType.Battlefield, auraId);
    addCard(game, seat, ZoneType.Battlefield, creatureId);
    const before = game.layerEngine.currentEpoch;
    runAll(game.action.attach(auraId, creatureId, "cast"));
    expect(game.layerEngine.currentEpoch).toBeGreaterThan(before);
  });

  it("attach with missing source throws GameStateIntegrityError", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const creatureId = mkEntityId(41);
    addCard(game, seat, ZoneType.Battlefield, creatureId);
    expect(() => runAll(game.action.attach(mkEntityId(999), creatureId, "cast"))).toThrow(
      GameStateIntegrityError,
    );
  });

  it("attach with missing target throws GameStateIntegrityError", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const auraId = mkEntityId(50);
    addCard(game, seat, ZoneType.Battlefield, auraId);
    expect(() => runAll(game.action.attach(auraId, mkEntityId(998), "cast"))).toThrow(
      GameStateIntegrityError,
    );
  });

  it("replacement can prevent attach → EventPrevented, no state change, no CardAttached", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const auraId = mkEntityId(60);
    const creatureId = mkEntityId(61);
    addCard(game, seat, ZoneType.Battlefield, auraId);
    addCard(game, seat, ZoneType.Battlefield, creatureId);
    game.replacementRegistry.register(mkReplacement(1, 999, () => null));
    const ys = runAll(game.action.attach(auraId, creatureId, "cast"));
    expect(eventsOfKind(ys, "CardAttached")).toHaveLength(0);
    expect(eventsOfKind(ys, "EventPrevented")).toHaveLength(1);
    expect(eventsOfKind(ys, "ReplacementApplied")).toHaveLength(1);
    expect(game.cards.get(auraId)?.attachedTo).toBeNull();
    expect(game.cards.get(creatureId)?.attachments).toEqual([]);
  });

  it("replacement can redirect attach to a different target", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const auraId = mkEntityId(70);
    const original = mkEntityId(71);
    const substituted = mkEntityId(72);
    addCard(game, seat, ZoneType.Battlefield, auraId);
    addCard(game, seat, ZoneType.Battlefield, original);
    addCard(game, seat, ZoneType.Battlefield, substituted);
    game.replacementRegistry.register(
      mkReplacement(1, 999, (i) => {
        const src = i as unknown as { kind: string };
        if (src.kind !== "attach") return i;
        return {
          ...(i as unknown as Record<string, unknown>),
          targetId: substituted,
        } as unknown as MutationIntent;
      }),
    );
    const ys = runAll(game.action.attach(auraId, original, "cast"));
    expect(game.cards.get(auraId)?.attachedTo).toBe(substituted);
    expect(game.cards.get(original)?.attachments).toEqual([]);
    expect(game.cards.get(substituted)?.attachments).toEqual([auraId]);
    const attached = eventsOfKind(ys, "CardAttached");
    expect(attached).toHaveLength(1);
    if (attached[0]?.kind !== "event" || attached[0].event.kind !== "CardAttached") {
      throw new Error("expected CardAttached event");
    }
    expect(attached[0].event.payload.targetId).toBe(substituted);
  });
});

describe("GameAction.unattach (SP2 Task 42)", () => {
  it("unattach clears source.attachedTo + removes from target.attachments + emits CardUnattached", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const equipId = mkEntityId(100);
    const creatureId = mkEntityId(101);
    addCard(game, seat, ZoneType.Battlefield, equipId);
    addCard(game, seat, ZoneType.Battlefield, creatureId);
    runAll(game.action.attach(equipId, creatureId, "activated"));

    const before = game.layerEngine.currentEpoch;
    const ys = runAll(game.action.unattach(equipId, "effect"));
    expect(game.cards.get(equipId)?.attachedTo).toBeNull();
    expect(game.cards.get(creatureId)?.attachments).toEqual([]);
    expect(game.layerEngine.currentEpoch).toBeGreaterThan(before);
    const unattached = eventsOfKind(ys, "CardUnattached");
    expect(unattached).toHaveLength(1);
    if (unattached[0]?.kind !== "event" || unattached[0].event.kind !== "CardUnattached") {
      throw new Error("expected CardUnattached event");
    }
    expect(unattached[0].event.payload.sourceId).toBe(equipId);
    expect(unattached[0].event.payload.reason).toBe("effect");
  });

  it("unattach on unattached card is a no-op (no events, no state change)", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const equipId = mkEntityId(200);
    addCard(game, seat, ZoneType.Battlefield, equipId);
    const epochBefore = game.layerEngine.currentEpoch;
    const ys = runAll(game.action.unattach(equipId, "effect"));
    expect(ys).toEqual([]);
    expect(game.cards.get(equipId)?.attachedTo).toBeNull();
    expect(game.layerEngine.currentEpoch).toBe(epochBefore);
  });

  it("SBA equipmentUnattach routes through unattach (emits CardUnattached with reason sba)", () => {
    // An equipment attached to a non-creature triggers equipmentUnattach
    // on the next SBA sweep. That path now calls GameAction.unattach so
    // the event flows through the canonical pipeline.
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const equipId = mkEntityId(300);
    const land = mkEntityId(301);
    addCard(game, seat, ZoneType.Battlefield, equipId);
    addCard(game, seat, ZoneType.Battlefield, land);

    // Tag the subtype via the layer-cache so the SBA collector classifies
    // equipId as Equipment. The land stays a non-creature, which forces
    // the equipmentUnattach branch in collectAttachmentLegality.
    const equipChars = game.layerEngine.computeCharacteristics(equipId);
    equipChars.subtypes.add("Equipment");

    // Directly attach the equipment by mutating fields. Bypassing
    // GameAction.attach here keeps the test isolated to the SBA path.
    const equip = game.cards.get(equipId);
    const landCard = game.cards.get(land);
    if (!equip || !landCard) throw new Error("test setup");
    equip.attachedTo = land;
    landCard.attachments = [equipId];

    const ys = runAll(game.sbaEngine.sweep());
    expect(equip.attachedTo).toBeNull();
    expect(landCard.attachments).toEqual([]);
    const unattached = eventsOfKind(ys, "CardUnattached");
    expect(unattached).toHaveLength(1);
    if (unattached[0]?.kind !== "event" || unattached[0].event.kind !== "CardUnattached") {
      throw new Error("expected CardUnattached event");
    }
    expect(unattached[0].event.payload.reason).toBe("sba");
  });
});

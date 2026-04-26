// SPDX-License-Identifier: GPL-3.0-or-later
import type { LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  CounterType,
  DEFAULT_PAPER_CARD_FLAGS,
  IncompatibleSnapshotVersionError,
  Layer,
  PhaseStep,
  SeededRng,
  SnapshotRestoreError,
  UnknownCardError,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
  paperCardKey,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import type { StackItem } from "../stack/stack-item.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";
import { SNAPSHOT_SCHEMA_VERSION, restore, snapshot } from "./game-snapshot.js";

// === Shared fixtures ==============================================

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

const paperA: PaperCard = {
  name: "Llanowar Elves",
  edition: "LEA",
  collectorNumber: "236",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const paperB: PaperCard = {
  name: "Lightning Bolt",
  edition: "LEA",
  collectorNumber: "161",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const paperCards = new Map<string, PaperCard>([
  [paperCardKey(paperA), paperA],
  [paperCardKey(paperB), paperB],
]);

const makeGame = (seed = 1n): Game => {
  const g = new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(seed),
  });
  // Install one zone per player so zone round-trip is exercised.
  const p0 = g.players[0];
  const p1 = g.players[1];
  if (!p0 || !p1) throw new Error("makeGame: players not constructed");
  p0.zones.set(ZoneType.Library, new Library(ZoneType.Library, p0.seat));
  p0.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p0.seat));
  p0.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p0.seat));
  p0.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p0.seat));
  p1.zones.set(ZoneType.Library, new Library(ZoneType.Library, p1.seat));
  p1.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p1.seat));
  p1.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p1.seat));
  p1.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p1.seat));
  return g;
};

const seedCard = (g: Game, paper: PaperCard, owner: number, zone: ZoneType): Card => {
  const id = g.newEntityId();
  const c = new Card(id, paper, mkPlayerSeat(owner), mkPlayerSeat(owner), zone);
  g.cards.set(id, c);
  const p = g.players[owner];
  if (p) {
    const z = p.zones.get(zone);
    if (z) z.add(id);
  }
  return c;
};

const makeRestoreOpts = (rng = new SeededRng(1n)) => ({
  lobbyPlayers: [alice, bob],
  rng,
  paperCards,
  rules,
});

// === Tests ========================================================

describe("GameSnapshot", () => {
  it("header.schemaVersion is pinned to 7 (SP3 Wave 43: transient Card slots round-tripped)", () => {
    const g = makeGame();
    const snap = snapshot(g);
    expect(snap.header.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(snap.header.schemaVersion).toBe(7);
  });

  it("reserved state slots combat + cardRemembered + continuousEffects are present with SP1 sentinels", () => {
    const g = makeGame();
    const snap = snapshot(g);
    expect(snap.state.combat).toBeNull();
    expect(snap.state.cardRemembered).toEqual({});
    expect(snap.state.continuousEffects).toEqual([]);
  });

  it("restore tolerates null combat + empty cardRemembered + empty continuousEffects (SP1 no-op)", () => {
    const g = makeGame();
    const snap = snapshot(g);
    const restored = restore(JSON.parse(JSON.stringify(snap)) as typeof snap, makeRestoreOpts());
    const snap2 = snapshot(restored);
    expect(snap2.state.combat).toBeNull();
    expect(snap2.state.cardRemembered).toEqual({});
    expect(snap2.state.continuousEffects).toEqual([]);
  });

  it("Game default has an empty continuousEffects list", () => {
    const g = makeGame();
    expect(g.continuousEffects).toEqual([]);
  });

  it("continuousEffects round-trip: pre-seeded effects survive snapshot+restore", () => {
    const g = makeGame();
    // WHY: SP2 Milestone H promoted ContinuousEffect from an opaque
    // placeholder to the {layer: Layer enum, duration, payload} shape the
    // ContinuousEffectRegistry produces. Seed two representative effects
    // (untilEndOfTurn PT modifier + permanent type-add) to prove the
    // ledger still round-trips losslessly through JSON.
    g.continuousEffects.push({
      id: mkEntityId(500),
      sourceCardId: mkEntityId(501),
      layer: Layer.L7c_PTModify,
      timestamp: 1,
      duration: { kind: "untilEndOfTurn" },
      payload: { kind: "pt-modify", effect: { power: 2, toughness: 2 } },
    });
    g.continuousEffects.push({
      id: mkEntityId(502),
      sourceCardId: mkEntityId(503),
      layer: Layer.L4_Type,
      timestamp: 2,
      duration: { kind: "permanent" },
      payload: { kind: "type-add", types: ["Creature"] },
    });
    const snap = snapshot(g);
    const restored = restore(JSON.parse(JSON.stringify(snap)) as typeof snap, makeRestoreOpts());
    expect(restored.continuousEffects).toHaveLength(2);
    expect(restored.continuousEffects[0]?.layer).toBe(Layer.L7c_PTModify);
    expect(restored.continuousEffects[0]?.duration.kind).toBe("untilEndOfTurn");
    expect(restored.continuousEffects[1]?.layer).toBe(Layer.L4_Type);
    expect(restored.continuousEffects[1]?.duration.kind).toBe("permanent");
    expect(restored.continuousEffects[1]?.payload).toEqual({
      kind: "type-add",
      types: ["Creature"],
    });
  });

  it("header captures engine/card-data/rules provenance from GameMeta + GameRules", () => {
    const g = makeGame();
    const snap = snapshot(g);
    expect(snap.header.engineVersion).toBe(meta.engineVersion);
    expect(snap.header.forgeSha).toBe(meta.forgeSha);
    expect(snap.header.cardDataSyncedAt).toBe(meta.cardDataSyncedAt);
    expect(snap.header.crVersion).toBe(meta.crVersion);
    expect(snap.header.seed).toBe(meta.seed);
    expect(snap.header.formatId).toBe(rules.formatId);
    expect(snap.header.formatDefinitionSnapshot).toBeNull();
    // savedAt is an ISO-8601 string.
    expect(() => new Date(snap.header.savedAt).toISOString()).not.toThrow();
  });

  it("snapshot output is JSON-stringifiable (no bigints, no Maps, no Sets)", () => {
    const g = makeGame();
    seedCard(g, paperA, 0, ZoneType.Battlefield);
    seedCard(g, paperB, 1, ZoneType.Hand);
    const snap = snapshot(g);
    expect(() => JSON.stringify(snap)).not.toThrow();
  });

  it("round-trip through JSON produces an equivalent snapshot", () => {
    const g = makeGame();
    seedCard(g, paperA, 0, ZoneType.Battlefield);
    seedCard(g, paperB, 1, ZoneType.Hand);
    const snap = snapshot(g);
    const s = JSON.stringify(snap);
    const parsed = JSON.parse(s) as typeof snap;
    const restored = restore(parsed, makeRestoreOpts());
    const snap2 = snapshot(restored);
    // Header savedAt will differ across calls; compare state only.
    expect(snap2.state).toEqual(snap.state);
    // And the restored header carries identical provenance minus savedAt.
    expect(snap2.header.schemaVersion).toBe(snap.header.schemaVersion);
    expect(snap2.header.engineVersion).toBe(snap.header.engineVersion);
    expect(snap2.header.seed).toBe(snap.header.seed);
    expect(snap2.header.formatId).toBe(snap.header.formatId);
  });

  it("mutation on the original game does not leak into the restored snapshot", () => {
    const g = makeGame();
    const card = seedCard(g, paperA, 0, ZoneType.Battlefield);
    const snap = snapshot(g);
    // Mutate original after snapshotting.
    card.tapped = true;
    card.damage = 7;
    g.turn = 99;
    const restored = restore(JSON.parse(JSON.stringify(snap)) as typeof snap, makeRestoreOpts());
    const rc = restored.cards.get(card.id);
    expect(rc?.tapped).toBe(false);
    expect(rc?.damage).toBe(0);
    expect(restored.turn).toBe(1);
  });

  it("restores turn / phase / activePlayer / priorityPlayer verbatim", () => {
    const g = makeGame();
    g.turn = 7;
    g.phase = PhaseStep.DeclareAttackers;
    g.activePlayer = mkPlayerSeat(1);
    g.priorityPlayer = mkPlayerSeat(0);
    const snap = snapshot(g);
    const restored = restore(JSON.parse(JSON.stringify(snap)) as typeof snap, makeRestoreOpts());
    expect(restored.turn).toBe(7);
    expect(restored.phase).toBe(PhaseStep.DeclareAttackers);
    expect(restored.activePlayer).toBe(mkPlayerSeat(1));
    expect(restored.priorityPlayer).toBe(mkPlayerSeat(0));
  });

  it("GameFlags: dayNight / monarch / initiative / cityBlessing round-trip", () => {
    const g = makeGame();
    g.flags.dayNight = "day";
    g.flags.monarch = mkPlayerSeat(0);
    g.flags.initiative = mkPlayerSeat(1);
    g.flags.cityBlessing.add(mkPlayerSeat(0));
    const snap = snapshot(g);
    const restored = restore(JSON.parse(JSON.stringify(snap)) as typeof snap, makeRestoreOpts());
    expect(restored.flags.dayNight).toBe("day");
    expect(restored.flags.monarch).toBe(mkPlayerSeat(0));
    expect(restored.flags.initiative).toBe(mkPlayerSeat(1));
    expect(restored.flags.cityBlessing.has(mkPlayerSeat(0))).toBe(true);
    expect(restored.flags.cityBlessing.size).toBe(1);
  });

  it("GameFlags: Map-typed fields (ringLevel, commanderDamage) round-trip", () => {
    const g = makeGame();
    g.flags.ringLevel.set(mkPlayerSeat(0), 3);
    g.flags.ringLevel.set(mkPlayerSeat(1), 1);
    g.flags.speedLevel.set(mkPlayerSeat(0), 2);
    const commanderId = mkEntityId(42);
    const innerMap = new Map<ReturnType<typeof mkPlayerSeat>, number>();
    innerMap.set(mkPlayerSeat(0), 5);
    innerMap.set(mkPlayerSeat(1), 9);
    g.flags.commanderDamage.set(commanderId, innerMap);
    g.flags.landsPlayedThisTurn.set(mkPlayerSeat(0), 2);
    g.flags.turnsTakenThisTurn = 3;
    g.flags.skippedPhases = [PhaseStep.Draw, PhaseStep.Cleanup];
    g.flags.seatEliminated.set(mkPlayerSeat(1), true);

    const snap = snapshot(g);
    const restored = restore(JSON.parse(JSON.stringify(snap)) as typeof snap, makeRestoreOpts());
    expect(restored.flags.ringLevel.get(mkPlayerSeat(0))).toBe(3);
    expect(restored.flags.ringLevel.get(mkPlayerSeat(1))).toBe(1);
    expect(restored.flags.speedLevel.get(mkPlayerSeat(0))).toBe(2);
    expect(restored.flags.commanderDamage.get(commanderId)?.get(mkPlayerSeat(0))).toBe(5);
    expect(restored.flags.commanderDamage.get(commanderId)?.get(mkPlayerSeat(1))).toBe(9);
    expect(restored.flags.landsPlayedThisTurn.get(mkPlayerSeat(0))).toBe(2);
    expect(restored.flags.turnsTakenThisTurn).toBe(3);
    expect(restored.flags.skippedPhases).toEqual([PhaseStep.Draw, PhaseStep.Cleanup]);
    expect(restored.flags.seatEliminated.get(mkPlayerSeat(1))).toBe(true);
  });

  it("Stack items are preserved through snapshot + restore", () => {
    const g = makeGame();
    const itemId = mkEntityId(100);
    const sourceId = mkEntityId(50);
    const item: StackItem = {
      id: itemId,
      sourceCardId: sourceId,
      controllerSeat: mkPlayerSeat(0),
      kind: "spell",
      isCast: true,
      targets: null,
      modes: [],
      xValue: 3,
      costPaid: null,
      provenance: {
        originZone: ZoneType.Hand,
        altCostUsed: null,
        additionalCostsPaid: [],
      },
    };
    g.sharedZones.stack.push(item);
    const snap = snapshot(g);
    const restored = restore(JSON.parse(JSON.stringify(snap)) as typeof snap, makeRestoreOpts());
    expect(restored.sharedZones.stack.size).toBe(1);
    const top = restored.sharedZones.stack.top();
    expect(top?.id).toBe(itemId);
    expect(top?.sourceCardId).toBe(sourceId);
    expect(top?.xValue).toBe(3);
    expect(top?.provenance.originZone).toBe(ZoneType.Hand);
  });

  it("Card state (tapped, damage, counters, attachedTo, attachments) round-trips", () => {
    const g = makeGame();
    const c = seedCard(g, paperA, 0, ZoneType.Battlefield);
    c.tapped = true;
    c.phased = true;
    c.damage = 4;
    c.counters.set(CounterType.PlusOnePlusOne, 2);
    c.counters.set(CounterType.Loyalty, 5);
    c.attachedTo = mkEntityId(999);
    c.attachments = [mkEntityId(100), mkEntityId(101)];

    const snap = snapshot(g);
    const restored = restore(JSON.parse(JSON.stringify(snap)) as typeof snap, makeRestoreOpts());
    const rc = restored.cards.get(c.id);
    // WHY: narrow via throw rather than toBeDefined() so every downstream
    // field access is type-safe and the assertion failure surfaces the
    // missing-card case directly.
    if (!rc) throw new Error("test: expected restored card but got undefined");
    expect(rc.tapped).toBe(true);
    expect(rc.phased).toBe(true);
    expect(rc.damage).toBe(4);
    expect(rc.counters.get(CounterType.PlusOnePlusOne)).toBe(2);
    expect(rc.counters.get(CounterType.Loyalty)).toBe(5);
    expect(rc.attachedTo).toBe(mkEntityId(999));
    expect(rc.attachments).toEqual([mkEntityId(100), mkEntityId(101)]);
    expect(rc.paperCard).toBe(paperA);
  });

  it("Player life + counters + zone contents round-trip", () => {
    const g = makeGame();
    const p0 = g.players[0];
    if (!p0) throw new Error("p0 not constructed");
    p0.life = 13;
    p0.counters.set(CounterType.Poison, 2);
    const c = seedCard(g, paperA, 0, ZoneType.Hand);

    const snap = snapshot(g);
    const restored = restore(JSON.parse(JSON.stringify(snap)) as typeof snap, makeRestoreOpts());
    const rp0 = restored.players[0];
    expect(rp0?.life).toBe(13);
    expect(rp0?.counters.get(CounterType.Poison)).toBe(2);
    const hand = rp0?.zones.get(ZoneType.Hand);
    expect(hand?.toArray()).toEqual([c.id]);
  });

  it("RNG state survives restore — next nextLong() matches the original stream", () => {
    // Set up two parallel Games with the same seed; advance both to the same
    // point, then snapshot one and restore it. After restore, the restored
    // game's nextLong() sequence must match the reference game's continued
    // sequence.
    const reference = makeGame(42n);
    const toSnapshot = makeGame(42n);
    // Burn equal amounts of rng state on both.
    for (let i = 0; i < 10; i++) {
      reference.rng.nextLong();
      toSnapshot.rng.nextLong();
    }
    const snap = snapshot(toSnapshot);
    const restored = restore(JSON.parse(JSON.stringify(snap)) as typeof snap, {
      lobbyPlayers: [alice, bob],
      rng: new SeededRng(999n), // arbitrary — state will be overwritten
      paperCards,
      rules,
    });
    const refNext = reference.rng.nextLong();
    const restoredNext = restored.rng.nextLong();
    expect(restoredNext).toBe(refNext);
    // And the following draws also match.
    for (let i = 0; i < 5; i++) {
      expect(restored.rng.nextLong()).toBe(reference.rng.nextLong());
    }
  });

  it("entityIdCounter is restored: newEntityId after restore continues past existing ids", () => {
    const g = makeGame();
    const a = seedCard(g, paperA, 0, ZoneType.Battlefield);
    const b = seedCard(g, paperB, 0, ZoneType.Battlefield);
    const snap = snapshot(g);
    const restored = restore(JSON.parse(JSON.stringify(snap)) as typeof snap, makeRestoreOpts());
    const next = restored.newEntityId();
    const maxExisting = Math.max(a.id as unknown as number, b.id as unknown as number);
    expect(next as unknown as number).toBeGreaterThan(maxExisting);
  });

  it("Exile and Ante shared zones round-trip items", () => {
    const g = makeGame();
    const card = seedCard(g, paperA, 0, ZoneType.Exile);
    // seedCard added to p0.zones, not shared exile. Push to shared exile too.
    g.sharedZones.exile.add(card.id);
    g.sharedZones.ante.add(card.id);

    const snap = snapshot(g);
    const restored = restore(JSON.parse(JSON.stringify(snap)) as typeof snap, makeRestoreOpts());
    expect(restored.sharedZones.exile.toArray()).toEqual([card.id]);
    expect(restored.sharedZones.ante.toArray()).toEqual([card.id]);
  });

  it("teamId round-trips (team play with shared teams)", () => {
    const g = new Game({
      lobbyPlayers: [alice, bob],
      rules: { ...rules, teamAssignments: [0, 0] },
      meta,
      rng: new SeededRng(1n),
    });
    const snap = snapshot(g);
    const restored = restore(JSON.parse(JSON.stringify(snap)) as typeof snap, {
      lobbyPlayers: [alice, bob],
      rng: new SeededRng(1n),
      paperCards,
      rules: { ...rules, teamAssignments: [0, 0] },
    });
    expect(restored.players[0]?.teamId).toBe(0);
    expect(restored.players[1]?.teamId).toBe(0);
  });

  it("restore throws IncompatibleSnapshotVersionError on schemaVersion mismatch", () => {
    const g = makeGame();
    const snap = snapshot(g);
    const bad = { ...snap, header: { ...snap.header, schemaVersion: 999 } };
    expect(() => restore(bad, makeRestoreOpts())).toThrow(IncompatibleSnapshotVersionError);
    expect(() => restore(bad, makeRestoreOpts())).toThrow(/schema version/);
  });

  it("restore throws SnapshotRestoreError on missing LobbyPlayer id", () => {
    const g = makeGame();
    const snap = snapshot(g);
    expect(() =>
      restore(snap, {
        lobbyPlayers: [alice], // bob missing
        rng: new SeededRng(1n),
        paperCards,
        rules,
      }),
    ).toThrow(SnapshotRestoreError);
    expect(() =>
      restore(snap, {
        lobbyPlayers: [alice],
        rng: new SeededRng(1n),
        paperCards,
        rules,
      }),
    ).toThrow(/missing LobbyPlayer/);
  });

  it("restore throws UnknownCardError on missing PaperCard key", () => {
    const g = makeGame();
    seedCard(g, paperA, 0, ZoneType.Battlefield);
    const snap = snapshot(g);
    expect(() =>
      restore(snap, {
        lobbyPlayers: [alice, bob],
        rng: new SeededRng(1n),
        paperCards: new Map(), // empty
        rules,
      }),
    ).toThrow(UnknownCardError);
  });

  it("terminalState round-trips", () => {
    const g = makeGame();
    const terminal = {
      endedAt: { turn: 9, phase: g.phase },
      outcome: { kind: "win" as const, winner: mkPlayerSeat(0), reason: "victory" },
      concededSeats: [] as PlayerSeat[],
    };
    g.terminalState = terminal;
    const snap = snapshot(g);
    const restored = restore(JSON.parse(JSON.stringify(snap)) as typeof snap, makeRestoreOpts());
    expect(restored.terminalState).toEqual(terminal);
    expect(restored.isTerminal()).toBe(true);
  });

  it("restore throws SnapshotRestoreError on player seat mismatch with constructed seat", () => {
    // WHY: Game's constructor assigns seat by index (0, 1, …). If a snapshot
    // blob was hand-edited — or produced by a future engine that permitted
    // sparse seat numbering — the seat-equality assertion at restore is the
    // defense line. Force the mismatch by rewriting the serialized player
    // seat to an unexpected value.
    const g = makeGame();
    const snap = snapshot(g);
    const bad = {
      ...snap,
      state: {
        ...snap.state,
        players: [
          // Seat 0 rewritten to 7 — constructed seat is still 0.
          { ...snap.state.players[0], seat: mkPlayerSeat(7) },
          snap.state.players[1],
        ] as typeof snap.state.players,
      },
    };
    expect(() => restore(bad as typeof snap, makeRestoreOpts())).toThrow(SnapshotRestoreError);
    expect(() => restore(bad as typeof snap, makeRestoreOpts())).toThrow(
      /player\[0\] seat 7 !== constructed seat 0/,
    );
  });

  it("deep round-trip: stringify → parse → restore → snapshot equals original snapshot state", () => {
    const g = makeGame();
    g.turn = 5;
    g.phase = PhaseStep.Main2;
    g.activePlayer = mkPlayerSeat(1);
    g.priorityPlayer = mkPlayerSeat(1);
    const cardA = seedCard(g, paperA, 0, ZoneType.Battlefield);
    cardA.tapped = true;
    cardA.counters.set(CounterType.PlusOnePlusOne, 1);
    seedCard(g, paperB, 1, ZoneType.Hand);
    g.flags.dayNight = "night";
    g.flags.monarch = mkPlayerSeat(1);
    g.flags.ringLevel.set(mkPlayerSeat(0), 2);
    // Burn rng state to move past the initial position.
    g.rng.nextLong();
    g.rng.nextLong();

    const snap1 = snapshot(g);
    const roundTripped = JSON.parse(JSON.stringify(snap1)) as typeof snap1;
    const restored = restore(roundTripped, makeRestoreOpts());
    const snap2 = snapshot(restored);
    // state must be exactly equal; header.savedAt is allowed to differ.
    expect(snap2.state).toEqual(snap1.state);
  });
});

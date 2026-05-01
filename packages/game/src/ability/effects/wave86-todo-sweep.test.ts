// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 86 — Effect handler TODO sweep round 7.
//
// Closes inline TODO(advanced) tails on six effect handlers:
//   * put-counter:UpTo$ — out-of-range chooseNumber responses now stamp a
//     `chooseNumber-out-of-range` record on `game.decisionWarnings`. The
//     engine still falls back to the full N (legacy MVP behaviour); the
//     warning is purely advisory so test paths and the eventual UI can
//     introspect the rejection.
//   * wave-22:DayTime — manual SP$ DayTime transitions now autoFlip
//     daybound/nightbound permanents. Mirrors the upkeep-tracker behavior
//     in day-night-tracker.tryUpkeepTransition; the layer engine epoch is
//     bumped so the new face is observed on the next computeCharacteristics.
//   * wave-22:UnlockDoor — fully-unlocked detection. Tracks the unlocked-
//     doors set against the printed-doors list (defaults to ["front",
//     "back"] for the canonical two-door room shape); when every printed
//     door is open the card.fullyUnlocked flag stamps and a
//     `RoomEntered { fullyUnlocked: true }` event fires for the Wave 70
//     trigger family. Single-door cards fully-unlock on the lone door.
//   * wave-22:ReorderZone — invalid orderCards permutations now stamp a
//     `orderCards-invalid-permutation` record on game.decisionWarnings.
//     The engine still falls back to the original prefix order.
//   * wave-21:AssignGroup — Group$ <label> param now lands targets on
//     `source.groupedRemembered.get(label)` AND continues to append to
//     `source.remembered` for back-compat.
//   * wave-18:RearrangeTopOfLibrary — yields the canonical orderCards
//     decision and applies the response permutation against the library
//     top N. Mirrors ReorderZone's validation pipeline.
import "./index.js";
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Exile } from "../../zone/zones/exile.js";
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
  cardDataSyncedAt: "2026-04-26T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};
const plainPaper: PaperCard = {
  name: "Test",
  edition: "TST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const p of game.players) {
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
    p.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p.seat));
    p.zones.set(ZoneType.Library, new Library(ZoneType.Library, p.seat));
    p.zones.set(ZoneType.Exile, new Exile(ZoneType.Exile, p.seat));
  }
  return game;
};

const drainGen = (gen: Generator<unknown, void, unknown>): unknown[] => {
  const out: unknown[] = [];
  let r = gen.next();
  while (!r.done) {
    out.push(r.value);
    r = gen.next();
  }
  return out;
};

const mkSa = (
  handlerKey: string,
  params: Record<string, { kind: string; raw: string }>,
  sourceId = mkEntityId(10),
  controllerSeat = mkPlayerSeat(0),
  targets: ReturnType<typeof mkEntityId>[] = [],
) =>
  new SpellAbility(
    {
      kind: "spell",
      effect: { handlerKey, params: params as never },
      cost: { raw: "" },
    },
    sourceId,
    controllerSeat,
    new Map(),
    targets,
  );

const seedSourceCard = (game: Game, sourceId = mkEntityId(10)): Card => {
  const seat0 = mkPlayerSeat(0);
  const c = new Card(sourceId, plainPaper, seat0, seat0, ZoneType.Battlefield);
  game.cards.set(sourceId, c);
  const bf = game.getPlayer(seat0).zones.get(ZoneType.Battlefield);
  bf?.add(sourceId);
  return c;
};

// ---------------------------------------------------------------------------
// (1) PutCounter UpTo$ — out-of-range chooseNumber stamps decisionWarnings
// ---------------------------------------------------------------------------

describe("Wave 86 — PutCounter UpTo$ out-of-range warning", () => {
  it("stamps a decisionWarnings record when chooseNumber returns a value above N", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(5000);
    seedSourceCard(game, sourceId);
    const targetId = mkEntityId(5001);
    const t = new Card(targetId, plainPaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(targetId, t);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(targetId);
    const sa = mkSa(
      "PutCounter",
      {
        CounterType: { kind: "literal", raw: "P1P1" },
        CounterNum: { kind: "literal", raw: "3" },
        UpTo: { kind: "literal", raw: "True" },
      },
      sourceId,
      seat0,
      [targetId],
    );
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    // First yield is the chooseNumber decision request; respond with 99 (out-of-range).
    const first = gen.next();
    expect(first.done).toBe(false);
    const yielded = first.value as { kind: string; request?: { kind: string } };
    expect(yielded.kind).toBe("decision");
    expect(yielded.request?.kind).toBe("chooseNumber");
    let r = gen.next({ kind: "chooseNumber", chosen: 99 });
    while (!r.done) r = gen.next();
    const warn = game.decisionWarnings.find((w) => w.kind === "chooseNumber-out-of-range");
    expect(warn).toBeDefined();
    expect(warn?.sourceId).toBe(sourceId);
  });

  it("does NOT stamp a warning when chooseNumber returns a valid in-range value", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(5010);
    seedSourceCard(game, sourceId);
    const targetId = mkEntityId(5011);
    const t = new Card(targetId, plainPaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(targetId, t);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(targetId);
    const sa = mkSa(
      "PutCounter",
      {
        CounterType: { kind: "literal", raw: "P1P1" },
        CounterNum: { kind: "literal", raw: "3" },
        UpTo: { kind: "literal", raw: "True" },
      },
      sourceId,
      seat0,
      [targetId],
    );
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    gen.next();
    let r = gen.next({ kind: "chooseNumber", chosen: 2 });
    while (!r.done) r = gen.next();
    const warn = game.decisionWarnings.find((w) => w.kind === "chooseNumber-out-of-range");
    expect(warn).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// (2) DayTime — autoFlip daybound/nightbound permanents on manual transition
// ---------------------------------------------------------------------------

describe("Wave 86 — DayTime: autoFlips daybound/nightbound permanents", () => {
  it("manual day → night flips daybound permanents to back face", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(5100);
    seedSourceCard(game, sourceId);
    // Seed dayNight to "day" so the manual transition is day → night.
    game.flags.dayNight = "day";
    const dayboundId = mkEntityId(5101);
    const dayboundCard = new Card(dayboundId, plainPaper, seat0, seat0, ZoneType.Battlefield);
    dayboundCard.keywords = new Set(["daybound"]);
    game.cards.set(dayboundId, dayboundCard);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(dayboundId);
    expect(dayboundCard.face).toBe("default");
    const sa = mkSa("DayTime", { Value: { kind: "literal", raw: "night" } }, sourceId, seat0);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(game.flags.dayNight).toBe("night");
    expect(dayboundCard.face).toBe("back");
  });

  it("manual night → day flips nightbound permanents to back face", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(5110);
    seedSourceCard(game, sourceId);
    game.flags.dayNight = "night";
    const nightboundId = mkEntityId(5111);
    const nightboundCard = new Card(nightboundId, plainPaper, seat0, seat0, ZoneType.Battlefield);
    nightboundCard.keywords = new Set(["nightbound"]);
    game.cards.set(nightboundId, nightboundCard);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(nightboundId);
    const sa = mkSa("DayTime", { Value: { kind: "literal", raw: "day" } }, sourceId, seat0);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(game.flags.dayNight).toBe("day");
    expect(nightboundCard.face).toBe("back");
  });
});

// ---------------------------------------------------------------------------
// (3) UnlockDoor — fully-unlocked detection emits RoomEntered
// ---------------------------------------------------------------------------

describe("Wave 86 — UnlockDoor: full-unlock detection emits RoomEntered", () => {
  it("emits RoomEntered { fullyUnlocked: true } when both default doors are open", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(5200);
    seedSourceCard(game, sourceId);
    const roomId = mkEntityId(5201);
    const roomCard = new Card(roomId, plainPaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(roomId, roomCard);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(roomId);
    // Open the front door first.
    const sa1 = mkSa("UnlockDoor", { Door: { kind: "literal", raw: "front" } }, sourceId, seat0, [roomId]);
    const yields1 = drainGen(sa1.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect((roomCard as { fullyUnlocked?: boolean }).fullyUnlocked).toBeUndefined();
    const partial = yields1.find(
      (y): y is { kind: "event"; event: { kind: string; payload: { fullyUnlocked: boolean } } } =>
        typeof y === "object" &&
        y !== null &&
        (y as { kind?: string }).kind === "event" &&
        (y as { event?: { kind?: string } }).event?.kind === "RoomEntered",
    );
    expect(partial?.event.payload.fullyUnlocked).toBe(false);
    // Now open the back door — should fully-unlock.
    const sa2 = mkSa("UnlockDoor", { Door: { kind: "literal", raw: "back" } }, sourceId, seat0, [roomId]);
    const yields2 = drainGen(sa2.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect((roomCard as { fullyUnlocked?: boolean }).fullyUnlocked).toBe(true);
    const fullPulse = yields2.find(
      (y): y is { kind: "event"; event: { kind: string; payload: { fullyUnlocked: boolean } } } =>
        typeof y === "object" &&
        y !== null &&
        (y as { kind?: string }).kind === "event" &&
        (y as { event?: { kind?: string } }).event?.kind === "RoomEntered",
    );
    expect(fullPulse?.event.payload.fullyUnlocked).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (4) ReorderZone — invalid permutation stamps decisionWarnings
// ---------------------------------------------------------------------------

describe("Wave 86 — ReorderZone: invalid permutation warning", () => {
  it("stamps an orderCards-invalid-permutation warning when the response is not a bijection", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(5300);
    seedSourceCard(game, sourceId);
    const lib = game.getPlayer(seat0).zones.get(ZoneType.Library);
    if (!lib) throw new Error("no library");
    const ids: ReturnType<typeof mkEntityId>[] = [];
    for (let i = 0; i < 3; i++) {
      const id = mkEntityId(5310 + i);
      const c = new Card(id, plainPaper, seat0, seat0, ZoneType.Library);
      game.cards.set(id, c);
      lib.add(id);
      ids.push(id);
    }
    const sa = mkSa(
      "ReorderZone",
      {
        Zone: { kind: "literal", raw: "Library" },
        Number: { kind: "literal", raw: "3" },
      },
      sourceId,
      seat0,
    );
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    let r = gen.next();
    // Consume the CardsRevealed event yield, then catch the orderCards request.
    while (
      !r.done &&
      !(
        typeof r.value === "object" &&
        r.value !== null &&
        (r.value as { request?: { kind?: string } }).request?.kind === "orderCards"
      )
    ) {
      r = gen.next();
    }
    expect(r.done).toBe(false);
    // Respond with a bogus permutation (wrong length).
    const bogus = ids.slice(0, 2);
    r = gen.next({ kind: "orderCards", ordered: bogus });
    while (!r.done) r = gen.next();
    const warn = game.decisionWarnings.find((w) => w.kind === "orderCards-invalid-permutation");
    expect(warn).toBeDefined();
    expect(warn?.sourceId).toBe(sourceId);
  });
});

// ---------------------------------------------------------------------------
// (5) AssignGroup — Group$ label routes targets to per-group remembered slot
// ---------------------------------------------------------------------------

describe("Wave 86 — AssignGroup: Group$ label routes to groupedRemembered", () => {
  it("Group$ A and Group$ B land on per-label slots and back-compat remembered", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(5400);
    const source = seedSourceCard(game, sourceId);
    const tA = mkEntityId(5401);
    const tB = mkEntityId(5402);
    const tC = mkEntityId(5403);
    // Group A receives [tA, tB], Group B receives [tC].
    const saA = mkSa("AssignGroup", { Group: { kind: "literal", raw: "A" } }, sourceId, seat0, [tA, tB]);
    drainGen(saA.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const saB = mkSa("AssignGroup", { Group: { kind: "literal", raw: "B" } }, sourceId, seat0, [tC]);
    drainGen(saB.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const sourceWithGroups = source as { groupedRemembered?: Map<string, ReturnType<typeof mkEntityId>[]> };
    const groups = sourceWithGroups.groupedRemembered;
    expect(groups).toBeDefined();
    expect(groups?.get("A")).toEqual([tA, tB]);
    expect(groups?.get("B")).toEqual([tC]);
    // Back-compat: flat remembered list still has all three.
    expect(source.remembered).toContain(tA);
    expect(source.remembered).toContain(tB);
    expect(source.remembered).toContain(tC);
  });
});

// ---------------------------------------------------------------------------
// (6) RearrangeTopOfLibrary — yields orderCards and applies the response
// ---------------------------------------------------------------------------

describe("Wave 86 — RearrangeTopOfLibrary: orderCards reorders top N", () => {
  it("yields orderCards and applies the reverse permutation against the library top", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(5500);
    seedSourceCard(game, sourceId);
    const lib = game.getPlayer(seat0).zones.get(ZoneType.Library);
    if (!lib) throw new Error("no library");
    const ids: ReturnType<typeof mkEntityId>[] = [];
    for (let i = 0; i < 4; i++) {
      const id = mkEntityId(5510 + i);
      const c = new Card(id, plainPaper, seat0, seat0, ZoneType.Library);
      game.cards.set(id, c);
      lib.add(id);
      ids.push(id);
    }
    const topBefore = lib.toArray();
    const sa = mkSa("RearrangeTopOfLibrary", { NumCards: { kind: "literal", raw: "3" } }, sourceId, seat0);
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    const firstYield = gen.next();
    expect(firstYield.done).toBe(false);
    const yielded = firstYield.value as {
      kind: string;
      request?: { kind: string; cards: readonly ReturnType<typeof mkEntityId>[] };
    };
    expect(yielded.kind).toBe("decision");
    expect(yielded.request?.kind).toBe("orderCards");
    if (!yielded.request) throw new Error("expected request");
    const prefix = yielded.request.cards;
    expect(prefix.length).toBe(3);
    // Reverse the prefix.
    const reversed = [...prefix].reverse();
    let r = gen.next({ kind: "orderCards", ordered: reversed });
    while (!r.done) r = gen.next();
    const topAfter = lib.toArray();
    // Top 3 should now be the reversed prefix; the 4th card stays put.
    expect(topAfter[0]).toBe(reversed[0]);
    expect(topAfter[1]).toBe(reversed[1]);
    expect(topAfter[2]).toBe(reversed[2]);
    expect(topAfter[3]).toBe(topBefore[3]);
  });

  it("invalid permutation falls back to identity and stamps a warning", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(5520);
    seedSourceCard(game, sourceId);
    const lib = game.getPlayer(seat0).zones.get(ZoneType.Library);
    if (!lib) throw new Error("no library");
    for (let i = 0; i < 3; i++) {
      const id = mkEntityId(5530 + i);
      const c = new Card(id, plainPaper, seat0, seat0, ZoneType.Library);
      game.cards.set(id, c);
      lib.add(id);
    }
    const topBefore = lib.toArray();
    const sa = mkSa("RearrangeTopOfLibrary", { NumCards: { kind: "literal", raw: "3" } }, sourceId, seat0);
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    gen.next();
    // Bogus response: wrong length.
    let r = gen.next({ kind: "orderCards", ordered: topBefore.slice(0, 1) });
    while (!r.done) r = gen.next();
    expect(lib.toArray()).toEqual(topBefore);
    const warn = game.decisionWarnings.find((w) => w.kind === "orderCards-invalid-permutation");
    expect(warn).toBeDefined();
  });
});

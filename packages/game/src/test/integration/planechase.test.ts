// SPDX-License-Identifier: GPL-3.0-or-later
// M7.13b — Planechase variant integration test (CR 901). Verifies the
// setupGame `planechase` SetupOptions field:
//   1. populates each seat's PlanarDeck zone with the named EntityIds in
//      the order given (top-of-deck first);
//   2. places the FIRST entry's `activePlane` face-up in seat 0's
//      Command zone (shared-active-plane convention) and rewrites the
//      Card.zone pointer accordingly;
//   3. activates the active plane's printed continuous statics so the
//      static-effect registry sees them as soon as setup completes
//      (mirrors the Vanguard / Conspiracy zone-activation hand-off);
//   4. exposes a deterministic `game.planar.rollDie()` API that returns
//      one of "chaos" | "planeswalker" | "blank" off the seeded RNG.
import type {
  DecisionResponse,
  EntityId,
  LobbyPlayer,
  PaperCard,
  PlayerSeat,
  StaticAbility,
} from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { type SetupDecks, setupGame } from "../../setup/setup-flow.js";

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

const filler: PaperCard = {
  name: "Forest",
  edition: "LEA",
  collectorNumber: "294",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const planePaper = (name: string): PaperCard => ({
  name,
  edition: "HOP",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
});

const mkGame = (seed = 1n): Game =>
  new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(seed),
  });

const seedLibrary = (game: Game, seat: PlayerSeat, count: number, startId: number): EntityId[] => {
  const ids: EntityId[] = [];
  for (let i = 0; i < count; i++) {
    const id = mkEntityId(startId + i);
    game.cards.set(id, new Card(id, filler, seat, seat, ZoneType.Library));
    ids.push(id);
  }
  return ids;
};

const drive = (
  game: Game,
  decks: SetupDecks,
  planechase: { seat: PlayerSeat; planarDeck: readonly EntityId[]; activePlane: EntityId }[],
): void => {
  const gen = setupGame(game, { decks, planechase });
  let step = gen.next();
  while (!step.done) {
    const y = step.value;
    if (y.kind === "event") {
      step = gen.next();
      continue;
    }
    if (y.request.kind === "mulligan") {
      const resp: DecisionResponse = { kind: "mulligan", keep: true };
      step = gen.next(resp);
    } else if (y.request.kind === "mulliganBottom") {
      const resp: DecisionResponse = {
        kind: "mulliganBottom",
        bottomed: y.request.hand.slice(0, y.request.countToBottom),
      };
      step = gen.next(resp);
    } else if (y.request.kind === "companionDeclaration") {
      const resp: DecisionResponse = { kind: "companionDeclaration", companionId: null };
      step = gen.next(resp);
    } else if (y.request.kind === "openingHandAction") {
      const resp: DecisionResponse = { kind: "openingHandAction", chosenActions: [] };
      step = gen.next(resp);
    } else {
      throw new Error(`drive: unexpected decision kind ${y.request.kind}`);
    }
  }
};

describe("M7.13b — Planechase variant (CR 901)", () => {
  it("seats the active plane in seat 0's Command zone and the planar deck in seat 0's PlanarDeck zone", () => {
    const game = mkGame(1n);
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    seedLibrary(game, seat0, 30, 0);
    seedLibrary(game, seat1, 30, 100);

    // Mint a planar deck (active plane + 4 reserve planes) in game.cards.
    // The active plane card receives its own EntityId disjoint from the
    // reserve list — CR 901 keeps the active plane and the planar deck
    // strictly disjoint.
    const activePlaneId = mkEntityId(900);
    const reserveIds: EntityId[] = [];
    game.cards.set(
      activePlaneId,
      new Card(activePlaneId, planePaper("Academy at Tolaria West"), seat0, seat0, ZoneType.None),
    );
    for (let i = 0; i < 4; i++) {
      const id = mkEntityId(901 + i);
      reserveIds.push(id);
      game.cards.set(id, new Card(id, planePaper(`Reserve Plane ${i}`), seat0, seat0, ZoneType.None));
    }

    const decks: SetupDecks = {
      0: Array.from({ length: 30 }, (_, i) => mkEntityId(i)),
      1: Array.from({ length: 30 }, (_, i) => mkEntityId(100 + i)),
    };
    drive(game, decks, [{ seat: seat0, planarDeck: reserveIds, activePlane: activePlaneId }]);

    // Active plane lives in seat 0's Command zone (shared convention).
    const cmd0 = game.players[0]?.zones.get(ZoneType.Command);
    expect(cmd0?.toArray()).toContain(activePlaneId);
    expect(game.cards.get(activePlaneId)?.zone).toBe(ZoneType.Command);

    // Reserve planes live in seat 0's PlanarDeck zone, in caller order.
    const pd0 = game.players[0]?.zones.get(ZoneType.PlanarDeck);
    expect(pd0?.toArray()).toEqual(reserveIds);
    for (const id of reserveIds) {
      expect(game.cards.get(id)?.zone).toBe(ZoneType.PlanarDeck);
    }

    // Active plane MUST NOT have leaked into the planar deck.
    expect(pd0?.toArray()).not.toContain(activePlaneId);

    // Seat 1's PlanarDeck stays empty (only seat 0 brought a planar deck).
    const pd1 = game.players[1]?.zones.get(ZoneType.PlanarDeck);
    expect(pd1?.size).toBe(0);

    // Active plane MUST NOT have leaked into either library.
    expect(game.players[0]?.zones.get(ZoneType.Library)?.toArray()).not.toContain(activePlaneId);
    expect(game.players[1]?.zones.get(ZoneType.Library)?.toArray()).not.toContain(activePlaneId);
  });

  it("active plane's continuous static registers with staticEffectRegistry as soon as setup seats it", () => {
    const game = mkGame(1n);
    const seat0 = mkPlayerSeat(0);
    seedLibrary(game, seat0, 30, 0);
    seedLibrary(game, mkPlayerSeat(1), 30, 100);

    // Build a synthetic Plane with one intrinsic Continuous static gated
    // on activeInZones={Command}. This mirrors Forge's plane-card text
    // shape "S:Mode$ Continuous | EffectZone$ Command | Affected$
    // Creature | AddPower$ 1" — i.e. "creatures get +1/+0".
    const planeId = mkEntityId(900);
    const staticId = mkEntityId(901);
    const plane = new Card(planeId, planePaper("Synthetic Power-Plane"), seat0, seat0, ZoneType.None);
    const intrinsic: StaticAbility = {
      id: staticId,
      kind: "static",
      sourceCardId: planeId,
      activeInZones: new Set([ZoneType.Command]),
      timestamp: 1,
      controllerSeatAtReg: seat0,
      category: "cantMustMay",
      mode: "Continuous",
      describe: () => null,
    };
    plane.intrinsicStatics = [intrinsic];
    game.cards.set(planeId, plane);

    // Pre-setup: nothing registered.
    expect(game.staticEffectRegistry.size()).toBe(0);

    const decks: SetupDecks = {
      0: Array.from({ length: 30 }, (_, i) => mkEntityId(i)),
      1: Array.from({ length: 30 }, (_, i) => mkEntityId(100 + i)),
    };
    drive(game, decks, [{ seat: seat0, planarDeck: [], activePlane: planeId }]);

    // Post-setup: the active plane's continuous static is registered with
    // the static-effect registry — the layer engine and SBA collectors
    // will now observe its effect on every characteristic sweep.
    expect(game.staticEffectRegistry.size()).toBe(1);
    expect(game.staticEffectRegistry.get(staticId)).toBe(intrinsic);

    // Physical placement still correct.
    expect(plane.zone).toBe(ZoneType.Command);
    expect(game.players[0]?.zones.get(ZoneType.Command)?.toArray()).toContain(planeId);
  });

  it("game.planar.rollDie returns one of 'chaos' | 'planeswalker' | 'blank' deterministically off the seeded RNG", () => {
    // With seed 1n and 6-face mapping (0=chaos, 1=planeswalker, 2..5=blank),
    // determinism is what matters — same seed across runs yields the same
    // sequence. We verify (a) every outcome is one of the legal three and
    // (b) two Games with the same seed yield the same first roll.
    const game = mkGame(1n);
    const game2 = mkGame(1n);

    const legal: ReadonlySet<string> = new Set(["chaos", "planeswalker", "blank"]);
    const rolls: string[] = [];
    for (let i = 0; i < 12; i++) {
      const r = game.planar.rollDie();
      expect(legal.has(r)).toBe(true);
      rolls.push(r);
    }

    // Determinism: a fresh Game with the same seed produces the same
    // first roll as game's first roll (rolls[0]).
    expect(game2.planar.rollDie()).toBe(rolls[0]);

    // Distribution sanity (light): in 12 rolls under seed=1n we expect at
    // least one non-blank face given a 1/3 hit rate for chaos+planeswalker.
    // This is a smoke check against accidentally hard-coding "blank".
    expect(rolls.some((r) => r !== "blank")).toBe(true);
  });

  it("seat with no planechase entry gets an empty PlanarDeck zone (no spurious side-effects)", () => {
    const game = mkGame(1n);
    const seat0 = mkPlayerSeat(0);
    seedLibrary(game, seat0, 30, 0);
    seedLibrary(game, mkPlayerSeat(1), 30, 100);

    const decks: SetupDecks = {
      0: Array.from({ length: 30 }, (_, i) => mkEntityId(i)),
      1: Array.from({ length: 30 }, (_, i) => mkEntityId(100 + i)),
    };
    // Note: no `planechase` entry — drive without the variant.
    const gen = setupGame(game, { decks });
    let step = gen.next();
    while (!step.done) {
      const y = step.value;
      if (y.kind === "event") {
        step = gen.next();
        continue;
      }
      if (y.request.kind === "mulligan") {
        step = gen.next({ kind: "mulligan", keep: true });
      } else if (y.request.kind === "mulliganBottom") {
        step = gen.next({
          kind: "mulliganBottom",
          bottomed: y.request.hand.slice(0, y.request.countToBottom),
        });
      } else if (y.request.kind === "companionDeclaration") {
        step = gen.next({ kind: "companionDeclaration", companionId: null });
      } else if (y.request.kind === "openingHandAction") {
        step = gen.next({ kind: "openingHandAction", chosenActions: [] });
      } else {
        throw new Error(`unexpected decision kind ${y.request.kind}`);
      }
    }

    // Both seats have an empty PlanarDeck zone (constructed by default
    // in createPlayerZones; never populated because no planechase opt).
    expect(game.players[0]?.zones.get(ZoneType.PlanarDeck)?.size).toBe(0);
    expect(game.players[1]?.zones.get(ZoneType.PlanarDeck)?.size).toBe(0);
    // Both Command zones are also empty (no active plane was declared).
    expect(game.players[0]?.zones.get(ZoneType.Command)?.size).toBe(0);
    expect(game.players[1]?.zones.get(ZoneType.Command)?.size).toBe(0);
  });
});

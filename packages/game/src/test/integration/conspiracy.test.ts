// SPDX-License-Identifier: GPL-3.0-or-later
// M7.13 — Conspiracy variant integration (CR 901). Verifies that
// Conspiracy cards can be seeded into the command zone via setupGame's
// `conspiracies` SetupOptions field, and that their intrinsic static +
// triggered abilities (with TriggerZones$ Command / EffectZone$ Command)
// register with the engine registries the moment setup places them.
//
// Two scenarios:
//   1. "Power Play" parity — the conspiracy's "you are the starting
//      player" effect is modeled by pre-setting game.startingPlayer to
//      the conspiracy's owning seat before setupGame; we verify the
//      starting-player die-roll respects the pre-set value AND the
//      conspiracy actually lands in that seat's command zone.
//   2. Worldknit-style continuous static — a Conspiracy with one
//      intrinsic StaticAbility whose activeInZones includes Command
//      registers with staticEffectRegistry as soon as setupGame seats it.
//      Drives the engine's zone-activation discipline through the new
//      None → Command transition the setup flow now emits.
import type {
  DecisionResponse,
  EntityId,
  GameEvent,
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

const conspiracyPaper = (name: string): PaperCard => ({
  name,
  edition: "CN2",
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

// Library cards for both seats — setupGame requires libraries be seeded.
const seedLibrary = (game: Game, seat: PlayerSeat, count: number, startId: number): EntityId[] => {
  const ids: EntityId[] = [];
  for (let i = 0; i < count; i++) {
    const id = mkEntityId(startId + i);
    game.cards.set(id, new Card(id, filler, seat, seat, ZoneType.Library));
    ids.push(id);
  }
  return ids;
};

interface DriveResult {
  readonly events: GameEvent[];
  readonly decisions: number;
}

// Drive the setup generator with default keep-first-hand answers so we can
// observe the post-setup state (zones populated, starting player resolved,
// statics registered).
const drive = (
  game: Game,
  decks: SetupDecks,
  conspiracies: { seat: PlayerSeat; cardId: EntityId }[],
): DriveResult => {
  const gen = setupGame(game, { decks, conspiracies });
  const events: GameEvent[] = [];
  let decisions = 0;
  let step = gen.next();
  while (!step.done) {
    const y = step.value;
    if (y.kind === "event") {
      events.push(y.event);
      step = gen.next();
      continue;
    }
    decisions++;
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
  return { events, decisions };
};

describe("M7.13 — Conspiracy variant (CR 901)", () => {
  it("Power-Play parity: a conspiracy seeded into seat 1's command zone with startingPlayer pre-set lands the right starting player + zone", () => {
    const game = mkGame(1n);
    // Power Play's printed effect ("you are the starting player") would, in
    // a real Forge run, fire before the die-roll and overwrite the result.
    // SP1 setupGame already lets the host pre-set game.startingPlayer to
    // skip the die-roll; the conspiracy hand-off for that pre-roll setting
    // is the spec slot SP6's variant orchestration will fill (analog to
    // commander's pre-game zone moves). We simulate that here by setting
    // startingPlayer = seat 1 (Bob) before calling setupGame and asserting
    // the conspiracy lands physically in seat 1's command zone alongside.
    const seatBob = mkPlayerSeat(1);
    game.startingPlayer = seatBob;

    // Library + Conspiracy entity ids. Conspiracy is NOT in the library
    // (CR 901 keeps it strictly outside the deck).
    seedLibrary(game, mkPlayerSeat(0), 30, 0);
    seedLibrary(game, seatBob, 30, 100);
    const powerPlayId = mkEntityId(900);
    game.cards.set(
      powerPlayId,
      new Card(powerPlayId, conspiracyPaper("Power Play"), seatBob, seatBob, ZoneType.None),
    );

    const decks: SetupDecks = {
      0: Array.from({ length: 30 }, (_, i) => mkEntityId(i)),
      1: Array.from({ length: 30 }, (_, i) => mkEntityId(100 + i)),
    };

    drive(game, decks, [{ seat: seatBob, cardId: powerPlayId }]);

    // Starting player respected.
    expect(game.startingPlayer).toBe(seatBob);
    expect(game.activePlayer).toBe(seatBob);

    // Conspiracy is in seat 1's command zone.
    const cmdBob = game.players[1]?.zones.get(ZoneType.Command);
    const cmdAlice = game.players[0]?.zones.get(ZoneType.Command);
    expect(cmdBob?.toArray()).toContain(powerPlayId);
    expect(cmdAlice?.toArray()).not.toContain(powerPlayId);

    // Card.zone pointer mirrors the physical placement (so SBA / zone
    // queries don't see a stale None or Library pointer).
    const card = game.cards.get(powerPlayId);
    expect(card?.zone).toBe(ZoneType.Command);

    // Conspiracy must NOT have leaked into either library.
    const libBob = game.players[1]?.zones.get(ZoneType.Library);
    const libAlice = game.players[0]?.zones.get(ZoneType.Library);
    expect(libBob?.toArray()).not.toContain(powerPlayId);
    expect(libAlice?.toArray()).not.toContain(powerPlayId);
  });

  it("Continuous static on a conspiracy registers with staticEffectRegistry as soon as setupGame seats it in command zone", () => {
    const game = mkGame(1n);
    const seatAlice = mkPlayerSeat(0);
    seedLibrary(game, seatAlice, 30, 0);
    seedLibrary(game, mkPlayerSeat(1), 30, 100);

    // Build a synthetic Conspiracy with one intrinsic Continuous static
    // gated on EffectZone$ Command (i.e. activeInZones = {Command}).
    // Bypass activate*FromDefinition by pre-seeding intrinsicStatics
    // directly — CardDb-driven activation is exercised by the per-card
    // wave tests; this integration test exercises the setup-flow zone-
    // activation hand-off. The static AST shape below mirrors what
    // staticHandlerRegistry would produce for a "Continuous + EffectZone$
    // Command + AddPower$ +1" line on a Worldknit-shaped conspiracy.
    const worldknitId = mkEntityId(900);
    const staticId = mkEntityId(901);
    const worldknit = new Card(
      worldknitId,
      conspiracyPaper("Synthetic Worldknit"),
      seatAlice,
      seatAlice,
      ZoneType.None,
    );
    const intrinsic: StaticAbility = {
      id: staticId,
      kind: "static",
      sourceCardId: worldknitId,
      activeInZones: new Set([ZoneType.Command]),
      timestamp: 1,
      controllerSeatAtReg: seatAlice,
      category: "cantMustMay",
      mode: "Continuous",
      describe: () => null,
    };
    worldknit.intrinsicStatics = [intrinsic];
    game.cards.set(worldknitId, worldknit);

    // Pre-setup: nothing registered.
    expect(game.staticEffectRegistry.size()).toBe(0);

    const decks: SetupDecks = {
      0: Array.from({ length: 30 }, (_, i) => mkEntityId(i)),
      1: Array.from({ length: 30 }, (_, i) => mkEntityId(100 + i)),
    };
    drive(game, decks, [{ seat: seatAlice, cardId: worldknitId }]);

    // Post-setup: the conspiracy's continuous static is registered with
    // the static-effect registry — the layer engine and SBA collectors
    // will now see it on every characteristic / state-based-action sweep.
    expect(game.staticEffectRegistry.size()).toBe(1);
    expect(game.staticEffectRegistry.get(staticId)).toBe(intrinsic);

    // Physical placement still correct.
    expect(worldknit.zone).toBe(ZoneType.Command);
    expect(game.players[0]?.zones.get(ZoneType.Command)?.toArray()).toContain(worldknitId);
  });

  it("seat with no conspiracies gets an empty command zone (no spurious side-effects)", () => {
    const game = mkGame(1n);
    seedLibrary(game, mkPlayerSeat(0), 30, 0);
    seedLibrary(game, mkPlayerSeat(1), 30, 100);
    // One conspiracy on seat 0; seat 1's command zone must stay empty.
    const cId = mkEntityId(900);
    game.cards.set(cId, new Card(cId, conspiracyPaper("X"), mkPlayerSeat(0), mkPlayerSeat(0), ZoneType.None));
    const decks: SetupDecks = {
      0: Array.from({ length: 30 }, (_, i) => mkEntityId(i)),
      1: Array.from({ length: 30 }, (_, i) => mkEntityId(100 + i)),
    };
    drive(game, decks, [{ seat: mkPlayerSeat(0), cardId: cId }]);
    expect(game.players[0]?.zones.get(ZoneType.Command)?.size).toBe(1);
    expect(game.players[1]?.zones.get(ZoneType.Command)?.size).toBe(0);
  });
});

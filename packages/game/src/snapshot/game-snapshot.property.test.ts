// SPDX-License-Identifier: GPL-3.0-or-later
// Property-based deep round-trip test for GameSnapshot. Randomizes turn,
// phase, life totals, counters, zone contents, RNG advancement, and terminal
// state; then asserts the equivalence law:
//
//   snapshot → JSON.stringify → JSON.parse → restore → snapshot → state
//
// equals the original snapshot's state.
//
// Reviewer C §5: deep-state property coverage for the serialization boundary.
// A single failing seed (via fast-check's shrinking) points directly at
// which state slot desynced — invaluable when adding a new field that
// silently fails to survive the round-trip.
//
// numRuns is kept modest (40) to avoid CI slowness; the round-trip involves
// a full Game construction and a JSON stringify/parse cycle per iteration.
import type { LobbyPlayer, PaperCard, PhaseStep as PhaseStepT, PlayerSeat } from "@mtg-forge-ts/core";
import {
  CounterType,
  DEFAULT_PAPER_CARD_FLAGS,
  PhaseStep,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
  paperCardKey,
} from "@mtg-forge-ts/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import type { TerminalState } from "../terminal-state.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";
import { restore, snapshot } from "./game-snapshot.js";

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
  name: "Grizzly Bears",
  edition: "LEA",
  collectorNumber: "195",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const paperCards = new Map<string, PaperCard>([[paperCardKey(paperA), paperA]]);

// Arbitraries --------------------------------------------------------------

const arbPhase: fc.Arbitrary<PhaseStepT> = fc.constantFrom(
  PhaseStep.Untap,
  PhaseStep.Upkeep,
  PhaseStep.Draw,
  PhaseStep.Main1,
  PhaseStep.BeginCombat,
  PhaseStep.DeclareAttackers,
  PhaseStep.DeclareBlockers,
  PhaseStep.CombatDamage,
  PhaseStep.EndOfCombat,
  PhaseStep.Main2,
  PhaseStep.EndStep,
  PhaseStep.Cleanup,
);

const arbSeat: fc.Arbitrary<PlayerSeat> = fc.constantFrom(mkPlayerSeat(0), mkPlayerSeat(1));

const arbCounterKind: fc.Arbitrary<CounterType> = fc.constantFrom(
  CounterType.PlusOnePlusOne,
  CounterType.MinusOneMinusOne,
  CounterType.Loyalty,
  CounterType.Charge,
  CounterType.Poison,
);

const arbTerminal: fc.Arbitrary<TerminalState | null> = fc.oneof(
  fc.constant(null),
  fc.tuple(arbSeat, fc.nat({ max: 100 }), arbPhase).map(([winner, turn, phase]) => ({
    endedAt: { turn, phase },
    outcome: { kind: "win" as const, winner, reason: "property-test" },
    concededSeats: [] as PlayerSeat[],
  })),
  fc.tuple(fc.nat({ max: 100 }), arbPhase).map(([turn, phase]) => ({
    endedAt: { turn, phase },
    outcome: { kind: "draw" as const, reason: "property-test" },
    concededSeats: [] as PlayerSeat[],
  })),
);

interface CardSeed {
  readonly id: number;
  readonly seat: 0 | 1;
  readonly zone: typeof ZoneType.Battlefield | typeof ZoneType.Hand | typeof ZoneType.Graveyard;
  readonly tapped: boolean;
  readonly damage: number;
  readonly counters: ReadonlyArray<readonly [CounterType, number]>;
}

const arbCardSeed: fc.Arbitrary<CardSeed> = fc.record({
  id: fc.nat({ max: 10000 }),
  seat: fc.constantFrom(0 as const, 1 as const),
  zone: fc.constantFrom(
    ZoneType.Battlefield as typeof ZoneType.Battlefield,
    ZoneType.Hand as typeof ZoneType.Hand,
    ZoneType.Graveyard as typeof ZoneType.Graveyard,
  ),
  tapped: fc.boolean(),
  damage: fc.nat({ max: 20 }),
  counters: fc.array(fc.tuple(arbCounterKind, fc.nat({ max: 9 })), { maxLength: 3 }),
});

interface Scenario {
  readonly turn: number;
  readonly phase: PhaseStepT;
  readonly activePlayer: PlayerSeat;
  readonly priorityPlayer: PlayerSeat | null;
  readonly life0: number;
  readonly life1: number;
  readonly rngAdvance: number;
  readonly terminal: TerminalState | null;
  readonly cards: readonly CardSeed[];
  readonly monarch: PlayerSeat | null;
  readonly dayNight: "day" | "night" | "neither";
}

const arbScenario: fc.Arbitrary<Scenario> = fc.record({
  turn: fc.integer({ min: 1, max: 40 }),
  phase: arbPhase,
  activePlayer: arbSeat,
  priorityPlayer: fc.oneof(fc.constant(null), arbSeat),
  life0: fc.integer({ min: -5, max: 50 }),
  life1: fc.integer({ min: -5, max: 50 }),
  rngAdvance: fc.nat({ max: 20 }),
  terminal: arbTerminal,
  cards: fc.array(arbCardSeed, { maxLength: 6 }).map((arr) => {
    // Deduplicate ids — two Cards with the same EntityId would violate
    // the Game.cards Map invariant. Keep the first occurrence per id.
    const seen = new Set<number>();
    return arr.filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  }),
  monarch: fc.oneof(fc.constant(null), arbSeat),
  dayNight: fc.constantFrom("day" as const, "night" as const, "neither" as const),
});

// Applies a Scenario to a freshly-constructed Game. Kept out of arbScenario
// so the arbitrary stays pure data (shrinks cleanly when a run fails).
const applyScenario = (g: Game, s: Scenario): void => {
  g.turn = s.turn;
  g.phase = s.phase;
  g.activePlayer = s.activePlayer;
  g.priorityPlayer = s.priorityPlayer;
  g.terminalState = s.terminal;
  g.flags.monarch = s.monarch;
  g.flags.dayNight = s.dayNight;
  const p0 = g.players[0];
  const p1 = g.players[1];
  if (p0) p0.life = s.life0;
  if (p1) p1.life = s.life1;
  // Seed zones once per player.
  for (const player of g.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
  }
  // Cards.
  for (const seed of s.cards) {
    const id = mkEntityId(seed.id);
    const seat = mkPlayerSeat(seed.seat);
    const card = new Card(id, paperA, seat, seat, seed.zone);
    card.tapped = seed.tapped;
    card.damage = seed.damage;
    for (const [kind, amount] of seed.counters) {
      card.counters.set(kind, amount);
    }
    g.cards.set(id, card);
    const player = g.players[seed.seat];
    if (player) {
      const zone = player.zones.get(seed.zone);
      if (zone) zone.add(id);
    }
  }
  // Advance RNG deterministically so snapshot captures a non-initial state.
  for (let i = 0; i < s.rngAdvance; i++) g.rng.nextLong();
};

describe("GameSnapshot deep round-trip (property)", () => {
  it("snapshot → stringify → parse → restore → snapshot preserves state for any scenario", () => {
    fc.assert(
      fc.property(arbScenario, (scenario) => {
        const g = new Game({
          lobbyPlayers: [alice, bob],
          rules,
          meta,
          rng: new SeededRng(42n),
        });
        applyScenario(g, scenario);
        const snap1 = snapshot(g);
        const wire = JSON.parse(JSON.stringify(snap1)) as typeof snap1;
        const restored = restore(wire, {
          lobbyPlayers: [alice, bob],
          rng: new SeededRng(1n), // overwritten by restore
          paperCards,
          rules,
        });
        const snap2 = snapshot(restored);
        // Compare by-value — expect fails the property via assertion, which
        // fast-check surfaces as the shrunk counterexample.
        expect(snap2.state).toEqual(snap1.state);
      }),
      { numRuns: 40 },
    );
  });
});

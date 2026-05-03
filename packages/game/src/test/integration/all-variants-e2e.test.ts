// SPDX-License-Identifier: GPL-3.0-or-later
// All-variants end-to-end smoke. Asserts the five SP1 variants
// (Vanguard, Conspiracy, Planechase, Archenemy, Two-Headed Giant) co-exist
// cleanly through the full game-flow surface: setupGame → PhaseHandler → SBA.
// Each test re-uses the exact patterns the per-variant integration tests
// already pin down — no new orchestration helpers, no engine-internal
// reaching beyond the public seams those tests exercise.
//
// Test 1: a single 4-seat 2HG game stands up with every variant configured
//         simultaneously (avatars per seat, conspiracies on team 0, an
//         archenemy on team 1, an active plane in seat 0's command zone).
// Test 2: drives ~10 turns of a 2HG-with-avatars game through PhaseHandler,
//         scripting both seats to pass priority, and asserts we get the
//         expected TurnStarted / TurnEnded event counts with no crashes.
// Test 3: validateDeck on a 100-card singleton Commander build that ALSO
//         carries a Vanguard avatar — the variant doesn't pollute the
//         format-legality check (commander format only inspects the deck
//         entries; the avatar lives outside the deck).
import { type DeckEntry, validateDeck } from "@mtg-forge-ts/cards";
import { parseCard } from "@mtg-forge-ts/cards";
import type {
  DecisionResponse,
  EntityId,
  GameEvent,
  LobbyPlayer,
  PaperCard,
  PlayerSeat,
} from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { EngineYield } from "../../action/engine-yield.js";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { PhaseHandler } from "../../phase/phase-handler.js";
import {
  type ArchenemyAssignment,
  type ConspiracyAssignment,
  type PlanechaseAssignment,
  type SetupDecks,
  type TeamAssignment,
  type VanguardAssignment,
  setupGame,
} from "../../setup/setup-flow.js";

const alice: LobbyPlayer = { id: "p-alice", name: "Alice", controllerKind: "human" };
const bob: LobbyPlayer = { id: "p-bob", name: "Bob", controllerKind: "ai" };
const carol: LobbyPlayer = { id: "p-carol", name: "Carol", controllerKind: "human" };
const dave: LobbyPlayer = { id: "p-dave", name: "Dave", controllerKind: "ai" };

// 4-seat 2HG rules — the variant carrier for tests 1 & 2. Teams are 0+1
// vs 2+3 with a 30-life shared pool and 15-poison team-loss threshold.
const rules2HG: GameRules = {
  formatId: "two-headed-giant",
  startingLife: 30,
  startingHandSize: 7,
  mulliganRule: "london",
  firstPlayerSkipsDraw: true,
  ruleOverrides: [],
  playerCount: { min: 4, max: 4 },
  teamAssignments: [0, 0, 1, 1],
  poisonCountersToLose: 15,
  playForAnte: false,
  manaBurn: false,
  appliedVariants: ["TwoHeadedGiant", "Vanguard", "Conspiracy", "Planechase", "Archenemy"],
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

// Forge `cardsfolder/m/maro_avatar.txt` shape — minimal Vanguard text. We
// only need ANY avatar to verify setup seats one in each seat's command
// zone; modifier semantics are pinned by vanguard.test.ts.
const SIMPLE_AVATAR_SRC = (name: string, hand: number, life: number): string =>
  [
    `Name:${name}`,
    "ManaCost:no cost",
    "Types:Vanguard",
    `HandLifeModifier:${hand >= 0 ? "+" : ""}${String(hand)}/${life >= 0 ? "+" : ""}${String(life)}`,
    `Oracle:Hand ${String(hand)}, life ${String(life)}.`,
    "",
  ].join("\n");

// Forge `cardsfolder/y/your_puny_minds_cannot_fathom.txt` — flagship
// scheme used in archenemy.test.ts. Re-used here verbatim so test 1
// actually parses a real Forge scheme into the SchemeDeck.
const PUNY_MINDS_SRC = [
  "Name:Your Puny Minds Cannot Fathom",
  "ManaCost:no cost",
  "Types:Scheme",
  "T:Mode$ SetInMotion | ValidCard$ Card.Self | Execute$ GreatMind | TriggerZones$ Command | TriggerDescription$ When you set this scheme in motion, draw four cards.",
  "SVar:GreatMind:DB$ Draw | Defined$ You | NumCards$ 4",
  "Oracle:When you set this scheme in motion, draw four cards.",
  "",
].join("\n");

const mkPaper = (name: string, src: string, file: string): PaperCard => ({
  name,
  edition: "MIX",
  collectorNumber: "1",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: parseCard(src, file),
});

const conspiracyPaper = (name: string): PaperCard => ({
  name,
  edition: "CN2",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
});

const planePaper = (name: string): PaperCard => ({
  name,
  edition: "HOP",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
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

interface DriveResult {
  readonly events: GameEvent[];
}

// Drive setupGame to completion, default keep-first-hand answers. Mirrors
// the `drive()` helper in conspiracy.test.ts / planechase.test.ts /
// archenemy.test.ts / two-headed-giant.test.ts so the variant integration
// surface is exercised identically here.
const driveSetup = (
  game: Game,
  decks: SetupDecks,
  variantOpts: {
    vanguard?: readonly VanguardAssignment[];
    conspiracies?: readonly ConspiracyAssignment[];
    planechase?: readonly PlanechaseAssignment[];
    archenemy?: readonly ArchenemyAssignment[];
    teams?: readonly TeamAssignment[];
  },
): DriveResult => {
  const gen = setupGame(game, { decks, ...variantOpts });
  const events: GameEvent[] = [];
  let step = gen.next();
  while (!step.done) {
    const y = step.value;
    if (y.kind === "event") {
      events.push(y.event);
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
  return { events };
};

const seedAllLibraries = (game: Game, seatCount: number, perSeat = 30): SetupDecks => {
  const decks: { [seat: number]: EntityId[] } = {};
  for (let i = 0; i < seatCount; i++) {
    decks[i] = seedLibrary(game, mkPlayerSeat(i), perSeat, i * 1000);
  }
  return decks as SetupDecks;
};

describe("All-variants end-to-end smoke", () => {
  it("Test 1 — Vanguard + Conspiracy + Planechase + Archenemy + 2HG can co-exist (4-seat setup completes without errors)", () => {
    const game = new Game({
      lobbyPlayers: [alice, bob, carol, dave],
      rules: rules2HG,
      meta,
      rng: new SeededRng(1n),
    });
    const decks = seedAllLibraries(game, 4);

    // Vanguard avatars — one per seat. Each seat brings a different
    // (hand, life) modifier so we can later distinguish whose avatar
    // landed where.
    const avatarIds: EntityId[] = [];
    const avatarMods: [number, number][] = [
      [+1, +7],
      [+2, -7],
      [+0, +3],
      [-1, +5],
    ];
    for (let seat = 0; seat < 4; seat++) {
      const mod = avatarMods[seat];
      if (!mod) throw new Error("missing avatar mod");
      const id = mkEntityId(9000 + seat);
      avatarIds.push(id);
      game.cards.set(
        id,
        new Card(
          id,
          mkPaper(
            `Avatar ${String(seat)}`,
            SIMPLE_AVATAR_SRC(`Avatar ${String(seat)}`, mod[0], mod[1]),
            `avatar_${String(seat)}.txt`,
          ),
          mkPlayerSeat(seat),
          mkPlayerSeat(seat),
          ZoneType.Command,
        ),
      );
    }
    const vanguard: VanguardAssignment[] = avatarIds.map((id, seat) => ({
      seat: mkPlayerSeat(seat),
      cardId: id,
    }));

    // Conspiracies — team 0 (seats 0 + 1) each carries one. Conspiracy
    // cards do NOT need a parsed definition for setup-time seating;
    // conspiracy.test.ts seeds them as plain PaperCards too.
    const conspiracyIds: [EntityId, EntityId] = [mkEntityId(9100), mkEntityId(9101)];
    game.cards.set(
      conspiracyIds[0],
      new Card(
        conspiracyIds[0],
        conspiracyPaper("Power Play"),
        mkPlayerSeat(0),
        mkPlayerSeat(0),
        ZoneType.None,
      ),
    );
    game.cards.set(
      conspiracyIds[1],
      new Card(
        conspiracyIds[1],
        conspiracyPaper("Worldknit"),
        mkPlayerSeat(1),
        mkPlayerSeat(1),
        ZoneType.None,
      ),
    );
    const conspiracies: ConspiracyAssignment[] = [
      { seat: mkPlayerSeat(0), cardId: conspiracyIds[0] },
      { seat: mkPlayerSeat(1), cardId: conspiracyIds[1] },
    ];

    // Active plane (seat 0) + a 2-card planar deck. Planes also seed as
    // plain PaperCards — the active-plane statics activation lives
    // behind the same cardDb hook other variants use, but a plane with
    // no parsed definition still passes through setup cleanly per
    // planechase.test.ts patterns.
    const activePlaneId = mkEntityId(9200);
    const reservePlaneIds: EntityId[] = [mkEntityId(9201), mkEntityId(9202)];
    game.cards.set(
      activePlaneId,
      new Card(
        activePlaneId,
        planePaper("Academy at Tolaria West"),
        mkPlayerSeat(0),
        mkPlayerSeat(0),
        ZoneType.None,
      ),
    );
    for (const id of reservePlaneIds) {
      game.cards.set(
        id,
        new Card(id, planePaper("Reserve Plane"), mkPlayerSeat(0), mkPlayerSeat(0), ZoneType.None),
      );
    }
    const planechase: PlanechaseAssignment[] = [
      { seat: mkPlayerSeat(0), planarDeck: reservePlaneIds, activePlane: activePlaneId },
    ];

    // Archenemy — seat 2 (team 1) carries a 1-scheme deck. We parse a
    // real Forge scheme so the SchemeDeck holds a valid card with a
    // T:SetInMotion trigger (re-used from archenemy.test.ts).
    const schemeId = mkEntityId(9300);
    game.cards.set(
      schemeId,
      new Card(
        schemeId,
        mkPaper("Your Puny Minds Cannot Fathom", PUNY_MINDS_SRC, "your_puny_minds_cannot_fathom.txt"),
        mkPlayerSeat(2),
        mkPlayerSeat(2),
        ZoneType.None,
      ),
    );
    const archenemy: ArchenemyAssignment[] = [{ seat: mkPlayerSeat(2), schemeDeck: [schemeId] }];

    // 2HG team mapping — must agree with rules2HG.teamAssignments.
    const teams: TeamAssignment[] = [
      { teamId: 0, seats: [mkPlayerSeat(0), mkPlayerSeat(1)] },
      { teamId: 1, seats: [mkPlayerSeat(2), mkPlayerSeat(3)] },
    ];

    // Setup must complete without throwing.
    expect(() =>
      driveSetup(game, decks, { vanguard, conspiracies, planechase, archenemy, teams }),
    ).not.toThrow();

    // Verify each variant's setup landed:
    //   1) avatars in each seat's command zone.
    for (let seat = 0; seat < 4; seat++) {
      const cmd = game.players[seat]?.zones.get(ZoneType.Command);
      const id = avatarIds[seat];
      if (!id) throw new Error("missing avatar id");
      expect(cmd?.toArray()).toContain(id);
      expect(game.cards.get(id)?.zone).toBe(ZoneType.Command);
    }
    //   2) conspiracies in team-0 seats' command zones.
    expect(game.players[0]?.zones.get(ZoneType.Command)?.toArray()).toContain(conspiracyIds[0]);
    expect(game.players[1]?.zones.get(ZoneType.Command)?.toArray()).toContain(conspiracyIds[1]);
    //   3) active plane in seat 0's command zone; reserve planes in PlanarDeck.
    expect(game.players[0]?.zones.get(ZoneType.Command)?.toArray()).toContain(activePlaneId);
    expect(game.players[0]?.zones.get(ZoneType.PlanarDeck)?.toArray()).toEqual(reservePlaneIds);
    //   4) archenemy seat 2 carries the scheme in SchemeDeck.
    expect(game.players[2]?.zones.get(ZoneType.SchemeDeck)?.toArray()).toEqual([schemeId]);
    //   5) team-life pool populated for both teams (per 2HG ctor + setup).
    expect(game.teamLife).not.toBeNull();
    expect(game.teamLife?.size).toBe(2);
    expect(game.teamLife?.get(0)).toBe(30);
    expect(game.teamLife?.get(1)).toBe(30);

    // Sanity: variant cards never leaked into any library (CR 901 / 904
    // disjointness rule). Seats started with 30 in deck and drew
    // (7 + Vanguard handMod) for the opening hand, leaving the rest in
    // the library — so library + hand totals back to 30 and contains
    // none of the variant entity ids.
    const variantIds = new Set<EntityId>([
      ...avatarIds,
      ...conspiracyIds,
      activePlaneId,
      ...reservePlaneIds,
      schemeId,
    ]);
    for (let seat = 0; seat < 4; seat++) {
      const lib = game.players[seat]?.zones.get(ZoneType.Library);
      const hand = game.players[seat]?.zones.get(ZoneType.Hand);
      expect((lib?.size ?? 0) + (hand?.size ?? 0)).toBe(30);
      for (const id of lib?.toArray() ?? []) expect(variantIds.has(id)).toBe(false);
      for (const id of hand?.toArray() ?? []) expect(variantIds.has(id)).toBe(false);
    }
  });

  it("Test 2 — variant-game runs ~10 turns through PhaseHandler without engine crashes", () => {
    const game = new Game({
      lobbyPlayers: [alice, bob, carol, dave],
      rules: rules2HG,
      meta,
      rng: new SeededRng(2n),
    });
    const decks = seedAllLibraries(game, 4, 60);

    // Avatars per seat — keeps Vanguard active during the loop so the
    // command-zone static activation pipeline is exercised on every
    // turn boundary.
    const avatarIds: EntityId[] = [];
    for (let seat = 0; seat < 4; seat++) {
      const id = mkEntityId(9000 + seat);
      avatarIds.push(id);
      game.cards.set(
        id,
        new Card(
          id,
          mkPaper(
            `Avatar ${String(seat)}`,
            SIMPLE_AVATAR_SRC(`Avatar ${String(seat)}`, 0, 0),
            `avatar_${String(seat)}.txt`,
          ),
          mkPlayerSeat(seat),
          mkPlayerSeat(seat),
          ZoneType.Command,
        ),
      );
    }
    const vanguard: VanguardAssignment[] = avatarIds.map((id, seat) => ({
      seat: mkPlayerSeat(seat),
      cardId: id,
    }));
    const teams: TeamAssignment[] = [
      { teamId: 0, seats: [mkPlayerSeat(0), mkPlayerSeat(1)] },
      { teamId: 1, seats: [mkPlayerSeat(2), mkPlayerSeat(3)] },
    ];

    driveSetup(game, decks, { vanguard, teams });

    // Drive ~10 turns through PhaseHandler. We push 10 turns into the
    // queue (alternating seats — variant doesn't merge teammate turns
    // until SP6 per setup-flow.ts TODO) and drain. Both seats pass
    // priority on every step so the loop runs to natural completion of
    // the queued turns.
    const TARGET_TURNS = 10;
    const phaseHandler = new PhaseHandler(game);
    for (let i = 0; i < TARGET_TURNS; i++) {
      phaseHandler.turnQueue.push({ activePlayer: mkPlayerSeat(i % 4), isExtra: false });
    }

    const events: GameEvent[] = [];
    const ys: EngineYield[] = [];
    let safety = 0;
    const gen = phaseHandler.run();
    let step = gen.next();
    while (!step.done) {
      safety++;
      if (safety > 200000) throw new Error("runaway PhaseHandler.run generator");
      const y = step.value;
      ys.push(y);
      if (y.kind === "event") {
        events.push(y.event);
        step = gen.next();
        continue;
      }
      // SP1 priority is minimal: only "pass" is offered to the active
      // player every step. The other shape we expect is the cleanup-
      // step `chooseCard` discard (CR 514.1 — when hand > max-hand-size,
      // the active player picks which to discard); we drop the front of
      // the requested pool so the engine moves on.
      if (y.request.kind === "priority") {
        const resp: DecisionResponse = { kind: "priority", action: { kind: "pass" } };
        step = gen.next(resp);
      } else if (y.request.kind === "chooseCard") {
        const chosen = y.request.pool.slice(0, y.request.min);
        const resp: DecisionResponse = { kind: "chooseCard", chosen };
        step = gen.next(resp);
      } else {
        throw new Error(`turn-loop: unexpected decision kind ${y.request.kind}`);
      }
    }

    // Engine never crashed (we got here). Verify TurnStarted /
    // TurnEnded counts match the queued turns. Each turn emits exactly
    // one TurnStarted and one TurnEnded (and a number of StepStarted /
    // StepEnded between).
    const turnStarted = events.filter((e) => e.kind === "TurnStarted").length;
    const turnEnded = events.filter((e) => e.kind === "TurnEnded").length;
    expect(turnStarted).toBe(TARGET_TURNS);
    expect(turnEnded).toBe(TARGET_TURNS);
    // Final state is non-terminal (nobody conceded, no SBA loss): the
    // game is still alive after 10 quiet turns with shared-life intact.
    expect(game.isTerminal()).toBe(false);
    // Team life pool stays at 30 each — no damage was dealt during the
    // pass-only loop.
    expect(game.teamLife?.get(0)).toBe(30);
    expect(game.teamLife?.get(1)).toBe(30);
    // Suppress unused-variable lint on `ys` while keeping the array
    // available for future regression assertions.
    expect(ys.length).toBeGreaterThan(0);
  });

  it("Test 3 — Commander deck (100-card singleton) with a Vanguard avatar passes validateDeck (avatar lives outside the deck)", () => {
    // Build a clean 100-card singleton commander deck: 1 commander +
    // 60 basic Mountains (basics exempt from singleton) + 39 unique
    // non-basics with color-identity {R}. Mirrors makeCommander99()
    // from legality.test.ts.
    const deck: DeckEntry[] = [
      {
        name: "Krenko, Mob Boss",
        count: 1,
        commander: true,
        colorIdentity: ["R"],
      },
      { name: "Mountain", count: 60, colorIdentity: ["R"] },
    ];
    for (let i = 0; i < 39; i++) {
      deck.push({
        name: `Goblin Token Card #${String(i)}`,
        count: 1,
        colorIdentity: ["R"],
      });
    }

    // The Vanguard avatar is a SEPARATE pool from the deck (lives in the
    // command zone via SetupOptions.vanguard, NOT in DeckEntry[]). So
    // legality is purely deck-driven and must pass clean.
    const result = validateDeck(deck, "commander");
    expect(result.legal).toBe(true);
    expect(result.violations).toEqual([]);

    // Sanity-check: the same deck without the commander flag fails
    // — proves the validator is actually inspecting the deck shape and
    // we're not just getting a no-op pass.
    const noCommander = deck.map((e) => (e.commander === true ? { ...e, commander: false } : e));
    const failResult = validateDeck(noCommander, "commander");
    expect(failResult.legal).toBe(false);
    expect(failResult.violations.some((v) => v.includes("commander"))).toBe(true);
  });
});

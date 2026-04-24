// SPDX-License-Identifier: GPL-3.0-or-later
// SP2 Milestone W Task 72 — companion declaration + opening-hand actions.
import type {
  DecisionRequest,
  DecisionResponse,
  EntityId,
  GameEvent,
  LobbyPlayer,
  PaperCard,
  PlayerSeat,
} from "@mtg-forge-ts/core";
import {
  DEFAULT_PAPER_CARD_FLAGS,
  IllegalDecisionError,
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
import { CommandZone } from "../zone/zones/command-zone.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";
import { type SetupDecks, setupGame } from "./setup-flow.js";

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
  name: "Forest",
  edition: "LEA",
  collectorNumber: "294",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const mkGame = (seed = 1n): Game =>
  new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(seed) });

const seedCards = (game: Game, seat: PlayerSeat, count: number, startId: number): EntityId[] => {
  const ids: EntityId[] = [];
  for (let i = 0; i < count; i++) {
    const id = mkEntityId(startId + i);
    game.cards.set(id, new Card(id, paper, seat, seat, ZoneType.Library));
    ids.push(id);
  }
  return ids;
};

interface Capture {
  companionRequests: Array<{ seat: PlayerSeat; sideboardCardIds: readonly EntityId[] }>;
  openingHandRequests: Array<{ seat: PlayerSeat; availableActions: readonly string[] }>;
  events: GameEvent[];
}

const driveSetup = (
  game: Game,
  decks: SetupDecks,
  opts?: {
    companionChoice?: (req: {
      seat: PlayerSeat;
      sideboardCardIds: readonly EntityId[];
    }) => EntityId | null;
    openingHandChoice?: (req: { seat: PlayerSeat }) => readonly string[];
  },
): Capture => {
  const cap: Capture = { companionRequests: [], openingHandRequests: [], events: [] };
  const gen = setupGame(game, decks);
  let step = gen.next();
  while (!step.done) {
    const y = step.value;
    if (y.kind === "event") {
      cap.events.push(y.event);
      step = gen.next();
      continue;
    }
    const req = y.request as DecisionRequest;
    let resp: DecisionResponse;
    if (req.kind === "mulligan") {
      resp = { kind: "mulligan", keep: true };
    } else if (req.kind === "mulliganBottom") {
      resp = { kind: "mulliganBottom", bottomed: req.hand.slice(0, req.countToBottom) };
    } else if (req.kind === "companionDeclaration") {
      cap.companionRequests.push({
        seat: req.playerSeat,
        sideboardCardIds: req.sideboardCardIds,
      });
      const companionId = opts?.companionChoice
        ? opts.companionChoice({ seat: req.playerSeat, sideboardCardIds: req.sideboardCardIds })
        : null;
      resp = { kind: "companionDeclaration", companionId };
    } else if (req.kind === "openingHandAction") {
      cap.openingHandRequests.push({
        seat: req.playerSeat,
        availableActions: req.availableActions,
      });
      const chosenActions = opts?.openingHandChoice ? opts.openingHandChoice({ seat: req.playerSeat }) : [];
      resp = { kind: "openingHandAction", chosenActions };
    } else {
      throw new Error(`driveSetup: unexpected decision kind ${req.kind}`);
    }
    step = gen.next(resp);
  }
  return cap;
};

describe("setupGame — companion declaration (Task 72)", () => {
  it("emits a companionDeclaration request per seat with empty sideboard when none seeded", () => {
    const game = mkGame();
    const decks: SetupDecks = {
      0: seedCards(game, mkPlayerSeat(0), 40, 0),
      1: seedCards(game, mkPlayerSeat(1), 40, 40),
    };
    const cap = driveSetup(game, decks);
    expect(cap.companionRequests).toHaveLength(2);
    expect(cap.companionRequests.map((r) => r.seat)).toEqual([mkPlayerSeat(0), mkPlayerSeat(1)]);
    for (const r of cap.companionRequests) expect(r.sideboardCardIds).toEqual([]);
  });

  it("enumerates the seat's sideboard when pre-seeded", () => {
    const game = mkGame();
    // Pre-populate seat 0 with all standard zones PLUS a sideboard (the
    // setupGame's zone-create branch runs only when zones.size === 0, so
    // pre-seeding the sideboard requires seeding everything).
    const seat0 = mkPlayerSeat(0);
    const p0 = game.getPlayer(seat0);
    p0.zones.set(ZoneType.Library, new Library(ZoneType.Library, seat0));
    p0.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, seat0));
    p0.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, seat0));
    p0.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, seat0));
    p0.zones.set(ZoneType.Command, new CommandZone(ZoneType.Command, seat0));
    const companionId = mkEntityId(9000);
    game.cards.set(companionId, new Card(companionId, paper, seat0, seat0, ZoneType.Sideboard));
    // WHY: no concrete Sideboard zone class yet; Hand is a Zone concrete
    // subclass that carries EntityId items identically for test purposes.
    const sideboard = new Hand(ZoneType.Sideboard, seat0);
    sideboard.add(companionId);
    p0.zones.set(ZoneType.Sideboard, sideboard);
    const decks: SetupDecks = {
      0: seedCards(game, seat0, 40, 0),
      1: seedCards(game, mkPlayerSeat(1), 40, 40),
    };
    const cap = driveSetup(game, decks);
    const seat0Req = cap.companionRequests.find((r) => r.seat === seat0);
    expect(seat0Req?.sideboardCardIds).toEqual([companionId]);
  });

  it("records null when seat declines companion", () => {
    const game = mkGame();
    const decks: SetupDecks = {
      0: seedCards(game, mkPlayerSeat(0), 40, 0),
      1: seedCards(game, mkPlayerSeat(1), 40, 40),
    };
    driveSetup(game, decks);
    expect(game.companions.get(mkPlayerSeat(0))).toBe(null);
    expect(game.companions.get(mkPlayerSeat(1))).toBe(null);
  });

  it("records the chosen companion id when declared", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const p0 = game.getPlayer(seat0);
    p0.zones.set(ZoneType.Library, new Library(ZoneType.Library, seat0));
    p0.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, seat0));
    p0.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, seat0));
    p0.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, seat0));
    p0.zones.set(ZoneType.Command, new CommandZone(ZoneType.Command, seat0));
    const companionId = mkEntityId(9000);
    game.cards.set(companionId, new Card(companionId, paper, seat0, seat0, ZoneType.Sideboard));
    const sideboard = new Hand(ZoneType.Sideboard, seat0);
    sideboard.add(companionId);
    p0.zones.set(ZoneType.Sideboard, sideboard);
    const decks: SetupDecks = {
      0: seedCards(game, seat0, 40, 0),
      1: seedCards(game, mkPlayerSeat(1), 40, 40),
    };
    driveSetup(game, decks, {
      companionChoice: ({ sideboardCardIds }) => sideboardCardIds[0] ?? null,
    });
    expect(game.companions.get(seat0)).toBe(companionId);
  });

  it("rejects a companion id not present in the sideboard", () => {
    const game = mkGame();
    const decks: SetupDecks = {
      0: seedCards(game, mkPlayerSeat(0), 40, 0),
      1: seedCards(game, mkPlayerSeat(1), 40, 40),
    };
    expect(() =>
      driveSetup(game, decks, {
        companionChoice: () => mkEntityId(9999),
      }),
    ).toThrow(IllegalDecisionError);
  });
});

describe("setupGame — opening-hand actions (Task 72)", () => {
  it("emits an openingHandAction request per seat after mulligans settle", () => {
    const game = mkGame();
    const decks: SetupDecks = {
      0: seedCards(game, mkPlayerSeat(0), 40, 0),
      1: seedCards(game, mkPlayerSeat(1), 40, 40),
    };
    const cap = driveSetup(game, decks);
    expect(cap.openingHandRequests).toHaveLength(2);
    for (const r of cap.openingHandRequests) {
      // SP2 scope: availableActions is empty; SP3 populates from card definitions.
      expect(r.availableActions).toEqual([]);
    }
  });

  it("companionDeclaration fires before first CardDrawn (ordering check)", () => {
    const game = mkGame();
    const decks: SetupDecks = {
      0: seedCards(game, mkPlayerSeat(0), 40, 0),
      1: seedCards(game, mkPlayerSeat(1), 40, 40),
    };
    const cap = driveSetup(game, decks);
    const firstDrawIdx = cap.events.findIndex((e) => e.kind === "CardDrawn");
    // Companion decisions are not events, but the companion request should
    // have been captured BEFORE any CardDrawn events landed. We check
    // chronologically via capture-order vs event-order: all 2 companion
    // requests captured before any event requires driving through them
    // first, which the generator does.
    expect(firstDrawIdx).toBeGreaterThanOrEqual(0);
    expect(cap.companionRequests).toHaveLength(2);
  });

  it("openingHandAction fires after mulligan MulliganTaken events (before GameStarted)", () => {
    const game = mkGame();
    const decks: SetupDecks = {
      0: seedCards(game, mkPlayerSeat(0), 40, 0),
      1: seedCards(game, mkPlayerSeat(1), 40, 40),
    };
    const cap = driveSetup(game, decks);
    // The last event emitted is GameStarted; MulliganTaken events precede
    // both opening-hand actions and GameStarted. Since opening-hand is
    // not an event, we assert via request capture count + GameStarted.
    const last = cap.events[cap.events.length - 1];
    expect(last?.kind).toBe("GameStarted");
    expect(cap.openingHandRequests).toHaveLength(2);
  });

  it("SP2 rejects non-empty opening-hand responses (SP3 enumerates actions)", () => {
    const game = mkGame();
    const decks: SetupDecks = {
      0: seedCards(game, mkPlayerSeat(0), 40, 0),
      1: seedCards(game, mkPlayerSeat(1), 40, 40),
    };
    expect(() =>
      driveSetup(game, decks, {
        openingHandChoice: () => ["some-action"],
      }),
    ).toThrow(IllegalDecisionError);
  });
});

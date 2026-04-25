// SPDX-License-Identifier: GPL-3.0-or-later
// F7 — Divination flagship integration test.
// Tests DrawEffect with NumCards$ 2 (literal). Ensures game.action.drawCards
// loops correctly, drawing exactly 2 cards from a 5-card library.
//
// Pipeline: parse → build → cast (seed 3 U mana) → resolve → assert hand +2,
// library -2, Divination in graveyard.
import { parseCard } from "@mtg-forge-ts/cards";
import type { EntityId, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  Color,
  DEFAULT_PAPER_CARD_FLAGS,
  ManaProduced,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../src/card.js";
import type { CastProposal } from "../../src/cast/cast-pipeline.js";
import type { GameMeta } from "../../src/game-meta.js";
import type { GameRules } from "../../src/game-rules.js";
import { Game } from "../../src/game.js";
import { ManaPool } from "../../src/mana/mana-pool.js";
import { resolveStackItem } from "../../src/resolve/effect-resolve.js";
import type { StackItem } from "../../src/stack/stack-item.js";
import { Battlefield } from "../../src/zone/zones/battlefield.js";
import { Graveyard } from "../../src/zone/zones/graveyard.js";
import { Hand } from "../../src/zone/zones/hand.js";
import { Library } from "../../src/zone/zones/library.js";

// Self-register all effects
import "../../src/ability/effects/index.js";
// Register cost parts
import "../../src/cost/parts/index.js";
// SVar number selectors
import "../../src/svar/selectors/number.js";

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

const divinationSrc = `${[
  "Name:Divination",
  "ManaCost:2 U",
  "Types:Sorcery",
  "A:SP$ Draw | Cost$ 2 U | NumCards$ 2 | SpellDescription$ Draw two cards.",
  "Oracle:Draw two cards.",
].join("\n")}\n`;

const makeGame = () => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
  return game;
};

const addCardToHand = (game: Game, paper: PaperCard, seat: PlayerSeat, id: EntityId): Card => {
  const card = new Card(id, paper, seat, seat, ZoneType.Hand);
  game.cards.set(id, card);
  const hand = game.getPlayer(seat).zones.get(ZoneType.Hand);
  if (!hand) throw new Error("test: missing hand zone");
  hand.add(id);
  return card;
};

const addCardToLibrary = (game: Game, paper: PaperCard, seat: PlayerSeat, id: EntityId): Card => {
  const card = new Card(id, paper, seat, seat, ZoneType.Library);
  game.cards.set(id, card);
  const lib = game.getPlayer(seat).zones.get(ZoneType.Library);
  if (!lib) throw new Error("test: missing library zone");
  lib.add(id);
  return card;
};

const drainCast = (
  gen: Generator<{ kind: string }, StackItem | null, unknown>,
): { events: string[]; result: StackItem | null } => {
  const events: string[] = [];
  let step = gen.next();
  while (!step.done) {
    const y = step.value as { kind: string; event?: { kind?: string }; request?: { kind?: string } };
    if (y.kind === "event" && y.event?.kind) {
      events.push(y.event.kind);
      step = gen.next();
    } else if (y.kind === "decision" && y.request?.kind === "activateManaAbilities") {
      step = gen.next({ kind: "activateManaAbilities", done: true });
    } else {
      step = gen.next();
    }
  }
  return { events, result: step.value };
};

const drainResolver = (gen: Generator<unknown, void, unknown>): string[] => {
  const events: string[] = [];
  let step = gen.next();
  while (!step.done) {
    const y = step.value as {
      kind?: string;
      event?: { kind?: string };
      request?: { kind?: string; replacementIds?: number[] };
    };
    if (y.kind === "event" && y.event?.kind) {
      events.push(y.event.kind);
      step = gen.next();
    } else if (y.kind === "decision" && y.request?.kind === "orderReplacements") {
      step = gen.next({ order: [...(y.request.replacementIds ?? [])] });
    } else {
      step = gen.next();
    }
  }
  return events;
};

const fillerPaper: PaperCard = {
  name: "Filler",
  edition: "T",
  collectorNumber: "0",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

describe("Flagship: Divination end-to-end integration", () => {
  it("draws 2 cards — hand +2, library -2, Divination in graveyard", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const divId = mkEntityId(5000);

    // 1. Parse Divination and build PaperCard
    const def = parseCard(divinationSrc, "divination.txt");
    const divPaper: PaperCard = {
      name: "Divination",
      edition: "M13",
      collectorNumber: "53",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };

    // 2. Add Divination to hand, activate abilities
    const divCard = addCardToHand(game, divPaper, seat0, divId);
    divCard.activateAbilitiesFromDefinition();

    // 3. Put 5 filler cards in the library
    for (let i = 0; i < 5; i++) {
      addCardToLibrary(game, fillerPaper, seat0, mkEntityId(5100 + i));
    }
    const lib = game.getPlayer(seat0).zones.get(ZoneType.Library);
    if (!lib) throw new Error("test: missing library zone");
    expect(lib.size).toBe(5);

    // 4. Seed 3 mana: 2 colorless + 1 blue (Divination costs 2U)
    const pool = new ManaPool();
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colored(Color.Blue));
    game.getPlayer(seat0).manaPool = pool;
    expect(pool.size()).toBe(3);

    const hand = game.getPlayer(seat0).zones.get(ZoneType.Hand);
    if (!hand) throw new Error("test: missing hand zone");
    // hand currently has Divination
    const handSizeBefore = hand.size;
    expect(handSizeBefore).toBe(1);

    // 5. Cast Divination
    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: divId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const { events: castEvents, result: stackItem } = drainCast(
      game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );

    expect(stackItem).not.toBeNull();
    expect(castEvents).toContain("CostPaid");
    expect(castEvents).toContain("SpellCast");
    expect(pool.size()).toBe(0);

    // Divination is still tracked as being in Hand until resolution calls moveTo.
    // The CastPipeline does NOT physically move the card — resolveStackItem does.
    // hand.size remains 1 (Divination physically still in hand zone).
    expect(hand.size).toBe(1);

    // 6. Resolve Divination — DrawEffect draws 2
    const resolveEvents = drainResolver(
      resolveStackItem(game, stackItem as StackItem) as Generator<unknown, void, unknown>,
    );

    // Two CardDrawn events
    const cardDrawnEvents = resolveEvents.filter((e) => e === "CardDrawn");
    expect(cardDrawnEvents).toHaveLength(2);
    expect(resolveEvents).toContain("StackItemResolved");

    // Hand grew by exactly 2 (Divination left, 2 drawn)
    expect(hand.size).toBe(2);
    // Library lost 2 cards
    expect(lib.size).toBe(3);
    // Divination in graveyard
    expect(divCard.zone).toBe(ZoneType.Graveyard);
    // Stack is empty
    expect(game.sharedZones.stack.size).toBe(0);
  });

  it("CardDrawn events carry correct playerSeat", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const divId = mkEntityId(6000);

    const def = parseCard(divinationSrc, "divination.txt");
    const divPaper: PaperCard = {
      name: "Divination",
      edition: "M13",
      collectorNumber: "53",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };

    const divCard = addCardToHand(game, divPaper, seat0, divId);
    divCard.activateAbilitiesFromDefinition();

    addCardToLibrary(game, fillerPaper, seat0, mkEntityId(6100));
    addCardToLibrary(game, fillerPaper, seat0, mkEntityId(6101));

    const pool = new ManaPool();
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colored(Color.Blue));
    game.getPlayer(seat0).manaPool = pool;

    const { result: stackItem } = drainCast(
      game.castPipeline.run({
        castingPlayer: seat0,
        sourceCardId: divId,
        originZone: ZoneType.Hand,
        asSpecialAction: false,
      }) as Generator<{ kind: string }, StackItem | null, unknown>,
    );
    expect(stackItem).not.toBeNull();

    const allEvents: { kind: string; payload?: unknown }[] = [];
    const gen = resolveStackItem(game, stackItem as StackItem) as Generator<
      { kind: string; event?: { kind: string; payload?: unknown } },
      void,
      unknown
    >;
    let step = gen.next();
    while (!step.done) {
      const y = step.value;
      if (y.kind === "event" && y.event) {
        allEvents.push({ kind: y.event.kind, payload: y.event.payload });
      }
      if (y.kind === "decision") {
        const req = y as unknown as { request?: { kind?: string; replacementIds?: number[] } };
        if (req.request?.kind === "orderReplacements") {
          step = gen.next({ order: [...(req.request.replacementIds ?? [])] });
          continue;
        }
      }
      step = gen.next();
    }

    const drawEvents = allEvents.filter((e) => e.kind === "CardDrawn");
    expect(drawEvents).toHaveLength(2);
    for (const ev of drawEvents) {
      const p = ev.payload as { playerSeat?: number } | undefined;
      expect(p?.playerSeat).toBe(seat0 as unknown as number);
    }
  });
});

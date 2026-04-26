// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 12B flagship — DamageDoneOnce + CounterAddedOnce E2E once-per-turn guards.
//
// Drives real game state: parse a card with the trigger, attach it to a
// battlefield card, register the trigger via the live trigger registry,
// and emit successive events. Asserts that the trigger registry's pending
// queue gains AT MOST one entry per turn, then resets when game.turn
// advances.
//
// Card data: Forge-shaped DSL (the corpus search shows angelheart_vial.txt
// and apex_altisaur.txt as real users; we use a minimal synthetic card
// that exercises the same pipeline).
import { parseCard } from "@mtg-forge-ts/cards";
import type { LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  DEFAULT_PAPER_CARD_FLAGS,
  PhaseStep,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkEvent,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import "../../src/ability/effects/index.js";
import "../../src/cost/parts/index.js";
import "../../src/svar/selectors/number.js";
import { Card } from "../../src/card.js";
import type { GameMeta } from "../../src/game-meta.js";
import type { GameRules } from "../../src/game-rules.js";
import { Game } from "../../src/game.js";
import { Battlefield } from "../../src/zone/zones/battlefield.js";
import { Hand } from "../../src/zone/zones/hand.js";
import { Library } from "../../src/zone/zones/library.js";

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

const mkGame = () => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
  return game;
};

const addToBattlefield = (game: Game, paper: PaperCard, seat: PlayerSeat, id: number): Card => {
  const eid = mkEntityId(id);
  const card = new Card(eid, paper, seat, seat, ZoneType.Battlefield);
  game.cards.set(eid, card);
  const bf = game.getPlayer(seat).zones.get(ZoneType.Battlefield);
  if (!bf) throw new Error("test: missing battlefield");
  bf.add(eid);
  return card;
};

// "this deals damage to a player" pattern (DamageDoneOnce tracks Self →
// Player). Mirrors the angelheart-vial-style "you're dealt damage" trigger
// shape but inverted (this deals damage to opponent). The MVP handler
// supports ValidSource$ Card.Self + ValidTarget$ Player; subsequent waves
// can broaden the supported ValidTarget$ tokens if needed.
const enrageSrc = `${[
  "Name:Damager Beast",
  "ManaCost:4 G G",
  "Types:Creature Dinosaur",
  "PT:7/7",
  "T:Mode$ DamageDoneOnce | Execute$ TrigGain | ValidSource$ Card.Self | ValidTarget$ Player | TriggerZones$ Battlefield | TriggerDescription$ The first time this deals damage to a player each turn, you gain 2 life.",
  "SVar:TrigGain:DB$ GainLife | Defined$ You | LifeAmount$ 2",
  "Oracle:test",
].join("\n")}\n`;

describe("Flagship F-12B-1: DamageDoneOnce — once-per-turn fire guard", () => {
  it("multiple DamageDealt events in the same turn → only ONE pending trigger", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);

    const def = parseCard(enrageSrc, "enrage_beast.txt");
    const paper: PaperCard = {
      name: "Enrage Beast",
      edition: "TST",
      collectorNumber: "1",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };
    const beast = addToBattlefield(game, paper, seat0, 12000);
    beast.activateTriggersFromDefinition(game);

    game.turn = 1;

    // Three damage events, same turn: one source dealing 1 damage three times
    // (e.g., a 1/1 attacker hitting it during combat — collapsed into separate
    // assignments by our event model).
    const opponent = mkPlayerSeat(1);
    for (let i = 0; i < 3; i++) {
      game.triggerRegistry.onEvent(
        mkEvent("DamageDealt", game.turn, PhaseStep.CombatDamage, {
          sourceId: beast.id,
          targetKind: "player" as const,
          targetId: opponent,
          amount: 1,
          isCombat: true,
        }),
      );
    }

    // Only the first match enqueued a pending trigger.
    const pending = game.triggerRegistry.peekPending();
    const myTriggerHits = pending.filter((p) => p.sourceCardId === beast.id);
    expect(myTriggerHits.length).toBe(1);
  });

  it("turn advance → new fire window opens", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);

    const def = parseCard(enrageSrc, "enrage_beast_2.txt");
    const paper: PaperCard = {
      name: "Enrage Beast",
      edition: "TST",
      collectorNumber: "2",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };
    const beast = addToBattlefield(game, paper, seat0, 13000);
    beast.activateTriggersFromDefinition(game);

    const opponent = mkPlayerSeat(1);
    const fire = (turn: number) => {
      game.turn = turn;
      game.triggerRegistry.onEvent(
        mkEvent("DamageDealt", turn, PhaseStep.CombatDamage, {
          sourceId: beast.id,
          targetKind: "player" as const,
          targetId: opponent,
          amount: 1,
          isCombat: true,
        }),
      );
    };

    // Turn 1: two events → 1 pending.
    fire(1);
    fire(1);
    expect(game.triggerRegistry.peekPending().filter((p) => p.sourceCardId === beast.id).length).toBe(1);

    // Drain the queue, advance to turn 2: another event fires.
    game.triggerRegistry.drain();
    fire(2);
    expect(game.triggerRegistry.peekPending().filter((p) => p.sourceCardId === beast.id).length).toBe(1);

    // Same turn 2, another event → still 1 pending (the second one suppressed).
    fire(2);
    expect(game.triggerRegistry.peekPending().filter((p) => p.sourceCardId === beast.id).length).toBe(1);
  });
});

// ─── CounterAddedOnce flagship ──────────────────────────────────────────────

const counterOnceSrc = `${[
  "Name:Counter Beast",
  "ManaCost:3",
  "Types:Artifact",
  "T:Mode$ CounterAddedOnce | ValidCard$ Card.Self | Execute$ TrigDraw | TriggerDescription$ When a counter is first put on this each turn, draw a card.",
  "SVar:TrigDraw:DB$ Draw | Defined$ You | NumCards$ 1",
  "Oracle:test",
].join("\n")}\n`;

describe("Flagship F-12B-2: CounterAddedOnce — once-per-turn fire guard", () => {
  it("multiple CounterAdded events same turn → only ONE pending trigger", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);

    const def = parseCard(counterOnceSrc, "counter_beast.txt");
    const paper: PaperCard = {
      name: "Counter Beast",
      edition: "TST",
      collectorNumber: "1",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };
    const beast = addToBattlefield(game, paper, seat0, 14000);
    beast.activateTriggersFromDefinition(game);

    game.turn = 1;
    for (let i = 0; i < 4; i++) {
      game.triggerRegistry.onEvent(
        mkEvent("CounterAdded", game.turn, PhaseStep.Main1, {
          cardId: beast.id,
          counterType: "P1P1",
          amount: 1,
        }),
      );
    }
    const pending = game.triggerRegistry.peekPending();
    expect(pending.filter((p) => p.sourceCardId === beast.id).length).toBe(1);
  });

  it("turn advance → guard resets", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);

    const def = parseCard(counterOnceSrc, "counter_beast_2.txt");
    const paper: PaperCard = {
      name: "Counter Beast",
      edition: "TST",
      collectorNumber: "2",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };
    const beast = addToBattlefield(game, paper, seat0, 15000);
    beast.activateTriggersFromDefinition(game);

    const fire = (turn: number) => {
      game.turn = turn;
      game.triggerRegistry.onEvent(
        mkEvent("CounterAdded", turn, PhaseStep.Main1, {
          cardId: beast.id,
          counterType: "P1P1",
          amount: 1,
        }),
      );
    };
    fire(1);
    fire(1);
    expect(game.triggerRegistry.peekPending().filter((p) => p.sourceCardId === beast.id).length).toBe(1);
    game.triggerRegistry.drain();
    fire(2);
    expect(game.triggerRegistry.peekPending().filter((p) => p.sourceCardId === beast.id).length).toBe(1);
    fire(2);
    expect(game.triggerRegistry.peekPending().filter((p) => p.sourceCardId === beast.id).length).toBe(1);
  });
});

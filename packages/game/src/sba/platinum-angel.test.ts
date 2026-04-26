// SPDX-License-Identifier: GPL-3.0-or-later
// Batch D2 — Platinum Angel flagship integration test.
//
// Forge card text:
//   R:Event$ GameLoss | ActiveZones$ Battlefield | ValidPlayer$ You | Layer$ CantHappen
//     | Description$ You can't lose the game and your opponents can't win the game.
//   R:Event$ GameWin  | ActiveZones$ Battlefield | ValidPlayer$ Opponent | Layer$ CantHappen | Secondary$ True
//     | Description$ You can't lose the game and your opponents can't win the game.
//
// Verification path:
//   1. Construct a game with Alice at 0 life.
//   2. Register a CantHappen-layer GameLossReplacement on a Platinum-Angel-
//      style "card" controlled by Alice and seated on the battlefield.
//   3. Run a single SBA sweep.
//   4. Assert: Alice does NOT receive a PlayerLost event, terminalState
//      remains null, and an EventPrevented event WAS emitted (the
//      replacement chain ran and prevented the loss).
//
// This exercises the full pipeline: SBA collector → game.action.gameLoss
// mutator → applyWithReplacements → replacement match → null result →
// EventPrevented emit. The lossPrevented set then breaks the SBA loop
// (otherwise the loop would re-collect the same loss every iteration
// until MAX_ITERATIONS).
import type { EntityId, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { EngineYield } from "../action/engine-yield.js";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { GameLossReplacement } from "../replacement/handlers/game-loss-replacement.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";

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
  name: "Platinum Angel",
  edition: "10E",
  collectorNumber: "032",
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

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  seedZones(game);
  return game;
};

const addCard = (game: Game, seat: PlayerSeat, zone: ZoneType, id: EntityId): Card => {
  const card = new Card(id, paper, seat, seat, zone);
  game.cards.set(id, card);
  const z = game.getPlayer(seat).zones.get(zone);
  if (!z) throw new Error("test: missing zone");
  z.add(id);
  return card;
};

const runSweep = (game: Game): EngineYield[] => {
  const yields: EngineYield[] = [];
  const gen = game.sbaEngine.sweep();
  let step = gen.next();
  while (!step.done) {
    yields.push(step.value);
    step = gen.next();
  }
  return yields;
};

const countEvents = (ys: EngineYield[], kind: string): number =>
  ys.filter((y) => y.kind === "event" && y.event.kind === kind).length;

describe("Platinum Angel flagship — loss prevention via R:Event$ GameLoss replacement (Batch D2)", () => {
  it("Alice at 0 life with Platinum Angel does NOT lose; replacement prevents the loss", () => {
    const game = mkGame();
    const aliceSeat = mkPlayerSeat(0);

    // Drop Alice to 0 life — normally triggers playerLosesLifeZero SBA.
    game.getPlayer(aliceSeat).life = 0;

    // Build a Platinum-Angel-style "card" on Alice's battlefield. We don't
    // need the actual paper-card definition — we just need a card whose
    // replacement is registered against the GameLoss event-kind with
    // ValidPlayer$ You + Layer$ CantHappen.
    const angelId = mkEntityId(100);
    addCard(game, aliceSeat, ZoneType.Battlefield, angelId);

    // Construct the replacement directly via the registered handler.
    const replId = mkEntityId(500);
    const handler = new GameLossReplacement();
    const repl = handler.build(
      {
        eventKind: "GameLoss",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          Layer: { kind: "literal", raw: "CantHappen" },
        },
        effect: { handlerKey: "Prevent", params: {} },
      },
      {
        game,
        sourceCardId: angelId,
        controllerSeat: aliceSeat,
        replacementId: replId,
      },
    );
    game.replacementRegistry.register(repl);

    // Run a sweep — Alice's life=0 should be collected, but Platinum
    // Angel's replacement prevents the loss.
    const ys = runSweep(game);

    // No PlayerLost event for Alice.
    expect(countEvents(ys, "PlayerLost")).toBe(0);
    // No terminalState transition.
    expect(game.terminalState).toBeNull();
    // Replacement chain DID run and emitted EventPrevented.
    expect(countEvents(ys, "EventPrevented")).toBeGreaterThanOrEqual(1);
    // ReplacementApplied also emitted (one per fired replacement id).
    expect(countEvents(ys, "ReplacementApplied")).toBeGreaterThanOrEqual(1);
  });

  it("without Platinum Angel, Alice at 0 life DOES lose normally (control case)", () => {
    const game = mkGame();
    const aliceSeat = mkPlayerSeat(0);
    game.getPlayer(aliceSeat).life = 0;
    const ys = runSweep(game);
    expect(countEvents(ys, "PlayerLost")).toBe(1);
    expect(game.terminalState).not.toBeNull();
    expect(game.terminalState?.concededSeats).toContain(aliceSeat);
  });

  it("loss-prevention does NOT hot-spin — sweep terminates without exceeding MAX_ITERATIONS", () => {
    const game = mkGame();
    const aliceSeat = mkPlayerSeat(0);
    game.getPlayer(aliceSeat).life = 0;
    const angelId = mkEntityId(200);
    addCard(game, aliceSeat, ZoneType.Battlefield, angelId);
    const replId = mkEntityId(600);
    const handler = new GameLossReplacement();
    const repl = handler.build(
      {
        eventKind: "GameLoss",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          Layer: { kind: "literal", raw: "CantHappen" },
        },
        effect: { handlerKey: "Prevent", params: {} },
      },
      { game, sourceCardId: angelId, controllerSeat: aliceSeat, replacementId: replId },
    );
    game.replacementRegistry.register(repl);

    // Run sweep. If lossPrevented isn't tracked across iterations, the
    // loop would hit MAX_ITERATIONS=100 and throw. expect(...) not to
    // throw is the assertion.
    expect(() => runSweep(game)).not.toThrow();
  });
});

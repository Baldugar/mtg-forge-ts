// SPDX-License-Identifier: GPL-3.0-or-later
// SP2 Milestone L Task 45 — changeControl with opts.until registers a
// ledger entry that reverts on the duration's trigger. Without opts.until
// the change persists.
import type { EntityId, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
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
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";
import type { EngineYield } from "./engine-yield.js";

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
  name: "T",
  edition: "LEA",
  collectorNumber: "001",
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

const addCard = (
  game: Game,
  ownerSeat: PlayerSeat,
  controllerSeat: PlayerSeat,
  zone: ZoneType,
  id: EntityId,
): Card => {
  const card = new Card(id, paper, ownerSeat, controllerSeat, zone);
  game.cards.set(id, card);
  const z = game.getPlayer(controllerSeat).zones.get(zone);
  if (!z) throw new Error("test: missing zone");
  z.add(id);
  return card;
};

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  seedZones(game);
  return game;
};

const runAll = (gen: Generator<EngineYield, unknown, unknown>): EngineYield[] => {
  const out: EngineYield[] = [];
  let step = gen.next();
  while (!step.done) {
    const y = step.value;
    out.push(y);
    if (y.kind === "decision" && y.request.kind === "orderReplacements") {
      step = gen.next({ order: [...y.request.replacementIds] });
    } else {
      step = gen.next();
    }
  }
  return out;
};

describe("GameAction.changeControl duration (SP2 Task 45)", () => {
  it("changeControl with until: untilEndOfTurn reverts on TurnEnded", () => {
    const game = mkGame();
    const ownerSeat = mkPlayerSeat(0);
    const thiefSeat = mkPlayerSeat(1);
    const id = mkEntityId(10);
    addCard(game, ownerSeat, ownerSeat, ZoneType.Battlefield, id);

    runAll(game.action.changeControl(id, thiefSeat, { until: { kind: "untilEndOfTurn" } }));
    expect(game.cards.get(id)?.controllerSeat).toBe(thiefSeat);
    expect(game.controlChangeLedger.get(id)?.priorController).toBe(ownerSeat);

    // Fire TurnEnded. The ledger queues the revert; drain to apply it.
    game.emitEvent(mkEvent("TurnEnded", game.turn, PhaseStep.EndStep, { activeSeat: ownerSeat }));
    expect(game.pendingControlReverts).toContain(id);

    runAll(game.action.drainPendingControlReverts());
    expect(game.cards.get(id)?.controllerSeat).toBe(ownerSeat);
    expect(game.controlChangeLedger.get(id)).toBeUndefined();
    expect(game.pendingControlReverts).toEqual([]);
  });

  it("changeControl WITHOUT until does not register a ledger entry; control persists after TurnEnded", () => {
    const game = mkGame();
    const ownerSeat = mkPlayerSeat(0);
    const thiefSeat = mkPlayerSeat(1);
    const id = mkEntityId(20);
    addCard(game, ownerSeat, ownerSeat, ZoneType.Battlefield, id);

    runAll(game.action.changeControl(id, thiefSeat));
    expect(game.cards.get(id)?.controllerSeat).toBe(thiefSeat);
    expect(game.controlChangeLedger.get(id)).toBeUndefined();

    game.emitEvent(mkEvent("TurnEnded", game.turn, PhaseStep.EndStep, { activeSeat: ownerSeat }));
    runAll(game.action.drainPendingControlReverts());
    expect(game.cards.get(id)?.controllerSeat).toBe(thiefSeat);
  });

  it("changeControl with until: untilCombatEnds reverts on CombatEnded", () => {
    const game = mkGame();
    const ownerSeat = mkPlayerSeat(0);
    const thiefSeat = mkPlayerSeat(1);
    const id = mkEntityId(30);
    addCard(game, ownerSeat, ownerSeat, ZoneType.Battlefield, id);

    runAll(game.action.changeControl(id, thiefSeat, { until: { kind: "untilCombatEnds" } }));
    expect(game.cards.get(id)?.controllerSeat).toBe(thiefSeat);

    game.emitEvent(mkEvent("CombatEnded", game.turn, PhaseStep.EndOfCombat, { attackingSeat: ownerSeat }));
    runAll(game.action.drainPendingControlReverts());
    expect(game.cards.get(id)?.controllerSeat).toBe(ownerSeat);
  });

  it("permanent duration is inert — never reverts", () => {
    const game = mkGame();
    const ownerSeat = mkPlayerSeat(0);
    const thiefSeat = mkPlayerSeat(1);
    const id = mkEntityId(40);
    addCard(game, ownerSeat, ownerSeat, ZoneType.Battlefield, id);

    runAll(game.action.changeControl(id, thiefSeat, { until: { kind: "permanent" } }));
    // The ledger does record the entry (bookkeeping surface) but
    // expiredOn never returns it.
    expect(game.controlChangeLedger.get(id)?.priorController).toBe(ownerSeat);

    game.emitEvent(mkEvent("TurnEnded", game.turn, PhaseStep.EndStep, { activeSeat: ownerSeat }));
    game.emitEvent(mkEvent("CombatEnded", game.turn, PhaseStep.EndOfCombat, { attackingSeat: ownerSeat }));
    expect(game.pendingControlReverts).toEqual([]);
    expect(game.cards.get(id)?.controllerSeat).toBe(thiefSeat);
  });

  it("legacy positional sourceId argument still works", () => {
    const game = mkGame();
    const ownerSeat = mkPlayerSeat(0);
    const thiefSeat = mkPlayerSeat(1);
    const id = mkEntityId(50);
    const source = mkEntityId(51);
    addCard(game, ownerSeat, ownerSeat, ZoneType.Battlefield, id);

    const ys = runAll(game.action.changeControl(id, thiefSeat, source));
    expect(game.cards.get(id)?.controllerSeat).toBe(thiefSeat);
    const ctrlChanged = ys.find((y) => y.kind === "event" && y.event.kind === "ControlChanged");
    if (!ctrlChanged || ctrlChanged.kind !== "event" || ctrlChanged.event.kind !== "ControlChanged") {
      throw new Error("expected ControlChanged");
    }
    expect(ctrlChanged.event.payload.sourceId).toBe(source);
  });
});

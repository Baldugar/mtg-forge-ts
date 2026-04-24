// SPDX-License-Identifier: GPL-3.0-or-later
// SP2 Milestone L Task 44 — CR 400.7 verification: personal-zone
// destinations go to the card's OWNER, not the current controller.
// Only Battlefield routes by controller (matching how an opponent can
// steal a creature and it stays under their control).
import type { EntityId, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
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

const addStolenCard = (
  game: Game,
  ownerSeat: PlayerSeat,
  controllerSeat: PlayerSeat,
  zone: ZoneType,
  id: EntityId,
): Card => {
  // Owned by `ownerSeat` but controlled by `controllerSeat` — models the
  // "opponent stole your creature" scenario. The card sits in the
  // controller's battlefield zone (since controller decides which
  // battlefield side renders it) but is owned by the owner.
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

describe("CR 400.7 — personal-zone destinations route to owner (SP2 Task 44)", () => {
  it("opponent-controlled creature → Graveyard goes to OWNER's graveyard", () => {
    const game = mkGame();
    const ownerSeat = mkPlayerSeat(0);
    const controllerSeat = mkPlayerSeat(1);
    const id = mkEntityId(10);
    addStolenCard(game, ownerSeat, controllerSeat, ZoneType.Battlefield, id);

    runAll(game.action.moveTo(id, ZoneType.Graveyard));
    // Ends up in OWNER's graveyard, NOT controller's.
    expect(game.getPlayer(ownerSeat).zones.get(ZoneType.Graveyard)?.contains(id)).toBe(true);
    expect(game.getPlayer(controllerSeat).zones.get(ZoneType.Graveyard)?.contains(id)).toBe(false);
  });

  it("opponent-controlled creature → Hand goes to OWNER's hand", () => {
    const game = mkGame();
    const ownerSeat = mkPlayerSeat(0);
    const controllerSeat = mkPlayerSeat(1);
    const id = mkEntityId(20);
    addStolenCard(game, ownerSeat, controllerSeat, ZoneType.Battlefield, id);

    runAll(game.action.moveTo(id, ZoneType.Hand));
    expect(game.getPlayer(ownerSeat).zones.get(ZoneType.Hand)?.contains(id)).toBe(true);
    expect(game.getPlayer(controllerSeat).zones.get(ZoneType.Hand)?.contains(id)).toBe(false);
  });

  it("opponent-controlled creature → Library goes to OWNER's library", () => {
    const game = mkGame();
    const ownerSeat = mkPlayerSeat(0);
    const controllerSeat = mkPlayerSeat(1);
    const id = mkEntityId(30);
    addStolenCard(game, ownerSeat, controllerSeat, ZoneType.Battlefield, id);

    runAll(game.action.moveTo(id, ZoneType.Library));
    expect(game.getPlayer(ownerSeat).zones.get(ZoneType.Library)?.contains(id)).toBe(true);
    expect(game.getPlayer(controllerSeat).zones.get(ZoneType.Library)?.contains(id)).toBe(false);
  });

  it("moveTo Exile (shared) leaves toSeat null (controller/owner irrelevant)", () => {
    const game = mkGame();
    const ownerSeat = mkPlayerSeat(0);
    const controllerSeat = mkPlayerSeat(1);
    const id = mkEntityId(40);
    addStolenCard(game, ownerSeat, controllerSeat, ZoneType.Battlefield, id);

    const ys = runAll(game.action.moveTo(id, ZoneType.Exile));
    expect(game.sharedZones.exile.contains(id)).toBe(true);
    // CardChangedZone payload: toSeat must be absent for shared exile.
    const zoneEvents = ys.filter((y) => y.kind === "event" && y.event.kind === "CardChangedZone");
    expect(zoneEvents).toHaveLength(1);
    const evt = zoneEvents[0];
    if (evt?.kind !== "event" || evt.event.kind !== "CardChangedZone") {
      throw new Error("expected CardChangedZone");
    }
    expect(evt.event.payload.toSeat).toBeUndefined();
  });

  it("moveTo Battlefield without explicit toSeat defaults to CONTROLLER", () => {
    const game = mkGame();
    const ownerSeat = mkPlayerSeat(0);
    const controllerSeat = mkPlayerSeat(1);
    const id = mkEntityId(50);
    // Start in owner's Hand (the only place this distinction makes sense
    // pre-battlefield). The card is owned by alice and controlled by bob
    // via a prior control-assignment effect (simulated by mutating the
    // card's controllerSeat directly — no battlefield implication yet).
    const card = new Card(id, paper, ownerSeat, controllerSeat, ZoneType.Hand);
    game.cards.set(id, card);
    const handZ = game.getPlayer(ownerSeat).zones.get(ZoneType.Hand);
    if (!handZ) throw new Error("test");
    handZ.add(id);

    runAll(game.action.moveTo(id, ZoneType.Battlefield));
    expect(game.getPlayer(controllerSeat).zones.get(ZoneType.Battlefield)?.contains(id)).toBe(true);
    expect(game.getPlayer(ownerSeat).zones.get(ZoneType.Battlefield)?.contains(id)).toBe(false);
  });

  it("cast-from-opponent's-hand flow: controller changes on Battlefield arrival, later destroy routes to OWNER's graveyard", () => {
    const game = mkGame();
    const ownerSeat = mkPlayerSeat(0);
    const casterSeat = mkPlayerSeat(1);
    const id = mkEntityId(60);
    // Card sits in the owner's Hand but will be cast (via opts.toSeat)
    // by the caster. On resolution the card enters Battlefield controlled
    // by caster; on death it should return to OWNER's graveyard.
    const card = new Card(id, paper, ownerSeat, ownerSeat, ZoneType.Hand);
    game.cards.set(id, card);
    const handZ = game.getPlayer(ownerSeat).zones.get(ZoneType.Hand);
    if (!handZ) throw new Error("test");
    handZ.add(id);

    // Cast onto caster's battlefield (explicit toSeat overrides default).
    runAll(game.action.moveTo(id, ZoneType.Battlefield, { toSeat: casterSeat }));
    expect(card.controllerSeat).toBe(casterSeat);
    expect(game.getPlayer(casterSeat).zones.get(ZoneType.Battlefield)?.contains(id)).toBe(true);

    // Die → goes to OWNER's graveyard per CR 400.7.
    runAll(game.action.moveTo(id, ZoneType.Graveyard));
    expect(game.getPlayer(ownerSeat).zones.get(ZoneType.Graveyard)?.contains(id)).toBe(true);
    expect(game.getPlayer(casterSeat).zones.get(ZoneType.Graveyard)?.contains(id)).toBe(false);
  });
});

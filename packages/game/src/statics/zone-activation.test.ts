// SPDX-License-Identifier: GPL-3.0-or-later
// Zone-activation discipline tests (SP2 Task 25). Verify intrinsic
// statics register/unregister as cards cross the activeInZones boundary,
// and that epoch bumps reflect the transition.
import type { EntityId, LobbyPlayer, PaperCard, PlayerSeat, StaticAbility } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { getIntrinsicStatics, onZoneChange } from "./zone-activation.js";

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
const samplePaper: PaperCard = {
  name: "Forest",
  edition: "LEA",
  collectorNumber: "294",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const makeGame = (): Game => new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });

const addCard = (
  game: Game,
  id: EntityId,
  seat: PlayerSeat,
  zone: ZoneType,
  intrinsicStatics?: readonly StaticAbility[],
): Card => {
  const card = new Card(id, samplePaper, seat, seat, zone);
  if (intrinsicStatics !== undefined) card.intrinsicStatics = intrinsicStatics;
  game.cards.set(id, card);
  return card;
};

const mkStatic = (opts: {
  id: number;
  sourceCardId: number;
  activeInZones: ReadonlySet<ZoneType>;
}): StaticAbility => ({
  id: mkEntityId(opts.id),
  kind: "static",
  sourceCardId: mkEntityId(opts.sourceCardId),
  activeInZones: opts.activeInZones,
  timestamp: 1,
  controllerSeatAtReg: mkPlayerSeat(0),
  category: "cantMustMay",
  describe: () => null,
});

describe("onZoneChange + intrinsic statics (SP2 Task 25)", () => {
  it("registers a static when its card enters an activeIn zone", () => {
    const game = makeGame();
    const cardId = mkEntityId(1);
    const s = mkStatic({ id: 10, sourceCardId: 1, activeInZones: new Set([ZoneType.Battlefield]) });
    addCard(game, cardId, mkPlayerSeat(0), ZoneType.Battlefield, [s]);
    onZoneChange(game, cardId, ZoneType.Hand, ZoneType.Battlefield);
    expect(game.staticEffectRegistry.size()).toBe(1);
    expect(game.staticEffectRegistry.get(mkEntityId(10))).toBe(s);
  });

  it("unregisters a static when its card leaves the activeIn zone", () => {
    const game = makeGame();
    const cardId = mkEntityId(1);
    const s = mkStatic({ id: 10, sourceCardId: 1, activeInZones: new Set([ZoneType.Battlefield]) });
    addCard(game, cardId, mkPlayerSeat(0), ZoneType.Battlefield, [s]);
    game.staticEffectRegistry.register(s);
    onZoneChange(game, cardId, ZoneType.Battlefield, ZoneType.Graveyard);
    expect(game.staticEffectRegistry.size()).toBe(0);
  });

  it("does nothing when moving between two non-active zones", () => {
    const game = makeGame();
    const cardId = mkEntityId(1);
    const s = mkStatic({ id: 10, sourceCardId: 1, activeInZones: new Set([ZoneType.Battlefield]) });
    addCard(game, cardId, mkPlayerSeat(0), ZoneType.Hand, [s]);
    const before = game.layerEngine.currentEpoch;
    onZoneChange(game, cardId, ZoneType.Hand, ZoneType.Graveyard);
    expect(game.staticEffectRegistry.size()).toBe(0);
    // No transition means no epoch bump.
    expect(game.layerEngine.currentEpoch).toBe(before);
  });

  it("stays registered when moving between two active zones", () => {
    const game = makeGame();
    const cardId = mkEntityId(1);
    const s = mkStatic({
      id: 10,
      sourceCardId: 1,
      activeInZones: new Set([ZoneType.Battlefield, ZoneType.Graveyard]),
    });
    addCard(game, cardId, mkPlayerSeat(0), ZoneType.Battlefield, [s]);
    game.staticEffectRegistry.register(s);
    onZoneChange(game, cardId, ZoneType.Battlefield, ZoneType.Graveyard);
    expect(game.staticEffectRegistry.size()).toBe(1);
    onZoneChange(game, cardId, ZoneType.Graveyard, ZoneType.Battlefield);
    expect(game.staticEffectRegistry.size()).toBe(1);
  });

  it("bumps the layer epoch on register and on unregister transitions", () => {
    const game = makeGame();
    const cardId = mkEntityId(1);
    const s = mkStatic({ id: 10, sourceCardId: 1, activeInZones: new Set([ZoneType.Battlefield]) });
    addCard(game, cardId, mkPlayerSeat(0), ZoneType.Battlefield, [s]);
    const e0 = game.layerEngine.currentEpoch;
    onZoneChange(game, cardId, ZoneType.Hand, ZoneType.Battlefield);
    const e1 = game.layerEngine.currentEpoch;
    expect(e1).toBeGreaterThan(e0);
    onZoneChange(game, cardId, ZoneType.Battlefield, ZoneType.Graveyard);
    expect(game.layerEngine.currentEpoch).toBeGreaterThan(e1);
  });

  it("tolerates an untracked card (no throw)", () => {
    const game = makeGame();
    expect(() => onZoneChange(game, mkEntityId(999), ZoneType.Hand, ZoneType.Battlefield)).not.toThrow();
    expect(game.staticEffectRegistry.size()).toBe(0);
  });

  it("handles multiple intrinsic statics together", () => {
    const game = makeGame();
    const cardId = mkEntityId(1);
    const s1 = mkStatic({ id: 10, sourceCardId: 1, activeInZones: new Set([ZoneType.Battlefield]) });
    const s2 = mkStatic({ id: 11, sourceCardId: 1, activeInZones: new Set([ZoneType.Battlefield]) });
    const s3 = mkStatic({ id: 12, sourceCardId: 1, activeInZones: new Set([ZoneType.Graveyard]) });
    addCard(game, cardId, mkPlayerSeat(0), ZoneType.Battlefield, [s1, s2, s3]);
    onZoneChange(game, cardId, ZoneType.Hand, ZoneType.Battlefield);
    expect(game.staticEffectRegistry.size()).toBe(2); // s1 + s2; s3 only active in Graveyard
    onZoneChange(game, cardId, ZoneType.Battlefield, ZoneType.Graveyard);
    // s1 + s2 unregister; s3 registers.
    expect(game.staticEffectRegistry.size()).toBe(1);
    expect(game.staticEffectRegistry.get(mkEntityId(12))).toBe(s3);
  });

  it("getIntrinsicStatics returns [] when slot is absent", () => {
    const game = makeGame();
    const c = addCard(game, mkEntityId(1), mkPlayerSeat(0), ZoneType.Battlefield);
    expect(getIntrinsicStatics(c)).toEqual([]);
  });
});

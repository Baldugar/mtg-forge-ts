// SPDX-License-Identifier: GPL-3.0-or-later
// SP2 Task 63 — Ring level 1-4 ability grant tests.
import type { EntityId, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  CardType,
  DEFAULT_PAPER_CARD_FLAGS,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { EngineYield } from "../action/engine-yield.js";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";
import { RING_LEVEL_ABILITY_IDS, abilityIdsForLevel } from "./level-grants.js";
import { tempt } from "./temptation.js";

const paper: PaperCard = {
  name: "T",
  edition: "LEA",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

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

const mkGame = (): Game => {
  const lobby: LobbyPlayer[] = [
    { id: "a", name: "A", controllerKind: "human" },
    { id: "b", name: "B", controllerKind: "ai" },
  ];
  const game = new Game({ lobbyPlayers: lobby, rules, meta, rng: new SeededRng(1n) });
  for (const p of game.players) {
    p.zones.set(ZoneType.Library, new Library(ZoneType.Library, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
    p.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p.seat));
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
  }
  return game;
};

const addCreature = (game: Game, owner: PlayerSeat, id: EntityId): Card => {
  const card = new Card(id, paper, owner, owner, ZoneType.Battlefield);
  game.cards.set(id, card);
  const z = game.getPlayer(owner).zones.get(ZoneType.Battlefield);
  if (!z) throw new Error("no battlefield");
  z.add(id);
  game.layerEngine.typeEffects.push({
    kind: "add",
    cardType: CardType.Creature,
    isCda: false,
    timestamp: id as unknown as number,
    sourceAbilityId: null,
  });
  game.layerEngine.bumpEpoch("test-seed-creature");
  return card;
};

const drive = (
  gen: Generator<EngineYield, void, unknown>,
  responder: (y: Extract<EngineYield, { kind: "decision" }>) => unknown,
): void => {
  let step = gen.next();
  while (!step.done) {
    step = step.value.kind === "decision" ? gen.next(responder(step.value)) : gen.next();
  }
};

describe("abilityIdsForLevel (SP2 Task 63)", () => {
  it("level 0 grants nothing", () => {
    expect(abilityIdsForLevel(0)).toEqual([]);
  });
  it("level 1 grants 2 ids", () => {
    const ids = abilityIdsForLevel(1);
    expect(ids).toHaveLength(2);
    expect(ids).toContain(RING_LEVEL_ABILITY_IDS.L1_LEGENDARY);
    expect(ids).toContain(RING_LEVEL_ABILITY_IDS.L1_UNBLOCKABLE_BY_GREATER);
  });
  it("level 2 grants 3 ids (cumulative)", () => {
    expect(abilityIdsForLevel(2)).toHaveLength(3);
    expect(abilityIdsForLevel(2)).toContain(RING_LEVEL_ABILITY_IDS.L2_ATTACK_DEBUFF);
  });
  it("level 3 grants 4 ids (cumulative)", () => {
    expect(abilityIdsForLevel(3)).toHaveLength(4);
    expect(abilityIdsForLevel(3)).toContain(RING_LEVEL_ABILITY_IDS.L3_DAMAGE_LIFE_LOSS);
  });
  it("level 4 grants all 7 ids", () => {
    const ids = abilityIdsForLevel(4);
    expect(ids).toHaveLength(7);
    expect(ids).toContain(RING_LEVEL_ABILITY_IDS.L4_ATTACK_PUMP);
    expect(ids).toContain(RING_LEVEL_ABILITY_IDS.L4_UNCOUNTERABLE);
    expect(ids).toContain(RING_LEVEL_ABILITY_IDS.L4_UNTARGETABLE_BY_OPPONENT);
  });
});

describe("RingGrantLedger integration with LayerEngine (SP2 Task 63)", () => {
  it("after first tempt, bearer's characteristics contain L1 granted abilities", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const cid = mkEntityId(100);
    addCreature(game, seat, cid);
    drive(tempt(game, seat), () => ({ kind: "chooseRingBearer", bearerId: cid }));
    const chars = game.layerEngine.computeCharacteristics(cid);
    const grantedIds = chars.abilities.map((a) => a.id);
    expect(grantedIds).toContain(RING_LEVEL_ABILITY_IDS.L1_LEGENDARY);
    expect(grantedIds).toContain(RING_LEVEL_ABILITY_IDS.L1_UNBLOCKABLE_BY_GREATER);
  });

  it("no grants on a non-bearer", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const bearerId = mkEntityId(100);
    const otherId = mkEntityId(101);
    addCreature(game, seat, bearerId);
    addCreature(game, seat, otherId);
    drive(tempt(game, seat), () => ({ kind: "chooseRingBearer", bearerId }));
    const other = game.layerEngine.computeCharacteristics(otherId);
    const otherIds = other.abilities.map((a) => a.id);
    expect(otherIds).not.toContain(RING_LEVEL_ABILITY_IDS.L1_LEGENDARY);
  });

  it("switching bearers removes grants from the old one and applies to the new", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const oldId = mkEntityId(100);
    const newId = mkEntityId(101);
    addCreature(game, seat, oldId);
    addCreature(game, seat, newId);
    drive(tempt(game, seat), () => ({ kind: "chooseRingBearer", bearerId: oldId }));
    drive(tempt(game, seat), () => ({ kind: "chooseRingBearer", bearerId: newId }));
    // Old is no longer the bearer, so no Ring grants.
    const oldChars = game.layerEngine.computeCharacteristics(oldId);
    const oldGranted = oldChars.abilities.map((a) => a.id);
    expect(oldGranted).not.toContain(RING_LEVEL_ABILITY_IDS.L1_LEGENDARY);
    // New is the bearer at level 2 → 3 granted abilities.
    const newChars = game.layerEngine.computeCharacteristics(newId);
    const newGranted = newChars.abilities.map((a) => a.id);
    expect(newGranted).toContain(RING_LEVEL_ABILITY_IDS.L1_LEGENDARY);
    expect(newGranted).toContain(RING_LEVEL_ABILITY_IDS.L2_ATTACK_DEBUFF);
  });

  it("leveling up adds the new level's grants cumulatively", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const cid = mkEntityId(100);
    addCreature(game, seat, cid);
    for (let i = 0; i < 4; i++) {
      drive(tempt(game, seat), () => ({ kind: "chooseRingBearer", bearerId: cid }));
    }
    const chars = game.layerEngine.computeCharacteristics(cid);
    const granted = chars.abilities.map((a) => a.id);
    // All seven Ring grants expected at level 4.
    expect(granted).toContain(RING_LEVEL_ABILITY_IDS.L1_LEGENDARY);
    expect(granted).toContain(RING_LEVEL_ABILITY_IDS.L2_ATTACK_DEBUFF);
    expect(granted).toContain(RING_LEVEL_ABILITY_IDS.L3_DAMAGE_LIFE_LOSS);
    expect(granted).toContain(RING_LEVEL_ABILITY_IDS.L4_ATTACK_PUMP);
    expect(granted).toContain(RING_LEVEL_ABILITY_IDS.L4_UNCOUNTERABLE);
    expect(granted).toContain(RING_LEVEL_ABILITY_IDS.L4_UNTARGETABLE_BY_OPPONENT);
  });

  it("ledger.sizeFor tracks the contribution count per seat", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const cid = mkEntityId(100);
    addCreature(game, seat, cid);
    expect(game.ringGrantLedger.sizeFor(seat)).toBe(0);
    drive(tempt(game, seat), () => ({ kind: "chooseRingBearer", bearerId: cid }));
    expect(game.ringGrantLedger.sizeFor(seat)).toBe(2); // L1 grants.
    drive(tempt(game, seat), () => ({ kind: "chooseRingBearer", bearerId: cid }));
    expect(game.ringGrantLedger.sizeFor(seat)).toBe(3); // L2 cumulative.
  });

  it("with null bearer, no grants register", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    drive(tempt(game, seat), () => ({ kind: "chooseRingBearer", bearerId: null }));
    expect(game.ringGrantLedger.sizeFor(seat)).toBe(0);
  });

  it("per-seat grants are isolated — player 0's bearer doesn't affect player 1", () => {
    const game = mkGame();
    const s0 = mkPlayerSeat(0);
    const s1 = mkPlayerSeat(1);
    const c0 = mkEntityId(100);
    const c1 = mkEntityId(200);
    addCreature(game, s0, c0);
    addCreature(game, s1, c1);
    drive(tempt(game, s0), () => ({ kind: "chooseRingBearer", bearerId: c0 }));
    // s1's bearer still null; no contributions registered.
    expect(game.ringGrantLedger.sizeFor(s1)).toBe(0);
    const s1Player = game.layerEngine.computeCharacteristics(c1);
    expect(s1Player.abilities.map((a) => a.id)).not.toContain(RING_LEVEL_ABILITY_IDS.L1_LEGENDARY);
  });

  it("grants are scoped: applying level 4 to one card doesn't grant to every card", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const bearer = mkEntityId(100);
    const bystander = mkEntityId(101);
    addCreature(game, seat, bearer);
    addCreature(game, seat, bystander);
    for (let i = 0; i < 4; i++) {
      drive(tempt(game, seat), () => ({ kind: "chooseRingBearer", bearerId: bearer }));
    }
    // Bystander is never the bearer — should have zero Ring grants.
    const bc = game.layerEngine.computeCharacteristics(bystander);
    const ids = bc.abilities.map((a) => a.id);
    for (const ringId of Object.values(RING_LEVEL_ABILITY_IDS)) {
      expect(ids).not.toContain(ringId);
    }
  });
});

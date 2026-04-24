// SPDX-License-Identifier: GPL-3.0-or-later
// SP2 Milestone K Task 43 — integration test for the aura-ability-grant
// ledger. Verifies that attaching an Aura carrying an abilityGranting
// static flagged `targetsAttached: true` produces a scoped Layer 6
// grant on the attached creature, and that unattach tears it down.
import type { EntityId, LobbyPlayer, PaperCard, PlayerSeat, StaticAbility } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { EngineYield } from "../action/engine-yield.js";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import type { AbilityChangeEffect } from "../layers/layer6-ability.js";
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

const addCard = (game: Game, seat: PlayerSeat, zone: ZoneType, id: EntityId): Card => {
  const card = new Card(id, paper, seat, seat, zone);
  game.cards.set(id, card);
  const z = game.getPlayer(seat).zones.get(zone);
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

// Mint an aura-style `abilityGranting` static that opts into per-attachment
// scoping via `targetsAttached: true`. `grantedAbilityId` is the id the
// Layer 6 applier will push onto the target's abilities array.
const mkAuraGrant = (opts: {
  auraId: EntityId;
  grantedAbilityId: EntityId;
  timestamp?: number;
}): StaticAbility => {
  const effect: AbilityChangeEffect = {
    kind: "add",
    abilityId: opts.grantedAbilityId,
    grantedBy: opts.auraId,
    origin: "aura",
    timestamp: opts.timestamp ?? 1,
  };
  const payload = { kind: "ability", effect, targetsAttached: true } as const;
  return {
    id: mkEntityId(9000 + Number(opts.auraId)),
    kind: "static",
    sourceCardId: opts.auraId,
    activeInZones: new Set([ZoneType.Battlefield]),
    timestamp: opts.timestamp ?? 1,
    controllerSeatAtReg: mkPlayerSeat(0),
    category: "abilityGranting",
    mode: "Continuous",
    describe: () => payload,
  };
};

describe("AuraAbilityGrantLedger (SP2 Task 43)", () => {
  it("attach grants the Aura's ability to the attached creature only", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const auraId = mkEntityId(10);
    const targetId = mkEntityId(11);
    const otherId = mkEntityId(12);
    const grantedAbilityId = mkEntityId(777); // "flying" ability id
    const aura = addCard(game, seat, ZoneType.Battlefield, auraId);
    addCard(game, seat, ZoneType.Battlefield, targetId);
    addCard(game, seat, ZoneType.Battlefield, otherId);
    aura.intrinsicStatics = [mkAuraGrant({ auraId, grantedAbilityId })];

    runAll(game.action.attach(auraId, targetId, "cast"));

    // Target has the granted ability.
    const targetChars = game.layerEngine.computeCharacteristics(targetId);
    expect(targetChars.abilities.some((a) => a.id === grantedAbilityId)).toBe(true);

    // Aura itself does NOT have it.
    const auraChars = game.layerEngine.computeCharacteristics(auraId);
    expect(auraChars.abilities.some((a) => a.id === grantedAbilityId)).toBe(false);

    // Other creature does NOT have it.
    const otherChars = game.layerEngine.computeCharacteristics(otherId);
    expect(otherChars.abilities.some((a) => a.id === grantedAbilityId)).toBe(false);
  });

  it("unattach removes the granted ability from the previously-attached creature", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const auraId = mkEntityId(20);
    const targetId = mkEntityId(21);
    const grantedAbilityId = mkEntityId(778);
    const aura = addCard(game, seat, ZoneType.Battlefield, auraId);
    addCard(game, seat, ZoneType.Battlefield, targetId);
    aura.intrinsicStatics = [mkAuraGrant({ auraId, grantedAbilityId })];

    runAll(game.action.attach(auraId, targetId, "cast"));
    expect(
      game.layerEngine.computeCharacteristics(targetId).abilities.some((a) => a.id === grantedAbilityId),
    ).toBe(true);

    runAll(game.action.unattach(auraId, "effect"));
    expect(
      game.layerEngine.computeCharacteristics(targetId).abilities.some((a) => a.id === grantedAbilityId),
    ).toBe(false);
  });

  it("re-attach moves the grant to the new target", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const auraId = mkEntityId(30);
    const first = mkEntityId(31);
    const second = mkEntityId(32);
    const grantedAbilityId = mkEntityId(779);
    const aura = addCard(game, seat, ZoneType.Battlefield, auraId);
    addCard(game, seat, ZoneType.Battlefield, first);
    addCard(game, seat, ZoneType.Battlefield, second);
    aura.intrinsicStatics = [mkAuraGrant({ auraId, grantedAbilityId })];

    runAll(game.action.attach(auraId, first, "cast"));
    expect(
      game.layerEngine.computeCharacteristics(first).abilities.some((a) => a.id === grantedAbilityId),
    ).toBe(true);

    // Re-attach to the second creature. attach() auto-detaches from first.
    runAll(game.action.attach(auraId, second, "activated"));

    expect(
      game.layerEngine.computeCharacteristics(first).abilities.some((a) => a.id === grantedAbilityId),
    ).toBe(false);
    expect(
      game.layerEngine.computeCharacteristics(second).abilities.some((a) => a.id === grantedAbilityId),
    ).toBe(true);
  });

  it("attach without any targetsAttached static registers nothing", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const auraId = mkEntityId(40);
    const targetId = mkEntityId(41);
    addCard(game, seat, ZoneType.Battlefield, auraId);
    addCard(game, seat, ZoneType.Battlefield, targetId);
    // Aura has no intrinsic statics.
    runAll(game.action.attach(auraId, targetId, "cast"));
    expect(game.auraGrantLedger.entriesFor(auraId)).toEqual([]);
    expect(game.layerEngine.abilityEffects).toHaveLength(0);
  });

  it("attach then unattach cleans up the ledger entry", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const auraId = mkEntityId(50);
    const targetId = mkEntityId(51);
    const grantedAbilityId = mkEntityId(780);
    const aura = addCard(game, seat, ZoneType.Battlefield, auraId);
    addCard(game, seat, ZoneType.Battlefield, targetId);
    aura.intrinsicStatics = [mkAuraGrant({ auraId, grantedAbilityId })];

    runAll(game.action.attach(auraId, targetId, "cast"));
    expect(game.auraGrantLedger.entriesFor(auraId)).toHaveLength(1);
    expect(game.layerEngine.abilityEffects).toHaveLength(1);

    runAll(game.action.unattach(auraId, "effect"));
    expect(game.auraGrantLedger.entriesFor(auraId)).toEqual([]);
    expect(game.layerEngine.abilityEffects).toHaveLength(0);
  });
});

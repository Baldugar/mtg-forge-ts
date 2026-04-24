// SPDX-License-Identifier: GPL-3.0-or-later
// Ability-granting static tests (SP2 Task 28). abilityGranting statics
// share the layer-contributor path with "continuous" statics for
// "ability"-kind payloads; this file asserts the end-to-end: register
// → Characteristics reflect the grant; unregister → grant is gone;
// multiple grants stack in Layer 6.
import type { EntityId, LobbyPlayer, PaperCard, StaticAbility } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import type { AbilityChangeEffect } from "../layers/layer6-ability.js";
import type { ContinuousPayload } from "./layer-contributors.js";

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
  name: "Grizzly Bears",
  edition: "LEA",
  collectorNumber: "1",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const makeGame = (): Game => new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });

const mkAbilityStatic = (opts: {
  id: number;
  sourceCardId: number;
  abilityId: EntityId;
  grantedBy: EntityId;
  timestamp?: number;
  category?: "continuous" | "abilityGranting";
}): StaticAbility => {
  const effect: AbilityChangeEffect = {
    kind: "add",
    abilityId: opts.abilityId,
    grantedBy: opts.grantedBy,
    origin: "layer6",
    timestamp: opts.timestamp ?? 1,
  };
  const payload: ContinuousPayload = { kind: "ability", effect };
  return {
    id: mkEntityId(opts.id),
    kind: "static",
    sourceCardId: mkEntityId(opts.sourceCardId),
    activeInZones: new Set([ZoneType.Battlefield]),
    timestamp: 1,
    controllerSeatAtReg: mkPlayerSeat(0),
    category: opts.category ?? "abilityGranting",
    mode: "Continuous",
    describe: () => payload,
  };
};

describe("ability-granting statics end-to-end (SP2 Task 28)", () => {
  it("category: abilityGranting contributes the granted ability to Layer 6", () => {
    const game = makeGame();
    const targetId = mkEntityId(1);
    game.cards.set(
      targetId,
      new Card(targetId, samplePaper, mkPlayerSeat(0), mkPlayerSeat(0), ZoneType.Battlefield),
    );
    const flyingId = mkEntityId(77);
    const s = mkAbilityStatic({ id: 5, sourceCardId: 1, abilityId: flyingId, grantedBy: mkEntityId(5) });
    game.staticEffectRegistry.register(s);
    const chars = game.layerEngine.computeCharacteristics(targetId);
    expect(chars.abilities.some((a) => a.id === flyingId)).toBe(true);
    game.staticEffectRegistry.unregister(s.id);
    const reverted = game.layerEngine.computeCharacteristics(targetId);
    expect(reverted.abilities.some((a) => a.id === flyingId)).toBe(false);
  });

  it("multiple ability-grants stack in Layer 6", () => {
    const game = makeGame();
    const targetId = mkEntityId(1);
    game.cards.set(
      targetId,
      new Card(targetId, samplePaper, mkPlayerSeat(0), mkPlayerSeat(0), ZoneType.Battlefield),
    );
    const flyingId = mkEntityId(77);
    const vigilanceId = mkEntityId(78);
    const flying = mkAbilityStatic({
      id: 5,
      sourceCardId: 1,
      abilityId: flyingId,
      grantedBy: mkEntityId(5),
    });
    const vigilance = mkAbilityStatic({
      id: 6,
      sourceCardId: 2,
      abilityId: vigilanceId,
      grantedBy: mkEntityId(6),
      timestamp: 2,
    });
    game.staticEffectRegistry.register(flying);
    game.staticEffectRegistry.register(vigilance);
    const chars = game.layerEngine.computeCharacteristics(targetId);
    const ids = chars.abilities.map((a) => a.id);
    expect(ids).toContain(flyingId);
    expect(ids).toContain(vigilanceId);
  });

  it("a category:'continuous' static with an 'ability' payload also routes to Layer 6", () => {
    // Belt-and-suspenders: the layer contributor accepts both
    // "continuous" and "abilityGranting" categories for ability-kind
    // payloads. This keeps SP3 flexible about which category its
    // ability-grant DSL decides to emit.
    const game = makeGame();
    const targetId = mkEntityId(1);
    game.cards.set(
      targetId,
      new Card(targetId, samplePaper, mkPlayerSeat(0), mkPlayerSeat(0), ZoneType.Battlefield),
    );
    const trampleId = mkEntityId(99);
    const s = mkAbilityStatic({
      id: 5,
      sourceCardId: 1,
      abilityId: trampleId,
      grantedBy: mkEntityId(5),
      category: "continuous",
    });
    game.staticEffectRegistry.register(s);
    const chars = game.layerEngine.computeCharacteristics(targetId);
    expect(chars.abilities.some((a) => a.id === trampleId)).toBe(true);
  });

  it("unregister of one of two ability grants leaves the other in place", () => {
    const game = makeGame();
    const targetId = mkEntityId(1);
    game.cards.set(
      targetId,
      new Card(targetId, samplePaper, mkPlayerSeat(0), mkPlayerSeat(0), ZoneType.Battlefield),
    );
    const a1 = mkEntityId(77);
    const a2 = mkEntityId(78);
    const s1 = mkAbilityStatic({ id: 5, sourceCardId: 1, abilityId: a1, grantedBy: mkEntityId(5) });
    const s2 = mkAbilityStatic({
      id: 6,
      sourceCardId: 2,
      abilityId: a2,
      grantedBy: mkEntityId(6),
      timestamp: 2,
    });
    game.staticEffectRegistry.register(s1);
    game.staticEffectRegistry.register(s2);
    game.staticEffectRegistry.unregister(s1.id);
    const chars = game.layerEngine.computeCharacteristics(targetId);
    const ids = chars.abilities.map((a) => a.id);
    expect(ids).not.toContain(a1);
    expect(ids).toContain(a2);
  });
});

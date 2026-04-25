// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 3 — RegenerateEffect DestroyReplacement integration tests.
// Verifies that the registered ReplacementAbility intercepts destroy intents,
// taps + clears damage on the creature, and prevents destruction.
import "./regenerate.js";
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { EngineYield } from "../../action/engine-yield.js";
import { GameAction } from "../../action/game-action.js";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { Library } from "../../zone/zones/library.js";
import { SpellAbility } from "../spell-ability.js";

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
  name: "Grizzly Bears",
  edition: "LEA",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const mkGame = () => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
  return game;
};

const drainGen = (gen: Generator<unknown, void, unknown>): EngineYield[] => {
  const yields: EngineYield[] = [];
  let r = gen.next();
  while (!r.done) {
    yields.push(r.value as EngineYield);
    const y = r.value as EngineYield;
    if (y.kind === "decision" && y.request.kind === "orderReplacements") {
      r = gen.next({ kind: "orderReplacements", order: [...y.request.replacementIds] });
    } else {
      r = gen.next();
    }
  }
  return yields;
};

describe("RegenerateEffect — DestroyReplacement (Wave 3)", () => {
  it("first destroy attempt is prevented: card stays on battlefield, tapped, damage=0", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(1);
    const targetId = mkEntityId(10);

    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    const target = new Card(targetId, paper, seat0, seat0, ZoneType.Battlefield);
    target.damage = 4; // simulate pre-existing combat damage
    game.cards.set(sourceId, source);
    game.cards.set(targetId, target);
    const battlefield = game.getPlayer(seat0).zones.get(ZoneType.Battlefield);
    if (!battlefield) throw new Error("Battlefield zone not found");
    battlefield.add(targetId);

    // Register regeneration.
    const sa = new SpellAbility(
      { kind: "spell", effect: { handlerKey: "Regenerate", params: {} }, cost: { raw: "G" } },
      sourceId,
      seat0,
      new Map(),
      [targetId],
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(game.replacementRegistry.size()).toBe(1);

    // Destroy the target via GameAction.
    const action = new GameAction(game);
    drainGen(action.destroy(targetId, { cause: "effect" }));

    // Card should still exist in game.cards (not moved to graveyard).
    expect(game.cards.has(targetId)).toBe(true);
    // Card should be tapped and damage zeroed.
    expect(target.tapped).toBe(true);
    expect(target.damage).toBe(0);
    // Shield consumed → replacement unregistered.
    expect(game.replacementRegistry.size()).toBe(0);
    expect(target.regenerationShields).toBe(0);
  });

  it("second destroy attempt after shield consumed is NOT prevented", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(1);
    const targetId = mkEntityId(10);

    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    const target = new Card(targetId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.cards.set(targetId, target);
    const battlefield = game.getPlayer(seat0).zones.get(ZoneType.Battlefield);
    if (!battlefield) throw new Error("Battlefield zone not found");
    battlefield.add(targetId);
    const graveyard = game.getPlayer(seat0).zones.get(ZoneType.Graveyard);
    void graveyard; // suppress lint

    const sa = new SpellAbility(
      { kind: "spell", effect: { handlerKey: "Regenerate", params: {} }, cost: { raw: "G" } },
      sourceId,
      seat0,
      new Map(),
      [targetId],
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    const action = new GameAction(game);

    // First destroy — intercepted.
    drainGen(action.destroy(targetId, { cause: "effect" }));
    expect(game.cards.has(targetId)).toBe(true);
    expect(target.tapped).toBe(true);

    // Second destroy — no shield left, destruction proceeds.
    drainGen(action.destroy(targetId, { cause: "effect" }));
    // Card should now be in the graveyard (moved by GameAction.destroy).
    expect(target.zone).toBe(ZoneType.Graveyard);
  });

  it("preserves legacy regenerationShields count (still increments per Regenerate call)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(1);
    const targetId = mkEntityId(10);

    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    const target = new Card(targetId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.cards.set(targetId, target);

    const mkSa = () =>
      new SpellAbility(
        { kind: "spell", effect: { handlerKey: "Regenerate", params: {} }, cost: { raw: "G" } },
        sourceId,
        seat0,
        new Map(),
        [targetId],
      );

    drainGen(mkSa().makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    drainGen(mkSa().makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(target.regenerationShields).toBe(2);
    expect(game.replacementRegistry.size()).toBe(2);
  });
});

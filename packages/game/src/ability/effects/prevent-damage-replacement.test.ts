// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 3 — PreventDamageEffect shield-consumption integration tests.
// Verifies that the registered ReplacementAbility correctly intercepts
// damage intents, consumes the shield, and unregisters when exhausted.
import "./prevent-damage.js";
import "../../svar/selectors/number.js";
import type { AbilityAst, LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
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
  name: "Test",
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
    // Auto-respond to orderReplacements decisions.
    const y = r.value as EngineYield;
    if (y.kind === "decision" && y.request.kind === "orderReplacements") {
      r = gen.next({ kind: "orderReplacements", order: [...y.request.replacementIds] });
    } else {
      r = gen.next();
    }
  }
  return yields;
};

const mkPreventAst = (amount: number, validTarget?: string): AbilityAst => ({
  kind: "spell",
  effect: {
    handlerKey: "PreventDamage",
    params: {
      Amount: { kind: "literal", raw: String(amount) },
      ...(validTarget !== undefined ? { ValidTarget: { kind: "literal", raw: validTarget } } : {}),
    },
  },
  cost: { raw: "" },
});

describe("PreventDamageEffect — shield consumption (Wave 3)", () => {
  it("shield of 3 partially prevents 5-damage event → 2 damage lands, shield consumed", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const damageSourceId = mkEntityId(20);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    // Cast PreventDamage 3 — registers the replacement.
    const sa = new SpellAbility(mkPreventAst(3, "You"), sourceId, seat0, new Map(), []);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(game.replacementRegistry.size()).toBe(1);
    expect(game.getPlayer(seat0).damagePreventionShield).toBe(3);

    // Deal 5 damage to the player — shield reduces it to 2.
    const action = new GameAction(game);
    drainGen(action.damage(damageSourceId, "player", seat0, 5, false));

    expect(game.getPlayer(seat0).life).toBe(20 - 2); // 18
    // Shield fully consumed → replacement auto-unregistered.
    expect(game.replacementRegistry.size()).toBe(0);
    expect(game.getPlayer(seat0).damagePreventionShield).toBe(0);
  });

  it("shield of 5 fully prevents 3-damage event → no damage lands, shield = 2 remaining", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const damageSourceId = mkEntityId(20);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    const sa = new SpellAbility(mkPreventAst(5, "You"), sourceId, seat0, new Map(), []);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    const action = new GameAction(game);
    drainGen(action.damage(damageSourceId, "player", seat0, 3, false));

    expect(game.getPlayer(seat0).life).toBe(20); // no damage
    expect(game.replacementRegistry.size()).toBe(1); // still active
    expect(game.getPlayer(seat0).damagePreventionShield).toBe(2);
  });

  it("shield consumed across multiple damage events", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const damageSourceId = mkEntityId(20);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    // Shield = 3
    const sa = new SpellAbility(mkPreventAst(3, "You"), sourceId, seat0, new Map(), []);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    const action = new GameAction(game);

    // First hit: 5 damage → shield reduces to 0, 2 lands. Life = 18.
    drainGen(action.damage(damageSourceId, "player", seat0, 5, false));
    expect(game.getPlayer(seat0).life).toBe(18);
    expect(game.replacementRegistry.size()).toBe(0);

    // Second hit: shield is gone, full 5 lands. Life = 13.
    drainGen(action.damage(damageSourceId, "player", seat0, 5, false));
    expect(game.getPlayer(seat0).life).toBe(13);
  });

  it("shields for different players don't interfere", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const sourceId = mkEntityId(10);
    const damageSourceId = mkEntityId(20);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    // Player 0 gets shield of 3; player 1 gets no shield.
    const sa = new SpellAbility(mkPreventAst(3, "You"), sourceId, seat0, new Map(), []);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    const action = new GameAction(game);
    // 5 damage to player 1 — no shield, full damage.
    drainGen(action.damage(damageSourceId, "player", seat1, 5, false));
    expect(game.getPlayer(seat1).life).toBe(15);
    // Player 0's shield is untouched.
    expect(game.getPlayer(seat0).damagePreventionShield).toBe(3);
    expect(game.replacementRegistry.size()).toBe(1);
  });
});

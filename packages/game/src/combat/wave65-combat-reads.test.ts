// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 65.A — combat-handler reads on stamped flags. Verifies that
// previously-registered static gates + card flags are now consulted at
// the right combat decision points:
//
//   1. Decayed (CR 702.176) — can't block; sacrificed at end of combat
//      after attacking.
//   2. CantAttack static (Wave 50) — rejects attacker declarations.
//   3. MustAttack static (Wave 50) — auto-adds matched creatures to
//      the attackers list.
//   4. card.enteredAttacking (Wave 53) — pulls ETB-as-attacking creatures
//      into the attackers list and clears the flag.
import type { LobbyPlayer, PaperCard, StaticAbility } from "@mtg-forge-ts/core";
import {
  DEFAULT_PAPER_CARD_FLAGS,
  IllegalDecisionError,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import type { Restriction } from "../statics/cant-must-may.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";
import { CombatHandler } from "./combat-handler.js";

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
  cardDataSyncedAt: "2026-04-28T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "wave65",
};

const ALICE = mkPlayerSeat(0);
const BOB = mkPlayerSeat(1);

const paper: PaperCard = {
  name: "T",
  edition: "TST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  game.activePlayer = ALICE;
  for (const p of game.players) {
    p.zones.set(ZoneType.Library, new Library(ZoneType.Library, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
    p.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p.seat));
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
  }
  return game;
};

const mkCard = (game: Game, id: number, seat = ALICE): Card => {
  const cid = mkEntityId(id);
  const card = new Card(cid, paper, seat, seat, ZoneType.Battlefield);
  game.cards.set(cid, card);
  // Register on the controller's battlefield zone so SBA / sacrifice can
  // locate it.
  const bf = game.getPlayer(seat).zones.get(ZoneType.Battlefield);
  bf?.add(cid);
  return card;
};

// Build a Restriction-bearing StaticAbility and register it directly on
// the game.staticEffectRegistry. Bypasses the StaticHandler.build path
// (that path has parser-side wiring we don't need here); the registry is
// the source of truth that gatherRestrictions reads.
const registerRestriction = (game: Game, id: number, restriction: Restriction): void => {
  const s: StaticAbility = {
    id: mkEntityId(id),
    kind: "static",
    sourceCardId: mkEntityId(id + 1000),
    activeInZones: new Set([ZoneType.Battlefield]),
    timestamp: 1,
    controllerSeatAtReg: ALICE,
    category: "cantMustMay",
    mode: "CantAttack",
    describe: () => restriction,
  };
  game.staticEffectRegistry.register(s);
};

const drainGen = (gen: Generator<unknown, void, unknown>): void => {
  let n = gen.next();
  while (!n.done) n = gen.next();
};

describe("Wave 65.A — combat-handler reads on stamped flags", () => {
  // Read 1 — Decayed can't block.
  it("decayed creature can't be declared as a blocker (throws IllegalDecisionError)", () => {
    const game = mkGame();
    const attackerId = mkEntityId(1);
    const blockerId = mkEntityId(10);
    mkCard(game, 1);
    const blocker = mkCard(game, 10, BOB);
    blocker.decayed = true;
    const handler = new CombatHandler(game);
    handler.declareAttackers([{ attackerId, defender: { kind: "player", seat: BOB } }]);
    expect(() => handler.declareBlockers([{ blockerId, attackerIds: [attackerId] }])).toThrow(
      IllegalDecisionError,
    );
  });

  // Read 1 — Decayed sacrifices at EOC after attacking.
  it("decayed creature that attacked is sacrificed at end of combat", () => {
    const game = mkGame();
    const attackerId = mkEntityId(2);
    const card = mkCard(game, 2);
    card.decayed = true;
    const handler = new CombatHandler(game);
    handler.declareAttackers([{ attackerId, defender: { kind: "player", seat: BOB } }]);
    expect(card.attackedThisCombat).toBe(true);
    drainGen(handler.endOfCombat());
    // Card has moved to graveyard via sacrifice.
    expect(card.zone).toBe(ZoneType.Graveyard);
    // attackedThisCombat is cleared on every card.
    expect(card.attackedThisCombat).toBe(false);
  });

  // Read 2 — CantAttack rejects declarations.
  it("CantAttack static rejects an attacker declaration", () => {
    const game = mkGame();
    const attackerId = mkEntityId(3);
    mkCard(game, 3);
    registerRestriction(game, 100, {
      sourceStaticId: mkEntityId(100),
      kind: "cantAttack",
      subjectFilter: (id) => id === attackerId,
    });
    const handler = new CombatHandler(game);
    expect(() => handler.declareAttackers([{ attackerId, defender: { kind: "player", seat: BOB } }])).toThrow(
      IllegalDecisionError,
    );
  });

  // Read 3 — MustAttack auto-adds.
  it("MustAttack static forces matching creature into the attackers list (auto-correct)", () => {
    const game = mkGame();
    const requiredId = mkEntityId(4);
    mkCard(game, 4);
    registerRestriction(game, 200, {
      sourceStaticId: mkEntityId(200),
      kind: "mustAttack",
      subjectFilter: (id) => id === requiredId,
    });
    const handler = new CombatHandler(game);
    // Player declares NO attackers; auto-correct should pull the
    // must-attack creature in anyway.
    handler.declareAttackers([]);
    expect(handler.state.attackers.has(requiredId)).toBe(true);
    const info = handler.state.attackers.get(requiredId);
    if (!info) throw new Error("expected attacker info");
    expect(info.defender.kind).toBe("player");
    if (info.defender.kind === "player") {
      // First non-active opponent → Bob.
      expect(info.defender.seat).toBe(BOB);
    }
    const card = game.cards.get(requiredId);
    expect(card?.attackedThisCombat).toBe(true);
  });

  // Read 4 — enteredAttacking adds + clears flag.
  it("enteredAttacking + attackingDefender stamps cause the creature to be added to attackers; flag cleared", () => {
    const game = mkGame();
    const tokenId = mkEntityId(5);
    const tok = mkCard(game, 5);
    tok.enteredAttacking = true;
    (tok as unknown as { attackingDefender?: number }).attackingDefender = BOB as unknown as number;
    const handler = new CombatHandler(game);
    handler.declareAttackers([]);
    expect(handler.state.attackers.has(tokenId)).toBe(true);
    expect(tok.enteredAttacking).toBe(false);
    expect((tok as unknown as { attackingDefender?: unknown }).attackingDefender).toBeUndefined();
    expect(tok.attackedThisCombat).toBe(true);
  });

  // Read 4 follow-up — flag cleared after first combat means second combat
  // does NOT re-add the creature.
  it("enteredAttacking flag is cleared after first combat — second combat does not re-add", () => {
    const game = mkGame();
    const tokenId = mkEntityId(6);
    const tok = mkCard(game, 6);
    tok.enteredAttacking = true;
    (tok as unknown as { attackingDefender?: number }).attackingDefender = BOB as unknown as number;
    const handler = new CombatHandler(game);
    handler.declareAttackers([]);
    expect(handler.state.attackers.has(tokenId)).toBe(true);
    // Run end-of-combat to clear attackedThisCombat.
    drainGen(handler.endOfCombat());
    handler.clear();
    // Second combat — no new declarations, no enteredAttacking.
    handler.declareAttackers([]);
    expect(handler.state.attackers.has(tokenId)).toBe(false);
  });
});

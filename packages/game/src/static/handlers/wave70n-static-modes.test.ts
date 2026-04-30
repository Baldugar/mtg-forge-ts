// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.N — AssignNoCombatDamage static mode regression tests.
// Covers:
//   - Registration smoke for AssignNoCombatDamage.
//   - assignsNoCombatDamage helper / attackerPower returns 0 on match.
//   - Filter: non-matched attacker still deals normal damage.
//   - Combination with CombatDamageToughness: AssignNoCombatDamage wins
//     (0 trumps toughness substitution — matches Forge: ANCD short-
//     circuits before CombatDamageToughness applies).
//   - Lifecycle: deactivation reverses the gate.
import type {
  LobbyPlayer,
  ManaCostAst,
  PaperCard,
  StaticAbility,
  StaticAbilityMode,
  StaticAst,
} from "@mtg-forge-ts/core";
import {
  DEFAULT_PAPER_CARD_FLAGS,
  SeededRng,
  TypeLine,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import { attackerPower } from "../../combat/damage-assignment-helpers.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { assignsNoCombatDamage } from "../../statics/wave70n-combat-gates.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { Library } from "../../zone/zones/library.js";
import { staticHandlerRegistry } from "../static-handler.js";
// Side-effect: register every handler.
import "./index.js";

// ── fixtures ─────────────────────────────────────────────────────────────────
const alice: LobbyPlayer = { id: "P0", name: "P0", controllerKind: "human" };
const bob: LobbyPlayer = { id: "P1", name: "P1", controllerKind: "human" };
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
  forgeSha: "test",
  cardDataSyncedAt: "2026-04-26T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "deadbeef",
};

const mkGame = (): Game => {
  const game = new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(0xdeadbeefn),
  });
  for (const p of game.players) {
    p.zones.set(ZoneType.Library, new Library(ZoneType.Library, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
    p.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p.seat));
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
  }
  return game;
};

const mkPaper = (name: string, types = "Creature — Bear", manaCostRaw = "1G"): PaperCard => {
  const isCreature = types.includes("Creature");
  return {
    name,
    edition: "TEST",
    collectorNumber: "001",
    language: "en",
    foil: false,
    flags: DEFAULT_PAPER_CARD_FLAGS,
    definition: {
      name,
      oracle: "",
      types: TypeLine.parse(types),
      manaCost: { raw: manaCostRaw, symbols: [] } satisfies ManaCostAst,
      ...(isCreature ? { pt: { power: "2", toughness: "5" } } : {}),
      abilities: [],
      triggers: [],
      replacements: [],
      statics: [],
      keywords: [],
      svars: new Map(),
    },
  };
};

interface MintOpts {
  readonly game: Game;
  readonly id: number;
  readonly paper: PaperCard;
  readonly seat?: 0 | 1;
  readonly zone?: ZoneType;
}
const mintCard = (opts: MintOpts): Card => {
  const cid = mkEntityId(opts.id);
  const seat = mkPlayerSeat(opts.seat ?? 0);
  const card = new Card(cid, opts.paper, seat, seat, opts.zone ?? ZoneType.Battlefield);
  opts.game.cards.set(cid, card);
  const z = opts.game.getPlayer(seat).zones.get(opts.zone ?? ZoneType.Battlefield);
  z?.add(cid);
  return card;
};

const buildAndRegister = (
  game: Game,
  ast: StaticAst,
  sourceCardId: number,
  staticIdSeed: number,
  controllerSeat: 0 | 1 = 0,
): StaticAbility => {
  const Cls = staticHandlerRegistry.lookup(ast.mode as StaticAbilityMode);
  if (!Cls) throw new Error(`mode ${ast.mode} not registered`);
  const s = new Cls().build(ast, {
    game,
    sourceCardId: mkEntityId(sourceCardId),
    controllerSeat: mkPlayerSeat(controllerSeat),
    staticId: mkEntityId(staticIdSeed),
  });
  game.staticEffectRegistry.register(s);
  return s;
};

// ── registration smoke ───────────────────────────────────────────────────────
describe("Wave 70.N — registration smoke", () => {
  it("mode 'AssignNoCombatDamage' is registered", () => {
    expect(staticHandlerRegistry.has("AssignNoCombatDamage")).toBe(true);
  });
});

// ── AssignNoCombatDamage — Sunhome Enforcer / Indomitable Ancients ───────────
describe("Wave 70.N — AssignNoCombatDamage", () => {
  it("attackerPower returns 0 when an active static matches the attacker (2/5 deals 0)", () => {
    const g = mkGame();
    const attacker = mintCard({ game: g, id: 7700, paper: mkPaper("Bear"), seat: 0 });
    // Without the static: 2/5 deals power=2.
    expect(attackerPower(g, attacker.id)).toBe(2);
    buildAndRegister(
      g,
      {
        mode: "AssignNoCombatDamage",
        params: { ValidCard: { kind: "literal", raw: "Creature.YouCtrl" } },
        activeInZones: [],
      },
      7701,
      97701,
    );
    // With the static: 2/5 deals 0 regardless of power.
    expect(assignsNoCombatDamage(g, attacker.id)).toBe(true);
    expect(attackerPower(g, attacker.id)).toBe(0);
  });

  it("filter: non-matched attacker still deals normal damage", () => {
    const g = mkGame();
    const matched = mintCard({ game: g, id: 7710, paper: mkPaper("Mine"), seat: 0 });
    const opponent = mintCard({ game: g, id: 7711, paper: mkPaper("Theirs"), seat: 1 });
    // Filter: only seat-0's creatures deal no combat damage.
    buildAndRegister(
      g,
      {
        mode: "AssignNoCombatDamage",
        params: { ValidCard: { kind: "literal", raw: "Creature.YouCtrl" } },
        activeInZones: [],
      },
      7712,
      97712,
      0,
    );
    expect(assignsNoCombatDamage(g, matched.id)).toBe(true);
    expect(attackerPower(g, matched.id)).toBe(0);
    // Opponent's creature is not matched by Creature.YouCtrl (You = seat 0),
    // so normal power applies.
    expect(assignsNoCombatDamage(g, opponent.id)).toBe(false);
    expect(attackerPower(g, opponent.id)).toBe(2);
  });

  it("AssignNoCombatDamage takes precedence over CombatDamageToughness (0 wins, not toughness)", () => {
    const g = mkGame();
    const attacker = mintCard({ game: g, id: 7720, paper: mkPaper("Bear"), seat: 0 });
    // Doran-shape: would normally swap power(2) for toughness(5).
    buildAndRegister(
      g,
      {
        mode: "CombatDamageToughness",
        params: { ValidCard: { kind: "literal", raw: "Creature" } },
        activeInZones: [],
      },
      7721,
      97721,
    );
    expect(attackerPower(g, attacker.id)).toBe(5);
    // AssignNoCombatDamage layered on: 0 short-circuits toughness substitution.
    buildAndRegister(
      g,
      {
        mode: "AssignNoCombatDamage",
        params: { ValidCard: { kind: "literal", raw: "Creature" } },
        activeInZones: [],
      },
      7722,
      97722,
    );
    expect(attackerPower(g, attacker.id)).toBe(0);
  });

  it("Card.Self filter only matches the source card", () => {
    const g = mkGame();
    const self = mintCard({ game: g, id: 7730, paper: mkPaper("SelfBear"), seat: 0 });
    const other = mintCard({ game: g, id: 7731, paper: mkPaper("OtherBear"), seat: 0 });
    buildAndRegister(
      g,
      {
        mode: "AssignNoCombatDamage",
        params: { ValidCard: { kind: "literal", raw: "Creature.Self" } },
        activeInZones: [],
      },
      self.id as unknown as number,
      97732,
    );
    expect(assignsNoCombatDamage(g, self.id)).toBe(true);
    expect(assignsNoCombatDamage(g, other.id)).toBe(false);
  });

  it("lifecycle: deregister returns the attacker to power-based combat damage", () => {
    const g = mkGame();
    const attacker = mintCard({ game: g, id: 7740, paper: mkPaper("Bear"), seat: 0 });
    const s = buildAndRegister(
      g,
      {
        mode: "AssignNoCombatDamage",
        params: { ValidCard: { kind: "literal", raw: "Creature" } },
        activeInZones: [],
      },
      7741,
      97741,
    );
    expect(attackerPower(g, attacker.id)).toBe(0);
    g.staticEffectRegistry.unregister(s.id);
    expect(assignsNoCombatDamage(g, attacker.id)).toBe(false);
    expect(attackerPower(g, attacker.id)).toBe(2);
  });
});

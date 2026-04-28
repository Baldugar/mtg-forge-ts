// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 60.D — turn-structure modifier statics regression tests.
// Covers:
//   - Registration smoke for LimitOnHandSize / AdditionalCombatPhase.
//   - LimitOnHandSize: Reliquary Tower-shape — player has 12 cards, no
//     discard at cleanup (effectiveMaxHandSize returns Infinity).
//   - AdditionalCombatPhase static stamps the per-seat counter on
//     activate; phase handler grants an extra combat after end-of-combat.
//   - AB$ AdditionalCombat effect bumps the counter; phase handler
//     consumes one at end-of-combat and injects an extra combat block.
import type {
  LobbyPlayer,
  PaperCard,
  PlayerSeat,
  SVarAst,
  StaticAbility,
  StaticAbilityMode,
  StaticAst,
} from "@mtg-forge-ts/core";
import {
  DEFAULT_PAPER_CARD_FLAGS,
  PhaseStep,
  SeededRng,
  TypeLine,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { PhaseHandler } from "../../phase/phase-handler.js";
import {
  consumePendingAdditionalCombat,
  effectiveMaxHandSize,
  pendingAdditionalCombatCount,
} from "../../statics/wave60-turn-structure-gates.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { Library } from "../../zone/zones/library.js";
import { staticHandlerRegistry } from "../static-handler.js";
// Side-effect: the barrel registers every Wave-60 handler.
import "./index.js";
// Side-effect: register the AB$ AdditionalCombat effect handler.
import "../../ability/effects/additional-combat.js";
import { SpellAbility } from "../../ability/spell-ability.js";

// ── fixtures (lifted from wave60-permission-gates.test.ts) ───────────────────
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
  game.activePlayer = mkPlayerSeat(0);
  game.phase = PhaseStep.Main1;
  return game;
};

const mkPaper = (name: string, types = "Creature — Bear"): PaperCard => ({
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
    manaCost: { raw: "1G", symbols: [] },
    pt: { power: "2", toughness: "2" },
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars: new Map(),
  },
});

interface MintOpts {
  readonly game: Game;
  readonly id: number;
  readonly paper: PaperCard;
  readonly seat?: 0 | 1;
  readonly zone?: ZoneType;
}
const mintCard = (opts: MintOpts): Card => {
  const cid = mkEntityId(opts.id);
  const seat: PlayerSeat = mkPlayerSeat(opts.seat ?? 0);
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
describe("Wave 60.D — every new mode has a registered handler", () => {
  const modes: readonly StaticAbilityMode[] = ["LimitOnHandSize", "AdditionalCombatPhase"];
  for (const m of modes) {
    it(`mode '${m}' is registered`, () => {
      expect(staticHandlerRegistry.has(m)).toBe(true);
    });
  }
});

// ── LimitOnHandSize (Reliquary Tower-shape) ──────────────────────────────────
describe("Wave 60.D — LimitOnHandSize", () => {
  it("default (no static): effectiveMaxHandSize returns 7", () => {
    const g = mkGame();
    expect(effectiveMaxHandSize(g, mkPlayerSeat(0))).toBe(7);
  });

  it("Amount$ Unlimited returns POSITIVE_INFINITY for the matching seat", () => {
    const g = mkGame();
    buildAndRegister(
      g,
      {
        mode: "LimitOnHandSize",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          Amount: { kind: "literal", raw: "Unlimited" },
        },
        activeInZones: [],
      },
      9700,
      99700,
      0,
    );
    expect(effectiveMaxHandSize(g, mkPlayerSeat(0))).toBe(Number.POSITIVE_INFINITY);
    // The opponent (seat 1) is NOT covered by ValidPlayer$ You — they
    // still see the default cap.
    expect(effectiveMaxHandSize(g, mkPlayerSeat(1))).toBe(7);
  });

  it("Amount$ <literal N> returns that integer", () => {
    const g = mkGame();
    buildAndRegister(
      g,
      {
        mode: "LimitOnHandSize",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          Amount: { kind: "literal", raw: "10" },
        },
        activeInZones: [],
      },
      9710,
      99710,
      0,
    );
    expect(effectiveMaxHandSize(g, mkPlayerSeat(0))).toBe(10);
  });

  it("Reliquary Tower-shape: 12 cards in hand, NO discard at cleanup", () => {
    const g = mkGame();
    // Stamp Reliquary Tower's static for player 0.
    buildAndRegister(
      g,
      {
        mode: "LimitOnHandSize",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          Amount: { kind: "literal", raw: "Unlimited" },
        },
        activeInZones: [],
      },
      9720,
      99720,
      0,
    );
    // Put 12 cards in player 0's hand.
    const hand = g.getPlayer(mkPlayerSeat(0)).zones.get(ZoneType.Hand);
    if (!hand) throw new Error("hand missing");
    for (let i = 0; i < 12; i++) {
      const c = mintCard({
        game: g,
        id: 10000 + i,
        paper: mkPaper(`Filler ${i}`, "Instant"),
        seat: 0,
        zone: ZoneType.Hand,
      });
      // mintCard already adds to hand; just assert.
      void c;
    }
    expect(hand.size).toBe(12);
    // Drive cleanup-step turn-based actions.
    const ph = new PhaseHandler(g);
    g.phase = PhaseStep.Cleanup;
    const yields: unknown[] = [];
    const gen = ph.performTurnBasedActions(PhaseStep.Cleanup, mkPlayerSeat(0));
    let r = gen.next();
    while (!r.done) {
      yields.push(r.value);
      r = gen.next();
    }
    expect(hand.size).toBe(12);
  });

  it("Default cap (no static): 9 cards in hand, 2 are discarded at cleanup", () => {
    const g = mkGame();
    const hand = g.getPlayer(mkPlayerSeat(0)).zones.get(ZoneType.Hand);
    const gy = g.getPlayer(mkPlayerSeat(0)).zones.get(ZoneType.Graveyard);
    if (!hand || !gy) throw new Error("zones missing");
    for (let i = 0; i < 9; i++) {
      mintCard({
        game: g,
        id: 11000 + i,
        paper: mkPaper(`Filler ${i}`, "Instant"),
        seat: 0,
        zone: ZoneType.Hand,
      });
    }
    expect(hand.size).toBe(9);
    expect(gy.size).toBe(0);
    const ph = new PhaseHandler(g);
    g.phase = PhaseStep.Cleanup;
    const gen = ph.performTurnBasedActions(PhaseStep.Cleanup, mkPlayerSeat(0));
    let r = gen.next();
    while (!r.done) r = gen.next();
    expect(hand.size).toBe(7);
    expect(gy.size).toBe(2);
  });
});

// ── AdditionalCombatPhase ────────────────────────────────────────────────────
describe("Wave 60.D — AdditionalCombatPhase static", () => {
  it("static stamps pendingAdditionalCombatPhases on activate (Aurelia-shape)", () => {
    const g = mkGame();
    const seat0 = mkPlayerSeat(0);
    expect(pendingAdditionalCombatCount(g, seat0)).toBe(0);
    buildAndRegister(
      g,
      {
        mode: "AdditionalCombatPhase",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
        },
        activeInZones: [],
      },
      9800,
      99800,
      0,
    );
    expect(pendingAdditionalCombatCount(g, seat0)).toBe(1);
    // Opponent untouched.
    expect(pendingAdditionalCombatCount(g, mkPlayerSeat(1))).toBe(0);
  });

  it("phase handler injects extra combat at EndOfCombat when a pending entry exists", () => {
    const g = mkGame();
    const seat0 = mkPlayerSeat(0);
    // Stamp one pending combat directly on flags (skip building the static —
    // we want to test the phase-handler consume path in isolation).
    g.flags.pendingAdditionalCombatPhases.set(seat0, 1);
    const ph = new PhaseHandler(g);
    const lenBefore = ph.phaseSequence.getSteps().length;
    g.phase = PhaseStep.EndOfCombat;
    const gen = ph.performTurnBasedActions(PhaseStep.EndOfCombat, seat0);
    let r = gen.next();
    while (!r.done) r = gen.next();
    const lenAfter = ph.phaseSequence.getSteps().length;
    // injectExtraCombat appends 6 steps (BeginCombat → EndOfCombat).
    expect(lenAfter - lenBefore).toBe(6);
    // The counter is now drained.
    expect(pendingAdditionalCombatCount(g, seat0)).toBe(0);
  });

  it("phase handler does NOT inject extra combat when no pending entry", () => {
    const g = mkGame();
    const seat0 = mkPlayerSeat(0);
    const ph = new PhaseHandler(g);
    const lenBefore = ph.phaseSequence.getSteps().length;
    g.phase = PhaseStep.EndOfCombat;
    const gen = ph.performTurnBasedActions(PhaseStep.EndOfCombat, seat0);
    let r = gen.next();
    while (!r.done) r = gen.next();
    const lenAfter = ph.phaseSequence.getSteps().length;
    expect(lenAfter).toBe(lenBefore);
  });
});

// ── AB$ AdditionalCombat effect (Aggravated Assault et al.) ──────────────────
describe("Wave 60.D — AdditionalCombat effect", () => {
  it("AB$ AdditionalCombat increments the per-seat counter", () => {
    const g = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(900);
    g.cards.set(
      sourceId,
      new Card(sourceId, mkPaper("Aggravated Assault", "Enchantment"), seat0, seat0, ZoneType.Battlefield),
    );
    expect(pendingAdditionalCombatCount(g, seat0)).toBe(0);
    const sa = new SpellAbility(
      {
        kind: "activated",
        effect: { handlerKey: "AdditionalCombat", params: {} },
        cost: { raw: "5" },
      },
      sourceId,
      seat0,
      new Map<string, SVarAst>(),
      [],
    );
    const gen = sa.makeResolver().resolve(g) as Generator<unknown, void, unknown>;
    let r = gen.next();
    while (!r.done) r = gen.next();
    expect(pendingAdditionalCombatCount(g, seat0)).toBe(1);
  });

  it("phase handler consumes the AB$-bumped counter at EndOfCombat", () => {
    const g = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(910);
    g.cards.set(
      sourceId,
      new Card(sourceId, mkPaper("Hellkite Charger", "Creature"), seat0, seat0, ZoneType.Battlefield),
    );
    // Resolve the effect once.
    const sa = new SpellAbility(
      {
        kind: "activated",
        effect: { handlerKey: "AdditionalCombat", params: {} },
        cost: { raw: "" },
      },
      sourceId,
      seat0,
      new Map<string, SVarAst>(),
      [],
    );
    const gen1 = sa.makeResolver().resolve(g) as Generator<unknown, void, unknown>;
    let r1 = gen1.next();
    while (!r1.done) r1 = gen1.next();
    expect(pendingAdditionalCombatCount(g, seat0)).toBe(1);
    // Now drive EndOfCombat — should consume + inject.
    const ph = new PhaseHandler(g);
    const lenBefore = ph.phaseSequence.getSteps().length;
    g.phase = PhaseStep.EndOfCombat;
    const gen2 = ph.performTurnBasedActions(PhaseStep.EndOfCombat, seat0);
    let r2 = gen2.next();
    while (!r2.done) r2 = gen2.next();
    expect(ph.phaseSequence.getSteps().length - lenBefore).toBe(6);
    // Pure consumption.
    expect(consumePendingAdditionalCombat(g, seat0)).toBe(false);
  });
});

// ── helpers tests ────────────────────────────────────────────────────────────
describe("Wave 60.D — wave60-turn-structure-gates helpers", () => {
  it("consumePendingAdditionalCombat returns false when nothing pending", () => {
    const g = mkGame();
    expect(consumePendingAdditionalCombat(g, mkPlayerSeat(0))).toBe(false);
  });

  it("consumePendingAdditionalCombat decrements correctly across multiple calls", () => {
    const g = mkGame();
    const seat0 = mkPlayerSeat(0);
    g.flags.pendingAdditionalCombatPhases.set(seat0, 2);
    expect(consumePendingAdditionalCombat(g, seat0)).toBe(true);
    expect(pendingAdditionalCombatCount(g, seat0)).toBe(1);
    expect(consumePendingAdditionalCombat(g, seat0)).toBe(true);
    expect(pendingAdditionalCombatCount(g, seat0)).toBe(0);
    expect(consumePendingAdditionalCombat(g, seat0)).toBe(false);
  });
});

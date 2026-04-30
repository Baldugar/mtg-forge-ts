// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.O — three more registry-walk gate statics regression tests.
// Covers:
//   - Registration smoke for CantPhaseIn / CantPhaseOut /
//     CantChangeLife.
//   - CantPhaseIn: canPhaseIn helper false on match; phaseIn no-ops
//     silently (no PhasedIn event; card stays phased out).
//   - CantPhaseOut: canPhaseOut helper false on match; phaseOut
//     no-ops silently (no PhasedOut event; card stays phased in).
//   - CantChangeLife: canChangeLife helper false on match; both
//     positive and negative changeLife rewritten to 0 (LifeChanged
//     still fires with delta 0; player.life unchanged).
//   - Lifecycle: deactivation reverses each gate.
import type {
  GameEvent,
  LobbyPlayer,
  PaperCard,
  PlayerSeat,
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
import type { EngineYield } from "../../action/engine-yield.js";
import { GameAction } from "../../action/game-action.js";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { phaseIn, phaseOut } from "../../phasing/phasing-ops.js";
import { canChangeLife, canPhaseIn, canPhaseOut } from "../../statics/wave70o-gate-helpers.js";
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

const collectEvents = (yields: readonly EngineYield[]): readonly GameEvent[] =>
  yields.filter((y) => y.kind === "event").map((y) => (y as { event: GameEvent }).event);

const collect = (g: Generator<EngineYield, void, unknown>): EngineYield[] => {
  const out: EngineYield[] = [];
  for (const y of g) out.push(y);
  return out;
};

// ── registration smoke ───────────────────────────────────────────────────────
describe("Wave 70.O — registration smoke", () => {
  const modes: readonly StaticAbilityMode[] = ["CantPhaseIn", "CantPhaseOut", "CantChangeLife"];
  for (const m of modes) {
    it(`mode '${m}' is registered`, () => {
      expect(staticHandlerRegistry.has(m)).toBe(true);
    });
  }
});

// ── CantPhaseIn ──────────────────────────────────────────────────────────────
describe("Wave 70.O — CantPhaseIn", () => {
  it("smoke + canPhaseIn false; phaseIn no-ops silently when matched", () => {
    const g = mkGame();
    const card = mintCard({
      game: g,
      id: 9000,
      paper: mkPaper("Phased-out Bear"),
      seat: 0,
    });
    // Pre-condition: card is phased out (so phaseIn would normally
    // restore it).
    card.phased = true;

    // No gate yet — canPhaseIn permits.
    expect(canPhaseIn(g, card.id)).toBe(true);

    // Stamp ValidCard$ Card.Self gate sourced from this card.
    buildAndRegister(
      g,
      {
        mode: "CantPhaseIn",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      card.id as unknown as number,
      99000,
      0,
    );
    expect(canPhaseIn(g, card.id)).toBe(false);

    const yields = collect(phaseIn(g, card.id));
    const events = collectEvents(yields);

    // No PhasedIn event fires when the gate matches.
    expect(events.find((e) => e.kind === "PhasedIn")).toBeUndefined();
    // Card stays phased out.
    expect(card.phased).toBe(true);
  });

  it("non-matching cards are not affected by the gate", () => {
    const g = mkGame();
    const sourceCard = mintCard({
      game: g,
      id: 9100,
      paper: mkPaper("Source"),
      seat: 0,
    });
    const otherCard = mintCard({
      game: g,
      id: 9101,
      paper: mkPaper("Other Bear"),
      seat: 0,
    });
    otherCard.phased = true;

    // Card.Self gate scoped to the source — does NOT match otherCard.
    buildAndRegister(
      g,
      {
        mode: "CantPhaseIn",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      sourceCard.id as unknown as number,
      99100,
      0,
    );
    expect(canPhaseIn(g, otherCard.id)).toBe(true);

    const yields = collect(phaseIn(g, otherCard.id));
    const events = collectEvents(yields);
    // PhasedIn event fires; card phases in.
    expect(events.find((e) => e.kind === "PhasedIn")).toBeDefined();
    expect(otherCard.phased).toBe(false);
  });
});

// ── CantPhaseOut ─────────────────────────────────────────────────────────────
describe("Wave 70.O — CantPhaseOut", () => {
  it("smoke + canPhaseOut false; phaseOut no-ops silently when matched", () => {
    const g = mkGame();
    const card = mintCard({
      game: g,
      id: 9200,
      paper: mkPaper("Anti-phasing Bear"),
      seat: 0,
    });
    // Pre-condition: card is phased in (phaseOut would normally flip it).
    card.phased = false;

    expect(canPhaseOut(g, card.id)).toBe(true);

    buildAndRegister(
      g,
      {
        mode: "CantPhaseOut",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      card.id as unknown as number,
      99200,
      0,
    );
    expect(canPhaseOut(g, card.id)).toBe(false);

    const yields = collect(phaseOut(g, card.id));
    const events = collectEvents(yields);

    // No PhasedOut event fires when the gate matches.
    expect(events.find((e) => e.kind === "PhasedOut")).toBeUndefined();
    // Card stays phased in.
    expect(card.phased).toBe(false);
  });
});

// ── CantChangeLife ───────────────────────────────────────────────────────────
describe("Wave 70.O — CantChangeLife", () => {
  it("smoke + canChangeLife false; both positive and negative deltas rewritten to 0", () => {
    const g = mkGame();
    const seat = mkPlayerSeat(0);
    // Platinum Emperion-shape: ValidPlayer$ You — only seat 0 (the
    // static's controller) is gated.
    buildAndRegister(
      g,
      {
        mode: "CantChangeLife",
        params: { ValidPlayer: { kind: "literal", raw: "You" } },
        activeInZones: [],
      },
      9300,
      99300,
      0,
    );
    expect(canChangeLife(g, seat)).toBe(false);
    expect(canChangeLife(g, mkPlayerSeat(1))).toBe(true);

    const player = g.getPlayer(seat);
    const startingLife = player.life;
    const action = new GameAction(g);

    // Positive delta — gain blocked.
    let yields = collect(action.changeLife(seat, 5, { cause: "gain" }));
    let events = collectEvents(yields);
    let lc = events.find((e) => e.kind === "LifeChanged");
    expect(lc).toBeDefined();
    expect((lc as { payload: { delta: number } } | undefined)?.payload.delta).toBe(0);
    expect(player.life).toBe(startingLife);

    // Negative delta — loss blocked.
    yields = collect(action.changeLife(seat, -7, { cause: "damage" }));
    events = collectEvents(yields);
    lc = events.find((e) => e.kind === "LifeChanged");
    expect(lc).toBeDefined();
    expect((lc as { payload: { delta: number } } | undefined)?.payload.delta).toBe(0);
    expect(player.life).toBe(startingLife);

    // Per-turn life-gain / life-loss trackers stay zero.
    expect(g.flags.lifeGainedThisTurn.get(seat) ?? 0).toBe(0);
    expect(g.flags.lifeLostThisTurn.get(seat) ?? 0).toBe(0);
  });

  it("non-matching seat is unaffected by the gate", () => {
    const g = mkGame();
    // ValidPlayer$ You with controller seat 0 → only seat 0 gated.
    buildAndRegister(
      g,
      {
        mode: "CantChangeLife",
        params: { ValidPlayer: { kind: "literal", raw: "You" } },
        activeInZones: [],
      },
      9400,
      99400,
      0,
    );
    const otherSeat = mkPlayerSeat(1);
    expect(canChangeLife(g, otherSeat)).toBe(true);

    const player = g.getPlayer(otherSeat);
    const startingLife = player.life;
    const action = new GameAction(g);
    collect(action.changeLife(otherSeat, 4, { cause: "gain" }));
    expect(player.life).toBe(startingLife + 4);
  });
});

// ── Lifecycle: deactivation reverses each gate ───────────────────────────────
describe("Wave 70.O — lifecycle: deactivation reverses each gate", () => {
  it("unregistering each Wave 70.O static restores defaults", () => {
    const g = mkGame();
    const phaseInCard = mintCard({
      game: g,
      id: 9500,
      paper: mkPaper("Phase-in subject"),
      seat: 0,
    });
    phaseInCard.phased = true;
    const phaseOutCard = mintCard({
      game: g,
      id: 9501,
      paper: mkPaper("Phase-out subject"),
      seat: 0,
    });

    const sCantPhaseIn = buildAndRegister(
      g,
      {
        mode: "CantPhaseIn",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      phaseInCard.id as unknown as number,
      99500,
      0,
    );
    const sCantPhaseOut = buildAndRegister(
      g,
      {
        mode: "CantPhaseOut",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      phaseOutCard.id as unknown as number,
      99501,
      0,
    );
    const sCantChangeLife = buildAndRegister(
      g,
      {
        mode: "CantChangeLife",
        params: { ValidPlayer: { kind: "literal", raw: "You" } },
        activeInZones: [],
      },
      9502,
      99502,
      0,
    );

    expect(canPhaseIn(g, phaseInCard.id)).toBe(false);
    expect(canPhaseOut(g, phaseOutCard.id)).toBe(false);
    expect(canChangeLife(g, mkPlayerSeat(0))).toBe(false);

    g.staticEffectRegistry.unregister(sCantPhaseIn.id);
    g.staticEffectRegistry.unregister(sCantPhaseOut.id);
    g.staticEffectRegistry.unregister(sCantChangeLife.id);

    expect(canPhaseIn(g, phaseInCard.id)).toBe(true);
    expect(canPhaseOut(g, phaseOutCard.id)).toBe(true);
    expect(canChangeLife(g, mkPlayerSeat(0))).toBe(true);
  });
});

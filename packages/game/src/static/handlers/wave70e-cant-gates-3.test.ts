// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.E — three more registry-walk gate statics regression tests.
// Covers:
//   - Registration smoke for CantGainLife / CantPlayLand / CantPreventDamage
//   - CantGainLife: positive changeLife rewritten to 0 (LifeChanged still
//     fires with delta 0; player.life unchanged)
//   - CantGainLife: damage-induced life gain (Soul Sister-shape) also
//     blocked, since Soul Sister's trigger routes through changeLife
//   - CantPlayLand: playLand action rejected (no LandPlayed, no zone
//     change, no drop counter increment)
//   - CantPlayLand: spell-effect land plays bypass the gate (carve-out
//     via direct moveTo, simulating AB$ Play with Land$ True)
//   - CantPreventDamage: Wave 60.E PreventAllDamage bypassed for matched
//     source — wouldPreventDamage returns false; DamageDealt fires
//   - Lifecycle: unregistering each static reverses the gate
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
import { canGainLife, canPlayLand } from "../../statics/wave60-cant-gates.js";
import { canDamageBePrevented, wouldPreventDamage } from "../../statics/wave60-damage-gates.js";
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
describe("Wave 70.E — registration smoke", () => {
  const modes: readonly StaticAbilityMode[] = ["CantGainLife", "CantPlayLand", "CantPreventDamage"];
  for (const m of modes) {
    it(`mode '${m}' is registered`, () => {
      expect(staticHandlerRegistry.has(m)).toBe(true);
    });
  }
});

// ── CantGainLife — Erebos / Sulfuric Vortex / Rampaging Ferocidon ────────────
describe("Wave 70.E — CantGainLife", () => {
  it("smoke + canGainLife false; positive changeLife rewritten to 0", () => {
    const g = mkGame();
    const seat = mkPlayerSeat(0);
    // Sulfuric Vortex-shape: each player can't gain life.
    buildAndRegister(
      g,
      {
        mode: "CantGainLife",
        params: { ValidPlayer: { kind: "literal", raw: "Player" } },
        activeInZones: [],
      },
      8000,
      98000,
    );
    expect(canGainLife(g, seat)).toBe(false);

    const player = g.getPlayer(seat);
    const startingLife = player.life;
    const action = new GameAction(g);
    const yields = collect(action.changeLife(seat, 5, { cause: "gain" }));
    const events = collectEvents(yields);

    // LifeChanged still fires (with delta 0) so SBA bookkeeping is consistent.
    const lc = events.find((e) => e.kind === "LifeChanged");
    expect(lc).toBeDefined();
    expect((lc as { payload: { delta: number } } | undefined)?.payload.delta).toBe(0);
    // No life actually gained.
    expect(player.life).toBe(startingLife);
    // Per-turn life-gained tracker is unchanged (no positive delta applied).
    expect(g.flags.lifeGainedThisTurn.get(seat) ?? 0).toBe(0);
  });

  it("damage-induced life gain (Soul Sister-shape) is also blocked", () => {
    // Soul Sister's "whenever a creature ETBs, you gain 1 life" trigger
    // ultimately routes through changeLife with a positive delta, so the
    // CantGainLife gate covers damage-induced and trigger-induced gain
    // alike.
    const g = mkGame();
    const seat = mkPlayerSeat(0);
    buildAndRegister(
      g,
      {
        mode: "CantGainLife",
        params: { ValidPlayer: { kind: "literal", raw: "Player" } },
        activeInZones: [],
      },
      8010,
      98010,
    );
    const player = g.getPlayer(seat);
    const startingLife = player.life;
    const action = new GameAction(g);
    // Simulate a Soul Sister-shape life-gain trigger firing twice in a row.
    collect(action.changeLife(seat, 1, { cause: "etb-trigger" }));
    collect(action.changeLife(seat, 1, { cause: "etb-trigger" }));
    expect(player.life).toBe(startingLife);
    expect(g.flags.lifeGainedThisTurn.get(seat) ?? 0).toBe(0);
  });

  it("ValidPlayer$ Opponent — only seat 1 (opponent of controller) is gated", () => {
    const g = mkGame();
    // Static controlled by seat 0; ValidPlayer$ Opponent → only seat 1
    // is gated. Erebos-shape on Forge cards.
    buildAndRegister(
      g,
      {
        mode: "CantGainLife",
        params: { ValidPlayer: { kind: "literal", raw: "Opponent" } },
        activeInZones: [],
      },
      8020,
      98020,
      0,
    );
    expect(canGainLife(g, mkPlayerSeat(0))).toBe(true);
    expect(canGainLife(g, mkPlayerSeat(1))).toBe(false);
  });
});

// ── CantPlayLand — Restorm / Stranglehold / Ob Nixilis ───────────────────────
describe("Wave 70.E — CantPlayLand", () => {
  it("smoke + playLand rejected: no LandPlayed event, no zone change, no drop counter", () => {
    const g = mkGame();
    const seat = mkPlayerSeat(0);
    buildAndRegister(
      g,
      {
        mode: "CantPlayLand",
        params: { ValidPlayer: { kind: "literal", raw: "Player" } },
        activeInZones: [],
      },
      8100,
      98100,
    );
    expect(canPlayLand(g, seat)).toBe(false);

    // Mint a land in seat 0's hand.
    const land = mintCard({
      game: g,
      id: 8101,
      paper: mkPaper("Forest", "Basic Land — Forest"),
      seat: 0,
      zone: ZoneType.Hand,
    });
    const action = new GameAction(g);
    const yields = collect(action.playLand(land.id, seat));
    const events = collectEvents(yields);
    expect(events.find((e) => e.kind === "LandPlayed")).toBeUndefined();
    expect(land.zone).toBe(ZoneType.Hand);
    expect(g.flags.landsPlayedThisTurn.get(seat) ?? 0).toBe(0);
  });

  it("spell-effect land play bypasses the gate (carve-out via direct moveTo)", () => {
    // AB$ Play with Land$ True routes through moveTo directly, not playLand,
    // so the CantPlayLand gate must NOT apply to spell-effect plays.
    // We simulate this by calling moveTo directly to the battlefield.
    const g = mkGame();
    const seat = mkPlayerSeat(0);
    buildAndRegister(
      g,
      {
        mode: "CantPlayLand",
        params: { ValidPlayer: { kind: "literal", raw: "Player" } },
        activeInZones: [],
      },
      8110,
      98110,
    );
    const land = mintCard({
      game: g,
      id: 8111,
      paper: mkPaper("Forest", "Basic Land — Forest"),
      seat: 0,
      zone: ZoneType.Hand,
    });
    const action = new GameAction(g);
    // Spell-effect land play: moveTo directly. The gate should NOT block this.
    collect(action.moveTo(land.id, ZoneType.Battlefield, { toSeat: seat, cause: "spell-effect" }));
    expect(land.zone).toBe(ZoneType.Battlefield);
  });

  it("ValidPlayer$ Opponent — only opponent gated; controller may still play lands", () => {
    const g = mkGame();
    buildAndRegister(
      g,
      {
        mode: "CantPlayLand",
        params: { ValidPlayer: { kind: "literal", raw: "Opponent" } },
        activeInZones: [],
      },
      8120,
      98120,
      0,
    );
    expect(canPlayLand(g, mkPlayerSeat(0))).toBe(true);
    expect(canPlayLand(g, mkPlayerSeat(1))).toBe(false);
  });
});

// ── CantPreventDamage — Comet, Stellar Pup / Inferno ─────────────────────────
describe("Wave 70.E — CantPreventDamage", () => {
  it("smoke + Wave 60.E PreventAllDamage bypassed for matched source", () => {
    const g = mkGame();
    const matchedSource = mintCard({ game: g, id: 8200, paper: mkPaper("Inferno") });
    const target = mintCard({ game: g, id: 8201, paper: mkPaper("Target"), seat: 1 });
    // Stamp a global PreventAllDamage (Fog-shape).
    buildAndRegister(g, { mode: "PreventAllDamage", params: {}, activeInZones: [] }, 9200, 99200);
    // CantPreventDamage targets the matched source (Card.Self).
    buildAndRegister(
      g,
      {
        mode: "CantPreventDamage",
        params: { ValidSource: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      matchedSource.id as unknown as number,
      98200,
    );

    // canDamageBePrevented: false for matched source, true for unrelated
    // source (no CantPreventDamage match).
    expect(canDamageBePrevented(g, matchedSource.id)).toBe(false);
    // wouldPreventDamage flips to false for the matched source — the
    // prevention loop is short-circuited and damage flows normally.
    expect(wouldPreventDamage(g, matchedSource.id, "creature", target.id, false)).toBe(false);

    // Confirm the actual damage routes through (DamageDealt fires; target
    // takes damage).
    const action = new GameAction(g);
    const yields = collect(action.damage(matchedSource.id, "creature", target.id, 3, false));
    const events = collectEvents(yields);
    expect(events.find((e) => e.kind === "DamageDealt")).toBeDefined();
    expect(events.find((e) => e.kind === "DamagePrevented")).toBeUndefined();
    expect(target.damage).toBe(3);
  });

  it("CantPreventDamage scoped by ValidSource$ — non-matching source still prevented", () => {
    const g = mkGame();
    const matchedSource = mintCard({ game: g, id: 8210, paper: mkPaper("Inferno") });
    const otherSource = mintCard({ game: g, id: 8211, paper: mkPaper("Bear") });
    const target = mintCard({ game: g, id: 8212, paper: mkPaper("Target"), seat: 1 });
    buildAndRegister(g, { mode: "PreventAllDamage", params: {}, activeInZones: [] }, 9210, 99210);
    buildAndRegister(
      g,
      {
        mode: "CantPreventDamage",
        params: { ValidSource: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      matchedSource.id as unknown as number,
      98210,
    );
    // Matched source: prevention bypassed.
    expect(wouldPreventDamage(g, matchedSource.id, "creature", target.id, false)).toBe(false);
    // Unrelated source: prevention still applies.
    expect(wouldPreventDamage(g, otherSource.id, "creature", target.id, false)).toBe(true);
  });
});

// ── Lifecycle: deactivation reverses each gate ───────────────────────────────
describe("Wave 70.E — lifecycle: deactivation reverses each gate", () => {
  it("unregistering CantGainLife / CantPlayLand / CantPreventDamage restores normal behavior", () => {
    const g = mkGame();
    const seat = mkPlayerSeat(0);
    const source = mintCard({ game: g, id: 8300, paper: mkPaper("Inferno") });
    const target = mintCard({ game: g, id: 8301, paper: mkPaper("Target"), seat: 1 });

    const sGain = buildAndRegister(
      g,
      {
        mode: "CantGainLife",
        params: { ValidPlayer: { kind: "literal", raw: "Player" } },
        activeInZones: [],
      },
      8302,
      98302,
    );
    const sLand = buildAndRegister(
      g,
      {
        mode: "CantPlayLand",
        params: { ValidPlayer: { kind: "literal", raw: "Player" } },
        activeInZones: [],
      },
      8303,
      98303,
    );
    // Stamp PreventAllDamage to verify CantPreventDamage flips wouldPreventDamage.
    buildAndRegister(g, { mode: "PreventAllDamage", params: {}, activeInZones: [] }, 9300, 99300);
    const sPrev = buildAndRegister(
      g,
      {
        mode: "CantPreventDamage",
        params: { ValidSource: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      source.id as unknown as number,
      98304,
    );

    // All three gates active.
    expect(canGainLife(g, seat)).toBe(false);
    expect(canPlayLand(g, seat)).toBe(false);
    expect(wouldPreventDamage(g, source.id, "creature", target.id, false)).toBe(false);

    // Deregister all three.
    g.staticEffectRegistry.unregister(sGain.id);
    g.staticEffectRegistry.unregister(sLand.id);
    g.staticEffectRegistry.unregister(sPrev.id);

    // All three gates lifted.
    expect(canGainLife(g, seat)).toBe(true);
    expect(canPlayLand(g, seat)).toBe(true);
    // PreventAllDamage is still active and now applies (CantPreventDamage gone).
    expect(wouldPreventDamage(g, source.id, "creature", target.id, false)).toBe(true);
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 73 — UnspentMana + ManaBurn static-mode regression tests.
// Covers:
//   - UnspentMana smoke registration.
//   - ManaBurn smoke registration.
//   - Omnath-shape: green mana retained at end of phase, other colors drop.
//   - Filter: matched seat retains; unmatched seat empties normally.
//   - Lifecycle: deactivation reverses retention.
//   - ManaBurn variant: burn-enabled game deals damage on unspent mana.
//   - ManaBurn-via-static (Yurlok shape) layered on top of UnspentMana
//     gate: retained colors don't burn (they aren't lost).
import type {
  LobbyPlayer,
  ManaCostAst,
  PaperCard,
  StaticAbility,
  StaticAbilityMode,
  StaticAst,
} from "@mtg-forge-ts/core";
import {
  Color,
  DEFAULT_PAPER_CARD_FLAGS,
  ManaProduced,
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
import { ManaPool } from "../../mana/mana-pool.js";
import { PhaseHandler } from "../../phase/phase-handler.js";
import {
  playerHasManaBurn,
  retainsUnspentMana,
  shardSurvivesEmpty,
} from "../../statics/wave73-unspent-mana.js";
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
const baseRules: GameRules = {
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

const mkGame = (overrides?: Partial<GameRules>): Game => {
  const game = new Game({
    lobbyPlayers: [alice, bob],
    rules: { ...baseRules, ...overrides },
    meta,
    rng: new SeededRng(0xdeadbeefn),
  });
  for (const p of game.players) {
    p.zones.set(ZoneType.Library, new Library(ZoneType.Library, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
    p.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p.seat));
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
    p.manaPool = new ManaPool();
  }
  return game;
};

const mkPaper = (
  name: string,
  types = "Creature — Bear",
  manaCostRaw = "1G",
  pt: { power: string; toughness: string } | undefined = { power: "2", toughness: "5" },
): PaperCard => ({
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
    ...(pt ? { pt } : {}),
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
describe("Wave 73 — registration smoke", () => {
  it("mode 'UnspentMana' is registered", () => {
    expect(staticHandlerRegistry.has("UnspentMana")).toBe(true);
  });
  it("mode 'ManaBurn' is registered", () => {
    expect(staticHandlerRegistry.has("ManaBurn")).toBe(true);
  });
});

// ── core helper semantics ────────────────────────────────────────────────────
describe("Wave 73 — UnspentMana query helpers", () => {
  it("Omnath shape: only green is retained for matched seat", () => {
    const g = mkGame();
    const omnath = mintCard({ game: g, id: 7300, paper: mkPaper("Omnath, Locus of Mana"), seat: 0 });
    buildAndRegister(
      g,
      {
        mode: "UnspentMana",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          ManaType: { kind: "literal", raw: "Green" },
        },
        activeInZones: [],
      },
      omnath.id as unknown as number,
      97300,
      0,
    );
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    // Seat 0 (controller / "You"): green retained, others not.
    expect(shardSurvivesEmpty(g, seat0, Color.Green)).toBe(true);
    expect(shardSurvivesEmpty(g, seat0, Color.Red)).toBe(false);
    expect(shardSurvivesEmpty(g, seat0, null)).toBe(false);
    // Seat 1 (opponent): no static matches.
    expect(shardSurvivesEmpty(g, seat1, Color.Green)).toBe(false);
    // retainsUnspentMana is the "any color retained" probe — false here
    // because the static is per-color (not Upwelling-shape).
    expect(retainsUnspentMana(g, seat0)).toBe(false);
  });

  it("Upwelling shape: no ManaType filter retains every color for every player", () => {
    const g = mkGame();
    const upwelling = mintCard({ game: g, id: 7310, paper: mkPaper("Upwelling"), seat: 0 });
    buildAndRegister(
      g,
      {
        mode: "UnspentMana",
        params: {},
        activeInZones: [],
      },
      upwelling.id as unknown as number,
      97310,
      0,
    );
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    expect(retainsUnspentMana(g, seat0)).toBe(true);
    expect(retainsUnspentMana(g, seat1)).toBe(true);
    // All shards survive — including colorless.
    for (const c of [Color.White, Color.Blue, Color.Black, Color.Red, Color.Green, null]) {
      expect(shardSurvivesEmpty(g, seat0, c)).toBe(true);
      expect(shardSurvivesEmpty(g, seat1, c)).toBe(true);
    }
  });

  it("Lifecycle: deregister returns to default empty (no retention)", () => {
    const g = mkGame();
    const omnath = mintCard({ game: g, id: 7320, paper: mkPaper("Omnath, Locus of Mana"), seat: 0 });
    const ability = buildAndRegister(
      g,
      {
        mode: "UnspentMana",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          ManaType: { kind: "literal", raw: "Green" },
        },
        activeInZones: [],
      },
      omnath.id as unknown as number,
      97320,
      0,
    );
    const seat0 = mkPlayerSeat(0);
    expect(shardSurvivesEmpty(g, seat0, Color.Green)).toBe(true);
    g.staticEffectRegistry.unregister(ability.id);
    expect(shardSurvivesEmpty(g, seat0, Color.Green)).toBe(false);
    expect(retainsUnspentMana(g, seat0)).toBe(false);
  });
});

// ── end-of-step empty step (CR 106.4) ────────────────────────────────────────
describe("Wave 73 — ManaPool empty step in PhaseHandler", () => {
  it("Omnath: green mana retained across step boundary, red mana drops", () => {
    const g = mkGame();
    mintCard({ game: g, id: 7400, paper: mkPaper("Omnath, Locus of Mana"), seat: 0 });
    buildAndRegister(
      g,
      {
        mode: "UnspentMana",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          ManaType: { kind: "literal", raw: "Green" },
        },
        activeInZones: [],
      },
      7400,
      97400,
      0,
    );
    const seat0 = mkPlayerSeat(0);
    const pool = g.getPlayer(seat0).manaPool as ManaPool;
    pool.add(ManaProduced.colored(Color.Green));
    pool.add(ManaProduced.colored(Color.Green));
    pool.add(ManaProduced.colored(Color.Red));
    pool.add(ManaProduced.colorless());

    // Drive ONE step manually to invoke the empty step.
    const handler = new PhaseHandler(g);
    g.activePlayer = seat0;
    const gen = handler.runStep(g.phase);
    let next = gen.next();
    while (!next.done) {
      if (next.value.kind === "decision" && next.value.request.kind === "priority") {
        next = gen.next({ kind: "priority", action: { kind: "pass" } });
      } else {
        next = gen.next();
      }
    }

    // Two green shards retained; red + colorless dropped.
    expect(pool.size()).toBe(2);
    const colors = pool.toArray().map((s) => s.color);
    expect(colors).toEqual([Color.Green, Color.Green]);
  });

  it("Filter: matched seat retains, unmatched seat empties normally", () => {
    const g = mkGame();
    mintCard({ game: g, id: 7410, paper: mkPaper("Omnath, Locus of Mana"), seat: 0 });
    buildAndRegister(
      g,
      {
        mode: "UnspentMana",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          ManaType: { kind: "literal", raw: "Green" },
        },
        activeInZones: [],
      },
      7410,
      97410,
      0, // controller = seat 0
    );
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const pool0 = g.getPlayer(seat0).manaPool as ManaPool;
    const pool1 = g.getPlayer(seat1).manaPool as ManaPool;
    pool0.add(ManaProduced.colored(Color.Green));
    pool1.add(ManaProduced.colored(Color.Green));

    const handler = new PhaseHandler(g);
    g.activePlayer = seat0;
    const gen = handler.runStep(g.phase);
    let next = gen.next();
    while (!next.done) {
      if (next.value.kind === "decision" && next.value.request.kind === "priority") {
        next = gen.next({ kind: "priority", action: { kind: "pass" } });
      } else {
        next = gen.next();
      }
    }

    // Seat 0 (controller / "You") retained green; seat 1 emptied.
    expect(pool0.size()).toBe(1);
    expect(pool1.size()).toBe(0);
  });

  it("Default behavior (no static): every shard drops at end of step", () => {
    const g = mkGame();
    const seat0 = mkPlayerSeat(0);
    const pool = g.getPlayer(seat0).manaPool as ManaPool;
    pool.add(ManaProduced.colored(Color.Green));
    pool.add(ManaProduced.colored(Color.Red));
    pool.add(ManaProduced.colorless());

    const handler = new PhaseHandler(g);
    g.activePlayer = seat0;
    const gen = handler.runStep(g.phase);
    let next = gen.next();
    while (!next.done) {
      if (next.value.kind === "decision" && next.value.request.kind === "priority") {
        next = gen.next({ kind: "priority", action: { kind: "pass" } });
      } else {
        next = gen.next();
      }
    }
    expect(pool.size()).toBe(0);
  });
});

// ── ManaBurn variant (pre-2009 R 119.10) ─────────────────────────────────────
describe("Wave 73 — ManaBurn variant", () => {
  it("manaBurn=false (modern): unspent mana drains silently, no life loss", () => {
    const g = mkGame({ manaBurn: false });
    const seat0 = mkPlayerSeat(0);
    const pool = g.getPlayer(seat0).manaPool as ManaPool;
    pool.add(ManaProduced.colored(Color.Red));
    pool.add(ManaProduced.colored(Color.Red));
    const startingLife = g.getPlayer(seat0).life;

    const handler = new PhaseHandler(g);
    g.activePlayer = seat0;
    const gen = handler.runStep(g.phase);
    let next = gen.next();
    while (!next.done) {
      if (next.value.kind === "decision" && next.value.request.kind === "priority") {
        next = gen.next({ kind: "priority", action: { kind: "pass" } });
      } else {
        next = gen.next();
      }
    }
    expect(pool.size()).toBe(0);
    expect(g.getPlayer(seat0).life).toBe(startingLife);
  });

  it("manaBurn=true (retro): each unspent shard deals 1 life loss", () => {
    const g = mkGame({ manaBurn: true });
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    expect(playerHasManaBurn(g, seat0)).toBe(true);
    expect(playerHasManaBurn(g, seat1)).toBe(true);
    const pool0 = g.getPlayer(seat0).manaPool as ManaPool;
    pool0.add(ManaProduced.colored(Color.Red));
    pool0.add(ManaProduced.colored(Color.Red));
    pool0.add(ManaProduced.colorless());
    const startLife = g.getPlayer(seat0).life;

    const handler = new PhaseHandler(g);
    g.activePlayer = seat0;
    const gen = handler.runStep(g.phase);
    let next = gen.next();
    while (!next.done) {
      if (next.value.kind === "decision" && next.value.request.kind === "priority") {
        next = gen.next({ kind: "priority", action: { kind: "pass" } });
      } else {
        next = gen.next();
      }
    }
    expect(pool0.size()).toBe(0);
    expect(g.getPlayer(seat0).life).toBe(startLife - 3);
  });

  it("ManaBurn static (Yurlok shape): per-seat opt-in to mana burn", () => {
    const g = mkGame({ manaBurn: false });
    const yurlok = mintCard({
      game: g,
      id: 7500,
      paper: mkPaper("Yurlok of Scorch Thrash"),
      seat: 0,
    });
    buildAndRegister(
      g,
      {
        mode: "ManaBurn",
        params: {},
        activeInZones: [],
      },
      yurlok.id as unknown as number,
      97500,
      0,
    );
    const seat0 = mkPlayerSeat(0);
    expect(playerHasManaBurn(g, seat0)).toBe(true);
    const pool = g.getPlayer(seat0).manaPool as ManaPool;
    pool.add(ManaProduced.colored(Color.Black));
    pool.add(ManaProduced.colored(Color.Red));
    const startLife = g.getPlayer(seat0).life;

    const handler = new PhaseHandler(g);
    g.activePlayer = seat0;
    const gen = handler.runStep(g.phase);
    let next = gen.next();
    while (!next.done) {
      if (next.value.kind === "decision" && next.value.request.kind === "priority") {
        next = gen.next({ kind: "priority", action: { kind: "pass" } });
      } else {
        next = gen.next();
      }
    }
    expect(pool.size()).toBe(0);
    expect(g.getPlayer(seat0).life).toBe(startLife - 2);
  });

  it("ManaBurn + UnspentMana layered: retained shards don't burn", () => {
    const g = mkGame({ manaBurn: true });
    mintCard({ game: g, id: 7510, paper: mkPaper("Omnath, Locus of Mana"), seat: 0 });
    buildAndRegister(
      g,
      {
        mode: "UnspentMana",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          ManaType: { kind: "literal", raw: "Green" },
        },
        activeInZones: [],
      },
      7510,
      97510,
      0,
    );
    const seat0 = mkPlayerSeat(0);
    const pool = g.getPlayer(seat0).manaPool as ManaPool;
    pool.add(ManaProduced.colored(Color.Green));
    pool.add(ManaProduced.colored(Color.Green));
    pool.add(ManaProduced.colored(Color.Red));
    const startLife = g.getPlayer(seat0).life;

    const handler = new PhaseHandler(g);
    g.activePlayer = seat0;
    const gen = handler.runStep(g.phase);
    let next = gen.next();
    while (!next.done) {
      if (next.value.kind === "decision" && next.value.request.kind === "priority") {
        next = gen.next({ kind: "priority", action: { kind: "pass" } });
      } else {
        next = gen.next();
      }
    }
    // Two greens retained; one red lost → 1 life lost (not 3).
    expect(pool.size()).toBe(2);
    expect(g.getPlayer(seat0).life).toBe(startLife - 1);
  });
});

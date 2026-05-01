// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 77 — WitherDamage + InfectDamage + SurveilNum static modes regression tests.
// Covers:
//   - Registration smoke for all three modes.
//   - WitherDamage static rewrites damage to creatures into -1/-1
//     counters even when K:Wither is absent on the source.
//   - InfectDamage static rewrites BOTH paths (creatures → -1/-1
//     counters, players → poison counters) without K:Infect.
//   - Filter: non-matched sources still deal normal damage.
//   - SurveilNum modifier sums Amount$ across matching statics; the
//     SurveilEffect resolver runs the augmented count through
//     game.action.surveil.
//   - Lifecycle: deactivation reverses each gate.
import type {
  AbilityAst,
  DecisionResponse,
  EntityId,
  LobbyPlayer,
  PaperCard,
  PlayerSeat,
  StaticAbility,
  StaticAbilityMode,
  StaticAst,
} from "@mtg-forge-ts/core";
import {
  CounterType,
  DEFAULT_PAPER_CARD_FLAGS,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { SpellAbility } from "../../ability/spell-ability.js";
import type { EngineYield } from "../../action/engine-yield.js";
import "../../ability/effects/index.js";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import {
  dealsInfectDamage,
  dealsWitherDamage,
  surveilNumModifier,
} from "../../statics/wave77-gate-helpers.js";
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

const paper: PaperCard = {
  name: "T",
  edition: "TST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
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

interface MintOpts {
  readonly game: Game;
  readonly id: number;
  readonly seat?: 0 | 1;
  readonly zone?: ZoneType;
}
const mintCard = (opts: MintOpts): Card => {
  const cid = mkEntityId(opts.id);
  const seat: PlayerSeat = mkPlayerSeat(opts.seat ?? 0);
  const card = new Card(cid, paper, seat, seat, opts.zone ?? ZoneType.Battlefield);
  opts.game.cards.set(cid, card);
  const z = opts.game.getPlayer(seat).zones.get(opts.zone ?? ZoneType.Battlefield);
  z?.add(cid);
  return card;
};

const seedLib = (game: Game, seat: PlayerSeat, ids: readonly EntityId[]): void => {
  const lib = game.getPlayer(seat).zones.get(ZoneType.Library);
  if (!lib) throw new Error("seedLib: missing library");
  for (const id of ids) {
    game.cards.set(id, new Card(id, paper, seat, seat, ZoneType.Library));
    lib.add(id);
  }
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

const drain = (g: Generator<EngineYield, void, unknown>): EngineYield[] => {
  const out: EngineYield[] = [];
  let s = g.next();
  while (!s.done) {
    out.push(s.value);
    s = g.next();
  }
  return out;
};

// ── registration smoke ───────────────────────────────────────────────────────
describe("Wave 77 — registration smoke", () => {
  const modes: readonly StaticAbilityMode[] = ["WitherDamage", "InfectDamage", "SurveilNum"];
  for (const m of modes) {
    it(`mode '${m}' is registered`, () => {
      expect(staticHandlerRegistry.has(m)).toBe(true);
    });
  }
});

// ── WitherDamage ─────────────────────────────────────────────────────────────
describe("Wave 77 — WitherDamage (static form of K:Wither)", () => {
  it("matched non-keyword source: damage to creature applies as -1/-1 counters", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 7900, seat: 0 });
    const tgt = mintCard({ game: g, id: 7901, seat: 1 });
    // No K:Wither keyword on src.
    expect(src.keywords?.has("wither")).not.toBe(true);
    // Static rewrites globally (Card filter — match all cards).
    buildAndRegister(
      g,
      {
        mode: "WitherDamage",
        params: { ValidCard: { kind: "literal", raw: "Card" } },
        activeInZones: [],
      },
      7902,
      97902,
    );
    expect(dealsWitherDamage(g, src.id)).toBe(true);
    drain(g.action.damage(src.id, "creature", tgt.id, 3, true));
    expect(tgt.damage).toBe(0);
    expect(tgt.counters.get(CounterType.MinusOneMinusOne)).toBe(3);
  });

  it("WitherDamage to player still uses regular life loss (NOT poison)", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 7910, seat: 0 });
    buildAndRegister(
      g,
      {
        mode: "WitherDamage",
        params: { ValidCard: { kind: "literal", raw: "Card" } },
        activeInZones: [],
      },
      7911,
      97911,
    );
    const bobP = g.getPlayer(mkPlayerSeat(1));
    const initialLife = bobP.life;
    drain(g.action.damage(src.id, "player", mkPlayerSeat(1), 3, true));
    expect(bobP.life).toBe(initialLife - 3);
    expect(bobP.counters.get(CounterType.Poison) ?? 0).toBe(0);
  });

  it("filter: non-matched source still deals normal damage", () => {
    const g = mkGame();
    const matched = mintCard({ game: g, id: 7920, seat: 0 });
    const unmatched = mintCard({ game: g, id: 7921, seat: 1 });
    const tgt = mintCard({ game: g, id: 7922, seat: 1 });
    // Filter: only seat-0's cards.
    buildAndRegister(
      g,
      {
        mode: "WitherDamage",
        params: { ValidCard: { kind: "literal", raw: "Card.YouCtrl" } },
        activeInZones: [],
      },
      7923,
      97923,
      0,
    );
    expect(dealsWitherDamage(g, matched.id)).toBe(true);
    expect(dealsWitherDamage(g, unmatched.id)).toBe(false);
    // Unmatched source → regular damage.
    drain(g.action.damage(unmatched.id, "creature", tgt.id, 2, true));
    expect(tgt.damage).toBe(2);
    expect(tgt.counters.get(CounterType.MinusOneMinusOne) ?? 0).toBe(0);
  });
});

// ── InfectDamage ─────────────────────────────────────────────────────────────
describe("Wave 77 — InfectDamage (static form of K:Infect)", () => {
  it("matched non-keyword source: damage to creature applies as -1/-1 counters", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 7930, seat: 0 });
    const tgt = mintCard({ game: g, id: 7931, seat: 1 });
    expect(src.keywords?.has("infect")).not.toBe(true);
    buildAndRegister(
      g,
      {
        mode: "InfectDamage",
        params: { ValidCard: { kind: "literal", raw: "Card" } },
        activeInZones: [],
      },
      7932,
      97932,
    );
    expect(dealsInfectDamage(g, src.id)).toBe(true);
    drain(g.action.damage(src.id, "creature", tgt.id, 2, true));
    expect(tgt.damage).toBe(0);
    expect(tgt.counters.get(CounterType.MinusOneMinusOne)).toBe(2);
  });

  it("matched non-keyword source: damage to player applies as poison counters", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 7940, seat: 0 });
    expect(src.keywords?.has("infect")).not.toBe(true);
    buildAndRegister(
      g,
      {
        mode: "InfectDamage",
        params: { ValidCard: { kind: "literal", raw: "Card" } },
        activeInZones: [],
      },
      7941,
      97941,
    );
    const bobP = g.getPlayer(mkPlayerSeat(1));
    const initialLife = bobP.life;
    drain(g.action.damage(src.id, "player", mkPlayerSeat(1), 2, true));
    // Life unchanged.
    expect(bobP.life).toBe(initialLife);
    // Poison counters added.
    expect(bobP.counters.get(CounterType.Poison)).toBe(2);
  });

  it("filter: non-matched source still deals normal damage", () => {
    const g = mkGame();
    const matched = mintCard({ game: g, id: 7950, seat: 0 });
    const unmatched = mintCard({ game: g, id: 7951, seat: 1 });
    buildAndRegister(
      g,
      {
        mode: "InfectDamage",
        params: { ValidCard: { kind: "literal", raw: "Card.YouCtrl" } },
        activeInZones: [],
      },
      7952,
      97952,
      0,
    );
    expect(dealsInfectDamage(g, matched.id)).toBe(true);
    expect(dealsInfectDamage(g, unmatched.id)).toBe(false);
    const aliceP = g.getPlayer(mkPlayerSeat(0));
    const initialLife = aliceP.life;
    // Unmatched source → regular damage to player (life loss, no poison).
    drain(g.action.damage(unmatched.id, "player", mkPlayerSeat(0), 3, true));
    expect(aliceP.life).toBe(initialLife - 3);
    expect(aliceP.counters.get(CounterType.Poison) ?? 0).toBe(0);
  });
});

// ── SurveilNum ───────────────────────────────────────────────────────────────
describe("Wave 77 — SurveilNum (modifies surveil count)", () => {
  it("surveilNumModifier 0 by default; sums Amount$ across matches", () => {
    const g = mkGame();
    const seat0 = mkPlayerSeat(0);
    expect(surveilNumModifier(g, seat0)).toBe(0);
    buildAndRegister(
      g,
      {
        mode: "SurveilNum",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          Amount: { kind: "literal", raw: "1" },
        },
        activeInZones: [],
      },
      7960,
      97960,
      0,
    );
    buildAndRegister(
      g,
      {
        mode: "SurveilNum",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          Amount: { kind: "literal", raw: "2" },
        },
        activeInZones: [],
      },
      7961,
      97961,
      0,
    );
    expect(surveilNumModifier(g, seat0)).toBe(3);
    // Seat 1 doesn't match ValidPlayer$ You (controller seat 0).
    expect(surveilNumModifier(g, mkPlayerSeat(1))).toBe(0);
  });

  it("default Amount$ is 1 when omitted", () => {
    const g = mkGame();
    buildAndRegister(
      g,
      {
        mode: "SurveilNum",
        params: { ValidPlayer: { kind: "literal", raw: "You" } },
        activeInZones: [],
      },
      7970,
      97970,
      0,
    );
    expect(surveilNumModifier(g, mkPlayerSeat(0))).toBe(1);
  });

  it("SurveilEffect routes printed N + modifier through game.action.surveil", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 7980, seat: 0 });
    // Seed library with 3 cards so surveil(2) reveals 2 cards.
    const ids: readonly EntityId[] = [mkEntityId(8000), mkEntityId(8001), mkEntityId(8002)];
    seedLib(g, mkPlayerSeat(0), ids);
    // Modifier: +1 to seat 0's surveil count.
    buildAndRegister(
      g,
      {
        mode: "SurveilNum",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          Amount: { kind: "literal", raw: "1" },
        },
        activeInZones: [],
      },
      7981,
      97981,
      0,
    );
    // Drive `SP$ Surveil | Amount$ 1` — runtime count should be 1 + 1 = 2.
    const ast: AbilityAst = {
      kind: "spell",
      effect: { handlerKey: "Surveil", params: { Amount: { kind: "literal", raw: "1" } } },
      cost: { raw: "" },
    };
    const sa = new SpellAbility(ast, src.id, mkPlayerSeat(0), new Map(), []);
    const gen = sa.makeResolver().resolve(g) as Generator<EngineYield, void, unknown>;
    let revealed: readonly EntityId[] = [];
    let step = gen.next();
    while (!step.done) {
      const y = step.value;
      if (y.kind === "decision" && y.request.kind === "surveil") {
        revealed = y.request.cards;
        const resp: DecisionResponse = {
          kind: "surveil",
          toTop: revealed,
          toGraveyard: [] as readonly EntityId[],
        };
        step = gen.next(resp);
      } else {
        step = gen.next();
      }
    }
    // Modifier landed: 2 cards revealed instead of 1.
    expect(revealed.length).toBe(2);
  });
});

// ── Lifecycle ────────────────────────────────────────────────────────────────
describe("Wave 77 — lifecycle: deactivation reverses each gate", () => {
  it("unregistering each Wave 77 static restores defaults", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 7990, seat: 0 });
    const seat0 = mkPlayerSeat(0);

    const sWither = buildAndRegister(
      g,
      {
        mode: "WitherDamage",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      src.id as unknown as number,
      97990,
      0,
    );
    const sInfect = buildAndRegister(
      g,
      {
        mode: "InfectDamage",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      src.id as unknown as number,
      97991,
      0,
    );
    const sSurveil = buildAndRegister(
      g,
      {
        mode: "SurveilNum",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          Amount: { kind: "literal", raw: "2" },
        },
        activeInZones: [],
      },
      7992,
      97992,
      0,
    );

    // All three gates active.
    expect(dealsWitherDamage(g, src.id)).toBe(true);
    expect(dealsInfectDamage(g, src.id)).toBe(true);
    expect(surveilNumModifier(g, seat0)).toBe(2);

    // Unregister; each gate releases.
    g.staticEffectRegistry.unregister(sWither.id);
    g.staticEffectRegistry.unregister(sInfect.id);
    g.staticEffectRegistry.unregister(sSurveil.id);

    expect(dealsWitherDamage(g, src.id)).toBe(false);
    expect(dealsInfectDamage(g, src.id)).toBe(false);
    expect(surveilNumModifier(g, seat0)).toBe(0);
  });
});

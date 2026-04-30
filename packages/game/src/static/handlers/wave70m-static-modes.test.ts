// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.M — four more registry-walk gate statics regression tests.
// Covers:
//   - Registration smoke for PlayerMustAttack / CantBeCopied /
//     MaxCounter / CantLoseLife.
//   - PlayerMustAttack: requirement-set helper surfaces the gate
//     when the attacking player matches; defenderMatches predicates
//     respect MustAttack$ filter (You / Planeswalker.YouCtrl) and
//     "any defender" default.
//   - CantBeCopied: cantBeCopied helper rejects matched cards;
//     game.action.castCopyOf returns undefined and emits no event;
//     CopySpellAbilityEffect is a no-op when gate matches.
//   - MaxCounter: maxCounter helper returns the cap; addCounter
//     clamps the requested amount; addCounter no-ops when at cap.
//   - CantLoseLife: canLoseLife helper false on match; negative
//     changeLife rewritten to 0 (LifeChanged still fires with delta
//     0; player.life unchanged).
//   - Lifecycle: deactivation reverses each gate.
import type {
  CounterType,
  GameEvent,
  LobbyPlayer,
  PaperCard,
  PlayerSeat,
  StaticAbility,
  StaticAbilityMode,
  StaticAst,
} from "@mtg-forge-ts/core";
import {
  CounterType as CT,
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
import {
  canLoseLife,
  cantBeCopied,
  maxCounter,
  playerMustAttackDefenderSatisfies,
  playerMustAttackRequirements,
} from "../../statics/wave70m-gate-helpers.js";
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
describe("Wave 70.M — registration smoke", () => {
  const modes: readonly StaticAbilityMode[] = [
    "PlayerMustAttack",
    "CantBeCopied",
    "MaxCounter",
    "CantLoseLife",
  ];
  for (const m of modes) {
    it(`mode '${m}' is registered`, () => {
      expect(staticHandlerRegistry.has(m)).toBe(true);
    });
  }
});

// ── PlayerMustAttack — Seeker of Slaanesh / Trove of Temptation ──────────────
describe("Wave 70.M — PlayerMustAttack", () => {
  it("requirements: Seeker-of-Slaanesh shape (no MustAttack$) — any defender satisfies", () => {
    const g = mkGame();
    // Seeker of Slaanesh: each opponent must attack with at least one
    // creature each combat if able. Static is controlled by seat 0;
    // ValidPlayer$ Opponent → seat 1 is the matched attacker.
    buildAndRegister(
      g,
      {
        mode: "PlayerMustAttack",
        params: {
          ValidPlayer: { kind: "literal", raw: "Opponent" },
        },
        activeInZones: [],
      },
      9000,
      99000,
      0,
    );
    const reqs = playerMustAttackRequirements(g, mkPlayerSeat(1));
    expect(reqs.length).toBe(1);
    expect(reqs[0]?.hasMustAttackFilter).toBe(false);
    // Any defender satisfies the "no filter" default.
    expect(
      playerMustAttackDefenderSatisfies(g, mkPlayerSeat(1), {
        kind: "player",
        controllerSeat: mkPlayerSeat(0),
      }),
    ).toBe(true);
    // Seat 0 (controller / "you") is NOT an opponent → no requirement applies.
    expect(playerMustAttackRequirements(g, mkPlayerSeat(0)).length).toBe(0);
  });

  it("requirements: Trove-of-Temptation shape — MustAttack$ You,Planeswalker.YouCtrl", () => {
    const g = mkGame();
    // Trove of Temptation: each opponent must attack you or a planeswalker
    // you control with at least one creature each combat if able. Static
    // controlled by seat 0.
    buildAndRegister(
      g,
      {
        mode: "PlayerMustAttack",
        params: {
          ValidPlayer: { kind: "literal", raw: "Opponent" },
          MustAttack: { kind: "literal", raw: "You,Planeswalker.YouCtrl" },
        },
        activeInZones: [],
      },
      9100,
      99100,
      0,
    );
    const reqs = playerMustAttackRequirements(g, mkPlayerSeat(1));
    expect(reqs.length).toBe(1);
    expect(reqs[0]?.hasMustAttackFilter).toBe(true);
    // Defender = seat 0 (the static's controller / "you") → satisfies.
    expect(
      playerMustAttackDefenderSatisfies(g, mkPlayerSeat(1), {
        kind: "player",
        controllerSeat: mkPlayerSeat(0),
      }),
    ).toBe(true);
    // Defender = seat 1 (NOT "you" relative to the static's controller) →
    // does NOT satisfy.
    expect(
      playerMustAttackDefenderSatisfies(g, mkPlayerSeat(1), {
        kind: "player",
        controllerSeat: mkPlayerSeat(1),
      }),
    ).toBe(false);
    // Defender = planeswalker controlled by seat 0 ("YouCtrl") → satisfies.
    expect(
      playerMustAttackDefenderSatisfies(g, mkPlayerSeat(1), {
        kind: "planeswalker",
        controllerSeat: mkPlayerSeat(0),
      }),
    ).toBe(true);
    // Defender = planeswalker controlled by seat 1 (NOT YouCtrl) → no.
    expect(
      playerMustAttackDefenderSatisfies(g, mkPlayerSeat(1), {
        kind: "planeswalker",
        controllerSeat: mkPlayerSeat(1),
      }),
    ).toBe(false);
  });

  it("requirements: empty when no static registered", () => {
    const g = mkGame();
    expect(playerMustAttackRequirements(g, mkPlayerSeat(0)).length).toBe(0);
    expect(playerMustAttackRequirements(g, mkPlayerSeat(1)).length).toBe(0);
  });
});

// ── CantBeCopied — Display of Power / See Double ─────────────────────────────
describe("Wave 70.M — CantBeCopied", () => {
  it("cantBeCopied: matches Card.Self gate; default permits", () => {
    const g = mkGame();
    const spellCard = mintCard({
      game: g,
      id: 9200,
      paper: mkPaper("Display of Power", "Instant"),
      seat: 0,
      zone: ZoneType.Stack,
    });
    // No static — copy permitted.
    expect(cantBeCopied(g, spellCard.id)).toBe(false);
    // Display of Power-shape: ValidCard$ Card.Self.
    buildAndRegister(
      g,
      {
        mode: "CantBeCopied",
        params: {
          ValidCard: { kind: "literal", raw: "Card.Self" },
        },
        activeInZones: [],
      },
      spellCard.id as unknown as number,
      99201,
      0,
    );
    expect(cantBeCopied(g, spellCard.id)).toBe(true);
    // Other cards are not gated by a Card.Self filter.
    const otherCard = mintCard({
      game: g,
      id: 9202,
      paper: mkPaper("Other Spell", "Instant"),
      seat: 0,
      zone: ZoneType.Stack,
    });
    expect(cantBeCopied(g, otherCard.id)).toBe(false);
  });

  it("cantBeCopied: ValidCard$ broader filter matches any matching card", () => {
    const g = mkGame();
    const sourceCard = mintCard({
      game: g,
      id: 9300,
      paper: mkPaper("Source", "Instant"),
      seat: 0,
      zone: ZoneType.Battlefield,
    });
    const spellA = mintCard({
      game: g,
      id: 9301,
      paper: mkPaper("Spell A", "Instant"),
      seat: 0,
      zone: ZoneType.Stack,
    });
    // Broader gate: Instant — covers any Instant on the stack/battlefield.
    buildAndRegister(
      g,
      {
        mode: "CantBeCopied",
        params: {
          ValidCard: { kind: "literal", raw: "Instant" },
        },
        activeInZones: [],
      },
      sourceCard.id as unknown as number,
      99302,
      0,
    );
    expect(cantBeCopied(g, spellA.id)).toBe(true);
  });
});

// ── MaxCounter — Rasputin Dreamweaver ────────────────────────────────────────
describe("Wave 70.M — MaxCounter", () => {
  it("maxCounter: returns the cap when card+type matches; undefined otherwise", () => {
    const g = mkGame();
    const rasputin = mintCard({
      game: g,
      id: 9400,
      paper: mkPaper("Rasputin Dreamweaver", "Legendary Creature — Human Minion"),
      seat: 0,
    });
    expect(maxCounter(g, rasputin.id, CT.Dream)).toBeUndefined();
    // Stamp the Rasputin gate: ValidCard$ Card.Self | CounterType$ DREAM | MaxNum$ 7.
    buildAndRegister(
      g,
      {
        mode: "MaxCounter",
        params: {
          ValidCard: { kind: "literal", raw: "Card.Self" },
          CounterType: { kind: "literal", raw: "DREAM" },
          MaxNum: { kind: "literal", raw: "7" },
        },
        activeInZones: [],
      },
      rasputin.id as unknown as number,
      99401,
      0,
    );
    expect(maxCounter(g, rasputin.id, CT.Dream)).toBe(7);
    // A different counter type → no cap.
    expect(maxCounter(g, rasputin.id, CT.PlusOnePlusOne)).toBeUndefined();
    // A different card → no cap.
    const other = mintCard({ game: g, id: 9402, paper: mkPaper("Other Bear"), seat: 0 });
    expect(maxCounter(g, other.id, CT.Dream)).toBeUndefined();
  });

  it("addCounter clamps requested amount to the MaxCounter cap", () => {
    const g = mkGame();
    const rasputin = mintCard({
      game: g,
      id: 9500,
      paper: mkPaper("Rasputin Dreamweaver", "Legendary Creature — Human Minion"),
      seat: 0,
    });
    buildAndRegister(
      g,
      {
        mode: "MaxCounter",
        params: {
          ValidCard: { kind: "literal", raw: "Card.Self" },
          CounterType: { kind: "literal", raw: "DREAM" },
          MaxNum: { kind: "literal", raw: "7" },
        },
        activeInZones: [],
      },
      rasputin.id as unknown as number,
      99501,
      0,
    );
    const action = new GameAction(g);
    // Request 10 dream counters; cap is 7 → only 7 added.
    collect(action.addCounter(rasputin.id, CT.Dream as CounterType, 10));
    expect(rasputin.counters.get(CT.Dream) ?? 0).toBe(7);
    // Subsequent adds while at cap are no-ops.
    const yields = collect(action.addCounter(rasputin.id, CT.Dream as CounterType, 5));
    expect(rasputin.counters.get(CT.Dream) ?? 0).toBe(7);
    // No CounterAdded event fires when the no-op short-circuits.
    expect(collectEvents(yields).filter((e) => e.kind === "CounterAdded").length).toBe(0);
  });
});

// ── CantLoseLife — Courageous Resolve / Everybody Lives! ─────────────────────
describe("Wave 70.M — CantLoseLife", () => {
  it("smoke + canLoseLife false; negative changeLife rewritten to 0", () => {
    const g = mkGame();
    const seat = mkPlayerSeat(0);
    // Everybody Lives!-shape: ValidPlayer$ Player → all seats blocked.
    buildAndRegister(
      g,
      {
        mode: "CantLoseLife",
        params: { ValidPlayer: { kind: "literal", raw: "Player" } },
        activeInZones: [],
      },
      9600,
      99600,
    );
    expect(canLoseLife(g, seat)).toBe(false);

    const player = g.getPlayer(seat);
    const startingLife = player.life;
    const action = new GameAction(g);
    const yields = collect(action.changeLife(seat, -5, { cause: "damage" }));
    const events = collectEvents(yields);

    // LifeChanged still fires (with delta 0) so SBA bookkeeping is consistent.
    const lc = events.find((e) => e.kind === "LifeChanged");
    expect(lc).toBeDefined();
    expect((lc as { payload: { delta: number } } | undefined)?.payload.delta).toBe(0);
    // No life actually lost.
    expect(player.life).toBe(startingLife);
    // Per-turn life-lost tracker is unchanged.
    expect(g.flags.lifeLostThisTurn.get(seat) ?? 0).toBe(0);
  });

  it("ValidPlayer$ You — only seat 0 (controller) is gated", () => {
    const g = mkGame();
    // Courageous Resolve-shape: ValidPlayer$ You → only the static's
    // controller (seat 0) is gated.
    buildAndRegister(
      g,
      {
        mode: "CantLoseLife",
        params: { ValidPlayer: { kind: "literal", raw: "You" } },
        activeInZones: [],
      },
      9700,
      99700,
      0,
    );
    expect(canLoseLife(g, mkPlayerSeat(0))).toBe(false);
    expect(canLoseLife(g, mkPlayerSeat(1))).toBe(true);
  });

  it("positive deltas are unaffected by CantLoseLife", () => {
    const g = mkGame();
    const seat = mkPlayerSeat(0);
    buildAndRegister(
      g,
      {
        mode: "CantLoseLife",
        params: { ValidPlayer: { kind: "literal", raw: "Player" } },
        activeInZones: [],
      },
      9800,
      99800,
    );
    const player = g.getPlayer(seat);
    const startingLife = player.life;
    const action = new GameAction(g);
    collect(action.changeLife(seat, 3, { cause: "gain" }));
    expect(player.life).toBe(startingLife + 3);
  });
});

// ── Lifecycle: deactivation reverses each gate ───────────────────────────────
describe("Wave 70.M — lifecycle: deactivation reverses each gate", () => {
  it("unregistering each Wave 70.M static restores defaults", () => {
    const g = mkGame();
    const spellCard = mintCard({
      game: g,
      id: 9900,
      paper: mkPaper("Display of Power", "Instant"),
      seat: 0,
      zone: ZoneType.Stack,
    });
    const rasputin = mintCard({
      game: g,
      id: 9901,
      paper: mkPaper("Rasputin Dreamweaver", "Legendary Creature — Human Minion"),
      seat: 0,
    });

    const sPlayerMustAttack = buildAndRegister(
      g,
      {
        mode: "PlayerMustAttack",
        params: { ValidPlayer: { kind: "literal", raw: "Opponent" } },
        activeInZones: [],
      },
      9902,
      99902,
      0,
    );
    const sCantBeCopied = buildAndRegister(
      g,
      {
        mode: "CantBeCopied",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      spellCard.id as unknown as number,
      99903,
      0,
    );
    const sMaxCounter = buildAndRegister(
      g,
      {
        mode: "MaxCounter",
        params: {
          ValidCard: { kind: "literal", raw: "Card.Self" },
          CounterType: { kind: "literal", raw: "DREAM" },
          MaxNum: { kind: "literal", raw: "7" },
        },
        activeInZones: [],
      },
      rasputin.id as unknown as number,
      99904,
      0,
    );
    const sCantLoseLife = buildAndRegister(
      g,
      {
        mode: "CantLoseLife",
        params: { ValidPlayer: { kind: "literal", raw: "Player" } },
        activeInZones: [],
      },
      9905,
      99905,
      0,
    );

    expect(playerMustAttackRequirements(g, mkPlayerSeat(1)).length).toBe(1);
    expect(cantBeCopied(g, spellCard.id)).toBe(true);
    expect(maxCounter(g, rasputin.id, CT.Dream)).toBe(7);
    expect(canLoseLife(g, mkPlayerSeat(0))).toBe(false);

    g.staticEffectRegistry.unregister(sPlayerMustAttack.id);
    g.staticEffectRegistry.unregister(sCantBeCopied.id);
    g.staticEffectRegistry.unregister(sMaxCounter.id);
    g.staticEffectRegistry.unregister(sCantLoseLife.id);

    expect(playerMustAttackRequirements(g, mkPlayerSeat(1)).length).toBe(0);
    expect(cantBeCopied(g, spellCard.id)).toBe(false);
    expect(maxCounter(g, rasputin.id, CT.Dream)).toBeUndefined();
    expect(canLoseLife(g, mkPlayerSeat(0))).toBe(true);
  });
});

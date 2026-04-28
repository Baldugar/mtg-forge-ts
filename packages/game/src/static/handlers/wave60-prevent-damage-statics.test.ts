// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 60.E — three same-shape damage-prevention statics regression tests.
// Covers:
//   - Registry hookup for PreventAllDamage / PreventAllDamageBy /
//     PreventAllDamageTo.
//   - Blanket prevention: any damage event is short-circuited when an
//     unfiltered PreventAllDamage static is active.
//   - ValidSource$ filter on PreventAllDamageBy: matched sources deal 0
//     damage; unmatched sources still deal full damage.
//   - ValidTarget$ filter on PreventAllDamageTo: matched targets take 0
//     damage; unmatched targets take full damage.
//   - Combat$ True filter: only combat damage prevented; spell-damage
//     still applies.
//   - Per-turn lifecycle: two consecutive damage events both blocked
//     while a static is active.
//
// The consumer wiring (GameAction.damage) emits a DamagePrevented event
// and bails before applyWithReplacements when the gate matches; we
// observe that by counting DamagePrevented events and asserting absence
// of DamageDealt + zero-mutation on the target.
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
import { wouldPreventDamage } from "../../statics/wave60-damage-gates.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { Library } from "../../zone/zones/library.js";
import { staticHandlerRegistry } from "../static-handler.js";
// Side-effect: the barrel registers every Wave-60 handler.
import "./index.js";

// ── fixtures (match wave60-cant-statics.test.ts shapes) ──────────────────────
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
describe("Wave 60.E — every prevent-damage mode has a registered handler", () => {
  const modes: readonly StaticAbilityMode[] = [
    "PreventAllDamage",
    "PreventAllDamageBy",
    "PreventAllDamageTo",
  ];
  for (const m of modes) {
    it(`mode '${m}' is registered`, () => {
      expect(staticHandlerRegistry.has(m)).toBe(true);
    });
  }
});

// ── PreventAllDamage — global Fog-shape ──────────────────────────────────────
describe("Wave 60.E — PreventAllDamage (global)", () => {
  it("blanket prevention: any source-to-target damage is 0; DamagePrevented emitted, no DamageDealt", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 100, paper: mkPaper("Source") });
    const tgt = mintCard({ game: g, id: 101, paper: mkPaper("Target") });
    buildAndRegister(
      g,
      {
        mode: "PreventAllDamage",
        params: {},
        activeInZones: [],
      },
      9100,
      99100,
    );
    expect(wouldPreventDamage(g, src.id, "creature", tgt.id, false)).toBe(true);
    expect(wouldPreventDamage(g, src.id, "creature", tgt.id, true)).toBe(true);

    const action = new GameAction(g);
    const yields = collect(action.damage(src.id, "creature", tgt.id, 5, false));
    const events = collectEvents(yields);
    // Damage prevented — no DamageDealt; one DamagePrevented; no card mutation.
    expect(events.find((e) => e.kind === "DamageDealt")).toBeUndefined();
    expect(events.filter((e) => e.kind === "DamagePrevented")).toHaveLength(1);
    expect(tgt.damage).toBe(0);
  });
});

// ── PreventAllDamageBy — filter source ───────────────────────────────────────
describe("Wave 60.E — PreventAllDamageBy (filter source)", () => {
  it("matched source deals 0; unmatched source still deals full damage", () => {
    const g = mkGame();
    const matched = mintCard({ game: g, id: 200, paper: mkPaper("Matched") });
    const unmatched = mintCard({ game: g, id: 201, paper: mkPaper("Unmatched") });
    const tgt = mintCard({ game: g, id: 202, paper: mkPaper("Target") });

    // Static keys ValidSource$ Card.Self on the matched source card —
    // the predicate hits exactly that one card.
    buildAndRegister(
      g,
      {
        mode: "PreventAllDamageBy",
        params: { ValidSource: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      matched.id as unknown as number,
      99200,
    );

    expect(wouldPreventDamage(g, matched.id, "creature", tgt.id, false)).toBe(true);
    expect(wouldPreventDamage(g, unmatched.id, "creature", tgt.id, false)).toBe(false);

    const action = new GameAction(g);
    // Matched source — damage prevented.
    const matchedYields = collect(action.damage(matched.id, "creature", tgt.id, 4, false));
    expect(collectEvents(matchedYields).find((e) => e.kind === "DamageDealt")).toBeUndefined();
    expect(tgt.damage).toBe(0);

    // Unmatched source — damage flows through.
    const unmatchedYields = collect(action.damage(unmatched.id, "creature", tgt.id, 3, false));
    const unmatchedEvents = collectEvents(unmatchedYields);
    expect(unmatchedEvents.find((e) => e.kind === "DamageDealt")).toBeDefined();
    expect(tgt.damage).toBe(3);
  });
});

// ── PreventAllDamageTo — filter target ───────────────────────────────────────
describe("Wave 60.E — PreventAllDamageTo (filter target)", () => {
  it("damage to matched target is 0; damage to unmatched target flows full", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 300, paper: mkPaper("Source") });
    const matched = mintCard({ game: g, id: 301, paper: mkPaper("Matched") });
    const unmatched = mintCard({ game: g, id: 302, paper: mkPaper("Unmatched") });

    // Static keys ValidTarget$ Card.Self on the matched card — the
    // predicate hits exactly the one matched target.
    buildAndRegister(
      g,
      {
        mode: "PreventAllDamageTo",
        params: { ValidTarget: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      matched.id as unknown as number,
      99300,
    );

    expect(wouldPreventDamage(g, src.id, "creature", matched.id, false)).toBe(true);
    expect(wouldPreventDamage(g, src.id, "creature", unmatched.id, false)).toBe(false);

    const action = new GameAction(g);
    // Matched target — damage prevented.
    const matchedYields = collect(action.damage(src.id, "creature", matched.id, 5, false));
    expect(collectEvents(matchedYields).find((e) => e.kind === "DamageDealt")).toBeUndefined();
    expect(matched.damage).toBe(0);

    // Unmatched target — damage flows.
    const unmatchedYields = collect(action.damage(src.id, "creature", unmatched.id, 2, false));
    expect(collectEvents(unmatchedYields).find((e) => e.kind === "DamageDealt")).toBeDefined();
    expect(unmatched.damage).toBe(2);
  });
});

// ── Combat$ True filter — only combat damage prevented ───────────────────────
describe("Wave 60.E — Combat$ True filter", () => {
  it("Holy Day-shape: combat damage prevented; non-combat (spell) damage flows", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 400, paper: mkPaper("Source") });
    const tgt = mintCard({ game: g, id: 401, paper: mkPaper("Target") });

    // Holy Day: "Prevent all combat damage that would be dealt this turn."
    buildAndRegister(
      g,
      {
        mode: "PreventAllDamage",
        params: { Combat: { kind: "literal", raw: "True" } },
        activeInZones: [],
      },
      9400,
      99400,
    );

    expect(wouldPreventDamage(g, src.id, "creature", tgt.id, true)).toBe(true);
    expect(wouldPreventDamage(g, src.id, "creature", tgt.id, false)).toBe(false);

    const action = new GameAction(g);
    // Combat damage — prevented.
    const combatYields = collect(action.damage(src.id, "creature", tgt.id, 3, true));
    expect(collectEvents(combatYields).find((e) => e.kind === "DamageDealt")).toBeUndefined();
    expect(tgt.damage).toBe(0);

    // Non-combat (spell) damage — flows.
    const spellYields = collect(action.damage(src.id, "creature", tgt.id, 2, false));
    expect(collectEvents(spellYields).find((e) => e.kind === "DamageDealt")).toBeDefined();
    expect(tgt.damage).toBe(2);
  });
});

// ── Per-turn lifecycle — two consecutive events both blocked ─────────────────
describe("Wave 60.E — per-turn lifecycle", () => {
  it("two consecutive damage events are both blocked while the static is active", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 500, paper: mkPaper("Source") });
    const tgt = mintCard({ game: g, id: 501, paper: mkPaper("Target") });
    buildAndRegister(
      g,
      {
        mode: "PreventAllDamage",
        params: {},
        activeInZones: [],
      },
      9500,
      99500,
    );

    const action = new GameAction(g);
    const firstYields = collect(action.damage(src.id, "creature", tgt.id, 3, false));
    const secondYields = collect(action.damage(src.id, "creature", tgt.id, 4, true));

    // Both events resulted in DamagePrevented; neither emitted DamageDealt.
    expect(collectEvents(firstYields).filter((e) => e.kind === "DamagePrevented")).toHaveLength(1);
    expect(collectEvents(secondYields).filter((e) => e.kind === "DamagePrevented")).toHaveLength(1);
    expect(collectEvents(firstYields).find((e) => e.kind === "DamageDealt")).toBeUndefined();
    expect(collectEvents(secondYields).find((e) => e.kind === "DamageDealt")).toBeUndefined();
    expect(tgt.damage).toBe(0);
  });
});

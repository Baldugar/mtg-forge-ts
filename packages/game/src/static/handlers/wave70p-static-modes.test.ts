// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.P — final small-batch registry-walk gate statics regression
// tests. Covers:
//   - Registration smoke for CanBlockIfReach / CantBecomeMonarch /
//     CantChangeDayTime / TurnReversed / PhaseReversed.
//   - CanBlockIfReach: flying-rejection bypassed when matched
//     (blocker, attacker) pairing; non-matched pairing still rejects.
//   - CantBecomeMonarch: grantMonarch no-ops silently when matched;
//     prior monarch preserved; non-matched seat unaffected.
//   - CantChangeDayTime: tryUpkeepTransition no-ops silently when
//     proposed new state matches NewTime$.
//   - TurnReversed / PhaseReversed: registration flips the helper's
//     boolean read for matched seats; unregistration restores default.
//   - Lifecycle: deactivation reverses each gate.
import type {
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
import { Card } from "../../card.js";
import { isBlockLegal } from "../../combat/keywords/block-restrictions.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { grantMonarch } from "../../monarch/monarch-tracker.js";
import { tryUpkeepTransition } from "../../phase/day-night-tracker.js";
import {
  canBecomeMonarch,
  canBlockIfReach,
  canChangeDayTimeTo,
  isPhaseOrderReversed,
  isTurnOrderReversed,
} from "../../statics/wave70p-gate-helpers.js";
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
  /** Keyword strings to stamp directly on the live Card (e.g. "flying"). */
  readonly keywords?: readonly string[];
}
const mintCard = (opts: MintOpts): Card => {
  const cid = mkEntityId(opts.id);
  const seat: PlayerSeat = mkPlayerSeat(opts.seat ?? 0);
  const card = new Card(cid, opts.paper, seat, seat, opts.zone ?? ZoneType.Battlefield);
  // Mint the keyword set on the card directly so hasKeyword reads
  // it without a layer-engine pass. The PaperCard definition.keywords
  // surface is typed as readonly unknown[] (Wave 32 forward-compat),
  // so we pipe through MintOpts instead.
  if (opts.keywords && opts.keywords.length > 0) {
    card.keywords = new Set<string>(opts.keywords);
  }
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
describe("Wave 70.P — registration smoke", () => {
  const modes: readonly StaticAbilityMode[] = [
    "CanBlockIfReach",
    "CantBecomeMonarch",
    "CantChangeDayTime",
    "TurnReversed",
    "PhaseReversed",
  ];
  for (const m of modes) {
    it(`mode '${m}' is registered`, () => {
      expect(staticHandlerRegistry.has(m)).toBe(true);
    });
  }
});

// ── CanBlockIfReach — Dragon Hunter ──────────────────────────────────────────
describe("Wave 70.P — CanBlockIfReach", () => {
  it("flying-rejection bypassed when (blocker, attacker) matches; non-matched pairing still rejects", () => {
    const g = mkGame();
    const blocker = mintCard({
      game: g,
      id: 7000,
      paper: mkPaper("Dragon Hunter"),
      seat: 1,
    });
    const dragonAttacker = mintCard({
      game: g,
      id: 7001,
      paper: mkPaper("Niv-Mizzet", "Creature — Dragon"),
      seat: 0,
      keywords: ["flying"],
    });
    // Without the static: blocker has no flying / reach → flying check
    // rejects.
    expect(canBlockIfReach(g, blocker.id, dragonAttacker.id)).toBe(false);
    let res = isBlockLegal(g, blocker.id, dragonAttacker.id, [blocker.id]);
    expect(res.legal).toBe(false);
    expect(res.reason).toContain("flying");

    // Stamp the gate sourced from the blocker (Dragon Hunter shape:
    // ValidBlocker$ Card.Self, ValidAttacker$ Dragon).
    buildAndRegister(
      g,
      {
        mode: "CanBlockIfReach",
        params: {
          ValidBlocker: { kind: "literal", raw: "Card.Self" },
          ValidAttacker: { kind: "literal", raw: "Dragon" },
        },
        activeInZones: [],
      },
      blocker.id as unknown as number,
      80000,
      1,
    );

    expect(canBlockIfReach(g, blocker.id, dragonAttacker.id)).toBe(true);
    res = isBlockLegal(g, blocker.id, dragonAttacker.id, [blocker.id]);
    expect(res.legal).toBe(true);
  });

  it("non-Dragon flying attacker is not affected by the gate (ValidAttacker$ Dragon)", () => {
    const g = mkGame();
    const blocker = mintCard({
      game: g,
      id: 7100,
      paper: mkPaper("Dragon Hunter"),
      seat: 1,
    });
    const angelAttacker = mintCard({
      game: g,
      id: 7101,
      paper: mkPaper("Serra Angel", "Creature — Angel"),
      seat: 0,
      keywords: ["flying"],
    });
    // Stamp Dragon-only gate.
    buildAndRegister(
      g,
      {
        mode: "CanBlockIfReach",
        params: {
          ValidBlocker: { kind: "literal", raw: "Card.Self" },
          ValidAttacker: { kind: "literal", raw: "Dragon" },
        },
        activeInZones: [],
      },
      blocker.id as unknown as number,
      80100,
      1,
    );

    // Angel is not a Dragon — the ValidAttacker$ filter rejects, and
    // the flying check still fires.
    expect(canBlockIfReach(g, blocker.id, angelAttacker.id)).toBe(false);
    const res = isBlockLegal(g, blocker.id, angelAttacker.id, [blocker.id]);
    expect(res.legal).toBe(false);
  });
});

// ── CantBecomeMonarch — Jared Carthalion ─────────────────────────────────────
describe("Wave 70.P — CantBecomeMonarch", () => {
  it("grantMonarch no-ops silently when matched seat would become monarch", () => {
    const g = mkGame();
    const seat0 = mkPlayerSeat(0);
    // Without the gate: seat 0 may become monarch.
    expect(canBecomeMonarch(g, seat0)).toBe(true);
    expect(g.flags.monarch).toBeNull();

    // Stamp ValidPlayer$ You gate sourced from seat 0.
    buildAndRegister(
      g,
      {
        mode: "CantBecomeMonarch",
        params: { ValidPlayer: { kind: "literal", raw: "You" } },
        activeInZones: [],
      },
      8200,
      80200,
      0,
    );

    expect(canBecomeMonarch(g, seat0)).toBe(false);
    const events = grantMonarch(g, seat0);
    expect(events).toEqual([]);
    // Monarch slot stays null — grant rejected silently.
    expect(g.flags.monarch).toBeNull();
  });

  it("non-matched seat may still become the monarch", () => {
    const g = mkGame();
    // ValidPlayer$ You + controller seat 0 → only seat 0 gated.
    buildAndRegister(
      g,
      {
        mode: "CantBecomeMonarch",
        params: { ValidPlayer: { kind: "literal", raw: "You" } },
        activeInZones: [],
      },
      8300,
      80300,
      0,
    );
    const seat1 = mkPlayerSeat(1);
    expect(canBecomeMonarch(g, seat1)).toBe(true);
    const events = grantMonarch(g, seat1);
    expect(events.length).toBeGreaterThan(0);
    expect(g.flags.monarch).toBe(seat1);
  });
});

// ── CantChangeDayTime — Angel of Eternal Dawn ────────────────────────────────
describe("Wave 70.P — CantChangeDayTime", () => {
  it("tryUpkeepTransition no-ops silently when proposed new state matches NewTime$", () => {
    const g = mkGame();
    const seat0 = mkPlayerSeat(0);
    // Seed dayNight to "day" + record prior turn 0 spell-casts so the
    // CR 726.4 transition would normally flip day → night.
    g.flags.dayNight = "day";
    g.flags.lastTurnActiveSeat = seat0;
    g.flags.lastTurnSpellsCast.set(seat0, 0);
    expect(canChangeDayTimeTo(g, "night")).toBe(true);

    // Stamp NewTime$ Night gate (Angel of Eternal Dawn shape).
    buildAndRegister(
      g,
      {
        mode: "CantChangeDayTime",
        params: { NewTime: { kind: "literal", raw: "Night" } },
        activeInZones: [],
      },
      8400,
      80400,
      0,
    );

    expect(canChangeDayTimeTo(g, "night")).toBe(false);
    expect(canChangeDayTimeTo(g, "day")).toBe(true);

    // Try the transition — gated, no-op.
    const result = tryUpkeepTransition(g);
    expect(result).toBeNull();
    expect(g.flags.dayNight).toBe("day");
  });
});

// ── TurnReversed / PhaseReversed — Topsy Turvy ───────────────────────────────
describe("Wave 70.P — TurnReversed", () => {
  it("isTurnOrderReversed flips true on registration; clears on unregister", () => {
    const g = mkGame();
    const seat0 = mkPlayerSeat(0);
    expect(isTurnOrderReversed(g, seat0)).toBe(false);
    const s = buildAndRegister(
      g,
      {
        mode: "TurnReversed",
        params: { ValidPlayer: { kind: "literal", raw: "Player" } },
        activeInZones: [],
      },
      8500,
      80500,
      0,
    );
    expect(isTurnOrderReversed(g, seat0)).toBe(true);
    expect(isTurnOrderReversed(g, mkPlayerSeat(1))).toBe(true);
    g.staticEffectRegistry.unregister(s.id);
    expect(isTurnOrderReversed(g, seat0)).toBe(false);
  });
});

describe("Wave 70.P — PhaseReversed", () => {
  it("isPhaseOrderReversed flips true on registration; clears on unregister", () => {
    const g = mkGame();
    const seat0 = mkPlayerSeat(0);
    expect(isPhaseOrderReversed(g, seat0)).toBe(false);
    const s = buildAndRegister(
      g,
      {
        mode: "PhaseReversed",
        params: { ValidPlayer: { kind: "literal", raw: "Player" } },
        activeInZones: [],
      },
      8600,
      80600,
      0,
    );
    expect(isPhaseOrderReversed(g, seat0)).toBe(true);
    expect(isPhaseOrderReversed(g, mkPlayerSeat(1))).toBe(true);
    g.staticEffectRegistry.unregister(s.id);
    expect(isPhaseOrderReversed(g, seat0)).toBe(false);
  });
});

// ── Lifecycle: deactivation reverses each gate ───────────────────────────────
describe("Wave 70.P — lifecycle: deactivation reverses each gate", () => {
  it("unregistering each Wave 70.P static restores defaults", () => {
    const g = mkGame();
    const blocker = mintCard({
      game: g,
      id: 8800,
      paper: mkPaper("Dragon Hunter"),
      seat: 1,
    });
    const dragonAttacker = mintCard({
      game: g,
      id: 8801,
      paper: mkPaper("Dragon", "Creature — Dragon"),
      seat: 0,
      keywords: ["flying"],
    });
    const seat0 = mkPlayerSeat(0);

    const sCanBlock = buildAndRegister(
      g,
      {
        mode: "CanBlockIfReach",
        params: {
          ValidBlocker: { kind: "literal", raw: "Card.Self" },
          ValidAttacker: { kind: "literal", raw: "Dragon" },
        },
        activeInZones: [],
      },
      blocker.id as unknown as number,
      88800,
      1,
    );
    const sCantMonarch = buildAndRegister(
      g,
      {
        mode: "CantBecomeMonarch",
        params: { ValidPlayer: { kind: "literal", raw: "You" } },
        activeInZones: [],
      },
      8802,
      88802,
      0,
    );
    const sCantDay = buildAndRegister(
      g,
      {
        mode: "CantChangeDayTime",
        params: { NewTime: { kind: "literal", raw: "Night" } },
        activeInZones: [],
      },
      8803,
      88803,
      0,
    );
    const sTurn = buildAndRegister(
      g,
      {
        mode: "TurnReversed",
        params: { ValidPlayer: { kind: "literal", raw: "Player" } },
        activeInZones: [],
      },
      8804,
      88804,
      0,
    );
    const sPhase = buildAndRegister(
      g,
      {
        mode: "PhaseReversed",
        params: { ValidPlayer: { kind: "literal", raw: "Player" } },
        activeInZones: [],
      },
      8805,
      88805,
      0,
    );

    expect(canBlockIfReach(g, blocker.id, dragonAttacker.id)).toBe(true);
    expect(canBecomeMonarch(g, seat0)).toBe(false);
    expect(canChangeDayTimeTo(g, "night")).toBe(false);
    expect(isTurnOrderReversed(g, seat0)).toBe(true);
    expect(isPhaseOrderReversed(g, seat0)).toBe(true);

    g.staticEffectRegistry.unregister(sCanBlock.id);
    g.staticEffectRegistry.unregister(sCantMonarch.id);
    g.staticEffectRegistry.unregister(sCantDay.id);
    g.staticEffectRegistry.unregister(sTurn.id);
    g.staticEffectRegistry.unregister(sPhase.id);

    expect(canBlockIfReach(g, blocker.id, dragonAttacker.id)).toBe(false);
    expect(canBecomeMonarch(g, seat0)).toBe(true);
    expect(canChangeDayTimeTo(g, "night")).toBe(true);
    expect(isTurnOrderReversed(g, seat0)).toBe(false);
    expect(isPhaseOrderReversed(g, seat0)).toBe(false);
  });
});

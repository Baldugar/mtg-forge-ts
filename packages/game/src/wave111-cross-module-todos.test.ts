// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 111 — cross-module TODO(advanced) sweep round 16 regression tests.
//
// Picks closed (one assertion bundle per pick):
//   1. static/handlers/attack-restrict-static.ts — multi-defender filter
//      (`ValidDefender$ You,Planeswalker.YouCtrl`). Comma-OR seat lane
//      AND card lane evaluated symmetrically; either-lane match counts
//      attackers toward the cap.
//   2. static/handlers/block-restrict-static.ts — Mirri-shape per-defender
//      allotment (`each opponent can't block with more than one`).
//      `exceedsBlockerCap` buckets by defender seat / card and tests
//      each bucket against `maxBlockers` independently.
//   3. static/handlers/prevent-damage-static.ts — `PreventionEffect$ N`
//      shield-count metadata. Positive N is "prevent up to N";
//      negative N is "prevent all but |N|"; undefined preserves the
//      canonical Fog/Holy-Day full-prevention shape.
//      `applyPreventionShields` clamps remaining damage accordingly.
//   4. static/handlers/tap-power-value-static.ts — deeper `ValidSA$`
//      filter chains (e.g. `Activated.Crew+Vehicle.cmcEQ3`). The
//      everything-after-the-tag tail is reassembled into a Wave-32
//      cardMatchesFilter expression and tested against the activating
//      source card.
//   5. static/handlers/flip-coin-mod-static.ts — `CheckSVar$` +
//      `SVarCompare$` per-turn-counter gate (Edgar's "first time you
//      flip a coin each turn" shape). The payload's
//      `checkSVarSatisfied(game)` thunk is consulted at match time and
//      lapses when the threshold is crossed.
//   6. static/handlers/can-exhaust-static.ts — symmetric CheckSVar$
//      gate (Elvish Refueler's per-turn activation gate). Always-true
//      when both params are omitted (back-compat).
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
import { Card } from "./card.js";
import type { GameMeta } from "./game-meta.js";
import type { GameRules } from "./game-rules.js";
import { Game } from "./game.js";
import type { AttackRestrictPayload } from "./static/handlers/attack-restrict-static.js";
import type { BlockRestrictPayload } from "./static/handlers/block-restrict-static.js";
import type { CanExhaustPayload } from "./static/handlers/can-exhaust-static.js";
import type { FlipCoinModPayload } from "./static/handlers/flip-coin-mod-static.js";
import type { PreventDamagePayload } from "./static/handlers/prevent-damage-static.js";
import type { TapPowerValuePayload } from "./static/handlers/tap-power-value-static.js";
import { staticHandlerRegistry } from "./static/static-handler.js";
import { applyPreventionShields, wouldPreventDamage } from "./statics/wave60-damage-gates.js";
import {
  type DeclaredAttackerForCap,
  type DeclaredBlockerForCap,
  exceedsAttackerCap,
  exceedsBlockerCap,
} from "./statics/wave70h-combat-gates.js";
import { Battlefield } from "./zone/zones/battlefield.js";
import { Graveyard } from "./zone/zones/graveyard.js";
import { Hand } from "./zone/zones/hand.js";
import { Library } from "./zone/zones/library.js";
import "./static/handlers/index.js";

// ── shared fixtures ──────────────────────────────────────────────────────────
const alice: LobbyPlayer = { id: "P0", name: "P0", controllerKind: "human" };
const bob: LobbyPlayer = { id: "P1", name: "P1", controllerKind: "human" };

const rules: GameRules = {
  formatId: "standard",
  startingLife: 20,
  startingHandSize: 7,
  mulliganRule: "london",
  firstPlayerSkipsDraw: false,
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
  cardDataSyncedAt: "2026-04-30T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "wave111",
};

const mkGame = (): Game => {
  const game = new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(0xfacefeed11n),
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

// ── Pick 1: AttackRestrict multi-defender filter ────────────────────────────
describe("Wave 111 — Pick 1: AttackRestrict multi-defender filter (comma-OR)", () => {
  it("`ValidDefender$ You,Planeswalker.YouCtrl` matches both seat-lane AND card-lane defenders", () => {
    const g = mkGame();
    // Mint a planeswalker permanent on the controller seat (seat 0).
    const pw = mintCard({
      game: g,
      id: 1100,
      paper: mkPaper("Mywalker", "Legendary Planeswalker — X"),
    });
    const s = buildAndRegister(
      g,
      {
        mode: "AttackRestrict",
        params: {
          MaxAttackers: { kind: "literal", raw: "1" },
          ValidDefender: { kind: "literal", raw: "You,Planeswalker.YouCtrl" },
        },
        activeInZones: [],
      },
      1101,
      11101,
    );
    const payload = s.describe() as AttackRestrictPayload;
    expect(payload.kind).toBe("attackRestrict");
    expect(payload.hasDefenderFilter).toBe(true);
    // Seat-lane match: attacking seat 0 (You) → matches.
    expect(payload.defenderSeatMatches(mkPlayerSeat(0))).toBe(true);
    // Seat-lane miss: attacking seat 1 (opp) → only the planeswalker
    // alt could match if it were an opp's pw; not our seat → false.
    expect(payload.defenderSeatMatches(mkPlayerSeat(1))).toBe(false);
    // Card-lane match: attacking the static's controller's planeswalker.
    expect(payload.defenderCardMatches(pw.id, g)).toBe(true);
  });

  it("Cap fires when 2 attackers cross the comma-OR filter (one seat-side, one card-side)", () => {
    const g = mkGame();
    const pw = mintCard({
      game: g,
      id: 1110,
      paper: mkPaper("Mywalker", "Legendary Planeswalker — X"),
    });
    buildAndRegister(
      g,
      {
        mode: "AttackRestrict",
        params: {
          MaxAttackers: { kind: "literal", raw: "1" },
          ValidDefender: { kind: "literal", raw: "You,Planeswalker.YouCtrl" },
        },
        activeInZones: [],
      },
      1111,
      11111,
    );
    const declared: DeclaredAttackerForCap[] = [
      { attackerId: mkEntityId(9001), defender: { kind: "player", seat: mkPlayerSeat(0) } },
      { attackerId: mkEntityId(9002), defender: { kind: "planeswalker", id: pw.id } },
    ];
    const violation = exceedsAttackerCap(g, declared);
    expect(violation).not.toBeNull();
    expect(violation?.count).toBe(2);
  });
});

// ── Pick 2: BlockRestrict per-defender allotment ────────────────────────────
describe("Wave 111 — Pick 2: BlockRestrict per-defender allotment (Mirri-shape)", () => {
  it("`ValidDefender$ Opponent` triggers per-opponent allotment (cap fires when ANY opp bucket overflows)", () => {
    const g = mkGame();
    const s = buildAndRegister(
      g,
      {
        mode: "BlockRestrict",
        params: {
          MaxBlockers: { kind: "literal", raw: "1" },
          ValidDefender: { kind: "literal", raw: "Opponent" },
        },
        activeInZones: [],
      },
      2100,
      12100,
    );
    const payload = s.describe() as BlockRestrictPayload;
    expect(payload.perDefenderAllotment).toBe(true);
    // Two blockers BOTH against attackers on seat 1's side (opp). The
    // bucket for seat-1 has 2 entries → exceeds cap of 1 → violation.
    const declared: DeclaredBlockerForCap[] = [
      {
        blockerId: mkEntityId(9101),
        attackerId: mkEntityId(9201),
        defender: { kind: "player", seat: mkPlayerSeat(1) },
      },
      {
        blockerId: mkEntityId(9102),
        attackerId: mkEntityId(9202),
        defender: { kind: "player", seat: mkPlayerSeat(1) },
      },
    ];
    const violation = exceedsBlockerCap(g, declared);
    expect(violation).not.toBeNull();
    expect(violation?.count).toBe(2);
  });

  it("Per-defender allotment lets each defender absorb its own quota independently", () => {
    const g = mkGame();
    // Set up a 3-player-shape board: one blocker against opp seat 1, one
    // against the controller's own pw card. Per-bucket: each has count 1
    // → no overflow.
    const pw = mintCard({
      game: g,
      id: 2150,
      paper: mkPaper("OppPW", "Legendary Planeswalker — X"),
      seat: 1,
    });
    buildAndRegister(
      g,
      {
        mode: "BlockRestrict",
        params: {
          MaxBlockers: { kind: "literal", raw: "1" },
          EachOpponent: { kind: "literal", raw: "True" },
        },
        activeInZones: [],
      },
      2151,
      12151,
    );
    const declared: DeclaredBlockerForCap[] = [
      {
        blockerId: mkEntityId(9301),
        attackerId: mkEntityId(9401),
        defender: { kind: "player", seat: mkPlayerSeat(1) },
      },
      {
        blockerId: mkEntityId(9302),
        attackerId: mkEntityId(9402),
        defender: { kind: "planeswalker", id: pw.id },
      },
    ];
    const violation = exceedsBlockerCap(g, declared);
    // Per-bucket counts of 1 each, neither exceeds cap.
    expect(violation).toBeNull();
  });

  it("Default cap shape (no allotment flag) still sums cumulatively", () => {
    const g = mkGame();
    const s = buildAndRegister(
      g,
      {
        mode: "BlockRestrict",
        params: {
          MaxBlockers: { kind: "literal", raw: "1" },
          // No ValidDefender$ + no EachOpponent$ → per-defender flag false
          // → default cumulative semantics.
        },
        activeInZones: [],
      },
      2200,
      12200,
    );
    const payload = s.describe() as BlockRestrictPayload;
    expect(payload.perDefenderAllotment).toBe(false);
    const declared: DeclaredBlockerForCap[] = [
      {
        blockerId: mkEntityId(9501),
        attackerId: mkEntityId(9601),
        defender: { kind: "player", seat: mkPlayerSeat(0) },
      },
      {
        blockerId: mkEntityId(9502),
        attackerId: mkEntityId(9602),
        defender: { kind: "player", seat: mkPlayerSeat(1) },
      },
    ];
    const violation = exceedsBlockerCap(g, declared);
    // Cumulative count = 2 > cap 1 → violation.
    expect(violation).not.toBeNull();
    expect(violation?.count).toBe(2);
  });
});

// ── Pick 3: PreventDamage shield-count metadata ─────────────────────────────
describe("Wave 111 — Pick 3: PreventDamage `PreventionEffect$ N` shield-count", () => {
  it("Positive N: `applyPreventionShields` subtracts N from incoming damage", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 3100, paper: mkPaper("DmgSrc") });
    const s = buildAndRegister(
      g,
      {
        mode: "PreventAllDamage",
        params: {
          PreventionEffect: { kind: "literal", raw: "2" },
        },
        activeInZones: [],
      },
      3101,
      13101,
    );
    const payload = s.describe() as PreventDamagePayload;
    expect(payload.preventionEffect).toBe(2);
    // wouldPreventDamage returns FALSE for shield-count statics (partial,
    // not full prevention).
    expect(wouldPreventDamage(g, src.id, "player", mkPlayerSeat(1), false)).toBe(false);
    // applyPreventionShields clamps: 5 incoming damage minus 2 shielded = 3 surviving.
    expect(applyPreventionShields(g, src.id, "player", mkPlayerSeat(1), false, 5)).toBe(3);
  });

  it("Negative N: `applyPreventionShields` keeps |N| (Ajani-Steadfast 'all but 1')", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 3200, paper: mkPaper("DmgSrc") });
    buildAndRegister(
      g,
      {
        mode: "PreventAllDamage",
        params: {
          PreventionEffect: { kind: "literal", raw: "-1" },
        },
        activeInZones: [],
      },
      3201,
      13201,
    );
    // 5 incoming damage, "all but 1" → keeps 1 surviving.
    expect(applyPreventionShields(g, src.id, "player", mkPlayerSeat(1), false, 5)).toBe(1);
    // 0 incoming damage stays 0 (clamp at 0, not |N|).
    expect(applyPreventionShields(g, src.id, "player", mkPlayerSeat(1), false, 0)).toBe(0);
  });

  it("Undefined N: full prevention (canonical Fog-shape) preserved via `wouldPreventDamage`", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 3300, paper: mkPaper("DmgSrc") });
    const s = buildAndRegister(
      g,
      {
        mode: "PreventAllDamage",
        params: {
          // No PreventionEffect$ → undefined → full prevention.
        },
        activeInZones: [],
      },
      3301,
      13301,
    );
    const payload = s.describe() as PreventDamagePayload;
    expect(payload.preventionEffect).toBeUndefined();
    expect(wouldPreventDamage(g, src.id, "player", mkPlayerSeat(1), false)).toBe(true);
    expect(applyPreventionShields(g, src.id, "player", mkPlayerSeat(1), false, 5)).toBe(0);
  });
});

// ── Pick 4: TapPowerValue deeper ValidSA filter chains ──────────────────────
describe("Wave 111 — Pick 4: TapPowerValue deeper `ValidSA$` filter chains", () => {
  it("`Activated.Crew+Vehicle.YouCtrl` honors deeper qualifier chain (controller filter)", () => {
    const g = mkGame();
    // Vehicle on the controller's seat 0 → `Vehicle.YouCtrl` matches.
    const myVehicle = mintCard({
      game: g,
      id: 4100,
      paper: mkPaper("MyVehicle", "Artifact — Vehicle"),
      seat: 0,
    });
    // Vehicle on opp seat 1 → `Vehicle.YouCtrl` rejects.
    const oppVehicle = mintCard({
      game: g,
      id: 4101,
      paper: mkPaper("OppVehicle", "Artifact — Vehicle"),
      seat: 1,
    });
    const s = buildAndRegister(
      g,
      {
        mode: "TapPowerValue",
        params: {
          ValidSA: { kind: "literal", raw: "Activated.Crew+Vehicle.YouCtrl" },
          ValidCard: { kind: "literal", raw: "Card.Self" },
          Value: { kind: "literal", raw: "2" },
        },
        activeInZones: [],
      },
      4150,
      14150,
    );
    const payload = s.describe() as TapPowerValuePayload;
    expect(payload.kind).toBe("tapPowerValue");
    // Vehicle on the static's controller → deeper chain `Vehicle.YouCtrl` matches.
    expect(payload.saMatches({ saKind: "Crew", activatingSourceId: myVehicle.id }, g)).toBe(true);
    // Vehicle on opponent → deeper chain rejects.
    expect(payload.saMatches({ saKind: "Crew", activatingSourceId: oppVehicle.id }, g)).toBe(false);
    // Wrong activation kind → misses regardless of source filter.
    expect(payload.saMatches({ saKind: "Saddle", activatingSourceId: myVehicle.id }, g)).toBe(false);
  });

  it("Tapped-state filter chain (`Activated.Crew+Vehicle.untapped`) tracks live state", () => {
    const g = mkGame();
    const v = mintCard({
      game: g,
      id: 4200,
      paper: mkPaper("Vehicle2", "Artifact — Vehicle"),
    });
    const s = buildAndRegister(
      g,
      {
        mode: "TapPowerValue",
        params: {
          ValidSA: { kind: "literal", raw: "Activated.Crew+Vehicle.untapped" },
          ValidCard: { kind: "literal", raw: "Card.Self" },
          Value: { kind: "literal", raw: "Toughness" },
        },
        activeInZones: [],
      },
      4250,
      14250,
    );
    const payload = s.describe() as TapPowerValuePayload;
    expect(payload.useToughness).toBe(true);
    // Initially untapped → matches.
    expect(payload.saMatches({ saKind: "Crew", activatingSourceId: v.id }, g)).toBe(true);
    // Tap it → no longer matches.
    v.tapped = true;
    expect(payload.saMatches({ saKind: "Crew", activatingSourceId: v.id }, g)).toBe(false);
  });

  it("Pure-tag fast path (`Activated.Station`) still matches any source (back-compat)", () => {
    const g = mkGame();
    const ship = mintCard({
      game: g,
      id: 4300,
      paper: mkPaper("Spacecraft", "Artifact — Spacecraft"),
    });
    const s = buildAndRegister(
      g,
      {
        mode: "TapPowerValue",
        params: {
          ValidSA: { kind: "literal", raw: "Activated.Station" },
          ValidCard: { kind: "literal", raw: "Card.Self" },
          Value: { kind: "literal", raw: "Toughness" },
        },
        activeInZones: [],
      },
      4350,
      14350,
    );
    const payload = s.describe() as TapPowerValuePayload;
    expect(payload.useToughness).toBe(true);
    expect(payload.saMatches({ saKind: "Station", activatingSourceId: ship.id }, g)).toBe(true);
  });
});

// ── Pick 5: FlipCoinMod CheckSVar gate ──────────────────────────────────────
describe("Wave 111 — Pick 5: FlipCoinMod `CheckSVar$` + `SVarCompare$` gate", () => {
  it("Numeric-literal CheckSVar$ + GE1 → satisfied; LT1 → not satisfied", () => {
    const g = mkGame();
    const sLt = buildAndRegister(
      g,
      {
        mode: "FlipCoinMod",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          Result: { kind: "literal", raw: "True" },
          CheckSVar: { kind: "literal", raw: "0" },
          SVarCompare: { kind: "literal", raw: "LT1" },
        },
        activeInZones: [],
      },
      5100,
      15100,
    );
    const lt = sLt.describe() as FlipCoinModPayload;
    // 0 LT 1 → satisfied (Edgar's "first time" pattern: while count is below 1 the gate fires).
    expect(lt.checkSVarSatisfied(g)).toBe(true);

    const sGe = buildAndRegister(
      g,
      {
        mode: "FlipCoinMod",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          Result: { kind: "literal", raw: "True" },
          CheckSVar: { kind: "literal", raw: "0" },
          SVarCompare: { kind: "literal", raw: "GE1" },
        },
        activeInZones: [],
      },
      5101,
      15101,
    );
    const ge = sGe.describe() as FlipCoinModPayload;
    // 0 GE 1 → false.
    expect(ge.checkSVarSatisfied(g)).toBe(false);
  });

  it("`Count$Players` resolves against the player roster (3+ player gate)", () => {
    const g = mkGame();
    const s = buildAndRegister(
      g,
      {
        mode: "FlipCoinMod",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          DoubleFlip: { kind: "literal", raw: "True" },
          CheckSVar: { kind: "literal", raw: "Count$Players" },
          SVarCompare: { kind: "literal", raw: "GE2" },
        },
        activeInZones: [],
      },
      5200,
      15200,
    );
    const payload = s.describe() as FlipCoinModPayload;
    // 2-seat fixture → players.length GE 2 → satisfied.
    expect(payload.checkSVarSatisfied(g)).toBe(true);
  });

  it("No CheckSVar$ → gate is always-satisfied (back-compat)", () => {
    const g = mkGame();
    const s = buildAndRegister(
      g,
      {
        mode: "FlipCoinMod",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          Result: { kind: "literal", raw: "True" },
        },
        activeInZones: [],
      },
      5300,
      15300,
    );
    const payload = s.describe() as FlipCoinModPayload;
    expect(payload.checkSVarSatisfied(g)).toBe(true);
  });
});

// ── Pick 6: CanExhaust CheckSVar gate (symmetric) ───────────────────────────
describe("Wave 111 — Pick 6: CanExhaust `CheckSVar$` + `SVarCompare$` gate", () => {
  it("Default (no CheckSVar$) is always-satisfied", () => {
    const g = mkGame();
    const s = buildAndRegister(
      g,
      {
        mode: "CanExhaust",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          PlayerTurn: { kind: "literal", raw: "You" },
        },
        activeInZones: [],
      },
      6100,
      16100,
    );
    const payload = s.describe() as CanExhaustPayload;
    expect(payload.checkSVarSatisfied(g)).toBe(true);
  });

  it("Recognised SVar key + comparator gates the modifier (Elvish-Refueler shape)", () => {
    const g = mkGame();
    const s = buildAndRegister(
      g,
      {
        mode: "CanExhaust",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          PlayerTurn: { kind: "literal", raw: "You" },
          // 0 == "haven't activated yet"; LT1 → satisfied while no
          // activation has happened. Lapses when the counter increments.
          CheckSVar: { kind: "literal", raw: "0" },
          SVarCompare: { kind: "literal", raw: "LT1" },
        },
        activeInZones: [],
      },
      6200,
      16200,
    );
    const payload = s.describe() as CanExhaustPayload;
    expect(payload.checkSVarSatisfied(g)).toBe(true);
  });

  it("Unknown SVar key falls back to 0 (Forge missing-SVar default), gate evaluates against 0", () => {
    const g = mkGame();
    const s = buildAndRegister(
      g,
      {
        mode: "CanExhaust",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          // Unknown key resolves to 0; 0 LT 1 → true.
          CheckSVar: { kind: "literal", raw: "Count$Unknown_Made_Up_Key" },
          SVarCompare: { kind: "literal", raw: "LT1" },
        },
        activeInZones: [],
      },
      6300,
      16300,
    );
    const payload = s.describe() as CanExhaustPayload;
    expect(payload.checkSVarSatisfied(g)).toBe(true);
  });
});

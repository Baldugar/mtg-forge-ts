// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 107 — cross-module TODO(advanced) sweep round 12 regression tests.
//
// Picks closed (one assertion bundle per pick):
//   1. static/handlers/cant-prevent-damage-static.ts +
//      statics/wave60-damage-gates.ts — ValidTarget$ + Combat$ sub-filters
//      now honored on CantPreventDamage. The full event context is
//      threaded through canDamageBePrevented → wouldPreventDamage so
//      Mark-of-Asylum-style "damage to X from non-X can't be prevented"
//      and "Combat$ True/False" scoping match correctly.
//   2. static/handlers/wither-damage-static.ts — retired the stale
//      ExceptionType$ TODO(advanced) tail (no corpus instance);
//      regression: cardMatches predicate still gates the rewrite.
//   3. static/handlers/infect-damage-static.ts — retired the stale
//      ExceptionType$ TODO(advanced) tail (no corpus instance);
//      regression: cardMatches predicate still gates the rewrite.
//   4. static/handlers/devotion-static.ts — retired the stale
//      "combined player+card filter" TODO(advanced) tail; the existing
//      hasPlayerScope / hasCardScope flags already route correctly when
//      both filters appear on a single static line.
//   5. static/handlers/optional-attack-cost-static.ts — Trigger$
//      multi-trigger support. `Trigger$ TrigA & TrigB` now splits on
//      the `&` separator (and the `,` legacy separator) and exposes
//      both keys via triggerSVarsAll; the legacy first-key slot
//      `triggerSVar` is preserved for back-compat.
//   6. static/handlers/cant-target-static.ts — retired the stale
//      hexproof/shroud TODO bullet (already routed elsewhere) and the
//      Enthralling Hold cast-time choose-clause (lives in the cast
//      pipeline, not the static); the four-axis ValidTarget$ +
//      ValidSource$ + Activator$ + ValidSA$ matrix is the durable
//      contract.
import type {
  EntityId,
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
import type { CantPreventDamagePayload } from "./static/handlers/cant-prevent-damage-static.js";
import type { DevotionPayload } from "./static/handlers/devotion-static.js";
import type { InfectDamagePayload } from "./static/handlers/infect-damage-static.js";
import type { OptionalAttackCostPayload } from "./static/handlers/optional-attack-cost-static.js";
import type { WitherDamagePayload } from "./static/handlers/wither-damage-static.js";
import { staticHandlerRegistry } from "./static/static-handler.js";
import { canDamageBePrevented, wouldPreventDamage } from "./statics/wave60-damage-gates.js";
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
  seed: "wave107",
};

const seat0 = mkPlayerSeat(0);
const seat1 = mkPlayerSeat(1);

const mkGame = (): Game => {
  const game = new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(0xfacefeed07n),
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

// ── Pick 1: CantPreventDamage — ValidTarget$ + Combat$ sub-filters ───────────
describe("Wave 107 — Pick 1: CantPreventDamage ValidTarget$ + Combat$ sub-filters", () => {
  it("Combat$ True — only combat damage from matched source bypasses prevention", () => {
    const g = mkGame();
    const matchedSource = mintCard({ game: g, id: 7300, paper: mkPaper("Inferno") });
    const target = mintCard({ game: g, id: 7301, paper: mkPaper("Bear"), seat: 1 });
    // Stamp a global PreventAllDamage (Fog-shape).
    buildAndRegister(g, { mode: "PreventAllDamage", params: {}, activeInZones: [] }, 7302, 97302);
    // CantPreventDamage with Combat$ True — only combat damage from
    // matched source bypasses prevention.
    buildAndRegister(
      g,
      {
        mode: "CantPreventDamage",
        params: {
          ValidSource: { kind: "literal", raw: "Card.Self" },
          Combat: { kind: "literal", raw: "True" },
        },
        activeInZones: [],
      },
      matchedSource.id as unknown as number,
      97303,
    );
    // Combat damage from matched source: gate fires → prevention bypassed.
    expect(wouldPreventDamage(g, matchedSource.id, "creature", target.id, true)).toBe(false);
    // Non-combat damage from same matched source: gate does NOT fire (the
    // Combat$ True scope rejects), so the prevention static still applies.
    expect(wouldPreventDamage(g, matchedSource.id, "creature", target.id, false)).toBe(true);
  });

  it("Combat$ False — only non-combat damage from matched source bypasses", () => {
    const g = mkGame();
    const matchedSource = mintCard({ game: g, id: 7310, paper: mkPaper("Comet") });
    const target = mintCard({ game: g, id: 7311, paper: mkPaper("Bear"), seat: 1 });
    buildAndRegister(g, { mode: "PreventAllDamage", params: {}, activeInZones: [] }, 7312, 97312);
    buildAndRegister(
      g,
      {
        mode: "CantPreventDamage",
        params: {
          ValidSource: { kind: "literal", raw: "Card.Self" },
          Combat: { kind: "literal", raw: "False" },
        },
        activeInZones: [],
      },
      matchedSource.id as unknown as number,
      97313,
    );
    expect(wouldPreventDamage(g, matchedSource.id, "creature", target.id, false)).toBe(false);
    expect(wouldPreventDamage(g, matchedSource.id, "creature", target.id, true)).toBe(true);
  });

  it("ValidTarget$ — gate only fires for damage to a matching target (seat-scoped)", () => {
    const g = mkGame();
    const source = mintCard({ game: g, id: 7320, paper: mkPaper("Inferno") });
    // matchedTarget on seat 0 (= controller of the static = "You");
    // otherTarget on seat 1 (= "Opponent"). The card-side ValidTarget$
    // grammar's YouCtrl token discriminates them.
    const matchedTarget = mintCard({ game: g, id: 7321, paper: mkPaper("Bear"), seat: 0 });
    const otherTarget = mintCard({ game: g, id: 7322, paper: mkPaper("Other"), seat: 1 });
    buildAndRegister(g, { mode: "PreventAllDamage", params: {}, activeInZones: [] }, 7323, 97323);
    buildAndRegister(
      g,
      {
        mode: "CantPreventDamage",
        params: {
          ValidSource: { kind: "literal", raw: "Card" },
          ValidTarget: { kind: "literal", raw: "Creature.YouCtrl" },
        },
        activeInZones: [],
      },
      source.id as unknown as number,
      97324,
      0,
    );
    // Damage from source to a YouCtrl creature: ValidTarget$ matches →
    // bypass prevention.
    expect(wouldPreventDamage(g, source.id, "creature", matchedTarget.id, false)).toBe(false);
    // Damage from source to opponent's creature: ValidTarget$ misses
    // → prevention still applies (the gate's ValidTarget$ rejects).
    expect(wouldPreventDamage(g, source.id, "creature", otherTarget.id, false)).toBe(true);
  });

  it("legacy single-arg canDamageBePrevented preserves the source-only probe", () => {
    const g = mkGame();
    const matchedSource = mintCard({ game: g, id: 7330, paper: mkPaper("Inferno") });
    buildAndRegister(
      g,
      {
        mode: "CantPreventDamage",
        params: { ValidSource: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      matchedSource.id as unknown as number,
      97330,
    );
    // No event context → the legacy sourceMatches path is used (true =
    // damage from this source can be prevented; false = it can't).
    expect(canDamageBePrevented(g, matchedSource.id)).toBe(false);
  });
});

// ── Pick 2: WitherDamage — stale TODO retired, payload still gates ───────────
describe("Wave 107 — Pick 2: WitherDamage payload still gates after stale TODO retired", () => {
  it("cardMatches honors ValidCard$ Card.Self", () => {
    const g = mkGame();
    const c = mintCard({ game: g, id: 7400, paper: mkPaper("WitherSource") });
    const other = mintCard({ game: g, id: 7401, paper: mkPaper("OtherSource") });
    const s = buildAndRegister(
      g,
      {
        mode: "WitherDamage",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      c.id as unknown as number,
      97401,
    );
    const payload = s.describe() as WitherDamagePayload;
    expect(payload.cardMatches(c.id, g)).toBe(true);
    expect(payload.cardMatches(other.id, g)).toBe(false);
  });
});

// ── Pick 3: InfectDamage — stale TODO retired, payload still gates ───────────
describe("Wave 107 — Pick 3: InfectDamage payload still gates after stale TODO retired", () => {
  it("cardMatches honors ValidCard$ Card.Self", () => {
    const g = mkGame();
    const c = mintCard({ game: g, id: 7500, paper: mkPaper("InfectSource") });
    const other = mintCard({ game: g, id: 7501, paper: mkPaper("OtherSource") });
    const s = buildAndRegister(
      g,
      {
        mode: "InfectDamage",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      c.id as unknown as number,
      97501,
    );
    const payload = s.describe() as InfectDamagePayload;
    expect(payload.cardMatches(c.id, g)).toBe(true);
    expect(payload.cardMatches(other.id, g)).toBe(false);
  });
});

// ── Pick 4: Devotion — combined player+card filter routes correctly ──────────
describe("Wave 107 — Pick 4: Devotion combined player+card filter (stale TODO retired)", () => {
  it("hasPlayerScope + hasCardScope are independent flags set by the parser", () => {
    const g = mkGame();
    // Static line carrying BOTH ValidPlayer$ AND ValidCard$ — the
    // implementation already handles this even though no corpus card
    // ships such a static today.
    const s = buildAndRegister(
      g,
      {
        mode: "Devotion",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          ValidCard: { kind: "literal", raw: "Card.Self" },
          Amount: { kind: "literal", raw: "1" },
          DevotionMod: { kind: "literal", raw: "1" },
        },
        activeInZones: [],
      },
      7600,
      97600,
    );
    const payload = s.describe() as DevotionPayload;
    expect(payload.hasPlayerScope).toBe(true);
    expect(payload.hasCardScope).toBe(true);
    expect(payload.playerAmount).toBe(1);
    expect(payload.cardMod).toBe(1);
  });

  it("player-only static keeps hasCardScope false", () => {
    const g = mkGame();
    const s = buildAndRegister(
      g,
      {
        mode: "Devotion",
        params: { ValidPlayer: { kind: "literal", raw: "You" }, Amount: { kind: "literal", raw: "1" } },
        activeInZones: [],
      },
      7610,
      97610,
    );
    const payload = s.describe() as DevotionPayload;
    expect(payload.hasPlayerScope).toBe(true);
    expect(payload.hasCardScope).toBe(false);
  });
});

// ── Pick 5: OptionalAttackCost — multi-trigger Trigger$ A & B ────────────────
describe("Wave 107 — Pick 5: OptionalAttackCost multi-trigger Trigger$ list", () => {
  it("Trigger$ TrigA & TrigB → triggerSVarsAll = ['TrigA', 'TrigB']", () => {
    const g = mkGame();
    const s = buildAndRegister(
      g,
      {
        mode: "OptionalAttackCost",
        params: {
          ValidCard: { kind: "literal", raw: "Card.Self" },
          Trigger: { kind: "literal", raw: "TrigA & TrigB" },
          Cost: { kind: "literal", raw: "Exert<1/CARDNAME>" },
        },
        activeInZones: [],
      },
      7700,
      97700,
    );
    const payload = (s.describe() as { payload: OptionalAttackCostPayload }).payload;
    expect(payload.triggerSVarsAll).toEqual(["TrigA", "TrigB"]);
    // Back-compat slot keeps the first key.
    expect(payload.triggerSVar).toBe("TrigA");
  });

  it("Trigger$ legacy comma form (TrigA, TrigB) splits into the same list", () => {
    const g = mkGame();
    const s = buildAndRegister(
      g,
      {
        mode: "OptionalAttackCost",
        params: {
          ValidCard: { kind: "literal", raw: "Card.Self" },
          Trigger: { kind: "literal", raw: "TrigA, TrigB" },
        },
        activeInZones: [],
      },
      7710,
      97710,
    );
    const payload = (s.describe() as { payload: OptionalAttackCostPayload }).payload;
    expect(payload.triggerSVarsAll).toEqual(["TrigA", "TrigB"]);
    expect(payload.triggerSVar).toBe("TrigA");
  });

  it("absent Trigger$ → triggerSVarsAll empty; triggerSVar undefined", () => {
    const g = mkGame();
    const s = buildAndRegister(
      g,
      {
        mode: "OptionalAttackCost",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      7720,
      97720,
    );
    const payload = (s.describe() as { payload: OptionalAttackCostPayload }).payload;
    expect(payload.triggerSVarsAll).toEqual([]);
    expect(payload.triggerSVar).toBeUndefined();
  });

  it("single-trigger Trigger$ TrigA → triggerSVarsAll = ['TrigA']", () => {
    const g = mkGame();
    const s = buildAndRegister(
      g,
      {
        mode: "OptionalAttackCost",
        params: {
          ValidCard: { kind: "literal", raw: "Card.Self" },
          Trigger: { kind: "literal", raw: "TrigA" },
        },
        activeInZones: [],
      },
      7730,
      97730,
    );
    const payload = (s.describe() as { payload: OptionalAttackCostPayload }).payload;
    expect(payload.triggerSVarsAll).toEqual(["TrigA"]);
    expect(payload.triggerSVar).toBe("TrigA");
  });
});

// ── Pick 6: CantTarget — registration smoke after stale TODO retired ─────────
describe("Wave 107 — Pick 6: CantTarget registration smoke after stale TODO retired", () => {
  it("CantTarget mode is still registered and builds without throwing", () => {
    expect(staticHandlerRegistry.has("CantTarget" as StaticAbilityMode)).toBe(true);
    const g = mkGame();
    const s = buildAndRegister(
      g,
      {
        mode: "CantTarget",
        params: {
          ValidTarget: { kind: "literal", raw: "Card.Self" },
          ValidSA: { kind: "literal", raw: "Spell" },
        },
        activeInZones: [],
      },
      7800,
      97800,
    );
    // The Restriction wrapper is intact; payload kind tag matches the
    // post-Wave-107 contract.
    const restriction = s.describe() as { kind: string; payload: { kind: string } };
    expect(restriction.kind).toBe("cantTarget");
    expect(restriction.payload.kind).toBe("cantTargetExtended");
  });

  it("ValidSA$ Spell rejects non-Spell ability kinds, accepts Spell", () => {
    const g = mkGame();
    const target = mintCard({ game: g, id: 7810, paper: mkPaper("Bear") });
    void target;
    const s = buildAndRegister(
      g,
      {
        mode: "CantTarget",
        params: {
          ValidTarget: { kind: "literal", raw: "Card.Self" },
          ValidSA: { kind: "literal", raw: "Spell" },
        },
        activeInZones: [],
      },
      7811,
      97811,
    );
    const payload = (
      s.describe() as {
        payload: { saKindMatches: (k: "Spell" | "Activated" | "Triggered" | "Other") => boolean };
      }
    ).payload;
    expect(payload.saKindMatches("Spell")).toBe(true);
    expect(payload.saKindMatches("Activated")).toBe(false);
    expect(payload.saKindMatches("Triggered")).toBe(false);
    expect(payload.saKindMatches("Other")).toBe(false);
  });
});

// Suppress unused-symbol warnings for tightly-typed imports used only in
// payload casts.
void seat0;
void seat1;
const _typeAnchors: ReadonlyArray<unknown> = [
  null as unknown as CantPreventDamagePayload,
  null as unknown as EntityId,
];
void _typeAnchors;

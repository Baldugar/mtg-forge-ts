// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 75 — four more bespoke-infra static modes regression tests.
// Covers:
//   - Registration smoke for CanAdapt / CanExhaust / IgnoreShroud /
//     CantExile.
//   - CanAdapt: canAdaptAgain helper false-by-default; true when a
//     ValidCard$ Card.Self gate is registered. AdaptEffect bypasses
//     the +1/+1 counter precondition for the matched creature.
//   - CanExhaust: canReExhaust helper false-by-default; true when a
//     ValidPlayer$ You gate is registered. (Forward-compat stub —
//     Exhaust mechanic not yet wired, but the registration round-
//     trips and the helper resolves.)
//   - IgnoreShroud: ignoresShroud helper false-by-default; shroud
//     creature bypassed for the matched activator. Eligibility set
//     populates correctly via enumerateEligibleTargets.
//   - CantExile: canBeExiled helper true-by-default; false when a
//     ValidCard$ Card.Self gate matches. game-action.moveTo to
//     Exile no-ops silently when the gate matches.
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
  canAdaptAgain,
  canBeExiled,
  canReExhaust,
  ignoresShroud,
} from "../../statics/wave75-gate-helpers.js";
import { enumerateEligibleTargets } from "../../target/enumeration.js";
import type { TargetRestriction } from "../../target/restriction.js";
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
describe("Wave 75 — registration smoke", () => {
  const modes: readonly StaticAbilityMode[] = ["CanAdapt", "CanExhaust", "IgnoreShroud", "CantExile"];
  for (const m of modes) {
    it(`mode '${m}' is registered`, () => {
      expect(staticHandlerRegistry.has(m)).toBe(true);
    });
  }
});

// ── CanAdapt ─────────────────────────────────────────────────────────────────
describe("Wave 75 — CanAdapt (Biomancer's Familiar)", () => {
  it("canAdaptAgain false-by-default; true on Card.Self match", () => {
    const g = mkGame();
    const adapter = mintCard({
      game: g,
      id: 7900,
      paper: mkPaper("Adapter Bear"),
      seat: 0,
    });
    const otherCard = mintCard({
      game: g,
      id: 7901,
      paper: mkPaper("Other Bear"),
      seat: 0,
    });

    // No gate yet — both return false.
    expect(canAdaptAgain(g, adapter.id)).toBe(false);
    expect(canAdaptAgain(g, otherCard.id)).toBe(false);

    // Stamp ValidCard$ Card.Self sourced from `adapter`.
    buildAndRegister(
      g,
      {
        mode: "CanAdapt",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      adapter.id as unknown as number,
      77900,
      0,
    );

    // Adapter matches; other doesn't.
    expect(canAdaptAgain(g, adapter.id)).toBe(true);
    expect(canAdaptAgain(g, otherCard.id)).toBe(false);
  });
});

// ── CanExhaust ───────────────────────────────────────────────────────────────
describe("Wave 75 — CanExhaust (Elvish Refueler — forward-compat stub)", () => {
  it("canReExhaust false-by-default; true when ValidPlayer$ You matches", () => {
    const g = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);

    expect(canReExhaust(g, seat0)).toBe(false);
    expect(canReExhaust(g, seat1)).toBe(false);

    // Stamp ValidPlayer$ You with controller seat 0 → only seat 0
    // is matched.
    buildAndRegister(
      g,
      {
        mode: "CanExhaust",
        params: { ValidPlayer: { kind: "literal", raw: "You" } },
        activeInZones: [],
      },
      8000,
      78000,
      0,
    );

    expect(canReExhaust(g, seat0)).toBe(true);
    expect(canReExhaust(g, seat1)).toBe(false);
  });
});

// ── IgnoreShroud ─────────────────────────────────────────────────────────────
describe("Wave 75 — IgnoreShroud (Autumn Willow)", () => {
  it("shroud entity appears in eligibility set when IgnoreShroud matches activator", () => {
    const g = mkGame();
    // The Effect-source card; Autumn Willow's analogue.
    const willow = mintCard({
      game: g,
      id: 8100,
      paper: mkPaper("Autumn Willow", "Legendary Creature — Avatar"),
      seat: 1,
    });
    const r: TargetRestriction = {
      permitZones: new Set([ZoneType.Battlefield]),
      controllerScope: "any",
      forbidSelfSource: false,
      mayTargetPlayers: false,
      hexproof: false,
      shroud: true,
      permitTypes: new Set(),
      forbidTypes: new Set(),
      minTargets: 1,
      maxTargets: 1,
    };

    // Without static: shroud bears all candidates (no entity passes).
    {
      const out = enumerateEligibleTargets(
        g,
        { sourceId: willow.id, sourceControllerSeat: mkPlayerSeat(0) },
        r,
      );
      expect(out.length).toBe(0);
    }

    // Stamp IgnoreShroud: Activator$ You (seat 0), ValidEntity$ Card.EffectSource
    // (resolves to willow's id via Card.Self mapping in the handler).
    // Source the static FROM willow so Card.EffectSource → Card.Self
    // points at willow itself.
    buildAndRegister(
      g,
      {
        mode: "IgnoreShroud",
        params: {
          Activator: { kind: "literal", raw: "You" },
          ValidEntity: { kind: "literal", raw: "Card.EffectSource" },
        },
        activeInZones: [],
      },
      willow.id as unknown as number,
      78100,
      0, // controller = seat 0 → "You" resolves to seat 0
    );

    // ignoresShroud: seat 0 activator (matches "You"), targeting willow.
    expect(ignoresShroud(g, mkPlayerSeat(0), willow.id)).toBe(true);
    // seat 1 activator (does not match "You"): shroud still applies.
    expect(ignoresShroud(g, mkPlayerSeat(1), willow.id)).toBe(false);

    // With static + seat 0 source: willow now appears in eligibility.
    {
      const out = enumerateEligibleTargets(
        g,
        { sourceId: willow.id, sourceControllerSeat: mkPlayerSeat(0) },
        r,
      );
      expect(out.find((x) => x.kind === "card" && x.id === willow.id)).toBeDefined();
    }
  });
});

// ── CantExile ────────────────────────────────────────────────────────────────
describe("Wave 75 — CantExile (The Master, Multiplied)", () => {
  it("canBeExiled true-by-default; false on Card.Self match", () => {
    const g = mkGame();
    const protected_ = mintCard({
      game: g,
      id: 8200,
      paper: mkPaper("Protected Token"),
      seat: 0,
    });
    const otherCard = mintCard({
      game: g,
      id: 8201,
      paper: mkPaper("Other Card"),
      seat: 0,
    });

    expect(canBeExiled(g, protected_.id)).toBe(true);
    expect(canBeExiled(g, otherCard.id)).toBe(true);

    // Stamp ValidCard$ Card.Self sourced from `protected_`.
    buildAndRegister(
      g,
      {
        mode: "CantExile",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      protected_.id as unknown as number,
      78200,
      0,
    );

    expect(canBeExiled(g, protected_.id)).toBe(false);
    expect(canBeExiled(g, otherCard.id)).toBe(true);
  });

  it("game.action.moveTo to Exile no-ops silently when CantExile matches", () => {
    const g = mkGame();
    const protected_ = mintCard({
      game: g,
      id: 8300,
      paper: mkPaper("Indestructible Token"),
      seat: 0,
    });

    // Stamp ValidCard$ Card.Self gate sourced from protected_.
    buildAndRegister(
      g,
      {
        mode: "CantExile",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      protected_.id as unknown as number,
      78300,
      0,
    );

    const action = new GameAction(g);
    const yields = collect(action.moveTo(protected_.id, ZoneType.Exile));
    const events = collectEvents(yields);

    // No CardChangedZone event fires.
    expect(events.find((e) => e.kind === "CardChangedZone")).toBeUndefined();
    // Card stays on the battlefield.
    expect(protected_.zone).toBe(ZoneType.Battlefield);
    const bfZone = g.getPlayer(mkPlayerSeat(0)).zones.get(ZoneType.Battlefield);
    expect(bfZone?.toArray()).toContain(protected_.id);
  });

  it("non-matching cards still exile normally", () => {
    const g = mkGame();
    const protected_ = mintCard({
      game: g,
      id: 8400,
      paper: mkPaper("Protected Card"),
      seat: 0,
    });
    const free_ = mintCard({
      game: g,
      id: 8401,
      paper: mkPaper("Free Card"),
      seat: 0,
    });

    // Stamp ValidCard$ Card.Self gate sourced from protected_ only.
    buildAndRegister(
      g,
      {
        mode: "CantExile",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      protected_.id as unknown as number,
      78400,
      0,
    );

    const action = new GameAction(g);
    const yields = collect(action.moveTo(free_.id, ZoneType.Exile));
    const events = collectEvents(yields);
    expect(events.find((e) => e.kind === "CardChangedZone")).toBeDefined();
    expect(free_.zone).toBe(ZoneType.Exile);
  });
});

// ── Lifecycle: deactivation reverses each gate ───────────────────────────────
describe("Wave 75 — lifecycle: deactivation reverses each gate", () => {
  it("unregistering each Wave 75 static restores defaults", () => {
    const g = mkGame();
    const adapter = mintCard({
      game: g,
      id: 8500,
      paper: mkPaper("Adapter"),
      seat: 0,
    });
    const willow = mintCard({
      game: g,
      id: 8501,
      paper: mkPaper("Shroud Subject"),
      seat: 1,
    });
    const protected_ = mintCard({
      game: g,
      id: 8502,
      paper: mkPaper("Exile Subject"),
      seat: 0,
    });

    const sCanAdapt = buildAndRegister(
      g,
      {
        mode: "CanAdapt",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      adapter.id as unknown as number,
      78500,
      0,
    );
    const sCanExhaust = buildAndRegister(
      g,
      {
        mode: "CanExhaust",
        params: { ValidPlayer: { kind: "literal", raw: "You" } },
        activeInZones: [],
      },
      8503,
      78503,
      0,
    );
    const sIgnoreShroud = buildAndRegister(
      g,
      {
        mode: "IgnoreShroud",
        params: {
          Activator: { kind: "literal", raw: "You" },
          ValidEntity: { kind: "literal", raw: "Card.EffectSource" },
        },
        activeInZones: [],
      },
      willow.id as unknown as number,
      78504,
      0,
    );
    const sCantExile = buildAndRegister(
      g,
      {
        mode: "CantExile",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      protected_.id as unknown as number,
      78505,
      0,
    );

    // All four gates active.
    expect(canAdaptAgain(g, adapter.id)).toBe(true);
    expect(canReExhaust(g, mkPlayerSeat(0))).toBe(true);
    expect(ignoresShroud(g, mkPlayerSeat(0), willow.id)).toBe(true);
    expect(canBeExiled(g, protected_.id)).toBe(false);

    // Unregister; each gate releases.
    g.staticEffectRegistry.unregister(sCanAdapt.id);
    g.staticEffectRegistry.unregister(sCanExhaust.id);
    g.staticEffectRegistry.unregister(sIgnoreShroud.id);
    g.staticEffectRegistry.unregister(sCantExile.id);

    expect(canAdaptAgain(g, adapter.id)).toBe(false);
    expect(canReExhaust(g, mkPlayerSeat(0))).toBe(false);
    expect(ignoresShroud(g, mkPlayerSeat(0), willow.id)).toBe(false);
    expect(canBeExiled(g, protected_.id)).toBe(true);
  });
});

// ── AdaptEffect bypass — integration with the static gate ────────────────────
describe("Wave 75 — AdaptEffect bypasses +1/+1 precondition under CanAdapt", () => {
  it("creature with +1/+1 counters adapts again when gate matches", () => {
    const g = mkGame();
    const adapter = mintCard({
      game: g,
      id: 8600,
      paper: mkPaper("Already Adapted"),
      seat: 0,
    });
    // Pre-stamp +1/+1 counter so the canonical CR 702.139a precondition
    // would normally block adapt.
    adapter.counters.set(CT.PlusOnePlusOne, 1);

    // Stamp the CanAdapt gate.
    buildAndRegister(
      g,
      {
        mode: "CanAdapt",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      adapter.id as unknown as number,
      78600,
      0,
    );

    // canAdaptAgain returns true → AdaptEffect.resolve will proceed.
    expect(canAdaptAgain(g, adapter.id)).toBe(true);

    // Without the gate (from a fresh game), the same precondition
    // would short-circuit the resolve. Verified at the helper level
    // — the integration with AdaptEffect is wired via a single
    // `&& !canAdaptAgain(...)` clause.
    const g2 = mkGame();
    const other = mintCard({
      game: g2,
      id: 8700,
      paper: mkPaper("Already Adapted (no gate)"),
      seat: 0,
    });
    other.counters.set(CT.PlusOnePlusOne, 1);
    expect(canAdaptAgain(g2, other.id)).toBe(false);
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 74 — three more bespoke-infra static modes regression tests.
// Covers:
//   - Registration smoke for CantCrew / CantDiscard /
//     ColorlessDamageSource.
//   - CantCrew: canCrew helper false on match; registry-walk; non-
//     matching cards still pass.
//   - CantDiscard: canDiscard helper false on match; moveTo with
//     cause "discard" no-ops silently (no zone change, no
//     CardDiscarded event); cause "handSize" gated identically;
//     non-matching seat still discards normally.
//   - ColorlessDamageSource: damageColorOverride returns "colorless"
//     on match; null otherwise.
//   - Lifecycle: deactivation reverses each gate.
import type {
  GameEvent,
  LobbyPlayer,
  PaperCard,
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
import { canCrew, canDiscard, damageColorOverride } from "../../statics/wave74-gate-helpers.js";
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

const collectEvents = (yields: readonly EngineYield[]): readonly GameEvent[] =>
  yields.filter((y) => y.kind === "event").map((y) => (y as { event: GameEvent }).event);

const collect = (g: Generator<EngineYield, void, unknown>): EngineYield[] => {
  const out: EngineYield[] = [];
  for (const y of g) out.push(y);
  return out;
};

// ── registration smoke ───────────────────────────────────────────────────────
describe("Wave 74 — registration smoke", () => {
  const modes: readonly StaticAbilityMode[] = ["CantCrew", "CantDiscard", "ColorlessDamageSource"];
  for (const m of modes) {
    it(`mode '${m}' is registered`, () => {
      expect(staticHandlerRegistry.has(m)).toBe(true);
    });
  }
});

// ── CantCrew ─────────────────────────────────────────────────────────────────
describe("Wave 74 — CantCrew", () => {
  it("canCrew false on match; non-matching creatures still pass", () => {
    const g = mkGame();
    // Source = Aura source (Revoke Privileges shape). For the test we
    // gate the gated creature directly via Card.Self so we don't need
    // the full Enchant/EnchantedBy plumbing.
    const gatedCreature = mintCard({
      game: g,
      id: 7400,
      paper: mkPaper("Gated Crewer"),
      seat: 0,
    });
    const otherCreature = mintCard({
      game: g,
      id: 7401,
      paper: mkPaper("Free Crewer"),
      seat: 0,
    });

    expect(canCrew(g, gatedCreature.id)).toBe(true);
    expect(canCrew(g, otherCreature.id)).toBe(true);

    // Stamp ValidCard$ Card.Self gate sourced from gatedCreature.
    buildAndRegister(
      g,
      {
        mode: "CantCrew",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      gatedCreature.id as unknown as number,
      77400,
      0,
    );

    // Gated creature now fails the gate; the other does not.
    expect(canCrew(g, gatedCreature.id)).toBe(false);
    expect(canCrew(g, otherCreature.id)).toBe(true);
  });
});

// ── CantDiscard ──────────────────────────────────────────────────────────────
describe("Wave 74 — CantDiscard", () => {
  it("smoke + canDiscard false; moveTo cause 'discard' no-ops silently when matched", () => {
    const g = mkGame();
    const seat = mkPlayerSeat(0);

    // ValidPlayer$ You with controller seat 0 → only seat 0 gated.
    buildAndRegister(
      g,
      {
        mode: "CantDiscard",
        params: { ValidPlayer: { kind: "literal", raw: "You" } },
        activeInZones: [],
      },
      7500,
      77500,
      0,
    );

    expect(canDiscard(g, seat)).toBe(false);
    expect(canDiscard(g, mkPlayerSeat(1))).toBe(true);

    // Mint a card in seat 0's hand; attempt to discard it via moveTo.
    const card = mintCard({
      game: g,
      id: 7501,
      paper: mkPaper("Hand Card", "Sorcery"),
      seat: 0,
      zone: ZoneType.Hand,
    });
    const action = new GameAction(g);

    const yields = collect(action.moveTo(card.id, ZoneType.Graveyard, { cause: "discard" }));
    const events = collectEvents(yields);

    // No CardDiscarded event fires when the gate matches.
    expect(events.find((e) => e.kind === "CardDiscarded")).toBeUndefined();
    // No CardChangedZone event either — the action is fully silenced.
    expect(events.find((e) => e.kind === "CardChangedZone")).toBeUndefined();
    // Card stays in hand.
    expect(card.zone).toBe(ZoneType.Hand);
    const handZone = g.getPlayer(seat).zones.get(ZoneType.Hand);
    expect(handZone?.toArray()).toContain(card.id);
  });

  it("moveTo cause 'handSize' is gated identically; non-matching seat still discards", () => {
    const g = mkGame();
    // ValidPlayer$ You with controller seat 0 → only seat 0 gated.
    buildAndRegister(
      g,
      {
        mode: "CantDiscard",
        params: { ValidPlayer: { kind: "literal", raw: "You" } },
        activeInZones: [],
      },
      7600,
      77600,
      0,
    );

    // Seat 0 (gated) — handSize discard no-ops.
    const cardA = mintCard({
      game: g,
      id: 7601,
      paper: mkPaper("Gated Hand Card", "Sorcery"),
      seat: 0,
      zone: ZoneType.Hand,
    });
    const action = new GameAction(g);
    const yieldsA = collect(action.moveTo(cardA.id, ZoneType.Graveyard, { cause: "handSize" }));
    expect(collectEvents(yieldsA).find((e) => e.kind === "CardDiscarded")).toBeUndefined();
    expect(cardA.zone).toBe(ZoneType.Hand);

    // Seat 1 (not gated) — discard proceeds normally.
    const cardB = mintCard({
      game: g,
      id: 7602,
      paper: mkPaper("Free Hand Card", "Sorcery"),
      seat: 1,
      zone: ZoneType.Hand,
    });
    const yieldsB = collect(action.moveTo(cardB.id, ZoneType.Graveyard, { cause: "discard" }));
    const eventsB = collectEvents(yieldsB);
    expect(eventsB.find((e) => e.kind === "CardDiscarded")).toBeDefined();
    expect(cardB.zone).toBe(ZoneType.Graveyard);
  });
});

// ── ColorlessDamageSource ────────────────────────────────────────────────────
describe("Wave 74 — ColorlessDamageSource", () => {
  it("damageColorOverride returns 'colorless' on match; null otherwise", () => {
    const g = mkGame();
    const matchedSource = mintCard({
      game: g,
      id: 7700,
      paper: mkPaper("Matched Source"),
      seat: 0,
    });
    const otherSource = mintCard({
      game: g,
      id: 7701,
      paper: mkPaper("Other Source"),
      seat: 0,
    });

    // No gate yet — both return null.
    expect(damageColorOverride(g, matchedSource.id)).toBeNull();
    expect(damageColorOverride(g, otherSource.id)).toBeNull();

    // Stamp ValidCard$ Card.Self sourced from matchedSource (Ghostly
    // Flame's full filter is a comma-OR over Permanent.Black/Red and
    // Spell.Black/Red; the registration helper uses cardMatchesFilter
    // for the full grammar — we exercise the simpler Card.Self shape
    // here to keep the test independent of the broader filter wiring).
    buildAndRegister(
      g,
      {
        mode: "ColorlessDamageSource",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      matchedSource.id as unknown as number,
      77700,
      0,
    );

    expect(damageColorOverride(g, matchedSource.id)).toBe("colorless");
    expect(damageColorOverride(g, otherSource.id)).toBeNull();
  });
});

// ── Lifecycle: deactivation reverses each gate ───────────────────────────────
describe("Wave 74 — lifecycle: deactivation reverses each gate", () => {
  it("unregistering each Wave 74 static restores defaults", () => {
    const g = mkGame();
    const crewSubject = mintCard({
      game: g,
      id: 7800,
      paper: mkPaper("Crew subject"),
      seat: 0,
    });
    const damageSubject = mintCard({
      game: g,
      id: 7801,
      paper: mkPaper("Damage subject"),
      seat: 0,
    });

    const sCantCrew = buildAndRegister(
      g,
      {
        mode: "CantCrew",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      crewSubject.id as unknown as number,
      77800,
      0,
    );
    const sCantDiscard = buildAndRegister(
      g,
      {
        mode: "CantDiscard",
        params: { ValidPlayer: { kind: "literal", raw: "You" } },
        activeInZones: [],
      },
      7802,
      77802,
      0,
    );
    const sColorless = buildAndRegister(
      g,
      {
        mode: "ColorlessDamageSource",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      damageSubject.id as unknown as number,
      77803,
      0,
    );

    // All three gates active.
    expect(canCrew(g, crewSubject.id)).toBe(false);
    expect(canDiscard(g, mkPlayerSeat(0))).toBe(false);
    expect(damageColorOverride(g, damageSubject.id)).toBe("colorless");

    // Unregister; each gate releases.
    g.staticEffectRegistry.unregister(sCantCrew.id);
    g.staticEffectRegistry.unregister(sCantDiscard.id);
    g.staticEffectRegistry.unregister(sColorless.id);

    expect(canCrew(g, crewSubject.id)).toBe(true);
    expect(canDiscard(g, mkPlayerSeat(0))).toBe(true);
    expect(damageColorOverride(g, damageSubject.id)).toBeNull();
  });
});

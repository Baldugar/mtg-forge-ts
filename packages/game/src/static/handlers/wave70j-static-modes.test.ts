// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.J — three more registry-walk gate statics regression tests.
// Covers:
//   - Registration smoke for IgnoreLegendRule / CantBlockUnless / DisableTriggers
//   - IgnoreLegendRule: isExemptFromLegendRule reads true for matched cards
//   - IgnoreLegendRule: legend-world SBA collector skips matched legendaries
//                       (no `legendRule` action emitted when one of two same-
//                        named legendaries is exempt)
//   - CantBlockUnless: surfaces a cantBlock Restriction (isBlockingRestricted
//                       returns true for matched blocker)
//   - CantBlockUnless: cantBlockUnlessPaidCostText returns the Cost$ text
//   - DisableTriggers: trigger-registry's onEvent path drops matched fires
//                      silently (Hushwing-shape: ETB triggers suppressed
//                      when a creature ETBs)
//   - DisableTriggers: ValidCard$ scoping (only opponents' triggers
//                      suppressed)
//   - Lifecycle: deactivation reverses each gate
import type {
  EntityId,
  GameEvent,
  LobbyPlayer,
  PaperCard,
  PlayerSeat,
  StaticAbility,
  StaticAbilityMode,
  StaticAst,
  TriggeredAbility,
} from "@mtg-forge-ts/core";
import {
  DEFAULT_PAPER_CARD_FLAGS,
  PhaseStep,
  SeededRng,
  Supertype,
  TypeLine,
  ZoneType,
  mkEntityId,
  mkEvent,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { collectLegendWorld } from "../../sba/legend-world.js";
import type { SbaAction } from "../../sba/sba-action.js";
import { isBlockingRestricted } from "../../statics/cant-must-may-extras.js";
import {
  cantBlockUnlessPaidCostText,
  isExemptFromLegendRule,
  isTriggerDisabled,
} from "../../statics/wave70j-rule-gates.js";
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

const markLegendary = (game: Game, id: EntityId): void => {
  const chars = game.layerEngine.computeCharacteristics(id);
  chars.supertypes.add(Supertype.Legendary);
};

// ── registration smoke ───────────────────────────────────────────────────────
describe("Wave 70.J — registration smoke", () => {
  const modes: readonly StaticAbilityMode[] = ["IgnoreLegendRule", "CantBlockUnless", "DisableTriggers"];
  for (const m of modes) {
    it(`mode '${m}' is registered`, () => {
      expect(staticHandlerRegistry.has(m)).toBe(true);
    });
  }
});

// ── IgnoreLegendRule — Mirror Gallery / Sliver Legion / Brothers Yamazaki ────
describe("Wave 70.J — IgnoreLegendRule", () => {
  it("smoke + isExemptFromLegendRule reads true for matched cards", () => {
    const g = mkGame();
    const c = mintCard({
      game: g,
      id: 8000,
      paper: mkPaper("Brothers Yamazaki", "Legendary Creature — Samurai"),
    });
    expect(isExemptFromLegendRule(g, c.id)).toBe(false);
    // Mirror-Gallery shape: no ValidCard filter — exempts every card.
    buildAndRegister(
      g,
      {
        mode: "IgnoreLegendRule",
        params: {},
        activeInZones: [],
      },
      8001,
      98001,
    );
    expect(isExemptFromLegendRule(g, c.id)).toBe(true);
  });

  it("legend-world SBA collector skips matched legendaries (no legendRule emitted)", () => {
    const g = mkGame();
    const seat = mkPlayerSeat(0);
    const id1 = 8100;
    const id2 = 8101;
    const c1 = mintCard({ game: g, id: id1, paper: mkPaper("Jace", "Legendary Planeswalker — Jace") });
    const c2 = mintCard({ game: g, id: id2, paper: mkPaper("Jace", "Legendary Planeswalker — Jace") });
    markLegendary(g, c1.id);
    markLegendary(g, c2.id);
    // Without the static, two same-named legendaries would emit a legendRule action.
    {
      const out: SbaAction[] = [];
      collectLegendWorld(g, out);
      expect(out.find((x) => x.kind === "legendRule")).toBeDefined();
    }
    // Stamp Mirror Gallery on seat 0.
    buildAndRegister(
      g,
      {
        mode: "IgnoreLegendRule",
        params: {},
        activeInZones: [],
      },
      8102,
      98102,
      0,
    );
    {
      const out: SbaAction[] = [];
      collectLegendWorld(g, out);
      // No legendRule — both cards exempted; bucket never reaches size 2.
      expect(out.find((x) => x.kind === "legendRule")).toBeUndefined();
    }
    // Both cards still on the battlefield.
    expect(c1.zone).toBe(ZoneType.Battlefield);
    expect(c2.zone).toBe(ZoneType.Battlefield);
    void seat;
  });
});

// ── CantBlockUnless — Aurochs Herd / Crawlspace siblings / "tap creature" ────
describe("Wave 70.J — CantBlockUnless", () => {
  it("isBlockingRestricted returns true for the matched blocker", () => {
    const g = mkGame();
    const blocker = mintCard({ game: g, id: 8200, paper: mkPaper("Vanilla Bear") });
    const attacker = mintCard({ game: g, id: 8201, paper: mkPaper("Vanilla Wolf"), seat: 1 });
    // Default: no restriction.
    expect(isBlockingRestricted(g, attacker.id, blocker.id)).toBe(false);
    buildAndRegister(
      g,
      {
        mode: "CantBlockUnless",
        params: {
          ValidCard: { kind: "literal", raw: "Card.Self" },
          Cost: { kind: "literal", raw: "2" },
        },
        activeInZones: [],
      },
      blocker.id as unknown as number,
      98200,
    );
    // The unless-cost is unpaid by MVP semantics → matched blocker is restricted.
    expect(isBlockingRestricted(g, attacker.id, blocker.id)).toBe(true);
  });

  it("cantBlockUnlessPaidCostText surfaces the Cost$ string", () => {
    const g = mkGame();
    const blocker = mintCard({ game: g, id: 8300, paper: mkPaper("Vanilla Bear") });
    expect(cantBlockUnlessPaidCostText(g, blocker.id)).toBeUndefined();
    buildAndRegister(
      g,
      {
        mode: "CantBlockUnless",
        params: {
          ValidCard: { kind: "literal", raw: "Card.Self" },
          Cost: { kind: "literal", raw: "PayLife<1>" },
        },
        activeInZones: [],
      },
      blocker.id as unknown as number,
      98300,
    );
    expect(cantBlockUnlessPaidCostText(g, blocker.id)).toBe("PayLife<1>");
  });
});

// ── DisableTriggers — Hushwing Gryff / Tocatli Honor Guard / Torpor Orb ──────
describe("Wave 70.J — DisableTriggers", () => {
  // Build a synthetic ChangesZone trigger — minimal TriggeredAbility shape
  // matching the Wave 32 trigger surface so the gate's mode/source/cause
  // checks have data to chew on.
  const mkSynthTrigger = (sourceCardId: EntityId, mode = "ChangesZone"): TriggeredAbility => {
    const t: TriggeredAbility & {
      ast?: { mode: string; params?: Record<string, { kind: string; raw: string }> };
    } = {
      id: mkEntityId(99999),
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 1,
      controllerSeatAtReg: mkPlayerSeat(0),
      matches: () => true,
      isDelayed: false,
      ast: { mode },
    };
    return t;
  };

  it("Hushwing-shape: ETB-creature trigger fire suppressed", () => {
    const g = mkGame();
    const causeCreature = mintCard({ game: g, id: 8400, paper: mkPaper("Vanilla Bear") });
    const triggerSrc = mintCard({ game: g, id: 8401, paper: mkPaper("Some ETB Trigger Source") });
    const trig = mkSynthTrigger(triggerSrc.id, "ChangesZone");

    // CardChangedZone event from Library to Battlefield — the canonical ETB.
    const event: GameEvent = mkEvent("CardChangedZone", 1, PhaseStep.Main1, {
      cardId: causeCreature.id,
      fromZone: ZoneType.Library,
      toZone: ZoneType.Battlefield,
    });

    expect(isTriggerDisabled(g, trig, event)).toBe(false);
    // Stamp Hushwing Gryff: ValidCause=Creature, ValidMode=ChangesZone,
    // Destination=Battlefield.
    buildAndRegister(
      g,
      {
        mode: "DisableTriggers",
        params: {
          ValidCause: { kind: "literal", raw: "Creature" },
          ValidMode: { kind: "literal", raw: "ChangesZone,ChangesZoneAll" },
          Destination: { kind: "literal", raw: "Battlefield" },
        },
        activeInZones: [],
      },
      8402,
      98402,
    );
    expect(isTriggerDisabled(g, trig, event)).toBe(true);
  });

  it("ValidCard$ scoping: only opponents' trigger sources match", () => {
    const g = mkGame();
    const causeCreature = mintCard({ game: g, id: 8500, paper: mkPaper("Vanilla Bear"), seat: 1 });
    const myTrigSrc = mintCard({ game: g, id: 8501, paper: mkPaper("My Trigger"), seat: 0 });
    const oppTrigSrc = mintCard({ game: g, id: 8502, paper: mkPaper("Opp Trigger"), seat: 1 });
    const myTrig = mkSynthTrigger(myTrigSrc.id, "ChangesZone");
    const oppTrig = mkSynthTrigger(oppTrigSrc.id, "ChangesZone");
    const event: GameEvent = mkEvent("CardChangedZone", 1, PhaseStep.Main1, {
      cardId: causeCreature.id,
      fromZone: ZoneType.Library,
      toZone: ZoneType.Battlefield,
    });
    // Stamp DisableTriggers controlled by seat 0, scoped to OppCtrl trigger
    // sources. (Permanent.OppCtrl reads "controlled by an opponent of the
    // static's controller".)
    buildAndRegister(
      g,
      {
        mode: "DisableTriggers",
        params: {
          ValidCause: { kind: "literal", raw: "Creature" },
          ValidMode: { kind: "literal", raw: "ChangesZone,ChangesZoneAll" },
          Destination: { kind: "literal", raw: "Battlefield" },
          ValidCard: { kind: "literal", raw: "Permanent.OppCtrl" },
        },
        activeInZones: [],
      },
      8503,
      98503,
      0,
    );
    // My trigger: NOT suppressed (it's not OppCtrl from seat 0's perspective).
    expect(isTriggerDisabled(g, myTrig, event)).toBe(false);
    // Opponent's trigger: suppressed.
    expect(isTriggerDisabled(g, oppTrig, event)).toBe(true);
  });

  it("non-matching event mode does not match", () => {
    const g = mkGame();
    const causeCreature = mintCard({ game: g, id: 8600, paper: mkPaper("Vanilla Bear") });
    const triggerSrc = mintCard({ game: g, id: 8601, paper: mkPaper("Some Trigger Source") });
    // This trigger has mode "Phase" — DOES NOT match ChangesZone in the static.
    const trig = mkSynthTrigger(triggerSrc.id, "Phase");
    const event: GameEvent = mkEvent("CardChangedZone", 1, PhaseStep.Main1, {
      cardId: causeCreature.id,
      fromZone: ZoneType.Library,
      toZone: ZoneType.Battlefield,
    });
    buildAndRegister(
      g,
      {
        mode: "DisableTriggers",
        params: {
          ValidCause: { kind: "literal", raw: "Creature" },
          ValidMode: { kind: "literal", raw: "ChangesZone,ChangesZoneAll" },
          Destination: { kind: "literal", raw: "Battlefield" },
        },
        activeInZones: [],
      },
      8602,
      98602,
    );
    // Mode mismatch → not suppressed.
    expect(isTriggerDisabled(g, trig, event)).toBe(false);
  });
});

// ── Lifecycle: deactivation reverses each gate ───────────────────────────────
describe("Wave 70.J — lifecycle: deactivation reverses each gate", () => {
  it("unregistering IgnoreLegendRule / CantBlockUnless / DisableTriggers restores defaults", () => {
    const g = mkGame();
    const legendCard = mintCard({
      game: g,
      id: 8700,
      paper: mkPaper("Jace", "Legendary Planeswalker — Jace"),
    });
    markLegendary(g, legendCard.id);
    const blocker = mintCard({ game: g, id: 8701, paper: mkPaper("Vanilla Bear") });
    const attacker = mintCard({ game: g, id: 8702, paper: mkPaper("Vanilla Wolf"), seat: 1 });
    const causeCreature = mintCard({ game: g, id: 8703, paper: mkPaper("Vanilla Bear 2") });
    const triggerSrc = mintCard({ game: g, id: 8704, paper: mkPaper("Trigger Source") });
    const trig: TriggeredAbility & {
      ast?: { mode: string };
    } = {
      id: mkEntityId(99998),
      kind: "triggered",
      sourceCardId: triggerSrc.id,
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 1,
      controllerSeatAtReg: mkPlayerSeat(0),
      matches: () => true,
      isDelayed: false,
      ast: { mode: "ChangesZone" },
    };
    const event: GameEvent = mkEvent("CardChangedZone", 1, PhaseStep.Main1, {
      cardId: causeCreature.id,
      fromZone: ZoneType.Library,
      toZone: ZoneType.Battlefield,
    });

    const sLegend = buildAndRegister(
      g,
      { mode: "IgnoreLegendRule", params: {}, activeInZones: [] },
      8705,
      98705,
    );
    const sBlock = buildAndRegister(
      g,
      {
        mode: "CantBlockUnless",
        params: {
          ValidCard: { kind: "literal", raw: "Card.Self" },
          Cost: { kind: "literal", raw: "1" },
        },
        activeInZones: [],
      },
      blocker.id as unknown as number,
      98706,
    );
    const sDisable = buildAndRegister(
      g,
      {
        mode: "DisableTriggers",
        params: {
          ValidCause: { kind: "literal", raw: "Creature" },
          ValidMode: { kind: "literal", raw: "ChangesZone,ChangesZoneAll" },
          Destination: { kind: "literal", raw: "Battlefield" },
        },
        activeInZones: [],
      },
      8707,
      98707,
    );

    // All three gates active.
    expect(isExemptFromLegendRule(g, legendCard.id)).toBe(true);
    expect(isBlockingRestricted(g, attacker.id, blocker.id)).toBe(true);
    expect(isTriggerDisabled(g, trig, event)).toBe(true);

    // Deregister.
    g.staticEffectRegistry.unregister(sLegend.id);
    g.staticEffectRegistry.unregister(sBlock.id);
    g.staticEffectRegistry.unregister(sDisable.id);

    // All defaults restored.
    expect(isExemptFromLegendRule(g, legendCard.id)).toBe(false);
    expect(isBlockingRestricted(g, attacker.id, blocker.id)).toBe(false);
    expect(isTriggerDisabled(g, trig, event)).toBe(false);
  });
});

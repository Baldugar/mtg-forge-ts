// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 50 — static-mode pack regression tests. One smoke + one semantics
// test per mode, exercising:
//   - registry hookup (the StaticHandler is registered by ./index.ts)
//   - describe() payload shape
//   - integration of the new gather helpers in cant-must-may-extras.ts
import type {
  LobbyPlayer,
  ManaCostAst,
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
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import {
  canAttackerBypassDefender,
  gatherAlternativeCosts,
  gatherOptionalCosts,
  gatherPanharmoniconHits,
  isBlockingRestricted,
  shouldGrantFlash,
} from "../../statics/cant-must-may-extras.js";
import { gatherRestrictions, isRestricted } from "../../statics/cant-must-may.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { Library } from "../../zone/zones/library.js";
import { staticHandlerRegistry } from "../static-handler.js";

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

const mkPaper = (name: string, types = "Creature — Bear", manaCostRaw = "1G"): PaperCard => {
  const isCreature = types.includes("Creature");
  return {
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
      ...(isCreature ? { pt: { power: "2", toughness: "2" } } : {}),
      abilities: [],
      triggers: [],
      replacements: [],
      statics: [],
      keywords: [],
      svars: new Map(),
    },
  };
};

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
  return card;
};

// Build via the registry (proves the handler is wired) and register the
// resulting StaticAbility into the live registry.
const buildAndRegister = (
  game: Game,
  ast: StaticAst,
  sourceCardId: number,
  staticIdSeed: number,
): StaticAbility => {
  const Cls = staticHandlerRegistry.lookup(ast.mode as StaticAbilityMode);
  if (!Cls) throw new Error(`mode ${ast.mode} not registered`);
  const s = new Cls().build(ast, {
    game,
    sourceCardId: mkEntityId(sourceCardId),
    controllerSeat: mkPlayerSeat(0),
    staticId: mkEntityId(staticIdSeed),
  });
  game.staticEffectRegistry.register(s);
  return s;
};

// ── registration smoke (every Wave-50 mode) ──────────────────────────────────
describe("Wave 50 — every new mode has a registered handler", () => {
  const modes: readonly import("@mtg-forge-ts/core").StaticAbilityMode[] = [
    "CantBlockBy",
    "CantAttack",
    "AlternativeCost",
    "CantBlock",
    "CantBeCast",
    "MustAttack",
    "CastWithFlash",
    "MinMaxBlocker",
    "OptionalCost",
    "Panharmonicon",
    "CantBeActivated",
    "CanAttackDefender",
  ];
  for (const m of modes) {
    it(`mode '${m}' is registered`, () => {
      expect(staticHandlerRegistry.has(m)).toBe(true);
    });
  }
});

// ── CantBlockBy (Fear-shape) ─────────────────────────────────────────────────
describe("Wave 50 — CantBlockBy", () => {
  it("rejects blocker that matches ValidBlocker$ and attacker that matches Source$", () => {
    const g = mkGame();
    const attacker = mintCard({ game: g, id: 100, paper: mkPaper("FearAtk"), seat: 0 });
    const blocker = mintCard({ game: g, id: 101, paper: mkPaper("Blkr"), seat: 1 });
    buildAndRegister(
      g,
      {
        mode: "CantBlockBy",
        params: {
          Mode: { kind: "literal", raw: "CantBlockBy" },
          ValidAttacker: { kind: "literal", raw: "Card.Self" },
          ValidBlocker: { kind: "literal", raw: "Creature" },
        },
        activeInZones: [],
      },
      100,
      9100,
    );
    expect(isBlockingRestricted(g, attacker.id, blocker.id)).toBe(true);
  });

  it("does not reject when only one side matches", () => {
    const g = mkGame();
    const attacker = mintCard({ game: g, id: 110, paper: mkPaper("Atk"), seat: 0 });
    const blocker = mintCard({ game: g, id: 111, paper: mkPaper("Blkr", "Artifact", "1") });
    buildAndRegister(
      g,
      {
        mode: "CantBlockBy",
        params: {
          ValidAttacker: { kind: "literal", raw: "Card.Self" },
          ValidBlocker: { kind: "literal", raw: "Creature" }, // blocker is artifact, not creature
        },
        activeInZones: [],
      },
      110,
      9110,
    );
    expect(isBlockingRestricted(g, attacker.id, blocker.id)).toBe(false);
  });
});

// ── CantBlock ────────────────────────────────────────────────────────────────
describe("Wave 50 — CantBlock", () => {
  it("registers a cantBlock restriction matching ValidCard$", () => {
    const g = mkGame();
    const c = mintCard({ game: g, id: 200, paper: mkPaper("Defender") });
    buildAndRegister(
      g,
      {
        mode: "CantBlock",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      200,
      9200,
    );
    expect(isRestricted(g, "cantBlock", c.id)).toBe(true);
  });
});

// ── CantAttack (Propaganda smoke) ────────────────────────────────────────────
describe("Wave 50 — CantAttack", () => {
  it("registers a cantAttack restriction; subjectFilter matches", () => {
    const g = mkGame();
    const c = mintCard({ game: g, id: 300, paper: mkPaper("Self") });
    buildAndRegister(
      g,
      {
        mode: "CantAttack",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      300,
      9300,
    );
    expect(isRestricted(g, "cantAttack", c.id)).toBe(true);
  });
});

// ── MustAttack (Goad) ────────────────────────────────────────────────────────
describe("Wave 50 — MustAttack", () => {
  it("registers a mustAttack restriction", () => {
    const g = mkGame();
    const c = mintCard({ game: g, id: 400, paper: mkPaper("Goader") });
    buildAndRegister(
      g,
      {
        mode: "MustAttack",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      400,
      9400,
    );
    expect(gatherRestrictions(g, "mustAttack")).toHaveLength(1);
    expect(isRestricted(g, "mustAttack", c.id)).toBe(true);
  });
});

// ── CanAttackDefender (Sylvan Advocate-shape positive override) ──────────────
describe("Wave 50 — CanAttackDefender", () => {
  it("positive override — canAttackerBypassDefender returns true for matching creature", () => {
    const g = mkGame();
    const c = mintCard({ game: g, id: 500, paper: mkPaper("DefenderBypass") });
    buildAndRegister(
      g,
      {
        mode: "CanAttackDefender",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      500,
      9500,
    );
    expect(canAttackerBypassDefender(g, c.id)).toBe(true);
  });
});

// ── MinMaxBlocker (smoke + payload) ──────────────────────────────────────────
describe("Wave 50 — MinMaxBlocker", () => {
  it("registers and exposes {min, max} payload on the Restriction", () => {
    const g = mkGame();
    mintCard({ game: g, id: 600, paper: mkPaper("MinMax") });
    const s = buildAndRegister(
      g,
      {
        mode: "MinMaxBlocker",
        params: {
          ValidCard: { kind: "literal", raw: "Card.Self" },
          Min: { kind: "literal", raw: "2" },
          Max: { kind: "literal", raw: "3" },
        },
        activeInZones: [],
      },
      600,
      9600,
    );
    expect(s.mode).toBe("MinMaxBlocker");
    const restrictions = gatherRestrictions(g, "minMaxBlocker");
    expect(restrictions).toHaveLength(1);
    const payload = restrictions[0]?.payload as { min: number; max: number };
    expect(payload.min).toBe(2);
    expect(payload.max).toBe(3);
  });
});

// ── CantBeCast (Meddling Mage / Conqueror's Flail) ───────────────────────────
describe("Wave 50 — CantBeCast", () => {
  it("registers a cantCast restriction; isRestricted gates the spell card id", () => {
    const g = mkGame();
    const spell = mintCard({
      game: g,
      id: 700,
      paper: mkPaper("Spell", "Sorcery", "1U"),
      zone: ZoneType.Hand,
    });
    buildAndRegister(
      g,
      {
        mode: "CantBeCast",
        params: { ValidCard: { kind: "literal", raw: "Card" } },
        activeInZones: [],
      },
      700,
      9700,
    );
    expect(isRestricted(g, "cantCast", spell.id)).toBe(true);
  });
});

// ── CantBeActivated (Linvala / Pithing Needle) ───────────────────────────────
describe("Wave 50 — CantBeActivated", () => {
  it("registers a cantActivate restriction; payload carries ValidSA$ kind", () => {
    const g = mkGame();
    const c = mintCard({ game: g, id: 800, paper: mkPaper("ActiveSrc") });
    buildAndRegister(
      g,
      {
        mode: "CantBeActivated",
        params: {
          ValidCard: { kind: "literal", raw: "Card.OppCtrl" },
          ValidSA: { kind: "literal", raw: "Mana" },
        },
        activeInZones: [],
      },
      800,
      9800,
    );
    const r = gatherRestrictions(g, "cantActivate");
    expect(r).toHaveLength(1);
    const payload = r[0]?.payload as { validSAKind: string };
    expect(payload.validSAKind).toBe("Mana");
    // Card.OppCtrl: source seat is 0; so opponent-side cards (seat 1) match.
    expect(c.controllerSeat).toBe(mkPlayerSeat(0));
    expect(r[0]?.subjectFilter(c.id, g)).toBe(false); // controller is seat 0 == source-controller, NOT opp
  });
});

// ── CastWithFlash (Vedalken Orrery / Leyline of Anticipation) ────────────────
describe("Wave 50 — CastWithFlash", () => {
  it("ruleChanging static enables flash for matching ValidCard$ + Caster$", () => {
    const g = mkGame();
    const spell = mintCard({
      game: g,
      id: 900,
      paper: mkPaper("S", "Sorcery", "2"),
      zone: ZoneType.Hand,
    });
    buildAndRegister(
      g,
      {
        mode: "CastWithFlash",
        params: { ValidCard: { kind: "literal", raw: "Card.YouCtrl" } },
        activeInZones: [],
      },
      900,
      9900,
    );
    expect(shouldGrantFlash(g, spell.id, mkPlayerSeat(0))).toBe(true);
    // Opponent's card under my static is NOT YouCtrl from the static's POV.
    const oppSpell = mintCard({
      game: g,
      id: 901,
      paper: mkPaper("OppS", "Sorcery", "2"),
      seat: 1,
      zone: ZoneType.Hand,
    });
    expect(shouldGrantFlash(g, oppSpell.id, mkPlayerSeat(1))).toBe(false);
  });
});

// ── AlternativeCost (Surge / Awaken) ─────────────────────────────────────────
describe("Wave 50 — AlternativeCost", () => {
  it("registers an alternativeCost-category static; gather returns matching payload", () => {
    const g = mkGame();
    const spell = mintCard({
      game: g,
      id: 1000,
      paper: mkPaper("AltCard", "Sorcery", "3R"),
      zone: ZoneType.Hand,
    });
    buildAndRegister(
      g,
      {
        mode: "AlternativeCost",
        params: {
          ValidCard: { kind: "literal", raw: "Card.Self" },
          Cost: { kind: "literal", raw: "1 R" },
          Description: { kind: "literal", raw: "Surge" },
        },
        activeInZones: [],
      },
      1000,
      9_1000,
    );
    const hits = gatherAlternativeCosts(g, spell.id, mkPlayerSeat(0));
    expect(hits).toHaveLength(1);
    expect(hits[0]?.costRaw).toBe("1 R");
    expect(hits[0]?.description).toBe("Surge");
  });
});

// ── OptionalCost ─────────────────────────────────────────────────────────────
describe("Wave 50 — OptionalCost", () => {
  it("registers a cantMustMay static of kind 'optionalCost'", () => {
    const g = mkGame();
    const spell = mintCard({
      game: g,
      id: 1100,
      paper: mkPaper("OptCard", "Sorcery", "2"),
      zone: ZoneType.Hand,
    });
    buildAndRegister(
      g,
      {
        mode: "OptionalCost",
        params: {
          ValidCard: { kind: "literal", raw: "Card.Self" },
          Cost: { kind: "literal", raw: "B" },
        },
        activeInZones: [],
      },
      1100,
      9_1100,
    );
    const hits = gatherOptionalCosts(g, spell.id, mkPlayerSeat(0));
    expect(hits).toHaveLength(1);
    const payload = hits[0]?.payload as { costRaw: string };
    expect(payload.costRaw).toBe("B");
  });
});

// ── Panharmonicon ────────────────────────────────────────────────────────────
describe("Wave 50 — Panharmonicon", () => {
  it("registers a ruleChanging static; gather returns matching payload", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 1200, paper: mkPaper("Triggerer") });
    buildAndRegister(
      g,
      {
        mode: "Panharmonicon",
        params: {
          ValidCard: { kind: "literal", raw: "Card.YouCtrl" },
          ValidEvent: { kind: "literal", raw: "EntersBattlefield" },
        },
        activeInZones: [],
      },
      1200,
      9_1200,
    );
    const hits = gatherPanharmoniconHits(g, src.id, "EntersBattlefield");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.additionalFires).toBe(1);
    // Mismatched event kind → no hit.
    expect(gatherPanharmoniconHits(g, src.id, "Dies")).toHaveLength(0);
  });
});

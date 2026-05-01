// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 108 — cross-module TODO(advanced) sweep round 13 regression tests.
//
// Picks closed (one assertion bundle per pick):
//   1. static/handlers/colorless-damage-source-static.ts +
//      statics/wave74-gate-helpers.ts — retired the two stale TODO(advanced)
//      tails (DamageDealt event color slot; Layer 5 color-overwrite
//      contributor). The damageColorOverride helper is the durable
//      contract — assert it returns "colorless" for matched sources and
//      null for non-matched.
//   2. static/handlers/ignore-land-walk-static.ts — retired the stale
//      "ValidKeyword$" TODO(advanced) tail (no corpus instance);
//      regression: blocker+attacker predicate pair still gates the rewrite.
//   3. static/handlers/no-cleanup-damage-static.ts — retired the stale
//      "NoCleanupDamageFromSource$" TODO(advanced) tail (no corpus
//      instance); regression: ValidCard$ predicate still gates the rewrite.
//   4. static/handlers/surveil-num-static.ts — retired the stale
//      "X-expression Amount$" TODO(advanced) tail (corpus carries only
//      literal integers); regression: amount + playerMatches still
//      derived from the ValidPlayer$ + Amount$ pair.
//   5. static/handlers/attack-vigilance-static.ts — retired the stale
//      "Trigger$ TrigDealDamage" TODO(advanced) tail (Glorybringer-
//      shape triggers live in T:Mode$ Attacks lines, not on the static);
//      regression: cardMatches predicate still gates the override.
//   6. static/handlers/num-loyalty-act-static.ts — retired the stale
//      "conditional sub-params" TODO(advanced) tail (no corpus card
//      gates the +N activation conditionally); regression: numActivations
//      + cardMatches still derived from the ValidCard$ + NumActivations$
//      pair.
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
import type { AttackVigilancePayload } from "./static/handlers/attack-vigilance-static.js";
import type { ColorlessDamageSourcePayload } from "./static/handlers/colorless-damage-source-static.js";
import type { IgnoreLandWalkPayload } from "./static/handlers/ignore-land-walk-static.js";
import type { NoCleanupDamagePayload } from "./static/handlers/no-cleanup-damage-static.js";
import type { NumLoyaltyActPayload } from "./static/handlers/num-loyalty-act-static.js";
import type { SurveilNumPayload } from "./static/handlers/surveil-num-static.js";
import { staticHandlerRegistry } from "./static/static-handler.js";
import { damageColorOverride } from "./statics/wave74-gate-helpers.js";
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
  seed: "wave108",
};

const mkGame = (): Game => {
  const game = new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(0xfacefeed08n),
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

// ── Pick 1: ColorlessDamageSource — helper still pivots on cardMatches ───────
describe("Wave 108 — Pick 1: ColorlessDamageSource damageColorOverride helper", () => {
  it("damageColorOverride returns 'colorless' for matched source", () => {
    const g = mkGame();
    const c = mintCard({ game: g, id: 8100, paper: mkPaper("GhostlyFlame") });
    buildAndRegister(
      g,
      {
        mode: "ColorlessDamageSource",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      c.id as unknown as number,
      98100,
    );
    expect(damageColorOverride(g, c.id)).toBe("colorless");
  });

  it("damageColorOverride returns null for non-matched source", () => {
    const g = mkGame();
    const c = mintCard({ game: g, id: 8101, paper: mkPaper("GhostlyFlame") });
    const other = mintCard({ game: g, id: 8102, paper: mkPaper("Other") });
    buildAndRegister(
      g,
      {
        mode: "ColorlessDamageSource",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      c.id as unknown as number,
      98101,
    );
    // The static is bound to c; other doesn't match Card.Self.
    expect(damageColorOverride(g, other.id)).toBeNull();
  });

  it("ColorlessDamageSourcePayload.cardMatches honors the predicate", () => {
    const g = mkGame();
    const c = mintCard({ game: g, id: 8110, paper: mkPaper("GhostlyFlame") });
    const other = mintCard({ game: g, id: 8111, paper: mkPaper("Other") });
    const s = buildAndRegister(
      g,
      {
        mode: "ColorlessDamageSource",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      c.id as unknown as number,
      98110,
    );
    const payload = s.describe() as ColorlessDamageSourcePayload;
    expect(payload.kind).toBe("colorlessDamageSource");
    expect(payload.cardMatches(c.id, g)).toBe(true);
    expect(payload.cardMatches(other.id, g)).toBe(false);
  });
});

// ── Pick 2: IgnoreLandwalk — payload still gates after stale TODO retired ────
describe("Wave 108 — Pick 2: IgnoreLandwalk payload still gates after stale TODO retired", () => {
  it("blockerMatches + attackerMatches honor their filters", () => {
    const g = mkGame();
    const blocker = mintCard({ game: g, id: 8200, paper: mkPaper("Blocker") });
    const attacker = mintCard({ game: g, id: 8201, paper: mkPaper("Attacker"), seat: 1 });
    const s = buildAndRegister(
      g,
      {
        mode: "IgnoreLandwalk",
        params: {
          ValidBlocker: { kind: "literal", raw: "Card.Self" },
          ValidAttacker: { kind: "literal", raw: "Card" },
        },
        activeInZones: [],
      },
      blocker.id as unknown as number,
      98200,
    );
    const payload = s.describe() as IgnoreLandWalkPayload;
    expect(payload.kind).toBe("ignoreLandWalk");
    expect(payload.blockerMatches(blocker.id, g)).toBe(true);
    expect(payload.blockerMatches(attacker.id, g)).toBe(false);
    // attacker$ Card → matches every card
    expect(payload.attackerMatches(attacker.id, g)).toBe(true);
    expect(payload.attackerMatches(blocker.id, g)).toBe(true);
  });
});

// ── Pick 3: NoCleanupDamage — payload still gates after stale TODO retired ───
describe("Wave 108 — Pick 3: NoCleanupDamage payload still gates after stale TODO retired", () => {
  it("cardMatches honors ValidCard$ Card.Self", () => {
    const g = mkGame();
    const c = mintCard({ game: g, id: 8300, paper: mkPaper("DamageStays") });
    const other = mintCard({ game: g, id: 8301, paper: mkPaper("Other") });
    const s = buildAndRegister(
      g,
      {
        mode: "NoCleanupDamage",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      c.id as unknown as number,
      98300,
    );
    const payload = s.describe() as NoCleanupDamagePayload;
    expect(payload.kind).toBe("noCleanupDamage");
    expect(payload.cardMatches(c.id, g)).toBe(true);
    expect(payload.cardMatches(other.id, g)).toBe(false);
  });
});

// ── Pick 4: SurveilNum — Amount$ is a literal integer; payload gates seat ────
describe("Wave 108 — Pick 4: SurveilNum payload still uses literal-integer Amount$", () => {
  it("Amount$ 2 + ValidPlayer$ You → playerMatches honors seat 0; amount = 2", () => {
    const g = mkGame();
    const s = buildAndRegister(
      g,
      {
        mode: "SurveilNum",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          Amount: { kind: "literal", raw: "2" },
        },
        activeInZones: [],
      },
      8400,
      98400,
    );
    const payload = s.describe() as SurveilNumPayload;
    expect(payload.kind).toBe("surveilNum");
    expect(payload.amount).toBe(2);
    expect(payload.playerMatches(mkPlayerSeat(0))).toBe(true);
    expect(payload.playerMatches(mkPlayerSeat(1))).toBe(false);
  });

  it("absent Amount$ defaults to 1 (Niv-Mizzet-shape default)", () => {
    const g = mkGame();
    const s = buildAndRegister(
      g,
      {
        mode: "SurveilNum",
        params: { ValidPlayer: { kind: "literal", raw: "You" } },
        activeInZones: [],
      },
      8410,
      98410,
    );
    const payload = s.describe() as SurveilNumPayload;
    expect(payload.amount).toBe(1);
  });
});

// ── Pick 5: AttackVigilance — payload still gates after stale TODO retired ───
describe("Wave 108 — Pick 5: AttackVigilance payload still gates after stale TODO retired", () => {
  it("cardMatches honors ValidCard$ Card.Self", () => {
    const g = mkGame();
    const c = mintCard({ game: g, id: 8500, paper: mkPaper("Vigilant") });
    const other = mintCard({ game: g, id: 8501, paper: mkPaper("Other") });
    const s = buildAndRegister(
      g,
      {
        mode: "AttackVigilance",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      c.id as unknown as number,
      98500,
    );
    const payload = s.describe() as AttackVigilancePayload;
    expect(payload.kind).toBe("attackVigilance");
    expect(payload.cardMatches(c.id, g)).toBe(true);
    expect(payload.cardMatches(other.id, g)).toBe(false);
  });
});

// ── Pick 6: NumLoyaltyAct — unconditional after stale TODO retired ───────────
describe("Wave 108 — Pick 6: NumLoyaltyAct activation count is unconditional", () => {
  it("NumActivations$ 1 + ValidCard$ Card.Self yields numActivations = 1", () => {
    const g = mkGame();
    const c = mintCard({ game: g, id: 8600, paper: mkPaper("Carth", "Legendary Creature — Cat") });
    const s = buildAndRegister(
      g,
      {
        mode: "NumLoyaltyAct",
        params: {
          ValidCard: { kind: "literal", raw: "Card.Self" },
          NumActivations: { kind: "literal", raw: "1" },
        },
        activeInZones: [],
      },
      c.id as unknown as number,
      98600,
    );
    const payload = s.describe() as NumLoyaltyActPayload;
    expect(payload.kind).toBe("numLoyaltyAct");
    expect(payload.numActivations).toBe(1);
    expect(payload.cardMatches(c.id, g)).toBe(true);
  });

  it("NumActivations$ omitted defaults to 1 (Carth-shape default)", () => {
    const g = mkGame();
    const s = buildAndRegister(
      g,
      {
        mode: "NumLoyaltyAct",
        params: { ValidCard: { kind: "literal", raw: "Planeswalker.YouCtrl" } },
        activeInZones: [],
      },
      8610,
      98610,
    );
    const payload = s.describe() as NumLoyaltyActPayload;
    expect(payload.numActivations).toBe(1);
  });

  it("NumActivations$ 3 (large literal) honored", () => {
    const g = mkGame();
    const s = buildAndRegister(
      g,
      {
        mode: "NumLoyaltyAct",
        params: {
          ValidCard: { kind: "literal", raw: "Planeswalker.YouCtrl" },
          NumActivations: { kind: "literal", raw: "3" },
        },
        activeInZones: [],
      },
      8620,
      98620,
    );
    const payload = s.describe() as NumLoyaltyActPayload;
    expect(payload.numActivations).toBe(3);
  });
});

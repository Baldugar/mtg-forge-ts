// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 109 — cross-module TODO(advanced) sweep round 14 regression tests.
//
// Picks closed (one assertion bundle per pick):
//   1. static/handlers/unspent-mana-static.ts — retired the stale 3-bullet
//      TODO(advanced) tail (ManaType$ Colorless / Snow / ActivationConditions$
//      have no corpus instance). Regression: WUBRG color matching +
//      no-filter Upwelling shape still gates correctly.
//   2. static/handlers/cant-transform-static.ts — retired the stale
//      "side discriminator sub-filter" TODO(advanced) tail (no corpus
//      card uses it). Regression: cardMatches still gates the rewrite.
//   3. static/handlers/untap-other-player-static.ts — retired the stale
//      "Optional$ True" TODO(advanced) tail (no corpus instance).
//      Regression: cardMatches + playerMatches predicate pair still gates.
//   4. static/handlers/ignore-hexproof-static.ts — retired the stale
//      "ValidSpell$ Spell sub-shape" TODO(advanced) tail (no corpus uses
//      ValidSpell$). Regression: sourceMatches + targetMatches predicate
//      pair still gates.
//   5. static/handlers/combat-damage-toughness-static.ts — retired the
//      stale 2-bullet TODO(advanced) tail (both bullets were observations
//      of correct existing behaviour). Regression: cardMatches still
//      gates the rewrite.
//   6. static/handlers/assign-no-combat-damage-static.ts — retired the
//      stale "Optional$ True" TODO(advanced) tail (no corpus instance).
//      Regression: cardMatches still gates the rewrite.
import type {
  LobbyPlayer,
  PaperCard,
  PlayerSeat,
  StaticAbility,
  StaticAbilityMode,
  StaticAst,
} from "@mtg-forge-ts/core";
import {
  Color,
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
import type { AssignNoCombatDamagePayload } from "./static/handlers/assign-no-combat-damage-static.js";
import type { CantTransformPayload } from "./static/handlers/cant-transform-static.js";
import type { CombatDamageToughnessPayload } from "./static/handlers/combat-damage-toughness-static.js";
import type { IgnoreHexproofPayload } from "./static/handlers/ignore-hexproof-static.js";
import type { UnspentManaPayload } from "./static/handlers/unspent-mana-static.js";
import type { UntapOtherPlayerPayload } from "./static/handlers/untap-other-player-static.js";
import { staticHandlerRegistry } from "./static/static-handler.js";
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
  seed: "wave109",
};

const mkGame = (): Game => {
  const game = new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(0xfacefeed09n),
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

// ── Pick 1: UnspentMana — WUBRG + Upwelling shape after stale TODO retired ───
describe("Wave 109 — Pick 1: UnspentMana payload still gates after stale TODO retired", () => {
  it("ManaType$ Green + ValidPlayer$ You retains green for seat 0 only (Omnath shape)", () => {
    const g = mkGame();
    const s = buildAndRegister(
      g,
      {
        mode: "UnspentMana",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          ManaType: { kind: "literal", raw: "Green" },
        },
        activeInZones: [],
      },
      9100,
      99100,
    );
    const payload = s.describe() as UnspentManaPayload;
    expect(payload.kind).toBe("unspentMana");
    expect(payload.retainsAll).toBe(false);
    expect(payload.retainsColor(Color.Green)).toBe(true);
    expect(payload.retainsColor(Color.Red)).toBe(false);
    expect(payload.retainsColor(null)).toBe(false);
    expect(payload.playerMatches(mkPlayerSeat(0))).toBe(true);
    expect(payload.playerMatches(mkPlayerSeat(1))).toBe(false);
  });

  it("ManaType$ omitted yields retainsAll = true (Upwelling shape)", () => {
    const g = mkGame();
    const s = buildAndRegister(
      g,
      {
        mode: "UnspentMana",
        params: {},
        activeInZones: [],
      },
      9110,
      99110,
    );
    const payload = s.describe() as UnspentManaPayload;
    expect(payload.retainsAll).toBe(true);
    expect(payload.retainsColor(Color.White)).toBe(true);
    expect(payload.retainsColor(Color.Blue)).toBe(true);
    expect(payload.retainsColor(Color.Black)).toBe(true);
    expect(payload.retainsColor(Color.Red)).toBe(true);
    expect(payload.retainsColor(Color.Green)).toBe(true);
    // No ValidPlayer$ → buildPlayerPredicate default matches every seat.
    expect(payload.playerMatches(mkPlayerSeat(0))).toBe(true);
    expect(payload.playerMatches(mkPlayerSeat(1))).toBe(true);
  });

  it("Single-letter token 'R' is honored (Leyline Tyrant shape)", () => {
    const g = mkGame();
    const s = buildAndRegister(
      g,
      {
        mode: "UnspentMana",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          ManaType: { kind: "literal", raw: "R" },
        },
        activeInZones: [],
      },
      9120,
      99120,
    );
    const payload = s.describe() as UnspentManaPayload;
    expect(payload.retainsAll).toBe(false);
    expect(payload.retainsColor(Color.Red)).toBe(true);
    expect(payload.retainsColor(Color.Green)).toBe(false);
  });
});

// ── Pick 2: CantTransform — payload still gates after stale TODO retired ─────
describe("Wave 109 — Pick 2: CantTransform payload still gates after stale TODO retired", () => {
  it("cardMatches honors ValidCard$ Card.Self short-circuit", () => {
    const g = mkGame();
    const c = mintCard({ game: g, id: 9200, paper: mkPaper("Werewolf") });
    const other = mintCard({ game: g, id: 9201, paper: mkPaper("Other") });
    const s = buildAndRegister(
      g,
      {
        mode: "CantTransform",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      c.id as unknown as number,
      99200,
    );
    const payload = s.describe() as CantTransformPayload;
    expect(payload.kind).toBe("replacementGen");
    expect(payload.replacements).toHaveLength(0);
    expect(payload.cardMatches(c.id, g)).toBe(true);
    expect(payload.cardMatches(other.id, g)).toBe(false);
  });
});

// ── Pick 3: UntapOtherPlayer — payload still gates after stale TODO retired ──
describe("Wave 109 — Pick 3: UntapOtherPlayer payload still gates after stale TODO retired", () => {
  it("cardMatches + playerMatches honor their filters (Awakening-shape)", () => {
    const g = mkGame();
    const land = mintCard({ game: g, id: 9300, paper: mkPaper("Land", "Land") });
    const creature = mintCard({ game: g, id: 9301, paper: mkPaper("Creature") });
    const s = buildAndRegister(
      g,
      {
        mode: "UntapOtherPlayer",
        params: {
          ValidCard: { kind: "literal", raw: "Land" },
          ValidPlayer: { kind: "literal", raw: "Any" },
        },
        activeInZones: [],
      },
      9300,
      99300,
    );
    const payload = s.describe() as UntapOtherPlayerPayload;
    expect(payload.kind).toBe("untapOtherPlayer");
    expect(payload.cardMatches(land.id, g)).toBe(true);
    expect(payload.cardMatches(creature.id, g)).toBe(false);
    expect(payload.playerMatches(mkPlayerSeat(0))).toBe(true);
    expect(payload.playerMatches(mkPlayerSeat(1))).toBe(true);
  });
});

// ── Pick 4: IgnoreHexproof — payload still gates after stale TODO retired ────
describe("Wave 109 — Pick 4: IgnoreHexproof payload still gates after stale TODO retired", () => {
  it("sourceMatches + targetMatches honor their filters", () => {
    const g = mkGame();
    const source = mintCard({ game: g, id: 9400, paper: mkPaper("GlaringSpotlight") });
    const target = mintCard({ game: g, id: 9401, paper: mkPaper("Target"), seat: 1 });
    const s = buildAndRegister(
      g,
      {
        mode: "IgnoreHexproof",
        params: {
          ValidSource: { kind: "literal", raw: "Card.Self" },
          ValidCard: { kind: "literal", raw: "Creature" },
        },
        activeInZones: [],
      },
      source.id as unknown as number,
      99400,
    );
    const payload = s.describe() as IgnoreHexproofPayload;
    expect(payload.kind).toBe("ignoreHexproof");
    expect(payload.sourceMatches(source.id, g)).toBe(true);
    expect(payload.sourceMatches(target.id, g)).toBe(false);
    expect(payload.targetMatches(target.id, g)).toBe(true);
    // Source is also a Creature — so targetMatches matches it too.
    expect(payload.targetMatches(source.id, g)).toBe(true);
  });

  it("Both filters omitted yields universal source + target match", () => {
    const g = mkGame();
    const source = mintCard({ game: g, id: 9410, paper: mkPaper("UniversalSpotlight") });
    const other = mintCard({ game: g, id: 9411, paper: mkPaper("Other") });
    const s = buildAndRegister(
      g,
      {
        mode: "IgnoreHexproof",
        params: {},
        activeInZones: [],
      },
      source.id as unknown as number,
      99410,
    );
    const payload = s.describe() as IgnoreHexproofPayload;
    expect(payload.sourceMatches(source.id, g)).toBe(true);
    expect(payload.sourceMatches(other.id, g)).toBe(true);
    expect(payload.targetMatches(source.id, g)).toBe(true);
    expect(payload.targetMatches(other.id, g)).toBe(true);
  });
});

// ── Pick 5: CombatDamageToughness — payload still gates after stale TODO ─────
describe("Wave 109 — Pick 5: CombatDamageToughness payload still gates after stale TODO retired", () => {
  it("cardMatches honors ValidCard$ Card.Self (Doran-shape self-only)", () => {
    const g = mkGame();
    const c = mintCard({ game: g, id: 9500, paper: mkPaper("Doran") });
    const other = mintCard({ game: g, id: 9501, paper: mkPaper("Other") });
    const s = buildAndRegister(
      g,
      {
        mode: "CombatDamageToughness",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      c.id as unknown as number,
      99500,
    );
    const payload = s.describe() as CombatDamageToughnessPayload;
    expect(payload.kind).toBe("combatDamageToughness");
    expect(payload.cardMatches(c.id, g)).toBe(true);
    expect(payload.cardMatches(other.id, g)).toBe(false);
  });

  it("ValidCard$ omitted defaults to 'Creature' (Doran's Aura broad shape)", () => {
    const g = mkGame();
    const creature = mintCard({ game: g, id: 9510, paper: mkPaper("Creature") });
    const land = mintCard({ game: g, id: 9511, paper: mkPaper("Land", "Land") });
    const s = buildAndRegister(
      g,
      {
        mode: "CombatDamageToughness",
        params: {},
        activeInZones: [],
      },
      9510,
      99510,
    );
    const payload = s.describe() as CombatDamageToughnessPayload;
    expect(payload.cardMatches(creature.id, g)).toBe(true);
    expect(payload.cardMatches(land.id, g)).toBe(false);
  });
});

// ── Pick 6: AssignNoCombatDamage — payload still gates after stale TODO ──────
describe("Wave 109 — Pick 6: AssignNoCombatDamage payload still gates after stale TODO retired", () => {
  it("cardMatches honors ValidCard$ Card.Self", () => {
    const g = mkGame();
    const c = mintCard({ game: g, id: 9600, paper: mkPaper("NoDamage") });
    const other = mintCard({ game: g, id: 9601, paper: mkPaper("Other") });
    const s = buildAndRegister(
      g,
      {
        mode: "AssignNoCombatDamage",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      c.id as unknown as number,
      99600,
    );
    const payload = s.describe() as AssignNoCombatDamagePayload;
    expect(payload.kind).toBe("assignNoCombatDamage");
    expect(payload.cardMatches(c.id, g)).toBe(true);
    expect(payload.cardMatches(other.id, g)).toBe(false);
  });
});

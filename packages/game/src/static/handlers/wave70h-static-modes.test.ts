// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.H — three more registry-walk gate statics regression tests.
// Covers:
//   - Registration smoke for OptionalAttackCost / AttackRestrict / BlockRestrict
//   - OptionalAttackCost: collectOptionalAttackCosts surfaces matched payloads
//   - AttackRestrict: declareAttackers rejects when MaxAttackers$ exceeded
//   - AttackRestrict: ValidDefender$ scopes the cap to matching defenders
//   - BlockRestrict: declareBlockers rejects when MaxBlockers$ exceeded
//   - Lifecycle: deactivation reverses each gate
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
  IllegalDecisionError,
  SeededRng,
  TypeLine,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import { CombatHandler } from "../../combat/combat-handler.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import {
  collectOptionalAttackCosts,
  exceedsAttackerCap,
  exceedsBlockerCap,
} from "../../statics/wave70h-combat-gates.js";
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

// ── registration smoke ───────────────────────────────────────────────────────
describe("Wave 70.H — registration smoke", () => {
  const modes: readonly StaticAbilityMode[] = ["OptionalAttackCost", "AttackRestrict", "BlockRestrict"];
  for (const m of modes) {
    it(`mode '${m}' is registered`, () => {
      expect(staticHandlerRegistry.has(m)).toBe(true);
    });
  }
});

// ── OptionalAttackCost — Exert family ───────────────────────────────────────
describe("Wave 70.H — OptionalAttackCost", () => {
  it("collectOptionalAttackCosts returns Trigger$ + Cost$ metadata for matched attacker", () => {
    const g = mkGame();
    const att = mintCard({ game: g, id: 8000, paper: mkPaper("Ahn-Crop Champion"), seat: 0 });
    buildAndRegister(
      g,
      {
        mode: "OptionalAttackCost",
        params: {
          ValidCard: { kind: "literal", raw: "Card.Self" },
          Cost: { kind: "literal", raw: "Exert<1/CARDNAME>" },
          Trigger: { kind: "literal", raw: "TrigUntapAll" },
          Description: { kind: "literal", raw: "You may exert CARDNAME as it attacks." },
        },
        activeInZones: [],
      },
      att.id as unknown as number,
      98000,
    );
    const entries = collectOptionalAttackCosts(g, att.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.costText).toBe("Exert<1/CARDNAME>");
    expect(entries[0]?.triggerSVar).toBe("TrigUntapAll");
    expect(entries[0]?.description).toContain("exert");
    // Unmatched attacker: no entries.
    expect(collectOptionalAttackCosts(g, mkEntityId(99999))).toHaveLength(0);
  });
});

// ── AttackRestrict — Astral Arena / Silent Arbiter analogues ────────────────
describe("Wave 70.H — AttackRestrict", () => {
  it("declareAttackers rejects when MaxAttackers$ exceeded", () => {
    const g = mkGame();
    const seat1 = mkPlayerSeat(1);
    const arena = mintCard({ game: g, id: 8100, paper: mkPaper("Astral Arena", "Plane") });
    const att1 = mintCard({ game: g, id: 8101, paper: mkPaper("Hill Giant"), seat: 0 });
    const att2 = mintCard({ game: g, id: 8102, paper: mkPaper("Grizzly Bear"), seat: 0 });
    buildAndRegister(
      g,
      {
        mode: "AttackRestrict",
        params: { MaxAttackers: { kind: "literal", raw: "1" } },
        activeInZones: [],
      },
      arena.id as unknown as number,
      98100,
    );

    const handler = new CombatHandler(g);
    // One attacker is fine.
    expect(() =>
      handler.declareAttackers([{ attackerId: att1.id, defender: { kind: "player", seat: seat1 } }]),
    ).not.toThrow();

    // Reset & try two — should violate the cap.
    const handler2 = new CombatHandler(g);
    expect(() =>
      handler2.declareAttackers([
        { attackerId: att1.id, defender: { kind: "player", seat: seat1 } },
        { attackerId: att2.id, defender: { kind: "player", seat: seat1 } },
      ]),
    ).toThrow(IllegalDecisionError);
  });

  it("ValidDefender$ You — cap only applies when defender matches the controller's perspective", () => {
    const g = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    // Source controlled by seat0 ("you"). Crawlspace-shape: at most one
    // creature can attack ME (seat0). Attackers from seat1 attacking
    // seat0 → cap applies. Attackers from seat0 attacking seat1 → cap
    // does not apply.
    const source = mintCard({ game: g, id: 8200, paper: mkPaper("Crawlspace", "Artifact"), seat: 0 });
    buildAndRegister(
      g,
      {
        mode: "AttackRestrict",
        params: {
          MaxAttackers: { kind: "literal", raw: "1" },
          ValidDefender: { kind: "literal", raw: "You" },
        },
        activeInZones: [],
      },
      source.id as unknown as number,
      98200,
      0,
    );

    const att1 = mintCard({ game: g, id: 8201, paper: mkPaper("Hill Giant"), seat: 1 });
    const att2 = mintCard({ game: g, id: 8202, paper: mkPaper("Grizzly Bear"), seat: 1 });
    // Two attackers, BOTH attacking seat0 (controller-of-source) → cap
    // applies → violation.
    const violation = exceedsAttackerCap(g, [
      { attackerId: att1.id, defender: { kind: "player", seat: seat0 } },
      { attackerId: att2.id, defender: { kind: "player", seat: seat0 } },
    ]);
    expect(violation?.payload.maxAttackers).toBe(1);
    expect(violation?.count).toBe(2);

    // Two attackers, BOTH attacking seat1 → cap does NOT apply → no violation.
    expect(
      exceedsAttackerCap(g, [
        { attackerId: att1.id, defender: { kind: "player", seat: seat1 } },
        { attackerId: att2.id, defender: { kind: "player", seat: seat1 } },
      ]),
    ).toBeNull();
  });
});

// ── BlockRestrict — Silent Arbiter-shape ────────────────────────────────────
describe("Wave 70.H — BlockRestrict", () => {
  it("declareBlockers rejects when MaxBlockers$ exceeded", () => {
    const g = mkGame();
    const seat1 = mkPlayerSeat(1);
    const arena = mintCard({ game: g, id: 8300, paper: mkPaper("Silent Arbiter", "Artifact"), seat: 0 });
    const att = mintCard({ game: g, id: 8301, paper: mkPaper("Hill Giant"), seat: 0 });
    const blocker1 = mintCard({ game: g, id: 8302, paper: mkPaper("Grizzly Bear"), seat: 1 });
    const blocker2 = mintCard({ game: g, id: 8303, paper: mkPaper("Runeclaw Bear"), seat: 1 });
    buildAndRegister(
      g,
      {
        mode: "BlockRestrict",
        params: { MaxBlockers: { kind: "literal", raw: "1" } },
        activeInZones: [],
      },
      arena.id as unknown as number,
      98300,
      0,
    );

    const handler = new CombatHandler(g);
    handler.declareAttackers([{ attackerId: att.id, defender: { kind: "player", seat: seat1 } }]);
    // One blocker is fine.
    expect(() => handler.declareBlockers([{ blockerId: blocker1.id, attackerIds: [att.id] }])).not.toThrow();

    // Reset combat and try two blockers → violation.
    const handler2 = new CombatHandler(g);
    handler2.declareAttackers([{ attackerId: att.id, defender: { kind: "player", seat: seat1 } }]);
    expect(() =>
      handler2.declareBlockers([
        { blockerId: blocker1.id, attackerIds: [att.id] },
        { blockerId: blocker2.id, attackerIds: [att.id] },
      ]),
    ).toThrow(IllegalDecisionError);
  });

  it("exceedsBlockerCap returns null with no statics registered", () => {
    const g = mkGame();
    const seat1: PlayerSeat = mkPlayerSeat(1);
    expect(
      exceedsBlockerCap(g, [
        {
          blockerId: mkEntityId(1),
          attackerId: mkEntityId(2),
          defender: { kind: "player", seat: seat1 },
        },
      ]),
    ).toBeNull();
  });
});

// ── Lifecycle: deactivation reverses each gate ──────────────────────────────
describe("Wave 70.H — lifecycle: deactivation reverses each gate", () => {
  it("unregistering each Wave 70.H static restores normal behavior", () => {
    const g = mkGame();
    const seat1 = mkPlayerSeat(1);
    const att = mintCard({ game: g, id: 8400, paper: mkPaper("Glorybringer"), seat: 0 });
    const arena = mintCard({ game: g, id: 8401, paper: mkPaper("Astral Arena"), seat: 0 });
    const arbiter = mintCard({ game: g, id: 8402, paper: mkPaper("Silent Arbiter"), seat: 0 });

    const sOpt = buildAndRegister(
      g,
      {
        mode: "OptionalAttackCost",
        params: {
          ValidCard: { kind: "literal", raw: "Card.Self" },
          Cost: { kind: "literal", raw: "Exert<1/CARDNAME>" },
        },
        activeInZones: [],
      },
      att.id as unknown as number,
      98400,
    );
    const sAtt = buildAndRegister(
      g,
      {
        mode: "AttackRestrict",
        params: { MaxAttackers: { kind: "literal", raw: "1" } },
        activeInZones: [],
      },
      arena.id as unknown as number,
      98401,
    );
    const sBlk = buildAndRegister(
      g,
      {
        mode: "BlockRestrict",
        params: { MaxBlockers: { kind: "literal", raw: "1" } },
        activeInZones: [],
      },
      arbiter.id as unknown as number,
      98402,
    );

    expect(collectOptionalAttackCosts(g, att.id)).toHaveLength(1);
    expect(
      exceedsAttackerCap(g, [
        { attackerId: mkEntityId(1), defender: { kind: "player", seat: seat1 } },
        { attackerId: mkEntityId(2), defender: { kind: "player", seat: seat1 } },
      ]),
    ).not.toBeNull();
    expect(
      exceedsBlockerCap(g, [
        {
          blockerId: mkEntityId(3),
          attackerId: mkEntityId(1),
          defender: { kind: "player", seat: seat1 },
        },
        {
          blockerId: mkEntityId(4),
          attackerId: mkEntityId(1),
          defender: { kind: "player", seat: seat1 },
        },
      ]),
    ).not.toBeNull();

    g.staticEffectRegistry.unregister(sOpt.id);
    g.staticEffectRegistry.unregister(sAtt.id);
    g.staticEffectRegistry.unregister(sBlk.id);

    expect(collectOptionalAttackCosts(g, att.id)).toHaveLength(0);
    expect(
      exceedsAttackerCap(g, [
        { attackerId: mkEntityId(1), defender: { kind: "player", seat: seat1 } },
        { attackerId: mkEntityId(2), defender: { kind: "player", seat: seat1 } },
      ]),
    ).toBeNull();
    expect(
      exceedsBlockerCap(g, [
        {
          blockerId: mkEntityId(3),
          attackerId: mkEntityId(1),
          defender: { kind: "player", seat: seat1 },
        },
      ]),
    ).toBeNull();
  });
});

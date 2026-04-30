// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.F — three more registry-walk gate statics regression tests.
// Covers:
//   - Registration smoke for UntapOtherPlayer / AssignCombatDamageAsUnblocked
//     / IgnoreLandwalk
//   - UntapOtherPlayer: filter activates an extra untap during the
//     active player's untap step (cross-player untap)
//   - AssignCombatDamageAsUnblocked: blocked attacker damages the
//     defending player as if unblocked
//   - IgnoreLandwalk: blocker successfully blocks landwalk attacker
//     (block-legality short-circuits the landwalk rejection)
import type {
  Characteristics,
  EntityId,
  LobbyPlayer,
  PaperCard,
  PlayerSeat,
  StaticAbility,
  StaticAbilityMode,
  StaticAst,
} from "@mtg-forge-ts/core";
import {
  CardType,
  DEFAULT_PAPER_CARD_FLAGS,
  PhaseStep,
  SeededRng,
  TypeLine,
  ZoneType,
  emptyCharacteristics,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { EngineYield } from "../../action/engine-yield.js";
import { Card } from "../../card.js";
import { CombatHandler } from "../../combat/combat-handler.js";
import { isBlockLegal } from "../../combat/keywords/block-restrictions.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { PhaseHandler } from "../../phase/phase-handler.js";
import {
  assignsCombatDamageAsUnblocked,
  ignoresLandWalk,
  shouldUntapDuringStep,
} from "../../statics/wave70f-combat-gates.js";
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

const drain = (g: Generator<EngineYield, void, unknown>): EngineYield[] => {
  const out: EngineYield[] = [];
  let step = g.next();
  while (!step.done) {
    out.push(step.value);
    step = g.next();
  }
  return out;
};

interface CharOverride {
  power?: number;
  toughness?: number;
  types?: CardType[];
  subtypes?: string[];
}

const stubChars = (game: Game): ((id: EntityId, o: CharOverride) => void) => {
  const overrides = new Map<EntityId, CharOverride>();
  const orig = game.layerEngine.computeCharacteristics.bind(game.layerEngine);
  game.layerEngine.computeCharacteristics = (id: EntityId): Characteristics => {
    const o = overrides.get(id);
    if (!o) return orig(id);
    const chars = emptyCharacteristics();
    if (o.power !== undefined) chars.power = o.power;
    if (o.toughness !== undefined) chars.toughness = o.toughness;
    if (o.types) for (const t of o.types) chars.types.add(t);
    if (o.subtypes) for (const s of o.subtypes) chars.subtypes.add(s);
    return chars;
  };
  return (id, o) => overrides.set(id, o);
};

// ── registration smoke ───────────────────────────────────────────────────────
describe("Wave 70.F — registration smoke", () => {
  const modes: readonly StaticAbilityMode[] = [
    "UntapOtherPlayer",
    "AssignCombatDamageAsUnblocked",
    "IgnoreLandwalk",
  ];
  for (const m of modes) {
    it(`mode '${m}' is registered`, () => {
      expect(staticHandlerRegistry.has(m)).toBe(true);
    });
  }
});

// ── UntapOtherPlayer — Awakening / Vedalken Orrery analogues ────────────────
describe("Wave 70.F — UntapOtherPlayer", () => {
  it("filter activates extra untap during active player's untap step", () => {
    // Awakening-shape: during seat 0's untap step, every player's lands
    // and creatures untap. We drive runUntapPass via PhaseHandler's
    // public surface — but its untap-step body is private. Instead, we
    // verify the gate's effect by calling the helper directly: the
    // shouldUntapDuringStep helper returns true for a card on the
    // OTHER player's battlefield when an UntapOtherPlayer static
    // matches.
    const g = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const opponentCreature = mintCard({
      game: g,
      id: 7100,
      paper: mkPaper("Grizzly Bear"),
      seat: 1,
    });
    // Awakening-shape: ValidCard$ Card (any), ValidPlayer$ Any.
    buildAndRegister(
      g,
      {
        mode: "UntapOtherPlayer",
        params: {
          ValidCard: { kind: "literal", raw: "Card" },
          ValidPlayer: { kind: "literal", raw: "Any" },
        },
        activeInZones: [],
      },
      7099,
      97099,
    );
    // shouldUntapDuringStep: true for the opponent's card during seat0's untap.
    expect(shouldUntapDuringStep(g, opponentCreature.id, seat0)).toBe(true);
    // Also true during seat1's own untap step (Any → both seats).
    expect(shouldUntapDuringStep(g, opponentCreature.id, seat1)).toBe(true);

    // End-to-end: tap the opponent's creature, drive the untap turn-
    // based actions for seat0 directly, and verify the cross-player
    // untap fires.
    opponentCreature.tapped = true;
    const phaseHandler = new PhaseHandler(g);
    g.activePlayer = seat0;
    g.phase = PhaseStep.Untap;
    drain(phaseHandler.performTurnBasedActions(PhaseStep.Untap, seat0));
    expect(opponentCreature.tapped).toBe(false);
  });

  it("ValidPlayer$ You — gate only fires during the controller's untap step", () => {
    const g = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const card = mintCard({ game: g, id: 7110, paper: mkPaper("Grizzly Bear"), seat: 1 });
    // Static controlled by seat 0; ValidPlayer$ You → only seat 0's
    // untap step opens the gate.
    buildAndRegister(
      g,
      {
        mode: "UntapOtherPlayer",
        params: {
          ValidCard: { kind: "literal", raw: "Card" },
          ValidPlayer: { kind: "literal", raw: "You" },
        },
        activeInZones: [],
      },
      7109,
      97109,
      0,
    );
    expect(shouldUntapDuringStep(g, card.id, seat0)).toBe(true);
    expect(shouldUntapDuringStep(g, card.id, seat1)).toBe(false);
  });
});

// ── AssignCombatDamageAsUnblocked — Bloodthorn Tine / Tempting Wurm ─────────
describe("Wave 70.F — AssignCombatDamageAsUnblocked", () => {
  it("smoke + helper returns true for matched attacker", () => {
    const g = mkGame();
    const attacker = mintCard({ game: g, id: 7200, paper: mkPaper("Bloodthorn Tine") });
    buildAndRegister(
      g,
      {
        mode: "AssignCombatDamageAsUnblocked",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      attacker.id as unknown as number,
      97200,
    );
    expect(assignsCombatDamageAsUnblocked(g, attacker.id)).toBe(true);
    // Unmatched id: gate is false.
    expect(assignsCombatDamageAsUnblocked(g, mkEntityId(99999))).toBe(false);
  });

  it("blocked attacker damages defending player as if unblocked", () => {
    const g = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const setChars = stubChars(g);
    const attacker = mintCard({ game: g, id: 7210, paper: mkPaper("Bloodthorn Tine"), seat: 0 });
    const blocker = mintCard({ game: g, id: 7211, paper: mkPaper("Grizzly Bear"), seat: 1 });
    setChars(attacker.id, { power: 3, toughness: 3 });
    setChars(blocker.id, { power: 2, toughness: 2 });
    // Stamp the static so the blocked attacker routes damage as unblocked.
    buildAndRegister(
      g,
      {
        mode: "AssignCombatDamageAsUnblocked",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      attacker.id as unknown as number,
      97210,
    );

    const handler = new CombatHandler(g);
    handler.declareAttackers([{ attackerId: attacker.id, defender: { kind: "player", seat: seat1 } }]);
    handler.declareBlockers([{ blockerId: blocker.id, attackerIds: [attacker.id] }]);
    handler.setBlockerOrder(attacker.id, [blocker.id]);

    const yields = drain(handler.dealDamage(false));
    // Collect DamageDealt events keyed by source.
    const dmg: Array<{ src: EntityId; tgtKind: string; tgtId: EntityId | PlayerSeat; amt: number }> = [];
    for (const y of yields) {
      if (y.kind !== "event") continue;
      if (y.event.kind !== "DamageDealt") continue;
      dmg.push({
        src: y.event.payload.sourceId,
        tgtKind: y.event.payload.targetKind,
        tgtId: y.event.payload.targetId,
        amt: y.event.payload.amount,
      });
    }
    // Attacker dealt 3 damage to seat1 directly (not to the blocker).
    const attackerDeals = dmg.filter((d) => d.src === attacker.id);
    expect(attackerDeals).toHaveLength(1);
    expect(attackerDeals[0]?.tgtKind).toBe("player");
    expect(attackerDeals[0]?.tgtId).toBe(seat1);
    expect(attackerDeals[0]?.amt).toBe(3);
    // Blocker still hits the attacker normally.
    const blockerDeals = dmg.filter((d) => d.src === blocker.id);
    expect(blockerDeals).toHaveLength(1);
    expect(blockerDeals[0]?.tgtKind).toBe("creature");
    expect(blockerDeals[0]?.tgtId).toBe(attacker.id);
    expect(blockerDeals[0]?.amt).toBe(2);
    // The blocker did NOT receive any damage from the attacker.
    expect(g.cards.get(blocker.id)?.damage ?? 0).toBe(0);
    // Defending player took 3.
    expect(g.getPlayer(seat0).life).toBe(20);
    expect(g.getPlayer(seat1).life).toBe(17);
  });
});

// ── IgnoreLandwalk — Sphere of Truth / Reverence analogues ──────────────────
describe("Wave 70.F — IgnoreLandwalk", () => {
  it("smoke + helper returns true for matched (blocker, attacker) pair", () => {
    const g = mkGame();
    const blocker = mintCard({ game: g, id: 7300, paper: mkPaper("Sphere of Truth"), seat: 1 });
    const attacker = mintCard({ game: g, id: 7301, paper: mkPaper("Wood Elves"), seat: 0 });
    // Sphere of Truth-shape: this creature ignores landwalk.
    buildAndRegister(
      g,
      {
        mode: "IgnoreLandwalk",
        params: { ValidBlocker: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      blocker.id as unknown as number,
      97300,
      1,
    );
    expect(ignoresLandWalk(g, blocker.id, attacker.id)).toBe(true);
    // Unmatched blocker: gate is false.
    expect(ignoresLandWalk(g, mkEntityId(99999), attacker.id)).toBe(false);
  });

  it("blocker successfully blocks landwalk attacker (forestwalk bypassed)", () => {
    const g = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const setChars = stubChars(g);
    const attacker = mintCard({ game: g, id: 7310, paper: mkPaper("Wood Elves"), seat: 0 });
    const blocker = mintCard({ game: g, id: 7311, paper: mkPaper("Sphere of Truth"), seat: 1 });
    const forest = mintCard({
      game: g,
      id: 7312,
      paper: mkPaper("Forest", "Basic Land — Forest"),
      seat: 1,
    });
    setChars(attacker.id, { power: 2, toughness: 2 });
    setChars(blocker.id, { power: 2, toughness: 2 });
    // Defender (seat 1) controls a Forest → without the static the
    // forestwalk attacker can't be blocked.
    setChars(forest.id, { types: [CardType.Land], subtypes: ["Forest"] });
    // Attacker has forestwalk.
    if (!attacker.keywords) attacker.keywords = new Set();
    attacker.keywords.add("forestwalk");

    // Without the static — block is illegal.
    expect(isBlockLegal(g, blocker.id, attacker.id, [blocker.id]).legal).toBe(false);

    // Stamp IgnoreLandwalk on the blocker — block is now legal.
    buildAndRegister(
      g,
      {
        mode: "IgnoreLandwalk",
        params: { ValidBlocker: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      blocker.id as unknown as number,
      97310,
      1,
    );
    // Helper agrees.
    expect(ignoresLandWalk(g, blocker.id, attacker.id)).toBe(true);
    // Block-legality flips to legal.
    expect(isBlockLegal(g, blocker.id, attacker.id, [blocker.id]).legal).toBe(true);

    // End-to-end via CombatHandler.declareBlockers (would throw if illegal).
    const handler = new CombatHandler(g);
    handler.declareAttackers([{ attackerId: attacker.id, defender: { kind: "player", seat: seat1 } }]);
    expect(() =>
      handler.declareBlockers([{ blockerId: blocker.id, attackerIds: [attacker.id] }]),
    ).not.toThrow();
    // Defending player did not get hit (blocked successfully).
    handler.setBlockerOrder(attacker.id, [blocker.id]);
    drain(handler.dealDamage(false));
    expect(g.getPlayer(seat0).life).toBe(20);
    expect(g.getPlayer(seat1).life).toBe(20);
  });
});

// ── Lifecycle: deactivation reverses each gate ──────────────────────────────
describe("Wave 70.F — lifecycle: deactivation reverses each gate", () => {
  it("unregistering each Wave 70.F static restores normal behavior", () => {
    const g = mkGame();
    const seat0 = mkPlayerSeat(0);
    const card = mintCard({ game: g, id: 7400, paper: mkPaper("Grizzly Bear"), seat: 1 });
    const attacker = mintCard({ game: g, id: 7401, paper: mkPaper("Bloodthorn Tine") });
    const blocker = mintCard({ game: g, id: 7402, paper: mkPaper("Sphere of Truth"), seat: 1 });

    const sUntap = buildAndRegister(
      g,
      {
        mode: "UntapOtherPlayer",
        params: {
          ValidCard: { kind: "literal", raw: "Card" },
          ValidPlayer: { kind: "literal", raw: "Any" },
        },
        activeInZones: [],
      },
      7410,
      97410,
    );
    const sUnblocked = buildAndRegister(
      g,
      {
        mode: "AssignCombatDamageAsUnblocked",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      attacker.id as unknown as number,
      97420,
    );
    const sLandwalk = buildAndRegister(
      g,
      {
        mode: "IgnoreLandwalk",
        params: { ValidBlocker: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      blocker.id as unknown as number,
      97430,
      1,
    );

    expect(shouldUntapDuringStep(g, card.id, seat0)).toBe(true);
    expect(assignsCombatDamageAsUnblocked(g, attacker.id)).toBe(true);
    expect(ignoresLandWalk(g, blocker.id, attacker.id)).toBe(true);

    g.staticEffectRegistry.unregister(sUntap.id);
    g.staticEffectRegistry.unregister(sUnblocked.id);
    g.staticEffectRegistry.unregister(sLandwalk.id);

    expect(shouldUntapDuringStep(g, card.id, seat0)).toBe(false);
    expect(assignsCombatDamageAsUnblocked(g, attacker.id)).toBe(false);
    expect(ignoresLandWalk(g, blocker.id, attacker.id)).toBe(false);
  });
});

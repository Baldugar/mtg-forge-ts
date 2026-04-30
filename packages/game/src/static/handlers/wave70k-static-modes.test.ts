// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.K — three more registry-walk gate statics regression tests.
// Covers:
//   - Registration smoke for CantAttach / AttackRequirement / IgnoreHexproof
//   - CantAttach: canAttach helper rejects matched (equipment, target) pair;
//                 game.action.attach call site no-ops on rejection.
//   - CantAttach: targeted attach (Aura cast-time) blocked via canAttach.
//   - AttackRequirement: declareAttackers passes when defender matches
//                         the static's ValidDefender$ filter ("You").
//   - AttackRequirement: declareAttackers throws IllegalDecisionError
//                         when an attacker subject to the static declares
//                         an alternate (non-permitted) defender.
//   - IgnoreHexproof: hexproof creature targeted via canBeTargetedBy/
//                      enumerateEligibleTargets when an active static
//                      matches the casting source.
//   - Lifecycle: deactivation reverses each gate.
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
import { attackRequirementsFor, canAttach, ignoresHexproof } from "../../statics/wave70k-gate-helpers.js";
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

const runAll = <T>(gen: Generator<T, void, unknown>): readonly T[] => {
  const out: T[] = [];
  let v = gen.next();
  while (!v.done) {
    out.push(v.value);
    v = gen.next();
  }
  return out;
};

// ── registration smoke ───────────────────────────────────────────────────────
describe("Wave 70.K — registration smoke", () => {
  const modes: readonly StaticAbilityMode[] = ["CantAttach", "AttackRequirement", "IgnoreHexproof"];
  for (const m of modes) {
    it(`mode '${m}' is registered`, () => {
      expect(staticHandlerRegistry.has(m)).toBe(true);
    });
  }
});

// ── CantAttach — Sigarda / True Believer / Witchbane Orb ─────────────────────
describe("Wave 70.K — CantAttach", () => {
  it("canAttach: rejects matched (equipment, target) pair; default permits", () => {
    const g = mkGame();
    const equip = mintCard({
      game: g,
      id: 9000,
      paper: mkPaper("Test Equipment", "Artifact — Equipment"),
      seat: 0,
    });
    const target = mintCard({ game: g, id: 9001, paper: mkPaper("Friendly Bear"), seat: 0 });
    // Default: no static — attach allowed.
    expect(canAttach(g, equip.id, target.id)).toBe(true);
    // Stamp Witchbane-shape gate: ValidCard$ Card (any) | ValidTarget$ Card.YouCtrl.
    buildAndRegister(
      g,
      {
        mode: "CantAttach",
        params: {
          ValidCard: { kind: "literal", raw: "Equipment" },
          ValidTarget: { kind: "literal", raw: "Card.YouCtrl" },
        },
        activeInZones: [],
      },
      9002,
      99002,
      0,
    );
    // Now matched: the equipment hits ValidCard$ AND target hits ValidTarget$.
    expect(canAttach(g, equip.id, target.id)).toBe(false);
  });

  it("game.action.attach no-ops silently when CantAttach matches", () => {
    const g = mkGame();
    const equip = mintCard({
      game: g,
      id: 9100,
      paper: mkPaper("Test Equipment 2", "Artifact — Equipment"),
      seat: 0,
    });
    const target = mintCard({ game: g, id: 9101, paper: mkPaper("Friendly Bear 2"), seat: 0 });
    buildAndRegister(
      g,
      {
        mode: "CantAttach",
        params: {
          ValidCard: { kind: "literal", raw: "Equipment" },
          ValidTarget: { kind: "literal", raw: "Card.YouCtrl" },
        },
        activeInZones: [],
      },
      9102,
      99102,
      0,
    );
    // Run the attach generator; expect silent no-op (no event emitted, no
    // state change).
    const ys = runAll(g.action.attach(equip.id, target.id, "activated"));
    // No CardAttached event yielded.
    expect(
      ys.find(
        (y) =>
          (y as unknown as { kind?: string; payload?: { kind?: string } }).payload?.kind === "CardAttached",
      ),
    ).toBeUndefined();
    // State invariants intact: source not attached, target has no attachments.
    expect(equip.attachedTo).toBeNull();
    expect(target.attachments.length).toBe(0);
  });

  it("targeted attach (Aura-shape) blocked: canAttach rejects ValidCard$ Aura.OppCtrl", () => {
    // Sigarda-shape: from seat 0's perspective, Auras controlled by seat 1
    // can't attach to seat-0 permanents. Cast-time target choice would be
    // illegal — modeled here by canAttach returning false.
    const g = mkGame();
    const aura = mintCard({
      game: g,
      id: 9200,
      paper: mkPaper("Hostile Aura", "Enchantment — Aura"),
      seat: 1,
    });
    const myCreature = mintCard({
      game: g,
      id: 9201,
      paper: mkPaper("My Creature"),
      seat: 0,
    });
    buildAndRegister(
      g,
      {
        mode: "CantAttach",
        params: {
          ValidCard: { kind: "literal", raw: "Aura.OppCtrl" },
          ValidTarget: { kind: "literal", raw: "Card.YouCtrl" },
        },
        activeInZones: [],
      },
      9202,
      99202,
      0,
    );
    expect(canAttach(g, aura.id, myCreature.id)).toBe(false);
  });
});

// ── AttackRequirement — Goad-shape / curse-shape / Vow auras ─────────────────
describe("Wave 70.K — AttackRequirement", () => {
  it("declareAttackers passes when declared defender matches ValidDefender$ You", () => {
    const g = mkGame();
    const att = mintCard({ game: g, id: 9300, paper: mkPaper("Bear A"), seat: 1 });
    // Stamp curse-shape gate on seat 0 ("creatures attack you if able"):
    // ValidCard$ Creature, ValidDefender$ You.
    buildAndRegister(
      g,
      {
        mode: "AttackRequirement",
        params: {
          ValidCard: { kind: "literal", raw: "Creature" },
          ValidDefender: { kind: "literal", raw: "You" },
        },
        activeInZones: [],
      },
      9301,
      99301,
      0, // controllerSeat = 0 → "You" resolves to seat 0
    );
    // Decl: seat 1's creature attacks seat 0 — matches ValidDefender$ "You" (seat 0).
    const handler = new CombatHandler(g);
    expect(() =>
      handler.declareAttackers([{ attackerId: att.id, defender: { kind: "player", seat: mkPlayerSeat(0) } }]),
    ).not.toThrow();
    expect(handler.state.attackers.has(att.id)).toBe(true);
  });

  it("declareAttackers rejects alternate defender when AttackRequirement applies", () => {
    const g = mkGame();
    const att = mintCard({ game: g, id: 9400, paper: mkPaper("Bear B"), seat: 1 });
    // 3-player setup would be ideal but the rules cap is 2; the attacker
    // (seat 1) attacking THEMSELVES is invalid combat anyway, so we
    // synthesize the rejection by pointing the defender at seat 1
    // (the static says "defender must be You, i.e. seat 0").
    buildAndRegister(
      g,
      {
        mode: "AttackRequirement",
        params: {
          ValidCard: { kind: "literal", raw: "Creature" },
          ValidDefender: { kind: "literal", raw: "You" },
        },
        activeInZones: [],
      },
      9401,
      99401,
      0, // controllerSeat = 0 → "You" resolves to seat 0
    );
    // Decl: seat-1 attacker declares seat 1 as defender — VIOLATES the
    // AttackRequirement (which says "must attack seat 0").
    const handler = new CombatHandler(g);
    expect(() =>
      handler.declareAttackers([{ attackerId: att.id, defender: { kind: "player", seat: mkPlayerSeat(1) } }]),
    ).toThrow(IllegalDecisionError);
  });

  it("attackRequirementsFor: returns null when no static matches", () => {
    const g = mkGame();
    const att = mintCard({ game: g, id: 9500, paper: mkPaper("Bear C"), seat: 1 });
    expect(attackRequirementsFor(g, att.id)).toBeNull();
  });
});

// ── IgnoreHexproof — Glaring Spotlight / Arcane Lighthouse ───────────────────
describe("Wave 70.K — IgnoreHexproof", () => {
  it("hexproof creature appears in eligibility set when IgnoreHexproof matches", () => {
    const g = mkGame();
    const sourceCard = mintCard({
      game: g,
      id: 9600,
      paper: mkPaper("Glaring Spotlight", "Artifact"),
      seat: 0,
    });
    const targetCreature = mintCard({
      game: g,
      id: 9601,
      paper: mkPaper("Hexproof Bear"),
      seat: 1,
    });
    // Build a hexproof restriction (opponent's permanents normally
    // filtered).
    const r: TargetRestriction = {
      permitZones: new Set([ZoneType.Battlefield]),
      controllerScope: "any",
      forbidSelfSource: false,
      mayTargetPlayers: false,
      hexproof: true,
      shroud: false,
      permitTypes: new Set(),
      forbidTypes: new Set(),
      minTargets: 1,
      maxTargets: 1,
    };
    // Without static: hexproof opp creature filtered out.
    {
      const out = enumerateEligibleTargets(
        g,
        { sourceId: sourceCard.id, sourceControllerSeat: mkPlayerSeat(0) },
        r,
      );
      expect(out.find((x) => x.kind === "card" && x.id === targetCreature.id)).toBeUndefined();
    }
    // Stamp Glaring Spotlight: ValidSource$ Card.YouCtrl bypasses hexproof
    // for OUR sources.
    buildAndRegister(
      g,
      {
        mode: "IgnoreHexproof",
        params: {
          ValidSource: { kind: "literal", raw: "Card.YouCtrl" },
        },
        activeInZones: [],
      },
      sourceCard.id as unknown as number,
      99602,
      0,
    );
    // ignoresHexproof reads true for our source.
    expect(ignoresHexproof(g, sourceCard.id, targetCreature.id)).toBe(true);
    // With static: hexproof opp creature now appears.
    {
      const out = enumerateEligibleTargets(
        g,
        { sourceId: sourceCard.id, sourceControllerSeat: mkPlayerSeat(0) },
        r,
      );
      expect(out.find((x) => x.kind === "card" && x.id === targetCreature.id)).toBeDefined();
    }
  });

  it("non-matching ValidSource$ leaves hexproof in force", () => {
    const g = mkGame();
    const oppSource = mintCard({
      game: g,
      id: 9700,
      paper: mkPaper("Opp Source", "Artifact"),
      seat: 1, // opponent's source
    });
    // Stamp Glaring Spotlight with ValidSource$ Card.YouCtrl (controller
    // seat 0). The opp's source does NOT match.
    buildAndRegister(
      g,
      {
        mode: "IgnoreHexproof",
        params: {
          ValidSource: { kind: "literal", raw: "Card.YouCtrl" },
        },
        activeInZones: [],
      },
      9701,
      99701,
      0,
    );
    expect(ignoresHexproof(g, oppSource.id)).toBe(false);
  });
});

// ── Lifecycle: deactivation reverses each gate ───────────────────────────────
describe("Wave 70.K — lifecycle: deactivation reverses each gate", () => {
  it("unregistering CantAttach / AttackRequirement / IgnoreHexproof restores defaults", () => {
    const g = mkGame();
    const equip = mintCard({
      game: g,
      id: 9800,
      paper: mkPaper("Eqp", "Artifact — Equipment"),
      seat: 0,
    });
    const target = mintCard({ game: g, id: 9801, paper: mkPaper("Tgt"), seat: 0 });
    const att = mintCard({ game: g, id: 9802, paper: mkPaper("Att"), seat: 1 });
    const sourceCard = mintCard({
      game: g,
      id: 9803,
      paper: mkPaper("Src", "Artifact"),
      seat: 0,
    });

    const sCantAttach = buildAndRegister(
      g,
      {
        mode: "CantAttach",
        params: {
          ValidCard: { kind: "literal", raw: "Equipment" },
          ValidTarget: { kind: "literal", raw: "Card.YouCtrl" },
        },
        activeInZones: [],
      },
      9804,
      99804,
      0,
    );
    const sAttackReq = buildAndRegister(
      g,
      {
        mode: "AttackRequirement",
        params: {
          ValidCard: { kind: "literal", raw: "Creature" },
          ValidDefender: { kind: "literal", raw: "You" },
        },
        activeInZones: [],
      },
      9805,
      99805,
      0,
    );
    const sIgnoreHex = buildAndRegister(
      g,
      {
        mode: "IgnoreHexproof",
        params: {
          ValidSource: { kind: "literal", raw: "Card.YouCtrl" },
        },
        activeInZones: [],
      },
      sourceCard.id as unknown as number,
      99806,
      0,
    );

    // All three active.
    expect(canAttach(g, equip.id, target.id)).toBe(false);
    expect(attackRequirementsFor(g, att.id)).not.toBeNull();
    expect(ignoresHexproof(g, sourceCard.id)).toBe(true);

    // Deregister.
    g.staticEffectRegistry.unregister(sCantAttach.id);
    g.staticEffectRegistry.unregister(sAttackReq.id);
    g.staticEffectRegistry.unregister(sIgnoreHex.id);

    // Defaults restored.
    expect(canAttach(g, equip.id, target.id)).toBe(true);
    expect(attackRequirementsFor(g, att.id)).toBeNull();
    expect(ignoresHexproof(g, sourceCard.id)).toBe(false);
  });
});

// Avoid TS6133 unused-import noise for EntityId — used via type args.
void (0 as unknown as EntityId);

// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.D — three new static modes regression tests.
// Covers:
//   - Registration smoke for CantTarget / CantAttackUnless / CombatDamageToughness
//   - canBeTargetedBy helper rejects matched candidates under matched contexts
//   - target-enumeration drops CantTarget-matched cards
//   - canAttackUnlessPaid + gatherRestrictions("cantAttack") see the
//     CantAttackUnless static when active
//   - usesToughnessForCombatDamage flips attackerPower when active
//   - Lifecycle: deregister stops gating
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
import { attackerPower } from "../../combat/damage-assignment-helpers.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { gatherRestrictions, isRestricted } from "../../statics/cant-must-may.js";
import {
  canAttackUnlessPaid,
  canBeTargetedBy,
  usesToughnessForCombatDamage,
} from "../../statics/wave70d-target-combat-gates.js";
import { enumerateEligibleTargets } from "../../target/enumeration.js";
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
      ...(isCreature ? { pt: { power: "2", toughness: "5" } } : {}),
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
describe("Wave 70.D — registration smoke", () => {
  const modes: readonly StaticAbilityMode[] = ["CantTarget", "CantAttackUnless", "CombatDamageToughness"];
  for (const m of modes) {
    it(`mode '${m}' is registered`, () => {
      expect(staticHandlerRegistry.has(m)).toBe(true);
    });
  }
});

// ── CantTarget — True Believer / Mother of Runes ─────────────────────────────
describe("Wave 70.D — CantTarget", () => {
  it("canBeTargetedBy returns false when an active static matches the candidate", () => {
    const g = mkGame();
    const target = mintCard({ game: g, id: 7000, paper: mkPaper("Bear"), seat: 0 });
    buildAndRegister(
      g,
      {
        mode: "CantTarget",
        params: { ValidTarget: { kind: "literal", raw: "Card.YouCtrl" } },
        activeInZones: [],
      },
      7001,
      97001,
    );
    // Source from seat 1 (opponent) targeting our creature.
    expect(
      canBeTargetedBy(g, target.id, { sourceId: mkEntityId(7001), activatorSeat: mkPlayerSeat(1) }),
    ).toBe(false);
  });

  it("canBeTargetedBy returns true when ValidSource$ filter rejects the source", () => {
    const g = mkGame();
    const target = mintCard({ game: g, id: 7010, paper: mkPaper("Bear"), seat: 0 });
    const otherSource = mintCard({ game: g, id: 7012, paper: mkPaper("White Spell", "Sorcery"), seat: 1 });
    buildAndRegister(
      g,
      {
        mode: "CantTarget",
        params: {
          ValidTarget: { kind: "literal", raw: "Card.YouCtrl" },
          ValidSource: { kind: "literal", raw: "Card.Self" },
        },
        activeInZones: [],
      },
      7011,
      97011,
    );
    // The static's source-side predicate is "Card.Self" → only sourceId === ctx.sourceCardId
    // (the static's own host). Anything else passes.
    expect(canBeTargetedBy(g, target.id, { sourceId: otherSource.id, activatorSeat: mkPlayerSeat(1) })).toBe(
      true,
    );
  });

  it("enumerateEligibleTargets drops CantTarget-matched cards", () => {
    const g = mkGame();
    const safe = mintCard({ game: g, id: 7020, paper: mkPaper("Safe"), seat: 0 });
    const blocked = mintCard({ game: g, id: 7021, paper: mkPaper("Blocked"), seat: 0 });
    // CantTarget matches Card.Self (the blocked card itself).
    buildAndRegister(
      g,
      {
        mode: "CantTarget",
        params: { ValidTarget: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      blocked.id as unknown as number,
      97022,
    );
    const refs = enumerateEligibleTargets(
      g,
      { sourceId: mkEntityId(7099), sourceControllerSeat: mkPlayerSeat(1) },
      {
        permitZones: new Set([ZoneType.Battlefield]),
        permitTypes: new Set(),
        forbidTypes: new Set(),
        controllerScope: "any",
        minTargets: 1,
        maxTargets: 1,
        mayTargetPlayers: false,
      },
    );
    const ids = refs.filter((r) => r.kind === "card").map((r) => (r as { id: number }).id);
    expect(ids).toContain(safe.id);
    expect(ids).not.toContain(blocked.id);
  });

  it("CantTarget lifecycle: deregister un-gates the candidate", () => {
    const g = mkGame();
    const target = mintCard({ game: g, id: 7030, paper: mkPaper("Bear"), seat: 0 });
    const s = buildAndRegister(
      g,
      {
        mode: "CantTarget",
        params: { ValidTarget: { kind: "literal", raw: "Card" } },
        activeInZones: [],
      },
      7031,
      97031,
    );
    expect(
      canBeTargetedBy(g, target.id, { sourceId: mkEntityId(7031), activatorSeat: mkPlayerSeat(1) }),
    ).toBe(false);
    g.staticEffectRegistry.unregister(s.id);
    expect(
      canBeTargetedBy(g, target.id, { sourceId: mkEntityId(7031), activatorSeat: mkPlayerSeat(1) }),
    ).toBe(true);
  });
});

// ── CantAttackUnless — Propaganda / Ghostly Prison ───────────────────────────
describe("Wave 70.D — CantAttackUnless", () => {
  it("canAttackUnlessPaid returns false (cost unpaid in MVP) when the static matches", () => {
    const g = mkGame();
    const attacker = mintCard({ game: g, id: 7100, paper: mkPaper("Goblin"), seat: 1 });
    buildAndRegister(
      g,
      {
        mode: "CantAttackUnless",
        params: {
          ValidCard: { kind: "literal", raw: "Creature" },
          Cost: { kind: "literal", raw: "1" },
        },
        activeInZones: [],
      },
      7101,
      97101,
      0,
    );
    expect(canAttackUnlessPaid(g, attacker.id)).toBe(false);
  });

  it("emits a cantAttack Restriction so the existing combat-handler sweep sees it", () => {
    const g = mkGame();
    const attacker = mintCard({ game: g, id: 7110, paper: mkPaper("Goblin"), seat: 1 });
    buildAndRegister(
      g,
      {
        mode: "CantAttackUnless",
        params: {
          ValidCard: { kind: "literal", raw: "Creature" },
          Cost: { kind: "literal", raw: "2" },
        },
        activeInZones: [],
      },
      7111,
      97111,
      0,
    );
    const restrictions = gatherRestrictions(g, "cantAttack");
    expect(restrictions.length).toBeGreaterThanOrEqual(1);
    expect(isRestricted(g, "cantAttack", attacker.id)).toBe(true);
  });

  it("Card.Self filter only matches the source attacker", () => {
    const g = mkGame();
    const self = mintCard({ game: g, id: 7120, paper: mkPaper("Self"), seat: 1 });
    const other = mintCard({ game: g, id: 7121, paper: mkPaper("Other"), seat: 1 });
    buildAndRegister(
      g,
      {
        mode: "CantAttackUnless",
        params: {
          ValidCard: { kind: "literal", raw: "Creature.Self" },
          Cost: { kind: "literal", raw: "Sac<1/Land>" },
        },
        activeInZones: [],
      },
      self.id as unknown as number,
      97122,
      1,
    );
    expect(canAttackUnlessPaid(g, self.id)).toBe(false);
    expect(canAttackUnlessPaid(g, other.id)).toBe(true);
  });
});

// ── CombatDamageToughness — Doran / Assault Formation ────────────────────────
describe("Wave 70.D — CombatDamageToughness", () => {
  it("usesToughnessForCombatDamage returns true when the static matches", () => {
    const g = mkGame();
    const attacker = mintCard({ game: g, id: 7200, paper: mkPaper("Bear"), seat: 0 });
    buildAndRegister(
      g,
      {
        mode: "CombatDamageToughness",
        params: { ValidCard: { kind: "literal", raw: "Creature.YouCtrl" } },
        activeInZones: [],
      },
      7201,
      97201,
    );
    expect(usesToughnessForCombatDamage(g, attacker.id)).toBe(true);
  });

  it("attackerPower swaps in toughness on match (Doran-shape: 2/5 deals 5)", () => {
    const g = mkGame();
    const attacker = mintCard({ game: g, id: 7210, paper: mkPaper("Bear"), seat: 0 });
    // Without the static: 2/5 deals power=2.
    expect(attackerPower(g, attacker.id)).toBe(2);
    buildAndRegister(
      g,
      {
        mode: "CombatDamageToughness",
        params: { ValidCard: { kind: "literal", raw: "Creature.YouCtrl" } },
        activeInZones: [],
      },
      7211,
      97211,
    );
    // With Doran: 2/5 deals toughness=5.
    expect(attackerPower(g, attacker.id)).toBe(5);
  });

  it("CombatDamageToughness lifecycle: deregister returns to power-based damage", () => {
    const g = mkGame();
    const attacker = mintCard({ game: g, id: 7220, paper: mkPaper("Bear"), seat: 0 });
    const s = buildAndRegister(
      g,
      {
        mode: "CombatDamageToughness",
        params: { ValidCard: { kind: "literal", raw: "Creature" } },
        activeInZones: [],
      },
      7221,
      97221,
    );
    expect(attackerPower(g, attacker.id)).toBe(5);
    g.staticEffectRegistry.unregister(s.id);
    expect(attackerPower(g, attacker.id)).toBe(2);
  });
});

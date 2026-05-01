// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 112 — cross-module TODO(advanced) sweep round 17 regression tests.
//
// Picks closed (one assertion bundle per pick):
//   1. static/handlers/assign-combat-damage-as-unblocked-static.ts —
//      `Optional$ True` + `CombatDamage$ N` parsed onto payload, surfaced
//      via the new `asUnblockedRoutingFor` helper.
//   2. static/handlers/can-adapt-static.ts — `ValidSA$ Spell` (and other
//      SA-kind classifiers) honored via `saKindMatches`. Permissive
//      (back-compat) when the slot is omitted or the consumer doesn't
//      thread an SA kind through.
//   3. static/handlers/can-attack-if-haste-static.ts — `Cost$ <Forge cost
//      string>` parsed onto payload as `costText` for the future
//      cost-payment dialog.
//   4. static/handlers/cant-attack-unless-static.ts — payment ledger:
//      `recordCantAttackUnlessPayment` stamps `unlessPaymentsByStaticId`,
//      `canAttackUnlessPaid` consults it and returns true when paid.
//   5. static/handlers/cant-block-unless-static.ts — Attacker$ filter
//      applied at the `isBlockingRestricted` validation site; payment
//      ledger consulted via `recordCantBlockUnlessPayment`.
//   6. static/handlers/must-block-static.ts — multi-target
//      "must-block-one-of" via `attackerCandidates(game)` enumerating all
//      battlefield ids matching Attacker$.
//   7. static/handlers/optional-attack-cost-static.ts — `recordPayment` /
//      `hasPaid` payload hooks for the future cost-payment dialog.
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
import type { AssignCombatDamageAsUnblockedPayload } from "./static/handlers/assign-combat-damage-as-unblocked-static.js";
import type { CanAdaptPayload } from "./static/handlers/can-adapt-static.js";
import type { CanAttackIfHastePayload } from "./static/handlers/can-attack-if-haste-static.js";
import type { MustBlockPayload } from "./static/handlers/must-block-static.js";
import type { OptionalAttackCostPayload } from "./static/handlers/optional-attack-cost-static.js";
import { staticHandlerRegistry } from "./static/static-handler.js";
import { isBlockingRestricted, recordCantBlockUnlessPayment } from "./statics/cant-must-may-extras.js";
import type { Restriction } from "./statics/cant-must-may.js";
import { canAttackUnlessPaid, recordCantAttackUnlessPayment } from "./statics/wave70d-target-combat-gates.js";
import { asUnblockedRoutingFor } from "./statics/wave70f-combat-gates.js";
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
  seed: "wave112",
};

const mkGame = (): Game => {
  const game = new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(0xfacefeed12n),
  });
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

// ── Pick 1: AssignCombatDamageAsUnblocked Optional$ + CombatDamage$ ─────────
describe("Wave 112 — Pick 1: AssignCombatDamageAsUnblocked Optional$ + CombatDamage$", () => {
  it("`Optional$ True` parses onto payload as optional=true; default is mandatory", () => {
    const g = mkGame();
    const a = mintCard({ game: g, id: 1100, paper: mkPaper("Optional1") });
    const sOpt = buildAndRegister(
      g,
      {
        mode: "AssignCombatDamageAsUnblocked",
        params: {
          ValidCard: { kind: "literal", raw: "Card.Self" },
          Optional: { kind: "literal", raw: "True" },
        },
        activeInZones: [],
      },
      a.id as unknown as number,
      11100,
    );
    const pOpt = sOpt.describe() as AssignCombatDamageAsUnblockedPayload;
    expect(pOpt.optional).toBe(true);

    const b = mintCard({ game: g, id: 1101, paper: mkPaper("Optional2") });
    const sMand = buildAndRegister(
      g,
      {
        mode: "AssignCombatDamageAsUnblocked",
        params: {
          ValidCard: { kind: "literal", raw: "Card.Self" },
        },
        activeInZones: [],
      },
      b.id as unknown as number,
      11101,
    );
    const pMand = sMand.describe() as AssignCombatDamageAsUnblockedPayload;
    expect(pMand.optional).toBe(false);
  });

  it("`CombatDamage$ N` parses to numeric override; non-numeric falls back to undefined", () => {
    const g = mkGame();
    const a = mintCard({ game: g, id: 1200, paper: mkPaper("DmgOverride") });
    const sN = buildAndRegister(
      g,
      {
        mode: "AssignCombatDamageAsUnblocked",
        params: {
          ValidCard: { kind: "literal", raw: "Card.Self" },
          CombatDamage: { kind: "literal", raw: "3" },
        },
        activeInZones: [],
      },
      a.id as unknown as number,
      11200,
    );
    const pN = sN.describe() as AssignCombatDamageAsUnblockedPayload;
    expect(pN.combatDamageOverride).toBe(3);

    // Non-numeric → undefined.
    const b = mintCard({ game: g, id: 1201, paper: mkPaper("DmgOverride2") });
    const sX = buildAndRegister(
      g,
      {
        mode: "AssignCombatDamageAsUnblocked",
        params: {
          ValidCard: { kind: "literal", raw: "Card.Self" },
          CombatDamage: { kind: "literal", raw: "X" },
        },
        activeInZones: [],
      },
      b.id as unknown as number,
      11201,
    );
    const pX = sX.describe() as AssignCombatDamageAsUnblockedPayload;
    expect(pX.combatDamageOverride).toBeUndefined();
  });

  it("`asUnblockedRoutingFor` exposes the payload metadata for matched attacker", () => {
    const g = mkGame();
    const a = mintCard({ game: g, id: 1300, paper: mkPaper("RouteCard") });
    buildAndRegister(
      g,
      {
        mode: "AssignCombatDamageAsUnblocked",
        params: {
          ValidCard: { kind: "literal", raw: "Card.Self" },
          Optional: { kind: "literal", raw: "True" },
          CombatDamage: { kind: "literal", raw: "5" },
        },
        activeInZones: [],
      },
      a.id as unknown as number,
      11300,
    );
    const route = asUnblockedRoutingFor(g, a.id);
    expect(route).not.toBeNull();
    expect(route?.optional).toBe(true);
    expect(route?.combatDamageOverride).toBe(5);
    // Unmatched id → null.
    expect(asUnblockedRoutingFor(g, mkEntityId(99999))).toBeNull();
  });
});

// ── Pick 2: CanAdapt ValidSA$ classifier ────────────────────────────────────
describe("Wave 112 — Pick 2: CanAdapt `ValidSA$` SA-kind classifier", () => {
  it("`ValidSA$ Spell` matches `saKind` 'Spell'; rejects 'Activated'", () => {
    const g = mkGame();
    const s = buildAndRegister(
      g,
      {
        mode: "CanAdapt",
        params: {
          ValidCard: { kind: "literal", raw: "Card.IsRemembered" },
          ValidSA: { kind: "literal", raw: "Spell" },
        },
        activeInZones: [],
      },
      2100,
      12100,
    );
    const p = s.describe() as CanAdaptPayload;
    expect(p.saKindMatches("Spell")).toBe(true);
    expect(p.saKindMatches("Activated")).toBe(false);
  });

  it("Permissive when ValidSA$ is omitted (matches any SA kind, including undefined)", () => {
    const g = mkGame();
    const s = buildAndRegister(
      g,
      {
        mode: "CanAdapt",
        params: {
          ValidCard: { kind: "literal", raw: "Card.IsRemembered" },
        },
        activeInZones: [],
      },
      2200,
      12200,
    );
    const p = s.describe() as CanAdaptPayload;
    expect(p.saKindMatches("Spell")).toBe(true);
    expect(p.saKindMatches("Activated")).toBe(true);
    expect(p.saKindMatches(undefined)).toBe(true);
  });

  it("Permissive when consumer doesn't thread SA kind through (back-compat)", () => {
    const g = mkGame();
    const s = buildAndRegister(
      g,
      {
        mode: "CanAdapt",
        params: {
          ValidCard: { kind: "literal", raw: "Card.IsRemembered" },
          ValidSA: { kind: "literal", raw: "Spell" },
        },
        activeInZones: [],
      },
      2300,
      12300,
    );
    const p = s.describe() as CanAdaptPayload;
    // saKind === undefined → permissive (no kind to filter on).
    expect(p.saKindMatches(undefined)).toBe(true);
  });
});

// ── Pick 3: CanAttackIfHaste Cost$ ──────────────────────────────────────────
describe("Wave 112 — Pick 3: CanAttackIfHaste `Cost$` surface", () => {
  it("`Cost$ Exert<1/CARDNAME>` parses onto payload as costText", () => {
    const g = mkGame();
    const s = buildAndRegister(
      g,
      {
        mode: "CanAttackIfHaste",
        params: {
          ValidCard: { kind: "literal", raw: "Card.Self" },
          Cost: { kind: "literal", raw: "Exert<1/CARDNAME>" },
        },
        activeInZones: [],
      },
      3100,
      13100,
    );
    const p = s.describe() as CanAttackIfHastePayload;
    expect(p.costText).toBe("Exert<1/CARDNAME>");
  });

  it("Cost$ undefined when omitted (free-of-charge canonical haste)", () => {
    const g = mkGame();
    const s = buildAndRegister(
      g,
      {
        mode: "CanAttackIfHaste",
        params: {
          ValidCard: { kind: "literal", raw: "Card.Self" },
        },
        activeInZones: [],
      },
      3200,
      13200,
    );
    const p = s.describe() as CanAttackIfHastePayload;
    expect(p.costText).toBeUndefined();
  });
});

// ── Pick 4: CantAttackUnless payment ledger ─────────────────────────────────
describe("Wave 112 — Pick 4: CantAttackUnless payment ledger", () => {
  it("`canAttackUnlessPaid` returns false when ledger empty (cost unpaid)", () => {
    const g = mkGame();
    const attacker = mintCard({ game: g, id: 4100, paper: mkPaper("Attacker"), seat: 1 });
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
      4101,
      14101,
    );
    expect(canAttackUnlessPaid(g, attacker.id)).toBe(false);
  });

  it("`recordCantAttackUnlessPayment` stamps ledger; gate flips to true", () => {
    const g = mkGame();
    const attacker = mintCard({ game: g, id: 4200, paper: mkPaper("Attacker2"), seat: 1 });
    const s = buildAndRegister(
      g,
      {
        mode: "CantAttackUnless",
        params: {
          ValidCard: { kind: "literal", raw: "Creature" },
          Cost: { kind: "literal", raw: "1" },
        },
        activeInZones: [],
      },
      4201,
      14201,
    );
    expect(canAttackUnlessPaid(g, attacker.id)).toBe(false);
    recordCantAttackUnlessPayment(g, s.id, attacker.id);
    expect(canAttackUnlessPaid(g, attacker.id)).toBe(true);
    // Different attacker id is unaffected by THIS attacker's payment, but
    // since the static's ValidCard$ is "Creature" and the unmatched id
    // has no Card record, the cardPred fails → gate doesn't apply → the
    // unmatched attacker may attack (gate returns true for "may attack").
    expect(canAttackUnlessPaid(g, mkEntityId(9999))).toBe(true);
    // Add a SECOND attacker that DOES match the gate, but hasn't paid;
    // the ledger entry for `attacker.id` doesn't help it.
    const attacker2 = mintCard({ game: g, id: 4250, paper: mkPaper("Atkr3"), seat: 1 });
    expect(canAttackUnlessPaid(g, attacker2.id)).toBe(false);
  });
});

// ── Pick 5: CantBlockUnless Attacker$ + payment ledger ──────────────────────
describe("Wave 112 — Pick 5: CantBlockUnless Attacker$ filter + payment ledger", () => {
  it("Attacker$ filter narrows the gate: blocker may block non-matching attacker freely", () => {
    const g = mkGame();
    const blocker = mintCard({ game: g, id: 5100, paper: mkPaper("Blocker"), seat: 0 });
    // The "matched attacker" is Card.Self of the static (sourceCardId 5101).
    const blockedAttacker = mintCard({
      game: g,
      id: 5101,
      paper: mkPaper("BlockedAttacker"),
      seat: 1,
    });
    // Other attacker not matched by Attacker$ Card.Self.
    const otherAttacker = mintCard({
      game: g,
      id: 5102,
      paper: mkPaper("OtherAttacker"),
      seat: 1,
    });
    buildAndRegister(
      g,
      {
        mode: "CantBlockUnless",
        params: {
          ValidCard: { kind: "literal", raw: "Creature" },
          Attacker: { kind: "literal", raw: "Card.Self" },
          Cost: { kind: "literal", raw: "1" },
        },
        activeInZones: [],
      },
      blockedAttacker.id as unknown as number,
      15100,
    );
    // Blocking the matched attacker → restricted (cost unpaid).
    expect(isBlockingRestricted(g, blockedAttacker.id, blocker.id)).toBe(true);
    // Blocking a different attacker → NOT restricted (Attacker$ doesn't match).
    expect(isBlockingRestricted(g, otherAttacker.id, blocker.id)).toBe(false);
  });

  it("Payment ledger short-circuits the gate", () => {
    const g = mkGame();
    const blocker = mintCard({ game: g, id: 5200, paper: mkPaper("Blocker2"), seat: 0 });
    const attacker = mintCard({ game: g, id: 5201, paper: mkPaper("Atkr2"), seat: 1 });
    const s = buildAndRegister(
      g,
      {
        mode: "CantBlockUnless",
        params: {
          ValidCard: { kind: "literal", raw: "Creature" },
          Cost: { kind: "literal", raw: "1" },
        },
        activeInZones: [],
      },
      5202,
      15200,
    );
    // Initially gated.
    expect(isBlockingRestricted(g, attacker.id, blocker.id)).toBe(true);
    // After payment, gate releases for THIS blocker.
    recordCantBlockUnlessPayment(g, s.id, blocker.id);
    expect(isBlockingRestricted(g, attacker.id, blocker.id)).toBe(false);
  });
});

// ── Pick 6: MustBlock multi-target attacker enumeration ─────────────────────
describe("Wave 112 — Pick 6: MustBlock multi-target attackerCandidates", () => {
  it("`attackerCandidates` enumerates all battlefield ids matching Attacker$ filter", () => {
    const g = mkGame();
    // Two creature attackers under opponent (seat 1).
    const opp1 = mintCard({ game: g, id: 6100, paper: mkPaper("Opp1"), seat: 1 });
    const opp2 = mintCard({ game: g, id: 6101, paper: mkPaper("Opp2"), seat: 1 });
    // One creature under controller (seat 0) — should NOT match
    // Creature.OppCtrl filter.
    mintCard({ game: g, id: 6102, paper: mkPaper("Mine"), seat: 0 });
    const s = buildAndRegister(
      g,
      {
        mode: "MustBlock",
        params: {
          ValidCreature: { kind: "literal", raw: "Creature.YouCtrl" },
          Attacker: { kind: "literal", raw: "Creature.OppCtrl" },
        },
        activeInZones: [],
      },
      6200,
      16200,
    );
    const r = s.describe() as Restriction;
    const p = r.payload as MustBlockPayload;
    const candidates = p.attackerCandidates(g);
    expect(candidates).toEqual(expect.arrayContaining([opp1.id, opp2.id]));
    expect(candidates).not.toContain(mkEntityId(6102));
  });

  it("Omitted Attacker$ → `attackerCandidates` returns the full card roster (any-attacker shape)", () => {
    const g = mkGame();
    const c1 = mintCard({ game: g, id: 6300, paper: mkPaper("C1"), seat: 1 });
    const c2 = mintCard({ game: g, id: 6301, paper: mkPaper("C2"), seat: 0 });
    const s = buildAndRegister(
      g,
      {
        mode: "MustBlock",
        params: {
          ValidCreature: { kind: "literal", raw: "Creature.YouCtrl" },
        },
        activeInZones: [],
      },
      6400,
      16400,
    );
    const r = s.describe() as Restriction;
    const p = r.payload as MustBlockPayload;
    const candidates = p.attackerCandidates(g);
    expect(candidates).toEqual(expect.arrayContaining([c1.id, c2.id]));
  });
});

// ── Pick 7: OptionalAttackCost recordPayment / hasPaid ──────────────────────
describe("Wave 112 — Pick 7: OptionalAttackCost payment hooks", () => {
  it("`hasPaid` is initially false; flips to true after `recordPayment`", () => {
    const g = mkGame();
    const attacker = mintCard({ game: g, id: 7100, paper: mkPaper("ExertCard") });
    const s = buildAndRegister(
      g,
      {
        mode: "OptionalAttackCost",
        params: {
          ValidCard: { kind: "literal", raw: "Card.Self" },
          Cost: { kind: "literal", raw: "Exert<1/CARDNAME>" },
        },
        activeInZones: [],
      },
      attacker.id as unknown as number,
      17100,
    );
    const r = s.describe() as Restriction;
    const p = r.payload as OptionalAttackCostPayload;
    expect(p.hasPaid(g, attacker.id)).toBe(false);
    p.recordPayment(g, attacker.id);
    expect(p.hasPaid(g, attacker.id)).toBe(true);
    // Different attacker is unaffected.
    expect(p.hasPaid(g, mkEntityId(99999))).toBe(false);
  });

  it("`triggerSVarsAll` carries the multi-trigger key list (Wave 107 closure preserved)", () => {
    const g = mkGame();
    const attacker = mintCard({ game: g, id: 7200, paper: mkPaper("ExertCard2") });
    const s = buildAndRegister(
      g,
      {
        mode: "OptionalAttackCost",
        params: {
          ValidCard: { kind: "literal", raw: "Card.Self" },
          Cost: { kind: "literal", raw: "Exert<1/CARDNAME>" },
          Trigger: { kind: "literal", raw: "TrigA & TrigB" },
        },
        activeInZones: [],
      },
      attacker.id as unknown as number,
      17200,
    );
    const r = s.describe() as Restriction;
    const p = r.payload as OptionalAttackCostPayload;
    expect(p.triggerSVarsAll).toEqual(["TrigA", "TrigB"]);
    expect(p.triggerSVar).toBe("TrigA");
  });
});

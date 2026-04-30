// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.G — three more registry-walk gate statics regression tests.
// Covers:
//   - Registration smoke for CanAttackIfHaste / MustBlock / AttackVigilance
//   - CanAttackIfHaste: helper returns true for matched (attacker, defender)
//   - MustBlock: declareBlockers auto-correct pulls in must-block subjects
//   - AttackVigilance: helper returns true for matched attacker
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
  attacksWithVigilance,
  canAttackAsIfHaste,
  collectMustBlockSubjects,
} from "../../statics/wave70g-combat-gates.js";
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
describe("Wave 70.G — registration smoke", () => {
  const modes: readonly StaticAbilityMode[] = ["CanAttackIfHaste", "MustBlock", "AttackVigilance"];
  for (const m of modes) {
    it(`mode '${m}' is registered`, () => {
      expect(staticHandlerRegistry.has(m)).toBe(true);
    });
  }
});

// ── CanAttackIfHaste — Glorybringer / Frenzied Saddlebrute analogues ────────
describe("Wave 70.G — CanAttackIfHaste", () => {
  it("matched attacker + matched defender → helper returns true", () => {
    const g = mkGame();
    const seat1 = mkPlayerSeat(1);
    // Instill Energy-shape: enchanted creature can attack as if it had haste.
    // ValidCard$ Card.Self stamped on the matched attacker.
    const attacker = mintCard({ game: g, id: 7500, paper: mkPaper("Glorybringer"), seat: 0 });
    buildAndRegister(
      g,
      {
        mode: "CanAttackIfHaste",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      attacker.id as unknown as number,
      97500,
    );
    expect(canAttackAsIfHaste(g, attacker.id, { kind: "player", seat: seat1 })).toBe(true);
    // Unmatched attacker: gate is false.
    expect(canAttackAsIfHaste(g, mkEntityId(99999), { kind: "player", seat: seat1 })).toBe(false);
  });

  it("ValidTarget$ Opponent — only matches when defender is opponent", () => {
    const g = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const attacker = mintCard({ game: g, id: 7510, paper: mkPaper("Frenzied Saddlebrute"), seat: 0 });
    // Frenzied Saddlebrute-shape: ValidTarget$ Opponent → only defenders
    // who are opponents of the static's controller open the gate.
    buildAndRegister(
      g,
      {
        mode: "CanAttackIfHaste",
        params: {
          ValidCard: { kind: "literal", raw: "Card.Self" },
          ValidTarget: { kind: "literal", raw: "Opponent" },
        },
        activeInZones: [],
      },
      attacker.id as unknown as number,
      97510,
      0,
    );
    // Defender = seat1 (opponent of seat0) → match.
    expect(canAttackAsIfHaste(g, attacker.id, { kind: "player", seat: seat1 })).toBe(true);
    // Defender = seat0 (the controller themselves) → no match.
    expect(canAttackAsIfHaste(g, attacker.id, { kind: "player", seat: seat0 })).toBe(false);
  });
});

// ── MustBlock — Provoke / Brutal Hordechief analogues ───────────────────────
describe("Wave 70.G — MustBlock", () => {
  it("smoke: subject collected from registry", () => {
    const g = mkGame();
    const blocker = mintCard({ game: g, id: 7600, paper: mkPaper("Grizzly Bear"), seat: 1 });
    // Provoke-shape: ValidCreature$ Card.Self → matched creature must block.
    buildAndRegister(
      g,
      {
        mode: "MustBlock",
        params: { ValidCreature: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      blocker.id as unknown as number,
      97600,
      1,
    );
    const subjects = collectMustBlockSubjects(g);
    expect(subjects).toHaveLength(1);
    expect(subjects[0]?.blockerId).toBe(blocker.id);
    expect(subjects[0]?.mustBlockAttackerId).toBeUndefined();
  });

  it("declareBlockers auto-pulls must-block subject (Provoke-shape)", () => {
    const g = mkGame();
    const seat1 = mkPlayerSeat(1);
    // Attacker (seat 0) and a blocker (seat 1) on the battlefield. No
    // explicit block declared — but a Provoke-shape MustBlock static
    // matches the blocker, so the auto-correct pulls it in.
    const attacker = mintCard({ game: g, id: 7610, paper: mkPaper("Hill Giant"), seat: 0 });
    const blocker = mintCard({ game: g, id: 7611, paper: mkPaper("Grizzly Bear"), seat: 1 });
    buildAndRegister(
      g,
      {
        mode: "MustBlock",
        params: { ValidCreature: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      blocker.id as unknown as number,
      97611,
      1,
    );

    const handler = new CombatHandler(g);
    handler.declareAttackers([{ attackerId: attacker.id, defender: { kind: "player", seat: seat1 } }]);
    // Caller declares NO blockers. The auto-correct is responsible.
    handler.declareBlockers([]);
    // Verify the auto-correct pulled in the must-block creature.
    const blockerInfo = handler.state.blockers.get(blocker.id);
    expect(blockerInfo).toBeDefined();
    expect(blockerInfo?.attackerIds).toEqual([attacker.id]);
  });

  it("decayed creature is NOT pulled in (canBlock gate respected)", () => {
    const g = mkGame();
    const seat1 = mkPlayerSeat(1);
    const attacker = mintCard({ game: g, id: 7620, paper: mkPaper("Hill Giant"), seat: 0 });
    const blocker = mintCard({ game: g, id: 7621, paper: mkPaper("Decayed Zombie"), seat: 1 });
    blocker.decayed = true;
    buildAndRegister(
      g,
      {
        mode: "MustBlock",
        params: { ValidCreature: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      blocker.id as unknown as number,
      97621,
      1,
    );
    const handler = new CombatHandler(g);
    handler.declareAttackers([{ attackerId: attacker.id, defender: { kind: "player", seat: seat1 } }]);
    handler.declareBlockers([]);
    // Decayed creature must NOT be pulled in despite the must-block static.
    expect(handler.state.blockers.has(blocker.id)).toBe(false);
  });
});

// ── AttackVigilance — Archangel of Tithes / Heat Wave analogues ─────────────
describe("Wave 70.G — AttackVigilance", () => {
  it("smoke + helper returns true for matched attacker", () => {
    const g = mkGame();
    const attacker = mintCard({ game: g, id: 7700, paper: mkPaper("Archangel of Tithes"), seat: 0 });
    buildAndRegister(
      g,
      {
        mode: "AttackVigilance",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      attacker.id as unknown as number,
      97700,
    );
    expect(attacksWithVigilance(g, attacker.id)).toBe(true);
    // Unmatched id: gate is false.
    expect(attacksWithVigilance(g, mkEntityId(99999))).toBe(false);
  });

  it("filter ValidCard$ Creature.YouCtrl scopes to matching controller", () => {
    const g = mkGame();
    const myCreature = mintCard({ game: g, id: 7710, paper: mkPaper("My Bear"), seat: 0 });
    const oppCreature = mintCard({ game: g, id: 7711, paper: mkPaper("Their Bear"), seat: 1 });
    // Controller seat = 0; ValidCard$ Creature.YouCtrl → only my creatures.
    buildAndRegister(
      g,
      {
        mode: "AttackVigilance",
        params: { ValidCard: { kind: "literal", raw: "Creature.YouCtrl" } },
        activeInZones: [],
      },
      7710,
      97710,
      0,
    );
    expect(attacksWithVigilance(g, myCreature.id)).toBe(true);
    expect(attacksWithVigilance(g, oppCreature.id)).toBe(false);
  });
});

// ── Lifecycle: deactivation reverses each gate ──────────────────────────────
describe("Wave 70.G — lifecycle: deactivation reverses each gate", () => {
  it("unregistering each Wave 70.G static restores normal behavior", () => {
    const g = mkGame();
    const seat1 = mkPlayerSeat(1);
    const attacker = mintCard({ game: g, id: 7800, paper: mkPaper("Glorybringer"), seat: 0 });
    const blocker = mintCard({ game: g, id: 7801, paper: mkPaper("Grizzly Bear"), seat: 1 });
    const vigilanceAtt = mintCard({ game: g, id: 7802, paper: mkPaper("Archangel of Tithes"), seat: 0 });

    const sHaste = buildAndRegister(
      g,
      {
        mode: "CanAttackIfHaste",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      attacker.id as unknown as number,
      97800,
    );
    const sMustBlock = buildAndRegister(
      g,
      {
        mode: "MustBlock",
        params: { ValidCreature: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      blocker.id as unknown as number,
      97801,
      1,
    );
    const sVigilance = buildAndRegister(
      g,
      {
        mode: "AttackVigilance",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      vigilanceAtt.id as unknown as number,
      97802,
    );

    expect(canAttackAsIfHaste(g, attacker.id, { kind: "player", seat: seat1 })).toBe(true);
    expect(collectMustBlockSubjects(g)).toHaveLength(1);
    expect(attacksWithVigilance(g, vigilanceAtt.id)).toBe(true);

    g.staticEffectRegistry.unregister(sHaste.id);
    g.staticEffectRegistry.unregister(sMustBlock.id);
    g.staticEffectRegistry.unregister(sVigilance.id);

    expect(canAttackAsIfHaste(g, attacker.id, { kind: "player", seat: seat1 })).toBe(false);
    expect(collectMustBlockSubjects(g)).toHaveLength(0);
    expect(attacksWithVigilance(g, vigilanceAtt.id)).toBe(false);
    // Silence unused-import warnings — the helpers are also exercised by
    // the per-mode test groups above.
    void canAttackAsIfHaste;
    void attacksWithVigilance;
  });
});

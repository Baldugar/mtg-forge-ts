// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 105 — cross-module TODO(advanced) sweep round 10 regression tests.
//
// Picks closed (one assertion bundle per pick):
//   1. cost/parts/cost-mana.ts (Adamant) — Adamant tracking IS wired:
//      after a cast where ≥3 pips of one chromatic color were spent,
//      `card.adamantColor` carries that color; ≤2 pips leaves the slot
//      undefined; colorless / Phyrexian pips don't count. The
//      svar/selectors/conditions.ts (`evalAdamant`) reads the slot and
//      flips Count$Adamant to true.
//   2. player.ts (effectiveStartingHandSize) — game-start integration
//      helper. Layers `startingHandSizeMod` onto the rules-default
//      starting hand size with a 0 floor; multiple statics stack
//      additively; negative cap reduces to 0 not to a negative number.
//   3. svar/selectors/conditions.ts (evalHeroic) — trigger-aware:
//      when the SvarContext carries a `triggerContext.objects` list,
//      Heroic fires only when the source card is among the targets;
//      without trigger context the legacy "always true" contract holds.
//   4. static/handlers/cant-sacrifice-static.ts +
//      statics/wave60-cant-gates.ts — CantSacrificeBy$ carve-out is
//      wired. Sigarda-shape: own-side sacrifice is allowed; opponent-
//      side sacrifice is blocked. Without `byPlayer` the gate fires
//      uniformly (back-compat).
//   5. statics/wave70d-target-combat-gates.ts (canAttackUnlessPaid) —
//      Target$ filter narrows the defender side. Propaganda-shape:
//      cost only applies to attacks targeting the static's controller
//      (`Target$ You`); attacks against an opponent's planeswalker
//      bypass the gate.
//   6. combat/keywords/block-restrictions.ts +
//      static/handlers/min-max-blocker.ts — MinMaxBlocker enforcement
//      is wired in validateBlockDeclarations. Tromokratis-shape: ≥3
//      blockers required when ≥1 declared; 0 blockers (unblocked) is
//      legal per the "if able" gate; > max rejects.
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
  CardType,
  Color,
  ColorSet,
  DEFAULT_PAPER_CARD_FLAGS,
  ManaProduced,
  SeededRng,
  ZoneType,
  emptyCharacteristics,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "./card.js";
import { validateBlockDeclarations } from "./combat/keywords/block-restrictions.js";
import { CostMana } from "./cost/parts/cost-mana.js";
import type { CostPaymentContext } from "./cost/parts/cost-part.js";
import type { GameMeta } from "./game-meta.js";
import type { GameRules } from "./game-rules.js";
import { Game } from "./game.js";
import { ManaPool } from "./mana/mana-pool.js";
import { effectiveStartingHandSize } from "./player.js";
import { staticHandlerRegistry } from "./static/static-handler.js";
import { canBeSacrificed } from "./statics/wave60-cant-gates.js";
import { canAttackUnlessPaid } from "./statics/wave70d-target-combat-gates.js";
import { Battlefield } from "./zone/zones/battlefield.js";
import { Graveyard } from "./zone/zones/graveyard.js";
import { Hand } from "./zone/zones/hand.js";
import { Library } from "./zone/zones/library.js";
import "./static/handlers/index.js";
import type { SvarContext } from "./svar/context.js";
import { evaluateExpression } from "./svar/evaluator.js";

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
  seed: "wave105",
};

const seat0 = mkPlayerSeat(0);
const seat1 = mkPlayerSeat(1);

const mkGame = (): Game =>
  new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(0xfacefeed05n) });

const grizzlyBears: PaperCard = {
  name: "Grizzly Bears",
  edition: "LEA",
  collectorNumber: "195",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const seedZones = (game: Game): void => {
  for (const player of game.players) {
    if (!player.zones.has(ZoneType.Library))
      player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    if (!player.zones.has(ZoneType.Hand))
      player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    if (!player.zones.has(ZoneType.Graveyard))
      player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    if (!player.zones.has(ZoneType.Battlefield))
      player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
};

const seedCard = (
  game: Game,
  id: number,
  seat: PlayerSeat = seat0,
  zone: ZoneType = ZoneType.Battlefield,
): Card => {
  const eid = mkEntityId(id);
  const card = new Card(eid, grizzlyBears, seat, seat, zone);
  game.cards.set(eid, card);
  const z = game.getPlayer(seat).zones.get(zone);
  if (z) z.add(eid);
  return card;
};

const buildAndRegisterStatic = (
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

// Drive a generator to completion.
function driveGenerator<T>(gen: Generator<unknown, T, unknown>, responses: unknown[] = []): T {
  let result = gen.next();
  while (!result.done) {
    const resp = responses.shift();
    result = gen.next(resp);
  }
  return result.value;
}

// ── Pick 1: Adamant color tracking via CostMana.pay ──────────────────────────
describe("Wave 105 — Adamant tracking via cost-mana", () => {
  it("stamps card.adamantColor when ≥3 pips of one chromatic color are spent", () => {
    const game = mkGame();
    seedZones(game);
    const card = seedCard(game, 7000, seat0, ZoneType.Hand);
    const player = game.getPlayer(seat0);
    const pool = new ManaPool();
    pool.add(ManaProduced.colored(Color.Red, { sourceId: mkEntityId(99) }));
    pool.add(ManaProduced.colored(Color.Red, { sourceId: mkEntityId(99) }));
    pool.add(ManaProduced.colored(Color.Red, { sourceId: mkEntityId(99) }));
    player.manaPool = pool;
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat0,
      sourceCardId: card.id,
      raw: "RRR",
    };
    expect(card.adamantColor).toBeUndefined();
    driveGenerator(CostMana.pay(ctx));
    expect(card.adamantColor).toBe(Color.Red);
  });

  it("does NOT stamp when only 2 pips of one color were spent", () => {
    const game = mkGame();
    seedZones(game);
    const card = seedCard(game, 7010, seat0, ZoneType.Hand);
    const player = game.getPlayer(seat0);
    const pool = new ManaPool();
    pool.add(ManaProduced.colored(Color.Red, { sourceId: mkEntityId(99) }));
    pool.add(ManaProduced.colored(Color.Red, { sourceId: mkEntityId(99) }));
    pool.add(ManaProduced.colored(Color.Green, { sourceId: mkEntityId(99) }));
    player.manaPool = pool;
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat0,
      sourceCardId: card.id,
      raw: "RRG",
    };
    driveGenerator(CostMana.pay(ctx));
    expect(card.adamantColor).toBeUndefined();
  });

  it("colorless pips do not satisfy Adamant (3 generic ≠ 3 of one color)", () => {
    const game = mkGame();
    seedZones(game);
    const card = seedCard(game, 7020, seat0, ZoneType.Hand);
    const player = game.getPlayer(seat0);
    const pool = new ManaPool();
    // Three colorless mana satisfies a "3" cost, but it isn't chromatic.
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colorless());
    player.manaPool = pool;
    const ctx: CostPaymentContext = {
      game,
      payerSeat: seat0,
      sourceCardId: card.id,
      raw: "3",
    };
    driveGenerator(CostMana.pay(ctx));
    expect(card.adamantColor).toBeUndefined();
  });
});

// ── Pick 2: effectiveStartingHandSize layers per-seat mod ────────────────────
describe("Wave 105 — effectiveStartingHandSize", () => {
  it("returns the base when no mod is stamped", () => {
    const game = mkGame();
    const player = game.getPlayer(seat0);
    expect(effectiveStartingHandSize(player, 7)).toBe(7);
  });

  it("layers a positive mod additively", () => {
    const game = mkGame();
    const player = game.getPlayer(seat0);
    player.startingHandSizeMod = 3;
    expect(effectiveStartingHandSize(player, 7)).toBe(10);
  });

  it("layers a negative mod additively", () => {
    const game = mkGame();
    const player = game.getPlayer(seat0);
    player.startingHandSizeMod = -2;
    expect(effectiveStartingHandSize(player, 7)).toBe(5);
  });

  it("floors at 0 when the mod would reduce below zero (Yawgmoth's-Bargain shape)", () => {
    const game = mkGame();
    const player = game.getPlayer(seat0);
    player.startingHandSizeMod = -10;
    expect(effectiveStartingHandSize(player, 7)).toBe(0);
  });

  it("composes with multiple stamps (statics stack additively)", () => {
    const game = mkGame();
    const player = game.getPlayer(seat0);
    // Simulate two activate calls each adding 1.
    player.startingHandSizeMod = 0;
    player.startingHandSizeMod += 1;
    player.startingHandSizeMod += 1;
    expect(effectiveStartingHandSize(player, 7)).toBe(9);
  });
});

// ── Pick 3: Heroic refines via triggerContext ────────────────────────────────
describe("Wave 105 — Count$Heroic refines via triggerContext.objects", () => {
  // Build the SVar Count expression: kind="Count", args[0].raw="Heroic.0.5".
  // The Wave 51 ternary dispatcher reads args[0].raw and parses
  // <Flag>.<elseValue>.<thenValue>.
  const mkHeroicTernary = () =>
    ({
      kind: "Count",
      args: [{ kind: "raw", raw: "Heroic.0.5" }],
      raw: "Count$Heroic.0.5",
    }) as const;

  it("returns thenValue when no triggerContext.objects is supplied (legacy)", () => {
    const game = mkGame();
    seedZones(game);
    const card = seedCard(game, 7100);
    const ctx: SvarContext = {
      game,
      sourceCardId: card.id,
      svars: new Map(),
      controller: seat0,
    };
    expect(evaluateExpression(mkHeroicTernary(), ctx)).toBe(5);
  });

  it("returns thenValue when source IS among triggerContext.objects", () => {
    const game = mkGame();
    seedZones(game);
    const card = seedCard(game, 7110);
    const ctx: SvarContext = {
      game,
      sourceCardId: card.id,
      svars: new Map(),
      controller: seat0,
      triggerContext: { objects: [card.id] },
    };
    expect(evaluateExpression(mkHeroicTernary(), ctx)).toBe(5);
  });

  it("returns elseValue when source is NOT among triggerContext.objects", () => {
    const game = mkGame();
    seedZones(game);
    const heroicCard = seedCard(game, 7120);
    const otherCard = seedCard(game, 7121);
    const ctx: SvarContext = {
      game,
      sourceCardId: heroicCard.id,
      svars: new Map(),
      controller: seat0,
      triggerContext: { objects: [otherCard.id] },
    };
    expect(evaluateExpression(mkHeroicTernary(), ctx)).toBe(0);
  });
});

// ── Pick 4: CantSacrificeBy$ carve-out ───────────────────────────────────────
describe("Wave 105 — CantSacrifice + CantSacrificeBy$ carve-out", () => {
  it("blocks sacrifice without a carve-out (back-compat)", () => {
    const game = mkGame();
    seedZones(game);
    const target = seedCard(game, 7200, seat0);
    buildAndRegisterStatic(
      game,
      {
        mode: "CantSacrifice",
        params: { ValidCard: { kind: "literal", raw: "Card.YouCtrl" } },
        activeInZones: [],
      },
      target.id as unknown as number,
      97200,
    );
    expect(canBeSacrificed(game, target.id)).toBe(false);
  });

  it("blocks sacrifice when byPlayer is supplied but does NOT match carve-out (opponent forces sacrifice)", () => {
    const game = mkGame();
    seedZones(game);
    const target = seedCard(game, 7210, seat0);
    buildAndRegisterStatic(
      game,
      {
        mode: "CantSacrifice",
        params: {
          ValidCard: { kind: "literal", raw: "Card.YouCtrl" },
          // Sigarda: "except by you" — owner-controlled sacrifice OK.
          CantSacrificeBy: { kind: "literal", raw: "You" },
        },
        activeInZones: [],
      },
      target.id as unknown as number,
      97210,
      0, // static controller is seat0
    );
    // Opponent forces sacrifice — gate fires.
    expect(canBeSacrificed(game, target.id, seat1)).toBe(false);
  });

  it("does NOT block sacrifice when byPlayer matches the carve-out (own-side sacrifice OK)", () => {
    const game = mkGame();
    seedZones(game);
    const target = seedCard(game, 7220, seat0);
    buildAndRegisterStatic(
      game,
      {
        mode: "CantSacrifice",
        params: {
          ValidCard: { kind: "literal", raw: "Card.YouCtrl" },
          CantSacrificeBy: { kind: "literal", raw: "You" },
        },
        activeInZones: [],
      },
      target.id as unknown as number,
      97220,
      0,
    );
    // Static controller (seat0) sacrifices their own creature — gate
    // does NOT fire (the carve-out exempts seat0).
    expect(canBeSacrificed(game, target.id, seat0)).toBe(true);
  });
});

// ── Pick 5: CantAttackUnless Target$ filter ──────────────────────────────────
describe("Wave 105 — canAttackUnlessPaid with Target$ filter", () => {
  it("gates uniformly when Target$ is omitted (back-compat)", () => {
    const game = mkGame();
    seedZones(game);
    const attacker = seedCard(game, 7300, seat1);
    buildAndRegisterStatic(
      game,
      {
        mode: "CantAttackUnless",
        params: {
          ValidCard: { kind: "literal", raw: "Card" },
          Cost: { kind: "literal", raw: "1" },
        },
        activeInZones: [],
      },
      mkEntityId(7301) as unknown as number,
      97300,
      0,
    );
    // No defender hint — gate fires regardless of who's being attacked.
    expect(canAttackUnlessPaid(game, attacker.id)).toBe(false);
  });

  it("gates only attacks targeting You (Propaganda shape)", () => {
    const game = mkGame();
    seedZones(game);
    const attacker = seedCard(game, 7310, seat1);
    buildAndRegisterStatic(
      game,
      {
        mode: "CantAttackUnless",
        params: {
          ValidCard: { kind: "literal", raw: "Card" },
          Cost: { kind: "literal", raw: "1" },
          Target: { kind: "literal", raw: "You" },
        },
        activeInZones: [],
      },
      mkEntityId(7311) as unknown as number,
      97310,
      0, // static controlled by seat0
    );
    // Attacking seat0 (the static's controller) — gate fires.
    expect(canAttackUnlessPaid(game, attacker.id, seat0)).toBe(false);
    // Attacking seat1 (opponent) — gate bypassed.
    expect(canAttackUnlessPaid(game, attacker.id, seat1)).toBe(true);
  });
});

// ── Pick 6: MinMaxBlocker enforcement in validateBlockDeclarations ───────────
describe("Wave 105 — validateBlockDeclarations honors MinMaxBlocker", () => {
  const seedZonesAndChars = (game: Game): void => {
    seedZones(game);
    const orig = game.layerEngine.computeCharacteristics.bind(game.layerEngine);
    game.layerEngine.computeCharacteristics = (id: EntityId) => {
      const base = emptyCharacteristics();
      base.power = 1;
      base.toughness = 1;
      base.types.add(CardType.Creature);
      base.colors = ColorSet.fromJSON(0);
      const out = orig(id);
      // Merge — preserve existing fields, fall back to base.
      return { ...base, ...out };
    };
  };

  it("returns 0 errors when blockers === 0 (unblocked is legal under 'if able')", () => {
    const game = mkGame();
    seedZonesAndChars(game);
    const att = seedCard(game, 7400, seat0);
    buildAndRegisterStatic(
      game,
      {
        mode: "MinMaxBlocker",
        params: {
          ValidAttacker: { kind: "literal", raw: "Card.Self" },
          Min: { kind: "literal", raw: "3" },
        },
        activeInZones: [],
      },
      att.id as unknown as number,
      97400,
      0,
    );
    // No declarations at all — no error.
    const errs = validateBlockDeclarations(game, []);
    expect(errs).toHaveLength(0);
  });

  it("rejects when min not met (Tromokratis: min=3, only 2 blockers)", () => {
    const game = mkGame();
    seedZonesAndChars(game);
    const att = seedCard(game, 7410, seat0);
    const blk1 = seedCard(game, 7411, seat1);
    const blk2 = seedCard(game, 7412, seat1);
    buildAndRegisterStatic(
      game,
      {
        mode: "MinMaxBlocker",
        params: {
          ValidAttacker: { kind: "literal", raw: "Card.Self" },
          Min: { kind: "literal", raw: "3" },
        },
        activeInZones: [],
      },
      att.id as unknown as number,
      97410,
      0,
    );
    const errs = validateBlockDeclarations(game, [
      { blockerId: blk1.id, attackerIds: [att.id] },
      { blockerId: blk2.id, attackerIds: [att.id] },
    ]);
    // Pre-existing block-legality checks may also flag entries; we want
    // to confirm a min-violation reason is among them.
    const reasons = errs.map((e) => e.reason ?? "");
    expect(reasons.some((r) => r.includes("min"))).toBe(true);
  });

  it("accepts when min is met (3 blockers, min=3)", () => {
    const game = mkGame();
    seedZonesAndChars(game);
    const att = seedCard(game, 7420, seat0);
    const blk1 = seedCard(game, 7421, seat1);
    const blk2 = seedCard(game, 7422, seat1);
    const blk3 = seedCard(game, 7423, seat1);
    buildAndRegisterStatic(
      game,
      {
        mode: "MinMaxBlocker",
        params: {
          ValidAttacker: { kind: "literal", raw: "Card.Self" },
          Min: { kind: "literal", raw: "3" },
        },
        activeInZones: [],
      },
      att.id as unknown as number,
      97420,
      0,
    );
    const errs = validateBlockDeclarations(game, [
      { blockerId: blk1.id, attackerIds: [att.id] },
      { blockerId: blk2.id, attackerIds: [att.id] },
      { blockerId: blk3.id, attackerIds: [att.id] },
    ]);
    // No min-violation in the result list.
    const reasons = errs.map((e) => e.reason ?? "");
    expect(reasons.some((r) => r.includes("min"))).toBe(false);
  });

  it("rejects when max exceeded (max=1, 2 blockers)", () => {
    const game = mkGame();
    seedZonesAndChars(game);
    const att = seedCard(game, 7430, seat0);
    const blk1 = seedCard(game, 7431, seat1);
    const blk2 = seedCard(game, 7432, seat1);
    buildAndRegisterStatic(
      game,
      {
        mode: "MinMaxBlocker",
        params: {
          ValidAttacker: { kind: "literal", raw: "Card.Self" },
          Max: { kind: "literal", raw: "1" },
        },
        activeInZones: [],
      },
      att.id as unknown as number,
      97430,
      0,
    );
    const errs = validateBlockDeclarations(game, [
      { blockerId: blk1.id, attackerIds: [att.id] },
      { blockerId: blk2.id, attackerIds: [att.id] },
    ]);
    const reasons = errs.map((e) => e.reason ?? "");
    expect(reasons.some((r) => r.includes("max"))).toBe(true);
  });
});

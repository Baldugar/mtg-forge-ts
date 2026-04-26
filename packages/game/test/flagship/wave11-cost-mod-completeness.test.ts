// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 11 flagships — end-to-end coverage for the 6 cost-modification gaps
// closed in Wave 11 (the cost-mod runtime completeness push). Each describe
// block exercises ONE Forge card (or a synthetic-but-shaped fixture) that
// uses the gap's specific Forge DSL form, and casts a real spell through
// the cast pipeline to confirm the cost-mod fires (or doesn't) as expected.
//
// Coverage:
//   Gap 1 — MinMana$           : Zirda, the Dawnwaker (synthetic spell cost)
//   Gap 2 — OnlyFirstSpell$    : Acolyte of Bahamut (DragonReduce SVar)
//   Gap 3 — AffectedZone$      : Gloom (white enchantment ability cost +3)
//   Gap 4 — Cost$ colored raise: Alabaster Leech (white spells cost {W} more)
//   Gap 5 — SetCost            : Trinisphere ({1B} → {2B})
//   Gap 6 — Amount$ X (numeric): synthetic fixture using Number$2 expression
//                                (Yavimaya's Count$Domain uses an unimplemented
//                                selector; we cover the dynamic-resolution
//                                pathway via Number$ which is implemented)
import { parseCard } from "@mtg-forge-ts/cards";
import type { EntityId, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  Color,
  DEFAULT_PAPER_CARD_FLAGS,
  ManaProduced,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../src/card.js";
import type { CastProposal } from "../../src/cast/cast-pipeline.js";
import type { GameMeta } from "../../src/game-meta.js";
import type { GameRules } from "../../src/game-rules.js";
import { Game } from "../../src/game.js";
import { ManaPool } from "../../src/mana/mana-pool.js";
import type { StackItem } from "../../src/stack/stack-item.js";
import { onZoneChange } from "../../src/statics/zone-activation.js";
import { Battlefield } from "../../src/zone/zones/battlefield.js";
import { Graveyard } from "../../src/zone/zones/graveyard.js";
import { Hand } from "../../src/zone/zones/hand.js";
import { Library } from "../../src/zone/zones/library.js";

// Self-register all effects + cost parts.
import "../../src/ability/effects/index.js";
import "../../src/cost/parts/index.js";

const alice: LobbyPlayer = { id: "p-alice", name: "Alice", controllerKind: "human" };
const bob: LobbyPlayer = { id: "p-bob", name: "Bob", controllerKind: "ai" };

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
  forgeSha: "abc",
  cardDataSyncedAt: "2026-04-23T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};

const makeGame = (): Game => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
  return game;
};

const addCardToHand = (game: Game, paper: PaperCard, seat: PlayerSeat, id: EntityId): Card => {
  const card = new Card(id, paper, seat, seat, ZoneType.Hand);
  game.cards.set(id, card);
  const hand = game.getPlayer(seat).zones.get(ZoneType.Hand);
  if (!hand) throw new Error("test: missing hand zone");
  hand.add(id);
  return card;
};

const addCardToBattlefield = (game: Game, paper: PaperCard, seat: PlayerSeat, id: EntityId): Card => {
  const card = new Card(id, paper, seat, seat, ZoneType.Battlefield);
  game.cards.set(id, card);
  const bf = game.getPlayer(seat).zones.get(ZoneType.Battlefield);
  if (!bf) throw new Error("test: missing battlefield zone");
  bf.add(id);
  return card;
};

const installStaticSource = (game: Game, src: string, name: string, seat: PlayerSeat, id: EntityId): Card => {
  const def = parseCard(src, `${name.toLowerCase().replace(/[^a-z0-9]/g, "_")}.txt`);
  const paper: PaperCard = {
    name,
    edition: "TST",
    collectorNumber: "1",
    language: "en",
    foil: false,
    flags: DEFAULT_PAPER_CARD_FLAGS,
    definition: def,
  };
  const card = addCardToBattlefield(game, paper, seat, id);
  card.activateStaticsFromDefinition(game);
  onZoneChange(game, id, ZoneType.None, ZoneType.Battlefield);
  return card;
};

const drainCast = (
  gen: Generator<{ kind: string }, StackItem | null, unknown>,
): { events: string[]; result: StackItem | null } => {
  const events: string[] = [];
  let step = gen.next();
  while (!step.done) {
    const y = step.value as { kind: string; event?: { kind?: string }; request?: { kind?: string } };
    if (y.kind === "event" && y.event?.kind) {
      events.push(y.event.kind);
      step = gen.next();
    } else if (y.kind === "decision" && y.request?.kind === "activateManaAbilities") {
      step = gen.next({ kind: "activateManaAbilities", done: true });
    } else if (y.kind === "decision" && y.request?.kind === "chooseCastTargets") {
      const req = y.request as { legalTargets?: readonly unknown[] };
      const first = req.legalTargets?.[0];
      step = gen.next({ kind: "chooseCastTargets", targets: first !== undefined ? [first] : [] });
    } else {
      step = gen.next();
    }
  }
  return { events, result: step.value };
};

// ----------------------------- Fixture sources ------------------------------

// Generic test instant — black 1B, no body. Used as the cast-target for
// MinMana / OnlyFirstSpell / SetCost flagships (filter is the payload, not
// the spell's effect).
const testInstantSrc = (name: string, types: string, mana: string): string =>
  `${[`Name:${name}`, `ManaCost:${mana}`, `Types:${types}`, `Oracle:${name}.`].join("\n")}\n`;

// --------------------------- Gap 1: MinMana$ --------------------------------

// Synthetic Zirda — abilities/spells you cast cost {2} less but never less
// than {1}. The real Zirda affects activated abilities; here we use Type$
// Spell because activating a real ability through the activate.ts pipeline
// requires more fixture setup. The MinMana$ floor is the load-bearing
// behaviour and is identical for spell vs ability mods.
const zirdaSyntheticSrc = `${[
  "Name:Zirda Synthetic",
  "ManaCost:1 RW RW",
  "Types:Artifact",
  "S:Mode$ ReduceCost | ValidCard$ Card | Activator$ You | Type$ Spell | Amount$ 2 | MinMana$ 1 | Description$ Spells you cast cost {2} less, but never less than {1}.",
  "Oracle:flagship-test fixture",
].join("\n")}\n`;

describe("Wave 11 flagship — Gap 1: MinMana$ floor (Zirda-shaped)", () => {
  it("Reduces a {3B} cost to {1B} with -2 reduction floored at 1", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const zirdaId = mkEntityId(30000);
    const spellId = mkEntityId(30001);

    installStaticSource(game, zirdaSyntheticSrc, "Zirda Synthetic", seat0, zirdaId);
    expect(game.staticEffectRegistry.byCategory("costModification")).toHaveLength(1);

    // 3-B black instant. Without reduction → {3B}. With -2 reduction floored
    // at 1 → {1B}. Pool: {1}{B} = colorless + black mana.
    const def = parseCard(testInstantSrc("Test Spell 3B", "Instant", "3 B"), "test.txt");
    const paper: PaperCard = {
      name: "Test Spell 3B",
      edition: "TST",
      collectorNumber: "1",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };
    addCardToHand(game, paper, seat0, spellId);

    const pool = new ManaPool();
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colored(Color.Black));
    game.getPlayer(seat0).manaPool = pool;
    expect(pool.size()).toBe(2);

    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: spellId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const { events, result } = drainCast(
      game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );
    expect(result).not.toBeNull();
    expect(events).toContain("CostPaid");
    expect(events).toContain("SpellCast");
    expect(pool.size()).toBe(0);
  });

  it("Floor blocks aggressive reduction: a {1B} spell would reduce to {0B} but floor=1 holds it at {1B}", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const zirdaId = mkEntityId(31000);
    const spellId = mkEntityId(31001);

    installStaticSource(game, zirdaSyntheticSrc, "Zirda Synthetic", seat0, zirdaId);

    const def = parseCard(testInstantSrc("Test Spell 1B", "Instant", "1 B"), "test.txt");
    const paper: PaperCard = {
      name: "Test Spell 1B",
      edition: "TST",
      collectorNumber: "1",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };
    addCardToHand(game, paper, seat0, spellId);

    // Pool: just one B — a real {0B}-after-reduction would succeed, but the
    // floor of 1 keeps the cost at {1B} and we need 1+B = 2 mana minimum.
    const pool = new ManaPool();
    pool.add(ManaProduced.colored(Color.Black));
    game.getPlayer(seat0).manaPool = pool;

    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: spellId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const { result } = drainCast(
      game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );
    // Cast aborts: {1B} cost cannot be paid by a single B mana.
    expect(result).toBeNull();
  });
});

// ------------------- Gap 2: OnlyFirstSpell$ once-per-turn -------------------

// Acolyte of Bahamut's static GRANTS another card the DragonReduce SVar via
// a Continuous AddStaticAbility. Wiring continuous AddStaticAbility$ at
// Wave 11 is out of scope; instead we install the DragonReduce static
// directly on a fixture card that carries it as a top-level S: line. The
// behaviour we're testing — OnlyFirstSpell$ True per-turn gating — is
// identical regardless of which card carries the static at runtime.
const dragonReducerSrc = `${[
  "Name:Dragon Reducer",
  "ManaCost:1 G",
  "Types:Enchantment",
  "S:Mode$ ReduceCost | ValidCard$ Card.Dragon | Activator$ You | Type$ Spell | OnlyFirstSpell$ True | Amount$ 2 | Description$ The first Dragon spell you cast each turn costs {2} less to cast.",
  "Oracle:OnlyFirstSpell flagship-test fixture",
].join("\n")}\n`;

describe("Wave 11 flagship — Gap 2: OnlyFirstSpell$ True (Acolyte-shaped)", () => {
  it("Reduces only the first Dragon spell each turn; second same-turn pays full; next turn resets", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const reducerId = mkEntityId(32000);

    installStaticSource(game, dragonReducerSrc, "Dragon Reducer", seat0, reducerId);

    // Two Dragon spells — both ManaCost: 4 R (CMC 5; Dragon subtype). With
    // the static, the FIRST cast pays {2}{R}, the SECOND pays {4}{R}.
    const dragonSrc = `${[
      "Name:Test Dragon",
      "ManaCost:4 R",
      "Types:Creature Dragon",
      "PT:5/5",
      "Oracle:Dragon",
    ].join("\n")}\n`;
    const dragonDef = parseCard(dragonSrc, "dragon.txt");
    const dragonPaper = (id: number): PaperCard => ({
      name: `Test Dragon ${id}`,
      edition: "TST",
      collectorNumber: String(id),
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: dragonDef,
    });
    const d1Id = mkEntityId(32001);
    const d2Id = mkEntityId(32002);
    addCardToHand(game, dragonPaper(1), seat0, d1Id);
    addCardToHand(game, dragonPaper(2), seat0, d2Id);

    // Pool for first cast: exactly {2}{R} (= 3 mana). Should succeed.
    const pool = new ManaPool();
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colored(Color.Red));
    game.getPlayer(seat0).manaPool = pool;

    const proposal1: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: d1Id,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const r1 = drainCast(
      game.castPipeline.run(proposal1) as Generator<{ kind: string }, StackItem | null, unknown>,
    );
    expect(r1.result).not.toBeNull();
    expect(pool.size()).toBe(0);

    // Refill pool to exactly {2}{R} again. The SECOND dragon should NOT get
    // the discount this turn — the cast must abort because we'd need {4}{R}.
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colored(Color.Red));
    expect(pool.size()).toBe(3);

    const proposal2: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: d2Id,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const r2 = drainCast(
      game.castPipeline.run(proposal2) as Generator<{ kind: string }, StackItem | null, unknown>,
    );
    // Second cast same turn is unmodified — {4}{R} requires 5 mana, we
    // only have 3, so the cast aborts.
    expect(r2.result).toBeNull();

    // Advance to next turn; the once-per-turn guard resets. The same {2}{R}
    // pool is now sufficient again.
    game.turn = 2;
    expect(pool.size()).toBe(3);

    const proposal3: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: d2Id,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const r3 = drainCast(
      game.castPipeline.run(proposal3) as Generator<{ kind: string }, StackItem | null, unknown>,
    );
    expect(r3.result).not.toBeNull();
    expect(pool.size()).toBe(0);
  });
});

// --------------------- Gap 3: AffectedZone$ Battlefield ---------------------

// Gloom — second static gates RaiseCost on Type$ Ability + AffectedZone$
// Battlefield. The first static (Type$ Spell) is unconditionally active.
// We test the second static specifically by ensuring the Activator$ You
// constraint fails the first one (we cast as Bob) — leaving only the
// AffectedZone-gated one in play, which Bob's spells should NOT trigger
// (Type$ Ability fails).
const gloomSrc = `${[
  "Name:Gloom",
  "ManaCost:2 B",
  "Types:Enchantment",
  "S:Mode$ RaiseCost | ValidCard$ Card.White | Type$ Spell | Amount$ 3 | Description$ White spells cost {3} more to cast.",
  "S:Mode$ RaiseCost | ValidCard$ Enchantment.White | Type$ Ability | Amount$ 3 | AffectedZone$ Battlefield | Description$ Activated abilities of white enchantments cost {3} more to activate.",
  "Oracle:Gloom",
].join("\n")}\n`;

describe("Wave 11 flagship — Gap 3: AffectedZone$ + Type$ Ability (Gloom)", () => {
  it("White spell from any zone is raised by {3} (first static — no AffectedZone gate)", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0); // Gloom controller
    const seat1 = mkPlayerSeat(1); // White spell caster
    const gloomId = mkEntityId(33000);
    const spellId = mkEntityId(33001);

    installStaticSource(game, gloomSrc, "Gloom", seat0, gloomId);
    expect(game.staticEffectRegistry.byCategory("costModification")).toHaveLength(2);

    // Bob casts a 1W white spell — should now cost {4}{W}.
    const def = parseCard(testInstantSrc("White Test", "Instant", "1 W"), "white.txt");
    const paper: PaperCard = {
      name: "White Test",
      edition: "TST",
      collectorNumber: "1",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };
    addCardToHand(game, paper, seat1, spellId);

    // Bob's pool: {1}{W} — would succeed normally but RaiseCost+3 needs {4}{W}.
    const pool = new ManaPool();
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colored(Color.White));
    game.getPlayer(seat1).manaPool = pool;

    const proposal: CastProposal = {
      castingPlayer: seat1,
      sourceCardId: spellId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const { result } = drainCast(
      game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );
    // Cost is now {4}{W}; pool has only 2 mana. Cast aborts.
    expect(result).toBeNull();
  });

  it("White spell succeeds when given enough mana to cover the raise (sanity check)", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const gloomId = mkEntityId(33100);
    const spellId = mkEntityId(33101);

    installStaticSource(game, gloomSrc, "Gloom", seat0, gloomId);

    const def = parseCard(testInstantSrc("White Test", "Instant", "1 W"), "white.txt");
    const paper: PaperCard = {
      name: "White Test",
      edition: "TST",
      collectorNumber: "1",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };
    addCardToHand(game, paper, seat1, spellId);

    // {4}{W} = 5 mana.
    const pool = new ManaPool();
    for (let i = 0; i < 4; i++) pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colored(Color.White));
    game.getPlayer(seat1).manaPool = pool;

    const proposal: CastProposal = {
      castingPlayer: seat1,
      sourceCardId: spellId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const { result } = drainCast(
      game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );
    expect(result).not.toBeNull();
    expect(pool.size()).toBe(0);
  });

  it("AffectedZone$ Battlefield gates the ability static — a white enchantment's activated ability costs +3 only when on the battlefield", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0); // Gloom controller
    const seat1 = mkPlayerSeat(1); // Activates a separate white enchantment
    const gloomId = mkEntityId(33200);
    const enchId = mkEntityId(33201);

    installStaticSource(game, gloomSrc, "Gloom", seat0, gloomId);

    // White enchantment with an activated ability that costs {1}.
    const wEnchSrc = `${[
      "Name:White Aura Enchantment",
      "ManaCost:1 W",
      "Types:Enchantment",
      // AB$ Mana isn't a great fit because it's a mana ability. Use Pump
      // or any non-mana AB$. We use a self-targeting Pump $0 trivial body.
      "A:AB$ GainLife | Cost$ 1 | LifeAmount$ 1 | SpellDescription$ Gain 1 life.",
      "Oracle:white test",
    ].join("\n")}\n`;
    const def = parseCard(wEnchSrc, "wench.txt");
    const paper: PaperCard = {
      name: "White Aura Enchantment",
      edition: "TST",
      collectorNumber: "1",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };
    // Place the white enchantment on Bob's battlefield.
    const enchCard = addCardToBattlefield(game, paper, seat1, enchId);
    enchCard.activateAbilitiesFromDefinition();

    // Bob's pool: just {1} — would normally activate the ability ({1}). With
    // Gloom's AffectedZone$ Battlefield ability static, the cost is {4}.
    const pool = new ManaPool();
    pool.add(ManaProduced.colorless());
    game.getPlayer(seat1).manaPool = pool;

    const activateGen = game.action.activateAbility(enchId, 0, seat1) as Generator<
      { kind: string },
      unknown,
      unknown
    >;
    // Drain & expect throw on insufficient mana — payCost throws when mana
    // is short, propagating up out of activateAbility.
    let threw = false;
    try {
      let s = activateGen.next();
      while (!s.done) s = activateGen.next();
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    // Now top up the pool to {4} — the ability succeeds, confirming the
    // raise was the only blocker (and the ability static fired in
    // Battlefield zone).
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colorless());
    expect(pool.size()).toBe(4);
    const activateGen2 = game.action.activateAbility(enchId, 0, seat1) as Generator<
      { kind: string },
      unknown,
      unknown
    >;
    let s2 = activateGen2.next();
    while (!s2.done) s2 = activateGen2.next();
    // Pool drained to 0.
    expect(pool.size()).toBe(0);
  });
});

// ----------------- Gap 4: Cost$ colored-pip raise (Alabaster Leech) ----------

const alabasterLeechSrc = `${[
  "Name:Alabaster Leech",
  "ManaCost:W",
  "Types:Creature Leech",
  "PT:1/3",
  "S:Mode$ RaiseCost | ValidCard$ Card.White | Activator$ You | Type$ Spell | Cost$ W | Description$ White spells you cast cost {W} more to cast.",
  "Oracle:White spells you cast cost {W} more to cast.",
].join("\n")}\n`;

describe("Wave 11 flagship — Gap 4: Cost$ W colored raise (Alabaster Leech)", () => {
  it("Adds a {W} pip to a {1W} white spell, requiring {1WW} to cast", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const leechId = mkEntityId(34000);
    const spellId = mkEntityId(34001);

    installStaticSource(game, alabasterLeechSrc, "Alabaster Leech", seat0, leechId);

    const def = parseCard(testInstantSrc("White 1W", "Instant", "1 W"), "white.txt");
    const paper: PaperCard = {
      name: "White 1W",
      edition: "TST",
      collectorNumber: "1",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };
    addCardToHand(game, paper, seat0, spellId);

    // Pool: {1}{W} only — would succeed normally but Alabaster Leech demands {1}{W}{W}.
    const pool = new ManaPool();
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colored(Color.White));
    game.getPlayer(seat0).manaPool = pool;

    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: spellId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const { result } = drainCast(
      game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );
    expect(result).toBeNull();
  });

  it("Succeeds with {1WW} pool — confirms the Cost$ W raise is the only blocker", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const leechId = mkEntityId(34100);
    const spellId = mkEntityId(34101);

    installStaticSource(game, alabasterLeechSrc, "Alabaster Leech", seat0, leechId);

    const def = parseCard(testInstantSrc("White 1W", "Instant", "1 W"), "white.txt");
    const paper: PaperCard = {
      name: "White 1W",
      edition: "TST",
      collectorNumber: "1",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };
    addCardToHand(game, paper, seat0, spellId);

    const pool = new ManaPool();
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colored(Color.White));
    pool.add(ManaProduced.colored(Color.White));
    game.getPlayer(seat0).manaPool = pool;

    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: spellId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const { result } = drainCast(
      game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );
    expect(result).not.toBeNull();
    expect(pool.size()).toBe(0);
  });

  it("Non-white spell is unaffected (Activator$ You + ValidCard$ Card.White filter rejects)", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const leechId = mkEntityId(34200);
    const spellId = mkEntityId(34201);

    installStaticSource(game, alabasterLeechSrc, "Alabaster Leech", seat0, leechId);

    const def = parseCard(testInstantSrc("Red R", "Instant", "R"), "red.txt");
    const paper: PaperCard = {
      name: "Red R",
      edition: "TST",
      collectorNumber: "1",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };
    addCardToHand(game, paper, seat0, spellId);

    const pool = new ManaPool();
    pool.add(ManaProduced.colored(Color.Red));
    game.getPlayer(seat0).manaPool = pool;

    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: spellId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const { result } = drainCast(
      game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );
    expect(result).not.toBeNull();
    expect(pool.size()).toBe(0);
  });
});

// ----------------------- Gap 5: SetCost (Trinisphere) -----------------------

const trinisphereSrc = `${[
  "Name:Trinisphere",
  "ManaCost:3",
  "Types:Artifact",
  "S:Mode$ SetCost | ValidCard$ Card | Type$ Spell | Amount$ 3 | RaiseTo$ True | Description$ Each spell that would cost less than three mana to cast costs three mana to cast.",
  "Oracle:Trinisphere",
].join("\n")}\n`;

describe("Wave 11 flagship — Gap 5: SetCost (Trinisphere)", () => {
  it("Tops up a {1B} spell to mana value 3 — costs {2B} to cast", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const triId = mkEntityId(35000);
    const spellId = mkEntityId(35001);

    installStaticSource(game, trinisphereSrc, "Trinisphere", seat0, triId);

    const def = parseCard(testInstantSrc("Black 1B", "Instant", "1 B"), "black.txt");
    const paper: PaperCard = {
      name: "Black 1B",
      edition: "TST",
      collectorNumber: "1",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };
    addCardToHand(game, paper, seat0, spellId);

    // Pool: {1}{B} — base cost. Trinisphere bumps cost to MV 3 = {2}{B}.
    // With only 2 mana, the cast must fail.
    const pool = new ManaPool();
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colored(Color.Black));
    game.getPlayer(seat0).manaPool = pool;

    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: spellId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const { result } = drainCast(
      game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );
    expect(result).toBeNull();
  });

  it("Succeeds when given the topped-up cost ({2B} = 3 mana)", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const triId = mkEntityId(35100);
    const spellId = mkEntityId(35101);

    installStaticSource(game, trinisphereSrc, "Trinisphere", seat0, triId);

    const def = parseCard(testInstantSrc("Black 1B", "Instant", "1 B"), "black.txt");
    const paper: PaperCard = {
      name: "Black 1B",
      edition: "TST",
      collectorNumber: "1",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };
    addCardToHand(game, paper, seat0, spellId);

    const pool = new ManaPool();
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colored(Color.Black));
    game.getPlayer(seat0).manaPool = pool;

    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: spellId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const { result } = drainCast(
      game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );
    expect(result).not.toBeNull();
    expect(pool.size()).toBe(0);
  });

  it("Already-expensive spell is unchanged: {3WW} (MV=5) untouched by SetCost 3", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const triId = mkEntityId(35200);
    const spellId = mkEntityId(35201);

    installStaticSource(game, trinisphereSrc, "Trinisphere", seat0, triId);

    const def = parseCard(testInstantSrc("Wrath", "Sorcery", "3 W W"), "wrath.txt");
    const paper: PaperCard = {
      name: "Wrath",
      edition: "TST",
      collectorNumber: "1",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };
    addCardToHand(game, paper, seat0, spellId);

    // {3WW} = 5 mana. Pool: exactly 5.
    const pool = new ManaPool();
    for (let i = 0; i < 3; i++) pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colored(Color.White));
    pool.add(ManaProduced.colored(Color.White));
    game.getPlayer(seat0).manaPool = pool;

    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: spellId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const { result } = drainCast(
      game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );
    expect(result).not.toBeNull();
    expect(pool.size()).toBe(0);
  });
});

// ------------------ Gap 6: Non-numeric Amount$ (Number$N) -------------------

// Synthetic stand-in for Yavimaya Sojourner. Real Yavimaya uses Count$Domain
// which Wave 11 does not implement; we exercise the dynamic-resolution
// pathway via Number$N (already supported by the SVar evaluator). The
// Amount$ string `Number$2` causes the resolver to evaluate at apply time
// rather than capture a static literal at handler-build time.
const numberAmountSrc = `${[
  "Name:Numeric Amount Reducer",
  "ManaCost:1 G",
  "Types:Enchantment",
  "S:Mode$ ReduceCost | ValidCard$ Card | Activator$ You | Type$ Spell | Amount$ Number$2 | Description$ All your spells cost {Number$2} less.",
  "Oracle:dynamic Amount flagship-test fixture",
].join("\n")}\n`;

describe("Wave 11 flagship — Gap 6: Non-numeric Amount$ (dynamic resolver)", () => {
  it("Resolves Amount$ Number$2 at apply time and reduces a {3}{R} cost to {1}{R}", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const reducerId = mkEntityId(36000);
    const spellId = mkEntityId(36001);

    installStaticSource(game, numberAmountSrc, "Numeric Amount Reducer", seat0, reducerId);

    const def = parseCard(testInstantSrc("Red 3R", "Instant", "3 R"), "red.txt");
    const paper: PaperCard = {
      name: "Red 3R",
      edition: "TST",
      collectorNumber: "1",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };
    addCardToHand(game, paper, seat0, spellId);

    // {3}{R} normally needs 4 mana. With dynamic Amount$ Number$2 reducing
    // by 2, we need only {1}{R} = 2 mana.
    const pool = new ManaPool();
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colored(Color.Red));
    game.getPlayer(seat0).manaPool = pool;

    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: spellId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const { result } = drainCast(
      game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );
    expect(result).not.toBeNull();
    expect(pool.size()).toBe(0);
  });
});

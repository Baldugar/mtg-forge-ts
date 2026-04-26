// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 12A flagship — Doom Blade ValidTgts$ Creature.nonBlack color enforcement.
//
// Two scenarios on the same card definition:
//   (1) Doom Blade casting against a black creature is rejected at the
//       chooseCastTargets step (cast aborts → null) because the black
//       creature is filtered out of the eligible-targets set.
//   (2) Doom Blade casting against a green creature succeeds; the cast
//       lands a stack item with the chosen target.
//
// Card data: real Forge data parsed via @mtg-forge-ts/cards.
import { parseCard } from "@mtg-forge-ts/cards";
import type { LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  Color,
  ColorSet,
  DEFAULT_PAPER_CARD_FLAGS,
  ManaProduced,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import "../../src/ability/effects/index.js";
import "../../src/cost/parts/index.js";
import "../../src/svar/selectors/number.js";
import { Card } from "../../src/card.js";
import type { GameMeta } from "../../src/game-meta.js";
import type { GameRules } from "../../src/game-rules.js";
import { Game } from "../../src/game.js";
import { ManaPool } from "../../src/mana/mana-pool.js";
import type { StackItem } from "../../src/stack/stack-item.js";
import { Battlefield } from "../../src/zone/zones/battlefield.js";
import { Graveyard } from "../../src/zone/zones/graveyard.js";
import { Hand } from "../../src/zone/zones/hand.js";
import { Library } from "../../src/zone/zones/library.js";

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
  cardDataSyncedAt: "2026-04-26T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};

const doomBladeSrc = `${[
  "Name:Doom Blade",
  "ManaCost:1 B",
  "Types:Instant",
  "A:SP$ Destroy | Cost$ 1 B | ValidTgts$ Creature.nonBlack | TgtPrompt$ Select target nonblack creature | SpellDescription$ Destroy target nonblack creature.",
  "Oracle:Destroy target nonblack creature.",
].join("\n")}\n`;

const grizzlyBearsSrc = `${[
  "Name:Grizzly Bears",
  "ManaCost:1 G",
  "Types:Creature Bear",
  "PT:2/2",
  "Oracle:2/2",
].join("\n")}\n`;

const phyrexianGhoulSrc = `${[
  "Name:Phyrexian Ghoul",
  "ManaCost:2 B",
  "Types:Creature Zombie",
  "PT:2/2",
  "Oracle:Sacrifice a creature: Phyrexian Ghoul gets +2/+2 until end of turn.",
].join("\n")}\n`;

const mkGame = () => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
  return game;
};

const addCardToHand = (game: Game, paper: PaperCard, seat: PlayerSeat, id: number): Card => {
  const eid = mkEntityId(id);
  const card = new Card(eid, paper, seat, seat, ZoneType.Hand);
  game.cards.set(eid, card);
  const hand = game.getPlayer(seat).zones.get(ZoneType.Hand);
  if (!hand) throw new Error("test: missing hand");
  hand.add(eid);
  return card;
};

const addCardToBattlefield = (game: Game, paper: PaperCard, seat: PlayerSeat, id: number): Card => {
  const eid = mkEntityId(id);
  const card = new Card(eid, paper, seat, seat, ZoneType.Battlefield);
  game.cards.set(eid, card);
  const bf = game.getPlayer(seat).zones.get(ZoneType.Battlefield);
  if (!bf) throw new Error("test: missing battlefield");
  bf.add(eid);
  return card;
};

const drainCast = (
  gen: Generator<{ kind: string }, StackItem | null, unknown>,
  chosenIds: readonly number[],
): { events: string[]; result: StackItem | null; legalTargetIds: number[] } => {
  const events: string[] = [];
  const legalTargetIds: number[] = [];
  let step = gen.next();
  while (!step.done) {
    const y = step.value as {
      kind: string;
      event?: { kind?: string };
      request?: { kind?: string; legalTargets?: readonly { kind: string; id: number }[] };
    };
    if (y.kind === "event" && y.event?.kind) {
      events.push(y.event.kind);
      step = gen.next();
    } else if (y.kind === "decision" && y.request?.kind === "activateManaAbilities") {
      step = gen.next({ kind: "activateManaAbilities", done: true });
    } else if (y.kind === "decision" && y.request?.kind === "chooseCastTargets") {
      // Record the legal targets observed by the pipeline.
      for (const t of y.request.legalTargets ?? []) {
        if (t.kind === "card") legalTargetIds.push(t.id);
      }
      step = gen.next({
        kind: "chooseCastTargets",
        targets: chosenIds.map((id) => ({ kind: "card", id: mkEntityId(id) })),
      });
    } else {
      step = gen.next();
    }
  }
  return { events, result: step.value, legalTargetIds };
};

describe("Flagship F-12A: Doom Blade — ValidTgts$ Creature.nonBlack color filter", () => {
  it("rejects a black creature target — the black creature is NOT in legalTargets and the cast aborts", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0); // caster
    const seat1 = mkPlayerSeat(1); // target owner

    // Set up Doom Blade in seat0's hand
    const doomBladeDef = parseCard(doomBladeSrc, "doom_blade.txt");
    const doomBladePaper: PaperCard = {
      name: "Doom Blade",
      edition: "M10",
      collectorNumber: "90",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: doomBladeDef,
    };
    const doomBlade = addCardToHand(game, doomBladePaper, seat0, 7000);
    doomBlade.activateAbilitiesFromDefinition();

    // Set up a black creature on seat1's battlefield
    const ghoulDef = parseCard(phyrexianGhoulSrc, "phyrexian_ghoul.txt");
    const ghoulPaper: PaperCard = {
      name: "Phyrexian Ghoul",
      edition: "STH",
      collectorNumber: "60",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: ghoulDef,
    };
    const ghoul = addCardToBattlefield(game, ghoulPaper, seat1, 7001);

    // Sanity: the layered characteristics report the ghoul as black.
    const chars = game.layerEngine.computeCharacteristics(ghoul.id);
    expect(chars.colors.has(Color.Black)).toBe(true);

    // Pre-pay the cost (1 generic + 1 black).
    const pool = new ManaPool();
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colored(Color.Black));
    game.getPlayer(seat0).manaPool = pool;

    // Attempt to cast Doom Blade targeting the black creature.
    const { result, legalTargetIds } = drainCast(
      game.castPipeline.run({
        castingPlayer: seat0,
        sourceCardId: doomBlade.id,
        originZone: ZoneType.Hand,
        asSpecialAction: false,
      }) as Generator<{ kind: string }, StackItem | null, unknown>,
      [7001],
    );

    // The black creature is NOT in legal targets.
    expect(legalTargetIds).not.toContain(7001);
    // The cast pipeline aborts because the only-legal-target it was offered
    // (the black creature) is not in the eligible set: validateAtCast → false.
    expect(result).toBeNull();
  });

  it("accepts a green creature target — the green creature IS in legalTargets and the cast succeeds", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);

    // Set up Doom Blade
    const doomBladeDef = parseCard(doomBladeSrc, "doom_blade.txt");
    const doomBladePaper: PaperCard = {
      name: "Doom Blade",
      edition: "M10",
      collectorNumber: "90",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: doomBladeDef,
    };
    const doomBlade = addCardToHand(game, doomBladePaper, seat0, 8000);
    doomBlade.activateAbilitiesFromDefinition();

    // Set up a green creature on seat1's battlefield
    const bearDef = parseCard(grizzlyBearsSrc, "grizzly_bears.txt");
    const bearPaper: PaperCard = {
      name: "Grizzly Bears",
      edition: "LEA",
      collectorNumber: "195",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: bearDef,
    };
    const bear = addCardToBattlefield(game, bearPaper, seat1, 8001);
    const bearChars = game.layerEngine.computeCharacteristics(bear.id);
    expect(bearChars.colors.has(Color.Green)).toBe(true);
    expect(bearChars.colors.has(Color.Black)).toBe(false);

    // Pre-pay the cost.
    const pool = new ManaPool();
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colored(Color.Black));
    game.getPlayer(seat0).manaPool = pool;

    // Cast Doom Blade targeting the green creature.
    const { events, result, legalTargetIds } = drainCast(
      game.castPipeline.run({
        castingPlayer: seat0,
        sourceCardId: doomBlade.id,
        originZone: ZoneType.Hand,
        asSpecialAction: false,
      }) as Generator<{ kind: string }, StackItem | null, unknown>,
      [8001],
    );

    expect(legalTargetIds).toContain(8001);
    expect(result).not.toBeNull();
    expect(events).toContain("CostPaid");
    expect(events).toContain("SpellCast");
  });

  it("multi-color (B/G) creature is rejected by Creature.nonBlack — ANY forbidden color is enough", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);

    // Build a synthetic B/G creature via explicit Colors line on the definition.
    const bgSrc = `${[
      "Name:Death Worm",
      "ManaCost:1 G",
      "Types:Creature Worm",
      "PT:2/2",
      "Colors:Black,Green",
      "Oracle:test fixture",
    ].join("\n")}\n`;
    const bgDef = parseCard(bgSrc, "death_worm.txt");
    // Sanity: definition.colors carries B + G.
    expect(bgDef.colors).toBeDefined();
    const expectedColors = ColorSet.of(Color.Black, Color.Green);
    if (bgDef.colors) expect(bgDef.colors.equals(expectedColors)).toBe(true);

    const bgPaper: PaperCard = {
      name: "Death Worm",
      edition: "TST",
      collectorNumber: "1",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: bgDef,
    };
    const bgCard = addCardToBattlefield(game, bgPaper, seat1, 9001);
    const chars = game.layerEngine.computeCharacteristics(bgCard.id);
    expect(chars.colors.has(Color.Black)).toBe(true);
    expect(chars.colors.has(Color.Green)).toBe(true);

    // Set up Doom Blade
    const doomBladeDef = parseCard(doomBladeSrc, "doom_blade.txt");
    const doomBladePaper: PaperCard = {
      name: "Doom Blade",
      edition: "M10",
      collectorNumber: "90",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: doomBladeDef,
    };
    const doomBlade = addCardToHand(game, doomBladePaper, seat0, 9000);
    doomBlade.activateAbilitiesFromDefinition();

    const pool = new ManaPool();
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colored(Color.Black));
    game.getPlayer(seat0).manaPool = pool;

    const { result, legalTargetIds } = drainCast(
      game.castPipeline.run({
        castingPlayer: seat0,
        sourceCardId: doomBlade.id,
        originZone: ZoneType.Hand,
        asSpecialAction: false,
      }) as Generator<{ kind: string }, StackItem | null, unknown>,
      [9001],
    );

    // B/G creature is excluded — Black is in the forbid set.
    expect(legalTargetIds).not.toContain(9001);
    expect(result).toBeNull();
  });
});

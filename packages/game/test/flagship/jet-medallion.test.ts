// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 6 — Jet Medallion flagship integration test.
// Tests the cost-modification static-ability runtime end-to-end:
//   S:Mode$ ReduceCost | ValidCard$ Card.Black | Type$ Spell | Activator$ You | Amount$ 1
//
// Three scenarios pin the binary success metric for Wave 6:
//   1. Black 1B spell pays only {B} when Jet Medallion is on Alice's battlefield.
//   2. Red R spell is unaffected — full cost still required.
//   3. Black B spell (no generic) still costs B — reduction floored at 0.
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
import { SpellAbility } from "../../src/ability/spell-ability.js";
import { Card } from "../../src/card.js";
import type { CastProposal } from "../../src/cast/cast-pipeline.js";
import type { GameMeta } from "../../src/game-meta.js";
import type { GameRules } from "../../src/game-rules.js";
import { Game } from "../../src/game.js";
import { ManaPool } from "../../src/mana/mana-pool.js";
import { resolveStackItem } from "../../src/resolve/effect-resolve.js";
import type { StackItem } from "../../src/stack/stack-item.js";
import { onZoneChange } from "../../src/statics/zone-activation.js";
import { Battlefield } from "../../src/zone/zones/battlefield.js";
import { Graveyard } from "../../src/zone/zones/graveyard.js";
import { Hand } from "../../src/zone/zones/hand.js";
import { Library } from "../../src/zone/zones/library.js";

// Self-register all effects (DestroyEffect, etc.)
import "../../src/ability/effects/index.js";
// Register cost parts (CostMana, etc.)
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

const jetMedallionSrc = `${[
  "Name:Jet Medallion",
  "ManaCost:2",
  "Types:Artifact",
  "S:Mode$ ReduceCost | ValidCard$ Card.Black | Type$ Spell | Activator$ You | Amount$ 1 | Description$ Black spells you cast cost {1} less to cast.",
  "Oracle:Black spells you cast cost {1} less to cast.",
].join("\n")}\n`;

const doomBladeSrc = `${[
  "Name:Doom Blade",
  "ManaCost:1 B",
  "Types:Instant",
  "A:SP$ Destroy | Cost$ 1 B | ValidTgts$ Creature.nonBlack | TgtPrompt$ Select target nonblack creature | SpellDescription$ Destroy target nonblack creature.",
  "Oracle:Destroy target nonblack creature.",
].join("\n")}\n`;

const lightningBoltSrc = `${[
  "Name:Lightning Bolt",
  "ManaCost:R",
  "Types:Instant",
  "A:SP$ DealDamage | Cost$ R | ValidTgts$ Any | NumDmg$ 3 | SpellDescription$ Lightning Bolt deals 3 damage to any target.",
  "Oracle:Lightning Bolt deals 3 damage to any target.",
].join("\n")}\n`;

const darkRitualSrc = `${[
  // A B-only black spell — used to verify the floor at 0 doesn't underflow.
  // Any black B-cost spell would do; we mock the body irrelevantly so the
  // cost-mod pipeline is the only thing under test.
  "Name:Dark Ritual",
  "ManaCost:B",
  "Types:Instant",
  "Oracle:Add {B}{B}{B}.",
].join("\n")}\n`;

const grizzlyBearsSrc = `${[
  "Name:Grizzly Bears",
  "ManaCost:1 G",
  "Types:Creature Bear",
  "PT:2/2",
  "Oracle:2/2",
].join("\n")}\n`;

const makeGame = () => {
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

const installJetMedallion = (game: Game, seat: PlayerSeat, id: EntityId): Card => {
  const def = parseCard(jetMedallionSrc, "jet_medallion.txt");
  const paper: PaperCard = {
    name: "Jet Medallion",
    edition: "TMP",
    collectorNumber: "292",
    language: "en",
    foil: false,
    flags: DEFAULT_PAPER_CARD_FLAGS,
    definition: def,
  };
  const card = addCardToBattlefield(game, paper, seat, id);
  // Activate statics — produces the costModification StaticAbility on
  // Card.intrinsicStatics. Then drive zone-activation explicitly: card was
  // placed straight onto battlefield, so feed onZoneChange a (None →
  // Battlefield) transition so the static registers with the registry.
  card.activateStaticsFromDefinition(game);
  onZoneChange(game, id, ZoneType.None, ZoneType.Battlefield);
  return card;
};

describe("Flagship: Jet Medallion (Wave 6 — cost-modification statics)", () => {
  it("Reduces a 1B black spell to {B} — Alice pays only B for Doom Blade", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0); // Alice (caster + Jet Medallion controller)
    const seat1 = mkPlayerSeat(1); // Bob (target creature owner)
    const medallionId = mkEntityId(20000);
    const doomBladeId = mkEntityId(20001);
    const bearId = mkEntityId(20002);

    installJetMedallion(game, seat0, medallionId);
    expect(game.staticEffectRegistry.byCategory("costModification")).toHaveLength(1);

    // Doom Blade in Alice's hand
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
    const doomBladeCard = addCardToHand(game, doomBladePaper, seat0, doomBladeId);
    doomBladeCard.activateAbilitiesFromDefinition();

    // Grizzly Bears as a legal target on Bob's battlefield
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
    addCardToBattlefield(game, bearPaper, seat1, bearId);

    // Pool has ONLY one black mana — without the discount the cast would
    // require {1}{B} and fail. With Jet Medallion the cost folds to {B}.
    const pool = new ManaPool();
    pool.add(ManaProduced.colored(Color.Black));
    game.getPlayer(seat0).manaPool = pool;
    expect(pool.size()).toBe(1);

    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: doomBladeId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const { events, result: stackItem } = drainCast(
      game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );

    expect(stackItem).not.toBeNull();
    expect(events).toContain("CostPaid");
    expect(events).toContain("SpellCast");
    // Pool drained — the single B was consumed; no generic was needed.
    expect(pool.size()).toBe(0);
    // Doom Blade is now on the stack.
    expect(game.sharedZones.stack.size).toBe(1);
  });

  it("Does not affect a non-black spell — Lightning Bolt still costs R", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const medallionId = mkEntityId(21000);
    const boltId = mkEntityId(21001);

    installJetMedallion(game, seat0, medallionId);

    const boltDef = parseCard(lightningBoltSrc, "lightning_bolt.txt");
    const boltPaper: PaperCard = {
      name: "Lightning Bolt",
      edition: "LEA",
      collectorNumber: "161",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: boltDef,
    };
    const boltCard = addCardToHand(game, boltPaper, seat0, boltId);
    boltCard.activateAbilitiesFromDefinition();

    // Bind the bolt SpellAbility to Bob (player target) so chooseCastTargets
    // resolves cleanly via the legalTargets[0] path.
    const sa = boltCard.spellAbilities[0];
    if (!sa) throw new Error("test: bolt has no spellAbility");
    void new SpellAbility(sa.ast, sa.sourceCardId, sa.controllerSeat, sa.svars, []);

    const pool = new ManaPool();
    pool.add(ManaProduced.colored(Color.Red));
    game.getPlayer(seat0).manaPool = pool;

    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: boltId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const { events, result: stackItem } = drainCast(
      game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );

    expect(stackItem).not.toBeNull();
    expect(events).toContain("CostPaid");
    expect(events).toContain("SpellCast");
    expect(pool.size()).toBe(0); // R was paid normally; reduction did not fire
  });

  it("Does not reduce below floor — a B-only black spell still costs B", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const medallionId = mkEntityId(22000);
    const ritualId = mkEntityId(22001);

    installJetMedallion(game, seat0, medallionId);

    const ritualDef = parseCard(darkRitualSrc, "dark_ritual.txt");
    const ritualPaper: PaperCard = {
      name: "Dark Ritual",
      edition: "LEA",
      collectorNumber: "98",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: ritualDef,
    };
    const ritualCard = addCardToHand(game, ritualPaper, seat0, ritualId);
    ritualCard.activateAbilitiesFromDefinition();

    // Empty pool — the cast must fail (cost of B with no mana available),
    // confirming the floor didn't accidentally turn B → 0.
    game.getPlayer(seat0).manaPool = new ManaPool();
    const proposalEmpty: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: ritualId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const drainedEmpty = drainCast(
      game.castPipeline.run(proposalEmpty) as Generator<{ kind: string }, StackItem | null, unknown>,
    );
    // Cast aborts cleanly when no mana is available.
    expect(drainedEmpty.result).toBeNull();

    // Now seed exactly one B and re-attempt — should succeed.
    const pool = new ManaPool();
    pool.add(ManaProduced.colored(Color.Black));
    game.getPlayer(seat0).manaPool = pool;

    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: ritualId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const { result: stackItem } = drainCast(
      game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );
    expect(stackItem).not.toBeNull();
    expect(pool.size()).toBe(0);
  });
});

void resolveStackItem; // silence unused-import warning until/unless we resolve mid-test

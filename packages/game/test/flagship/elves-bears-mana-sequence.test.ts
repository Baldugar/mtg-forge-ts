// SPDX-License-Identifier: GPL-3.0-or-later
// F12 — Llanowar Elves → Grizzly Bears mana-sequence flagship test.
// Tests the full activated-ability → cast pipeline:
//   1. Cast Llanowar Elves (G). Resolves to battlefield.
//   2. Activate Elves' {T}: Add {G} ability → pool gains 1G, Elves taps.
//   3. Cast Grizzly Bears (1G) spending that G + 1 colorless.
//   4. Resolve Bears to battlefield.
//
// Proves that the activated-ability pipeline integrates with the cast pipeline:
// mana produced by an activated ability flows into the mana pool and can be
// spent to cast a subsequent spell.
//
// Uses game.action.activateAbility for Phase 2 (same as llanowar-elves.test.ts
// Phase B) and castPipeline for Phases 1 and 3.
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
import { resolveStackItem } from "../../src/resolve/effect-resolve.js";
import type { StackItem } from "../../src/stack/stack-item.js";
import { Battlefield } from "../../src/zone/zones/battlefield.js";
import { Graveyard } from "../../src/zone/zones/graveyard.js";
import { Hand } from "../../src/zone/zones/hand.js";
import { Library } from "../../src/zone/zones/library.js";

// Self-register all effects
import "../../src/ability/effects/index.js";
// Register cost parts
import "../../src/cost/parts/index.js";
// SVar number selectors
import "../../src/svar/selectors/number.js";

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
  cardDataSyncedAt: "2026-04-24T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};

const llanowarElvesSrc = `${[
  "Name:Llanowar Elves",
  "ManaCost:G",
  "Types:Creature Elf Druid",
  "PT:1/1",
  "A:AB$ Mana | Cost$ T | Produced$ G | SpellDescription$ Add {G}.",
  "Oracle:{T}: Add {G}.",
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
    } else {
      step = gen.next();
    }
  }
  return { events, result: step.value };
};

const drainResolver = (gen: Generator<unknown, void, unknown>): string[] => {
  const events: string[] = [];
  let step = gen.next();
  while (!step.done) {
    const y = step.value as {
      kind?: string;
      event?: { kind?: string };
      request?: { kind?: string; replacementIds?: number[] };
    };
    if (y.kind === "event" && y.event?.kind) {
      events.push(y.event.kind);
      step = gen.next();
    } else if (y.kind === "decision" && y.request?.kind === "orderReplacements") {
      step = gen.next({ order: [...(y.request.replacementIds ?? [])] });
    } else {
      step = gen.next();
    }
  }
  return events;
};

describe("Flagship: Llanowar Elves → Bears mana sequence — activated ability feeds spell cast", () => {
  it("tap Elves for G, then cast Grizzly Bears spending that G + 1 colorless", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);

    const elvesId = mkEntityId(23000);
    const bearsId = mkEntityId(23001);

    // 1. Parse both cards
    const elvesDef = parseCard(llanowarElvesSrc, "llanowar_elves.txt");
    const elvesPaper: PaperCard = {
      name: "Llanowar Elves",
      edition: "LEA",
      collectorNumber: "186",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: elvesDef,
    };

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

    // ── Phase 1: Cast Llanowar Elves ────────────────────────────────────

    const elvesCard = addCardToHand(game, elvesPaper, seat0, elvesId);
    elvesCard.activateAbilitiesFromDefinition();

    // Verify the AB$ Mana ability was parsed
    expect(elvesCard.spellAbilities).toHaveLength(1);
    expect(elvesCard.spellAbilities[0]?.handlerKey).toBe("Mana");

    // Seed 1G to cast Elves (costs G)
    const castPool1 = new ManaPool();
    castPool1.add(ManaProduced.colored(Color.Green));
    game.getPlayer(seat0).manaPool = castPool1;

    const elvesProposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: elvesId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const { result: elvesRawStack } = drainCast(
      game.castPipeline.run(elvesProposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );
    expect(elvesRawStack).not.toBeNull();
    expect(castPool1.size()).toBe(0); // 1G spent

    // Patch to Battlefield destination (creature spell)
    const elvesSpell = elvesRawStack as StackItem;
    const elvesPatched: StackItem = {
      ...elvesSpell,
      provenance: { ...elvesSpell.provenance, alternativeZoneDestination: ZoneType.Battlefield },
    };
    game.sharedZones.stack.pop();
    game.sharedZones.stack.push(elvesPatched);

    const elvesResolveEvents = drainResolver(
      resolveStackItem(game, elvesPatched) as Generator<unknown, void, unknown>,
    );
    expect(elvesResolveEvents).toContain("CardChangedZone");
    expect(elvesCard.zone).toBe(ZoneType.Battlefield);
    expect(elvesCard.tapped).toBe(false);
    expect(game.sharedZones.stack.size).toBe(0);

    // ── Phase 2: Activate {T}: Add {G} ─────────────────────────────────

    // Pool starts empty after spell cast
    const pool = new ManaPool();
    game.getPlayer(seat0).manaPool = pool;
    expect(pool.size()).toBe(0);

    // Activate ability index 0 via the canonical activateAbility orchestrator
    const activateEvents: string[] = [];
    const activateGen = game.action.activateAbility(elvesId, 0, seat0) as Generator<
      { kind: string; event?: { kind?: string } },
      unknown,
      unknown
    >;
    let activateStep = activateGen.next();
    while (!activateStep.done) {
      const y = activateStep.value;
      if (y.kind === "event" && y.event?.kind) activateEvents.push(y.event.kind);
      activateStep = activateGen.next();
    }

    // Elves tapped, AbilityActivated fired
    expect(elvesCard.tapped).toBe(true);
    expect(activateEvents).toContain("CardTapped");
    expect(activateEvents).toContain("AbilityActivated");

    // Resolve the mana ability on the stack
    expect(game.sharedZones.stack.size).toBe(1);
    const manaAbilityItem = game.sharedZones.stack.top();
    if (!manaAbilityItem) throw new Error("test: stack is empty after activateAbility");
    const manaResolveEvents = drainResolver(
      resolveStackItem(game, manaAbilityItem) as Generator<unknown, void, unknown>,
    );
    expect(manaResolveEvents).toContain("StackItemResolved");

    // Pool now has exactly 1G
    expect(pool.size()).toBe(1);
    expect(game.sharedZones.stack.size).toBe(0);

    // ── Phase 3: Cast Grizzly Bears (1G) spending the Elves-produced G ──

    // Grizzly Bears costs 1G — seed the colorless part (the G comes from pool)
    // The mana pool already has 1G. We need 1 more colorless.
    pool.add(ManaProduced.colorless());
    expect(pool.size()).toBe(2); // 1G + 1 colorless

    const bearsCard = addCardToHand(game, bearPaper, seat0, bearsId);
    bearsCard.activateAbilitiesFromDefinition();

    const bearsProposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: bearsId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const { events: bearsCastEvents, result: bearsRawStack } = drainCast(
      game.castPipeline.run(bearsProposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );
    expect(bearsRawStack).not.toBeNull();
    expect(bearsCastEvents).toContain("CostPaid");
    expect(bearsCastEvents).toContain("SpellCast");
    // All mana spent
    expect(pool.size()).toBe(0);

    // Patch to Battlefield destination
    const bearsSpell = bearsRawStack as StackItem;
    const bearsPatched: StackItem = {
      ...bearsSpell,
      provenance: { ...bearsSpell.provenance, alternativeZoneDestination: ZoneType.Battlefield },
    };
    game.sharedZones.stack.pop();
    game.sharedZones.stack.push(bearsPatched);

    const bearsResolveEvents = drainResolver(
      resolveStackItem(game, bearsPatched) as Generator<unknown, void, unknown>,
    );
    expect(bearsResolveEvents).toContain("CardChangedZone");
    expect(bearsResolveEvents).toContain("StackItemResolved");

    // 4. Final assertions
    // Bears on battlefield
    expect(bearsCard.zone).toBe(ZoneType.Battlefield);
    // Elves still on battlefield, tapped
    expect(elvesCard.zone).toBe(ZoneType.Battlefield);
    expect(elvesCard.tapped).toBe(true);
    // Mana pool empty
    expect(pool.size()).toBe(0);
    // Stack empty
    expect(game.sharedZones.stack.size).toBe(0);
    // Life unchanged
    expect(game.getPlayer(seat0).life).toBe(20);
  });
});

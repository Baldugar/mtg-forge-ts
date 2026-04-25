// SPDX-License-Identifier: GPL-3.0-or-later
// F8 — Doom Blade flagship integration test.
// Tests targeted DestroyEffect on a creature (variant of Disenchant, using 1B).
//
// Scenario: White 2/2 creature on seat1's battlefield. Cast Doom Blade (1B)
// targeting it. Creature moves to graveyard.
//
// NOTE: ValidTgts$ Creature.nonBlack validation is NOT enforced by the current
// pipeline — the target is hand-bound directly to the resolver using the same
// pattern as Lightning Bolt. Target validation deferred to SP3 targeting system.
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
  cardDataSyncedAt: "2026-04-23T00:00:00Z",
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

describe("Flagship: Doom Blade end-to-end integration", () => {
  it("destroys target creature — creature moves to graveyard, Doom Blade in graveyard", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0); // caster
    const seat1 = mkPlayerSeat(1); // target creature owner
    const doomBladeId = mkEntityId(9000);
    const creatureId = mkEntityId(9001);

    // 1. Parse Doom Blade
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

    // 2. Build a Grizzly Bears as the target creature
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

    // 3. Set up: Doom Blade in seat0's hand, Grizzly Bears on seat1's battlefield
    const doomBladeCard = addCardToHand(game, doomBladePaper, seat0, doomBladeId);
    doomBladeCard.activateAbilitiesFromDefinition();

    const creatureCard = addCardToBattlefield(game, bearPaper, seat1, creatureId);
    expect(creatureCard.zone).toBe(ZoneType.Battlefield);

    // 4. Seed 1 colorless + 1 black (Doom Blade costs 1B)
    const pool = new ManaPool();
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colored(Color.Black));
    game.getPlayer(seat0).manaPool = pool;

    // 5. Cast Doom Blade
    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: doomBladeId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const { events: castEvents, result: stackItem } = drainCast(
      game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );

    expect(stackItem).not.toBeNull();
    expect(castEvents).toContain("CostPaid");
    expect(castEvents).toContain("SpellCast");
    expect(pool.size()).toBe(0);

    // 6. Patch the stack item with the creature as target
    const saTemplate = doomBladeCard.spellAbilities[0];
    if (!saTemplate) throw new Error("test: card has no spellAbilities");
    const boundSa = new SpellAbility(
      saTemplate.ast,
      saTemplate.sourceCardId,
      saTemplate.controllerSeat,
      saTemplate.svars,
      [creatureId],
    );
    const patchedItem: StackItem = { ...(stackItem as StackItem), resolver: boundSa.makeResolver() };
    game.sharedZones.stack.pop();
    game.sharedZones.stack.push(patchedItem);

    // 7. Resolve Doom Blade
    const resolveEvents = drainResolver(
      resolveStackItem(game, patchedItem) as Generator<unknown, void, unknown>,
    );

    // CardDestroyed event
    expect(resolveEvents).toContain("CardDestroyed");
    expect(resolveEvents).toContain("CardChangedZone");
    expect(resolveEvents).toContain("StackItemResolved");

    // Creature destroyed → owner's graveyard
    expect(creatureCard.zone).toBe(ZoneType.Graveyard);

    // Doom Blade → caster's graveyard
    expect(doomBladeCard.zone).toBe(ZoneType.Graveyard);

    // Life totals unchanged
    expect(game.getPlayer(seat0).life).toBe(20);
    expect(game.getPlayer(seat1).life).toBe(20);

    // Stack empty
    expect(game.sharedZones.stack.size).toBe(0);
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 23 — Convoke flagship integration test ("Conclave Cavalier" stand-in).
//
// Convoke (CR 702.51) — "Your creatures can help cast this spell. Each
// creature you tap while casting this spell pays for {1} or one mana of that
// creature's color." Wave 23 MVP supports the {1}-generic substitution; the
// colored-pip path is documented as a follow-up.
//
// This test pins the binary success metric:
//   - A creature spell with K:Convoke and base cost 3G (4 mana value), with
//     two untapped Bears on the caster's battlefield, can be cast paying only
//     {1}{G} after tapping both Bears for {2} of generic.
//   - The two Bears end up tapped; the residual mana pool is drained.
//
// Synthetic card definition (Convoke creature):
//   Name:Convoke Knight
//   ManaCost:3 G
//   Types:Creature Knight
//   K:Convoke
//   PT:4/4
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
import { Battlefield } from "../../src/zone/zones/battlefield.js";
import { Graveyard } from "../../src/zone/zones/graveyard.js";
import { Hand } from "../../src/zone/zones/hand.js";
import { Library } from "../../src/zone/zones/library.js";

// Bootstrap registries
import "../../src/ability/effects/index.js";
import "../../src/cost/parts/index.js";
import "../../src/keyword/index.js";

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
  seed: "23",
};

const convokeKnightSrc = `${[
  "Name:Convoke Knight",
  "ManaCost:3 G",
  "Types:Creature Knight",
  "K:Convoke",
  "PT:4/4",
  "Oracle:Convoke. (Your creatures can help cast this spell. Each creature you tap while casting this spell pays for {1} or one mana of that creature's color.)",
].join("\n")}\n`;

const grizzlyBearsSrc = `${[
  "Name:Grizzly Bears",
  "ManaCost:1 G",
  "Types:Creature Bear",
  "PT:2/2",
  "Oracle:2/2",
].join("\n")}\n`;

const makeGame = (): Game => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(23n) });
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

interface ConvokeDecisionRequest {
  readonly kind?: string;
  readonly eligible?: readonly { readonly cardId: EntityId; readonly mode: "convoke" | "improvise" }[];
  readonly legalTargets?: readonly unknown[];
}

const drainCast = (
  gen: Generator<{ kind: string }, StackItem | null, unknown>,
  tapAll: boolean,
): { events: string[]; result: StackItem | null; tappedIds: readonly EntityId[] } => {
  const events: string[] = [];
  let tappedIds: readonly EntityId[] = [];
  let step = gen.next();
  while (!step.done) {
    const y = step.value as { kind: string; event?: { kind?: string }; request?: ConvokeDecisionRequest };
    if (y.kind === "event" && y.event?.kind) {
      events.push(y.event.kind);
      step = gen.next();
    } else if (y.kind === "decision" && y.request?.kind === "activateManaAbilities") {
      step = gen.next({ kind: "activateManaAbilities", done: true });
    } else if (y.kind === "decision" && y.request?.kind === "chooseConvokeImproviseTap") {
      const eligible = y.request.eligible ?? [];
      const ids = tapAll ? eligible.map((e) => e.cardId) : [];
      tappedIds = ids;
      step = gen.next({ kind: "chooseConvokeImproviseTap", tapIds: ids });
    } else if (y.kind === "decision" && y.request?.kind === "chooseCastTargets") {
      const first = y.request.legalTargets?.[0];
      step = gen.next({ kind: "chooseCastTargets", targets: first !== undefined ? [first] : [] });
    } else {
      step = gen.next();
    }
  }
  return { events, result: step.value, tappedIds };
};

describe("Flagship: Convoke (Wave 23)", () => {
  it("Two tapped Bears reduce a 3G Convoke spell to 1G — caster pays only {1}{G}", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const knightId = mkEntityId(23000);
    const bear1Id = mkEntityId(23001);
    const bear2Id = mkEntityId(23002);

    // Knight in Alice's hand with K:Convoke wired up.
    const knightDef = parseCard(convokeKnightSrc, "convoke_knight.txt");
    const knightPaper: PaperCard = {
      name: "Convoke Knight",
      edition: "TEST",
      collectorNumber: "1",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: knightDef,
    };
    const knightCard = addCardToHand(game, knightPaper, seat0, knightId);
    knightCard.activateAbilitiesFromDefinition();
    knightCard.activateKeywordsFromDefinition(game);

    expect(knightCard.keywords?.has("convoke")).toBe(true);

    // Two untapped Bears on Alice's battlefield.
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
    const bear1 = addCardToBattlefield(game, bearPaper, seat0, bear1Id);
    const bear2 = addCardToBattlefield(game, bearPaper, seat0, bear2Id);
    expect(bear1.tapped).toBe(false);
    expect(bear2.tapped).toBe(false);

    // Pool has only {1}{G} — without Convoke the 3G cast would fail.
    const pool = new ManaPool();
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colored(Color.Green));
    game.getPlayer(seat0).manaPool = pool;
    expect(pool.size()).toBe(2);

    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: knightId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };

    const {
      events,
      result: stackItem,
      tappedIds,
    } = drainCast(
      game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
      true,
    );

    expect(stackItem).not.toBeNull();
    expect(events).toContain("CostPaid");
    expect(events).toContain("SpellCast");
    // Both bears were offered as eligible.
    expect(tappedIds).toHaveLength(2);
    expect(tappedIds).toContain(bear1Id);
    expect(tappedIds).toContain(bear2Id);
    // Pool drained: {1}{G} was sufficient after the {2} convoke reduction.
    expect(pool.size()).toBe(0);
    // Bears are now tapped.
    expect(bear1.tapped).toBe(true);
    expect(bear2.tapped).toBe(true);
    // Stack has the spell.
    expect(game.sharedZones.stack.size).toBe(1);
  });

  it("Declining to convoke (tapIds empty) leaves the cost intact", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const knightId = mkEntityId(23100);
    const bear1Id = mkEntityId(23101);

    const knightDef = parseCard(convokeKnightSrc, "convoke_knight.txt");
    const knightPaper: PaperCard = {
      name: "Convoke Knight",
      edition: "TEST",
      collectorNumber: "1",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: knightDef,
    };
    const knightCard = addCardToHand(game, knightPaper, seat0, knightId);
    knightCard.activateAbilitiesFromDefinition();
    knightCard.activateKeywordsFromDefinition(game);

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
    const bear1 = addCardToBattlefield(game, bearPaper, seat0, bear1Id);

    // Pool has full {3}{G}.
    const pool = new ManaPool();
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colored(Color.Green));
    game.getPlayer(seat0).manaPool = pool;
    expect(pool.size()).toBe(4);

    const { result: stackItem, tappedIds } = drainCast(
      game.castPipeline.run({
        castingPlayer: seat0,
        sourceCardId: knightId,
        originZone: ZoneType.Hand,
        asSpecialAction: false,
      }) as Generator<{ kind: string }, StackItem | null, unknown>,
      false, // do not tap
    );

    expect(stackItem).not.toBeNull();
    expect(tappedIds).toEqual([]);
    // Full {3}{G} drained — no Convoke discount.
    expect(pool.size()).toBe(0);
    // Bear was not tapped.
    expect(bear1.tapped).toBe(false);
  });

  it("Smoke: convoke handler registers and adds 'convoke' to card.keywords", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const knightId = mkEntityId(23200);
    const knightDef = parseCard(convokeKnightSrc, "convoke_knight.txt");
    const knightPaper: PaperCard = {
      name: "Convoke Knight",
      edition: "TEST",
      collectorNumber: "1",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: knightDef,
    };
    const card = addCardToHand(game, knightPaper, seat0, knightId);
    card.activateKeywordsFromDefinition(game);
    expect(card.keywords?.has("convoke")).toBe(true);
  });
});

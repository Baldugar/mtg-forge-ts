import { parseCard } from "@mtg-forge-ts/cards";
// SPDX-License-Identifier: GPL-3.0-or-later
// Task 59 — verify that CastPipeline.finalizeStackItem wires a real
// SpellAbility resolver onto the StackItem when the source Card has
// spellAbilities populated via activateAbilitiesFromDefinition(). Cards
// without spellAbilities (SP2 synthetic fixtures) continue to get
// resolver: null so existing tests are unaffected.
import type { EntityId, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { SpellAbility } from "../ability/spell-ability.js";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { resolveStackItem } from "../resolve/effect-resolve.js";
import type { StackItem } from "../stack/stack-item.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";
import type { CastProposal } from "./cast-pipeline.js";

// Self-register effects: DealDamageEffect → effectRegistry
import "../ability/effects/index.js";
// SVar selectors (needed for evaluateParamNumber inside DealDamageEffect)
import "../svar/selectors/number.js";

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

const boltSrc = `${[
  "Name:Lightning Bolt",
  "ManaCost:R",
  "Types:Instant",
  "A:SP$ DealDamage | Cost$ R | NumDmg$ 3 | ValidTgts$ Any | SpellDescription$ CARDNAME deals 3 damage to any target.",
  "Oracle:Lightning Bolt deals 3 damage to any target.",
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
  const z = game.getPlayer(seat).zones.get(ZoneType.Hand);
  if (!z) throw new Error("test: missing hand zone");
  z.add(id);
  return card;
};

/**
 * Drain a generator while auto-skipping SpellCast events and feeding
 * decision responses in order.
 */
const drainWithResponses = <R>(
  gen: Generator<{ kind: string }, R, unknown>,
  responses: readonly unknown[],
): R => {
  let idx = 0;
  let step = gen.next();
  while (!step.done) {
    const y = step.value as { kind: string; event?: { kind?: string } };
    const isSpellCast = y.kind === "event" && y.event?.kind === "SpellCast";
    if (y.kind === "decision" && !isSpellCast && idx < responses.length) {
      step = gen.next(responses[idx]);
      idx++;
    } else {
      step = gen.next();
    }
  }
  return step.value;
};

/**
 * Drain a resolver generator. Auto-responds to orderReplacements; other
 * decisions fail the test.
 */
const drainResolver = (gen: Generator<unknown, void, unknown>): void => {
  let step = gen.next();
  while (!step.done) {
    const y = step.value as { kind?: string; request?: { kind?: string; replacementIds?: number[] } };
    if (y.kind === "decision" && y.request?.kind === "orderReplacements") {
      step = gen.next({ order: [...(y.request.replacementIds ?? [])] });
    } else {
      step = gen.next();
    }
  }
};

describe("Task 59 — CastPipeline.finalizeStackItem resolver wiring", () => {
  it("resolver is null when card has no spellAbilities (SP2 synthetic cards)", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const cardId = mkEntityId(100);
    const syntheticPaper: PaperCard = {
      name: "Synthetic",
      edition: "TST",
      collectorNumber: "001",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
    };
    addCardToHand(game, syntheticPaper, seat0, cardId);

    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: cardId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const item = drainWithResponses(
      game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
      [],
    );
    expect(item).not.toBeNull();
    expect((item as StackItem).resolver).toBeNull();
  });

  it("resolver is non-null when card has spellAbilities from activateAbilitiesFromDefinition", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const cardId = mkEntityId(200);
    const def = parseCard(boltSrc, "lightning_bolt.txt");
    const boltPaper: PaperCard = {
      name: "Lightning Bolt",
      edition: "LEA",
      collectorNumber: "161",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };
    const card = addCardToHand(game, boltPaper, seat0, cardId);
    card.activateAbilitiesFromDefinition();

    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: cardId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const item = drainWithResponses(
      game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
      [],
    );
    expect(item).not.toBeNull();
    const si = item as StackItem;
    expect(si.resolver).not.toBeNull();
    expect(si.resolver).toBeDefined();
  });

  it("driving the resolver via resolveStackItem deals 3 damage to a player target", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const cardId = mkEntityId(300);
    const def = parseCard(boltSrc, "lightning_bolt.txt");
    const boltPaper: PaperCard = {
      name: "Lightning Bolt",
      edition: "LEA",
      collectorNumber: "161",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };
    const card = addCardToHand(game, boltPaper, seat0, cardId);
    card.activateAbilitiesFromDefinition();

    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: cardId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const item = drainWithResponses(
      game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
      [],
    ) as StackItem;
    expect(item).not.toBeNull();

    // Build a patched stack item with targets bound to seat1.
    // The pipeline built the resolver with no targets (no targetRestriction
    // on the paper card). We rebuild the resolver with the correct target.
    const saTemplate = card.spellAbilities[0];
    if (!saTemplate)
      throw new Error("test: card has no spellAbilities after activateAbilitiesFromDefinition");
    const boundSa = new SpellAbility(
      saTemplate.ast,
      saTemplate.sourceCardId,
      saTemplate.controllerSeat,
      saTemplate.svars,
      [seat1 as unknown as EntityId],
    );
    const patchedItem: StackItem = { ...item, resolver: boundSa.makeResolver() };
    // The item is already on the stack from the cast pipeline. Pop it and
    // push the patched version.
    game.sharedZones.stack.pop();
    game.sharedZones.stack.push(patchedItem);

    const lifeBefore = game.getPlayer(seat1).life;
    drainResolver(resolveStackItem(game, patchedItem) as Generator<unknown, void, unknown>);
    expect(game.getPlayer(seat1).life).toBe(lifeBefore - 3);
  });
});

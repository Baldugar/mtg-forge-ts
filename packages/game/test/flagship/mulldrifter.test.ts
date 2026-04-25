// SPDX-License-Identifier: GPL-3.0-or-later
// T3 — Mulldrifter ETB flagship integration test.
// Exercises the complete parse → build → cast → resolve → ETB-trigger → draw pipeline:
//   1. Parse Mulldrifter source (ETB draw 2).
//   2. Construct PaperCard + Card. Call activateTriggersFromDefinition() and
//      activateAbilitiesFromDefinition() to wire both spellAbilities (for
//      casting) and triggeredAbilities (for ETB).
//   3. Place Mulldrifter in hand. Seed 5 colorless mana (4U cost).
//   4. Put 2 filler cards in the library so draw has targets.
//   5. Run CastPipeline to put Mulldrifter on the stack.
//   6. Patch the stack item with alternativeZoneDestination = Battlefield
//      (creature resolution: the engine doesn't yet auto-detect card type for
//      permanent resolution — flagged below for follow-up).
//   7. Resolve the spell: moveTo(Mulldrifter, Battlefield) fires CardChangedZone
//      → TriggerRegistry queues the ETB trigger.
//   8. Drain the trigger queue: priority orchestrator reads trigger.resolver,
//      pushes a triggeredAbility stack item.
//   9. Resolve the triggered stack item: DrawEffect draws 2.
//  10. Assert: Mulldrifter on Battlefield, controller hand +2, DrawCards events ×2.
//
// Integration gap / follow-up: the engine does not yet auto-set
// alternativeZoneDestination = Battlefield for permanent (creature/artifact/
// enchantment/planeswalker) spells. This is a known SP3 gap. The test
// manually patches the stack item with the correct destination so the ETB
// machinery can be exercised. When the engine gains auto-permanent-resolution,
// this patch can be removed and the test stands as-is.

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
import type { StackItem, StackItemResolver } from "../../src/stack/stack-item.js";
import { Battlefield } from "../../src/zone/zones/battlefield.js";
import { Graveyard } from "../../src/zone/zones/graveyard.js";
import { Hand } from "../../src/zone/zones/hand.js";
import { Library } from "../../src/zone/zones/library.js";

// Self-register all effects into effectRegistry (Draw, DealDamage, GainLife, …)
import "../../src/ability/effects/index.js";
// Register cost parts into costPartRegistry
import "../../src/cost/parts/index.js";
// SVar number selectors
import "../../src/svar/selectors/number.js";
// Register trigger handlers (ChangesZoneTrigger, PhaseTrigger)
import "../../src/trigger/handlers/index.js";

// ---------------------------------------------------------------------------
// Mulldrifter card source (4U Elemental, ETB draw 2)
// ---------------------------------------------------------------------------

const mulldrifterSrc = `Name:Mulldrifter
ManaCost:4 U
Types:Creature Elemental
PT:2/2
K:Flying
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDraw | TriggerDescription$ When this enters, draw a card.
SVar:TrigDraw:DB$ Draw | NumCards$ 2
Oracle:Flying. When Mulldrifter enters, its controller draws two cards.
`;

// ---------------------------------------------------------------------------
// Shared game boilerplate
// ---------------------------------------------------------------------------

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

const addCardToLibrary = (game: Game, paper: PaperCard, seat: PlayerSeat, id: EntityId): Card => {
  const card = new Card(id, paper, seat, seat, ZoneType.Library);
  game.cards.set(id, card);
  const lib = game.getPlayer(seat).zones.get(ZoneType.Library);
  if (!lib) throw new Error("test: missing library zone");
  lib.add(id);
  return card;
};

/**
 * Drive the cast generator. Responds to activateManaAbilities with done:true.
 * Returns the finalized StackItem (or null on abort) plus all event kinds.
 */
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

/**
 * Drain a resolver generator. Auto-responds to orderReplacements decisions.
 * Collects all event kinds emitted.
 */
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

/**
 * Drive a priority-window generator fragment: drain triggers from the
 * registry and push triggered-ability stack items. Returns the stack item
 * pushed for the first trigger, or null if none.
 *
 * This replicates the trigger-drain inner loop from runPriorityWindow
 * so we can test the trigger machinery without running the full orchestrator.
 */
const drainTriggersIntoStack = (game: Game): StackItem | null => {
  const pending = game.triggerRegistry.drain();
  if (pending.length === 0) return null;
  const pt = pending[0];
  if (!pt) return null;
  const trigger = game.triggerRegistry.getTrigger(pt.triggerId);
  const triggerResolver =
    (trigger as { readonly resolver?: StackItemResolver | null } | undefined)?.resolver ?? null;
  const stackItem: StackItem = {
    id: game.newEntityId(),
    sourceCardId: pt.sourceCardId,
    controllerSeat: pt.sourceControllerAtFire,
    kind: "triggeredAbility",
    isCast: false,
    targets: null,
    modes: [],
    xValue: null,
    costPaid: null,
    provenance: {
      originZone: game.cards.get(pt.sourceCardId)?.zone ?? ZoneType.Battlefield,
      altCostUsed: null,
      additionalCostsPaid: [],
    },
    triggerId: pt.triggerId,
    lki: pt.lki,
    event: pt.event,
    resolver: triggerResolver,
  };
  game.sharedZones.stack.push(stackItem);
  return stackItem;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Flagship: Mulldrifter ETB end-to-end integration", () => {
  it("Mulldrifter enters battlefield → ETB fires → controller draws 2 cards", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0); // caster / controller
    const seat1 = mkPlayerSeat(1); // opponent

    const mulldrifterId = mkEntityId(1000);

    // 1. Parse Mulldrifter definition and build PaperCard
    const def = parseCard(mulldrifterSrc, "mulldrifter.txt");
    const mulldrifterPaper: PaperCard = {
      name: "Mulldrifter",
      edition: "LRW",
      collectorNumber: "68",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };

    // 2. Add Mulldrifter to caster's hand; activate abilities (for casting)
    //    and triggers (for ETB). Both must be activated before the ETB fires.
    //
    // INTEGRATION NOTE: activateTriggersFromDefinition must be called before
    // the card enters the battlefield so the TriggerRegistry has the ETB
    // trigger registered when CardChangedZone fires. The engine does NOT yet
    // auto-call this on zone entry — that wiring is a follow-up for SP3's
    // moveTo hook. For now, the test calls it manually.
    const mulldrifterCard = addCardToHand(game, mulldrifterPaper, seat0, mulldrifterId);
    mulldrifterCard.activateAbilitiesFromDefinition();
    mulldrifterCard.activateTriggersFromDefinition(game);

    // Verify the trigger is registered and has a resolver
    expect(mulldrifterCard.triggeredAbilities).toHaveLength(1);
    const ta = mulldrifterCard.triggeredAbilities[0];
    if (!ta) throw new Error("test: expected triggered ability at index 0");
    const taWithResolver = ta as unknown as { resolver?: StackItemResolver | null };
    expect(taWithResolver.resolver).not.toBeNull();

    // 3. Put 2 filler cards in the library — DrawEffect needs real cards to draw
    const filler: PaperCard = {
      name: "Filler",
      edition: "T",
      collectorNumber: "0",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
    };
    addCardToLibrary(game, filler, seat0, mkEntityId(1001));
    addCardToLibrary(game, filler, seat0, mkEntityId(1002));
    const lib = game.getPlayer(seat0).zones.get(ZoneType.Library);
    if (!lib) throw new Error("test: missing library zone");
    expect(lib.size).toBe(2);

    // 4. Seed 5 mana: 4 colorless (satisfies generic pips) + 1 blue (Mulldrifter costs 4U)
    const pool = new ManaPool();
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colored(Color.Blue));
    game.getPlayer(seat0).manaPool = pool;
    expect(pool.size()).toBe(5);

    const hand = game.getPlayer(seat0).zones.get(ZoneType.Hand);
    if (!hand) throw new Error("test: missing hand zone");

    // 5. Cast Mulldrifter — CastPipeline
    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: mulldrifterId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const { events: castEvents, result: rawStackItem } = drainCast(
      game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );
    expect(rawStackItem).not.toBeNull();
    expect(castEvents).toContain("SpellCast");
    expect(castEvents).toContain("CostPaid");
    expect(pool.size()).toBe(0);

    // Mulldrifter is still in "Hand" zone-wise at this point (the CastPipeline
    // doesn't move it — the card remains in the hand zone until resolveStackItem
    // calls moveTo). The hand still physically contains it.
    expect(mulldrifterCard.zone).toBe(ZoneType.Hand);

    // 6. Patch the stack item with alternativeZoneDestination = Battlefield.
    //    Creature spells resolve to the battlefield, but the engine's
    //    resolveStackItem uses Graveyard as the default destination for spells
    //    (it doesn't yet detect card type). Until that gap is fixed, the test
    //    patches the provenance.
    const spellItem = rawStackItem as StackItem;
    const patchedSpellItem: StackItem = {
      ...spellItem,
      provenance: {
        ...spellItem.provenance,
        alternativeZoneDestination: ZoneType.Battlefield,
      },
    };
    // Replace the spell item on the stack
    game.sharedZones.stack.pop();
    game.sharedZones.stack.push(patchedSpellItem);

    // 7. Resolve the Mulldrifter spell: card moves Hand → Battlefield.
    //    This emits CardChangedZone(toZone: Battlefield) → TriggerRegistry
    //    sees it → ETB trigger queues.
    const spellResolveEvents = drainResolver(
      resolveStackItem(game, patchedSpellItem) as Generator<unknown, void, unknown>,
    );
    expect(spellResolveEvents).toContain("StackItemResolved");
    expect(spellResolveEvents).toContain("CardChangedZone");

    // Mulldrifter is now on the battlefield
    expect(mulldrifterCard.zone).toBe(ZoneType.Battlefield);

    // 8. Drain the trigger queue: the ETB trigger should be pending
    const pendingCount = game.triggerRegistry.peekPending().length;
    expect(pendingCount).toBe(1);
    const triggerStackItem = drainTriggersIntoStack(game);
    expect(triggerStackItem).not.toBeNull();
    if (!triggerStackItem) throw new Error("test: no trigger stack item produced");
    expect(triggerStackItem.kind).toBe("triggeredAbility");
    expect(triggerStackItem.resolver).not.toBeNull();

    // 9. Resolve the triggered stack item: DrawEffect draws 2 cards
    const handSizeAfterSpell = hand.size; // Mulldrifter left hand during resolve
    const triggerResolveEvents = drainResolver(
      resolveStackItem(game, triggerStackItem) as Generator<unknown, void, unknown>,
    );

    // Draw 2: two CardDrawn events should fire
    const cardDrawnEvents = triggerResolveEvents.filter((e) => e === "CardDrawn");
    expect(cardDrawnEvents).toHaveLength(2);
    expect(triggerResolveEvents).toContain("StackItemResolved");

    // Hand should have grown by 2 (Mulldrifter already left, 2 drawn)
    expect(hand.size).toBe(handSizeAfterSpell + 2);
    // Library is now empty (drew both cards)
    expect(lib.size).toBe(0);

    // 10. Sanity checks
    // Mulldrifter is on the battlefield
    expect(mulldrifterCard.zone).toBe(ZoneType.Battlefield);
    // No DamageDealt events (sanity check — no damage was dealt)
    expect(triggerResolveEvents.filter((e) => e === "DamageDealt")).toHaveLength(0);
    // Opponent life unchanged
    expect(game.getPlayer(seat1).life).toBe(20);
    // Stack is empty
    expect(game.sharedZones.stack.size).toBe(0);
  });

  it("Mulldrifter ETB fires exactly once (no duplicate triggers)", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);

    const mulldrifterId = mkEntityId(2000);
    const def = parseCard(mulldrifterSrc, "mulldrifter.txt");
    const mulldrifterPaper: PaperCard = {
      name: "Mulldrifter",
      edition: "LRW",
      collectorNumber: "68",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };
    const mulldrifterCard = addCardToHand(game, mulldrifterPaper, seat0, mulldrifterId);
    mulldrifterCard.activateAbilitiesFromDefinition();
    mulldrifterCard.activateTriggersFromDefinition(game);

    // Seed mana + library cards
    const pool = new ManaPool();
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colored(Color.Blue));
    game.getPlayer(seat0).manaPool = pool;

    const filler: PaperCard = {
      name: "Filler",
      edition: "T",
      collectorNumber: "0",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
    };
    addCardToLibrary(game, filler, seat0, mkEntityId(2001));
    addCardToLibrary(game, filler, seat0, mkEntityId(2002));

    // Cast and resolve to battlefield
    const { result: rawStackItem } = drainCast(
      game.castPipeline.run({
        castingPlayer: seat0,
        sourceCardId: mulldrifterId,
        originZone: ZoneType.Hand,
        asSpecialAction: false,
      }) as Generator<{ kind: string }, StackItem | null, unknown>,
    );
    expect(rawStackItem).not.toBeNull();

    const spellItem = rawStackItem as StackItem;
    const patchedItem: StackItem = {
      ...spellItem,
      provenance: { ...spellItem.provenance, alternativeZoneDestination: ZoneType.Battlefield },
    };
    game.sharedZones.stack.pop();
    game.sharedZones.stack.push(patchedItem);
    drainResolver(resolveStackItem(game, patchedItem) as Generator<unknown, void, unknown>);

    // Exactly one trigger should be pending
    const pending = game.triggerRegistry.peekPending();
    expect(pending).toHaveLength(1);
  });
});

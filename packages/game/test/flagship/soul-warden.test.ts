// SPDX-License-Identifier: GPL-3.0-or-later
// F6 — Soul Warden flagship integration test.
// Tests ChangesZoneAllTrigger + GainLifeEffect via triggered ability.
//
// Scenario: Cast Soul Warden. When it enters the battlefield, it triggers its
// own ChangesZoneAll trigger (because Soul Warden IS a creature entering).
// The trigger fires GainLife$ 1 for the controller: life 20 → 21.
//
// This validates:
//   - ChangesZoneAllTrigger matches the creature's own ETB event
//   - Self-triggering on own entry works (the trigger is registered before
//     the moveTo fires, so it sees the CardChangedZone event)
//   - GainLifeEffect runs from a triggered ability resolver
//
// Pipeline (mirrors Mulldrifter flagship structure):
//   1. Parse Soul Warden.
//   2. activateAbilitiesFromDefinition() — SpellAbility for casting.
//   3. activateTriggersFromDefinition(game) — registers ChangesZoneAll trigger.
//   4. Cast Soul Warden (1W).
//   5. Patch StackItem with alternativeZoneDestination = Battlefield.
//   6. Resolve spell → moveTo(Battlefield) fires CardChangedZone → trigger queues.
//   7. Drain trigger queue → push triggeredAbility StackItem.
//   8. Resolve triggered StackItem → GainLife 1 fires.
//   9. Assert: life 20 → 21, Soul Warden on battlefield, stack empty.
import { parseCard } from "@mtg-forge-ts/cards";
import type { EntityId, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  CardType,
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

// Self-register all effects
import "../../src/ability/effects/index.js";
// Register cost parts
import "../../src/cost/parts/index.js";
// SVar number selectors
import "../../src/svar/selectors/number.js";
// Register trigger handlers (ChangesZoneAllTrigger etc.)
import "../../src/trigger/handlers/index.js";

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

// Soul Warden: T:Mode$ ChangesZoneAll | Origin$ Any | Destination$ Battlefield
//   | ValidCards$ Creature | Execute$ TrigGainLife
// SVar:TrigGainLife:DB$ GainLife | LifeAmount$ 1
const soulWardenSrc = `${[
  "Name:Soul Warden",
  "ManaCost:W",
  "Types:Creature Human Cleric",
  "PT:1/1",
  "T:Mode$ ChangesZoneAll | Origin$ Any | Destination$ Battlefield | ValidCards$ Creature | Execute$ TrigGainLife | TriggerDescription$ Whenever a creature enters, you gain 1 life.",
  "SVar:TrigGainLife:DB$ GainLife | LifeAmount$ 1",
  "Oracle:Whenever a creature enters, you gain 1 life.",
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

// SP4 gap workaround: deriveBaseCharacteristics does NOT read CardType from
// PaperCard.definition. ChangesZoneAllTrigger.matches() calls
// game.layerEngine.computeCharacteristics() to check chars.types.has(CardType.Creature).
// Without Layer4 seeding, Soul Warden's own ETB event is not recognised as a Creature
// entering and the trigger never fires. Seed a global "add Creature" Layer4 effect
// (same pattern as destroy-all.test.ts unit tests) before casting.
const seedCreatureType = (game: Game): void => {
  game.layerEngine.typeEffects.push({
    kind: "add",
    cardType: CardType.Creature,
    isCda: false,
    timestamp: 0,
    sourceAbilityId: null,
  });
};

/**
 * Drain the trigger registry into a stack item (mirrors Mulldrifter pattern).
 * Returns the first pending triggered ability as a StackItem, or null if none.
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

describe("Flagship: Soul Warden end-to-end integration", () => {
  it("ETB trigger fires on own entry — life 20 → 21, Soul Warden on battlefield", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0); // caster / controller
    const seat1 = mkPlayerSeat(1); // opponent

    const soulWardenId = mkEntityId(13000);

    // 1. Parse Soul Warden and build PaperCard
    const def = parseCard(soulWardenSrc, "soul_warden.txt");
    const soulWardenPaper: PaperCard = {
      name: "Soul Warden",
      edition: "EXO",
      collectorNumber: "22",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };

    // 2. Add Soul Warden to hand; activate abilities and triggers.
    //    activateTriggersFromDefinition MUST be called before casting
    //    so the trigger is registered when CardChangedZone fires.
    const soulWardenCard = addCardToHand(game, soulWardenPaper, seat0, soulWardenId);
    soulWardenCard.activateAbilitiesFromDefinition();
    soulWardenCard.activateTriggersFromDefinition(game);

    // Verify trigger registered with resolver
    expect(soulWardenCard.triggeredAbilities).toHaveLength(1);
    const ta = soulWardenCard.triggeredAbilities[0];
    if (!ta) throw new Error("test: expected triggered ability");
    const taWithResolver = ta as unknown as { resolver?: StackItemResolver | null };
    expect(taWithResolver.resolver).not.toBeNull();

    // 3. Seed Layer4 Creature type (SP4 workaround — see comment above).
    //    Must be seeded before resolveStackItem fires CardChangedZone, so that
    //    ChangesZoneAllTrigger.matches() sees Soul Warden as a Creature.
    seedCreatureType(game);

    // 4. Seed 1 white mana (Soul Warden costs W)
    const pool = new ManaPool();
    pool.add(ManaProduced.colored(Color.White));
    game.getPlayer(seat0).manaPool = pool;

    // Verify initial life
    expect(game.getPlayer(seat0).life).toBe(20);
    expect(game.getPlayer(seat1).life).toBe(20);

    // 5. Cast Soul Warden
    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: soulWardenId,
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

    // 6. Patch the stack item: creature spell resolves to Battlefield.
    //    (Same gap as Mulldrifter: auto-destination for permanents not yet
    //    implemented in resolveStackItem. Patch manually.)
    const spellItem = rawStackItem as StackItem;
    const patchedSpellItem: StackItem = {
      ...spellItem,
      provenance: {
        ...spellItem.provenance,
        alternativeZoneDestination: ZoneType.Battlefield,
      },
    };
    game.sharedZones.stack.pop();
    game.sharedZones.stack.push(patchedSpellItem);

    // 7. Resolve the spell → Soul Warden moves Hand → Battlefield.
    //    CardChangedZone fires → TriggerRegistry sees it → ETB trigger queues.
    const spellResolveEvents = drainResolver(
      resolveStackItem(game, patchedSpellItem) as Generator<unknown, void, unknown>,
    );
    expect(spellResolveEvents).toContain("StackItemResolved");
    expect(spellResolveEvents).toContain("CardChangedZone");

    // Soul Warden is on the battlefield
    expect(soulWardenCard.zone).toBe(ZoneType.Battlefield);

    // 8. Drain the trigger queue: the ETB trigger should be pending.
    //    ChangesZoneAllTrigger matches the CardChangedZone event where
    //    the card is a Creature entering the Battlefield (Soul Warden itself).
    const pendingCount = game.triggerRegistry.peekPending().length;
    expect(pendingCount).toBe(1);

    const triggerStackItem = drainTriggersIntoStack(game);
    expect(triggerStackItem).not.toBeNull();
    if (!triggerStackItem) throw new Error("test: no trigger stack item produced");
    expect(triggerStackItem.kind).toBe("triggeredAbility");
    expect(triggerStackItem.resolver).not.toBeNull();

    // 9. Resolve the triggered ability: GainLife 1
    const triggerResolveEvents = drainResolver(
      resolveStackItem(game, triggerStackItem) as Generator<unknown, void, unknown>,
    );

    expect(triggerResolveEvents).toContain("LifeChanged");
    expect(triggerResolveEvents).toContain("StackItemResolved");

    // 10. Assertions
    // Life gained: 20 + 1 = 21
    expect(game.getPlayer(seat0).life).toBe(21);
    // Opponent life unchanged
    expect(game.getPlayer(seat1).life).toBe(20);
    // Soul Warden on battlefield
    expect(soulWardenCard.zone).toBe(ZoneType.Battlefield);
    // Stack is empty
    expect(game.sharedZones.stack.size).toBe(0);
  });

  it("ChangesZoneAllTrigger fires exactly once on Soul Warden entry", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const soulWardenId = mkEntityId(14000);

    const def = parseCard(soulWardenSrc, "soul_warden.txt");
    const soulWardenPaper: PaperCard = {
      name: "Soul Warden",
      edition: "EXO",
      collectorNumber: "22",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };

    const soulWardenCard = addCardToHand(game, soulWardenPaper, seat0, soulWardenId);
    soulWardenCard.activateAbilitiesFromDefinition();
    soulWardenCard.activateTriggersFromDefinition(game);

    // SP4 gap workaround: seed Layer4 Creature type before resolve.
    seedCreatureType(game);

    const pool = new ManaPool();
    pool.add(ManaProduced.colored(Color.White));
    game.getPlayer(seat0).manaPool = pool;

    const { result: rawStackItem } = drainCast(
      game.castPipeline.run({
        castingPlayer: seat0,
        sourceCardId: soulWardenId,
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

    // Exactly one trigger pending
    const pending = game.triggerRegistry.peekPending();
    expect(pending).toHaveLength(1);
  });
});

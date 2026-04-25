// SPDX-License-Identifier: GPL-3.0-or-later
// F11 — Soul Warden + Grizzly Bears chained ETB trigger test.
//
// Tests that a ChangesZoneAll trigger registered by one card fires for ANOTHER
// card's ETB event (not just for the trigger source's own entry).
//
// Scenario:
//   1. Cast Soul Warden (W). Resolves. ETB fires its own ChangesZoneAll trigger.
//      Soul Warden is a Creature entering → trigger matches → GainLife 1 →
//      controller life: 20 → 21.
//   2. Cast Grizzly Bears (1G). Resolves. Soul Warden's already-registered
//      trigger fires AGAIN for the Bears' ETB event. Bears is a Creature
//      entering Battlefield → trigger matches → GainLife 1 →
//      controller life: 21 → 22.
//   3. Final assertion: controller life is 22.
//
// This validates:
//   - TriggeredAbility persists in game.triggerRegistry across multiple events
//   - ChangesZoneAllTrigger.matches() fires for OTHER cards' ETBs
//   - Two-step ETB chain works end-to-end
//
// Both Soul Warden and Grizzly Bears carry a PaperCard.definition whose
// types include Creature; deriveBaseCharacteristics reads these directly.
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
  cardDataSyncedAt: "2026-04-24T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};

const soulWardenSrc = `${[
  "Name:Soul Warden",
  "ManaCost:W",
  "Types:Creature Human Cleric",
  "PT:1/1",
  "T:Mode$ ChangesZoneAll | Origin$ Any | Destination$ Battlefield | ValidCards$ Creature | Execute$ TrigGainLife | TriggerDescription$ Whenever a creature enters, you gain 1 life.",
  "SVar:TrigGainLife:DB$ GainLife | LifeAmount$ 1",
  "Oracle:Whenever a creature enters, you gain 1 life.",
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

/**
 * Drain the trigger registry into a stack item and resolve it.
 * Returns the life gain events that occurred.
 */
const drainAndResolveTrigger = (game: Game): string[] => {
  const pending = game.triggerRegistry.drain();
  if (pending.length === 0) return [];
  const pt = pending[0];
  if (!pt) return [];
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
  const events = drainResolver(resolveStackItem(game, stackItem) as Generator<unknown, void, unknown>);
  return events;
};

describe("Flagship: Soul Warden + Bears chained ETB — trigger fires for both creatures", () => {
  it("Soul Warden trigger fires for own entry AND for Bears entry — life 20 → 21 → 22", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0); // controller of both cards

    const soulWardenId = mkEntityId(22000);
    const bearsId = mkEntityId(22001);

    // 1. Parse both cards
    const swDef = parseCard(soulWardenSrc, "soul_warden.txt");
    const swPaper: PaperCard = {
      name: "Soul Warden",
      edition: "EXO",
      collectorNumber: "22",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: swDef,
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

    // 2. Add Soul Warden to hand; activate abilities AND triggers
    // deriveBaseCharacteristics now reads Creature type from PaperCard.definition,
    // so no Layer4 seeding is needed.
    const swCard = addCardToHand(game, swPaper, seat0, soulWardenId);
    swCard.activateAbilitiesFromDefinition();
    swCard.activateTriggersFromDefinition(game);

    expect(swCard.triggeredAbilities).toHaveLength(1);
    // Trigger registered with game.triggerRegistry
    expect(game.triggerRegistry.size()).toBe(1);

    // Initial life
    expect(game.getPlayer(seat0).life).toBe(20);

    // ── Phase 1: Cast + resolve Soul Warden ─────────────────────────────

    // 3. Seed 1W to cast Soul Warden
    const pool1 = new ManaPool();
    pool1.add(ManaProduced.colored(Color.White));
    game.getPlayer(seat0).manaPool = pool1;

    const swProposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: soulWardenId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const { result: swRawStack } = drainCast(
      game.castPipeline.run(swProposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );
    expect(swRawStack).not.toBeNull();

    // Patch to Battlefield destination (creature spell)
    const swSpellItem = swRawStack as StackItem;
    const swPatched: StackItem = {
      ...swSpellItem,
      provenance: { ...swSpellItem.provenance, alternativeZoneDestination: ZoneType.Battlefield },
    };
    game.sharedZones.stack.pop();
    game.sharedZones.stack.push(swPatched);

    // 5. Resolve Soul Warden → ETB → CardChangedZone fires →
    //    ChangesZoneAllTrigger.matches() sees Soul Warden (Creature → Battlefield) → queues trigger
    const swResolveEvents = drainResolver(
      resolveStackItem(game, swPatched) as Generator<unknown, void, unknown>,
    );
    expect(swResolveEvents).toContain("CardChangedZone");
    expect(swCard.zone).toBe(ZoneType.Battlefield);

    // Trigger queued
    expect(game.triggerRegistry.peekPending()).toHaveLength(1);

    // 6. Resolve the Soul Warden ETB trigger → GainLife 1
    const swTriggerEvents = drainAndResolveTrigger(game);
    expect(swTriggerEvents).toContain("LifeChanged");

    // Life after Soul Warden ETB: 20 → 21
    expect(game.getPlayer(seat0).life).toBe(21);

    // Stack empty, trigger queue empty
    expect(game.sharedZones.stack.size).toBe(0);
    expect(game.triggerRegistry.peekPending()).toHaveLength(0);

    // ── Phase 2: Cast + resolve Grizzly Bears ─────────────────────────────

    // 7. Add Grizzly Bears to hand; activate abilities (no triggers on bears)
    const bearsCard = addCardToHand(game, bearPaper, seat0, bearsId);
    bearsCard.activateAbilitiesFromDefinition();

    // Soul Warden's trigger is STILL registered — no re-registration needed
    expect(game.triggerRegistry.size()).toBe(1);

    // 8. Seed 1G + 1 colorless to cast Grizzly Bears (1G cost)
    const pool2 = new ManaPool();
    pool2.add(ManaProduced.colored(Color.Green));
    pool2.add(ManaProduced.colorless());
    game.getPlayer(seat0).manaPool = pool2;

    const bearsProposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: bearsId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const { result: bearsRawStack } = drainCast(
      game.castPipeline.run(bearsProposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );
    expect(bearsRawStack).not.toBeNull();

    // Patch to Battlefield destination
    const bearsSpellItem = bearsRawStack as StackItem;
    const bearsPatched: StackItem = {
      ...bearsSpellItem,
      provenance: { ...bearsSpellItem.provenance, alternativeZoneDestination: ZoneType.Battlefield },
    };
    game.sharedZones.stack.pop();
    game.sharedZones.stack.push(bearsPatched);

    // 9. Resolve Grizzly Bears → ETB → CardChangedZone fires →
    //    Soul Warden's trigger fires AGAIN for Bears entering
    const bearsResolveEvents = drainResolver(
      resolveStackItem(game, bearsPatched) as Generator<unknown, void, unknown>,
    );
    expect(bearsResolveEvents).toContain("CardChangedZone");
    expect(bearsCard.zone).toBe(ZoneType.Battlefield);

    // Soul Warden's trigger queued again for Bears' ETB
    expect(game.triggerRegistry.peekPending()).toHaveLength(1);

    // 10. Resolve the Bears ETB trigger → GainLife 1 (triggered by Soul Warden)
    const bearsTriggerEvents = drainAndResolveTrigger(game);
    expect(bearsTriggerEvents).toContain("LifeChanged");

    // Life after Bears ETB: 21 → 22
    expect(game.getPlayer(seat0).life).toBe(22);

    // Stack empty, trigger queue empty
    expect(game.sharedZones.stack.size).toBe(0);
    expect(game.triggerRegistry.peekPending()).toHaveLength(0);

    // Both creatures on battlefield
    expect(swCard.zone).toBe(ZoneType.Battlefield);
    expect(bearsCard.zone).toBe(ZoneType.Battlefield);
  });
});

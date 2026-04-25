// SPDX-License-Identifier: GPL-3.0-or-later
// F4 — Giant Growth flagship integration test.
// Tests PumpEffect (SP$ Pump): a 2/2 creature gets +3/+3 until end of turn.
// After PumpEffect resolves, LayerEngine reports 5/5. After TurnEnded event,
// the untilEndOfTurn ContinuousEffect expires and LayerEngine reports 2/2.
//
// KNOWN DESIGN GAP — PumpEffect does not scope pt7c effects to a specific
// target card: game.layerEngine.pt7c is a global array applied to EVERY card
// when computeCharacteristics(cardId) runs. For a board with a single
// creature this is correct behavior. For boards with multiple creatures the
// pump would apply to all of them, which is a Layer 7c scoping bug.
// Documented here; a targetId field on Layer7cEffect is needed to fix it.
// This test asserts the current (working) behavior for a single-creature board.
//
// Pipeline: parse Giant Growth → cast (G) → resolve with 2/2 creature as
// target → LayerEngine 5/5 → emit TurnEnded → LayerEngine 2/2.
import { parseCard } from "@mtg-forge-ts/cards";
import type { EntityId, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  Color,
  DEFAULT_PAPER_CARD_FLAGS,
  Layer,
  ManaProduced,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkEvent,
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

const giantGrowthSrc = `${[
  "Name:Giant Growth",
  "ManaCost:G",
  "Types:Instant",
  "A:SP$ Pump | Cost$ G | ValidTgts$ Creature | NumAtt$ 3 | NumDef$ 3 | SpellDescription$ Target creature gets +3/+3 until end of turn.",
  "Oracle:Target creature gets +3/+3 until end of turn.",
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

describe("Flagship: Giant Growth end-to-end integration", () => {
  it("+3/+3 UEOT: 2/2 becomes 5/5 after resolve, reverts to 2/2 after TurnEnded", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const ggId = mkEntityId(11000);
    const creatureId = mkEntityId(11001);

    // 1. Parse Giant Growth
    const ggDef = parseCard(giantGrowthSrc, "giant_growth.txt");
    const ggPaper: PaperCard = {
      name: "Giant Growth",
      edition: "LEA",
      collectorNumber: "187",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: ggDef,
    };

    // 2. Build Grizzly Bears as target
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

    // 3. Set up: Giant Growth in hand, Grizzly Bears on battlefield
    const ggCard = addCardToHand(game, ggPaper, seat0, ggId);
    ggCard.activateAbilitiesFromDefinition();

    // Place creature on battlefield.
    // NOTE: deriveBaseCharacteristics does NOT read PT from definition (SP2 gap —
    // base-characteristics.ts only reads `name` from definition). We seed the
    // base 2/2 via a Layer7b set effect, same pattern as the pump.test.ts unit test.
    addCardToBattlefield(game, bearPaper, seat0, creatureId);
    game.layerEngine.pt7b.push({
      kind: "set",
      power: 2,
      toughness: 2,
      timestamp: 0,
      sourceAbilityId: null,
    });

    // Verify base 2/2
    const charsBase = game.layerEngine.computeCharacteristics(creatureId);
    expect(charsBase.power).toBe(2);
    expect(charsBase.toughness).toBe(2);

    // 4. Seed 1 green mana
    const pool = new ManaPool();
    pool.add(ManaProduced.colored(Color.Green));
    game.getPlayer(seat0).manaPool = pool;

    // 5. Cast Giant Growth
    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: ggId,
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

    // 6. Patch the stack item with creatureId as target
    const saTemplate = ggCard.spellAbilities[0];
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

    // 7. Resolve Giant Growth
    const resolveEvents = drainResolver(
      resolveStackItem(game, patchedItem) as Generator<unknown, void, unknown>,
    );

    expect(resolveEvents).toContain("StackItemResolved");
    // Giant Growth in graveyard
    expect(ggCard.zone).toBe(ZoneType.Graveyard);

    // 8. ContinuousEffect registered; creature is now 5/5 via LayerEngine.
    expect(game.continuousEffectRegistry.size()).toBe(1);
    const charsAfter = game.layerEngine.computeCharacteristics(creatureId);
    expect(charsAfter.power).toBe(5);
    expect(charsAfter.toughness).toBe(5);

    // 9. Simulate end of turn: emit TurnEnded through game.emitEvent.
    //    game.emitEvent is synchronous — it routes the event to
    //    continuousEffectRegistry.onEvent which calls isExpired → unregisters.
    const turnEndedYield = game.emitEvent(mkEvent("TurnEnded", game.turn, game.phase, { activeSeat: seat0 }));
    // emitEvent returns the EngineYield for observer use; we discard it here.
    void turnEndedYield;

    // Drain the expired buffer (mimicking what the priority orchestrator does).
    const expired = game.continuousEffectRegistry.drainExpired();
    expect(expired).toHaveLength(1);
    expect(game.continuousEffectRegistry.size()).toBe(0);

    // 10. LayerEngine should report base 2/2 again after expiry.
    const charsAfterExpiry = game.layerEngine.computeCharacteristics(creatureId);
    expect(charsAfterExpiry.power).toBe(2);
    expect(charsAfterExpiry.toughness).toBe(2);
  });

  it("registers exactly one Layer7c ContinuousEffect with untilEndOfTurn duration", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const ggId = mkEntityId(12000);
    const creatureId = mkEntityId(12001);

    const ggDef = parseCard(giantGrowthSrc, "giant_growth.txt");
    const ggPaper: PaperCard = {
      name: "Giant Growth",
      edition: "LEA",
      collectorNumber: "187",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: ggDef,
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

    const ggCard = addCardToHand(game, ggPaper, seat0, ggId);
    ggCard.activateAbilitiesFromDefinition();
    addCardToBattlefield(game, bearPaper, seat0, creatureId);
    game.layerEngine.pt7b.push({ kind: "set", power: 2, toughness: 2, timestamp: 0, sourceAbilityId: null });

    const pool = new ManaPool();
    pool.add(ManaProduced.colored(Color.Green));
    game.getPlayer(seat0).manaPool = pool;

    const { result: stackItem } = drainCast(
      game.castPipeline.run({
        castingPlayer: seat0,
        sourceCardId: ggId,
        originZone: ZoneType.Hand,
        asSpecialAction: false,
      }) as Generator<{ kind: string }, StackItem | null, unknown>,
    );
    expect(stackItem).not.toBeNull();

    const saTemplate = ggCard.spellAbilities[0];
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

    drainResolver(resolveStackItem(game, patchedItem) as Generator<unknown, void, unknown>);

    // Verify continuous effect properties
    const effects = game.continuousEffects;
    expect(effects).toHaveLength(1);
    expect(effects[0]?.layer).toBe(Layer.L7c_PTModify);
    expect(effects[0]?.duration.kind).toBe("untilEndOfTurn");
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
// activateAbility orchestrator — Wave 8 target selection tests.
//
// Exercises CR 602.1b: when an activated ability publishes a ValidTgts$
// filter, the orchestrator must yield `chooseCastTargets` AFTER zone
// validation but BEFORE cost payment, validate the response, emit
// CardTargeted for card-typed targets, and bind the chosen targets onto
// a fresh SpellAbility so the resolver receives them.
//
// Coverage:
//   1. No-target ability path (regression check, mirrors Wave 5/6 pattern)
//   2. Player-target ability — chooseCastTargets yielded; no CardTargeted
//   3. Card-target ability — chooseCastTargets + CardTargeted emitted
//   4. Invalid (empty) selection rejected with IllegalDecisionError
import "./effects/index.js";
import "../cost/parts/index.js";
import "../svar/selectors/number.js";
import { parseCard } from "@mtg-forge-ts/cards";
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import {
  DEFAULT_PAPER_CARD_FLAGS,
  IllegalDecisionError,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { ManaPool } from "../mana/mana-pool.js";
import { resolveStackItem } from "../resolve/effect-resolve.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";
import { SpellAbility } from "./spell-ability.js";

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

const sourcePaper: PaperCard = {
  name: "TestSource",
  edition: "TST",
  collectorNumber: "1",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const bearSrc = `${["Name:Test Bear", "ManaCost:1 G", "Types:Creature Bear", "PT:2/2", "Oracle:"].join(
  "\n",
)}\n`;

const bearPaper = (): PaperCard => ({
  name: "Test Bear",
  edition: "TST",
  collectorNumber: "2",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: parseCard(bearSrc, "test_bear.txt"),
});

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

interface DrainOpts {
  // Response to a chooseCastTargets decision; if undefined the test fails.
  readonly chooseTargets?: { readonly targets: readonly unknown[] };
}

const drain = (
  gen: Generator<unknown, unknown, unknown>,
  opts: DrainOpts = {},
): { events: { kind: string; payload?: unknown }[]; result: unknown } => {
  const events: { kind: string; payload?: unknown }[] = [];
  let step = gen.next();
  while (!step.done) {
    const y = step.value as {
      kind?: string;
      event?: { kind?: string; payload?: unknown };
      request?: { kind?: string; replacementIds?: number[] };
    };
    if (y.kind === "event" && y.event?.kind) {
      events.push({ kind: y.event.kind, payload: y.event.payload });
      step = gen.next();
    } else if (y.kind === "decision" && y.request?.kind === "orderReplacements") {
      step = gen.next({ order: [...(y.request.replacementIds ?? [])] });
    } else if (y.kind === "decision" && y.request?.kind === "chooseCastTargets") {
      if (!opts.chooseTargets) throw new Error("test: chooseCastTargets yielded but no response provided");
      step = gen.next({ kind: "chooseCastTargets", targets: opts.chooseTargets.targets });
    } else {
      step = gen.next();
    }
  }
  return { events, result: step.value };
};

// Build minimal AST for AB$ Mana | Cost$ T | Produced$ G — no ValidTgts$.
const makeManaAbilityAst = () => ({
  kind: "spell" as const,
  effect: {
    handlerKey: "Mana",
    params: {
      Produced: { kind: "literal" as const, raw: "G" },
    },
  },
  cost: { raw: "T" },
});

// Build AST for AB$ DealDamage | Cost$ T | ValidTgts$ Any | NumDmg$ 1.
const makeDealDamageAnyAst = () => ({
  kind: "spell" as const,
  effect: {
    handlerKey: "DealDamage",
    params: {
      ValidTgts: { kind: "literal" as const, raw: "Any" },
      NumDmg: { kind: "literal" as const, raw: "1" },
    },
  },
  cost: { raw: "T" },
});

// Build AST for AB$ Destroy | Cost$ T | ValidTgts$ Creature.
const makeDestroyCreatureAst = () => ({
  kind: "spell" as const,
  effect: {
    handlerKey: "Destroy",
    params: {
      ValidTgts: { kind: "literal" as const, raw: "Creature" },
    },
  },
  cost: { raw: "T" },
});

describe("activateAbility — Wave 8 target selection", () => {
  it("regression: no-target ability path skips chooseCastTargets entirely", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const cardId = mkEntityId(200);

    const card = new Card(cardId, sourcePaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(cardId, card);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(cardId);
    card.spellAbilities = [new SpellAbility(makeManaAbilityAst(), cardId, seat0, new Map())];

    const pool = new ManaPool();
    game.getPlayer(seat0).manaPool = pool;

    let yieldedChooseCastTargets = false;
    const gen = game.action.activateAbility(cardId, 0, seat0) as Generator<unknown, unknown, unknown>;
    let step = gen.next();
    while (!step.done) {
      const y = step.value as { kind?: string; request?: { kind?: string; replacementIds?: number[] } };
      if (y.kind === "decision" && y.request?.kind === "chooseCastTargets") {
        yieldedChooseCastTargets = true;
      }
      if (y.kind === "decision" && y.request?.kind === "orderReplacements") {
        step = gen.next({ order: [...(y.request.replacementIds ?? [])] });
      } else {
        step = gen.next();
      }
    }

    expect(yieldedChooseCastTargets).toBe(false);
    expect(card.tapped).toBe(true);
    expect(game.sharedZones.stack.size).toBe(1);
  });

  it("yields chooseCastTargets for ValidTgts$ Any; player-target resolves and damages opponent", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0); // Alice
    const seat1 = mkPlayerSeat(1); // Bob
    const sourceId = mkEntityId(210);

    const card = new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, card);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(sourceId);
    card.spellAbilities = [new SpellAbility(makeDealDamageAnyAst(), sourceId, seat0, new Map())];

    expect(game.getPlayer(seat1).life).toBe(20);

    // Activate — respond to chooseCastTargets with Bob as a player target.
    const gen = game.action.activateAbility(sourceId, 0, seat0) as Generator<unknown, unknown, unknown>;
    const { events: activateEvents } = drain(gen, {
      chooseTargets: { targets: [{ kind: "player", seat: seat1 }] },
    });
    const activateKinds = activateEvents.map((e) => e.kind);

    expect(activateKinds).toContain("CardTapped");
    expect(activateKinds).toContain("AbilityActivated");
    // CardTargeted is NOT emitted for player targets.
    expect(activateKinds).not.toContain("CardTargeted");
    expect(card.tapped).toBe(true);
    expect(game.sharedZones.stack.size).toBe(1);

    const top = game.sharedZones.stack.top();
    if (!top) throw new Error("test: stack is empty after activateAbility");
    // The stack item carries the chosen target.
    expect(top.targets).not.toBeNull();
    const stackTargets = top.targets as readonly { kind: string; seat?: number }[];
    expect(stackTargets).toHaveLength(1);
    expect(stackTargets[0]?.kind).toBe("player");
    expect(stackTargets[0]?.seat).toBe(seat1);

    // Resolve — DealDamageEffect should hit Bob via the bound resolver.
    const { events: resolveEvents } = drain(
      resolveStackItem(game, top) as Generator<unknown, unknown, unknown>,
    );
    const resolveKinds = resolveEvents.map((e) => e.kind);

    expect(resolveKinds).toContain("DamageDealt");
    expect(resolveKinds).toContain("StackItemResolved");
    expect(game.getPlayer(seat1).life).toBe(19);
    expect(game.sharedZones.stack.size).toBe(0);
  });

  it("emits CardTargeted for card-typed targets; Destroy moves creature to graveyard", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0); // Alice
    const seat1 = mkPlayerSeat(1); // Bob
    const sourceId = mkEntityId(220);
    const bearId = mkEntityId(221);

    // Source on Alice's battlefield.
    const source = new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(sourceId);
    source.spellAbilities = [new SpellAbility(makeDestroyCreatureAst(), sourceId, seat0, new Map())];

    // Bear on Bob's battlefield.
    const bear = new Card(bearId, bearPaper(), seat1, seat1, ZoneType.Battlefield);
    game.cards.set(bearId, bear);
    game.getPlayer(seat1).zones.get(ZoneType.Battlefield)?.add(bearId);

    // Activate — respond with the bear as the card target.
    const gen = game.action.activateAbility(sourceId, 0, seat0) as Generator<unknown, unknown, unknown>;
    const { events: activateEvents } = drain(gen, {
      chooseTargets: { targets: [{ kind: "card", id: bearId }] },
    });
    const activateKinds = activateEvents.map((e) => e.kind);

    expect(activateKinds).toContain("CardTargeted");
    expect(activateKinds).toContain("AbilityActivated");

    // CardTargeted payload must reference bear + source + Alice's seat.
    const cardTargetedEvent = activateEvents.find((e) => e.kind === "CardTargeted");
    const payload = cardTargetedEvent?.payload as
      | { targetId?: number; sourceCardId?: number; targetingSeat?: number }
      | undefined;
    expect(payload?.targetId).toBe(bearId);
    expect(payload?.sourceCardId).toBe(sourceId);
    expect(payload?.targetingSeat).toBe(seat0);

    // Resolve — bear should move to graveyard.
    const top = game.sharedZones.stack.top();
    if (!top) throw new Error("test: stack is empty after activateAbility");
    drain(resolveStackItem(game, top) as Generator<unknown, unknown, unknown>);

    expect(bear.zone).toBe(ZoneType.Graveyard);
    expect(game.sharedZones.stack.size).toBe(0);
  });

  it("rejects empty target selection when min=1 with IllegalDecisionError", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(230);

    const card = new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, card);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(sourceId);
    card.spellAbilities = [new SpellAbility(makeDealDamageAnyAst(), sourceId, seat0, new Map())];

    const gen = game.action.activateAbility(sourceId, 0, seat0) as Generator<unknown, unknown, unknown>;
    expect(() => {
      // Drive the generator and respond to chooseCastTargets with an empty array.
      let step = gen.next();
      while (!step.done) {
        const y = step.value as { kind?: string; request?: { kind?: string; replacementIds?: number[] } };
        if (y.kind === "decision" && y.request?.kind === "chooseCastTargets") {
          step = gen.next({ kind: "chooseCastTargets", targets: [] });
        } else if (y.kind === "decision" && y.request?.kind === "orderReplacements") {
          step = gen.next({ order: [...(y.request.replacementIds ?? [])] });
        } else {
          step = gen.next();
        }
      }
    }).toThrow(IllegalDecisionError);
  });
});

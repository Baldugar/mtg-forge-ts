// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 8 — Prodigal Sorcerer flagship integration test.
//
// Exercises the new activated-ability target-selection path end-to-end:
//   1. Parse Prodigal Sorcerer (real Forge text — A:AB$ DealDamage with
//      Cost$ T and ValidTgts$ Any).
//   2. Place untapped on Alice's battlefield, run activateAbilitiesFromDefinition.
//   3. Activate ability index 0; respond to chooseCastTargets with a
//      player target (Bob).
//   4. Verify the activate generator yields decisions in CR 602.1b order
//      (target before cost), the card taps, AbilityActivated fires, and
//      the stack item carries the bound player target.
//   5. Resolve the stack item — Bob takes 1 damage (20 → 19), DamageDealt
//      and StackItemResolved emitted, stack empties.
//
// A second test exercises the card-target arm: Prodigal Sorcerer deals 1
// damage to a Bear on Bob's battlefield. CardTargeted is emitted; bear
// takes 1 damage (and survives — it's a 2/2).
import { parseCard } from "@mtg-forge-ts/cards";
import type { EntityId, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../src/card.js";
import type { GameMeta } from "../../src/game-meta.js";
import type { GameRules } from "../../src/game-rules.js";
import { Game } from "../../src/game.js";
import { resolveStackItem } from "../../src/resolve/effect-resolve.js";
import { Battlefield } from "../../src/zone/zones/battlefield.js";
import { Graveyard } from "../../src/zone/zones/graveyard.js";
import { Hand } from "../../src/zone/zones/hand.js";
import { Library } from "../../src/zone/zones/library.js";

// Self-register all effects (DealDamageEffect, etc.)
import "../../src/ability/effects/index.js";
// Register cost parts (CostTap, CostMana, etc.)
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

// Real Forge text for Prodigal Sorcerer.
const prodigalSorcererSrc = `${[
  "Name:Prodigal Sorcerer",
  "ManaCost:2 U",
  "Types:Creature Human Wizard Sorcerer",
  "PT:1/1",
  "A:AB$ DealDamage | Cost$ T | ValidTgts$ Any | NumDmg$ 1 | SpellDescription$ CARDNAME deals 1 damage to any target.",
  "SVar:NonCombatPriority:1",
  "Oracle:{T}: Prodigal Sorcerer deals 1 damage to any target.",
].join("\n")}\n`;

// Bear used as a card-typed target.
const bearSrc = `${["Name:Test Bear", "ManaCost:1 G", "Types:Creature Bear", "PT:2/2", "Oracle:"].join(
  "\n",
)}\n`;

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

const placeOnBattlefield = (
  game: Game,
  paper: PaperCard,
  seat: PlayerSeat,
  id: EntityId,
  options: { activate?: boolean } = {},
): Card => {
  const card = new Card(id, paper, seat, seat, ZoneType.Battlefield);
  game.cards.set(id, card);
  const bf = game.getPlayer(seat).zones.get(ZoneType.Battlefield);
  if (!bf) throw new Error("test: missing battlefield zone");
  bf.add(id);
  if (options.activate === true) card.activateAbilitiesFromDefinition();
  return card;
};

interface DrainOpts {
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

describe("Flagship: Prodigal Sorcerer — activated-ability target with damage", () => {
  it("deals 1 damage to opponent player — Bob's life 20 → 19, sorcerer tapped, stack empty", () => {
    const game = makeGame();
    const aliceSeat = mkPlayerSeat(0);
    const bobSeat = mkPlayerSeat(1);
    const sorcererId = mkEntityId(30000);

    // 1. Parse + build PaperCard.
    const def = parseCard(prodigalSorcererSrc, "prodigal_sorcerer.txt");
    const sorcererPaper: PaperCard = {
      name: "Prodigal Sorcerer",
      edition: "LEA",
      collectorNumber: "62",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };

    // 2. Place untapped on Alice's battlefield + activate AB$ abilities.
    const sorcerer = placeOnBattlefield(game, sorcererPaper, aliceSeat, sorcererId, { activate: true });

    // The AB$ DealDamage ability was parsed.
    expect(sorcerer.spellAbilities).toHaveLength(1);
    expect(sorcerer.spellAbilities[0]?.handlerKey).toBe("DealDamage");

    // Initial state.
    expect(sorcerer.tapped).toBe(false);
    expect(game.getPlayer(bobSeat).life).toBe(20);
    expect(game.sharedZones.stack.size).toBe(0);

    // 3. Activate — respond with Bob as the player target.
    const activateGen = game.action.activateAbility(sorcererId, 0, aliceSeat) as Generator<
      unknown,
      unknown,
      unknown
    >;
    const { events: activateEvents } = drain(activateGen, {
      chooseTargets: { targets: [{ kind: "player", seat: bobSeat }] },
    });
    const activateKinds = activateEvents.map((e) => e.kind);

    // Cost paid: card is now tapped. AbilityActivated fired.
    expect(sorcerer.tapped).toBe(true);
    expect(activateKinds).toContain("CardTapped");
    expect(activateKinds).toContain("AbilityActivated");
    // Player target — no CardTargeted.
    expect(activateKinds).not.toContain("CardTargeted");

    // Stack has the activated ability with the bound player target.
    expect(game.sharedZones.stack.size).toBe(1);
    const top = game.sharedZones.stack.top();
    if (!top) throw new Error("test: stack is empty after activateAbility");
    expect(top.kind).toBe("activatedAbility");
    expect(top.targets).not.toBeNull();
    const stackTargets = top.targets as readonly { kind: string; seat?: number }[];
    expect(stackTargets).toHaveLength(1);
    expect(stackTargets[0]?.kind).toBe("player");
    expect(stackTargets[0]?.seat).toBe(bobSeat);

    // 4. Resolve — DealDamageEffect should hit Bob via the bound resolver.
    const { events: resolveEvents } = drain(
      resolveStackItem(game, top) as Generator<unknown, unknown, unknown>,
    );
    const resolveKinds = resolveEvents.map((e) => e.kind);

    expect(resolveKinds).toContain("DamageDealt");
    expect(resolveKinds).toContain("StackItemResolved");

    // 5. Final state — binary success metric.
    expect(game.getPlayer(bobSeat).life).toBe(19);
    expect(sorcerer.tapped).toBe(true);
    expect(sorcerer.zone).toBe(ZoneType.Battlefield);
    expect(game.sharedZones.stack.size).toBe(0);

    // DamageDealt payload — 1 damage to player.
    const damageEvent = activateEvents.concat(resolveEvents).find((e) => e.kind === "DamageDealt");
    const payload = damageEvent?.payload as { amount?: number; targetKind?: string } | undefined;
    expect(payload?.amount).toBe(1);
    expect(payload?.targetKind).toBe("player");
  });

  it("deals 1 damage to a creature on opponent's battlefield — emits CardTargeted, bear damaged", () => {
    const game = makeGame();
    const aliceSeat = mkPlayerSeat(0);
    const bobSeat = mkPlayerSeat(1);
    const sorcererId = mkEntityId(30100);
    const bearId = mkEntityId(30101);

    // Sorcerer on Alice's side.
    const def = parseCard(prodigalSorcererSrc, "prodigal_sorcerer.txt");
    const sorcererPaper: PaperCard = {
      name: "Prodigal Sorcerer",
      edition: "LEA",
      collectorNumber: "62",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };
    placeOnBattlefield(game, sorcererPaper, aliceSeat, sorcererId, { activate: true });

    // Bear on Bob's battlefield.
    const bearDef = parseCard(bearSrc, "test_bear.txt");
    const bearPaper: PaperCard = {
      name: "Test Bear",
      edition: "TST",
      collectorNumber: "1",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: bearDef,
    };
    const bear = placeOnBattlefield(game, bearPaper, bobSeat, bearId);

    // Activate — respond with the bear as a card target.
    const activateGen = game.action.activateAbility(sorcererId, 0, aliceSeat) as Generator<
      unknown,
      unknown,
      unknown
    >;
    const { events: activateEvents } = drain(activateGen, {
      chooseTargets: { targets: [{ kind: "card", id: bearId }] },
    });
    const activateKinds = activateEvents.map((e) => e.kind);

    expect(activateKinds).toContain("CardTargeted");
    expect(activateKinds).toContain("AbilityActivated");

    // CardTargeted payload references bear + sorcerer + Alice.
    const ct = activateEvents.find((e) => e.kind === "CardTargeted");
    const ctPayload = ct?.payload as
      | { targetId?: number; sourceCardId?: number; targetingSeat?: number }
      | undefined;
    expect(ctPayload?.targetId).toBe(bearId);
    expect(ctPayload?.sourceCardId).toBe(sorcererId);
    expect(ctPayload?.targetingSeat).toBe(aliceSeat);

    // Resolve — bear takes 1 damage (still on battlefield as a 2/2).
    const top = game.sharedZones.stack.top();
    if (!top) throw new Error("test: stack is empty after activateAbility");
    const { events: resolveEvents } = drain(
      resolveStackItem(game, top) as Generator<unknown, unknown, unknown>,
    );

    expect(resolveEvents.map((e) => e.kind)).toContain("DamageDealt");

    const damage = resolveEvents.find((e) => e.kind === "DamageDealt");
    const dPayload = damage?.payload as { amount?: number; targetKind?: string } | undefined;
    expect(dPayload?.amount).toBe(1);
    expect(dPayload?.targetKind).toBe("creature");

    // Bear has 1 damage marked but is still alive (toughness 2).
    expect(bear.zone).toBe(ZoneType.Battlefield);
    expect(game.sharedZones.stack.size).toBe(0);
  });
});

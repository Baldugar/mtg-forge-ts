// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 23 — Improvise flagship integration test ("Reverse Engineer" stand-in).
//
// Improvise (CR 702.126) — "Your artifacts can help cast this spell. Each
// artifact you tap after you're done activating mana abilities pays for {1}."
// Each tapped artifact pays {1} generic only — no colored-pip substitution.
//
// This test pins the binary success metric:
//   - A spell with K:Improvise and base cost 4U, with three untapped Servos
//     (1/1 colorless artifact creatures) on the caster's battlefield, can be
//     cast paying only {1}{U} after tapping all three Servos for {3} of generic.
//   - All three Servos end up tapped; the residual mana pool is drained.
//
// Synthetic card definition (Improvise spell):
//   Name:Improvise Engineer
//   ManaCost:4 U
//   Types:Sorcery
//   K:Improvise
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

const improviseEngineerSrc = `${[
  "Name:Improvise Engineer",
  "ManaCost:4 U",
  "Types:Sorcery",
  "K:Improvise",
  "Oracle:Improvise. (Your artifacts can help cast this spell. Each artifact you tap after you're done activating mana abilities pays for {1}.)",
].join("\n")}\n`;

const servoSrc = `${[
  "Name:Servo",
  "ManaCost:1",
  "Types:Artifact Creature Servo",
  "PT:1/1",
  "Oracle:1/1",
].join("\n")}\n`;

const makeGame = (): Game => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(24n) });
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

interface ImpDecisionRequest {
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
    const y = step.value as { kind: string; event?: { kind?: string }; request?: ImpDecisionRequest };
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

describe("Flagship: Improvise (Wave 23)", () => {
  it("Three tapped Servos reduce a 4U Improvise spell to 1U — caster pays only {1}{U}", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const engineerId = mkEntityId(24000);
    const servo1Id = mkEntityId(24001);
    const servo2Id = mkEntityId(24002);
    const servo3Id = mkEntityId(24003);

    const engineerDef = parseCard(improviseEngineerSrc, "improvise_engineer.txt");
    const engineerPaper: PaperCard = {
      name: "Improvise Engineer",
      edition: "TEST",
      collectorNumber: "1",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: engineerDef,
    };
    const engineerCard = addCardToHand(game, engineerPaper, seat0, engineerId);
    engineerCard.activateAbilitiesFromDefinition();
    engineerCard.activateKeywordsFromDefinition(game);

    expect(engineerCard.keywords?.has("improvise")).toBe(true);

    // Three untapped Servos (artifact creatures) on Alice's battlefield.
    const servoDef = parseCard(servoSrc, "servo.txt");
    const servoPaper: PaperCard = {
      name: "Servo",
      edition: "TEST",
      collectorNumber: "2",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: servoDef,
    };
    const servo1 = addCardToBattlefield(game, servoPaper, seat0, servo1Id);
    const servo2 = addCardToBattlefield(game, servoPaper, seat0, servo2Id);
    const servo3 = addCardToBattlefield(game, servoPaper, seat0, servo3Id);
    expect(servo1.tapped).toBe(false);
    expect(servo2.tapped).toBe(false);
    expect(servo3.tapped).toBe(false);

    // Pool has only {1}{U} — without Improvise the 4U cast would fail.
    const pool = new ManaPool();
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colored(Color.Blue));
    game.getPlayer(seat0).manaPool = pool;
    expect(pool.size()).toBe(2);

    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: engineerId,
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
    expect(tappedIds).toHaveLength(3);
    expect(tappedIds).toContain(servo1Id);
    expect(tappedIds).toContain(servo2Id);
    expect(tappedIds).toContain(servo3Id);
    // Pool drained: {1}{U} was sufficient after the {3} improvise reduction.
    expect(pool.size()).toBe(0);
    expect(servo1.tapped).toBe(true);
    expect(servo2.tapped).toBe(true);
    expect(servo3.tapped).toBe(true);
    expect(game.sharedZones.stack.size).toBe(1);
  });

  it("Non-artifact creatures are not eligible for Improvise (Bears excluded)", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const engineerId = mkEntityId(24100);
    const bearId = mkEntityId(24101);

    const engineerDef = parseCard(improviseEngineerSrc, "improvise_engineer.txt");
    const engineerPaper: PaperCard = {
      name: "Improvise Engineer",
      edition: "TEST",
      collectorNumber: "1",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: engineerDef,
    };
    const engineerCard = addCardToHand(game, engineerPaper, seat0, engineerId);
    engineerCard.activateAbilitiesFromDefinition();
    engineerCard.activateKeywordsFromDefinition(game);

    // A Bear (creature, not artifact) — should NOT be enumerated as eligible.
    const bearSrc = `${[
      "Name:Grizzly Bears",
      "ManaCost:1 G",
      "Types:Creature Bear",
      "PT:2/2",
      "Oracle:2/2",
    ].join("\n")}\n`;
    const bearDef = parseCard(bearSrc, "bear.txt");
    const bearPaper: PaperCard = {
      name: "Grizzly Bears",
      edition: "LEA",
      collectorNumber: "195",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: bearDef,
    };
    addCardToBattlefield(game, bearPaper, seat0, bearId);

    // Full {4}{U} pool so the cast succeeds without Improvise help.
    const pool = new ManaPool();
    for (let i = 0; i < 4; i++) pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colored(Color.Blue));
    game.getPlayer(seat0).manaPool = pool;

    const { result: stackItem, tappedIds } = drainCast(
      game.castPipeline.run({
        castingPlayer: seat0,
        sourceCardId: engineerId,
        originZone: ZoneType.Hand,
        asSpecialAction: false,
      }) as Generator<{ kind: string }, StackItem | null, unknown>,
      true, // would tap all eligible — but no eligible artifacts, so list is empty
    );

    expect(stackItem).not.toBeNull();
    // Bear was a creature not an artifact — so the chooseConvokeImproviseTap
    // decision was NOT yielded (eligible list empty), tappedIds stays [].
    expect(tappedIds).toEqual([]);
  });

  it("Smoke: improvise handler registers and adds 'improvise' to card.keywords", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const engineerId = mkEntityId(24200);
    const engineerDef = parseCard(improviseEngineerSrc, "improvise_engineer.txt");
    const engineerPaper: PaperCard = {
      name: "Improvise Engineer",
      edition: "TEST",
      collectorNumber: "1",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: engineerDef,
    };
    const card = addCardToHand(game, engineerPaper, seat0, engineerId);
    card.activateKeywordsFromDefinition(game);
    expect(card.keywords?.has("improvise")).toBe(true);
  });
});

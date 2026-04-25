// SPDX-License-Identifier: GPL-3.0-or-later
// F9 — Path to Exile flagship integration test.
// Tests ChangeZoneEffect with Destination$ Exile on a targeted creature.
//
// Scenario: Opponent has a Grizzly Bears (2/2) on their battlefield. Controller
// casts Path to Exile (W instant) targeting it. The ChangeZoneEffect reads
// Destination$ Exile and moves the targeted creature to the shared exile zone.
//
// MVP scope: primary ChangeZone effect only. The SubAbility (DBSearchLand —
// search library for basic land) is beyond scope (Effect handler depth +
// search-library deferred to Part D2). Not tested here.
//
// This validates:
//   - ChangeZoneEffect parses Destination$ Exile → ZoneType.Exile correctly
//   - moveTo(cardId, Exile) routes card to shared exile zone
//   - Target creature moves from battlefield to exile
//   - Path to Exile itself goes to graveyard after resolving (instant rule)
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
  cardDataSyncedAt: "2026-04-24T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};

// Path to Exile: W instant — exile target creature.
// SubAbility (DBSearchLand) omitted from MVP — only testing ChangeZone effect.
const pathToExileSrc = `${[
  "Name:Path to Exile",
  "ManaCost:W",
  "Types:Instant",
  "A:SP$ ChangeZone | Cost$ W | Origin$ Battlefield | Destination$ Exile | ValidTgts$ Creature | TgtPrompt$ Select target creature | SpellDescription$ Exile target creature.",
  "Oracle:Exile target creature. Its controller may search their library for a basic land card and put it onto the battlefield tapped.",
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

describe("Flagship: Path to Exile end-to-end integration", () => {
  it("exiles target creature — creature moves from battlefield to exile zone", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0); // caster
    const seat1 = mkPlayerSeat(1); // target creature owner
    const pathId = mkEntityId(20000);
    const creatureId = mkEntityId(20001);

    // 1. Parse Path to Exile
    const pathDef = parseCard(pathToExileSrc, "path_to_exile.txt");
    const pathPaper: PaperCard = {
      name: "Path to Exile",
      edition: "CON",
      collectorNumber: "11",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: pathDef,
    };

    // 2. Parse Grizzly Bears as target creature
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

    // 3. Set up: Path to Exile in seat0's hand, Grizzly Bears on seat1's battlefield
    const pathCard = addCardToHand(game, pathPaper, seat0, pathId);
    pathCard.activateAbilitiesFromDefinition();

    const creatureCard = addCardToBattlefield(game, bearPaper, seat1, creatureId);
    expect(creatureCard.zone).toBe(ZoneType.Battlefield);

    // Verify the exile zone starts empty
    expect(game.sharedZones.exile.size).toBe(0);

    // 4. Seed 1 white mana (Path to Exile costs W)
    const pool = new ManaPool();
    pool.add(ManaProduced.colored(Color.White));
    game.getPlayer(seat0).manaPool = pool;

    // 5. Cast Path to Exile
    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: pathId,
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
    //    ChangeZoneEffect.resolve iterates sa.targets; each target is moved
    //    to the Destination$ zone (Exile).
    const saTemplate = pathCard.spellAbilities[0];
    if (!saTemplate) throw new Error("test: card has no spellAbilities");
    const boundSa = new SpellAbility(
      saTemplate.ast,
      saTemplate.sourceCardId,
      saTemplate.controllerSeat,
      saTemplate.svars,
      [creatureId], // targeting the Grizzly Bears
    );
    const patchedItem: StackItem = { ...(stackItem as StackItem), resolver: boundSa.makeResolver() };
    game.sharedZones.stack.pop();
    game.sharedZones.stack.push(patchedItem);

    // 7. Resolve Path to Exile
    const resolveEvents = drainResolver(
      resolveStackItem(game, patchedItem) as Generator<unknown, void, unknown>,
    );

    // CardChangedZone fires when creature moves to exile
    expect(resolveEvents).toContain("CardChangedZone");
    expect(resolveEvents).toContain("StackItemResolved");

    // 8. Assertions
    // Creature is in the exile zone
    expect(creatureCard.zone).toBe(ZoneType.Exile);
    expect(game.sharedZones.exile.size).toBe(1);
    expect(game.sharedZones.exile.contains(creatureId)).toBe(true);

    // Path to Exile itself goes to caster's graveyard (instant resolves to GY)
    expect(pathCard.zone).toBe(ZoneType.Graveyard);

    // Life totals unchanged
    expect(game.getPlayer(seat0).life).toBe(20);
    expect(game.getPlayer(seat1).life).toBe(20);

    // Stack empty
    expect(game.sharedZones.stack.size).toBe(0);
  });
});

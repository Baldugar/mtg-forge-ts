// SPDX-License-Identifier: GPL-3.0-or-later
// F2 — Disenchant flagship integration test.
// Tests targeted DestroyEffect on an artifact — opponent's artifact moves to
// graveyard after Disenchant resolves.
//
// Pipeline: parse → build → cast (1W) → resolve with artifact as target →
// artifact in graveyard, Disenchant in graveyard.
//
// NOTE: ValidTgts$ validation (Artifact,Enchantment) is NOT enforced by the
// current pipeline — the target is hand-bound directly to the StackItem
// resolver using the same SpellAbility patch pattern as Lightning Bolt.
// This is a known gap (target validation deferred). Documented here.
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
  cardDataSyncedAt: "2026-04-23T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};

const disenchantSrc = `${[
  "Name:Disenchant",
  "ManaCost:1 W",
  "Types:Instant",
  "A:SP$ Destroy | Cost$ 1 W | ValidTgts$ Artifact,Enchantment | TgtPrompt$ Select target artifact or enchantment | SpellDescription$ Destroy target artifact or enchantment.",
  "Oracle:Destroy target artifact or enchantment.",
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

// A minimal artifact to use as the target.
const artifactSrc = `${["Name:Sol Ring", "ManaCost:1", "Types:Artifact", "Oracle:{T}: Add {C}{C}."].join(
  "\n",
)}\n`;

describe("Flagship: Disenchant end-to-end integration", () => {
  it("destroys target artifact — artifact moves to graveyard, Disenchant in graveyard", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0); // caster
    const seat1 = mkPlayerSeat(1); // artifact owner
    const disenchantId = mkEntityId(8000);
    const artifactId = mkEntityId(8001);

    // 1. Parse Disenchant
    const disenchantDef = parseCard(disenchantSrc, "disenchant.txt");
    const disenchantPaper: PaperCard = {
      name: "Disenchant",
      edition: "LEA",
      collectorNumber: "202",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: disenchantDef,
    };

    // 2. Build a Sol Ring to destroy
    const artifactDef = parseCard(artifactSrc, "sol_ring.txt");
    const artifactPaper: PaperCard = {
      name: "Sol Ring",
      edition: "LEA",
      collectorNumber: "265",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: artifactDef,
    };

    // 3. Set up: Disenchant in seat0's hand, Sol Ring on seat1's battlefield
    const disenchantCard = addCardToHand(game, disenchantPaper, seat0, disenchantId);
    disenchantCard.activateAbilitiesFromDefinition();

    const artifactCard = addCardToBattlefield(game, artifactPaper, seat1, artifactId);
    expect(artifactCard.zone).toBe(ZoneType.Battlefield);

    // 4. Seed 1 colorless + 1 white (Disenchant costs 1W)
    const pool = new ManaPool();
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colored(Color.White));
    game.getPlayer(seat0).manaPool = pool;

    // 5. Cast Disenchant
    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: disenchantId,
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

    // 6. Patch the stack item: bind artifactId as the target.
    //    (Same pattern as Lightning Bolt flagship test — target hand-bound.)
    const saTemplate = disenchantCard.spellAbilities[0];
    if (!saTemplate) throw new Error("test: card has no spellAbilities");
    const boundSa = new SpellAbility(
      saTemplate.ast,
      saTemplate.sourceCardId,
      saTemplate.controllerSeat,
      saTemplate.svars,
      [artifactId],
    );
    const patchedItem: StackItem = { ...(stackItem as StackItem), resolver: boundSa.makeResolver() };
    game.sharedZones.stack.pop();
    game.sharedZones.stack.push(patchedItem);

    // 7. Resolve Disenchant
    const resolveEvents = drainResolver(
      resolveStackItem(game, patchedItem) as Generator<unknown, void, unknown>,
    );

    // CardDestroyed + zone move
    expect(resolveEvents).toContain("CardDestroyed");
    expect(resolveEvents).toContain("CardChangedZone");
    expect(resolveEvents).toContain("StackItemResolved");

    // Artifact destroyed → graveyard (goes to owner's graveyard)
    expect(artifactCard.zone).toBe(ZoneType.Graveyard);

    // Disenchant → graveyard
    expect(disenchantCard.zone).toBe(ZoneType.Graveyard);

    // Life unchanged
    expect(game.getPlayer(seat0).life).toBe(20);
    expect(game.getPlayer(seat1).life).toBe(20);

    // Stack empty
    expect(game.sharedZones.stack.size).toBe(0);
  });
});

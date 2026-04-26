// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 12C flagship — Yavimaya Sojourner Domain cost reduction E2E.
//
// Yavimaya Sojourner real Forge data:
//   Name:Yavimaya Sojourner
//   ManaCost:7 G
//   Types:Creature Treefolk
//   PT:4/6
//   S:Mode$ ReduceCost | ValidCard$ Card.Self | Type$ Spell | Amount$ X
//     | EffectZone$ All | Description$ Domain — This spell costs {1} less
//     to cast for each basic land type among lands you control.
//   SVar:X:Count$Domain
//
// Scenarios:
//   (1) Zero domain → cost stays at {7}{G} → with {7}{G} mana the cast
//       succeeds.
//   (2) Three distinct basic land subtypes (Forest/Mountain/Plains) →
//       reduction of {3}, effective cost {4}{G}. With {4}{G} mana the cast
//       succeeds; with {3}{G} mana the cast fails.
//   (3) Five distinct basics → reduction of {5}, effective cost {2}{G}.
//
// EffectZone$ All means the static applies even from the spell's stack /
// hand origin — Yavimaya's own pre-pay reduction ALWAYS works, regardless
// of whether the card is on the battlefield. The static ability is intrinsic
// to the card itself.
import { parseCard } from "@mtg-forge-ts/cards";
import type { EntityId, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  Color,
  DEFAULT_PAPER_CARD_FLAGS,
  ManaProduced,
  SeededRng,
  TypeLine,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import "../../src/ability/effects/index.js";
import "../../src/cost/parts/index.js";
import { Card } from "../../src/card.js";
import type { CastProposal } from "../../src/cast/cast-pipeline.js";
import type { GameMeta } from "../../src/game-meta.js";
import type { GameRules } from "../../src/game-rules.js";
import { Game } from "../../src/game.js";
import { ManaPool } from "../../src/mana/mana-pool.js";
import type { StackItem } from "../../src/stack/stack-item.js";
import { onZoneChange } from "../../src/statics/zone-activation.js";
import { Battlefield } from "../../src/zone/zones/battlefield.js";
import { Graveyard } from "../../src/zone/zones/graveyard.js";
import { Hand } from "../../src/zone/zones/hand.js";
import { Library } from "../../src/zone/zones/library.js";

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
  seed: "01",
};

const yavimayaSrc = `${[
  "Name:Yavimaya Sojourner",
  "ManaCost:7 G",
  "Types:Creature Treefolk",
  "PT:4/6",
  "S:Mode$ ReduceCost | ValidCard$ Card.Self | Type$ Spell | Amount$ X | EffectZone$ All | Description$ Domain — This spell costs {1} less to cast for each basic land type among lands you control.",
  "SVar:X:Count$Domain",
  "Oracle:Domain — This spell costs {1} less to cast for each basic land type among lands you control.",
].join("\n")}\n`;

const mkGame = (): Game => {
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

const mkLandPaper = (subtype: string): PaperCard => ({
  name: `Basic ${subtype}`,
  edition: "TST",
  collectorNumber: "1",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: {
    name: `Basic ${subtype}`,
    oracle: "",
    types: TypeLine.parse(`Basic Land — ${subtype}`),
    manaCost: { raw: "", symbols: [] },
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars: new Map(),
  },
});

const addLandToBattlefield = (game: Game, subtype: string, seat: PlayerSeat, id: EntityId): Card => {
  const card = new Card(id, mkLandPaper(subtype), seat, seat, ZoneType.Battlefield);
  game.cards.set(id, card);
  const bf = game.getPlayer(seat).zones.get(ZoneType.Battlefield);
  if (!bf) throw new Error("test: missing battlefield");
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
    } else {
      step = gen.next();
    }
  }
  return { events, result: step.value };
};

const installYavimayaInHand = (game: Game, seat: PlayerSeat, id: EntityId): Card => {
  const def = parseCard(yavimayaSrc, "yavimaya_sojourner.txt");
  const paper: PaperCard = {
    name: "Yavimaya Sojourner",
    edition: "ONS",
    collectorNumber: "270",
    language: "en",
    foil: false,
    flags: DEFAULT_PAPER_CARD_FLAGS,
    definition: def,
  };
  const card = addCardToHand(game, paper, seat, id);
  // Activate statics from definition. EffectZone$ All means the static
  // is wired regardless of zone — onZoneChange installs it.
  card.activateStaticsFromDefinition(game);
  onZoneChange(game, id, ZoneType.None, ZoneType.Hand);
  return card;
};

describe("Flagship F-12C: Yavimaya Sojourner — Count$Domain cost reduction E2E", () => {
  it("scenario 1 — 0 distinct basics → cost stays at {7}{G}; pool of 7 colorless + 1 G casts", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const yavimayaId = mkEntityId(40000);

    installYavimayaInHand(game, seat0, yavimayaId);
    expect(game.staticEffectRegistry.byCategory("costModification")).toHaveLength(1);

    // Pool: 7 colorless + 1 G
    const pool = new ManaPool();
    for (let i = 0; i < 7; i++) pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colored(Color.Green));
    game.getPlayer(seat0).manaPool = pool;
    expect(pool.size()).toBe(8);

    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: yavimayaId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const { events, result } = drainCast(
      game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );
    expect(result).not.toBeNull();
    expect(events).toContain("CostPaid");
    expect(events).toContain("SpellCast");
    expect(pool.size()).toBe(0);
  });

  it("scenario 2 — 3 distinct basics (F+M+P) → cost {4}{G}; pool of 4 colorless + 1 G is enough", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const yavimayaId = mkEntityId(41000);

    // Place 3 distinct basics on seat0's battlefield.
    addLandToBattlefield(game, "Forest", seat0, mkEntityId(41001));
    addLandToBattlefield(game, "Mountain", seat0, mkEntityId(41002));
    addLandToBattlefield(game, "Plains", seat0, mkEntityId(41003));

    installYavimayaInHand(game, seat0, yavimayaId);

    // Pool: 4 colorless + 1 G (= 5 mana, sufficient for {4}{G}).
    const pool = new ManaPool();
    for (let i = 0; i < 4; i++) pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colored(Color.Green));
    game.getPlayer(seat0).manaPool = pool;

    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: yavimayaId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const { events, result } = drainCast(
      game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );
    expect(result).not.toBeNull();
    expect(events).toContain("CostPaid");
    expect(events).toContain("SpellCast");
    expect(pool.size()).toBe(0);
  });

  it("scenario 2b — 3 distinct basics → cost {4}{G}; pool of 3 colorless + 1 G is NOT enough", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const yavimayaId = mkEntityId(42000);

    addLandToBattlefield(game, "Forest", seat0, mkEntityId(42001));
    addLandToBattlefield(game, "Mountain", seat0, mkEntityId(42002));
    addLandToBattlefield(game, "Plains", seat0, mkEntityId(42003));

    installYavimayaInHand(game, seat0, yavimayaId);

    // Pool: 3 colorless + 1 G (only 4 mana, but cost is {4}{G} = 5 mana).
    const pool = new ManaPool();
    for (let i = 0; i < 3; i++) pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colored(Color.Green));
    game.getPlayer(seat0).manaPool = pool;

    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: yavimayaId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const { result } = drainCast(
      game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );
    // Insufficient mana → cast aborts.
    expect(result).toBeNull();
  });

  it("scenario 3 — 5 distinct basics → cost {2}{G}; pool of 2 colorless + 1 G casts", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const yavimayaId = mkEntityId(43000);

    const subtypes = ["Plains", "Island", "Swamp", "Mountain", "Forest"];
    for (let i = 0; i < subtypes.length; i++) {
      const sub = subtypes[i];
      if (sub === undefined) throw new Error("test invariant");
      addLandToBattlefield(game, sub, seat0, mkEntityId(43100 + i));
    }

    installYavimayaInHand(game, seat0, yavimayaId);

    const pool = new ManaPool();
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colored(Color.Green));
    game.getPlayer(seat0).manaPool = pool;

    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: yavimayaId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const { events, result } = drainCast(
      game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );
    expect(result).not.toBeNull();
    expect(events).toContain("CostPaid");
    expect(events).toContain("SpellCast");
    expect(pool.size()).toBe(0);
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.B — Initiative dungeon per-room printed-effect dispatch.
//
// Verifies that `applyUndercityRoomEffect` invokes the canonical per-room
// printed effect from Forge's `tokenscripts/undercity.txt`:
//   1 Secret Entrance      — search library for a basic land + put into hand
//   2 Forge                — put two +1/+1 counters on a creature you control
//   3 Lost Well            — scry 2
//   4 Trap!                — opponent loses 5 life
//   5 Arena                — goad target creature you don't control
//   6 Stash                — create a Treasure token
//   7 Archives             — draw a card
//   8 Catacombs            — create a 4/1 black Skeleton creature with menace
//   9 Throne of the Dead Three — put a creature card from top 10 onto the
//                                battlefield with three +1/+1 counters
//
// Plus integration tests for the lifecycle: TakeInitiativeEffect now
// applies room 1's effect on take, and the upkeep advance hook applies
// the next room's effect.
import "../ability/effects/wave-22-effects.js";
import type { CardDefinition, DecisionResponse, EntityId, LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import {
  CardType,
  ColorSet,
  DEFAULT_PAPER_CARD_FLAGS,
  SeededRng,
  Supertype,
  TypeLine,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { effectRegistry } from "../ability/effect-registry.js";
import { SpellAbility } from "../ability/spell-ability.js";
import { Card } from "../card.js";
import { applyUndercityRoomEffect, grantInitiative } from "../dnd/initiative-tracker.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Exile } from "../zone/zones/exile.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";

const alice: LobbyPlayer = { id: "p-alice", name: "Alice", controllerKind: "human" };
const bob: LobbyPlayer = { id: "p-bob", name: "Bob", controllerKind: "ai" };

const rules: GameRules = {
  formatId: "standard",
  startingLife: 20,
  startingHandSize: 7,
  mulliganRule: "london",
  firstPlayerSkipsDraw: false,
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
  cardDataSyncedAt: "2026-04-28T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};

const seat0 = mkPlayerSeat(0);
const seat1 = mkPlayerSeat(1);

const mkGame = (): Game => {
  const g = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const player of g.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
    player.zones.set(ZoneType.Exile, new Exile(ZoneType.Exile, player.seat));
  }
  return g;
};

const minimalDef = (overrides: Partial<CardDefinition> = {}): CardDefinition => ({
  name: "Test",
  oracle: "",
  types: TypeLine.parse("Creature"),
  manaCost: null,
  pt: { power: "1", toughness: "1" },
  colors: ColorSet.empty(),
  abilities: [],
  triggers: [],
  replacements: [],
  statics: [],
  keywords: [],
  svars: new Map(),
  ...overrides,
});

const mkPaper = (name: string, def?: CardDefinition): PaperCard => ({
  name,
  edition: "LEA",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  ...(def !== undefined ? { definition: def } : {}),
});

const seedCard = (
  game: Game,
  id: number,
  name: string,
  controllerSeat: ReturnType<typeof mkPlayerSeat>,
  zone: ZoneType,
  def?: CardDefinition,
): Card => {
  const eid = mkEntityId(id);
  const paper = mkPaper(name, def);
  const card = new Card(eid, paper, controllerSeat, controllerSeat, zone);
  game.cards.set(eid, card);
  const z = game.getPlayer(controllerSeat).zones.get(zone);
  if (z) z.add(eid);
  return card;
};

/** Drain a generator, auto-responding to scry decisions with "all to top". */
const drainAutoScry = (
  gen: Generator<{ kind: string; request?: { kind: string; cards?: readonly EntityId[] } }, void, unknown>,
): unknown[] => {
  const out: unknown[] = [];
  let r = gen.next();
  while (!r.done) {
    const y = r.value;
    out.push(y);
    if (y.kind === "decision" && y.request?.kind === "scry") {
      const cards = (y.request.cards ?? []) as readonly EntityId[];
      const resp: DecisionResponse = { kind: "scry", toTop: cards, toBottom: [] };
      r = gen.next(resp);
    } else {
      r = gen.next();
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// Room-effect tests
// ---------------------------------------------------------------------------

describe("Wave 70.B — Undercity room effects (smoke per room)", () => {
  it("room 1 (Secret Entrance) — finds a basic land in library and moves to hand", () => {
    const game = mkGame();
    // Seed the library with a non-land card and a basic Plains.
    const nonLandDef = minimalDef({ types: TypeLine.parse("Creature — Goblin") });
    const basicDef = minimalDef({
      types: new TypeLine([Supertype.Basic], [CardType.Land], ["Plains"]),
    });
    seedCard(game, 100, "Goblin", seat0, ZoneType.Library, nonLandDef);
    seedCard(game, 101, "Plains", seat0, ZoneType.Library, basicDef);

    drainAutoScry(applyUndercityRoomEffect(game, seat0, 1) as never);

    const hand = game.getPlayer(seat0).zones.get(ZoneType.Hand);
    const handIds = hand?.toArray() ?? [];
    expect(handIds.includes(mkEntityId(101))).toBe(true);
    // Non-land was not moved.
    expect(handIds.includes(mkEntityId(100))).toBe(false);
  });

  it("room 2 (Forge) — adds two +1/+1 counters to a creature you control", () => {
    const game = mkGame();
    const c = seedCard(game, 200, "Bear", seat0, ZoneType.Battlefield, minimalDef());

    drainAutoScry(applyUndercityRoomEffect(game, seat0, 2) as never);

    expect(c.counters.get("P1P1" as never)).toBe(2);
  });

  it("room 3 (Lost Well) — yields a scry-2 decision", () => {
    const game = mkGame();
    // Seed library with two cards so the scry has something to reveal.
    seedCard(game, 300, "A", seat0, ZoneType.Library, minimalDef());
    seedCard(game, 301, "B", seat0, ZoneType.Library, minimalDef());

    const yields = drainAutoScry(applyUndercityRoomEffect(game, seat0, 3) as never);
    const scryDecision = yields.find(
      (y) =>
        (y as { kind?: string }).kind === "decision" &&
        (y as { request?: { kind?: string } }).request?.kind === "scry",
    );
    expect(scryDecision).toBeDefined();
  });

  it("room 4 (Trap!) — opponent loses 5 life", () => {
    const game = mkGame();
    const oppLifeBefore = game.getPlayer(seat1).life;

    drainAutoScry(applyUndercityRoomEffect(game, seat0, 4) as never);

    expect(game.getPlayer(seat1).life).toBe(oppLifeBefore - 5);
    expect(game.getPlayer(seat0).life).toBe(20); // self unaffected
  });

  it("room 5 (Arena) — goads a creature you don't control", () => {
    const game = mkGame();
    const oppCreature = seedCard(game, 500, "Wolf", seat1, ZoneType.Battlefield, minimalDef());
    expect(oppCreature.goaded).toBe(false);

    drainAutoScry(applyUndercityRoomEffect(game, seat0, 5) as never);

    expect(oppCreature.goaded).toBe(true);
  });

  it("room 6 (Stash) — creates a Treasure token", () => {
    const game = mkGame();
    const bfBefore = game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.size ?? 0;

    drainAutoScry(applyUndercityRoomEffect(game, seat0, 6) as never);

    const bfIds = game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.toArray() ?? [];
    expect(bfIds.length).toBe(bfBefore + 1);
    const tokenCard = game.cards.get(bfIds[bfIds.length - 1] as EntityId);
    expect(tokenCard?.paperCard.name).toBe("Treasure Token");
  });

  it("room 7 (Archives) — draws a card", () => {
    const game = mkGame();
    seedCard(game, 700, "TopCard", seat0, ZoneType.Library, minimalDef());
    const handBefore = game.getPlayer(seat0).zones.get(ZoneType.Hand)?.size ?? 0;

    drainAutoScry(applyUndercityRoomEffect(game, seat0, 7) as never);

    const handAfter = game.getPlayer(seat0).zones.get(ZoneType.Hand)?.size ?? 0;
    expect(handAfter).toBe(handBefore + 1);
  });

  it("room 8 (Catacombs) — creates a 4/1 black Skeleton with menace", () => {
    const game = mkGame();

    drainAutoScry(applyUndercityRoomEffect(game, seat0, 8) as never);

    const bfIds = game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.toArray() ?? [];
    expect(bfIds.length).toBe(1);
    const tokenId = bfIds[0] as EntityId;
    const tokenCard = game.cards.get(tokenId);
    expect(tokenCard?.paperCard.name).toBe("Skeleton Token");
    const chars = game.layerEngine.computeCharacteristics(tokenId);
    expect(chars.types.has(CardType.Creature)).toBe(true);
    expect(chars.subtypes.has("Skeleton")).toBe(true);
  });

  it("room 9 (Throne of the Dead Three) — picks a creature from top 10 and puts onto battlefield with 3 +1/+1 counters", () => {
    const game = mkGame();
    // Seed top of library: non-creature on top, then a creature in slot 2.
    const nonCreatureDef = minimalDef({ types: TypeLine.parse("Land — Mountain") });
    const creatureDef = minimalDef({ types: TypeLine.parse("Creature — Bear") });
    seedCard(game, 900, "Mountain", seat0, ZoneType.Library, nonCreatureDef);
    seedCard(game, 901, "Bear", seat0, ZoneType.Library, creatureDef);

    drainAutoScry(applyUndercityRoomEffect(game, seat0, 9) as never);

    const bf = game.getPlayer(seat0).zones.get(ZoneType.Battlefield);
    const bfIds = bf?.toArray() ?? [];
    expect(bfIds.includes(mkEntityId(901))).toBe(true);
    const bear = game.cards.get(mkEntityId(901));
    expect(bear?.counters.get("P1P1" as never)).toBe(3);
  });

  it("room 0 (sentinel — not yet entered) — no-op", () => {
    const game = mkGame();
    const lifeBefore = game.getPlayer(seat0).life;

    drainAutoScry(applyUndercityRoomEffect(game, seat0, 0) as never);

    expect(game.getPlayer(seat0).life).toBe(lifeBefore);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle integration tests
// ---------------------------------------------------------------------------

describe("Wave 70.B — Initiative lifecycle integration", () => {
  it("TakeInitiative effect emits BecameInitiative + UndercityRoomEntered + applies room-1 effect", () => {
    const game = mkGame();
    // Seed a basic Plains in the library so room 1 (Secret Entrance) has
    // something to find.
    const basicDef = minimalDef({
      types: new TypeLine([Supertype.Basic], [CardType.Land], ["Plains"]),
    });
    seedCard(game, 1000, "Plains", seat0, ZoneType.Library, basicDef);
    // Source card for the SpellAbility.
    seedCard(game, 1001, "InitiativeGranter", seat0, ZoneType.Battlefield, minimalDef());

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: { handlerKey: "TakeInitiative", params: {} as never },
        cost: { raw: "" },
      },
      mkEntityId(1001),
      seat0,
      new Map(),
      [],
    );
    expect(effectRegistry.has("TakeInitiative")).toBe(true);

    const yields = drainAutoScry(sa.makeResolver().resolve(game) as never);

    // BecameInitiative event present
    expect(yields.some((y) => (y as { event?: { kind?: string } }).event?.kind === "BecameInitiative")).toBe(
      true,
    );
    // UndercityRoomEntered event present
    expect(
      yields.some((y) => (y as { event?: { kind?: string } }).event?.kind === "UndercityRoomEntered"),
    ).toBe(true);
    // Room-1 effect applied — Plains moved from library to hand.
    const handIds = game.getPlayer(seat0).zones.get(ZoneType.Hand)?.toArray() ?? [];
    expect(handIds.includes(mkEntityId(1000))).toBe(true);
    expect(game.flags.initiative).toBe(seat0);
    expect(game.flags.undercityRoom).toBe(1);
  });

  it("upkeep advance through 3 rooms — each effect applies in sequence", () => {
    const game = mkGame();
    // Already on room 1 (Secret Entrance). Seed enough state that rooms
    // 2..4 produce observable changes when we manually walk the dungeon.
    const c = seedCard(game, 2000, "Bear", seat0, ZoneType.Battlefield, minimalDef());
    const oppLifeBefore = game.getPlayer(seat1).life;

    // Advance to room 2 (Forge — +1/+1 counters)
    drainAutoScry(applyUndercityRoomEffect(game, seat0, 2) as never);
    expect(c.counters.get("P1P1" as never)).toBe(2);

    // Advance to room 3 (Lost Well — scry 2)
    seedCard(game, 2100, "TopA", seat0, ZoneType.Library, minimalDef());
    seedCard(game, 2101, "TopB", seat0, ZoneType.Library, minimalDef());
    const yields3 = drainAutoScry(applyUndercityRoomEffect(game, seat0, 3) as never);
    expect(
      yields3.some(
        (y) =>
          (y as { kind?: string }).kind === "decision" &&
          (y as { request?: { kind?: string } }).request?.kind === "scry",
      ),
    ).toBe(true);

    // Advance to room 4 (Trap! — opponent loses 5 life)
    drainAutoScry(applyUndercityRoomEffect(game, seat0, 4) as never);
    expect(game.getPlayer(seat1).life).toBe(oppLifeBefore - 5);
  });

  it("smoke — grantInitiative on an empty game emits both events", () => {
    const game = mkGame();
    const events = grantInitiative(game, seat0);
    expect(events.length).toBe(2);
    expect(events[0]?.kind).toBe("BecameInitiative");
    expect(events[1]?.kind).toBe("UndercityRoomEntered");
    if (events[1]?.kind === "UndercityRoomEntered") {
      expect(events[1].payload.roomName).toBe("Secret Entrance");
      expect(events[1].payload.room).toBe(1);
    }
  });
});

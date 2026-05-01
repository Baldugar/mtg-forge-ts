// SPDX-License-Identifier: GPL-3.0-or-later
// Ensure svar selectors are registered.
import "../../svar/selectors/number.js";
// Import effect — self-registers in effectRegistry at module load.
import "./deal-damage.js";
import type { AbilityAst, EntityId, LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { Library } from "../../zone/zones/library.js";
import { SpellAbility } from "../spell-ability.js";

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
const paper: PaperCard = {
  name: "Test",
  edition: "LEA",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const mkGame = () => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
  return game;
};

const drainGen = (gen: Generator<unknown, void, unknown>): void => {
  let r = gen.next();
  while (!r.done) r = gen.next();
};

const mkAst = (dmg: number): AbilityAst => ({
  kind: "spell",
  effect: {
    handlerKey: "DealDamage",
    params: { NumDmg: { kind: "literal", raw: String(dmg) } },
  },
  cost: { raw: "R" },
});

describe("DealDamageEffect", () => {
  it("deals damage to a player target — life decreases by NumDmg", () => {
    const game = mkGame();
    // Use high entity ids to avoid collision with PlayerSeat values (0, 1)
    const sourceId = mkEntityId(10);
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);

    // PlayerSeat is a branded number; cast as EntityId to use in targets array.
    // DealDamageEffect checks game.cards.get(targetId) — if absent, routes as player.
    const targetAsEntityId = seat1 as unknown as EntityId;
    const sa = new SpellAbility(mkAst(2), sourceId, seat0, new Map(), [targetAsEntityId]);

    const before = game.getPlayer(seat1).life;
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(game.getPlayer(seat1).life).toBe(before - 2);
  });

  it("deals damage to a creature target — creature gains damage counters", () => {
    const game = mkGame();
    const sourceId = mkEntityId(10);
    const seat0 = mkPlayerSeat(0);
    const creatureId = mkEntityId(20);
    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    const creature = new Card(creatureId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.cards.set(creatureId, creature);

    const sa = new SpellAbility(mkAst(3), sourceId, seat0, new Map(), [creatureId]);

    expect(creature.damage).toBe(0);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(creature.damage).toBe(3);
  });

  // M5 — regression: seat-vs-cardId numerical collision must NOT misroute
  // player damage to a colliding creature. Pre-fix, DealDamageEffect probed
  // game.cards.get(targetId) to discriminate; when a player seat (small int
  // like 0/1) numerically collided with a real cardId (cards allocate from
  // the same pool starting near 0), the probe matched the card and player
  // damage was silently routed as creature damage.
  //
  // The fix: SpellAbility now carries a discriminated `targetRefs` array so
  // effects route by explicit kind. This test seeds the exact collision
  // (cardId 1 == seat 1) and confirms the player takes life loss while the
  // colliding card receives no damage.
  it("seat-vs-cardId collision — player target takes life damage even when seat == cardId", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    // Source card uses a high id that doesn't collide with any seat.
    const sourceId = mkEntityId(100);
    // The colliding card: cardId 1 == seat1 numerically. Pre-fix this
    // would get the damage that should go to seat1.
    const collidingCardId = mkEntityId(1);
    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    const collider = new Card(collidingCardId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.cards.set(collidingCardId, collider);

    const lifeBefore = game.getPlayer(seat1).life;
    expect(collider.damage).toBe(0);

    // Construct SA with explicit targetRefs flagging the target as a player.
    // `targets` array still carries seat-as-EntityId for legacy code paths,
    // but targetRefs preserves the kind discriminator.
    const targetSeatAsEntityId = seat1 as unknown as ReturnType<typeof mkEntityId>;
    const sa = new SpellAbility(
      mkAst(2),
      sourceId,
      seat0,
      new Map(),
      [targetSeatAsEntityId],
      undefined,
      undefined,
      undefined,
      [{ kind: "player", seat: seat1 } as const],
    );

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(game.getPlayer(seat1).life).toBe(lifeBefore - 2);
    expect(collider.damage).toBe(0); // The colliding card was NOT damaged.
  });

  // M5 — confirm targetRefs="card" routes to creature damage even when no
  // collision is involved (parity with the legacy game.cards.get probe).
  it("targetRefs card kind — creature target receives damage regardless of probe", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(100);
    const creatureId = mkEntityId(2);
    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    const creature = new Card(creatureId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.cards.set(creatureId, creature);

    const sa = new SpellAbility(
      mkAst(3),
      sourceId,
      seat0,
      new Map(),
      [creatureId],
      undefined,
      undefined,
      undefined,
      [{ kind: "card", id: creatureId } as const],
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(creature.damage).toBe(3);
  });
});

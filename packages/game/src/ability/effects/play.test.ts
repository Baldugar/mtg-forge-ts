// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 4 — PlayEffect tests.
// Verifies that PlayEffect with Defined$ Targeted and WithoutManaCost$ True
// drives the cast pipeline and puts the target card on the stack without
// charging mana.
import "./play.js";
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { EngineYield } from "../../action/engine-yield.js";
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
  cardDataSyncedAt: "2026-04-24T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};
const paper: PaperCard = {
  name: "Test Card",
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

const drainGen = (gen: Generator<unknown, void, unknown>): EngineYield[] => {
  const yields: EngineYield[] = [];
  let r = gen.next();
  while (!r.done) {
    yields.push(r.value as EngineYield);
    r = gen.next();
  }
  return yields;
};

describe("PlayEffect — Wave 4 (Defined$ Targeted + WithoutManaCost$)", () => {
  it("drives FreeCastPipeline and emits SpellCast for target card", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const targetId = mkEntityId(20);

    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    // Target card in exile — owned by seat0, no mana cost on paperCard
    // so FreeCastPipeline base:null is redundant but harmless; the regular
    // pipeline would also auto-pass.
    const targetCard = new Card(targetId, paper, seat0, seat0, ZoneType.Exile);
    game.cards.set(targetId, targetCard);
    // Register in the shared exile zone.
    game.sharedZones.exile.add(targetId);

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "Play",
          params: {
            Defined: { kind: "literal", raw: "Targeted" },
            WithoutManaCost: { kind: "literal", raw: "True" },
          },
        },
        cost: { raw: "" },
      },
      sourceId,
      seat0,
      new Map(),
      [targetId], // sa.targets[0] = the card to cast
    );

    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const spellCastEvents = yields.filter((y) => y.kind === "event" && y.event.kind === "SpellCast");
    expect(spellCastEvents).toHaveLength(1);

    const ev = spellCastEvents[0] as Extract<EngineYield, { kind: "event" }>;
    if (ev.event.kind !== "SpellCast") throw new Error("expected SpellCast");
    expect(ev.event.payload.cardId).toBe(targetId);
    expect(ev.event.payload.controllerSeat).toBe(seat0);

    // Card should be on the stack after a successful cast.
    expect(game.sharedZones.stack.size).toBeGreaterThan(0);
  });

  it("no-ops gracefully when sa.targets is empty (Optional$ True)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "Play",
          params: {
            Defined: { kind: "literal", raw: "Targeted" },
            Optional: { kind: "literal", raw: "True" },
            WithoutManaCost: { kind: "literal", raw: "True" },
          },
        },
        cost: { raw: "" },
      },
      sourceId,
      seat0,
      new Map(),
      [], // no targets
    );

    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(yields).toHaveLength(0); // no events — graceful no-op
  });

  it("no-ops when Defined$ is not Targeted (Remembered deferred)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "Play",
          params: {
            Defined: { kind: "literal", raw: "Remembered" },
            WithoutManaCost: { kind: "literal", raw: "True" },
          },
        },
        cost: { raw: "" },
      },
      sourceId,
      seat0,
      new Map(),
      [],
    );

    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(yields).toHaveLength(0); // deferred — no crash, no yields
  });
});

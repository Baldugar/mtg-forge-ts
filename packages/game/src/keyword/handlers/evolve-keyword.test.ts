// SPDX-License-Identifier: GPL-3.0-or-later
// EvolveKeywordHandler unit tests — flagship Cloudfin Raptor.
// We exercise the handler directly: synthesize the trigger via
// activateKeywordsFromDefinition, check it matches a CardChangedZone event
// for an entering bigger creature, then drive the resolver and assert that
// (a) a +1/+1 counter is added and (b) a CardEvolved event is yielded.
import { parseCard } from "@mtg-forge-ts/cards";
import type { GameEvent, LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import {
  CounterType,
  DEFAULT_PAPER_CARD_FLAGS,
  PhaseStep,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkEvent,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import "../../keyword/index.js";
import "./evolve-keyword.js";

const alice: LobbyPlayer = { id: "P0", name: "Alice", controllerKind: "human" };
const bob: LobbyPlayer = { id: "P1", name: "Bob", controllerKind: "ai" };
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
  forgeSha: "test",
  cardDataSyncedAt: "2026-04-24T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "42",
};
const mkGame = (): Game => new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(42n) });

const cloudfinSrc = `${[
  "Name:Cloudfin Raptor",
  "ManaCost:U",
  "Types:Creature Bird",
  "PT:0/1",
  "K:Flying",
  "K:Evolve",
  "Oracle:Evolve",
].join("\n")}\n`;

const grizzlySrc = `${[
  "Name:Test Bear",
  "ManaCost:1 G",
  "Types:Creature Bear",
  "PT:2/2",
  "Oracle:vanilla",
].join("\n")}\n`;

const mkPaper = (src: string, name: string): PaperCard => ({
  name,
  edition: "TST",
  collectorNumber: "1",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: parseCard(src, `${name}.txt`),
});

describe("EvolveKeywordHandler", () => {
  it("registers a triggered ability and adds 'evolve' flag", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(100);
    const paper = mkPaper(cloudfinSrc, "Cloudfin Raptor");
    const card = new Card(id, paper, seat, seat, ZoneType.Battlefield);
    game.cards.set(id, card);
    card.activateKeywordsFromDefinition(game);
    expect(card.keywords?.has("evolve")).toBe(true);
    expect(card.triggeredAbilities?.length).toBeGreaterThanOrEqual(1);
  });

  it("matches a same-controller bigger-creature ETB and resolves to a +1/+1 counter", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);

    const raptorId = mkEntityId(101);
    const raptor = new Card(
      raptorId,
      mkPaper(cloudfinSrc, "Cloudfin Raptor"),
      seat,
      seat,
      ZoneType.Battlefield,
    );
    game.cards.set(raptorId, raptor);
    game.getPlayer(seat).zones.get(ZoneType.Battlefield)?.add(raptorId);
    raptor.activateKeywordsFromDefinition(game);

    const bearId = mkEntityId(102);
    const bear = new Card(bearId, mkPaper(grizzlySrc, "Test Bear"), seat, seat, ZoneType.Battlefield);
    game.cards.set(bearId, bear);
    game.getPlayer(seat).zones.get(ZoneType.Battlefield)?.add(bearId);

    const ta = raptor.triggeredAbilities?.[0];
    expect(ta).toBeDefined();
    if (!ta) return;

    const ev: GameEvent = mkEvent("CardChangedZone", game.turn, PhaseStep.Main1, {
      cardId: bearId,
      fromZone: ZoneType.Hand,
      toZone: ZoneType.Battlefield,
      toSeat: seat,
    });
    expect(ta.matches(ev)).toBe(true);

    // Drive the resolver (run all yields).
    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    const yields = [...resolver.resolve(game)];
    void yields;

    expect(raptor.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBeGreaterThanOrEqual(1);
    const evolvedEvents = yields.filter(
      (y) => typeof y === "object" && y !== null && (y as { kind?: string }).kind === "event",
    ) as { kind: "event"; event: GameEvent }[];
    expect(evolvedEvents.some((y) => y.event.kind === "CardEvolved")).toBe(true);
  });

  it("does not match an opponent's creature ETB", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const oppSeat = mkPlayerSeat(1);

    const raptorId = mkEntityId(110);
    const raptor = new Card(
      raptorId,
      mkPaper(cloudfinSrc, "Cloudfin Raptor"),
      seat,
      seat,
      ZoneType.Battlefield,
    );
    game.cards.set(raptorId, raptor);
    raptor.activateKeywordsFromDefinition(game);

    const oppBearId = mkEntityId(111);
    const oppBear = new Card(
      oppBearId,
      mkPaper(grizzlySrc, "Opp Bear"),
      oppSeat,
      oppSeat,
      ZoneType.Battlefield,
    );
    game.cards.set(oppBearId, oppBear);

    const ta = raptor.triggeredAbilities?.[0];
    if (!ta) return;
    const ev: GameEvent = mkEvent("CardChangedZone", game.turn, PhaseStep.Main1, {
      cardId: oppBearId,
      fromZone: ZoneType.Hand,
      toZone: ZoneType.Battlefield,
      toSeat: oppSeat,
    });
    expect(ta.matches(ev)).toBe(false);
  });

  it("does not self-trigger (excludes the source card)", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const raptorId = mkEntityId(120);
    const raptor = new Card(
      raptorId,
      mkPaper(cloudfinSrc, "Cloudfin Raptor"),
      seat,
      seat,
      ZoneType.Battlefield,
    );
    game.cards.set(raptorId, raptor);
    raptor.activateKeywordsFromDefinition(game);

    const ta = raptor.triggeredAbilities?.[0];
    if (!ta) return;
    const ev: GameEvent = mkEvent("CardChangedZone", game.turn, PhaseStep.Main1, {
      cardId: raptorId,
      fromZone: ZoneType.Hand,
      toZone: ZoneType.Battlefield,
      toSeat: seat,
    });
    expect(ta.matches(ev)).toBe(false);
  });
});

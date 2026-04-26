// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 16b — CastPipeline.stepChooseTargets emits a CrimeCommitted event
// after target selection when ANY target is opponent-controlled (CR 113.13,
// Murders at Karlov Manor). One emit per cast, even if multiple opponent
// targets are chosen.
import type { LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { Battlefield } from "../zone/zones/battlefield.js";
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
const samplePaper: PaperCard = {
  name: "Murder",
  edition: "MKM",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const makeGame = (): { game: Game; seat0: PlayerSeat; seat1: PlayerSeat } => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
  return { game, seat0: mkPlayerSeat(0), seat1: mkPlayerSeat(1) };
};

describe("CastPipeline — Wave 16b CrimeCommitted emit", () => {
  it("emits CrimeCommitted when targeting an opponent-controlled card", () => {
    const { game, seat0, seat1 } = makeGame();
    const opponentCardId = mkEntityId(800);
    const oppCard = new Card(opponentCardId, samplePaper, seat1, seat1, ZoneType.Battlefield);
    game.cards.set(opponentCardId, oppCard);
    game.getPlayer(seat1).zones.get(ZoneType.Battlefield)?.add(opponentCardId);

    const restriction = {
      controllerScope: "any",
      permitZones: new Set([ZoneType.Battlefield]),
      permitTypes: new Set(),
      forbidTypes: new Set(),
      minTargets: 1,
      maxTargets: 1,
      mayTargetPlayers: false,
    } as const;
    const paper: PaperCard & { targetRestriction: typeof restriction } = {
      ...samplePaper,
      targetRestriction: restriction,
    };
    const cardId = mkEntityId(801);
    const card = new Card(cardId, paper, seat0, seat0, ZoneType.Hand);
    game.cards.set(cardId, card);
    game.getPlayer(seat0).zones.get(ZoneType.Hand)?.add(cardId);

    const gen = game.castPipeline.run({
      castingPlayer: seat0,
      sourceCardId: cardId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    });
    const yields: unknown[] = [];
    let step = gen.next();
    while (!step.done) {
      yields.push(step.value);
      const v = step.value as { kind?: string; request?: { kind?: string } };
      if (v.kind === "decision" && v.request?.kind === "chooseCastTargets") {
        step = gen.next({
          kind: "chooseCastTargets",
          targets: [{ kind: "card", id: opponentCardId }],
        });
      } else {
        step = gen.next();
      }
    }
    const events = yields
      .map((y) => y as { kind?: string; event?: { kind: string; payload: unknown } })
      .filter((y) => y.kind === "event")
      .map((y) => y.event as { kind: string; payload: unknown });
    const crime = events.find((e) => e.kind === "CrimeCommitted");
    expect(crime).toBeDefined();
    const payload = crime?.payload as {
      playerSeat: PlayerSeat;
      sourceCardId: number;
      victimSeat?: PlayerSeat;
      victimCardId?: number;
    };
    expect(payload.playerSeat).toBe(seat0);
    expect(payload.sourceCardId).toBe(cardId);
    expect(payload.victimSeat).toBe(seat1);
    expect(payload.victimCardId).toBe(opponentCardId);
  });

  it("does NOT emit CrimeCommitted when targeting a self-controlled card", () => {
    const { game, seat0 } = makeGame();
    const ownTargetId = mkEntityId(810);
    const ownCard = new Card(ownTargetId, samplePaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(ownTargetId, ownCard);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(ownTargetId);

    const restriction = {
      controllerScope: "any",
      permitZones: new Set([ZoneType.Battlefield]),
      permitTypes: new Set(),
      forbidTypes: new Set(),
      minTargets: 1,
      maxTargets: 1,
      mayTargetPlayers: false,
    } as const;
    const paper: PaperCard & { targetRestriction: typeof restriction } = {
      ...samplePaper,
      targetRestriction: restriction,
    };
    const cardId = mkEntityId(811);
    const card = new Card(cardId, paper, seat0, seat0, ZoneType.Hand);
    game.cards.set(cardId, card);
    game.getPlayer(seat0).zones.get(ZoneType.Hand)?.add(cardId);

    const gen = game.castPipeline.run({
      castingPlayer: seat0,
      sourceCardId: cardId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    });
    const yields: unknown[] = [];
    let step = gen.next();
    while (!step.done) {
      yields.push(step.value);
      const v = step.value as { kind?: string; request?: { kind?: string } };
      if (v.kind === "decision" && v.request?.kind === "chooseCastTargets") {
        step = gen.next({
          kind: "chooseCastTargets",
          targets: [{ kind: "card", id: ownTargetId }],
        });
      } else {
        step = gen.next();
      }
    }
    const events = yields
      .map((y) => y as { kind?: string; event?: { kind: string } })
      .filter((y) => y.kind === "event")
      .map((y) => y.event as { kind: string });
    expect(events.find((e) => e.kind === "CrimeCommitted")).toBeUndefined();
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
// CascadeKeywordHandler unit tests — verifies that activating a cascade
// keyword adds "cascade" to the card's keyword set AND registers a
// triggered ability with the game's TriggerRegistry whose sourceCardId
// matches the source card.
import { parseCard } from "@mtg-forge-ts/cards";
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import {
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
// Side-effect imports register every keyword handler.
import "../../keyword/index.js";
import "./cascade-keyword.js";

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
  cardDataSyncedAt: "2026-04-26T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "42",
};

const mkGame = (): Game => new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(42n) });

// Bituminous Blast: 3RB instant, Cascade. We only need the keyword line +
// types + a manaCost to cover the unit-level activation contract; the
// resolver itself is exercised by the flagship test.
const bitumBlastSrc = `${[
  "Name:Bituminous Blast",
  "ManaCost:3 R B",
  "Types:Instant",
  "K:Cascade",
  "Oracle:Cascade.",
].join("\n")}\n`;

describe("CascadeKeywordHandler", () => {
  it("adds 'cascade' to card.keywords after activateKeywordsFromDefinition", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const cardId = mkEntityId(200);

    const def = parseCard(bitumBlastSrc, "bituminous-blast.txt");
    const paper: PaperCard = {
      name: "Bituminous Blast",
      edition: "ALA",
      collectorNumber: "171",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };

    const card = new Card(cardId, paper, seat, seat, ZoneType.Hand);
    game.cards.set(cardId, card);

    card.activateKeywordsFromDefinition(game);

    expect(card.keywords?.has("cascade")).toBe(true);
  });

  it("registers a triggered ability sourced by the cascade card", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const cardId = mkEntityId(201);

    const def = parseCard(bitumBlastSrc, "bituminous-blast.txt");
    const paper: PaperCard = {
      name: "Bituminous Blast",
      edition: "ALA",
      collectorNumber: "171",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };

    const card = new Card(cardId, paper, seat, seat, ZoneType.Hand);
    game.cards.set(cardId, card);

    const before = game.triggerRegistry.size();
    card.activateKeywordsFromDefinition(game);
    const after = game.triggerRegistry.size();

    expect(after).toBeGreaterThan(before);
  });

  it("synthesized trigger matches a SpellCast event whose cardId is the source", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const cardId = mkEntityId(202);

    const def = parseCard(bitumBlastSrc, "bituminous-blast.txt");
    const paper: PaperCard = {
      name: "Bituminous Blast",
      edition: "ALA",
      collectorNumber: "171",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };

    const card = new Card(cardId, paper, seat, seat, ZoneType.Hand);
    game.cards.set(cardId, card);
    card.activateKeywordsFromDefinition(game);

    // Locate the cascade trigger by scanning the registry's pending-fire
    // path: emit a SpellCast event for the source card and check that at
    // least one trigger fires.
    const otherId = mkEntityId(20299);
    const cascadeMatchesSelf = mkEvent("SpellCast", 1, PhaseStep.Main1, {
      stackItemId: mkEntityId(80000),
      cardId,
      controllerSeat: seat,
    });
    game.triggerRegistry.onEvent(cascadeMatchesSelf);
    const pendingForSelf = game.triggerRegistry.peekPending();
    expect(pendingForSelf.some((p) => p.sourceCardId === cardId)).toBe(true);

    // A SpellCast event for a DIFFERENT card must not fire the cascade
    // trigger (cascade is Card.Self-scoped).
    game.triggerRegistry.drain();
    const cascadeIgnoresOther = mkEvent("SpellCast", 1, PhaseStep.Main1, {
      stackItemId: mkEntityId(80001),
      cardId: otherId,
      controllerSeat: seat,
    });
    game.triggerRegistry.onEvent(cascadeIgnoresOther);
    const pendingForOther = game.triggerRegistry.peekPending();
    expect(pendingForOther.some((p) => p.sourceCardId === cardId)).toBe(false);
  });
});

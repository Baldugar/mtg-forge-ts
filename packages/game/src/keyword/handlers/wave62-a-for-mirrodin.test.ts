// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 62.A — For Mirrodin token spawn + auto-attach tests.
//
// Closes the Wave 59 token-creation TODO. Verifies the ETB trigger
// spawns a 2/2 red Rebel creature token and auto-attaches the source
// Equipment to the new token. Multi-ETB (blink loop) spawns a fresh
// Rebel each time and reattaches.
import "../../ability/effects/index.js";
import "../../altcost/index.js";
import "./index.js";
import { parseCard } from "@mtg-forge-ts/cards";
import type { LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  CardType,
  Color,
  ColorSet,
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
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Hand } from "../../zone/zones/hand.js";
import { ForMirrodinKeywordHandler } from "./for-mirrodin-keyword.js";

const aliceLP: LobbyPlayer = { id: "p-alice", name: "Alice", controllerKind: "human" };
const bobLP: LobbyPlayer = { id: "p-bob", name: "Bob", controllerKind: "ai" };
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

const equipmentSrc = (): string =>
  `${["Name:Test Equipment", "ManaCost:1", "Types:Artifact Equipment", "K:Equip:2", "Oracle:Test"].join("\n")}\n`;

const mkEquipmentPaper = (): PaperCard => ({
  name: "Test Equipment",
  edition: "TST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: parseCard(equipmentSrc(), "test-equipment.txt"),
});

const ALICE: PlayerSeat = mkPlayerSeat(0);

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [aliceLP, bobLP], rules, meta, rng: new SeededRng(1n) });
  for (const p of game.players) {
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
  }
  return game;
};

describe("Wave 62.A — For Mirrodin token spawn + auto-attach", () => {
  it("ETB spawns a 2/2 red Rebel creature token controlled by source's controller", () => {
    const game = mkGame();
    const sourceId = mkEntityId(8001);
    const source = new Card(sourceId, mkEquipmentPaper(), ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.getPlayer(ALICE).zones.get(ZoneType.Battlefield)?.add(sourceId);

    new ForMirrodinKeywordHandler().activate(
      { keyword: "for_mirrodin" },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );

    const ta = source.triggeredAbilities?.[0];
    expect(ta).toBeDefined();
    if (!ta) return;
    const event = mkEvent("CardChangedZone", 1, PhaseStep.Main1, {
      cardId: sourceId,
      fromZone: ZoneType.Hand,
      toZone: ZoneType.Battlefield,
    });
    expect(ta.matches(event)).toBe(true);

    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    const gen = resolver.resolve(game);
    let next = gen.next();
    while (!next.done) next = gen.next();

    const tokens = [...game.cards.values()].filter(
      (c) => c.isToken === true && c.paperCard.name === "Rebel Token",
    );
    expect(tokens.length).toBe(1);
    const rebel = tokens[0];
    if (!rebel) return;
    expect(rebel.controllerSeat).toBe(ALICE);
    expect(rebel.ownerSeat).toBe(ALICE);
    // 2/2 P/T from token definition.
    const def = rebel.paperCard.definition;
    expect(def?.pt?.power).toBe("2");
    expect(def?.pt?.toughness).toBe("2");
    // Red color, Creature primary, Rebel subtype.
    expect(def?.colors?.equals(ColorSet.of(Color.Red))).toBe(true);
    expect(def?.types.types.includes(CardType.Creature)).toBe(true);
    expect(def?.types.subtypes.includes("Rebel")).toBe(true);
  });

  it("auto-attaches the source Equipment to the spawned Rebel token", () => {
    const game = mkGame();
    const sourceId = mkEntityId(8011);
    const source = new Card(sourceId, mkEquipmentPaper(), ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.getPlayer(ALICE).zones.get(ZoneType.Battlefield)?.add(sourceId);

    new ForMirrodinKeywordHandler().activate(
      { keyword: "for_mirrodin" },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );

    const ta = source.triggeredAbilities?.[0];
    if (!ta) return;
    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    const gen = resolver.resolve(game);
    let next = gen.next();
    while (!next.done) next = gen.next();

    const tokens = [...game.cards.values()].filter(
      (c) => c.isToken === true && c.paperCard.name === "Rebel Token",
    );
    expect(tokens.length).toBe(1);
    const rebel = tokens[0];
    if (!rebel) return;
    // Equipment attached to the new Rebel; Rebel's attachments
    // include the Equipment.
    expect(source.attachedTo).toBe(rebel.id);
    expect(rebel.attachments.includes(sourceId)).toBe(true);
  });

  it("multi-ETB (blink loop) — each resolve spawns a fresh Rebel + reattaches", () => {
    const game = mkGame();
    const sourceId = mkEntityId(8021);
    const source = new Card(sourceId, mkEquipmentPaper(), ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.getPlayer(ALICE).zones.get(ZoneType.Battlefield)?.add(sourceId);

    new ForMirrodinKeywordHandler().activate(
      { keyword: "for_mirrodin" },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );

    const ta = source.triggeredAbilities?.[0];
    if (!ta) return;
    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;

    // First ETB.
    let gen = resolver.resolve(game);
    let next = gen.next();
    while (!next.done) next = gen.next();
    const rebelsAfterFirst = [...game.cards.values()].filter(
      (c) => c.isToken === true && c.paperCard.name === "Rebel Token",
    );
    expect(rebelsAfterFirst.length).toBe(1);
    const firstRebelId = rebelsAfterFirst[0]?.id;
    expect(source.attachedTo).toBe(firstRebelId);

    // Second ETB (simulating exile-and-return / blink).
    gen = resolver.resolve(game);
    next = gen.next();
    while (!next.done) next = gen.next();
    const rebelsAfterSecond = [...game.cards.values()].filter(
      (c) => c.isToken === true && c.paperCard.name === "Rebel Token",
    );
    expect(rebelsAfterSecond.length).toBe(2);
    // Equipment is now attached to the second (fresh) Rebel — attach()
    // detaches from prior target before re-attaching to the new one.
    const secondRebel = rebelsAfterSecond.find((r) => r.id !== firstRebelId);
    expect(secondRebel).toBeDefined();
    if (!secondRebel) return;
    expect(source.attachedTo).toBe(secondRebel.id);
    // First Rebel is no longer attached-to by the Equipment.
    const firstRebel = rebelsAfterSecond.find((r) => r.id === firstRebelId);
    expect(firstRebel?.attachments.includes(sourceId)).toBe(false);
  });
});

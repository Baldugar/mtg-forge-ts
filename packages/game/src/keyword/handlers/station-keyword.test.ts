// SPDX-License-Identifier: GPL-3.0-or-later
// StationKeywordHandler unit tests — synthesized activated ability + StationEffect.
import { parseCard } from "@mtg-forge-ts/cards";
import type { GameEvent, LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import {
  CardType,
  DEFAULT_PAPER_CARD_FLAGS,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import "../../ability/effects/index.js";
import { effectRegistry } from "../../ability/effect-registry.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import "../../keyword/index.js";
import "./station-keyword.js";

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

// A simple non-creature Spacecraft with K:Station:3.
const spacecraftSrc = `${[
  "Name:Test Spacecraft",
  "ManaCost:3",
  "Types:Artifact Spacecraft",
  "PT:4/4",
  "K:Station:3",
  "Oracle:Station 3",
].join("\n")}\n`;

const bearSrc = `${["Name:Test Bear", "ManaCost:1 G", "Types:Creature Bear", "PT:2/2", "Oracle:vanilla"].join(
  "\n",
)}\n`;

const mkPaper = (src: string, name: string): PaperCard => ({
  name,
  edition: "TST",
  collectorNumber: "1",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: parseCard(src, `${name}.txt`),
});

describe("StationKeywordHandler", () => {
  it("synthesizes an activated SpellAbility (battlefield zone) and adds 'station' flag", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(200);
    const card = new Card(id, mkPaper(spacecraftSrc, "Test Spacecraft"), seat, seat, ZoneType.Battlefield);
    game.cards.set(id, card);
    expect(card.spellAbilities).toHaveLength(0);
    card.activateKeywordsFromDefinition(game);
    expect(card.keywords?.has("station")).toBe(true);
    const sa = card.spellAbilities.find((a) => a.activeInZones.has(ZoneType.Battlefield));
    expect(sa).toBeDefined();
    expect(sa?.handlerKey).toBe("Station");
  });

  it("StationEffect taps creatures, stamps stationedUntilEot, emits CardStationed", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);

    const shipId = mkEntityId(201);
    const ship = new Card(
      shipId,
      mkPaper(spacecraftSrc, "Test Spacecraft"),
      seat,
      seat,
      ZoneType.Battlefield,
    );
    game.cards.set(shipId, ship);
    ship.activateKeywordsFromDefinition(game);

    // Two 2/2 bears, total power 4 ≥ 3 — enough for Station 3.
    const a = mkEntityId(202);
    const b = mkEntityId(203);
    const bearA = new Card(a, mkPaper(bearSrc, "Bear A"), seat, seat, ZoneType.Battlefield);
    const bearB = new Card(b, mkPaper(bearSrc, "Bear B"), seat, seat, ZoneType.Battlefield);
    game.cards.set(a, bearA);
    game.cards.set(b, bearB);

    const sa = ship.spellAbilities.find((s) => s.handlerKey === "Station");
    expect(sa).toBeDefined();
    if (!sa) return;

    // Resolve the effect with an injected DecisionResponse for "tap A and B".
    // Drive the resolver directly: we step the generator, send the decision
    // response when the engine yields a chooseCrewSaddleCreatures request.
    const Ctor = effectRegistry.lookup("Station");
    expect(Ctor).toBeDefined();
    if (!Ctor) return;
    const handler = new Ctor();
    const gen = handler.resolve(sa, game);
    let next = gen.next();
    const yields: unknown[] = [];
    while (!next.done) {
      const y = next.value;
      yields.push(y);
      const yObj = y as { kind?: string; request?: { kind?: string } };
      if (yObj.kind === "decision" && yObj.request?.kind === "chooseCrewSaddleCreatures") {
        next = gen.next({ kind: "chooseCrewSaddleCreatures", tapIds: [a, b] });
      } else {
        next = gen.next();
      }
    }

    expect(ship.stationedUntilEot).toBe(true);
    expect(bearA.tapped).toBe(true);
    expect(bearB.tapped).toBe(true);

    // Type-flip: re-compute characteristics; Spacecraft should now be a Creature too.
    const chars = game.layerEngine.computeCharacteristics(shipId);
    expect(chars.types.has(CardType.Creature)).toBe(true);

    // CardStationed event was emitted.
    const stationedEvts = yields.filter(
      (y) =>
        typeof y === "object" &&
        y !== null &&
        (y as { kind?: string }).kind === "event" &&
        ((y as { event: GameEvent }).event.kind as string) === "CardStationed",
    );
    expect(stationedEvts).toHaveLength(1);
  });
});

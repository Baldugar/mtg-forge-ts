// SPDX-License-Identifier: GPL-3.0-or-later
// VisitAttractionEffect unit tests — verifies AttractionVisited emit.
import { parseCard } from "@mtg-forge-ts/cards";
import type { GameEvent, LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { SpellAbility } from "../spell-ability.js";
import "./index.js";
import "./visit-attraction.js";

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

const attractionSrc = `${["Name:Test Attraction", "Types:Artifact Attraction", "Oracle:Visit"].join("\n")}\n`;

const mkPaper = (src: string, name: string): PaperCard => ({
  name,
  edition: "TST",
  collectorNumber: "1",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: parseCard(src, `${name}.txt`),
});

describe("VisitAttractionEffect", () => {
  it("emits AttractionVisited event with the source card and controllerSeat", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(300);
    const card = new Card(id, mkPaper(attractionSrc, "Test Attraction"), seat, seat, ZoneType.Battlefield);
    game.cards.set(id, card);

    const Ctor = effectRegistry.lookup("VisitAttraction");
    expect(Ctor).toBeDefined();
    if (!Ctor) return;

    const ast = {
      kind: "spell" as const,
      effect: { handlerKey: "VisitAttraction", params: {} },
      cost: { raw: "" },
      rulesText: "",
    };
    const sa = new SpellAbility(ast, id, seat, new Map(), [], undefined, undefined, undefined);

    const handler = new Ctor();
    const yields = [...handler.resolve(sa, game)];

    const visited = yields.filter(
      (y) =>
        typeof y === "object" &&
        y !== null &&
        (y as { kind?: string }).kind === "event" &&
        ((y as { event: GameEvent }).event.kind as string) === "AttractionVisited",
    ) as { kind: "event"; event: GameEvent }[];
    expect(visited).toHaveLength(1);
    const ev = visited[0]?.event;
    expect(ev?.kind).toBe("AttractionVisited");
    if (ev?.kind === "AttractionVisited") {
      expect(ev.payload.attractionId).toBe(id);
      expect(ev.payload.playerSeat).toBe(seat);
    }
  });
});

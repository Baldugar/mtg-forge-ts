// SPDX-License-Identifier: GPL-3.0-or-later
// Batch D2 — CountersRemainStaticHandler tests. Verifies the static
// builds a `replacementGenerating` payload whose generated
// ReplacementAbility (a) matches the synthetic
// `clearCountersOnZoneChange` intent on the source card when the
// destination is not Hand or Library, (b) declines for Hand/Library
// destinations (per CR 122.6 carve-out), and (c) apply() returns null
// (counters carry over).
import type { LobbyPlayer, MutationIntent, StaticAst } from "@mtg-forge-ts/core";
import { SeededRng, type ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { afterEach, describe, expect, it } from "vitest";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import type { ReplacementGenPayload } from "../../statics/replacement-generating.js";
import { staticHandlerRegistry } from "../static-handler.js";
import { CountersRemainStaticHandler } from "./counters-remain.js";

const SOURCE_ID = mkEntityId(80);
const OTHER_ID = mkEntityId(81);
const STATIC_ID = mkEntityId(8);
const CONTROLLER = mkPlayerSeat(0);

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

const mkGame = (): Game => new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });

const mkAst = (validCard: string): StaticAst => ({
  mode: "CountersRemain",
  params: { ValidCard: { kind: "literal", raw: validCard } },
  // EffectZone$ All — expanded by normalizeActiveInZones to every zone.
  activeInZones: ["all" as ZoneType],
});

afterEach(() => {
  staticHandlerRegistry.clear();
  staticHandlerRegistry.register(CountersRemainStaticHandler);
});

staticHandlerRegistry.register(CountersRemainStaticHandler);

describe("CountersRemainStaticHandler (Batch D2)", () => {
  it("is registered under mode 'CountersRemain'", () => {
    expect(staticHandlerRegistry.has("CountersRemain")).toBe(true);
  });

  it("builds a replacementGenerating static with a single derived replacement", () => {
    const Cls = staticHandlerRegistry.lookup("CountersRemain");
    if (!Cls) return;
    const game = mkGame();
    const s = new Cls().build(mkAst("Card.Self"), {
      game,
      sourceCardId: SOURCE_ID,
      controllerSeat: CONTROLLER,
      staticId: STATIC_ID,
    });
    expect(s.kind).toBe("static");
    expect(s.category).toBe("replacementGenerating");
    expect(s.mode).toBe("CountersRemain");
    const payload = s.describe() as ReplacementGenPayload;
    expect(payload.kind).toBe("replacementGen");
    expect(payload.replacements).toHaveLength(1);
  });

  it("derived replacement matches clearCountersOnZoneChange on source card → non-hand/library zone", () => {
    const Cls = staticHandlerRegistry.lookup("CountersRemain");
    if (!Cls) return;
    const game = mkGame();
    const s = new Cls().build(mkAst("Card.Self"), {
      game,
      sourceCardId: SOURCE_ID,
      controllerSeat: CONTROLLER,
      staticId: STATIC_ID,
    });
    const payload = s.describe() as ReplacementGenPayload;
    const repl = payload.replacements[0];
    expect(repl).toBeDefined();
    if (!repl) return;

    const intent: MutationIntent = {
      kind: "clearCountersOnZoneChange",
      cardId: SOURCE_ID,
      toZone: "Graveyard",
    };
    expect(repl.matches(intent)).toBe(true);
    expect(repl.apply(intent, game)).toBeNull();
  });

  it("derived replacement does NOT match when destination is Hand", () => {
    const Cls = staticHandlerRegistry.lookup("CountersRemain");
    if (!Cls) return;
    const game = mkGame();
    const s = new Cls().build(mkAst("Card.Self"), {
      game,
      sourceCardId: SOURCE_ID,
      controllerSeat: CONTROLLER,
      staticId: STATIC_ID,
    });
    const payload = s.describe() as ReplacementGenPayload;
    const repl = payload.replacements[0];
    if (!repl) return;
    const intent: MutationIntent = {
      kind: "clearCountersOnZoneChange",
      cardId: SOURCE_ID,
      toZone: "Hand",
    };
    expect(repl.matches(intent)).toBe(false);
  });

  it("derived replacement does NOT match when destination is Library", () => {
    const Cls = staticHandlerRegistry.lookup("CountersRemain");
    if (!Cls) return;
    const game = mkGame();
    const s = new Cls().build(mkAst("Card.Self"), {
      game,
      sourceCardId: SOURCE_ID,
      controllerSeat: CONTROLLER,
      staticId: STATIC_ID,
    });
    const payload = s.describe() as ReplacementGenPayload;
    const repl = payload.replacements[0];
    if (!repl) return;
    const intent: MutationIntent = {
      kind: "clearCountersOnZoneChange",
      cardId: SOURCE_ID,
      toZone: "Library",
    };
    expect(repl.matches(intent)).toBe(false);
  });

  it("derived replacement (ValidCard$ Card.Self) does NOT match a different card", () => {
    const Cls = staticHandlerRegistry.lookup("CountersRemain");
    if (!Cls) return;
    const game = mkGame();
    const s = new Cls().build(mkAst("Card.Self"), {
      game,
      sourceCardId: SOURCE_ID,
      controllerSeat: CONTROLLER,
      staticId: STATIC_ID,
    });
    const payload = s.describe() as ReplacementGenPayload;
    const repl = payload.replacements[0];
    if (!repl) return;
    const intent: MutationIntent = {
      kind: "clearCountersOnZoneChange",
      cardId: OTHER_ID,
      toZone: "Graveyard",
    };
    expect(repl.matches(intent)).toBe(false);
  });

  it("derived replacement does NOT match unrelated intent kinds", () => {
    const Cls = staticHandlerRegistry.lookup("CountersRemain");
    if (!Cls) return;
    const game = mkGame();
    const s = new Cls().build(mkAst("Card.Self"), {
      game,
      sourceCardId: SOURCE_ID,
      controllerSeat: CONTROLLER,
      staticId: STATIC_ID,
    });
    const payload = s.describe() as ReplacementGenPayload;
    const repl = payload.replacements[0];
    if (!repl) return;
    expect(repl.matches({ kind: "removeCounter", cardId: SOURCE_ID, amount: 1 })).toBe(false);
  });
});

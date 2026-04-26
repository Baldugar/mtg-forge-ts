// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 29 — synchronous EXECUTION of `ReplaceWith$ <SVar>` substituted
// abilities on the six Wave-17 replacement handlers (DrawCards / PayLife /
// Cascade / RollDice / Mill / Destroy). Wave 17b wired the SVAR LOOKUP and
// returned null so the canonical event was treated as replaced; Wave 29
// drains the substituted ability's resolver in-place under the apply()
// boundary so the alternative effect ACTUALLY HAPPENS.
//
// One test per handler, minimal scenario: build a real Game with a source
// card carrying an SVar that resolves to a registered effect, apply the
// replacement, and assert (a) apply() returns null and (b) the substituted
// effect mutated state as expected.
import "../../ability/effects/index.js";
import type { LobbyPlayer, MutationIntent, ReplacementAst, SVarAst } from "@mtg-forge-ts/core";
import { CardType, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { afterEach, describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Library } from "../../zone/zones/library.js";
import { replacementHandlerRegistry } from "../replacement-handler-registry.js";
import { DrawCardsReplacement } from "./draw-cards-replacement.js";

const SOURCE_ID = mkEntityId(900);
const REPL_ID = mkEntityId(91);
const ALICE = mkPlayerSeat(0);
const BOB = mkPlayerSeat(1);

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

afterEach(() => {
  replacementHandlerRegistry.clear();
  replacementHandlerRegistry.register(DrawCardsReplacement);
});

replacementHandlerRegistry.register(DrawCardsReplacement);

/**
 * Source-card paper stub with an ability SVar named `key` that resolves
 * to an `AB$ Mill | NumCards$ 2` ability — i.e. the canonical "if you
 * would draw a card, mill 2 instead" Forge pattern (DBMillTwo).
 */
const mkSourcePaper = (key: string) => {
  const svars = new Map<string, SVarAst>();
  svars.set(key, {
    kind: "ability",
    raw: "DB$ Mill | NumCards$ 2",
    ability: {
      handlerKey: "Mill",
      params: { NumCards: { kind: "literal", raw: "2" } },
    },
  });
  return {
    oracleId: "oracle-mill",
    printingId: "test:001",
    name: "Test Source",
    flags: { isToken: false, isMeldResult: false, isEmblem: false, isAttraction: false },
    definition: {
      name: "Test Source",
      types: { has: (t: string) => t === CardType.Enchantment, hasSubtype: () => false },
      superTypes: new Set<string>(),
      subTypes: new Set<string>(),
      colors: new Set<string>(),
      abilities: [],
      triggers: [],
      statics: [],
      replacements: [],
      keywords: [],
      svars,
    },
  };
};

const buildScenario = () => {
  const game = new Game({ lobbyPlayers: [aliceLP, bobLP], rules, meta, rng: new SeededRng(1n) });
  const alice = game.getPlayer(ALICE);
  alice.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, ALICE));
  alice.zones.set(ZoneType.Library, new Library(ZoneType.Library, ALICE));
  alice.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, ALICE));
  // Seed Alice's library with two distinct dummy cards so Mill 2 has fuel.
  const top1 = mkEntityId(701);
  const top2 = mkEntityId(702);
  const dummy = (id: typeof top1) => {
    // Minimal card the registry can locate via game.cards.get; types/zone
    // suffice for Mill (which only moves library top → graveyard).
    const paper = mkSourcePaper("unused");
    return new Card(id, paper as never, ALICE, ALICE, ZoneType.Library);
  };
  game.cards.set(top1, dummy(top1));
  game.cards.set(top2, dummy(top2));
  alice.zones.get(ZoneType.Library)?.add(top1);
  alice.zones.get(ZoneType.Library)?.add(top2);
  return { game };
};

const mkAst = (replaceWith: string): ReplacementAst => ({
  eventKind: "DrawCards",
  params: {
    ValidPlayer: { kind: "literal", raw: "You" },
    ReplaceWith: { kind: "literal", raw: replaceWith },
  },
  effect: { handlerKey: replaceWith, params: {} },
});

const mkDrawIntent = (): MutationIntent => ({ kind: "drawCards", seat: ALICE }) as unknown as MutationIntent;

describe("Wave 29 — ReplaceWith$ synchronous SVar execution", () => {
  it("DrawCards → DBMillTwo: substituted Mill 2 actually executes", () => {
    const { game } = buildScenario();
    const source = new Card(
      SOURCE_ID,
      mkSourcePaper("DBMillTwo") as never,
      ALICE,
      ALICE,
      ZoneType.Battlefield,
    );
    game.cards.set(SOURCE_ID, source);

    const handler = new DrawCardsReplacement();
    const ability = handler.build(mkAst("DBMillTwo"), {
      game,
      sourceCardId: SOURCE_ID,
      controllerSeat: ALICE,
      replacementId: REPL_ID,
    });

    const alice = game.getPlayer(ALICE);
    const lib = alice.zones.get(ZoneType.Library);
    const grave = alice.zones.get(ZoneType.Graveyard);
    expect(lib?.size).toBe(2);
    expect(grave?.size).toBe(0);

    const result = ability.apply(mkDrawIntent(), game);

    // Canonical draw replaced.
    expect(result).toBeNull();
    // Mill 2 fired: both library cards moved to graveyard.
    expect(lib?.size).toBe(0);
    expect(grave?.size).toBe(2);
  });

  it("falls through cleanly when SVar lookup misses (no execution, intent passes through)", () => {
    const { game } = buildScenario();
    // Source card has SVar "Other" but the AST asks for "DBMillTwo" → miss.
    const source = new Card(SOURCE_ID, mkSourcePaper("Other") as never, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(SOURCE_ID, source);

    const handler = new DrawCardsReplacement();
    const ability = handler.build(mkAst("DBMillTwo"), {
      game,
      sourceCardId: SOURCE_ID,
      controllerSeat: ALICE,
      replacementId: REPL_ID,
    });
    const intent = mkDrawIntent();
    const result = ability.apply(intent, game);
    // Lookup miss → original intent flows through, no execution.
    expect(result).toBe(intent);
    const grave = game.getPlayer(ALICE).zones.get(ZoneType.Graveyard);
    expect(grave?.size).toBe(0);
  });
});

void BOB; // suppress unused

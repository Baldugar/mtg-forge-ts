// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 66 — Sideboard + OutsideTheGame zone, Companion hand-tutor,
// Learn lesson-tutor, Double team conjure-to-hand. Closes the
// infrastructure gaps documented in NEXT_STEPS_WAVE_59_DONE.md (Wave 66
// section) and unlocks the deferred branches in Wave 39 / 54 / 59.
import {
  CardType,
  DEFAULT_PAPER_CARD_FLAGS,
  type DecisionResponse,
  type LobbyPlayer,
  type PaperCard,
  type SVarAst,
  TypeLine,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { SeededRng, paperCardKey } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { SpellAbility } from "../ability/spell-ability.js";
// Side-effect import: registers the Learn / discard / etc. effect handlers.
import "../ability/effects/index.js";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { CompanionKeywordHandler } from "../keyword/handlers/companion-keyword.js";
import { DoubleTeamKeywordHandler } from "../keyword/handlers/double-team-keyword.js";
import { restore, snapshot } from "../snapshot/game-snapshot.js";
import { Battlefield } from "./zones/battlefield.js";
import { Exile } from "./zones/exile.js";
import { Graveyard } from "./zones/graveyard.js";
import { Hand } from "./zones/hand.js";
import { Library } from "./zones/library.js";
import { OutsideTheGame } from "./zones/outside-the-game.js";
import { Sideboard } from "./zones/sideboard.js";

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

const paper: PaperCard = {
  name: "Test",
  edition: "LEA",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const lessonPaper: PaperCard = {
  name: "Practical Lesson",
  edition: "STX",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: {
    name: "Practical Lesson",
    oracle: "",
    types: new TypeLine([], [CardType.Sorcery], ["Lesson"]),
    manaCost: null,
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars: new Map<string, unknown>(),
  },
};

const nonLessonPaper: PaperCard = {
  name: "Plain Sorcery",
  edition: "LEA",
  collectorNumber: "002",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: {
    name: "Plain Sorcery",
    oracle: "",
    types: new TypeLine([], [CardType.Sorcery], []),
    manaCost: null,
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars: new Map<string, unknown>(),
  },
};

const mkGame = () => {
  const game = new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(1n),
  });
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
    player.zones.set(ZoneType.Exile, new Exile(ZoneType.Exile, player.seat));
    player.zones.set(ZoneType.Sideboard, new Sideboard(ZoneType.Sideboard, player.seat));
    player.zones.set(ZoneType.OutsideTheGame, new OutsideTheGame(ZoneType.OutsideTheGame, player.seat));
  }
  return game;
};

// -----------------------------------------------------------------------
// 1. Sideboard zone basic
// -----------------------------------------------------------------------
describe("Wave 66 — Sideboard zone basics", () => {
  it("Player.addToSideboard places ids in the Sideboard zone; remove takes them out", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const player = game.getPlayer(seat0);
    const id = mkEntityId(100);
    player.addToSideboard(id);
    const sb = player.zones.get(ZoneType.Sideboard);
    expect(sb).toBeDefined();
    expect(sb?.contains(id)).toBe(true);
    expect(sb?.size).toBe(1);
    sb?.remove(id);
    expect(sb?.contains(id)).toBe(false);
  });
});

// -----------------------------------------------------------------------
// 2. OutsideTheGame zone enum + snapshot roundtrip
// -----------------------------------------------------------------------
describe("Wave 66 — OutsideTheGame zone enum + snapshot round-trip", () => {
  it("OutsideTheGame is a valid ZoneType and survives snapshot/restore with its items", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const player = game.getPlayer(seat0);
    const id = mkEntityId(200);
    const card = new Card(id, paper, seat0, seat0, ZoneType.OutsideTheGame);
    game.cards.set(id, card);
    player.addToOutsideTheGame(id);

    expect(ZoneType.OutsideTheGame).toBe("OutsideTheGame");
    const otg = player.zones.get(ZoneType.OutsideTheGame);
    expect(otg?.contains(id)).toBe(true);

    // Snapshot/restore round-trip — the OutsideTheGame zone + its items
    // must survive a serialization cycle.
    const snap = snapshot(game);
    const paperCards = new Map<string, PaperCard>();
    paperCards.set(paperCardKey(paper), paper);
    const restored = restore(snap, {
      lobbyPlayers: [alice, bob],
      rng: new SeededRng(1n),
      paperCards,
      rules,
    });
    const restoredOtg = restored.getPlayer(seat0).zones.get(ZoneType.OutsideTheGame);
    expect(restoredOtg).toBeDefined();
    expect(restoredOtg?.contains(id)).toBe(true);
  });
});

// -----------------------------------------------------------------------
// 3. Companion hand-tutor: ability appears + costs {3} + moves to hand
// -----------------------------------------------------------------------
describe("Wave 66 — Companion hand-tutor SA", () => {
  it("synthesizes a Sideboard/OutsideTheGame-zone activated SA tagged 'companion' with cost {3}", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const id = mkEntityId(300);
    const card = new Card(id, paper, seat0, seat0, ZoneType.Sideboard);
    game.cards.set(id, card);
    game.getPlayer(seat0).addToSideboard(id);

    const handler = new CompanionKeywordHandler();
    handler.activate(
      { keyword: "companion", params: { detail: { kind: "literal", raw: "Card.Self:Reminder" } } } as never,
      { game, sourceCardId: id, controllerSeat: seat0 },
    );

    const sa = card.spellAbilities.find((s) => s.tags.has("companion"));
    expect(sa).toBeDefined();
    expect(sa?.activeInZones.has(ZoneType.Sideboard)).toBe(true);
    expect(sa?.activeInZones.has(ZoneType.OutsideTheGame)).toBe(true);
    expect(sa?.ast.cost.raw).toBe("3");
  });

  it("on resolve, moves the companion from sideboard to hand and stamps companionUsedThisGame", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const id = mkEntityId(301);
    const card = new Card(id, paper, seat0, seat0, ZoneType.Sideboard);
    game.cards.set(id, card);
    game.getPlayer(seat0).addToSideboard(id);

    const handler = new CompanionKeywordHandler();
    handler.activate(
      { keyword: "companion", params: { detail: { kind: "literal", raw: "Card.Self:Reminder" } } } as never,
      { game, sourceCardId: id, controllerSeat: seat0 },
    );
    const sa = card.spellAbilities.find((s) => s.tags.has("companion"));
    expect(sa).toBeDefined();
    if (!sa) throw new Error("companion SA not synthesized");
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    let r = gen.next();
    while (!r.done) r = gen.next();

    expect(card.zone).toBe(ZoneType.Hand);
    expect(game.flags.companionUsedThisGame.get(seat0)).toBe(true);
    const hand = game.getPlayer(seat0).zones.get(ZoneType.Hand);
    expect(hand?.contains(id)).toBe(true);
    const sb = game.getPlayer(seat0).zones.get(ZoneType.Sideboard);
    expect(sb?.contains(id)).toBe(false);
  });
});

// -----------------------------------------------------------------------
// 4. Companion once-per-game flag (second activation rejected)
// -----------------------------------------------------------------------
describe("Wave 66 — Companion once-per-game gate", () => {
  it("resolver is idempotent: second activation does NOT re-move the card", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const id = mkEntityId(302);
    const card = new Card(id, paper, seat0, seat0, ZoneType.Sideboard);
    game.cards.set(id, card);
    game.getPlayer(seat0).addToSideboard(id);

    const handler = new CompanionKeywordHandler();
    handler.activate(
      { keyword: "companion", params: { detail: { kind: "literal", raw: "Card.Self:Reminder" } } } as never,
      { game, sourceCardId: id, controllerSeat: seat0 },
    );
    const sa = card.spellAbilities.find((s) => s.tags.has("companion"));
    if (!sa) throw new Error("companion SA not synthesized");

    // First activation: resolves to Hand.
    const gen1 = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    let r = gen1.next();
    while (!r.done) r = gen1.next();
    expect(card.zone).toBe(ZoneType.Hand);
    expect(game.flags.companionUsedThisGame.get(seat0)).toBe(true);

    // Manually move back to sideboard (simulating an opponent's bounce
    // back to outside-the-game / a hypothetical re-staging scenario) so
    // the gate's "second activation rejected" semantics are testable.
    const hand = game.getPlayer(seat0).zones.get(ZoneType.Hand);
    hand?.remove(id);
    game.getPlayer(seat0).addToSideboard(id);
    card.zone = ZoneType.Sideboard;

    // Second activation: resolver checks the once-per-game flag and
    // bails before the move. The card stays in Sideboard.
    const gen2 = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    r = gen2.next();
    while (!r.done) r = gen2.next();
    expect(card.zone).toBe(ZoneType.Sideboard);
    const sb = game.getPlayer(seat0).zones.get(ZoneType.Sideboard);
    expect(sb?.contains(id)).toBe(true);
  });
});

// -----------------------------------------------------------------------
// 5. Learn lesson-tutor: chooseCard over sideboard Lessons
// -----------------------------------------------------------------------
describe("Wave 66 — Learn lesson-tutor", () => {
  const mkSa = (handlerKey: string, sourceId = mkEntityId(10), controllerSeat = mkPlayerSeat(0)) =>
    new SpellAbility(
      {
        kind: "spell",
        effect: { handlerKey, params: {} as never },
        cost: { raw: "" },
      },
      sourceId,
      controllerSeat,
      new Map<string, SVarAst>(),
      [],
    );

  it("yields a chooseCard request over sideboard Lessons when lesson is picked", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const player = game.getPlayer(seat0);
    // Source on battlefield.
    const sourceId = mkEntityId(400);
    const sourceCard = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, sourceCard);
    player.zones.get(ZoneType.Battlefield)?.add(sourceId);

    // Two cards in sideboard: one Lesson, one non-Lesson.
    const lessonId = mkEntityId(401);
    const lessonCard = new Card(lessonId, lessonPaper, seat0, seat0, ZoneType.Sideboard);
    game.cards.set(lessonId, lessonCard);
    player.addToSideboard(lessonId);

    const nonLessonId = mkEntityId(402);
    const nonLessonCard = new Card(nonLessonId, nonLessonPaper, seat0, seat0, ZoneType.Sideboard);
    game.cards.set(nonLessonId, nonLessonCard);
    player.addToSideboard(nonLessonId);

    const sa = mkSa("Learn", sourceId);
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    // First yield: chooseLearnOption.
    let r = gen.next();
    expect((r.value as { request?: { kind?: string } }).request?.kind).toBe("chooseLearnOption");
    // Pick lesson.
    r = gen.next({ kind: "chooseLearnOption", option: "lesson" } satisfies DecisionResponse);
    // Second yield: chooseCard restricted to Lesson cards in sideboard.
    expect((r.value as { request?: { kind?: string } }).request?.kind).toBe("chooseCard");
    const pool = (r.value as { request: { pool: readonly number[] } }).request.pool;
    expect(pool).toContain(lessonId);
    expect(pool).not.toContain(nonLessonId);
    // Pick the lesson.
    r = gen.next({ kind: "chooseCard", chosen: [lessonId] } satisfies DecisionResponse);
    while (!r.done) r = gen.next();

    // Lesson moved sideboard → hand.
    expect(lessonCard.zone).toBe(ZoneType.Hand);
    const hand = player.zones.get(ZoneType.Hand);
    expect(hand?.contains(lessonId)).toBe(true);
    const sb = player.zones.get(ZoneType.Sideboard);
    expect(sb?.contains(lessonId)).toBe(false);
  });

  // -----------------------------------------------------------------------
  // 6. Learn no-Lesson-available — graceful no-op
  // -----------------------------------------------------------------------
  it("when no Lesson exists in sideboard, lesson branch is a graceful no-op", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const player = game.getPlayer(seat0);
    const sourceId = mkEntityId(410);
    const sourceCard = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, sourceCard);
    player.zones.get(ZoneType.Battlefield)?.add(sourceId);

    // Sideboard contains only a non-Lesson card.
    const nonLessonId = mkEntityId(411);
    const nonLessonCard = new Card(nonLessonId, nonLessonPaper, seat0, seat0, ZoneType.Sideboard);
    game.cards.set(nonLessonId, nonLessonCard);
    player.addToSideboard(nonLessonId);

    const sa = mkSa("Learn", sourceId);
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    let r = gen.next();
    r = gen.next({ kind: "chooseLearnOption", option: "lesson" } satisfies DecisionResponse);
    while (!r.done) r = gen.next();

    // Non-Lesson stays in sideboard; the source's flag is stamped.
    expect(nonLessonCard.zone).toBe(ZoneType.Sideboard);
    expect((sourceCard as unknown as { learnLessonRequested?: boolean }).learnLessonRequested).toBe(true);
  });
});

// -----------------------------------------------------------------------
// 7. Double team conjure: attacks-trigger spawns duplicate in hand
// -----------------------------------------------------------------------
describe("Wave 66 — Double team conjure-to-hand", () => {
  it("attacks-trigger conjures a duplicate via OutsideTheGame → Hand", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const player = game.getPlayer(seat0);
    const id = mkEntityId(500);
    const card = new Card(id, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(id, card);
    player.zones.get(ZoneType.Battlefield)?.add(id);

    const handler = new DoubleTeamKeywordHandler();
    handler.activate({ keyword: "double_team", params: {} } as never, {
      game,
      sourceCardId: id,
      controllerSeat: seat0,
    });
    expect(card.triggeredAbilities).toBeDefined();
    expect(card.triggeredAbilities?.length).toBeGreaterThan(0);
    const ta = card.triggeredAbilities?.[0] as
      | { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
      | undefined;
    if (!ta || !ta.resolver) throw new Error("trigger resolver missing");

    const handBefore = player.zones.get(ZoneType.Hand)?.size ?? 0;
    const gen = ta.resolver.resolve(game) as Generator<unknown, void, unknown>;
    let r = gen.next();
    while (!r.done) r = gen.next();
    const handAfter = player.zones.get(ZoneType.Hand)?.size ?? 0;
    expect(handAfter).toBe(handBefore + 1);
    // The original is stamped with the doubled-flag and remains on the
    // battlefield.
    expect((card as unknown as { doubleTeamUsed?: boolean }).doubleTeamUsed).toBe(true);
    expect(card.zone).toBe(ZoneType.Battlefield);
  });

  // -----------------------------------------------------------------------
  // 8. Double team doubled counter — subsequent attacks don't re-conjure
  // -----------------------------------------------------------------------
  it("subsequent attacks-trigger fires no-op when the doubled marker is set", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const player = game.getPlayer(seat0);
    const id = mkEntityId(501);
    const card = new Card(id, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(id, card);
    player.zones.get(ZoneType.Battlefield)?.add(id);

    const handler = new DoubleTeamKeywordHandler();
    handler.activate({ keyword: "double_team", params: {} } as never, {
      game,
      sourceCardId: id,
      controllerSeat: seat0,
    });
    const ta = card.triggeredAbilities?.[0] as
      | { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
      | undefined;
    if (!ta || !ta.resolver) throw new Error("trigger resolver missing");

    // First fire: conjures.
    let gen = ta.resolver.resolve(game) as Generator<unknown, void, unknown>;
    let r = gen.next();
    while (!r.done) r = gen.next();
    const handAfterFirst = player.zones.get(ZoneType.Hand)?.size ?? 0;
    expect(handAfterFirst).toBe(1);

    // Second fire: should bail because doubleTeamUsed is now set.
    gen = ta.resolver.resolve(game) as Generator<unknown, void, unknown>;
    r = gen.next();
    while (!r.done) r = gen.next();
    const handAfterSecond = player.zones.get(ZoneType.Hand)?.size ?? 0;
    expect(handAfterSecond).toBe(handAfterFirst); // unchanged
  });
});

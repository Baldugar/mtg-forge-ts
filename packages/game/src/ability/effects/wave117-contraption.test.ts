// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 117 — Contraption deck shuffle + crank trigger.
//
// Closes the Wave 45 AssembleContraption TODO(advanced) tail:
//   * Player.contraptionDeck zone slot exists + can be populated.
//   * AssembleContraption pops the top of the contraption deck onto the
//     battlefield and tags the moved card with the chosen sprocket.
//   * When the contraption deck is empty AND the discard pile is non-
//     empty, AssembleContraption shuffles the discard back in (CR 308.3)
//     before popping.
//   * AdvanceCrank fires CardCranked per on-sprocket contraption AFTER
//     rotating the per-controller sprocket pointer; the CrankContraption
//     trigger handler latches the correct sources.
//   * Snapshot v7 round-tripping preserves both contraptionDeck and
//     contraptionDiscard so save/load mid-contraption-game survives.
import "./index.js";
import "../../trigger/handlers/index.js";
import type { LobbyPlayer, PaperCard, TriggerAst } from "@mtg-forge-ts/core";
import {
  DEFAULT_PAPER_CARD_FLAGS,
  PhaseStep,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkEvent,
  mkPlayerSeat,
  paperCardKey,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { restore, snapshot } from "../../snapshot/game-snapshot.js";
import { triggerHandlerRegistry } from "../../trigger/trigger-handler-registry.js";
import type { TriggerBuildContext } from "../../trigger/trigger-handler.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Exile } from "../../zone/zones/exile.js";
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
  cardDataSyncedAt: "2026-04-30T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};
const plainPaper: PaperCard = {
  name: "Test",
  edition: "TST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const mkGame = (seed = 1n): Game => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(seed) });
  for (const p of game.players) {
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
    p.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p.seat));
    p.zones.set(ZoneType.Library, new Library(ZoneType.Library, p.seat));
    p.zones.set(ZoneType.Exile, new Exile(ZoneType.Exile, p.seat));
  }
  return game;
};

const drainGen = (gen: Generator<unknown, void, unknown>): unknown[] => {
  const out: unknown[] = [];
  let r = gen.next();
  while (!r.done) {
    out.push(r.value);
    r = gen.next();
  }
  return out;
};

const mkSa = (
  handlerKey: string,
  params: Record<string, { kind: string; raw: string }>,
  sourceId = mkEntityId(10),
  controllerSeat = mkPlayerSeat(0),
) =>
  new SpellAbility(
    {
      kind: "spell",
      effect: { handlerKey, params: params as never },
      cost: { raw: "" },
    },
    sourceId,
    controllerSeat,
    new Map(),
    [],
  );

const seedSourceCard = (game: Game, sourceId = mkEntityId(10), seat = mkPlayerSeat(0)): Card => {
  const c = new Card(sourceId, plainPaper, seat, seat, ZoneType.Battlefield);
  game.cards.set(sourceId, c);
  const bf = game.getPlayer(seat).zones.get(ZoneType.Battlefield);
  bf?.add(sourceId);
  return c;
};

// ---------------------------------------------------------------------------
// (1) Player.contraptionDeck slot exists + populated
// ---------------------------------------------------------------------------
describe("Wave 117 — Player.contraptionDeck slot", () => {
  it("defaults to undefined and accepts a populated Library-shaped zone", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const player = game.getPlayer(seat0);
    expect(player.contraptionDeck).toBeUndefined();
    expect(player.contraptionDiscard).toEqual([]);

    const deck = new Library(ZoneType.ContraptionDeck, seat0);
    const a = mkEntityId(8001);
    const b = mkEntityId(8002);
    deck.add(a);
    deck.add(b);
    player.contraptionDeck = deck;
    expect(player.contraptionDeck.size).toBe(2);
    expect(player.contraptionDeck.toArray()).toEqual([a, b]);
  });
});

// ---------------------------------------------------------------------------
// (2) AssembleContraption pops top + chooses sprocket
// ---------------------------------------------------------------------------
describe("Wave 117 — AssembleContraption pops top + chooses sprocket", () => {
  it("pops the top of contraptionDeck onto battlefield + stamps assignedSprocket", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(8100);
    seedSourceCard(game, sourceId, seat0);
    const player = game.getPlayer(seat0);

    const deck = new Library(ZoneType.ContraptionDeck, seat0);
    const contraptionId = mkEntityId(8110);
    const contraptionCard = new Card(contraptionId, plainPaper, seat0, seat0, ZoneType.ContraptionDeck);
    game.cards.set(contraptionId, contraptionCard);
    deck.add(contraptionId);
    player.contraptionDeck = deck;

    const sa = mkSa("AssembleContraption", { Amount: { kind: "literal", raw: "1" } }, sourceId, seat0);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    const bf = player.zones.get(ZoneType.Battlefield);
    expect(bf?.toArray()).toContain(contraptionId);
    expect(deck.size).toBe(0);
    const moved = game.cards.get(contraptionId);
    const stampedSprocket = (moved as unknown as { assignedSprocket?: number }).assignedSprocket;
    expect(stampedSprocket).toBe(1); // canonical default with no decision response
  });
});

// ---------------------------------------------------------------------------
// (3) Empty contraptionDeck reshuffles from discard
// ---------------------------------------------------------------------------
describe("Wave 117 — empty contraptionDeck reshuffles from discard (CR 308.3)", () => {
  it("shuffles the discard pile back into the deck before popping", () => {
    const game = mkGame(7n);
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(8200);
    seedSourceCard(game, sourceId, seat0);
    const player = game.getPlayer(seat0);

    // Deck starts empty; discard has three contraption ids.
    const emptyDeck = new Library(ZoneType.ContraptionDeck, seat0);
    player.contraptionDeck = emptyDeck;
    const discardIds = [mkEntityId(8210), mkEntityId(8211), mkEntityId(8212)];
    for (const id of discardIds) {
      const c = new Card(id, plainPaper, seat0, seat0, ZoneType.ContraptionDeck);
      game.cards.set(id, c);
    }
    player.contraptionDiscard = [...discardIds];

    const sa = mkSa("AssembleContraption", { Amount: { kind: "literal", raw: "1" } }, sourceId, seat0);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    // After resolution: discard cleared, one card moved to battlefield,
    // remaining two sit in the now-shuffled deck.
    expect(player.contraptionDiscard.length).toBe(0);
    expect(emptyDeck.size).toBe(2);
    const bf = player.zones.get(ZoneType.Battlefield);
    const onBf = (bf?.toArray() ?? []).filter((id) => discardIds.includes(id));
    expect(onBf.length).toBe(1);
  });

  it("falls through to the legacy counter-bump path when both deck and discard are empty", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(8250);
    seedSourceCard(game, sourceId, seat0);
    const player = game.getPlayer(seat0);

    const emptyDeck = new Library(ZoneType.ContraptionDeck, seat0);
    player.contraptionDeck = emptyDeck;
    // discard already []

    const sa = mkSa("AssembleContraption", { Amount: { kind: "literal", raw: "2" } }, sourceId, seat0);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    const rec = game.flags.attractions.get(seat0) as { assembledContraptions?: number } | undefined;
    expect(rec?.assembledContraptions).toBe(2);
    const source = game.cards.get(sourceId);
    expect(source?.attractions).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// (4) AdvanceCrank — CardCranked per contraption + ContraptionCranked pulse
// ---------------------------------------------------------------------------
describe("Wave 117 — AdvanceCrank fires CardCranked per on-sprocket contraption", () => {
  it("emits CardCranked for each contraption whose assignedSprocket matches the rotated pointer", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(8300);
    seedSourceCard(game, sourceId, seat0);
    const player = game.getPlayer(seat0);

    // Three contraptions: two on sprocket 1, one on sprocket 2. First crank
    // lands on sprocket 1 (Forge default).
    const c1 = mkEntityId(8310);
    const c2 = mkEntityId(8311);
    const c3 = mkEntityId(8312);
    const bf = player.zones.get(ZoneType.Battlefield);
    for (const [id, sp] of [
      [c1, 1],
      [c2, 1],
      [c3, 2],
    ] as const) {
      const card = new Card(id, plainPaper, seat0, seat0, ZoneType.Battlefield);
      (card as unknown as { assignedSprocket?: number }).assignedSprocket = sp;
      game.cards.set(id, card);
      bf?.add(id);
    }

    const sa = mkSa("AdvanceCrank", {}, sourceId, seat0);
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const events = yields
      .filter(
        (y): y is { kind: "event"; event: { kind: string; payload: unknown } } =>
          typeof y === "object" && y !== null && (y as { kind?: string }).kind === "event",
      )
      .map((y) => y.event);

    // CardCranked: source + the two on-sprocket contraptions = 3 emissions.
    const crankedEvents = events.filter((e) => e.kind === "CardCranked");
    const crankedIds = crankedEvents.map((e) => (e.payload as { cardId: number }).cardId);
    expect(crankedIds).toContain(sourceId as unknown as number);
    expect(crankedIds).toContain(c1 as unknown as number);
    expect(crankedIds).toContain(c2 as unknown as number);
    expect(crankedIds).not.toContain(c3 as unknown as number);

    // ContraptionCranked deck-event pulse: sprocket 1, ids = [c1, c2].
    const pulse = events.find((e) => e.kind === "ContraptionCranked");
    expect(pulse).toBeDefined();
    const payload = pulse?.payload as { sprocket: number; cardIds: readonly number[] };
    expect(payload.sprocket).toBe(1);
    expect(new Set(payload.cardIds)).toEqual(new Set([c1, c2] as unknown as number[]));
  });

  it("CrankContraption trigger handler matches per-contraption CardCranked with ValidPlayer$ You", () => {
    const SOURCE_ID = mkEntityId(8400);
    const OTHER_ID = mkEntityId(8401);
    const TRIGGER_ID = mkEntityId(8402);
    const CONTROLLER = mkPlayerSeat(0);
    const OPPONENT = mkPlayerSeat(1);

    const ctx: TriggerBuildContext = {
      game: {} as never,
      sourceCardId: SOURCE_ID,
      controllerSeat: CONTROLLER,
      triggerId: TRIGGER_ID,
    };
    const ast: TriggerAst = {
      mode: "CrankContraption",
      params: {
        ValidCard: { kind: "literal", raw: "Card" },
        ValidPlayer: { kind: "literal", raw: "You" },
      },
      effect: { handlerKey: "TrigPump", params: {} },
    };
    const Cls = triggerHandlerRegistry.lookup("CrankContraption");
    if (!Cls) throw new Error("CrankContraption handler not registered");
    const ta = new Cls().build(ast, ctx);

    // Self-cranked by controller: matches.
    expect(
      ta.matches(
        mkEvent("CardCranked", 1, PhaseStep.Main1, {
          cardId: OTHER_ID,
          controllerSeat: CONTROLLER,
        }),
      ),
    ).toBe(true);
    // Opponent cranked: ValidPlayer$ You blocks.
    expect(
      ta.matches(
        mkEvent("CardCranked", 1, PhaseStep.Main1, {
          cardId: OTHER_ID,
          controllerSeat: OPPONENT,
        }),
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (5) Snapshot v7 round-trip preserves contraption state
// ---------------------------------------------------------------------------
describe("Wave 117 — snapshot v7 preserves contraption deck + discard", () => {
  it("round-trips contraptionDeck items + contraptionDiscard ids losslessly", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const player = game.getPlayer(seat0);

    // Stand up a contraption deck with two cards + a discard with one.
    const deck = new Library(ZoneType.ContraptionDeck, seat0);
    const a = mkEntityId(8500);
    const b = mkEntityId(8501);
    const dis = mkEntityId(8510);
    for (const id of [a, b, dis]) {
      const c = new Card(id, plainPaper, seat0, seat0, ZoneType.ContraptionDeck);
      game.cards.set(id, c);
    }
    deck.add(a);
    deck.add(b);
    player.contraptionDeck = deck;
    player.contraptionDiscard = [dis];

    const blob = snapshot(game);
    const wire = JSON.parse(JSON.stringify(blob)) as typeof blob;

    const restored = restore(wire, {
      lobbyPlayers: [alice, bob],
      paperCards: new Map([[paperCardKey(plainPaper), plainPaper]]),
      rules,
      rng: new SeededRng(1n),
    });
    const rp = restored.getPlayer(seat0);
    expect(rp.contraptionDeck).toBeDefined();
    expect(rp.contraptionDeck?.size).toBe(2);
    expect(rp.contraptionDeck?.toArray()).toEqual([a, b]);
    expect(rp.contraptionDiscard).toEqual([dis]);
  });

  it("a player with no contraption corpus emits NO contraptionDeck/contraptionDiscard fields", () => {
    const game = mkGame();
    const blob = snapshot(game);
    for (const sp of blob.state.players) {
      expect(sp.contraptionDeck).toBeUndefined();
      expect(sp.contraptionDiscard).toBeUndefined();
    }
  });
});

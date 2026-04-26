// SPDX-License-Identifier: GPL-3.0-or-later
// F-Specialize — March of the Machine Specialize flagship test
// (Gale, Conduit of the Arcane).
//
// Specialize: {2}, choose a color — turn this card into the corresponding
// color-variant face. Real Forge data carries a primary face plus five
// "SPECIALIZE:<COLOR>" sections (W/U/B/R/G); the SP4 PaperCard ingest maps
// those sections into PaperCard.faces under "W"/"U"/"B"/"R"/"G" slot keys.
// SP3 tests synthesize the faces map directly.
//
// Test scenario (end-to-end):
//   1. Build a Gale, Conduit of the Arcane card (K:Specialize:2) on Alice's
//      battlefield, with PaperCard.faces seeded for each of the five
//      specialize variants (only "Gale, Storm Conduit" — the red face —
//      is exercised here; the others are present for symmetry).
//   2. activateKeywordsFromDefinition wires the SpecializeKeywordHandler,
//      which synthesizes a Battlefield-zone activated SpellAbility tagged
//      "specialize" with handlerKey "Specialize".
//   3. Seed 2 colorless mana in Alice's pool.
//   4. Activate the specialize ability via game.action.activateAbility.
//      — Pays the {2} cost.
//      — Pushes a Specialize StackItem onto the stack.
//   5. Resolve the stack item, responding "red" to the chooseColor decision.
//   6. Assert:
//      - card.face === "R".
//      - LayerEngine.computeCharacteristics sees the new face's name
//        ("Gale, Storm Conduit") on the card.
//      - A CardSpecialized event was emitted.
//      - SpecializesTrigger.matches returns true on the emitted event
//        (smoke test for Wave 20 trigger wiring).
import { parseCard } from "@mtg-forge-ts/cards";
import type { EntityId, GameEvent, LobbyPlayer, PaperCard, PlayerSeat, TriggerAst } from "@mtg-forge-ts/core";
import {
  Color,
  DEFAULT_PAPER_CARD_FLAGS,
  ManaProduced,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkEvent,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../src/card.js";
import type { GameMeta } from "../../src/game-meta.js";
import type { GameRules } from "../../src/game-rules.js";
import { Game } from "../../src/game.js";
import { ManaPool } from "../../src/mana/mana-pool.js";
import { resolveStackItem } from "../../src/resolve/effect-resolve.js";
import { SpecializesTrigger } from "../../src/trigger/handlers/wave-20-triggers.js";
import { Battlefield } from "../../src/zone/zones/battlefield.js";
import { Graveyard } from "../../src/zone/zones/graveyard.js";
import { Hand } from "../../src/zone/zones/hand.js";
import { Library } from "../../src/zone/zones/library.js";

// --- Bootstrap registries ---
import "../../src/cost/parts/index.js";
import "../../src/ability/effects/index.js";
import "../../src/keyword/index.js";
import "../../src/svar/selectors/number.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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
  forgeSha: "specialize-test",
  cardDataSyncedAt: "2026-04-24T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "55",
};

// Gale, Conduit of the Arcane — primary face only. Real Forge data has
// SPECIALIZE:WHITE..GREEN sections; SP3 hand-stitches the per-color faces
// into PaperCard.faces below to match what the SP4 ingest will produce.
const galeSrc = `${[
  "Name:Gale, Conduit of the Arcane",
  "ManaCost:3 U",
  "Types:Legendary Creature Human Wizard",
  "PT:2/3",
  "K:Specialize:2",
  "Oracle:Specialize {2}.",
].join("\n")}\n`;

const makeGame = (): Game => new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(55n) });

function setupZones(game: Game, seat: PlayerSeat): void {
  const player = game.getPlayer(seat);
  player.zones.set(ZoneType.Library, new Library(ZoneType.Library, seat));
  player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, seat));
  player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, seat));
  player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, seat));
}

function addCardToBattlefield(game: Game, paper: PaperCard, seat: PlayerSeat, id: EntityId): Card {
  const card = new Card(id, paper, seat, seat, ZoneType.Battlefield);
  game.cards.set(id, card);
  const bf = game.getPlayer(seat).zones.get(ZoneType.Battlefield);
  if (!bf) throw new Error("test: missing battlefield zone");
  bf.add(id);
  return card;
}

// Drive a generator. When a chooseColor decision arrives, respond with
// red. Other decisions/replacements get default responses.
function driveGen(
  gen: Generator<unknown, unknown, unknown>,
  chosenColor: Color = Color.Red,
): { events: GameEvent[] } {
  const events: GameEvent[] = [];
  let step = gen.next();
  while (!step.done) {
    const y = step.value as {
      kind?: string;
      event?: GameEvent;
      request?: { kind?: string; replacementIds?: number[] };
    };
    if (y.kind === "event" && y.event) {
      events.push(y.event);
      step = gen.next();
    } else if (y.kind === "decision" && y.request?.kind === "chooseColor") {
      step = gen.next({ kind: "chooseColor", color: chosenColor });
    } else if (y.kind === "decision" && y.request?.kind === "orderReplacements") {
      step = gen.next({ order: [...(y.request.replacementIds ?? [])] });
    } else if (y.kind === "decision" && y.request?.kind === "activateManaAbilities") {
      step = gen.next({ kind: "activateManaAbilities", done: true });
    } else {
      step = gen.next();
    }
  }
  return { events };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Flagship: Specialize — Gale, Conduit of the Arcane end-to-end", () => {
  const galeId = mkEntityId(33000);

  function buildGalePaper(): PaperCard {
    const def = parseCard(galeSrc, "gale.txt");
    return {
      name: "Gale, Conduit of the Arcane",
      edition: "MOM",
      collectorNumber: "59",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
      faces: {
        W: { name: "Gale, Holy Conduit" },
        U: { name: "Gale, Temporal Conduit" },
        B: { name: "Gale, Abyssal Conduit" },
        R: { name: "Gale, Storm Conduit" },
        G: { name: "Gale, Verdant Conduit" },
      },
    };
  }

  it("SpecializeKeywordHandler synthesizes a Battlefield-zone activated ability", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    setupZones(game, seat);

    const paper = buildGalePaper();
    const card = addCardToBattlefield(game, paper, seat, galeId);
    card.activateKeywordsFromDefinition(game);

    const specializeAbility = card.spellAbilities.find((sa) => sa.tags.has("specialize"));
    expect(specializeAbility).toBeDefined();
    expect(specializeAbility?.handlerKey).toBe("Specialize");
    expect(specializeAbility?.activeInZones.has(ZoneType.Battlefield)).toBe(true);
    expect(specializeAbility?.activeInZones.has(ZoneType.Hand)).toBe(false);
    expect(specializeAbility?.ast.cost.raw).toBe("2");
    expect(card.keywords?.has("specialize")).toBe(true);
  });

  it("specialize Gale: pay {2}, choose red → card.face becomes 'R'", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    setupZones(game, seat);

    const paper = buildGalePaper();
    const card = addCardToBattlefield(game, paper, seat, galeId);
    card.activateKeywordsFromDefinition(game);

    // Sanity: face starts at "default" — deriveBaseCharacteristics uses
    // the printed name.
    expect(card.face).toBe("default");
    const baseCharsBefore = game.layerEngine.computeCharacteristics(galeId);
    expect(baseCharsBefore.name).toBe("Gale, Conduit of the Arcane");

    // Seed 2 colorless mana for the {2} cost.
    const pool = new ManaPool();
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colorless());
    game.getPlayer(seat).manaPool = pool;
    expect(pool.size()).toBe(2);

    const specializeIndex = card.spellAbilities.findIndex((sa) => sa.tags.has("specialize"));
    expect(specializeIndex).toBeGreaterThanOrEqual(0);

    // Activate — pays {2}, pushes Specialize ability on the stack.
    const { events: activateEvents } = driveGen(
      game.action.activateAbility(galeId, specializeIndex, seat) as Generator<unknown, unknown, unknown>,
    );
    expect(pool.size()).toBe(0);
    expect(activateEvents.map((e) => e.kind)).toContain("AbilityActivated");
    expect(game.sharedZones.stack.size).toBe(1);

    // Resolve the stack item — responds chooseColor with red.
    const stackItem = game.sharedZones.stack.top();
    if (!stackItem) throw new Error("test: stack empty after specialize activation");
    const { events: resolveEvents } = driveGen(
      resolveStackItem(game, stackItem) as Generator<unknown, unknown, unknown>,
      Color.Red,
    );

    // CardSpecialized fired with color "R".
    const specEvents = resolveEvents.filter((e) => e.kind === "CardSpecialized");
    expect(specEvents.length).toBe(1);
    const spec = specEvents[0];
    if (!spec || spec.kind !== "CardSpecialized") throw new Error("expected CardSpecialized");
    expect(spec.payload.cardId).toBe(galeId);
    expect(spec.payload.color).toBe("R");

    // Card.face flipped to the red slot.
    expect(card.face).toBe("R");

    // Layer engine reads the new face's name. The epoch was bumped during
    // resolution so the cached pre-flip Characteristics is invalidated.
    const baseCharsAfter = game.layerEngine.computeCharacteristics(galeId);
    expect(baseCharsAfter.name).toBe("Gale, Storm Conduit");
    expect(baseCharsAfter).not.toBe(baseCharsBefore); // fresh reference

    // SpecializesTrigger.matches smoke test — Wave 20 trigger wiring sees
    // the emitted event for this exact card.
    const fakeAst = {
      mode: "Specializes" as const,
      effect: { handlerKey: "Noop", params: {} },
      params: {},
    } as unknown as TriggerAst;
    const trigger = new SpecializesTrigger().build(fakeAst, {
      game,
      sourceCardId: galeId,
      controllerSeat: seat,
      triggerId: mkEntityId(99999),
    });
    expect(trigger.matches(spec)).toBe(true);
    // And does not match an unrelated event.
    const unrelated = mkEvent("CardSpecialized", game.turn, game.phase, {
      cardId: mkEntityId(8888),
      color: "R",
    });
    expect(trigger.matches(unrelated)).toBe(false);

    expect(game.sharedZones.stack.size).toBe(0);
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
// Flagship — Cascade keyword end-to-end via Bituminous Blast (CMC 5).
//
// Scenario:
//   1. Build Bituminous Blast (3RB instant) with K:Cascade in hand.
//   2. Activate keywords → cascade trigger registered.
//   3. Library top→bottom = [Forgotten Cave (Land), Grizzly Bears (CMC 2)].
//   4. Drive the cascade resolver directly:
//        - Forgotten Cave is exiled and SKIPPED (it's a land).
//        - Grizzly Bears is exiled; CMC 2 < 5 → it's the FOUND card.
//        - Resolver yields a confirmAction "may cast for free".
//        - Respond { confirmed: true }.
//        - FreeCastPipeline runs from Exile; SpellCast(Bears) emits.
//   5. Assert:
//        - Forgotten Cave landed in Exile (the cascade-leftover would normally
//          be shuffled to bottom-of-library, but with only one leftover it's
//          moved to library directly).
//        - Grizzly Bears is on the stack as a fresh cast.
//
// The test exercises the resolver in isolation — we don't drive the full
// cast-pipeline of Bituminous Blast itself; the spell-cast trigger framework
// is unit-tested elsewhere. This keeps the flagship focused on the cascade
// search / "may cast for free" branch.
import { parseCard } from "@mtg-forge-ts/cards";
import type { EntityId, LobbyPlayer, PaperCard, PlayerSeat, TriggeredAbility } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../src/card.js";
import type { GameMeta } from "../../src/game-meta.js";
import type { GameRules } from "../../src/game-rules.js";
import { Game } from "../../src/game.js";
import type { StackItemResolver } from "../../src/stack/stack-item.js";
import { Exile } from "../../src/zone/zones/exile.js";
import { Graveyard } from "../../src/zone/zones/graveyard.js";
import { Hand } from "../../src/zone/zones/hand.js";
import { Library } from "../../src/zone/zones/library.js";

// Bootstrap registries.
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
  forgeSha: "abc",
  cardDataSyncedAt: "2026-04-26T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "13",
};

const bitumBlastSrc = `${[
  "Name:Bituminous Blast",
  "ManaCost:3 R B",
  "Types:Instant",
  "K:Cascade",
  "Oracle:Cascade.",
].join("\n")}\n`;

const grizzlyBearsSrc = `${[
  "Name:Grizzly Bears",
  "ManaCost:1 G",
  "Types:Creature Bear",
  "PT:2/2",
  "Oracle:",
].join("\n")}\n`;

const forgottenCaveSrc = `${["Name:Forgotten Cave", "Types:Land Mountain", "Oracle:"].join("\n")}\n`;

const makeGame = (): Game => new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(13n) });

function setupZones(game: Game, seat: PlayerSeat): void {
  const player = game.getPlayer(seat);
  player.zones.set(ZoneType.Library, new Library(ZoneType.Library, seat));
  player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, seat));
  player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, seat));
  // Exile is shared by spec, but tests historically set it per-seat to keep
  // assertions seat-scoped. Here we install one for the active seat.
  player.zones.set(ZoneType.Exile, new Exile(ZoneType.Exile, seat));
}

function paper(definitionSrc: string, name: string, file: string): PaperCard {
  return {
    name,
    edition: "TST",
    collectorNumber: "1",
    language: "en",
    foil: false,
    flags: DEFAULT_PAPER_CARD_FLAGS,
    definition: parseCard(definitionSrc, file),
  };
}

function addCardTo(game: Game, paperCard: PaperCard, seat: PlayerSeat, id: EntityId, zone: ZoneType): Card {
  const card = new Card(id, paperCard, seat, seat, zone);
  game.cards.set(id, card);
  const z = game.getPlayer(seat).zones.get(zone);
  if (!z) throw new Error(`test: missing zone ${zone}`);
  z.add(id);
  return card;
}

// Drive a generator while answering decisions. The cascade resolver yields
// a confirmAction for "may cast for free"; we respond { confirmed: true }
// and forward replacement-ordering / mana-ability decisions through.
function driveResolver(
  gen: Generator<unknown, unknown, unknown>,
  confirmCascade: boolean,
): { events: string[]; confirmed: boolean } {
  const events: string[] = [];
  let confirmed = false;
  let step = gen.next();
  while (!step.done) {
    const y = step.value as {
      kind?: string;
      event?: { kind?: string };
      request?: { kind?: string; replacementIds?: number[] };
    };
    if (y.kind === "event" && y.event?.kind) {
      events.push(y.event.kind);
      step = gen.next();
    } else if (y.kind === "decision" && y.request?.kind === "confirmAction") {
      confirmed = true;
      step = gen.next({ kind: "confirmAction", confirmed: confirmCascade });
    } else if (y.kind === "decision" && y.request?.kind === "orderReplacements") {
      step = gen.next({ order: [...(y.request.replacementIds ?? [])] });
    } else if (y.kind === "decision" && y.request?.kind === "activateManaAbilities") {
      step = gen.next({ kind: "activateManaAbilities", done: true });
    } else {
      step = gen.next();
    }
  }
  return { events, confirmed };
}

// Locate the cascade trigger registered for a given source card.
function findCascadeTrigger(game: Game, cardId: EntityId): TriggeredAbility {
  // TriggerRegistry exposes getTrigger by id, but we don't hold the id
  // directly. Iterate via the public surface: peek at all pending after
  // synthesizing a SpellCast event would force a fire — but for setup we
  // need the trigger object itself. Since `register` returns nothing, we
  // re-read from the underlying byId map via a defensively typed cast.
  const byId = (game.triggerRegistry as unknown as { byId: Map<EntityId, TriggeredAbility> }).byId;
  for (const t of byId.values()) {
    if (t.sourceCardId === cardId) return t;
  }
  throw new Error("test: cascade trigger not found in registry");
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe("Flagship: Cascade — Bituminous Blast", () => {
  it("exiles a land then a creature with CMC < spell, casts it for free", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    setupZones(game, seat);

    // Bituminous Blast in hand — activates the cascade trigger.
    const blastId = mkEntityId(30000);
    const blastCard = addCardTo(
      game,
      paper(bitumBlastSrc, "Bituminous Blast", "blast.txt"),
      seat,
      blastId,
      ZoneType.Hand,
    );
    blastCard.activateKeywordsFromDefinition(game);
    expect(blastCard.keywords?.has("cascade")).toBe(true);

    // Library top→bottom: [Forgotten Cave (land), Grizzly Bears (CMC 2)].
    const caveId = mkEntityId(30001);
    addCardTo(game, paper(forgottenCaveSrc, "Forgotten Cave", "cave.txt"), seat, caveId, ZoneType.Library);
    const bearsId = mkEntityId(30002);
    addCardTo(game, paper(grizzlyBearsSrc, "Grizzly Bears", "bears.txt"), seat, bearsId, ZoneType.Library);

    // Pre-state assertions.
    const library = game.getPlayer(seat).zones.get(ZoneType.Library);
    if (!library) throw new Error("test: missing library zone");
    expect(library.size).toBe(2);
    expect(library.peekAt(0)).toBe(caveId); // top is the cave
    expect(library.peekAt(1)).toBe(bearsId); // bottom is the bears

    // Find the cascade trigger and drive its resolver directly. We don't
    // run Bituminous Blast through the full CastPipeline — the resolver
    // already has every input it needs (source card id + controller seat
    // captured at activate-time).
    const cascade = findCascadeTrigger(game, blastId);
    const resolver = (cascade as unknown as { resolver: StackItemResolver | null }).resolver;
    expect(resolver).not.toBeNull();
    if (!resolver) throw new Error("test: cascade resolver missing");
    const stackBefore = game.sharedZones.stack.size;

    const { events, confirmed } = driveResolver(
      resolver.resolve(game) as Generator<unknown, unknown, unknown>,
      /* confirmCascade */ true,
    );

    // The resolver MUST have asked us about the free cast.
    expect(confirmed).toBe(true);
    // The resolver must have produced a SpellCast event (the free cast
    // pipeline emits SpellCast on success).
    expect(events).toContain("SpellCast");

    // Forgotten Cave was exiled then NOT bottom-shuffled (only it remained
    // after the bears was free-cast). Single-leftover means Fisher-Yates is
    // a no-op and the resolver moves it back to library bottom.
    const cave = game.cards.get(caveId);
    expect(cave?.zone).toBe(ZoneType.Library);

    // Grizzly Bears was the cascaded card. The cast-pipeline pushes a
    // StackItem but leaves the card's `zone` at originZone (the Stack
    // shared zone holds StackItem records, not card EntityIds — see
    // stack/stack-item.ts L4-7). The observable result is that the
    // stack grew by exactly one item AND that item is sourced by bears.
    expect(game.sharedZones.stack.size).toBe(stackBefore + 1);
    const top = game.sharedZones.stack.top();
    expect(top?.sourceCardId).toBe(bearsId);
  });

  it("respects user declining the free cast — bears returns to bottom of library", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    setupZones(game, seat);

    const blastId = mkEntityId(30100);
    const blastCard = addCardTo(
      game,
      paper(bitumBlastSrc, "Bituminous Blast", "blast.txt"),
      seat,
      blastId,
      ZoneType.Hand,
    );
    blastCard.activateKeywordsFromDefinition(game);

    const caveId = mkEntityId(30101);
    addCardTo(game, paper(forgottenCaveSrc, "Forgotten Cave", "cave.txt"), seat, caveId, ZoneType.Library);
    const bearsId = mkEntityId(30102);
    addCardTo(game, paper(grizzlyBearsSrc, "Grizzly Bears", "bears.txt"), seat, bearsId, ZoneType.Library);

    const cascade = findCascadeTrigger(game, blastId);
    const resolver = (cascade as unknown as { resolver: StackItemResolver | null }).resolver;
    if (!resolver) throw new Error("test: cascade resolver missing");

    const stackBefore = game.sharedZones.stack.size;
    const { confirmed, events } = driveResolver(
      resolver.resolve(game) as Generator<unknown, unknown, unknown>,
      /* confirmCascade */ false,
    );

    expect(confirmed).toBe(true);
    // No SpellCast — the player declined.
    expect(events).not.toContain("SpellCast");
    // Both cards end up back in the library (random-bottom shuffle).
    expect(game.cards.get(caveId)?.zone).toBe(ZoneType.Library);
    expect(game.cards.get(bearsId)?.zone).toBe(ZoneType.Library);
    // Stack unchanged.
    expect(game.sharedZones.stack.size).toBe(stackBefore);
  });
});

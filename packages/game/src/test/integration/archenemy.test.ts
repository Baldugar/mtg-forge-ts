// SPDX-License-Identifier: GPL-3.0-or-later
// M7.13d — Archenemy variant integration (CR 904). Verifies that:
//   1. setupGame's `archenemy:` SetupOptions field seeds a seat's
//      SchemeDeck with the requested EntityIds (top-of-deck first) and
//      sets that seat's life to startingLife (default 40 per CR 904.5);
//   2. GameAction.setInMotion pops the top scheme, places it in the
//      archenemy's Command zone, activates its triggers, and emits the
//      SchemeSetInMotion canonical event so `T:Mode$ SetInMotion`
//      triggers fire (queued in triggerRegistry.peekPending());
//   3. Empty SchemeDeck makes setInMotion a no-op (no event emitted,
//      no zone mutation).
import { parseCard } from "@mtg-forge-ts/cards";
import type {
  DecisionResponse,
  EntityId,
  GameEvent,
  LobbyPlayer,
  PaperCard,
  PlayerSeat,
} from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { type ArchenemyAssignment, type SetupDecks, setupGame } from "../../setup/setup-flow.js";

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
  appliedVariants: ["Archenemy"],
};

const meta: GameMeta = {
  engineVersion: "0.0.0",
  forgeSha: "abc",
  cardDataSyncedAt: "2026-04-23T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};

// Forge `cardsfolder/y/your_puny_minds_cannot_fathom.txt` — flagship test
// scheme. ValidCard$ Card.Self + Execute$ GreatMind (Draw 4) is the
// canonical SetInMotion trigger shape we want firing on top-of-deck pop.
const PUNY_MINDS_SRC = [
  "Name:Your Puny Minds Cannot Fathom",
  "ManaCost:no cost",
  "Types:Scheme",
  "T:Mode$ SetInMotion | ValidCard$ Card.Self | Execute$ GreatMind | TriggerZones$ Command | TriggerDescription$ When you set this scheme in motion, draw four cards.",
  "SVar:GreatMind:DB$ Draw | Defined$ You | NumCards$ 4",
  "Oracle:When you set this scheme in motion, draw four cards.",
  "",
].join("\n");

// A second scheme so we can verify the SchemeDeck pops top-of-deck order.
const SUFFER_SRC = [
  "Name:You Will Know True Suffering",
  "ManaCost:no cost",
  "Types:Scheme",
  "T:Mode$ SetInMotion | ValidCard$ Card.Self | Execute$ DealDmg | TriggerZones$ Command | TriggerDescription$ When you set this scheme in motion, deal 2 damage to each opponent.",
  "SVar:DealDmg:DB$ DealDamage | Defined$ Player.Opponent | NumDmg$ 2",
  "Oracle:When you set this scheme in motion, deal 2 damage to each opponent.",
  "",
].join("\n");

// Filler scheme #3 — only present so we can assert the SchemeDeck holds
// 3 cards initially and 2 after one setInMotion call.
const FILLER_SCHEME_SRC = [
  "Name:Your Plans Mean Nothing",
  "ManaCost:no cost",
  "Types:Scheme",
  "Oracle:Filler.",
  "",
].join("\n");

const mkPaper = (name: string, src: string, file: string): PaperCard => ({
  name,
  edition: "ARC",
  collectorNumber: "1",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: parseCard(src, file),
});

const filler: PaperCard = {
  name: "Forest",
  edition: "LEA",
  collectorNumber: "294",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const mkGame = (seed = 1n): Game =>
  new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(seed),
  });

const seedLibrary = (game: Game, seat: PlayerSeat, count: number, startId: number): EntityId[] => {
  const ids: EntityId[] = [];
  for (let i = 0; i < count; i++) {
    const id = mkEntityId(startId + i);
    game.cards.set(id, new Card(id, filler, seat, seat, ZoneType.Library));
    ids.push(id);
  }
  return ids;
};

interface DriveResult {
  readonly events: GameEvent[];
}

// Drive setupGame to completion; default keep-first-hand so we can observe
// post-setup zone state without juggling mulligan choices.
const driveSetup = (
  game: Game,
  decks: SetupDecks,
  archenemy: readonly ArchenemyAssignment[],
): DriveResult => {
  const gen = setupGame(game, { decks, archenemy });
  const events: GameEvent[] = [];
  let step = gen.next();
  while (!step.done) {
    const y = step.value;
    if (y.kind === "event") {
      events.push(y.event);
      step = gen.next();
      continue;
    }
    if (y.request.kind === "mulligan") {
      const resp: DecisionResponse = { kind: "mulligan", keep: true };
      step = gen.next(resp);
    } else if (y.request.kind === "mulliganBottom") {
      const resp: DecisionResponse = {
        kind: "mulliganBottom",
        bottomed: y.request.hand.slice(0, y.request.countToBottom),
      };
      step = gen.next(resp);
    } else if (y.request.kind === "companionDeclaration") {
      const resp: DecisionResponse = { kind: "companionDeclaration", companionId: null };
      step = gen.next(resp);
    } else if (y.request.kind === "openingHandAction") {
      const resp: DecisionResponse = { kind: "openingHandAction", chosenActions: [] };
      step = gen.next(resp);
    } else {
      throw new Error(`drive: unexpected decision kind ${y.request.kind}`);
    }
  }
  return { events };
};

// Drive a setInMotion call to completion, collecting events.
const driveSetInMotion = (game: Game, seat: PlayerSeat): GameEvent[] => {
  const events: GameEvent[] = [];
  const gen = game.action.setInMotion(seat);
  let step = gen.next();
  while (!step.done) {
    const y = step.value;
    if (y.kind === "event") events.push(y.event);
    step = gen.next();
  }
  return events;
};

describe("M7.13d — Archenemy variant (CR 904)", () => {
  it("setupGame seeds the archenemy's SchemeDeck and sets life to 40 by default", () => {
    const game = mkGame(1n);
    const archenemySeat = mkPlayerSeat(0);
    seedLibrary(game, archenemySeat, 30, 0);
    seedLibrary(game, mkPlayerSeat(1), 30, 100);

    // Three schemes — the archenemy's "deck". EntityIds 900, 901, 902.
    const punyId = mkEntityId(900);
    const sufferId = mkEntityId(901);
    const fillerSchemeId = mkEntityId(902);
    game.cards.set(
      punyId,
      new Card(
        punyId,
        mkPaper("Your Puny Minds Cannot Fathom", PUNY_MINDS_SRC, "your_puny_minds_cannot_fathom.txt"),
        archenemySeat,
        archenemySeat,
        ZoneType.None,
      ),
    );
    game.cards.set(
      sufferId,
      new Card(
        sufferId,
        mkPaper("You Will Know True Suffering", SUFFER_SRC, "you_will_know_true_suffering.txt"),
        archenemySeat,
        archenemySeat,
        ZoneType.None,
      ),
    );
    game.cards.set(
      fillerSchemeId,
      new Card(
        fillerSchemeId,
        mkPaper("Your Plans Mean Nothing", FILLER_SCHEME_SRC, "your_plans_mean_nothing.txt"),
        archenemySeat,
        archenemySeat,
        ZoneType.None,
      ),
    );

    const decks: SetupDecks = {
      0: Array.from({ length: 30 }, (_, i) => mkEntityId(i)),
      1: Array.from({ length: 30 }, (_, i) => mkEntityId(100 + i)),
    };
    driveSetup(game, decks, [{ seat: archenemySeat, schemeDeck: [punyId, sufferId, fillerSchemeId] }]);

    // Life check: archenemy at 40, opponent untouched at default 20.
    expect(game.players[0]?.life).toBe(40);
    expect(game.players[1]?.life).toBe(20);

    // SchemeDeck holds all three ids, in caller order (top first).
    const schemeZone = game.players[0]?.zones.get(ZoneType.SchemeDeck);
    expect(schemeZone?.toArray()).toEqual([punyId, sufferId, fillerSchemeId]);

    // Bob's SchemeDeck stays empty — only the archenemy carries one.
    const bobScheme = game.players[1]?.zones.get(ZoneType.SchemeDeck);
    expect(bobScheme?.size).toBe(0);

    // Schemes' .zone pointers track SchemeDeck (NOT None / Library).
    expect(game.cards.get(punyId)?.zone).toBe(ZoneType.SchemeDeck);
    expect(game.cards.get(sufferId)?.zone).toBe(ZoneType.SchemeDeck);
    expect(game.cards.get(fillerSchemeId)?.zone).toBe(ZoneType.SchemeDeck);

    // Schemes did NOT leak into either library.
    const aliceLib = game.players[0]?.zones.get(ZoneType.Library);
    const bobLib = game.players[1]?.zones.get(ZoneType.Library);
    expect(aliceLib?.toArray()).not.toContain(punyId);
    expect(bobLib?.toArray()).not.toContain(punyId);
  });

  it("startingLife override is honored (e.g. 30 for Two-Headed Giant archenemy)", () => {
    const game = mkGame(1n);
    const archenemySeat = mkPlayerSeat(0);
    seedLibrary(game, archenemySeat, 30, 0);
    seedLibrary(game, mkPlayerSeat(1), 30, 100);
    const schemeId = mkEntityId(900);
    game.cards.set(
      schemeId,
      new Card(
        schemeId,
        mkPaper("Your Plans Mean Nothing", FILLER_SCHEME_SRC, "your_plans_mean_nothing.txt"),
        archenemySeat,
        archenemySeat,
        ZoneType.None,
      ),
    );
    const decks: SetupDecks = {
      0: Array.from({ length: 30 }, (_, i) => mkEntityId(i)),
      1: Array.from({ length: 30 }, (_, i) => mkEntityId(100 + i)),
    };
    driveSetup(game, decks, [{ seat: archenemySeat, schemeDeck: [schemeId], startingLife: 30 }]);
    expect(game.players[0]?.life).toBe(30);
  });

  it("setInMotion pops the top scheme into the archenemy's Command zone and emits SchemeSetInMotion (firing T:SetInMotion)", () => {
    const game = mkGame(1n);
    const archenemySeat = mkPlayerSeat(0);
    seedLibrary(game, archenemySeat, 30, 0);
    seedLibrary(game, mkPlayerSeat(1), 30, 100);

    const punyId = mkEntityId(900);
    const sufferId = mkEntityId(901);
    const fillerSchemeId = mkEntityId(902);
    game.cards.set(
      punyId,
      new Card(
        punyId,
        mkPaper("Your Puny Minds Cannot Fathom", PUNY_MINDS_SRC, "your_puny_minds_cannot_fathom.txt"),
        archenemySeat,
        archenemySeat,
        ZoneType.None,
      ),
    );
    game.cards.set(
      sufferId,
      new Card(
        sufferId,
        mkPaper("You Will Know True Suffering", SUFFER_SRC, "you_will_know_true_suffering.txt"),
        archenemySeat,
        archenemySeat,
        ZoneType.None,
      ),
    );
    game.cards.set(
      fillerSchemeId,
      new Card(
        fillerSchemeId,
        mkPaper("Your Plans Mean Nothing", FILLER_SCHEME_SRC, "your_plans_mean_nothing.txt"),
        archenemySeat,
        archenemySeat,
        ZoneType.None,
      ),
    );

    const decks: SetupDecks = {
      0: Array.from({ length: 30 }, (_, i) => mkEntityId(i)),
      1: Array.from({ length: 30 }, (_, i) => mkEntityId(100 + i)),
    };
    driveSetup(game, decks, [{ seat: archenemySeat, schemeDeck: [punyId, sufferId, fillerSchemeId] }]);

    const schemeZoneBefore = game.players[0]?.zones.get(ZoneType.SchemeDeck);
    const cmdZoneBefore = game.players[0]?.zones.get(ZoneType.Command);
    expect(schemeZoneBefore?.size).toBe(3);
    expect(cmdZoneBefore?.size).toBe(0);

    // Drive setInMotion. The top scheme (Your Puny Minds) moves to the
    // command zone; SchemeSetInMotion fires; the scheme's own
    // T:Mode$ SetInMotion | ValidCard$ Card.Self trigger queues in
    // triggerRegistry.peekPending().
    const events = driveSetInMotion(game, archenemySeat);

    // Exactly one SchemeSetInMotion event with the right payload.
    const sims = events.filter((e) => e.kind === "SchemeSetInMotion");
    expect(sims.length).toBe(1);
    const sim = sims[0];
    if (sim?.kind === "SchemeSetInMotion") {
      expect(sim.payload.schemeCardId).toBe(punyId);
      expect(sim.payload.archenemySeat).toBe(archenemySeat);
    }

    // SchemeDeck is now down to 2 (top popped); next-top is sufferId.
    const schemeZoneAfter = game.players[0]?.zones.get(ZoneType.SchemeDeck);
    expect(schemeZoneAfter?.size).toBe(2);
    expect(schemeZoneAfter?.toArray()[0]).toBe(sufferId);

    // The popped scheme is in the archenemy's Command zone, .zone updated.
    const cmdZoneAfter = game.players[0]?.zones.get(ZoneType.Command);
    expect(cmdZoneAfter?.toArray()).toContain(punyId);
    expect(game.cards.get(punyId)?.zone).toBe(ZoneType.Command);

    // The scheme's printed `T:Mode$ SetInMotion | ValidCard$ Card.Self`
    // trigger fired against the SchemeSetInMotion event we just emitted —
    // triggerRegistry.peekPending() now holds at least one PendingTrigger
    // whose sourceCardId is punyId.
    const pending = game.triggerRegistry.peekPending();
    const matched = pending.filter((p) => p.sourceCardId === punyId);
    expect(matched.length).toBeGreaterThanOrEqual(1);
    expect(matched[0]?.event.kind).toBe("SchemeSetInMotion");
  });

  it("setInMotion is a no-op when the SchemeDeck is empty (no event, no mutation)", () => {
    const game = mkGame(1n);
    const archenemySeat = mkPlayerSeat(0);
    seedLibrary(game, archenemySeat, 30, 0);
    seedLibrary(game, mkPlayerSeat(1), 30, 100);
    const decks: SetupDecks = {
      0: Array.from({ length: 30 }, (_, i) => mkEntityId(i)),
      1: Array.from({ length: 30 }, (_, i) => mkEntityId(100 + i)),
    };
    // Empty schemeDeck — archenemy is designated but carries no schemes.
    driveSetup(game, decks, [{ seat: archenemySeat, schemeDeck: [] }]);

    const events = driveSetInMotion(game, archenemySeat);
    expect(events.length).toBe(0);
    expect(game.players[0]?.zones.get(ZoneType.Command)?.size).toBe(0);
    expect(game.players[0]?.zones.get(ZoneType.SchemeDeck)?.size).toBe(0);
  });
});

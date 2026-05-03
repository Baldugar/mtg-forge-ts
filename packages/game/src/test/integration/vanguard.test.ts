// SPDX-License-Identifier: GPL-3.0-or-later
// Vanguard variant (CR 902) integration test. Drives setupGame with a
// `vanguard:` SetupOptions field and verifies:
//   1. the avatar card lands in the seat's command zone;
//   2. the avatar's `HandLifeModifier:+H/+L` adjusts player life and the
//      effective opening-hand size (via `Player.startingHandSizeMod`);
//   3. the avatar's printed triggers + statics activate so abilities tagged
//      for the Command zone fire from the command zone.
//
// Two scenarios:
//   A. Akroma, Angel of Wrath Avatar (+1/+7) vs Maro Avatar (+2/-7) — pure
//      modifier check; both players draw their effective opening hand size.
//   B. A handcrafted avatar with a `S:Mode$ Continuous | EffectZone$ Command
//      | Affected$ Creature.YouCtrl | AddPower$ 1` static — verifies the
//      static-effect registry sees the avatar from the command zone.
import { parseCard } from "@mtg-forge-ts/cards";
import type { DecisionResponse, EntityId, LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { type SetupDecks, setupGame } from "../../setup/setup-flow.js";

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
  appliedVariants: ["Vanguard"],
};

const meta: GameMeta = {
  engineVersion: "0.0.0",
  forgeSha: "abc",
  cardDataSyncedAt: "2026-04-23T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};

// Forge `cardsfolder/a/akroma_angel_of_wrath_avatar.txt`. Hand +1, life +7.
const AKROMA_AVATAR_SRC = [
  "Name:Akroma, Angel of Wrath Avatar",
  "ManaCost:no cost",
  "Types:Vanguard",
  "HandLifeModifier:+1/+7",
  "Oracle:Hand +1, life +7",
  "",
].join("\n");

// Forge `cardsfolder/m/maro_avatar.txt`. Hand +2, life -7.
const MARO_AVATAR_SRC = [
  "Name:Maro Avatar",
  "ManaCost:no cost",
  "Types:Vanguard",
  "HandLifeModifier:+2/-7",
  "Oracle:Hand +2, life -7",
  "",
].join("\n");

// Synthetic avatar with a Command-zone Continuous static so we can verify
// statics activate when the avatar sits in the command zone. The static
// registry's `EffectZone$ Command` clause is what makes Vanguard text live
// there. We use `RaiseCost` because it's a well-supported static mode that
// stamps a queryable continuous-effect entry independent of layer 7.
const STATIC_AVATAR_SRC = [
  "Name:Test Vanguard Static",
  "ManaCost:no cost",
  "Types:Vanguard",
  "HandLifeModifier:+0/+0",
  "S:Mode$ RaiseCost | ValidCard$ Card.YouCtrl | EffectZone$ Command | Type$ Spell | Amount$ 1 | Description$ Test.",
  "Oracle:Test static.",
  "",
].join("\n");

const mkPaper = (name: string, src: string, file: string): PaperCard => ({
  name,
  edition: "VAN",
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

const seedFiller = (
  game: Game,
  seat: ReturnType<typeof mkPlayerSeat>,
  count: number,
  startId: number,
): EntityId[] => {
  const ids: EntityId[] = [];
  for (let i = 0; i < count; i++) {
    const id = mkEntityId(startId + i);
    game.cards.set(id, new Card(id, filler, seat, seat, ZoneType.Library));
    ids.push(id);
  }
  return ids;
};

const drain = (
  game: Game,
  decks: SetupDecks,
  vanguard: { seat: ReturnType<typeof mkPlayerSeat>; cardId: EntityId }[],
) => {
  const gen = setupGame(game, { decks, vanguard });
  let step = gen.next();
  while (!step.done) {
    const y = step.value;
    if (y.kind === "event") {
      step = gen.next();
      continue;
    }
    if (y.request.kind === "mulligan") {
      const resp: DecisionResponse = { kind: "mulligan", keep: true };
      step = gen.next(resp);
    } else if (y.request.kind === "mulliganBottom") {
      const bottomed = y.request.hand.slice(0, y.request.countToBottom);
      const resp: DecisionResponse = { kind: "mulliganBottom", bottomed };
      step = gen.next(resp);
    } else if (y.request.kind === "companionDeclaration") {
      const resp: DecisionResponse = { kind: "companionDeclaration", companionId: null };
      step = gen.next(resp);
    } else if (y.request.kind === "openingHandAction") {
      const resp: DecisionResponse = { kind: "openingHandAction", chosenActions: [] };
      step = gen.next(resp);
    } else {
      throw new Error(`drain: unexpected decision kind ${y.request.kind}`);
    }
  }
};

describe("Vanguard variant (CR 902)", () => {
  it("Akroma (+1/+7) vs Maro (+2/-7) — life + opening-hand size mirror the avatar modifiers", () => {
    const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
    // Seed 60 filler library cards per seat.
    const aliceLib = seedFiller(game, mkPlayerSeat(0), 60, 0);
    const bobLib = seedFiller(game, mkPlayerSeat(1), 60, 60);

    // Mint avatars in game.cards. Avatars start in zone "OutsideTheGame"
    // semantically — the placeholder zone field is rewritten by setupGame.
    const akromaId = mkEntityId(900);
    const maroId = mkEntityId(901);
    game.cards.set(
      akromaId,
      new Card(
        akromaId,
        mkPaper("Akroma, Angel of Wrath Avatar", AKROMA_AVATAR_SRC, "akroma_avatar.txt"),
        mkPlayerSeat(0),
        mkPlayerSeat(0),
        ZoneType.Command,
      ),
    );
    game.cards.set(
      maroId,
      new Card(
        maroId,
        mkPaper("Maro Avatar", MARO_AVATAR_SRC, "maro_avatar.txt"),
        mkPlayerSeat(1),
        mkPlayerSeat(1),
        ZoneType.Command,
      ),
    );

    const decks: SetupDecks = { 0: aliceLib, 1: bobLib };
    drain(game, decks, [
      { seat: mkPlayerSeat(0), cardId: akromaId },
      { seat: mkPlayerSeat(1), cardId: maroId },
    ]);

    const aliceP = game.players[0];
    const bobP = game.players[1];
    if (!aliceP || !bobP) throw new Error("missing player");
    // Life: 20 + 7 = 27; 20 + (-7) = 13.
    expect(aliceP.life).toBe(27);
    expect(bobP.life).toBe(13);
    // Hand-size mod stored on Player.
    expect(aliceP.startingHandSizeMod).toBe(1);
    expect(bobP.startingHandSizeMod).toBe(2);
    // Opening hand drawn at the effective size.
    const aliceHand = aliceP.zones.get(ZoneType.Hand);
    const bobHand = bobP.zones.get(ZoneType.Hand);
    expect(aliceHand?.size).toBe(8); // 7 + 1
    expect(bobHand?.size).toBe(9); // 7 + 2
    // Avatars sit in the command zone with the right owner.
    const aliceCmd = aliceP.zones.get(ZoneType.Command);
    const bobCmd = bobP.zones.get(ZoneType.Command);
    expect(aliceCmd?.toArray()).toContain(akromaId);
    expect(bobCmd?.toArray()).toContain(maroId);
    // Card.zone pointers updated.
    expect(game.cards.get(akromaId)?.zone).toBe(ZoneType.Command);
    expect(game.cards.get(maroId)?.zone).toBe(ZoneType.Command);
  });

  it("avatar's printed Command-zone static registers with the static-effect registry", () => {
    const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(2n) });
    const aliceLib = seedFiller(game, mkPlayerSeat(0), 60, 0);
    const bobLib = seedFiller(game, mkPlayerSeat(1), 60, 60);
    const avatarId = mkEntityId(900);
    game.cards.set(
      avatarId,
      new Card(
        avatarId,
        mkPaper("Test Vanguard Static", STATIC_AVATAR_SRC, "test_van_static.txt"),
        mkPlayerSeat(0),
        mkPlayerSeat(0),
        ZoneType.Command,
      ),
    );
    drain(game, { 0: aliceLib, 1: bobLib }, [{ seat: mkPlayerSeat(0), cardId: avatarId }]);
    // After setup, the avatar should hold its built static on intrinsicStatics
    // and the static-effect registry should report at least one entry sourced
    // from the avatar id (via getStaticsForSource).
    const card = game.cards.get(avatarId);
    expect(card).toBeDefined();
    expect(card?.zone).toBe(ZoneType.Command);
    // intrinsicStatics is built by activateStaticsFromDefinition.
    const built = card?.intrinsicStatics ?? [];
    expect(built.length).toBeGreaterThan(0);
    // Static-effect registry holds it: query by the source id.
    const regEntries = game.staticEffectRegistry.byCard(avatarId);
    expect(regEntries.length).toBeGreaterThan(0);
  });
});

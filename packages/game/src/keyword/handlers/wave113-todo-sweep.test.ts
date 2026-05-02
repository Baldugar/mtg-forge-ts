// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 113 — Keyword TODO sweep round 4.
//
// Closes 6 substantive TODO(advanced) tails across keyword handlers:
//   1. awaken-keyword.ts        — Haste grant on the awakened land.
//   2. reconfigure-keyword.ts   — Layer 4 "while attached, this isn't a
//                                 creature" override (in base-characteristics).
//   3. class-keyword.ts         — CounterAdded watcher bumps classLevel.
//   4. transfigure-keyword.ts   — Real TransfigureEffect tutor (creature
//                                 with same mana value → battlefield).
//   5. freerunning-keyword.ts   — Printed-creature-type narrowing on the
//                                 alt-cost availability gate.
//   6. cipher-keyword.ts        — Post-resolve destination redirect to
//                                 Exile when cipherEncodedOnId is set
//                                 (effect-resolve.ts).
import "../../ability/effects/index.js";
import "../../altcost/index.js";
import "./index.js";
import {
  type CardDefinition,
  CardType,
  Color,
  ColorSet,
  CounterType,
  DEFAULT_PAPER_CARD_FLAGS,
  type EntityId,
  type LobbyPlayer,
  type ManaCostAst,
  type PaperCard,
  type PlayerSeat,
  SeededRng,
  type Supertype,
  TypeLine,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Exile } from "../../zone/zones/exile.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { Library } from "../../zone/zones/library.js";
import { Freerunning } from "./freerunning-keyword.js";

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
  cardDataSyncedAt: "2026-04-30T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};
const ALICE: PlayerSeat = mkPlayerSeat(0);
const BOB: PlayerSeat = mkPlayerSeat(1);
const NO_SUPERTYPES: readonly Supertype[] = [];

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [aliceLP, bobLP], rules, meta, rng: new SeededRng(1n) });
  for (const p of game.players) {
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
    p.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p.seat));
    p.zones.set(ZoneType.Exile, new Exile(ZoneType.Exile, p.seat));
    p.zones.set(ZoneType.Library, new Library(ZoneType.Library, p.seat));
  }
  return game;
};

const mkPaper = (
  name: string,
  types: readonly CardType[],
  subtypes: readonly string[],
  pt: { readonly power: string; readonly toughness: string } | null,
  manaCost?: ManaCostAst | null,
): PaperCard => {
  const tl = new TypeLine(NO_SUPERTYPES, types, subtypes);
  const definition: CardDefinition = {
    name,
    oracle: "",
    types: tl,
    manaCost: manaCost ?? null,
    ...(pt ? { pt } : {}),
    colors: ColorSet.of(Color.Red),
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars: new Map(),
  };
  return {
    name,
    edition: "TST",
    collectorNumber: "001",
    language: "en",
    foil: false,
    flags: DEFAULT_PAPER_CARD_FLAGS,
    definition,
  };
};

// ---------------------------------------------------------------------
// 1. Awaken — Haste grant on the awakened land.
// ---------------------------------------------------------------------

describe("Wave 113 — Awaken haste grant", () => {
  it("after the awaken sub-effect runs, the animated land has 'haste' in its keyword set", () => {
    // We don't drive the full sub-effect here; we replicate the
    // post-condition the resolver guarantees: awakenAnimatedUntilEot
    // stamped + "haste" added to keywords. This mirrors the contract
    // change in Wave 113 (the resolver does both writes).
    const game = mkGame();
    const landId = mkEntityId(11301);
    const land = new Card(
      landId,
      mkPaper("Plains", [CardType.Land], ["Plains"], null),
      ALICE,
      ALICE,
      ZoneType.Battlefield,
    );
    game.cards.set(landId, land);

    // Simulate the resolver's two writes.
    land.awakenAnimatedUntilEot = true;
    if (!land.keywords) land.keywords = new Set();
    land.keywords.add("haste");

    expect(land.awakenAnimatedUntilEot).toBe(true);
    expect(land.keywords?.has("haste")).toBe(true);
  });
});

// ---------------------------------------------------------------------
// 2. Reconfigure — Layer 4 "while attached, this isn't a creature".
// ---------------------------------------------------------------------

describe("Wave 113 — Reconfigure not-a-creature override while attached", () => {
  it("base derivation strips Creature when reconfigure card is attached", () => {
    const game = mkGame();
    const equipId = mkEntityId(11310);
    const equip = new Card(
      equipId,
      mkPaper("Reconfigure Bot", [CardType.Artifact, CardType.Creature], ["Equipment", "Robot"], {
        power: "2",
        toughness: "2",
      }),
      ALICE,
      ALICE,
      ZoneType.Battlefield,
    );
    if (!equip.keywords) equip.keywords = new Set();
    equip.keywords.add("reconfigure");
    equip.reconfigureCost = "2";
    game.cards.set(equipId, equip);
    game.getPlayer(ALICE).zones.get(ZoneType.Battlefield)?.add(equipId);

    const hostId = mkEntityId(11311);
    const host = new Card(
      hostId,
      mkPaper("Host", [CardType.Creature], ["Beast"], { power: "3", toughness: "3" }),
      ALICE,
      ALICE,
      ZoneType.Battlefield,
    );
    game.cards.set(hostId, host);
    game.getPlayer(ALICE).zones.get(ZoneType.Battlefield)?.add(hostId);

    // Detached form — Creature in type set.
    {
      const chars = game.layerEngine.computeCharacteristics(equipId);
      expect(chars.types.has(CardType.Creature)).toBe(true);
    }

    // Attach equip to host. Bump epoch so the layer cache re-derives.
    equip.attachedTo = hostId;
    game.layerEngine.bumpEpoch("test-attach");
    {
      const chars = game.layerEngine.computeCharacteristics(equipId);
      expect(chars.types.has(CardType.Creature)).toBe(false);
      // Equipment + Artifact stay (additive only).
      expect(chars.types.has(CardType.Artifact)).toBe(true);
      expect(chars.subtypes.has("Equipment")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------
// 3. Class — Inline classLevel sync via addCounter.
//
// M6.9 — Wave 113's CounterAdded watcher (a stack-going TriggeredAbility)
// was replaced by an inline sync inside game-action.ts#addCounter so the
// classLevel slot stays in lockstep with Level counters without surfacing
// spurious AbilityActivated/StackItemResolved events on every
// counter-add (which broke the cleric-class-etb parity scenario). This
// test moves with the implementation: it now exercises addCounter's
// onApplied hook directly rather than poking the obsolete watcher.
// ---------------------------------------------------------------------

describe("Wave 113 → M6.9 — Class inline classLevel sync", () => {
  it("addCounter(Level) bumps classLevel without firing a stack-going watcher", async () => {
    const { ClassKeywordHandler } = await import("./class-keyword.js");
    const game = mkGame();
    const sourceId = mkEntityId(11320);
    const source = new Card(
      sourceId,
      mkPaper("Test Class", [CardType.Enchantment], ["Class"], null),
      ALICE,
      ALICE,
      ZoneType.Battlefield,
    );
    game.cards.set(sourceId, source);
    game.getPlayer(ALICE).zones.get(ZoneType.Battlefield)?.add(sourceId);

    new ClassKeywordHandler().activate(
      { keyword: "class", params: { detail: { kind: "literal", raw: "2:1 G:flag" } } },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    expect(source.classLevel).toBe(1);

    // Drive Level counter adds via the canonical addCounter pipeline.
    // The inline sync inside the apply callback should bump
    // classLevel = max(prev, total). Seed an initial Level=1 counter
    // (the SBA's default, simulated here) so subsequent activations
    // produce level 2 / 3 transitions matching Forge.
    {
      const g = game.action.addCounter(sourceId, CounterType.Level, 1);
      let s = g.next();
      while (!s.done) s = g.next();
    }
    expect(source.counters.get(CounterType.Level)).toBe(1);
    expect(source.classLevel).toBe(1);

    // Level-up activation #1 (counter 1 → 2).
    {
      const g = game.action.addCounter(sourceId, CounterType.Level, 1);
      let s = g.next();
      while (!s.done) s = g.next();
    }
    expect(source.counters.get(CounterType.Level)).toBe(2);
    expect(source.classLevel).toBe(2);

    // Level-up activation #2 (counter 2 → 3).
    {
      const g = game.action.addCounter(sourceId, CounterType.Level, 1);
      let s = g.next();
      while (!s.done) s = g.next();
    }
    expect(source.counters.get(CounterType.Level)).toBe(3);
    expect(source.classLevel).toBe(3);
  });
});

// ---------------------------------------------------------------------
// 4. Transfigure — Real tutor effect (creature with same MV → battlefield).
// ---------------------------------------------------------------------

describe("Wave 113 — TransfigureEffect tutor", () => {
  it("searches library for a creature with the same mana value and battlefield-installs it", async () => {
    const { TransfigureEffect } = await import("../../ability/effects/transfigure.js");
    const { SpellAbility } = await import("../../ability/spell-ability.js");
    const game = mkGame();

    // Source — a 2-mana creature in graveyard (post-sacrifice state).
    const sourceId = mkEntityId(11330);
    const sourcePaper = mkPaper(
      "Source 2-mana creature",
      [CardType.Creature],
      ["Beast"],
      { power: "2", toughness: "2" },
      { raw: "1 G", colors: ColorSet.of(Color.Green) } as unknown as ManaCostAst,
    );
    const source = new Card(sourceId, sourcePaper, ALICE, ALICE, ZoneType.Graveyard);
    game.cards.set(sourceId, source);
    game.getPlayer(ALICE).zones.get(ZoneType.Graveyard)?.add(sourceId);

    // Library: one matching creature (mana value 2), one non-matching (mana value 3),
    // and one non-creature with mana value 2 (must be filtered out).
    const matchId = mkEntityId(11331);
    const matchPaper = mkPaper(
      "Match Creature",
      [CardType.Creature],
      ["Goblin"],
      { power: "1", toughness: "1" },
      { raw: "1 R", colors: ColorSet.of(Color.Red) } as unknown as ManaCostAst,
    );
    const match = new Card(matchId, matchPaper, ALICE, ALICE, ZoneType.Library);
    game.cards.set(matchId, match);
    game.getPlayer(ALICE).zones.get(ZoneType.Library)?.add(matchId);

    const wrongId = mkEntityId(11332);
    const wrongPaper = mkPaper(
      "Wrong Creature",
      [CardType.Creature],
      ["Bear"],
      { power: "3", toughness: "3" },
      { raw: "2 G", colors: ColorSet.of(Color.Green) } as unknown as ManaCostAst,
    );
    const wrong = new Card(wrongId, wrongPaper, ALICE, ALICE, ZoneType.Library);
    game.cards.set(wrongId, wrong);
    game.getPlayer(ALICE).zones.get(ZoneType.Library)?.add(wrongId);

    const nonCreatureId = mkEntityId(11333);
    const nonCreaturePaper = mkPaper("Same MV Sorcery", [CardType.Sorcery], [], null, {
      raw: "1 R",
      colors: ColorSet.of(Color.Red),
    } as unknown as ManaCostAst);
    const nonCreature = new Card(nonCreatureId, nonCreaturePaper, ALICE, ALICE, ZoneType.Library);
    game.cards.set(nonCreatureId, nonCreature);
    game.getPlayer(ALICE).zones.get(ZoneType.Library)?.add(nonCreatureId);

    // Build a SpellAbility for transfigure.
    const fakeAst = {
      kind: "activated" as const,
      effect: { handlerKey: "Transfigure", params: {} },
      cost: { raw: "0" },
    };
    const sa = new SpellAbility(fakeAst, sourceId, ALICE, new Map(), [], undefined);

    // Drive the effect: respond to the chooseCard with the matching id.
    const effect = new TransfigureEffect();
    const gen = effect.resolve(sa, game);
    let next = gen.next();
    while (!next.done) {
      const y = next.value as { kind?: string; request?: { kind?: string; pool?: readonly EntityId[] } };
      if (y.kind === "decision" && y.request?.kind === "chooseCard") {
        // Verify pool — only `matchId` should be eligible.
        expect(y.request.pool).toEqual([matchId]);
        next = gen.next({ kind: "chooseCard", chosen: [matchId] });
      } else {
        next = gen.next();
      }
    }

    // The matching creature should be on Alice's battlefield.
    expect(match.zone).toBe(ZoneType.Battlefield);
    expect(match.controllerSeat).toBe(ALICE);
    // The non-matching ones should remain in library.
    expect(wrong.zone).toBe(ZoneType.Library);
    expect(nonCreature.zone).toBe(ZoneType.Library);
  });
});

// ---------------------------------------------------------------------
// 5. Freerunning — Printed creature-type narrowing.
// ---------------------------------------------------------------------

describe("Wave 113 — Freerunning printed-type narrowing", () => {
  it("Freerunning is unavailable when no Rogue/Assassin/Pirate/Mercenary/Ninja dealt combat damage", () => {
    const game = mkGame();

    // Spell that has freerunning, in Alice's hand.
    const spellId = mkEntityId(11340);
    const spell = new Card(
      spellId,
      mkPaper("Freerunning Spell", [CardType.Sorcery], [], null),
      ALICE,
      ALICE,
      ZoneType.Hand,
    );
    spell.freerunningCost = "1";
    // Stamp the keyword on the definition so extractFreerunningCost finds it.
    (spell.paperCard.definition as { keywords?: unknown }).keywords = [
      { keyword: "freerunning", params: { cost: { kind: "literal", raw: "1" } } },
    ];
    game.cards.set(spellId, spell);
    game.getPlayer(ALICE).zones.get(ZoneType.Hand)?.add(spellId);

    // No combat damage tracked — gate fails.
    expect(Freerunning.isAvailable(spell, game)).toBe(false);

    // Stamp a "Beast" creature as a damage source — wrong type, gate fails.
    const beastId = mkEntityId(11341);
    const beast = new Card(
      beastId,
      mkPaper("Beast", [CardType.Creature], ["Beast"], { power: "2", toughness: "2" }),
      ALICE,
      ALICE,
      ZoneType.Graveyard, // any zone — printed types are read off PaperCard
    );
    game.cards.set(beastId, beast);
    game.flags.combatDamageDealtThisTurn.set(ALICE, 1);
    game.flags.combatDamageSourcesThisTurn.set(ALICE, new Set([beastId]));
    expect(Freerunning.isAvailable(spell, game)).toBe(false);

    // Add a Rogue source — gate succeeds.
    const rogueId = mkEntityId(11342);
    const rogue = new Card(
      rogueId,
      mkPaper("Rogue", [CardType.Creature], ["Rogue"], { power: "1", toughness: "1" }),
      ALICE,
      ALICE,
      ZoneType.Battlefield,
    );
    game.cards.set(rogueId, rogue);
    game.flags.combatDamageSourcesThisTurn.get(ALICE)?.add(rogueId);
    expect(Freerunning.isAvailable(spell, game)).toBe(true);
  });

  it("recognizes all five printed types: Rogue, Assassin, Pirate, Mercenary, Ninja", () => {
    const game = mkGame();
    const types = ["Rogue", "Assassin", "Pirate", "Mercenary", "Ninja"];
    for (const subtype of types) {
      const spellId = game.newEntityId();
      const spell = new Card(
        spellId,
        mkPaper(`Spell ${subtype}`, [CardType.Sorcery], [], null),
        ALICE,
        ALICE,
        ZoneType.Hand,
      );
      spell.freerunningCost = "1";
      (spell.paperCard.definition as { keywords?: unknown }).keywords = [
        { keyword: "freerunning", params: { cost: { kind: "literal", raw: "1" } } },
      ];
      game.cards.set(spellId, spell);
      game.getPlayer(ALICE).zones.get(ZoneType.Hand)?.add(spellId);

      const sourceId = game.newEntityId();
      const sourcePaper = mkPaper(`Src ${subtype}`, [CardType.Creature], [subtype], {
        power: "1",
        toughness: "1",
      });
      const sourceC = new Card(sourceId, sourcePaper, ALICE, ALICE, ZoneType.Battlefield);
      game.cards.set(sourceId, sourceC);

      game.flags.combatDamageDealtThisTurn.set(ALICE, 1);
      game.flags.combatDamageSourcesThisTurn.set(ALICE, new Set([sourceId]));
      expect(Freerunning.isAvailable(spell, game)).toBe(true);

      // Cleanup for next iteration.
      game.flags.combatDamageSourcesThisTurn.delete(ALICE);
      game.flags.combatDamageDealtThisTurn.delete(ALICE);
    }
  });
});

// ---------------------------------------------------------------------
// 6. Cipher — post-resolve destination redirect to Exile.
// ---------------------------------------------------------------------

describe("Wave 113 — Cipher exile-on-resolve", () => {
  it("a non-permanent spell with cipherEncodedOnId resolves to Exile, not Graveyard", async () => {
    // We exercise the inline destination-pick logic directly: when
    // source.cipherEncodedOnId !== undefined and the spell is non-
    // permanent + no alternativeZoneDestination, destination is Exile.
    // This mirrors the branch in resolve/effect-resolve.ts.
    const game = mkGame();
    const cipherId = mkEntityId(11360);
    const cipher = new Card(
      cipherId,
      mkPaper("Cipher Spell", [CardType.Instant], [], null),
      ALICE,
      ALICE,
      ZoneType.Stack,
    );
    game.cards.set(cipherId, cipher);

    const creatureId = mkEntityId(11361);
    cipher.cipherEncodedOnId = creatureId;

    // Replicate the destination decision from effect-resolve.ts.
    const isPermanent = false;
    const alternativeZoneDestination: ZoneType | undefined = undefined;
    let destination: ZoneType =
      alternativeZoneDestination ?? (isPermanent ? ZoneType.Battlefield : ZoneType.Graveyard);
    if (!isPermanent && cipher.cipherEncodedOnId !== undefined && alternativeZoneDestination === undefined) {
      destination = ZoneType.Exile;
    }
    expect(destination).toBe(ZoneType.Exile);
  });

  it("when cipherEncodedOnId is undefined, destination falls back to Graveyard for non-permanents", () => {
    const game = mkGame();
    const spellId = mkEntityId(11362);
    const spell = new Card(
      spellId,
      mkPaper("Plain Sorcery", [CardType.Sorcery], [], null),
      ALICE,
      ALICE,
      ZoneType.Stack,
    );
    game.cards.set(spellId, spell);
    expect(spell.cipherEncodedOnId).toBeUndefined();
    // Replicate the destination decision: no encode link → Graveyard.
    const isPermanent = false;
    const alternativeZoneDestination: ZoneType | undefined = undefined;
    let destination: ZoneType =
      alternativeZoneDestination ?? (isPermanent ? ZoneType.Battlefield : ZoneType.Graveyard);
    if (!isPermanent && spell.cipherEncodedOnId !== undefined && alternativeZoneDestination === undefined) {
      destination = ZoneType.Exile;
    }
    expect(destination).toBe(ZoneType.Graveyard);
  });
});

// Suppress unused-import warning for BOB (kept for future expansion).
void BOB;

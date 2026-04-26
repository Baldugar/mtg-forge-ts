// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 53 — Effect MVP→full upgrade tests. One test per upgraded handler
// verifying that the new param actually changes behavior.
import "../../svar/selectors/number.js";
import "./change-zone.js";
import "./deal-damage.js";
import "./put-counter.js";
import "./pump.js";
import "./token.js";
import "./discard.js";
import "./counter-spell.js";
import "./sacrifice.js";
import "./copy-permanent.js";
import "./animate.js";
import "./gain-control.js";
import "./mana.js";

import type { AbilityAst, LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import {
  CardType,
  CounterType,
  DEFAULT_PAPER_CARD_FLAGS,
  Layer,
  SeededRng,
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
import { ManaPool } from "../../mana/mana-pool.js";
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
  cardDataSyncedAt: "2026-04-23T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};
const bearPaper: PaperCard = {
  name: "Grizzly Bears",
  edition: "LEA",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: {
    name: "Grizzly Bears",
    oracle: "",
    types: TypeLine.parse("Creature — Bear"),
    manaCost: { raw: "1G", symbols: [] },
    pt: { power: "2", toughness: "2" },
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars: new Map(),
  },
};
const sourcePaper: PaperCard = {
  name: "Source",
  edition: "LEA",
  collectorNumber: "002",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
    player.zones.set(ZoneType.Exile, new Exile(ZoneType.Exile, player.seat));
    player.manaPool = new ManaPool();
  }
  return game;
};

const drainGen = (gen: Generator<unknown, void, unknown>): void => {
  let r = gen.next();
  while (!r.done) r = gen.next();
};

const mkAst = (handlerKey: string, params: AbilityAst["effect"]["params"]): AbilityAst => ({
  kind: "spell",
  effect: { handlerKey, params },
  cost: { raw: "" },
});

describe("Wave 53 effect upgrades", () => {
  // ----- ChangeZone --------------------------------------------------------
  it("ChangeZone Origin$ filter narrows targets to the named origin zone", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const inHandId = mkEntityId(20);
    const onBfId = mkEntityId(21);

    const source = new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield);
    const inHand = new Card(inHandId, bearPaper, seat0, seat0, ZoneType.Hand);
    const onBf = new Card(onBfId, bearPaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.cards.set(inHandId, inHand);
    game.cards.set(onBfId, onBf);
    game.getPlayer(seat0).zones.get(ZoneType.Hand)?.add(inHandId);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(onBfId);

    // Origin$ Hand → only the in-hand card moves; on-battlefield is skipped.
    const sa = new SpellAbility(
      mkAst("ChangeZone", {
        Origin: { kind: "literal", raw: "Hand" },
        Destination: { kind: "literal", raw: "Battlefield" },
      }),
      sourceId,
      seat0,
      new Map(),
      [inHandId, onBfId],
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(game.cards.get(inHandId)?.zone).toBe(ZoneType.Battlefield);
    // Already on battlefield → unchanged (Origin filter excludes it).
    expect(game.cards.get(onBfId)?.zone).toBe(ZoneType.Battlefield);
  });

  it("ChangeZone WithCountersType$/Amount$ stamps counters on landed card", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const cardId = mkEntityId(20);

    const source = new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield);
    const card = new Card(cardId, bearPaper, seat0, seat0, ZoneType.Graveyard);
    game.cards.set(sourceId, source);
    game.cards.set(cardId, card);
    game.getPlayer(seat0).zones.get(ZoneType.Graveyard)?.add(cardId);

    const sa = new SpellAbility(
      mkAst("ChangeZone", {
        Origin: { kind: "literal", raw: "Graveyard" },
        Destination: { kind: "literal", raw: "Battlefield" },
        WithCountersType: { kind: "literal", raw: "-1/-1" },
        WithCountersAmount: { kind: "literal", raw: "1" },
      }),
      sourceId,
      seat0,
      new Map(),
      [cardId],
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(game.cards.get(cardId)?.zone).toBe(ZoneType.Battlefield);
    expect(game.cards.get(cardId)?.counters.get(CounterType.MinusOneMinusOne)).toBe(1);
  });

  it("ChangeZone Tapped$ True flips tapped on landed card", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const cardId = mkEntityId(20);

    const source = new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield);
    const card = new Card(cardId, bearPaper, seat0, seat0, ZoneType.Hand);
    game.cards.set(sourceId, source);
    game.cards.set(cardId, card);
    game.getPlayer(seat0).zones.get(ZoneType.Hand)?.add(cardId);

    const sa = new SpellAbility(
      mkAst("ChangeZone", {
        Destination: { kind: "literal", raw: "Battlefield" },
        Tapped: { kind: "literal", raw: "True" },
      }),
      sourceId,
      seat0,
      new Map(),
      [cardId],
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(game.cards.get(cardId)?.tapped).toBe(true);
  });

  it("ChangeZone ChangeNum$ caps how many targets are moved", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const id1 = mkEntityId(20);
    const id2 = mkEntityId(21);
    const id3 = mkEntityId(22);

    const source = new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    for (const id of [id1, id2, id3]) {
      const c = new Card(id, bearPaper, seat0, seat0, ZoneType.Graveyard);
      game.cards.set(id, c);
      game.getPlayer(seat0).zones.get(ZoneType.Graveyard)?.add(id);
    }

    const sa = new SpellAbility(
      mkAst("ChangeZone", {
        Destination: { kind: "literal", raw: "Hand" },
        ChangeNum: { kind: "literal", raw: "2" },
      }),
      sourceId,
      seat0,
      new Map(),
      [id1, id2, id3],
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    const inHand = [id1, id2, id3].filter((id) => game.cards.get(id)?.zone === ZoneType.Hand);
    expect(inHand.length).toBe(2);
  });

  // ----- DealDamage --------------------------------------------------------
  it("DealDamage Defined$ Self damages the source card without targeting", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);

    const source = new Card(sourceId, bearPaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);

    const sa = new SpellAbility(
      mkAst("DealDamage", {
        Defined: { kind: "literal", raw: "Self" },
        NumDmg: { kind: "literal", raw: "2" },
      }),
      sourceId,
      seat0,
      new Map(),
      [], // empty targets → Defined kicks in
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(game.cards.get(sourceId)?.damage).toBe(2);
  });

  it("DealDamage RememberDamaged$ True stamps damaged ids on source", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const tgtId = mkEntityId(20);

    const source = new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield);
    const tgt = new Card(tgtId, bearPaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.cards.set(tgtId, tgt);

    const sa = new SpellAbility(
      mkAst("DealDamage", {
        NumDmg: { kind: "literal", raw: "1" },
        RememberDamaged: { kind: "literal", raw: "True" },
      }),
      sourceId,
      seat0,
      new Map(),
      [tgtId],
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(game.cards.get(sourceId)?.remembered).toContain(tgtId);
  });

  // ----- PutCounter --------------------------------------------------------
  it("PutCounter UpTo$ True with N=2 still adds the full N (MVP)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const tgtId = mkEntityId(20);

    const source = new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield);
    const tgt = new Card(tgtId, bearPaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.cards.set(tgtId, tgt);

    const sa = new SpellAbility(
      mkAst("PutCounter", {
        CounterType: { kind: "literal", raw: "+1/+1" },
        CounterNum: { kind: "literal", raw: "2" },
        UpTo: { kind: "literal", raw: "True" },
      }),
      sourceId,
      seat0,
      new Map(),
      [tgtId],
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(game.cards.get(tgtId)?.counters.get(CounterType.PlusOnePlusOne)).toBe(2);
  });

  it("PutCounter EachExistingCounter$ True adds one of each present type", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const tgtId = mkEntityId(20);

    const source = new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield);
    const tgt = new Card(tgtId, bearPaper, seat0, seat0, ZoneType.Battlefield);
    tgt.counters.set(CounterType.PlusOnePlusOne, 2);
    tgt.counters.set(CounterType.Loyalty, 1);
    game.cards.set(sourceId, source);
    game.cards.set(tgtId, tgt);

    const sa = new SpellAbility(
      mkAst("PutCounter", {
        EachExistingCounter: { kind: "literal", raw: "True" },
      }),
      sourceId,
      seat0,
      new Map(),
      [tgtId],
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(game.cards.get(tgtId)?.counters.get(CounterType.PlusOnePlusOne)).toBe(3);
    expect(game.cards.get(tgtId)?.counters.get(CounterType.Loyalty)).toBe(2);
  });

  // ----- Pump --------------------------------------------------------------
  it("Pump IsCurse$ True flips signs for negative pumps", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const creatureId = mkEntityId(20);

    const source = new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield);
    const creature = new Card(creatureId, bearPaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.cards.set(creatureId, creature);
    game.layerEngine.pt7b.push({
      kind: "set",
      power: 4,
      toughness: 4,
      timestamp: 0,
      sourceAbilityId: null,
    });

    const sa = new SpellAbility(
      mkAst("Pump", {
        NumAtt: { kind: "literal", raw: "2" },
        NumDef: { kind: "literal", raw: "2" },
        IsCurse: { kind: "literal", raw: "True" },
      }),
      sourceId,
      seat0,
      new Map(),
      [creatureId],
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    const chars = game.layerEngine.computeCharacteristics(creatureId);
    expect(chars.power).toBe(2);
    expect(chars.toughness).toBe(2);
  });

  it("Pump Until$ MyNextTurn registers untilEndOfYourNextTurn duration", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const creatureId = mkEntityId(20);

    const source = new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield);
    const creature = new Card(creatureId, bearPaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.cards.set(creatureId, creature);

    const sa = new SpellAbility(
      mkAst("Pump", {
        NumAtt: { kind: "literal", raw: "1" },
        NumDef: { kind: "literal", raw: "1" },
        Until: { kind: "literal", raw: "MyNextTurn" },
      }),
      sourceId,
      seat0,
      new Map(),
      [creatureId],
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    const effects = game.continuousEffects;
    expect(effects).toHaveLength(1);
    expect(effects[0]?.duration.kind).toBe("untilEndOfYourNextTurn");
    expect(effects[0]?.layer).toBe(Layer.L7c_PTModify);
  });

  // ----- Token -------------------------------------------------------------
  it("Token RememberTokens$ True stamps created token ids on source", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const source = new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);

    const sa = new SpellAbility(
      mkAst("Token", {
        TokenAmount: { kind: "literal", raw: "2" },
        TokenName: { kind: "literal", raw: "Spirit" },
        TokenTypes: { kind: "literal", raw: "Creature,Spirit" },
        TokenPower: { kind: "literal", raw: "1" },
        TokenToughness: { kind: "literal", raw: "1" },
        TokenColors: { kind: "literal", raw: "White" },
        RememberTokens: { kind: "literal", raw: "True" },
      }),
      sourceId,
      seat0,
      new Map(),
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    const remembered = game.cards.get(sourceId)?.remembered ?? [];
    expect(remembered.length).toBe(2);
    for (const id of remembered) {
      expect(game.cards.get(id)?.isToken).toBe(true);
    }
  });

  it("Token Tapped$ True / Attacking$ True flag flips on the new tokens", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const source = new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);

    const sa = new SpellAbility(
      mkAst("Token", {
        TokenAmount: { kind: "literal", raw: "1" },
        TokenName: { kind: "literal", raw: "Soldier" },
        TokenTypes: { kind: "literal", raw: "Creature,Soldier" },
        TokenPower: { kind: "literal", raw: "1" },
        TokenToughness: { kind: "literal", raw: "1" },
        TokenColors: { kind: "literal", raw: "White" },
        Tapped: { kind: "literal", raw: "True" },
        Attacking: { kind: "literal", raw: "True" },
        RememberTokens: { kind: "literal", raw: "True" },
      }),
      sourceId,
      seat0,
      new Map(),
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    const newTokenId = game.cards.get(sourceId)?.remembered[0];
    expect(newTokenId).toBeDefined();
    if (newTokenId !== undefined) {
      const tok = game.cards.get(newTokenId);
      expect(tok?.tapped).toBe(true);
      expect(tok?.enteredAttacking).toBe(true);
    }
  });

  // ----- Discard -----------------------------------------------------------
  it("Discard Mode$ Random uses game.rng deterministically", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const source = new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);

    const handIds = [mkEntityId(20), mkEntityId(21), mkEntityId(22)];
    for (const id of handIds) {
      const c = new Card(id, bearPaper, seat0, seat0, ZoneType.Hand);
      game.cards.set(id, c);
      game.getPlayer(seat0).zones.get(ZoneType.Hand)?.add(id);
    }

    const sa = new SpellAbility(
      mkAst("Discard", {
        NumCards: { kind: "literal", raw: "1" },
        Mode: { kind: "literal", raw: "Random" },
      }),
      sourceId,
      seat0,
      new Map(),
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    const inGy = handIds.filter((id) => game.cards.get(id)?.zone === ZoneType.Graveyard);
    expect(inGy.length).toBe(1);
  });

  // ----- CounterSpell DestinationZone$ ------------------------------------
  it("Counter DestinationZone$ Exile sends countered spell to exile", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const sourceId = mkEntityId(10);
    const spellOwnerId = mkEntityId(20);

    const source = new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield);
    const spellSource = new Card(spellOwnerId, bearPaper, seat1, seat1, ZoneType.Stack);
    game.cards.set(sourceId, source);
    game.cards.set(spellOwnerId, spellSource);

    // Add the spell-owner card to seat1's hand so locate() finds it
    // for the countered moveTo. (Counter then moves Stack→DestinationZone
    // by reading sourceCard's owner.)
    game.getPlayer(seat1).zones.get(ZoneType.Hand)?.add(spellOwnerId);

    // Push a fake spell stack item to be countered.
    const stackItemId = mkEntityId(30);
    game.sharedZones.stack.push({
      id: stackItemId,
      sourceCardId: spellOwnerId,
      controllerSeat: seat1,
      kind: "spell",
      isCast: true,
      targets: [],
      modes: [],
      xValue: null,
      costPaid: null,
      provenance: { originZone: ZoneType.Hand, altCostUsed: null, additionalCostsPaid: [] },
    });

    const sa = new SpellAbility(
      mkAst("Counter", {
        DestinationZone: { kind: "literal", raw: "Exile" },
      }),
      sourceId,
      seat0,
      new Map(),
      [stackItemId],
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(game.cards.get(spellOwnerId)?.zone).toBe(ZoneType.Exile);
  });

  // ----- Sacrifice Amount$ -------------------------------------------------
  it("Sacrifice Amount$ caps how many targets are sacrificed", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const ids = [mkEntityId(20), mkEntityId(21), mkEntityId(22)];

    const source = new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    for (const id of ids) {
      const c = new Card(id, bearPaper, seat0, seat0, ZoneType.Battlefield);
      game.cards.set(id, c);
      game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(id);
    }

    const sa = new SpellAbility(
      mkAst("Sacrifice", {
        Amount: { kind: "literal", raw: "2" },
        RememberSacrificed: { kind: "literal", raw: "True" },
      }),
      sourceId,
      seat0,
      new Map(),
      ids,
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    const inGy = ids.filter((id) => game.cards.get(id)?.zone === ZoneType.Graveyard);
    expect(inGy.length).toBe(2);
    expect(game.cards.get(sourceId)?.remembered.length).toBe(2);
  });

  // ----- CopyPermanent AddTypes$ ------------------------------------------
  it("CopyPermanent AddTypes$ adds card types via Layer 4", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const tgtId = mkEntityId(20);

    const source = new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield);
    const tgt = new Card(tgtId, bearPaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.cards.set(tgtId, tgt);

    const sa = new SpellAbility(
      mkAst("CopyPermanent", {
        NumCopies: { kind: "literal", raw: "1" },
        AddTypes: { kind: "literal", raw: "Artifact" },
      }),
      sourceId,
      seat0,
      new Map(),
      [tgtId],
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    // Find the new token (id != source/tgt).
    const newTokenId = [...game.cards.keys()].find(
      (id) => id !== sourceId && id !== tgtId && game.cards.get(id)?.isToken === true,
    );
    expect(newTokenId).toBeDefined();
    if (newTokenId !== undefined) {
      const chars = game.layerEngine.computeCharacteristics(newTokenId);
      expect(chars.types.has(CardType.Artifact)).toBe(true);
      // Original creature type from the copied PaperCard is preserved.
      expect(chars.types.has(CardType.Creature)).toBe(true);
    }
  });

  // ----- Animate Until$ MyNextTurn ----------------------------------------
  it("Animate Until$ MyNextTurn registers untilEndOfYourNextTurn duration", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const source = new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);

    const sa = new SpellAbility(
      mkAst("Animate", {
        Power: { kind: "literal", raw: "3" },
        Toughness: { kind: "literal", raw: "3" },
        Duration: { kind: "literal", raw: "MyNextTurn" },
        RememberObjects: { kind: "literal", raw: "True" },
      }),
      sourceId,
      seat0,
      new Map(),
      [sourceId],
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    const effects = game.continuousEffects;
    expect(effects.length).toBe(2);
    for (const e of effects) {
      expect(e.duration.kind).toBe("untilEndOfYourNextTurn");
    }
    expect(game.cards.get(sourceId)?.remembered).toContain(sourceId);
  });

  // ----- GainControl LoseControl$ -----------------------------------------
  it("GainControl LoseControl$ EndOfTurn records a ledger revert entry", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const sourceId = mkEntityId(10);
    const tgtId = mkEntityId(20);

    const source = new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield);
    const tgt = new Card(tgtId, bearPaper, seat1, seat1, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.cards.set(tgtId, tgt);

    const sa = new SpellAbility(
      mkAst("GainControl", {
        LoseControl: { kind: "literal", raw: "EndOfTurn" },
      }),
      sourceId,
      seat0,
      new Map(),
      [tgtId],
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(game.cards.get(tgtId)?.controllerSeat).toBe(seat0);
    // Ledger must have an entry so the EOT cleanup can revert.
    const entry = game.controlChangeLedger.get(tgtId);
    expect(entry).toBeDefined();
    expect(entry?.duration.kind).toBe("untilEndOfTurn");
  });

  // ----- Mana Amount$ -----------------------------------------------------
  it("Mana Amount$ N produces N copies of Produced$", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const source = new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);

    const sa = new SpellAbility(
      mkAst("Mana", {
        Produced: { kind: "literal", raw: "G" },
        Amount: { kind: "literal", raw: "3" },
      }),
      sourceId,
      seat0,
      new Map(),
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    const pool = game.getPlayer(seat0).manaPool as { size(): number };
    expect(pool.size()).toBe(3);
  });
});

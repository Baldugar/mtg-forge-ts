// SPDX-License-Identifier: GPL-3.0-or-later
// Round-trip coverage for the 40 concrete CostPart classes: instantiate with
// plausible sample data, wrap in Cost.of, stringify + parse, re-hydrate via
// Cost.fromJSON, and verify the revived instance is of the expected class with
// every field preserved. The side-effect import ensures all CostPartRegistry
// registrations fire at module load.
import { describe, expect, it } from "vitest";
import { CounterType } from "../counter-type.js";
import { ManaCost } from "../mana/cost.js";
import { ZoneType } from "../zone.js";
import type { CostPart } from "./cost-part.js";
import { Cost } from "./cost.js";
import "./parts/index.js";

import { CostAddMana } from "./parts/add-mana.js";
import { CostBeholdExile } from "./parts/behold-exile.js";
import { CostBehold } from "./parts/behold.js";
import { CostBlight } from "./parts/blight.js";
import { CostChooseColor } from "./parts/choose-color.js";
import { CostChooseCreatureType } from "./parts/choose-creature-type.js";
import { CostCollectEvidence } from "./parts/collect-evidence.js";
import { CostDamage } from "./parts/damage.js";
import { CostDiscard } from "./parts/discard.js";
import { CostDraw } from "./parts/draw.js";
import { CostEnlist } from "./parts/enlist.js";
import { CostExert } from "./parts/exert.js";
import { CostExileFromStack } from "./parts/exile-from-stack.js";
import { CostExile } from "./parts/exile.js";
import { CostExiledMoveToGrave } from "./parts/exiled-move-to-grave.js";
import { CostFlipCoin } from "./parts/flip-coin.js";
import { CostForage } from "./parts/forage.js";
import { CostGainControl } from "./parts/gain-control.js";
import { CostGainLife } from "./parts/gain-life.js";
import { CostPartMana } from "./parts/mana.js";
import { CostMill } from "./parts/mill.js";
import { CostPayEnergy } from "./parts/pay-energy.js";
import { CostPayLife } from "./parts/pay-life.js";
import { CostPayShards } from "./parts/pay-shards.js";
import { CostPromiseGift } from "./parts/promise-gift.js";
import { CostPutCardToLib } from "./parts/put-card-to-lib.js";
import { CostPutCounter } from "./parts/put-counter.js";
import { CostRemoveAnyCounter } from "./parts/remove-any-counter.js";
import { CostRemoveCounter } from "./parts/remove-counter.js";
import { CostReturn } from "./parts/return.js";
import { CostRevealChosen } from "./parts/reveal-chosen.js";
import { CostReveal } from "./parts/reveal.js";
import { CostRollDice } from "./parts/roll-dice.js";
import { CostSacrifice } from "./parts/sacrifice.js";
import { CostTapType } from "./parts/tap-type.js";
import { CostTap } from "./parts/tap.js";
import { CostUnattach } from "./parts/unattach.js";
import { CostUntapType } from "./parts/untap-type.js";
import { CostUntap } from "./parts/untap.js";
import { CostWaterbend } from "./parts/waterbend.js";

type Ctor<T extends CostPart> = new (...args: never[]) => T;

function roundTrip(part: CostPart): CostPart {
  const cost = Cost.of(part);
  const wire = JSON.parse(JSON.stringify(cost.toJSON())) as {
    parts: Array<{ kind: string; [k: string]: unknown }>;
  };
  const restored = Cost.fromJSON(wire);
  expect(restored.parts.length).toBe(1);
  const [first] = restored.parts;
  if (!first) throw new Error("round-trip: empty parts list");
  return first;
}

function expectInstanceAndKind<T extends CostPart>(
  got: CostPart,
  ctor: Ctor<T>,
  kind: string,
): asserts got is T {
  expect(got).toBeInstanceOf(ctor);
  expect(got.kind).toBe(kind);
}

describe("CostPart round-trip — 40 kinds", () => {
  it("addMana", () => {
    const got = roundTrip(new CostAddMana("1", "R", "one red"));
    expectInstanceAndKind(got, CostAddMana, "addMana");
    expect(got.amount).toBe("1");
    expect(got.type).toBe("R");
    expect(got.description).toBe("one red");
  });

  it("behold", () => {
    const got = roundTrip(new CostBehold("1", "Creature", "a creature"));
    expectInstanceAndKind(got, CostBehold, "behold");
    expect(got.amount).toBe("1");
    expect(got.type).toBe("Creature");
    expect(got.description).toBe("a creature");
  });

  it("beholdExile", () => {
    const got = roundTrip(new CostBeholdExile("1", "Creature", "a creature"));
    expectInstanceAndKind(got, CostBeholdExile, "beholdExile");
    expect(got.amount).toBe("1");
    expect(got.type).toBe("Creature");
    expect(got.description).toBe("a creature");
  });

  it("blight", () => {
    const got = roundTrip(new CostBlight("1"));
    expectInstanceAndKind(got, CostBlight, "blight");
    expect(got.counters).toBe("1");
  });

  it("chooseColor", () => {
    const got = roundTrip(new CostChooseColor("1"));
    expectInstanceAndKind(got, CostChooseColor, "chooseColor");
    expect(got.amount).toBe("1");
  });

  it("chooseCreatureType", () => {
    const got = roundTrip(new CostChooseCreatureType("1"));
    expectInstanceAndKind(got, CostChooseCreatureType, "chooseCreatureType");
    expect(got.amount).toBe("1");
  });

  it("collectEvidence", () => {
    const got = roundTrip(new CostCollectEvidence("6"));
    expectInstanceAndKind(got, CostCollectEvidence, "collectEvidence");
    expect(got.amount).toBe("6");
  });

  it("damage", () => {
    const got = roundTrip(new CostDamage("2"));
    expectInstanceAndKind(got, CostDamage, "damage");
    expect(got.amount).toBe("2");
  });

  it("discard", () => {
    const got = roundTrip(new CostDiscard("1", "Card", "a card"));
    expectInstanceAndKind(got, CostDiscard, "discard");
    expect(got.amount).toBe("1");
    expect(got.type).toBe("Card");
    expect(got.description).toBe("a card");
  });

  it("draw", () => {
    const got = roundTrip(new CostDraw("1", "You"));
    expectInstanceAndKind(got, CostDraw, "draw");
    expect(got.amount).toBe("1");
    expect(got.playerSelector).toBe("You");
  });

  it("enlist", () => {
    const got = roundTrip(new CostEnlist("1", "Creature.YouCtrl", "a creature you control"));
    expectInstanceAndKind(got, CostEnlist, "enlist");
    expect(got.amount).toBe("1");
    expect(got.type).toBe("Creature.YouCtrl");
    expect(got.description).toBe("a creature you control");
  });

  it("exert", () => {
    const got = roundTrip(new CostExert("1", "Creature.YouCtrl", "a creature you control"));
    expectInstanceAndKind(got, CostExert, "exert");
    expect(got.amount).toBe("1");
    expect(got.type).toBe("Creature.YouCtrl");
    expect(got.description).toBe("a creature you control");
  });

  it("exile", () => {
    const got = roundTrip(new CostExile("1", "Creature", "a creature", [ZoneType.Battlefield], 1));
    expectInstanceAndKind(got, CostExile, "exile");
    expect(got.amount).toBe("1");
    expect(got.type).toBe("Creature");
    expect(got.description).toBe("a creature");
    expect([...got.from]).toEqual([ZoneType.Battlefield]);
    expect(got.zoneRestriction).toBe(1);
  });

  it("exileFromStack", () => {
    const got = roundTrip(new CostExileFromStack("1", "Card", "a card"));
    expectInstanceAndKind(got, CostExileFromStack, "exileFromStack");
    expect(got.amount).toBe("1");
    expect(got.type).toBe("Card");
    expect(got.description).toBe("a card");
  });

  it("exiledMoveToGrave", () => {
    const got = roundTrip(new CostExiledMoveToGrave("1", "Card", "an exiled card"));
    expectInstanceAndKind(got, CostExiledMoveToGrave, "exiledMoveToGrave");
    expect(got.amount).toBe("1");
    expect(got.type).toBe("Card");
    expect(got.description).toBe("an exiled card");
  });

  it("flipCoin", () => {
    const got = roundTrip(new CostFlipCoin("1"));
    expectInstanceAndKind(got, CostFlipCoin, "flipCoin");
    expect(got.amount).toBe("1");
  });

  it("forage", () => {
    const got = roundTrip(new CostForage());
    expectInstanceAndKind(got, CostForage, "forage");
  });

  it("gainControl", () => {
    const got = roundTrip(new CostGainControl("1", "Creature", "a creature"));
    expectInstanceAndKind(got, CostGainControl, "gainControl");
    expect(got.amount).toBe("1");
    expect(got.type).toBe("Creature");
    expect(got.description).toBe("a creature");
  });

  it("gainLife", () => {
    const got = roundTrip(new CostGainLife("2", "Opponent", 1));
    expectInstanceAndKind(got, CostGainLife, "gainLife");
    expect(got.amount).toBe("2");
    expect(got.playerSelector).toBe("Opponent");
    expect(got.cntPlayers).toBe(1);
  });

  it("mana", () => {
    const original = new CostPartMana(ManaCost.parse("2WU"), 0, false, false, false);
    const got = roundTrip(original);
    expectInstanceAndKind(got, CostPartMana, "mana");
    expect(got.cost.symbols.length).toBe(3);
    expect(got.xMin).toBe(0);
    expect(got.isExiledCreatureCost).toBe(false);
    expect(got.isEnchantedCreatureCost).toBe(false);
    expect(got.isCostPayAnyNumberOfTimes).toBe(false);
  });

  it("mill", () => {
    const got = roundTrip(new CostMill("2"));
    expectInstanceAndKind(got, CostMill, "mill");
    expect(got.amount).toBe("2");
  });

  it("payEnergy", () => {
    const got = roundTrip(new CostPayEnergy("2"));
    expectInstanceAndKind(got, CostPayEnergy, "payEnergy");
    expect(got.amount).toBe("2");
  });

  it("payLife", () => {
    const got = roundTrip(new CostPayLife("2", "2 life"));
    expectInstanceAndKind(got, CostPayLife, "payLife");
    expect(got.amount).toBe("2");
    expect(got.description).toBe("2 life");
  });

  it("payShards", () => {
    const got = roundTrip(new CostPayShards("1"));
    expectInstanceAndKind(got, CostPayShards, "payShards");
    expect(got.amount).toBe("1");
  });

  it("promiseGift", () => {
    const got = roundTrip(new CostPromiseGift());
    expectInstanceAndKind(got, CostPromiseGift, "promiseGift");
  });

  it("putCardToLib", () => {
    const got = roundTrip(new CostPutCardToLib("1", "0", "Card", "a card", ZoneType.Hand, false));
    expectInstanceAndKind(got, CostPutCardToLib, "putCardToLib");
    expect(got.amount).toBe("1");
    expect(got.libPosition).toBe("0");
    expect(got.type).toBe("Card");
    expect(got.description).toBe("a card");
    expect(got.from).toBe(ZoneType.Hand);
    expect(got.sameZone).toBe(false);
  });

  it("putCounter", () => {
    const got = roundTrip(
      new CostPutCounter("1", CounterType.PlusOnePlusOne, "Creature.YouCtrl", "a creature you control"),
    );
    expectInstanceAndKind(got, CostPutCounter, "putCounter");
    expect(got.amount).toBe("1");
    expect(got.counter).toBe(CounterType.PlusOnePlusOne);
    expect(got.type).toBe("Creature.YouCtrl");
    expect(got.description).toBe("a creature you control");
  });

  it("removeAnyCounter", () => {
    const got = roundTrip(
      new CostRemoveAnyCounter(
        "1",
        CounterType.PlusOnePlusOne,
        "Permanent.YouCtrl",
        "a permanent you control",
        false,
      ),
    );
    expectInstanceAndKind(got, CostRemoveAnyCounter, "removeAnyCounter");
    expect(got.amount).toBe("1");
    expect(got.counter).toBe(CounterType.PlusOnePlusOne);
    expect(got.type).toBe("Permanent.YouCtrl");
    expect(got.description).toBe("a permanent you control");
    expect(got.oneOrMore).toBe(false);
  });

  it("removeCounter", () => {
    const got = roundTrip(
      new CostRemoveCounter(
        "1",
        CounterType.Loyalty,
        "CARDNAME",
        "this planeswalker",
        [ZoneType.Battlefield],
        false,
      ),
    );
    expectInstanceAndKind(got, CostRemoveCounter, "removeCounter");
    expect(got.amount).toBe("1");
    expect(got.counter).toBe(CounterType.Loyalty);
    expect(got.type).toBe("CARDNAME");
    expect(got.description).toBe("this planeswalker");
    expect([...got.zone]).toEqual([ZoneType.Battlefield]);
    expect(got.oneOrMore).toBe(false);
  });

  it("return", () => {
    const got = roundTrip(new CostReturn("1", "Creature.YouCtrl", "a creature you control"));
    expectInstanceAndKind(got, CostReturn, "return");
    expect(got.amount).toBe("1");
    expect(got.type).toBe("Creature.YouCtrl");
    expect(got.description).toBe("a creature you control");
  });

  it("reveal", () => {
    const got = roundTrip(new CostReveal("1", "Card", "a card", [ZoneType.Hand]));
    expectInstanceAndKind(got, CostReveal, "reveal");
    expect(got.amount).toBe("1");
    expect(got.type).toBe("Card");
    expect(got.description).toBe("a card");
    expect([...got.revealFrom]).toEqual([ZoneType.Hand]);
  });

  it("revealChosen", () => {
    const got = roundTrip(new CostRevealChosen("Player", "chosen player"));
    expectInstanceAndKind(got, CostRevealChosen, "revealChosen");
    expect(got.type).toBe("Player");
    expect(got.description).toBe("chosen player");
  });

  it("rollDice", () => {
    const got = roundTrip(new CostRollDice("1", "6", "RolledResult", "a d6"));
    expectInstanceAndKind(got, CostRollDice, "rollDice");
    expect(got.amount).toBe("1");
    expect(got.sides).toBe("6");
    expect(got.resultSVar).toBe("RolledResult");
    expect(got.description).toBe("a d6");
  });

  it("sacrifice", () => {
    const got = roundTrip(new CostSacrifice("1", "Creature.YouCtrl", "a creature you control"));
    expectInstanceAndKind(got, CostSacrifice, "sacrifice");
    expect(got.amount).toBe("1");
    expect(got.type).toBe("Creature.YouCtrl");
    expect(got.description).toBe("a creature you control");
  });

  it("tap", () => {
    const got = roundTrip(new CostTap());
    expectInstanceAndKind(got, CostTap, "tap");
  });

  it("tapType", () => {
    const got = roundTrip(new CostTapType("1", "Creature.YouCtrl", "a creature you control", true));
    expectInstanceAndKind(got, CostTapType, "tapType");
    expect(got.amount).toBe("1");
    expect(got.type).toBe("Creature.YouCtrl");
    expect(got.description).toBe("a creature you control");
    expect(got.canTapSource).toBe(true);
  });

  it("unattach", () => {
    const got = roundTrip(new CostUnattach("CARDNAME", "this equipment"));
    expectInstanceAndKind(got, CostUnattach, "unattach");
    expect(got.type).toBe("CARDNAME");
    expect(got.description).toBe("this equipment");
  });

  it("untap", () => {
    const got = roundTrip(new CostUntap());
    expectInstanceAndKind(got, CostUntap, "untap");
  });

  it("untapType", () => {
    const got = roundTrip(new CostUntapType("1", "Creature.YouCtrl", "a creature you control", true));
    expectInstanceAndKind(got, CostUntapType, "untapType");
    expect(got.amount).toBe("1");
    expect(got.type).toBe("Creature.YouCtrl");
    expect(got.description).toBe("a creature you control");
    expect(got.canUntapSource).toBe(true);
  });

  it("waterbend", () => {
    const got = roundTrip(new CostWaterbend("1U"));
    expectInstanceAndKind(got, CostWaterbend, "waterbend");
    expect(got.mana).toBe("1U");
    expect(got.cost.symbols.length).toBe(2);
  });
});

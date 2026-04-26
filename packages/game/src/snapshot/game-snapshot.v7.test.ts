// SPDX-License-Identifier: GPL-3.0-or-later
// SP3 Wave 43 — v7 schema round-trip coverage for the 35+ transient Card
// slots accumulated across Waves 23-42. Each slot is exercised: stamp a
// non-default value on a live Card, snapshot, JSON.stringify/parse, restore,
// and assert the restored Card carries the same value.
import {
  Color,
  ColorSet,
  DEFAULT_PAPER_CARD_FLAGS,
  IncompatibleSnapshotVersionError,
  type LobbyPlayer,
  type PaperCard,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
  paperCardKey,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";
import { restore, snapshot } from "./game-snapshot.js";

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

const paper: PaperCard = {
  name: "Grizzly Bears",
  edition: "LEA",
  collectorNumber: "195",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const paperCards = new Map<string, PaperCard>([[paperCardKey(paper), paper]]);

const makeGame = (seed = 1n): Game => {
  const g = new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(seed),
  });
  for (const p of g.players) {
    p.zones.set(ZoneType.Library, new Library(ZoneType.Library, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
    p.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p.seat));
  }
  return g;
};

const seedCard = (g: Game, owner: number, zone: ZoneType): Card => {
  const id = g.newEntityId();
  const c = new Card(id, paper, mkPlayerSeat(owner), mkPlayerSeat(owner), zone);
  g.cards.set(id, c);
  const p = g.players[owner];
  if (p) {
    const z = p.zones.get(zone);
    if (z) z.add(id);
  }
  return c;
};

const makeRestoreOpts = () => ({
  lobbyPlayers: [alice, bob],
  rng: new SeededRng(1n),
  paperCards,
  rules,
});

const roundTrip = (g: Game): Game => {
  const snap = snapshot(g);
  const wire = JSON.parse(JSON.stringify(snap)) as typeof snap;
  return restore(wire, makeRestoreOpts());
};

describe("GameSnapshot v7 (SP3 Wave 43 — transient Card slots round-trip)", () => {
  it("schemaVersion is pinned to 7", () => {
    const g = makeGame();
    const snap = snapshot(g);
    expect(snap.header.schemaVersion).toBe(7);
  });

  it("rejects v6 input with IncompatibleSnapshotVersionError", () => {
    const g = makeGame();
    const snap = snapshot(g);
    const v6 = { ...snap, header: { ...snap.header, schemaVersion: 6 } };
    expect(() => restore(v6, makeRestoreOpts())).toThrow(IncompatibleSnapshotVersionError);
  });

  it("Crew / Saddle / Station per-EOT flags round-trip", () => {
    const g = makeGame();
    const vehicle = seedCard(g, 0, ZoneType.Battlefield);
    const mount = seedCard(g, 0, ZoneType.Battlefield);
    const spacecraft = seedCard(g, 0, ZoneType.Battlefield);
    vehicle.crewedUntilEot = true;
    mount.saddledUntilEot = true;
    spacecraft.stationedUntilEot = true;
    const r = roundTrip(g);
    expect(r.cards.get(vehicle.id)?.crewedUntilEot).toBe(true);
    expect(r.cards.get(mount.id)?.saddledUntilEot).toBe(true);
    expect(r.cards.get(spacecraft.id)?.stationedUntilEot).toBe(true);
  });

  it("Champion linkage (championedTarget / championedBy) round-trips", () => {
    const g = makeGame();
    const champion = seedCard(g, 0, ZoneType.Battlefield);
    const exiled = seedCard(g, 0, ZoneType.Exile);
    champion.championedTarget = exiled.id;
    exiled.championedBy = champion.id;
    const r = roundTrip(g);
    expect(r.cards.get(champion.id)?.championedTarget).toBe(exiled.id);
    expect(r.cards.get(exiled.id)?.championedBy).toBe(champion.id);
  });

  it("Echo + age + suspend + haste-from-suspend round-trip", () => {
    const g = makeGame();
    const echoer = seedCard(g, 0, ZoneType.Battlefield);
    const ageCreature = seedCard(g, 0, ZoneType.Battlefield);
    const suspended = seedCard(g, 0, ZoneType.Exile);
    echoer.echoOwedCost = "{2}{R}";
    ageCreature.ageCounters = 3;
    suspended.suspendedCounters = 4;
    suspended.hasteFromSuspend = true;
    const r = roundTrip(g);
    expect(r.cards.get(echoer.id)?.echoOwedCost).toBe("{2}{R}");
    expect(r.cards.get(ageCreature.id)?.ageCounters).toBe(3);
    expect(r.cards.get(suspended.id)?.suspendedCounters).toBe(4);
    expect(r.cards.get(suspended.id)?.hasteFromSuspend).toBe(true);
  });

  it("Phasing / goad / removed-from-combat / must-block round-trip", () => {
    const g = makeGame();
    const phased = seedCard(g, 0, ZoneType.Battlefield);
    const goaded = seedCard(g, 0, ZoneType.Battlefield);
    const removed = seedCard(g, 0, ZoneType.Battlefield);
    const muster = seedCard(g, 0, ZoneType.Battlefield);
    const target = seedCard(g, 1, ZoneType.Battlefield);
    phased.phasedOut = true;
    goaded.goaded = true;
    removed.removedFromCombat = true;
    muster.mustBlockTargetId = target.id;
    const r = roundTrip(g);
    expect(r.cards.get(phased.id)?.phasedOut).toBe(true);
    expect(r.cards.get(goaded.id)?.goaded).toBe(true);
    expect(r.cards.get(removed.id)?.removedFromCombat).toBe(true);
    expect(r.cards.get(muster.id)?.mustBlockTargetId).toBe(target.id);
  });

  it("Choice-store fields (colors / types / players / number / direction / name) round-trip", () => {
    const g = makeGame();
    const c = seedCard(g, 0, ZoneType.Battlefield);
    c.chosenColors = [Color.Red, Color.Green, null];
    c.chosenTypes = ["Goblin", "Knight"];
    c.chosenPlayers = [mkPlayerSeat(0), mkPlayerSeat(1)];
    c.chosenNumber = 7;
    c.chosenDirection = "Left";
    c.namedCard = "Lightning Bolt";
    const r = roundTrip(g);
    const rc = r.cards.get(c.id);
    expect(rc?.chosenColors).toEqual([Color.Red, Color.Green, null]);
    expect(rc?.chosenTypes).toEqual(["Goblin", "Knight"]);
    expect(rc?.chosenPlayers).toEqual([mkPlayerSeat(0), mkPlayerSeat(1)]);
    expect(rc?.chosenNumber).toBe(7);
    expect(rc?.chosenDirection).toBe("Left");
    expect(rc?.namedCard).toBe("Lightning Bolt");
  });

  it("Text-change record list round-trips", () => {
    const g = makeGame();
    const c = seedCard(g, 0, ZoneType.Battlefield);
    c.textChanges = [
      { kind: "color", from: "white", to: "blue" },
      { kind: "type", from: "Goblin", to: "Elf" },
    ];
    const r = roundTrip(g);
    expect(r.cards.get(c.id)?.textChanges).toEqual([
      { kind: "color", from: "white", to: "blue" },
      { kind: "type", from: "Goblin", to: "Elf" },
    ]);
  });

  it("Plot / mutate (mutate already in v6) / disturb / renown / riot / rebound / pair round-trip", () => {
    const g = makeGame();
    const plot = seedCard(g, 0, ZoneType.Exile);
    const disturb = seedCard(g, 0, ZoneType.Graveyard);
    const renowned = seedCard(g, 0, ZoneType.Battlefield);
    const riotter = seedCard(g, 0, ZoneType.Battlefield);
    const rebound = seedCard(g, 0, ZoneType.Exile);
    const a = seedCard(g, 0, ZoneType.Battlefield);
    const b = seedCard(g, 0, ZoneType.Battlefield);
    plot.plotted = true;
    plot.plottedOnTurn = 4;
    disturb.disturbed = true;
    renowned.renowned = true;
    riotter.riotChoseHaste = true;
    rebound.reboundUntilUpkeep = 5;
    a.pairedWith = b.id;
    b.pairedWith = a.id;
    const r = roundTrip(g);
    expect(r.cards.get(plot.id)?.plotted).toBe(true);
    expect(r.cards.get(plot.id)?.plottedOnTurn).toBe(4);
    expect(r.cards.get(disturb.id)?.disturbed).toBe(true);
    expect(r.cards.get(renowned.id)?.renowned).toBe(true);
    expect(r.cards.get(riotter.id)?.riotChoseHaste).toBe(true);
    expect(r.cards.get(rebound.id)?.reboundUntilUpkeep).toBe(5);
    expect(r.cards.get(a.id)?.pairedWith).toBe(b.id);
    expect(r.cards.get(b.id)?.pairedWith).toBe(a.id);
  });

  it("Wave 34 Battle slots (protectorSeat / battleDefeated) round-trip", () => {
    const g = makeGame();
    const battle = seedCard(g, 0, ZoneType.Battlefield);
    const defeated = seedCard(g, 0, ZoneType.Exile);
    battle.protectorSeat = mkPlayerSeat(1);
    defeated.battleDefeated = true;
    const r = roundTrip(g);
    expect(r.cards.get(battle.id)?.protectorSeat).toBe(mkPlayerSeat(1));
    expect(r.cards.get(defeated.id)?.battleDefeated).toBe(true);
  });

  it("Wave 37 hideaway link + Wave 37 mana-spent + Wave 42 mana-spent-total round-trip", () => {
    const g = makeGame();
    const host = seedCard(g, 0, ZoneType.Battlefield);
    const exiled = seedCard(g, 0, ZoneType.Exile);
    const sunburst = seedCard(g, 0, ZoneType.Battlefield);
    host.hideawayCard = exiled.id;
    exiled.hideawayHost = host.id;
    sunburst.manaSpentColors = new Set([Color.White, Color.Blue, Color.Red]);
    sunburst.manaSpentTotal = 5;
    const r = roundTrip(g);
    expect(r.cards.get(host.id)?.hideawayCard).toBe(exiled.id);
    expect(r.cards.get(exiled.id)?.hideawayHost).toBe(host.id);
    expect([...(r.cards.get(sunburst.id)?.manaSpentColors ?? [])].sort()).toEqual(
      [...new Set([Color.White, Color.Blue, Color.Red])].sort(),
    );
    expect(r.cards.get(sunburst.id)?.manaSpentTotal).toBe(5);
  });

  it("Wave 38 strive / Wave 39 sweep + companion / Wave 40 dredge round-trip", () => {
    const g = makeGame();
    const strive = seedCard(g, 0, ZoneType.Hand);
    const sweep = seedCard(g, 0, ZoneType.Hand);
    const companion = seedCard(g, 0, ZoneType.Command);
    const dredge = seedCard(g, 0, ZoneType.Graveyard);
    strive.striveExtraCost = "{1}{W}";
    sweep.sweepReturnedType = "Plains";
    sweep.sweepReturnedCount = 3;
    companion.companionCondition = "Card.cmcEven";
    dredge.dredgeAmount = 2;
    const r = roundTrip(g);
    expect(r.cards.get(strive.id)?.striveExtraCost).toBe("{1}{W}");
    expect(r.cards.get(sweep.id)?.sweepReturnedType).toBe("Plains");
    expect(r.cards.get(sweep.id)?.sweepReturnedCount).toBe(3);
    expect(r.cards.get(companion.id)?.companionCondition).toBe("Card.cmcEven");
    expect(r.cards.get(dredge.id)?.dredgeAmount).toBe(2);
  });

  it("Wave 33 tokenOverrides round-trip with all sub-fields populated", () => {
    const g = makeGame();
    const eternalized = seedCard(g, 0, ZoneType.Battlefield);
    eternalized.tokenOverrides = {
      colors: ColorSet.fromJSON(Color.Black),
      addedTypes: ["Zombie"],
      clearManaCost: true,
      setPower: 4,
      setToughness: 4,
    };
    const r = roundTrip(g);
    const rt = r.cards.get(eternalized.id)?.tokenOverrides;
    expect(rt?.colors?.toJSON()).toBe(Color.Black);
    expect(rt?.addedTypes).toEqual(["Zombie"]);
    expect(rt?.clearManaCost).toBe(true);
    expect(rt?.setPower).toBe(4);
    expect(rt?.setToughness).toBe(4);
  });

  it("regenerationShields + damagedByDeathtouch round-trip", () => {
    const g = makeGame();
    const regen = seedCard(g, 0, ZoneType.Battlefield);
    const dt = seedCard(g, 0, ZoneType.Battlefield);
    regen.regenerationShields = 2;
    dt.damagedByDeathtouch = true;
    const r = roundTrip(g);
    expect(r.cards.get(regen.id)?.regenerationShields).toBe(2);
    expect(r.cards.get(dt.id)?.damagedByDeathtouch).toBe(true);
  });

  it("Default-valued cards stay compact: snapshot omits transient slots when at default", () => {
    const g = makeGame();
    const c = seedCard(g, 0, ZoneType.Battlefield);
    const snap = snapshot(g);
    const sc = snap.state.cards.find((x) => x.id === c.id);
    expect(sc).toBeDefined();
    if (!sc) throw new Error("seed card serialized");
    // Sanity: none of the transient slots should be present on a fresh
    // card (they were never stamped).
    expect(sc.crewedUntilEot).toBeUndefined();
    expect(sc.championedTarget).toBeUndefined();
    expect(sc.echoOwedCost).toBeUndefined();
    expect(sc.tokenOverrides).toBeUndefined();
    expect(sc.textChanges).toBeUndefined();
    expect(sc.chosenColors).toBeUndefined();
  });

  it("game-flags.permanentsLeftBfThisTurn (Wave 32 Revolt counter) round-trips", () => {
    const g = makeGame();
    g.flags.permanentsLeftBfThisTurn.set(mkPlayerSeat(0), 2);
    g.flags.permanentsLeftBfThisTurn.set(mkPlayerSeat(1), 5);
    const r = roundTrip(g);
    expect(r.flags.permanentsLeftBfThisTurn.get(mkPlayerSeat(0))).toBe(2);
    expect(r.flags.permanentsLeftBfThisTurn.get(mkPlayerSeat(1))).toBe(5);
  });

  it("comprehensive: every transient slot stamped on a single Card round-trips through JSON", () => {
    const g = makeGame();
    const c = seedCard(g, 0, ZoneType.Battlefield);
    const other = seedCard(g, 1, ZoneType.Battlefield);
    c.crewedUntilEot = true;
    c.saddledUntilEot = true;
    c.stationedUntilEot = true;
    c.championedTarget = other.id;
    c.echoOwedCost = "{R}";
    c.ageCounters = 1;
    c.suspendedCounters = 2;
    c.hasteFromSuspend = true;
    c.phasedOut = true;
    c.goaded = true;
    c.removedFromCombat = true;
    c.mustBlockTargetId = other.id;
    c.chosenColors = [Color.Blue];
    c.chosenTypes = ["Wizard"];
    c.chosenPlayers = [mkPlayerSeat(1)];
    c.chosenNumber = 3;
    c.chosenDirection = "Right";
    c.namedCard = "Counterspell";
    c.textChanges = [{ kind: "color", from: "red", to: "white" }];
    c.disturbed = true;
    c.plotted = true;
    c.plottedOnTurn = 2;
    c.renowned = true;
    c.riotChoseHaste = true;
    c.reboundUntilUpkeep = 3;
    c.pairedWith = other.id;
    c.hideawayCard = other.id;
    c.manaSpentColors = new Set([Color.Green]);
    c.manaSpentTotal = 4;
    c.protectorSeat = mkPlayerSeat(1);
    c.battleDefeated = false;
    c.dredgeAmount = 5;
    c.tokenOverrides = { addedTypes: ["Zombie"], clearManaCost: false };
    c.companionCondition = "Card.YouCtrl";
    c.sweepReturnedType = "Mountain";
    c.sweepReturnedCount = 7;
    c.striveExtraCost = "{2}";
    c.regenerationShields = 1;
    c.damagedByDeathtouch = true;
    // Round-trip through JSON to prove wire-shape is fully serializable.
    const snap = snapshot(g);
    const wire = JSON.parse(JSON.stringify(snap)) as typeof snap;
    const r = restore(wire, makeRestoreOpts());
    const rc = r.cards.get(c.id);
    if (!rc) throw new Error("missing restored card");
    expect(rc.crewedUntilEot).toBe(true);
    expect(rc.saddledUntilEot).toBe(true);
    expect(rc.stationedUntilEot).toBe(true);
    expect(rc.championedTarget).toBe(other.id);
    expect(rc.echoOwedCost).toBe("{R}");
    expect(rc.ageCounters).toBe(1);
    expect(rc.suspendedCounters).toBe(2);
    expect(rc.hasteFromSuspend).toBe(true);
    expect(rc.phasedOut).toBe(true);
    expect(rc.goaded).toBe(true);
    expect(rc.removedFromCombat).toBe(true);
    expect(rc.mustBlockTargetId).toBe(other.id);
    expect(rc.chosenColors).toEqual([Color.Blue]);
    expect(rc.chosenTypes).toEqual(["Wizard"]);
    expect(rc.chosenPlayers).toEqual([mkPlayerSeat(1)]);
    expect(rc.chosenNumber).toBe(3);
    expect(rc.chosenDirection).toBe("Right");
    expect(rc.namedCard).toBe("Counterspell");
    expect(rc.textChanges).toEqual([{ kind: "color", from: "red", to: "white" }]);
    expect(rc.disturbed).toBe(true);
    expect(rc.plotted).toBe(true);
    expect(rc.plottedOnTurn).toBe(2);
    expect(rc.renowned).toBe(true);
    expect(rc.riotChoseHaste).toBe(true);
    expect(rc.reboundUntilUpkeep).toBe(3);
    expect(rc.pairedWith).toBe(other.id);
    expect(rc.hideawayCard).toBe(other.id);
    expect([...(rc.manaSpentColors ?? [])]).toEqual([Color.Green]);
    expect(rc.manaSpentTotal).toBe(4);
    expect(rc.protectorSeat).toBe(mkPlayerSeat(1));
    expect(rc.battleDefeated).toBe(false);
    expect(rc.dredgeAmount).toBe(5);
    expect(rc.tokenOverrides?.addedTypes).toEqual(["Zombie"]);
    expect(rc.tokenOverrides?.clearManaCost).toBe(false);
    expect(rc.companionCondition).toBe("Card.YouCtrl");
    expect(rc.sweepReturnedType).toBe("Mountain");
    expect(rc.sweepReturnedCount).toBe(7);
    expect(rc.striveExtraCost).toBe("{2}");
    expect(rc.regenerationShields).toBe(1);
    expect(rc.damagedByDeathtouch).toBe(true);
    // Smoke check: an entityId not stamped should still be undefined.
    expect(rc.championedBy).toBeUndefined();
    // mkEntityId noop sanity check (referenced for test completeness).
    expect(mkEntityId(0)).toBeDefined();
  });
});

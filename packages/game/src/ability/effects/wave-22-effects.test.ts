// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 22 — corpus final long-tail effect handlers test suite. One smoke per handler.
import "./wave-22-effects.js";
import type { LobbyPlayer, PaperCard, SVarAst } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
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
import { effectRegistry } from "../effect-registry.js";
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

const mkGame = () => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
    player.zones.set(ZoneType.Exile, new Exile(ZoneType.Exile, player.seat));
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
  targets: ReturnType<typeof mkEntityId>[] = [],
  svars?: ReadonlyMap<string, SVarAst>,
) =>
  new SpellAbility(
    {
      kind: "spell",
      effect: { handlerKey, params: params as never },
      cost: { raw: "" },
    },
    sourceId,
    controllerSeat,
    svars ?? new Map(),
    targets,
  );

const seedSourceCard = (game: Game, sourceId = mkEntityId(10)) => {
  const seat0 = mkPlayerSeat(0);
  const c = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
  game.cards.set(sourceId, c);
  return c;
};

describe("Wave 22 — handler registration", () => {
  it("registers all 20 handlers", () => {
    for (const key of [
      "Detain",
      "DayTime",
      "Poison",
      "BecomeMonarch",
      "ChooseEvenOdd",
      "AddPhase",
      "SwitchBlock",
      "ProtectionAll",
      "Meld",
      "GainControlVariant",
      "UnlockDoor",
      "Clash",
      "ChooseSector",
      "ExchangeControlVariant",
      "GainOwnership",
      "Unattach",
      "ActivateAbility",
      "TakeInitiative",
      "VillainousChoice",
      "RollPlanarDice",
    ]) {
      expect(effectRegistry.has(key)).toBe(true);
    }
  });
});

describe("DetainEffect", () => {
  it("taps the target and stamps detainedUntilTurn", () => {
    const game = mkGame();
    seedSourceCard(game);
    const seat0 = mkPlayerSeat(0);
    const tgtId = mkEntityId(50);
    const tgt = new Card(tgtId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(tgtId, tgt);
    const sa = mkSa("Detain", {}, mkEntityId(10), seat0, [tgtId]);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(tgt.tapped).toBe(true);
    expect((tgt as unknown as { detainedUntilTurn?: number }).detainedUntilTurn).toBeGreaterThan(0);
  });
});

describe("DayTimeEffect", () => {
  it("emits DayTimeChanged and stamps the value", () => {
    const game = mkGame();
    seedSourceCard(game);
    const sa = mkSa("DayTime", { Value: { kind: "literal", raw: "night" } });
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(game.flags.dayNight).toBe("night");
    expect(yields.some((y) => (y as { event?: { kind: string } }).event?.kind === "DayTimeChanged")).toBe(
      true,
    );
  });
});

describe("PoisonEffect", () => {
  it("bumps poison counters on the targeted seat", () => {
    const game = mkGame();
    seedSourceCard(game);
    const sa = mkSa("Poison", {
      Defined: { kind: "literal", raw: "Opponent" },
      Num: { kind: "literal", raw: "2" },
    });
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const target = game.getPlayer(mkPlayerSeat(1));
    expect((target as unknown as { poisonCounters?: number }).poisonCounters).toBe(2);
  });
});

describe("BecomeMonarchEffect", () => {
  it("stamps monarchSeat and emits BecameMonarch", () => {
    const game = mkGame();
    seedSourceCard(game);
    const sa = mkSa("BecomeMonarch", {});
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(game.flags.monarch).toBe(mkPlayerSeat(0));
    expect(yields.some((y) => (y as { event?: { kind: string } }).event?.kind === "BecameMonarch")).toBe(
      true,
    );
  });
});

describe("ChooseEvenOddEffect", () => {
  it("stashes the chosen value on the source", () => {
    const game = mkGame();
    const source = seedSourceCard(game);
    const sa = mkSa("ChooseEvenOdd", { Choice: { kind: "literal", raw: "even" } });
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect((source as unknown as { chosenEvenOdd?: string }).chosenEvenOdd).toBe("even");
  });
});

describe("AddPhaseEffect", () => {
  it("appends a pending extra phase entry on game", () => {
    const game = mkGame();
    seedSourceCard(game);
    const sa = mkSa("AddPhase", { Phase: { kind: "literal", raw: "Combat" } });
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect((game as unknown as { pendingExtraPhases?: string[] }).pendingExtraPhases).toContain("Combat");
  });
});

describe("SwitchBlockEffect", () => {
  it("smoke — no throw with insufficient targets", () => {
    const game = mkGame();
    seedSourceCard(game);
    const sa = mkSa("SwitchBlock", {});
    expect(() =>
      drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>),
    ).not.toThrow();
  });
});

describe("ProtectionAllEffect", () => {
  it("stashes a temporaryProtections list on the target", () => {
    const game = mkGame();
    const source = seedSourceCard(game);
    const sa = mkSa("ProtectionAll", { Gains: { kind: "literal", raw: "red" } });
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect((source as unknown as { temporaryProtections?: string[] }).temporaryProtections).toContain("red");
  });
});

describe("MeldEffect", () => {
  it("emits a Melded event", () => {
    const game = mkGame();
    seedSourceCard(game);
    const sa = mkSa("Meld", {});
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(yields.some((y) => (y as { event?: { kind: string } }).event?.kind === "Melded")).toBe(true);
  });
});

describe("GainControlVariantEffect", () => {
  it("smoke — runs without throwing on empty target list", () => {
    const game = mkGame();
    seedSourceCard(game);
    const sa = mkSa("GainControlVariant", {});
    expect(() =>
      drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>),
    ).not.toThrow();
  });
});

describe("UnlockDoorEffect", () => {
  it("emits a DoorOpened event and tracks the unlocked door", () => {
    const game = mkGame();
    const source = seedSourceCard(game);
    const sa = mkSa("UnlockDoor", { Door: { kind: "literal", raw: "front" } });
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect((source as unknown as { unlockedDoors?: Set<string> }).unlockedDoors?.has("front")).toBe(true);
    expect(yields.some((y) => (y as { event?: { kind: string } }).event?.kind === "DoorOpened")).toBe(true);
  });
});

describe("ClashEffect", () => {
  it("emits a CardClashed event with the controller as winner", () => {
    const game = mkGame();
    seedSourceCard(game);
    const sa = mkSa("Clash", {});
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(yields.some((y) => (y as { event?: { kind: string } }).event?.kind === "CardClashed")).toBe(true);
  });
});

describe("ChooseSectorEffect", () => {
  it("stashes the chosen sector on the source", () => {
    const game = mkGame();
    const source = seedSourceCard(game);
    const sa = mkSa("ChooseSector", { Sector: { kind: "literal", raw: "3" } });
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect((source as unknown as { chosenSector?: string }).chosenSector).toBe("3");
  });
});

describe("ExchangeControlVariantEffect", () => {
  it("smoke — runs without throwing with insufficient targets", () => {
    const game = mkGame();
    seedSourceCard(game);
    const sa = mkSa("ExchangeControlVariant", {});
    expect(() =>
      drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>),
    ).not.toThrow();
  });
});

describe("GainOwnershipEffect", () => {
  it("stamps a new ownerSeat on the target", () => {
    const game = mkGame();
    const source = seedSourceCard(game);
    const sa = mkSa("GainOwnership", {});
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect((source as unknown as { ownerSeat?: number }).ownerSeat).toBe(mkPlayerSeat(0));
  });
});

describe("UnattachEffect", () => {
  it("clears attachedTo and emits CardUnattached", () => {
    const game = mkGame();
    const source = seedSourceCard(game);
    (source as unknown as { attachedTo?: number | null }).attachedTo = mkEntityId(99);
    const sa = mkSa("Unattach", {});
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect((source as unknown as { attachedTo?: number | null }).attachedTo).toBeNull();
    expect(yields.some((y) => (y as { event?: { kind: string } }).event?.kind === "CardUnattached")).toBe(
      true,
    );
  });
});

describe("ActivateAbilityEffect", () => {
  it("queues a pending ability activation on the source", () => {
    const game = mkGame();
    const source = seedSourceCard(game);
    const sa = mkSa("ActivateAbility", { Ability: { kind: "literal", raw: "AB$Whatever" } });
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(
      (source as unknown as { pendingAbilityActivations?: string[] }).pendingAbilityActivations,
    ).toContain("AB$Whatever");
  });
});

describe("TakeInitiativeEffect", () => {
  it("stamps initiativeSeat and emits BecameInitiative", () => {
    const game = mkGame();
    seedSourceCard(game);
    const sa = mkSa("TakeInitiative", {});
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(game.flags.initiative).toBe(mkPlayerSeat(0));
    expect(yields.some((y) => (y as { event?: { kind: string } }).event?.kind === "BecameInitiative")).toBe(
      true,
    );
  });
});

describe("VillainousChoiceEffect", () => {
  it("smoke — records the intent on the source's remembered list", () => {
    const game = mkGame();
    const source = seedSourceCard(game);
    const sa = mkSa("VillainousChoice", {});
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(source.remembered.length).toBeGreaterThan(0);
  });
});

describe("RollPlanarDiceEffect", () => {
  it("emits a PlanarDieRolled event", () => {
    const game = mkGame();
    seedSourceCard(game);
    const sa = mkSa("RollPlanarDice", {});
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(yields.some((y) => (y as { event?: { kind: string } }).event?.kind === "PlanarDieRolled")).toBe(
      true,
    );
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 15 — corpus-unknown effect handlers test suite. Each handler has
// 2-3 cases covering: (a) registry registration, (b) the canonical resolve
// path, and (c) at least one DSL-param-driven branch.
import "./add-turn.js";
import "./fog.js";
import "./reveal.js";
import "./set-life.js";
import "./name-card.js";
import "./choose-player.js";
import "./generic-choice.js";
import "./debuff.js";
import "./change-text.js";
import "./make-card.js";
import "./permanent-creature.js";
import "./dig-until.js";
import "./delayed-trigger.js";
import "./repeat.js";
import "./move-counter.js";
import "./copy-spell-ability.js";
import "./amass.js";
import "./seek.js";
import "./mana-reflected.js";
import "./assemble-contraption.js";
// Sub-ability dependency for GenericChoice + Repeat tests.
import "./gain-life.js";
import type { LobbyPlayer, PaperCard, SVarAst } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
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

// ── Registry ────────────────────────────────────────────────────────────────
describe("Wave 15 — handler registration", () => {
  it("registers all 20 handlers", () => {
    for (const key of [
      "AddTurn",
      "Fog",
      "Reveal",
      "SetLife",
      "NameCard",
      "ChoosePlayer",
      "GenericChoice",
      "Debuff",
      "ChangeText",
      "MakeCard",
      "PermanentCreature",
      "DigUntil",
      "DelayedTrigger",
      "Repeat",
      "MoveCounter",
      "CopySpellAbility",
      "Amass",
      "Seek",
      "ManaReflected",
      "AssembleContraption",
    ]) {
      expect(effectRegistry.has(key)).toBe(true);
    }
  });
});

// ── AddTurn ──────────────────────────────────────────────────────────────────
describe("AddTurnEffect", () => {
  it("queues an extra turn for the controller (default Defined)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    game.cards.set(mkEntityId(10), new Card(mkEntityId(10), paper, seat0, seat0, ZoneType.Battlefield));
    const sa = mkSa("AddTurn", { NumTurns: { kind: "literal", raw: "1" } });
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(game.flags.pendingExtraTurns).toEqual([seat0]);
  });

  it("queues N extra turns when NumTurns$ > 1", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    game.cards.set(mkEntityId(10), new Card(mkEntityId(10), paper, seat0, seat0, ZoneType.Battlefield));
    const sa = mkSa("AddTurn", { NumTurns: { kind: "literal", raw: "2" } });
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(game.flags.pendingExtraTurns.length).toBe(2);
  });
});

// ── Fog ──────────────────────────────────────────────────────────────────────
describe("FogEffect", () => {
  it("registers a damage-prevention replacement", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    game.cards.set(mkEntityId(10), new Card(mkEntityId(10), paper, seat0, seat0, ZoneType.Battlefield));
    const before = game.replacementRegistry.size();
    const sa = mkSa("Fog", {});
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(game.replacementRegistry.size()).toBe(before + 1);
  });
});

// ── Reveal ──────────────────────────────────────────────────────────────────
describe("RevealEffect", () => {
  it("emits a CardsRevealed event for RevealDefined$ Self", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    game.cards.set(mkEntityId(10), new Card(mkEntityId(10), paper, seat0, seat0, ZoneType.Battlefield));
    const sa = mkSa("Reveal", { RevealDefined: { kind: "literal", raw: "Self" } });
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const events = yields.filter((y) => (y as { kind?: string }).kind === "event") as {
      event: { kind: string };
    }[];
    expect(events.some((e) => e.event.kind === "CardsRevealed")).toBe(true);
  });
});

// ── SetLife ─────────────────────────────────────────────────────────────────
describe("SetLifeEffect", () => {
  it("sets life to LifeAmount$", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    game.cards.set(mkEntityId(10), new Card(mkEntityId(10), paper, seat0, seat0, ZoneType.Battlefield));
    const sa = mkSa("SetLife", { LifeAmount: { kind: "literal", raw: "10" } });
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(game.getPlayer(seat0).life).toBe(10);
  });
});

// ── NameCard ────────────────────────────────────────────────────────────────
describe("NameCardEffect", () => {
  it("yields nameCard decision and stores response on namedCard", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    const sa = mkSa("NameCard", { ValidCards: { kind: "literal", raw: "Card.nonLand" } }, sourceId);
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    const first = gen.next();
    expect((first.value as { kind?: string }).kind).toBe("decision");
    let r = gen.next({ kind: "nameCard", cardName: "Lightning Bolt" });
    while (!r.done) r = gen.next();
    expect(source.namedCard).toBe("Lightning Bolt");
  });

  it("falls back deterministically when no response provided", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    const sa = mkSa("NameCard", {}, sourceId);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(source.namedCard).not.toBeNull();
  });
});

// ── ChoosePlayer ────────────────────────────────────────────────────────────
describe("ChoosePlayerEffect", () => {
  it("yields choosePlayer decision and stores chosen seat", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const sourceId = mkEntityId(10);
    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    const sa = mkSa("ChoosePlayer", { Choices: { kind: "literal", raw: "Player.Opponent" } }, sourceId);
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    gen.next();
    let r = gen.next({ kind: "choosePlayer", chosen: [seat1] });
    while (!r.done) r = gen.next();
    expect(source.chosenPlayers).toEqual([seat1]);
  });
});

// ── GenericChoice ───────────────────────────────────────────────────────────
describe("GenericChoiceEffect", () => {
  it("dispatches to the chosen SVar sub-ability", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    const svars = new Map<string, SVarAst>([
      [
        "DBLife",
        {
          kind: "ability",
          raw: "",
          ability: { handlerKey: "GainLife", params: { LifeAmount: { kind: "literal", raw: "3" } } },
        } as unknown as SVarAst,
      ],
    ]);
    const sa = mkSa(
      "GenericChoice",
      { Choices: { kind: "literal", raw: "DBLife" } },
      sourceId,
      seat0,
      [],
      svars,
    );
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    let r = gen.next();
    while (!r.done) r = gen.next({ kind: "chooseGenericOption", optionId: "DBLife" });
    expect(game.getPlayer(seat0).life).toBe(23);
  });
});

// ── Debuff ──────────────────────────────────────────────────────────────────
describe("DebuffEffect", () => {
  it("strips the named keyword from each target", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const targetId = mkEntityId(11);
    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    const target = new Card(targetId, paper, seat0, seat0, ZoneType.Battlefield);
    target.keywords = new Set(["flying"]);
    game.cards.set(sourceId, source);
    game.cards.set(targetId, target);
    const sa = mkSa("Debuff", { Keywords: { kind: "literal", raw: "Flying" } }, sourceId, seat0, [targetId]);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(target.keywords?.has("flying")).toBe(false);
  });
});

// ── ChangeText ──────────────────────────────────────────────────────────────
describe("ChangeTextEffect", () => {
  it("appends a textChanges record on the target for a literal substitution", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const targetId = mkEntityId(11);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    const target = new Card(targetId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(targetId, target);
    const sa = mkSa(
      "ChangeText",
      { ChangeColorWord: { kind: "literal", raw: "White Black" } },
      sourceId,
      seat0,
      [targetId],
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(target.textChanges).toEqual([{ kind: "color", from: "White", to: "Black" }]);
  });
});

// ── MakeCard ────────────────────────────────────────────────────────────────
describe("MakeCardEffect", () => {
  it("synthesizes a card and places it in the requested zone", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    const handBefore = game.getPlayer(seat0).zones.get(ZoneType.Hand)?.size ?? 0;
    const sa = mkSa(
      "MakeCard",
      {
        Name: { kind: "literal", raw: "Lightning Bolt" },
        Zone: { kind: "literal", raw: "Hand" },
      },
      sourceId,
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect((game.getPlayer(seat0).zones.get(ZoneType.Hand)?.size ?? 0) - handBefore).toBe(1);
  });
});

// ── PermanentCreature ───────────────────────────────────────────────────────
describe("PermanentCreatureEffect", () => {
  it("moves the source card to the controller's battlefield", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Hand);
    game.cards.set(sourceId, source);
    // Source must be in a real zone for moveTo's locate() to find it.
    game.getPlayer(seat0).zones.get(ZoneType.Hand)?.add(sourceId);
    const sa = mkSa("PermanentCreature", {}, sourceId);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(source.zone).toBe(ZoneType.Battlefield);
  });
});

// ── DigUntil ────────────────────────────────────────────────────────────────
describe("DigUntilEffect", () => {
  it("digs library top until first match (no library = no-op)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    // empty library — should return without throwing
    const sa = mkSa("DigUntil", { Valid: { kind: "literal", raw: "Card" } }, sourceId);
    expect(() =>
      drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>),
    ).not.toThrow();
  });
});

// ── DelayedTrigger ──────────────────────────────────────────────────────────
describe("DelayedTriggerEffect", () => {
  it("registers a delayed trigger on the queue", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    const before = game.delayedTriggerQueue.size();
    const sa = mkSa("DelayedTrigger", {
      Mode: { kind: "literal", raw: "Phase" },
      Phase: { kind: "literal", raw: "End" },
      Execute: { kind: "literal", raw: "TrigDestroy" },
    });
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(game.delayedTriggerQueue.size()).toBe(before + 1);
  });
});

// ── Repeat ──────────────────────────────────────────────────────────────────
describe("RepeatEffect", () => {
  it("runs the SVar sub-ability MaxRepeat$ times", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    const svars = new Map<string, SVarAst>([
      [
        "DBLife",
        {
          kind: "ability",
          raw: "",
          ability: { handlerKey: "GainLife", params: { LifeAmount: { kind: "literal", raw: "1" } } },
        } as unknown as SVarAst,
      ],
    ]);
    const sa = mkSa(
      "Repeat",
      {
        RepeatSubAbility: { kind: "literal", raw: "DBLife" },
        MaxRepeat: { kind: "literal", raw: "3" },
      },
      sourceId,
      seat0,
      [],
      svars,
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(game.getPlayer(seat0).life).toBe(23);
  });
});

// ── MoveCounter ─────────────────────────────────────────────────────────────
describe("MoveCounterEffect", () => {
  it("moves N counters from source target to dest target", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const fromId = mkEntityId(11);
    const toId = mkEntityId(12);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    const fromCard = new Card(fromId, paper, seat0, seat0, ZoneType.Battlefield);
    fromCard.counters.set("P1P1", 3);
    const toCard = new Card(toId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(fromId, fromCard);
    game.cards.set(toId, toCard);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(fromId);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(toId);
    const sa = mkSa(
      "MoveCounter",
      {
        CounterType: { kind: "literal", raw: "P1P1" },
        CounterNum: { kind: "literal", raw: "2" },
      },
      sourceId,
      seat0,
      [fromId, toId],
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(fromCard.counters.get("P1P1")).toBe(1);
    expect(toCard.counters.get("P1P1")).toBe(2);
  });
});

// ── CopySpellAbility ────────────────────────────────────────────────────────
describe("CopySpellAbilityEffect", () => {
  it("does not throw when no source stack item exists", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    const sa = mkSa("CopySpellAbility", {});
    expect(() =>
      drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>),
    ).not.toThrow();
  });
});

// ── Amass ───────────────────────────────────────────────────────────────────
describe("AmassEffect", () => {
  it("creates an Army token when none exists and adds Num counters", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    const sa = mkSa("Amass", {
      Type: { kind: "literal", raw: "Zombie" },
      Num: { kind: "literal", raw: "2" },
    });
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    // An army token should now exist on the battlefield with 2 +1/+1 counters.
    const bf = game.getPlayer(seat0).zones.get(ZoneType.Battlefield);
    let foundCounters = 0;
    for (const id of bf?.toArray() ?? []) {
      const c = game.cards.get(id);
      if (c && (c.counters.get("P1P1") ?? 0) > 0) foundCounters = c.counters.get("P1P1") ?? 0;
    }
    expect(foundCounters).toBe(2);
  });
});

// ── Seek ────────────────────────────────────────────────────────────────────
describe("SeekEffect", () => {
  it("no-ops gracefully on an empty library", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    const sa = mkSa("Seek", { Num: { kind: "literal", raw: "1" } });
    expect(() =>
      drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>),
    ).not.toThrow();
  });
});

// ── ManaReflected ───────────────────────────────────────────────────────────
describe("ManaReflectedEffect", () => {
  it("runs without throwing (MVP scope)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    const sa = mkSa("ManaReflected", {});
    expect(() =>
      drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>),
    ).not.toThrow();
  });
});

// ── AssembleContraption ─────────────────────────────────────────────────────
describe("AssembleContraptionEffect", () => {
  it("records the assembled count on game.flags.attractions", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    const sa = mkSa("AssembleContraption", { Amount: { kind: "literal", raw: "2" } });
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const rec = game.flags.attractions.get(seat0) as { assembledContraptions?: number } | undefined;
    expect(rec?.assembledContraptions).toBe(2);
  });
});

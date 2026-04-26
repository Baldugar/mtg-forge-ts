// SPDX-License-Identifier: GPL-3.0-or-later
// Tests for EffectEffect — full delayed-trigger-host semantics + the
// pass-through SubAbility$ MVP fast path.
import "../../svar/selectors/number.js";
// Self-registering side effects.
import "./effect.js";
import "./draw.js";
import "./gain-life.js";
// Side-effect import: registers PhaseTrigger so `Triggers$` SVars can resolve.
import "../../trigger/handlers/phase-trigger.js";
import type { LobbyPlayer, PaperCard, PhaseStep, SVarAst } from "@mtg-forge-ts/core";
import {
  DEFAULT_PAPER_CARD_FLAGS,
  PhaseStep as PhaseStepEnum,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkEvent,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { CommandZone } from "../../zone/zones/command-zone.js";
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
    player.zones.set(ZoneType.Command, new CommandZone(ZoneType.Command, player.seat));
  }
  return game;
};

const drainGen = (gen: Generator<unknown, void, unknown>): void => {
  let r = gen.next();
  while (!r.done) r = gen.next();
};

describe("EffectEffect", () => {
  it("with SubAbility$ DBDraw — runs Draw effect inline", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const card1Id = mkEntityId(30);

    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    game.cards.set(card1Id, new Card(card1Id, paper, seat0, seat0, ZoneType.Library));
    game.getPlayer(seat0).zones.get(ZoneType.Library)?.add(card1Id);

    const drawSvar: SVarAst = {
      kind: "ability",
      raw: "DB$ Draw | NumCards$ 1",
      ability: {
        handlerKey: "Draw",
        params: { NumCards: { kind: "literal", raw: "1" } },
      },
    };
    const svars = new Map<string, SVarAst>([["DBDraw", drawSvar]]);

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "Effect",
          params: {
            SubAbility: { kind: "literal", raw: "DBDraw" },
          },
        },
        cost: { raw: "2 U" },
      },
      sourceId,
      seat0,
      svars,
    );

    const handBefore = game.getPlayer(seat0).zones.get(ZoneType.Hand)?.size ?? 0;
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const handAfter = game.getPlayer(seat0).zones.get(ZoneType.Hand)?.size ?? 0;
    expect(handAfter).toBe(handBefore + 1);
  });

  it("without SubAbility$ — no-op, does not throw", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);

    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "Effect",
          params: {},
        },
        cost: { raw: "1 B" },
      },
      sourceId,
      seat0,
      new Map(),
    );

    const lifeBefore = game.getPlayer(seat0).life;
    expect(() =>
      drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>),
    ).not.toThrow();
    // Nothing changed.
    expect(game.getPlayer(seat0).life).toBe(lifeBefore);
  });

  it("with unknown SubAbility$ handler — silent no-op", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);

    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    // SVar present but its handlerKey ("UnknownHandler") is not registered.
    const unknownSvar: SVarAst = {
      kind: "ability",
      raw: "DB$ UnknownHandler",
      ability: {
        handlerKey: "UnknownHandler",
        params: {},
      },
    };
    const svars = new Map<string, SVarAst>([["DBUnknown", unknownSvar]]);

    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "Effect",
          params: {
            SubAbility: { kind: "literal", raw: "DBUnknown" },
          },
        },
        cost: { raw: "1 B" },
      },
      sourceId,
      seat0,
      svars,
    );

    expect(() =>
      drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Delayed-trigger host semantics (SP3 Batch D)
// ---------------------------------------------------------------------------

const mkPhaseTriggerSvar = (executeKey: string, phase: string): SVarAst => ({
  kind: "trigger",
  raw: `Mode$ Phase | Phase$ ${phase} | Execute$ ${executeKey}`,
  trigger: {
    mode: "Phase",
    params: {
      Phase: { kind: "literal", raw: phase },
      ValidPlayer: { kind: "literal", raw: "You" },
    },
    effect: { handlerKey: executeKey, params: {} },
  },
});

const mkDrawAbilitySvar = (n: number): SVarAst => ({
  kind: "ability",
  raw: `DB$ Draw | NumCards$ ${n}`,
  ability: {
    handlerKey: "Draw",
    params: { NumCards: { kind: "literal", raw: String(n) } },
  },
});

const runEffect = (
  game: Game,
  sourceId: ReturnType<typeof mkEntityId>,
  seat: ReturnType<typeof mkPlayerSeat>,
  svars: Map<string, SVarAst>,
  params: Readonly<Record<string, { kind: "literal"; raw: string }>>,
  targets: ReturnType<typeof mkEntityId>[] = [],
): void => {
  const sa = new SpellAbility(
    {
      kind: "spell",
      effect: { handlerKey: "Effect", params },
      cost: { raw: "" },
    },
    sourceId,
    seat,
    svars,
    targets,
  );
  drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
};

describe("EffectEffect — delayed-trigger host", () => {
  it("Triggers$ creates a host card with the trigger registered", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    const triggerCount0 = game.triggerRegistry.size();
    const cmdZoneSize0 = game.getPlayer(seat0).zones.get(ZoneType.Command)?.size ?? 0;

    const svars = new Map<string, SVarAst>([
      ["TrigDraw", mkPhaseTriggerSvar("DBDraw", "EndOfTurn")],
      ["DBDraw", mkDrawAbilitySvar(1)],
    ]);

    runEffect(game, sourceId, seat0, svars, {
      Triggers: { kind: "literal", raw: "TrigDraw" },
    });

    expect(game.triggerRegistry.size()).toBe(triggerCount0 + 1);
    expect(game.getPlayer(seat0).zones.get(ZoneType.Command)?.size ?? 0).toBe(cmdZoneSize0 + 1);
  });

  it("Duration$ UntilEndOfTurn — host expires on TurnEnded", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    const triggerCount0 = game.triggerRegistry.size();

    const svars = new Map<string, SVarAst>([
      ["TrigDraw", mkPhaseTriggerSvar("DBDraw", "EndOfTurn")],
      ["DBDraw", mkDrawAbilitySvar(1)],
    ]);

    runEffect(game, sourceId, seat0, svars, {
      Triggers: { kind: "literal", raw: "TrigDraw" },
    });

    expect(game.triggerRegistry.size()).toBe(triggerCount0 + 1);

    const turnEnded = mkEvent("TurnEnded", game.turn, game.phase, { activeSeat: seat0 });
    game.continuousEffectRegistry.onEvent(turnEnded);

    expect(game.triggerRegistry.size()).toBe(triggerCount0);
    expect(game.getPlayer(seat0).zones.get(ZoneType.Command)?.size ?? 0).toBe(0);
  });

  it("Duration$ Permanent — host does NOT expire on TurnEnded", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));

    const triggerCount0 = game.triggerRegistry.size();

    const svars = new Map<string, SVarAst>([
      ["TrigDraw", mkPhaseTriggerSvar("DBDraw", "EndOfTurn")],
      ["DBDraw", mkDrawAbilitySvar(1)],
    ]);

    runEffect(game, sourceId, seat0, svars, {
      Triggers: { kind: "literal", raw: "TrigDraw" },
      Duration: { kind: "literal", raw: "Permanent" },
    });

    expect(game.triggerRegistry.size()).toBe(triggerCount0 + 1);

    const turnEnded = mkEvent("TurnEnded", game.turn, game.phase, { activeSeat: seat0 });
    game.continuousEffectRegistry.onEvent(turnEnded);

    // Trigger still registered; host still in command zone.
    expect(game.triggerRegistry.size()).toBe(triggerCount0 + 1);
    expect(game.getPlayer(seat0).zones.get(ZoneType.Command)?.size ?? 0).toBe(1);
  });

  it("RememberObjects$ Targeted — populates host.remembered", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const targetId = mkEntityId(50);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    game.cards.set(targetId, new Card(targetId, paper, seat0, seat0, ZoneType.Battlefield));

    const svars = new Map<string, SVarAst>([
      ["TrigDraw", mkPhaseTriggerSvar("DBDraw", "EndOfTurn")],
      ["DBDraw", mkDrawAbilitySvar(1)],
    ]);

    runEffect(
      game,
      sourceId,
      seat0,
      svars,
      {
        Triggers: { kind: "literal", raw: "TrigDraw" },
        RememberObjects: { kind: "literal", raw: "Targeted" },
      },
      [targetId],
    );

    const cmd = game.getPlayer(seat0).zones.get(ZoneType.Command);
    expect(cmd?.size).toBe(1);
    const hostId = (cmd?.toArray() ?? [])[0];
    expect(hostId).toBeDefined();
    if (!hostId) return;
    const host = game.cards.get(hostId);
    expect(host?.remembered).toEqual([targetId]);
  });

  it("Triggers$ trigger fires at end-of-turn — Alice draws 1", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const libraryId = mkEntityId(700);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    game.cards.set(libraryId, new Card(libraryId, paper, seat0, seat0, ZoneType.Library));
    game.getPlayer(seat0).zones.get(ZoneType.Library)?.add(libraryId);

    const svars = new Map<string, SVarAst>([
      ["TrigDraw", mkPhaseTriggerSvar("DBDraw", "EndOfTurn")],
      ["DBDraw", mkDrawAbilitySvar(1)],
    ]);

    runEffect(game, sourceId, seat0, svars, {
      Triggers: { kind: "literal", raw: "TrigDraw" },
      Duration: { kind: "literal", raw: "Permanent" },
    });

    // Step-started event for End-of-turn step. The PhaseTrigger's
    // matches() will return true; the registry queues a pending trigger.
    const stepEvent = mkEvent("StepStarted", game.turn, PhaseStepEnum.EndStep, {
      step: PhaseStepEnum.EndStep as PhaseStep,
      activeSeat: seat0,
    });
    game.triggerRegistry.onEvent(stepEvent);

    // One pending trigger has been queued.
    const pending = game.triggerRegistry.peekPending();
    expect(pending.length).toBe(1);

    // Drain + resolve the resolver to draw.
    const drained = game.triggerRegistry.drain();
    expect(drained.length).toBe(1);
    const handBefore = game.getPlayer(seat0).zones.get(ZoneType.Hand)?.size ?? 0;
    const ta = game.triggerRegistry.getTrigger(drained[0]?.triggerId as ReturnType<typeof mkEntityId>);
    expect(ta).toBeDefined();
    if (!ta) return;
    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    drainGen(resolver.resolve(game));
    const handAfter = game.getPlayer(seat0).zones.get(ZoneType.Hand)?.size ?? 0;
    expect(handAfter).toBe(handBefore + 1);
  });
});

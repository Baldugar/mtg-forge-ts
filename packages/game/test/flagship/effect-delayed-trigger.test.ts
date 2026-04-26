// SPDX-License-Identifier: GPL-3.0-or-later
// Flagship: SP$ Effect with a delayed Phase trigger (end-of-turn draw).
// Validates the SP3 Batch D upgrade — EffectEffect synthesizes a hidden
// command-zone host card carrying a Phase trigger (drawn from an SVar),
// the trigger fires when the End step's StepStarted event flows through
// the registry, and the host tears down at TurnEnded under the default
// Duration$ UntilEndOfTurn semantics.
//
// This test wires the registries directly rather than relying on a parsed
// card so it can verify the delayed-trigger-host scaffold in isolation
// from the SP3 DSL parser (whose Triggers$/SVar trigger emission lands in
// a later wave).
import type { EntityId, LobbyPlayer, PaperCard, PhaseStep, PlayerSeat, SVarAst } from "@mtg-forge-ts/core";
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
import { SpellAbility } from "../../src/ability/spell-ability.js";
import { Card } from "../../src/card.js";
import type { GameMeta } from "../../src/game-meta.js";
import type { GameRules } from "../../src/game-rules.js";
import { Game } from "../../src/game.js";
import { Battlefield } from "../../src/zone/zones/battlefield.js";
import { CommandZone } from "../../src/zone/zones/command-zone.js";
import { Graveyard } from "../../src/zone/zones/graveyard.js";
import { Hand } from "../../src/zone/zones/hand.js";
import { Library } from "../../src/zone/zones/library.js";

// Self-register all effects.
import "../../src/ability/effects/index.js";
// Register cost parts (effect drainer compatibility).
import "../../src/cost/parts/index.js";
// SVar number selectors.
import "../../src/svar/selectors/number.js";
// Self-register PhaseTrigger so the host's Triggers$ resolves to a real handler.
import "../../src/trigger/handlers/phase-trigger.js";

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

const filler: PaperCard = {
  name: "Filler",
  edition: "T",
  collectorNumber: "0",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const makeGame = () => {
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

const seedSourceCard = (game: Game, seat: PlayerSeat, id: EntityId): Card => {
  const card = new Card(id, filler, seat, seat, ZoneType.Battlefield);
  game.cards.set(id, card);
  return card;
};

const seedLibraryCard = (game: Game, seat: PlayerSeat, id: EntityId): Card => {
  const card = new Card(id, filler, seat, seat, ZoneType.Library);
  game.cards.set(id, card);
  game.getPlayer(seat).zones.get(ZoneType.Library)?.add(id);
  return card;
};

describe("Flagship: SP$ Effect — delayed end-of-turn draw trigger", () => {
  it("creates a host with a Phase trigger; trigger fires on EndStep; host expires at end of turn", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(9000);
    seedSourceCard(game, seat0, sourceId);
    seedLibraryCard(game, seat0, mkEntityId(9100));

    // SVars wire the trigger and the draw ability the trigger executes.
    // Equivalent Forge text:
    //   A:SP$ Effect | Triggers$ TrigDelayedDraw
    //   SVar:TrigDelayedDraw:Mode$ Phase | Phase$ EndOfTurn | Execute$ DBDraw1
    //   SVar:DBDraw1:DB$ Draw | NumCards$ 1
    const svars = new Map<string, SVarAst>([
      [
        "TrigDelayedDraw",
        {
          kind: "trigger",
          raw: "Mode$ Phase | Phase$ EndOfTurn | Execute$ DBDraw1 | ValidPlayer$ You",
          trigger: {
            mode: "Phase",
            params: {
              Phase: { kind: "literal", raw: "EndOfTurn" },
              ValidPlayer: { kind: "literal", raw: "You" },
            },
            effect: { handlerKey: "DBDraw1", params: {} },
          },
        },
      ],
      [
        "DBDraw1",
        {
          kind: "ability",
          raw: "DB$ Draw | NumCards$ 1",
          ability: {
            handlerKey: "Draw",
            params: { NumCards: { kind: "literal", raw: "1" } },
          },
        },
      ],
    ]);

    // Resolve the Effect ability — should mint a host with the trigger.
    const triggerCount0 = game.triggerRegistry.size();
    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "Effect",
          params: { Triggers: { kind: "literal", raw: "TrigDelayedDraw" } },
        },
        cost: { raw: "" },
      },
      sourceId,
      seat0,
      svars,
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    // 1) Host present in the command zone; trigger registered.
    const cmd = game.getPlayer(seat0).zones.get(ZoneType.Command);
    expect(cmd?.size).toBe(1);
    expect(game.triggerRegistry.size()).toBe(triggerCount0 + 1);

    // 2) Fire the EndStep StepStarted event — trigger queues a pending entry.
    const stepEvent = mkEvent("StepStarted", game.turn, PhaseStepEnum.EndStep, {
      step: PhaseStepEnum.EndStep as PhaseStep,
      activeSeat: seat0,
    });
    game.triggerRegistry.onEvent(stepEvent);
    const pending = game.triggerRegistry.peekPending();
    expect(pending.length).toBe(1);

    // 3) Resolve the pending trigger — Alice draws a card.
    const drained = game.triggerRegistry.drain();
    const ta = game.triggerRegistry.getTrigger(drained[0]?.triggerId as EntityId);
    expect(ta).toBeDefined();
    if (!ta) return;

    const handBefore = game.getPlayer(seat0).zones.get(ZoneType.Hand)?.size ?? 0;
    const resolver = (
      ta as unknown as {
        resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> };
      }
    ).resolver;
    drainGen(resolver.resolve(game));
    const handAfter = game.getPlayer(seat0).zones.get(ZoneType.Hand)?.size ?? 0;
    expect(handAfter).toBe(handBefore + 1);

    // 4) TurnEnded fires the duration cleanup hook — host gone, trigger gone.
    const turnEnded = mkEvent("TurnEnded", game.turn, game.phase, { activeSeat: seat0 });
    game.continuousEffectRegistry.onEvent(turnEnded);

    expect(game.getPlayer(seat0).zones.get(ZoneType.Command)?.size).toBe(0);
    expect(game.triggerRegistry.size()).toBe(triggerCount0);
  });
});

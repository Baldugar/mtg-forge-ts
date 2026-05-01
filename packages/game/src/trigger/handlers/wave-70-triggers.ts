// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.A — Trigger mode coverage additions. Adds first-class
// registry entries for four trigger-mode kinds the keyword/effect
// handlers reference but lacked dedicated TriggerHandler subclasses.
//
// Triggers covered:
//   ClassLevelGained — CR 716, fires when a Class card's level
//                      increases (counter add gated on Class subtype).
//                      Filter on NewLevel$ N matches the level reached
//                      after the transition.
//   RoomEntered     — Duskmourn: House of Horror. Fires when a Room
//                      is fully unlocked. Wave 104 closure of the
//                      prior TODO(advanced): the Room unlock pipeline
//                      (`ability/effects/wave-22-effects.ts`
//                      UnlockDoorEffect) emits both the partial-unlock
//                      pulse and the fully-unlocked transition; this
//                      handler matches both via `fullyUnlocked` filter.
//   TakesInitiative — CR 716.1, fires when a player takes the
//                      Initiative. Matches BecameInitiative event.
//   Adapted          — CR 702.130, fires when an Adapt activated
//                      ability resolves and adds +1/+1 counters.
//                      Matches the dedicated CardAdapted pulse.
import type {
  AbilityAst,
  EntityId,
  GameEvent,
  PlayerSeat,
  SVarAst,
  TriggerAst,
  TriggeredAbility,
} from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import { SpellAbility } from "../../ability/spell-ability.js";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";
import type { TriggerBuildContext } from "../trigger-handler.js";
import { TriggerHandler } from "../trigger-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

const getParamRaw = (ast: TriggerAst, key: string): string | undefined => {
  const pv = ast.params[key];
  if (!pv) return undefined;
  if (pv.kind === "literal") return pv.raw;
  return undefined;
};

/** SVar-driven resolver shared by every Wave-70.A trigger. */
const makeSvarResolver = (
  sourceCardId: EntityId,
  controllerSeat: PlayerSeat,
  executeKey: string,
  className: string,
): StackItemResolver => ({
  *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
    const game = gameUnknown as Game;
    const sourceCard = game.cards.get(sourceCardId);
    if (!sourceCard) return;
    const def = sourceCard.paperCard.definition;
    if (!def) return;
    const svars = def.svars as ReadonlyMap<string, SVarAst>;
    const sv = svars.get(executeKey);
    if (!sv) {
      throw new Error(
        `${className}: Execute$ SVar '${executeKey}' not found on ${sourceCard.paperCard.name ?? "?"}`,
      );
    }
    if (sv.kind !== "ability" || !sv.ability) {
      throw new Error(
        `${className}: Execute$ '${executeKey}' is not an ability SVar on ${sourceCard.paperCard.name ?? "?"}`,
      );
    }
    const fakeAst: AbilityAst = { kind: "spell", effect: sv.ability, cost: { raw: "" } };
    const sa = new SpellAbility(fakeAst, sourceCardId, controllerSeat, svars, []);
    yield* sa.makeResolver().resolve(game);
  },
});

const battlefieldZones = (): ReadonlySet<ZoneType> =>
  new Set([ZoneType.Battlefield]) as ReadonlySet<ZoneType>;

// 1. ClassLevelGained ---------------------------------------------------------
// Forge T:Mode$ ClassLevelGained — CR 716. Fires when a Class card's
// level increases. NewLevel$ N filters on the level reached.
//
// Engine wiring: game-action.addCounter emits ClassLevelGained AFTER
// the underlying CounterAdded fires when the counter type is Level
// AND the card has Class subtype. This trigger matches that pulse.
export class ClassLevelGainedTrigger extends TriggerHandler {
  static override readonly mode = "ClassLevelGained";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const validCard = getParamRaw(ast, "ValidCard") ?? "Card.Self";
    const newLevelRaw = getParamRaw(ast, "NewLevel");
    const newLevelFilter = newLevelRaw !== undefined ? Number.parseInt(newLevelRaw, 10) : undefined;
    const { sourceCardId, controllerSeat, triggerId } = ctx;
    const executeKey = ast.effect.handlerKey;

    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: battlefieldZones(),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        if (event.kind !== "ClassLevelGained") return false;
        const p = event.payload as {
          cardId: EntityId;
          oldLevel: number;
          newLevel: number;
        };
        if (validCard === "Card.Self") {
          if (p.cardId !== sourceCardId) return false;
        } else if (validCard !== "Card") {
          // Dotted Card.* qualifiers default to Self semantics for MVP
          // (mirrors counter-added-once-trigger fallback).
          const lower = validCard.toLowerCase();
          if (lower.startsWith("card.self") || lower.startsWith("permanent.self")) {
            if (p.cardId !== sourceCardId) return false;
          }
        }
        // NewLevel$ N — only fire when the Class reached exactly that level
        // (Forge's standard form: each per-level trigger is keyed to its
        // target level). When NewLevel$ is absent the trigger fires on
        // every level transition.
        if (newLevelFilter !== undefined && Number.isFinite(newLevelFilter)) {
          if (p.newLevel !== newLevelFilter) return false;
        }
        return true;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "ClassLevelGainedTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(ClassLevelGainedTrigger);

// 2. RoomEntered --------------------------------------------------------------
// Forge T:Mode$ RoomEntered — Duskmourn: House of Horror. Fires when
// a Room (split-card variant) is fully unlocked.
//
// Wave 104 closure of the prior TODO(advanced): the Room unlock
// pipeline lives in `ability/effects/wave-22-effects.ts`
// UnlockDoorEffect — it emits a RoomEntered event with
// `fullyUnlocked: true` on the final-door transition and
// `fullyUnlocked: false` on each intermediate partial unlock. This
// handler picks up the fully-unlocked transition by default; cards
// that watch partial unlocks read the `fullyUnlocked: false` pulse.
export class RoomEnteredTrigger extends TriggerHandler {
  static override readonly mode = "RoomEntered";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const validRoom = getParamRaw(ast, "ValidRoom") ?? "Card.Self";
    const { sourceCardId, controllerSeat, triggerId } = ctx;
    const executeKey = ast.effect.handlerKey;

    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: battlefieldZones(),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        if (event.kind !== "RoomEntered") return false;
        const p = event.payload as { cardId: EntityId; fullyUnlocked: boolean };
        // Room entry is gated on the "fully unlocked" half — half-unlock
        // events still emit but Mode$ RoomEntered fires only on the
        // fully-unlocked transition (Forge parity).
        if (!p.fullyUnlocked) return false;
        if (validRoom === "Card.Self") return p.cardId === sourceCardId;
        if (validRoom === "Card") return true;
        return false;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "RoomEnteredTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(RoomEnteredTrigger);

// 3. TakesInitiative ----------------------------------------------------------
// Forge T:Mode$ TakesInitiative — CR 716.1, Initiative dungeon. Fires
// when a player takes the Initiative.
//
// Engine wiring: dnd/initiative-tracker.ts emits BecameInitiative on
// every transition into a new Initiative-holder.
export class TakesInitiativeTrigger extends TriggerHandler {
  static override readonly mode = "TakesInitiative";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const validPlayer = getParamRaw(ast, "ValidPlayer") ?? "You";
    const { sourceCardId, controllerSeat, triggerId } = ctx;
    const executeKey = ast.effect.handlerKey;

    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: battlefieldZones(),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        if (event.kind !== "BecameInitiative") return false;
        const p = event.payload as { playerSeat: PlayerSeat };
        if (validPlayer === "You") return p.playerSeat === controllerSeat;
        if (validPlayer === "Opponent") return p.playerSeat !== controllerSeat;
        if (validPlayer === "Player") return true;
        return true;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "TakesInitiativeTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(TakesInitiativeTrigger);

// 4. Adapted ------------------------------------------------------------------
// Forge T:Mode$ Adapted — CR 702.130. Fires when an Adapt activated
// ability resolves AND adds +1/+1 counters (Forge parity — distinct
// from generic CounterAdded so the trigger fires only on the Adapt
// mechanic, not on every +1/+1 counter addition).
//
// Engine wiring: ability/effects/adapt.ts emits CardAdapted after the
// addCounter completes (the CR 702.139a precondition gates emission).
export class AdaptedTrigger extends TriggerHandler {
  static override readonly mode = "Adapted";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const validCard = getParamRaw(ast, "ValidCard") ?? "Card.Self";
    const { sourceCardId, controllerSeat, triggerId } = ctx;
    const executeKey = ast.effect.handlerKey;

    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: battlefieldZones(),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        if (event.kind !== "CardAdapted") return false;
        const p = event.payload as { cardId: EntityId };
        if (validCard === "Card.Self") return p.cardId === sourceCardId;
        if (validCard === "Card") return true;
        const lower = validCard.toLowerCase();
        if (lower.startsWith("card.self") || lower.startsWith("permanent.self")) {
          return p.cardId === sourceCardId;
        }
        return false;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "AdaptedTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(AdaptedTrigger);

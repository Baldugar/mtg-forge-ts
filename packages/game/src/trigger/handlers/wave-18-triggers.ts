// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 18 — corpus-unknown trigger handlers (12 entries). Each handler
// matches its dedicated game event and resolves the Execute$ SVar via the
// canonical SVar-driven path. Where the trigger uses a once-per-turn or
// "secondary" semantic (TokenCreatedOnce, AttackerBlockedOnce), the handler
// shares the underlying event with the primary trigger and adds a per-turn
// guard.
//
// Triggers covered:
//   Mentored, TokenCreatedOnce, BecomesPlotted, SearchedLibrary,
//   ElementalBend, PayCumulativeUpkeep, FullyUnlock, Countered, Exerted,
//   Enlisted, AttackerBlockedOnce, SpellAbilityCast.
import type {
  AbilityAst,
  EntityId,
  GameEvent,
  GameEventKind,
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

/** Build the SVar-driven resolver shared by every Wave-18 trigger. */
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

// 1. Mentored -----------------------------------------------------------------
export class MentoredTrigger extends TriggerHandler {
  static override readonly mode = "Mentored";

  override build(_ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const { sourceCardId, controllerSeat, triggerId } = ctx;
    const executeKey = _ast.effect.handlerKey;
    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: battlefieldZones(),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        return event.kind === "Mentored";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "MentoredTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(MentoredTrigger);

// 2. TokenCreatedOnce ---------------------------------------------------------
// Once-per-turn variant of TokenCreated. Tracks last-fired turn on a closure-
// scoped slot so subsequent emissions in the same turn are suppressed.
export class TokenCreatedOnceTrigger extends TriggerHandler {
  static override readonly mode = "TokenCreatedOnce";

  override build(_ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const { sourceCardId, controllerSeat, triggerId, game } = ctx;
    const executeKey = _ast.effect.handlerKey;
    let lastFiredTurn = -1;
    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: battlefieldZones(),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        if (event.kind !== "TokenCreated") return false;
        const t = game.turn;
        if (lastFiredTurn === t) return false;
        lastFiredTurn = t;
        return true;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "TokenCreatedOnceTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(TokenCreatedOnceTrigger);

// 3. BecomesPlotted -----------------------------------------------------------
// Bloomburrow Plot mechanic — fires when the source becomes plotted.
export class BecomesPlottedTrigger extends TriggerHandler {
  static override readonly mode = "BecomesPlotted";

  override build(_ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const { sourceCardId, controllerSeat, triggerId } = ctx;
    const executeKey = _ast.effect.handlerKey;
    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([ZoneType.Battlefield, ZoneType.Hand, ZoneType.Exile]) as ReadonlySet<ZoneType>,
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        if (event.kind !== "CardPlotted") return false;
        const p = event.payload as { cardId: EntityId };
        return p.cardId === sourceCardId;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "BecomesPlottedTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(BecomesPlottedTrigger);

// 4. SearchedLibrary ----------------------------------------------------------
export class SearchedLibraryTrigger extends TriggerHandler {
  static override readonly mode = "SearchedLibrary";

  override build(_ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const { sourceCardId, controllerSeat, triggerId } = ctx;
    const executeKey = _ast.effect.handlerKey;
    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: battlefieldZones(),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        return event.kind === "SearchedLibrary";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "SearchedLibraryTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(SearchedLibraryTrigger);

// 5. ElementalBend ------------------------------------------------------------
export class ElementalBendTrigger extends TriggerHandler {
  static override readonly mode = "ElementalBend";

  override build(_ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const { sourceCardId, controllerSeat, triggerId } = ctx;
    const executeKey = _ast.effect.handlerKey;
    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: battlefieldZones(),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        return event.kind === "ElementalBend";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "ElementalBendTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(ElementalBendTrigger);

// 6. PayCumulativeUpkeep ------------------------------------------------------
export class PayCumulativeUpkeepTrigger extends TriggerHandler {
  static override readonly mode = "PayCumulativeUpkeep";

  override build(_ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const { sourceCardId, controllerSeat, triggerId } = ctx;
    const executeKey = _ast.effect.handlerKey;
    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: battlefieldZones(),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        if (event.kind !== "PayCumulativeUpkeep") return false;
        const p = event.payload as { cardId: EntityId };
        return p.cardId === sourceCardId;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "PayCumulativeUpkeepTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(PayCumulativeUpkeepTrigger);

// 7. FullyUnlock --------------------------------------------------------------
// Outlaws of Thunder Junction / Duskmourn Room mechanic. Fires when ALL
// doors on the source are unlocked. Wave 98 — gates on the source card's
// `fullyUnlocked` flag, which UnlockDoorEffect transitions exactly once
// per Room (the partial-unlock pulse leaves the flag false; the final
// door-open flips it to true and emits the DoorOpened event we observe
// here). Reading the flag inside the matcher is the canonical "last
// unlock only" semantics — earlier door-opens fail the gate because the
// flag is still false at observation time, only the door-open that
// completes the room sees `fullyUnlocked === true`. Single-door rooms
// (most OTJ doors) trivially fully-unlock on their lone open, so the
// trigger fires on that one event.
export class FullyUnlockTrigger extends TriggerHandler {
  static override readonly mode = "FullyUnlock";

  override build(_ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const { game, sourceCardId, controllerSeat, triggerId } = ctx;
    const executeKey = _ast.effect.handlerKey;
    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: battlefieldZones(),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        if (event.kind !== "DoorOpened") return false;
        const p = event.payload as { cardId?: EntityId };
        if (p.cardId !== sourceCardId) return false;
        // CR 702.166 (OTJ) / Duskmourn Room — fire only on the door-open
        // that completes the room. UnlockDoorEffect adds the freshly-
        // opened door to `card.unlockedDoors` BEFORE yielding the
        // DoorOpened event, so the set observed here always includes the
        // current door. The room is fully unlocked iff every entry in
        // `printedDoors` is in `unlockedDoors`. Single-door rooms (most
        // OTJ doors) trivially satisfy this on the lone open. Two-door
        // Duskmourn rooms only fire on the second open. Defaulting
        // `printedDoors` to ["front", "back"] mirrors UnlockDoorEffect's
        // own fallback so the two implementations stay aligned.
        const card = game.cards.get(sourceCardId);
        const probe = card as unknown as
          | { unlockedDoors?: Set<string>; printedDoors?: readonly string[] }
          | undefined;
        const open = probe?.unlockedDoors;
        if (!(open instanceof Set) || open.size === 0) return false;
        const printed = probe?.printedDoors ?? ["front", "back"];
        for (const d of printed) {
          if (!open.has(d)) return false;
        }
        return true;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "FullyUnlockTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(FullyUnlockTrigger);

// 8. Countered ----------------------------------------------------------------
export class CounteredTrigger extends TriggerHandler {
  static override readonly mode = "Countered";

  override build(_ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const { sourceCardId, controllerSeat, triggerId } = ctx;
    const executeKey = _ast.effect.handlerKey;
    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([
        ZoneType.Battlefield,
        ZoneType.Stack,
        ZoneType.Hand,
        ZoneType.Graveyard,
      ]) as ReadonlySet<ZoneType>,
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        return event.kind === "StackItemCountered";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "CounteredTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(CounteredTrigger);

// 9. Exerted ------------------------------------------------------------------
export class ExertedTrigger extends TriggerHandler {
  static override readonly mode = "Exerted";

  override build(_ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const { sourceCardId, controllerSeat, triggerId } = ctx;
    const executeKey = _ast.effect.handlerKey;
    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: battlefieldZones(),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        return event.kind === "Exerted";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "ExertedTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(ExertedTrigger);

// 10. Enlisted ----------------------------------------------------------------
export class EnlistedTrigger extends TriggerHandler {
  static override readonly mode = "Enlisted";

  override build(_ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const { sourceCardId, controllerSeat, triggerId } = ctx;
    const executeKey = _ast.effect.handlerKey;
    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: battlefieldZones(),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        return event.kind === "Enlisted";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "EnlistedTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(EnlistedTrigger);

// 11. AttackerBlockedOnce -----------------------------------------------------
export class AttackerBlockedOnceTrigger extends TriggerHandler {
  static override readonly mode = "AttackerBlockedOnce";

  override build(_ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const { sourceCardId, controllerSeat, triggerId, game } = ctx;
    const executeKey = _ast.effect.handlerKey;
    let lastFiredTurn = -1;
    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: battlefieldZones(),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        if (event.kind !== "AttackerBecomesBlocked") return false;
        const t = game.turn;
        if (lastFiredTurn === t) return false;
        lastFiredTurn = t;
        return true;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "AttackerBlockedOnceTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(AttackerBlockedOnceTrigger);

// 12. SpellAbilityCast --------------------------------------------------------
// Fires on EITHER a spell or an activated ability cast — superset of
// SpellCast and AbilityActivated. Companion to SpellCastOrCopy from Wave 16.
export class SpellAbilityCastTrigger extends TriggerHandler {
  static override readonly mode = "SpellAbilityCast";

  override build(_ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const { sourceCardId, controllerSeat, triggerId } = ctx;
    const executeKey = _ast.effect.handlerKey;
    const interesting: ReadonlySet<GameEventKind> = new Set<GameEventKind>(["SpellCast", "AbilityActivated"]);
    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: battlefieldZones(),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        return interesting.has(event.kind);
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "SpellAbilityCastTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(SpellAbilityCastTrigger);

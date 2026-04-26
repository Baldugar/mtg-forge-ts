// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 19 — final corpus-unknown trigger handlers (20 entries). Each handler
// matches its dedicated game event and resolves the Execute$ SVar via the
// canonical SVar-driven path. Mirrors the Wave 18 structure.
//
// Triggers covered:
//   DiscardedAll, CounterAddedAll, CounterRemovedOnce, UnlockDoor,
//   DayTimeChanges, ManaAdded, AbilityTriggered, ExcessDamage, CounterAdded,
//   LifeLost, Surveil, LosesGame, Abandoned, RolledDieOnce, DamageAll,
//   SacrificedOnce, Saddled, Crewed, Unattach, CaseSolved.
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

/** Build the SVar-driven resolver shared by every Wave-19 trigger. */
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

const battlefieldOrCommandZones = (): ReadonlySet<ZoneType> =>
  new Set([ZoneType.Battlefield, ZoneType.Command]) as ReadonlySet<ZoneType>;

// 1. DiscardedAll -------------------------------------------------------------
export class DiscardedAllTrigger extends TriggerHandler {
  static override readonly mode = "DiscardedAll";

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
        return event.kind === "DiscardedAll";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "DiscardedAllTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(DiscardedAllTrigger);

// 2. CounterAddedAll ----------------------------------------------------------
// Fires once per CounterAdded batch (board-wide proliferate sweep).
export class CounterAddedAllTrigger extends TriggerHandler {
  static override readonly mode = "CounterAddedAll";

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
        return event.kind === "CounterAdded";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "CounterAddedAllTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(CounterAddedAllTrigger);

// 3. CounterRemovedOnce -------------------------------------------------------
export class CounterRemovedOnceTrigger extends TriggerHandler {
  static override readonly mode = "CounterRemovedOnce";

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
        if (event.kind !== "CounterRemoved") return false;
        const t = game.turn;
        if (lastFiredTurn === t) return false;
        lastFiredTurn = t;
        return true;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "CounterRemovedOnceTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(CounterRemovedOnceTrigger);

// 4. UnlockDoor ---------------------------------------------------------------
// Outlaws of Thunder Junction Door mechanic — fires when a door is unlocked
// (one of multiple). Distinct from FullyUnlock (Wave 18) which fires only on
// the LAST unlock.
export class UnlockDoorTrigger extends TriggerHandler {
  static override readonly mode = "UnlockDoor";

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
        if (event.kind !== "DoorOpened") return false;
        const p = event.payload as { cardId?: EntityId };
        return p.cardId === sourceCardId;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "UnlockDoorTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(UnlockDoorTrigger);

// 5. DayTimeChanges -----------------------------------------------------------
export class DayTimeChangesTrigger extends TriggerHandler {
  static override readonly mode = "DayTimeChanges";

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
        return event.kind === "DayTimeChanged";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "DayTimeChangesTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(DayTimeChangesTrigger);

// 6. ManaAdded ----------------------------------------------------------------
export class ManaAddedTrigger extends TriggerHandler {
  static override readonly mode = "ManaAdded";

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
        return event.kind === "ManaAdded";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "ManaAddedTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(ManaAddedTrigger);

// 7. AbilityTriggered ---------------------------------------------------------
// Meta-trigger — fires when ANOTHER trigger triggers. Rare (Strionic Resonator-
// like cards observe these via copy-target gates rather than dedicated mode).
export class AbilityTriggeredTrigger extends TriggerHandler {
  static override readonly mode = "AbilityTriggered";

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
        return event.kind === "AbilityTriggered";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "AbilityTriggeredTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(AbilityTriggeredTrigger);

// 8. ExcessDamage -------------------------------------------------------------
// CR 120.4 — fires on excess damage (damage beyond the target's remaining
// toughness or life total).
export class ExcessDamageTrigger extends TriggerHandler {
  static override readonly mode = "ExcessDamage";

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
        return event.kind === "ExcessDamage";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "ExcessDamageTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(ExcessDamageTrigger);

// 9. CounterAdded -------------------------------------------------------------
// Per-counter-add variant. Distinct from CounterAddedAll only in semantics
// at engine emit time; runtime match is the same.
export class CounterAddedTrigger extends TriggerHandler {
  static override readonly mode = "CounterAdded";

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
        return event.kind === "CounterAdded";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "CounterAddedTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(CounterAddedTrigger);

// 10. LifeLost ----------------------------------------------------------------
export class LifeLostTrigger extends TriggerHandler {
  static override readonly mode = "LifeLost";

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
        if (event.kind === "LifeLost") return true;
        if (event.kind === "LifeChanged") {
          const p = event.payload as { delta: number };
          return p.delta < 0;
        }
        return false;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "LifeLostTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(LifeLostTrigger);

// 11. Surveil -----------------------------------------------------------------
export class SurveilTrigger extends TriggerHandler {
  static override readonly mode = "Surveil";

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
        return event.kind === "Surveil";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "SurveilTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(SurveilTrigger);

// 12. LosesGame ---------------------------------------------------------------
// Active in Command + Battlefield so commander/emblem effects can observe.
export class LosesGameTrigger extends TriggerHandler {
  static override readonly mode = "LosesGame";

  override build(_ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const { sourceCardId, controllerSeat, triggerId } = ctx;
    const executeKey = _ast.effect.handlerKey;
    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: battlefieldOrCommandZones(),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        return event.kind === "PlayerLost";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "LosesGameTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(LosesGameTrigger);

// 13. Abandoned ---------------------------------------------------------------
// Archenemy — fires when a scheme is abandoned.
export class AbandonedTrigger extends TriggerHandler {
  static override readonly mode = "Abandoned";

  override build(_ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const { sourceCardId, controllerSeat, triggerId } = ctx;
    const executeKey = _ast.effect.handlerKey;
    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: battlefieldOrCommandZones(),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        return event.kind === "Abandoned";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "AbandonedTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(AbandonedTrigger);

// 14. RolledDieOnce -----------------------------------------------------------
// Once-per-turn variant of RolledDie.
export class RolledDieOnceTrigger extends TriggerHandler {
  static override readonly mode = "RolledDieOnce";

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
        if (event.kind !== "RollDie") return false;
        const t = game.turn;
        if (lastFiredTurn === t) return false;
        lastFiredTurn = t;
        return true;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "RolledDieOnceTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(RolledDieOnceTrigger);

// 15. DamageAll ---------------------------------------------------------------
// Fires when a single source deals damage to multiple targets at once.
export class DamageAllTrigger extends TriggerHandler {
  static override readonly mode = "DamageAll";

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
        return event.kind === "DamageDealtAll";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "DamageAllTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(DamageAllTrigger);

// 16. SacrificedOnce ----------------------------------------------------------
export class SacrificedOnceTrigger extends TriggerHandler {
  static override readonly mode = "SacrificedOnce";

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
        if (event.kind !== "CardSacrificed") return false;
        const t = game.turn;
        if (lastFiredTurn === t) return false;
        lastFiredTurn = t;
        return true;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "SacrificedOnceTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(SacrificedOnceTrigger);

// 17. Saddled -----------------------------------------------------------------
// Outlaws of Thunder Junction Mount mechanic.
export class SaddledTrigger extends TriggerHandler {
  static override readonly mode = "Saddled";

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
        if (event.kind !== "Saddled") return false;
        const p = event.payload as { mountId: EntityId };
        return p.mountId === sourceCardId;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "SaddledTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(SaddledTrigger);

// 18. Crewed ------------------------------------------------------------------
// Kaladesh Vehicle mechanic.
export class CrewedTrigger extends TriggerHandler {
  static override readonly mode = "Crewed";

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
        if (event.kind !== "Crewed") return false;
        const p = event.payload as { vehicleId: EntityId };
        return p.vehicleId === sourceCardId;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "CrewedTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(CrewedTrigger);

// 19. Unattach ----------------------------------------------------------------
// Fires when an Aura/Equipment unattaches from its target.
export class UnattachTrigger extends TriggerHandler {
  static override readonly mode = "Unattach";

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
        return event.kind === "CardUnattached";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "UnattachTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(UnattachTrigger);

// 20. CaseSolved --------------------------------------------------------------
// Murders at Karlov Manor.
export class CaseSolvedTrigger extends TriggerHandler {
  static override readonly mode = "CaseSolved";

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
        if (event.kind !== "CaseSolved") return false;
        const p = event.payload as { cardId: EntityId };
        return p.cardId === sourceCardId;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "CaseSolvedTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(CaseSolvedTrigger);

// 21. FlippedCoin -------------------------------------------------------------
// Forge T:Mode$ FlippedCoin — fires after a coin flip resolves. Matches the
// engine's FlipCoin event regardless of result; ValidPlayer$ optional gates
// who flipped. Cards: Mana Clash, Goblin Bookie, etc.
export class FlippedCoinTrigger extends TriggerHandler {
  static override readonly mode = "FlippedCoin";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const { sourceCardId, controllerSeat, triggerId } = ctx;
    const executeKey = ast.effect.handlerKey;
    const validPlayer = ast.params.ValidPlayer?.kind === "literal" ? ast.params.ValidPlayer.raw : "Each";
    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: battlefieldZones(),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        if (event.kind !== "FlipCoin") return false;
        const p = event.payload as { playerSeat: PlayerSeat };
        if (validPlayer === "You" && p.playerSeat !== controllerSeat) return false;
        if (
          (validPlayer === "Opponent" || validPlayer === "Player.Opponent") &&
          p.playerSeat === controllerSeat
        )
          return false;
        return true;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "FlippedCoinTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(FlippedCoinTrigger);

// 22. Destroyed ---------------------------------------------------------------
// Forge T:Mode$ Destroyed — fires when a card is destroyed (not just any
// graveyard entry; specifically a destroy mutation). Matches CardDestroyed
// event. Cards: cards with "when ~ is destroyed" wording.
export class DestroyedTrigger extends TriggerHandler {
  static override readonly mode = "Destroyed";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const { sourceCardId, controllerSeat, triggerId } = ctx;
    const executeKey = ast.effect.handlerKey;
    const validCard = ast.params.ValidCard?.kind === "literal" ? ast.params.ValidCard.raw : "Card.Self";
    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: battlefieldZones(),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        if (event.kind !== "CardDestroyed") return false;
        const p = event.payload as { cardId: EntityId };
        if (validCard === "Card.Self") return p.cardId === sourceCardId;
        return true; // permissive for non-Self filters; advanced ValidCard$ deferred
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "DestroyedTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(DestroyedTrigger);

// 23. ChangesController -------------------------------------------------------
// Forge T:Mode$ ChangesController — fires when a card changes controller
// (Mind Control, Threaten, etc.). Matches CardControllerChanged event added
// alongside this handler.
export class ChangesControllerTrigger extends TriggerHandler {
  static override readonly mode = "ChangesController";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const { sourceCardId, controllerSeat, triggerId } = ctx;
    const executeKey = ast.effect.handlerKey;
    const validCard = ast.params.ValidCard?.kind === "literal" ? ast.params.ValidCard.raw : "Card.Self";
    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: battlefieldZones(),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        if (event.kind !== "CardControllerChanged") return false;
        const p = event.payload as { cardId: EntityId };
        if (validCard === "Card.Self") return p.cardId === sourceCardId;
        return true;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "ChangesControllerTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(ChangesControllerTrigger);

// 24. Exploited ---------------------------------------------------------------
// Khans-of-Tarkir Mardu Exploit mechanic — when an exploit creature ETBs you
// may sacrifice another creature; the exploit trigger then fires. Matches
// CardExploited event added alongside this handler.
export class ExploitedTrigger extends TriggerHandler {
  static override readonly mode = "Exploited";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const { sourceCardId, controllerSeat, triggerId } = ctx;
    const executeKey = ast.effect.handlerKey;
    const validCard = ast.params.ValidCard?.kind === "literal" ? ast.params.ValidCard.raw : "Card.Self";
    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: battlefieldZones(),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        if (event.kind !== "CardExploited") return false;
        const p = event.payload as { exploiterCardId: EntityId };
        if (validCard === "Card.Self") return p.exploiterCardId === sourceCardId;
        return true;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "ExploitedTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(ExploitedTrigger);

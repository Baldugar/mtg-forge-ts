// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 22 — corpus final long-tail trigger handlers (14 entries). Each handler
// matches its dedicated game event and resolves the Execute$ SVar via the
// canonical SVar-driven path. Mirrors the Wave 21 structure.
//
// Triggers covered:
//   ExcessDamageAll, Championed, Stationed, VisitAttraction, FightOnce,
//   ManifestDread, Trains, DamagePreventedOnce, PayEcho, BecomesSaddled,
//   UntapAll, ClaimPrize, PhaseOutAll, BlockersDeclared.
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

/** Build the SVar-driven resolver shared by every Wave-22 trigger. */
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

// 1. ExcessDamageAll ----------------------------------------------------------
// Forge T:Mode$ ExcessDamageAll — group form of ExcessDamage; fires when one
// or more permanents take excess damage in a single sweep. MVP: matches every
// ExcessDamage event (engine-side aggregation is SP4 follow-up).
export class ExcessDamageAllTrigger extends TriggerHandler {
  static override readonly mode = "ExcessDamageAll";

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
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "ExcessDamageAllTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(ExcessDamageAllTrigger);

// 2. Championed ---------------------------------------------------------------
// Forge T:Mode$ Championed (Lorwyn) — fires when a creature is championed.
export class ChampionedTrigger extends TriggerHandler {
  static override readonly mode = "Championed";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
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
        return event.kind === "CardChampioned";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "ChampionedTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(ChampionedTrigger);

// 3. Stationed ----------------------------------------------------------------
// Forge T:Mode$ Stationed (Aetherdrift) — fires when a creature is stationed
// on a Vehicle/Spacecraft.
export class StationedTrigger extends TriggerHandler {
  static override readonly mode = "Stationed";

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
        if (event.kind !== "CardStationed") return false;
        const p = event.payload as { vehicleId: EntityId };
        if (validCard === "Card.Self") return p.vehicleId === sourceCardId;
        return true;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "StationedTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(StationedTrigger);

// 4. VisitAttraction ----------------------------------------------------------
// Forge T:Mode$ VisitAttraction (Unfinity) — fires when a player visits an
// Attraction.
export class VisitAttractionTrigger extends TriggerHandler {
  static override readonly mode = "VisitAttraction";

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
        return event.kind === "AttractionVisited";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "VisitAttractionTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(VisitAttractionTrigger);

// 5. FightOnce ----------------------------------------------------------------
// Forge T:Mode$ FightOnce — once-per-turn variant of Fight.
export class FightOnceTrigger extends TriggerHandler {
  static override readonly mode = "FightOnce";

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
        if (event.kind !== "FightFought") return false;
        const t = game.turn;
        if (lastFiredTurn === t) return false;
        lastFiredTurn = t;
        return true;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "FightOnceTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(FightOnceTrigger);

// 6. ManifestDread (trigger form) --------------------------------------------
// Forge T:Mode$ ManifestDread (Duskmourn) — fires when a creature manifest
// dreads (a face-down creature is revealed via the dread mechanic). MVP:
// matches the existing CardChangedZone Library->Battlefield path with
// cause="manifest-dread".
export class ManifestDreadTrigger extends TriggerHandler {
  static override readonly mode = "ManifestDread";

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
        if (event.kind !== "CardChangedZone") return false;
        const p = event.payload as { toZone: ZoneType; cause?: string };
        return p.toZone === ZoneType.Battlefield && p.cause === "manifest-dread";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "ManifestDreadTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(ManifestDreadTrigger);

// 7. Trains -------------------------------------------------------------------
// Forge T:Mode$ Trains (Bloomburrow) — fires when a creature trains.
export class TrainsTrigger extends TriggerHandler {
  static override readonly mode = "Trains";

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
        if (event.kind !== "CardTrained") return false;
        const p = event.payload as { cardId: EntityId };
        if (validCard === "Card.Self") return p.cardId === sourceCardId;
        return true;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "TrainsTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(TrainsTrigger);

// 8. DamagePreventedOnce ------------------------------------------------------
// Forge T:Mode$ DamagePreventedOnce — once-per-turn variant of DamagePrevented.
export class DamagePreventedOnceTrigger extends TriggerHandler {
  static override readonly mode = "DamagePreventedOnce";

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
        if (event.kind !== "DamagePrevented") return false;
        const t = game.turn;
        if (lastFiredTurn === t) return false;
        lastFiredTurn = t;
        return true;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "DamagePreventedOnceTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(DamagePreventedOnceTrigger);

// 9. PayEcho ------------------------------------------------------------------
// Forge T:Mode$ PayEcho (CR 702.29) — fires when a card's echo cost is paid.
// MVP: matches the existing PayCumulativeUpkeep event (echo is a sibling
// cumulative-upkeep variant).
export class PayEchoTrigger extends TriggerHandler {
  static override readonly mode = "PayEcho";

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
        if (event.kind !== "PayCumulativeUpkeep") return false;
        const p = event.payload as { cardId: EntityId };
        if (validCard === "Card.Self") return p.cardId === sourceCardId;
        return true;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "PayEchoTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(PayEchoTrigger);

// 10. BecomesSaddled ----------------------------------------------------------
// Forge T:Mode$ BecomesSaddled (Outlaws of Thunder Junction) — fires when a
// Mount becomes saddled. MVP: matches the existing Saddled event.
export class BecomesSaddledTrigger extends TriggerHandler {
  static override readonly mode = "BecomesSaddled";

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
        if (event.kind !== "Saddled") return false;
        const p = event.payload as { mountId: EntityId };
        if (validCard === "Card.Self") return p.mountId === sourceCardId;
        return true;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "BecomesSaddledTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(BecomesSaddledTrigger);

// 11. UntapAll ----------------------------------------------------------------
// Forge T:Mode$ UntapAll — fires once per "untap all" batch.
export class UntapAllTrigger extends TriggerHandler {
  static override readonly mode = "UntapAll";

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
        return event.kind === "CardsUntappedAll";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "UntapAllTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(UntapAllTrigger);

// 12. ClaimPrize --------------------------------------------------------------
// Forge T:Mode$ ClaimPrize (Unfinity) — fires when a player claims a prize.
export class ClaimPrizeTrigger extends TriggerHandler {
  static override readonly mode = "ClaimPrize";

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
        return event.kind === "PrizeClaimed";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "ClaimPrizeTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(ClaimPrizeTrigger);

// 13. PhaseOutAll -------------------------------------------------------------
// Forge T:Mode$ PhaseOutAll — group form of PhaseOut; fires whenever any
// permanent phases out. MVP: matches every CardPhasedOut event.
export class PhaseOutAllTrigger extends TriggerHandler {
  static override readonly mode = "PhaseOutAll";

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
        return event.kind === "CardPhasedOut" || event.kind === "PhasedOut";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "PhaseOutAllTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(PhaseOutAllTrigger);

// 14. BlockersDeclared (group form) -------------------------------------------
// Forge T:Mode$ BlockersDeclared — fires once when blockers are declared.
// Distinct from per-card "WhenBlocks" triggers.
export class BlockersDeclaredTrigger extends TriggerHandler {
  static override readonly mode = "BlockersDeclared";

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
        return event.kind === "BlockersDeclared";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "BlockersDeclaredTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(BlockersDeclaredTrigger);

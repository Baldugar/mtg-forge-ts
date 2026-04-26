// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 21 — corpus long-tail trigger handlers (20 entries). Each handler
// matches its dedicated game event and resolves the Execute$ SVar via the
// canonical SVar-driven path. Mirrors the Wave 19/20 structure.
//
// Triggers covered:
//   Investigated, PhaseOut, CollectEvidence, Milled, MilledOnce, Exiled,
//   AbilityResolves, CounterTypeAddedAll, BecomeRenowned, Evolved,
//   ConjureAll, Forage, AttackerUnblockedOnce, TapAll, Foretell, Fight,
//   PayLife, SpellAbilityCopy, GiveGift, Devoured.
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

/** Build the SVar-driven resolver shared by every Wave-21 trigger. */
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

// 1. Investigated -------------------------------------------------------------
export class InvestigatedTrigger extends TriggerHandler {
  static override readonly mode = "Investigated";

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
        return event.kind === "CardInvestigated";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "InvestigatedTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(InvestigatedTrigger);

// 2. PhaseOut -----------------------------------------------------------------
export class PhaseOutTrigger extends TriggerHandler {
  static override readonly mode = "PhaseOut";

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
        if (event.kind !== "CardPhasedOut") return false;
        const p = event.payload as { cardId: EntityId };
        if (validCard === "Card.Self") return p.cardId === sourceCardId;
        return true;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "PhaseOutTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(PhaseOutTrigger);

// 3. CollectEvidence ----------------------------------------------------------
export class CollectEvidenceTrigger extends TriggerHandler {
  static override readonly mode = "CollectEvidence";

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
        return event.kind === "EvidenceCollected";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "CollectEvidenceTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(CollectEvidenceTrigger);

// 4. Milled -------------------------------------------------------------------
export class MilledTrigger extends TriggerHandler {
  static override readonly mode = "Milled";

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
        return event.kind === "CardMilled";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "MilledTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(MilledTrigger);

// 5. MilledOnce ---------------------------------------------------------------
export class MilledOnceTrigger extends TriggerHandler {
  static override readonly mode = "MilledOnce";

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
        if (event.kind !== "CardMilled" && event.kind !== "CardMilledOnce") return false;
        const t = game.turn;
        if (lastFiredTurn === t) return false;
        lastFiredTurn = t;
        return true;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "MilledOnceTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(MilledOnceTrigger);

// 6. Exiled -------------------------------------------------------------------
export class ExiledTrigger extends TriggerHandler {
  static override readonly mode = "Exiled";

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
        if (event.kind === "CardExiled") {
          const p = event.payload as { cardId: EntityId };
          if (validCard === "Card.Self") return p.cardId === sourceCardId;
          return true;
        }
        if (event.kind === "CardChangedZone") {
          const p = event.payload as { cardId: EntityId; toZone: ZoneType };
          if (p.toZone !== ZoneType.Exile) return false;
          if (validCard === "Card.Self") return p.cardId === sourceCardId;
          return true;
        }
        return false;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "ExiledTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(ExiledTrigger);

// 7. AbilityResolves ----------------------------------------------------------
export class AbilityResolvesTrigger extends TriggerHandler {
  static override readonly mode = "AbilityResolves";

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
        return event.kind === "AbilityResolved";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "AbilityResolvesTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(AbilityResolvesTrigger);

// 8. CounterTypeAddedAll ------------------------------------------------------
export class CounterTypeAddedAllTrigger extends TriggerHandler {
  static override readonly mode = "CounterTypeAddedAll";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const { sourceCardId, controllerSeat, triggerId } = ctx;
    const executeKey = ast.effect.handlerKey;
    const wantType = ast.params.CounterType?.kind === "literal" ? ast.params.CounterType.raw : null;
    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: battlefieldZones(),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        if (event.kind === "CounterTypeAddedAll") {
          if (wantType === null) return true;
          const p = event.payload as { counterType: string };
          return p.counterType === wantType;
        }
        if (event.kind === "CounterAdded") {
          if (wantType === null) return true;
          const p = event.payload as { counterType: string };
          return p.counterType === wantType;
        }
        return false;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "CounterTypeAddedAllTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(CounterTypeAddedAllTrigger);

// 9. BecomeRenowned -----------------------------------------------------------
export class BecomeRenownedTrigger extends TriggerHandler {
  static override readonly mode = "BecomeRenowned";

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
        if (event.kind !== "CardBecameRenowned") return false;
        const p = event.payload as { cardId: EntityId };
        if (validCard === "Card.Self") return p.cardId === sourceCardId;
        return true;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "BecomeRenownedTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(BecomeRenownedTrigger);

// 10. Evolved -----------------------------------------------------------------
export class EvolvedTrigger extends TriggerHandler {
  static override readonly mode = "Evolved";

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
        if (event.kind !== "CardEvolved") return false;
        const p = event.payload as { cardId: EntityId };
        if (validCard === "Card.Self") return p.cardId === sourceCardId;
        return true;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "EvolvedTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(EvolvedTrigger);

// 11. ConjureAll --------------------------------------------------------------
export class ConjureAllTrigger extends TriggerHandler {
  static override readonly mode = "ConjureAll";

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
        return event.kind === "CardConjuredAll";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "ConjureAllTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(ConjureAllTrigger);

// 12. Forage ------------------------------------------------------------------
export class ForageTrigger extends TriggerHandler {
  static override readonly mode = "Forage";

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
        return event.kind === "CardForage";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "ForageTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(ForageTrigger);

// 13. AttackerUnblockedOnce --------------------------------------------------
export class AttackerUnblockedOnceTrigger extends TriggerHandler {
  static override readonly mode = "AttackerUnblockedOnce";

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
        if (event.kind !== "AttackerUnblockedOnce" && event.kind !== "AttackerUnblocked") return false;
        const t = game.turn;
        if (lastFiredTurn === t) return false;
        lastFiredTurn = t;
        return true;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "AttackerUnblockedOnceTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(AttackerUnblockedOnceTrigger);

// 14. TapAll ------------------------------------------------------------------
export class TapAllTrigger extends TriggerHandler {
  static override readonly mode = "TapAll";

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
        return event.kind === "CardsTappedAll";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "TapAllTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(TapAllTrigger);

// 15. Foretell ----------------------------------------------------------------
export class ForetellTrigger extends TriggerHandler {
  static override readonly mode = "Foretell";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const { sourceCardId, controllerSeat, triggerId } = ctx;
    const executeKey = ast.effect.handlerKey;
    const validCard = ast.params.ValidCard?.kind === "literal" ? ast.params.ValidCard.raw : "Card.Self";
    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      // Foretell is exile-zone — observe from Hand + Exile + Battlefield.
      activeInZones: new Set([ZoneType.Hand, ZoneType.Exile, ZoneType.Battlefield]) as ReadonlySet<ZoneType>,
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        if (event.kind !== "CardForetoldExiled" && event.kind !== "CardForetold") return false;
        const p = event.payload as { cardId: EntityId };
        if (validCard === "Card.Self") return p.cardId === sourceCardId;
        return true;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "ForetellTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(ForetellTrigger);

// 16. Fight -------------------------------------------------------------------
export class FightTrigger extends TriggerHandler {
  static override readonly mode = "Fight";

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
        return event.kind === "FightFought";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "FightTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(FightTrigger);

// 17. PayLife -----------------------------------------------------------------
export class PayLifeTrigger extends TriggerHandler {
  static override readonly mode = "PayLife";

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
        return event.kind === "LifePaid";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "PayLifeTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(PayLifeTrigger);

// 18. SpellAbilityCopy --------------------------------------------------------
export class SpellAbilityCopyTrigger extends TriggerHandler {
  static override readonly mode = "SpellAbilityCopy";

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
        return (
          event.kind === "SpellAbilityCopied" ||
          event.kind === "SpellCopied" ||
          event.kind === "StackItemCopied"
        );
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "SpellAbilityCopyTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(SpellAbilityCopyTrigger);

// 19. GiveGift ----------------------------------------------------------------
export class GiveGiftTrigger extends TriggerHandler {
  static override readonly mode = "GiveGift";

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
        return event.kind === "GiftPromised";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "GiveGiftTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(GiveGiftTrigger);

// 20. Devoured ----------------------------------------------------------------
export class DevouredTrigger extends TriggerHandler {
  static override readonly mode = "Devoured";

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
        if (event.kind !== "CreatureDevoured") return false;
        const p = event.payload as { devourerId: EntityId };
        if (validCard === "Card.Self") return p.devourerId === sourceCardId;
        return true;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "DevouredTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(DevouredTrigger);

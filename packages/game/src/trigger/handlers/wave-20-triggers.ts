// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 20 — corpus long-tail trigger handlers (20 entries). Each handler
// matches its dedicated game event and resolves the Execute$ SVar via the
// canonical SVar-driven path. Mirrors the Wave 19 structure.
//
// Triggers covered:
//   Specializes (47), Proliferate (7), SpellCopy (6), Clashed (6),
//   Explores (6), NewGame (5), BecomesCrewed (5), PlaneswalkedFrom (5),
//   Shuffled (4), BecomeMonarch (4), DungeonCompleted (4), PhaseIn (4),
//   PlanarDice (4), Vote (3), BecomesTargetOnce (3), SeekAll (3),
//   MilledAll (3), TokenCreated (3), Discover (2), LifeLostAll (2).
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

/** Build the SVar-driven resolver shared by every Wave-20 trigger. */
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

// 1. Specializes ---------------------------------------------------------------
// March of the Machine — fires when a creature specializes (transforms into
// one of five colored variants).
export class SpecializesTrigger extends TriggerHandler {
  static override readonly mode = "Specializes";

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
        if (event.kind !== "CardSpecialized") return false;
        const p = event.payload as { cardId: EntityId };
        if (validCard === "Card.Self") return p.cardId === sourceCardId;
        return true;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "SpecializesTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(SpecializesTrigger);

// 2. Proliferate ---------------------------------------------------------------
// Fires after a proliferate sweep resolves.
export class ProliferateTrigger extends TriggerHandler {
  static override readonly mode = "Proliferate";

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
        return event.kind === "Proliferated";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "ProliferateTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(ProliferateTrigger);

// 3. SpellCopy -----------------------------------------------------------------
// Fires when a spell on the stack is copied.
export class SpellCopyTrigger extends TriggerHandler {
  static override readonly mode = "SpellCopy";

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
        return event.kind === "SpellCopied" || event.kind === "StackItemCopied";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "SpellCopyTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(SpellCopyTrigger);

// 4. Clashed -------------------------------------------------------------------
// Mirage / Lorwyn — fires when two players clash.
export class ClashedTrigger extends TriggerHandler {
  static override readonly mode = "Clashed";

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
        return event.kind === "CardClashed";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "ClashedTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(ClashedTrigger);

// 5. Explores ------------------------------------------------------------------
// Ixalan Explore — fires when a creature explores.
export class ExploresTrigger extends TriggerHandler {
  static override readonly mode = "Explores";

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
        if (event.kind !== "CardExplored") return false;
        const p = event.payload as { cardId: EntityId };
        if (validCard === "Card.Self") return p.cardId === sourceCardId;
        return true;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "ExploresTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(ExploresTrigger);

// 6. NewGame -------------------------------------------------------------------
// Fires once at the start of a new game.
export class NewGameTrigger extends TriggerHandler {
  static override readonly mode = "NewGame";

  override build(_ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const { sourceCardId, controllerSeat, triggerId } = ctx;
    const executeKey = _ast.effect.handlerKey;
    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      // Pre-game / commander-zone — observe from Command + Library.
      activeInZones: new Set([
        ZoneType.Command,
        ZoneType.Library,
        ZoneType.Battlefield,
      ]) as ReadonlySet<ZoneType>,
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        return event.kind === "NewGameStarted" || event.kind === "GameStarted";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "NewGameTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(NewGameTrigger);

// 7. BecomesCrewed -------------------------------------------------------------
// State-change variant of Crewed (Wave 19) — fires when a Vehicle becomes
// crewed. Distinct from Crewed in that BecomesCrewed observes the
// state-machine transition (was-not-crewed -> is-crewed), not the
// activation that caused it.
export class BecomesCrewedTrigger extends TriggerHandler {
  static override readonly mode = "BecomesCrewed";

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
        if (event.kind === "CardBecameCrewed") {
          const p = event.payload as { vehicleId: EntityId };
          return p.vehicleId === sourceCardId;
        }
        if (event.kind === "Crewed") {
          const p = event.payload as { vehicleId: EntityId };
          return p.vehicleId === sourceCardId;
        }
        return false;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "BecomesCrewedTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(BecomesCrewedTrigger);

// 8. PlaneswalkedFrom ---------------------------------------------------------
// Planechase — fires when a player planeswalks AWAY from a plane.
export class PlaneswalkedFromTrigger extends TriggerHandler {
  static override readonly mode = "PlaneswalkedFrom";

  override build(_ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const { sourceCardId, controllerSeat, triggerId } = ctx;
    const executeKey = _ast.effect.handlerKey;
    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([ZoneType.Command]) as ReadonlySet<ZoneType>,
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        if (event.kind !== "PlaneswalkedFrom") return false;
        const p = event.payload as { planeCardId: EntityId };
        return p.planeCardId === sourceCardId;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "PlaneswalkedFromTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(PlaneswalkedFromTrigger);

// 9. Shuffled ------------------------------------------------------------------
// Fires when a player's library is shuffled.
export class ShuffledTrigger extends TriggerHandler {
  static override readonly mode = "Shuffled";

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
        return event.kind === "LibraryShuffled" || event.kind === "Shuffle";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "ShuffledTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(ShuffledTrigger);

// 10. BecomeMonarch -----------------------------------------------------------
// Fires when a player becomes the monarch.
export class BecomeMonarchTrigger extends TriggerHandler {
  static override readonly mode = "BecomeMonarch";

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
        return event.kind === "BecameMonarch";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "BecomeMonarchTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(BecomeMonarchTrigger);

// 11. DungeonCompleted --------------------------------------------------------
// Adventures into the Forgotten Realms.
export class DungeonCompletedTrigger extends TriggerHandler {
  static override readonly mode = "DungeonCompleted";

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
        return event.kind === "DungeonCompleted";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "DungeonCompletedTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(DungeonCompletedTrigger);

// 12. PhaseIn -----------------------------------------------------------------
// Fires when a permanent phases in.
export class PhaseInTrigger extends TriggerHandler {
  static override readonly mode = "PhaseIn";

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
        if (event.kind !== "PhasedIn") return false;
        const p = event.payload as { cardId: EntityId };
        if (validCard === "Card.Self") return p.cardId === sourceCardId;
        return true;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "PhaseInTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(PhaseInTrigger);

// 13. PlanarDice --------------------------------------------------------------
// Fires when a planar die is rolled (any face). For chaos-only see
// ChaosEnsuesTrigger (Wave 9).
export class PlanarDiceTrigger extends TriggerHandler {
  static override readonly mode = "PlanarDice";

  override build(_ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const { sourceCardId, controllerSeat, triggerId } = ctx;
    const executeKey = _ast.effect.handlerKey;
    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([ZoneType.Command, ZoneType.Battlefield]) as ReadonlySet<ZoneType>,
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        return event.kind === "PlanarDieRolled";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "PlanarDiceTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(PlanarDiceTrigger);

// 14. Vote --------------------------------------------------------------------
// Conspiracy / Council's Dilemma — fires when a vote is performed.
export class VoteTrigger extends TriggerHandler {
  static override readonly mode = "Vote";

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
        return event.kind === "VotePerformed";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "VoteTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(VoteTrigger);

// 15. BecomesTargetOnce -------------------------------------------------------
// Once-per-turn variant of BecomesTarget.
export class BecomesTargetOnceTrigger extends TriggerHandler {
  static override readonly mode = "BecomesTargetOnce";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const { sourceCardId, controllerSeat, triggerId, game } = ctx;
    const executeKey = ast.effect.handlerKey;
    const validCard = ast.params.ValidCard?.kind === "literal" ? ast.params.ValidCard.raw : "Card.Self";
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
        if (event.kind !== "CardTargeted") return false;
        const p = event.payload as { targetId: EntityId };
        if (validCard === "Card.Self" && p.targetId !== sourceCardId) return false;
        const t = game.turn;
        if (lastFiredTurn === t) return false;
        lastFiredTurn = t;
        return true;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "BecomesTargetOnceTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(BecomesTargetOnceTrigger);

// 16. SeekAll -----------------------------------------------------------------
// Fires once per "seek" batch (player seeks one or more cards).
export class SeekAllTrigger extends TriggerHandler {
  static override readonly mode = "SeekAll";

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
        return event.kind === "CardSeekedAll";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "SeekAllTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(SeekAllTrigger);

// 17. MilledAll ---------------------------------------------------------------
// Fires once per mill batch (group of cards milled simultaneously).
export class MilledAllTrigger extends TriggerHandler {
  static override readonly mode = "MilledAll";

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
        return event.kind === "CardMilledAll" || event.kind === "PlayerMilled";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "MilledAllTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(MilledAllTrigger);

// 18. TokenCreated ------------------------------------------------------------
// Fires when a token is created (Forge T:Mode$ TokenCreated).
export class TokenCreatedTrigger extends TriggerHandler {
  static override readonly mode = "TokenCreated";

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
        return event.kind === "CardCreatedToken" || event.kind === "TokenCreated";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "TokenCreatedTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(TokenCreatedTrigger);

// 19. Discover ----------------------------------------------------------------
// Lost Caverns of Ixalan — fires when a card is discovered.
export class DiscoverTrigger extends TriggerHandler {
  static override readonly mode = "Discover";

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
        return event.kind === "CardDiscovered";
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "DiscoverTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(DiscoverTrigger);

// 20. LifeLostAll -------------------------------------------------------------
// Fires once per life-loss batch (multiple players lose simultaneously).
export class LifeLostAllTrigger extends TriggerHandler {
  static override readonly mode = "LifeLostAll";

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
        if (event.kind === "PlayerLifeLostAll") return true;
        if (event.kind === "LifeLost") return true;
        return false;
      },
      resolver: makeSvarResolver(sourceCardId, controllerSeat, executeKey, "LifeLostAllTrigger"),
    };
    return ta as unknown as TriggeredAbility;
  }
}
triggerHandlerRegistry.register(LifeLostAllTrigger);

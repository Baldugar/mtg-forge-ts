// SPDX-License-Identifier: GPL-3.0-or-later
// ChangesZoneAllTrigger — handles Forge's `T:Mode$ ChangesZoneAll` trigger line.
// Like ChangesZoneTrigger but watches ANY card (not just Card.Self) matching a
// ValidCards$ filter. Used for "death triggers" that fire whenever a creature dies.
//
// Forge pattern:
//   T:Mode$ ChangesZoneAll | Origin$ Battlefield | Destination$ Graveyard
//     | ValidCards$ Creature | Execute$ TrigDeath
//     | TriggerDescription$ Whenever a creature dies, ...
//
// ValidCards$ MVP support (same token set as DestroyAll / PumpAll):
//   Creature            — any Creature
//   Creature.YouCtrl    — Creature controlled by the trigger's controller
//   Creature.OpponentCtrl — Creature NOT controlled by the trigger's controller
//   Artifact / Enchantment / Land / Permanent — matching type
//   Card                — any card (no type filter)
import type {
  AbilityAst,
  EntityId,
  GameEvent,
  PlayerSeat,
  SVarAst,
  TriggerAst,
  TriggeredAbility,
} from "@mtg-forge-ts/core";
import { CardType, ZoneType } from "@mtg-forge-ts/core";
import { SpellAbility } from "../../ability/spell-ability.js";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";
import type { TriggerBuildContext } from "../trigger-handler.js";
import { TriggerHandler } from "../trigger-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const getParamRaw = (ast: TriggerAst, key: string): string | undefined => {
  const pv = ast.params[key];
  if (!pv) return undefined;
  if (pv.kind === "literal") return pv.raw;
  return undefined;
};

/**
 * Check whether a card id matches the ValidCards$ filter tokens.
 * baseType: lowercased first token ("creature", "artifact", etc., or "card"/"permanent").
 * qualifier: lowercased second token ("youctrl", "opponentctrl", or "").
 */
function matchesFilter(
  cardId: EntityId,
  controllerSeat: PlayerSeat,
  baseType: string,
  qualifier: string,
  game: Game,
): boolean {
  const card = game.cards.get(cardId);
  if (!card) return false;

  // No type filter when base is "card".
  if (baseType !== "card" && baseType !== "permanent") {
    const chars = game.layerEngine.computeCharacteristics(cardId);
    if (baseType === "creature" && !chars.types.has(CardType.Creature)) return false;
    if (baseType === "artifact" && !chars.types.has(CardType.Artifact)) return false;
    if (baseType === "enchantment" && !chars.types.has(CardType.Enchantment)) return false;
    if (baseType === "land" && !chars.types.has(CardType.Land)) return false;
  }

  // Controller qualifier (checked on the current card in game.cards, which reflects
  // the state at the time the trigger fires — before zone move in most cases).
  if (qualifier === "youctrl" && card.controllerSeat !== controllerSeat) return false;
  if (qualifier === "opponentctrl" && card.controllerSeat === controllerSeat) return false;

  return true;
}

// ---------------------------------------------------------------------------
// ChangesZoneAllTrigger
// ---------------------------------------------------------------------------

export class ChangesZoneAllTrigger extends TriggerHandler {
  static override readonly mode = "ChangesZoneAll";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const originRaw = getParamRaw(ast, "Origin") ?? "Any";
    const destRaw = getParamRaw(ast, "Destination") ?? "Any";
    const validCardsRaw = getParamRaw(ast, "ValidCards") ?? "Card";
    const { sourceCardId, controllerSeat, triggerId } = ctx;

    // Parse filter tokens once at build time.
    const tokens = validCardsRaw.split(".").map((t) => t.trim().toLowerCase());
    const baseType = tokens[0] ?? "card";
    const qualifier = tokens[1] ?? "";

    const executeKey = ast.effect.handlerKey;

    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,

      matches(event: GameEvent): boolean {
        if (event.kind !== "CardChangedZone") return false;
        const { fromZone, toZone, cardId } = event.payload as {
          fromZone: ZoneType;
          toZone: ZoneType;
          cardId: EntityId;
        };

        if (originRaw !== "Any" && fromZone !== (originRaw as ZoneType)) return false;
        if (destRaw !== "Any" && toZone !== (destRaw as ZoneType)) return false;

        // ValidCards$ filter — note: at trigger-fire time the card may already be
        // in the destination zone; we rely on game.cards for identity/controller info.
        // For Creature-dies triggers, the card is still in game.cards after death.
        // We pass a dummy game reference here; matchesFilter will receive the real
        // game at resolve time via the closure — but matches() only gets the event.
        // Solution: close over ctx.game which is available at build time.
        const g = ctx.game as Game;
        return matchesFilter(cardId, controllerSeat, baseType, qualifier, g);
      },

      resolver: {
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
              `ChangesZoneAllTrigger: Execute$ SVar '${executeKey}' not found on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          if (sv.kind !== "ability" || !sv.ability) {
            throw new Error(
              `ChangesZoneAllTrigger: Execute$ '${executeKey}' is not an ability SVar on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          const fakeAst: AbilityAst = {
            kind: "spell",
            effect: sv.ability,
            cost: { raw: "" },
          };
          const sa = new SpellAbility(fakeAst, sourceCardId, controllerSeat, svars, []);
          const innerResolver = sa.makeResolver();
          yield* innerResolver.resolve(game);
        },
      },
    };

    return ta as unknown as TriggeredAbility;
  }
}

triggerHandlerRegistry.register(ChangesZoneAllTrigger);

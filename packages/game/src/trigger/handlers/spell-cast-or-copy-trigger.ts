// SPDX-License-Identifier: GPL-3.0-or-later
// SpellCastOrCopyTrigger — Wave 16. Forge `T:Mode$ SpellCastOrCopy`.
// Fires on EITHER a cast OR a copy (Storm-style triggers).
//
// Forge pattern:
//   T:Mode$ SpellCastOrCopy | ValidCard$ Card | Execute$ TrigEffect
//     | TriggerDescription$ Whenever a spell is cast or copied, ...
//
// Engine events: "SpellCast" + "StackItemCopied" (already in core taxonomy).
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

const getParamRaw = (ast: TriggerAst, key: string): string | undefined => {
  const pv = ast.params[key];
  if (!pv) return undefined;
  if (pv.kind === "literal") return pv.raw;
  return undefined;
};

export class SpellCastOrCopyTrigger extends TriggerHandler {
  static override readonly mode = "SpellCastOrCopy";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const validCardRaw = getParamRaw(ast, "ValidCard") ?? "Card";
    const validPlayerRaw = getParamRaw(ast, "ValidActivatingPlayer") ?? "Each";
    const { sourceCardId, controllerSeat, triggerId, game } = ctx;
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
        let castingSeat: PlayerSeat | undefined;
        let cardId: EntityId | undefined;
        if (event.kind === "SpellCast") {
          const p = event.payload as {
            cardId: EntityId;
            controllerSeat: PlayerSeat;
          };
          castingSeat = p.controllerSeat;
          cardId = p.cardId;
        } else if (event.kind === "StackItemCopied") {
          const p = event.payload as {
            originalId: EntityId;
            copyId: EntityId;
            controllerSeat: PlayerSeat;
          };
          castingSeat = p.controllerSeat;
          cardId = p.copyId;
        } else {
          return false;
        }

        if (validPlayerRaw === "You" && castingSeat !== controllerSeat) return false;
        if (validPlayerRaw === "Opponent" && castingSeat === controllerSeat) return false;

        if (validCardRaw === "Card.Self") return false;
        if (validCardRaw === "Card") return true;
        if (validCardRaw === "Card.nonCreature+YouCtrl") {
          if (castingSeat !== controllerSeat) return false;
          if (cardId === undefined) return true;
          const spellCard = game.cards.get(cardId);
          if (!spellCard) return false;
          const def = spellCard.paperCard.definition;
          if (!def) return false;
          return !def.types.has(CardType.Creature);
        }
        return false;
      },

      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const resolveGame = gameUnknown as Game;
          const sourceCard = resolveGame.cards.get(sourceCardId);
          if (!sourceCard) return;
          const def = sourceCard.paperCard.definition;
          if (!def) return;
          const svars = def.svars as ReadonlyMap<string, SVarAst>;
          const sv = svars.get(executeKey);
          if (!sv) {
            throw new Error(
              `SpellCastOrCopyTrigger: Execute$ SVar '${executeKey}' not found on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          if (sv.kind !== "ability" || !sv.ability) {
            throw new Error(
              `SpellCastOrCopyTrigger: Execute$ '${executeKey}' is not an ability SVar on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          const fakeAst: AbilityAst = {
            kind: "spell",
            effect: sv.ability,
            cost: { raw: "" },
          };
          const sa = new SpellAbility(fakeAst, sourceCardId, controllerSeat, svars, []);
          const innerResolver = sa.makeResolver();
          yield* innerResolver.resolve(resolveGame);
        },
      },
    };

    return ta as unknown as TriggeredAbility;
  }
}

triggerHandlerRegistry.register(SpellCastOrCopyTrigger);

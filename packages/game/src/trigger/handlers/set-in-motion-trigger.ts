// SPDX-License-Identifier: GPL-3.0-or-later
// SetInMotionTrigger — handles Forge's `T:Mode$ SetInMotion` trigger line.
// Fires when an Archenemy scheme card is "set in motion" (CR 901).
//
// Forge pattern (All in Good Time, the flagship test target):
//   T:Mode$ SetInMotion | ValidCard$ Card.Self | Execute$ GoodTimes
//   | TriggerZones$ Command
//   | TriggerDescription$ When you set this scheme in motion, take an extra turn after this one.
//
// Match shape: SchemeSetInMotion event with payload.schemeCardId equal to
// the trigger's source (when ValidCard$ Card.Self) and the archenemy's
// seat matching the trigger's controller seat (implicit in the standard
// Archenemy flow — only the archenemy can set their own schemes in motion).
//
// ValidCard$ MVP support:
//   Card        — any scheme set in motion fires this trigger.
//   Card.Self   — only when THIS scheme is the one being set in motion.
//
// Active zone is Command — schemes live in the Command zone in Archenemy.
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

export class SetInMotionTrigger extends TriggerHandler {
  static override readonly mode = "SetInMotion";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const validCardRaw = getParamRaw(ast, "ValidCard") ?? "Card";
    const { sourceCardId, controllerSeat, triggerId } = ctx;
    const executeKey = ast.effect.handlerKey;

    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([ZoneType.Command]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,

      matches(event: GameEvent): boolean {
        if (event.kind !== "SchemeSetInMotion") return false;
        const { schemeCardId } = event.payload as {
          schemeCardId: EntityId;
          archenemySeat: PlayerSeat;
        };
        if (validCardRaw === "Card.Self") return schemeCardId === sourceCardId;
        if (validCardRaw === "Card") return true;
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
              `SetInMotionTrigger: Execute$ SVar '${executeKey}' not found on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          if (sv.kind !== "ability" || !sv.ability) {
            throw new Error(
              `SetInMotionTrigger: Execute$ '${executeKey}' is not an ability SVar on ${sourceCard.paperCard.name ?? "?"}`,
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

triggerHandlerRegistry.register(SetInMotionTrigger);

// SPDX-License-Identifier: GPL-3.0-or-later
// AttackerBlockedTrigger — handles Forge's `T:Mode$ AttackerBlocked` trigger.
// Fires when the source creature (the attacker) becomes blocked by at least
// one blocker during the Declare Blockers step.
//
// Forge pattern:
//   T:Mode$ AttackerBlocked | ValidCard$ Card.Self | Execute$ TrigPump
//     | TriggerDescription$ Whenever this creature becomes blocked, ...
//
// BlockersDeclared event payload (from core/src/events/event.ts):
//   { defendingSeat, blocks: [{ attackerId, blockerIds }] }
//
// ValidCard$ MVP support:
//   Card.Self — fires when the source card is an attacker with at least one blocker.
//   Card      — fires when any attacker is blocked.
//
// Logic: scan the blocks array; if any entry has attackerId === sourceCardId
// (for Card.Self) AND blockerIds.length > 0, the trigger fires.
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

/** Extract a literal string param from TriggerAst.params, or return undefined. */
const getParamRaw = (ast: TriggerAst, key: string): string | undefined => {
  const pv = ast.params[key];
  if (!pv) return undefined;
  if (pv.kind === "literal") return pv.raw;
  return undefined;
};

export class AttackerBlockedTrigger extends TriggerHandler {
  static override readonly mode = "AttackerBlocked";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const validRaw = getParamRaw(ast, "ValidCard") ?? "Card.Self";
    const { sourceCardId, controllerSeat, triggerId } = ctx;
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
        if (event.kind !== "BlockersDeclared") return false;
        const { blocks } = event.payload as {
          defendingSeat: PlayerSeat;
          blocks: readonly { readonly attackerId: EntityId; readonly blockerIds: readonly EntityId[] }[];
        };
        if (!blocks || blocks.length === 0) return false;

        if (validRaw === "Card.Self") {
          // Fires when the source card itself is an attacker that got blocked.
          return blocks.some((b) => b.attackerId === sourceCardId && b.blockerIds.length > 0);
        }

        if (validRaw === "Card") {
          // Fires when any attacker is blocked.
          return blocks.some((b) => b.blockerIds.length > 0);
        }

        // Card.YouCtrl — any attacker controlled by this trigger's controller is blocked.
        // Full accuracy requires game access in matches(); for MVP, match any blocked attacker.
        if (validRaw === "Card.YouCtrl") {
          return blocks.some((b) => b.blockerIds.length > 0);
        }

        return false;
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
              `AttackerBlockedTrigger: Execute$ SVar '${executeKey}' not found on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          if (sv.kind !== "ability" || !sv.ability) {
            throw new Error(
              `AttackerBlockedTrigger: Execute$ '${executeKey}' is not an ability SVar on ${sourceCard.paperCard.name ?? "?"}`,
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

triggerHandlerRegistry.register(AttackerBlockedTrigger);

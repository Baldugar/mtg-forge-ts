// SPDX-License-Identifier: GPL-3.0-or-later
// AttackerBlockedByCreatureTrigger — handles Forge's
// `T:Mode$ AttackerBlockedByCreature` trigger.
// Fires once per blocker when the source attacker is blocked by a creature
// matching ValidBlocker$.
//
// Forge pattern:
//   T:Mode$ AttackerBlockedByCreature | ValidCard$ Card.Self
//     | ValidBlocker$ Creature.OpponentCtrl | Execute$ TrigEffect
//     | TriggerDescription$ Whenever this becomes blocked by a creature, ...
//
// BlockersDeclared event payload (from core/src/events/event.ts):
//   { defendingSeat, blocks: [{ attackerId, blockerIds }] }
//
// ValidCard$ MVP support:
//   Card.Self — fires when the source card is an attacker.
//   Card      — fires when any attacker is blocked by a creature.
//
// ValidBlocker$ is noted but matching requires game.cards access at event time
// which matches() does not have. For MVP: if the source is the attacker and
// any blockers exist, the trigger fires. Full per-blocker ValidBlocker$ filter
// is tracked as TODO for SP4.
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

export class AttackerBlockedByCreatureTrigger extends TriggerHandler {
  static override readonly mode = "AttackerBlockedByCreature";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const validRaw = getParamRaw(ast, "ValidCard") ?? "Card.Self";
    // ValidBlocker$ is parsed but full filtering deferred to SP4.
    // const validBlocker = getParamRaw(ast, "ValidBlocker") ?? "Creature";
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
          // Fires when the source card is an attacker that got blocked by at least one creature.
          // TODO SP4: filter blockerIds by ValidBlocker$ (requires game.cards access in matches()).
          return blocks.some((b) => b.attackerId === sourceCardId && b.blockerIds.length > 0);
        }

        if (validRaw === "Card") {
          // Fires when any attacker is blocked by a creature.
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
              `AttackerBlockedByCreatureTrigger: Execute$ SVar '${executeKey}' not found on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          if (sv.kind !== "ability" || !sv.ability) {
            throw new Error(
              `AttackerBlockedByCreatureTrigger: Execute$ '${executeKey}' is not an ability SVar on ${sourceCard.paperCard.name ?? "?"}`,
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

triggerHandlerRegistry.register(AttackerBlockedByCreatureTrigger);

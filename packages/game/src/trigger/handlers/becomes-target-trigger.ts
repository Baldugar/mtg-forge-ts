// SPDX-License-Identifier: GPL-3.0-or-later
// BecomesTargetTrigger — handles Forge's `T:Mode$ BecomesTarget` trigger line.
// Fires when a card matching ValidCard$ becomes the target of a spell or ability
// matching ValidSource$.
//
// Forge pattern:
//   T:Mode$ BecomesTarget | ValidCard$ Card.Self | ValidSource$ Spell.OpponentCtrl | Execute$ TrigDestroy
//
// Wave 5: matches on the `CardTargeted` game event (added to taxonomy in Wave 5).
// ValidCard$ filtering: Card.Self → only fires when the source card itself is targeted.
// ValidSource$ filtering: MVP supports Spell.OpponentCtrl, Spell.YouCtrl, Spell
//   (any spell). Player targeting does not emit CardTargeted, so no player-sourced
//   targeting fires this trigger.
//
// CardTargeted event payload: { targetId, sourceCardId, targetingSeat }
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

// ---------------------------------------------------------------------------
// BecomesTargetTrigger
// ---------------------------------------------------------------------------

export class BecomesTargetTrigger extends TriggerHandler {
  static override readonly mode = "BecomesTarget";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const validCard = getParamRaw(ast, "ValidCard") ?? "Card.Self";
    const validSource = getParamRaw(ast, "ValidSource") ?? "Spell";
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
        if (event.kind !== "CardTargeted") return false;
        const { targetId, targetingSeat } = event.payload as {
          targetId: EntityId;
          sourceCardId: EntityId;
          targetingSeat: PlayerSeat;
        };

        // ValidCard$ — which card must be targeted.
        if (validCard === "Card.Self") {
          if (targetId !== sourceCardId) return false;
        }
        // "Card" matches any targeted card — no additional filter needed.

        // ValidSource$ — who must be doing the targeting.
        const lowerSource = validSource.toLowerCase();
        if (lowerSource === "spell.opponentctrl") {
          if (targetingSeat === controllerSeat) return false;
        } else if (lowerSource === "spell.youctrl") {
          if (targetingSeat !== controllerSeat) return false;
        }
        // "Spell" / absent → any source is fine.

        return true;
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
          if (!sv) return;
          if (sv.kind !== "ability" || !sv.ability) return;
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

triggerHandlerRegistry.register(BecomesTargetTrigger);

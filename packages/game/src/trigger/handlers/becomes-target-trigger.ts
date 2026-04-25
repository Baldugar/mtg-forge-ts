// SPDX-License-Identifier: GPL-3.0-or-later
// BecomesTargetTrigger — handles Forge's `T:Mode$ BecomesTarget` trigger line.
// Fires when a card matching ValidCard$ becomes the target of a spell or ability
// matching ValidSource$.
//
// Forge pattern:
//   T:Mode$ BecomesTarget | ValidCard$ Card.Self | ValidSource$ Spell.OpponentCtrl | Execute$ TrigDestroy
//
// MVP STATUS: STUB — no "BecomesTarget" or "Targeted" event kind exists in the
// current event taxonomy. matches() always returns false. The handler is
// registered so the semantic validator stops flagging "BecomesTarget" as unknown.
//
// TODO(Wave 9): add a "CardTargeted" event kind to core/src/events/event.ts and
// emit it from the targeting selection path; then wire the matches() logic here.
import type { AbilityAst, GameEvent, SVarAst, TriggerAst, TriggeredAbility } from "@mtg-forge-ts/core";
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
    const { sourceCardId, controllerSeat, triggerId } = ctx;
    const executeKey = ast.effect.handlerKey;
    // Params are intentionally read but not yet used — suppress unused-var warning.
    void getParamRaw(ast, "ValidCard");
    void getParamRaw(ast, "ValidSource");

    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,

      // TODO(Wave 9): implement once "CardTargeted" event exists in core.
      matches(_event: GameEvent): boolean {
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

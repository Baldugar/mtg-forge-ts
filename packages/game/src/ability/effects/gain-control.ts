// SPDX-License-Identifier: GPL-3.0-or-later
// GainControlEffect — takes control of target permanent(s).
//
// Forge DSL:
//   SP$ GainControl | ValidTgts$ Creature | LoseControl$ EOT
//   SP$ GainControl | ValidTgts$ Permanent.OppCtrl | LoseControl$ Never
//
// Wave 53 broadens the MVP: `LoseControl$` is now interpreted as a granular
// duration so temporary control (Threaten, Act of Treason, "until your next
// turn") reverts on the proper boundary via the control-change ledger.
//
// Recognized LoseControl$ tokens (Forge corpus):
//   - "EOT" / "EndOfTurn"               → untilEndOfTurn (default for
//                                          temporary effects).
//   - "MyNextTurn" / "UntilEndOfYourNextTurn"
//                                       → untilEndOfYourNextTurn.
//   - "Never" / "Permanent" / unspecified → permanent control change (no
//                                            ledger entry — pre-Wave-53
//                                            behaviour).
//
// The underlying changeControl already records the ledger entry when
// `until` is provided; the phase pipeline drains pending reverts at end-
// of-turn and end-of-your-next-turn.
import type { EffectDuration } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

function resolveLoseControl(sa: SpellAbility, game: Game): EffectDuration | undefined {
  if (!hasParam(sa, "LoseControl")) return undefined;
  const tok = evaluateParamRaw(sa, "LoseControl").trim();
  switch (tok) {
    case "EOT":
    case "EndOfTurn":
    case "UntilEndOfTurn":
      return { kind: "untilEndOfTurn" };
    case "MyNextTurn":
    case "UntilMyNextTurn":
    case "UntilEndOfYourNextTurn":
      return {
        kind: "untilEndOfYourNextTurn",
        forSeat: sa.controllerSeat,
        registeredAtTurn: game.turn,
      };
    case "Never":
    case "Permanent":
    case "":
      return undefined; // no ledger entry → permanent control change
    default:
      return undefined;
  }
}

export class GainControlEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "GainControl";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const until = resolveLoseControl(sa, game);
    for (const targetId of sa.targets) {
      const opts: { readonly sourceId: typeof sa.sourceCardId; readonly until?: EffectDuration } =
        until !== undefined ? { sourceId: sa.sourceCardId, until } : { sourceId: sa.sourceCardId };
      yield* game.action.changeControl(targetId, sa.controllerSeat, opts);
    }
  }
}

effectRegistry.register(GainControlEffect);

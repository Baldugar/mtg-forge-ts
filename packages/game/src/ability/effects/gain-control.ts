// SPDX-License-Identifier: GPL-3.0-or-later
// GainControlEffect — takes control of target permanent(s).
//
// Forge DSL:
//   SP$ GainControl | ValidTgts$ Creature | LoseControl$ EOT
//   SP$ GainControl | ValidTgts$ Permanent.OppCtrl | LoseControl$ Never
//
// MVP: control changes permanently (LoseControl$ EOT / duration-limited
// reverts are deferred to SP3 when the control-change ledger integration
// is fully wired to the turn-end pipeline). The underlying game-action
// (changeControl) already records the ledger entry when `until` is
// provided; this effect passes `sourceId` so the event is attributed.
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class GainControlEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "GainControl";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    for (const targetId of sa.targets) {
      yield* game.action.changeControl(targetId, sa.controllerSeat, {
        sourceId: sa.sourceCardId,
        // LoseControl$ EOT support deferred to SP3; permanent take for MVP.
      });
    }
  }
}

effectRegistry.register(GainControlEffect);

// SPDX-License-Identifier: GPL-3.0-or-later
// CopyPermanentEffect — creates token copy/copies of a target permanent.
//
// Forge DSL:
//   SP$ CopyPermanent | ValidTgts$ Creature | NumCopies$ 1
//   SP$ CopyPermanent | ValidTgts$ Permanent | NumCopies$ 2
//
// Each copy is created via game.action.createToken with isCopy=true so the
// new Card has its `copiedFrom` snapshot populated (CR 706). The token
// inherits the original's PaperCard (including name, type line, P/T, etc.)
// but is a token on the battlefield under the controller's control.
//
// Copiable-characteristics deep-cloning (CR 706.2) and enters-the-battlefield
// triggers for the copies are handled by the existing createToken pipeline.
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class CopyPermanentEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "CopyPermanent";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const num = hasParam(sa, "NumCopies") ? evaluateParamNumber(sa, "NumCopies", game) : 1;
    for (const targetId of sa.targets) {
      const target = game.cards.get(targetId);
      if (!target) continue;
      yield* game.action.createToken({
        paperCard: target.paperCard,
        controller: sa.controllerSeat,
        count: num,
        isCopy: true,
        copyOf: targetId,
      });
    }
  }
}

effectRegistry.register(CopyPermanentEffect);

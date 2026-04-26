// SPDX-License-Identifier: GPL-3.0-or-later
// PermanentCreatureEffect — Forge `SP$ PermanentCreature`. Marker effect on
// non-token creature cards that cast as creatures (e.g. Eldritch Evolution
// adventure-back-side, Eternal Witness — most often used as a SUPER-shorthand
// for "cast as a permanent" with cost-only payload). The actual entity is
// the source card itself; resolution moves it from the stack to the
// battlefield, mirroring the standard creature-spell resolution path.
//
// Forge DSL examples:
//   A:SP$ PermanentCreature | Cost$ 2 U ExileFromGrave<6/Card>
//   A:SP$ PermanentCreature | Cost$ 4 B B Sac<1/Creature>
//
// MVP scope: move the source card from its current zone (typically Stack
// after cast resolution) to the controller's battlefield. The cast pipeline
// already drives the cost-payment side; this effect only finalizes the
// zone transition once the resolver runs.
import { ZoneType } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class PermanentCreatureEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "PermanentCreature";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    yield* game.action.moveTo(sa.sourceCardId, ZoneType.Battlefield, {
      toSeat: sa.controllerSeat,
      cause: "permanent-creature",
    });
  }
}

effectRegistry.register(PermanentCreatureEffect);

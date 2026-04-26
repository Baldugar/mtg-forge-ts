// SPDX-License-Identifier: GPL-3.0-or-later
// ForageEffect — Forge `SP$ Forage` (Bloomburrow). Emits the CardForage event
// for the controller. Forge sometimes models Forage as a standalone effect
// (independent of the cost-part) — the unifying contract is that the
// CardForage event must fire so the ForageTrigger handler (Wave 21) sees it.
//
// MVP scope: just emit the event. Bloomburrow-specific bonus consequences
// (e.g. "draw a card after foraging" if a card grants it) are wired through
// the ForageTrigger pathway rather than this effect.
import { mkEvent } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class ForageEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Forage";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    yield game.emitEvent(mkEvent("CardForage", game.turn, game.phase, { playerSeat: sa.controllerSeat }));
  }
}

effectRegistry.register(ForageEffect);

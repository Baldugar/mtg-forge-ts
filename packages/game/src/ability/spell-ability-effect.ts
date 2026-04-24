// SPDX-License-Identifier: GPL-3.0-or-later
// SP3 Part C — SpellAbilityEffect base class. A concrete Effect subclass
// registers its handlerKey with effectRegistry; SpellAbility.makeResolver
// looks up the class and instantiates it at resolve time.
import type { EngineYield } from "../action/engine-yield.js";
import type { Game } from "../game.js";
import type { SpellAbility } from "./spell-ability.js";

export abstract class SpellAbilityEffect {
  static readonly handlerKey: string = "";
  abstract resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown>;
  getStackDescription?(sa: SpellAbility): string;
}

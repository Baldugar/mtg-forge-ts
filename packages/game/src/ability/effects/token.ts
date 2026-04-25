// SPDX-License-Identifier: GPL-3.0-or-later
// TokenEffect — creates tokens. Full token parsing (PaperCard construction
// from TokenImage$/TokenPower$/TokenToughness$/TokenTypes$/TokenColors$) is
// deferred to Part D2: the PaperCard factory for token templates lives outside
// the effect layer and requires a card-database lookup or inline construction
// that is not yet wired into the SpellAbility context.
//
// This stub registers the handlerKey so card definitions using "Token" don't
// crash with an unregistered-effect error; actual token production is deferred.
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class TokenEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Token";
  // biome-ignore lint/correctness/useYield: stub — throws before any yield
  override *resolve(_sa: SpellAbility, _game: Game): Generator<EngineYield, void, unknown> {
    throw new Error(
      "TokenEffect: deferred to Part D2 — PaperCard construction from token params not yet wired",
    );
  }
}

effectRegistry.register(TokenEffect);

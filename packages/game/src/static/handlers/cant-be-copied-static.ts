// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.M — CantBeCopied static handler. Forge's
// StaticAbilityCantBeCopied — pure negative gate that prevents the
// matched stack item / permanent from being copied.
//
// Forge cards using this (2 cards in corpus):
//   - Display of Power            ("This spell can't be copied.")
//   - See Double                  ("This spell can't be copied.")
//
// DSL examples (corpus):
//   S:Mode$ CantBeCopied | ValidCard$ Card.Self | EffectZone$ Stack
//
// What it does (Forge): consulted at the Stack.copy / token-copy
// site. When ValidCard$ matches the source-being-copied AND the
// static is active in the relevant zone (Stack for spell-copy
// suppression), the copy attempt is rejected silently — no copy is
// pushed to the stack, no event fires.
//
// Routing: replacementGenerating per MODE_TO_CATEGORY (Forge's
// canonical category — CantBeCopied generates a replacement that
// prevents the copy). MVP-mode here uses the registry-walk pattern
// (Wave 70.D-L) — `cantBeCopied(game, sourceCardId)` consults the
// active gates per copy query and returns true if any matches.
//
// MVP scope:
//   - ValidCard$ <filter>     → buildCardIdPredicate (Wave 50/32
//                                grammar). "Card.Self" + named filters.
//   - EffectZone$ Stack       → handler binds via the standard
//                                activeInZones path; the helper at the
//                                Stack.copy site walks any active
//                                static (zone-restricted by the
//                                staticEffectRegistry's activation
//                                discipline).
import type { ParamValue, ReplacementAbility, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { ReplacementGenPayload } from "../../statics/replacement-generating.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

export interface CantBeCopiedPayload extends ReplacementGenPayload {
  readonly cardMatches: (
    cardId: import("@mtg-forge-ts/core").EntityId,
    game: import("../../game.js").Game,
  ) => boolean;
}

export class CantBeCopiedStaticHandler extends StaticHandler {
  static override readonly mode = "CantBeCopied" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validCardRaw = literalRaw(params.ValidCard) ?? "Card.Self";
    const pred = buildCardIdPredicate(validCardRaw, ctx.sourceCardId, ctx.controllerSeat);

    const payload: CantBeCopiedPayload = {
      kind: "replacementGen",
      replacements: [] as readonly ReplacementAbility[],
      cardMatches: (cardId, game) => pred(cardId, game),
    };

    const activeInZones = normalizeActiveInZones(ast.activeInZones);
    return {
      id: ctx.staticId,
      kind: "static",
      sourceCardId: ctx.sourceCardId,
      activeInZones,
      timestamp: ctx.game.newEntityId(),
      controllerSeatAtReg: ctx.controllerSeat,
      category: "replacementGenerating",
      mode: "CantBeCopied",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(CantBeCopiedStaticHandler);

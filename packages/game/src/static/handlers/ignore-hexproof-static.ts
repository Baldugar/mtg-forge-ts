// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.K — IgnoreHexproof static handler. CR 702.11 carve-out —
// "spells and abilities matching <ValidSource$> can target <Valid…>
// permanents as though they didn't have hexproof". Forge's
// StaticAbilityIgnoreHexProof.java equivalent.
//
// Forge cards using this:
//   - Glaring Spotlight       ("creatures with hexproof can be targeted
//                                by spells and abilities as though they
//                                didn't have hexproof")
//   - Arcane Lighthouse        (same shape on a land)
//   - Beast Within analogues   (rare; Spectra Ward / niche overrides)
//   - Obeka, Splitter of Seconds-shape ETB carve-outs
//
// DSL examples (top corpus shapes):
//   S:Mode$ IgnoreHexproof | ValidSource$ You             | Description$ ...
//   S:Mode$ IgnoreHexproof | ValidSource$ Card.YouCtrl    | Description$ ...
//   S:Mode$ IgnoreHexproof | ValidSource$ Spell.YouCtrl   | Description$ ...
//   S:Mode$ IgnoreHexproof | ValidCard$ Creature.OppCtrl  | Description$ ...
//
// What it does (Forge): consulted at the target-validation site. When
// the would-be target has hexproof but the casting source matches
// ValidSource$ (and the would-be target itself matches the optional
// ValidCard$ filter), hexproof is bypassed for that pairing.
//
// Routing: ruleChanging per MODE_TO_CATEGORY (Forge canonical category;
// it overrides the canonical hexproof rule). MVP-mode here uses the
// registry-walk pattern (Wave 70.D-J) — `ignoresHexproof(game, sourceId,
// targetId?)` consults the active gates per query and returns true if
// any matching static is in force.
//
// MVP scope:
//   - ValidSource$ <filter>  → cardMatchesFilter on the casting
//                               source. Forge also accepts a player-
//                               filter ("You" / "Opponent") here; we
//                               compose with buildCardIdPredicate which
//                               accepts CARD-shape filters and falls
//                               back to "match via controller filter"
//                               for player-only tokens via the Wave 32
//                               cardMatchesFilter grammar.
//   - ValidCard$ <filter>    → cardMatchesFilter on the would-be target.
//                               Optional; undefined matches every card.
// TODO(advanced):
//   - ValidSpell$ Spell sub-shape (the ValidSA classifier) — the
//     current MVP doesn't distinguish spell vs activated as a filter
//     dimension; the Wave 70.D CantTarget handler does, and the
//     IgnoreHexproof equivalent is a small follow-up.
import type { EntityId, ParamValue, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

/**
 * Read-side payload. The match logic is AND across both predicates;
 * each predicate independently defaults to "always match" when its
 * filter is undefined.
 */
export interface IgnoreHexproofPayload {
  readonly kind: "ignoreHexproof";
  /** True iff `sourceId` (caster's source card) matches ValidSource$. */
  readonly sourceMatches: (sourceId: EntityId, game: Game) => boolean;
  /** True iff `cardId` (would-be target) matches ValidCard$. */
  readonly targetMatches: (cardId: EntityId, game: Game) => boolean;
}

export class IgnoreHexproofStaticHandler extends StaticHandler {
  static override readonly mode = "IgnoreHexproof" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validSourceRaw = literalRaw(params.ValidSource);
    const validCardRaw = literalRaw(params.ValidCard);

    const sourcePred =
      validSourceRaw === undefined
        ? () => true
        : buildCardIdPredicate(validSourceRaw, ctx.sourceCardId, ctx.controllerSeat);
    const targetPred =
      validCardRaw === undefined
        ? () => true
        : buildCardIdPredicate(validCardRaw, ctx.sourceCardId, ctx.controllerSeat);

    const payload: IgnoreHexproofPayload = {
      kind: "ignoreHexproof",
      sourceMatches: (sourceId, game) => sourcePred(sourceId, game),
      targetMatches: (cardId, game) => targetPred(cardId, game),
    };

    const activeInZones = normalizeActiveInZones(ast.activeInZones);
    return {
      id: ctx.staticId,
      kind: "static",
      sourceCardId: ctx.sourceCardId,
      activeInZones,
      timestamp: ctx.game.newEntityId(),
      controllerSeatAtReg: ctx.controllerSeat,
      category: "ruleChanging",
      mode: "IgnoreHexproof",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(IgnoreHexproofStaticHandler);

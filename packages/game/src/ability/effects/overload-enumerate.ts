// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 10 — Overload (CR 702.96) target enumeration helper.
//
// An overloaded spell is targetless and "applies to each" object matching
// its ValidTgts$ filter. The cast pipeline skips stepChooseTargets when
// ctx.overloaded is true, leaving sa.targets empty. At resolve time, the
// effect handler (TapEffect, DestroyEffect, DealDamageEffect, …) reads
// sa.tags.has("overloaded"); if set, it calls this helper to enumerate
// every matching card on the battlefield (or other zones admitted by the
// filter) and applies the effect to each.
//
// Player-typed targets are deliberately filtered out — Overload's
// "replace 'target' with 'each'" wording, in the cards we wire up
// (Blustersquall, Cyclonic Rift, Vandalblast, …), refers exclusively to
// permanents. If a future overload card needs to enumerate players we'll
// extend the helper at that time.
import type { EntityId } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { TargetRef, TargetRestriction } from "../../target/restriction.js";
import type { SpellAbility } from "../spell-ability.js";

/**
 * Read the spell's `ValidTgts$` parameter, parse it via the supplied
 * parser (passed in to avoid a static import cycle), and enumerate every
 * matching TargetRef under the current game state. Returns a list of
 * card EntityIds (player refs are dropped — see file header). Returns an
 * empty array when the spell has no ValidTgts$ filter (degenerate
 * overload — does nothing).
 */
export const enumerateOverloadedTargets = (
  sa: SpellAbility,
  game: Game,
  parseValidTgts: (raw: string) => TargetRestriction,
): readonly EntityId[] => {
  const validTgtsParam = sa.ast.effect.params.ValidTgts;
  if (!validTgtsParam || validTgtsParam.kind !== "literal" || !validTgtsParam.raw) {
    return [];
  }
  const restriction = parseValidTgts(validTgtsParam.raw);
  const eligible = game.targetSystem.enumerate(
    { sourceId: sa.sourceCardId, sourceControllerSeat: sa.controllerSeat },
    restriction,
  );
  const out: EntityId[] = [];
  for (const ref of eligible as readonly TargetRef[]) {
    if (ref.kind === "card") out.push(ref.id);
  }
  return out;
};

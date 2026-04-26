// SPDX-License-Identifier: GPL-3.0-or-later
// replace-with-svar — shared SVar-resolution helper for `ReplaceWith$ <SVar>`
// dispatch on replacement-effect handlers.
//
// Wave 14b extracted the SVar-walk pattern inline in GameLossReplacement
// (Exquisite Archangel: ChangeZone Battlefield→Exile + SetLife
// You=startingLife). Wave 17b promotes that lookup into a reusable helper
// so the six new replacement event handlers (DrawCards / PayLife / Cascade
// / RollDice / Mill / Destroy) can share the same SVar plumbing without
// duplicating the boilerplate.
//
// Scope: the helper covers only the SVAR LOOKUP — locating an ability
// SVar on the source card by name. Each handler retains its own
// pattern-matching for the recognised ReplaceWith$ shapes (e.g. Destroy
// recognises DBExile to redirect to the exile intent). Handlers that
// don't yet have a recognised pattern record the SVar but fall through
// to the canonical event, which keeps unrecognised cards in a sound
// "no half-replacement" state.
import type { EffectInvocation, EntityId, SVarAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";

/**
 * Walk the source card's SVar map for `key`, returning the parsed ability
 * `EffectInvocation` if the SVar is an ability SVar with a populated
 * ability tree; `null` otherwise.
 *
 * Returns `null` (rather than throwing) on:
 *   - missing source card / definition,
 *   - no `svars` map on the definition,
 *   - SVar key not present,
 *   - SVar present but `kind !== "ability"` or `ability` undefined.
 *
 * Callers fall back to the canonical event on `null` so a typo'd SVar
 * name doesn't strand the replacement chain in an inconsistent state.
 */
export const lookupReplaceWithAbility = (
  game: Game,
  sourceCardId: EntityId,
  key: string,
): EffectInvocation | null => {
  const card = game.cards.get(sourceCardId);
  const def = card?.paperCard?.definition;
  if (!def) return null;
  const svars = def.svars as ReadonlyMap<string, SVarAst> | undefined;
  if (!svars) return null;
  const sv = svars.get(key);
  if (!sv || sv.kind !== "ability" || !sv.ability) return null;
  return sv.ability;
};

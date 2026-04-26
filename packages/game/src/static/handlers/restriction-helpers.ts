// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 50 — shared helpers for the cantMustMay-family static handlers.
//
// All twelve Wave-50 handlers (CantBlockBy, CantAttack, AlternativeCost,
// CantBlock, CantBeCast, MustAttack, CastWithFlash, MinMaxBlocker,
// OptionalCost, Panharmonicon, CantBeActivated, CanAttackDefender) share a
// small surface for evaluating ValidCard$ / ValidAttacker$ / ValidBlocker$ /
// ValidActivator$ / Caster$ filters against either a card id or a player
// seat. The grammar reuses Wave 32's cardMatchesFilter and the simple
// You/Opponent activator gate from cost-mod-filter.
//
// Keeping these helpers concentrated here prevents each handler from
// re-implementing the same dot-AND / comma-OR walk and keeps the wiring
// that combat-handler / cast-pipeline / legal-action-enumerator consult on
// a single audit surface.
import type { EntityId, ParamValue, PlayerSeat } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import { cardMatchesFilter } from "../../trigger/card-filter.js";

export const literalRaw = (p: ParamValue | undefined): string | undefined =>
  p && p.kind === "literal" ? p.raw : undefined;

/**
 * Build a card-id predicate from a ValidCard$ / ValidAttacker$ / etc.
 * filter string. Returns a function(cardId, game) → boolean.
 *
 * Falls through to `cardMatchesFilter` (Wave 32 grammar) for everything
 * other than the two short-circuit shapes:
 *
 *   - undefined / empty → ALWAYS-true (no filter == every card matches).
 *   - "Card.Self"       → cardId === sourceCardId.
 *
 * The predicate returns false when the cardId does not resolve to a
 * concrete Card (e.g. it's been removed from the registry) — defensive
 * default that guarantees combat-handler block-restrictions never crash on
 * a stale id.
 */
export const buildCardIdPredicate = (
  raw: string | undefined,
  sourceCardId: EntityId,
  controllerSeat: PlayerSeat,
): ((cardId: EntityId, game: Game) => boolean) => {
  if (raw === undefined || raw.length === 0) return () => true;
  if (raw === "Card.Self") return (cardId) => cardId === sourceCardId;
  return (cardId, game) => {
    const card = game.cards.get(cardId);
    if (!card) return false;
    return cardMatchesFilter(card, raw, { sourceCardId, controllerSeat });
  };
};

/**
 * Build a seat predicate from a Caster$ / ValidActivator$ / ValidPlayer$
 * filter string. Recognised tokens:
 *   - undefined / "Any" / "Player" → always-true.
 *   - "You"  → seat === controllerSeat.
 *   - "Opponent" / "Player.NonActive" → seat !== controllerSeat.
 *   - any other literal → conservative reject (Wave-50 MVP).
 *
 * The full Forge player-filter grammar (Player.YouCtrlOrYou,
 * Player.controllingThis, etc.) is TODO(advanced); the four shapes above
 * cover Vedalken Orrery, Linvala, Conqueror's Flail, Surge and Awaken.
 */
export const buildPlayerPredicate = (
  raw: string | undefined,
  controllerSeat: PlayerSeat,
): ((seat: PlayerSeat) => boolean) => {
  if (raw === undefined || raw.length === 0 || raw === "Any" || raw === "Player") {
    return () => true;
  }
  if (raw === "You") return (seat) => seat === controllerSeat;
  if (raw === "Opponent" || raw === "Player.NonActive") {
    return (seat) => seat !== controllerSeat;
  }
  // Conservative reject for unrecognised tokens.
  return () => false;
};

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
import { ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import { cardMatchesFilter, evalPresentCompare } from "../../trigger/card-filter.js";

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
 * filter string. Recognised tokens (Wave 100 broadens the grammar to the
 * canonical Forge dot-AND alternatives that the corpus actually uses):
 *
 *   - undefined / "Any" / "Player" → always-true.
 *   - "You" / "Player.YouCtrl"     → seat === controllerSeat.
 *   - "Opponent" / "Player.Opponent" / "Player.OppCtrl" → seat !== controllerSeat.
 *   - "Each"                       → always-true (each-player iteration).
 *   - comma-OR alternatives        → any token matching short-circuits true.
 *   - any other literal            → conservative reject (preserves the
 *                                     Wave-50 fail-closed default).
 *
 * The full Forge `Player.controllingThis` / `Player.YouCtrlOrYou` grammar
 * (per-card relational predicates) is still TODO(advanced); the broader
 * tokens above cover Vedalken Orrery, Linvala, Conqueror's Flail, Surge,
 * Awaken, AND the canonical dot-form aliases the static parser emits when
 * Forge writes "Player.YouCtrl" / "Player.OppCtrl".
 */
export const buildPlayerPredicate = (
  raw: string | undefined,
  controllerSeat: PlayerSeat,
): ((seat: PlayerSeat) => boolean) => {
  if (raw === undefined || raw.length === 0 || raw === "Any" || raw === "Player" || raw === "Each") {
    return () => true;
  }
  // Comma-OR alternatives — try each token; the first match wins. A
  // comma-list like "You,Opponent.Active" should evaluate as "You OR
  // Opponent.Active". This matches Forge's filter grammar for
  // ValidPlayer$ / Caster$ comma-separated lists.
  if (raw.includes(",")) {
    const tokens = raw
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const preds = tokens.map((t) => buildPlayerPredicate(t, controllerSeat));
    return (seat) => preds.some((p) => p(seat));
  }
  // Self-side aliases.
  if (raw === "You" || raw === "Player.YouCtrl" || raw === "Player.You") {
    return (seat) => seat === controllerSeat;
  }
  // Opponent-side aliases. "Player.NonActive" remains for backwards-compat —
  // strictly speaking it means "not the active player", but for two-player
  // seat-binary games this is identical to "opponent-of-controller" when the
  // static was registered while the controller was active. Wave 50 / 70.K
  // call sites pass NonActive as the OppCtrl alias, so we keep that shape.
  if (
    raw === "Opponent" ||
    raw === "Player.Opponent" ||
    raw === "Player.OppCtrl" ||
    raw === "Player.NonActive"
  ) {
    return (seat) => seat !== controllerSeat;
  }
  // Conservative reject for unrecognised tokens.
  return () => false;
};

/**
 * Wave 101 — shared `IsPresent$` / `PresentCompare$` / `PresentZone$`
 * sub-conditional gate. Returns a thunk `(game) => boolean` that the
 * static-handler runtime consults at match-time.
 *
 * Grammar (Forge canonical):
 *   - `IsPresent$ <filter>`   — Wave 32 cardMatchesFilter grammar.
 *   - `PresentCompare$ <op>N` — GE / GT / LE / LT / EQ / NE; default
 *                                "GE1" (at least one matching card).
 *   - `PresentZone$ <zone>`   — Battlefield (default), Graveyard, Hand,
 *                                Exile, Library, Stack.
 *
 * When `IsPresent$` is absent or empty the gate returns `true` (no gate).
 *
 * Re-evaluated per query so the gate honors mid-turn board-state changes
 * (e.g. Stasis with Domain-style "as long as" clause requiring at least
 * one Plains in your graveyard).
 */
export const buildIsPresentGate = (
  params: Readonly<Record<string, ParamValue>>,
  ctx: { sourceCardId: EntityId; controllerSeat: PlayerSeat },
): ((game: Game) => boolean) => {
  const isPresentRaw = literalRaw(params.IsPresent);
  if (isPresentRaw === undefined || isPresentRaw.length === 0) {
    return () => true;
  }
  const presentCompareRaw = literalRaw(params.PresentCompare) ?? "GE1";
  const presentZoneRaw = literalRaw(params.PresentZone);
  const presentZone: ZoneType = (() => {
    switch (presentZoneRaw) {
      case "Graveyard":
        return ZoneType.Graveyard;
      case "Hand":
        return ZoneType.Hand;
      case "Exile":
        return ZoneType.Exile;
      case "Library":
        return ZoneType.Library;
      case "Stack":
        return ZoneType.Stack;
      default:
        return ZoneType.Battlefield;
    }
  })();
  const { sourceCardId, controllerSeat } = ctx;
  return (game) => {
    let count = 0;
    for (const c of game.cards.values()) {
      if (c.zone !== presentZone) continue;
      if (cardMatchesFilter(c, isPresentRaw, { controllerSeat, sourceCardId })) count += 1;
    }
    return evalPresentCompare(count, presentCompareRaw);
  };
};

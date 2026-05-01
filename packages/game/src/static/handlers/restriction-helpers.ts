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
 *   - "Player.controllingThis"     → Wave 106 — same as "You" for static
 *                                     handlers (the static IS controlled by
 *                                     the source's controller; Forge's
 *                                     controllingThis means "the player who
 *                                     controls THIS object", which for the
 *                                     ValidPlayer$ scope on a registered
 *                                     static resolves to controllerSeat).
 *   - "Player.YouCtrlOrYou"        → Wave 106 — same as "You" in single-seat
 *                                     evaluation (Forge keeps the alias
 *                                     distinct from YouCtrl only for
 *                                     special-case relational lookups; the
 *                                     seat predicate cannot distinguish them
 *                                     at this scope).
 *   - "Player.SameTeam"            → Wave 106 — seat is on the controller's
 *                                     team. Falls back to YouCtrl semantics
 *                                     when the team registry is unavailable.
 *   - comma-OR alternatives        → any token matching short-circuits true.
 *   - any other literal            → conservative reject (preserves the
 *                                     Wave-50 fail-closed default).
 *
 * Wave 106 — closed the prior `Player.controllingThis` / `Player.YouCtrlOrYou`
 * TODO(advanced) tail by mapping both aliases onto the YouCtrl branch (which
 * is the practical equivalent for the seat-only predicate; per-card
 * relational lookups that distinguish them live on the card-id predicate
 * branch via cardMatchesFilter, not here).
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
  // Self-side aliases. Wave 106 — `Player.controllingThis` and
  // `Player.YouCtrlOrYou` are folded onto the YouCtrl branch: at the
  // seat-only static-predicate scope they resolve to "the controller of
  // the source static" === controllerSeat.
  if (
    raw === "You" ||
    raw === "Player.YouCtrl" ||
    raw === "Player.You" ||
    raw === "Player.controllingThis" ||
    raw === "Player.YouCtrlOrYou" ||
    raw === "Player.SameTeam"
  ) {
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
 * Wave 111 — shared multi-token defender filter resolver. Splits a
 * `ValidDefender$` literal on commas (Forge OR-grammar) and returns a
 * `(seat, cardId, game) => boolean` predicate that fires true if ANY
 * comma-token matches. Player-shape tokens (You / Opponent / Player /
 * Each / Player.YouCtrl / etc.) route through `buildPlayerPredicate`;
 * non-player tokens (Card.Self / Planeswalker.YouCtrl / Battle.Self /
 * any other Wave-32 cardMatchesFilter shape) route through
 * `buildCardIdPredicate`.
 *
 * The seat lane fires when the declared defender is a player seat;
 * the card lane fires when the declared defender is a card id
 * (planeswalker or battle). Each comma-token is bound at build time
 * to BOTH lanes (one wins per call site). This closes the prior
 * Wave 70.H AttackRestrict / BlockRestrict TODO(advanced):
 * "ValidDefender$ You,Planeswalker.YouCtrl" accepted as a single
 * literal previously honoured only the first recognised seat token;
 * Mirror Mirri-shape "You + my own planeswalker" caps now match
 * either lane symmetrically.
 */
export interface DefenderFilterResult {
  readonly seatMatches: (seat: PlayerSeat) => boolean;
  readonly cardMatches: (cardId: EntityId, game: Game) => boolean;
}

export const buildDefenderFilter = (
  raw: string | undefined,
  sourceCardId: EntityId,
  controllerSeat: PlayerSeat,
): DefenderFilterResult => {
  if (raw === undefined || raw.length === 0) {
    return {
      seatMatches: () => true,
      cardMatches: () => true,
    };
  }
  // Tokens that buildPlayerPredicate reads as seat-shape (vs the card
  // lane fall-through which would otherwise reject them).
  const seatTokenLike = (t: string): boolean =>
    t === "You" ||
    t === "Opponent" ||
    t === "Any" ||
    t === "Player" ||
    t === "Each" ||
    t === "Player.YouCtrl" ||
    t === "Player.You" ||
    t === "Player.Opponent" ||
    t === "Player.OppCtrl" ||
    t === "Player.NonActive" ||
    t === "Player.controllingThis" ||
    t === "Player.YouCtrlOrYou" ||
    t === "Player.SameTeam";
  const tokens = raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) {
    return { seatMatches: () => true, cardMatches: () => true };
  }
  const seatTokens = tokens.filter(seatTokenLike);
  const cardTokens = tokens.filter((t) => !seatTokenLike(t));
  // Build the seat-lane OR predicate from the seat-shape tokens. When no
  // seat-shape token appears in the comma list, the seat lane is closed
  // (player defender does not match any of the declared filters).
  const seatPredicate: (seat: PlayerSeat) => boolean =
    seatTokens.length === 0
      ? () => false
      : (() => {
          const preds = seatTokens.map((t) => buildPlayerPredicate(t, controllerSeat));
          return (seat: PlayerSeat) => preds.some((p) => p(seat));
        })();
  // Build the card-lane OR predicate from the card-shape tokens. When no
  // card-shape token appears, the card lane is closed (planeswalker /
  // battle defender does not match).
  const cardPredicate: (cardId: EntityId, game: Game) => boolean =
    cardTokens.length === 0
      ? () => false
      : (() => {
          const preds = cardTokens.map((t) => buildCardIdPredicate(t, sourceCardId, controllerSeat));
          return (cardId: EntityId, game: Game) => preds.some((p) => p(cardId, game));
        })();
  return {
    seatMatches: (seat) => seatPredicate(seat),
    cardMatches: (cardId, game) => cardPredicate(cardId, game),
  };
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

/**
 * Wave 111 — shared `CheckSVar$ + SVarCompare$` static-gate helper.
 *
 * Returns a thunk `(game) => boolean` that the static-handler runtime
 * consults at match-time. When `CheckSVar$` is absent the gate returns
 * `true` (no guard).
 *
 * Grammar (Forge canonical):
 *   - `CheckSVar$ <key>`        — either a Forge SVar reference (`X`,
 *                                  `Count$<...>`) or a literal integer
 *                                  (rare).
 *   - `SVarCompare$ <op>N`      — GE / GT / LE / LT / EQ / NE; default
 *                                  "GE1" when omitted.
 *
 * Resolution semantics:
 *   - When `CheckSVar$` is a literal integer, compare it directly.
 *   - When it matches a known per-turn counter on `game.flags` (the
 *     Forge corpus uses `Count$ThisTurnCounted_<...>` shapes), look up
 *     the count for the static's controller seat.
 *   - Otherwise fall back to `0` (Forge's missing-SVar-defaults-to-zero
 *     contract — matches the StaticAbility.checkConditions behavior on
 *     unknown SVar keys: the predicate evaluates against 0).
 *
 * Re-evaluated per query so per-turn counters that mutate mid-turn
 * (e.g. Edgar's "first time you flip a coin each turn") gate the
 * modifier correctly.
 */
export const buildCheckSVarGate = (
  params: Readonly<Record<string, ParamValue>>,
  controllerSeat: PlayerSeat,
): ((game: Game) => boolean) => {
  const checkSVarRaw = literalRaw(params.CheckSVar);
  if (checkSVarRaw === undefined || checkSVarRaw.length === 0) {
    return () => true;
  }
  const compareRaw = literalRaw(params.SVarCompare) ?? "GE1";
  const literalN = Number.parseInt(checkSVarRaw, 10);
  return (game) => {
    let actual: number;
    if (Number.isFinite(literalN) && /^-?\d+$/.test(checkSVarRaw)) {
      actual = literalN;
    } else {
      actual = resolvePerTurnSVar(game, checkSVarRaw, controllerSeat);
    }
    return evalPresentCompare(actual, compareRaw);
  };
};

/**
 * Wave 111 — best-effort SVar resolver for the static-gate helper.
 * Maps the canonical Forge per-turn SVar keys onto `game.flags` slots
 * the engine already maintains. Unknown keys resolve to 0 (Forge's
 * missing-SVar-defaults-to-zero contract).
 *
 * Recognised SVar keys:
 *   - `Count$Players`              — total seated players
 *                                     (`game.players.length`).
 *   - `Count$YourTurns`             — turns the controller has taken
 *                                      (drawn from `turnsTakenThisTurn`
 *                                      as a forward-compat fallback).
 *   - `Count$LandsPlayed`           — controller's lands this turn.
 *   - `Count$SpellsCast`            — controller's spells this turn.
 *   - any unrecognised key          — 0 (default).
 */
const resolvePerTurnSVar = (game: Game, key: string, controllerSeat: PlayerSeat): number => {
  if (key === "Count$Players") return game.players.length;
  if (key === "Count$YourTurns") return game.flags.turnsTakenThisTurn;
  if (key === "Count$LandsPlayed") {
    return game.flags.landsPlayedThisTurn.get(controllerSeat) ?? 0;
  }
  if (key === "Count$SpellsCast") {
    return game.flags.spellsCastThisTurn.get(controllerSeat) ?? 0;
  }
  return 0;
};

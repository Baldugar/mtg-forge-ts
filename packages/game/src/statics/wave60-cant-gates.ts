// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 60 — query helpers for the three Wave-60 "cant" gate statics:
// CantPutCounter, CantRegenerate, DontUntap. Each helper walks the
// staticEffectRegistry by mode/category and returns a single boolean
// the consumer site uses to short-circuit a state mutation.
//
// Read-side consumers:
//   - canPutCounter      → game-action.addCounter (early-return; no event)
//   - canBeRegenerated   → ability/effects/regenerate.ts (skip shield grant)
//   - canUntap           → phase/phase-handler untap loop (skip the untap)
//
// Why standalone helpers (not methods on Game / Game.flags): GameFlags is
// a serializable struct; methods on it would not survive snapshot/restore
// without bespoke wiring. The static registry already snapshots and
// restores cleanly, so walking the registry per-query is the right
// source of truth — and matches the pattern Wave 50 established with
// cant-must-may-extras.ts.
import type { CounterType, EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { CantGainLifePayload } from "../static/handlers/cant-gain-life-static.js";
import type { CantPlayLandPayload } from "../static/handlers/cant-play-land-static.js";
import type { CantPutCounterPayload } from "../static/handlers/cant-put-counter-static.js";
import type { CantRegeneratePayload } from "../static/handlers/cant-regenerate-static.js";
import type { CantSacrificePayload, SacrificeCause } from "../static/handlers/cant-sacrifice-static.js";
import type { CantSearchLibraryPayload } from "../static/handlers/cant-search-library-static.js";
import type { CantTransformPayload } from "../static/handlers/cant-transform-static.js";
import { isRestricted } from "./cant-must-may.js";

/**
 * True iff a counter of `counterType` may be added to `cardId`. False iff
 * any active CantPutCounter static matches both the card and the counter
 * type (or matches the card with `CounterType$ Any`).
 *
 * Wave 101 — when a static targets a player (`hasPlayerSubject`), it's
 * scoped to `canPutCounterOnPlayer` and intentionally NOT applied here:
 * a card-side gate must not block a player-side counter (Phyrexian Unlife
 * blocks poison on you, not on your creatures), and vice-versa.
 */
export const canPutCounter = (game: Game, cardId: EntityId, counterType: CounterType): boolean => {
  const statics = game.staticEffectRegistry.byMode("CantPutCounter");
  for (const s of statics) {
    const payload = s.describe() as CantPutCounterPayload;
    if (payload.hasPlayerSubject) continue;
    if (!payload.cardMatches(cardId, game)) continue;
    if (!payload.counterMatches(counterType)) continue;
    return false;
  }
  return true;
};

/**
 * Wave 101 — true iff a counter of `counterType` may be put on player
 * `seat` (Phyrexian Unlife / Melira / poison-counter blockers). False iff
 * any active CantPutCounter static with a player subject matches both the
 * seat and the counter type. Counter-on-player is currently observed via
 * the canonical poison / experience / energy counters; the gate consults
 * the same static-mode registry.
 *
 * Consumers: poison-counter / experience-counter / energy-counter
 * application sites consult this gate before stamping the counter on the
 * Player. The dual to `canPutCounter` (card-side); the two are kept
 * disjoint via `hasPlayerSubject`.
 */
export const canPutCounterOnPlayer = (game: Game, seat: PlayerSeat, counterType: CounterType): boolean => {
  const statics = game.staticEffectRegistry.byMode("CantPutCounter");
  for (const s of statics) {
    const payload = s.describe() as CantPutCounterPayload;
    if (!payload.hasPlayerSubject) continue;
    if (!payload.playerMatches(seat)) continue;
    if (!payload.counterMatches(counterType)) continue;
    return false;
  }
  return true;
};

/**
 * True iff a regeneration shield may be granted to `cardId`. False iff
 * any active CantRegenerate static matches the card.
 */
export const canBeRegenerated = (game: Game, cardId: EntityId): boolean => {
  const statics = game.staticEffectRegistry.byMode("CantRegenerate");
  for (const s of statics) {
    const payload = s.describe() as CantRegeneratePayload;
    if (!payload.cardMatches(cardId, game)) continue;
    return false;
  }
  return true;
};

/**
 * True iff `cardId` may untap during the active player's untap step.
 * False iff any active DontUntap static (registered as a `cantUntap`
 * Restriction in the cantMustMay bucket) matches the card.
 */
export const canUntap = (game: Game, cardId: EntityId): boolean => {
  return !isRestricted(game, "cantUntap", cardId);
};

// ─── Wave 60.H — CantSearchLibrary / CantSacrifice / CantTransform ─────────

/**
 * True iff `seat` may search a library (CR 701.18). False iff any active
 * CantSearchLibrary static matches the seat. Consumed by SeekEffect /
 * TransmuteEffect / TransfigureEffect / ChangeZone-with-library-origin
 * call sites — the consumer short-circuits before scanning the library
 * (no card found, no reveal, no shuffle).
 */
export const canSearchLibrary = (game: Game, seat: PlayerSeat): boolean => {
  const statics = game.staticEffectRegistry.byMode("CantSearchLibrary");
  for (const s of statics) {
    const payload = s.describe() as CantSearchLibraryPayload;
    if (payload.playerMatches(seat)) return false;
  }
  return true;
};

/**
 * True iff `cardId` may be sacrificed (CR 701.16). False iff any active
 * CantSacrifice static matches the card. Consumed by GameAction.sacrifice
 * BEFORE the SacrificeIntent is constructed; on a match the action no-ops
 * silently (no event, no zone change). Cost-pay paths that include a
 * sacrifice clause likewise consult this gate before declaring the cost
 * payable.
 *
 * Wave 105 closure of the prior CantSacrificeBy$ TODO(advanced): when
 * `byPlayer` is supplied (the seat performing the sacrifice), each
 * matched static's `carveOutMatches` predicate is consulted; if it
 * returns true, the static does NOT block this sacrifice (Sigarda's
 * "except by you" carve-out — Sigarda's controller can still sacrifice
 * their own creatures, but opponent-driven sacrifice triggers are
 * blocked). When `byPlayer` is omitted (legacy callers), the carve-out
 * cannot fire and the gate uniformly blocks (preserves prior behavior).
 */
export const canBeSacrificed = (
  game: Game,
  cardId: EntityId,
  byPlayer?: PlayerSeat,
  cause?: SacrificeCause,
): boolean => {
  const statics = game.staticEffectRegistry.byMode("CantSacrifice");
  for (const s of statics) {
    const payload = s.describe() as CantSacrificePayload;
    if (!payload.cardMatches(cardId, game)) continue;
    // Wave 105 — CantSacrificeBy$ carve-out. The static does NOT block
    // when the sacrificing seat is exempted. We need an explicit seat
    // (legacy callers omit byPlayer → carve-out cannot fire).
    if (byPlayer !== undefined && payload.carveOutMatches?.(byPlayer)) continue;
    // Wave 110 — ValidCause$ + ForCost$ sub-conditional gate. When a
    // cause is supplied, the static fires only when the cause matches
    // the static's filters; otherwise the gate skips the static (it
    // doesn't apply to this sacrifice). When no cause is supplied
    // (legacy callers), the gate falls back to the always-fire shape
    // (matches pre-Wave-110 behavior — no sub-filter gating).
    if (cause !== undefined && payload.causeMatches !== undefined) {
      if (!payload.causeMatches(cause, payload.staticControllerSeat)) continue;
    }
    return false;
  }
  return true;
};

/**
 * True iff `cardId` may transform (CR 701.32). False iff any active
 * CantTransform static matches the card. Consumed by GameAction.transform
 * (multiface/transform.ts) BEFORE the face is toggled; on a match the
 * action no-ops silently (no Transformed event, no face change, no
 * layer-epoch bump).
 */
export const canTransform = (game: Game, cardId: EntityId): boolean => {
  const statics = game.staticEffectRegistry.byMode("CantTransform");
  for (const s of statics) {
    const payload = s.describe() as CantTransformPayload;
    if (payload.cardMatches(cardId, game)) return false;
  }
  return true;
};

// ─── Wave 70.E — CantGainLife / CantPlayLand ─────────────────────────────────

/**
 * True iff `seat` may gain life (CR 119). False iff any active CantGainLife
 * static matches the seat. Consumed by GameAction.changeLife when the delta
 * is positive (life-gain) — on a match the delta is rewritten to 0 BEFORE
 * the LifeChanged event is emitted, so downstream observers (Soul's
 * Attendant / Ajani's Pridemate / Crested Sunmare) do not observe a gain.
 *
 * Damage-induced life gain (e.g. Soul Sister's "whenever a creature ETBs,
 * you gain 1 life") routes through changeLife and is therefore covered
 * by the same gate. The Sulfuric Vortex / Roiling Vortex / Stigma Lasher
 * / Rampaging Ferocidon shapes (each player can't gain life) all consult
 * this helper.
 */
export const canGainLife = (game: Game, seat: PlayerSeat, sourceId?: EntityId): boolean => {
  const statics = game.staticEffectRegistry.byMode("CantGainLife");
  for (const s of statics) {
    const payload = s.describe() as CantGainLifePayload;
    if (!payload.playerMatches(seat)) continue;
    // Wave 97 — CantGainLifeFromSource$ source-conditional gate. When the
    // static omits FromSource$, sourceMatches trivially returns true and
    // the gate fires for every gain. When present, only matching sources
    // gate the gain; non-matching sources fall through.
    if (!payload.sourceMatches(sourceId, game)) continue;
    return false;
  }
  return true;
};

/**
 * True iff `seat` may play a land this turn (CR 305). False iff any active
 * CantPlayLand static matches the seat. Consumed by GameAction.playLand
 * BEFORE the zone change is initiated; on a match the action no-ops
 * silently (no LandPlayed event, no zone change, no drop counter
 * increment). The legal-action enumerator (Wave 50) likewise consults
 * this gate so the AI / UI never offers play-land as a legal action.
 *
 * Spell-effect land plays (AB$ Play with Land$ True) bypass this gate
 * by routing through `moveTo` directly rather than `playLand` — matches
 * Forge's "as a special action" carve-out (Restorm-style).
 */
export const canPlayLand = (game: Game, seat: PlayerSeat): boolean => {
  const statics = game.staticEffectRegistry.byMode("CantPlayLand");
  for (const s of statics) {
    const payload = s.describe() as CantPlayLandPayload;
    if (payload.playerMatches(seat)) return false;
  }
  return true;
};

// SPDX-License-Identifier: GPL-3.0-or-later
// Walk a Game's card registries and players, returning everything eligible
// per the given TargetRestriction. Used by both validateAtCast (source of
// truth for "is this legal") and future AI-driven target suggestion.
//
// The enumerate function does NOT consult the player's choice — it produces
// the complete eligibility set. validateAtCast then checks that the player's
// chosen targets are all members of that set.
//
// Wave 70.D — eligibility now consults CantTarget statics. Cards matched
// by an active CantTarget gate (against the source/activator/SA-kind
// tuple in the EnumerationContext) are dropped silently. Forge:
// `StaticAbilityCantTarget.cantTarget` is consulted before the candidate
// is added to the target list.
//
// Forge references:
//   - forge.game.ability.AbilityUtils#isValidTarget
//   - forge.game.spellability.TargetRestrictions#canTgtPlayer / canTgtCard
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import { isPhasedOut } from "../combat/damage-assignment-helpers.js";
import type { Game } from "../game.js";
import { canBeTargetedBy } from "../statics/wave70d-target-combat-gates.js";
import type { ControllerScope, TargetRef, TargetRestriction } from "./restriction.js";

/**
 * Context describing the source ability's identity — its source card and
 * controller — so enumeration can evaluate controller-scope and the
 * forbid-self-source rule.
 *
 * Wave 70.D — `saKind` is consulted by the CantTarget gate (CR 702.11
 * sub-shape ValidSA$ Spell / Activated). undefined treats the SA as
 * "any kind", which matches Forge's behaviour during early enumeration
 * before the SA is fully classified.
 */
export interface EnumerationContext {
  readonly sourceId: EntityId;
  readonly sourceControllerSeat: PlayerSeat;
  /** SA classification for CantTarget ValidSA$ filter. undefined → any. */
  readonly saKind?: "Spell" | "Activated" | "Triggered" | "Other";
}

/**
 * Return every TargetRef the given restriction admits, given current game
 * state. Caller-owned array; consumers may iterate freely.
 *
 * Walks `game.cards.values()` (all live Cards keyed by EntityId) and
 * `game.players` (seats) exactly once each — O(#cards + #players).
 * Characteristic-dependent filters (permitTypes, forbidTypes) consult
 * `game.layerEngine.computeCharacteristics`, which is cached per epoch, so
 * repeated enumerations in the same game state are cheap.
 */
export const enumerateEligibleTargets = (
  game: Game,
  ctx: EnumerationContext,
  r: TargetRestriction,
): readonly TargetRef[] => {
  const out: TargetRef[] = [];

  for (const card of game.cards.values()) {
    if (r.forbidSelfSource === true && card.id === ctx.sourceId) continue;
    if (!r.permitZones.has(card.zone)) continue;
    // CR 702.26e — phased-out permanents are invisible to most effects,
    // including targeting. Filter before the zone/controller checks so we
    // never surface a phased card to eligibility. SP3 will add a rare
    // "mayTargetPhased" restriction flag if any card in the data set turns
    // out to ignore phasing (none in the current Forge catalog).
    // Wave 54 — `isPhasedOut` consults BOTH `card.phased` (keyword Phasing)
    // and `card.phasedOut` (`SP$ Phases` direct phase-out, e.g. Teferi's
    // Veil) so both code paths gate identically.
    if (isPhasedOut(game, card.id)) continue;
    if (!matchesControllerScope(ctx.sourceControllerSeat, card.controllerSeat, r.controllerScope)) {
      continue;
    }
    // Shroud denies everyone, including the controller (CR 702.18).
    if (r.shroud === true) continue;
    // Hexproof denies opponents only (CR 702.11).
    if (r.hexproof === true && card.controllerSeat !== ctx.sourceControllerSeat) continue;

    // permitTypes / forbidTypes / forbidColors / forbidColorless require the
    // layered characteristics view — a card that "becomes a creature" via
    // Layer 4 should pass a Creature filter even though its base PaperCard
    // doesn't carry the type, and a green creature pumped to also-black
    // should be rejected by nonBlack. Compute chars once if any layered
    // filter is in play.
    const needsChars =
      r.permitTypes.size > 0 ||
      r.forbidTypes.size > 0 ||
      (r.forbidColors !== undefined && r.forbidColors.size > 0) ||
      r.forbidColorless === true;
    if (needsChars) {
      const chars = game.layerEngine.computeCharacteristics(card.id);
      if (r.permitTypes.size > 0) {
        let ok = false;
        for (const t of r.permitTypes) {
          if (chars.types.has(t)) {
            ok = true;
            break;
          }
        }
        if (!ok) continue;
      }
      if (r.forbidTypes.size > 0) {
        let forbidden = false;
        for (const t of r.forbidTypes) {
          if (chars.types.has(t)) {
            forbidden = true;
            break;
          }
        }
        if (forbidden) continue;
      }
      // Wave 12 — forbidColors: reject if the card carries ANY of the
      // forbidden colors (Forge: nonBlack disqualifies B, B/G, B/W, etc.).
      if (r.forbidColors !== undefined && r.forbidColors.size > 0) {
        let colorForbidden = false;
        for (const c of r.forbidColors) {
          if (chars.colors.has(c)) {
            colorForbidden = true;
            break;
          }
        }
        if (colorForbidden) continue;
      }
      // Wave 12 — forbidColorless: reject if the card has no colors at all.
      if (r.forbidColorless === true && chars.colors.size === 0) continue;
    }

    // Protection: SP2 doesn't have the keyword parser yet (SP3 lands with
    // the DSL + StaticEffectRegistry). The slot is reserved on the
    // restriction for forward compatibility; for now every card passes
    // the protection check by default.
    // WHY: intentional no-op so `protectionKeywords` documents the hook
    // without behaving as a silent allow-all filter that later-added
    // protection data would fail to consult. Consumers who need protection
    // checks before SP3 must lift this into a companion filter.

    // Wave 70.D — CantTarget gate (CR 702.11 sub-shape; True Believer /
    // Mother of Runes / Spectra Ward / Aether Membrane). The static
    // matches against the candidate target id AND the (sourceId,
    // activatorSeat, saKind) tuple in ctx. On match, the candidate
    // is dropped from eligibility silently — Forge equivalent of
    // `StaticAbilityCantTarget.cantTarget(...)` returning a non-null
    // gating static.
    if (
      !canBeTargetedBy(game, card.id, {
        sourceId: ctx.sourceId,
        activatorSeat: ctx.sourceControllerSeat,
        ...(ctx.saKind !== undefined ? { saKind: ctx.saKind } : {}),
      })
    ) {
      continue;
    }

    out.push({ kind: "card", id: card.id });
  }

  if (r.mayTargetPlayers) {
    for (const p of game.players) {
      if (!matchesControllerScope(ctx.sourceControllerSeat, p.seat, r.controllerScope)) continue;
      out.push({ kind: "player", seat: p.seat });
    }
  }

  return out;
};

const matchesControllerScope = (
  sourceSeat: PlayerSeat,
  candidateSeat: PlayerSeat,
  scope: ControllerScope,
): boolean => {
  switch (scope) {
    case "you":
      return candidateSeat === sourceSeat;
    case "opponent":
      return candidateSeat !== sourceSeat;
    case "any":
      return true;
    default: {
      const _: never = scope;
      throw new Error(`matchesControllerScope: unreachable ${JSON.stringify(_)}`);
    }
  }
};

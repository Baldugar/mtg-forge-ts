// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.D — CantTarget static handler. CR 702.11 (and related): pure
// negative target-permission gate. The matched cards may not be chosen
// as the target of spells/abilities matching the static's filter set.
//
// Forge cards using this:
//   - True Believer / Mother of Runes (creatures gain "can't be the
//     target of <X>")
//   - Spectra Ward / Shield of Duty and Reason (Aura adds "can't be
//     targeted by spells/abilities of color <X>")
//   - Suspicious Stowaway-style "can't be the target of Auras"
//   - Aether Membrane / Aetherflame Wall ("can't be the target of red
//     spells or abilities your opponents control")
//
// DSL examples (top-five shapes from corpus survey):
//   S:Mode$ CantTarget | ValidTarget$ Card.EnchantedBy | ValidSA$ Spell
//   S:Mode$ CantTarget | ValidTarget$ Card.Self | ValidSource$ Aura | ValidSA$ Spell
//   S:Mode$ CantTarget | ValidTarget$ Card.EnchantedBy | Activator$ Opponent
//   S:Mode$ CantTarget | AffectedZone$ Graveyard
//   S:Mode$ CantTarget | ValidTarget$ Card.Self | ValidSource$ Card.Black,Card.Red | ValidSA$ Spell | Activator$ Opponent
//
// What it does (Forge): the target-validation call sites
// (`StaticAbilityCantTarget.cantTarget`) walk every active CantTarget
// static and, on a ValidTarget$ + ValidSA$ + ValidSource$ + Activator$
// match, deny the targeting choice. If no static matches, the target
// is legal.
//
// Routing: cantMustMay category — the existing RestrictionKind union
// already exposes `cantTarget`. The describe() payload returns a
// concrete Restriction whose `subjectFilter` matches against the
// candidate target's id; the read-side helper (canBeTargetedBy in
// wave70-target-gate.ts) walks the registry per-query so the
// enumerateEligibleTargets pre-filter can drop matched candidates.
//
// MVP scope:
//   - ValidTarget$ <filter>            → cardMatchesFilter (Wave 32 grammar).
//   - ValidSource$ <filter>            → resolves against ctx source card id.
//   - Activator$ <player-filter>       → buildPlayerPredicate (Wave 50 grammar).
//   - ValidSA$ Spell / Activated / All → simple kind gate.
//   - Card.Self short-circuit honored (sourceCardId === cardId).
// Wave 100 — `AffectedZone$ <list>` is now respected (Card-in-Graveyard
// candidates no longer inherit the battlefield-only default). Each zone
// listed is honored; `All` widens to every zone game.cards tracks. The
// canonical "battlefield only" default holds when AffectedZone$ is
// omitted.
//
// TODO(advanced):
//   - SourceCanOnlyTarget$ — Enthralling Hold's narrow choose-clause
//     constraint at cast-time.
//   - Hexproof / Shroud-keyword sub-shapes — already handled by the
//     restriction.shroud/hexproof slots on TargetRestriction; CantTarget
//     here covers the bespoke text shapes that DON'T grant the keyword.
import type { EntityId, ParamValue, PlayerSeat, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { Restriction } from "../../statics/cant-must-may.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { parseAffectedZones } from "./affected-filter.js";
import { buildCardIdPredicate, buildPlayerPredicate, literalRaw } from "./restriction-helpers.js";

/**
 * The describe() payload exposes the four match predicates plus a
 * "kind: SpellAbility" classifier so the read-side helper can supply
 * the casting context without fabricating fake Restrictions per query.
 */
export interface CantTargetPayload {
  readonly kind: "cantTargetExtended";
  /** True iff the candidate target card matches the static's ValidTarget$ filter. */
  readonly targetMatches: (cardId: EntityId, game: Game) => boolean;
  /** True iff the casting source card matches the static's ValidSource$ filter. */
  readonly sourceMatches: (cardId: EntityId, game: Game) => boolean;
  /** True iff the activating player matches the static's Activator$ filter. */
  readonly activatorMatches: (seat: PlayerSeat) => boolean;
  /** True iff the SA "kind" matches ValidSA$ (Spell / Activated / All). */
  readonly saKindMatches: (saKind: "Spell" | "Activated" | "Triggered" | "Other") => boolean;
  /**
   * Wave 100 — set of zones the candidate target's card must currently
   * be in for the gate to fire. Undefined → battlefield-only (Wave 70.D
   * default); `"all"` matches every zone; an explicit Set narrows.
   */
  readonly affectedZones: ReadonlySet<ZoneType> | "all" | undefined;
}

const matchValidSA = (raw: string | undefined) => {
  if (raw === undefined || raw.length === 0) return () => true;
  // Forge's ValidSA grammar admits "Spell" (object on the stack that's a
  // spell), "Activated" (activated ability), "Triggered" (triggered ability),
  // "All" (any). Compose via a simple includes check.
  if (raw === "Spell") return (k: "Spell" | "Activated" | "Triggered" | "Other") => k === "Spell";
  if (raw === "Activated") return (k: "Spell" | "Activated" | "Triggered" | "Other") => k === "Activated";
  if (raw === "Triggered") return (k: "Spell" | "Activated" | "Triggered" | "Other") => k === "Triggered";
  if (raw === "All" || raw === "Any") return () => true;
  // Any other literal: conservative reject (MVP).
  return () => false;
};

export class CantTargetStaticHandler extends StaticHandler {
  static override readonly mode = "CantTarget" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;

    const validTargetRaw = literalRaw(params.ValidTarget) ?? "Card";
    const validSourceRaw = literalRaw(params.ValidSource);
    const activatorRaw = literalRaw(params.Activator);
    const validSARaw = literalRaw(params.ValidSA);
    // Wave 100 — `AffectedZone$ <list>` is honored (default
    // battlefield-only); `All` widens to every zone (rare); an explicit
    // list narrows (Card-in-Graveyard targeting protections, e.g.
    // Vigilance for the Dead).
    const affectedZones = parseAffectedZones(literalRaw(params.AffectedZone)) ?? undefined;

    const targetPred = buildCardIdPredicate(validTargetRaw, ctx.sourceCardId, ctx.controllerSeat);
    // ValidSource undefined → match any source.
    const sourcePred =
      validSourceRaw === undefined
        ? () => true
        : buildCardIdPredicate(validSourceRaw, ctx.sourceCardId, ctx.controllerSeat);
    const activatorPred = buildPlayerPredicate(activatorRaw, ctx.controllerSeat);
    const saKindPred = matchValidSA(validSARaw);

    // Wave 100 — wrap the target predicate with the AffectedZone$ gate.
    // The default (undefined) preserves the canonical battlefield-only
    // restriction (Wave 70.D); explicit zones widen / narrow.
    const targetMatchesGated = (cardId: EntityId, game: Game): boolean => {
      const card = game.cards.get(cardId);
      if (!card) return false;
      if (affectedZones === "all") {
        // Every zone in scope.
      } else if (affectedZones !== undefined) {
        if (!affectedZones.has(card.zone)) return false;
      } else if (card.zone !== ZoneType.Battlefield) {
        return false;
      }
      return targetPred(cardId, game);
    };

    const payload: CantTargetPayload = {
      kind: "cantTargetExtended",
      targetMatches: (cardId, game) => targetMatchesGated(cardId, game),
      sourceMatches: (cardId, game) => sourcePred(cardId, game),
      activatorMatches: (seat) => activatorPred(seat),
      saKindMatches: (k) => saKindPred(k),
      affectedZones,
    };

    // Concretely surface a generic Restriction so the existing
    // gatherRestrictions("cantTarget") sweep also sees it. The
    // subjectFilter here only encodes the target-side predicate; the
    // SOURCE/ACTIVATOR/SA filters require full context (provided via
    // the canBeTargetedBy helper that reads the payload directly).
    const restriction: Restriction = {
      sourceStaticId: ctx.staticId,
      kind: "cantTarget",
      subjectFilter: (subjectId, game) => {
        if (typeof subjectId !== "number" && typeof subjectId !== "object") {
          // PlayerSeat — players can't be filtered by ValidTarget$ Card.X.
          return false;
        }
        return targetMatchesGated(subjectId as EntityId, game);
      },
      payload,
    };

    const activeInZones = normalizeActiveInZones(ast.activeInZones);
    return {
      id: ctx.staticId,
      kind: "static",
      sourceCardId: ctx.sourceCardId,
      activeInZones,
      timestamp: ctx.game.newEntityId(),
      controllerSeatAtReg: ctx.controllerSeat,
      category: "cantMustMay",
      mode: "CantTarget",
      describe: () => restriction,
    };
  }
}

staticHandlerRegistry.register(CantTargetStaticHandler);

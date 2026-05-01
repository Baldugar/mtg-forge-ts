// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 50 — CantBeActivated static handler. Linvala (Mode$ CantBeActivated
// | ValidCard$ Card.OppCtrl | ValidSA$ Mana) and Pithing Needle ("activated
// abilities of the named permanent can't be activated"). The static
// matches against the permanent whose ability is being activated; the
// activation legality check (legal-action-enumerator) consults
// isRestricted("cantActivate", cardId).
//
// Routing: cantMustMay static, restriction kind = cantActivate. The
// existing `cantActivate` RestrictionKind already exists; this handler
// hooks into it.
//
// Wave 106 — closed the prior `// TODO(advanced)` for ValidSA$ kind
// discrimination. The payload now exposes a `matchesAbilityKind(kind)`
// predicate alongside the raw `validSAKind` string. The predicate
// honors the canonical Forge tokens — "Mana" (CR 605.1 mana abilities),
// "Loyalty" (CR 606.4 planeswalker activations), and "Activated"
// (every activated kind, the catch-all). When ValidSA$ is absent the
// predicate is permissive (matches every kind), preserving Linvala's
// "all activated abilities" / Pithing-Needle "named permanent's
// activations" semantics. The legal-action-enumerator wiring still
// lives in SP3 (the enumerator currently stops at castSpell — see
// priority/legal-action-enumerator.ts SP3 WIRING comment); when it
// lights up the activated-ability branch, it consults this predicate
// against each enumerated ability's kind to suppress the matching
// subset.
import type { EntityId, ParamValue, PlayerSeat, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Restriction } from "../../statics/cant-must-may.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, buildPlayerPredicate, literalRaw } from "./restriction-helpers.js";

/**
 * Activated-ability kinds the cantActivate gate may target. Mirrors
 * Forge's StaticAbilityCantBeActivated token enumeration.
 */
export type CantActivateAbilityKind = "Mana" | "Loyalty" | "Activated" | "NonMana";

export interface CantBeActivatedAuxPayload {
  /** Raw ValidSA$ filter string (preserved for diagnostic / replay surfaces). */
  readonly validSAKind: string | undefined;
  /**
   * True iff an activated ability of the given kind is suppressed by this
   * gate. Permissive (always-true) when ValidSA$ is absent. The "Activated"
   * token is a catch-all; "Mana" / "Loyalty" target their narrower kinds;
   * "NonMana" matches every kind except "Mana".
   */
  readonly matchesAbilityKind: (kind: CantActivateAbilityKind) => boolean;
}

const buildAbilityKindMatcher = (raw: string | undefined): ((kind: CantActivateAbilityKind) => boolean) => {
  if (raw === undefined || raw.length === 0) return () => true;
  // Comma-OR alternatives: any matches the union.
  if (raw.includes(",")) {
    const tokens = raw
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const matchers = tokens.map(buildAbilityKindMatcher);
    return (kind) => matchers.some((m) => m(kind));
  }
  if (raw === "Activated") return () => true;
  if (raw === "Mana") return (kind) => kind === "Mana";
  if (raw === "Loyalty") return (kind) => kind === "Loyalty";
  if (raw === "NonMana") return (kind) => kind !== "Mana";
  // Conservative reject for unrecognised tokens (matches Wave-50
  // fail-closed default for the player predicate). Future Forge tokens
  // (Triggered, Spell, etc.) flow through the same shape.
  return () => false;
};

export class CantBeActivatedStaticHandler extends StaticHandler {
  static override readonly mode = "CantBeActivated" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validCardRaw = literalRaw(params.ValidCard) ?? "Card";
    const activatorRaw = literalRaw(params.ValidActivator) ?? literalRaw(params.Activator);
    const validSARaw = literalRaw(params.ValidSA);

    const cardPred = buildCardIdPredicate(validCardRaw, ctx.sourceCardId, ctx.controllerSeat);
    const seatPred = buildPlayerPredicate(activatorRaw, ctx.controllerSeat);

    const matchesAbilityKind = buildAbilityKindMatcher(validSARaw);
    const restriction: Restriction = {
      sourceStaticId: ctx.staticId,
      kind: "cantActivate",
      subjectFilter: (id, game) => cardPred(id as EntityId, game),
      auxFilter: (seat) => seatPred(seat as PlayerSeat),
      payload: { validSAKind: validSARaw, matchesAbilityKind } satisfies CantBeActivatedAuxPayload,
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
      mode: "CantBeActivated",
      describe: () => restriction,
    };
  }
}

staticHandlerRegistry.register(CantBeActivatedStaticHandler);

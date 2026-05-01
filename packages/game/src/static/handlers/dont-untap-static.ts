// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 60 — DontUntap static handler. Stasis-style "permanents don't
// untap during their controller's untap step". Examples:
//
//   S:Mode$ DontUntap | ValidCard$ Permanent       (Stasis)
//   S:Mode$ DontUntap | ValidCard$ Creature.YouCtrl
//
// Routing: cantMustMay category, restriction kind = `cantUntap` (an
// existing RestrictionKind in cant-must-may.ts). The phase-handler's
// untap-step loop consults `isRestricted(game, "cantUntap", cardId)`
// before invoking `action.untap`; matching cards are silently skipped.
//
// MVP — the basic ValidCard$ filter is the durable contract. Forge's
// Stasis text reads "Permanents don't untap during their controllers'
// untap steps" without any per-controller carve-out for whose step it
// is, so the simplest model (skip the untap if any DontUntap active
// matches the card) is correct for Stasis itself.
//
// Wave 100 — counted-allowance: the `MaxUntap$ N` sub-param installs a
// per-controller cap on how many matching cards may untap during the
// canonical untap step (Static Orb / Smoke / Winter Orb-land shape). The
// gate-helper `untapAllowance(game, cardId, controller)` consults the
// active DontUntap statics and returns the remaining quota; the untap
// loop calls `consumeUntapAllowance` after a successful untap to deduct
// from the quota. When the quota is zero the matched card stays tapped.
//
// MaxUntap$ omitted preserves Wave 60 behavior: the matched card simply
// can't untap (the cantUntap restriction wins). MaxUntap$ N flips the
// semantics to "this many MAY untap" — exactly the Forge model.
//
// NOTE: Frozen Aether is "permanents enter tapped" (a different
// replacement effect, not DontUntap). See destroy-all.ts comment for
// the analogous note on Wrath-of-God-style effects vs regen-shields.
import type { EntityId, ParamValue, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Restriction } from "../../statics/cant-must-may.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

/**
 * Wave 100 — payload exposed alongside the cantUntap Restriction so the
 * gate-helper can read the counted-allowance contract uniformly. The
 * canonical Restriction is still emitted (so `isRestricted` integrates
 * with the existing untap loop fail-closed default); MaxUntap$ N
 * flips the gate to a per-controller quota.
 */
export interface DontUntapPayload {
  readonly kind: "dontUntap";
  /** True iff `cardId` matches the static's ValidCard$ filter. */
  readonly cardMatches: (cardId: EntityId, game: { cards: ReadonlyMap<EntityId, unknown> }) => boolean;
  /**
   * `MaxUntap$ N` — quota of matching cards that MAY untap during the
   * canonical untap step. Undefined → no quota (the cantUntap restriction
   * fully blocks the matched cards, matching Wave 60's Stasis shape).
   */
  readonly maxUntap: number | undefined;
}

export class DontUntapStaticHandler extends StaticHandler {
  static override readonly mode = "DontUntap" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validRaw = literalRaw(params.ValidCard) ?? "Card.Self";
    const pred = buildCardIdPredicate(validRaw, ctx.sourceCardId, ctx.controllerSeat);
    const maxUntapRaw = literalRaw(params.MaxUntap);
    const maxUntap =
      maxUntapRaw === undefined
        ? undefined
        : (() => {
            const n = Number.parseInt(maxUntapRaw, 10);
            return Number.isFinite(n) && n >= 0 ? n : undefined;
          })();

    const payload: DontUntapPayload = {
      kind: "dontUntap",
      cardMatches: (id) => pred(id, ctx.game),
      maxUntap,
    };

    const restriction: Restriction = {
      sourceStaticId: ctx.staticId,
      kind: "cantUntap",
      // The runtime hands subjectFilter an EntityId | PlayerSeat union;
      // for DontUntap the consumer (untap loop) only ever passes a card
      // id, so the inner buildCardIdPredicate cast is safe. When MaxUntap$
      // N is set the untap loop is expected to consult the gate-helper
      // FIRST and only fall through to this Restriction when the quota
      // is exhausted; without a quota the Restriction always wins.
      subjectFilter: (id, game) => pred(id as EntityId, game),
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
      mode: "DontUntap",
      describe: () => restriction,
    };
  }
}

staticHandlerRegistry.register(DontUntapStaticHandler);

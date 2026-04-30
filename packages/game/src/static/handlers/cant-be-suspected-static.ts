// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 76 — CantBeSuspected static handler. CR — Suspect mechanic
// (March of the Machine block / MTR set). Forge's
// StaticAbilityCantBeSuspected.java equivalent.
//
// Forge cards using this shape (~1 card in corpus): cards that grant
// matched permanents immunity to becoming "suspected". Suspect is a
// status modifier, not a counter — applied via AB$ Suspect / TR$
// Suspect, mirrored by AdjustSuspect / Trigger$ on the matching card.
//
// DSL (corpus):
//   S:Mode$ CantBeSuspected | ValidCard$ <filter> | Description$ ...
//
// What it does (Forge): consulted at the suspect-application call
// site. When ValidCard$ matches the card being suspected, the
// suspect transition is rejected silently — no Suspect status
// stamped, no SuspectGained event emitted. Mirrors Wave 70.O's
// CantPhaseIn / Wave 75's CantExile silent-rejection pattern.
//
// Routing: replacementGenerating per MODE_TO_CATEGORY. The
// replacements list is empty; the gate is enforced at the future
// suspect-application call site rather than via a derived
// replacement chain.
//
// MVP scope: forward-compat stub. Our codebase has no Suspect
// mechanic infra yet — there is no per-card `suspected` flag, no
// AB$ Suspect / TR$ Suspect handler, no SuspectGained event. The
// static still registers (so ports of cards with this S: line
// don't break the parser) and the `canBeSuspected` helper is
// exposed so the future Suspect pipeline can read it uniformly.
// TODO(advanced) — wire into the Suspect application gate once the
// Suspect mechanic lands.
import type { EntityId, ParamValue, ReplacementAbility, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { ReplacementGenPayload } from "../../statics/replacement-generating.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

export interface CantBeSuspectedPayload extends ReplacementGenPayload {
  readonly cardMatches: (cardId: EntityId, game: Game) => boolean;
}

export class CantBeSuspectedStaticHandler extends StaticHandler {
  static override readonly mode = "CantBeSuspected" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validCardRaw = literalRaw(params.ValidCard) ?? "Card.Self";
    const pred = buildCardIdPredicate(validCardRaw, ctx.sourceCardId, ctx.controllerSeat);

    const payload: CantBeSuspectedPayload = {
      kind: "replacementGen",
      replacements: [] as readonly ReplacementAbility[],
      cardMatches: (cardId, game) => pred(cardId, game),
    };

    const activeInZones = normalizeActiveInZones(ast.activeInZones);
    return {
      id: ctx.staticId,
      kind: "static",
      sourceCardId: ctx.sourceCardId,
      activeInZones,
      timestamp: ctx.game.newEntityId(),
      controllerSeatAtReg: ctx.controllerSeat,
      category: "replacementGenerating",
      mode: "CantBeSuspected",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(CantBeSuspectedStaticHandler);

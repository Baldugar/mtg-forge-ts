// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 60 — CantPutCounter static handler. Solemnity / Hushwood Verge /
// Phyrexian Unlife / Decree of Silence — "counters can't be put on
// {ValidCard}". CR 614.5 (the family of "X can't have counters put on
// it" effects). Examples:
//
//   S:Mode$ CantPutCounter | ValidCard$ Card.YouCtrl | CounterType$ Any
//   S:Mode$ CantPutCounter | ValidCard$ You         | CounterType$ M1M1
//
// Routing: replacementGenerating category — the consumer (game-action's
// addCounter generator) consults `canPutCounter` on every counter-add
// attempt. When any active CantPutCounter static matches, the addCounter
// short-circuits silently (no event fires) — Forge mirrors this by
// dropping the intent before the replacement chain runs.
//
// Subject conventions:
//   - ValidCard$ Card.Self       → cardId === sourceCardId
//   - ValidCard$ <type/subtype>  → cardMatchesFilter (Wave 32 grammar)
//   - ValidPlayer$ <filter>      → Wave 101: player-subject filter for
//                                    Phyrexian Unlife / Melira (poison
//                                    counters) / Solphim, Mayhem Dominus
//                                    style "counters can't be put on
//                                    {player}" effects. Defaults to no
//                                    match (preserves Wave 60 contract
//                                    when the param is omitted).
//   - CounterType$ Any (or omitted) → matches every counter type
//   - CounterType$ <name>        → exact CounterType-enum match
//
// Wave 101 closes the prior `// TODO(advanced)` for player-side gating.
// `cantPutCounterOnPlayer(game, seat, counterType)` consults the registry
// uniformly, mirroring `cantPutCounterOnCard`.
import type {
  CounterType,
  EntityId,
  ParamValue,
  PlayerSeat,
  ReplacementAbility,
  StaticAbility,
  StaticAst,
} from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { ReplacementGenPayload } from "../../statics/replacement-generating.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, buildPlayerPredicate, literalRaw } from "./restriction-helpers.js";

// Payload extends the replacementGen envelope (mandatory for the
// replacementGenerating category contract) with two extra predicates the
// `canPutCounter` query helper reads via byMode("CantPutCounter"). The
// `replacements` slot is intentionally empty — the gate is enforced at
// the addCounter call site rather than via a derived replacement chain,
// matching Forge's behavior of dropping the intent silently before any
// replacement runs.
export interface CantPutCounterPayload extends ReplacementGenPayload {
  readonly cardMatches: (cardId: EntityId, game: Game) => boolean;
  readonly counterMatches: (ct: CounterType) => boolean;
  /**
   * Wave 101 — true iff `seat` matches the static's `ValidPlayer$`
   * filter. Defaults to false when the static's subject is a card
   * (no `ValidPlayer$` set), preserving the Wave-60 default. Phyrexian
   * Unlife / Melira / Solphim shapes set ValidPlayer$ and consult the
   * gate via `cantPutCounterOnPlayer`.
   */
  readonly playerMatches: (seat: PlayerSeat) => boolean;
  /** True iff this static targets a player (ValidPlayer$ set). */
  readonly hasPlayerSubject: boolean;
}

const buildCounterPredicate = (raw: string | undefined): ((ct: CounterType) => boolean) => {
  if (raw === undefined || raw.length === 0 || raw === "Any") return () => true;
  // Forge writes counter-type tokens in many shapes (P1P1, M1M1, Charge,
  // +1/+1, -1/-1). Normalize via lowercase + strip non-alphanumerics so
  // "P1P1" / "+1/+1" / "p1p1" all collide on the same key.
  const normalize = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  // P1P1 → CounterType.PlusOnePlusOne (string value "+1/+1") → "11" after normalize.
  // Special-case the +1/+1 / -1/-1 tokens because their CounterType string
  // values include the slashes which the normalize above strips.
  const target = (() => {
    if (raw === "P1P1" || raw === "+1/+1") return "p1p1";
    if (raw === "M1M1" || raw === "-1/-1") return "m1m1";
    return normalize(raw);
  })();
  return (ct) => {
    const key = (() => {
      if (ct === ("+1/+1" as CounterType)) return "p1p1";
      if (ct === ("-1/-1" as CounterType)) return "m1m1";
      return normalize(ct);
    })();
    return key === target;
  };
};

export class CantPutCounterStaticHandler extends StaticHandler {
  static override readonly mode = "CantPutCounter" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validCardRaw = literalRaw(params.ValidCard) ?? "Card";
    const counterRaw = literalRaw(params.CounterType);
    const validPlayerRaw = literalRaw(params.ValidPlayer);

    const cardPred = buildCardIdPredicate(validCardRaw, ctx.sourceCardId, ctx.controllerSeat);
    const counterPred = buildCounterPredicate(counterRaw);
    const hasPlayerSubject = validPlayerRaw !== undefined && validPlayerRaw.length > 0;
    const playerPred = hasPlayerSubject
      ? buildPlayerPredicate(validPlayerRaw, ctx.controllerSeat)
      : () => false;

    const payload: CantPutCounterPayload = {
      kind: "replacementGen",
      replacements: [] as readonly ReplacementAbility[],
      cardMatches: (cardId, game) => cardPred(cardId, game),
      counterMatches: counterPred,
      playerMatches: (seat) => playerPred(seat),
      hasPlayerSubject,
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
      mode: "CantPutCounter",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(CantPutCounterStaticHandler);

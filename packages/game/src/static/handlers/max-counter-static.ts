// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.M — MaxCounter static handler. Forge's
// StaticAbilityMaxCounter.maxCounter — caps the number of counters of
// a particular type that may exist on the matched card. Adding
// counters past the cap is silently clamped to the cap (no event for
// the surplus, no replacement chain runs).
//
// Forge cards using this (1 card in corpus):
//   - Rasputin Dreamweaver  ("CARDNAME can't have more than seven
//                              dream counters on it.")
//
// DSL example (corpus):
//   S:Mode$ MaxCounter | ValidCard$ Card.Self | CounterType$ DREAM
//                      | MaxNum$ 7
//
// What it does (Forge): consulted at addCounter time. When the card
// matches ValidCard$ AND the counter type matches CounterType$ (or
// CounterType$ is omitted → Any), and the resulting (current +
// requested) count would exceed MaxNum$, the requested amount is
// reduced so the post-add count equals MaxNum$. When MaxNum$ matches
// the existing count exactly, the addCounter no-ops silently.
//
// Routing: replacementGenerating per MODE_TO_CATEGORY (Forge's
// canonical category — MaxCounter generates a replacement that
// caps the AddCounterIntent's amount). MVP-mode here uses the
// registry-walk pattern (Wave 70.D-L) — `maxCounter(game, cardId,
// counterType)` returns the lowest active cap among matching gates,
// or undefined when none apply.
import type {
  CounterType,
  EntityId,
  ParamValue,
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
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

export interface MaxCounterPayload extends ReplacementGenPayload {
  readonly cardMatches: (cardId: EntityId, game: Game) => boolean;
  /** True iff the counter type matches the gate's CounterType$ filter. */
  readonly counterMatches: (counterType: CounterType) => boolean;
  /** Numeric cap (MaxNum$) — pre-resolved at build time. */
  readonly maxNum: number;
}

const parseCounterType = (raw: string | undefined): ((c: CounterType) => boolean) => {
  if (raw === undefined || raw.length === 0 || raw === "Any") return () => true;
  // Forge counter token is uppercase ("DREAM", "P1P1", "M1M1"). The
  // engine's CounterType enum uses Pascal/Title-cased names ("Dream",
  // "P1P1", "M1M1"). Compare case-insensitively to stay forgiving.
  const want = raw.toLowerCase();
  return (c: CounterType) => (c as string).toLowerCase() === want;
};

export class MaxCounterStaticHandler extends StaticHandler {
  static override readonly mode = "MaxCounter" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validCardRaw = literalRaw(params.ValidCard) ?? "Card.Self";
    const counterTypeRaw = literalRaw(params.CounterType);
    const maxNumRaw = literalRaw(params.MaxNum) ?? "0";
    const maxNum = Number.parseInt(maxNumRaw, 10);

    const cardPred = buildCardIdPredicate(validCardRaw, ctx.sourceCardId, ctx.controllerSeat);
    const counterPred = parseCounterType(counterTypeRaw);

    const payload: MaxCounterPayload = {
      kind: "replacementGen",
      replacements: [] as readonly ReplacementAbility[],
      cardMatches: (cardId, game) => cardPred(cardId, game),
      counterMatches: (c) => counterPred(c),
      maxNum: Number.isFinite(maxNum) ? maxNum : 0,
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
      mode: "MaxCounter",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(MaxCounterStaticHandler);

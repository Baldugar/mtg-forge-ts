// SPDX-License-Identifier: GPL-3.0-or-later
// Surge — alternative casting cost from the hand that is only available
// if the controller or a teammate has cast another spell this turn (Oath
// of the Gatewatch, CR 702.117).
//
// CR 702.117a — "Surge [cost]" — "You may cast this spell for its surge
// cost if you or a teammate has cast another spell this turn."
//
// DSL form in card definitions:
//   K:Surge:R         → surge cost is {R}
//   K:Surge:1 W       → surge cost is {1}{W}
//
// MVP scope:
//   - isAvailable: card in Hand with K:Surge AND game.flags.spellsCast
//     this turn ≥ 1 (controller-only check; teammate check is
//     TODO(advanced) — multiplayer-only).
//   - modifyCastContext: stamp altCostUsed = "Surge", replace
//     totalCost.base, set `card.surgePaid = true`.
import type { KeywordAst, ParamValue } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { SpellAbility } from "../ability/spell-ability.js";
import type { Card } from "../card.js";
import type { CastContext } from "../cast/cast-context.js";
import type { Game } from "../game.js";
import type { AltCost } from "../registries/alt-cost-registry.js";
import { altCostRegistry } from "../registries/alt-cost-registry.js";

const extractSurgeCost = (card: Card): string | null => {
  const def = card.paperCard.definition;
  if (!def) return null;
  const keywords = def.keywords as readonly KeywordAst[] | undefined;
  if (!keywords) return null;
  const kw = keywords.find((k) => k.keyword === "surge");
  if (!kw) return null;
  const costParam = kw.params?.cost as ParamValue | undefined;
  if (!costParam || costParam.kind !== "literal") return null;
  return (costParam.raw as string) || "0";
};

const controllerCastSpellsThisTurn = (card: Card, game: Game): number => {
  // Read game.flags.spellsCastThisTurn[seat] if available; tolerate absence.
  const flags = game.flags as unknown as {
    spellsCastThisTurn?: Map<number, number> | ReadonlyMap<unknown, number>;
  };
  if (!flags.spellsCastThisTurn) return 0;
  const seatRaw = card.controllerSeat as unknown;
  return (flags.spellsCastThisTurn as ReadonlyMap<unknown, number>).get(seatRaw) ?? 0;
};

export const Surge: AltCost = {
  handlerKey: "Surge",

  isAvailable(card: Card, game: Game): boolean {
    if (card.zone !== ZoneType.Hand) return false;
    if (extractSurgeCost(card) === null) return false;
    // Need ≥ 1 prior spell this turn by controller (MVP). The full
    // teammate-check is TODO(advanced).
    return controllerCastSpellsThisTurn(card, game) >= 1;
  },

  modifyCastContext(ctx: CastContext, _sa: SpellAbility, game: Game): void {
    const card = game.cards.get(ctx.sourceCardId);
    if (!card) return;
    const cost = extractSurgeCost(card);
    if (cost === null) return;
    (ctx as { altCostUsed: string | null }).altCostUsed = "Surge";
    (ctx as { totalCost: unknown }).totalCost = { base: { raw: cost } };
    card.surgePaid = true;
  },
};

altCostRegistry.register(Surge);

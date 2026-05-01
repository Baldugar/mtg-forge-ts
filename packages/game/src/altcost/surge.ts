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
// Scope (Wave 106 — closes the prior teammate-check TODO(advanced)):
//   - isAvailable: card in Hand with K:Surge AND ≥ 1 spell already cast
//     this turn by either the controller OR any teammate (same teamId).
//     The teammate sweep walks game.players and unions per-seat
//     spellsCastThisTurn counts for matching teamIds. In two-player
//     duel games (the canonical case), every player has a unique
//     teamId so the sweep degenerates to the controller-only check —
//     the prior MVP behavior is preserved exactly.
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

/**
 * Wave 106 — sum spellsCastThisTurn across the controller AND any
 * teammates (same teamId). Falls back to the controller-only count when
 * the team registry is unavailable, preserving the Wave-58 MVP shape.
 */
const teamCastSpellsThisTurn = (card: Card, game: Game): number => {
  const flags = game.flags as unknown as {
    spellsCastThisTurn?: ReadonlyMap<unknown, number>;
  };
  if (!flags.spellsCastThisTurn) return 0;
  const counts = flags.spellsCastThisTurn;
  const controllerSeat = card.controllerSeat as unknown;
  const players = (game as unknown as { players?: readonly { seat: unknown; teamId: number }[] }).players;
  if (!players || players.length === 0) {
    return counts.get(controllerSeat) ?? 0;
  }
  const controllerEntry = players.find((p) => p.seat === controllerSeat);
  if (!controllerEntry) return counts.get(controllerSeat) ?? 0;
  const team = controllerEntry.teamId;
  let total = 0;
  for (const p of players) {
    if (p.teamId !== team) continue;
    total += counts.get(p.seat) ?? 0;
  }
  return total;
};

export const Surge: AltCost = {
  handlerKey: "Surge",

  isAvailable(card: Card, game: Game): boolean {
    if (card.zone !== ZoneType.Hand) return false;
    if (extractSurgeCost(card) === null) return false;
    // Wave 106 — controller + teammate sweep (CR 702.117a "you or a
    // teammate"). In duel games each seat has a unique teamId so this
    // degenerates to the controller-only check; in 2-Headed Giant /
    // Archenemy / Conspiracy modes the union is consulted.
    return teamCastSpellsThisTurn(card, game) >= 1;
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

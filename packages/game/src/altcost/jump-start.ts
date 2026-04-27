// SPDX-License-Identifier: GPL-3.0-or-later
// Jump-Start — alternative casting cost from the graveyard with an
// additional Discard-a-Card cost (Guilds of Ravnica, CR 702.139).
//
// CR 702.139a — "Jump-start. You may cast this card from your graveyard
// by discarding a card in addition to paying its other costs. Then
// exile this card."
//
// DSL form in card definitions:
//   K:Jump-Start          → no parameters. The card retains its printed
//                           mana cost; the only delta is the additional
//                           Discard cost and the exile-on-resolve.
//
// MVP scope (mirrors Aftermath structure — graveyard cast that does
// not replace the mana cost, only adds Discard and exiles after):
//   - isAvailable: card sits in Graveyard AND its definition carries
//     the "jump_start" keyword.
//   - modifyCastContext:
//       - leave the printed mana cost in place (the cast pipeline's
//         stepDetermineTotalCost reads the printed cost off the
//         definition);
//       - mark altCostUsed = "JumpStart";
//       - set alternativeZoneDestination = Exile (CR 702.139a "then
//         exile this card");
//       - the additional Discard<1/Card> cost is documented under
//         TODO(advanced); the mana-cost addition is a CostMana augment
//         that SP3's cost-pipeline confirmAction loop covers when the
//         multi-part-cost APIs are wired through.
//
// TODO(advanced) — Splice the "Discard a card" additional cost into the
// total-cost computation. The cost pipeline's stepDetermineTotalCost
// reads `card.kickerCost` / `card.multikickerCost` for confirm-action
// loops; jump-start's additional discard belongs alongside those slots.
// The post-resolution exile-routing is the durable contract; the
// additional cost wiring is incremental.
import type { KeywordAst } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { SpellAbility } from "../ability/spell-ability.js";
import type { Card } from "../card.js";
import type { CastContext } from "../cast/cast-context.js";
import type { Game } from "../game.js";
import type { AltCost } from "../registries/alt-cost-registry.js";
import { altCostRegistry } from "../registries/alt-cost-registry.js";

const hasJumpStart = (card: Card): boolean => {
  const def = card.paperCard.definition;
  if (!def) return false;
  const keywords = def.keywords as readonly KeywordAst[] | undefined;
  if (!keywords) return false;
  return keywords.some((k) => k.keyword === "jump_start" || k.keyword === "jump-start");
};

export const JumpStart: AltCost = {
  handlerKey: "JumpStart",

  isAvailable(card: Card, _game: Game): boolean {
    if (card.zone !== ZoneType.Graveyard) return false;
    return hasJumpStart(card);
  },

  modifyCastContext(ctx: CastContext, _sa: SpellAbility, _game: Game): void {
    // Jump-Start does not replace the mana cost; the spell pays its
    // printed cost (plus the additional discard, TODO(advanced)).
    (ctx as { altCostUsed: string | null }).altCostUsed = "JumpStart";
    // CR 702.139a — exile after resolving (mirrors Flashback).
    (ctx as { alternativeZoneDestination: ZoneType | undefined }).alternativeZoneDestination = ZoneType.Exile;
  },
};

altCostRegistry.register(JumpStart);

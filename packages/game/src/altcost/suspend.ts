// SPDX-License-Identifier: GPL-3.0-or-later
// Suspend — alternative casting cost from Exile, AFTER the suspend special-
// action has stamped `card.suspendedCounters = N` and the upkeep tick has
// drained it to 0.
//
// CR 702.61c — "When the last time counter is removed from a card with
// suspend, if it's exiled, its owner plays it without paying its mana cost.
// If they can't, it remains exiled."
//
// DSL form: K:Suspend:N:cost (parsed by keyword-line.ts).
//
// Scope of THIS handler: the alt-cost arm — given a suspended card in Exile
// whose counters have ticked to 0, let the owner cast it for FREE. The
// special-action arm (Hand → Exile + stamp counters + pay suspend cost) is
// the synthesized hand-zone activated ability in
// keyword/handlers/suspend-keyword.ts via SuspendEffect.
//
// isAvailable:
//   - Card must be in the Exile zone.
//   - card.suspendedCounters must be defined and equal to 0 (drained).
//   - The card must declare the suspend keyword.
//
// modifyCastContext:
//   - Sets ctx.altCostUsed = "Suspend".
//   - Sets ctx.totalCost.base.raw = "" (free cast).
//   - Routes the post-resolution destination:
//       - permanent spells → Battlefield (CR 608.3a).
//       - non-permanent spells → Graveyard (CR 608.2g, Madness/Flashback
//         pattern when casting from Exile).
//   - Stamps `card.hasteFromSuspend = true` so combat-time has-haste reads
//     can grant haste until the card next leaves the battlefield.
import type { CardDefinition, KeywordAst } from "@mtg-forge-ts/core";
import { CARD_TYPE_IS_PERMANENT, type CardType, ZoneType } from "@mtg-forge-ts/core";
import type { SpellAbility } from "../ability/spell-ability.js";
import type { Card } from "../card.js";
import type { CastContext } from "../cast/cast-context.js";
import type { Game } from "../game.js";
import type { AltCost } from "../registries/alt-cost-registry.js";
import { altCostRegistry } from "../registries/alt-cost-registry.js";

const hasSuspendKeyword = (card: Card): boolean => {
  const def = card.paperCard.definition;
  if (!def) return false;
  const keywords = def.keywords as readonly KeywordAst[] | undefined;
  if (!keywords) return false;
  return keywords.some((k) => k.keyword === "suspend");
};

const definitionIsPermanent = (def: CardDefinition): boolean => {
  for (const t of def.types.types) {
    if (CARD_TYPE_IS_PERMANENT[t as CardType]) return true;
  }
  return false;
};

export const Suspend: AltCost = {
  handlerKey: "Suspend",

  isAvailable(card: Card, _game: Game): boolean {
    if (card.zone !== ZoneType.Exile) return false;
    if (card.suspendedCounters === undefined) return false;
    if (card.suspendedCounters !== 0) return false;
    return hasSuspendKeyword(card);
  },

  modifyCastContext(ctx: CastContext, _sa: SpellAbility, game: Game): void {
    const card = game.cards.get(ctx.sourceCardId);
    if (!card) return;

    (ctx as { altCostUsed: string | null }).altCostUsed = "Suspend";

    // Free cast — empty mana cost string.
    (ctx as { totalCost: unknown }).totalCost = {
      base: { raw: "" },
    };

    // Route post-resolution destination.
    const def = card.paperCard.definition;
    const dest = def && definitionIsPermanent(def) ? ZoneType.Battlefield : ZoneType.Graveyard;
    (ctx as { alternativeZoneDestination: ZoneType | undefined }).alternativeZoneDestination = dest;

    // CR 702.61f — "the spell gains haste". Stamp the flag for combat-time
    // has-haste reads. Cleared when the card next leaves the battlefield.
    card.hasteFromSuspend = true;
  },
};

altCostRegistry.register(Suspend);

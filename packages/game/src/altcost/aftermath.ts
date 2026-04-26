// SPDX-License-Identifier: GPL-3.0-or-later
// Aftermath — alternative casting cost from the graveyard for the R-half
// of a split card (Amonkhet / Hour of Devastation, CR 702.133).
//
// CR 702.133 — "Aftermath" is a subtype-shaped marker on the second face of
// an Aftermath split card. It means "Cast this spell only from your
// graveyard. Then exile it."
//
// DSL form in card definitions:
//   K:Aftermath        (no cost — the K-line is purely a marker)
//
// isAvailable:
//   - The card sits in the Graveyard zone.
//   - The card carries the "aftermath" keyword (intrinsic from the R face)
//     OR the PaperCard satisfies isAftermathCard (R-face has the
//     "Aftermath" subtype set).
//
// modifyCastContext:
//   - Leaves the regular printed mana cost in place (ctx.totalCost is set
//     downstream by stepDetermineTotalCost). Aftermath does not REPLACE
//     the mana cost — it only opens graveyard-cast and steers the
//     post-resolution destination.
//   - Sets ctx.altCostUsed = "Aftermath".
//   - Sets ctx.alternativeZoneDestination = ZoneType.Exile so the resolver
//     moves the card to exile instead of the graveyard after resolution
//     (mirrors Flashback's post-resolution behaviour).
//
// TODO(advanced) — Multi-face split-card "active face" routing. Once the
// cast pipeline picks a face for split cards (CastPipeline step 2), the
// availability gate should additionally require Card.face === "R" so the
// L (front) half is unaffected. For MVP we accept that an Aftermath split
// card in the graveyard offers Aftermath as an alt-cost regardless of
// face selection — the player must still pick the R face on cast for the
// resolver to do anything sensible. The keyword-presence + zone heuristic
// is safe because aftermath only appears on R-half text.
import type { KeywordAst } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { SpellAbility } from "../ability/spell-ability.js";
import type { Card } from "../card.js";
import type { CastContext } from "../cast/cast-context.js";
import type { Game } from "../game.js";
import { isAftermathCard } from "../multiface/split.js";
import type { AltCost } from "../registries/alt-cost-registry.js";
import { altCostRegistry } from "../registries/alt-cost-registry.js";

// ---------------------------------------------------------------------------
// Helper: detect an Aftermath card by either keyword presence or split-face
// subtype. Both forms are tolerated so tests can stamp K:Aftermath directly
// and real cards (which carry the subtype on their R face) work too.
// ---------------------------------------------------------------------------

const isAftermath = (card: Card): boolean => {
  if (isAftermathCard(card.paperCard)) return true;
  const def = card.paperCard.definition;
  if (!def) return false;
  const keywords = def.keywords as readonly KeywordAst[] | undefined;
  if (!keywords) return false;
  return keywords.some((k) => k.keyword === "aftermath");
};

// ---------------------------------------------------------------------------
// Aftermath AltCost
// ---------------------------------------------------------------------------

export const Aftermath: AltCost = {
  handlerKey: "Aftermath",

  isAvailable(card: Card, _game: Game): boolean {
    if (card.zone !== ZoneType.Graveyard) return false;
    return isAftermath(card);
  },

  modifyCastContext(ctx: CastContext, _sa: SpellAbility, _game: Game): void {
    // Aftermath does not replace the mana cost; the spell pays its printed
    // R-face cost (the cast pipeline reads the mana cost off the chosen face
    // in stepDetermineTotalCost). We only mark altCostUsed and steer the
    // post-resolution zone to Exile.
    (ctx as { altCostUsed: string | null }).altCostUsed = "Aftermath";
    (ctx as { alternativeZoneDestination: ZoneType | undefined }).alternativeZoneDestination = ZoneType.Exile;
  },
};

altCostRegistry.register(Aftermath);

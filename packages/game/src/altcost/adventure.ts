// SPDX-License-Identifier: GPL-3.0-or-later
// Adventure — alternative casting cost for Adventure cards (Throne of
// Eldraine, CR 715). Adventure cards have a creature face ("front") and
// an instant/sorcery face ("adventure"); when the adventure half is
// cast and resolves, the card is exiled instead of going to the
// graveyard, and the controller may later cast the creature half from
// exile (CR 715.2).
//
// Wave 55 surface:
//   - The cast pipeline already offers the chooseFace decision when
//     `paper.faces` contains "adventure" (cast-pipeline step 2,
//     stepChooseFace). The cast-from-hand path resolves through the
//     normal mana cost; this AltCost only governs the post-resolution
//     re-cast from exile.
//   - isAvailable: card sits in Exile AND its PaperCard has an
//     "adventure" face AND `card.adventureSide === "spell"` (i.e. the
//     adventure half resolved and exiled the card). The AltCost name
//     "Adventure" is the durable contract for the cast pipeline.
//   - modifyCastContext: stamp altCostUsed = "Adventure"; the cast is
//     from Exile, so step 4's stepChooseZoneOverride will already set
//     alternativeZoneDestination = Exile (cast-from-exile re-exile is
//     wrong here — the creature should enter the battlefield on resolve).
//     The cast pipeline's stepChooseZoneOverride defaults to Exile for
//     exile origins; we override that back to Battlefield by setting
//     alternativeZoneDestination = Battlefield so the creature half
//     enters the battlefield (CR 715.2 — once a creature spell on the
//     stack resolves, it enters the battlefield as a normal creature
//     spell would).
//
// Closure note (Wave 118) — Stamping `card.adventureSide = "spell"`
// when the adventure half resolves belongs to the resolver's post-
// resolution hook + ChangeZone-to-Exile interception. The AltCost
// contract here is the durable read; resolver-side write integration
// has now landed via SP3 Part C's adventure cast lane (see
// `multiface/adventure.ts` + the cast-pipeline face-selection step),
// so the flag is observable in tests that go through that pipeline.
import type { PaperCard } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { SpellAbility } from "../ability/spell-ability.js";
import type { Card } from "../card.js";
import type { CastContext } from "../cast/cast-context.js";
import type { Game } from "../game.js";
import { isAdventureCard } from "../multiface/adventure.js";
import type { AltCost } from "../registries/alt-cost-registry.js";
import { altCostRegistry } from "../registries/alt-cost-registry.js";

const isAdventurePaper = (paper: PaperCard): boolean => isAdventureCard(paper);

export const Adventure: AltCost = {
  handlerKey: "Adventure",

  isAvailable(card: Card, _game: Game): boolean {
    if (card.zone !== ZoneType.Exile) return false;
    if (!isAdventurePaper(card.paperCard)) return false;
    // Adventure half must have already resolved — so the card is in
    // exile under the adventure mechanic. The stamp is the trigger.
    return card.adventureSide === "spell";
  },

  modifyCastContext(ctx: CastContext, _sa: SpellAbility, game: Game): void {
    // Adventure does NOT replace the mana cost; the creature half pays
    // its printed mana cost. We only:
    //   - mark altCostUsed = "Adventure"
    //   - override the default exile-origin → exile-on-resolve override
    //     back to Battlefield (the creature enters the battlefield).
    //   - flip card.adventureSide to "creature" so subsequent resolution
    //     paths know which half is on the stack.
    (ctx as { altCostUsed: string | null }).altCostUsed = "Adventure";
    (ctx as { alternativeZoneDestination: ZoneType | undefined }).alternativeZoneDestination =
      ZoneType.Battlefield;

    const card = game.cards.get(ctx.sourceCardId);
    if (card) {
      card.adventureSide = "creature";
    }
  },
};

altCostRegistry.register(Adventure);

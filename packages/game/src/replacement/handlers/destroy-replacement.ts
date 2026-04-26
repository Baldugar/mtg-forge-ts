// SPDX-License-Identifier: GPL-3.0-or-later
// DestroyReplacement — handles Forge's `R:Event$ Destroy` replacement line.
// Intercepts destroy mutation intents and either prevents the destruction
// (Indestructible-adjacent locks; CR 614 destruction-specific replacement)
// or redirects to "exile instead" (Rest in Peace-style redirects).
//
// Forge patterns:
//   R:Event$ Destroy | ValidCard$ Card.Self | Prevent$ True
//     | Description$ This permanent can't be destroyed.
//   R:Event$ Destroy | ValidCard$ Creature.YouCtrl | ReplaceWith$ DBExile
//     | Description$ If a creature you control would be destroyed, exile it
//       instead.
//   R:Event$ Destroy | ValidCard$ Card.Self | Layer$ CantHappen
//     | Description$ Can't be destroyed.
//
// Wave 17 MVP support:
//   ValidCard$ Card.Self                        — match the source card only.
//   ValidCard$ Card / Permanent                 — match any card.
//   ValidCard$ <Type>.YouCtrl / .OppCtrl        — type+control filter
//                                                 (creature/artifact/etc.).
//   Layer$ CantHappen / Prevent$ True           — block the destruction.
//   ReplaceWith$ DBExile                         — return an `exile` intent
//                                                 in place of `destroy`.
//   ReplaceWith$ <SVar> (other shapes)          — Wave 17b: lookup the
//     SVar via the shared helper. When an ability SVar is found, treat
//     the canonical destroy as replaced (return null). Wave 18 will
//     execute the alternative ability synchronously.
import type {
  EntityId,
  MutationIntent,
  PlayerSeat,
  ReplacementAbility,
  ReplacementAst,
} from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import { replacementHandlerRegistry } from "../replacement-handler-registry.js";
import type { ReplacementBuildContext } from "../replacement-handler.js";
import { ReplacementHandler } from "../replacement-handler.js";
import { lookupReplaceWithAbility } from "./replace-with-svar.js";

const getParamRaw = (ast: ReplacementAst, key: string): string | undefined => {
  const pv = ast.params[key];
  if (!pv) return undefined;
  if (pv.kind === "literal") return pv.raw;
  return undefined;
};

/**
 * Lightweight ValidCard$ matcher tailored to the Destroy replacement.
 * Recognises the small slice of filters Forge actually uses on destroy
 * lines: Card.Self, Card / Permanent / Any, plus a `<Type>.YouCtrl` /
 * `.OppCtrl` shape that checks the targeted card's primary type and the
 * relationship between its controller and the replacement's controller.
 *
 * Returns false on any unrecognised filter so we never half-match.
 */
const matchesValidCardLite = (
  filter: string,
  cardId: EntityId,
  sourceCardId: EntityId,
  controllerSeat: PlayerSeat,
  game: Game | undefined,
): boolean => {
  if (filter === "Card.Self") return cardId === sourceCardId;
  if (filter === "Card" || filter === "Permanent" || filter === "Any") return true;
  // Type.YouCtrl / Type.OppCtrl
  const dotIndex = filter.indexOf(".");
  if (dotIndex < 0) return false;
  const typeKey = filter.slice(0, dotIndex);
  const qualifier = filter.slice(dotIndex + 1);
  const card = game?.cards.get(cardId);
  if (!card) return false;
  // Type check: definition.types.has(typeName) is the canonical Forge form.
  const types = card.paperCard?.definition?.types as { has?: (t: string) => boolean } | undefined;
  if (types?.has === undefined) return false;
  if (!types.has(typeKey)) return false;
  // Qualifier check: control relationship vs the replacement's controller.
  const cardCtrl = card.controllerSeat;
  if (qualifier === "YouCtrl") return cardCtrl === controllerSeat;
  if (qualifier === "OppCtrl") return cardCtrl !== controllerSeat;
  // Other qualifiers (e.g. .Other, .nonToken) — defer to Wave 18.
  return false;
};

export class DestroyReplacement extends ReplacementHandler {
  static override readonly eventKind = "Destroy";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const validCardRaw = getParamRaw(ast, "ValidCard") ?? "Card.Self";
    const layerParam = getParamRaw(ast, "Layer");
    const preventParam = getParamRaw(ast, "Prevent");
    const replaceWithKey = getParamRaw(ast, "ReplaceWith") ?? ast.effect.handlerKey;
    const { sourceCardId, controllerSeat, replacementId, game } = ctx;

    return {
      id: replacementId,
      kind: "replacement",
      sourceCardId,
      activeInZones: new Set(["Battlefield" as never]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isSelfReplacement: ast.isSelf === true,
      layer: layerParam === "CantHappen" ? "cantHappen" : "other",

      matches(intent: MutationIntent): boolean {
        if (intent.kind !== "destroy") return false;
        const di = intent as { cardId?: EntityId };
        if (di.cardId === undefined) return false;
        return matchesValidCardLite(validCardRaw, di.cardId, sourceCardId, controllerSeat, game);
      },

      apply(intent: MutationIntent, gameUnknown: unknown): MutationIntent | null {
        if (layerParam === "CantHappen" || preventParam === "True") return null;
        // ReplaceWith$ DBExile — turn the destroy into an exile intent.
        if (replaceWithKey === "DBExile") {
          const di = intent as { cardId?: EntityId; sourceId?: EntityId | null };
          return {
            kind: "exile",
            cardId: di.cardId,
            sourceId: di.sourceId ?? sourceCardId,
          } as unknown as MutationIntent;
        }
        // Other ReplaceWith$ <SVar> shapes — Wave 17b: when the SVar
        // dereferences to an ability on the source card, treat the
        // canonical destroy as replaced (return null). Wave 18 wires
        // synchronous execution of the alternative.
        if (replaceWithKey !== undefined && replaceWithKey !== ast.effect.handlerKey) {
          const game = gameUnknown as Game;
          const ability = lookupReplaceWithAbility(game, sourceCardId, replaceWithKey);
          if (ability !== null) return null;
        }
        return intent;
      },
    };
  }
}

replacementHandlerRegistry.register(DestroyReplacement);

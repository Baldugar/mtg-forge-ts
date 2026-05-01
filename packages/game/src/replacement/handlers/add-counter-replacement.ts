// SPDX-License-Identifier: GPL-3.0-or-later
// AddCounterReplacement — handles Forge's `R:Event$ AddCounter` replacement.
// Intercepts counter-addition mutation intents and multiplies (or otherwise
// modifies) the amount. Doubling Season / Vorinclex / Hardened Scales
// belong here.
//
// Wave 115 — the parent matches BOTH `addCounter` (card-counter) and
// `addPlayerCounter` (player-counter) MutationIntent kinds so a single
// `R:Event$ AddCounter | ValidPlayer$ Opponent | Amount$ 2` replacement
// (Vorinclex of the Hunger) doubles counters going onto an opponent's
// permanent OR onto the opponent themselves. ValidCard$ filters scope
// the card half; ValidPlayer$ filters scope the player half. When neither
// is set, the replacement matches BOTH halves (matches Forge's "permanent
// or player" wording).
//
// Forge patterns:
//   R:Event$ AddCounter | ValidCard$ Permanent.YouCtrl | Amount$ 2
//     | Description$ If one or more counters would be put on a permanent
//                    you control, twice that many of each kind are put on
//                    it instead. (Doubling Season counter half)
//   R:Event$ AddCounter | ValidCard$ Creature.YouCtrl
//                       | CounterType$ P1P1 | Amount$ 1
//     | Description$ Hardened Scales — if one or more +1/+1 counters
//                    would be put on a creature you control, that many
//                    plus one are put on it instead.
//
// Wave 48 supports:
//   ValidCard$ Card.Self / Card / Permanent / Any            — wildcard match.
//   ValidCard$ <Type>.YouCtrl / .OppCtrl                     — type+control filter.
//   CounterType$ <NAME>                                       — restrict to one
//                                                              counter type
//                                                              (Hardened Scales).
//   Amount$ <int>                                             — multiplier.
//   AddAmount$ <int>                                          — additive bump
//                                                              (Hardened Scales
//                                                              "+1 more").
//   Layer$ CantHappen / Prevent$ True                         — block addition.
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
import { lookupReplaceWithAbility, runReplaceWithIntentMutation } from "./replace-with-svar.js";

const getParamRaw = (ast: ReplacementAst, key: string): string | undefined => {
  const pv = ast.params[key];
  if (!pv) return undefined;
  if (pv.kind === "literal") return pv.raw;
  return undefined;
};

const parseLiteralInt = (raw: string | undefined): number | null => {
  if (raw === undefined) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
};

/** Lightweight ValidCard$ matcher (mirrors counter-replacement's). */
const matchesValidCardLite = (
  filter: string,
  cardId: EntityId,
  sourceCardId: EntityId,
  controllerSeat: PlayerSeat,
  game: Game | undefined,
): boolean => {
  if (filter === "Card.Self") return cardId === sourceCardId;
  if (filter === "Card" || filter === "Permanent" || filter === "Any") return true;
  const dotIndex = filter.indexOf(".");
  if (dotIndex < 0) return false;
  const typeKey = filter.slice(0, dotIndex);
  const qualifier = filter.slice(dotIndex + 1);
  const card = game?.cards.get(cardId);
  if (!card) return false;
  const types = card.paperCard?.definition?.types as { has?: (t: string) => boolean } | undefined;
  if (types?.has === undefined) return false;
  if (!types.has(typeKey)) return false;
  const cardCtrl = card.controllerSeat;
  if (qualifier === "YouCtrl") return cardCtrl === controllerSeat;
  if (qualifier === "OppCtrl") return cardCtrl !== controllerSeat;
  return false;
};

// ---------------------------------------------------------------------------
// AddCounterReplacement
// ---------------------------------------------------------------------------

export class AddCounterReplacement extends ReplacementHandler {
  static override readonly eventKind = "AddCounter";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const { sourceCardId, controllerSeat, replacementId, game } = ctx;
    // Wave 115 — when the script omits ValidCard$ entirely we must NOT
    // default to a card-only filter, otherwise Vorinclex-shape
    // ValidPlayer$ Opponent forms would never engage the player half.
    // Treat "no ValidCard$" as "card half is permissive" by sentinelling
    // it with `null`.
    const validCardRawOrNull = getParamRaw(ast, "ValidCard") ?? null;
    const validPlayerRaw = getParamRaw(ast, "ValidPlayer");
    const counterTypeRaw = getParamRaw(ast, "CounterType");
    const layerParam = getParamRaw(ast, "Layer");
    const preventParam = getParamRaw(ast, "Prevent");
    const multiplier = parseLiteralInt(getParamRaw(ast, "Amount"));
    const addAmount = parseLiteralInt(getParamRaw(ast, "AddAmount"));
    // Wave 67 — ReplaceWith$ <SVar> for the SVar-bodied form (e.g. Doubling
    // Season's "DBDouble" SVar that resolves to DB$ ReplaceCounter |
    // Multiplier$ 2). When the SVar handler is from the ReplaceEffect family
    // we thread the addCounter intent through the side-channel runner.
    const replaceWithKey = getParamRaw(ast, "ReplaceWith") ?? ast.effect.handlerKey;

    // Card-half default: legacy Wave-48 callers that didn't pass ValidPlayer$
    // expected the parent to match cards with the historical
    // "Permanent.YouCtrl" filter. Preserve that when the ValidPlayer$ side
    // is also absent.
    const validCardRaw = validCardRawOrNull ?? "Permanent.YouCtrl";

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
        // CounterType filter applies to both card + player halves.
        const ciAny = intent as { counterType?: string };
        if (
          counterTypeRaw !== undefined &&
          ciAny.counterType !== undefined &&
          String(ciAny.counterType) !== counterTypeRaw
        ) {
          return false;
        }
        if (intent.kind === "addCounter") {
          const ci = intent as { cardId?: EntityId };
          if (ci.cardId === undefined) return false;
          return matchesValidCardLite(validCardRaw, ci.cardId, sourceCardId, controllerSeat, game);
        }
        if (intent.kind === "addPlayerCounter") {
          // Wave 115 — player half. Match ValidPlayer$ if set; otherwise the
          // parent matches all players unless ValidCard$ pinned us to the
          // card half (legacy callers).
          const ci = intent as { playerSeat?: PlayerSeat };
          const seat = ci.playerSeat;
          if (seat === undefined) return false;
          if (validPlayerRaw === undefined) {
            // No explicit ValidPlayer$ — the parent only engages the player
            // half when the script also omitted ValidCard$ (so the intent
            // is "permanent or player" as in Vorinclex's printed wording).
            // Legacy Wave-48 callers that pinned ValidCard$ but not
            // ValidPlayer$ stay card-only.
            return validCardRawOrNull === null;
          }
          if (validPlayerRaw === "You") return seat === controllerSeat;
          if (validPlayerRaw === "Opponent") return seat !== controllerSeat;
          if (validPlayerRaw === "Each" || validPlayerRaw === "Player") return true;
          return false;
        }
        return false;
      },

      apply(intent: MutationIntent, gameUnknown: unknown): MutationIntent | null {
        if (layerParam === "CantHappen" || preventParam === "True") return null;
        const ci = intent as { amount?: number };
        const current = ci.amount ?? 1;
        let newAmount = current;
        if (multiplier !== null && multiplier > 1) newAmount = current * multiplier;
        if (addAmount !== null && addAmount !== 0) newAmount = newAmount + addAmount;

        // Wave 67 — ReplaceWith$ <SVar> dispatch into the ReplaceEffect family.
        // Doubling Season's counter half is parsed as
        //   R:Event$ AddCounter | ValidCard$ Permanent.YouCtrl
        //                       | ReplaceWith$ DBDouble
        //   SVar:DBDouble:DB$ ReplaceCounter | Multiplier$ 2
        // When such a ReplaceWith$ is present and the SVar resolves to a
        // ReplaceEffect-family handler, we thread the (already inline-multiplied)
        // intent through the side-channel runner so the SVar's mutation stacks
        // on top.
        const game = gameUnknown as Game;
        const interim: MutationIntent =
          newAmount === current ? intent : ({ ...intent, amount: newAmount } as MutationIntent);
        if (replaceWithKey !== undefined) {
          const ability = lookupReplaceWithAbility(game, sourceCardId, replaceWithKey);
          if (ability !== null) {
            const handlerKey = ability.handlerKey;
            if (handlerKey === "ReplaceEffect" || handlerKey === "ReplaceCounter") {
              const next = runReplaceWithIntentMutation(game, sourceCardId, controllerSeat, ability, interim);
              return next;
            }
          }
        }
        if (newAmount === current) return intent;
        return interim;
      },
    };
  }
}

replacementHandlerRegistry.register(AddCounterReplacement);

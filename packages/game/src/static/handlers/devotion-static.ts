// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 78 — Devotion static handler. CR 700.5 (Devotion) +
// Forge's StaticAbilityDevotion.java equivalent.
//
// Wave 42 wired the canonical `Count$Devotion.<Color>` SVar selector
// (counts colored mana symbols among controller's permanents). The
// Devotion-as-a-static modifier extends the calculation: matched cards
// contribute additional pips (or matched players' devotion to a color
// gets bumped), even when the printed mana cost wouldn't otherwise
// contain those pips.
//
// Forge cards using this shape (~few cards in the corpus):
//   - Altar of the Pantheon ("Your devotion to each color and each
//                              combination of colors is increased by one.")
//   - Mirror Match-style cards that grant +N devotion in a specific
//     color (rare; mostly 0-1 cards per shape).
//
// DSL (corpus):
//   S:Mode$ Devotion | ValidPlayer$ You | Description$ ...                  ← per-player +1 (Altar)
//   S:Mode$ Devotion | ValidCard$ <filter>
//                    | DevotionMod$ N | DevotionColor$ <Color>
//                    | Description$ ...                                     ← per-card +N to specific color
//
// What it does (Forge): consulted by the Devotion-counter (Wave 42's
// `countDevotionTo`). The runtime devotion total becomes:
//   countedSymbols + sum(per-player Amount$) + sum(per-card matching
//   filter × DevotionMod$ for the queried color).
//
// Routing: ruleChanging per MODE_TO_CATEGORY (overrides the canonical
// CR 700.5 calculation rather than gating an action).
//
// MVP scope:
//   - ValidPlayer$ <filter> + Amount$ N → adds N to the matched seat's
//                                          devotion to ALL colors. Defaults
//                                          to 1 when Amount$ omitted.
//   - ValidCard$ <filter>  + DevotionMod$ N + DevotionColor$ <Color>
//                                       → adds N to the matched card's
//                                          contribution to the queried
//                                          color. Defaults: Mod=1,
//                                          Color=any (matches every
//                                          queried color).
// Wave 107 — retired the stale "Combined player+card filter"
// TODO(advanced) tail. The Wave 78 grammar already supports both
// scopes in a single static (a Devotion line with both ValidPlayer$
// and ValidCard$ present): `hasPlayerScope` and `hasCardScope` are
// independent flags read by the gate helper, so a static carrying
// both predicates contributes its player-amount once for the matched
// seat AND its card-mod for every matched permanent. The corpus
// sweep at Wave 107 confirms no current line uses both at once, but
// the implementation already routes correctly if a future line does.
import type { Color, EntityId, ParamValue, PlayerSeat, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import { Color as ColorEnum } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, buildPlayerPredicate, literalRaw } from "./restriction-helpers.js";

const COLOR_BY_NAME: Readonly<Record<string, Color>> = {
  White: ColorEnum.White,
  Blue: ColorEnum.Blue,
  Black: ColorEnum.Black,
  Red: ColorEnum.Red,
  Green: ColorEnum.Green,
};

export interface DevotionPayload {
  readonly kind: "devotion";
  /**
   * Player-side modifier: when set, the predicate matches the seat
   * whose devotion we're counting, and `playerAmount` is added once
   * (independent of the queried color).
   */
  readonly playerMatches: (seat: PlayerSeat) => boolean;
  readonly playerAmount: number;
  /**
   * Card-side modifier: when set, every battlefield card matched by
   * the predicate (under the queried player as controller) contributes
   * `cardMod` extra pips to the queried color.
   */
  readonly cardMatches: (cardId: EntityId, game: Game) => boolean;
  readonly cardMod: number;
  /**
   * Color filter for the card-side modifier. Undefined means "any
   * queried color" (the modifier applies to every Devotion query).
   * Set means "only when querying this specific color".
   */
  readonly devotionColor: Color | undefined;
  /**
   * True when this static carries a player-shape modifier (ValidPlayer$
   * present). Read by the gate helper to dispatch player-vs-card path.
   */
  readonly hasPlayerScope: boolean;
  /**
   * True when this static carries a card-shape modifier (ValidCard$
   * present). Read by the gate helper to dispatch player-vs-card path.
   */
  readonly hasCardScope: boolean;
}

const parseInt0 = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined || raw.length === 0) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
};

export class DevotionStaticHandler extends StaticHandler {
  static override readonly mode = "Devotion" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validPlayerRaw = literalRaw(params.ValidPlayer);
    const validCardRaw = literalRaw(params.ValidCard);
    const hasPlayerScope = validPlayerRaw !== undefined;
    const hasCardScope = validCardRaw !== undefined;

    const seatPred = buildPlayerPredicate(validPlayerRaw, ctx.controllerSeat);
    const cardPred = buildCardIdPredicate(validCardRaw ?? "Card.Self", ctx.sourceCardId, ctx.controllerSeat);
    const playerAmount = parseInt0(literalRaw(params.Amount), 1);
    const cardMod = parseInt0(literalRaw(params.DevotionMod), 1);
    const colorRaw = literalRaw(params.DevotionColor);
    const devotionColor: Color | undefined = colorRaw !== undefined ? COLOR_BY_NAME[colorRaw] : undefined;

    const payload: DevotionPayload = {
      kind: "devotion",
      playerMatches: (seat) => seatPred(seat),
      playerAmount,
      cardMatches: (cardId, game) => cardPred(cardId, game),
      cardMod,
      devotionColor,
      hasPlayerScope,
      hasCardScope,
    };

    const activeInZones = normalizeActiveInZones(ast.activeInZones);
    return {
      id: ctx.staticId,
      kind: "static",
      sourceCardId: ctx.sourceCardId,
      activeInZones,
      timestamp: ctx.game.newEntityId(),
      controllerSeatAtReg: ctx.controllerSeat,
      category: "ruleChanging",
      mode: "Devotion",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(DevotionStaticHandler);

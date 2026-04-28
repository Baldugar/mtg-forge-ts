// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 60.I — ManaConvert static handler. CR 605 / Forge's
// StaticAbilityManaConvert.java. Examples (real Forge cards):
//
//   S:Mode$ ManaConvert | ValidPlayer$ You | ManaConversion$ AnyType->AnyColor
//     | Description$ You may spend mana as though it were mana of any color.
//   S:Mode$ ManaConvert | ValidPlayer$ You | ValidCard$ Card.Self
//     | ValidSA$ Activated | ManaConversion$ AnyType->AnyColor
//     | Description$ ...
//   S:Mode$ ManaConvert | ValidPlayer$ You
//     | ManaConversion$ White->AnyColor nonWhite<-C
//     | Description$ ...
//
// What it does (Forge): when the matched ValidPlayer is paying for a
// matched ValidCard / ValidSA, the cost-payment matrix is relaxed by
// applying the named ManaConversion$ rewrite. The classic shape
// `AnyType->AnyColor` means "spend any colored mana for any colored
// cost"; the carve-out shapes (`White->AnyColor nonWhite<-C`) restrict
// the rewrite to specific colors and downgrade the rest to colorless.
//
// Routing: ruleChanging category — overrides default mana-payment
// matching rules. The describe() payload exposes the matched
// ValidPlayer/ValidCard/ValidSA predicates plus the raw conversion
// string so the cost-payment matrix consumer can read it. The Wave 60.I
// MVP stamps the payload at activation; the cost-pay matrix consumer
// (mana-cost solver) reads the active ManaConvert payloads at the
// payment-resolution decision point. Full SHARDS-level rewrite logic
// is // TODO(advanced) — the durable contract here is the registry
// presence of the static so tests + downstream consumers can probe it.
//
// MVP scope:
//   ValidPlayer$ You / Opponent / Any / Player → buildPlayerPredicate.
//   ValidCard$  Card.Self / <filter>           → buildCardIdPredicate.
//   ValidSA$    Spell / Activated / Spell,Activated → exposed verbatim.
//   ManaConversion$ <token>                    → exposed verbatim.
//
// Aliases: the kickoff prompt also documented `ManaTypes$` as a
// possible param name; we accept it as an alias to ManaConversion$ to
// stay forward-compatible with both Forge's actual usage and the
// looser kickoff-prompt usage.
import type { EntityId, ParamValue, PlayerSeat, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, buildPlayerPredicate, literalRaw } from "./restriction-helpers.js";

export interface ManaConvertPayload {
  readonly kind: "manaConvert";
  /** True iff the paying player matches the ValidPlayer$ filter. */
  readonly playerMatches: (seat: PlayerSeat) => boolean;
  /** True iff the spell/ability source card matches the ValidCard$ filter. */
  readonly cardMatches: (cardId: EntityId, game: Game) => boolean;
  /**
   * Raw ValidSA$ token (e.g. "Spell", "Activated", "Spell,Activated"). The
   * cost-payment-matrix consumer parses this; MVP exposes it verbatim and
   * the consumer's `Spell` / `Activated` / `Spell,Activated` walk uses
   * substring inclusion (Forge's parser is the same shape).
   */
  readonly validSaRaw: string | undefined;
  /**
   * Raw ManaConversion$ token (e.g. "AnyType->AnyColor",
   * "White->AnyColor nonWhite<-C", "Blue->AnyColor"). The cost-payment-
   * matrix consumer parses this and applies the rewrite; MVP exposes it
   * verbatim.
   */
  readonly conversionRaw: string;
}

export class ManaConvertStaticHandler extends StaticHandler {
  static override readonly mode = "ManaConvert" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validPlayerRaw = literalRaw(params.ValidPlayer);
    const validCardRaw = literalRaw(params.ValidCard);
    const validSaRaw = literalRaw(params.ValidSA);
    // Forge canonical param is `ManaConversion`; the kickoff prompt also
    // accepts `ManaTypes` as a synonym. Prefer the canonical when both
    // are present.
    const conversionRaw =
      literalRaw(params.ManaConversion) ?? literalRaw(params.ManaTypes) ?? "AnyType->AnyColor";

    const seatPred = buildPlayerPredicate(validPlayerRaw, ctx.controllerSeat);
    // ValidCard$ omitted → match every card (ManaConvert often has no
    // card filter; the conversion is global to the paying player).
    const cardPred = buildCardIdPredicate(validCardRaw, ctx.sourceCardId, ctx.controllerSeat);

    const payload: ManaConvertPayload = {
      kind: "manaConvert",
      playerMatches: (seat) => seatPred(seat),
      cardMatches: (cardId, game) => cardPred(cardId, game),
      validSaRaw,
      conversionRaw,
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
      mode: "ManaConvert",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(ManaConvertStaticHandler);

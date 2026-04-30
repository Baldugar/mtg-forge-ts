// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.E — CantPlayLand static handler. CR 305 — land-play prevention.
// Forge cards using this:
//   - Restorm, the Searing      (players can't play lands except by spell
//                                 effects — see Spell$ True carve-out)
//   - Stranglehold              (players can't take extra turns AND its
//                                 broader landwalk variants — note: extra-
//                                 turn lands are forbidden via a separate
//                                 ExtraTurn$ slot, TODO(advanced))
//   - Emberwilde Captain        (each opponent can't play lands while X)
//   - Ob Nixilis, the Adversary (each opponent can't play lands)
//
// DSL:
//   S:Mode$ CantPlayLand | ValidPlayer$ Player   | Description$ ...
//   S:Mode$ CantPlayLand | ValidPlayer$ Opponent | Description$ ...
//   S:Mode$ CantPlayLand | ValidPlayer$ You      | Description$ ...
//
// What it does (Forge): the matched player can't play lands. The play-
// land call site (GameAction.playLand) consults `canPlayLand(game, seat)`
// before initiating the zone change; on a match the action no-ops
// silently (no LandPlayed event, no zone change, no drop counter
// increment). The legal-action enumerator (Wave 50) likewise consults
// the gate so the AI / UI never offers play-land as a legal action.
//
// Spell-effect land plays (e.g. AB$ Play with Land$ True) bypass this
// gate by routing through `moveTo` directly rather than `playLand`,
// matching Forge's "as a special action" carve-out (CR 305.3 +
// SpellEffect$ exception). This is the canonical Restorm carve-out.
//
// Routing: cantMustMay category — already mapped in MODE_TO_CATEGORY.
// Pure action filter consulted by the play-land entry point. Mirrors
// the Wave 60.A / 60.H "cant" gate pattern: walk the registry per-query.
//
// MVP scope: ValidPlayer$ You / Opponent / Any / Player (Wave 50
// buildPlayerPredicate grammar). Sub-conditional gates
// (ExtraTurn$ True / Spell$ False) are TODO(advanced).
import type { ParamValue, PlayerSeat, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildPlayerPredicate, literalRaw } from "./restriction-helpers.js";

export interface CantPlayLandPayload {
  readonly kind: "cantPlayLand";
  readonly playerMatches: (seat: PlayerSeat) => boolean;
}

export class CantPlayLandStaticHandler extends StaticHandler {
  static override readonly mode = "CantPlayLand" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validPlayerRaw = literalRaw(params.ValidPlayer);
    const seatPred = buildPlayerPredicate(validPlayerRaw, ctx.controllerSeat);

    const payload: CantPlayLandPayload = {
      kind: "cantPlayLand",
      playerMatches: (seat) => seatPred(seat),
    };

    const activeInZones = normalizeActiveInZones(ast.activeInZones);
    return {
      id: ctx.staticId,
      kind: "static",
      sourceCardId: ctx.sourceCardId,
      activeInZones,
      timestamp: ctx.game.newEntityId(),
      controllerSeatAtReg: ctx.controllerSeat,
      category: "cantMustMay",
      mode: "CantPlayLand",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(CantPlayLandStaticHandler);

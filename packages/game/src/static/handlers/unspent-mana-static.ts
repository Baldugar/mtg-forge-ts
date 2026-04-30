// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 73 — UnspentMana static handler. Forge's
// `forge.game.staticability.StaticAbilityUnspentMana`.
//
// Forge cards using this shape (~7 cards in corpus):
//   - Omnath, Locus of Mana       (ValidPlayer$ You | ManaType$ Green)
//   - Upwelling                   (no filter — all players keep all colors)
//   - Vorinclex, Voice of Hunger  (analog — Vorinclex itself uses a
//                                   different mechanic; Forge models the
//                                   "fangorn tree shepherd" / "leyline
//                                   tyrant" / "ashling, flame dancer" /
//                                   "electro, assaulting battery"
//                                   shape with this static)
//   - Fangorn Tree Shepherd       (ValidPlayer$ You | ManaType$ Green)
//   - Leyline Tyrant              (ValidPlayer$ You | ManaType$ Red)
//   - Ashling, Flame Dancer       (ValidPlayer$ You | ManaType$ Red)
//   - Electro, Assaulting Battery (ValidPlayer$ You | ManaType$ Red)
//   - The Last Agni Kai (svar form, until end of turn)
//
// DSL:
//   S:Mode$ UnspentMana | ValidPlayer$ <filter> | ManaType$ <Color> |
//     Description$ ...
//   S:Mode$ UnspentMana | Description$ ...     (no filter — all players)
//
// What it does (Forge): at the end of each phase the mana-pool empty
// step normally drains every shard the player has unspent. This static
// rewrites the empty step so shards matching ManaType$ are RETAINED
// across the phase boundary for ValidPlayer$. When ManaType$ is
// omitted, every color is retained (Upwelling). When ValidPlayer$ is
// omitted (Upwelling), every player is matched.
//
// Routing: ruleChanging — already mapped in MODE_TO_CATEGORY. The
// payload exposes a per-color filter consulted by phase-handler at
// the end-of-phase mana-empty step (see `retainsUnspentMana` /
// `getRetainedManaColors` in statics/wave73-unspent-mana.ts).
//
// MVP scope:
//   - ValidPlayer$ You / Opponent / Any / Player via Wave 50
//     buildPlayerPredicate grammar.
//   - ManaType$ <Color> for the five colors W/U/B/R/G. Unrecognised
//     tokens reject silently (no colors retained).
//   - No ManaType$ token at all → every color retained for the matched
//     player (Upwelling shape).
//
// TODO(advanced):
//   - ManaType$ Colorless (no Forge card uses it today).
//   - Snow-mana retention sub-filter.
//   - Conditional retention via ActivationConditions$ (none in corpus).
import type { ParamValue, PlayerSeat, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import { Color } from "@mtg-forge-ts/core";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildPlayerPredicate, literalRaw } from "./restriction-helpers.js";

/**
 * Sentinel returned from the per-color matcher to mean "every color".
 * Used when ManaType$ is omitted (Upwelling shape).
 */
const ALL_COLORS_AND_COLORLESS = "*" as const;

/**
 * Map a ManaType$ string token (W / U / B / R / G or full name) to a
 * Color enum value. Returns null for unrecognised tokens.
 *
 * Forge's StaticAbilityUnspentMana applies `MagicColor.fromName(...)`,
 * which accepts both single-letter ("R") and full-name ("Red") forms.
 */
const parseManaType = (raw: string): Color | null => {
  const t = raw.trim();
  if (t === "W" || t === "White") return Color.White;
  if (t === "U" || t === "Blue") return Color.Blue;
  if (t === "B" || t === "Black") return Color.Black;
  if (t === "R" || t === "Red") return Color.Red;
  if (t === "G" || t === "Green") return Color.Green;
  return null;
};

export interface UnspentManaPayload {
  readonly kind: "unspentMana";
  readonly playerMatches: (seat: PlayerSeat) => boolean;
  /**
   * Per-color predicate. Returns true when the (color | null) shard
   * should be retained at end-of-phase. `null` represents colorless
   * shards. The sentinel value indicates "match every color including
   * colorless" (Upwelling shape with no ManaType$ token).
   */
  readonly retainsColor: (color: Color | null) => boolean;
  /**
   * Convenience flag: true when this static has no ManaType$ filter
   * (so every color is retained for matched players). Lets the query
   * helper short-circuit color enumeration.
   */
  readonly retainsAll: boolean;
}

export class UnspentManaStaticHandler extends StaticHandler {
  static override readonly mode = "UnspentMana" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validPlayerRaw = literalRaw(params.ValidPlayer);
    const manaTypeRaw = literalRaw(params.ManaType);
    const seatPred = buildPlayerPredicate(validPlayerRaw, ctx.controllerSeat);

    let retainsColor: (color: Color | null) => boolean;
    let retainsAll: boolean;
    if (manaTypeRaw === undefined || manaTypeRaw.length === 0) {
      retainsAll = true;
      retainsColor = () => true;
    } else {
      retainsAll = false;
      const targetColor = parseManaType(manaTypeRaw);
      // Unrecognised token → reject everything (defensive — Forge
      // would throw; we degrade silently to avoid blowing up the
      // mana-empty step on a typo).
      if (targetColor === null) {
        retainsColor = () => false;
      } else {
        retainsColor = (color) => color === targetColor;
      }
    }
    void ALL_COLORS_AND_COLORLESS; // sentinel kept for future colorless support

    const payload: UnspentManaPayload = {
      kind: "unspentMana",
      playerMatches: (seat) => seatPred(seat),
      retainsColor,
      retainsAll,
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
      mode: "UnspentMana",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(UnspentManaStaticHandler);

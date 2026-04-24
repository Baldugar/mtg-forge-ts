// SPDX-License-Identifier: GPL-3.0-or-later
// SvarContext — evaluation context passed to SVar selectors. Holds the
// game, the source card (for Count$yourHand-style selectors), the
// current scope's svar table, and spell-ability-specific data like
// targets and xValue.

import type { EntityId, PlayerSeat, SVarAst } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";

export interface SvarContext {
  readonly game: Game;
  readonly sourceCardId?: EntityId;
  readonly svars: ReadonlyMap<string, SVarAst>;
  readonly controller?: PlayerSeat;
  readonly targets?: readonly EntityId[];
  readonly xValue?: number;
  readonly triggerContext?: {
    readonly objects?: readonly EntityId[];
    readonly player?: PlayerSeat;
    readonly count?: number;
  };
}

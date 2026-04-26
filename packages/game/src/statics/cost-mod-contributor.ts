// SPDX-License-Identifier: GPL-3.0-or-later
// Cost-modification contributors — "spells cost {1} less", "your creatures
// cost {1} more to cast", etc. SP3's ManaCostSolver consults these on
// DetermineTotalCost (cast pipeline step 8). SP2 pins the shape.
//
// The describe() return is tolerated in two shapes:
//   - the bare CostModEffect object, or
//   - a tagged envelope `{ kind: "costMod", effect: CostModEffect }`.
// SP3's DSL will emit one of these consistently; accepting both keeps the
// contributor call site tolerant while the DSL is being written.
import type { Color, EntityId, ManaSymbol } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";

// WHY stackItem is typed `unknown`: StackItem lives in the game package,
// and importing it here is fine, but SP3 plans a broader "cost context"
// shape (card + controller + intent metadata) that would shadow
// StackItem anyway. Keep the surface permissive until that lands.
//
// Wave 11 (cost-mod runtime completeness) extensions:
//   - `minMana`: MinMana$ floor — the result generic count cannot drop below
//     this when reductions apply. When multiple reductions stack, the most
//     restrictive (max) wins.
//   - `setMinTotal`: SetCost-style "this spell costs at least N mana" floor.
//     Applied AFTER all generic deltas + symbol additions; tops up generic
//     to reach the floor. When multiple SetCost mods stack, the max wins.
//   - `addSymbols` / `subtractSymbols`: Cost$-form colored-pip raise/reduce
//     (e.g. Alabaster Leech adds {W}; symmetric reduce strips a {W} pip if
//     the spell has one).
//   - `delta.generic` may be a function, evaluated per-cast for SVar/Count
//     expressions (Yavimaya Sojourner: `Amount$ X` with `X:Count$Domain`).
//   - `markUsed`: callback fired after a successful cast/activation pays its
//     cost — used by once-per-turn guards (OnlyFirstSpell$ True).
export interface CostModEffect {
  readonly sourceStaticId: EntityId;
  readonly filter: (item: unknown, game: Game) => boolean;
  readonly delta: {
    readonly generic?: number | ((item: unknown, game: Game) => number);
    readonly color?: Color;
    readonly deltaColor?: number;
    readonly addSymbols?: readonly ManaSymbol[];
    readonly subtractSymbols?: readonly ManaSymbol[];
  };
  readonly minMana?: number;
  readonly setMinTotal?: number;
  readonly markUsed?: (game: Game, item: unknown) => void;
}

// Envelope shape some describe() payloads may use.
interface CostModEnvelope {
  readonly kind: "costMod";
  readonly effect: CostModEffect;
}

const isEnvelope = (x: unknown): x is CostModEnvelope =>
  typeof x === "object" && x !== null && "kind" in x && (x as { kind: unknown }).kind === "costMod";

export const gatherCostModsFor = (game: Game, stackItem: unknown): readonly CostModEffect[] => {
  const statics = game.staticEffectRegistry.byCategory("costModification");
  const out: CostModEffect[] = [];
  for (const s of statics) {
    const payload = s.describe();
    const concrete: CostModEffect = isEnvelope(payload) ? payload.effect : (payload as CostModEffect);
    if (concrete.filter(stackItem, game)) out.push(concrete);
  }
  return out;
};

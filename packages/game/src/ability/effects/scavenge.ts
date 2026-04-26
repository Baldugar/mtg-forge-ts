// SPDX-License-Identifier: GPL-3.0-or-later
// ScavengeEffect — resolver for the synthesized Scavenge activated
// ability (Return to Ravnica, CR 702.95). After CostExileSelfFromGrave
// moves the source from graveyard to exile, this effect picks any
// battlefield Creature via chooseCard and stamps P1P1 counters equal
// to the source's printed power.
import type { EntityId, PaperCard } from "@mtg-forge-ts/core";
import { CardType, CounterType, ZoneType } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

/** Read printed power from the PaperCard.definition.pt slot. Tolerant of
 * non-numeric printed values (e.g. "*", "X+1") — those scavenge-as-zero
 * which is rules-faithful for the corner case. */
const printedPower = (paper: PaperCard | undefined): number => {
  const pt = paper?.definition?.pt;
  if (!pt) return 0;
  const parsed = Number.parseInt(pt.power, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export class ScavengeEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Scavenge";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const source = game.cards.get(sa.sourceCardId);
    if (!source) return;
    const n = printedPower(source.paperCard);
    if (n <= 0) return;

    const eligible: EntityId[] = [];
    for (const [id, c] of game.cards) {
      if (c.zone !== ZoneType.Battlefield) continue;
      const chars = game.layerEngine.computeCharacteristics(id);
      if (!chars.types.has(CardType.Creature)) continue;
      eligible.push(id);
    }
    if (eligible.length === 0) return;

    const decision = (yield {
      kind: "decision",
      request: {
        kind: "chooseCard",
        playerSeat: sa.controllerSeat,
        pool: eligible,
        restriction: { keyword: "scavenge", n },
        min: 1,
        max: 1,
      },
    }) as { readonly kind: "chooseCard"; readonly chosen: readonly EntityId[] } | undefined;

    const targetId = decision?.kind === "chooseCard" ? decision.chosen[0] : undefined;
    if (targetId === undefined) return;
    if (!eligible.includes(targetId)) return;

    yield* game.action.addCounter(targetId, CounterType.PlusOnePlusOne, n, sa.sourceCardId);
  }
}

effectRegistry.register(ScavengeEffect);

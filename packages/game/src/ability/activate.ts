// SPDX-License-Identifier: GPL-3.0-or-later
// activateAbility — orchestrator for activated abilities (AB$ lines).
//
// An activated ability follows the pattern:
//   1. Validate: card exists, correct zone (Battlefield for most AB$
//      abilities), controller is the active player.
//   2. Validate summoning sickness: if the cost contains a tap symbol (T)
//      AND the source is a creature, it must have been under the
//      controller's control since the start of their turn (CR 302.6).
//      SP2 models this as a simple tapped/untapped check — if the card
//      entered the battlefield this turn AND is a creature AND the cost
//      contains T, we block activation. We defer the full
//      "since the beginning of the controlling player's most recent turn"
//      tracking to SP3; the tap cost itself will fail if the card is
//      already tapped.
//   3. Parse the cost string via parseCostString.
//   4. Pay via payCost (emits CardTapped for {T}, etc.).
//   5. Build a StackItem of kind "activatedAbility" with the SA's
//      makeResolver().
//   6. Push via game.action.putOnStack — which emits AbilityActivated.
//   7. Return the StackItem id.
//
// MVP scope: no-target activated abilities (Llanowar Elves {T}: Add {G}).
// Targeted activated abilities (e.g. equip) are SP3+.
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { EngineYield } from "../action/engine-yield.js";
import { parseCostString, payCost } from "../cost/parts/cost-payment.js";
import type { Game } from "../game.js";
import type { StackItem, StackItemProvenance } from "../stack/stack-item.js";

/**
 * Activate the ability at `abilityIndex` on `cardId`. Validates the
 * activation is legal, pays the cost, pushes to the stack, and returns
 * the StackItem id.
 *
 * Throws if:
 *   - the card doesn't exist in game.cards,
 *   - the card is not on the battlefield,
 *   - the ability index is out of range,
 *   - the cost cannot be paid (payCost throws).
 */
export function* activateAbility(
  game: Game,
  cardId: EntityId,
  abilityIndex: number,
  controllerSeat: PlayerSeat,
): Generator<EngineYield, EntityId, unknown> {
  // 1. Validate card exists and is on the battlefield.
  const card = game.cards.get(cardId);
  if (!card) {
    throw new Error(`activateAbility: card ${cardId} not found in game.cards`);
  }
  if (card.zone !== ZoneType.Battlefield) {
    throw new Error(
      `activateAbility: card ${cardId} is in zone ${card.zone}, not Battlefield — activated abilities require the battlefield zone`,
    );
  }
  if (card.controllerSeat !== controllerSeat) {
    throw new Error(
      `activateAbility: seat ${controllerSeat} does not control card ${cardId} (controller is ${card.controllerSeat})`,
    );
  }

  // 2. Fetch the SpellAbility.
  const sa = card.spellAbilities[abilityIndex];
  if (!sa) {
    throw new Error(
      `activateAbility: ability index ${abilityIndex} out of range (card ${cardId} has ${card.spellAbilities.length} abilities)`,
    );
  }

  // 3. Parse the cost.
  const costRaw = sa.ast.cost.raw;
  const plan = parseCostString(costRaw);

  // 4. Pay the cost.
  const costCtx = {
    game,
    payerSeat: controllerSeat,
    sourceCardId: cardId,
    raw: costRaw,
  };
  const receipts = yield* payCost(plan, costCtx);

  // 5. Build the StackItem.
  const itemId = game.newEntityId();
  const provenance: StackItemProvenance = {
    originZone: ZoneType.Battlefield,
    altCostUsed: null,
    additionalCostsPaid: [],
  };
  const stackItem: StackItem = {
    id: itemId,
    sourceCardId: cardId,
    controllerSeat,
    kind: "activatedAbility",
    isCast: false,
    targets: null,
    modes: [],
    xValue: null,
    costPaid: receipts,
    provenance,
    resolver: sa.makeResolver(),
  };

  // 6. Push to stack (emits AbilityActivated).
  yield* game.action.putOnStack(stackItem);

  // 7. Return the stack item id for callers that need to track it.
  return itemId;
}

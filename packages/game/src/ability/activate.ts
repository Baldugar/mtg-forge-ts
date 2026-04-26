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
// Wave 8 — target selection (CR 602.1b). When the activated ability
// publishes a ValidTgts$ filter on its effect, choose targets BEFORE
// paying costs (announce → choose targets → pay costs → on stack).
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import { IllegalDecisionError, mkEvent } from "@mtg-forge-ts/core";
import type { EngineYield } from "../action/engine-yield.js";
import { parseValidTgts } from "../cast/valid-targets.js";
import { parseCostString, payCost } from "../cost/parts/cost-payment.js";
import type { Game } from "../game.js";
import type { StackItem, StackItemProvenance } from "../stack/stack-item.js";
import type { TargetChoices, TargetRef } from "../target/restriction.js";
import { SpellAbility } from "./spell-ability.js";

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
  // 1. Validate card exists.
  const card = game.cards.get(cardId);
  if (!card) {
    throw new Error(`activateAbility: card ${cardId} not found in game.cards`);
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

  // 3a. Validate zone: the ability must be active in the card's current zone.
  //   Default battlefield-activated abilities (e.g. Llanowar Elves {T}: Add {G})
  //   carry activeInZones = {Battlefield}. Cycling-synthesized abilities carry
  //   activeInZones = {Hand}. Any future keyword can override as needed.
  if (!sa.activeInZones.has(card.zone)) {
    throw new Error(
      `activateAbility: ability ${abilityIndex} on card ${cardId} is not active in zone ${card.zone} ` +
        `(active in: ${[...sa.activeInZones].join(", ")})`,
    );
  }

  // 3b. Wave 8 — target selection (CR 602.1b: choose modes/targets BEFORE
  //     paying costs). If the ability's effect carries a ValidTgts$ param,
  //     parse it into a TargetRestriction, enumerate eligible targets via
  //     game.targetSystem, yield chooseCastTargets, validate the response.
  //
  // Targets are stored as TargetRef[] (card | player). For binding into the
  // SpellAbility constructor we map them to EntityId[] (PlayerSeat is a
  // branded number, same underlying type as EntityId — same coercion the
  // cast pipeline uses).
  const validTgtsParam = sa.ast.effect.params.ValidTgts;
  let chosenTargets: readonly TargetRef[] = [];
  if (validTgtsParam && validTgtsParam.kind === "literal" && validTgtsParam.raw) {
    const restriction = parseValidTgts(validTgtsParam.raw);
    const enumerationCtx = {
      sourceId: cardId,
      sourceControllerSeat: controllerSeat,
    };
    const eligible = game.targetSystem.enumerate(enumerationCtx, restriction);
    const response = (yield {
      kind: "decision",
      request: {
        kind: "chooseCastTargets",
        playerSeat: controllerSeat,
        sourceId: cardId,
        legalTargets: eligible as readonly unknown[],
        min: restriction.minTargets,
        max: restriction.maxTargets,
        ...(restriction.divideX !== undefined ? { divideX: restriction.divideX } : {}),
      },
    }) as {
      readonly kind: "chooseCastTargets";
      readonly targets: readonly unknown[];
      readonly divisions?: Readonly<Record<number, number>>;
    };
    chosenTargets = response.targets as readonly TargetRef[];
    const choices: TargetChoices =
      response.divisions !== undefined
        ? { targets: chosenTargets, divisions: { ...response.divisions } }
        : { targets: chosenTargets };
    if (!game.targetSystem.validateAtCast(choices, enumerationCtx, restriction)) {
      throw new IllegalDecisionError(
        `activateAbility: invalid target selection for card ${cardId} ability ${abilityIndex}`,
      );
    }
    // Emit CardTargeted for each card-typed target so BecomesTargetTrigger fires.
    for (const ref of chosenTargets) {
      if (ref.kind === "card") {
        yield game.emitEvent(
          mkEvent("CardTargeted", game.turn, game.phase, {
            targetId: ref.id,
            sourceCardId: cardId,
            targetingSeat: controllerSeat,
          }),
        );
      }
    }

    // Wave 16b — CrimeCommitted (CR 113.13). Activated abilities that target
    // an opponent-controlled object/player commit a crime (e.g. Murders at
    // Karlov Manor activated abilities). Mirror the cast-pipeline emit.
    let crimeVictimSeat: PlayerSeat | undefined;
    let crimeVictimCardId: EntityId | undefined;
    for (const ref of chosenTargets) {
      if (ref.kind === "card") {
        const targetCard = game.cards.get(ref.id);
        if (targetCard && targetCard.controllerSeat !== controllerSeat) {
          crimeVictimSeat = targetCard.controllerSeat;
          crimeVictimCardId = ref.id;
          break;
        }
      } else if (ref.kind === "player") {
        if (ref.seat !== controllerSeat) {
          crimeVictimSeat = ref.seat;
          break;
        }
      }
    }
    if (crimeVictimSeat !== undefined) {
      yield game.emitEvent(
        mkEvent("CrimeCommitted", game.turn, game.phase, {
          playerSeat: controllerSeat,
          sourceCardId: cardId,
          ...(crimeVictimSeat !== undefined ? { victimSeat: crimeVictimSeat } : {}),
          ...(crimeVictimCardId !== undefined ? { victimCardId: crimeVictimCardId } : {}),
        }),
      );
    }
  }

  // 3. Parse the cost.
  const costRaw = sa.ast.cost.raw;
  const plan = parseCostString(costRaw);

  // 4. Pay the cost. Wave 11 — thread kind="ability" + the card's current
  // zone so cost-mod statics gated on Type$ Ability / AffectedZone$ fire
  // correctly (e.g. Gloom: activated abilities of white enchantments cost
  // {3} more — only matches when the source is on the battlefield).
  const costCtx = {
    game,
    payerSeat: controllerSeat,
    sourceCardId: cardId,
    raw: costRaw,
    kind: "ability" as const,
    sourceZone: card.zone,
  };
  const receipts = yield* payCost(plan, costCtx);

  // 4a. Wave 5 — if the ability is tagged "cycling", emit CardCycled now that
  //     costs have been paid (the card was discarded as part of the cost).
  if (sa.tags.has("cycling")) {
    yield game.emitEvent(
      mkEvent("CardCycled", game.turn, game.phase, {
        cardId,
        playerSeat: controllerSeat,
      }),
    );
  }

  // 5. Build the StackItem.
  const itemId = game.newEntityId();
  // originZone reflects where the card actually was when the ability was
  // activated — Battlefield for normal AB$ abilities, Hand for Cycling, etc.
  const provenance: StackItemProvenance = {
    originZone: card.zone,
    altCostUsed: null,
    additionalCostsPaid: [],
  };

  // Wave 8 — build a target-bound resolver when targets were chosen. Mirror
  // the cast-pipeline finalizeStackItem pattern: when chosenTargets is
  // non-empty, construct a fresh SpellAbility with the bound EntityIds and
  // use its resolver. Otherwise fall through to the unbound template's
  // resolver. PlayerSeat is a branded number, same underlying as EntityId,
  // so casting through unknown is safe at runtime (the same coercion the
  // cast pipeline performs in finalizeStackItem).
  let resolver = sa.makeResolver();
  if (chosenTargets.length > 0) {
    const targetIds: EntityId[] = chosenTargets.map((ref) =>
      ref.kind === "card" ? ref.id : (ref.seat as unknown as EntityId),
    );
    const boundSa = new SpellAbility(
      sa.ast,
      sa.sourceCardId,
      sa.controllerSeat,
      sa.svars,
      targetIds,
      sa.xValue,
      sa.activeInZones,
      sa.tags,
    );
    resolver = boundSa.makeResolver();
  }

  const stackItem: StackItem = {
    id: itemId,
    sourceCardId: cardId,
    controllerSeat,
    kind: "activatedAbility",
    isCast: false,
    targets: chosenTargets.length > 0 ? chosenTargets : null,
    modes: [],
    xValue: null,
    costPaid: receipts,
    provenance,
    resolver,
  };

  // 6. Push to stack (emits AbilityActivated).
  yield* game.action.putOnStack(stackItem);

  // 7. Return the stack item id for callers that need to track it.
  return itemId;
}

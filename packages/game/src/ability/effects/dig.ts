// SPDX-License-Identifier: GPL-3.0-or-later
// DigEffect — top-N library lookup with selective zone movement (57+ cards).
//
// Forge DSL:
//   A:SP$ Dig | Cost$ 2 U | DigNum$ 5 | ChangeNum$ 1 | DestinationZone$ Hand
//              | LibraryPosition$ -1 | RestRandomOrder$ True
//
// Mechanic:
//   1. Peek at (i.e. temporarily remove from library) the top DigNum$ cards.
//   2. Yield a "chooseCard" decision: pick ChangeNum$ cards to move to
//      DestinationZone$ (default: Hand).
//   3. Move the chosen cards to the destination zone via game.action.moveTo
//      so zone-change triggers, replacement effects, and Card.zone bookkeeping
//      are all respected.
//   4. Return unchosen cards to the library:
//        LibraryPosition$ -1  → bottom (library.add at end)
//        LibraryPosition$ 0   → top (library.addToTop, reverse order so the
//                               first-peeked card ends up topmost)
//      Returning to library is done directly on the Zone — these cards never
//      truly left (they were temporarily held in the peeked buffer), so we
//      mirror the scry implementation which also skips moveTo for the
//      "return to library" step.
//
// Decision kind: chooseCard. Response field: chosen (EntityId[]).
// Fallback (no driver / deterministic): first ChangeNum$ peeked cards.
import type { DecisionResponse, EntityId } from "@mtg-forge-ts/core";
import { GameStateIntegrityError, ZoneType } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

/**
 * Map a Forge DestinationZone$ string to ZoneType. Common values:
 *   Hand, Graveyard, Exile, Battlefield, Library.
 * Unrecognised strings fall back to Hand (safe default).
 */
const destToZone = (dest: string): ZoneType => {
  switch (dest.toLowerCase()) {
    case "hand":
      return ZoneType.Hand;
    case "graveyard":
      return ZoneType.Graveyard;
    case "exile":
      return ZoneType.Exile;
    case "battlefield":
      return ZoneType.Battlefield;
    case "library":
      return ZoneType.Library;
    default:
      return ZoneType.Hand;
  }
};

export class DigEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Dig";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const seat = sa.controllerSeat;
    const player = game.getPlayer(seat);
    const library = player.zones.get(ZoneType.Library);
    if (!library) throw new GameStateIntegrityError(`DigEffect: player ${seat} has no Library zone`);

    const digNum = hasParam(sa, "DigNum") ? evaluateParamNumber(sa, "DigNum", game) : 1;
    const changeNum = hasParam(sa, "ChangeNum") ? evaluateParamNumber(sa, "ChangeNum", game) : 1;
    const destStr = hasParam(sa, "DestinationZone") ? evaluateParamRaw(sa, "DestinationZone") : "Hand";
    const libPosStr = hasParam(sa, "LibraryPosition") ? evaluateParamRaw(sa, "LibraryPosition") : "0";

    // Temporarily remove the top digNum cards from the library into a local
    // "peeked" buffer. Index 0 = was the top card (drawn first).
    const peeked: EntityId[] = [];
    for (let i = 0; i < digNum; i++) {
      const id = library.peekAt(0);
      if (id === undefined) break;
      library.removeAt(0);
      peeked.push(id);
    }
    if (peeked.length === 0) return;

    const actualChange = Math.min(changeNum, peeked.length);

    // Yield decision: choose actualChange cards from peeked to move.
    const rawResponse = yield {
      kind: "decision",
      request: {
        kind: "chooseCard",
        playerSeat: seat,
        pool: peeked,
        restriction: null,
        min: actualChange,
        max: actualChange,
      },
    };

    const response = rawResponse as DecisionResponse | undefined;
    let chosen: readonly EntityId[];
    if (response && response.kind === "chooseCard") {
      chosen = response.chosen;
    } else {
      // Deterministic fallback: first actualChange peeked cards.
      chosen = peeked.slice(0, actualChange);
    }

    const chosenSet = new Set<EntityId>(chosen as EntityId[]);
    const rest = peeked.filter((id) => !chosenSet.has(id));

    // Phase 1 — return unchosen cards to the library. Cards in the peeked
    // buffer are not in any zone (GameAction.locate would throw). We re-seat
    // them directly on the Zone object — same pattern as GameAction.scry()
    // for its "return to library" step, which also bypasses moveTo for cards
    // that were temporarily held in a revealed buffer.
    const toBottom = libPosStr.trim() === "-1";
    if (toBottom) {
      // Library.add(id) with default index appends at the bottom.
      for (const cid of rest) {
        library.add(cid);
      }
    } else {
      // Return to the top in original peeked order. Iterate in reverse so
      // that rest[0] (the card that was topmost originally) ends up at index 0
      // after all addToTop calls.
      for (let i = rest.length - 1; i >= 0; i--) {
        const cid = rest[i];
        if (cid !== undefined) library.addToTop(cid);
      }
    }

    // Phase 2 — move chosen cards to the destination zone. We first put them
    // back into the library (so GameAction.locate can find them), then route
    // each through moveTo so zone-change triggers, replacements, and
    // Card.zone bookkeeping are all respected. Temporarily added at the
    // bottom (index = library.size) to keep them out of the way; their
    // precise library position is irrelevant since moveTo will remove them
    // immediately afterward.
    const destZone = destToZone(destStr);
    for (const cid of chosen) {
      library.add(cid); // re-seat so locate() can find it
      yield* game.action.moveTo(cid, destZone, { toSeat: seat, cause: "dig" });
    }
  }
}

effectRegistry.register(DigEffect);

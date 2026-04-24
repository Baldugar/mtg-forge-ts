// SPDX-License-Identifier: GPL-3.0-or-later
// CR 701.37 — meld. Two specific named cards combine into one
// "melded" permanent with a third-face identity. Forge's canonical
// meld pairs (Bruna/Gisela → Brisela, Graf Rats/Midnight Scavengers →
// Chittering Host, etc.) pick ONE of the two originals to host the
// "melded" FaceDefinition so the combined permanent has a concrete
// paperCard identity to project.
//
// SP2 scope: the state-mutation primitive. Exiles both originals,
// mints a new Card with face="melded" on the battlefield under the
// shared controller, bumps the epoch, emits `Melded`. Snapshot /
// un-meld / trigger wiring is SP3's job.
import type { EntityId } from "@mtg-forge-ts/core";
import { GameStateIntegrityError, ZoneType, mkEvent } from "@mtg-forge-ts/core";
import type { EngineYield } from "../action/engine-yield.js";
import { Card } from "../card.js";
import type { Game } from "../game.js";

/**
 * Execute the meld operation on two cards A and B owned by the same
 * player. Runs as:
 *   1. Validate both ids resolve and share a controller.
 *   2. Exile each original through GameAction.exile (routes through
 *      the replacement chain — a player with a "this can't be exiled"
 *      replacement would prevent meld; SP3's full rules DSL layers
 *      the "you can't meld unless" checks on top).
 *   3. Mint a new Card on the battlefield under the shared controller
 *      using cardA's paperCard as the identity source (cardA is, by
 *      Forge convention, the primary meld half whose PaperCard carries
 *      the `melded` FaceDefinition).
 *   4. Emit `Melded` carrying the new id and the two source ids.
 *
 * Returns the minted `meldedId` so callers (SP3 trigger handlers, tests)
 * can track the fused permanent.
 */
export function* meld(
  game: Game,
  cardIdA: EntityId,
  cardIdB: EntityId,
): Generator<EngineYield, EntityId, unknown> {
  const cardA = game.cards.get(cardIdA);
  const cardB = game.cards.get(cardIdB);
  if (!cardA || !cardB) {
    throw new GameStateIntegrityError(`meld: card missing (${cardIdA}, ${cardIdB})`);
  }
  if (cardA.controllerSeat !== cardB.controllerSeat) {
    throw new GameStateIntegrityError(
      `meld: cards must share controller (A=${cardA.controllerSeat}, B=${cardB.controllerSeat})`,
    );
  }
  const sharedController = cardA.controllerSeat;
  // Exile the two originals through the canonical mutator so replace-
  // ment effects see the move. If a replacement prevents one of the
  // exiles, the meld still proceeds on the surviving half — SP3 adds
  // the "both-must-exile" gate; SP2 keeps the primitive minimal so
  // tests can inspect the raw behavior.
  yield* game.action.exile(cardIdA);
  yield* game.action.exile(cardIdB);
  // Mint the melded permanent.
  const meldedId = game.newEntityId();
  // WHY cardA.paperCard: by Forge convention one of the two originals
  // carries the canonical melded-face data on its PaperCard.faces map.
  // Tests can exercise either ordering.
  const melded = new Card(meldedId, cardA.paperCard, cardA.ownerSeat, sharedController, ZoneType.Battlefield);
  melded.face = "melded";
  melded.meldedFrom = [cardIdA, cardIdB];
  game.cards.set(meldedId, melded);
  const bf = game.getPlayer(sharedController).zones.get(ZoneType.Battlefield);
  if (!bf) {
    throw new GameStateIntegrityError(`meld: battlefield missing for seat ${sharedController}`);
  }
  bf.add(meldedId);
  game.layerEngine.bumpEpoch("meld");
  yield {
    kind: "event",
    event: mkEvent("Melded", game.turn, game.phase, {
      meldedId,
      sourceIds: [cardIdA, cardIdB],
    }),
  };
  return meldedId;
}

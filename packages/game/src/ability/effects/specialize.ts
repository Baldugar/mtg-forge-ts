// SPDX-License-Identifier: GPL-3.0-or-later
// SpecializeEffect — March of the Machine "Specialize" face-flip resolver
// (CR 702.155). Synthesized by SpecializeKeywordHandler on a card with
// K:Specialize:<cost>; runs once the activated ability resolves off the
// stack.
//
// Resolution sequence:
//   1. Yield a chooseColor decision (no colorless option — Specialize
//      explicitly picks one of W/U/B/R/G).
//   2. Map the chosen Color enum → the canonical face-slot key
//      ("W"/"U"/"B"/"R"/"G") matching CardSpecialized event payload and
//      PaperCard.faces keying convention.
//   3. Set card.face to the chosen color slot. Bump the layer engine epoch
//      so deriveBaseCharacteristics rereads from the new face on next
//      computeCharacteristics call.
//   4. Emit a CardSpecialized event so SpecializesTrigger (Wave 20) fires.
//
// Non-interactive fallback (no decision response supplied): default to
// White, mirroring ChooseColorEffect's fallback. This keeps headless tests
// and snapshot-replay paths deterministic.
import type { DecisionResponse, EntityId } from "@mtg-forge-ts/core";
import { Color, mkEvent } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

type SpecializeColor = "W" | "U" | "B" | "R" | "G";

const COLOR_TO_SLOT: ReadonlyMap<Color, SpecializeColor> = new Map<Color, SpecializeColor>([
  [Color.White, "W"],
  [Color.Blue, "U"],
  [Color.Black, "B"],
  [Color.Red, "R"],
  [Color.Green, "G"],
]);

const colorToSlot = (c: Color | null): SpecializeColor => {
  if (c === null) return "W";
  return COLOR_TO_SLOT.get(c) ?? "W";
};

export class SpecializeEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Specialize";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const sourceId: EntityId = sa.sourceCardId;
    const card = game.cards.get(sourceId);
    if (!card) return;

    // 1. Ask the controller to pick a color.
    const rawResponse = yield {
      kind: "decision",
      request: {
        kind: "chooseColor",
        sourceId,
        allowColorless: false,
      },
    };
    const response = rawResponse as DecisionResponse | undefined;
    let chosen: Color | null;
    if (response && response.kind === "chooseColor") {
      chosen = response.color;
    } else {
      chosen = Color.White;
    }
    const slot: SpecializeColor = colorToSlot(chosen);

    // 2. Flip the active face. Cast through unknown/string is required
    //    because FaceKind's union literal exposes the color slots; using
    //    the slot variable directly satisfies the type checker.
    card.face = slot;

    // 3. Invalidate the layer engine cache so the new face's data is read.
    game.layerEngine.bumpEpoch("specialize");

    // 4. Announce the face flip — SpecializesTrigger (Wave 20) listens for
    //    CardSpecialized and fires per-card via Card.Self matching.
    yield game.emitEvent(
      mkEvent("CardSpecialized", game.turn, game.phase, {
        cardId: sourceId,
        color: slot,
      }),
    );
  }
}

effectRegistry.register(SpecializeEffect);

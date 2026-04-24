// SPDX-License-Identifier: GPL-3.0-or-later
// CR 708.2 — face-down override. A face-down permanent is a 2/2 colorless
// creature with no name, no mana cost, and no abilities. Applied in Layer 1
// AFTER any copy effect (CR 707.11: if a face-down card is copied, the copy
// is still face-down; the face-down override wins over copiable values).
//
// Layer 1 ordering (CR 613.1a + 707.11):
//   1. Apply copy-effect characteristics from `card.copiedFrom`.
//   2. Apply face-down override from `card.faceDown` (this module).
//   3. Layer 2..7 continue on the resulting characteristics.
//
// Non-copiable state (counters, damage, attachments) is untouched by Layer 1
// generally and by this module specifically. The owner's private View still
// sees the real card identity; face-down override operates on the PUBLIC
// characteristics that Layer 1 produces.
//
// SP2 scope: `abilities` on Characteristics is the currently-active ref list
// Layer 6 repopulates on each walk; clearing it here is idempotent-safe.
// Granted abilities from Layer 6 may land AFTER Layer 1 and re-add entries —
// that's fine per CR 708.2 ("no abilities" refers to INTRINSIC abilities;
// effects that grant abilities to face-down permanents continue to apply).
import { CardType, type Characteristics, ColorSet, type FaceDownState, ManaCost } from "@mtg-forge-ts/core";

export const applyFaceDownOverride = (target: Characteristics, fd: FaceDownState): void => {
  switch (fd.kind) {
    case "none":
      return;
    case "morph":
    case "manifest":
    case "foretell":
    case "disguise":
    case "cloak":
      break;
    default: {
      const _never: never = fd;
      throw new Error(`applyFaceDownOverride: unreachable ${JSON.stringify(_never)}`);
    }
  }
  target.name = "";
  target.manaCost = ManaCost.parse("");
  target.colorIndicator = null;
  target.supertypes.clear();
  target.types.clear();
  target.types.add(CardType.Creature);
  target.subtypes.clear();
  target.colors = ColorSet.empty();
  target.rulesText = "";
  target.power = 2;
  target.toughness = 2;
  target.loyalty = null;
  target.defense = null;
  // Clear intrinsic ability refs. Layer 6 will add granted abilities back if
  // any effect grants abilities to the face-down permanent (e.g., Ixidron's
  // passive doesn't actually grant abilities, but morph-cost-reduction
  // effects do attach abilities to face-down creatures).
  target.abilities.length = 0;
};

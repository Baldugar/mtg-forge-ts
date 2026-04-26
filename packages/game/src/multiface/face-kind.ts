// SPDX-License-Identifier: GPL-3.0-or-later
// FaceKind — enum of face-slot keys used by multi-face cards.
//
// Semantics per key:
//   "default"   — no multi-face selection; read the card's printed data
//                  (or combined characteristics for split cards off-stack,
//                  per CR 708.4a).
//   "L" / "R"   — split-card halves. Chosen at cast (CastPipeline step 2);
//                  stored on StackItemProvenance.faceChosen and mirrored to
//                  Card.face when the spell goes to the stack.
//   "front"     — default face for transform DFCs / flip cards / MDFCs.
//   "back"      — the flipped / transformed side.
//   "adventure" — the instant/sorcery "adventure" half of an adventure card.
//   "flipped"   — Kamigawa flip cards' flipped state (same physical face;
//                  in-place rotation flags different characteristics).
//   "melded"    — the merged permanent produced by the meld mechanic
//                  (CR 701.37).
//   "W"/"U"/"B"/"R"/"G" — March of the Machine "Specialize" face slots
//                  (CR 702.155). When a creature with K:Specialize is
//                  on the battlefield, paying the specialize cost lets
//                  its controller pick a color and replace the active
//                  face with that color's variant. The five color-keyed
//                  faces live in PaperCard.faces under these slot ids.
//
// The union is closed — all multi-face kinds SP2/SP3 models live here; SP4
// can extend it when the PaperCard.definition layer adds new face families.
export type FaceKind =
  | "default"
  | "L"
  | "R"
  | "front"
  | "back"
  | "adventure"
  | "flipped"
  | "melded"
  | "W"
  | "U"
  | "B"
  | "R"
  | "G";

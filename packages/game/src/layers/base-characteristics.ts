// SPDX-License-Identifier: GPL-3.0-or-later
// Compute the pre-layer "base" Characteristics of a Card from its PaperCard.
// This is the input to LayerEngine — Layers 1..7e all apply on top.
//
// Reads PaperCard.definition when present:
//   - types → supertypes, types, subtypes (Set<Supertype>, Set<CardType>, Set<string>)
//   - pt    → power / toughness as numbers (parsed from string; '*'/'X' → null)
//   - manaCost → ManaCost.parse(ast.raw) for CMC-aware mana cost
//   - colors → copied directly when explicitly set on the definition
//
// Cards with NO definition (token fixtures, synthetic test cards) fall through
// to the empty baseline. LayerEngine must be able to run before CardDb
// attaches a definition.
//
// SP2 Task 58 (Milestone Q) — multi-face support. When PaperCard.faces
// publishes a Record<FaceKind, FaceDefinition> and Card.face points into
// it, we read the face's name from the map instead of paperCard.name.
// Split cards whose face is still "default" use the combined-both-halves
// name per CR 708.4a; all other "default" cases (single-face cards, DFCs
// before any chooseFace selection, etc.) fall through to paperCard.name.
import type { ManaCostAst } from "@mtg-forge-ts/core";
import { CardType, type Characteristics, ManaCost, emptyCharacteristics } from "@mtg-forge-ts/core";
import type { Card } from "../card.js";
import { combinedSplitCharacteristics, isSplitCard } from "../multiface/split.js";

// Wave 10 — Bestow type-flip (see end of deriveBaseCharacteristics). Hoist
// the enum value to a module-local constant for readability.
const CARDTYPE_CREATURE = CardType.Creature;

/**
 * Parse a P/T string ("2", "*", "1+*", "X") into a number or null.
 * CR 208.2 — variable P/T values (* / X / 1+*) have no fixed number at the
 * base-characteristics level; the layer engine resolves them via CDA layers.
 * We return null here so layer 7 can apply the real value later.
 */
const parsePt = (raw: string): number | null => {
  const n = Number(raw);
  if (!Number.isNaN(n) && raw.trim() !== "") return n;
  return null; // '*', 'X', '1+*', etc.
};

export const deriveBaseCharacteristics = (card: Card): Characteristics => {
  const base = emptyCharacteristics();
  const paper = card.paperCard;
  const faces = paper.faces;

  // Face-aware path: PaperCard publishes a faces Record.
  if (faces !== undefined) {
    if (card.face !== "default") {
      const face = faces[card.face];
      if (face !== undefined) {
        base.name = face.name;
        // SP4 populates more fields from PaperCard.definition[card.face].
        return base;
      }
      // Face key not present — fall through to the paperCard.name fallback.
    } else if (isSplitCard(paper)) {
      // CR 708.4a — split cards in non-stack zones use both halves' combined
      // characteristics. The per-face path above is taken only when a half
      // has been chosen (CastPipeline sets Card.face before the stack push).
      return combinedSplitCharacteristics(paper);
    }
  }

  // Fallback: single-face card, or a face key not in the map.
  if (paper.name !== undefined) base.name = paper.name;

  // Populate from definition when present.
  const def = paper.definition;
  if (def !== undefined) {
    // types: supertypes, core types, subtypes.
    for (const st of def.types.supertypes) base.supertypes.add(st);
    for (const ct of def.types.types) base.types.add(ct);
    for (const sub of def.types.subtypes) base.subtypes.add(sub);

    // manaCost: ManaCostAst carries a .raw string; parse it into a ManaCost.
    // Typed as `unknown` in CardDefinition until the DSL AST lands; probe
    // structurally so we don't need to widen the type definition here.
    const manaCostAst = def.manaCost as ManaCostAst | null | undefined;
    if (manaCostAst != null && typeof manaCostAst === "object" && typeof manaCostAst.raw === "string") {
      try {
        base.manaCost = ManaCost.parse(manaCostAst.raw);
      } catch {
        // Unparseable raw string — keep the empty baseline (hasNoCost=true).
      }
    }

    // P/T: only meaningful for Creature (and Vehicle / Saga after animate).
    // We populate it unconditionally from the definition and let the layer
    // engine resolve CDA values. Non-creature cards have null pt in the
    // definition anyway.
    if (def.pt !== undefined) {
      base.power = parsePt(def.pt.power);
      base.toughness = parsePt(def.pt.toughness);
    }

    // colors: if explicitly set on the definition, use it. Otherwise the
    // colors field stays ColorSet.empty() — Layer 5 derives color from mana
    // cost for cards without a color indicator override.
    if (def.colors !== undefined) {
      base.colors = def.colors;
    }
  }

  // Wave 10 — Bestow (CR 702.103). A bestowed permanent is an Aura, not a
  // creature, while attached. We flip the base type-set BEFORE Layer 4 so
  // any subsequent type-changing effects (animate, etc.) compose normally.
  // Conditions:
  //   - card.bestowed === true (set by the bestow alt-cost cast pipeline),
  //   - card.attachedTo !== null (still attached to a target),
  //   - the card has CardType.Creature in its base types (defensive check).
  // When all three hold, remove Creature from the type set, add Aura as a
  // subtype, and clear power/toughness (an Aura has no P/T).
  // When attachedTo === null, the card reverts to its printed creature
  // form — the bestowed flag stays true so this branch can re-fire if it's
  // re-attached, but the SBA pipeline clears `bestowed` once the card
  // leaves the battlefield (CR 702.103, applyBestowAuraReverts in sba/).
  if (card.bestowed && card.attachedTo !== null) {
    // Lazy import shouldn't be needed — CardType is already used above. We
    // need the enum reference: fetch it via the constructor name from the
    // base.types Set's element type. We can't `import { CardType }` at the
    // top because base-characteristics.ts is layer-engine-internal — the
    // enum is exported from @mtg-forge-ts/core; importing it is fine.
    base.types.delete(CARDTYPE_CREATURE);
    base.subtypes.add("Aura");
    // Aura has no P/T; clear the printed creature P/T so layer 7 doesn't
    // operate on stale numbers.
    base.power = null;
    base.toughness = null;
  }

  return base;
};

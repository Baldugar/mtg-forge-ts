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
import {
  CardType,
  type Characteristics,
  Color,
  ColorSet,
  ManaCost,
  emptyCharacteristics,
} from "@mtg-forge-ts/core";
import type { Card } from "../card.js";
import { combinedSplitCharacteristics, isSplitCard } from "../multiface/split.js";

// Wave 45 — ChangeText (Layer 1/4 partial wiring). Maps the canonical
// English color word found in card text to the corresponding Color bit so
// `card.textChanges` rewrites can swap one color for another in the
// effective ColorSet. Casing matches Forge's printed-text convention
// (Title-Case word). Wave 98 — rules-text rewrite path is now wired in:
// the printed `rulesText` is also rewritten in place so phrasings like
// "protection from white" / "deals damage to target Goblin" observe the
// swap. Word-boundary semantics match layers/layer3-text.ts (negative
// lookarounds for word characters, so "creatures" is not partially
// matched by "creature"). Both Title-Case and lower-case forms of the
// color word are rewritten because Forge text uses both ("White creature"
// in costs / type lines, "white" mid-sentence).
const COLOR_WORD_TO_BIT: Readonly<Record<string, Color>> = {
  White: Color.White,
  Blue: Color.Blue,
  Black: Color.Black,
  Red: Color.Red,
  Green: Color.Green,
};

// Word-boundary literal-string substitution mirroring layer3-text. Returns
// the rewritten text so callers can chain replacements on the result.
const replaceWord = (haystack: string, from: string, to: string): string => {
  if (haystack.length === 0 || from.length === 0) return haystack;
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return haystack.replace(new RegExp(`(?<!\\w)${escaped}(?!\\w)`, "g"), to);
};

const applyColorTextChange = (chars: Characteristics, fromWord: string, toWord: string): void => {
  const fromBit = COLOR_WORD_TO_BIT[fromWord];
  const toBit = COLOR_WORD_TO_BIT[toWord];
  if (fromBit === undefined || toBit === undefined) return;
  if (chars.colors.has(fromBit)) {
    // Remove fromBit and union with toBit. ColorSet is immutable; rebuild
    // from the bits we keep + the new one.
    const remaining: Color[] = [];
    for (const c of [Color.White, Color.Blue, Color.Black, Color.Red, Color.Green]) {
      if (c === fromBit) continue;
      if (chars.colors.has(c)) remaining.push(c);
    }
    remaining.push(toBit);
    chars.colors = ColorSet.of(...remaining);
  }
  // CR 612.2 — rewrite both casings of the color word so any color-aware
  // text reader (cost gates, target restrictions, "protection from <X>"
  // checks) observes the swap. Independent of whether the card's own
  // color set held `fromBit` (a card with "deals damage to target white
  // creature" is not itself white but still rewrites the text).
  let txt = chars.rulesText;
  txt = replaceWord(txt, fromWord, toWord);
  txt = replaceWord(txt, fromWord.toLowerCase(), toWord.toLowerCase());
  chars.rulesText = txt;
};

const applyTypeTextChange = (chars: Characteristics, fromType: string, toType: string): void => {
  // CR 612 — the "type word" change rewrites the printed text wholesale,
  // so creature subtypes (Goblin → Elf) flip both on the type line and
  // anywhere the original word appeared in rules text. Wave 98 — rules-
  // text rewrite path is now wired in alongside the subtype-set swap so
  // phrasings like "Goblin creatures you control" observe the change.
  // Title-Case only: subtypes are printed Title-Case in Forge (Goblin /
  // Elf / Soldier) and the rules-text references match. Lower-case forms
  // are not rewritten — they would risk matching unrelated words (e.g.
  // "soldier" inside a flavor reference).
  if (chars.subtypes.has(fromType)) {
    chars.subtypes.delete(fromType);
    chars.subtypes.add(toType);
  }
  chars.rulesText = replaceWord(chars.rulesText, fromType, toType);
};

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
  // Wave 25 — Mutate (CR 702.139). A card that is mutated INTO another's
  // pile is hidden — it no longer exists independently on the battlefield.
  // Returning empty characteristics is the cleanest way to ensure no
  // downstream consumer (P/T derivation, type filters, color enumeration,
  // SBA scans) treats it as a live permanent. The merged pile's
  // characteristics live on the canonical pile owner (the card whose
  // mutatedPile is non-empty). Independent of the multi-face/face-aware
  // path because mutated-into cards may still carry a Card.face value
  // from before they merged; the empty baseline preempts that.
  if (card.mutatedInto !== undefined) {
    return emptyCharacteristics();
  }
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

    // Wave 98 — populate the printed rules text from the definition's
    // oracle string so the Layer 1 ChangeText path (below) can rewrite
    // phrases like "white creature" → "black creature". The layer3
    // text-substitution pass operates on this same field via a
    // dedicated module (layers/layer3-text.ts) that runs over the
    // statics-driven text-change registry; the per-card textChanges
    // rewrite path below operates on the same string in place.
    if (typeof def.oracle === "string" && def.oracle.length > 0) {
      base.rulesText = def.oracle;
    }

    // colors: if explicitly set on the definition (Colors: line override),
    // use it. Otherwise CR 202.2 — a card's color is derived from its mana
    // cost's colored pips. Wave 12: derive from base.manaCost so target
    // filters (forbidColors / forbidColorless) and color-aware effects can
    // reason about printed cards that omit a Colors: line.
    if (def.colors !== undefined) {
      base.colors = def.colors;
    } else {
      base.colors = base.manaCost.colors();
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

  // Wave 24 — Crew (CR 702.121). A Vehicle is normally an artifact only;
  // crewing turns it into an artifact creature until end of turn. The
  // CrewEffect stamps `card.crewedUntilEot = true` and registers an
  // untilEndOfTurn ContinuousEffect whose cleanup hook clears the flag at
  // expiry. We add CardType.Creature here at the base layer so the layer
  // engine sees a creature throughout. The Vehicle keeps its other types
  // (Artifact + Vehicle subtype) — we only ADD Creature, never remove.
  if (card.crewedUntilEot === true) {
    base.types.add(CARDTYPE_CREATURE);
  }

  // Wave 28 — Station (CR 718). Mirrors Crew: a non-creature Spacecraft
  // becomes a creature until end of turn when stationed. Same flag/cleanup
  // pattern as crewedUntilEot.
  if (card.stationedUntilEot === true) {
    base.types.add(CARDTYPE_CREATURE);
  }

  // Wave 60.I / Wave 99 — Crew static (CR 702.122) "is a creature
  // without crewing". Closes the prior TODO(advanced): static-form
  // Vehicles (a small published group, e.g. cards that grant a Vehicle
  // creature-status without a Crew activation) read `crewStaticActive`
  // here so the type-derivation path adds Creature to the type line
  // without requiring a Crew payment. Cleared on static deactivate;
  // additive only (the Vehicle keeps Artifact + Vehicle subtype).
  if (card.crewStaticActive === true) {
    base.types.add(CARDTYPE_CREATURE);
  }

  // Wave 103 — Awaken animation (CR 702.112a). When the awaken
  // sub-effect resolves on a target land, `awakenAnimatedUntilEot`
  // is stamped true and the land "becomes a 0/0 Elemental creature
  // with haste. It's still a land." Closes the Layer 4 type-add +
  // Layer 7b base-PT portion of the prior TODO(advanced): we add
  // CardType.Creature to the type set, append "Elemental" as a
  // subtype, and pin base power/toughness to 0/0 (override the land's
  // null/null baseline). The Haste-grant (Layer 6) ships in a
  // follow-up — Forge models awaken's haste through a static-grant
  // that the keyword scaffold currently registers as an inert
  // Layer 7c slot; the durable contract here is the type-line +
  // P/T derivation that downstream readers (combat enumeration,
  // SBA toughness scan, target filters like "Creature.YouCtrl")
  // observe correctly.
  if (card.awakenAnimatedUntilEot === true) {
    base.types.add(CARDTYPE_CREATURE);
    base.subtypes.add("Elemental");
    base.power = 0;
    base.toughness = 0;
  }

  // Wave 45 — ChangeText (CR 612). Apply each text-change rule on top of
  // the populated characteristics. Wave 98 — rules-text rewrite path is
  // now wired in alongside the color-set / subtype-set swaps, so any
  // downstream consumer reading `chars.rulesText` (target-restriction
  // parsers, "protection from <X>" gates, type-line rewrites) observes
  // the substitution as well. Color words rewrite both casings (Title-
  // Case + lower); type words rewrite Title-Case only (subtypes are
  // canonically Title-Case in Forge text).
  if (card.textChanges.length > 0) {
    for (const tc of card.textChanges) {
      if (tc.kind === "color") applyColorTextChange(base, tc.from, tc.to);
      else applyTypeTextChange(base, tc.from, tc.to);
    }
  }

  // Wave 33 — Embalm / Eternalize (CR 702.131 / 702.139). Token copies spawned
  // by these graveyard-recursion keywords carry tokenOverrides that replace
  // the printed-card characteristics:
  //   - colors: replace the printed color identity wholesale.
  //   - addedTypes: appended as subtypes (Embalm/Eternalize → "Zombie").
  //   - clearManaCost: token has no mana cost (CR 111.10).
  //   - setPower / setToughness: Eternalize prints 4/4 P/T regardless.
  // Applied AFTER the printed population so overrides win.
  const overrides = card.tokenOverrides;
  if (overrides !== undefined) {
    if (overrides.colors !== undefined) {
      base.colors = overrides.colors;
    }
    if (overrides.addedTypes !== undefined) {
      for (const t of overrides.addedTypes) {
        base.subtypes.add(t);
      }
    }
    if (overrides.clearManaCost === true) {
      base.manaCost = ManaCost.parse("");
    }
    if (overrides.setPower !== undefined) {
      base.power = overrides.setPower;
    }
    if (overrides.setToughness !== undefined) {
      base.toughness = overrides.setToughness;
    }
  }

  return base;
};

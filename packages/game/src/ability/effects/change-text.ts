// SPDX-License-Identifier: GPL-3.0-or-later
// ChangeTextEffect — Forge `SP$ ChangeText` (Crystal Spray, Artificial
// Evolution, Alter Reality). Modifies a card's printed text by replacing
// instances of one color word or creature-type word with another.
//
// Forge DSL examples:
//   A:SP$ ChangeText | ValidTgts$ Card | ChangeColorWord$ Choose Choose
//   A:SP$ ChangeText | ValidTgts$ Card | ChangeTypeWord$ ChooseCreatureType ChooseCreatureType
//
// MVP scope:
//   - ChangeColorWord$ "<from> <to>" — store a textChange record on each
//     target card. "Choose Choose" yields two chooseColor decisions
//     (from then to); concrete color names ("White Black") skip the prompt.
//   - ChangeTypeWord$ "<from> <to>" — same pattern with chooseType.
//   - Records appended to card.textChanges; downstream layered text
//     application is deferred to a future wave (the slot is populated
//     and tests verify it; full Layer 1/4 application is SP4-scope).
//
// Wave 84 — bump the layer-engine epoch every time a textChanges record is
// pushed. Layer 3 (text-changing effects, CR 613.1c) is recomputed on every
// epoch bump; downstream consumers that depend on text substitution
// (Layer 4 type / Layer 6 ability tags derived from rules text) re-derive
// against the updated `textChanges` array. Epoch-bumping here is the
// canonical signal that a card's printed-text shadow has changed —
// mirrors the pattern used by `tap` / `untap` / counter mutations in
// game-action.ts. The full Layer 3 derive-text pipeline still defers
// rules-text-driven keyword / ability re-derivation to a future wave; the
// epoch bump unblocks observers that DO honour textChanges (the layer3
// substitution tape exposed by `getEffectiveText`) without paying for an
// in-place rules-text reparse.
import type { Color, DecisionResponse } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

const COLOR_NAMES: Record<number, string> = {
  1: "White",
  2: "Blue",
  4: "Black",
  8: "Red",
  16: "Green",
};
const colorToName = (c: Color | null): string =>
  c === null ? "Colorless" : (COLOR_NAMES[c as unknown as number] ?? "White");

export class ChangeTextEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ChangeText";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    let kind: "color" | "type" | null = null;
    let from = "";
    let to = "";

    if (hasParam(sa, "ChangeColorWord")) {
      kind = "color";
      const raw = evaluateParamRaw(sa, "ChangeColorWord").trim();
      const parts = raw.split(/\s+/);
      from = parts[0] ?? "";
      to = parts[1] ?? "";
    } else if (hasParam(sa, "ChangeTypeWord")) {
      kind = "type";
      const raw = evaluateParamRaw(sa, "ChangeTypeWord").trim();
      const parts = raw.split(/\s+/);
      from = parts[0] ?? "";
      to = parts[1] ?? "";
    } else {
      return;
    }

    // Resolve "Choose" tokens via decisions.
    if (kind === "color") {
      if (from === "Choose") {
        const r1 = (yield {
          kind: "decision",
          request: { kind: "chooseColor", sourceId: sa.sourceCardId, allowColorless: false },
        }) as DecisionResponse | undefined;
        from = r1 && r1.kind === "chooseColor" ? colorToName(r1.color) : "White";
      }
      if (to === "Choose") {
        const r2 = (yield {
          kind: "decision",
          request: { kind: "chooseColor", sourceId: sa.sourceCardId, allowColorless: false },
        }) as DecisionResponse | undefined;
        to = r2 && r2.kind === "chooseColor" ? colorToName(r2.color) : "Black";
      }
    } else {
      if (from === "ChooseCreatureType" || from === "Choose") {
        const r1 = (yield {
          kind: "decision",
          request: { kind: "chooseType", sourceId: sa.sourceCardId, typeKind: "Creature" },
        }) as DecisionResponse | undefined;
        from = r1 && r1.kind === "chooseType" ? r1.type : "Goblin";
      }
      if (to === "ChooseCreatureType" || to === "Choose") {
        const r2 = (yield {
          kind: "decision",
          request: { kind: "chooseType", sourceId: sa.sourceCardId, typeKind: "Creature" },
        }) as DecisionResponse | undefined;
        to = r2 && r2.kind === "chooseType" ? r2.type : "Elf";
      }
    }

    if (!from || !to) return;

    let mutated = false;
    for (const t of sa.targets) {
      const card = game.cards.get(t);
      if (!card) continue;
      card.textChanges.push({ kind, from, to });
      mutated = true;
    }
    if (mutated) {
      // Wave 84 — bump the layer epoch so the layer engine re-derives
      // characteristics that consult textChanges (and any downstream cache
      // keyed on the printed-text-shadow signal). The reason string is
      // the canonical signal source the layer engine surfaces in its
      // diagnostic logging.
      game.layerEngine.bumpEpoch("change-text");
    }
  }
}

effectRegistry.register(ChangeTextEffect);

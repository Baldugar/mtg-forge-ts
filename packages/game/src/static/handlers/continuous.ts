// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 47 — Continuous static handler. Forge's `S:Mode$ Continuous`
// broadcasts a passel of layered effects (P/T, type, color, ability, kw)
// against an `Affected$` target set. This handler routes each recognised
// payload param into the appropriate Layer 4/5/6/7 effect with optional
// per-card scoping and live `Condition$` gating.
//
// Affected$ — full Wave 32 cardMatchesFilter grammar:
//   - `Card.Self`        → only the source card.
//   - `Card.EnchantedBy` → the aura's current attachedTo (Bestow flagship).
//   - `Card.YouCtrl`, `Creature.YouCtrl`, `Creature.OppCtrl`, `Creature`,
//     `Permanent.YouCtrl`, `Card`, `<Subtype>.YouCtrl`, etc.
//   - Comma-OR alternatives + dot/plus-AND qualifiers (Wave 32 grammar).
//
// Payloads — each pushes a Layer effect with `appliesToCardIdFn` set to
// the handler's filter predicate (the predicate also includes the live
// Condition$ gate, so a single test on the predicate suppresses the
// effect entirely when the condition doesn't hold):
//   - AddPower / AddToughness   → Layer 7c (modify P/T).
//   - SetPower / SetToughness   → Layer 7b (set P/T).
//   - AddKeyword                → Layer 6 keyword grant. Multi-keyword
//     grants split on " & " (rare, but Forge uses it).
//   - RemoveKeyword             → Wave 60.F — Layer 6 negative keyword
//     removal. Multi-keyword removals split on " & ". Applied AFTER
//     additive grants in `effectiveGrantedKeywords`; subtracted in the
//     `hasKeyword` combat helper so combat / SBA / target filters see
//     the gate uniformly.
//   - AddType                   → Layer 4 add card type.
//   - AddSubType / AddSubtype   → Layer 4 addSubtype.
//   - RemoveType                → Layer 4 remove card type.
//   - RemoveSubType / RemoveSubtype → Layer 4 removeSubtype.
//   - RemoveCardTypes           → Layer 4 removeAllCardTypes.
//   - RemoveCreatureTypes       → Layer 4 removeAllCreatureTypes.
//   - AddColor / SetColor       → Layer 5 add/set colors.
//   - AddTrigger / AddReplacement / AddStaticAbility → Wave 60.B —
//     SVar-defined grants of T/R/S abilities. Each names an SVar on the
//     source card whose body is a `T:` / `R:` / `S:` line; the
//     GrantedAbilitySweep machinery parses the SVar text, builds a granted
//     ability per matched card, and reconciles add/remove deltas on every
//     epoch bump. See granted-ability.ts.
//   - AddAbility                → Wave 60.F — SVar-defined grant of an
//     activated ability. Same GrantedAbilitySweep machinery (4th
//     `activated` kind) — parses the SVar's `AB$ ...` body via the
//     standard ability-line parser and pushes the resulting SpellAbility
//     onto the matched card's `spellAbilities`.
//   - CharacteristicDefining    → marker only; Layer 4/5 apply CDA-first
//     ordering. We forward the flag to per-payload `isCda` where the
//     layer differentiates (Layer 4 / Layer 5).
//   - MayLookAt                 → Wave 60.F — face-down peek-rights gate.
//     Stamps a MayLookAtGate on the layer engine that visibility consumers
//     consult via `mayLookAtFaceDown(game, cardId, seat)`. Player-filter
//     parsing handles `You` / `Each` / `Opponent` (Telepathy / Sen
//     Triplets / similar).
//
// Condition$ — eight live evaluators (see ./conditions.ts): Threshold,
// Hellbent, Metalcraft, Delirium, FatefulHour, Landfall, Revolt,
// Spellmastery. The condition gate is checked inside the per-card
// predicate so re-evaluation happens on every layer-engine epoch bump.
//
// Static-id stamping — describe() returns the SAME LayerPayload reference
// on successive calls (referential-equality contract for register /
// unregister). The payload graph is built once at build() time; the
// per-card predicate is a closure that re-reads game state live.
import type { CardType, EntityId, ParamValue, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import { CardType as CardTypeEnum, Color, ColorSet } from "@mtg-forge-ts/core";
import type { Layer6KeywordGrant, Layer6KeywordRemoval } from "../../layers/keyword-layer.js";
import type { LayerPayload } from "../../layers/layer-dispatch.js";
import type { TypeChangeEffect } from "../../layers/layer4-type.js";
import type { ColorChangeEffect } from "../../layers/layer5-color.js";
import type { Layer7bEffect, Layer7cEffect } from "../../layers/layer7-pt.js";
import { type MayLookAtGate, parseMayLookAtSeatFilter } from "../../statics/wave60-may-look-at-gate.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { cardIdMatchesAffectedFilter, parseAffectedZones } from "./affected-filter.js";
import { evalCondition } from "./conditions.js";
import { GrantedAbilitySweep } from "./granted-ability.js";

const literalRaw = (p: ParamValue | undefined): string | undefined =>
  p && p.kind === "literal" ? p.raw : undefined;

const numericParam = (p: ParamValue | undefined): number => {
  const raw = literalRaw(p);
  if (raw === undefined) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
};

const splitKeywords = (raw: string): string[] => {
  const parts = raw.split(/\s+&\s+/);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
};

// Map a Forge color name (or single-letter code) to ColorSet. Returns
// null when the name is unrecognised (e.g. a non-color SVar reference);
// callers detect ChosenColor / ChosenColors separately and route those
// through a `colorsFn` that resolves at apply-time (Wave 99).
const COLOR_BY_NAME: Readonly<Record<string, Color>> = {
  White: Color.White,
  Blue: Color.Blue,
  Black: Color.Black,
  Red: Color.Red,
  Green: Color.Green,
  W: Color.White,
  U: Color.Blue,
  B: Color.Black,
  R: Color.Red,
  G: Color.Green,
};

const parseColorList = (raw: string): ColorSet | null => {
  const tokens = raw.split(/[,\s&+]+/).filter((t) => t.length > 0);
  const bits: Color[] = [];
  for (const t of tokens) {
    const bit = COLOR_BY_NAME[t];
    if (bit === undefined) return null;
    bits.push(bit);
  }
  return ColorSet.of(...bits);
};

// Map a Forge core-type name to the CardType enum; returns null for
// names that are subtypes (Goblin, Wizard) — those flow into the
// addSubtype / removeSubtype path instead.
const CORE_TYPE_BY_NAME: Readonly<Record<string, CardType>> = {
  Artifact: CardTypeEnum.Artifact,
  Battle: CardTypeEnum.Battle,
  Creature: CardTypeEnum.Creature,
  Enchantment: CardTypeEnum.Enchantment,
  Instant: CardTypeEnum.Instant,
  Kindred: CardTypeEnum.Kindred,
  Land: CardTypeEnum.Land,
  Planeswalker: CardTypeEnum.Planeswalker,
  Sorcery: CardTypeEnum.Sorcery,
};

const isTrue = (raw: string | undefined): boolean => raw === "True" || raw === "true";

export class ContinuousStaticHandler extends StaticHandler {
  static override readonly mode = "Continuous" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params = ast.params;
    const affected = literalRaw(params.Affected) ?? "Card.Self";

    const addPower = numericParam(params.AddPower);
    const addToughness = numericParam(params.AddToughness);
    const setPowerRaw = literalRaw(params.SetPower);
    const setToughnessRaw = literalRaw(params.SetToughness);
    const addKeywordRaw = literalRaw(params.AddKeyword);
    const conditionRaw = literalRaw(params.Condition);

    const addTypeRaw = literalRaw(params.AddType);
    const removeTypeRaw = literalRaw(params.RemoveType);
    const addSubtypeRaw = literalRaw(params.AddSubType) ?? literalRaw(params.AddSubtype);
    const removeSubtypeRaw = literalRaw(params.RemoveSubType) ?? literalRaw(params.RemoveSubtype);
    const removeCardTypesRaw = literalRaw(params.RemoveCardTypes);
    const removeCreatureTypesRaw = literalRaw(params.RemoveCreatureTypes);

    const addColorRaw = literalRaw(params.AddColor);
    const setColorRaw = literalRaw(params.SetColor);

    const isCda = isTrue(literalRaw(params.CharacteristicDefining));

    // Wave 100 — `AffectedZone$ <list>` (or `All`). When omitted, the
    // affected-filter helper preserves the canonical battlefield-only
    // default. `All` (Painter's Servant / Conspiracy shape) widens the
    // scope to every zone game.cards tracks; an explicit zone list
    // narrows to those zones (e.g. `Hand,Battlefield`).
    const affectedZones = parseAffectedZones(literalRaw(params.AffectedZone)) ?? undefined;

    const game = ctx.game;
    const sourceId: EntityId = ctx.sourceCardId;
    const controllerSeat = ctx.controllerSeat;
    const timestamp = game.newEntityId();

    // Per-card predicate: live filter + live condition gate. Returns true
    // iff `cardId` matches the Affected$ filter AND Condition$ holds in
    // the current game state. Used by every Layer 4/5/6/7 effect we
    // build below; the layer-engine re-evaluates the predicate on every
    // epoch bump (matching the Wave 32 contract for live conditions).
    const appliesToCardIdFn = (cardId: EntityId): boolean => {
      if (!evalCondition(conditionRaw, game, controllerSeat)) return false;
      return cardIdMatchesAffectedFilter(game, sourceId, controllerSeat, cardId, affected, affectedZones);
    };

    // Backwards-compat for the Wave 32 / Wave 33 single-target shape.
    // Threshold-static.test.ts asserts on `targetCardIdFn?.()` returning
    // null when the condition is inactive and the source id when active.
    // We preserve that shape for the two narrow filters that always
    // resolve to a single card; multi-target filters use the predicate
    // path and leave targetCardIdFn unset (the layer apply prefers the
    // predicate when both are present).
    const isSingleTargetFilter = affected === "Card.Self" || affected === "Card.EnchantedBy";
    const singleTargetCardIdFn = (): EntityId | null => {
      if (!evalCondition(conditionRaw, game, controllerSeat)) return null;
      if (affected === "Card.Self") return sourceId;
      // Card.EnchantedBy
      const aura = game.cards.get(sourceId);
      if (!aura) return null;
      return aura.attachedTo;
    };

    const payloads: LayerPayload[] = [];

    // ---- Layer 7c (modify P/T) ---------------------------------------------
    if (addPower !== 0 || addToughness !== 0) {
      const e: Layer7cEffect = isSingleTargetFilter
        ? {
            kind: "modify",
            powerDelta: addPower,
            toughnessDelta: addToughness,
            timestamp,
            sourceAbilityId: ctx.staticId,
            targetCardIdFn: singleTargetCardIdFn,
          }
        : {
            kind: "modify",
            powerDelta: addPower,
            toughnessDelta: addToughness,
            timestamp,
            sourceAbilityId: ctx.staticId,
            appliesToCardIdFn,
          };
      payloads.push({ kind: "pt-modify", effect: e });
    }

    // ---- Layer 7b (set P/T) -------------------------------------------------
    if (setPowerRaw !== undefined || setToughnessRaw !== undefined) {
      // CR 613.4 — SetPower without SetToughness still produces a 7b
      // effect; we leave the un-set side untouched by re-using the
      // current characteristics. MVP shape: literal numbers only.
      // Symbolic values (NEUTRAL$DefenseValue etc.) are
      // Out-of-scope (Wave 118 closure note): symbolic SetPower /
      // SetToughness values (NEUTRAL$DefenseValue, etc.) require an
      // SVar resolver hooked into the layer applier — that's an SP3
      // Part D architectural item on the layer-engine refactor (the
      // resolver needs access to live characteristics at apply-time,
      // which currently runs before SVar evaluation). We default to 0
      // when the literal is not a number so the handler does not throw
      // on dynamic values; literal-numeric P/T (the corpus norm) works.
      const sp = setPowerRaw === undefined ? 0 : Number.parseInt(setPowerRaw, 10);
      const st = setToughnessRaw === undefined ? 0 : Number.parseInt(setToughnessRaw, 10);
      const e: Layer7bEffect = isSingleTargetFilter
        ? {
            kind: "set",
            power: Number.isFinite(sp) ? sp : 0,
            toughness: Number.isFinite(st) ? st : 0,
            timestamp,
            sourceAbilityId: ctx.staticId,
            targetCardIdFn: singleTargetCardIdFn,
          }
        : {
            kind: "set",
            power: Number.isFinite(sp) ? sp : 0,
            toughness: Number.isFinite(st) ? st : 0,
            timestamp,
            sourceAbilityId: ctx.staticId,
            appliesToCardIdFn,
          };
      payloads.push({ kind: "pt-set", effect: e });
    }

    // ---- Layer 6 keyword grants --------------------------------------------
    if (addKeywordRaw !== undefined) {
      for (const kw of splitKeywords(addKeywordRaw)) {
        const grant: Layer6KeywordGrant = isSingleTargetFilter
          ? {
              keyword: kw,
              sourceAbilityId: ctx.staticId,
              timestamp,
              targetCardIdFn: singleTargetCardIdFn,
            }
          : {
              keyword: kw,
              sourceAbilityId: ctx.staticId,
              timestamp,
              // Single-target shape requires a function; provide a
              // stub for the contract and rely on appliesToCardIdFn for
              // multi-target predicate routing.
              targetCardIdFn: () => null,
              appliesToCardIdFn,
            };
        payloads.push({ kind: "kw-grant", effect: grant });
      }
    }

    // ---- Layer 4 type / subtype additions and removals ---------------------
    if (addTypeRaw !== undefined) {
      const coreType = CORE_TYPE_BY_NAME[addTypeRaw];
      if (coreType !== undefined) {
        const e: TypeChangeEffect = {
          kind: "add",
          cardType: coreType,
          isCda,
          timestamp,
          sourceAbilityId: ctx.staticId,
          appliesToCardIdFn,
        };
        payloads.push({ kind: "type", effect: e });
      } else {
        // Treat unknown name as a subtype (Conspiracy: AddType$ ChosenType
        // — ChosenType resolves to a creature subtype like "Goblin").
        // Wave 47 MVP — when the raw string IS a literal subtype, we
        // route through addSubtype. Dynamic SVar refs (ChosenType,
        // ChosenColor) would currently be added as a literal subtype
        // string; full SVar resolution lives in a follow-up wave.
        const e: TypeChangeEffect = {
          kind: "addSubtype",
          subtype: addTypeRaw,
          isCda,
          timestamp,
          sourceAbilityId: ctx.staticId,
          appliesToCardIdFn,
        };
        payloads.push({ kind: "type", effect: e });
      }
    }
    if (removeTypeRaw !== undefined) {
      const coreType = CORE_TYPE_BY_NAME[removeTypeRaw];
      if (coreType !== undefined) {
        const e: TypeChangeEffect = {
          kind: "remove",
          cardType: coreType,
          isCda,
          timestamp,
          sourceAbilityId: ctx.staticId,
          appliesToCardIdFn,
        };
        payloads.push({ kind: "type", effect: e });
      } else {
        const e: TypeChangeEffect = {
          kind: "removeSubtype",
          subtype: removeTypeRaw,
          isCda,
          timestamp,
          sourceAbilityId: ctx.staticId,
          appliesToCardIdFn,
        };
        payloads.push({ kind: "type", effect: e });
      }
    }
    if (addSubtypeRaw !== undefined) {
      const e: TypeChangeEffect = {
        kind: "addSubtype",
        subtype: addSubtypeRaw,
        isCda,
        timestamp,
        sourceAbilityId: ctx.staticId,
        appliesToCardIdFn,
      };
      payloads.push({ kind: "type", effect: e });
    }
    if (removeSubtypeRaw !== undefined) {
      const e: TypeChangeEffect = {
        kind: "removeSubtype",
        subtype: removeSubtypeRaw,
        isCda,
        timestamp,
        sourceAbilityId: ctx.staticId,
        appliesToCardIdFn,
      };
      payloads.push({ kind: "type", effect: e });
    }
    if (isTrue(removeCardTypesRaw)) {
      const e: TypeChangeEffect = {
        kind: "removeAllCardTypes",
        isCda,
        timestamp,
        sourceAbilityId: ctx.staticId,
        appliesToCardIdFn,
      };
      payloads.push({ kind: "type", effect: e });
    }
    if (isTrue(removeCreatureTypesRaw)) {
      const e: TypeChangeEffect = {
        kind: "removeAllCreatureTypes",
        isCda,
        timestamp,
        sourceAbilityId: ctx.staticId,
        appliesToCardIdFn,
      };
      payloads.push({ kind: "type", effect: e });
    }

    // ---- Layer 5 color additions and replacements --------------------------
    // Wave 99 — Symbolic color names (ChosenColor / ChosenColors) resolve
    // at apply-time via `colorsFn`. The closure reads the source card's
    // `chosenColors` slot, which the ChooseColorEffect stamps when the
    // controller answers a chooseColor decision. Forge stores ChosenColor
    // singular (first chosen color) and ChosenColors plural (the full
    // list) — we treat both as a union for the ADD shape, since Painter's
    // Servant-style cards typically have a single choice anyway.
    const buildChosenColorsFn = (): (() => ColorSet | null) => {
      return () => {
        const src = game.cards.get(sourceId);
        if (!src) return null;
        const picks = src.chosenColors;
        if (picks.length === 0) return null;
        const bits: Color[] = [];
        for (const c of picks) if (c !== null) bits.push(c);
        if (bits.length === 0) return null;
        return ColorSet.of(...bits);
      };
    };
    const isChosenColorToken = (raw: string): boolean => raw === "ChosenColor" || raw === "ChosenColors";

    if (addColorRaw !== undefined) {
      if (isChosenColorToken(addColorRaw)) {
        // Dynamic resolution path. Static fallback colors = empty (until
        // chooser fires). The Layer 5 applier prefers `colorsFn` when set
        // and falls back to the static field when it returns null.
        const e: ColorChangeEffect = {
          kind: "add",
          colors: ColorSet.empty(),
          isCda,
          timestamp,
          sourceAbilityId: ctx.staticId,
          appliesToCardIdFn,
          colorsFn: buildChosenColorsFn(),
        };
        payloads.push({ kind: "color", effect: e });
      } else {
        const colors = parseColorList(addColorRaw);
        // Unknown / SVar colors fall through to a no-op rather than throw —
        // the param is recognised, the dynamic value is just unresolved here.
        if (colors !== null) {
          const e: ColorChangeEffect = {
            kind: "add",
            colors,
            isCda,
            timestamp,
            sourceAbilityId: ctx.staticId,
            appliesToCardIdFn,
          };
          payloads.push({ kind: "color", effect: e });
        }
      }
    }
    if (setColorRaw !== undefined) {
      if (isChosenColorToken(setColorRaw)) {
        const e: ColorChangeEffect = {
          kind: "set",
          colors: ColorSet.empty(),
          isCda,
          timestamp,
          sourceAbilityId: ctx.staticId,
          appliesToCardIdFn,
          colorsFn: buildChosenColorsFn(),
        };
        payloads.push({ kind: "color", effect: e });
      } else {
        const colors = parseColorList(setColorRaw);
        if (colors !== null) {
          const e: ColorChangeEffect = {
            kind: "set",
            colors,
            isCda,
            timestamp,
            sourceAbilityId: ctx.staticId,
            appliesToCardIdFn,
          };
          payloads.push({ kind: "color", effect: e });
        }
      }
    }

    // ---- Wave 60.B — Continuous static grants of T/R/S abilities ----------
    // AddTrigger$ / AddReplacement$ / AddStaticAbility$ each name an SVar
    // on the source card whose body is a `T:` / `R:` / `S:` line (Forge
    // stores them sans the line prefix). At static activation we build a
    // GrantedAbilitySweep per payload that:
    //   - parses the SVar text once (lazily on first sweep);
    //   - on every layer-engine epoch bump, reconciles which matched
    //     cards currently hold a granted ability — adds for newly-
    //     matched, removes for newly-unmatched;
    //   - on static deactivation, tears down all current grants
    //     symmetrically.
    // The sweep is encapsulated in a new layer payload kind
    // ("granted-ability") so push/remove flows through layer-dispatch
    // alongside the rest of the Continuous static contributions; this
    // keeps the register/unregister contract uniform with the existing
    // Layer 4/5/6/7 paths.
    const addTriggerRaw = literalRaw(params.AddTrigger);
    const addReplacementRaw = literalRaw(params.AddReplacement);
    const addStaticAbilityRaw = literalRaw(params.AddStaticAbility);

    if (addTriggerRaw !== undefined) {
      const sweep = new GrantedAbilitySweep({
        staticId: ctx.staticId,
        staticSourceCardId: sourceId,
        controllerSeat,
        kind: "trigger",
        svarName: addTriggerRaw,
        appliesToCardIdFn,
      });
      payloads.push({ kind: "granted-ability", sweep });
    }
    if (addReplacementRaw !== undefined) {
      const sweep = new GrantedAbilitySweep({
        staticId: ctx.staticId,
        staticSourceCardId: sourceId,
        controllerSeat,
        kind: "replacement",
        svarName: addReplacementRaw,
        appliesToCardIdFn,
      });
      payloads.push({ kind: "granted-ability", sweep });
    }
    if (addStaticAbilityRaw !== undefined) {
      const sweep = new GrantedAbilitySweep({
        staticId: ctx.staticId,
        staticSourceCardId: sourceId,
        controllerSeat,
        kind: "static",
        svarName: addStaticAbilityRaw,
        appliesToCardIdFn,
      });
      payloads.push({ kind: "granted-ability", sweep });
    }

    // ---- Wave 60.F — RemoveKeyword$, AddAbility$, MayLookAt$ ---------------
    // RemoveKeyword$ — Layer 6 negative keyword removal applied AFTER
    // additive grants. Same predicate / target plumbing as kw-grant; multi-
    // keyword removals split on " & " (mirrors AddKeyword$).
    const removeKeywordRaw = literalRaw(params.RemoveKeyword);
    if (removeKeywordRaw !== undefined) {
      for (const kw of splitKeywords(removeKeywordRaw)) {
        const removal: Layer6KeywordRemoval = isSingleTargetFilter
          ? {
              keyword: kw,
              sourceAbilityId: ctx.staticId,
              timestamp,
              targetCardIdFn: singleTargetCardIdFn,
            }
          : {
              keyword: kw,
              sourceAbilityId: ctx.staticId,
              timestamp,
              targetCardIdFn: () => null,
              appliesToCardIdFn,
            };
        payloads.push({ kind: "kw-remove", effect: removal });
      }
    }

    // AddAbility$ — granted activated SA via SVar dispatch. Extends the
    // Wave 60.B GrantedAbilitySweep machinery with a 4th `activated` kind
    // (see granted-ability.ts). The sweep parses the SVar's `AB$ ...` body
    // via the standard parseAbilityLine pipeline, then per-matched-card
    // builds an SA bound to the matched card and pushes it onto
    // `card.spellAbilities`. Symmetric unregister splices the SA out by
    // reference on static deactivation.
    const addAbilityRaw = literalRaw(params.AddAbility);
    if (addAbilityRaw !== undefined) {
      const sweep = new GrantedAbilitySweep({
        staticId: ctx.staticId,
        staticSourceCardId: sourceId,
        controllerSeat,
        kind: "activated",
        svarName: addAbilityRaw,
        appliesToCardIdFn,
      });
      payloads.push({ kind: "granted-ability", sweep });
    }

    // MayLookAt$ — face-down peek-rights gate. Stamps a MayLookAtGate on
    // the layer engine; visibility consumers consult `mayLookAtFaceDown`
    // (see statics/wave60-may-look-at-gate.ts) when probing whether a
    // given seat may peek at a face-down card. The gate's predicate is
    // `appliesToCardIdFn` (the static's Affected$ filter); the seat
    // predicate is parsed from the MayLookAt$ raw value (`You` / `Each` /
    // `Opponent` / fallback admit-all).
    const mayLookAtRaw = literalRaw(params.MayLookAt);
    if (mayLookAtRaw !== undefined) {
      const seatHasPeekRights = parseMayLookAtSeatFilter(mayLookAtRaw, controllerSeat);
      const gate: MayLookAtGate = {
        sourceAbilityId: ctx.staticId,
        appliesToCardIdFn,
        seatHasPeekRights,
      };
      payloads.push({ kind: "may-look-at", gate });
    }

    // Defensive: a Continuous static with NO concrete payload would be
    // a no-op. Emit a noop payload so the registry has SOMETHING to
    // register/unregister symmetrically (mirrors Wave 32 behavior).
    const payload: LayerPayload =
      payloads.length === 0
        ? { kind: "noop" }
        : payloads.length === 1
          ? (payloads[0] as LayerPayload)
          : { kind: "multi", entries: payloads };

    const activeInZones = normalizeActiveInZones(ast.activeInZones);

    return {
      id: ctx.staticId,
      kind: "static",
      sourceCardId: sourceId,
      activeInZones,
      timestamp,
      controllerSeatAtReg: ctx.controllerSeat,
      category: "continuous",
      mode: "Continuous",
      // describe() must return the same reference every call (referential-
      // equality contract for register/unregister symmetry).
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(ContinuousStaticHandler);

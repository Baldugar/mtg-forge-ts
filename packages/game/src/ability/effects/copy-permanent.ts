// SPDX-License-Identifier: GPL-3.0-or-later
// CopyPermanentEffect — creates token copy/copies of a target permanent.
//
// Forge DSL:
//   SP$ CopyPermanent | ValidTgts$ Creature | NumCopies$ 1
//   SP$ CopyPermanent | ValidTgts$ Permanent | NumCopies$ 2
//
// Each copy is created via game.action.createToken with isCopy=true so the
// new Card has its `copiedFrom` snapshot populated (CR 706). The token
// inherits the original's PaperCard (including name, type line, P/T, etc.)
// but is a token on the battlefield under the controller's control.
//
// Wave 53 broadens the MVP:
//   - AddTypes$ <Type[,…]>  — add card-type(s) to the copy via Layer 4 effect.
//   - SetPower$/SetToughness$ <N> — Layer 7b set on the token.
//   - AddTriggers$ <SVar list> — register additional trigger SVars on the
//                                copy. SVars are looked up off sa.svars.
//   - Embalm$/Eternalize$ flags — already handled via tokenOverrides in the
//                                 Embalm/Eternalize handlers; pass-through
//                                 here is a no-op (preserves Wave 33).
//
// Wave 63.B — broadened sub-params:
//   - AddColors$ <Color[,…]>      — Layer 5 "add" continuous effect against
//                                    the new copy's id (W/U/B/R/G letters or
//                                    full color words).
//   - AddSubtypes$ <Subtype[,…]>  — Layer 4 "addSubtype" effect per subtype.
//   - AddKeywords$ <Kw[,…]>       — Layer 6 "kw-grant" effect per keyword.
//   - Power$ / Toughness$ <N>     — aliases for SetPower$ / SetToughness$
//                                    matching the Forge-DSL surface.
import { CardType, Color, ColorSet, Layer } from "@mtg-forge-ts/core";
import type { ContinuousEffect, EntityId, TriggerAst } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import type { Layer6KeywordGrant } from "../../layers/keyword-layer.js";
import type { TypeChangeEffect } from "../../layers/layer4-type.js";
import type { ColorChangeEffect } from "../../layers/layer5-color.js";
import type { Layer7bEffect } from "../../layers/layer7-pt.js";
import { triggerHandlerRegistry } from "../../trigger/index.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

const CARD_TYPE_BY_NAME: Readonly<Record<string, CardType>> = {
  Creature: CardType.Creature,
  Artifact: CardType.Artifact,
  Enchantment: CardType.Enchantment,
  Land: CardType.Land,
  Sorcery: CardType.Sorcery,
  Instant: CardType.Instant,
  Planeswalker: CardType.Planeswalker,
  Battle: CardType.Battle,
};

// Wave 63.B — Forge color tokens accept either the canonical letters
// (W/U/B/R/G) or the long-form words (White/Blue/Black/Red/Green). We
// normalise both.
const COLOR_BY_NAME: Readonly<Record<string, Color>> = {
  W: Color.White,
  White: Color.White,
  U: Color.Blue,
  Blue: Color.Blue,
  B: Color.Black,
  Black: Color.Black,
  R: Color.Red,
  Red: Color.Red,
  G: Color.Green,
  Green: Color.Green,
};

const splitNames = (raw: string): readonly string[] =>
  raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

const parseColorList = (raw: string): ColorSet => {
  const colors: Color[] = [];
  for (const name of splitNames(raw)) {
    const c = COLOR_BY_NAME[name];
    if (c !== undefined) colors.push(c);
  }
  return colors.length === 0 ? ColorSet.empty() : ColorSet.of(...colors);
};

export class CopyPermanentEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "CopyPermanent";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const num = hasParam(sa, "NumCopies") ? evaluateParamNumber(sa, "NumCopies", game) : 1;

    const addTypeNames = hasParam(sa, "AddTypes") ? splitNames(evaluateParamRaw(sa, "AddTypes")) : [];
    const addSubtypeNames = hasParam(sa, "AddSubtypes")
      ? splitNames(evaluateParamRaw(sa, "AddSubtypes"))
      : [];
    const addKeywordNames = hasParam(sa, "AddKeywords")
      ? splitNames(evaluateParamRaw(sa, "AddKeywords"))
      : [];
    // Wave 63.B — AddColors$ becomes a Layer 5 "add" continuous effect on
    // the new copy's id, so color-aware filters / triggers / replacements
    // observe the augmented color set.
    const addColors = hasParam(sa, "AddColors")
      ? parseColorList(evaluateParamRaw(sa, "AddColors"))
      : ColorSet.empty();
    // Wave 63.B — Power$ / Toughness$ aliases for SetPower$ / SetToughness$.
    const setPower = hasParam(sa, "SetPower")
      ? evaluateParamNumber(sa, "SetPower", game)
      : hasParam(sa, "Power")
        ? evaluateParamNumber(sa, "Power", game)
        : null;
    const setToughness = hasParam(sa, "SetToughness")
      ? evaluateParamNumber(sa, "SetToughness", game)
      : hasParam(sa, "Toughness")
        ? evaluateParamNumber(sa, "Toughness", game)
        : null;
    const addTriggerNames = hasParam(sa, "AddTriggers")
      ? splitNames(evaluateParamRaw(sa, "AddTriggers"))
      : [];

    for (const targetId of sa.targets) {
      const target = game.cards.get(targetId);
      if (!target) continue;
      const ids = yield* game.action.createToken({
        paperCard: target.paperCard,
        controller: sa.controllerSeat,
        count: num,
        isCopy: true,
        copyOf: targetId,
      });

      for (const newId of ids) {
        // ---- AddTypes$ → Layer 4 add ---------------------------------
        for (const tname of addTypeNames) {
          const ct = CARD_TYPE_BY_NAME[tname];
          if (!ct) continue;
          const ts = game.newEntityId();
          const eff: TypeChangeEffect = {
            kind: "add",
            cardType: ct,
            isCda: false,
            timestamp: ts,
            sourceAbilityId: sa.sourceCardId,
            appliesToCardIdFn: (id: EntityId) => id === newId,
          };
          const ce: ContinuousEffect = {
            id: game.newEntityId(),
            sourceCardId: sa.sourceCardId,
            timestamp: ts,
            layer: Layer.L4_Type,
            duration: { kind: "permanent" },
            payload: { kind: "type", effect: eff },
          };
          game.continuousEffectRegistry.register(ce);
        }

        // ---- AddSubtypes$ → Layer 4 addSubtype (Wave 63.B) -----------
        for (const sub of addSubtypeNames) {
          const ts = game.newEntityId();
          const eff: TypeChangeEffect = {
            kind: "addSubtype",
            subtype: sub,
            isCda: false,
            timestamp: ts,
            sourceAbilityId: sa.sourceCardId,
            appliesToCardIdFn: (id: EntityId) => id === newId,
          };
          const ce: ContinuousEffect = {
            id: game.newEntityId(),
            sourceCardId: sa.sourceCardId,
            timestamp: ts,
            layer: Layer.L4_Type,
            duration: { kind: "permanent" },
            payload: { kind: "type", effect: eff },
          };
          game.continuousEffectRegistry.register(ce);
        }

        // ---- AddColors$ → Layer 5 add (Wave 63.B) --------------------
        if (addColors.toJSON() !== 0) {
          const ts = game.newEntityId();
          const eff: ColorChangeEffect = {
            kind: "add",
            colors: addColors,
            isCda: false,
            timestamp: ts,
            sourceAbilityId: sa.sourceCardId,
            appliesToCardIdFn: (id: EntityId) => id === newId,
          };
          const ce: ContinuousEffect = {
            id: game.newEntityId(),
            sourceCardId: sa.sourceCardId,
            timestamp: ts,
            layer: Layer.L5_Color,
            duration: { kind: "permanent" },
            payload: { kind: "color", effect: eff },
          };
          game.continuousEffectRegistry.register(ce);
        }

        // ---- AddKeywords$ → Layer 6 kw-grant (Wave 63.B) -------------
        for (const kw of addKeywordNames) {
          const ts = game.newEntityId();
          const grant: Layer6KeywordGrant = {
            keyword: kw,
            sourceAbilityId: sa.sourceCardId,
            timestamp: ts,
            // Single-target shape: target the freshly-minted copy.
            targetCardIdFn: () => newId,
          };
          const ce: ContinuousEffect = {
            id: game.newEntityId(),
            sourceCardId: sa.sourceCardId,
            timestamp: ts,
            layer: Layer.L6_Ability,
            duration: { kind: "permanent" },
            payload: { kind: "kw-grant", effect: grant },
          };
          game.continuousEffectRegistry.register(ce);
        }

        // ---- SetPower$ / SetToughness$ → Layer 7b set ---------------
        if (setPower !== null || setToughness !== null) {
          const ts = game.newEntityId();
          const eff: Layer7bEffect = {
            kind: "set",
            power: setPower ?? 0,
            toughness: setToughness ?? 0,
            timestamp: ts,
            sourceAbilityId: sa.sourceCardId,
            targetCardIdFn: () => newId,
          };
          const ce: ContinuousEffect = {
            id: game.newEntityId(),
            sourceCardId: sa.sourceCardId,
            timestamp: ts,
            layer: Layer.L7b_PTSet,
            duration: { kind: "permanent" },
            payload: { kind: "pt-set", effect: eff },
          };
          game.continuousEffectRegistry.register(ce);
        }

        // ---- AddTriggers$ — register the named SVar trigger asts -----
        for (const name of addTriggerNames) {
          const sv = sa.svars.get(name);
          if (!sv || sv.kind !== "trigger") continue;
          const ast = sv.trigger as TriggerAst | undefined;
          if (!ast) continue;
          const Cls = triggerHandlerRegistry.lookup(ast.mode);
          if (!Cls) continue;
          const handler = new Cls();
          const triggerId = game.newEntityId();
          const ta = handler.build(ast, {
            game,
            sourceCardId: newId,
            controllerSeat: sa.controllerSeat,
            triggerId,
          });
          game.triggerRegistry.register(ta);
        }
      }
    }
  }
}

effectRegistry.register(CopyPermanentEffect);

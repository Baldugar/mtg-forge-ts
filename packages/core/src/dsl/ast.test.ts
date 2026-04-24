// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, expectTypeOf, it } from "vitest";
import type { KeywordId } from "../card/keyword-id.js";
import { Color } from "../color.js";
import { ZoneType } from "../zone.js";
import type {
  AbilityAst,
  CostAst,
  DefenseAst,
  EffectInvocation,
  KeywordAst,
  LoyaltyAst,
  ManaCostAst,
  ParamValue,
  PtAst,
  ReplacementAst,
  SVarAst,
  SVarExpressionAst,
  StaticAst,
  TriggerAst,
  TypeLineAst,
} from "./ast.js";

const roundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("DSL AST shapes", () => {
  it("ParamValue — literal/svarRef/expression round-trip", () => {
    const lit: ParamValue = { kind: "literal", raw: "3" };
    const sv: ParamValue = { kind: "svarRef", name: "DBDamage" };
    const expr: ParamValue = {
      kind: "expression",
      ast: { kind: "Count", args: [{ kind: "Self", raw: "Self" }] },
    };
    expect(roundTrip(lit)).toEqual(lit);
    expect(roundTrip(sv)).toEqual(sv);
    expect(roundTrip(expr)).toEqual(expr);
  });

  it("SVarExpressionAst — nested args preserved", () => {
    const ast: SVarExpressionAst = {
      kind: "Count",
      args: [
        { kind: "Creatures.YouCtrl", raw: "Creatures.YouCtrl" },
        { kind: "Plus", args: [{ kind: "Number", raw: "1" }] },
      ],
    };
    expect(roundTrip(ast)).toEqual(ast);
  });

  it("EffectInvocation — subAbility chain", () => {
    const inv: EffectInvocation = {
      handlerKey: "DealDamage",
      params: {
        NumDmg: { kind: "literal", raw: "3" },
        ValidTgts: { kind: "literal", raw: "Creature,Player" },
      },
      subAbility: {
        handlerKey: "Draw",
        params: { NumCards: { kind: "literal", raw: "1" } },
      },
    };
    expect(roundTrip(inv)).toEqual(inv);
  });

  it("AbilityAst — spell with instant timing", () => {
    const ab: AbilityAst = {
      kind: "spell",
      effect: { handlerKey: "DealDamage", params: {} },
      cost: { raw: "R" },
      rulesText: "Lightning Bolt deals 3 damage to any target.",
      timing: "instant",
    };
    expect(roundTrip(ab)).toEqual(ab);
  });

  it("TriggerAst — shape", () => {
    const t: TriggerAst = {
      mode: "ChangesZone",
      params: {
        Origin: { kind: "literal", raw: "Any" },
        Destination: { kind: "literal", raw: "Battlefield" },
      },
      effect: { handlerKey: "Draw", params: {} },
    };
    expect(roundTrip(t)).toEqual(t);
  });

  it("ReplacementAst — isSelf flag", () => {
    const r: ReplacementAst = {
      eventKind: "DealtDamage",
      params: { ValidTarget: { kind: "literal", raw: "You" } },
      effect: { handlerKey: "PreventDamage", params: {} },
      isSelf: true,
    };
    expect(roundTrip(r)).toEqual(r);
  });

  it("StaticAst — activeInZones list", () => {
    const s: StaticAst = {
      mode: "Continuous",
      params: { EffectZone: { kind: "literal", raw: "Battlefield" } },
      activeInZones: [ZoneType.Battlefield, ZoneType.Command],
    };
    expect(roundTrip(s)).toEqual(s);
  });

  it("KeywordAst — with and without params", () => {
    const flying: KeywordAst = { keyword: "flying" };
    const protection: KeywordAst = {
      keyword: "protection",
      params: { From: { kind: "literal", raw: "red" } },
    };
    expect(roundTrip(flying)).toEqual(flying);
    expect(roundTrip(protection)).toEqual(protection);
  });

  it("SVarAst — value and ability kinds", () => {
    const val: SVarAst = {
      kind: "value",
      raw: "Count$CardPower",
      expression: { kind: "Count", args: [{ kind: "CardPower", raw: "CardPower" }] },
    };
    const abil: SVarAst = {
      kind: "ability",
      raw: "DBDamage$...",
      ability: { handlerKey: "DealDamage", params: {} },
    };
    expect(roundTrip(val)).toEqual(val);
    expect(roundTrip(abil)).toEqual(abil);
  });

  it("CostAst — raw placeholder", () => {
    const c: CostAst = { raw: "2 R" };
    expect(roundTrip(c)).toEqual(c);
  });

  it("TypeLineAst — three-bucket shape", () => {
    const t: TypeLineAst = {
      supertypes: ["Legendary"],
      types: ["Creature"],
      subtypes: ["Human", "Wizard"],
    };
    expect(roundTrip(t)).toEqual(t);
  });

  it("PtAst / LoyaltyAst / DefenseAst", () => {
    const pt: PtAst = { power: "2", toughness: "3" };
    const loy: LoyaltyAst = { starting: "4" };
    const def: DefenseAst = { starting: "5" };
    expect(roundTrip(pt)).toEqual(pt);
    expect(roundTrip(loy)).toEqual(loy);
    expect(roundTrip(def)).toEqual(def);
  });

  it("ManaCostAst — parser-time snapshot with typed symbols", () => {
    const m: ManaCostAst = {
      raw: "2R",
      symbols: [
        { kind: "generic", amount: 2 },
        { kind: "colored", color: Color.Red },
      ],
    };
    expect(roundTrip(m)).toEqual(m);
  });
});

describe("KeywordAst", () => {
  it("requires KeywordId, not raw string", () => {
    const ast: KeywordAst = { keyword: "flying" };
    expectTypeOf(ast.keyword).toEqualTypeOf<KeywordId>();
  });
});

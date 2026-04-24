// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { parseAbilityLine } from "./ability-line.js";
import { lex } from "./lexer.js";

const first = <T>(arr: readonly T[]): T => {
  if (arr.length === 0) throw new Error("empty array");
  return arr[0] as T;
};

describe("parseAbilityLine", () => {
  it("parses a simple SP$ DealDamage spell", () => {
    const out = parseAbilityLine(first(lex("A:SP$ DealDamage | Cost$ R | NumDmg$ 3 | ValidTgts$ Any\n")));
    expect(out.kind).toBe("spell");
    expect(out.effect.handlerKey).toBe("DealDamage");
    expect(out.effect.params.NumDmg).toEqual({ kind: "literal", raw: "3" });
    expect(out.effect.params.ValidTgts).toEqual({ kind: "literal", raw: "Any" });
    expect(out.cost.raw).toBe("R");
  });

  it("parses an AB$ activated ability with tap cost", () => {
    const out = parseAbilityLine(first(lex("A:AB$ Mana | Cost$ T | Produced$ G\n")));
    expect(out.kind).toBe("activated");
    expect(out.effect.handlerKey).toBe("Mana");
    expect(out.cost.raw).toBe("T");
  });

  it("parses a DB$ sub-ability (inline)", () => {
    const out = parseAbilityLine(first(lex("A:DB$ Draw | NumCards$ 1\n")));
    expect(out.kind).toBe("spell");
    expect(out.effect.handlerKey).toBe("Draw");
  });

  it("resolves X as svarRef, literal 3 as literal", () => {
    const out = parseAbilityLine(first(lex("A:SP$ DealDamage | Cost$ X R | NumDmg$ X | ValidTgts$ Any\n")));
    expect(out.effect.params.NumDmg).toEqual({ kind: "svarRef", name: "X" });
  });

  it("handles SubAbility$ reference (DBname form)", () => {
    const out = parseAbilityLine(first(lex("A:SP$ DealDamage | Cost$ R | NumDmg$ 2 | SubAbility$ DBDraw\n")));
    expect(out.effect.params.SubAbility).toEqual({ kind: "svarRef", name: "DBDraw" });
  });

  it("captures Count\\$ expression", () => {
    const out = parseAbilityLine(
      first(lex("A:SP$ DealDamage | Cost$ R | NumDmg$ Count\\$yourHand | ValidTgts$ Any\n")),
    );
    const pv = out.effect.params.NumDmg;
    if (pv?.kind !== "expression") throw new Error("expected expression ParamValue");
    expect(pv.ast.raw).toBe("Count$yourHand");
  });

  it("rejects lines without SP$/AB$/DB$", () => {
    expect(() => parseAbilityLine(first(lex("A:ValidTgts$ Any\n")))).toThrow();
  });
});

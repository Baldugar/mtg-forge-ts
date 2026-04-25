// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { parseKeywordLine } from "./keyword-line.js";
import { lex } from "./lexer.js";

const first = <T>(arr: readonly T[]): T => {
  if (arr.length === 0) throw new Error("empty array");
  return arr[0] as T;
};

describe("parseKeywordLine", () => {
  it("parses simple 'K:Flying'", () => {
    const out = parseKeywordLine(first(lex("K:Flying\n")));
    expect(out.keyword).toBe("flying");
    expect(out.params).toBeUndefined();
  });

  it("parses 'K:First Strike' (display name with space)", () => {
    const out = parseKeywordLine(first(lex("K:First Strike\n")));
    expect(out.keyword).toBe("first_strike");
  });

  it("parses 'K:Kicker:2 R' with cost param", () => {
    const out = parseKeywordLine(first(lex("K:Kicker:2 R\n")));
    expect(out.keyword).toBe("kicker");
    expect(out.params?.cost).toEqual({ kind: "literal", raw: "2 R" });
  });

  it("parses 'K:Bushido:2' with amount param", () => {
    const out = parseKeywordLine(first(lex("K:Bushido:2\n")));
    expect(out.keyword).toBe("bushido");
    expect(out.params?.amount).toEqual({ kind: "literal", raw: "2" });
  });

  it("parses 'K:Jump-start' (hyphenated display)", () => {
    const out = parseKeywordLine(first(lex("K:Jump-start\n")));
    expect(out.keyword).toBe("jump_start");
  });

  it("tolerates unknown keywords as freeform (no throw)", () => {
    const out = parseKeywordLine(first(lex("K:Notakeyword\n")));
    expect(out.keyword).toBe("freeform");
    expect(out.params?.text).toEqual({ kind: "literal", raw: "Notakeyword" });
  });

  it("tolerates long freeform rule text as freeform keyword", () => {
    const out = parseKeywordLine(
      first(lex("K:You may choose not to untap CARDNAME during your untap step.\n")),
    );
    expect(out.keyword).toBe("freeform");
    expect((out.params?.text as { kind: string; raw: string } | undefined)?.raw).toMatch(/untap step/);
  });

  it("parses 'K:Protection from black' as canonical protection keyword", () => {
    const out = parseKeywordLine(first(lex("K:Protection from black\n")));
    expect(out.keyword).toBe("protection");
    expect(out.params?.from).toEqual({ kind: "literal", raw: "black" });
  });

  it("parses 'K:Protection from white and from black' as protection keyword", () => {
    const out = parseKeywordLine(first(lex("K:Protection from white and from black\n")));
    expect(out.keyword).toBe("protection");
    expect((out.params?.from as { kind: string; raw: string } | undefined)?.raw).toBe("white and from black");
  });

  // Tolerable parser-extension keywords — etbCounter, ETBReplacement, Chapter.
  // These map to opaque KeywordIds so the parser does not throw on cards that
  // carry them; full semantics are deferred to future waves.

  it("parses 'K:etbCounter:1+1+1' — ETB counter placement shorthand", () => {
    const out = parseKeywordLine(first(lex("K:etbCounter:1+1+1\n")));
    expect(out.keyword).toBe("etb_counter");
    expect(out.params?.detail).toEqual({ kind: "literal", raw: "1+1+1" });
  });

  it("parses 'K:etbCounter' without param", () => {
    const out = parseKeywordLine(first(lex("K:etbCounter\n")));
    expect(out.keyword).toBe("etb_counter");
  });

  it("parses 'K:ETBReplacement' — ETB replacement shorthand", () => {
    const out = parseKeywordLine(first(lex("K:ETBReplacement\n")));
    expect(out.keyword).toBe("etb_replacement");
  });

  it("parses 'K:Chapter:1' — Saga chapter keyword", () => {
    const out = parseKeywordLine(first(lex("K:Chapter:1\n")));
    expect(out.keyword).toBe("chapter");
    expect(out.params?.detail).toEqual({ kind: "literal", raw: "1" });
  });

  it("parses 'K:MayEffectFromOpeningHand:RevealCard' as canonical id", () => {
    const out = parseKeywordLine(first(lex("K:MayEffectFromOpeningHand:RevealCard\n")));
    expect(out.keyword).toBe("may_effect_from_opening_hand");
    expect(out.params?.detail).toEqual({ kind: "literal", raw: "RevealCard" });
  });

  it("parses 'K:MayEffectFromOpeningDeck:DBReveal' as canonical id", () => {
    const out = parseKeywordLine(first(lex("K:MayEffectFromOpeningDeck:DBReveal\n")));
    expect(out.keyword).toBe("may_effect_from_opening_deck");
    expect(out.params?.detail).toEqual({ kind: "literal", raw: "DBReveal" });
  });
});

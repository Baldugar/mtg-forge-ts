// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { type LexedLine, lex } from "./lexer.js";
import { parseTypeLine } from "./type-line.js";

const first = (source: string): LexedLine => {
  const lines = lex(source);
  if (lines[0] === undefined) throw new Error("no lines lexed");
  return lines[0];
};

describe("parseTypeLine", () => {
  it("parses 'Creature Human Wizard'", () => {
    const out = parseTypeLine(first("Types:Creature Human Wizard\n"));
    expect(out).toEqual({ supertypes: [], types: ["Creature"], subtypes: ["Human", "Wizard"] });
  });
  it("splits Legendary supertype", () => {
    const out = parseTypeLine(first("Types:Legendary Creature Human\n"));
    expect(out.supertypes).toEqual(["Legendary"]);
    expect(out.types).toEqual(["Creature"]);
    expect(out.subtypes).toEqual(["Human"]);
  });
  it("handles Instant with no subtypes", () => {
    const out = parseTypeLine(first("Types:Instant\n"));
    expect(out).toEqual({ supertypes: [], types: ["Instant"], subtypes: [] });
  });
  it("handles multi-type 'Artifact Creature'", () => {
    const out = parseTypeLine(first("Types:Artifact Creature Construct\n"));
    expect(out.types).toEqual(["Artifact", "Creature"]);
    expect(out.subtypes).toEqual(["Construct"]);
  });
  it("handles Land subtypes", () => {
    const out = parseTypeLine(first("Types:Basic Land Mountain\n"));
    expect(out.supertypes).toEqual(["Basic"]);
    expect(out.types).toEqual(["Land"]);
    expect(out.subtypes).toEqual(["Mountain"]);
  });
  it("rejects wrong prefix", () => {
    expect(() => parseTypeLine(first("Name:Foo\n"))).toThrow(/expected prefix 'Types'/);
  });
});

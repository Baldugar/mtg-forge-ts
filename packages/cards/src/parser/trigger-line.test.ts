// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { lex } from "./lexer.js";
import { parseTriggerLine } from "./trigger-line.js";

const first = <T>(arr: readonly T[]): T => {
  if (arr.length === 0) throw new Error("empty array");
  return arr[0] as T;
};

describe("parseTriggerLine", () => {
  it("parses ChangesZone trigger pointing at Execute svar", () => {
    const out = parseTriggerLine(
      first(
        lex(
          "T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDraw | TriggerDescription$ When this enters, draw a card.\n",
        ),
      ),
    );
    expect(out.mode).toBe("ChangesZone");
    expect(out.params.Origin).toEqual({ kind: "literal", raw: "Any" });
    expect(out.params.Destination).toEqual({ kind: "literal", raw: "Battlefield" });
    expect(out.params.ValidCard).toEqual({ kind: "literal", raw: "Card.Self" });
    expect(out.effect.handlerKey).toBe("TrigDraw");
  });

  it("rejects triggers without Mode$", () => {
    expect(() => parseTriggerLine(first(lex("T:ValidCard$ Card.Self | Execute$ TrigX\n")))).toThrow(
      /missing Mode/,
    );
  });

  it("accepts triggers without Execute$ as watcher-only triggers (NoOp handlerKey)", () => {
    // Forge allows trigger lines with no Execute$ — used by static effects
    // that rely on ForgetOnCast$/RememberFlags$ only (Stalwart Realmwarden
    // pattern). We synthesize a "NoOp" handlerKey rather than rejecting.
    const out = parseTriggerLine(first(lex("T:Mode$ ChangesZone | ValidCard$ Card.Self\n")));
    expect(out.mode).toBe("ChangesZone");
    expect(out.effect.handlerKey).toBe("NoOp");
  });
});

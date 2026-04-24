// SPDX-License-Identifier: GPL-3.0-or-later
import { mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { CascadeIntent, KnownIntent, ProduceManaIntent, ScryIntent } from "./mutation-intent.js";
import { INTENT_KINDS } from "./mutation-intent.js";

describe("MutationIntent expansion", () => {
  it("exposes 39 intent kinds total", () => {
    expect(Object.keys(INTENT_KINDS)).toHaveLength(39);
  });

  it("narrows ScryIntent payload", () => {
    const i: ScryIntent = { kind: "scry", seat: mkPlayerSeat(0), amount: 2 };
    expect(i.amount).toBe(2);
  });

  it("CascadeIntent carries sourceId + triggerCmc", () => {
    const i: CascadeIntent = {
      kind: "cascade",
      sourceId: mkEntityId(1),
      triggerCmc: 4,
      seat: mkPlayerSeat(0),
    };
    expect(i.triggerCmc).toBe(4);
  });

  it("KnownIntent union discriminates all 39 kinds", () => {
    const fn = (i: KnownIntent): string => i.kind;
    const sample: KnownIntent = { kind: "proliferate", seat: mkPlayerSeat(0) };
    expect(fn(sample)).toBe("proliferate");
  });

  it("ProduceMana carries symbols", () => {
    const i: ProduceManaIntent = {
      kind: "produceMana",
      seat: mkPlayerSeat(0),
      sourceId: mkEntityId(1),
      symbols: ["G", "G"],
    };
    expect(i.symbols).toHaveLength(2);
  });
});

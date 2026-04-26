// SPDX-License-Identifier: GPL-3.0-or-later
// BeginPhaseReplacement (Wave 19) — smoke + match/skip cases.
import type { MutationIntent, ReplacementAst } from "@mtg-forge-ts/core";
import { mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { replacementHandlerRegistry } from "../replacement-handler-registry.js";
import type { ReplacementBuildContext } from "../replacement-handler.js";
// Side-effect — registers BeginPhaseReplacement.
import "./index.js";
import { BeginPhaseReplacement } from "./begin-phase-replacement.js";

const SOURCE_ID = mkEntityId(800);
const REPL_ID = mkEntityId(90);
const ALICE = mkPlayerSeat(0);
const BOB = mkPlayerSeat(1);

const mkCtx = (): ReplacementBuildContext => ({
  game: {} as never,
  sourceCardId: SOURCE_ID,
  controllerSeat: ALICE,
  replacementId: REPL_ID,
});

const mkAst = (validPlayer: string, phase?: string, layer?: string, prevent?: string): ReplacementAst => ({
  eventKind: "BeginPhase",
  params: {
    ValidPlayer: { kind: "literal", raw: validPlayer },
    ...(phase ? { Phase: { kind: "literal", raw: phase } } : {}),
    ...(layer ? { Layer: { kind: "literal", raw: layer } } : {}),
    ...(prevent ? { Prevent: { kind: "literal", raw: prevent } } : {}),
  },
  effect: { handlerKey: "NoEffect", params: {} },
});

describe("BeginPhaseReplacement (Wave 19)", () => {
  it("is registered under eventKind 'BeginPhase'", () => {
    expect(replacementHandlerRegistry.has("BeginPhase")).toBe(true);
  });

  it("matches a beginPhase intent for ValidPlayer$ You + Phase$ Draw", () => {
    const ra = new BeginPhaseReplacement().build(mkAst("You", "Draw"), mkCtx());
    const intent = { kind: "beginPhase", seat: ALICE, phase: "Draw" } as unknown as MutationIntent;
    expect(ra.matches(intent)).toBe(true);
  });

  it("does not match a beginPhase intent for the wrong phase", () => {
    const ra = new BeginPhaseReplacement().build(mkAst("You", "Draw"), mkCtx());
    const intent = { kind: "beginPhase", seat: ALICE, phase: "Upkeep" } as unknown as MutationIntent;
    expect(ra.matches(intent)).toBe(false);
  });

  it("ValidPlayer$ Opponent rejects the controller's intent", () => {
    const ra = new BeginPhaseReplacement().build(mkAst("Opponent"), mkCtx());
    const intent = { kind: "beginPhase", seat: ALICE, phase: "Draw" } as unknown as MutationIntent;
    expect(ra.matches(intent)).toBe(false);
  });

  it("ValidPlayer$ Opponent matches the opponent's intent", () => {
    const ra = new BeginPhaseReplacement().build(mkAst("Opponent"), mkCtx());
    const intent = { kind: "beginPhase", seat: BOB, phase: "Draw" } as unknown as MutationIntent;
    expect(ra.matches(intent)).toBe(true);
  });

  it("Layer$ CantHappen prevents the phase (apply returns null)", () => {
    const ra = new BeginPhaseReplacement().build(mkAst("You", "Draw", "CantHappen"), mkCtx());
    const intent = { kind: "beginPhase", seat: ALICE, phase: "Draw" } as unknown as MutationIntent;
    expect(ra.apply(intent, {} as never)).toBeNull();
  });

  it("Prevent$ True also returns null", () => {
    const ra = new BeginPhaseReplacement().build(mkAst("Each", "Upkeep", undefined, "True"), mkCtx());
    const intent = { kind: "beginPhase", seat: BOB, phase: "Upkeep" } as unknown as MutationIntent;
    expect(ra.apply(intent, {} as never)).toBeNull();
  });

  it("declines non-beginPhase intents", () => {
    const ra = new BeginPhaseReplacement().build(mkAst("You"), mkCtx());
    const intent = { kind: "drawCards", seat: ALICE } as unknown as MutationIntent;
    expect(ra.matches(intent)).toBe(false);
  });
});

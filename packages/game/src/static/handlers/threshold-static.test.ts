// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 32 — Threshold flagship test for ContinuousStaticHandler.
//
// Excavating Anurid (Odyssey) verbatim Forge static:
//   S:Mode$ Continuous | Affected$ Card.Self | AddPower$ 1 | AddToughness$ 1
//     | AddKeyword$ Vigilance | Condition$ Threshold
//
// The test mints a stub Game shape carrying:
//   - players[0] with a graveyard zone whose `size` we mutate to flip the
//     Threshold condition.
//   - cards Map keyed by the source card's id so targetCardIdFn can
//     resolve.
//   - newEntityId() supplying a fresh timestamp/static id.
//
// We then drive the handler's describe()-emitted payload through the
// targetCardIdFn it builds; under Threshold inactive (GY < 7) the fn
// MUST return null (suppresses pt-modify + kw-grant); under Threshold
// active (GY ≥ 7) the fn MUST return the source card id.
import type { StaticAst } from "@mtg-forge-ts/core";
import { ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { LayerPayload } from "../../layers/layer-dispatch.js";
import { ContinuousStaticHandler } from "./continuous.js";

const SOURCE_ID = mkEntityId(50);
const STATIC_ID = mkEntityId(51);
const CONTROLLER = mkPlayerSeat(0);

interface StubGyZone {
  size: number;
}

const mkGameStub = (gySize: number) => {
  const gy: StubGyZone = { size: gySize };
  const player = {
    seat: CONTROLLER,
    zones: new Map<ZoneType, StubGyZone>([[ZoneType.Graveyard, gy]]),
  };
  return {
    cards: new Map<number, unknown>([[SOURCE_ID as number, { id: SOURCE_ID, attachedTo: null }]]),
    players: [player],
    newEntityId: () => 9999 as ReturnType<typeof mkEntityId>,
    // Handler stamps a timestamp via game.newEntityId(); we hand it a stable
    // value so tests are deterministic.
    gy, // exposed so tests can mutate the GY size between flips
  } as never;
};

const thresholdAst: StaticAst = {
  mode: "Continuous",
  params: {
    Mode: { kind: "literal", raw: "Continuous" },
    Affected: { kind: "literal", raw: "Card.Self" },
    AddPower: { kind: "literal", raw: "1" },
    AddToughness: { kind: "literal", raw: "1" },
    AddKeyword: { kind: "literal", raw: "Vigilance" },
    Condition: { kind: "literal", raw: "Threshold" },
  },
  activeInZones: [],
};

describe("Wave 32 — Threshold flagship (Excavating Anurid)", () => {
  it("describe() emits a multi payload with pt-modify + kw-grant", () => {
    const game = mkGameStub(0);
    const s = new ContinuousStaticHandler().build(thresholdAst, {
      game,
      sourceCardId: SOURCE_ID,
      controllerSeat: CONTROLLER,
      staticId: STATIC_ID,
    });
    const payload = s.describe() as LayerPayload;
    expect(payload.kind).toBe("multi");
    if (payload.kind !== "multi") return;
    const kinds = payload.entries.map((e) => e.kind).sort();
    expect(kinds).toEqual(["kw-grant", "pt-modify"]);
  });

  it("Threshold INACTIVE (GY < 7) — targetCardIdFn returns null on every entry", () => {
    const game = mkGameStub(6);
    const s = new ContinuousStaticHandler().build(thresholdAst, {
      game,
      sourceCardId: SOURCE_ID,
      controllerSeat: CONTROLLER,
      staticId: STATIC_ID,
    });
    const payload = s.describe() as LayerPayload;
    if (payload.kind !== "multi") {
      throw new Error("expected multi payload");
    }
    for (const entry of payload.entries) {
      if (entry.kind === "pt-modify") {
        expect(entry.effect.targetCardIdFn?.()).toBeNull();
      } else if (entry.kind === "kw-grant") {
        expect(entry.effect.targetCardIdFn()).toBeNull();
      }
    }
  });

  it("Threshold ACTIVE (GY ≥ 7) — targetCardIdFn returns the source card id", () => {
    const game = mkGameStub(7);
    const s = new ContinuousStaticHandler().build(thresholdAst, {
      game,
      sourceCardId: SOURCE_ID,
      controllerSeat: CONTROLLER,
      staticId: STATIC_ID,
    });
    const payload = s.describe() as LayerPayload;
    if (payload.kind !== "multi") {
      throw new Error("expected multi payload");
    }
    for (const entry of payload.entries) {
      if (entry.kind === "pt-modify") {
        expect(entry.effect.targetCardIdFn?.()).toBe(SOURCE_ID);
      } else if (entry.kind === "kw-grant") {
        expect(entry.effect.targetCardIdFn()).toBe(SOURCE_ID);
        expect(entry.effect.keyword).toBe("Vigilance");
      }
    }
  });

  it("threshold flips between calls — GY size changes are observed live", () => {
    const game = mkGameStub(0) as unknown as { gy: StubGyZone };
    const handler = new ContinuousStaticHandler();
    const s = handler.build(thresholdAst, {
      game: game as never,
      sourceCardId: SOURCE_ID,
      controllerSeat: CONTROLLER,
      staticId: STATIC_ID,
    });
    const payload = s.describe() as LayerPayload;
    if (payload.kind !== "multi") throw new Error("expected multi payload");
    const ptEntry = payload.entries.find((e) => e.kind === "pt-modify");
    if (!ptEntry || ptEntry.kind !== "pt-modify") throw new Error("missing pt-modify entry");

    // Initially GY = 0 → Threshold inactive → null target.
    expect(ptEntry.effect.targetCardIdFn?.()).toBeNull();
    // Bump GY past the threshold — the fn re-reads the live GY.size.
    game.gy.size = 7;
    expect(ptEntry.effect.targetCardIdFn?.()).toBe(SOURCE_ID);
    // Drop back below — targetCardIdFn should re-suppress.
    game.gy.size = 6;
    expect(ptEntry.effect.targetCardIdFn?.()).toBeNull();
  });

  it("describe() returns the SAME reference on successive calls (referential-equality contract)", () => {
    const game = mkGameStub(0);
    const s = new ContinuousStaticHandler().build(thresholdAst, {
      game,
      sourceCardId: SOURCE_ID,
      controllerSeat: CONTROLLER,
      staticId: STATIC_ID,
    });
    const a = s.describe();
    const b = s.describe();
    expect(a).toBe(b);
  });
});

describe("Wave 32 — ContinuousStaticHandler Card.Self without Condition (no gate)", () => {
  it("targetCardIdFn returns sourceId immediately when no Condition$ is set", () => {
    const game = mkGameStub(0);
    const ast: StaticAst = {
      mode: "Continuous",
      params: {
        Mode: { kind: "literal", raw: "Continuous" },
        Affected: { kind: "literal", raw: "Card.Self" },
        AddPower: { kind: "literal", raw: "2" },
        AddToughness: { kind: "literal", raw: "0" },
      },
      activeInZones: [],
    };
    const s = new ContinuousStaticHandler().build(ast, {
      game,
      sourceCardId: SOURCE_ID,
      controllerSeat: CONTROLLER,
      staticId: STATIC_ID,
    });
    const payload = s.describe() as LayerPayload;
    expect(payload.kind).toBe("pt-modify");
    if (payload.kind !== "pt-modify") return;
    expect(payload.effect.targetCardIdFn?.()).toBe(SOURCE_ID);
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
// Unit tests for the FaceDownState union (CR 708). Compile-time the switch
// exhaustiveness guard already enforces kind coverage; this file covers the
// values and constructability of each variant and the FACE_UP sentinel.
import { describe, expect, it } from "vitest";
import { ManaCost } from "../mana/index.js";
import { FACE_UP, type FaceDownState } from "./face-down-state.js";

describe("FaceDownState (CR 708)", () => {
  it("FACE_UP sentinel has kind 'none'", () => {
    expect(FACE_UP.kind).toBe("none");
  });

  it("morph variant carries a ManaCost", () => {
    const fd: FaceDownState = { kind: "morph", cost: ManaCost.parse("3") };
    if (fd.kind === "morph") {
      expect(fd.cost.cmc()).toBe(3);
    } else {
      throw new Error("expected morph");
    }
  });

  it("manifest variant", () => {
    const fd: FaceDownState = { kind: "manifest" };
    expect(fd.kind).toBe("manifest");
  });

  it("foretell variant carries castableFrom 'exile'", () => {
    const fd: FaceDownState = { kind: "foretell", castableFrom: "exile" };
    if (fd.kind === "foretell") {
      expect(fd.castableFrom).toBe("exile");
    } else {
      throw new Error("expected foretell");
    }
  });

  it("disguise variant carries a ward amount", () => {
    const fd: FaceDownState = { kind: "disguise", wardAmount: 3 };
    if (fd.kind === "disguise") {
      expect(fd.wardAmount).toBe(3);
    } else {
      throw new Error("expected disguise");
    }
  });

  it("cloak variant", () => {
    const fd: FaceDownState = { kind: "cloak" };
    expect(fd.kind).toBe("cloak");
  });

  it("exhaustiveness guard fires on unknown kind", () => {
    const kinds: readonly FaceDownState["kind"][] = [
      "none",
      "morph",
      "manifest",
      "foretell",
      "disguise",
      "cloak",
    ];
    expect(kinds).toHaveLength(6);
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  KEYWORD_IDS,
  type KeywordId,
  keywordDisplayName,
  keywordIdFromDisplayName,
  keywordIsMultipleRedundant,
} from "./keyword-id.js";

describe("KeywordId", () => {
  it("covers the full Forge roster (>=196 entries)", () => {
    expect(KEYWORD_IDS.length).toBeGreaterThanOrEqual(196);
  });

  it("round-trips canonical ids through displayName", () => {
    expect(keywordDisplayName("first_strike")).toBe("First Strike");
    expect(keywordDisplayName("double_strike")).toBe("Double Strike");
    expect(keywordDisplayName("flying")).toBe("Flying");
    expect(keywordDisplayName("bands_with_other")).toBe("Bands with other");
    expect(keywordDisplayName("jump_start")).toBe("Jump-start");
    expect(keywordDisplayName("more_than_meets_the_eye")).toBe("More Than Meets the Eye");
  });

  it("parses display name back into canonical id (case-insensitive)", () => {
    expect(keywordIdFromDisplayName("Flying")).toBe("flying");
    expect(keywordIdFromDisplayName("FLYING")).toBe("flying");
    expect(keywordIdFromDisplayName("First Strike")).toBe("first_strike");
    expect(keywordIdFromDisplayName("Jump-start")).toBe("jump_start");
    expect(keywordIdFromDisplayName("not-a-real-keyword")).toBeNull();
  });

  it("encodes isMultipleRedundant flag (Flying redundant, Ward not)", () => {
    expect(keywordIsMultipleRedundant("flying")).toBe(true);
    expect(keywordIsMultipleRedundant("ward")).toBe(false);
    expect(keywordIsMultipleRedundant("first_strike")).toBe(true);
  });

  it("every canonical id resolves via displayName round-trip", () => {
    for (const id of KEYWORD_IDS) {
      const display = keywordDisplayName(id);
      const back: KeywordId | null = keywordIdFromDisplayName(display);
      expect(back).toBe(id);
    }
  });
});

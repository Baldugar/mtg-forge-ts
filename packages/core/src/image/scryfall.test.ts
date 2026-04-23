// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { DEFAULT_PAPER_CARD_FLAGS, type PaperCard } from "../card/paper-card.js";
import { UnknownCardError } from "../errors.js";
import { SCRYFALL_BASE, scryfallImageUrl, scryfallTokenImageUrl } from "./scryfall.js";

const mk = (overrides: Partial<PaperCard>): PaperCard => ({
  name: "Lightning Bolt",
  edition: "LEA",
  collectorNumber: "161",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  ...overrides,
});

describe("scryfallImageUrl — Forge-ported URL construction", () => {
  it("builds base URL with setcode lowered and front face", () => {
    expect(scryfallImageUrl(mk({}))).toBe(`${SCRYFALL_BASE}/lea/161/en?format=image&version=normal`);
  });

  it("appends face=back when caller requests back", () => {
    expect(scryfallImageUrl(mk({}), { face: "back" })).toBe(
      `${SCRYFALL_BASE}/lea/161/en?format=image&version=normal&face=back`,
    );
  });

  it("supports art_crop and other version params", () => {
    expect(scryfallImageUrl(mk({}), { crop: "art_crop" })).toBe(
      `${SCRYFALL_BASE}/lea/161/en?format=image&version=art_crop`,
    );
  });

  it("honors caller-provided lang override", () => {
    expect(scryfallImageUrl(mk({}), { lang: "ja" })).toBe(
      `${SCRYFALL_BASE}/lea/161/ja?format=image&version=normal`,
    );
  });

  it("strips F prefix on funny-card collector numbers", () => {
    const url = scryfallImageUrl(mk({ edition: "UNF", collectorNumber: "F123" }));
    expect(url).toBe(`${SCRYFALL_BASE}/unf/123/en?format=image&version=normal`);
  });

  it("applies planechase setcode override for OHOP-prefixed collector numbers", () => {
    const url = scryfallImageUrl(mk({ edition: "HOP", collectorNumber: "OHOP42" }));
    expect(url).toBe(`${SCRYFALL_BASE}/ohop/42/en?format=image&version=normal`);
  });

  it("forces face=back when collector number ends in ☇", () => {
    const url = scryfallImageUrl(mk({ collectorNumber: "161☇" }));
    expect(url).toBe(`${SCRYFALL_BASE}/lea/161/en?format=image&version=normal&face=back`);
  });

  it("url-encodes collector numbers containing special characters", () => {
    const url = scryfallImageUrl(mk({ collectorNumber: "A/1" }));
    expect(url).toContain(encodeURIComponent("A/1"));
  });

  it("throws UnknownCardError when edition is missing", () => {
    const bad = { ...mk({}), edition: "" } as PaperCard;
    expect(() => scryfallImageUrl(bad)).toThrow(UnknownCardError);
  });

  it("throws UnknownCardError when collectorNumber is missing", () => {
    const bad = { ...mk({}), collectorNumber: "" } as PaperCard;
    expect(() => scryfallImageUrl(bad)).toThrow(UnknownCardError);
  });
});

describe("scryfallTokenImageUrl", () => {
  it("builds token URL with lowered setcode and defaults to front", () => {
    expect(scryfallTokenImageUrl("C19", "17", "en")).toBe(
      `${SCRYFALL_BASE}/c19/17/en?format=image&version=normal`,
    );
  });

  it("appends face=back when caller requests back", () => {
    expect(scryfallTokenImageUrl("C19", "17", "en", "back")).toBe(
      `${SCRYFALL_BASE}/c19/17/en?format=image&version=normal&face=back`,
    );
  });
});

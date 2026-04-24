// SPDX-License-Identifier: GPL-3.0-or-later
// M1 golden-master: parse real Forge vendored card files to verify
// the parser handles actual production data.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCard } from "../src/parser/assembler.js";

const FORGE_CARDS = "F:/BACKUP/Programacion/forge/forge-gui/res/cardsfolder";

const maybeParse = (relPath: string): boolean => {
  const abs = resolve(FORGE_CARDS, relPath);
  if (!existsSync(abs)) return false;
  const src = readFileSync(abs, "utf8");
  const card = parseCard(src, relPath);
  expect(card.name).toBeTruthy();
  return true;
};

describe("M1 golden-master: real Forge vendored cards", () => {
  it("parses Lightning Bolt", () => {
    if (!maybeParse("l/lightning_bolt.txt")) {
      console.warn("skipping: Forge cardsfolder not present");
    }
  });

  it("parses Grizzly Bears", () => {
    if (!maybeParse("g/grizzly_bears.txt")) {
      console.warn("skipping: Forge cardsfolder not present");
    }
  });

  it("parses Counterspell", () => {
    if (!maybeParse("c/counterspell.txt")) {
      console.warn("skipping: Forge cardsfolder not present");
    }
  });
});

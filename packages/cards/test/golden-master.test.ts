// SPDX-License-Identifier: GPL-3.0-or-later
// M1 golden-master: parse real Forge vendored card files to verify
// the parser handles actual production data.
// M2 extension: also run the structural validator on each parsed card and
// assert no ERROR-severity issues (warnings are allowed — SVar validator
// may warn on unknown selector kinds not yet covered by M3).
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCard } from "../src/parser/assembler.js";
import { validateCard } from "../src/validator/validate-card.js";
import "../src/validator/mana-cost-validator.js";
import "../src/validator/zone-validator.js";
import "../src/validator/svar-selector-validator.js";

const FORGE_CARDS = "F:/BACKUP/Programacion/forge/forge-gui/res/cardsfolder";

const maybeParseAndValidate = (relPath: string): boolean => {
  const abs = resolve(FORGE_CARDS, relPath);
  if (!existsSync(abs)) return false;
  const src = readFileSync(abs, "utf8");
  const card = parseCard(src, relPath);
  expect(card.name).toBeTruthy();
  const res = validateCard(card);
  if (!res.ok) {
    console.warn(`validation issues for ${relPath}:`, res.issues);
  }
  const errors = res.issues.filter((i) => i.severity === "error");
  expect(errors).toEqual([]);
  return true;
};

describe("M1 golden-master: real Forge vendored cards", () => {
  it("parses Lightning Bolt", () => {
    if (!maybeParseAndValidate("l/lightning_bolt.txt")) {
      console.warn("skipping: Forge cardsfolder not present");
    }
  });

  it("parses Grizzly Bears", () => {
    if (!maybeParseAndValidate("g/grizzly_bears.txt")) {
      console.warn("skipping: Forge cardsfolder not present");
    }
  });

  it("parses Counterspell", () => {
    if (!maybeParseAndValidate("c/counterspell.txt")) {
      console.warn("skipping: Forge cardsfolder not present");
    }
  });
});

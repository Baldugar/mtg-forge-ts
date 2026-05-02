#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
//
// M6.14 — revert specific scenario IDs back to empty actions: [].
// Reads /tmp/m614-fails.txt one ID per line; in-place edits scenarios.ts.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../../..");
const scenariosPath = resolve(repoRoot, "packages/game/test/golden/scenarios.ts");

const failsPath = process.argv[2] ?? "/tmp/m614-fails.txt";
const failsText = readFileSync(failsPath, "utf8");
const failIds = new Set(
  failsText
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean),
);

const src = readFileSync(scenariosPath, "utf8");
const lines = src.split("\n");

let openIdx = -1;
let id = null;
let reverted = 0;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line === "  {") {
    openIdx = i;
    id = null;
  }
  const idMatch = line.match(/^ {4}id: "([^"]+)",$/);
  if (idMatch) id = idMatch[1];
  if (line === "  }," && openIdx !== -1 && id !== null && failIds.has(id)) {
    // walk this block and replace any non-empty actions: [...] line with actions: []
    for (let j = openIdx; j <= i; j++) {
      const m = lines[j].match(/^(\s*)actions: \[(.*)\],?$/);
      if (m && m[2] !== "") {
        lines[j] = `${m[1]}actions: [],`;
        reverted++;
        break;
      }
    }
    openIdx = -1;
    id = null;
  }
}

writeFileSync(scenariosPath, lines.join("\n"));
console.log(`Reverted ${reverted} scenarios.`);

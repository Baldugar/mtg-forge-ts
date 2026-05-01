#!/usr/bin/env -S npx tsx
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Export the M2 GoldenScenario set to plain JSON files so the Java bridge
// can consume them. Output: tools/forge-bridge/scenarios/<id>.scenario.json
//
// Usage:
//   npx tsx tools/forge-bridge/scripts/export-scenarios.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../../..");

// Import the TS source directly via tsx. Windows requires file:// URLs.
const scenariosPath = resolve(repoRoot, "packages/game/test/golden/scenarios.ts");
const { SCENARIOS } = await import(pathToFileURL(scenariosPath).href);

const outDir = resolve(__dirname, "../scenarios");
mkdirSync(outDir, { recursive: true });

let count = 0;
for (const sc of SCENARIOS) {
  const out = resolve(outDir, `${sc.id}.scenario.json`);
  writeFileSync(out, JSON.stringify(sc, null, 2));
  count++;
}
console.log(`Exported ${count} scenarios to ${outDir}`);

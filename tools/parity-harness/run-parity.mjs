#!/usr/bin/env -S npx tsx
// SPDX-License-Identifier: GPL-3.0-or-later
// Milestone 4 — parity aggregator entry point.
//
// Walks the M2 golden cohort, diffs each TS-vs-Java pair, and writes a
// human-readable Markdown summary to
//   tools/parity-harness/reports/parity-<timestamp>.md
//
// Usage:
//   npx tsx tools/parity-harness/run-parity.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../..");

// Import via tsx — parity runner + scenarios are TS source.
const runnerPath = resolve(repoRoot, "packages/game/test/parity/runner.ts");
const scenariosPath = resolve(repoRoot, "packages/game/test/golden/scenarios.ts");
const { aggregateReports, diffTraces, loadJavaGolden, loadTsGolden } = await import(
  pathToFileURL(runnerPath).href
);
const { SCENARIOS } = await import(pathToFileURL(scenariosPath).href);

const reports = [];
const missing = [];
for (const sc of SCENARIOS) {
  const ts = loadTsGolden(sc.id);
  const java = loadJavaGolden(sc.id);
  if (!ts) {
    missing.push(`${sc.id} (TS golden missing)`);
    continue;
  }
  if (!java) {
    missing.push(`${sc.id} (Java golden missing)`);
    continue;
  }
  reports.push(diffTraces(sc.id, ts, java));
}

const agg = aggregateReports(reports);

// ── Markdown report ─────────────────────────────────────────────────────────

const ts = new Date().toISOString().replace(/[:.]/g, "-");
const reportsDir = resolve(__dirname, "reports");
mkdirSync(reportsDir, { recursive: true });
const outPath = resolve(reportsDir, `parity-${ts}.md`);

const lines = [];
lines.push(`# Parity report`);
lines.push("");
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push(`Cohort: M2 30-card golden set`);
lines.push("");
lines.push(`- Scenarios:        ${agg.totalScenarios}`);
lines.push(`- Full-match:       ${agg.fullMatch}`);
lines.push(`- MVP-known:        ${agg.mvpKnown} (divergences explained by documented M3-MVP bridge limits)`);
lines.push(`- Unknown:          ${agg.unknown} (real divergences worth investigating)`);
if (missing.length > 0) {
  lines.push(`- Missing goldens:  ${missing.length}`);
}
lines.push("");
lines.push(`## Divergence classes (count of scenarios touching each class)`);
lines.push("");
for (const [cls, count] of Object.entries(agg.perClass)) {
  lines.push(`- \`${cls}\`: ${count}`);
}
lines.push("");
lines.push(`## Per-scenario`);
lines.push("");
lines.push(`| Scenario | Severity | TS-only kinds | Java-only kinds | Shared |`);
lines.push(`| --- | --- | --- | --- | --- |`);
for (const r of agg.perScenario) {
  const tsOnly =
    r.tsOnlyKinds.length === 0
      ? "—"
      : r.tsOnlyKinds.map((d) => `${d.kind} *(${d.classification})*`).join(", ");
  const javaOnly =
    r.javaOnlyKinds.length === 0
      ? "—"
      : r.javaOnlyKinds.map((d) => `${d.kind} *(${d.classification})*`).join(", ");
  const shared = r.sharedKinds.length === 0 ? "—" : r.sharedKinds.join(", ");
  lines.push(`| \`${r.scenarioId}\` | ${r.severity} | ${tsOnly} | ${javaOnly} | ${shared} |`);
}
if (missing.length > 0) {
  lines.push("");
  lines.push(`## Missing goldens`);
  lines.push("");
  for (const m of missing) lines.push(`- ${m}`);
}

writeFileSync(outPath, lines.join("\n") + "\n", "utf8");

// ── Console summary ─────────────────────────────────────────────────────────

console.log(`Parity report written: ${outPath}`);
console.log(`Scenarios: ${agg.totalScenarios}`);
console.log(`  full-match:  ${agg.fullMatch}`);
console.log(`  mvp-known:   ${agg.mvpKnown}`);
console.log(`  unknown:     ${agg.unknown}`);
if (missing.length > 0) console.log(`  missing:     ${missing.length}`);
for (const [cls, count] of Object.entries(agg.perClass)) {
  console.log(`  class ${cls.padEnd(34)} ${count}`);
}

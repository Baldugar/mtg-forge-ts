// SPDX-License-Identifier: GPL-3.0-or-later
// CLI entry point — scans a directory tree of Forge .txt card files,
// runs parseCard + validateCardSemantically on each, and prints aggregate
// coverage statistics.
//
// Usage:
//   pnpm --filter @mtg-forge-ts/dsl-validator scan [<corpus-dir>] [--cap <n>]
//   pnpm --filter @mtg-forge-ts/dsl-validator scan -- --smoke [--cap <n>]
//
// Defaults: corpus = F:/BACKUP/Programacion/forge/forge-gui/res/cardsfolder
//           cap    = 5000 (remove with --cap 0 or a large number)
//
// --smoke flag switches to the smoke-harness mode (Milestone 1 of
// TESTING_STRATEGY.md): for each card, the engine builds a minimal Game,
// places the card in a zone, drives ETB / activates abilities-from-
// definition, and reports per-card pass/fail. A JSON report is written to
// tools/dsl-validator/reports/smoke-<timestamp>.json plus a fix-list
// markdown grouping failures by error class.

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCard } from "@mtg-forge-ts/cards";
import { validateCardSemantically } from "./index.js";
import type { SmokeErrorClass, SmokeResult } from "./smoke.js";
import { runSmoke } from "./smoke.js";

// ── CLI argument parsing ──────────────────────────────────────────────────────

const args = process.argv.slice(2);
let CORPUS = "F:/BACKUP/Programacion/forge/forge-gui/res/cardsfolder";
let CAP = 5000;
let MODE: "scan" | "smoke" = "scan";

for (let i = 0; i < args.length; i++) {
  const a = args[i] ?? "";
  if (a === "--cap") {
    const next = args[i + 1];
    if (next !== undefined) {
      CAP = Number(next);
      i++;
    }
  } else if (a === "--smoke") {
    MODE = "smoke";
  } else if (a !== "" && !a.startsWith("--")) {
    CORPUS = a;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface FileResult {
  readonly file: string;
  readonly status: "parsed" | "parseError" | "semanticIssues";
  readonly error?: string;
  readonly issues?: readonly { kind: string; key: string }[];
}

// ── Corpus walker ─────────────────────────────────────────────────────────────

function* walkTxt(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    if (st.isDirectory()) yield* walkTxt(path);
    else if (entry.endsWith(".txt")) yield path;
  }
}

// ── Smoke-mode runner ────────────────────────────────────────────────────────

interface SmokeFailure {
  readonly file: string;
  readonly cardName: string;
  readonly result: SmokeResult;
}

const __dirname_smoke = dirname(fileURLToPath(import.meta.url));

const runSmokeMode = (): void => {
  const failures: SmokeFailure[] = [];
  let total = 0;
  let parseFailures = 0;
  let passed = 0;
  let capped = false;
  const byStrategy: Record<SmokeResult["strategy"], { pass: number; fail: number }> = {
    "permanent-etb": { pass: 0, fail: 0 },
    "spell-activate": { pass: 0, fail: 0 },
    "other-activate": { pass: 0, fail: 0 },
  };
  const byErrorClass = new Map<SmokeErrorClass, number>();
  const errorMessageTally = new Map<string, { count: number; example: string }>();

  for (const path of walkTxt(CORPUS)) {
    if (CAP > 0 && total >= CAP) {
      capped = true;
      break;
    }
    total++;
    let src: string;
    try {
      src = readFileSync(path, "utf8");
    } catch (e) {
      parseFailures++;
      const msg = e instanceof Error ? e.message : String(e);
      failures.push({
        file: path,
        cardName: "<unreadable>",
        result: {
          ok: false,
          strategy: "other-activate",
          errorClass: "other",
          error: `read error: ${msg.slice(0, 200)}`,
        },
      });
      continue;
    }

    let cardName = "<unknown>";
    try {
      const def = parseCard(src, path);
      cardName = def.name;
      const result = runSmoke(def);
      byStrategy[result.strategy][result.ok ? "pass" : "fail"]++;
      if (result.ok) {
        passed++;
      } else {
        const cls = result.errorClass ?? "other";
        byErrorClass.set(cls, (byErrorClass.get(cls) ?? 0) + 1);
        // Group failure messages by their first 80 chars for a top-N tally.
        const msgKey = (result.error ?? "<no message>").slice(0, 80);
        const existing = errorMessageTally.get(msgKey);
        if (existing) {
          existing.count++;
        } else {
          errorMessageTally.set(msgKey, { count: 1, example: cardName });
        }
        failures.push({ file: path, cardName, result });
      }
    } catch (e) {
      // Parser threw — distinct from a smoke failure.
      parseFailures++;
      const msg = e instanceof Error ? e.message : String(e);
      failures.push({
        file: path,
        cardName,
        result: {
          ok: false,
          strategy: "other-activate",
          errorClass: "other",
          error: `parser threw: ${msg.slice(0, 200)}`,
        },
      });
    }
  }

  // ── Print report ─────────────────────────────────────────────────────────
  const pct = (n: number): string => (total === 0 ? "0.0%" : `${((n / total) * 100).toFixed(1)}%`);
  console.log("\n=== Forge Corpus Smoke Report ===");
  console.log(`Corpus : ${CORPUS}`);
  console.log(`Scanned: ${total} .txt files${capped ? ` (capped at ${CAP})` : ""}`);
  console.log(`  Passed              : ${passed.toString().padStart(5)} (${pct(passed)})`);
  console.log(`  Parser failures     : ${parseFailures.toString().padStart(5)} (${pct(parseFailures)})`);
  console.log(
    `  Smoke failures      : ${(failures.length - parseFailures).toString().padStart(5)} (${pct(failures.length - parseFailures)})`,
  );
  console.log("\n  By strategy:");
  for (const [s, counts] of Object.entries(byStrategy)) {
    console.log(
      `    ${s.padEnd(18)}: pass=${counts.pass.toString().padStart(5)}  fail=${counts.fail.toString().padStart(4)}`,
    );
  }
  if (byErrorClass.size > 0) {
    console.log("\n  By error class:");
    const sortedClasses = [...byErrorClass.entries()].sort((a, b) => b[1] - a[1]);
    for (const [cls, count] of sortedClasses) {
      console.log(`    ${cls.padEnd(20)}: ${count}`);
    }
  }
  if (errorMessageTally.size > 0) {
    console.log("\n  Top 20 failure messages:");
    const top = [...errorMessageTally.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 20);
    for (const [msg, { count, example }] of top) {
      console.log(`    [${count.toString().padStart(4)}] ${msg}  (e.g. ${example})`);
    }
  }

  // ── Persist artefacts ────────────────────────────────────────────────────
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const reportsDir = join(__dirname_smoke, "..", "reports");
  try {
    mkdirSync(reportsDir, { recursive: true });
  } catch {
    // ignore — directory may already exist
  }
  const jsonPath = join(reportsDir, `smoke-${ts}.json`);
  const reportPayload = {
    corpus: CORPUS,
    total,
    passed,
    parseFailures,
    smokeFailures: failures.length - parseFailures,
    capped,
    cap: CAP,
    byStrategy,
    byErrorClass: Object.fromEntries(byErrorClass),
    failures: failures.map((f) => ({
      file: f.file,
      cardName: f.cardName,
      strategy: f.result.strategy,
      errorClass: f.result.errorClass,
      error: f.result.error,
    })),
  };
  writeFileSync(jsonPath, JSON.stringify(reportPayload, null, 2), "utf8");
  console.log(`\nReport: ${jsonPath}`);

  // Fix-list markdown — always overwrites smoke-fixes.md so the next-wave
  // punch list reflects the most recent run.
  const fixesPath = join(reportsDir, "smoke-fixes.md");
  const groupedByClass = new Map<string, SmokeFailure[]>();
  for (const f of failures) {
    const cls = f.result.errorClass ?? "other";
    const list = groupedByClass.get(cls) ?? [];
    list.push(f);
    groupedByClass.set(cls, list);
  }
  let md = `# Corpus smoke fix-list\n\nGenerated: ${ts}\nCorpus: ${CORPUS}\nScanned: ${total}${capped ? ` (capped at ${CAP})` : ""}\nPassed: ${passed}\nFailed: ${failures.length}\n\n`;
  for (const [cls, list] of [...groupedByClass.entries()].sort((a, b) => b[1].length - a[1].length)) {
    md += `## ${cls} — ${list.length}\n\n`;
    // Cap per-class to first 50 cards so the file stays scannable.
    const head = list.slice(0, 50);
    for (const f of head) {
      md += `- **${f.cardName}** (${f.result.strategy}): \`${f.result.error ?? ""}\` — \`${f.file}\`\n`;
    }
    if (list.length > head.length) md += `- ...and ${list.length - head.length} more\n`;
    md += "\n";
  }
  writeFileSync(fixesPath, md, "utf8");
  console.log(`Fix-list: ${fixesPath}`);
};

// ── Main ──────────────────────────────────────────────────────────────────────

const main = (): void => {
  if (MODE === "smoke") {
    runSmokeMode();
    return;
  }
  const results: FileResult[] = [];
  let total = 0;
  let capped = false;

  for (const path of walkTxt(CORPUS)) {
    if (CAP > 0 && total >= CAP) {
      capped = true;
      break;
    }
    total++;

    let src: string;
    try {
      src = readFileSync(path, "utf8");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ file: path, status: "parseError", error: `read error: ${msg}` });
      continue;
    }

    try {
      const def = parseCard(src, path);
      const sem = validateCardSemantically(def);
      if (sem.ok) {
        results.push({ file: path, status: "parsed" });
      } else {
        results.push({
          file: path,
          status: "semanticIssues",
          issues: sem.issues.map((i) => ({ kind: i.kind, key: i.key })),
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Truncate very long error messages to keep the tally table readable.
      results.push({ file: path, status: "parseError", error: msg });
    }
  }

  // ── Aggregate ────────────────────────────────────────────────────────────────

  const parsed = results.filter((r) => r.status === "parsed").length;
  const parseErrors = results.filter((r) => r.status === "parseError").length;
  const semanticIssues = results.filter((r) => r.status === "semanticIssues").length;

  // Unknown handler keys, tallied by (kind, key).
  const unknownByKind = new Map<string, Map<string, number>>();
  for (const r of results) {
    if (r.status !== "semanticIssues" || !r.issues) continue;
    for (const issue of r.issues) {
      const m = unknownByKind.get(issue.kind) ?? new Map<string, number>();
      m.set(issue.key, (m.get(issue.key) ?? 0) + 1);
      unknownByKind.set(issue.kind, m);
    }
  }

  // Parser error messages, grouped by first-clause prefix.
  const errorTally = new Map<string, number>();
  for (const r of results) {
    if (r.status !== "parseError" || !r.error) continue;
    // Group by first segment (up to first colon or 80 chars).
    const raw = r.error;
    // Strip leading file path prefix ("path/to/file: message") so errors
    // from different paths collapse into the same bucket.
    const withoutPath = raw.replace(/^[^:]+\.txt:\s*/i, "");
    const key = (withoutPath.split(/:|\n/)[0] ?? raw).trim().slice(0, 100);
    errorTally.set(key, (errorTally.get(key) ?? 0) + 1);
  }

  // ── Print report ─────────────────────────────────────────────────────────────

  const pct = (n: number): string => (total === 0 ? "0.0%" : `${((n / total) * 100).toFixed(1)}%`);

  console.log("\n=== Forge Corpus Coverage Report ===");
  console.log(`Corpus : ${CORPUS}`);
  console.log(`Scanned: ${total} .txt files${capped ? ` (capped at ${CAP})` : ""}`);
  console.log(`  Parsed clean (semantic ok)  : ${parsed.toString().padStart(5)} (${pct(parsed)})`);
  console.log(
    `  Parsed with semantic issues : ${semanticIssues.toString().padStart(5)} (${pct(semanticIssues)})`,
  );
  console.log(`  Parser errors               : ${parseErrors.toString().padStart(5)} (${pct(parseErrors)})`);

  if (unknownByKind.size > 0) {
    console.log("\n=== Top 20 unknown handler keys (by card occurrence count) ===");
    for (const [kind, m] of unknownByKind) {
      const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
      console.log(`\n--- ${kind} ---`);
      for (const [key, count] of sorted) {
        console.log(`  ${count.toString().padStart(5)} : ${key}`);
      }
    }
  }

  console.log("\n=== Top 20 parser errors ===");
  const errorsSorted = [...errorTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  if (errorsSorted.length === 0) {
    console.log("  (none)");
  } else {
    for (const [msg, count] of errorsSorted) {
      console.log(`  ${count.toString().padStart(5)} : ${msg}`);
    }
  }

  console.log("");
};

main();

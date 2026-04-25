// SPDX-License-Identifier: GPL-3.0-or-later
// CLI entry point — scans a directory tree of Forge .txt card files,
// runs parseCard + validateCardSemantically on each, and prints aggregate
// coverage statistics.
//
// Usage:
//   pnpm --filter @mtg-forge-ts/dsl-validator scan [<corpus-dir>] [--cap <n>]
//
// Defaults: corpus = F:/BACKUP/Programacion/forge/forge-gui/res/cardsfolder
//           cap    = 5000 (remove with --cap 0 or a large number)

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseCard } from "@mtg-forge-ts/cards";
import { validateCardSemantically } from "./index.js";

// ── CLI argument parsing ──────────────────────────────────────────────────────

const args = process.argv.slice(2);
let CORPUS = "F:/BACKUP/Programacion/forge/forge-gui/res/cardsfolder";
let CAP = 5000;

for (let i = 0; i < args.length; i++) {
  const a = args[i] ?? "";
  if (a === "--cap") {
    const next = args[i + 1];
    if (next !== undefined) {
      CAP = Number(next);
      i++;
    }
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

// ── Main ──────────────────────────────────────────────────────────────────────

const main = (): void => {
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

#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
//
// M6.18 — Parallel recapture: spawns N workers concurrently, each running
// one bridge invocation. Used after BridgeRunner.java changes that affect
// every scenario (e.g. scenarioCards-vs-CardDb preference flip).
//
// Usage:
//   node tools/forge-bridge/scripts/recapture-parallel.mjs [concurrency=8] [ids-file?]
//
// If ids-file omitted, recaptures every scenario in scenarios/.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SCEN_DIR = path.join(ROOT, "scenarios");
const GOLD_DIR = path.join(ROOT, "__golden_java__");

const concurrency = Number.parseInt(process.argv[2] ?? "8", 10);
const idsFile = process.argv[3];

let ids;
if (idsFile) {
  ids = fs
    .readFileSync(idsFile, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
} else {
  ids = fs
    .readdirSync(SCEN_DIR)
    .filter((f) => f.endsWith(".scenario.json"))
    .map((f) => f.replace(/\.scenario\.json$/, ""))
    .sort();
}

console.log(`Recapturing ${ids.length} scenarios with concurrency=${concurrency}`);

let cursor = 0;
let ok = 0;
let fail = 0;
const failures = [];
const startedAt = Date.now();

function runOne(id) {
  return new Promise((resolve) => {
    const sc = path.join(SCEN_DIR, `${id}.scenario.json`);
    const out = path.join(GOLD_DIR, `${id}.golden.java.json`);
    if (!fs.existsSync(sc)) {
      failures.push({ id, reason: "missing-scenario" });
      fail++;
      resolve();
      return;
    }
    const child = spawn("bash", [path.join(ROOT, "scripts", "run.sh"), sc, out], {
      stdio: ["ignore", "ignore", "pipe"],
      timeout: 60000,
    });
    let err = "";
    child.stderr.on("data", (d) => {
      err += d.toString();
    });
    child.on("exit", (code) => {
      if (code === 0) {
        ok++;
      } else {
        failures.push({ id, code, reason: err.slice(-120) });
        fail++;
      }
      resolve();
    });
    child.on("error", (e) => {
      failures.push({ id, reason: e.message?.slice(0, 80) });
      fail++;
      resolve();
    });
  });
}

async function worker(_workerId) {
  while (cursor < ids.length) {
    const i = cursor++;
    const id = ids[i];
    await runOne(id);
    if ((ok + fail) % 50 === 0) {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(`[${ok + fail}/${ids.length}] ok=${ok} fail=${fail} t=${elapsed}s`);
    }
  }
}

const workers = [];
for (let w = 0; w < concurrency; w++) workers.push(worker(w));
await Promise.all(workers);

const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`Done in ${elapsed}s: ${ok} captured, ${fail} failed`);
if (failures.length > 0) {
  const log = path.join(ROOT, "__capture_logs__", "recapture-failures.json");
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.writeFileSync(log, JSON.stringify(failures, null, 2));
  console.log(`Wrote failure list: ${log}`);
}

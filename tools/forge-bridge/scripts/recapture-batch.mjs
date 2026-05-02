#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Robust batched recapture script. Reads IDs file, runs Forge bridge per
// scenario, swallows individual failures, reports summary.
//
// Usage: node tools/forge-bridge/scripts/recapture-batch.mjs <ids-file>

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const idsFile = process.argv[2];
if (!idsFile) {
  console.error("Usage: recapture-batch.mjs <ids-file>");
  process.exit(1);
}

// Throttling: process each capture sequentially with a small sleep
// between invocations so the user's CPU isn't overrun by JVM cold-starts.
// Override via env: THROTTLE_MS=<ms>, JVM_MEM=<heap>.
const throttleMs = Number(process.env.THROTTLE_MS ?? 800);
const jvmMem = process.env.JVM_MEM ?? "1g";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ids = fs
  .readFileSync(idsFile, "utf-8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname).slice(1), "..");
const scenariosDir = path.join(root, "scenarios");
const goldenDir = path.join(root, "__golden_java__");

let ok = 0;
let fail = 0;
const failures = [];

console.log(
  `Throttled capture: throttle=${throttleMs}ms, JVM_MEM=${jvmMem}, scenarios=${ids.length}`,
);

for (let i = 0; i < ids.length; i++) {
  const id = ids[i];
  const scenarioFile = path.join(scenariosDir, `${id}.scenario.json`);
  const outFile = path.join(goldenDir, `${id}.golden.java.json`);
  if (!fs.existsSync(scenarioFile)) {
    failures.push({ id, reason: "missing-scenario" });
    fail++;
    continue;
  }
  try {
    execFileSync("bash", [path.join(root, "scripts", "run.sh"), scenarioFile, outFile], {
      stdio: ["ignore", "ignore", "ignore"],
      timeout: 60000,
      env: {
        ...process.env,
        // Lower JVM heap + lower priority hint
        JAVA_OPTS: `-Xmx${jvmMem} -Dio.netty.tryReflectionSetAccessible=true -Dfile.encoding=UTF-8`,
      },
    });
    ok++;
  } catch (e) {
    failures.push({ id, reason: e.message?.slice(0, 60) ?? "unknown" });
    fail++;
  }
  if ((i + 1) % 10 === 0) {
    console.log(`[${i + 1}/${ids.length}] ok=${ok} fail=${fail}`);
  }
  // Throttle between captures to give the host CPU room.
  if (throttleMs > 0 && i < ids.length - 1) {
    await sleep(throttleMs);
  }
}

console.log(`Done: ${ok} captured, ${fail} failed`);
if (failures.length > 0) {
  fs.writeFileSync(
    path.join(root, "__capture_logs__", "recapture-failures.json"),
    JSON.stringify(failures, null, 2),
  );
  console.log("Wrote failure list: tools/forge-bridge/__capture_logs__/recapture-failures.json");
}

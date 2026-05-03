#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Persistent-JVM batch driver.
//
// Spawns ONE BridgeRunner JVM in --server mode, feeds it scenario IDs via
// stdin, and reads OK/ERR responses from stdout. Amortizes Forge's static
// init across the whole batch — per-scenario capture drops from ~21s
// (cold-start every time) to ~1-2s (warm).
//
// Usage: node tools/forge-bridge/scripts/server-batch.mjs <ids-file>
//
// Env:
//   JVM_MEM     — heap size (default "2g")
//   FORGE_JAR   — path to forge fat jar (same default as run.sh)
//   IDLE_MS     — between writes; default 0

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const idsFile = process.argv[2];
if (!idsFile) {
  console.error("Usage: server-batch.mjs <ids-file>");
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const buildDir = path.join(root, "build");
const scenariosDir = path.join(root, "scenarios");
const goldenDir = path.join(root, "__golden_java__");

const jvmMem = process.env.JVM_MEM ?? "2g";
const forgeJar = process.env.FORGE_JAR
  ?? path.resolve(root, "../../../forge/forge-gui-desktop/target/forge-gui-desktop-2.0.12-SNAPSHOT-jar-with-dependencies.jar");

if (!fs.existsSync(forgeJar)) {
  console.error(`ERROR: Forge fat jar not found at ${forgeJar}`);
  process.exit(1);
}

const forgeGuiDir = path.resolve(path.dirname(path.dirname(forgeJar)), "../forge-gui");
if (!fs.existsSync(path.join(forgeGuiDir, "res"))) {
  console.error(`ERROR: forge-gui/res not found at ${forgeGuiDir}/res`);
  process.exit(1);
}

const ids = fs.readFileSync(idsFile, "utf-8").split("\n").map((s) => s.trim()).filter(Boolean);
console.log(`Server batch: ${ids.length} scenarios, JVM_MEM=${jvmMem}`);

const sep = process.platform === "win32" ? ";" : ":";
// On MSYS/MinGW the JVM expects native Windows paths.
const toJvmPath = (p) =>
  process.platform === "win32" && p.includes("/")
    ? p.replace(/^\/([a-z])\//i, "$1:/").replace(/\//g, "\\")
    : p;
const cp = `${toJvmPath(buildDir)}${sep}${toJvmPath(forgeJar)}`;

const javaArgs = [
  `-Xmx${jvmMem}`,
  "-Dio.netty.tryReflectionSetAccessible=true",
  "-Dfile.encoding=UTF-8",
  "-cp",
  cp,
  "forge.bridge.BridgeRunner",
  "--server",
];

const startedAt = Date.now();
const jvm = spawn("java", javaArgs, {
  cwd: forgeGuiDir,
  stdio: ["pipe", "pipe", "inherit"],
});

let ok = 0;
let fail = 0;
const failures = [];
let pendingId = null;
let pendingIdx = 0;
let readyResolved;
const readyPromise = new Promise((r) => { readyResolved = r; });

const rl = readline.createInterface({ input: jvm.stdout });
rl.on("line", (line) => {
  if (line === "READY") {
    const initMs = Date.now() - startedAt;
    console.log(`[ready] init=${(initMs / 1000).toFixed(1)}s`);
    readyResolved();
    return;
  }
  if (line === "BYE") return;
  if (line.startsWith("OK ")) {
    ok++;
    pendingId = null;
  } else if (line.startsWith("ERR ")) {
    fail++;
    const detail = line.slice(4);
    failures.push({ id: pendingId, reason: detail.slice(0, 80) });
    pendingId = null;
  }
  if ((ok + fail) % 25 === 0 && (ok + fail) > 0) {
    const elapsed = (Date.now() - startedAt) / 1000;
    const rate = (ok + fail) / elapsed;
    console.log(`[${ok + fail}/${ids.length}] ok=${ok} fail=${fail} rate=${rate.toFixed(2)}/s`);
  }
});

jvm.on("exit", (code) => {
  const totalMs = Date.now() - startedAt;
  console.log(`Done: ${ok} captured, ${fail} failed in ${(totalMs / 1000).toFixed(1)}s (exit=${code})`);
  if (failures.length > 0) {
    fs.writeFileSync(
      path.join(root, "__capture_logs__", "server-batch-failures.json"),
      JSON.stringify(failures, null, 2),
    );
    console.log("Wrote failure list: tools/forge-bridge/__capture_logs__/server-batch-failures.json");
  }
  process.exit(code ?? 0);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const idleMs = Number(process.env.IDLE_MS ?? 0);

(async () => {
  await readyPromise;
  // Pace writes off the OK/ERR signal so backpressure stays sane.
  for (const id of ids) {
    pendingId = id;
    pendingIdx++;
    const scenarioFile = path.join(scenariosDir, `${id}.scenario.json`);
    const outFile = path.join(goldenDir, `${id}.golden.java.json`);
    if (!fs.existsSync(scenarioFile)) {
      failures.push({ id, reason: "missing-scenario" });
      fail++;
      pendingId = null;
      continue;
    }
    // Wait for previous response to land before sending the next request,
    // otherwise we can race writeStream backpressure.
    while (pendingId && (ok + fail) < pendingIdx - 1) {
      await sleep(5);
    }
    jvm.stdin.write(`${scenarioFile}\t${outFile}\n`);
    if (idleMs > 0) await sleep(idleMs);
  }
  // Drain remaining responses.
  while ((ok + fail) < ids.length) {
    await sleep(20);
  }
  jvm.stdin.write("QUIT\n");
  jvm.stdin.end();
})();

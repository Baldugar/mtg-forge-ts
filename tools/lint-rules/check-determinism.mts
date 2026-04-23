// SPDX-License-Identifier: GPL-3.0-or-later
// Determinism lint — forbid ambient randomness and wall-clock sources inside
// the engine (packages/game/src) and AI (packages/ai/src) trees. Master-spec
// §7 requires deterministic engine output given a fixed Rng seed; every one
// of the banned calls below sources entropy or time outside the RNG that
// GameSnapshot can't restore, so their appearance breaks reproducibility.
//
// Implementation notes:
// - globby rather than Node 22's fs.globSync, because CI targets Node 20 LTS.
// - Line + block comments are stripped before regex matching so inline docs
//   that reference the names (e.g. "avoid Math.random here") don't trip the
//   check.
// - Each banned pattern carries a human-readable reason string; failures
//   print file + pattern + reason so a CI red is immediately actionable.
import { readFileSync } from "node:fs";
import { globby } from "globby";

const BANNED: { readonly pattern: RegExp; readonly reason: string }[] = [
  { pattern: /\bMath\.random\s*\(/, reason: "Math.random is ambient randomness" },
  { pattern: /\bDate\.now\s*\(/, reason: "Date.now is ambient clock" },
  { pattern: /\bnew Date\s*\(\s*\)/, reason: "new Date() with no args is ambient clock" },
  { pattern: /\bcrypto\.randomUUID\s*\(/, reason: "crypto.randomUUID is ambient randomness" },
  { pattern: /\bperformance\.now\s*\(/, reason: "performance.now is ambient clock" },
];

const main = async (): Promise<void> => {
  const files = await globby(["packages/game/src/**/*.ts", "packages/ai/src/**/*.ts"]);

  let violations = 0;
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    // Strip line AND block comments so doc references don't false-positive.
    const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const { pattern, reason } of BANNED) {
      if (pattern.test(code)) {
        console.error(`${file}: ${reason} (matches ${pattern})`);
        violations++;
      }
    }
  }

  if (violations > 0) {
    console.error(`\nDeterminism check failed: ${violations} violation(s) in game/ai packages.`);
    process.exit(1);
  }
  console.log(`Determinism check passed: ${files.length} files, zero violations.`);
};

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

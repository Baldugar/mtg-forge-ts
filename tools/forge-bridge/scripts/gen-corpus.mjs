#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Corpus-coverage scenario generator.
//
// Reads cards from Forge's res/cardsfolder, identifies which ones are NOT
// yet exercised by any scenario in tools/forge-bridge/scenarios/, and emits
// a TypeScript IIFE block (to be appended to scenarios.ts) that defines
// minimal scenarios per uncovered card. Strategy:
//   - Permanents (Creature/Artifact/Enchantment/Land/Planeswalker/Battle)
//     → ETB scenario: card on battlefield, no actions, just setup.
//     The TS golden runner emits ETB triggers from the setup zone-move,
//     mirroring Forge's GameAction.moveTo path.
//   - Non-permanents (Instant/Sorcery) → in-hand scenario: card in hand,
//     no actions. Verifies parse + load.
//
// Usage:
//   node tools/forge-bridge/scripts/gen-corpus.mjs <count> <wave-tag> > out.ts
//
// Then append `out.ts` to packages/game/test/golden/scenarios.ts before the
// closing `]` of the SCENARIOS array.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const count = Number(process.argv[2] ?? 1000);
const wave = process.argv[3] ?? "m672";
if (!count || count < 1) {
  console.error("Usage: gen-corpus.mjs <count> <wave-tag>");
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../../..");
const corpusDir = path.resolve(root, "../forge/forge-gui/res/cardsfolder");
const scenariosDir = path.resolve(root, "tools/forge-bridge/scenarios");

// 1) Collect base card names already covered.
const covered = new Set();
for (const f of fs.readdirSync(scenariosDir)) {
  if (!f.endsWith(".scenario.json")) continue;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(scenariosDir, f), "utf8"));
    for (const name of Object.keys(j.cards ?? {})) {
      const base = name.replace(/\s+M6\d+(\s+M6\d+)?$/i, "").replace(/\s+v\d$/i, "").trim();
      covered.add(base);
    }
  } catch {}
}

// 2) Walk corpus alphabetically, pick the first `count` uncovered cards.
const uncovered = [];
outer: for (const letter of fs.readdirSync(corpusDir).sort()) {
  const sub = path.join(corpusDir, letter);
  if (!fs.statSync(sub).isDirectory()) continue;
  for (const f of fs.readdirSync(sub).sort()) {
    if (!f.endsWith(".txt")) continue;
    const txt = fs.readFileSync(path.join(sub, f), "utf8");
    const lines = txt.split("\n");
    const nameLine = lines[0];
    if (!nameLine?.startsWith("Name:")) continue;
    const nm = nameLine.slice(5).trim();
    if (covered.has(nm)) continue;
    // Skip card classes whose ETB-on-bf setup would diverge from Forge:
    //   - Schemes/Conspiracies/Vanguards/Phenomena/Planes/Dungeons live in
    //     non-battlefield zones the bridge doesn't replicate.
    //   - Auras (K:Enchant:) need a legal attachment target per CR 303.4
    //     to stay on the battlefield. Forge fizzles them; TS golden runner
    //     stamps them on bf. → in-hand only.
    //   - Sagas need lore-counter chapters to fire correctly; bridge timing
    //     diverges. → in-hand only.
    //   - Cards with K:etbCounter trigger CounterAdded on TS that Forge's
    //     bridge captures via a different event path (replacement, not
    //     GameEventCardCounters). → in-hand only.
    //   - Vehicles need crewing to be active.
    //   - Battles need defense counters seeded.
    const typesLine = lines.find((l) => l.startsWith("Types:")) ?? "";
    const t = typesLine.slice(6);
    if (/Scheme|Conspiracy|Vanguard|Phenomenon|Plane(\b|$)|Dungeon/.test(t)) continue;
    const isAura = lines.some((l) => l.startsWith("K:Enchant:"));
    const isSaga = /\bSaga\b/.test(t);
    const isVehicle = /\bVehicle\b/.test(t);
    const isBattle = /\bBattle\b/.test(t);
    const hasEtbCounter = lines.some((l) => l.startsWith("K:etbCounter"));
    // M6.73 — additional filters surfaced by 100-card pilot:
    //   - DFC/MDFC/Transform cards (AlternateMode:) often have face-specific
    //     timing the setup path doesn't replicate cleanly.
    //   - Lands with ETB triggers (Abraded Bluffs deals 1 damage to opp) —
    //     bridge AI doesn't always pick the trigger's target during setup
    //     drain-stack, leaving a TS-only damage emission.
    //   - Flash creatures with alternate-cost transforms (Aang) auto-trigger
    //     SetState in Forge's AI, tapping creatures pre-action.
    const hasAlternateMode = lines.some((l) => l.startsWith("AlternateMode:"));
    const isLand = /\bLand\b/.test(t);
    const hasSelfEtbTrigger = lines.some((l) =>
      l.startsWith("T:") && l.includes("ChangesZone") && l.includes("Battlefield") && l.includes("Card.Self"),
    );
    const hasFlash = lines.some((l) => l.startsWith("K:Flash"));
    const hasSetStateAbility = lines.some((l) =>
      l.startsWith("A:") && l.includes("SP$ SetState") || l.includes("AB$ SetState"),
    );
    // Avatar TLA effects (Airbend/Earthbend/Waterbend/Firebend) and other
    // niche Forge effects the TS engine treats as no-ops, leading to
    // auto-tap fallback paths that don't match Forge.
    const usesNicheEffect = lines.some((l) =>
      /\bDB\$ (Airbend|Earthbend|Waterbend|Firebend|Mutate|Companion)/.test(l),
    );
    const inHandOnly =
      isAura ||
      isSaga ||
      isVehicle ||
      isBattle ||
      hasEtbCounter ||
      hasAlternateMode ||
      (isLand && hasSelfEtbTrigger) ||
      (hasFlash && hasSetStateAbility) ||
      usesNicheEffect;
    uncovered.push({ name: nm, script: txt, types: typesLine, inHandOnly });
    if (uncovered.length >= count) break outer;
  }
}

console.error(`Generating ${uncovered.length} corpus scenarios with tag '${wave}'...`);

// 3) Emit TS scenario entries.
function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
function escape(s) {
  return s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
}

let seed = 0xf000;
let out = "";
for (const card of uncovered) {
  const t = card.types;
  const isPermanent =
    !card.inHandOnly && /\b(Creature|Artifact|Enchantment|Land|Planeswalker)\b/.test(t);
  const id = `${slug(card.name)}-corpus-${wave}`;
  const desc = `M6 corpus — ${card.name}; ${isPermanent ? "ETB-on-bf" : "in-hand parse"}.`;
  if (isPermanent) {
    out += `  {\n`;
    out += `    id: "${id}",\n`;
    out += `    description: "${desc.replace(/"/g, '\\"')}",\n`;
    out += `    seed: 0x${seed.toString(16)},\n`;
    out += `    cards: { "${card.name}": \`${escape(card.script)}\` },\n`;
    out += `    players: [\n`;
    out += `      { life: 20, hand: [], battlefield: [{ card: "${card.name}" }] },\n`;
    out += `      { life: 20, hand: [], battlefield: [] },\n`;
    out += `    ],\n`;
    out += `    actions: [],\n`;
    out += `  },\n`;
  } else {
    out += `  {\n`;
    out += `    id: "${id}",\n`;
    out += `    description: "${desc.replace(/"/g, '\\"')}",\n`;
    out += `    seed: 0x${seed.toString(16)},\n`;
    out += `    cards: { "${card.name}": \`${escape(card.script)}\` },\n`;
    out += `    players: [\n`;
    out += `      { life: 20, hand: ["${card.name}"], battlefield: [] },\n`;
    out += `      { life: 20, hand: [], battlefield: [] },\n`;
    out += `    ],\n`;
    out += `    actions: [],\n`;
    out += `  },\n`;
  }
  seed++;
}
process.stdout.write(out);
console.error(`Done. Emitted ${uncovered.length} scenarios.`);

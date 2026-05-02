#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
//
// M6.14 — Convert in-hand cohort scenarios from parse-only (empty actions)
// to action-driven (cast or etb action).
//
// Strategy:
//   - Find each scenario block that ends in `actions: [],`.
//   - Parse out the card name(s), type(s), and mana cost from inline source.
//   - For permanents (Creature/Artifact/Enchantment/Planeswalker/Land) that
//     are NOT Aura keyword (which needs a target), inject an ETB action.
//   - For Instant/Sorcery that have NO `ValidTgts` (no target needed) and
//     are NOT X-cost ($X without a default), inject a cast action.
//   - Skip targeted spells (need scenario-level target hints).
//   - Skip activated-only / pre-cast (Foretell/Suspend/Bestow needing K
//     mode to drive specific path).
//
// Output: rewrites scenarios.ts in place. Also dumps a JSON manifest of
// {converted, skipped, reason}.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../../..");
const scenariosPath = resolve(repoRoot, "packages/game/test/golden/scenarios.ts");

const src = readFileSync(scenariosPath, "utf8");

// Build a registry of top-of-file `const xxxSrc = \`...\`` definitions.
// These are referenced by scenarios that use `cards: { "Name": xxxSrc }`.
const constSources = new Map(); // const name → source content
{
  const constRegex = /^const (\w+) = `([\s\S]*?)`;$/gm;
  let m;
  while ((m = constRegex.exec(src)) !== null) {
    constSources.set(m[1], m[2]);
  }
}

// Find each scenario block with `actions: [],`. We rely on a stable
// formatting: the scenario block starts at "  {" and closes at "  },"
// at column 0 (relative to surrounding array).
//
// For this conversion we operate on blocks with id ending in "-in-hand".
//
// Anchor: search every line `    id: "<x>-in-hand",` and walk back to the
// opening "  {" and forward to the closing "  },".

const lines = src.split("\n");

// Build a list of scenario block ranges keyed by id.
const blocks = [];
{
  let openIdx = -1;
  let id = null;
  let descIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === "  {") {
      openIdx = i;
      id = null;
    }
    const idMatch = line.match(/^    id: "([^"]+)",$/);
    if (idMatch) id = idMatch[1];
    const descMatch = line.match(/^    description: "/);
    if (descMatch) descIdx = i;
    if (line === "  }," && openIdx !== -1 && id !== null) {
      blocks.push({ id, openIdx, closeIdx: i, descIdx });
      openIdx = -1;
      id = null;
      descIdx = -1;
    }
  }
}

// Helper — take the slice of `lines` for a block.
function blockText(b) {
  return lines.slice(b.openIdx, b.closeIdx + 1).join("\n");
}

// Detect "actions: [],"
function isEmptyActions(b) {
  return blockText(b).includes("actions: [],");
}

// Pull cards block + figure out the card (and full source).
//  - We want primary card = first hand card (the one being acted on).
//  - We need its type line and mana cost.
function parseScenario(b) {
  const txt = blockText(b);

  // hand: ["X", "Y"] — we want the first.
  const handMatch = txt.match(/hand: \["([^"]+)"/);
  if (!handMatch) return null;
  const handCard = handMatch[1];

  // Detect manaPool presence (any non-empty)
  const hasManaPool = /manaPool: \[[^\]]+\]/.test(txt);

  // Find the card source. It's either inline (`"X": \``) or a reference
  // (`"X": somethingSrc`). For inline, find the source between backticks.
  // Source lookup: we look at "cards: {...}" containing "X": `...`
  // For our purposes we need: type line, ValidTgts presence, ManaCost,
  // K: line for Aura/Bestow, A:AB$ presence (activated only?).
  //
  // Try inline first.
  const escName = handCard.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Card key in object literal can be quoted ("Card Name") or bare (SingleWord).
  // Try inline-with-quotes, inline-bare, ref-with-quotes, ref-bare.
  const inlineQuoted = new RegExp(`"${escName}": \`([\\s\\S]*?)\``, "m");
  const inlineBare = new RegExp(`(?:^|[\\s,{])${escName}: \`([\\s\\S]*?)\``, "m");
  const refQuoted = new RegExp(`"${escName}": (\\w+)\\s*[,}]`);
  const refBare = new RegExp(`(?:^|[\\s,{])${escName}: (\\w+)\\s*[,}]`);
  let cardSrc = null;
  let m2 = txt.match(inlineQuoted);
  if (m2) cardSrc = m2[1];
  if (!cardSrc) {
    m2 = txt.match(inlineBare);
    if (m2) cardSrc = m2[1];
  }
  if (!cardSrc) {
    m2 = txt.match(refQuoted);
    if (m2) cardSrc = constSources.get(m2[1]) ?? null;
  }
  if (!cardSrc) {
    m2 = txt.match(refBare);
    if (m2) cardSrc = constSources.get(m2[1]) ?? null;
  }

  if (!cardSrc) return { handCard, cardSrc: null, hasManaPool };

  const typeLineMatch = cardSrc.match(/^Types:(.+)$/m);
  const typeLine = typeLineMatch ? typeLineMatch[1].trim() : "";
  const types = typeLine.split(/\s+/);

  return {
    handCard,
    cardSrc,
    hasManaPool,
    types,
    typeLine,
    isPermanent: /Creature|Artifact|Enchantment|Planeswalker|Land|Battle/.test(typeLine),
    isInstantSorcery: /Instant|Sorcery/.test(typeLine),
    isAura: /Aura/.test(typeLine),
    isLand: /Land/.test(typeLine),
    hasValidTgts: /ValidTgts\$/.test(cardSrc),
    hasXCost: /^ManaCost:.*\bX\b/m.test(cardSrc),
    hasFlash: /\bK:Flash\b/.test(cardSrc),
    hasSuspend: /\bK:Suspend\b/.test(cardSrc),
    hasForetell: /\bK:Foretell\b/.test(cardSrc),
    hasBestow: /\bK:Bestow\b/.test(cardSrc),
    hasMorph: /\bK:Morph\b|\bK:Disguise\b/.test(cardSrc),
    hasMDFC: /\bAlternateMode:Modal\b|\bAlternateMode:DoubleFaced\b/.test(cardSrc),
  };
}

// Decide action(s) to inject. Returns string lines (without trailing
// newline) for the "actions:" replacement, or null to skip.
function decideAction(parsed) {
  if (!parsed || !parsed.cardSrc) return null;

  // Skip Aura — needs target.
  if (parsed.isAura) return { skip: "aura-needs-target" };

  // Skip if instant/sorcery with ValidTgts (target required).
  if (parsed.isInstantSorcery && parsed.hasValidTgts) return { skip: "spell-needs-target" };

  // Skip if X-cost (X resolution path requires explicit X).
  if (parsed.hasXCost) return { skip: "x-cost" };

  // Skip MDFC.
  if (parsed.hasMDFC) return { skip: "mdfc" };

  // Skip Suspend/Foretell/Morph since their normal cast is alt-cast and
  // the in-hand scenario likely intended the alt-cast path. Out of scope.
  if (parsed.hasSuspend || parsed.hasForetell || parsed.hasMorph) {
    return { skip: "alt-cast-keyword" };
  }

  // Skip Bestow (needs target as Aura).
  if (parsed.hasBestow) return { skip: "bestow-needs-target" };

  // Lands cannot be cast; they have no mana cost and become permanents
  // via the play-land action. Inject ETB to drive ETB triggers.
  if (parsed.isLand) {
    return { kind: "etb" };
  }

  // Permanents (no target requirement) → ETB.
  if (parsed.isPermanent && !parsed.isInstantSorcery) {
    return { kind: "etb" };
  }

  // Instants/Sorceries with no targets → cast (and resolveTopOfStack
  // is now driven by drainStack, so just one action).
  if (parsed.isInstantSorcery) {
    if (!parsed.hasManaPool) return { skip: "no-mana-pool" };
    return { kind: "cast" };
  }

  return { skip: "unknown-pattern" };
}

let converted = 0;
const skipReasons = {};
const skipped = [];
const convertedIds = [];

// Process in reverse so line indexes stay valid.
const inHandBlocks = blocks.filter((b) => b.id.endsWith("-in-hand") && isEmptyActions(b));

console.log(`Found ${inHandBlocks.length} in-hand blocks with empty actions.`);

for (let bi = inHandBlocks.length - 1; bi >= 0; bi--) {
  const b = inHandBlocks[bi];
  const parsed = parseScenario(b);
  const decision = decideAction(parsed);
  if (!decision || decision.skip) {
    const reason = decision?.skip ?? "no-cardsrc";
    skipReasons[reason] = (skipReasons[reason] ?? 0) + 1;
    skipped.push({ id: b.id, reason });
    continue;
  }

  // Build replacement actions line.
  let newActionsLine;
  if (decision.kind === "etb") {
    newActionsLine = `    actions: [{ kind: "etb", cardName: "${parsed.handCard}", controller: SEAT0 }],`;
  } else if (decision.kind === "cast") {
    newActionsLine = `    actions: [{ kind: "cast", cardName: "${parsed.handCard}", castingPlayer: SEAT0 }],`;
  } else {
    continue;
  }

  // Find the actions line (within the block) and replace.
  for (let i = b.openIdx; i <= b.closeIdx; i++) {
    if (lines[i] === "    actions: [],") {
      lines[i] = newActionsLine;
      converted++;
      convertedIds.push(b.id);
      break;
    }
  }
}

// Write back.
writeFileSync(scenariosPath, lines.join("\n"));

console.log(`Converted: ${converted}`);
console.log(`Skipped:`);
for (const [reason, count] of Object.entries(skipReasons)) {
  console.log(`  ${reason}: ${count}`);
}

// Also dump manifest.
const manifestPath = resolve(__dirname, "..", "convert-in-hand-manifest.json");
writeFileSync(
  manifestPath,
  JSON.stringify({ converted: convertedIds, skipped, skipCounts: skipReasons }, null, 2),
);
console.log(`Manifest: ${manifestPath}`);

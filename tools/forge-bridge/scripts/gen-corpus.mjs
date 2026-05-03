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
      const base = name
        .replace(/\s+M6\d+(\s+M6\d+)?$/i, "")
        .replace(/\s+v\d$/i, "")
        .trim();
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
    const hasEtbCounter = lines.some((l) => l.startsWith("K:etbCounter") || l.startsWith("K:ETBReplacement"));
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
    const hasSelfEtbTrigger = lines.some(
      (l) =>
        l.startsWith("T:") &&
        l.includes("ChangesZone") &&
        l.includes("Battlefield") &&
        l.includes("Card.Self"),
    );
    const hasFlash = lines.some((l) => l.startsWith("K:Flash"));
    const hasSetStateAbility = lines.some(
      (l) => (l.startsWith("A:") && l.includes("SP$ SetState")) || l.includes("AB$ SetState"),
    );
    // Avatar TLA effects (Airbend/Earthbend/Waterbend/Firebend) and other
    // niche Forge effects the TS engine treats as no-ops, leading to
    // auto-tap fallback paths that don't match Forge.
    const usesNicheEffect = lines.some((l) =>
      /\bDB\$ (Airbend|Earthbend|Waterbend|Firebend|Mutate|Companion|Emerge)/.test(l),
    );
    // Cards whose any cost reference is an alternate-cost expression
    // (Discard<X/Creature/creature(s)>, tapXType<...>, Sac<...>) — Forge
    // treats these as alternate costs but our parser hits them as mana
    // symbols. Check ANY line for these patterns since they appear in
    // S$ RaiseCost / SP$ / AB$ Cost$ fields, not just ManaCost:.
    const hasAltCostInManaCost = lines.some(
      (l) =>
        // ANY <Foo/...> pattern in a Cost$ field — sacrifice, tap, exile,
        // discard, addCounter, behold, choose, etc.
        /Cost\$[^|]*\b\w+</.test(l) || /ManaCost:.*<[^>]*\/[^>]*>/.test(l),
    );
    // Cards that reference AI-only Count$ selectors we don't yet support.
    const usesUnsupportedCount = lines.some(
      (l) =>
        l.includes("Count$") &&
        /Count\$Emerged|Count\$Imprinted\.|Count\$Reveal|Count\$Party|Count\$MostProminent/.test(l),
    );
    // SVar referenced as a trigger Execute that resolves to AB$ (activated
    // ability) — TS only supports DB$ in trigger execute resolution. Forge
    // uses AB$ for "may sacrifice an artifact, if you do, draw a card"
    // patterns (Benthic Criminologists). Skip until TS supports AB$ as
    // trigger execute.
    const triggerExecutesActivated = lines.some((line) => {
      const m = /Execute\$\s+(\w+)/.exec(line);
      if (!m) return false;
      const svarName = m[1];
      return lines.some((l2) => l2.startsWith(`SVar:${svarName}:AB$`));
    });
    // Mana cost or Cost$ uses Avatar mechanics (Waterbend<N>, Earthbend<N>,
    // Airbend<N>, Firebend<N>) which embed alt-cost in the mana cost slot.
    const usesAvatarMechanics = lines.some((l) =>
      /(?:ManaCost:|Cost\$).*\b(?:Waterbend|Earthbend|Airbend|Firebend)</.test(l),
    );
    // SVar with literal "Any" in a numeric param context — TS evaluator
    // throws when reducing 'Any' to a number. Most "Any" appearances are
    // legitimate (ValidTgts$ Any, Produced$ Any, Destination$ Any, etc.).
    // Narrow the filter to ONLY numeric params: Num*, *Amount, X.
    const hasAnyAsNumber = lines.some((l) =>
      /^SVar:[^:]+:.*\b(NumDmg|NumAtt|NumDef|NumCards|Amount|LifeAmount|CounterNum|TokenAmount|XValue)\$\s*Any\b/.test(l),
    );
    // Tokens that don't follow the standard `<color>_<P>_<T>_<subtype>...`
    // naming (e.g. "sword", "beau", "c_a_lander_sac_search") — synthesize
    // fallback can't infer their PT/subtype so we skip the cards using them.
    const hasExoticToken = lines.some(
      (l) =>
        l.includes("TokenScript$") &&
        /TokenScript\$\s+(?!(?:[wubrgcm]+_(?:\d+|x)_(?:\d+|x))[\w_]*)[a-z][a-z_]*/i.test(l),
    );
    // SVar selectors not yet supported by the TS evaluator.
    const usesUnsupportedSVar = lines.some(
      (l) =>
        l.startsWith("SVar:") &&
        /\b(PlayerCountPlayers|TriggeredCard|TriggeredAttacker|TriggeredBlocker|TriggeredSourceSA|TriggeredCardController)\b/.test(
          l,
        ),
    );
    // S:Mode$ Continuous with AddTrigger$/AddSVar$ — conditionally adds a
    // trigger to the card. Resolution differs between engines because the
    // bridge AI may activate the granted trigger immediately.
    const addsConditionalTrigger = lines.some((l) => l.startsWith("S:") && /\bAddTrigger\$/.test(l));
    // Cards with ETB triggers that put counters somewhere — bridge captures
    // CounterAdded events but the TS engine emits it for K:etbCounter only,
    // not for trigger-driven PutCounter via DB$ PutCounter. Until parity
    // tightens at the emission level, exclude these from corpus expansion.
    const hasPutCounterInTrigger = lines.some(
      (l) => l.startsWith("SVar:") && /\bDB\$ PutCounter\b|\bAB\$ PutCounter\b/.test(l),
    );
    // Cards using mechanic-specific events the bridge doesn't subscribe to
    // (Clash, Roll-a-die, Investigate, Suspect, GainControl) — TS emits
    // these as discrete events; bridge's @Subscribe set is conservative.
    const usesUnsubscribedEvent = lines.some((l) =>
      /\b(DB|AB|SP)\$ (Clash|RollDice|RollPlanarDice|Investigate|Suspect|GainControl|Branch)\b/.test(l),
    );
    // K:Offspring — trigger fires-on-other-ETB, complicates TS auto-fan-out.
    const hasOffspring = lines.some((l) => l.startsWith("K:Offspring"));
    // Mechanics whose ETB fan-out doesn't match between engines:
    //   - Fabricate puts counter or creates token (TS chooses one path, Java another)
    //   - Partner with triggers a search/library reveal on ETB
    //   - Doctor's companion is a partner variant
    //   - Venture/Dungeon mechanics — TS may not fully implement
    const hasComplexMechanic = lines.some(
      (l) =>
        l.startsWith("K:Fabricate") ||
        l.startsWith("K:Partner with") ||
        l.startsWith("K:Doctor's companion") ||
        l.startsWith("K:Friends forever") ||
        l.startsWith("K:Modular") ||
        l.startsWith("K:Riot") ||
        l.startsWith("K:Backup") ||
        l.startsWith("K:Job select") ||
        l.startsWith("K:Mutate") ||
        l.startsWith("K:Disturb") ||
        l.startsWith("K:Eternalize") ||
        l.startsWith("K:Embalm") ||
        l.startsWith("K:Living Weapon") ||
        l.startsWith("K:Reinforce") ||
        l.startsWith("K:Champion") ||
        l.startsWith("K:Devour") ||
        l.startsWith("K:Soulshift") ||
        l.startsWith("K:Squad") ||
        l.startsWith("K:Unearth") ||
        l.startsWith("K:Amplify") ||
        l.startsWith("K:Annihilator") ||
        l.startsWith("K:Bloodthirst") ||
        l.startsWith("K:Cumulative Upkeep") ||
        l.startsWith("K:Dethrone") ||
        l.startsWith("K:Echo") ||
        l.startsWith("K:Evoke") ||
        l.startsWith("K:Exalted") ||
        l.startsWith("K:Fading") ||
        l.startsWith("K:Vanishing") ||
        l.startsWith("K:Persist") ||
        l.startsWith("K:Undying") ||
        l.startsWith("K:Wither") ||
        l.startsWith("K:Haunt") ||
        l.startsWith("K:For Mirrodin") ||
        l.startsWith("K:Reconfigure") ||
        l.startsWith("K:Suspect") ||
        l.startsWith("K:Disturb") ||
        l.startsWith("K:Friends forever") ||
        l.startsWith("K:Adapt") ||
        l.startsWith("K:Monstrosity") ||
        l.startsWith("K:Unleash") ||
        l.startsWith("K:Exploit") ||
        l.startsWith("K:Devour") ||
        l.startsWith("K:Bestow") ||
        l.startsWith("K:Outlast") ||
        l.startsWith("K:Surge") ||
        l.startsWith("K:Recover") ||
        l.startsWith("K:Reinforce") ||
        l.startsWith("K:Renown") ||
        l.startsWith("K:Awaken") ||
        l.startsWith("K:Bolster") ||
        l.startsWith("K:Manifest") ||
        l.startsWith("K:Megamorph") ||
        l.startsWith("K:Tribute") ||
        l.startsWith("K:Improvise") ||
        l.startsWith("K:Convoke") ||
        l.startsWith("K:Delve") ||
        l.startsWith("K:Encore") ||
        l.startsWith("K:Casualty") ||
        l.startsWith("K:Buyback") ||
        l.startsWith("K:Spree") ||
        l.startsWith("K:Warp") ||
        l.startsWith("K:Plot") ||
        /\bDB\$ Venture\b/.test(l) ||
        l.startsWith("K:Venture"),
    );
    // ImmediateTrigger / ImmediateAbility — chained "When you do" triggers
    // that fire on action completion. TS engine doesn't yet handle this.
    const hasImmediateTrigger = lines.some((l) => /\b(AB|DB|SP)\$ ImmediateTrigger\b/.test(l));
    // ETB triggers requiring AI to pick a target (Opponent/Player/Creature)
    // diverge between bridge AI and TS RandomLegalController. Filter when
    // the card has a self-ETB trigger AND its referenced SVar uses ValidTgts$.
    const hasEtbTriggerWithTargetedPlayer = lines.some(
      (l) =>
        l.startsWith("SVar:") &&
        /\b(DB|AB)\$ (Discard|Mill|Search|DealDamage|GainLife|LoseLife|ChooseCard|ChoosePlayer)\b/.test(l) &&
        /ValidTgts\$ (Opponent|Player|Creature)/.test(l),
    );
    // Cards whose ETB triggers require choosePlayer / chooseCard with min>0
    // and the bridge AI / TS RandomLegalController doesn't have a default —
    // surfaces e.g. Akroan Horse "control of CARDNAME goes to opponent on ETB".
    const usesChoosePlayer = lines.some(
      (l) =>
        l.includes("ChoosePlayer$") ||
        l.includes("DefinedPlayer$ Choose") ||
        /\bDB\$ ChoosePlayer/.test(l) ||
        /\bSP\$ ChoosePlayer/.test(l),
    );
    // M6.78 — Distinguish "hard-skip" (card script can't be parsed at all)
    // from "soft-skip" (parse OK but ETB/cast scenario diverges → use
    // in-hand instead). The hasComplexMechanic / hasOffspring / hasFlash+
    // SetState families are soft-skip: the parser handles them, only the
    // ETB resolution diverges.
    // Hard-skip = parser/loader cannot handle the card script at all.
    // Soft-skip (in-hand-only) = parser handles it but ETB/cast diverges.
    // True hard-skips: parser/loader fails outright on the card script.
    // M6.82 — alt-cost in Cost$ fields no longer fails parser since
    // RaiseCost/ReduceCost gracefully ignore non-mana-pip Cost$ values.
    // Move to soft-skip (in-hand only) below.
    const manaCostHasAltCost = lines.some(
      (l) => l.startsWith("ManaCost:") && /<[^>]*\/[^>]*>/.test(l),
    );
    const skip = manaCostHasAltCost;
    if (skip) continue;
    const inHandOnly =
      isAura ||
      isSaga ||
      isVehicle ||
      isBattle ||
      hasEtbCounter ||
      hasAlternateMode ||
      (isLand && hasSelfEtbTrigger) ||
      (hasFlash && hasSetStateAbility) ||
      usesNicheEffect ||
      usesChoosePlayer ||
      hasComplexMechanic ||
      hasOffspring ||
      hasAltCostInManaCost ||
      usesAvatarMechanics ||
      hasAnyAsNumber ||
      hasExoticToken ||
      usesUnsupportedCount ||
      hasPutCounterInTrigger ||
      usesUnsubscribedEvent ||
      hasEtbTriggerWithTargetedPlayer ||
      hasImmediateTrigger ||
      triggerExecutesActivated ||
      usesUnsupportedSVar ||
      addsConditionalTrigger;
    uncovered.push({ name: nm, script: txt, types: typesLine, inHandOnly });
    if (uncovered.length >= count) break outer;
  }
}

console.error(`Generating ${uncovered.length} corpus scenarios with tag '${wave}'...`);

// 3) Emit TS scenario entries.
function slug(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
function escapeBackticks(s) {
  return s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
}

let seed = 0xf000;
let out = "";
for (const card of uncovered) {
  const t = card.types;
  // M6.75 — Default permanents-with-any-ETB-trigger to in-hand only. The
  // ETB-on-bf scenario surfaces fan-out + counter divergences both engines
  // are still aligning. Pure-vanilla permanents (no Card.Self ETB trigger)
  // still go to ETB.
  const hasAnyEtbTrigger = card.script.split("\n").some(
    (l) =>
      l.startsWith("T:") &&
      // Any ChangesZone-to-Battlefield trigger (self or other-card),
      // ChangesZoneAll (when other cards enter), Mode$ Always (state-
      // based passive trigger), Eerie (TriggerZones$ Graveyard variants),
      // or any FullyUnlock / Exploited / DamageDone trigger surfaces
      // engine-divergent fan-out paths in the simple ETB scenario.
      ((l.includes("ChangesZone") && l.includes("Battlefield")) ||
        l.includes("Mode$ Always") ||
        l.includes("Mode$ FullyUnlock") ||
        l.includes("Mode$ Exploited") ||
        l.includes("Mode$ DamageDone") ||
        l.includes("Mode$ BecomesTarget") ||
        l.includes("Mode$ Attacks") ||
        l.includes("Mode$ Phase") ||
        l.includes("Mode$ ChangesZoneAll")),
  );
  const isPermanent =
    !card.inHandOnly && !hasAnyEtbTrigger && /\b(Creature|Artifact|Enchantment|Land|Planeswalker)\b/.test(t);
  const id = `${slug(card.name)}-corpus-${wave}`;
  const desc = `M6 corpus — ${card.name}; ${isPermanent ? "ETB-on-bf" : "in-hand parse"}.`;
  const nameJson = JSON.stringify(card.name);
  const scriptLit = `\`${escapeBackticks(card.script)}\``;
  const descEsc = desc.replace(/"/g, '\\"');
  if (isPermanent) {
    out += "  {\n";
    out += `    id: "${id}",\n`;
    out += `    description: "${descEsc}",\n`;
    out += `    seed: 0x${seed.toString(16)},\n`;
    out += `    cards: { ${nameJson}: ${scriptLit} },\n`;
    out += "    players: [\n";
    out += `      { life: 20, hand: [], battlefield: [{ card: ${nameJson} }] },\n`;
    out += "      { life: 20, hand: [], battlefield: [] },\n";
    out += "    ],\n";
    out += "    actions: [],\n";
    out += "  },\n";
  } else {
    out += "  {\n";
    out += `    id: "${id}",\n`;
    out += `    description: "${descEsc}",\n`;
    out += `    seed: 0x${seed.toString(16)},\n`;
    out += `    cards: { ${nameJson}: ${scriptLit} },\n`;
    out += "    players: [\n";
    out += `      { life: 20, hand: [${nameJson}], battlefield: [] },\n`;
    out += "      { life: 20, hand: [], battlefield: [] },\n";
    out += "    ],\n";
    out += "    actions: [],\n";
    out += "  },\n";
  }
  seed++;
}
process.stdout.write(out);
console.error(`Done. Emitted ${uncovered.length} scenarios.`);

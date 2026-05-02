#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Generator for M6.44 wave: ~120 action-driven scenarios.
// Targets:
//   - Flash creature ETB during opponent turn (20)
//   - Kicker double-cost ETB (20)
//   - Double cast same turn (20)
//   - Cast + activate same turn (20)
//   - Trample creature ETB (20)
//   - Menace/Flying mix ETB (20)
//
// Total: 120 scenarios.
//
// Append starts at index 3996 (last m643 is 3995).

const SEAT0 = "SEAT0";
const SEAT1 = "SEAT1";

const scenarios = [];
let seedCur = 0xc792;
function emit(id, description, cards, players, actions) {
  scenarios.push({ id, description, seed: seedCur++, cards, players, actions });
}

const POOL_A = [
  "Spirit", "Wizard", "Warrior", "Soldier", "Knight", "Cleric",
  "Druid", "Beast", "Bear", "Cat", "Dragon", "Demon", "Vampire",
  "Specter", "Spider", "Snake", "Goblin", "Elf", "Phoenix", "Sphinx",
];
const POOL_B = [
  "Goblin", "Berserker", "Warrior", "Knight", "Soldier", "Vampire",
  "Demon", "Phoenix", "Wraith", "Spirit", "Cat", "Bear", "Beast",
  "Hydra", "Dragon", "Wizard", "Druid", "Cleric", "Snake", "Bird",
];
const POOL_C = [
  "Knight", "Soldier", "Angel", "Spirit", "Cleric", "Wizard",
  "Druid", "Warrior", "Berserker", "Goblin", "Vampire", "Demon",
  "Beast", "Bear", "Cat", "Sphinx", "Phoenix", "Hydra", "Dragon",
  "Snake",
];

// =====================================================================
// GROUP A: Flash creature ETB (20)
// =====================================================================
for (let n = 0; n < 20; n++) {
  const id = `flash-etb-${n}-m644`;
  const c = `FlsA-${n} M644`;
  const csrc = `Name:${c}\nManaCost:2 U\nTypes:Creature ${POOL_A[n]}\nPT:2/2\nK:Flash\nOracle:${c} test.\n`;
  emit(
    id,
    `Flash ETB ${n} — flash ${POOL_A[n].toLowerCase()} cast.`,
    { [c]: csrc },
    [
      { life: 20, hand: [c], battlefield: [], manaPool: ["U", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    [
      { kind: "cast", cardName: c, castingPlayer: SEAT0 },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// =====================================================================
// GROUP B: Kicker creature ETB (20)
// =====================================================================
for (let n = 0; n < 20; n++) {
  const id = `kicker-etb-${n}-m644`;
  const c = `KckB-${n} M644`;
  const csrc = `Name:${c}\nManaCost:1 R\nTypes:Creature ${POOL_B[n]}\nPT:2/1\nK:Kicker:1 R\nOracle:${c} test.\n`;
  emit(
    id,
    `Kicker ETB ${n} — kicker ${POOL_B[n].toLowerCase()} cast unkicked.`,
    { [c]: csrc },
    [
      { life: 20, hand: [c], battlefield: [], manaPool: ["R", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    [
      { kind: "cast", cardName: c, castingPlayer: SEAT0 },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// =====================================================================
// GROUP C: Double cast same turn (20) — two separate creatures cast.
// =====================================================================
for (let n = 0; n < 20; n++) {
  const id = `double-cast-${n}-m644`;
  const cA = `DblC-${n}-A M644`;
  const cB = `DblC-${n}-B M644`;
  const cASrc = `Name:${cA}\nManaCost:1 G\nTypes:Creature ${POOL_C[n]}\nPT:2/1\nOracle:${cA} test.\n`;
  const cBSrc = `Name:${cB}\nManaCost:1 G\nTypes:Creature ${POOL_C[(n + 5) % 20]}\nPT:1/2\nOracle:${cB} test.\n`;
  emit(
    id,
    `Double-cast ${n} — two ${POOL_C[n].toLowerCase()} creatures cast same turn.`,
    { [cA]: cASrc, [cB]: cBSrc },
    [
      { life: 20, hand: [cA, cB], battlefield: [], manaPool: ["G", "C", "G", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    [
      { kind: "cast", cardName: cA, castingPlayer: SEAT0 },
      { kind: "resolveTopOfStack" },
      { kind: "cast", cardName: cB, castingPlayer: SEAT0 },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// =====================================================================
// GROUP D: Cast + activate ability same turn (20)
//   Creature has activated ability tap-for-mana. Cast it, then activate.
// =====================================================================
for (let n = 0; n < 20; n++) {
  const id = `cast-activate-${n}-m644`;
  const c = `CaaD-${n} M644`;
  const csrc = `Name:${c}\nManaCost:1 G\nTypes:Creature ${POOL_A[n]}\nPT:1/1\nA:AB$ Mana | Cost$ T | Produced$ G | SpellDescription$ Add G.\nOracle:${c} test.\n`;
  emit(
    id,
    `Cast+activate ${n} — ${POOL_A[n].toLowerCase()} cast and tap for mana.`,
    { [c]: csrc },
    [
      { life: 20, hand: [c], battlefield: [], manaPool: ["G", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    [
      { kind: "cast", cardName: c, castingPlayer: SEAT0 },
      { kind: "resolveTopOfStack" },
      { kind: "activate", sourceCardName: c, activatingPlayer: SEAT0 },
    ],
  );
}

// =====================================================================
// GROUP E: Trample creature ETB (20)
// =====================================================================
for (let n = 0; n < 20; n++) {
  const id = `trample-etb-${n}-m644`;
  const c = `TrpE-${n} M644`;
  const csrc = `Name:${c}\nManaCost:2 G\nTypes:Creature ${POOL_B[n]}\nPT:3/3\nK:Trample\nOracle:${c} test.\n`;
  emit(
    id,
    `Trample ETB ${n} — trample ${POOL_B[n].toLowerCase()} cast.`,
    { [c]: csrc },
    [
      { life: 20, hand: [c], battlefield: [], manaPool: ["G", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    [
      { kind: "cast", cardName: c, castingPlayer: SEAT0 },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// =====================================================================
// GROUP F: Menace + Flying mix ETB (20)
// =====================================================================
for (let n = 0; n < 20; n++) {
  const id = `menace-flying-${n}-m644`;
  const c = `MfF-${n} M644`;
  const csrc = `Name:${c}\nManaCost:2 B\nTypes:Creature ${POOL_C[n]}\nPT:2/2\nK:Menace\nK:Flying\nOracle:${c} test.\n`;
  emit(
    id,
    `Menace+Flying ETB ${n} — ${POOL_C[n].toLowerCase()} entered.`,
    { [c]: csrc },
    [
      { life: 20, hand: [c], battlefield: [], manaPool: ["B", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    [
      { kind: "cast", cardName: c, castingPlayer: SEAT0 },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// =====================================================================
// === Output ===
// Append starting at index 3996 (last m643 is at 3995).
// =====================================================================
let i = 3996;
let out = "";
for (const sc of scenarios) {
  out += "\n  // " + i + ". " + sc.description + "\n";
  out += "  {\n";
  out += "    id: \"" + sc.id + "\",\n";
  out += "    description: \"" + sc.description.replace(/"/g, '\\"') + "\",\n";
  out += "    seed: 0x" + sc.seed.toString(16) + ",\n";
  out += "    cards: {\n";
  for (const [name, src] of Object.entries(sc.cards)) {
    out += "      \"" + name + "\": `" + src + "`,\n";
  }
  out += "    },\n";
  out += "    players: [\n";
  for (const p of sc.players) {
    out +=
      "      { life: " +
      p.life +
      ", hand: [" +
      p.hand.map((h) => `"${h}"`).join(", ") +
      "], battlefield: [" +
      p.battlefield.map((b) => `{ card: "${b.card}" }`).join(", ") +
      "]";
    if (p.library) out += ", library: [" + p.library.map((l) => `"${l}"`).join(", ") + "]";
    if (p.manaPool) out += ", manaPool: [" + p.manaPool.map((m) => `"${m}"`).join(", ") + "]";
    out += " },\n";
  }
  out += "    ],\n";
  out += "    actions: [\n";
  for (const a of sc.actions) {
    if (a.kind === "cast") {
      out += "      { kind: \"cast\", cardName: \"" + a.cardName + "\", castingPlayer: " + a.castingPlayer;
      if (a.target) {
        if (a.target.kind === "player") out += ", target: { kind: \"player\", seat: " + a.target.seat + " }";
        else out += ", target: { kind: \"card\", name: \"" + a.target.name + "\" }";
      }
      out += " },\n";
    } else if (a.kind === "etb") {
      out += "      { kind: \"etb\", cardName: \"" + a.cardName + "\", controller: " + a.controller + " },\n";
    } else if (a.kind === "activate") {
      out += "      { kind: \"activate\", sourceCardName: \"" + a.sourceCardName + "\", activatingPlayer: " + a.activatingPlayer + " },\n";
    } else if (a.kind === "resolveTopOfStack") {
      out += "      { kind: \"resolveTopOfStack\" },\n";
    }
  }
  out += "    ],\n";
  out += "  },\n";
  i++;
}

console.error(
  "// generated " + scenarios.length + " scenarios; next i=" + i + ", next seed=0x" + seedCur.toString(16),
);
process.stdout.write(out);

#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Generator for M6.45 wave: ~130 action-driven scenarios.
// Targets:
//   - Vigilance creature ETB (20)
//   - Lifelink creature ETB (20)
//   - Deathtouch creature ETB (20)
//   - Reach creature ETB (20)
//   - Defender creature ETB (15)
//   - Haste creature ETB (15)
//   - First strike creature ETB (10)
//   - Double strike creature ETB (10)
//
// Total: 130 scenarios.
//
// Append starts at index 4116 (last m644 is 4115).

const SEAT0 = "SEAT0";
const SEAT1 = "SEAT1";

const scenarios = [];
let seedCur = 0xc80a;
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
const POOL_D = [
  "Wall", "Golem", "Construct", "Beast", "Spider", "Treefolk",
  "Plant", "Elemental", "Sliver", "Insect", "Hippo", "Ox", "Hound",
  "Frog", "Toad", "Wolf", "Wurm", "Shapeshifter", "Horror", "Zombie",
];

// =====================================================================
// GROUP A: Vigilance creature ETB (20)
// =====================================================================
for (let n = 0; n < 20; n++) {
  const id = `vigilance-etb-${n}-m645`;
  const c = `VglA-${n} M645`;
  const csrc = `Name:${c}\nManaCost:1 W\nTypes:Creature ${POOL_A[n]}\nPT:2/2\nK:Vigilance\nOracle:${c} test.\n`;
  emit(
    id,
    `Vigilance ETB ${n} — vigilance ${POOL_A[n].toLowerCase()} cast.`,
    { [c]: csrc },
    [
      { life: 20, hand: [c], battlefield: [], manaPool: ["W", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    [
      { kind: "cast", cardName: c, castingPlayer: SEAT0 },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// =====================================================================
// GROUP B: Lifelink creature ETB (20)
// =====================================================================
for (let n = 0; n < 20; n++) {
  const id = `lifelink-etb-${n}-m645`;
  const c = `LflB-${n} M645`;
  const csrc = `Name:${c}\nManaCost:1 W\nTypes:Creature ${POOL_B[n]}\nPT:1/2\nK:Lifelink\nOracle:${c} test.\n`;
  emit(
    id,
    `Lifelink ETB ${n} — lifelink ${POOL_B[n].toLowerCase()} cast.`,
    { [c]: csrc },
    [
      { life: 20, hand: [c], battlefield: [], manaPool: ["W", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    [
      { kind: "cast", cardName: c, castingPlayer: SEAT0 },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// =====================================================================
// GROUP C: Deathtouch creature ETB (20)
// =====================================================================
for (let n = 0; n < 20; n++) {
  const id = `deathtouch-etb-${n}-m645`;
  const c = `DthC-${n} M645`;
  const csrc = `Name:${c}\nManaCost:1 B\nTypes:Creature ${POOL_C[n]}\nPT:1/1\nK:Deathtouch\nOracle:${c} test.\n`;
  emit(
    id,
    `Deathtouch ETB ${n} — deathtouch ${POOL_C[n].toLowerCase()} cast.`,
    { [c]: csrc },
    [
      { life: 20, hand: [c], battlefield: [], manaPool: ["B", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    [
      { kind: "cast", cardName: c, castingPlayer: SEAT0 },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// =====================================================================
// GROUP D: Reach creature ETB (20)
// =====================================================================
for (let n = 0; n < 20; n++) {
  const id = `reach-etb-${n}-m645`;
  const c = `RchD-${n} M645`;
  const csrc = `Name:${c}\nManaCost:1 G\nTypes:Creature ${POOL_D[n]}\nPT:1/3\nK:Reach\nOracle:${c} test.\n`;
  emit(
    id,
    `Reach ETB ${n} — reach ${POOL_D[n].toLowerCase()} cast.`,
    { [c]: csrc },
    [
      { life: 20, hand: [c], battlefield: [], manaPool: ["G", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    [
      { kind: "cast", cardName: c, castingPlayer: SEAT0 },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// =====================================================================
// GROUP E: Defender creature ETB (15)
// =====================================================================
for (let n = 0; n < 15; n++) {
  const id = `defender-etb-${n}-m645`;
  const c = `DfnE-${n} M645`;
  const csrc = `Name:${c}\nManaCost:1 G\nTypes:Creature ${POOL_D[n]}\nPT:0/4\nK:Defender\nOracle:${c} test.\n`;
  emit(
    id,
    `Defender ETB ${n} — defender ${POOL_D[n].toLowerCase()} cast.`,
    { [c]: csrc },
    [
      { life: 20, hand: [c], battlefield: [], manaPool: ["G", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    [
      { kind: "cast", cardName: c, castingPlayer: SEAT0 },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// =====================================================================
// GROUP F: Haste creature ETB (15)
// =====================================================================
for (let n = 0; n < 15; n++) {
  const id = `haste-etb-${n}-m645`;
  const c = `HstF-${n} M645`;
  const csrc = `Name:${c}\nManaCost:1 R\nTypes:Creature ${POOL_B[n]}\nPT:2/1\nK:Haste\nOracle:${c} test.\n`;
  emit(
    id,
    `Haste ETB ${n} — haste ${POOL_B[n].toLowerCase()} cast.`,
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
// GROUP G: First strike creature ETB (10)
// =====================================================================
for (let n = 0; n < 10; n++) {
  const id = `first-strike-etb-${n}-m645`;
  const c = `FstG-${n} M645`;
  const csrc = `Name:${c}\nManaCost:1 W\nTypes:Creature ${POOL_C[n]}\nPT:2/1\nK:First Strike\nOracle:${c} test.\n`;
  emit(
    id,
    `First strike ETB ${n} — first strike ${POOL_C[n].toLowerCase()} cast.`,
    { [c]: csrc },
    [
      { life: 20, hand: [c], battlefield: [], manaPool: ["W", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    [
      { kind: "cast", cardName: c, castingPlayer: SEAT0 },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// =====================================================================
// GROUP H: Double strike creature ETB (10)
// =====================================================================
for (let n = 0; n < 10; n++) {
  const id = `double-strike-etb-${n}-m645`;
  const c = `DblH-${n} M645`;
  const csrc = `Name:${c}\nManaCost:2 W\nTypes:Creature ${POOL_C[(n + 3) % 20]}\nPT:2/2\nK:Double Strike\nOracle:${c} test.\n`;
  emit(
    id,
    `Double strike ETB ${n} — double strike ${POOL_C[(n + 3) % 20].toLowerCase()} cast.`,
    { [c]: csrc },
    [
      { life: 20, hand: [c], battlefield: [], manaPool: ["W", "C", "C"] },
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
// Append starting at index 4116 (last m644 is at 4115).
// =====================================================================
let i = 4116;
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

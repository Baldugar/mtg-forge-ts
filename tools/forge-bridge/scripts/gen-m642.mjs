#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Generator for M6.42 wave: appends 180 deeper-coverage scenarios.
// Targets less-common keyword interactions and creature-type breadth.
//
// Targets (9 groups × 20):
//   - Deathtouch ETB across types (20)
//   - Haste ETB across types (20)
//   - Double-strike ETB across types (20)
//   - Protection from Red ETB across types (20)
//   - Skulk ETB across types (20)
//   - Annihilator 1 ETB across types (20)
//   - Soulbond ETB across types (20)
//   - Banding ETB across types (20)
//   - Soul Warden + creature cast F3 (20)

const SEAT0 = "SEAT0";
const SEAT1 = "SEAT1";

const scenarios = [];
let seedCur = 0xc648;
function emit(id, description, cards, players, actions) {
  scenarios.push({ id, description, seed: seedCur++, cards, players, actions });
}

// Global pool of subtypes — pick 20 distinct entries per group with variation.
const POOLA = [
  "Snake", "Vampire", "Spider", "Insect", "Rat", "Specter", "Wurm",
  "Demon", "Cat", "Hydra", "Beast", "Bear", "Zombie", "Dragon",
  "Spirit", "Wizard", "Druid", "Cleric", "Knight", "Soldier",
];
const POOLB = [
  "Goblin", "Berserker", "Warrior", "Soldier", "Knight", "Vampire",
  "Demon", "Phoenix", "Specter", "Spirit", "Cat", "Bear", "Beast",
  "Hydra", "Dragon", "Wizard", "Druid", "Cleric", "Snake", "Bird",
];
const POOLC = [
  "Knight", "Soldier", "Angel", "Spirit", "Cleric", "Wizard",
  "Druid", "Warrior", "Berserker", "Goblin", "Vampire", "Demon",
  "Beast", "Bear", "Cat", "Sphinx", "Phoenix", "Hydra", "Dragon",
  "Snake",
];
const POOLD = [
  "Knight", "Soldier", "Cleric", "Wizard", "Druid", "Spirit",
  "Angel", "Cat", "Beast", "Bear", "Centaur", "Treefolk", "Hydra",
  "Sphinx", "Phoenix", "Specter", "Dragon", "Demon", "Vampire",
  "Snake",
];
const POOLE = [
  "Rogue", "Spirit", "Wizard", "Druid", "Rat", "Snake", "Insect",
  "Bird", "Cat", "Bear", "Beast", "Goblin", "Elf", "Faerie",
  "Vampire", "Specter", "Wraith", "Dragon", "Demon", "Knight",
];
const POOLF = [
  "Eldrazi", "Demon", "Dragon", "Hydra", "Wurm", "Sphinx", "Beast",
  "Bear", "Spider", "Centaur", "Treefolk", "Phoenix", "Specter",
  "Knight", "Soldier", "Wizard", "Druid", "Cleric", "Snake", "Cat",
];
const POOLG = [
  "Wolf", "Cat", "Bear", "Druid", "Cleric", "Knight", "Soldier",
  "Wizard", "Spirit", "Beast", "Centaur", "Treefolk", "Snake",
  "Bird", "Insect", "Rat", "Sphinx", "Phoenix", "Dragon", "Hydra",
];
const POOLH = [
  "Soldier", "Knight", "Cleric", "Druid", "Wizard", "Beast", "Bear",
  "Cat", "Centaur", "Treefolk", "Spirit", "Sphinx", "Hydra",
  "Dragon", "Phoenix", "Demon", "Vampire", "Specter", "Snake",
  "Goblin",
];

// =====================================================================
// GROUP A: Deathtouch ETB across creature types (20)
// =====================================================================
for (let n = 0; n < 20; n++) {
  const id = `deathtouch-etb-${n}-m642`;
  const c = `DthA${n} M642`;
  const csrc = `Name:${c}\nManaCost:1 B\nTypes:Creature ${POOLA[n]}\nPT:1/1\nK:Deathtouch\nOracle:${c} test.\n`;
  emit(
    id,
    `Deathtouch ETB ${n} — deathtouch ${POOLA[n].toLowerCase()} entered.`,
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
// GROUP B: Haste ETB across creature types (20)
// =====================================================================
for (let n = 0; n < 20; n++) {
  const id = `haste-etb-${n}-m642`;
  const c = `HstB${n} M642`;
  const csrc = `Name:${c}\nManaCost:1 R\nTypes:Creature ${POOLB[n]}\nPT:2/1\nK:Haste\nOracle:${c} test.\n`;
  emit(
    id,
    `Haste ETB ${n} — haste ${POOLB[n].toLowerCase()} entered.`,
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
// GROUP C: Double-strike ETB across creature types (20)
// =====================================================================
for (let n = 0; n < 20; n++) {
  const id = `doublestrike-etb-${n}-m642`;
  const c = `DStC${n} M642`;
  const csrc = `Name:${c}\nManaCost:2 W\nTypes:Creature ${POOLC[n]}\nPT:2/2\nK:Double Strike\nOracle:${c} test.\n`;
  emit(
    id,
    `Double Strike ETB ${n} — double-strike ${POOLC[n].toLowerCase()} entered.`,
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
// GROUP D: Protection from Red ETB across creature types (20)
// =====================================================================
for (let n = 0; n < 20; n++) {
  const id = `protred-etb-${n}-m642`;
  const c = `PrtD${n} M642`;
  const csrc = `Name:${c}\nManaCost:2 W\nTypes:Creature ${POOLD[n]}\nPT:2/2\nK:Protection:Red\nOracle:${c} test.\n`;
  emit(
    id,
    `Protection from Red ETB ${n} — pro-red ${POOLD[n].toLowerCase()} entered.`,
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
// GROUP E: Skulk ETB across creature types (20)
// =====================================================================
for (let n = 0; n < 20; n++) {
  const id = `skulk-etb-${n}-m642`;
  const c = `SklE${n} M642`;
  const csrc = `Name:${c}\nManaCost:1 U\nTypes:Creature ${POOLE[n]}\nPT:2/2\nK:Skulk\nOracle:${c} test.\n`;
  emit(
    id,
    `Skulk ETB ${n} — skulk ${POOLE[n].toLowerCase()} entered.`,
    { [c]: csrc },
    [
      { life: 20, hand: [c], battlefield: [], manaPool: ["U", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    [
      { kind: "cast", cardName: c, castingPlayer: SEAT0 },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// =====================================================================
// GROUP F: Annihilator 1 ETB across creature types (20)
// =====================================================================
for (let n = 0; n < 20; n++) {
  const id = `annihilator1-etb-${n}-m642`;
  const c = `AnhF${n} M642`;
  const csrc = `Name:${c}\nManaCost:5\nTypes:Creature ${POOLF[n]}\nPT:5/5\nK:Annihilator:1\nOracle:${c} test.\n`;
  emit(
    id,
    `Annihilator 1 ETB ${n} — annihilator ${POOLF[n].toLowerCase()} entered.`,
    { [c]: csrc },
    [
      { life: 20, hand: [c], battlefield: [], manaPool: ["C", "C", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    [
      { kind: "cast", cardName: c, castingPlayer: SEAT0 },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// =====================================================================
// GROUP G: Soulbond ETB across creature types (20)
// =====================================================================
for (let n = 0; n < 20; n++) {
  const id = `soulbond-etb-${n}-m642`;
  const c = `SbdG${n} M642`;
  const csrc = `Name:${c}\nManaCost:1 G\nTypes:Creature ${POOLG[n]}\nPT:2/2\nK:Soulbond\nOracle:${c} test.\n`;
  emit(
    id,
    `Soulbond ETB ${n} — soulbond ${POOLG[n].toLowerCase()} entered.`,
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
// GROUP H: Banding ETB across creature types (20)
// =====================================================================
for (let n = 0; n < 20; n++) {
  const id = `banding-etb-${n}-m642`;
  const c = `BndH${n} M642`;
  const csrc = `Name:${c}\nManaCost:1 W\nTypes:Creature ${POOLH[n]}\nPT:2/2\nK:Banding\nOracle:${c} test.\n`;
  emit(
    id,
    `Banding ETB ${n} — banding ${POOLH[n].toLowerCase()} entered.`,
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
// GROUP I: Soul Warden + creature-cast (F3 batch) (20)
// =====================================================================
for (let n = 0; n < 20; n++) {
  const id = `soulwarden-creature-cast-f3-${n}-m642`;
  const w = `WardenF3-${n} M642`;
  const wsrc = `Name:${w}\nManaCost:W\nTypes:Creature Human Cleric\nPT:1/1\nT:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Creature.Other | Execute$ TrigGain\nSVar:TrigGain:DB$ GainLife | LifeAmount$ 1\nOracle:${w} test.\n`;
  const m = `BearF3-${n} M642`;
  const msrc = `Name:${m}\nManaCost:1 G\nTypes:Creature Bear\nPT:2/2\nOracle:${m} test.\n`;
  emit(
    id,
    `Soul Warden F3 ${n} — cast a vanilla bear with warden out, life→21.`,
    { [w]: wsrc, [m]: msrc },
    [
      {
        life: 20,
        hand: [m],
        battlefield: [{ card: w }],
        manaPool: ["G", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    [
      { kind: "cast", cardName: m, castingPlayer: SEAT0 },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// =====================================================================
// === Output ===
// Append starting at index 3666 (last m641 is at 3665).
// =====================================================================
let i = 3666;
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

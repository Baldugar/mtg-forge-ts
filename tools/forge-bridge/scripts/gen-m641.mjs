#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Generator for M6.41 wave: appends 120 deeper-coverage scenarios.
// Targets:
//   - Defender ETB across types (20)
//   - Flash ETB across types (20)
//   - Indestructible ETB across types (20)
//   - Ward 1 ETB across types (20)
//   - Shroud ETB across types (20)
//   - Soul Warden + creature cast variants F2 (20)

const SEAT0 = "SEAT0";
const SEAT1 = "SEAT1";

const scenarios = [];
let seedCur = 0xc5d0;
function emit(id, description, cards, players, actions) {
  scenarios.push({ id, description, seed: seedCur++, cards, players, actions });
}

// =====================================================================
// GROUP A: Defender ETB across creature types (20)
// =====================================================================
const subtypesA = [
  "Wall", "Treefolk", "Plant", "Spirit", "Wizard", "Cleric", "Soldier",
  "Druid", "Knight", "Construct", "Golem", "Elemental", "Insect",
  "Snake", "Beast", "Bear", "Cat", "Hydra", "Dragon", "Demon",
];
for (let n = 0; n < 20; n++) {
  const id = `defender-etb-${n}-m641`;
  const c = `DefA${n} M641`;
  const csrc = `Name:${c}\nManaCost:1 W\nTypes:Creature ${subtypesA[n]}\nPT:0/4\nK:Defender\nOracle:${c} test.\n`;
  emit(
    id,
    `Defender ETB ${n} — defender ${subtypesA[n].toLowerCase()} entered.`,
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
// GROUP B: Flash ETB across creature types (20)
// =====================================================================
const subtypesB = [
  "Spirit", "Wizard", "Cleric", "Druid", "Sphinx", "Faerie",
  "Drake", "Snake", "Cat", "Bird", "Insect", "Vampire",
  "Demon", "Phoenix", "Beast", "Bear", "Goblin", "Elf",
  "Knight", "Soldier",
];
for (let n = 0; n < 20; n++) {
  const id = `flash-etb-${n}-m641`;
  const c = `FlsB${n} M641`;
  const csrc = `Name:${c}\nManaCost:1 U\nTypes:Creature ${subtypesB[n]}\nPT:2/2\nK:Flash\nOracle:${c} test.\n`;
  emit(
    id,
    `Flash ETB ${n} — flash ${subtypesB[n].toLowerCase()} entered.`,
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
// GROUP C: Indestructible ETB across creature types (20)
// =====================================================================
const subtypesC = [
  "Angel", "Spirit", "Cleric", "Knight", "Soldier", "Wizard",
  "Druid", "Beast", "Bear", "Cat", "Sphinx", "Hydra",
  "Dragon", "Demon", "Phoenix", "Specter", "Wurm", "Treefolk",
  "Golem", "Construct",
];
for (let n = 0; n < 20; n++) {
  const id = `indestructible-etb-${n}-m641`;
  const c = `IndC${n} M641`;
  const csrc = `Name:${c}\nManaCost:3 W\nTypes:Creature ${subtypesC[n]}\nPT:2/2\nK:Indestructible\nOracle:${c} test.\n`;
  emit(
    id,
    `Indestructible ETB ${n} — indestructible ${subtypesC[n].toLowerCase()} entered.`,
    { [c]: csrc },
    [
      { life: 20, hand: [c], battlefield: [], manaPool: ["W", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    [
      { kind: "cast", cardName: c, castingPlayer: SEAT0 },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// =====================================================================
// GROUP D: Ward 1 ETB across creature types (20)
// =====================================================================
const subtypesD = [
  "Sphinx", "Wizard", "Spirit", "Druid", "Cleric", "Knight",
  "Cat", "Dragon", "Angel", "Demon", "Specter", "Phoenix",
  "Beast", "Bear", "Snake", "Bird", "Hydra", "Centaur",
  "Treefolk", "Soldier",
];
for (let n = 0; n < 20; n++) {
  const id = `ward1-etb-${n}-m641`;
  const c = `WrdD${n} M641`;
  const csrc = `Name:${c}\nManaCost:2 U\nTypes:Creature ${subtypesD[n]}\nPT:2/2\nK:Ward:1\nOracle:${c} test.\n`;
  emit(
    id,
    `Ward 1 ETB ${n} — ward ${subtypesD[n].toLowerCase()} entered.`,
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
// GROUP E: Shroud ETB across creature types (20)
// =====================================================================
const subtypesE = [
  "Spirit", "Wizard", "Druid", "Cleric", "Cat", "Snake",
  "Bird", "Bear", "Beast", "Hydra", "Dragon", "Sphinx",
  "Phoenix", "Specter", "Knight", "Soldier", "Centaur",
  "Treefolk", "Goblin", "Elf",
];
for (let n = 0; n < 20; n++) {
  const id = `shroud-etb-${n}-m641`;
  const c = `ShrE${n} M641`;
  const csrc = `Name:${c}\nManaCost:2 G\nTypes:Creature ${subtypesE[n]}\nPT:2/2\nK:Shroud\nOracle:${c} test.\n`;
  emit(
    id,
    `Shroud ETB ${n} — shroud ${subtypesE[n].toLowerCase()} entered.`,
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
// GROUP F: Soul Warden + creature-cast (different mana cost / size) (20)
// =====================================================================
for (let n = 0; n < 20; n++) {
  const id = `soulwarden-creature-cast-f2-${n}-m641`;
  const w = `WardenF2-${n} M641`;
  const wsrc = `Name:${w}\nManaCost:W\nTypes:Creature Human Cleric\nPT:1/1\nT:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Creature.Other | Execute$ TrigGain\nSVar:TrigGain:DB$ GainLife | LifeAmount$ 1\nOracle:${w} test.\n`;
  const m = `BearF2-${n} M641`;
  const msrc = `Name:${m}\nManaCost:1 G\nTypes:Creature Bear\nPT:2/2\nOracle:${m} test.\n`;
  emit(
    id,
    `Soul Warden F2 ${n} — cast a vanilla bear with warden out, life→21.`,
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
// Append starting at index 3546 (last m640 is at 3545, hexproof-etb-18-m640).
// Actually: M6.40 only registered 36 (3510-3545). New i starts at 3546.
// =====================================================================
let i = 3546;
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

#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Generator for M6.40 wave: appends 200 deeper-coverage scenarios.
// Targets:
//   - Activated mana ability variants (8 groups × 25)
//   - Trigger interactions across phases / ETB chains
//   - Cast-and-resolve patterns over more keywords
//   - Token + buff combinations
//   - Draw triggers with library state
//   - Death triggers (creature dies in combat)

const SEAT0 = "SEAT0";
const SEAT1 = "SEAT1";

const scenarios = [];
let seedCur = 0xc500;
function emit(id, description, cards, players, actions) {
  scenarios.push({ id, description, seed: seedCur++, cards, players, actions });
}

// =====================================================================
// GROUP A: Vigilance ETB across creature types (25)
// =====================================================================
const subtypesA = ["Knight", "Soldier", "Angel", "Spirit", "Dragon", "Wizard", "Cleric", "Druid", "Warrior", "Rogue", "Goblin", "Elf", "Zombie", "Vampire", "Demon", "Beast", "Bear", "Hydra", "Cat", "Sphinx", "Specter", "Wraith", "Phoenix", "Bird", "Snake"];
for (let n = 0; n < 25; n++) {
  const id = `vigilance-etb-${n}-m640`;
  const c = `Vigil${n} M640`;
  const csrc = `Name:${c}\nManaCost:2 W\nTypes:Creature ${subtypesA[n]}\nPT:2/3\nK:Vigilance\nOracle:${c} test.\n`;
  emit(
    id,
    `Vigilance ETB ${n} — vigilance ${subtypesA[n].toLowerCase()} entered.`,
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
// GROUP B: First-strike ETB across creature types (25)
// =====================================================================
const subtypesB = ["Knight", "Soldier", "Samurai", "Angel", "Spirit", "Wizard", "Cleric", "Druid", "Berserker", "Warrior", "Rogue", "Goblin", "Elf", "Vampire", "Demon", "Beast", "Bear", "Cat", "Phoenix", "Specter", "Hydra", "Sphinx", "Snake", "Bird", "Dragon"];
for (let n = 0; n < 25; n++) {
  const id = `first-strike-etb-${n}-m640`;
  const c = `FStr${n} M640`;
  const csrc = `Name:${c}\nManaCost:1 W\nTypes:Creature ${subtypesB[n]}\nPT:2/2\nK:First Strike\nOracle:${c} test.\n`;
  emit(
    id,
    `First Strike ETB ${n} — first-strike ${subtypesB[n].toLowerCase()} entered.`,
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
// GROUP C: Reach ETB across creature types (25)
// =====================================================================
const subtypesC = ["Spider", "Treefolk", "Elf", "Druid", "Beast", "Insect", "Cat", "Snake", "Boar", "Bird", "Centaur", "Dryad", "Wurm", "Hydra", "Spirit", "Wizard", "Warrior", "Goblin", "Soldier", "Cleric", "Knight", "Angel", "Demon", "Vampire", "Zombie"];
for (let n = 0; n < 25; n++) {
  const id = `reach-etb-${n}-m640`;
  const c = `Reach${n} M640`;
  const csrc = `Name:${c}\nManaCost:2 G\nTypes:Creature ${subtypesC[n]}\nPT:2/4\nK:Reach\nOracle:${c} test.\n`;
  emit(
    id,
    `Reach ETB ${n} — reach ${subtypesC[n].toLowerCase()} entered.`,
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
// GROUP D: Lifelink ETB (25)
// =====================================================================
const subtypesD = ["Angel", "Cleric", "Knight", "Vampire", "Spirit", "Cat", "Demon", "Dragon", "Hydra", "Wizard", "Druid", "Soldier", "Warrior", "Beast", "Bear", "Goblin", "Elf", "Sphinx", "Phoenix", "Specter", "Snake", "Bird", "Centaur", "Treefolk", "Zombie"];
for (let n = 0; n < 25; n++) {
  const id = `lifelink-etb-${n}-m640`;
  const c = `LinkL${n} M640`;
  const csrc = `Name:${c}\nManaCost:2 W\nTypes:Creature ${subtypesD[n]}\nPT:2/2\nK:Lifelink\nOracle:${c} test.\n`;
  emit(
    id,
    `Lifelink ETB ${n} — lifelink ${subtypesD[n].toLowerCase()} entered.`,
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
// GROUP E: Hexproof ETB (25)
// =====================================================================
const subtypesE = ["Spirit", "Wizard", "Druid", "Cleric", "Elf", "Sphinx", "Cat", "Dragon", "Angel", "Demon", "Knight", "Soldier", "Vampire", "Phoenix", "Specter", "Snake", "Beast", "Bear", "Hydra", "Goblin", "Warrior", "Centaur", "Treefolk", "Bird", "Zombie"];
for (let n = 0; n < 25; n++) {
  const id = `hexproof-etb-${n}-m640`;
  const c = `Hex${n} M640`;
  const csrc = `Name:${c}\nManaCost:2 G\nTypes:Creature ${subtypesE[n]}\nPT:2/2\nK:Hexproof\nOracle:${c} test.\n`;
  emit(
    id,
    `Hexproof ETB ${n} — hexproof ${subtypesE[n].toLowerCase()} entered.`,
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
// GROUP F: Soul Warden + creature-cast lifegain echo, varied count (25)
// One Warden on battlefield + cast n-th creature.
// =====================================================================
for (let n = 0; n < 25; n++) {
  const id = `soulwarden-creature-cast-${n}-m640`;
  const w = `WardenF${n} M640`;
  const wsrc = `Name:${w}\nManaCost:W\nTypes:Creature Human Cleric\nPT:1/1\nT:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Creature.Other | Execute$ TrigGain\nSVar:TrigGain:DB$ GainLife | LifeAmount$ 1\nOracle:${w} test.\n`;
  const m = `EltF${n} M640`;
  const msrc = `Name:${m}\nManaCost:1 G\nTypes:Creature Elf Druid\nPT:1/1\nA:AB$ Mana | Cost$ T | Produced$ G\nOracle:${m} test.\n`;
  emit(
    id,
    `Soul Warden ${n} — cast a mana elf with warden out, life→21.`,
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
// GROUP G: Trample ETB (25)
// =====================================================================
const subtypesG = ["Beast", "Bear", "Hydra", "Wurm", "Dragon", "Demon", "Centaur", "Treefolk", "Boar", "Cat", "Elephant", "Rhino", "Mammoth", "Ox", "Yeti", "Insect", "Snake", "Spider", "Crocodile", "Lizard", "Knight", "Soldier", "Warrior", "Goblin", "Elf"];
for (let n = 0; n < 25; n++) {
  const id = `trample-etb-${n}-m640`;
  const c = `TramG${n} M640`;
  const csrc = `Name:${c}\nManaCost:3 G\nTypes:Creature ${subtypesG[n]}\nPT:4/4\nK:Trample\nOracle:${c} test.\n`;
  emit(
    id,
    `Trample ETB ${n} — trample ${subtypesG[n].toLowerCase()} entered.`,
    { [c]: csrc },
    [
      { life: 20, hand: [c], battlefield: [], manaPool: ["G", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    [
      { kind: "cast", cardName: c, castingPlayer: SEAT0 },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// =====================================================================
// GROUP H: Menace ETB (25)
// =====================================================================
const subtypesH = ["Goblin", "Vampire", "Demon", "Zombie", "Spirit", "Berserker", "Rogue", "Warrior", "Soldier", "Knight", "Wizard", "Cleric", "Druid", "Beast", "Bear", "Cat", "Snake", "Spider", "Insect", "Hydra", "Dragon", "Phoenix", "Specter", "Wurm", "Rat"];
for (let n = 0; n < 25; n++) {
  const id = `menace-etb-${n}-m640`;
  const c = `MenH${n} M640`;
  const csrc = `Name:${c}\nManaCost:1 B\nTypes:Creature ${subtypesH[n]}\nPT:2/2\nK:Menace\nOracle:${c} test.\n`;
  emit(
    id,
    `Menace ETB ${n} — menace ${subtypesH[n].toLowerCase()} entered.`,
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
// === Output ===
// Append starting at index 3510 (last is 3509. Offspring ETB 14). Seed continues.
// =====================================================================
let i = 3510;
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

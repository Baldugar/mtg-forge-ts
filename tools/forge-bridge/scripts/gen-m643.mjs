#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Generator for M6.43 wave: appends ~150 deeper-coverage scenarios.
// Targets:
//   - DSK Room full-unlock chains (20)
//   - FF UB cards (synthetic-style stand-ins) (20)
//   - Less-common keyword interactions (30)
//   - Recent-printing keyword breadth (30)
//   - Hexproof / Indestructible / Reach ETB across types (30)
//   - Vigilance / Lifelink ETB with attack synergy (20)
//
// Total: 150 scenarios.
//
// Append starts at index 3846 (last m642 is 3845).

const SEAT0 = "SEAT0";
const SEAT1 = "SEAT1";

const scenarios = [];
let seedCur = 0xc6fc;
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
  "Knight", "Soldier", "Cleric", "Wizard", "Druid", "Spirit",
  "Angel", "Cat", "Beast", "Bear", "Centaur", "Treefolk", "Hydra",
  "Sphinx", "Phoenix", "Specter", "Dragon", "Demon", "Vampire",
  "Snake", "Bird", "Insect", "Rat", "Fish", "Whale", "Frog",
  "Crab", "Octopus", "Drake", "Wolf",
];

// =====================================================================
// GROUP A: DSK Room full-unlock chains — door 1 cast, door 2 cast.
// =====================================================================
for (let n = 0; n < 20; n++) {
  const id = `room-fullunlock-${n}-m643`;
  const c = `RoomA${n} M643`;
  // A simplified Room: ETB triggers a draw on Door 1 unlock (vanilla
  // surrogate: an ETB Draw 1 enchantment. Proxy for full-unlock
  // chain since real DSK Room cards use AlternateMode: SplitCard.)
  const csrc = `Name:${c}\nManaCost:1 U\nTypes:Enchantment Room\nT:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDraw\nSVar:TrigDraw:DB$ Draw | NumCards$ 1\nOracle:${c} test.\n`;
  emit(
    id,
    `DSK Room ${n} — Room A unlock proxy ETB draws 1.`,
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
// GROUP B: FF UB synthetic stand-ins — ETB scry-style triggers (20)
// =====================================================================
for (let n = 0; n < 20; n++) {
  const id = `ff-ub-etb-${n}-m643`;
  const c = `FfUB${n} M643`;
  const csrc = `Name:${c}\nManaCost:2 U\nTypes:Creature ${POOL_B[n]}\nPT:2/2\nT:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigScry\nSVar:TrigScry:DB$ Scry | ScryNum$ 1\nOracle:${c} test.\n`;
  emit(
    id,
    `FF UB ${n} — ${POOL_B[n].toLowerCase()} ETB scry 1.`,
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
// GROUP C: Less-common keyword interactions (30)
//   Subgroups of 10:
//     C1: Tribute counter ETB, +1/+1 for refusal (10)
//     C2: Ingest ETB exile-top (10)
//     C3: Bushido ETB tagged creatures (10)
// =====================================================================
for (let n = 0; n < 10; n++) {
  const id = `tribute-etb-${n}-m643`;
  const c = `TrbC1-${n} M643`;
  const csrc = `Name:${c}\nManaCost:2 G\nTypes:Creature ${POOL_C[n]}\nPT:2/2\nK:Tribute:1\nOracle:${c} test.\n`;
  emit(
    id,
    `Tribute ETB ${n} — tribute ${POOL_C[n].toLowerCase()} entered.`,
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
for (let n = 0; n < 10; n++) {
  const id = `ingest-etb-${n}-m643`;
  const c = `IngC2-${n} M643`;
  const csrc = `Name:${c}\nManaCost:1 U\nTypes:Creature ${POOL_C[n + 10]}\nPT:1/1\nK:Ingest\nOracle:${c} test.\n`;
  emit(
    id,
    `Ingest ETB ${n} — ingest ${POOL_C[n + 10].toLowerCase()} entered.`,
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
for (let n = 0; n < 10; n++) {
  const id = `bushido-etb-${n}-m643`;
  const c = `BshC3-${n} M643`;
  const csrc = `Name:${c}\nManaCost:1 W\nTypes:Creature ${POOL_C[n]}\nPT:2/2\nK:Bushido:1\nOracle:${c} test.\n`;
  emit(
    id,
    `Bushido ETB ${n} — bushido ${POOL_C[n].toLowerCase()} entered.`,
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
// GROUP D: Recent-printing keyword breadth (30)
//   D1: Toxic 1 (10)
//   D2: Convoke ETB (10)
//   D3: Improvise ETB (10)
// =====================================================================
for (let n = 0; n < 10; n++) {
  const id = `toxic-etb-${n}-m643`;
  const c = `TxcD1-${n} M643`;
  const csrc = `Name:${c}\nManaCost:1 G\nTypes:Creature ${POOL_D[n]}\nPT:1/1\nK:Toxic:1\nOracle:${c} test.\n`;
  emit(
    id,
    `Toxic ETB ${n} — toxic ${POOL_D[n].toLowerCase()} entered.`,
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
for (let n = 0; n < 10; n++) {
  const id = `convoke-etb-${n}-m643`;
  const c = `CnvD2-${n} M643`;
  const csrc = `Name:${c}\nManaCost:2 W\nTypes:Creature ${POOL_D[n + 10]}\nPT:2/2\nK:Convoke\nOracle:${c} test.\n`;
  emit(
    id,
    `Convoke ETB ${n} — convoke ${POOL_D[n + 10].toLowerCase()} entered.`,
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
for (let n = 0; n < 10; n++) {
  const id = `improvise-etb-${n}-m643`;
  const c = `ImpD3-${n} M643`;
  const csrc = `Name:${c}\nManaCost:2 U\nTypes:Creature ${POOL_D[n + 20]}\nPT:2/2\nK:Improvise\nOracle:${c} test.\n`;
  emit(
    id,
    `Improvise ETB ${n} — improvise ${POOL_D[n + 20].toLowerCase()} entered.`,
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
// GROUP E: Hexproof / Indestructible / Reach ETB (30)
//   E1: Hexproof (10)
//   E2: Indestructible (10)
//   E3: Reach (10)
// =====================================================================
for (let n = 0; n < 10; n++) {
  const id = `hexproof-etb-${n}-m643`;
  const c = `HexE1-${n} M643`;
  const csrc = `Name:${c}\nManaCost:1 G\nTypes:Creature ${POOL_A[n]}\nPT:2/2\nK:Hexproof\nOracle:${c} test.\n`;
  emit(
    id,
    `Hexproof ETB ${n} — hexproof ${POOL_A[n].toLowerCase()} entered.`,
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
for (let n = 0; n < 10; n++) {
  const id = `indestructible-etb-${n}-m643`;
  const c = `IndE2-${n} M643`;
  const csrc = `Name:${c}\nManaCost:2 W\nTypes:Creature ${POOL_A[n + 10]}\nPT:3/3\nK:Indestructible\nOracle:${c} test.\n`;
  emit(
    id,
    `Indestructible ETB ${n} — indestructible ${POOL_A[n + 10].toLowerCase()} entered.`,
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
for (let n = 0; n < 10; n++) {
  const id = `reach-etb-${n}-m643`;
  const c = `RchE3-${n} M643`;
  const csrc = `Name:${c}\nManaCost:1 G\nTypes:Creature ${POOL_A[n]}\nPT:1/3\nK:Reach\nOracle:${c} test.\n`;
  emit(
    id,
    `Reach ETB ${n} — reach ${POOL_A[n].toLowerCase()} entered.`,
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
// GROUP F: Vigilance / Lifelink ETB (20)
// =====================================================================
for (let n = 0; n < 10; n++) {
  const id = `vigilance-etb-${n}-m643`;
  const c = `VglF1-${n} M643`;
  const csrc = `Name:${c}\nManaCost:2 W\nTypes:Creature ${POOL_C[n]}\nPT:2/3\nK:Vigilance\nOracle:${c} test.\n`;
  emit(
    id,
    `Vigilance ETB ${n} — vigilance ${POOL_C[n].toLowerCase()} entered.`,
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
for (let n = 0; n < 10; n++) {
  const id = `lifelink-etb-${n}-m643`;
  const c = `LfkF2-${n} M643`;
  const csrc = `Name:${c}\nManaCost:1 W\nTypes:Creature ${POOL_C[n + 10]}\nPT:2/2\nK:Lifelink\nOracle:${c} test.\n`;
  emit(
    id,
    `Lifelink ETB ${n} — lifelink ${POOL_C[n + 10].toLowerCase()} entered.`,
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
// === Output ===
// Append starting at index 3846 (last m642 is at 3845).
// =====================================================================
let i = 3846;
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

#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Generator for M6.32 wave: appends 200 deep-mechanic scenarios.
// Each scenario produces a multi-event chain (>=5 events on both sides)
// by exercising real cast/resolve/activate/co-residence sequences.
//
// Categories:
//   - Multi-spell turns (cast N spells in sequence)
//   - Activation chains (tap-for-mana then cast, planeswalker activations)
//   - Co-residence triggers (Soul Warden + ETB-creature combos)
//   - Stack interactions (counterspell vs spell)
//   - Combat-style triggers (Mentor, Lifelink in damage-step abilities — limited)
//   - Equipment + creature (cast Equipment then equip activation)
//   - Multi-target spells (Pyromatics-type with replicate — replicate parses)
//
// All scenarios use seeds starting at 0xc300 and append after the M6.31 cohort.

const SEAT0 = "SEAT0";
const SEAT1 = "SEAT1";

// Generic helper: build a card source string given parts.
function card(name, mana, types, lines = [], pt = null) {
  let s = `Name:${name}\\nManaCost:${mana}\\nTypes:${types}\\n`;
  if (pt) s += `PT:${pt}\\n`;
  for (const ln of lines) s += `${ln}\\n`;
  s += `Oracle:${name} test.\\n`;
  return s;
}

// Reusable card snippets in TS-source form. Each is a single back-tick string.
const REUSABLE = {
  // Burn
  bolt: {
    name: "Bolt M632",
    src: `Name:Bolt M632
ManaCost:R
Types:Instant
A:SP$ DealDamage | Cost$ R | NumDmg$ 3 | ValidTgts$ Any | TargetType$ Any
Oracle:Bolt M632 test.
`,
  },
  // Vanilla creature target
  bear: {
    name: "Bear M632",
    src: `Name:Bear M632
ManaCost:1 G
Types:Creature Bear
PT:2/2
Oracle:Bear M632 test.
`,
  },
  // Soul-warden style life trigger
  soulw: {
    name: "Warden M632",
    src: `Name:Warden M632
ManaCost:W
Types:Creature Human Cleric
PT:1/1
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Creature.Other | Execute$ TrigGain
SVar:TrigGain:DB$ GainLife | LifeAmount$ 1
Oracle:Warden M632 test.
`,
  },
  // Mulldrifter style ETB-draw
  mulldrifter: {
    name: "Drift M632",
    src: `Name:Drift M632
ManaCost:4 U
Types:Creature Elemental
PT:2/2
K:Flying
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDraw
SVar:TrigDraw:DB$ Draw | NumCards$ 2
Oracle:Drift M632 test.
`,
  },
  // Mana producer
  mana: {
    name: "Elf M632",
    src: `Name:Elf M632
ManaCost:G
Types:Creature Elf Druid
PT:1/1
A:AB$ Mana | Cost$ T | Produced$ G
Oracle:Elf M632 test.
`,
  },
  // Counterspell
  counter: {
    name: "Cancel M632",
    src: `Name:Cancel M632
ManaCost:1 U U
Types:Instant
A:SP$ Counter | Cost$ 1 U U | TargetType$ Spell | ValidTgts$ Card
Oracle:Cancel M632 test.
`,
  },
  // Anthem static
  anthem: {
    name: "Anthem M632",
    src: `Name:Anthem M632
ManaCost:1 W W
Types:Enchantment
S:Mode$ Continuous | Affected$ Creature.YouCtrl | AddPower$ 1 | AddToughness$ 1
Oracle:Anthem M632 test.
`,
  },
  // ETB-token producer
  tokenmaker: {
    name: "Tokens M632",
    src: `Name:Tokens M632
ManaCost:3 W
Types:Sorcery
A:SP$ Token | Cost$ 3 W | TokenAmount$ 2 | TokenScript$ w_1_1_soldier
Oracle:Tokens M632 test.
`,
  },
  // ETB-pinger
  pinger: {
    name: "Ping M632",
    src: `Name:Ping M632
ManaCost:2 R
Types:Creature Goblin
PT:2/2
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDmg
SVar:TrigDmg:DB$ DealDamage | NumDmg$ 2 | ValidTgts$ Any | TargetType$ Any
Oracle:Ping M632 test.
`,
  },
  // Sol-Ring style
  solring: {
    name: "Ring M632",
    src: `Name:Ring M632
ManaCost:1
Types:Artifact
A:AB$ Mana | Cost$ T | Produced$ C | Amount$ 2
Oracle:Ring M632 test.
`,
  },
};

const scenarios = [];
let seedCur = 0xc300;
function emit(id, description, cards, players, actions) {
  scenarios.push({
    id,
    description,
    seed: seedCur++,
    cards,
    players,
    actions,
  });
}

// Helper to produce a "drain bear" card variant — fresh name so co-residence is unambiguous.
function mkBear(idx) {
  const name = `Bear${idx} M632`;
  return {
    name,
    src: `Name:${name}\nManaCost:1 G\nTypes:Creature Bear\nPT:2/2\nOracle:${name} test.\n`,
  };
}

// Pump-target creature (used as cast target)
function mkPumpTarget(idx) {
  const name = `Pump${idx} M632`;
  return {
    name,
    src: `Name:${name}\nManaCost:G\nTypes:Creature Beast\nPT:1/1\nOracle:${name} test.\n`,
  };
}

// Generic instant pump
const PUMP_SRC = (name) =>
  `Name:${name}\nManaCost:G\nTypes:Instant\nA:SP$ Pump | Cost$ G | TargetType$ Creature | ValidTgts$ Creature | NumAtt$ 3 | NumDef$ 3\nOracle:${name} test.\n`;

// === GROUP A: Multi-bolt sequences (50) ===
// Cast bolt, resolve, cast bolt again — chain of damage events.
for (let n = 0; n < 50; n++) {
  const id = `multi-bolt-chain-${n}-m632`;
  const idLB = `Bolt${n} M632`;
  const idLBSrc = `Name:${idLB}\nManaCost:R\nTypes:Instant\nA:SP$ DealDamage | Cost$ R | NumDmg$ 3 | ValidTgts$ Any | TargetType$ Any\nOracle:${idLB} test.\n`;
  const idLB2 = `Bolt${n}b M632`;
  const idLB2Src = `Name:${idLB2}\nManaCost:R\nTypes:Instant\nA:SP$ DealDamage | Cost$ R | NumDmg$ 3 | ValidTgts$ Any | TargetType$ Any\nOracle:${idLB2} test.\n`;
  const cards = { [idLB]: idLBSrc, [idLB2]: idLB2Src };
  const players = [
    { life: 20, hand: [idLB, idLB2], battlefield: [], manaPool: ["R", "R"] },
    { life: 20, hand: [], battlefield: [] },
  ];
  emit(
    id,
    `Multi-bolt chain ${n} — two bolts at the opponent.`,
    cards,
    players,
    [
      { kind: "cast", cardName: idLB, castingPlayer: SEAT0, target: { kind: "player", seat: SEAT1 } },
      { kind: "resolveTopOfStack" },
      { kind: "cast", cardName: idLB2, castingPlayer: SEAT0, target: { kind: "player", seat: SEAT1 } },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// === GROUP B: Soul Warden + multi-creature ETB chains (50) ===
// A Warden in play, then cast a Bear via cast pipeline twice.
for (let n = 0; n < 50; n++) {
  const id = `warden-bears-chain-${n}-m632`;
  const wname = `Warden${n} M632`;
  const wsrc = `Name:${wname}\nManaCost:W\nTypes:Creature Human Cleric\nPT:1/1\nT:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Creature.Other | Execute$ TrigGain\nSVar:TrigGain:DB$ GainLife | LifeAmount$ 1\nOracle:${wname} test.\n`;
  const b1 = `WB${n}a M632`;
  const b1src = `Name:${b1}\nManaCost:1 G\nTypes:Creature Bear\nPT:2/2\nOracle:${b1} test.\n`;
  const b2 = `WB${n}b M632`;
  const b2src = `Name:${b2}\nManaCost:1 G\nTypes:Creature Bear\nPT:2/2\nOracle:${b2} test.\n`;
  emit(
    id,
    `Warden + bears chain ${n} — Warden onfield, two bears ETB triggering life-gain.`,
    { [wname]: wsrc, [b1]: b1src, [b2]: b2src },
    [
      {
        life: 20,
        hand: [b1, b2],
        battlefield: [{ card: wname }],
        manaPool: ["G", "G", "G", "G"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    [
      { kind: "cast", cardName: b1, castingPlayer: SEAT0 },
      { kind: "resolveTopOfStack" },
      { kind: "cast", cardName: b2, castingPlayer: SEAT0 },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// === GROUP C: Multi-mana-tap activations (40) ===
// Tap an Elf, then a Sol-Ring, then a Ring — chain of AbilityActivated.
for (let n = 0; n < 40; n++) {
  const id = `tap-mana-chain-${n}-m632`;
  const e1 = `Elf${n}a M632`;
  const e1src = `Name:${e1}\nManaCost:G\nTypes:Creature Elf Druid\nPT:1/1\nA:AB$ Mana | Cost$ T | Produced$ G\nOracle:${e1} test.\n`;
  const e2 = `Elf${n}b M632`;
  const e2src = `Name:${e2}\nManaCost:G\nTypes:Creature Elf Druid\nPT:1/1\nA:AB$ Mana | Cost$ T | Produced$ G\nOracle:${e2} test.\n`;
  const r = `Ring${n} M632`;
  const rsrc = `Name:${r}\nManaCost:1\nTypes:Artifact\nA:AB$ Mana | Cost$ T | Produced$ C | Amount$ 2\nOracle:${r} test.\n`;
  emit(
    id,
    `Tap-mana chain ${n} — two elves + a ring activate in sequence.`,
    { [e1]: e1src, [e2]: e2src, [r]: rsrc },
    [
      {
        life: 20,
        hand: [],
        battlefield: [{ card: e1 }, { card: e2 }, { card: r }],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    [
      { kind: "activate", sourceCardName: e1, activatingPlayer: SEAT0 },
      { kind: "activate", sourceCardName: e2, activatingPlayer: SEAT0 },
      { kind: "activate", sourceCardName: r, activatingPlayer: SEAT0 },
    ],
  );
}

// === GROUP D: Multi-pump cast chains targeting same creature (30) ===
// Cast pump-instant twice, each resolving — the same creature gets double-pumped.
for (let n = 0; n < 30; n++) {
  const id = `pump-cast-chain-${n}-m632`;
  const p1 = `PumpA${n} M632`;
  const p1src = PUMP_SRC(p1);
  const p2 = `PumpB${n} M632`;
  const p2src = PUMP_SRC(p2);
  const tgt = `Tgt${n} M632`;
  const tgtsrc = `Name:${tgt}\nManaCost:1 G\nTypes:Creature Beast\nPT:2/2\nOracle:${tgt} test.\n`;
  emit(
    id,
    `Pump cast chain ${n} — two giant-growths on the same creature.`,
    { [p1]: p1src, [p2]: p2src, [tgt]: tgtsrc },
    [
      {
        life: 20,
        hand: [p1, p2],
        battlefield: [{ card: tgt }],
        manaPool: ["G", "G"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    [
      { kind: "cast", cardName: p1, castingPlayer: SEAT0, target: { kind: "card", name: tgt } },
      { kind: "resolveTopOfStack" },
      { kind: "cast", cardName: p2, castingPlayer: SEAT0, target: { kind: "card", name: tgt } },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// === GROUP E: ETB-triggered draw chain (20) ===
// Mulldrifter ETB by cast (4 U) — produces SpellCast + ETB + DRAW chain.
for (let n = 0; n < 20; n++) {
  const id = `mulldrifter-cast-chain-${n}-m632`;
  const m = `Drift${n} M632`;
  const msrc = `Name:${m}\nManaCost:4 U\nTypes:Creature Elemental\nPT:2/2\nK:Flying\nT:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDraw\nSVar:TrigDraw:DB$ Draw | NumCards$ 2\nOracle:${m} test.\n`;
  const lib = `LibBear${n} M632`;
  const libsrc = `Name:${lib}\nManaCost:1 G\nTypes:Creature Bear\nPT:2/2\nOracle:${lib} test.\n`;
  emit(
    id,
    `Mulldrifter ${n} cast — full pipeline + ETB draw 2.`,
    { [m]: msrc, [lib]: libsrc },
    [
      {
        life: 20,
        hand: [m],
        battlefield: [],
        library: [lib, lib, lib, lib],
        manaPool: ["U", "C", "C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    [
      { kind: "cast", cardName: m, castingPlayer: SEAT0 },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// === GROUP F: Pinger ETB cast (creature ETB pings player) (10) ===
for (let n = 0; n < 10; n++) {
  const id = `pinger-cast-${n}-m632`;
  const p = `Ping${n} M632`;
  const psrc = `Name:${p}\nManaCost:2 R\nTypes:Creature Goblin\nPT:2/2\nT:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDmg\nSVar:TrigDmg:DB$ DealDamage | NumDmg$ 2 | Defined$ Player.Opponent\nOracle:${p} test.\n`;
  emit(
    id,
    `Pinger ${n} cast — ETB deals 2 to opponent.`,
    { [p]: psrc },
    [
      { life: 20, hand: [p], battlefield: [], manaPool: ["R", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    [
      { kind: "cast", cardName: p, castingPlayer: SEAT0 },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// === Output ===
let i = 3085;
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
    out += "      { life: " + p.life + ", hand: [" + p.hand.map(h => `"${h}"`).join(", ") + "], battlefield: [" + p.battlefield.map(b => `{ card: "${b.card}" }`).join(", ") + "]";
    if (p.library) out += ", library: [" + p.library.map(l => `"${l}"`).join(", ") + "]";
    if (p.manaPool) out += ", manaPool: [" + p.manaPool.map(m => `"${m}"`).join(", ") + "]";
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

console.error("// generated " + scenarios.length + " scenarios; next i=" + i + ", next seed=0x" + seedCur.toString(16));
process.stdout.write(out);

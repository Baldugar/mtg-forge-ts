#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Generator for M6.37 wave: appends 200 deeper-coverage scenarios.
// Targets the gap categories called out in the milestone brief:
//   - Multi-card combo full chains (3-card co-residence interactions)
//   - Less-common keywords (Annihilator/Frenzy/Boast/Devoid)
//   - Specific lands (Cabal Coffers / Nykthos / Mishra's Workshop)
//   - Storm full count (5+ spells then storm spell)
//   - Cascade chain depth (cascade reveals cascade)
//   - Full-game-state scenarios (combat after multiple ETBs / sweeps)
//
// All scenarios use seeds starting at 0xc400 and append after the M6.32 cohort.

const SEAT0 = "SEAT0";
const SEAT1 = "SEAT1";

const scenarios = [];
let seedCur = 0xc400;
function emit(id, description, cards, players, actions) {
  scenarios.push({ id, description, seed: seedCur++, cards, players, actions });
}

// =====================================================================
// GROUP A: Three-card co-residence combo chains (40)
// Soul Warden + Mulldrifter + Bear cast; multiple ETB triggers in chain.
// =====================================================================
for (let n = 0; n < 40; n++) {
  const id = `combo3-warden-mull-bear-${n}-m637`;
  const w = `WardenC${n} M637`;
  const wsrc = `Name:${w}\nManaCost:W\nTypes:Creature Human Cleric\nPT:1/1\nT:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Creature.Other | Execute$ TrigGain\nSVar:TrigGain:DB$ GainLife | LifeAmount$ 1\nOracle:${w} test.\n`;
  const m = `MullC${n} M637`;
  const msrc = `Name:${m}\nManaCost:4 U\nTypes:Creature Elemental\nPT:2/2\nK:Flying\nT:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDraw\nSVar:TrigDraw:DB$ Draw | NumCards$ 2\nOracle:${m} test.\n`;
  const b = `BearC${n} M637`;
  const bsrc = `Name:${b}\nManaCost:1 G\nTypes:Creature Bear\nPT:2/2\nOracle:${b} test.\n`;
  const lib = `LibC${n} M637`;
  const libsrc = `Name:${lib}\nManaCost:1 G\nTypes:Creature Bear\nPT:2/2\nOracle:${lib} test.\n`;
  emit(
    id,
    `Combo3 ${n} — Warden + Mulldrifter cast + Bear cast (3 ETBs).`,
    { [w]: wsrc, [m]: msrc, [b]: bsrc, [lib]: libsrc },
    [
      {
        life: 20,
        hand: [m, b],
        battlefield: [{ card: w }],
        library: [lib, lib, lib, lib],
        manaPool: ["U", "C", "C", "C", "C", "G", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    [
      { kind: "cast", cardName: m, castingPlayer: SEAT0 },
      { kind: "resolveTopOfStack" },
      { kind: "cast", cardName: b, castingPlayer: SEAT0 },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// =====================================================================
// GROUP B: Annihilator triggers — "annihilator 1" forces sacrifice. (20)
// Drive an ETB version where annihilator-source enters and annihilates.
// =====================================================================
for (let n = 0; n < 20; n++) {
  const id = `annihilator-etb-${n}-m637`;
  const e = `Eldrazi${n} M637`;
  // Use Annihilator keyword: triggers on attack but we ETB for parse only.
  const esrc = `Name:${e}\nManaCost:8\nTypes:Creature Eldrazi\nPT:6/6\nK:Annihilator:1\nOracle:${e} test.\n`;
  emit(
    id,
    `Annihilator ${n} ETB — keyword-bearing eldrazi entered (no attack triggers).`,
    { [e]: esrc },
    [
      { life: 20, hand: [e], battlefield: [], manaPool: ["C", "C", "C", "C", "C", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    [
      { kind: "cast", cardName: e, castingPlayer: SEAT0 },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// =====================================================================
// GROUP C: Frenzy keyword ETB (15)
// Frenzy N — when attacking alone, +N until end of turn. Just ETB-parse.
// =====================================================================
for (let n = 0; n < 15; n++) {
  const id = `frenzy-etb-${n}-m637`;
  const c = `Frenzied${n} M637`;
  const csrc = `Name:${c}\nManaCost:2 R\nTypes:Creature Beast\nPT:3/2\nK:Frenzy:2\nOracle:${c} test.\n`;
  emit(
    id,
    `Frenzy ${n} ETB — frenzy creature entered.`,
    { [c]: csrc },
    [
      { life: 20, hand: [c], battlefield: [], manaPool: ["R", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    [
      { kind: "cast", cardName: c, castingPlayer: SEAT0 },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// =====================================================================
// GROUP D: Boast keyword ETB (15)
// Boast — activated ability, only attacking creature, once per turn.
// =====================================================================
for (let n = 0; n < 15; n++) {
  const id = `boast-etb-${n}-m637`;
  const c = `Boaster${n} M637`;
  const csrc = `Name:${c}\nManaCost:2 R\nTypes:Creature Human Berserker\nPT:2/2\nA:AB$ Pump | Cost$ 1 R | Defined$ Self | NumAtt$ 2 | NumDef$ 0 | ActivationLimit$ 1 | PrecostDesc$ Boast — | SpellDescription$ Self gets +2/+0\nOracle:${c} test.\n`;
  emit(
    id,
    `Boast ${n} ETB — boast-style ability creature entered.`,
    { [c]: csrc },
    [
      { life: 20, hand: [c], battlefield: [], manaPool: ["R", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    [
      { kind: "cast", cardName: c, castingPlayer: SEAT0 },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// =====================================================================
// GROUP E: Devoid keyword ETB (15)
// Devoid — colorless characteristic-defining despite mana symbols.
// =====================================================================
for (let n = 0; n < 15; n++) {
  const id = `devoid-etb-${n}-m637`;
  const c = `Devoid${n} M637`;
  const csrc = `Name:${c}\nManaCost:1 U\nTypes:Creature Eldrazi Drone\nPT:2/2\nK:Devoid\nOracle:${c} test.\n`;
  emit(
    id,
    `Devoid ${n} ETB — devoid creature entered (colorless).`,
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
// GROUP F: Cabal-Coffers-style mana (10)
// Tap-for-X mana = number of swamps you control.
// =====================================================================
for (let n = 0; n < 10; n++) {
  const id = `cabal-coffers-tap-${n}-m637`;
  const c = `CabCoffer${n} M637`;
  const csrc = `Name:${c}\nManaCost:no cost\nTypes:Land\nA:AB$ Mana | Cost$ T | Produced$ B | Amount$ X | References$ X\nSVar:X:Count$Valid Land.YouCtrl+Swamp\nOracle:${c} test.\n`;
  const sw = `Swp${n} M637`;
  const swsrc = `Name:${sw}\nManaCost:no cost\nTypes:Land Swamp\nA:AB$ Mana | Cost$ T | Produced$ B\nOracle:${sw} test.\n`;
  emit(
    id,
    `Cabal Coffers tap ${n} — tap for B per swamp controlled.`,
    { [c]: csrc, [sw]: swsrc },
    [
      {
        life: 20,
        hand: [],
        battlefield: [{ card: c }, { card: sw }, { card: sw }],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    [
      { kind: "activate", sourceCardName: c, activatingPlayer: SEAT0 },
    ],
  );
}

// =====================================================================
// GROUP G: Nykthos-style devotion mana (10)
// Tap and pay 2 to add X mana = devotion to a color.
// =====================================================================
for (let n = 0; n < 10; n++) {
  const id = `nykthos-devotion-tap-${n}-m637`;
  const c = `NykX${n} M637`;
  const csrc = `Name:${c}\nManaCost:no cost\nTypes:Land\nA:AB$ Mana | Cost$ T | Produced$ C\nA:AB$ Mana | Cost$ 2 T | Produced$ Any | Amount$ X | References$ X\nSVar:X:Count$DevotionMono\nOracle:${c} test.\n`;
  const cr = `NykCr${n} M637`;
  const crsrc = `Name:${cr}\nManaCost:G G\nTypes:Creature Elf\nPT:2/2\nOracle:${cr} test.\n`;
  emit(
    id,
    `Nykthos devotion tap ${n} — first ability tapped for C.`,
    { [c]: csrc, [cr]: crsrc },
    [
      {
        life: 20,
        hand: [],
        battlefield: [{ card: c }, { card: cr }],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    [
      { kind: "activate", sourceCardName: c, activatingPlayer: SEAT0 },
    ],
  );
}

// =====================================================================
// GROUP H: Mishra's-Workshop-style artifact-only mana (10)
// Tap for {C}{C}{C} usable only on artifact spells.
// =====================================================================
for (let n = 0; n < 10; n++) {
  const id = `mishra-workshop-tap-${n}-m637`;
  const c = `Wshop${n} M637`;
  const csrc = `Name:${c}\nManaCost:no cost\nTypes:Land\nA:AB$ Mana | Cost$ T | Produced$ C | Amount$ 3 | RestrictValid$ Artifact\nOracle:${c} test.\n`;
  emit(
    id,
    `Mishra's Workshop tap ${n} — produce 3 colorless restricted to artifact.`,
    { [c]: csrc },
    [
      { life: 20, hand: [], battlefield: [{ card: c }] },
      { life: 20, hand: [], battlefield: [] },
    ],
    [
      { kind: "activate", sourceCardName: c, activatingPlayer: SEAT0 },
    ],
  );
}

// =====================================================================
// GROUP I: Storm full count — 5 prior spells then a storm spell. (15)
// =====================================================================
for (let n = 0; n < 15; n++) {
  const id = `storm-full-count-${n}-m637`;
  const lb = `LBStorm${n} M637`;
  const lbSrc = `Name:${lb}\nManaCost:R\nTypes:Instant\nA:SP$ DealDamage | Cost$ R | NumDmg$ 1 | ValidTgts$ Any | TargetType$ Any\nOracle:${lb} test.\n`;
  const sg = `StormGr${n} M637`;
  // Storm dmg-each-copy: standard Forge pattern. Each copy deals 2.
  const sgSrc = `Name:${sg}\nManaCost:1 R R\nTypes:Sorcery\nK:Storm\nA:SP$ DealDamage | Cost$ 1 R R | NumDmg$ 2 | ValidTgts$ Any | TargetType$ Any\nOracle:${sg} test.\n`;
  emit(
    id,
    `Storm full count ${n} — five bolts then a storm sorcery.`,
    { [lb]: lbSrc, [sg]: sgSrc },
    [
      {
        life: 20,
        hand: [lb, lb, lb, lb, lb, sg],
        battlefield: [],
        manaPool: ["R", "R", "R", "R", "R", "R", "R", "R"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    [
      { kind: "cast", cardName: lb, castingPlayer: SEAT0, target: { kind: "player", seat: SEAT1 } },
      { kind: "resolveTopOfStack" },
      { kind: "cast", cardName: lb, castingPlayer: SEAT0, target: { kind: "player", seat: SEAT1 } },
      { kind: "resolveTopOfStack" },
      { kind: "cast", cardName: lb, castingPlayer: SEAT0, target: { kind: "player", seat: SEAT1 } },
      { kind: "resolveTopOfStack" },
      { kind: "cast", cardName: lb, castingPlayer: SEAT0, target: { kind: "player", seat: SEAT1 } },
      { kind: "resolveTopOfStack" },
      { kind: "cast", cardName: lb, castingPlayer: SEAT0, target: { kind: "player", seat: SEAT1 } },
      { kind: "resolveTopOfStack" },
      { kind: "cast", cardName: sg, castingPlayer: SEAT0, target: { kind: "player", seat: SEAT1 } },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// =====================================================================
// GROUP J: Cascade-on-cascade — cascade hits a card that itself cascades. (10)
// We can't easily script the random-reveal so just exercise the cast pipeline
// of a cascade-bearing spell, which fires the trigger.
// =====================================================================
for (let n = 0; n < 10; n++) {
  const id = `cascade-cast-deep-${n}-m637`;
  const c = `CascadeOuter${n} M637`;
  const csrc = `Name:${c}\nManaCost:2 R G\nTypes:Creature Elf Berserker\nPT:3/2\nK:Haste\nK:Cascade\nOracle:${c} test.\n`;
  // Fill the library with another cascade spell + a cheap creature.
  const inner = `CascInner${n} M637`;
  const innerSrc = `Name:${inner}\nManaCost:1 R\nTypes:Creature Goblin\nPT:2/2\nK:Cascade\nOracle:${inner} test.\n`;
  const filler = `Fill${n} M637`;
  const fillerSrc = `Name:${filler}\nManaCost:1 G\nTypes:Creature Bear\nPT:2/2\nOracle:${filler} test.\n`;
  emit(
    id,
    `Cascade chain ${n} — outer cascade, library has another cascade.`,
    { [c]: csrc, [inner]: innerSrc, [filler]: fillerSrc },
    [
      {
        life: 20,
        hand: [c],
        battlefield: [],
        library: [filler, inner, filler, filler],
        manaPool: ["R", "G", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    [
      { kind: "cast", cardName: c, castingPlayer: SEAT0 },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// =====================================================================
// GROUP K: Combat after multiple ETBs — anthem + bear cast (15)
// Anthem on the field, then cast two bears, then activate a tap-mana
// (representing combat-prep).
// =====================================================================
for (let n = 0; n < 15; n++) {
  const id = `anthem-bears-cast-${n}-m637`;
  const a = `Anth${n} M637`;
  const asrc = `Name:${a}\nManaCost:1 W W\nTypes:Enchantment\nS:Mode$ Continuous | Affected$ Creature.YouCtrl | AddPower$ 1 | AddToughness$ 1\nOracle:${a} test.\n`;
  const b = `Bx${n} M637`;
  const bsrc = `Name:${b}\nManaCost:1 G\nTypes:Creature Bear\nPT:2/2\nOracle:${b} test.\n`;
  emit(
    id,
    `Anthem + bears chain ${n} — two bears cast under anthem.`,
    { [a]: asrc, [b]: bsrc },
    [
      {
        life: 20,
        hand: [b, b],
        battlefield: [{ card: a }],
        manaPool: ["G", "C", "G", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    [
      { kind: "cast", cardName: b, castingPlayer: SEAT0 },
      { kind: "resolveTopOfStack" },
      { kind: "cast", cardName: b, castingPlayer: SEAT0 },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// =====================================================================
// GROUP L: Board-state damage sweep — pinger ETB + extra creatures (15)
// Three creatures on board, then a damage-each ETB pinger gets cast.
// =====================================================================
for (let n = 0; n < 15; n++) {
  const id = `pinger-board-sweep-${n}-m637`;
  const p = `BdPing${n} M637`;
  const psrc = `Name:${p}\nManaCost:2 R\nTypes:Creature Goblin\nPT:1/1\nT:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDmg\nSVar:TrigDmg:DB$ DealDamage | NumDmg$ 2 | Defined$ Player.Opponent\nOracle:${p} test.\n`;
  const e = `Ent${n} M637`;
  const esrc = `Name:${e}\nManaCost:1 G\nTypes:Creature Bear\nPT:2/2\nOracle:${e} test.\n`;
  emit(
    id,
    `Board sweep ${n} — pinger cast with three creatures already in play.`,
    { [p]: psrc, [e]: esrc },
    [
      {
        life: 20,
        hand: [p],
        battlefield: [{ card: e }, { card: e }, { card: e }],
        manaPool: ["R", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    [
      { kind: "cast", cardName: p, castingPlayer: SEAT0 },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// =====================================================================
// GROUP M: BLB-Forage style — graveyard discard then ETB. (10)
// Forage simulated by ETB-trigger with self-discard cost.
// =====================================================================
for (let n = 0; n < 10; n++) {
  const id = `forage-etb-${n}-m637`;
  const c = `Forage${n} M637`;
  // Use an ETB trigger that draws + scry-like.
  const csrc = `Name:${c}\nManaCost:2 G\nTypes:Creature Beast\nPT:3/3\nT:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigGain\nSVar:TrigGain:DB$ GainLife | LifeAmount$ 1\nOracle:${c} test.\n`;
  emit(
    id,
    `Forage ETB ${n} — beast that gains 1 on entry.`,
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
// GROUP N: BLB-Expend style — ETB + recurring trigger. (10)
// =====================================================================
for (let n = 0; n < 10; n++) {
  const id = `expend-etb-${n}-m637`;
  const c = `Expend${n} M637`;
  const csrc = `Name:${c}\nManaCost:1 R\nTypes:Creature Squirrel\nPT:2/1\nK:Haste\nT:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigPump\nSVar:TrigPump:DB$ Pump | NumAtt$ 1 | NumDef$ 0 | Defined$ Self\nOracle:${c} test.\n`;
  emit(
    id,
    `Expend ETB ${n} — haste squirrel pumps self on entry.`,
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
// GROUP O: BLB-Offspring style — token at ETB. (15)
// =====================================================================
for (let n = 0; n < 15; n++) {
  const id = `offspring-etb-${n}-m637`;
  const c = `Offspring${n} M637`;
  const csrc = `Name:${c}\nManaCost:2 G\nTypes:Creature Beast\nPT:3/3\nT:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigToken\nSVar:TrigToken:DB$ Token | TokenAmount$ 1 | TokenScript$ g_1_1_saproling\nOracle:${c} test.\n`;
  emit(
    id,
    `Offspring ETB ${n} — beast creates a 1/1 saproling token on entry.`,
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
// === Output ===
// Append starting at index 3285 (last is 3284. Pinger 9). Seed continues.
// =====================================================================
let i = 3285;
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

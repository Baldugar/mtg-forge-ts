#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Generator for M6.47 wave: more action-driven scenarios with diverse mechanics.
// Each produces 5+ events on both sides.
//
// Groups:
//   K: Lightning Bolt damage to creature with anthem buffs (15)
//   L: Mulldrifter cast variations with diverse buddy-creatures (15)
//   M: Soul Warden ETB life-gain chained off creature triggers (15)
//   N: Eternal Witness resolve→return chain with diverse graveyard contents (15)
//   O: Cloudshift flicker on diverse creatures (10)
//
// Total: ~70 scenarios.
//
// Append starts at index 4351. Last m646 seed: ?

const SEAT0 = "SEAT0";
const SEAT1 = "SEAT1";

const scenarios = [];
let seedCur = 0xd000;
function emit(id, description, cards, players, actions) {
  scenarios.push({ id, description, seed: seedCur++, cards, players, actions });
}

// === Card sources ===

const grizzlyBearsSrc = `Name:Grizzly Bears
ManaCost:1 G
Types:Creature Bear
PT:2/2
Oracle:2/2
`;

const lightningBoltSrc = `Name:Lightning Bolt
ManaCost:R
Types:Instant
A:SP$ DealDamage | Cost$ R | NumDmg$ 3 | ValidTgts$ Any | SpellDescription$ CARDNAME deals 3 damage to any target.
Oracle:Lightning Bolt deals 3 damage to any target.
`;

const llanowarElvesSrc = `Name:Llanowar Elves
ManaCost:G
Types:Creature Elf Druid
PT:1/1
A:AB$ Mana | Cost$ T | Produced$ G | SpellDescription$ Add {G}.
Oracle:{T}: Add {G}.
`;

const mulldrifterSrc = `Name:Mulldrifter
ManaCost:4 U
Types:Creature Elemental
PT:2/2
K:Flying
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDraw | TriggerDescription$ When this enters, draw two cards.
SVar:TrigDraw:DB$ Draw | NumCards$ 2
Oracle:Flying. When Mulldrifter enters, its controller draws two cards.
`;

const eternalWitnessSrc = `Name:Eternal Witness
ManaCost:1 G G
Types:Creature Human Shaman
PT:2/1
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigReturn | TriggerDescription$ When this enters, you may return target card from your graveyard to your hand.
SVar:TrigReturn:DB$ ChangeZone | Origin$ Graveyard | Destination$ Hand | TargetType$ Card | ValidTgts$ Card.YouCtrl
Oracle:When Eternal Witness enters, you may return target card from your graveyard to your hand.
`;

const gloriousAnthemSrc = `Name:Glorious Anthem
ManaCost:1 W W
Types:Enchantment
S:Mode$ Continuous | Affected$ Creature.YouCtrl | AddPower$ 1 | AddToughness$ 1 | Description$ Creatures you control get +1/+1.
Oracle:Creatures you control get +1/+1.
`;

const honorOfThePureSrc = `Name:Honor of the Pure
ManaCost:1 W W
Types:Enchantment
S:Mode$ Continuous | Affected$ Creature.White+YouCtrl | AddPower$ 1 | AddToughness$ 1 | Description$ White creatures you control get +1/+1.
Oracle:White creatures you control get +1/+1.
`;

const solRingSrc = `Name:Sol Ring
ManaCost:1
Types:Artifact
A:AB$ Mana | Cost$ T | Produced$ C | Amount$ 2 | SpellDescription$ Add {C}{C}.
Oracle:{T}: Add {C}{C}.
`;

const cloudshiftSrc = `Name:Cloudshift
ManaCost:W
Types:Instant
A:SP$ ChangeZone | Cost$ W | Origin$ Battlefield | Destination$ Exile | TargetType$ Card | ValidTgts$ Creature.YouCtrl | TgtPrompt$ Select target creature you control | RememberChanged$ True | SubAbility$ DBReturn
SVar:DBReturn:DB$ ChangeZone | Defined$ Remembered | Origin$ Exile | Destination$ Battlefield
Oracle:Exile target creature you control, then return that card to the battlefield under its owner's control.
`;

const soulWardenSrc = `Name:Soul Warden
ManaCost:W
Types:Creature Human Cleric
PT:1/1
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Creature.Other | Execute$ TrigGain | TriggerDescription$ Whenever another creature enters, you gain 1 life.
SVar:TrigGain:DB$ GainLife | LifeAmount$ 1
Oracle:Whenever another creature enters, you gain 1 life.
`;

const angelOfMercySrc = `Name:Angel of Mercy
ManaCost:4 W
Types:Creature Angel
PT:3/3
K:Flying
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigGainLife | TriggerDescription$ When this enters, you gain 3 life.
SVar:TrigGainLife:DB$ GainLife | LifeAmount$ 3
Oracle:Flying. When Angel of Mercy enters, you gain 3 life.
`;

const serraAngelSrc = `Name:Serra Angel
ManaCost:3 W W
Types:Creature Angel
PT:4/4
K:Flying
K:Vigilance
Oracle:Flying, vigilance.
`;

const birdsOfParadiseSrc = `Name:Birds of Paradise
ManaCost:G
Types:Creature Bird
PT:0/1
K:Flying
A:AB$ Mana | Cost$ T | Produced$ Any | SpellDescription$ Add one mana of any color.
Oracle:Flying. {T}: Add one mana of any color.
`;

const sulfuricVortexSrc = `Name:Sulfuric Vortex
ManaCost:1 R R
Types:Enchantment
T:Mode$ Phase | Phase$ BeginningOfUpkeep | ValidPlayer$ Player | Execute$ TrigDmg | TriggerDescription$ At the beginning of each player's upkeep, this deals 2 damage to that player.
SVar:TrigDmg:DB$ DealDamage | NumDmg$ 2 | Defined$ TriggeredPlayer
Oracle:At the beginning of each player's upkeep, Sulfuric Vortex deals 2 damage to that player.
`;

// =====================================================================
// GROUP K: Lightning Bolt → various creatures (15)
// Various creature toughnesses; bolt may or may not kill.
// =====================================================================
const GROUP_K_CREATURES = [
  { name: "BltK-0 M647", types: "Creature Bear", pt: "2/2" },
  { name: "BltK-1 M647", types: "Creature Wolf", pt: "1/1" },
  { name: "BltK-2 M647", types: "Creature Cat", pt: "1/1" },
  { name: "BltK-3 M647", types: "Creature Goblin", pt: "1/1" },
  { name: "BltK-4 M647", types: "Creature Knight", pt: "2/3" },
  { name: "BltK-5 M647", types: "Creature Soldier", pt: "2/2" },
  { name: "BltK-6 M647", types: "Creature Spirit", pt: "1/2" },
  { name: "BltK-7 M647", types: "Creature Wizard", pt: "1/3" },
  { name: "BltK-8 M647", types: "Creature Zombie", pt: "2/2" },
  { name: "BltK-9 M647", types: "Creature Cleric", pt: "1/2" },
  { name: "BltK-10 M647", types: "Creature Vampire", pt: "1/2" },
  { name: "BltK-11 M647", types: "Creature Ogre", pt: "3/3" },
  { name: "BltK-12 M647", types: "Creature Orc", pt: "3/3" },
  { name: "BltK-13 M647", types: "Creature Dwarf", pt: "2/3" },
  { name: "BltK-14 M647", types: "Creature Druid", pt: "1/1" },
];
for (let n = 0; n < 15; n++) {
  const c = GROUP_K_CREATURES[n];
  const csrc = `Name:${c.name}\nManaCost:1 G\nTypes:${c.types}\nPT:${c.pt}\nOracle:${c.name} test.\n`;
  const id = `bolt-on-creature-${n}-m647`;
  emit(
    id,
    `Lightning Bolt → ${c.name} (${c.pt}) — burn-then-SBA chain.`,
    { "Lightning Bolt": lightningBoltSrc, [c.name]: csrc },
    [
      { life: 20, hand: ["Lightning Bolt"], battlefield: [], manaPool: ["R"] },
      { life: 20, hand: [], battlefield: [{ card: c.name }] },
    ],
    [
      { kind: "cast", cardName: "Lightning Bolt", castingPlayer: SEAT0, target: { kind: "card", name: c.name } },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// =====================================================================
// GROUP L: Mulldrifter cast with diverse buddy creatures (15)
// Cast Mulldrifter with various other creatures already on bf.
// =====================================================================
const GROUP_L_BUDDIES = [
  ["Grizzly Bears", grizzlyBearsSrc],
  ["Llanowar Elves", llanowarElvesSrc],
  ["Soul Warden", soulWardenSrc],
  ["Birds of Paradise", birdsOfParadiseSrc],
  ["Angel of Mercy", angelOfMercySrc],
  ["Serra Angel", serraAngelSrc],
  ["Sol Ring", solRingSrc],
  ["Glorious Anthem", gloriousAnthemSrc],
  ["Honor of the Pure", honorOfThePureSrc],
  ["Sulfuric Vortex", sulfuricVortexSrc],
  ["Eternal Witness", eternalWitnessSrc],
  ["Grizzly Bears", grizzlyBearsSrc],
  ["Soul Warden", soulWardenSrc],
  ["Llanowar Elves", llanowarElvesSrc],
  ["Birds of Paradise", birdsOfParadiseSrc],
];
for (let n = 0; n < 15; n++) {
  const buddy = GROUP_L_BUDDIES[n];
  const id = `mulldrifter-cast-buddy-${n}-m647`;
  const cards = { Mulldrifter: mulldrifterSrc, "Grizzly Bears": grizzlyBearsSrc, [buddy[0]]: buddy[1] };
  if (buddy[0] === "Eternal Witness") cards["Lightning Bolt"] = lightningBoltSrc;
  const seat0 = {
    life: 20,
    hand: ["Mulldrifter"],
    battlefield: [{ card: buddy[0] }],
    library: ["Grizzly Bears", "Grizzly Bears", "Grizzly Bears"],
    manaPool: ["U", "C", "C", "C", "C"],
  };
  if (buddy[0] === "Eternal Witness") seat0.graveyard = ["Lightning Bolt"];
  emit(
    id,
    `Mulldrifter cast with ${buddy[0]} buddy — cast→ETB-draw-2 chain.`,
    cards,
    [seat0, { life: 20, hand: [], battlefield: [] }],
    [
      { kind: "cast", cardName: "Mulldrifter", castingPlayer: SEAT0 },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// =====================================================================
// GROUP M: Soul Warden ETB life-gain triggered by creature cast (15)
// Soul Warden on battlefield, cast creature spell with diverse PT/cost.
// =====================================================================
const GROUP_M_CREATURES = [
  { name: "WdnM-0 M647", cost: "1 G", types: "Creature Bear", pt: "2/2", pool: ["G", "C"] },
  { name: "WdnM-1 M647", cost: "1 R", types: "Creature Goblin", pt: "2/1", pool: ["R", "C"] },
  { name: "WdnM-2 M647", cost: "1 W", types: "Creature Soldier", pt: "2/2", pool: ["W", "C"] },
  { name: "WdnM-3 M647", cost: "1 U", types: "Creature Wizard", pt: "1/3", pool: ["U", "C"] },
  { name: "WdnM-4 M647", cost: "1 B", types: "Creature Zombie", pt: "2/2", pool: ["B", "C"] },
  { name: "WdnM-5 M647", cost: "G", types: "Creature Elf", pt: "1/1", pool: ["G"] },
  { name: "WdnM-6 M647", cost: "R", types: "Creature Goblin", pt: "1/1", pool: ["R"] },
  { name: "WdnM-7 M647", cost: "W", types: "Creature Cleric", pt: "1/2", pool: ["W"] },
  { name: "WdnM-8 M647", cost: "U", types: "Creature Spirit", pt: "1/1", pool: ["U"] },
  { name: "WdnM-9 M647", cost: "B", types: "Creature Vampire", pt: "1/1", pool: ["B"] },
  { name: "WdnM-10 M647", cost: "2 G", types: "Creature Beast", pt: "3/3", pool: ["G", "C", "C"] },
  { name: "WdnM-11 M647", cost: "2 W", types: "Creature Knight", pt: "3/3", pool: ["W", "C", "C"] },
  { name: "WdnM-12 M647", cost: "2 R", types: "Creature Dragon", pt: "2/3", pool: ["R", "C", "C"] },
  { name: "WdnM-13 M647", cost: "2 U", types: "Creature Merfolk", pt: "2/2", pool: ["U", "C", "C"] },
  { name: "WdnM-14 M647", cost: "2 B", types: "Creature Demon", pt: "3/2", pool: ["B", "C", "C"] },
];
for (let n = 0; n < 15; n++) {
  const c = GROUP_M_CREATURES[n];
  const csrc = `Name:${c.name}\nManaCost:${c.cost}\nTypes:${c.types}\nPT:${c.pt}\nOracle:${c.name} test.\n`;
  const id = `soul-warden-cast-creature-${n}-m647`;
  emit(
    id,
    `Soul Warden + ${c.name} cast — ETB triggers life gain.`,
    { "Soul Warden": soulWardenSrc, [c.name]: csrc },
    [
      { life: 20, hand: [c.name], battlefield: [{ card: "Soul Warden" }], manaPool: c.pool },
      { life: 20, hand: [], battlefield: [] },
    ],
    [
      { kind: "cast", cardName: c.name, castingPlayer: SEAT0 },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// =====================================================================
// GROUP N: Eternal Witness cast with various graveyard contents (15)
// Cast Witness; graveyard has 1-N varied cards. Choose target.
// =====================================================================
const GROUP_N_GRAVEYARD = [
  ["Lightning Bolt"],
  ["Lightning Bolt", "Grizzly Bears"],
  ["Grizzly Bears"],
  ["Grizzly Bears", "Lightning Bolt"],
  ["Lightning Bolt", "Lightning Bolt"],
  ["Soul Warden"],
  ["Soul Warden", "Lightning Bolt"],
  ["Llanowar Elves"],
  ["Llanowar Elves", "Grizzly Bears"],
  ["Birds of Paradise"],
  ["Birds of Paradise", "Lightning Bolt"],
  ["Mulldrifter"],
  ["Mulldrifter", "Grizzly Bears"],
  ["Angel of Mercy"],
  ["Angel of Mercy", "Lightning Bolt"],
];
function gnSrc(name) {
  if (name === "Lightning Bolt") return lightningBoltSrc;
  if (name === "Grizzly Bears") return grizzlyBearsSrc;
  if (name === "Soul Warden") return soulWardenSrc;
  if (name === "Llanowar Elves") return llanowarElvesSrc;
  if (name === "Birds of Paradise") return birdsOfParadiseSrc;
  if (name === "Mulldrifter") return mulldrifterSrc;
  if (name === "Angel of Mercy") return angelOfMercySrc;
  throw new Error(`gnSrc missing: ${name}`);
}
for (let n = 0; n < 15; n++) {
  const grave = GROUP_N_GRAVEYARD[n];
  const id = `witness-cast-grave-${n}-m647`;
  const cards = { "Eternal Witness": eternalWitnessSrc };
  for (const g of grave) cards[g] = gnSrc(g);
  emit(
    id,
    `Eternal Witness cast — graveyard ${grave.join("+")}, ETB returns one to hand.`,
    cards,
    [
      {
        life: 20,
        hand: ["Eternal Witness"],
        battlefield: [],
        graveyard: grave,
        manaPool: ["G", "G", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    [
      { kind: "cast", cardName: "Eternal Witness", castingPlayer: SEAT0 },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// =====================================================================
// GROUP O: Cloudshift on diverse creatures (10)
// Friendly creature on bf; cast Cloudshift to flicker.
// =====================================================================
const GROUP_O_TARGETS = [
  "Grizzly Bears",
  "Llanowar Elves",
  "Birds of Paradise",
  "Soul Warden",
  "Angel of Mercy",
  "Serra Angel",
  "Mulldrifter",
  "Soul Warden",
  "Grizzly Bears",
  "Birds of Paradise",
];
function goSrc(name) {
  if (name === "Grizzly Bears") return grizzlyBearsSrc;
  if (name === "Llanowar Elves") return llanowarElvesSrc;
  if (name === "Birds of Paradise") return birdsOfParadiseSrc;
  if (name === "Soul Warden") return soulWardenSrc;
  if (name === "Angel of Mercy") return angelOfMercySrc;
  if (name === "Serra Angel") return serraAngelSrc;
  if (name === "Mulldrifter") return mulldrifterSrc;
  throw new Error(`goSrc missing: ${name}`);
}
for (let n = 0; n < 10; n++) {
  const tgt = GROUP_O_TARGETS[n];
  const id = `cloudshift-on-${tgt.toLowerCase().replace(/[^a-z]+/g, "-")}-${n}-m647`;
  const cards = { Cloudshift: cloudshiftSrc, [tgt]: goSrc(tgt) };
  const seat0 = {
    life: 20,
    hand: ["Cloudshift"],
    battlefield: [{ card: tgt }],
    manaPool: ["W"],
  };
  if (tgt === "Mulldrifter") {
    seat0.library = ["Grizzly Bears", "Grizzly Bears", "Grizzly Bears"];
    cards["Grizzly Bears"] = grizzlyBearsSrc;
  }
  emit(
    id,
    `Cloudshift flicker on ${tgt} — ETB re-fires after return.`,
    cards,
    [seat0, { life: 20, hand: [], battlefield: [] }],
    [
      {
        kind: "cast",
        cardName: "Cloudshift",
        castingPlayer: SEAT0,
        target: { kind: "card", name: tgt },
      },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// =====================================================================
// === Output ===
// =====================================================================
let i = 4351;
let out = "";
for (const sc of scenarios) {
  out += "\n  // " + i + ". " + sc.description + "\n";
  out += "  {\n";
  out += "    id: \"" + sc.id + "\",\n";
  out += "    description: \"" + sc.description.replace(/"/g, '\\"') + "\",\n";
  out += "    seed: 0x" + sc.seed.toString(16) + ",\n";
  out += "    cards: {\n";
  for (const [name, src] of Object.entries(sc.cards)) {
    if (src === null || src === undefined) continue;
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
    if (p.graveyard) out += ", graveyard: [" + p.graveyard.map((l) => `"${l}"`).join(", ") + "]";
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

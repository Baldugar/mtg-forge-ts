#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Generator for M6.46 wave: deeper varied scenarios with rich event chains.
// Each scenario should produce 5+ events on both sides (TS and Java parity).
//
// Groups:
//   A: Soul Warden + creature ETB cast — multi-trigger chain (15)
//   B: Sulfuric Vortex co-residence + ETBs — SVortex pre-trigger setup (10)
//   C: Lightning Bolt → opposing X-toughness — SBA dies chain (12)
//   D: Cloudshift + ETB-trigger creature flicker re-trigger (10)
//   E: Multi-card co-residence — 3+ permanents on the battlefield (12)
//   F: Sol Ring activate then cast generic spell — activated→cast chain (10)
//   G: Llanowar Elves activate → cast green creature (10)
//   H: Mulldrifter cast → resolve → draw chain (8)
//   I: Eternal Witness with populated graveyard — resolve→return (8)
//   J: Glorious Anthem + Honor co-residence + creature cast — anthem stacking (10)
//
// Total: 105 scenarios.
//
// Append starts at index 4246. Last m645 seed: 0xc88b → start at 0xc88c.

const SEAT0 = "SEAT0";
const SEAT1 = "SEAT1";

const scenarios = [];
let seedCur = 0xc88c;
function emit(id, description, cards, players, actions) {
  scenarios.push({ id, description, seed: seedCur++, cards, players, actions });
}

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

const sulfuricVortexSrc = `Name:Sulfuric Vortex
ManaCost:1 R R
Types:Enchantment
T:Mode$ Phase | Phase$ BeginningOfUpkeep | ValidPlayer$ Player | Execute$ TrigDmg | TriggerDescription$ At the beginning of each player's upkeep, this deals 2 damage to that player.
SVar:TrigDmg:DB$ DealDamage | NumDmg$ 2 | Defined$ TriggeredPlayer
Oracle:At the beginning of each player's upkeep, Sulfuric Vortex deals 2 damage to that player.
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

const llanowarMentorSrc = `Name:Birds of Paradise
ManaCost:G
Types:Creature Bird
PT:0/1
K:Flying
A:AB$ Mana | Cost$ T | Produced$ Any | SpellDescription$ Add one mana of any color.
Oracle:Flying. {T}: Add one mana of any color.
`;

// =====================================================================
// GROUP A: Soul Warden + creature ETB cast — multi-trigger chain (15)
// Soul Warden on battlefield, cast a creature spell. ETB triggers
// Soul Warden's life-gain. Rich event chain: cast events + resolve +
// ETB trigger + GainLife.
// =====================================================================
const GROUP_A_CREATURES = [
  { name: "GrizA-0 M646", types: "Creature Bear", pt: "2/2", cost: "1 G", pool: ["G", "C"] },
  { name: "GrizA-1 M646", types: "Creature Wolf", pt: "2/2", cost: "1 G", pool: ["G", "C"] },
  { name: "GrizA-2 M646", types: "Creature Elf", pt: "1/1", cost: "G", pool: ["G"] },
  { name: "GrizA-3 M646", types: "Creature Soldier", pt: "2/2", cost: "1 W", pool: ["W", "C"] },
  { name: "GrizA-4 M646", types: "Creature Knight", pt: "2/2", cost: "1 W", pool: ["W", "C"] },
  { name: "GrizA-5 M646", types: "Creature Goblin", pt: "1/1", cost: "R", pool: ["R"] },
  { name: "GrizA-6 M646", types: "Creature Goblin", pt: "2/1", cost: "1 R", pool: ["R", "C"] },
  { name: "GrizA-7 M646", types: "Creature Zombie", pt: "2/2", cost: "1 B", pool: ["B", "C"] },
  { name: "GrizA-8 M646", types: "Creature Vampire", pt: "1/2", cost: "1 B", pool: ["B", "C"] },
  { name: "GrizA-9 M646", types: "Creature Spirit", pt: "1/1", cost: "U", pool: ["U"] },
  { name: "GrizA-10 M646", types: "Creature Wizard", pt: "2/1", cost: "1 U", pool: ["U", "C"] },
  { name: "GrizA-11 M646", types: "Creature Cat", pt: "2/2", cost: "1 W", pool: ["W", "C"] },
  { name: "GrizA-12 M646", types: "Creature Spider", pt: "1/3", cost: "2 G", pool: ["G", "C", "C"] },
  { name: "GrizA-13 M646", types: "Creature Beast", pt: "3/3", cost: "2 G", pool: ["G", "C", "C"] },
  { name: "GrizA-14 M646", types: "Creature Druid", pt: "1/2", cost: "1 G", pool: ["G", "C"] },
];
for (let n = 0; n < 15; n++) {
  const c = GROUP_A_CREATURES[n];
  const csrc = `Name:${c.name}\nManaCost:${c.cost}\nTypes:${c.types}\nPT:${c.pt}\nOracle:${c.name} test.\n`;
  const id = `soul-warden-creature-cast-${n}-m646`;
  emit(
    id,
    `Soul Warden + ${c.name} cast — multi-trigger life-gain chain.`,
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
// GROUP B: Sulfuric Vortex co-residence + creature ETBs (10)
// Sulfuric Vortex on battlefield, cast a creature/ETB spell. The
// SVortex Phase trigger is registered (latent) but the cast events +
// resolve + ETB still fire. Tests trigger registry stability under
// co-residence with phase-driven triggers.
// =====================================================================
const GROUP_B_CREATURES = [
  { name: "VtxB-0 M646", types: "Creature Bear", pt: "2/2", cost: "1 G", pool: ["G", "C"] },
  { name: "VtxB-1 M646", types: "Creature Soldier", pt: "2/2", cost: "1 W", pool: ["W", "C"] },
  { name: "VtxB-2 M646", types: "Creature Goblin", pt: "1/1", cost: "R", pool: ["R"] },
  { name: "VtxB-3 M646", types: "Creature Zombie", pt: "2/2", cost: "1 B", pool: ["B", "C"] },
  { name: "VtxB-4 M646", types: "Creature Wizard", pt: "1/2", cost: "U", pool: ["U"] },
  { name: "VtxB-5 M646", types: "Creature Knight", pt: "2/2", cost: "1 W", pool: ["W", "C"] },
  { name: "VtxB-6 M646", types: "Creature Beast", pt: "3/3", cost: "2 G", pool: ["G", "C", "C"] },
  { name: "VtxB-7 M646", types: "Creature Cleric", pt: "1/2", cost: "W", pool: ["W"] },
  { name: "VtxB-8 M646", types: "Creature Spirit", pt: "1/1", cost: "U", pool: ["U"] },
  { name: "VtxB-9 M646", types: "Creature Vampire", pt: "1/2", cost: "1 B", pool: ["B", "C"] },
];
for (let n = 0; n < 10; n++) {
  const c = GROUP_B_CREATURES[n];
  const csrc = `Name:${c.name}\nManaCost:${c.cost}\nTypes:${c.types}\nPT:${c.pt}\nOracle:${c.name} test.\n`;
  const id = `sulfuric-vortex-creature-cast-${n}-m646`;
  emit(
    id,
    `Sulfuric Vortex co-residence + ${c.name} cast — phase trigger latent.`,
    { "Sulfuric Vortex": sulfuricVortexSrc, [c.name]: csrc },
    [
      { life: 20, hand: [c.name], battlefield: [{ card: "Sulfuric Vortex" }], manaPool: c.pool },
      { life: 20, hand: [], battlefield: [] },
    ],
    [
      { kind: "cast", cardName: c.name, castingPlayer: SEAT0 },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// =====================================================================
// GROUP C: Lightning Bolt → opposing 1/2/3-toughness — SBA-dies chain (12)
// Cast Lightning Bolt at opposing creature; if its toughness <= 3 it
// dies via SBA after damage resolves. Rich chain: cast + resolve +
// DealDamage + LifeChange + SBA destroy + CardChangedZone (graveyard).
// =====================================================================
const GROUP_C_CREATURES = [
  { name: "BltC-0 M646", types: "Creature Bear", pt: "2/2" },
  { name: "BltC-1 M646", types: "Creature Wolf", pt: "1/1" },
  { name: "BltC-2 M646", types: "Creature Elf", pt: "1/1" },
  { name: "BltC-3 M646", types: "Creature Soldier", pt: "2/2" },
  { name: "BltC-4 M646", types: "Creature Knight", pt: "2/3" },
  { name: "BltC-5 M646", types: "Creature Goblin", pt: "1/1" },
  { name: "BltC-6 M646", types: "Creature Goblin", pt: "2/1" },
  { name: "BltC-7 M646", types: "Creature Spirit", pt: "1/1" },
  { name: "BltC-8 M646", types: "Creature Cat", pt: "2/2" },
  { name: "BltC-9 M646", types: "Creature Wizard", pt: "1/3" },
  { name: "BltC-10 M646", types: "Creature Cleric", pt: "1/2" },
  { name: "BltC-11 M646", types: "Creature Vampire", pt: "1/2" },
];
for (let n = 0; n < 12; n++) {
  const c = GROUP_C_CREATURES[n];
  const csrc = `Name:${c.name}\nManaCost:1 G\nTypes:${c.types}\nPT:${c.pt}\nOracle:${c.name} test.\n`;
  const id = `lightning-bolt-kills-creature-${n}-m646`;
  emit(
    id,
    `Lightning Bolt → opposing ${c.name} (${c.pt}) — damage + SBA dies chain.`,
    { "Lightning Bolt": lightningBoltSrc, [c.name]: csrc },
    [
      { life: 20, hand: ["Lightning Bolt"], battlefield: [], manaPool: ["R"] },
      { life: 20, hand: [], battlefield: [{ card: c.name }] },
    ],
    [
      {
        kind: "cast",
        cardName: "Lightning Bolt",
        castingPlayer: SEAT0,
        target: { kind: "card", name: c.name },
      },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// =====================================================================
// GROUP D: Cloudshift on ETB-trigger creature — flicker re-trigger (10)
// Friendly ETB-creature in play; cast Cloudshift at it. Cast +
// resolve exiles + returns; the return path re-fires the ETB trigger.
// Rich chain: cast + resolve + ChangeZone (out) + ChangeZone (in) +
// trigger fires + GainLife.
// =====================================================================
const GROUP_D_TARGETS = [
  "Angel of Mercy", "Soul Warden", "Mulldrifter", "Eternal Witness",
  "Angel of Mercy", "Soul Warden", "Mulldrifter", "Eternal Witness",
  "Angel of Mercy", "Soul Warden",
];
const GROUP_D_BUDDIES = [
  null, null, "Grizzly Bears", "Lightning Bolt",
  "Grizzly Bears", "Grizzly Bears", null, "Lightning Bolt",
  null, "Grizzly Bears",
];
function gdSrc(name) {
  if (name === "Angel of Mercy") return angelOfMercySrc;
  if (name === "Soul Warden") return soulWardenSrc;
  if (name === "Mulldrifter") return mulldrifterSrc;
  if (name === "Eternal Witness") return eternalWitnessSrc;
  if (name === "Grizzly Bears") return grizzlyBearsSrc;
  if (name === "Lightning Bolt") return lightningBoltSrc;
  throw new Error(`gdSrc missing: ${name}`);
}
for (let n = 0; n < 10; n++) {
  const tgt = GROUP_D_TARGETS[n];
  const buddy = GROUP_D_BUDDIES[n];
  const id = `cloudshift-flicker-${tgt.toLowerCase().replace(/[^a-z]+/g, "-")}-${n}-m646`;
  const cards = { Cloudshift: cloudshiftSrc, [tgt]: gdSrc(tgt) };
  const seat0Block = {
    life: 20,
    hand: ["Cloudshift"],
    battlefield: [{ card: tgt }],
    manaPool: ["W"],
  };
  // Mulldrifter / Eternal Witness need draw / graveyard targets; provide one.
  if (tgt === "Mulldrifter") {
    seat0Block.library = ["Grizzly Bears", "Grizzly Bears", "Grizzly Bears"];
    cards["Grizzly Bears"] = grizzlyBearsSrc;
  }
  if (tgt === "Eternal Witness") {
    seat0Block.graveyard = ["Lightning Bolt"];
    cards["Lightning Bolt"] = lightningBoltSrc;
  }
  if (buddy && !cards[buddy]) cards[buddy] = gdSrc(buddy);
  if (buddy && buddy !== "Lightning Bolt") {
    // Inject the buddy on the battlefield as another permanent.
    seat0Block.battlefield = [...seat0Block.battlefield, { card: buddy }];
  }
  emit(
    id,
    `Cloudshift flicker on ${tgt} — ETB re-fires after return.`,
    cards,
    [seat0Block, { life: 20, hand: [], battlefield: [] }],
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
// GROUP E: Multi-card co-residence (3+ permanents) (12)
// Several permanents already on the battlefield; cast one more spell.
// Tests static layer + trigger registry stability under crowded BF.
// =====================================================================
const GROUP_E = [
  {
    id: "trio-anthem-honor-bears-m646",
    desc: "Glorious Anthem + Honor of the Pure + Grizzly Bears co-residence; cast Lightning Bolt at opp.",
    cards: { "Glorious Anthem": gloriousAnthemSrc, "Honor of the Pure": honorOfThePureSrc, "Grizzly Bears": grizzlyBearsSrc, "Lightning Bolt": lightningBoltSrc },
    bf0: ["Glorious Anthem", "Honor of the Pure", "Grizzly Bears"],
    hand0: ["Lightning Bolt"],
    pool: ["R"],
    castName: "Lightning Bolt",
    target: { kind: "player", seat: SEAT1 },
  },
  {
    id: "trio-soul-warden-mentor-bears-m646",
    desc: "Soul Warden + Birds of Paradise + Grizzly Bears co-residence; cast Lightning Bolt at opp.",
    cards: { "Soul Warden": soulWardenSrc, "Birds of Paradise": llanowarMentorSrc, "Grizzly Bears": grizzlyBearsSrc, "Lightning Bolt": lightningBoltSrc },
    bf0: ["Soul Warden", "Birds of Paradise", "Grizzly Bears"],
    hand0: ["Lightning Bolt"],
    pool: ["R"],
    castName: "Lightning Bolt",
    target: { kind: "player", seat: SEAT1 },
  },
  {
    id: "trio-anthem-soul-warden-bears-cast-bears-m646",
    desc: "Glorious Anthem + Soul Warden + Grizzly Bears co-residence; cast a fresh Grizzly Bears.",
    cards: { "Glorious Anthem": gloriousAnthemSrc, "Soul Warden": soulWardenSrc, "Grizzly Bears": grizzlyBearsSrc },
    bf0: ["Glorious Anthem", "Soul Warden", "Grizzly Bears"],
    hand0: ["Grizzly Bears"],
    pool: ["G", "C"],
    castName: "Grizzly Bears",
    target: undefined,
  },
  {
    id: "trio-anthem-mentor-llanowar-cast-bears-m646",
    desc: "Glorious Anthem + Birds of Paradise + Llanowar Elves co-residence; cast Grizzly Bears.",
    cards: { "Glorious Anthem": gloriousAnthemSrc, "Birds of Paradise": llanowarMentorSrc, "Llanowar Elves": llanowarElvesSrc, "Grizzly Bears": grizzlyBearsSrc },
    bf0: ["Glorious Anthem", "Birds of Paradise", "Llanowar Elves"],
    hand0: ["Grizzly Bears"],
    pool: ["G", "C"],
    castName: "Grizzly Bears",
    target: undefined,
  },
  {
    id: "trio-soul-warden-anthem-honor-cast-bears-m646",
    desc: "Soul Warden + Glorious Anthem + Honor of the Pure co-residence; cast Grizzly Bears.",
    cards: { "Soul Warden": soulWardenSrc, "Glorious Anthem": gloriousAnthemSrc, "Honor of the Pure": honorOfThePureSrc, "Grizzly Bears": grizzlyBearsSrc },
    bf0: ["Soul Warden", "Glorious Anthem", "Honor of the Pure"],
    hand0: ["Grizzly Bears"],
    pool: ["G", "C"],
    castName: "Grizzly Bears",
    target: undefined,
  },
  {
    id: "trio-anthem-honor-soul-warden-cast-serra-m646",
    desc: "Anthem + Honor + Soul Warden trio; cast Serra Angel — multi-anthem layered + life-gain chain.",
    cards: { "Glorious Anthem": gloriousAnthemSrc, "Honor of the Pure": honorOfThePureSrc, "Soul Warden": soulWardenSrc, "Serra Angel": serraAngelSrc },
    bf0: ["Glorious Anthem", "Honor of the Pure", "Soul Warden"],
    hand0: ["Serra Angel"],
    pool: ["W", "W", "C", "C", "C"],
    castName: "Serra Angel",
    target: undefined,
  },
  {
    id: "trio-vortex-anthem-bears-cast-bears-m646",
    desc: "Sulfuric Vortex + Glorious Anthem + Grizzly Bears co-residence; cast another Grizzly Bears.",
    cards: { "Sulfuric Vortex": sulfuricVortexSrc, "Glorious Anthem": gloriousAnthemSrc, "Grizzly Bears": grizzlyBearsSrc },
    bf0: ["Sulfuric Vortex", "Glorious Anthem", "Grizzly Bears"],
    hand0: ["Grizzly Bears"],
    pool: ["G", "C"],
    castName: "Grizzly Bears",
    target: undefined,
  },
  {
    id: "trio-anthem-mentor-bears-cast-bolt-creature-m646",
    desc: "Anthem + Birds + Bears trio; cast Lightning Bolt at opposing Grizzly Bears.",
    cards: { "Glorious Anthem": gloriousAnthemSrc, "Birds of Paradise": llanowarMentorSrc, "Grizzly Bears": grizzlyBearsSrc, "Lightning Bolt": lightningBoltSrc },
    bf0: ["Glorious Anthem", "Birds of Paradise", "Grizzly Bears"],
    bf1: ["Grizzly Bears"],
    hand0: ["Lightning Bolt"],
    pool: ["R"],
    castName: "Lightning Bolt",
    target: { kind: "card", name: "Grizzly Bears" },
  },
  {
    id: "trio-soul-warden-vortex-bears-cast-angel-m646",
    desc: "Soul Warden + Vortex + Bears co-residence; cast Angel of Mercy — life-gain pile-up.",
    cards: { "Soul Warden": soulWardenSrc, "Sulfuric Vortex": sulfuricVortexSrc, "Grizzly Bears": grizzlyBearsSrc, "Angel of Mercy": angelOfMercySrc },
    bf0: ["Soul Warden", "Sulfuric Vortex", "Grizzly Bears"],
    hand0: ["Angel of Mercy"],
    pool: ["W", "C", "C", "C", "C"],
    castName: "Angel of Mercy",
    target: undefined,
  },
  {
    id: "trio-llanowar-mentor-bears-cast-mulldrifter-m646",
    desc: "Llanowar Elves + Birds + Bears trio; cast Mulldrifter (mana-sourced via pool).",
    cards: { "Llanowar Elves": llanowarElvesSrc, "Birds of Paradise": llanowarMentorSrc, "Grizzly Bears": grizzlyBearsSrc, Mulldrifter: mulldrifterSrc },
    bf0: ["Llanowar Elves", "Birds of Paradise", "Grizzly Bears"],
    hand0: ["Mulldrifter"],
    pool: ["U", "C", "C", "C", "C"],
    castName: "Mulldrifter",
    target: undefined,
    libraries: { 0: ["Grizzly Bears", "Grizzly Bears", "Grizzly Bears"] },
  },
  {
    id: "trio-anthem-soul-warden-witness-cast-witness-m646",
    desc: "Anthem + Soul Warden + Eternal Witness trio; cast another Witness with bolt in graveyard.",
    cards: { "Glorious Anthem": gloriousAnthemSrc, "Soul Warden": soulWardenSrc, "Eternal Witness": eternalWitnessSrc, "Lightning Bolt": lightningBoltSrc },
    bf0: ["Glorious Anthem", "Soul Warden", "Eternal Witness"],
    hand0: ["Eternal Witness"],
    pool: ["G", "G", "C"],
    castName: "Eternal Witness",
    target: undefined,
    graveyards: { 0: ["Lightning Bolt"] },
  },
  {
    id: "trio-anthem-mentor-llanowar-cast-bolt-player-m646",
    desc: "Anthem + Birds + Llanowar trio; cast Lightning Bolt at opp seat.",
    cards: { "Glorious Anthem": gloriousAnthemSrc, "Birds of Paradise": llanowarMentorSrc, "Llanowar Elves": llanowarElvesSrc, "Lightning Bolt": lightningBoltSrc },
    bf0: ["Glorious Anthem", "Birds of Paradise", "Llanowar Elves"],
    hand0: ["Lightning Bolt"],
    pool: ["R"],
    castName: "Lightning Bolt",
    target: { kind: "player", seat: SEAT1 },
  },
];
for (let n = 0; n < GROUP_E.length; n++) {
  const e = GROUP_E[n];
  const seat0 = {
    life: 20,
    hand: e.hand0,
    battlefield: e.bf0.map((c) => ({ card: c })),
    manaPool: e.pool,
  };
  if (e.libraries && e.libraries[0]) seat0.library = e.libraries[0];
  if (e.graveyards && e.graveyards[0]) seat0.graveyard = e.graveyards[0];
  const seat1 = {
    life: 20,
    hand: [],
    battlefield: e.bf1 ? e.bf1.map((c) => ({ card: c })) : [],
  };
  const cast = { kind: "cast", cardName: e.castName, castingPlayer: SEAT0 };
  if (e.target) cast.target = e.target;
  emit(e.id, e.desc, e.cards, [seat0, seat1], [cast, { kind: "resolveTopOfStack" }]);
}

// =====================================================================
// GROUP F: Sol Ring activate then ... (10)
// Sol Ring on battlefield untapped; activate the {T} mana ability.
// Tests activated→stack→mana production chain. With drainStack on, the
// mana ability resolves silently via the runner's CR-605.3a path.
// =====================================================================
const GROUP_F_VARIANTS = [
  { tag: "0", note: "vanilla" },
  { tag: "1", note: "with-bears-buddy" },
  { tag: "2", note: "with-anthem-buddy" },
  { tag: "3", note: "with-honor-buddy" },
  { tag: "4", note: "with-vortex-buddy" },
  { tag: "5", note: "with-soul-warden-buddy" },
  { tag: "6", note: "with-witness-buddy" },
  { tag: "7", note: "with-mentor-buddy" },
  { tag: "8", note: "with-llanowar-buddy" },
  { tag: "9", note: "with-mercy-buddy" },
];
const GROUP_F_BUDDIES = {
  vanilla: null,
  "with-bears-buddy": ["Grizzly Bears", grizzlyBearsSrc],
  "with-anthem-buddy": ["Glorious Anthem", gloriousAnthemSrc],
  "with-honor-buddy": ["Honor of the Pure", honorOfThePureSrc],
  "with-vortex-buddy": ["Sulfuric Vortex", sulfuricVortexSrc],
  "with-soul-warden-buddy": ["Soul Warden", soulWardenSrc],
  "with-witness-buddy": ["Eternal Witness", eternalWitnessSrc],
  "with-mentor-buddy": ["Birds of Paradise", llanowarMentorSrc],
  "with-llanowar-buddy": ["Llanowar Elves", llanowarElvesSrc],
  "with-mercy-buddy": ["Angel of Mercy", angelOfMercySrc],
};
for (const v of GROUP_F_VARIANTS) {
  const id = `sol-ring-activate-${v.tag}-${v.note}-m646`;
  const cards = { "Sol Ring": solRingSrc };
  const bf = [{ card: "Sol Ring" }];
  const buddy = GROUP_F_BUDDIES[v.note];
  if (buddy) {
    cards[buddy[0]] = buddy[1];
    bf.push({ card: buddy[0] });
  }
  emit(
    id,
    `Sol Ring activate (${v.note}) — mana ability activation chain.`,
    cards,
    [{ life: 20, hand: [], battlefield: bf }, { life: 20, hand: [], battlefield: [] }],
    [{ kind: "activate", sourceCardName: "Sol Ring", activatingPlayer: SEAT0 }],
  );
}

// =====================================================================
// GROUP G: Llanowar Elves activate (10)
// Friendly Llanowar Elves untapped; activate {T}: Add {G}.
// =====================================================================
for (let n = 0; n < 10; n++) {
  const v = GROUP_F_VARIANTS[n];
  const id = `llanowar-elves-activate-${v.tag}-${v.note}-m646`;
  const cards = { "Llanowar Elves": llanowarElvesSrc };
  const bf = [{ card: "Llanowar Elves" }];
  const buddy = GROUP_F_BUDDIES[v.note];
  if (buddy && buddy[0] !== "Llanowar Elves") {
    cards[buddy[0]] = buddy[1];
    bf.push({ card: buddy[0] });
  }
  emit(
    id,
    `Llanowar Elves activate (${v.note}) — {T}: Add {G}.`,
    cards,
    [{ life: 20, hand: [], battlefield: bf }, { life: 20, hand: [], battlefield: [] }],
    [{ kind: "activate", sourceCardName: "Llanowar Elves", activatingPlayer: SEAT0 }],
  );
}

// =====================================================================
// GROUP H: Mulldrifter cast → resolve → draw 2 chain (8)
// Cast Mulldrifter via pool, resolve. ETB trigger draws 2.
// Co-residence variants for static layer noise.
// =====================================================================
const GROUP_H_VARIANTS = [
  { tag: "0", note: "vanilla" },
  { tag: "1", note: "with-bears-buddy" },
  { tag: "2", note: "with-anthem-buddy" },
  { tag: "3", note: "with-honor-buddy" },
  { tag: "4", note: "with-soul-warden-buddy" },
  { tag: "5", note: "with-witness-buddy" },
  { tag: "6", note: "with-mentor-buddy" },
  { tag: "7", note: "with-llanowar-buddy" },
];
for (const v of GROUP_H_VARIANTS) {
  const id = `mulldrifter-cast-${v.tag}-${v.note}-m646`;
  const cards = { Mulldrifter: mulldrifterSrc, "Grizzly Bears": grizzlyBearsSrc };
  const bf = [];
  const buddy = GROUP_F_BUDDIES[v.note];
  if (buddy) {
    cards[buddy[0]] = buddy[1];
    if (v.note !== "with-bears-buddy") {
      bf.push({ card: buddy[0] });
    } else {
      bf.push({ card: "Grizzly Bears" });
    }
  }
  emit(
    id,
    `Mulldrifter cast (${v.note}) — cast→resolve→draw-2 chain.`,
    cards,
    [
      {
        life: 20,
        hand: ["Mulldrifter"],
        battlefield: bf,
        library: ["Grizzly Bears", "Grizzly Bears", "Grizzly Bears"],
        manaPool: ["U", "C", "C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    [
      { kind: "cast", cardName: "Mulldrifter", castingPlayer: SEAT0 },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// =====================================================================
// GROUP I: Eternal Witness cast → resolve → return chain (8)
// Cast Eternal Witness via pool with bolt in graveyard. Resolve →
// ETB trigger fires → return Lightning Bolt to hand.
// =====================================================================
const GROUP_I_VARIANTS = [
  { tag: "0", note: "vanilla" },
  { tag: "1", note: "with-anthem-buddy" },
  { tag: "2", note: "with-honor-buddy" },
  { tag: "3", note: "with-soul-warden-buddy" },
  { tag: "4", note: "with-vortex-buddy" },
  { tag: "5", note: "with-mentor-buddy" },
  { tag: "6", note: "with-llanowar-buddy" },
  { tag: "7", note: "with-mercy-buddy" },
];
for (const v of GROUP_I_VARIANTS) {
  const id = `eternal-witness-cast-${v.tag}-${v.note}-m646`;
  const cards = { "Eternal Witness": eternalWitnessSrc, "Lightning Bolt": lightningBoltSrc };
  const bf = [];
  const buddy = GROUP_F_BUDDIES[v.note];
  if (buddy) {
    cards[buddy[0]] = buddy[1];
    bf.push({ card: buddy[0] });
  }
  emit(
    id,
    `Eternal Witness cast (${v.note}) — cast→resolve→return-bolt chain.`,
    cards,
    [
      {
        life: 20,
        hand: ["Eternal Witness"],
        battlefield: bf,
        graveyard: ["Lightning Bolt"],
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
// GROUP J: Anthem stack + opposing creature creation (10)
// Glorious Anthem + Honor of the Pure (or other anthem) on battlefield;
// player2 has a creature. We cast a creature on side 1 — anthem stacks
// for our side, opponent's stays vanilla. Tests static-layer correctness
// across controllers.
// =====================================================================
const GROUP_J_CASTERS = [
  { name: "Grizzly Bears", src: grizzlyBearsSrc, pool: ["G", "C"] },
  { name: "Soul Warden", src: soulWardenSrc, pool: ["W"] },
  { name: "Birds of Paradise", src: llanowarMentorSrc, pool: ["G"] },
  { name: "Llanowar Elves", src: llanowarElvesSrc, pool: ["G"] },
  { name: "Eternal Witness", src: eternalWitnessSrc, pool: ["G", "G", "C"] },
  { name: "Angel of Mercy", src: angelOfMercySrc, pool: ["W", "C", "C", "C", "C"] },
  { name: "Serra Angel", src: serraAngelSrc, pool: ["W", "W", "C", "C", "C"] },
  { name: "Grizzly Bears", src: grizzlyBearsSrc, pool: ["G", "C"] },
  { name: "Soul Warden", src: soulWardenSrc, pool: ["W"] },
  { name: "Eternal Witness", src: eternalWitnessSrc, pool: ["G", "G", "C"] },
];
const GROUP_J_OPPS = [
  "Grizzly Bears", "Grizzly Bears", "Grizzly Bears", "Grizzly Bears",
  "Grizzly Bears", "Grizzly Bears", "Grizzly Bears", "Grizzly Bears",
  "Grizzly Bears", "Grizzly Bears",
];
for (let n = 0; n < 10; n++) {
  const c = GROUP_J_CASTERS[n];
  const opp = GROUP_J_OPPS[n];
  const id = `anthem-cross-controller-cast-${n}-m646`;
  const cards = {
    "Glorious Anthem": gloriousAnthemSrc,
    [c.name]: c.src,
    [opp]: opp === "Grizzly Bears" ? grizzlyBearsSrc : null,
  };
  if (c.name === "Eternal Witness") cards["Lightning Bolt"] = lightningBoltSrc;
  const seat0Block = {
    life: 20,
    hand: [c.name],
    battlefield: [{ card: "Glorious Anthem" }],
    manaPool: c.pool,
  };
  if (c.name === "Eternal Witness") seat0Block.graveyard = ["Lightning Bolt"];
  const seat1Block = {
    life: 20,
    hand: [],
    battlefield: [{ card: opp }],
  };
  emit(
    id,
    `Anthem cross-controller — cast ${c.name} our side, opp has ${opp}.`,
    cards,
    [seat0Block, seat1Block],
    [
      { kind: "cast", cardName: c.name, castingPlayer: SEAT0 },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// =====================================================================
// === Output ===
// Append starting at index 4246 (last m645 is at 4245).
// =====================================================================
let i = 4246;
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

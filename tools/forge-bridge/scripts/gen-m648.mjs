#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Generator for M6.48 wave: action-driven scenarios building on M6.47 base.
//
// Groups:
//   P: Lightning Bolt → player target (diverse setups, 10)
//   Q: Sol Ring activation with diverse boardstates (10)
//   R: Llanowar Elves activation with diverse boardstates (10)
//   S: Cloudshift on diverse creatures with non-creature buddies (10)
//   T: Cast Mulldrifter with diverse libraries — draw outcomes vary (10)
//
// Total: 50 scenarios.
// Append starts at index 4421. Last m647 seed: 0xd049 (cloudshift-on-bop-9).

const SEAT0 = "SEAT0";
const SEAT1 = "SEAT1";

const scenarios = [];
let seedCur = 0xd100;
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

const solRingSrc = `Name:Sol Ring
ManaCost:1
Types:Artifact
A:AB$ Mana | Cost$ T | Produced$ C | Amount$ 2 | SpellDescription$ Add {C}{C}.
Oracle:{T}: Add {C}{C}.
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

const gloriousAnthemSrc = `Name:Glorious Anthem
ManaCost:1 W W
Types:Enchantment
S:Mode$ Continuous | Affected$ Creature.YouCtrl | AddPower$ 1 | AddToughness$ 1 | Description$ Creatures you control get +1/+1.
Oracle:Creatures you control get +1/+1.
`;

const cloudshiftSrc = `Name:Cloudshift
ManaCost:W
Types:Instant
A:SP$ ChangeZone | Cost$ W | Origin$ Battlefield | Destination$ Exile | TargetType$ Card | ValidTgts$ Creature.YouCtrl | TgtPrompt$ Select target creature you control | RememberChanged$ True | SubAbility$ DBReturn
SVar:DBReturn:DB$ ChangeZone | Defined$ Remembered | Origin$ Exile | Destination$ Battlefield
Oracle:Exile target creature you control, then return that card to the battlefield under its owner's control.
`;

const honorOfThePureSrc = `Name:Honor of the Pure
ManaCost:1 W W
Types:Enchantment
S:Mode$ Continuous | Affected$ Creature.White+YouCtrl | AddPower$ 1 | AddToughness$ 1 | Description$ White creatures you control get +1/+1.
Oracle:White creatures you control get +1/+1.
`;

// =====================================================================
// GROUP P: Lightning Bolt → player target with diverse boardstates (10)
// =====================================================================
const GROUP_P_BUDDIES = [
  ["Grizzly Bears", grizzlyBearsSrc],
  ["Llanowar Elves", llanowarElvesSrc],
  ["Sol Ring", solRingSrc],
  ["Soul Warden", soulWardenSrc],
  ["Birds of Paradise", birdsOfParadiseSrc],
  ["Serra Angel", serraAngelSrc],
  ["Angel of Mercy", angelOfMercySrc],
  ["Glorious Anthem", gloriousAnthemSrc],
  ["Honor of the Pure", honorOfThePureSrc],
  ["Mulldrifter", mulldrifterSrc],
];
for (let n = 0; n < 10; n++) {
  const [bname, bsrc] = GROUP_P_BUDDIES[n];
  const id = `bolt-on-player-${n}-m648`;
  const cards = { "Lightning Bolt": lightningBoltSrc };
  // Buddy on opponent's side so Bolt's player-target reads cleanly.
  cards[bname] = bsrc;
  emit(
    id,
    `Lightning Bolt → opponent — burn-to-face with ${bname} buddy on bf.`,
    cards,
    [
      { life: 20, hand: ["Lightning Bolt"], battlefield: [], manaPool: ["R"] },
      { life: 20, hand: [], battlefield: [{ card: bname }] },
    ],
    [
      { kind: "cast", cardName: "Lightning Bolt", castingPlayer: SEAT0, target: { kind: "player", seat: SEAT1 } },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// =====================================================================
// GROUP Q: Sol Ring activation with diverse boardstates (10)
// =====================================================================
const GROUP_Q_BUDDIES = [
  ["Grizzly Bears", grizzlyBearsSrc],
  ["Llanowar Elves", llanowarElvesSrc],
  ["Soul Warden", soulWardenSrc],
  ["Angel of Mercy", angelOfMercySrc],
  ["Serra Angel", serraAngelSrc],
  ["Birds of Paradise", birdsOfParadiseSrc],
  ["Glorious Anthem", gloriousAnthemSrc],
  ["Honor of the Pure", honorOfThePureSrc],
  ["Mulldrifter", mulldrifterSrc],
  ["Cloudshift", cloudshiftSrc],
];
for (let n = 0; n < 10; n++) {
  const [bname, bsrc] = GROUP_Q_BUDDIES[n];
  const id = `sol-ring-tap-with-${bname.toLowerCase().replace(/[^a-z]+/g, "-")}-${n}-m648`;
  const cards = { "Sol Ring": solRingSrc };
  // Cloudshift goes in hand (it's an instant), others on battlefield.
  if (bname === "Cloudshift") {
    cards[bname] = bsrc;
    emit(
      id,
      `Sol Ring activate with ${bname} in hand — mana ability.`,
      cards,
      [
        { life: 20, hand: [bname], battlefield: [{ card: "Sol Ring" }] },
        { life: 20, hand: [], battlefield: [] },
      ],
      [{ kind: "activate", sourceCardName: "Sol Ring", activatingPlayer: SEAT0 }],
    );
    continue;
  }
  cards[bname] = bsrc;
  emit(
    id,
    `Sol Ring activate with ${bname} buddy — mana ability.`,
    cards,
    [
      { life: 20, hand: [], battlefield: [{ card: "Sol Ring" }, { card: bname }] },
      { life: 20, hand: [], battlefield: [] },
    ],
    [{ kind: "activate", sourceCardName: "Sol Ring", activatingPlayer: SEAT0 }],
  );
}

// =====================================================================
// GROUP R: Llanowar Elves activation with diverse boardstates (10)
// =====================================================================
const GROUP_R_BUDDIES = [
  ["Grizzly Bears", grizzlyBearsSrc],
  ["Sol Ring", solRingSrc],
  ["Soul Warden", soulWardenSrc],
  ["Angel of Mercy", angelOfMercySrc],
  ["Serra Angel", serraAngelSrc],
  ["Birds of Paradise", birdsOfParadiseSrc],
  ["Glorious Anthem", gloriousAnthemSrc],
  ["Honor of the Pure", honorOfThePureSrc],
  ["Mulldrifter", mulldrifterSrc],
  ["Cloudshift", cloudshiftSrc],
];
for (let n = 0; n < 10; n++) {
  const [bname, bsrc] = GROUP_R_BUDDIES[n];
  const id = `llanowar-elves-tap-with-${bname.toLowerCase().replace(/[^a-z]+/g, "-")}-${n}-m648`;
  const cards = { "Llanowar Elves": llanowarElvesSrc };
  if (bname === "Cloudshift") {
    cards[bname] = bsrc;
    emit(
      id,
      `Llanowar Elves activate with ${bname} in hand — mana ability.`,
      cards,
      [
        { life: 20, hand: [bname], battlefield: [{ card: "Llanowar Elves" }] },
        { life: 20, hand: [], battlefield: [] },
      ],
      [{ kind: "activate", sourceCardName: "Llanowar Elves", activatingPlayer: SEAT0 }],
    );
    continue;
  }
  cards[bname] = bsrc;
  emit(
    id,
    `Llanowar Elves activate with ${bname} buddy — mana ability.`,
    cards,
    [
      { life: 20, hand: [], battlefield: [{ card: "Llanowar Elves" }, { card: bname }] },
      { life: 20, hand: [], battlefield: [] },
    ],
    [{ kind: "activate", sourceCardName: "Llanowar Elves", activatingPlayer: SEAT0 }],
  );
}

// =====================================================================
// GROUP S: Cloudshift on diverse creatures with non-creature buddies (10)
// =====================================================================
const GROUP_S_TARGETS_BUDDIES = [
  // [target name, target src, buddy name, buddy src]
  ["Grizzly Bears", grizzlyBearsSrc, "Sol Ring", solRingSrc],
  ["Llanowar Elves", llanowarElvesSrc, "Sol Ring", solRingSrc],
  ["Birds of Paradise", birdsOfParadiseSrc, "Sol Ring", solRingSrc],
  ["Soul Warden", soulWardenSrc, "Glorious Anthem", gloriousAnthemSrc],
  ["Angel of Mercy", angelOfMercySrc, "Glorious Anthem", gloriousAnthemSrc],
  ["Serra Angel", serraAngelSrc, "Honor of the Pure", honorOfThePureSrc],
  ["Mulldrifter", mulldrifterSrc, "Honor of the Pure", honorOfThePureSrc],
  ["Grizzly Bears", grizzlyBearsSrc, "Glorious Anthem", gloriousAnthemSrc],
  ["Llanowar Elves", llanowarElvesSrc, "Glorious Anthem", gloriousAnthemSrc],
  ["Soul Warden", soulWardenSrc, "Sol Ring", solRingSrc],
];
for (let n = 0; n < 10; n++) {
  const [tname, tsrc, bname, bsrc] = GROUP_S_TARGETS_BUDDIES[n];
  const id = `cloudshift-with-${bname.toLowerCase().replace(/[^a-z]+/g, "-")}-on-${tname.toLowerCase().replace(/[^a-z]+/g, "-")}-${n}-m648`;
  const cards = { Cloudshift: cloudshiftSrc, [tname]: tsrc, [bname]: bsrc };
  const seat0 = {
    life: 20,
    hand: ["Cloudshift"],
    battlefield: [{ card: tname }, { card: bname }],
    manaPool: ["W"],
  };
  if (tname === "Mulldrifter") {
    seat0.library = ["Grizzly Bears", "Grizzly Bears", "Grizzly Bears"];
    cards["Grizzly Bears"] = grizzlyBearsSrc;
  }
  emit(
    id,
    `Cloudshift flicker on ${tname} with ${bname} static buddy — ETB re-fires.`,
    cards,
    [seat0, { life: 20, hand: [], battlefield: [] }],
    [
      { kind: "cast", cardName: "Cloudshift", castingPlayer: SEAT0, target: { kind: "card", name: tname } },
      { kind: "resolveTopOfStack" },
    ],
  );
}

// =====================================================================
// GROUP T: Cast Mulldrifter with diverse libraries (10)
// Library contents vary so the draw-2 produces different deck states.
// =====================================================================
const GROUP_T_LIBRARIES = [
  ["Grizzly Bears", "Lightning Bolt", "Sol Ring"],
  ["Sol Ring", "Llanowar Elves", "Grizzly Bears"],
  ["Grizzly Bears", "Grizzly Bears", "Lightning Bolt"],
  ["Lightning Bolt", "Lightning Bolt", "Grizzly Bears"],
  ["Llanowar Elves", "Soul Warden", "Birds of Paradise"],
  ["Birds of Paradise", "Sol Ring", "Grizzly Bears"],
  ["Soul Warden", "Soul Warden", "Llanowar Elves"],
  ["Glorious Anthem", "Honor of the Pure", "Sol Ring"],
  ["Cloudshift", "Cloudshift", "Lightning Bolt"],
  ["Serra Angel", "Angel of Mercy", "Grizzly Bears"],
];
function tSrc(name) {
  if (name === "Grizzly Bears") return grizzlyBearsSrc;
  if (name === "Lightning Bolt") return lightningBoltSrc;
  if (name === "Sol Ring") return solRingSrc;
  if (name === "Llanowar Elves") return llanowarElvesSrc;
  if (name === "Soul Warden") return soulWardenSrc;
  if (name === "Birds of Paradise") return birdsOfParadiseSrc;
  if (name === "Glorious Anthem") return gloriousAnthemSrc;
  if (name === "Honor of the Pure") return honorOfThePureSrc;
  if (name === "Cloudshift") return cloudshiftSrc;
  if (name === "Serra Angel") return serraAngelSrc;
  if (name === "Angel of Mercy") return angelOfMercySrc;
  throw new Error(`tSrc missing: ${name}`);
}
for (let n = 0; n < 10; n++) {
  const lib = GROUP_T_LIBRARIES[n];
  const id = `mulldrifter-cast-lib-${n}-m648`;
  const cards = { Mulldrifter: mulldrifterSrc };
  for (const c of lib) cards[c] = tSrc(c);
  emit(
    id,
    `Mulldrifter cast — library [${lib.join(",")}] — ETB-draw-2 chain.`,
    cards,
    [
      {
        life: 20,
        hand: ["Mulldrifter"],
        battlefield: [],
        library: lib,
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
// === Output ===
// =====================================================================
let i = 4421;
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

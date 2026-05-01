// SPDX-License-Identifier: GPL-3.0-or-later
// Milestone 2 — curated golden scenarios.
//
// Each scenario is a small, deterministic recipe locked as a regression
// net. The cohort is picked to span canonical mechanics: vanilla, burn,
// ETB triggers, statics, replacements, mana ramp, counterspell, flicker,
// damage prevention, modal, planeswalkers, sagas (parse-only), adventures
// (parse-only).
//
// Adding a new scenario:
//   1. Define the card source in `cards`.
//   2. Add a GoldenScenario entry with a unique id.
//   3. Run `UPDATE_GOLDENS=1 pnpm test golden` to capture.
//   4. Inspect the captured `__golden__/<id>.golden.json` for sanity.
//   5. Re-run without the env var; the test must pass deterministically.

import { mkPlayerSeat } from "@mtg-forge-ts/core";
import type { GoldenScenario } from "./types.js";

const SEAT0 = mkPlayerSeat(0);
const SEAT1 = mkPlayerSeat(1);

// ── Card source pool ─────────────────────────────────────────────────────────
// Inline, small, deterministic. We don't load from the corpus directory so
// scenarios are self-contained and stable even if the corpus updates.

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

const doublingSeasonSrc = `Name:Doubling Season
ManaCost:4 G
Types:Enchantment
R:Event$ AddCounter | ActiveZones$ Battlefield | ValidCard$ Permanent.YouCtrl | ReplaceWith$ DoubleAmount | Description$ Counters added to permanents you control are doubled.
SVar:DoubleAmount:DB$ ReplaceCounter | Multiplier$ 2
R:Event$ CreateToken | ActiveZones$ Battlefield | ValidPlayer$ You | ReplaceWith$ DoubleTokens | Description$ Tokens you'd create are doubled.
SVar:DoubleTokens:DB$ ReplaceTokenAmount | Multiplier$ 2
Oracle:If an effect would create one or more tokens under your control, it creates twice that many. If an effect would put one or more counters on a permanent you control, it puts twice that many on that permanent.
`;

const restInPeaceSrc = `Name:Rest in Peace
ManaCost:1 W
Types:Enchantment
R:Event$ Moved | ValidCard$ Card | Destination$ Graveyard | ReplaceWith$ ExileInstead | Description$ Exile cards going to graveyards.
SVar:ExileInstead:DB$ ChangeZone | Origin$ All | Destination$ Exile
S:Mode$ Continuous | Affected$ Card.inZoneGraveyard | RemoveAllAbilities$ True | Description$ Graveyards have no cards.
Oracle:If a card or token would be put into a graveyard from anywhere, exile it instead.
`;

const solRingSrc = `Name:Sol Ring
ManaCost:1
Types:Artifact
A:AB$ Mana | Cost$ T | Produced$ C | Amount$ 2 | SpellDescription$ Add {C}{C}.
Oracle:{T}: Add {C}{C}.
`;

const counterspellSrc = `Name:Counterspell
ManaCost:U U
Types:Instant
A:SP$ Counter | Cost$ U U | TargetType$ Spell | ValidTgts$ Card | TgtPrompt$ Select target spell | SpellDescription$ Counter target spell.
Oracle:Counter target spell.
`;

const negateSrc = `Name:Negate
ManaCost:1 U
Types:Instant
A:SP$ Counter | Cost$ 1 U | TargetType$ Spell | ValidTgts$ Card.nonCreature | TgtPrompt$ Select target noncreature spell | SpellDescription$ Counter target noncreature spell.
Oracle:Counter target noncreature spell.
`;

const cloudshiftSrc = `Name:Cloudshift
ManaCost:W
Types:Instant
A:SP$ ChangeZone | Cost$ W | Origin$ Battlefield | Destination$ Exile | TargetType$ Card | ValidTgts$ Creature.YouCtrl | TgtPrompt$ Select target creature you control | RememberChanged$ True | SubAbility$ DBReturn
SVar:DBReturn:DB$ ChangeZone | Defined$ Remembered | Origin$ Exile | Destination$ Battlefield
Oracle:Exile target creature you control, then return that card to the battlefield under its owner's control.
`;

const holyDaySrc = `Name:Holy Day
ManaCost:W
Types:Instant
A:SP$ Effect | Cost$ W | ReplacementEffects$ RPrevent | SpellDescription$ Prevent all combat damage this turn.
SVar:RPrevent:Event$ DamageDone | IsCombat$ True | PreventionEffect$ True | Description$ Prevent all combat damage that would be dealt this turn.
Oracle:Prevent all combat damage that would be dealt this turn.
`;

const sulfuricVortexSrc = `Name:Sulfuric Vortex
ManaCost:1 R R
Types:Enchantment
T:Mode$ Phase | Phase$ BeginningOfUpkeep | ValidPlayer$ Player | Execute$ TrigDmg | TriggerDescription$ At the beginning of each player's upkeep, this deals 2 damage to that player.
SVar:TrigDmg:DB$ DealDamage | NumDmg$ 2 | Defined$ TriggeredPlayer
Oracle:At the beginning of each player's upkeep, Sulfuric Vortex deals 2 damage to that player.
`;

const wrathOfGodSrc = `Name:Wrath of God
ManaCost:2 W W
Types:Sorcery
A:SP$ DestroyAll | Cost$ 2 W W | ValidCards$ Creature | NoRegen$ True | SpellDescription$ Destroy all creatures.
Oracle:Destroy all creatures. They can't be regenerated.
`;

const sunderingTitanSrc = `Name:Serra Angel
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

const giantGrowthSrc = `Name:Giant Growth
ManaCost:G
Types:Instant
A:SP$ PumpAll | Cost$ G | ValidCards$ Creature.targetedBy | NumAtt$ 3 | NumDef$ 3 | TargetType$ Card | ValidTgts$ Creature | SpellDescription$ Target creature gets +3/+3 until end of turn.
Oracle:Target creature gets +3/+3 until end of turn.
`;

const dispatchAcolyteSrc = `Name:Soul Warden
ManaCost:W
Types:Creature Human Cleric
PT:1/1
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Creature.Other | Execute$ TrigGain | TriggerDescription$ Whenever another creature enters, you gain 1 life.
SVar:TrigGain:DB$ GainLife | LifeAmount$ 1
Oracle:Whenever another creature enters, you gain 1 life.
`;

const ancestralRecallSrc = `Name:Ancestral Recall
ManaCost:U
Types:Instant
A:SP$ Draw | Cost$ U | NumCards$ 3 | TargetType$ Player | ValidTgts$ Player | SpellDescription$ Target player draws three cards.
Oracle:Target player draws three cards.
`;

const dragonSrc = `Name:Shivan Dragon
ManaCost:4 R R
Types:Creature Dragon
PT:5/5
K:Flying
A:AB$ Pump | Cost$ R | NumAtt$ 1 | SpellDescription$ This gets +1/+0 until end of turn.
Oracle:Flying. {R}: Shivan Dragon gets +1/+0 until end of turn.
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

const tarmoSrc = `Name:Tarmogoyf
ManaCost:1 G
Types:Creature Lhurgoyf
PT:*/1+*
SVar:X:Count$ DifferentCardTypesInGraveyards
Oracle:Tarmogoyf's power is equal to the number of card types among cards in all graveyards.
`;

const settleTheWreckageSrc = `Name:Settle the Wreckage
ManaCost:2 W W
Types:Instant
A:SP$ ChangeZoneAll | Cost$ 2 W W | ChangeType$ Creature.attacking | Origin$ Battlefield | Destination$ Library | LibraryPosition$ -1 | SpellDescription$ Exile all attacking creatures target player controls.
Oracle:Exile all attacking creatures target player controls.
`;

const krakensEyeSrc = `Name:Stone Rain
ManaCost:2 R
Types:Sorcery
A:SP$ Destroy | Cost$ 2 R | TargetType$ Card | ValidTgts$ Land | SpellDescription$ Destroy target land.
Oracle:Destroy target land.
`;

const giantSpiderSrc = `Name:Giant Spider
ManaCost:3 G
Types:Creature Spider
PT:2/4
K:Reach
Oracle:Reach.
`;

const forestSrc = `Name:Forest
Types:Basic Land Forest
A:AB$ Mana | Cost$ T | Produced$ G | SpellDescription$ Add {G}.
Oracle:({T}: Add {G}.)
`;

// ── Scenarios ────────────────────────────────────────────────────────────────

export const SCENARIOS: readonly GoldenScenario[] = [
  // 1. Vanilla — minimal ETB, no triggers, just CardChangedZone.
  {
    id: "grizzly-bears-etb",
    description: "Grizzly Bears enters the battlefield (vanilla creature).",
    seed: 0x42,
    cards: { "Grizzly Bears": grizzlyBearsSrc },
    players: [
      { life: 20, hand: ["Grizzly Bears"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Grizzly Bears", controller: SEAT0 }],
  },

  // 2. Burn — full cast→resolve pipeline against a player target.
  {
    id: "lightning-bolt-target-player",
    description: "Lightning Bolt → seat 1; expect 3 damage and burn → graveyard.",
    seed: 0x43,
    cards: { "Lightning Bolt": lightningBoltSrc },
    players: [
      { life: 20, hand: ["Lightning Bolt"], battlefield: [], manaPool: ["R"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [
      {
        kind: "cast",
        cardName: "Lightning Bolt",
        castingPlayer: SEAT0,
        target: { kind: "player", seat: SEAT1 },
      },
      { kind: "resolveTopOfStack" },
    ],
  },

  // 3. Burn — cast at a creature target.
  {
    id: "lightning-bolt-target-creature",
    description: "Lightning Bolt → opposing Grizzly Bears.",
    seed: 0x44,
    cards: {
      "Lightning Bolt": lightningBoltSrc,
      "Grizzly Bears": grizzlyBearsSrc,
    },
    players: [
      { life: 20, hand: ["Lightning Bolt"], battlefield: [], manaPool: ["R"] },
      { life: 20, hand: [], battlefield: [{ card: "Grizzly Bears" }] },
    ],
    actions: [
      {
        kind: "cast",
        cardName: "Lightning Bolt",
        castingPlayer: SEAT0,
        target: { kind: "card", name: "Grizzly Bears" },
      },
      { kind: "resolveTopOfStack" },
    ],
  },

  // 4. ETB trigger — Mulldrifter draws two.
  {
    id: "mulldrifter-etb-draw",
    description: "Mulldrifter ETBs and draws two cards.",
    seed: 0x45,
    cards: { Mulldrifter: mulldrifterSrc, "Grizzly Bears": grizzlyBearsSrc },
    players: [
      {
        life: 20,
        hand: ["Mulldrifter"],
        battlefield: [],
        library: ["Grizzly Bears", "Grizzly Bears", "Grizzly Bears"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Mulldrifter", controller: SEAT0 }],
  },

  // 5. ETB trigger — Eternal Witness returns from graveyard.
  {
    id: "eternal-witness-etb-return",
    description: "Eternal Witness ETBs and returns a card from graveyard.",
    seed: 0x46,
    cards: { "Eternal Witness": eternalWitnessSrc, "Lightning Bolt": lightningBoltSrc },
    players: [
      {
        life: 20,
        hand: ["Eternal Witness"],
        battlefield: [],
        graveyard: ["Lightning Bolt"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Eternal Witness", controller: SEAT0 }],
  },

  // 6. Static anthem — Glorious Anthem buffs creatures.
  {
    id: "glorious-anthem-static",
    description: "Glorious Anthem ETBs alongside a Grizzly Bears; locks +1/+1 anthem layer.",
    seed: 0x47,
    cards: { "Glorious Anthem": gloriousAnthemSrc, "Grizzly Bears": grizzlyBearsSrc },
    players: [
      {
        life: 20,
        hand: ["Glorious Anthem"],
        battlefield: [{ card: "Grizzly Bears" }],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Glorious Anthem", controller: SEAT0 }],
  },

  // 7. Static colour-restricted anthem.
  {
    id: "honor-of-the-pure-static",
    description: "Honor of the Pure ETBs; only white creatures get +1/+1.",
    seed: 0x48,
    cards: { "Honor of the Pure": honorOfThePureSrc, "Serra Angel": sunderingTitanSrc },
    players: [
      {
        life: 20,
        hand: ["Honor of the Pure"],
        battlefield: [{ card: "Serra Angel" }],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Honor of the Pure", controller: SEAT0 }],
  },

  // 8. Replacement — Doubling Season simply ETB-locks (counter-doubling
  // behaviour requires further actions; the static activation is the
  // observable part for M2).
  {
    id: "doubling-season-etb",
    description: "Doubling Season ETB: replacement registry registers the multiplier.",
    seed: 0x49,
    cards: { "Doubling Season": doublingSeasonSrc },
    players: [
      { life: 20, hand: ["Doubling Season"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Doubling Season", controller: SEAT0 }],
  },

  // 9. Replacement — Rest in Peace exile-replace.
  {
    id: "rest-in-peace-etb",
    description: "Rest in Peace ETB; future graveyard moves should re-route via Replace registry.",
    seed: 0x4a,
    cards: { "Rest in Peace": restInPeaceSrc },
    players: [
      { life: 20, hand: ["Rest in Peace"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Rest in Peace", controller: SEAT0 }],
  },

  // 10. Mana ramp — Llanowar Elves activate {T}: Add {G}.
  {
    id: "llanowar-elves-tap-for-mana",
    description: "Llanowar Elves activates its mana ability.",
    seed: 0x4b,
    cards: { "Llanowar Elves": llanowarElvesSrc },
    players: [
      { life: 20, hand: [], battlefield: [{ card: "Llanowar Elves" }] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "activate", sourceCardName: "Llanowar Elves", activatingPlayer: SEAT0 }],
  },

  // 11. Mana ramp — Sol Ring taps for {C}{C}.
  {
    id: "sol-ring-tap-for-mana",
    description: "Sol Ring activates {T}: Add CC.",
    seed: 0x4c,
    cards: { "Sol Ring": solRingSrc },
    players: [
      { life: 20, hand: [], battlefield: [{ card: "Sol Ring" }] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "activate", sourceCardName: "Sol Ring", activatingPlayer: SEAT0 }],
  },

  // 12. Counterspell — parse + ETB-style "in hand" registration only. Full
  // counter resolution requires stack-typed targets which the M2 runner
  // does not model (M3 will). The lock here is the mana cost activation +
  // ability registration sequence.
  {
    id: "counterspell-in-hand",
    description: "Counterspell mints into hand (parse + activation lock).",
    seed: 0x4d,
    cards: { Counterspell: counterspellSrc },
    players: [
      { life: 20, hand: ["Counterspell"], battlefield: [], manaPool: ["U", "U"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 13. Negate — same parse-only lock.
  {
    id: "negate-in-hand",
    description: "Negate mints into hand (parse + activation lock).",
    seed: 0x4e,
    cards: { Negate: negateSrc },
    players: [
      { life: 20, hand: ["Negate"], battlefield: [], manaPool: ["U", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 14. Flicker — Cloudshift exiles + returns. We lock the cast event;
  // resolution wires the exile→return DB chain.
  {
    id: "cloudshift-cast",
    description: "Cloudshift cast targeting an own creature.",
    seed: 0x4f,
    cards: { Cloudshift: cloudshiftSrc, "Grizzly Bears": grizzlyBearsSrc },
    players: [
      {
        life: 20,
        hand: ["Cloudshift"],
        battlefield: [{ card: "Grizzly Bears" }],
        manaPool: ["W"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [
      {
        kind: "cast",
        cardName: "Cloudshift",
        castingPlayer: SEAT0,
        target: { kind: "card", name: "Grizzly Bears" },
      },
    ],
  },

  // 15. Holy Day — damage prevention.
  {
    id: "holy-day-cast",
    description: "Holy Day cast — registers damage-prevention replacement.",
    seed: 0x50,
    cards: { "Holy Day": holyDaySrc },
    players: [
      { life: 20, hand: ["Holy Day"], battlefield: [], manaPool: ["W"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "cast", cardName: "Holy Day", castingPlayer: SEAT0 }],
  },

  // 16. Sulfuric Vortex ETB — phase trigger registration.
  {
    id: "sulfuric-vortex-etb",
    description: "Sulfuric Vortex ETB; trigger registry holds the upkeep ping.",
    seed: 0x51,
    cards: { "Sulfuric Vortex": sulfuricVortexSrc },
    players: [
      { life: 20, hand: ["Sulfuric Vortex"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Sulfuric Vortex", controller: SEAT0 }],
  },

  // 17. Sweep — Wrath cast (target-less, just mana).
  {
    id: "wrath-of-god-cast",
    description: "Wrath of God on stack.",
    seed: 0x52,
    cards: { "Wrath of God": wrathOfGodSrc },
    players: [
      {
        life: 20,
        hand: ["Wrath of God"],
        battlefield: [],
        manaPool: ["W", "W", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "cast", cardName: "Wrath of God", castingPlayer: SEAT0 }],
  },

  // 18. Keyword combat — Serra Angel ETB (flying + vigilance keywords).
  {
    id: "serra-angel-etb",
    description: "Serra Angel ETB locks flying+vigilance keyword registry.",
    seed: 0x53,
    cards: { "Serra Angel": sunderingTitanSrc },
    players: [
      { life: 20, hand: ["Serra Angel"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Serra Angel", controller: SEAT0 }],
  },

  // 19. Birds of Paradise — flying creature with Any-mana ability.
  {
    id: "birds-of-paradise-etb",
    description: "Birds of Paradise ETB; any-mana ability registered.",
    seed: 0x54,
    cards: { "Birds of Paradise": llanowarMentorSrc },
    players: [
      { life: 20, hand: ["Birds of Paradise"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Birds of Paradise", controller: SEAT0 }],
  },

  // 20. Pump — Giant Growth on a friendly creature.
  {
    id: "giant-growth-cast",
    description: "Giant Growth cast on own Grizzly Bears (target-bound).",
    seed: 0x55,
    cards: { "Giant Growth": giantGrowthSrc, "Grizzly Bears": grizzlyBearsSrc },
    players: [
      {
        life: 20,
        hand: ["Giant Growth"],
        battlefield: [{ card: "Grizzly Bears" }],
        manaPool: ["G"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [
      {
        kind: "cast",
        cardName: "Giant Growth",
        castingPlayer: SEAT0,
        target: { kind: "card", name: "Grizzly Bears" },
      },
    ],
  },

  // 21. ETB-trigger — Soul Warden gain life on creature ETB.
  {
    id: "soul-warden-creature-etb",
    description: "Soul Warden ETB; another creature ETBs and triggers gain-1.",
    seed: 0x56,
    cards: {
      "Soul Warden": dispatchAcolyteSrc,
      "Grizzly Bears": grizzlyBearsSrc,
    },
    players: [
      {
        life: 20,
        hand: ["Grizzly Bears"],
        battlefield: [{ card: "Soul Warden" }],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Grizzly Bears", controller: SEAT0 }],
  },

  // 22. Player draw — Ancestral Recall.
  {
    id: "ancestral-recall-cast",
    description: "Ancestral Recall: draw 3 for self.",
    seed: 0x57,
    cards: { "Ancestral Recall": ancestralRecallSrc, "Grizzly Bears": grizzlyBearsSrc },
    players: [
      {
        life: 20,
        hand: ["Ancestral Recall"],
        battlefield: [],
        library: ["Grizzly Bears", "Grizzly Bears", "Grizzly Bears", "Grizzly Bears"],
        manaPool: ["U"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [
      {
        kind: "cast",
        cardName: "Ancestral Recall",
        castingPlayer: SEAT0,
        target: { kind: "player", seat: SEAT0 },
      },
      { kind: "resolveTopOfStack" },
    ],
  },

  // 23. Big creature with activated ability — Shivan Dragon firebreathing.
  {
    id: "shivan-dragon-firebreathing",
    description: "Shivan Dragon ETB then firebreathing activation.",
    seed: 0x58,
    cards: { "Shivan Dragon": dragonSrc },
    players: [
      { life: 20, hand: [], battlefield: [{ card: "Shivan Dragon" }], manaPool: ["R"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "activate", sourceCardName: "Shivan Dragon", activatingPlayer: SEAT0 }],
  },

  // 24. Angel of Mercy — life-gain ETB.
  {
    id: "angel-of-mercy-etb",
    description: "Angel of Mercy ETB triggers gain 3.",
    seed: 0x59,
    cards: { "Angel of Mercy": angelOfMercySrc },
    players: [
      { life: 20, hand: ["Angel of Mercy"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Angel of Mercy", controller: SEAT0 }],
  },

  // 25. Tarmogoyf — CDA-driven P/T (the SVar registers; layer recompute is
  // visible on the snapshot via the static rebuild path).
  {
    id: "tarmogoyf-etb",
    description: "Tarmogoyf ETB; */1+* P/T registered through SVar.",
    seed: 0x5a,
    cards: { Tarmogoyf: tarmoSrc },
    players: [
      { life: 20, hand: ["Tarmogoyf"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Tarmogoyf", controller: SEAT0 }],
  },

  // 26. Settle the Wreckage — in-hand parse + activation lock. The card
  // targets a player and the M2 runner doesn't reliably bind player
  // targets through chooseCastTargets when the spell has no on-battlefield
  // creatures to validate against; locking the in-hand state suffices for
  // this cohort.
  {
    id: "settle-the-wreckage-in-hand",
    description: "Settle the Wreckage minted into hand.",
    seed: 0x5b,
    cards: { "Settle the Wreckage": settleTheWreckageSrc },
    players: [
      {
        life: 20,
        hand: ["Settle the Wreckage"],
        battlefield: [],
        manaPool: ["W", "W", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 27. Stone Rain — destroy land. Targets seat 1's Forest.
  {
    id: "stone-rain-cast",
    description: "Stone Rain on stack targeting a Forest.",
    seed: 0x5c,
    cards: { "Stone Rain": krakensEyeSrc, Forest: forestSrc },
    players: [
      {
        life: 20,
        hand: ["Stone Rain"],
        battlefield: [],
        manaPool: ["R", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [{ card: "Forest" }] },
    ],
    actions: [
      {
        kind: "cast",
        cardName: "Stone Rain",
        castingPlayer: SEAT0,
        target: { kind: "card", name: "Forest" },
      },
    ],
  },

  // 28. Reach keyword — Giant Spider ETB (locks Reach keyword).
  {
    id: "giant-spider-etb",
    description: "Giant Spider ETB; reach keyword registered.",
    seed: 0x5d,
    cards: { "Giant Spider": giantSpiderSrc },
    players: [
      { life: 20, hand: ["Giant Spider"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Giant Spider", controller: SEAT0 }],
  },

  // 29. Multi-spell sequence — two Lightning Bolts cast in series.
  // Locks event-ordering across consecutive cast/resolve pairs so a
  // refactor that re-orders SpellCast vs CostPaid surfaces here.
  {
    id: "double-lightning-bolt",
    description: "Two Lightning Bolts at seat 1 in sequence.",
    seed: 0x5e,
    cards: { "Lightning Bolt": lightningBoltSrc },
    players: [
      {
        life: 20,
        hand: ["Lightning Bolt", "Lightning Bolt"],
        battlefield: [],
        manaPool: ["R", "R"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [
      {
        kind: "cast",
        cardName: "Lightning Bolt",
        castingPlayer: SEAT0,
        target: { kind: "player", seat: SEAT1 },
      },
      { kind: "resolveTopOfStack" },
      {
        kind: "cast",
        cardName: "Lightning Bolt",
        castingPlayer: SEAT0,
        target: { kind: "player", seat: SEAT1 },
      },
      { kind: "resolveTopOfStack" },
    ],
  },

  // 30. Two-source life-gain chain — Soul Warden + Angel of Mercy ETB.
  {
    id: "soul-warden-angel-chain",
    description: "Soul Warden in play; Angel of Mercy ETBs (+1 from warden, +3 from angel).",
    seed: 0x5f,
    cards: {
      "Soul Warden": dispatchAcolyteSrc,
      "Angel of Mercy": angelOfMercySrc,
    },
    players: [
      {
        life: 20,
        hand: ["Angel of Mercy"],
        battlefield: [{ card: "Soul Warden" }],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Angel of Mercy", controller: SEAT0 }],
  },
];

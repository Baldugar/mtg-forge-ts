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
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigChangeZoneAll | TriggerDescription$ When CARDNAME enters, exile all graveyards.
SVar:TrigChangeZoneAll:DB$ ChangeZoneAll | ChangeType$ Card | Origin$ Graveyard | Destination$ Exile
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

// ── Tier 2 — known-tricky cards (M6) ─────────────────────────────────────────
// All sources are exact transcripts from the Forge corpus so the bridge
// (which loads cards by name from forge-gui/res/cardsfolder/) and the TS
// engine (which embeds the source verbatim) agree on every byte.

const phantasmalImageSrc = `Name:Phantasmal Image
ManaCost:1 U
Types:Creature Illusion
PT:0/0
K:ETBReplacement:Copy:DBCopy:Optional
SVar:DBCopy:DB$ Clone | Choices$ Creature.Other | AddTypes$ Illusion | AddTriggers$ PhantasmalImageTgtTrig | AddSVars$ PhantasmalImageSac,Targeting | SpellDescription$ You may have CARDNAME enter as a copy of any creature on the battlefield, except it's an Illusion in addition to its other types and it has "When this creature becomes the target of a spell or ability, sacrifice it."
SVar:PhantasmalImageTgtTrig:Mode$ BecomesTarget | ValidTarget$ Card.Self | Execute$ PhantasmalImageSac | TriggerDescription$ When this creature becomes the target of a spell or ability, sacrifice it.
SVar:PhantasmalImageSac:DB$ Sacrifice
SVar:Targeting:Dies
Oracle:You may have Phantasmal Image enter as a copy of any creature on the battlefield, except it's an Illusion in addition to its other types and it has "When this creature becomes the target of a spell or ability, sacrifice it."
`;

const phyrexianMetamorphSrc = `Name:Phyrexian Metamorph
ManaCost:3 UP
Types:Artifact Creature Phyrexian Shapeshifter
PT:0/0
K:ETBReplacement:Copy:DBCopy:Optional
SVar:DBCopy:DB$ Clone | Choices$ Creature.Other,Artifact.Other | AddTypes$ Artifact | SpellDescription$ You may have CARDNAME enter as a copy of any artifact or creature on the battlefield, except it's an artifact in addition to its other types.
Oracle:({U/P} can be paid with either {U} or 2 life.)\\nYou may have Phyrexian Metamorph enter as a copy of any artifact or creature on the battlefield, except it's an artifact in addition to its other types.
`;

const sakashimaImpostorSrc = `Name:Sakashima the Impostor
ManaCost:2 U U
Types:Legendary Creature Human Rogue
PT:3/1
K:ETBReplacement:Copy:DBCopy:Optional
SVar:DBCopy:DB$ Clone | Choices$ Creature.Other | NewName$ Sakashima the Impostor | AddTypes$ Legendary | AddAbilities$ ReturnSakashima | AddSVars$ TrigReturnSak | SpellDescription$ You may have CARDNAME enter as a copy of any creature on the battlefield, except its name is Sakashima the Impostor, it's legendary in addition to its other types, and it has "{2}{U}{U}: Return this creature to its owner's hand at the beginning of the next end step."
SVar:ReturnSakashima:AB$ DelayedTrigger | Cost$ 2 U U | Mode$ Phase | Phase$ End of Turn | Execute$ TrigReturnSak | SpellDescription$ Return CARDNAME to its owner's hand at the beginning of the next end step.
SVar:TrigReturnSak:DB$ ChangeZone | Defined$ Self | Origin$ Battlefield | Destination$ Hand
Oracle:You may have Sakashima the Impostor enter as a copy of any creature on the battlefield, except its name is Sakashima the Impostor, it's legendary in addition to its other types, and it has "{2}{U}{U}: Return this creature to its owner's hand at the beginning of the next end step."
`;

const gildedDrakeSrc = `Name:Gilded Drake
ManaCost:1 U
Types:Creature Drake
PT:3/3
K:Flying
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigExchange | TriggerDescription$ When CARDNAME enters, exchange control of CARDNAME and up to one target creature an opponent controls. If you don't or can't make an exchange, sacrifice CARDNAME. This ability still resolves if its target becomes illegal.
SVar:TrigExchange:DB$ ExchangeControl | Defined$ Self | ValidTgts$ Creature.OppCtrl | TgtPrompt$ Select target creature an opponent controls | TargetMin$ 0 | TargetMax$ 1 | CantFizzle$ True | SubAbility$ DBSacSelf
SVar:DBSacSelf:DB$ Sacrifice | ConditionDefined$ Self | ConditionPresent$ Card.YouCtrl
Oracle:Flying\\nWhen Gilded Drake enters, exchange control of Gilded Drake and up to one target creature an opponent controls. If you don't or can't make an exchange, sacrifice Gilded Drake. This ability still resolves if its target becomes illegal.
`;

const paintersServantSrc = `Name:Painter's Servant
ManaCost:2
Types:Artifact Creature Scarecrow
PT:1/3
K:ETBReplacement:Other:ChooseColor
SVar:ChooseColor:DB$ ChooseColor | Defined$ You | SpellDescription$ As CARDNAME enters, choose a color. | AILogic$ MostProminentKeywordInComputerDeck
S:Mode$ Continuous | Affected$ Card | AddColor$ ChosenColor | AffectedZone$ All | Description$ All cards that aren't on the battlefield, spells, and permanents are the chosen color in addition to their other colors.
Oracle:As Painter's Servant enters, choose a color.\\nAll cards that aren't on the battlefield, spells, and permanents are the chosen color in addition to their other colors.
`;

const krarksThumbSrc = `Name:Krark's Thumb
ManaCost:2
Types:Legendary Artifact
S:Mode$ Continuous | Affected$ You | AddKeyword$ If you would flip a coin, instead flip two coins and ignore one. | Description$ If you would flip a coin, instead flip two coins and ignore one.
Oracle:If you would flip a coin, instead flip two coins and ignore one.
`;

const humilitySrc = `Name:Humility
ManaCost:2 W W
Types:Enchantment
S:Mode$ Continuous | Affected$ Creature | SetPower$ 1 | SetToughness$ 1 | RemoveAllAbilities$ True | Description$ All creatures lose all abilities and have base power and toughness 1/1.
Oracle:All creatures lose all abilities and have base power and toughness 1/1.
`;

const worshipSrc = `Name:Worship
ManaCost:3 W
Types:Enchantment
R:Event$ LifeReduced | ActiveZones$ Battlefield | ValidPlayer$ You.lifeGE1 | Result$ LT1 | IsDamage$ True | IsPresent$ Creature.YouCtrl | ReplaceWith$ ReduceLoss | Description$ If you control a creature, damage that would reduce your life total to less than 1 reduces it to 1 instead.
SVar:ReduceLoss:DB$ ReplaceEffect | VarName$ Amount | VarValue$ X
SVar:X:ReplaceCount$Amount/LimitMax.Difference
SVar:Difference:Count$YourLifeTotal/Minus.1
Oracle:If you control a creature, damage that would reduce your life total to less than 1 reduces it to 1 instead.
`;

const sigardaHostHeronsSrc = `Name:Sigarda, Host of Herons
ManaCost:2 G W W
Types:Legendary Creature Angel
PT:5/5
K:Flying
K:Hexproof
S:Mode$ CantSacrifice | ValidCard$ Card.YouCtrl | ValidCause$ SpellAbility.OppCtrl | ForCost$ False | Description$ Spells and abilities your opponents control can't cause you to sacrifice permanents.
Oracle:Flying, hexproof\\nSpells and abilities your opponents control can't cause you to sacrifice permanents.
`;

const mirriWeatherlightSrc = `Name:Mirri, Weatherlight Duelist
ManaCost:1 G W
Types:Legendary Creature Cat Warrior
PT:3/2
K:First Strike
S:Mode$ AttackRestrict | IsPresent$ Card.Self+tapped | MaxAttackers$ 1 | ValidDefender$ You | Description$ As long as CARDNAME is tapped, no more than one creature can attack you each combat.
T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ TrigLimitBlock | TriggerZones$ Battlefield | TriggerDescription$ Whenever CARDNAME attacks, each opponent can't block with more than one creature this combat.
SVar:TrigLimitBlock:DB$ Effect | StaticAbilities$ STLimitBlock | Duration$ UntilEndOfCombat
SVar:STLimitBlock:Mode$ BlockRestrict | MaxBlockers$ 1 | ValidDefender$ Opponent | Description$ Each opponent can't block with more than one creature this combat.
Oracle:First strike\\nWhenever Mirri, Weatherlight Duelist attacks, each opponent can't block with more than one creature this combat.\\nAs long as Mirri, Weatherlight Duelist is tapped, no more than one creature can attack you each combat.
`;

const brothersYamazakiSrc = `Name:Brothers Yamazaki
ManaCost:2 R
Types:Legendary Creature Human Samurai
PT:2/1
K:Bushido:1
S:Mode$ IgnoreLegendRule | ValidCard$ Permanent.namedBrothers Yamazaki | IsPresent$ Permanent.namedBrothers Yamazaki | PresentCompare$ EQ2 | Description$ If there are exactly two permanents named Brothers Yamazaki on the battlefield, the "legend rule" doesn't apply to them.
S:Mode$ Continuous | Affected$ Creature.Other+namedBrothers Yamazaki | AddPower$ 2 | AddToughness$ 2 | AddKeyword$ Haste | Description$ Each other creature named Brothers Yamazaki gets +2/+2 and has haste.
Oracle:Bushido 1 (Whenever this creature blocks or becomes blocked, it gets +1/+1 until end of turn.)\\nIf there are exactly two permanents named Brothers Yamazaki on the battlefield, the "legend rule" doesn't apply to them.\\nEach other creature named Brothers Yamazaki gets +2/+2 and has haste.
`;

const aureliaWarleaderSrc = `Name:Aurelia, the Warleader
ManaCost:2 R R W W
Types:Legendary Creature Angel
PT:3/4
K:Flying
K:Vigilance
K:Haste
T:Mode$ Attacks | ValidCard$ Creature.Self | TriggerZones$ Battlefield | Execute$ TrigUntap | FirstAttack$ True | TriggerDescription$ Whenever CARDNAME attacks for the first time each turn, untap all creatures you control. After this phase, there is an additional combat phase.
SVar:TrigUntap:DB$ UntapAll | ValidCards$ Creature.YouCtrl | SubAbility$ DBAddCombat
SVar:DBAddCombat:DB$ AddPhase | ExtraPhase$ Combat | AfterPhase$ EndCombat
Oracle:Flying, vigilance, haste\\nWhenever Aurelia, the Warleader attacks for the first time each turn, untap all creatures you control. After this phase, there is an additional combat phase.
`;

const emptyTheWarrensSrc = `Name:Empty the Warrens
ManaCost:3 R
Types:Sorcery
A:SP$ Token | TokenAmount$ 2 | TokenScript$ r_1_1_goblin | TokenOwner$ You | SpellDescription$ Create two 1/1 red Goblin creature tokens.
K:Storm
Oracle:Create two 1/1 red Goblin creature tokens.\\nStorm (When you cast this spell, copy it for each spell cast before it this turn.)
`;

const stolenIdentitySrc = `Name:Stolen Identity
ManaCost:4 U U
Types:Sorcery
K:Cipher
A:SP$ CopyPermanent | ValidTgts$ Creature,Artifact | TgtPrompt$ Select target creature or artifact | SpellDescription$ Create a token that's a copy of target artifact or creature.
Oracle:Create a token that's a copy of target artifact or creature.\\nCipher (Then you may exile this spell card encoded on a creature you control. Whenever that creature deals combat damage to a player, its controller may cast a copy of the encoded card without paying its mana cost.)
`;

const glacialRaySrc = `Name:Glacial Ray
ManaCost:1 R
Types:Instant Arcane
K:Splice:Arcane:1 R
A:SP$ DealDamage | ValidTgts$ Any | NumDmg$ 2 | SpellDescription$ CARDNAME deals 2 damage to any target.
Oracle:Glacial Ray deals 2 damage to any target.\\nSplice onto Arcane {1}{R} (As you cast an Arcane spell, you may reveal this card from your hand and pay its splice cost. If you do, add this card's effects to that spell.)
`;

const bloodbraidElfSrc = `Name:Bloodbraid Elf
ManaCost:2 R G
Types:Creature Elf Berserker
PT:3/2
K:Haste
K:Cascade
Oracle:Haste\\nCascade (When you cast this spell, exile cards from the top of your library until you exile a nonland card that costs less. You may cast it without paying its mana cost. Put the exiled cards on the bottom of your library in a random order.)
`;

const lotusBloomSrc = `Name:Lotus Bloom
ManaCost:no cost
Types:Artifact
K:Suspend:3:0
A:AB$ Mana | Cost$ T Sac<1/CARDNAME> | Produced$ Any | Amount$ 3 | AILogic$ BlackLotus | SpellDescription$ Add three mana of any one color.
Oracle:Suspend 3—{0} (Rather than cast this card from your hand, pay {0} and exile it with three time counters on it. At the beginning of your upkeep, remove a time counter. When the last is removed, you may cast it without paying its mana cost.)\\n{T}, Sacrifice Lotus Bloom: Add three mana of any one color.
`;

const bonecrusherGiantSrc = `Name:Bonecrusher Giant
ManaCost:2 R
Types:Creature Giant
PT:4/3
T:Mode$ BecomesTarget | ValidTarget$ Card.Self | ValidSource$ Spell | TriggerZones$ Battlefield | Execute$ TrigDmg | TriggerDescription$ When CARDNAME becomes the target of a spell, CARDNAME deals 2 damage to that spell's controller.
SVar:TrigDmg:DB$ DealDamage | Defined$ TriggeredSourceController | NumDmg$ 2
AlternateMode:Adventure
Oracle:Whenever Bonecrusher Giant becomes the target of a spell, Bonecrusher Giant deals 2 damage to that spell's controller.

ALTERNATE

Name:Stomp
ManaCost:1 R
Types:Instant Adventure
A:SP$ Effect | StaticAbilities$ STCantPrevent | AILogic$ Burn | SubAbility$ DBDamage | SpellDescription$ Damage can't be prevented this turn. CARDNAME deals 2 damage to any target.
SVar:STCantPrevent:Mode$ CantPreventDamage | Description$ Damage can't be prevented.
SVar:DBDamage:DB$ DealDamage | ValidTgts$ Any | NumDmg$ 2 | NoPrevention$ True
Oracle:Damage can't be prevented this turn. Stomp deals 2 damage to any target.
`;

const historyOfBenaliaSrc = `Name:History of Benalia
ManaCost:1 W W
Types:Enchantment Saga
K:Chapter:3:DBToken,DBToken,DBPump
SVar:DBToken:DB$ Token | TokenScript$ w_2_2_knight_vigilance | TokenOwner$ You | SpellDescription$ Create a 2/2 white Knight creature token with vigilance.
SVar:DBPump:DB$ PumpAll | ValidCards$ Knight.YouCtrl | NumAtt$ +2 | NumDef$ +1 | SpellDescription$ Knights you control get +2/+1 until end of turn.
Oracle:(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\\nI, II — Create a 2/2 white Knight creature token with vigilance.\\nIII — Knights you control get +2/+1 until end of turn.
`;

// ── Tier 3 — popular staples (M6) ────────────────────────────────────────────

const smugglersCopterSrc = `Name:Smuggler's Copter
ManaCost:2
Types:Artifact Vehicle
PT:3/3
K:Flying
T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ TrigLoot | TriggerDescription$ Whenever CARDNAME attacks or blocks, you may draw a card. If you do, discard a card.
T:Mode$ Blocks | ValidCard$ Card.Self | Execute$ TrigLoot | Secondary$ True | TriggerDescription$ Whenever CARDNAME attacks or blocks, you may draw a card. If you do, discard a card.
SVar:TrigLoot:AB$ Discard | Defined$ You | Mode$ TgtChoose | NumCards$ 1 | Cost$ Draw<1/You>
K:Crew:1
Oracle:Flying\\nWhenever Smuggler's Copter attacks or blocks, you may draw a card. If you do, discard a card.\\nCrew 1 (Tap any number of creatures you control with total power 1 or more: This Vehicle becomes an artifact creature until end of turn.)
`;

const invasionOfIkoriaSrc = `Name:Invasion of Ikoria
ManaCost:X G G
Types:Battle Siege
Defense:6
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigSearch | TriggerDescription$ When CARDNAME enters, search your library and/or graveyard for a non-Human creature card with mana value X or less and put it onto the battlefield. If you search your library this way, shuffle.
SVar:TrigSearch:DB$ ChangeZone | ChangeType$ Creature.YouCtrl+nonHuman+cmcLEX | Hidden$ True | Origin$ Library | OriginAlternative$ Graveyard | Destination$ Battlefield | ShuffleNonMandatory$ True
SVar:X:Count$xPaid
AlternateMode:DoubleFaced
Oracle:(As a Siege enters, choose an opponent to protect it. You and others can attack it. When it's defeated, exile it, then cast it transformed.)\\nWhen Invasion of Ikoria enters, search your library and/or graveyard for a non-Human creature card with mana value X or less and put it onto the battlefield. If you search your library this way, shuffle.
`;

const crypticCommandSrc = `Name:Cryptic Command
ManaCost:1 U U U
Types:Instant
A:SP$ Charm | Choices$ DBCounter,DBReturn,DBTapAll,DBDraw | CharmNum$ 2
SVar:DBCounter:DB$ Counter | TargetType$ Spell | ValidTgts$ Card | SpellDescription$ Counter target spell.
SVar:DBReturn:DB$ ChangeZone | Origin$ Battlefield | Destination$ Hand | ValidTgts$ Permanent | AILogic$ Good | SpellDescription$ Return target permanent to its owner's hand.
SVar:DBTapAll:DB$ TapAll | ValidCards$ Creature.OppCtrl | AILogic$ AtLeast3 | SpellDescription$ Tap all creatures your opponents control.
SVar:DBDraw:DB$ Draw | Defined$ You | NumCards$ 1 | SpellDescription$ Draw a card.
Oracle:Choose two —\\n• Counter target spell.\\n• Return target permanent to its owner's hand.\\n• Tap all creatures your opponents control.\\n• Draw a card.
`;

const elspethSunsChampionSrc = `Name:Elspeth, Sun's Champion
ManaCost:4 W W
Types:Legendary Planeswalker Elspeth
Loyalty:4
A:AB$ Token | Cost$ AddCounter<1/LOYALTY> | TokenAmount$ 3 | TokenScript$ w_1_1_soldier | TokenOwner$ You | Planeswalker$ True | SpellDescription$ Create three 1/1 white Soldier creature tokens.
A:AB$ DestroyAll | Cost$ SubCounter<3/LOYALTY> | ValidCards$ Creature.powerGE4 | Planeswalker$ True | SpellDescription$ Destroy all creatures with power 4 or greater.
A:AB$ Effect | Cost$ SubCounter<7/LOYALTY> | Name$ Emblem — Elspeth, Sun's Champion | Image$ emblem_elspeth_suns_champion | StaticAbilities$ STFlying | Planeswalker$ True | Ultimate$ True | Duration$ Permanent | AILogic$ Always | SpellDescription$ You get an emblem with "Creatures you control get +2/+2 and have flying."
SVar:STFlying:Mode$ Continuous | Affected$ Creature.YouCtrl | AffectedZone$ Battlefield | AddKeyword$ Flying | AddPower$ 2 | AddToughness$ 2 | Description$ Creatures you control get +2/+2 and have flying.
Oracle:[+1]: Create three 1/1 white Soldier creature tokens.\\n[-3]: Destroy all creatures with power 4 or greater.\\n[-7]: You get an emblem with "Creatures you control get +2/+2 and have flying."
`;

const lilianaOfTheVeilSrc = `Name:Liliana of the Veil
ManaCost:1 B B
Types:Legendary Planeswalker Liliana
Loyalty:3
A:AB$ Discard | Cost$ AddCounter<1/LOYALTY> | Planeswalker$ True | NumCards$ 1 | Mode$ TgtChoose | Defined$ Player | SpellDescription$ Each player discards a card.
A:AB$ Sacrifice | Cost$ SubCounter<2/LOYALTY> | Planeswalker$ True | ValidTgts$ Player | SacValid$ Creature | SpellDescription$ Target player sacrifices a creature.
Oracle:[+1]: Each player discards a card.\\n[-2]: Target player sacrifices a creature.\\n[-6]: Separate all permanents target player controls into two piles. That player sacrifices all permanents in the pile of their choice.
`;

const jaceMindSculptorSrc = `Name:Jace, the Mind Sculptor
ManaCost:2 U U
Types:Legendary Planeswalker Jace
Loyalty:3
A:AB$ Dig | Cost$ AddCounter<2/LOYALTY> | ValidTgts$ Player | DigNum$ 1 | ChangeNum$ Any | DestinationZone$ Library | LibraryPosition2$ 0 | Planeswalker$ True | SpellDescription$ Look at the top card of target player's library. You may put that card on the bottom of that player's library.
A:AB$ Draw | Cost$ AddCounter<0/LOYALTY> | NumCards$ 3 | SubAbility$ DBChangeZone | Planeswalker$ True | SpellDescription$ Draw three cards, then put two cards from your hand on top of your library in any order.
SVar:DBChangeZone:DB$ ChangeZone | Origin$ Hand | Destination$ Library | ChangeType$ Card | ChangeNum$ 2 | LibraryPosition$ 0 | Mandatory$ True
A:AB$ ChangeZone | Cost$ SubCounter<1/LOYALTY> | Origin$ Battlefield | Destination$ Hand | ValidTgts$ Creature | Planeswalker$ True | SpellDescription$ Return target creature to its owner's hand.
Oracle:[+2]: Look at the top card of target player's library. You may put that card on the bottom of that player's library.\\n[0]: Draw three cards, then put two cards from your hand on top of your library in any order.\\n[-1]: Return target creature to its owner's hand.\\n[-12]: Exile all cards from target player's library, then that player shuffles their hand into their library.
`;

const brainstormSrc = `Name:Brainstorm
ManaCost:U
Types:Instant
A:SP$ Draw | NumCards$ 3 | StackDescription$ {p:You} draws three cards, | SpellDescription$ Draw three cards, then put two cards from your hand on top of your library in any order. | SubAbility$ ChangeZoneDB
SVar:ChangeZoneDB:DB$ ChangeZone | Origin$ Hand | Destination$ Library | ChangeNum$ 2 | Mandatory$ True | Reorder$ True | StackDescription$ then puts two cards from their hand on top of their library in any order.
Oracle:Draw three cards, then put two cards from your hand on top of your library in any order.
`;

const pathToExileSrc = `Name:Path to Exile
ManaCost:W
Types:Instant
A:SP$ ChangeZone | Origin$ Battlefield | Destination$ Exile | ValidTgts$ Creature | SubAbility$ DBChange | StackDescription$ Exile {c:Targeted}. {p:TargetedController} may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle their library. | SpellDescription$ Exile target creature. Its controller may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle.
SVar:DBChange:DB$ ChangeZone | Optional$ True | Origin$ Library | Destination$ Battlefield | Tapped$ True | ChangeType$ Land.Basic | ChangeTypeDesc$ basic land | DefinedPlayer$ TargetedController | ShuffleNonMandatory$ True | StackDescription$ None
Oracle:Exile target creature. Its controller may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle.
`;

const swordsToPlowsharesSrc = `Name:Swords to Plowshares
ManaCost:W
Types:Instant
A:SP$ ChangeZone | ValidTgts$ Creature | Origin$ Battlefield | Destination$ Exile | SubAbility$ DBGainLife | SpellDescription$ Exile target creature.
SVar:DBGainLife:DB$ GainLife | Defined$ TargetedController | LifeAmount$ X | SpellDescription$ Its controller gains life equal to its power.
SVar:X:Targeted$CardPower
Oracle:Exile target creature. Its controller gains life equal to its power.
`;

const thoughtseizeSrc = `Name:Thoughtseize
ManaCost:B
Types:Sorcery
A:SP$ Discard | ValidTgts$ Player | NumCards$ 1 | DiscardValid$ Card.nonLand | Mode$ RevealYouChoose | SubAbility$ DBLoseLife | SpellDescription$ Target player reveals their hand. You choose a nonland card from it. That player discards that card. You lose 2 life.
SVar:DBLoseLife:DB$ LoseLife | LifeAmount$ 2
Oracle:Target player reveals their hand. You choose a nonland card from it. That player discards that card. You lose 2 life.
`;

const fatalPushSrc = `Name:Fatal Push
ManaCost:B
Types:Instant
A:SP$ Destroy | ValidTgts$ Creature | AITgts$ Creature.cmcLEX | ConditionDefined$ Targeted | ConditionPresent$ Creature.cmcLEX | ConditionCompare$ EQ1 | SpellDescription$ Destroy target creature if it has mana value 2 or less. Revolt — Destroy that creature if it has mana value 4 or less instead if a permanent you controlled left the battlefield this turn.
SVar:X:Count$Revolt.4.2
Oracle:Destroy target creature if it has mana value 2 or less.\\nRevolt — Destroy that creature if it has mana value 4 or less instead if a permanent you controlled left the battlefield this turn.
`;

const darkRitualSrc = `Name:Dark Ritual
ManaCost:B
Types:Instant
A:SP$ Mana | Produced$ B | Amount$ 3 | AILogic$ ManaRitual | AINoRecursiveCheck$ True | SpellDescription$ Add {B}{B}{B}.
Oracle:Add {B}{B}{B}.
`;

const stoneforgeMysticSrc = `Name:Stoneforge Mystic
ManaCost:1 W
Types:Creature Kor Artificer
PT:1/2
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigChange | OptionalDecider$ You | TriggerDescription$ When CARDNAME enters, you may search your library for an Equipment card, reveal it, put it into your hand, then shuffle.
SVar:TrigChange:DB$ ChangeZone | Origin$ Library | Destination$ Hand | ChangeType$ Card.Equipment | ChangeNum$ 1 | ShuffleNonMandatory$ True
A:AB$ ChangeZone | Cost$ 1 W T | Origin$ Hand | Destination$ Battlefield | ChangeType$ Equipment | ChangeNum$ 1 | AILogic$ Main1 | SpellDescription$ You may put an Equipment card from your hand onto the battlefield.
Oracle:When Stoneforge Mystic enters, you may search your library for an Equipment card, reveal it, put it into your hand, then shuffle.\\n{1}{W}, {T}: You may put an Equipment card from your hand onto the battlefield.
`;

const snapcasterMageSrc = `Name:Snapcaster Mage
ManaCost:1 U
Types:Creature Human Wizard
PT:2/1
K:Flash
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigFlashback | TriggerDescription$ When CARDNAME enters, target instant or sorcery card in your graveyard gains flashback until end of turn. The flashback cost is equal to its mana cost. (You may cast that card from your graveyard for its flashback cost. Then exile it.)
SVar:TrigFlashback:DB$ Pump | ValidTgts$ Instant.YouCtrl,Sorcery.YouCtrl | TgtZone$ Graveyard | TgtPrompt$ Select target instant or sorcery card | KW$ Flashback | PumpZone$ Graveyard | AILogic$ ReplaySpell
Oracle:Flash\\nWhen Snapcaster Mage enters, target instant or sorcery card in your graveyard gains flashback until end of turn. The flashback cost is equal to its mana cost. (You may cast that card from your graveyard for its flashback cost. Then exile it.)
`;

const tarmogoyfRealSrc = `Name:Tarmogoyf
ManaCost:1 G
Types:Creature Lhurgoyf
PT:*/1+*
S:Mode$ Continuous | CharacteristicDefining$ True | SetPower$ X | SetToughness$ Y | Description$ CARDNAME's power is equal to the number of card types among cards in all graveyards and its toughness is equal to that number plus 1.
SVar:X:Count$ValidGraveyard Card$CardTypes
SVar:Y:SVar$X/Plus.1
Oracle:Tarmogoyf's power is equal to the number of card types among cards in all graveyards and its toughness is equal to that number plus 1.
`;

const tatyovaSrc = `Name:Tatyova, Benthic Druid
ManaCost:3 G U
Types:Legendary Creature Merfolk Druid
PT:3/3
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | TriggerZones$ Battlefield | ValidCard$ Land.YouCtrl | Execute$ TrigGainLife | TriggerDescription$ Landfall — Whenever a land you control enters, you gain 1 life and draw a card.
SVar:TrigGainLife:DB$ GainLife | Defined$ You | LifeAmount$ 1 | SubAbility$ DBDraw
SVar:DBDraw:DB$ Draw | Defined$ You | NumCards$ 1
Oracle:Landfall — Whenever a land you control enters, you gain 1 life and draw a card.
`;

const goblinGuideSrc = `Name:Goblin Guide
ManaCost:R
Types:Creature Goblin Scout
PT:2/2
K:Haste
T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ TrigDig | TriggerDescription$ Whenever CARDNAME attacks, defending player reveals the top card of their library. If it's a land card, that player puts it into their hand.
SVar:TrigDig:DB$ Dig | Defined$ TriggeredDefendingPlayer | DigNum$ 1 | Reveal$ True | ChangeNum$ All | ChangeValid$ Land | LibraryPosition2$ 0
Oracle:Haste\\nWhenever Goblin Guide attacks, defending player reveals the top card of their library. If it's a land card, that player puts it into their hand.
`;

const manamorphoseSrc = `Name:Manamorphose
ManaCost:1 RG
Types:Instant
A:SP$ Mana | Produced$ Combo Any | Amount$ 2 | SubAbility$ DBDraw | SpellDescription$ Add two mana in any combination of colors. Draw a card.
SVar:DBDraw:DB$ Draw | Defined$ You | NumCards$ 1
Oracle:Add two mana in any combination of colors.\\nDraw a card.
`;

const krakClanIronworksSrc = `Name:Krark-Clan Ironworks
ManaCost:4
Types:Artifact
A:AB$ Mana | Cost$ Sac<1/Artifact> | Produced$ C | Amount$ 2 | SpellDescription$ Add {C}{C}.
Oracle:Sacrifice an artifact: Add {C}{C}.
`;

const delverSrc = `Name:Delver of Secrets
ManaCost:U
Types:Creature Human Wizard
PT:1/1
T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | TriggerZones$ Battlefield | Execute$ TrigPeek | TriggerDescription$ At the beginning of your upkeep, look at the top card of your library. You may reveal that card. If an instant or sorcery card is revealed this way, transform CARDNAME.
SVar:TrigPeek:DB$ PeekAndReveal | PeekAmount$ 1 | RevealOptional$ True | RememberRevealed$ True | AILogic$ InstantOrSorcery | SubAbility$ DBTransform
SVar:DBTransform:DB$ SetState | Defined$ Self | Mode$ Transform | ConditionDefined$ Remembered | ConditionPresent$ Card.Instant,Card.Sorcery | ConditionCompare$ EQ1 | SubAbility$ DBCleanup
SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True
AlternateMode:DoubleFaced
Oracle:At the beginning of your upkeep, look at the top card of your library. You may reveal that card. If an instant or sorcery card is revealed this way, transform Delver of Secrets.
`;

const murderousRiderSrc = `Name:Murderous Rider
ManaCost:1 B B
Types:Creature Zombie Knight
PT:2/3
K:Lifelink
T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Card.Self | Execute$ TrigChange | TriggerDescription$ Whenever CARDNAME dies, put it on the bottom of its owner's library.
SVar:TrigChange:DB$ ChangeZone | Defined$ TriggeredNewCardLKICopy | Origin$ Graveyard | Destination$ Library | LibraryPosition$ -1
AlternateMode:Adventure
Oracle:Lifelink\\nWhen Murderous Rider dies, put it on the bottom of its owner's library.
`;

const mosswortBridgeSrc = `Name:Mosswort Bridge
ManaCost:no cost
Types:Land
K:Hideaway:4
R:Event$ Moved | ValidCard$ Card.Self | Destination$ Battlefield | ReplacementResult$ Updated | ReplaceWith$ ETBTapped | Description$ CARDNAME enters tapped.
SVar:ETBTapped:DB$ Tap | Defined$ Self | ETB$ True
A:AB$ Mana | Cost$ T | Produced$ G | SpellDescription$ Add {G}.
Oracle:Hideaway 4 (When this permanent enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom of your library.)\\nMosswort Bridge enters tapped.\\n{T}: Add {G}.\\n{G}, {T}: You may play the exiled card without paying its mana cost if creatures you control have total power 10 or greater.
`;

const unicycleSrc = `Name:Unicycle
ManaCost:2
Types:Artifact Equipment Vehicle
PT:3/1
K:First Strike
K:Haste
S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddKeyword$ First Strike & Haste | Description$ Equipped creature has first strike and haste.
K:Equip:1
K:Crew:1
Oracle:First strike, haste\\nEquipped creature has first strike and haste.\\nEquip {1}\\nCrew 1
`;

// ── M6.6 — additional cohort coverage (mechanics under-represented in M6) ───
// All sources copied verbatim from the Forge corpus for byte-symmetric Java
// vs TS comparison. ETB-only scenarios — same rationale as M6 (breadth over
// depth, every mechanic registers via the canonical moveTo pipeline).

const grayMerchantSrc = `Name:Gray Merchant of Asphodel
ManaCost:3 B B
Types:Creature Zombie
PT:2/4
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigLoseLife | TriggerDescription$ When CARDNAME enters, each opponent loses X life, where X is your devotion to black. You gain life equal to the life lost this way.
SVar:TrigLoseLife:DB$ LoseLife | Defined$ Player.Opponent | LifeAmount$ X | SubAbility$ DBGainLife
SVar:DBGainLife:DB$ GainLife | Defined$ You | LifeAmount$ AFLifeLost
SVar:AFLifeLost:Number$0
SVar:X:Count$Devotion.Black
Oracle:When Gray Merchant of Asphodel enters, each opponent loses X life, where X is your devotion to black. You gain life equal to the life lost this way. (Each {B} in the mana costs of permanents you control counts toward your devotion to black.)
`;

const banefireSrc = `Name:Banefire
ManaCost:X R
Types:Sorcery
A:SP$ DealDamage | ValidTgts$ Any | NumDmg$ X | SpellDescription$ CARDNAME deals X damage to any target.
S:Mode$ CantPreventDamage | ValidSource$ Spell.Self | EffectZone$ Stack | CheckSVar$ X | SVarCompare$ GE5 | Description$ If X is 5 or more, CARDNAME can't be countered by spells or abilities and the damage can't be prevented.
R:Event$ Counter | ValidCard$ Card.Self | ValidSA$ Spell | Layer$ CantHappen | CheckSVar$ X | SVarCompare$ GE5 | Secondary$ True | Description$ If X is 5 or more, CARDNAME can't be countered by spells or abilities and the damage can't be prevented.
SVar:X:Count$xPaid
Oracle:Banefire deals X damage to any target.\\nIf X is 5 or more, this spell can't be countered and the damage can't be prevented.
`;

const hangarbackWalkerSrc = `Name:Hangarback Walker
ManaCost:X X
Types:Artifact Creature Construct
PT:0/0
K:etbCounter:P1P1:X
T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Card.Self | Execute$ TrigToken | TriggerDescription$ When CARDNAME dies, create a 1/1 colorless Thopter artifact creature token with flying for each +1/+1 counter on CARDNAME.
SVar:TrigToken:DB$ Token | TokenAmount$ Y | TokenScript$ c_1_1_a_thopter_flying | TokenOwner$ You
SVar:Y:TriggeredCard$CardCounters.P1P1
A:AB$ PutCounter | Cost$ 1 T | CounterType$ P1P1 | CounterNum$ 1 | SpellDescription$ Put a +1/+1 counter on CARDNAME.
SVar:X:Count$xPaid
DeckHas:Ability$Token
Oracle:Hangarback Walker enters with X +1/+1 counters on it.\\nWhen Hangarback Walker dies, create a 1/1 colorless Thopter artifact creature token with flying for each +1/+1 counter on Hangarback Walker.\\n{1}, {T}: Put a +1/+1 counter on Hangarback Walker.
`;

const anointedProcessionSrc = `Name:Anointed Procession
ManaCost:3 W
Types:Enchantment
R:Event$ CreateToken | ActiveZones$ Battlefield | ValidToken$ Card.YouCtrl | ReplaceWith$ DoubleToken | EffectOnly$ True | Description$ If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.
SVar:DoubleToken:DB$ ReplaceToken | Type$ Amount
DeckNeeds:Ability$Token
Oracle:If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.
`;

const lurrusSrc = `Name:Lurrus of the Dream-Den
ManaCost:1 WB WB
Types:Legendary Creature Cat Nightmare
PT:3/2
K:Companion:Permanent.cmcLE2,Instant,Sorcery:Each permanent card in your starting deck has mana value 2 or less.
K:Lifelink
S:Mode$ Continuous | EffectZone$ Battlefield | Condition$ PlayerTurn | MayPlay$ True | MayPlayLimit$ 1 | Affected$ Permanent.nonLand+YouOwn+cmcLE2 | ValidAfterStack$ Spell.cmcLE2 | AffectedZone$ Graveyard | Description$ During each of your turns, you may cast one permanent spell with mana value 2 or less from your graveyard.
Oracle:Companion — Each permanent card in your starting deck has mana value 2 or less. (If this card is your chosen companion, you may put it into your hand from outside the game for {3} any time you could cast a sorcery.)\\nLifelink\\nDuring each of your turns, you may cast one permanent spell with mana value 2 or less from your graveyard.
`;

const stoneforgeMysticAltSrc = `Name:Stoneforge Mystic
ManaCost:1 W
Types:Creature Kor Artificer
PT:1/2
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigChange | OptionalDecider$ You | TriggerDescription$ When CARDNAME enters, you may search your library for an Equipment card, reveal it, put it into your hand, then shuffle.
SVar:TrigChange:DB$ ChangeZone | Origin$ Library | Destination$ Hand | ChangeType$ Card.Equipment | ChangeNum$ 1 | ShuffleNonMandatory$ True
A:AB$ ChangeZone | Cost$ 1 W T | Origin$ Hand | Destination$ Battlefield | ChangeType$ Equipment | ChangeNum$ 1 | AILogic$ Main1 | SpellDescription$ You may put an Equipment card from your hand onto the battlefield.
Oracle:When Stoneforge Mystic enters, you may search your library for an Equipment card, reveal it, put it into your hand, then shuffle.\\n{1}{W}, {T}: You may put an Equipment card from your hand onto the battlefield.
`;

const skullclampSrc = `Name:Skullclamp
ManaCost:1
Types:Artifact Equipment
K:Equip:1
S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddPower$ 1 | AddToughness$ -1 | Description$ Equipped creature gets +1/-1.
T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Card.EquippedBy | Execute$ TrigDraw | TriggerDescription$ Whenever equipped creature dies, draw two cards.
SVar:TrigDraw:DB$ Draw | NumCards$ 2
Oracle:Equipped creature gets +1/-1.\\nWhenever equipped creature dies, draw two cards.\\nEquip {1}
`;

const swordOfFireAndIceSrc = `Name:Sword of Fire and Ice
ManaCost:3
Types:Artifact Equipment
K:Equip:2
S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddPower$ 2 | AddToughness$ 2 | AddSVar$ SwordOfFireAndIceCE | AddKeyword$ Protection from red & Protection from blue | Description$ Equipped creature gets +2/+2 and has protection from red and from blue.
T:Mode$ DamageDone | ValidSource$ Creature.EquippedBy | ValidTarget$ Player | CombatDamage$ True | Execute$ TrigDealDamage | TriggerZones$ Battlefield | TriggerDescription$ Whenever equipped creature deals combat damage to a player, CARDNAME deals 2 damage to any target and you draw a card.
SVar:TrigDealDamage:DB$ DealDamage | ValidTgts$ Any | NumDmg$ 2 | SubAbility$ DBDraw
SVar:DBDraw:DB$ Draw | Defined$ You | NumCards$ 1
SVar:SwordOfFireAndIceCE:SVar:MustBeBlocked:AttackingPlayerConservative
Oracle:Equipped creature gets +2/+2 and has protection from red and from blue.\\nWhenever equipped creature deals combat damage to a player, Sword of Fire and Ice deals 2 damage to any target and you draw a card.\\nEquip {2}
`;

const korOutfitterSrc = `Name:Kor Outfitter
ManaCost:W W
Types:Creature Kor Soldier
PT:2/2
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ EquipmentSelection | OptionalDecider$ You | TriggerDescription$ When CARDNAME enters, you may attach target Equipment you control to target creature you control.
SVar:EquipmentSelection:DB$ Pump | ValidTgts$ Equipment.YouCtrl | TgtPrompt$ Select target equipment you control | SubAbility$ KorOutfitting | StackDescription$ None
SVar:KorOutfitting:DB$ Attach | Object$ ParentTarget | ValidTgts$ Creature.YouCtrl | TgtPrompt$ Select target creature you control.
AI:RemoveDeck:All
Oracle:When Kor Outfitter enters, you may attach target Equipment you control to target creature you control.
`;

const monasterySwiftspearSrc = `Name:Monastery Swiftspear
ManaCost:R
Types:Creature Human Monk
PT:1/2
K:Haste
K:Prowess
Oracle:Haste\\nProwess (Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.)
`;

const werebearSrc = `Name:Werebear
ManaCost:1 G
Types:Creature Human Bear Druid
PT:1/1
A:AB$ Mana | Cost$ T | Produced$ G | SpellDescription$ Add {G}.
S:Mode$ Continuous | Affected$ Card.Self | AddPower$ 3 | AddToughness$ 3 | Condition$ Threshold | Description$ Threshold — CARDNAME gets +3/+3 as long as there are seven or more cards in your graveyard.
Oracle:{T}: Add {G}.\\nThreshold — Werebear gets +3/+3 as long as there are seven or more cards in your graveyard.
`;

const grandArchitectSrc = `Name:Grand Architect
ManaCost:1 U U
Types:Creature Vedalken Artificer
PT:1/3
S:Mode$ Continuous | Affected$ Creature.Blue+Other+YouCtrl | AddPower$ 1 | AddToughness$ 1 | Description$ Other blue creatures you control get +1/+1.
A:AB$ Animate | Cost$ U | ValidTgts$ Creature.Artifact | TgtPrompt$ Select target artifact creature | Colors$ Blue | OverwriteColors$ True | SpellDescription$ Target artifact creature becomes blue until end of turn.
A:AB$ Mana | Cost$ tapXType<1/Creature.Blue> | Produced$ C | Amount$ 2 | RestrictValid$ Spell.Artifact,Activated.Artifact+inZoneBattlefield | SpellDescription$ Add {C}{C}. Spend this mana only to cast artifact spells or activate abilities of artifacts.
AI:RemoveDeck:Random
Oracle:Other blue creatures you control get +1/+1.\\n{U}: Target artifact creature becomes blue until end of turn.\\nTap an untapped blue creature you control: Add {C}{C}. Spend this mana only to cast artifact spells or activate abilities of artifacts.
`;

const stasisSrc = `Name:Stasis
ManaCost:1 U
Types:Enchantment
R:Event$ BeginPhase | ActiveZones$ Battlefield | Phase$ Untap | Skip$ True | Description$ Players skip their untap steps.
T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | TriggerZones$ Battlefield | Execute$ TrigUpkeep | TriggerDescription$ At the beginning of your upkeep, sacrifice CARDNAME unless you pay {U}.
SVar:TrigUpkeep:DB$ Sacrifice | UnlessPayer$ You | UnlessCost$ U
AI:RemoveDeck:Random
SVar:NonStackingEffect:True
Oracle:Players skip their untap steps.\\nAt the beginning of your upkeep, sacrifice Stasis unless you pay {U}.
`;

const vorinclexMonstrousSrc = `Name:Vorinclex, Monstrous Raider
ManaCost:4 G G
Types:Legendary Creature Phyrexian Praetor
PT:6/6
K:Trample
K:Haste
R:Event$ AddCounter | ActiveZones$ Battlefield | ValidSource$ You | ValidObject$ Permanent.inZoneBattlefield,Player | ReplaceWith$ DoubleCounters | Description$ If you would put one or more counters on a permanent or player, put twice that many of each of those kinds of counters on that permanent or player instead.
SVar:DoubleCounters:DB$ ReplaceCounter | ValidSource$ You | Amount$ X
SVar:X:ReplaceCount$CounterNum/Twice
R:Event$ AddCounter | ActiveZones$ Battlefield | ValidSource$ Opponent | ValidObject$ Permanent.inZoneBattlefield,Player | ReplaceWith$ HalfCounters | Description$ If an opponent would put one or more counters on a permanent or player, they put half that many of each of those kinds of counters on that permanent or player instead, rounded down.
SVar:HalfCounters:DB$ ReplaceCounter | ValidSource$ Opponent | Amount$ Y
SVar:Y:ReplaceCount$CounterNum/HalfDown
Oracle:Trample, haste\\nIf you would put one or more counters on a permanent or player, put twice that many of each of those kinds of counters on that permanent or player instead.\\nIf an opponent would put one or more counters on a permanent or player, they put half that many of each of those kinds of counters on that permanent or player instead, rounded down.
`;

const roxanneSrc = `Name:Roxanne, Starfall Savant
ManaCost:3 R G
Types:Legendary Creature Cat Druid
PT:4/3
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigToken | TriggerDescription$ Whenever CARDNAME enters or attacks, create a tapped colorless artifact token named Meteorite with "When Meteorite enters, it deals 2 damage to any target" and "{T}: Add one mana of any color."
T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ TrigToken | TriggerZones$ Battlefield | Secondary$ True | TriggerDescription$ Whenever CARDNAME enters or attacks, create a tapped colorless artifact token named Meteorite with "When Meteorite enters, it deals 2 damage to any target" and "{T}: Add one mana of any color."
SVar:TrigToken:DB$ Token | TokenScript$ meteorite | TokenTapped$ True | TokenOwner$ You
T:Mode$ TapsForMana | ValidCard$ Artifact.token | Activator$ You | Execute$ TrigMana | TriggerZones$ Battlefield | Static$ True | TriggerDescription$ Whenever you tap an artifact token for mana, add one mana of any type that permanent produced.
SVar:TrigMana:DB$ ManaReflected | ColorOrType$ Type | ReflectProperty$ Produced | Defined$ You
SVar:PlayMain1:TRUE
SVar:HasAttackEffect:TRUE
DeckHas:Ability$Token & Type$Artifact
DeckHints:Ability$Token & Type$Artifact|Token
Oracle:Whenever Roxanne, Starfall Savant enters or attacks, create a tapped colorless artifact token named Meteorite with "When Meteorite enters, it deals 2 damage to any target" and "{T}: Add one mana of any color."\\nWhenever you tap an artifact token for mana, add one mana of any type that artifact token produced.
`;

const avacynAngelOfHopeSrc = `Name:Avacyn, Angel of Hope
ManaCost:5 W W W
Types:Legendary Creature Angel
PT:8/8
K:Flying
K:Vigilance
K:Indestructible
S:Mode$ Continuous | Affected$ Permanent.Other+YouCtrl | AddKeyword$ Indestructible | Description$ Other permanents you control have indestructible.
Oracle:Flying, vigilance, indestructible\\nOther permanents you control have indestructible.
`;

const lilianaLastHopeSrc = `Name:Liliana, the Last Hope
ManaCost:1 B B
Types:Legendary Planeswalker Liliana
Loyalty:3
A:AB$ Pump | Cost$ AddCounter<1/LOYALTY> | Planeswalker$ True | NumAtt$ -2 | NumDef$ -1 | IsCurse$ True | Duration$ UntilYourNextTurn | TargetMin$ 0 | TargetMax$ 1 | ValidTgts$ Creature | SpellDescription$ Up to one target creature gets -2/-1 until your next turn.
A:AB$ Mill | Cost$ SubCounter<2/LOYALTY> | NumCards$ 2 | AILogic$ LilianaMill | Planeswalker$ True | Defined$ You | SubAbility$ DBChangeZone | SpellDescription$ Mill two cards, then you may return a creature card from your graveyard to your hand.
SVar:DBChangeZone:DB$ ChangeZone | Origin$ Graveyard | Destination$ Hand | ChangeType$ Creature.YouOwn | Hidden$ True
A:AB$ Effect | Cost$ SubCounter<7/LOYALTY> | Name$ Emblem — Liliana, the Last Hope | Image$ emblem_liliana_the_last_hope | Triggers$ TrigToken | Planeswalker$ True | Ultimate$ True | Duration$ Permanent | AILogic$ Always | SpellDescription$ You get an emblem with "At the beginning of your end step, create X 2/2 black Zombie creature tokens, where X is two plus the number of Zombies you control."
SVar:TrigToken:Mode$ Phase | Phase$ End of Turn | ValidPlayer$ You | TriggerZones$ Command | Execute$ DBToken | TriggerDescription$ At the beginning of your end step, create X 2/2 black Zombie creature tokens, where X is two plus the number of Zombies you control.
SVar:DBToken:DB$ Token | TokenAmount$ X | TokenScript$ b_2_2_zombie | TokenOwner$ You
SVar:X:Count$Valid Card.Zombie+YouCtrl/Plus.2
SVar:PlayMain1:TRUE
DeckHas:Ability$Token|Graveyard
DeckHints:Type$Zombie
Oracle:[+1]: Up to one target creature gets -2/-1 until your next turn.\\n[-2]: Mill two cards, then you may return a creature card from your graveyard to your hand.\\n[-7]: You get an emblem with "At the beginning of your end step, create X 2/2 black Zombie creature tokens, where X is two plus the number of Zombies you control."
`;

const beckoningCallSrc = `Name:Beck
ManaCost:G U
Types:Sorcery
K:Fuse
A:SP$ Effect | Triggers$ CreatureEntered | SpellDescription$ Whenever a creature enters this turn, you may draw a card.
SVar:CreatureEntered:Mode$ ChangesZone | ValidCard$ Creature | Origin$ Any | Destination$ Battlefield | Execute$ TrigDraw | TriggerZones$ Command | OptionalDecider$ You | TriggerDescription$ Whenever a creature enters this turn, you may draw a card.
SVar:TrigDraw:DB$ Draw | Defined$ You | NumCards$ 1
AlternateMode:Split
Oracle:Whenever a creature enters this turn, you may draw a card.\\nFuse (You may cast one or both halves of this card from your hand.)
`;

const chordOfCallingSrc = `Name:Chord of Calling
ManaCost:X G G G
Types:Instant
K:Convoke
A:SP$ ChangeZone | Origin$ Library | Destination$ Battlefield | ChangeType$ Creature.cmcLEX | ChangeNum$ 1 | StackDescription$ SpellDescription | AIMaxTgtCost$ Y | SpellDescription$ Search your library for a creature card with mana value X or less, put it onto the battlefield, then shuffle.
SVar:X:Count$xPaid
SVar:Y:Count$ValidLibrary Creature.YouOwn+cmcLELeftoverMana$GreatestCardManaCost
Oracle:Convoke (Your creatures can help cast this spell. Each creature you tap while casting this spell pays for {1} or one mana of that creature's color.)\\nSearch your library for a creature card with mana value X or less, put it onto the battlefield, then shuffle.
`;

const heraldOfAnguishSrc = `Name:Herald of Anguish
ManaCost:5 B B
Types:Creature Demon
PT:5/5
K:Improvise
K:Flying
T:Mode$ Phase | Phase$ End of Turn | ValidPlayer$ You | TriggerZones$ Battlefield | Execute$ TrigDiscard | TriggerDescription$ At the beginning of your end step, each opponent discards a card.
SVar:TrigDiscard:DB$ Discard | Defined$ Player.Opponent | NumCards$ 1 | Mode$ TgtChoose
A:AB$ Pump | Cost$ 1 B Sac<1/Artifact> | ValidTgts$ Creature | NumAtt$ -2 | NumDef$ -2 | IsCurse$ True | SpellDescription$ Target creature gets -2/-2 until end of turn.
Oracle:Improvise (Your artifacts can help cast this spell. Each artifact you tap after you're done activating mana abilities pays for {1}.)\\nFlying\\nAt the beginning of your end step, each opponent discards a card.\\n{1}{B}, Sacrifice an artifact: Target creature gets -2/-2 until end of turn.
`;

const thoughtcastSrc = `Name:Thoughtcast
ManaCost:4 U
Types:Sorcery
A:SP$ Draw | NumCards$ 2 | SpellDescription$ Draw two cards.
K:Affinity:Artifact
Oracle:Affinity for artifacts (This spell costs {1} less to cast for each artifact you control.)\\nDraw two cards.
`;

const drivenDespairSrc = `Name:Driven
ManaCost:1 G
Types:Sorcery
A:SP$ AnimateAll | ValidCards$ Creature.YouCtrl | Keywords$ Trample | Triggers$ Trig1 | StackDescription$ SpellDescription | SpellDescription$ Until end of turn, creatures you control gain trample and "Whenever this creature deals combat damage to a player, draw a card."
SVar:Trig1:Mode$ DamageDone | ValidSource$ Card.Self | ValidTarget$ Player | Execute$ Eff1 | CombatDamage$ True | TriggerDescription$ Whenever this creature deals combat damage to a player, draw a card.
SVar:Eff1:DB$ Draw
AlternateMode:Split
Oracle:Until end of turn, creatures you control gain trample and "Whenever this creature deals combat damage to a player, draw a card."
`;

const consignToMemorySrc = `Name:Consign to Memory
ManaCost:U
Types:Instant
K:Replicate:1
A:SP$ Counter | TargetType$ Spell.Colorless,Triggered | TgtPrompt$ Select target triggered ability or colorless spell | ValidTgts$ Card,Emblem | SpellDescription$ Counter target triggered ability or colorless spell.
Oracle:Replicate {1} (When you cast this spell, copy it for each time you paid its replicate cost. You may choose new targets for the copies.)\\nCounter target triggered ability or colorless spell.
`;

const baithookAnglerSrc = `Name:Baithook Angler
ManaCost:1 U
Types:Creature Human Peasant
PT:2/1
K:Disturb:1 U
DeckHas:Ability$Graveyard
AlternateMode:DoubleFaced
Oracle:Disturb {1}{U} (You may cast this card from your graveyard transformed for its disturb cost.)
`;

const beastbondOutcasterSrc = `Name:Beastbond Outcaster
ManaCost:2 G
Types:Creature Human Druid
PT:3/3
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | IsPresent$ Creature.YouCtrl+powerGE4 | Execute$ TrigDraw | TriggerDescription$ When CARDNAME enters, if you control a creature with power 4 or greater, draw a card.
SVar:TrigDraw:DB$ Draw | Defined$ You
K:Plot:1 G
Oracle:When Beastbond Outcaster enters, if you control a creature with power 4 or greater, draw a card.\\nPlot {1}{G} (You may pay 1 this card from your hand. Cast it as a sorcery on a later turn without paying its mana cost. Plot only as a sorcery.)
`;

const nellyBorcaSrc = `Name:Nelly Borca, Impulsive Accuser
ManaCost:2 R W
Types:Legendary Creature Human Detective
PT:2/4
K:Vigilance
T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ TrigSuspect | TriggerDescription$ Whenever CARDNAME attacks, suspect target creature. Then goad all suspected creatures. (A suspected creature has menace and can't block.)
SVar:TrigSuspect:DB$ AlterAttribute | ValidTgts$ Creature | Attributes$ Suspected | SubAbility$ DBGoad
SVar:DBGoad:DB$ Goad | Defined$ Valid Creature.IsSuspected
T:Mode$ DamageAll | CombatDamage$ True | ValidSource$ Creature.OppCtrl | ValidTarget$ Opponent | Execute$ TrigDraw | TriggerZones$ Battlefield | TriggerDescription$ Whenever one or more creatures an opponent controls deal combat damage to one or more of your opponents, you and the controller of those creatures each draw a card.
SVar:TrigDraw:DB$ Draw | Defined$ TriggeredSourcesController & You
Oracle:Vigilance\\nWhenever Nelly Borca, Impulsive Accuser attacks, suspect target creature. Then goad all suspected creatures. (A suspected creature has menace and can't block.)\\nWhenever one or more creatures an opponent controls deal combat damage to one or more of your opponents, you and the controller of those creatures each draw a card.
`;

const clericClassSrc = `Name:Cleric Class
ManaCost:W
Types:Enchantment Class
R:Event$ GainLife | ActiveZones$ Battlefield | ValidPlayer$ You | ReplaceWith$ ReplaceGainLife | Description$ If you would gain life, you gain that much life plus 1 instead.
SVar:ReplaceGainLife:DB$ ReplaceEffect | VarName$ LifeGained | VarValue$ X
SVar:X:ReplaceCount$LifeGained/Plus.1
K:Class:2:3 W:AddTrigger$ TriggerLife
SVar:TriggerLife:Mode$ LifeGained | ValidPlayer$ You | TriggerZones$ Battlefield | Execute$ TrigPutCounter | Secondary$ True | TriggerDescription$ Whenever you gain life, put a +1/+1 counter on target creature you control.
SVar:TrigPutCounter:DB$ PutCounter | ValidTgts$ Creature.YouCtrl | CounterType$ P1P1 | CounterNum$ 1
K:Class:3:4 W:AddTrigger$ TriggerClassLevel
SVar:TriggerClassLevel:Mode$ ClassLevelGained | ClassLevel$ 3 | ValidCard$ Card.Self | TriggerZones$ Battlefield | Execute$ TrigReanimate | Secondary$ True | TriggerDescription$ When this Class becomes level 3, return target creature card from your graveyard to the battlefield. You gain life equal to its toughness.
SVar:TrigReanimate:DB$ ChangeZone | ValidTgts$ Creature.YouOwn | TgtPrompt$ Select target creature from your graveyard | Origin$ Graveyard | Destination$ Battlefield | RememberTargets$ True | SubAbility$ DBGainLife
SVar:DBGainLife:DB$ GainLife | Defined$ You | LifeAmount$ Y | SubAbility$ DBCleanup
SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True
SVar:Y:Remembered$CardToughness
SVar:PlayMain1:True
DeckHas:Ability$Counters|Graveyard
DeckNeeds:Ability$LifeGain
Oracle:(Gain the next level as a sorcery to add its ability.)\\nIf you would gain life, you gain that much life plus 1 instead.\\n{3}{W}: Level 2\\nWhenever you gain life, put a +1/+1 counter on target creature you control.\\n{4}{W}: Level 3\\nWhen this Class becomes level 3, return target creature card from your graveyard to the battlefield. You gain life equal to its toughness.
`;

const aetherfluxReservoirSrc = `Name:Aetherflux Reservoir
ManaCost:4
Types:Artifact
T:Mode$ SpellCast | ValidCard$ Card | ValidActivatingPlayer$ You | Execute$ TrigGainLife | TriggerZones$ Battlefield | TriggerDescription$ Whenever you cast a spell, you gain 1 life for each spell you've cast this turn.
SVar:TrigGainLife:DB$ GainLife | Defined$ You | LifeAmount$ X
SVar:X:Count$ThisTurnCast_Card.YouCtrl
A:AB$ DealDamage | Cost$ PayLife<50> | ValidTgts$ Any | NumDmg$ 50 | SpellDescription$ CARDNAME deals 50 damage to any target.
Oracle:Whenever you cast a spell, you gain 1 life for each spell you've cast this turn.\\nPay 50 life: Aetherflux Reservoir deals 50 damage to any target.
`;

const bloodghastSrc = `Name:Bloodghast
ManaCost:B B
Types:Creature Vampire Spirit
PT:2/1
S:Mode$ CantBlock | ValidCard$ Card.Self | Description$ CARDNAME can't block.
S:Mode$ Continuous | Affected$ Card.Self | AddKeyword$ Haste | CheckSVar$ X | SVarCompare$ LE10 | Description$ CARDNAME has haste as long as an opponent has 10 or less life.
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Land.YouCtrl | OptionalDecider$ You | TriggerZones$ Graveyard | Execute$ TrigChange | TriggerDescription$ Landfall — Whenever a land you control enters, you may return CARDNAME from your graveyard to the battlefield.
SVar:TrigChange:DB$ ChangeZone | Origin$ Graveyard | Destination$ Battlefield
SVar:X:PlayerCountOpponents$LowestLifeTotal
SVar:SacMe:3
SVar:DiscardMe:3
Oracle:Bloodghast can't block.\\nBloodghast has haste as long as an opponent has 10 or less life.\\nLandfall — Whenever a land you control enters, you may return Bloodghast from your graveyard to the battlefield.
`;

const aetherVialSrc = `Name:Aether Vial
ManaCost:1
Types:Artifact
A:AB$ ChangeZone | Cost$ T | Origin$ Hand | Destination$ Battlefield | ChangeType$ Creature.cmcEQX+YouCtrl | Optional$ You | SpellDescription$ You may put a creature card with mana value equal to the number of charge counters on CARDNAME from your hand onto the battlefield. | StackDescription$ SpellDescription
T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | TriggerZones$ Battlefield | OptionalDecider$ You | Execute$ TrigPutCounter | TriggerDescription$ At the beginning of your upkeep, you may put a charge counter on CARDNAME.
SVar:TrigPutCounter:DB$ PutCounter | Defined$ Self | CounterType$ CHARGE | CounterNum$ 1 | AILogic$ ChargeToBestCMC
SVar:X:Count$CardCounters.CHARGE
Oracle:At the beginning of your upkeep, you may put a charge counter on Aether Vial.\\n{T}: You may put a creature card with mana value equal to the number of charge counters on Aether Vial from your hand onto the battlefield.
`;

const risenReefSrc = `Name:Risen Reef
ManaCost:1 G U
Types:Creature Elemental
PT:1/1
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self,Elemental.Other+YouCtrl | Execute$ TrigPeek | TriggerDescription$ Whenever CARDNAME or another Elemental you control enters, look at the top card of your library. If it's a land card, you may put it onto the battlefield tapped. If you don't put the card onto the battlefield, put it into your hand.
SVar:TrigPeek:DB$ PeekAndReveal | PeekAmount$ 1 | NoReveal$ True | RememberPeeked$ True | SubAbility$ DBChangeZone
SVar:DBChangeZone:DB$ ChangeZone | Optional$ True | ForgetChanged$ True | Origin$ Library | Destination$ Battlefield | Defined$ Remembered | ConditionDefined$ Remembered | ConditionPresent$ Land | ConditionCompare$ GE1 | Tapped$ True | SubAbility$ DBHand
SVar:DBHand:DB$ ChangeZone | Origin$ Library | Destination$ Hand | Defined$ Remembered | SubAbility$ DBCleanup
SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True
Oracle:Whenever Risen Reef or another Elemental you control enters, look at the top card of your library. If it's a land card, you may put it onto the battlefield tapped. If you don't put the card onto the battlefield, put it into your hand.
`;

const balefulStrixSrc = `Name:Baleful Strix
ManaCost:U B
Types:Artifact Creature Bird
PT:1/1
K:Flying
K:Deathtouch
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDraw | TriggerDescription$ When CARDNAME enters, draw a card.
SVar:TrigDraw:DB$ Draw | Defined$ You | NumCards$ 1
Oracle:Flying, deathtouch\\nWhen Baleful Strix enters, draw a card.
`;

const phytohydraSrc = `Name:Phytohydra
ManaCost:2 G W W
Types:Creature Plant Hydra
PT:1/1
R:Event$ DamageDone | ActiveZones$ Battlefield | ValidTarget$ Card.Self | ReplaceWith$ Counters | Description$ If damage would be dealt to CARDNAME, put that many +1/+1 counters on it instead.
SVar:Counters:DB$ PutCounter | Defined$ Self | CounterType$ P1P1 | CounterNum$ X
SVar:X:ReplaceCount$DamageAmount
Oracle:If damage would be dealt to Phytohydra, put that many +1/+1 counters on it instead.
`;

const pacifismSrc = `Name:Pacifism
ManaCost:1 W
Types:Enchantment Aura
K:Enchant:Creature
SVar:AttachAILogic:Curse
S:Mode$ CantAttack,CantBlock | ValidCard$ Creature.EnchantedBy | Description$ Enchanted creature can't attack or block.
Oracle:Enchant creature\\nEnchanted creature can't attack or block.
`;

const oblivionRingSrc = `Name:Oblivion Ring
ManaCost:2 W
Types:Enchantment
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigExile | TriggerDescription$ When CARDNAME enters, exile another target nonland permanent.
T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Any | ValidCard$ Card.Self | Execute$ TrigReturn | TriggerDescription$ When CARDNAME leaves the battlefield, return the exiled card to the battlefield under its owner's control.
SVar:TrigExile:DB$ ChangeZone | IsCurse$ True | ValidTgts$ Permanent.nonLand+Other | TgtPrompt$ Choose another target nonland permanent | Origin$ Battlefield | Destination$ Exile
SVar:TrigReturn:DB$ ChangeZone | Defined$ ExiledWith | Origin$ Exile | Destination$ Battlefield
SVar:PlayMain1:TRUE
SVar:OblivionRing:TRUE
Oracle:When Oblivion Ring enters, exile another target nonland permanent.\\nWhen Oblivion Ring leaves the battlefield, return the exiled card to the battlefield under its owner's control.
`;

const kalitasSrc = `Name:Kalitas, Traitor of Ghet
ManaCost:2 B B
Types:Legendary Creature Vampire Warrior
PT:3/4
K:Lifelink
R:Event$ Moved | ActiveZones$ Battlefield | Origin$ Battlefield | Destination$ Graveyard | ValidLKI$ Creature.!token+OppCtrl | ReplaceWith$ Exile | Description$ If a nontoken creature an opponent controls would die, instead exile that card and create a 2/2 black Zombie creature token.
SVar:Exile:DB$ ChangeZone | Origin$ Battlefield | Destination$ Exile | SubAbility$ DBToken | Defined$ ReplacedCard
SVar:DBToken:DB$ Token | TokenScript$ b_2_2_zombie | TokenOwner$ You
A:AB$ PutCounter | Cost$ 2 B Sac<1/Vampire.Other;Zombie.Other/another Vampire or Zombie> | CounterType$ P1P1 | CounterNum$ 2 | SpellDescription$ Put two +1/+1 counters on CARDNAME.
Oracle:Lifelink\\nIf a nontoken creature an opponent controls would die, instead exile that card and create a 2/2 black Zombie creature token.\\n{2}{B}, Sacrifice another Vampire or Zombie: Put two +1/+1 counters on Kalitas, Traitor of Ghet.
`;

const bloodArtistSrc = `Name:Blood Artist
ManaCost:1 B
Types:Creature Vampire
PT:0/1
T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Card.Self,Creature.Other | TriggerZones$ Battlefield | Execute$ TrigLoseLife | TriggerDescription$ Whenever CARDNAME or another creature dies, target player loses 1 life and you gain 1 life.
SVar:TrigLoseLife:DB$ LoseLife | ValidTgts$ Player | LifeAmount$ 1 | SubAbility$ DBGainLife
SVar:DBGainLife:DB$ GainLife | Defined$ You | LifeAmount$ 1
DeckHas:Ability$LifeGain
Oracle:Whenever Blood Artist or another creature dies, target player loses 1 life and you gain 1 life.
`;

const golgariGraveTrollSrc = `Name:Golgari Grave-Troll
ManaCost:4 G
Types:Creature Troll Skeleton
PT:0/0
K:etbCounter:P1P1:X:no Condition:CARDNAME enters with a +1/+1 counter on it for each creature card in your graveyard.
A:AB$ Regenerate | Cost$ 1 SubCounter<1/P1P1> | SpellDescription$ Regenerate CARDNAME.
K:Dredge:6
SVar:X:Count$ValidGraveyard Creature.YouCtrl
SVar:NeedsToPlayVar:X GE3
Oracle:Golgari Grave-Troll enters with a +1/+1 counter on it for each creature card in your graveyard.\\n{1}, Remove a +1/+1 counter from Golgari Grave-Troll: Regenerate Golgari Grave-Troll.\\nDredge 6 (If you would draw a card, you may mill six cards instead. If you do, return this card from your graveyard to your hand.)
`;

const stinkweedImpSrc = `Name:Stinkweed Imp
ManaCost:2 B
Types:Creature Imp
PT:1/2
K:Flying
T:Mode$ DamageDone | ValidSource$ Card.Self | ValidTarget$ Creature | CombatDamage$ True | TriggerZones$ Battlefield | Execute$ TrigDestroy | TriggerDescription$ Whenever CARDNAME deals combat damage to a creature, destroy that creature.
SVar:TrigDestroy:DB$ Destroy | Defined$ TriggeredTargetLKICopy
K:Dredge:5
Oracle:Flying\\nWhenever Stinkweed Imp deals combat damage to a creature, destroy that creature.\\nDredge 5 (If you would draw a card, you may mill five cards instead. If you do, return this card from your graveyard to your hand.)
`;

const courierGriffinSrc = `Name:Courier Griffin
ManaCost:3 W
Types:Creature Griffin
PT:2/3
K:Flying
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigGainLife | TriggerDescription$ When CARDNAME enters, you gain 2 life.
SVar:TrigGainLife:DB$ GainLife | LifeAmount$ 2
DeckHas:Ability$LifeGain
Oracle:Flying\\nWhen Courier Griffin enters, you gain 2 life.
`;

const courtOfGraceSrc = `Name:Court of Grace
ManaCost:2 W W
Types:Enchantment
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigMonarch | TriggerDescription$ When CARDNAME enters, you become the monarch.
SVar:TrigMonarch:DB$ BecomeMonarch
T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | TriggerZones$ Battlefield | Execute$ TrigBranch | TriggerDescription$ At the beginning of your upkeep, create a 1/1 white Spirit creature token with flying. If you're the monarch, create a 4/4 white Angel creature token with flying instead.
SVar:TrigBranch:DB$ Branch | BranchConditionSVar$ X | TrueSubAbility$ DBAngel | FalseSubAbility$ DBSpirit
SVar:DBSpirit:DB$ Token | TokenScript$ w_1_1_spirit_flying | TokenOwner$ You
SVar:DBAngel:DB$ Token | TokenScript$ w_4_4_angel_flying | TokenOwner$ You
SVar:X:Count$Monarch.1.0
Oracle:When Court of Grace enters, you become the monarch.\\nAt the beginning of your upkeep, create a 1/1 white Spirit creature token with flying. If you're the monarch, create a 4/4 white Angel creature token with flying instead.
`;

const scrapTrawlerSrc = `Name:Scrap Trawler
ManaCost:3
Types:Artifact Creature Construct
PT:3/2
T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Card.Self | Execute$ TrigReturnArti | TriggerDescription$ Whenever CARDNAME or another artifact you control is put into a graveyard from the battlefield, return to your hand target artifact card in your graveyard with lesser mana value.
T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Artifact.Other+YouCtrl | TriggerZones$ Battlefield | Secondary$ True | Execute$ TrigReturnArti | TriggerDescription$ Whenever CARDNAME or another artifact you control is put into a graveyard from the battlefield, return to your hand target artifact card in your graveyard with lesser mana value.
SVar:TrigReturnArti:DB$ ChangeZone | ValidTgts$ Artifact.cmcLTX+YouCtrl | Origin$ Graveyard | Destination$ Hand
SVar:X:TriggeredCard$CardManaCost
Oracle:Whenever Scrap Trawler or another artifact you control is put into a graveyard from the battlefield, return to your hand target artifact card in your graveyard with lesser mana value.
`;

const glissaSrc = `Name:Glissa Sunslayer
ManaCost:1 B G
Types:Legendary Creature Phyrexian Zombie Elf
PT:3/3
K:First Strike
K:Deathtouch
T:Mode$ DamageDone | ValidSource$ Card.Self | ValidTarget$ Player | CombatDamage$ True | Execute$ TrigCharm | TriggerZones$ Battlefield | TriggerDescription$ Whenever CARDNAME deals combat damage to a player, ABILITY
SVar:TrigCharm:DB$ Charm | Choices$ DBDraw,DBDestroy,DBRemove
SVar:DBDraw:DB$ Draw | SubAbility$ DBLoseLife | SpellDescription$ You draw a card and you lose 1 life.
SVar:DBLoseLife:DB$ LoseLife | LifeAmount$ 1
SVar:DBDestroy:DB$ Destroy | ValidTgts$ Enchantment | SpellDescription$ Destroy target enchantment.
SVar:DBRemove:DB$ RemoveCounter | ValidTgts$ Permanent | CounterType$ Any | CounterNum$ 3 | UpTo$ True | SpellDescription$ Remove up to three counters from target permanent.
Oracle:First strike, deathtouch\\nWhenever Glissa Sunslayer deals combat damage to a player, choose one —\\n• You draw a card and you lose 1 life.\\n• Destroy target enchantment.\\n• Remove up to three counters from target permanent.
`;

// ── M6.7 cohort expansion card sources ──────────────────────────────────────

const merEkNightbladeSrc = `Name:Mer-Ek Nightblade
ManaCost:3 B
Types:Creature Orc Assassin
PT:2/3
K:Outlast:B
S:Mode$ Continuous | Affected$ Creature.YouCtrl+counters_GE1_P1P1 | AddKeyword$ Deathtouch | Description$ Each creature you control with a +1/+1 counter on it has deathtouch.
Oracle:Outlast {B}.
`;

const knightOfTheWhiteOrchidSrc = `Name:Knight of the White Orchid
ManaCost:W W
Types:Creature Human Knight
PT:2/2
K:First Strike
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigChange | CheckSVar$ Y | SVarCompare$ GTX | OptionalDecider$ You | TriggerDescription$ When CARDNAME enters, if an opponent controls more lands than you, you may search your library for a Plains card.
SVar:TrigChange:DB$ ChangeZone | Origin$ Library | Destination$ Battlefield | ChangeType$ Card.Plains | ChangeNum$ 1 | ShuffleNonMandatory$ True
SVar:X:Count$Valid Land.YouCtrl
SVar:Y:PlayerCountOpponents$HighestValid Land.YouCtrl
Oracle:First strike. ETB conditional search.
`;

const migratoryRouteSrc = `Name:Migratory Route
ManaCost:3 W U
Types:Sorcery
A:SP$ Token | TokenAmount$ 4 | TokenScript$ w_1_1_bird_flying | TokenOwner$ You | SpellDescription$ Create four 1/1 white Bird creature tokens with flying.
K:TypeCycling:Basic:2
DeckHas:Ability$Token
Oracle:Create four 1/1 white Bird creature tokens with flying. Basic landcycling {2}.
`;

const tajicLegionsEdgeSrc = `Name:Tajic, Legion's Edge
ManaCost:1 R W
Types:Legendary Creature Human Soldier
PT:3/2
K:Haste
K:Mentor
R:Event$ DamageDone | ActiveZones$ Battlefield | Prevent$ True | ValidTarget$ Creature.Other+YouCtrl | IsCombat$ False | Description$ Prevent all noncombat damage that would be dealt to other creatures you control.
A:AB$ Pump | Cost$ R W | Defined$ Self | KW$ First Strike | SpellDescription$ CARDNAME gains first strike until end of turn.
Oracle:Haste, Mentor.
`;

const mizziumMortarsSrc = `Name:Mizzium Mortars
ManaCost:1 R
Types:Sorcery
A:SP$ DealDamage | ValidTgts$ Creature.YouDontCtrl | TgtPrompt$ Select target creature you don't control | NumDmg$ 4 | SpellDescription$ CARDNAME deals 4 damage to target creature you don't control.
K:Overload:3 R R R
Oracle:CARDNAME deals 4 damage to target creature you don't control. Overload.
`;

const generousVisitorSrc = `Name:Generous Visitor
ManaCost:G
Types:Creature Spirit
PT:1/1
T:Mode$ SpellCast | ValidCard$ Enchantment | ValidActivatingPlayer$ You | Execute$ TrigPutCounter | TriggerZones$ Battlefield | TriggerDescription$ Whenever you cast an enchantment spell, put a +1/+1 counter on target creature.
SVar:TrigPutCounter:DB$ PutCounter | ValidTgts$ Creature | CounterType$ P1P1 | CounterNum$ 1
Oracle:Whenever you cast an enchantment, put +1/+1 on target creature.
`;

const maelstromWandererSrc = `Name:Maelstrom Wanderer
ManaCost:5 G U R
Types:Legendary Creature Elemental
PT:7/5
K:Cascade
K:Cascade
S:Mode$ Continuous | Affected$ Creature.YouCtrl | AddKeyword$ Haste | Description$ Creatures you control have haste.
Oracle:Creatures you control have haste. Cascade twice.
`;

const auspiciousStarrixSrc = `Name:Auspicious Starrix
ManaCost:4 G
Types:Creature Elk Beast
PT:6/6
K:Mutate:5 G
T:Mode$ Mutates | ValidCard$ Card.Self | Execute$ TrigDigUntil | TriggerDescription$ Whenever this creature mutates, exile cards from the top of your library until you exile X permanent cards.
SVar:TrigDigUntil:DB$ DigUntil | Amount$ X | Defined$ You | Valid$ Permanent
SVar:X:Count$TimesMutated
Oracle:Mutate {5}{G}.
`;

const faldornDreadWolfHeraldSrc = `Name:Faldorn, Dread Wolf Herald
ManaCost:1 R G
Types:Legendary Creature Human Druid
PT:3/3
T:Mode$ SpellCast | ValidCard$ Card.wasCastFromExile | ValidActivatingPlayer$ You | Execute$ TrigToken | TriggerZones$ Battlefield | TriggerDescription$ Whenever you cast a spell from exile, create a 2/2 green Wolf creature token.
SVar:TrigToken:DB$ Token | TokenScript$ g_2_2_wolf
K:Encore:2 R G
Oracle:Create Wolf token on cast-from-exile. Encore.
`;

const swordOfTheRealmsSrc = `Name:Sword of the Realms
ManaCost:3
Types:Artifact Equipment
K:Equip:2
S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddPower$ 2 | AddToughness$ 2 | AddKeyword$ Protection from white & Protection from black | Description$ Equipped creature gets +2/+2 and has protection from white and from black.
Oracle:Equipped creature gets +2/+2 and protection from white and black.
`;

const batterskullSrc = `Name:Batterskull
ManaCost:5
Types:Artifact Equipment
K:Living Weapon
K:Equip:5
S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddPower$ 4 | AddToughness$ 4 | AddKeyword$ Vigilance & Lifelink | Description$ Equipped creature gets +4/+4 and has vigilance and lifelink.
A:AB$ ChangeZone | Cost$ 3 | Origin$ Battlefield | Destination$ Hand | SpellDescription$ Return CARDNAME to its owner's hand.
Oracle:Living weapon. Equipped creature +4/+4, vigilance, lifelink.
`;

const slitherheadSrc = `Name:Slitherhead
ManaCost:BG
Types:Creature Plant Zombie
PT:1/1
K:Scavenge:0
Oracle:Scavenge {0}.
`;

const murderousRedcapSrc = `Name:Murderous Redcap
ManaCost:2 BR BR
Types:Creature Goblin Assassin
PT:2/2
K:Persist
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDealDamage | TriggerDescription$ When CARDNAME enters, it deals damage equal to its power to any target.
SVar:TrigDealDamage:DB$ DealDamage | ValidTgts$ Any | NumDmg$ X
SVar:X:Count$CardPower
Oracle:Persist + ETB damage trigger.
`;

const stranglerootGeistSrc = `Name:Strangleroot Geist
ManaCost:G G
Types:Creature Spirit
PT:2/1
K:Haste
K:Undying
Oracle:Haste, Undying.
`;

const sacredCatSrc = `Name:Sacred Cat
ManaCost:W
Types:Creature Cat
PT:1/1
K:Lifelink
K:Embalm:W
Oracle:Lifelink, Embalm {W}.
`;

const sandStranglerSrc = `Name:Sand Strangler
ManaCost:3 R
Types:Creature Beast
PT:3/3
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDamage | OptionalDecider$ You | Desert$ True | TriggerDescription$ ETB conditional damage on Desert.
SVar:TrigDamage:DB$ DealDamage | ValidTgts$ Creature | NumDmg$ 3
K:Eternalize:5 R R
Oracle:Eternalize ETB conditional damage.
`;

const auguryRavenSrc = `Name:Augury Raven
ManaCost:3 U
Types:Creature Bird
PT:3/3
K:Flying
K:Foretell:1 U
Oracle:Flying, Foretell {1}{U}.
`;

const tribalFlamesSrc = `Name:Tribal Flames
ManaCost:1 R
Types:Sorcery
A:SP$ DealDamage | ValidTgts$ Any | NumDmg$ X | SpellDescription$ Domain — CARDNAME deals X damage to any target.
SVar:X:Count$Domain
Oracle:Domain — CARDNAME deals X damage.
`;

const doomwakeGiantSrc = `Name:Doomwake Giant
ManaCost:4 B
Types:Enchantment Creature Giant
PT:4/6
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self,Enchantment.Other+YouCtrl | Execute$ TrigMassacre | TriggerDescription$ Constellation — Whenever CARDNAME or another enchantment you control enters, creatures your opponents control get -1/-1 until end of turn.
SVar:TrigMassacre:DB$ PumpAll | NumAtt$ -1 | NumDef$ -1 | ValidCards$ Creature.OppCtrl | IsCurse$ True
Oracle:Constellation -1/-1 sweep on enchantment ETB.
`;

const borosReckonerSrc = `Name:Boros Reckoner
ManaCost:RW RW RW
Types:Creature Minotaur Wizard
PT:3/3
T:Mode$ DamageDoneOnce | Execute$ TrigDamage | ValidTarget$ Card.Self | TriggerZones$ Battlefield | TriggerDescription$ Whenever CARDNAME is dealt damage, it deals that much damage to any target.
SVar:TrigDamage:DB$ DealDamage | NumDmg$ X | ValidTgts$ Any
A:AB$ Pump | Cost$ RW | KW$ First Strike | Defined$ Self | SpellDescription$ CARDNAME gains first strike until end of turn.
SVar:X:TriggerCount$DamageAmount
Oracle:Damage redirect + activated first strike.
`;

// M6.9 — replaced fake "Tilted Animar" with the real Angelic Sleuth so
// the Forge bridge can resolve the card. Same trigger family
// (ChangesZone leaving the battlefield) — surfaces the bookkeeping
// path even if no permanent actually leaves during the seeded ETB.
const tiltedAnimarSrc = `Name:Angelic Sleuth
ManaCost:2 W
Types:Creature Angel Advisor
PT:2/3
K:Flying
T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Any | ValidCard$ Permanent.YouCtrl+Other+HasCounters | TriggerZones$ Battlefield | Execute$ TrigInvestigate | TriggerDescription$ Whenever another permanent you control leaves the battlefield, if it had counters on it, investigate.
SVar:TrigInvestigate:DB$ Investigate
DeckHas:Ability$Investigate|Token|Sacrifice & Type$Artifact|Clue
DeckHints:Ability$Counters
Oracle:Flying\\nWhenever another permanent you control leaves the battlefield, if it had counters on it, investigate.
`;

const steppeLynxSrc = `Name:Steppe Lynx
ManaCost:W
Types:Creature Cat
PT:0/1
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Land.YouCtrl | TriggerZones$ Battlefield | Execute$ TrigPump | TriggerDescription$ Landfall — +2/+2 until EOT.
SVar:TrigPump:DB$ Pump | Defined$ Self | NumAtt$ +2 | NumDef$ +2
Oracle:Landfall pump.
`;

const anaxAndCymedeSrc = `Name:Anax and Cymede
ManaCost:1 R W
Types:Legendary Creature Human Soldier
PT:3/2
K:First Strike
K:Vigilance
T:Mode$ SpellCast | ValidActivatingPlayer$ You | TargetsValid$ Card.Self | TriggerZones$ Battlefield | Execute$ TrigPump | TriggerDescription$ Heroic — When you cast a spell that targets CARDNAME, anthem until EOT.
SVar:TrigPump:DB$ PumpAll | ValidCards$ Creature.YouCtrl | KW$ Trample | NumAtt$ +1 | NumDef$ +1
Oracle:Heroic — anthem on target.
`;

const lightOfPromiseSrc = `Name:Light of Promise
ManaCost:2 W
Types:Enchantment Aura
K:Enchant:Creature
S:Mode$ Continuous | Affected$ Creature.EnchantedBy | AddTrigger$ LightOfPromiseTrig | Description$ Enchanted creature has lifegain-counter trigger.
SVar:LightOfPromiseTrig:Mode$ LifeGained | ValidPlayer$ You | TriggerZones$ Battlefield | Execute$ LightOfPromisePutCounter | TriggerDescription$ Whenever you gain life, put that many +1/+1 counters on this creature.
SVar:LightOfPromisePutCounter:DB$ PutCounter | Defined$ Self | CounterType$ P1P1 | CounterNum$ X
SVar:X:TriggerCount$LifeAmount
Oracle:Aura with grant-trigger.
`;

const quandrixApprenticeSrc = `Name:Quandrix Apprentice
ManaCost:G U
Types:Creature Human Wizard
PT:2/2
T:Mode$ SpellCastOrCopy | ValidCard$ Instant,Sorcery | ValidActivatingPlayer$ You | TriggerZones$ Battlefield | Execute$ TrigDig | TriggerDescription$ Magecraft — surveil-style dig on instant/sorcery cast.
SVar:TrigDig:DB$ Dig | DigNum$ 3 | ChangeNum$ 1 | Optional$ True | ChangeValid$ Land
Oracle:Magecraft trigger.
`;

const awakenTheBearSrc = `Name:Awaken the Bear
ManaCost:2 G
Types:Instant
A:SP$ Pump | ValidTgts$ Creature | NumAtt$ +3 | NumDef$ +3 | KW$ Trample | SpellDescription$ Target creature gets +3/+3 and gains trample until end of turn.
Oracle:Pump + trample.
`;

const hopefulEidolonSrc = `Name:Hopeful Eidolon
ManaCost:W
Types:Enchantment Creature Spirit
PT:1/1
K:Bestow:3 W
K:Lifelink
S:Mode$ Continuous | Affected$ Card.EnchantedBy | AddPower$ 1 | AddToughness$ 1 | AddKeyword$ Lifelink | Description$ Enchanted creature gets +1/+1 and has lifelink.
Oracle:Bestow {3}{W}, Lifelink.
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

  // ── Tier 2 — known-tricky cards (M6) ───────────────────────────────────────
  // M6 picks one card per "historically tricky" mechanic family. Almost
  // all are ETB-only scenarios because:
  //   1. The bridge runs cards through Forge's actual `GameAction.moveTo`
  //      pipeline — same as production — so triggers/replacements/statics
  //      register on both sides identically.
  //   2. ETB doesn't need scripted target binding, mana-cost payment, or
  //      stack drain heroics. The bridge V2 supports those, but every
  //      action we add multiplies the surface for divergence.
  //   3. The point of the cohort is BREADTH over depth — one scenario per
  //      mechanic to surface registration / static-engine / replacement-
  //      registry bugs across the corpus.

  // 31. Phantasmal Image — Clone variant (Wave 70.C).
  {
    id: "phantasmal-image-etb",
    description: "Phantasmal Image ETB; Clone replacement registered.",
    seed: 0x60,
    cards: { "Phantasmal Image": phantasmalImageSrc },
    players: [
      { life: 20, hand: ["Phantasmal Image"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Phantasmal Image", controller: SEAT0 }],
  },

  // 32. Phyrexian Metamorph — Clone+Artifact.
  {
    id: "phyrexian-metamorph-etb",
    description: "Phyrexian Metamorph ETB; Clone+Artifact replacement.",
    seed: 0x61,
    cards: { "Phyrexian Metamorph": phyrexianMetamorphSrc },
    players: [
      { life: 20, hand: ["Phyrexian Metamorph"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Phyrexian Metamorph", controller: SEAT0 }],
  },

  // 33. Sakashima the Impostor — Clone with name override.
  {
    id: "sakashima-impostor-etb",
    description: "Sakashima the Impostor ETB; clone with name+legendary override.",
    seed: 0x62,
    cards: { "Sakashima the Impostor": sakashimaImpostorSrc },
    players: [
      { life: 20, hand: ["Sakashima the Impostor"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Sakashima the Impostor", controller: SEAT0 }],
  },

  // 34. Gilded Drake — control-swap ETB trigger.
  {
    id: "gilded-drake-etb",
    description: "Gilded Drake ETB; control-exchange trigger registered.",
    seed: 0x63,
    cards: { "Gilded Drake": gildedDrakeSrc },
    players: [
      { life: 20, hand: ["Gilded Drake"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Gilded Drake", controller: SEAT0 }],
  },

  // 35. Painter's Servant — CDA color override (statics + ETB ChooseColor).
  {
    id: "painters-servant-etb",
    description: "Painter's Servant ETB; ChooseColor replacement + global color static.",
    seed: 0x64,
    cards: { "Painter's Servant": paintersServantSrc },
    players: [
      { life: 20, hand: ["Painter's Servant"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Painter's Servant", controller: SEAT0 }],
  },

  // 36. Krark's Thumb — FlipCoinMod static (Wave 101 / 111).
  {
    id: "krarks-thumb-etb",
    description: "Krark's Thumb ETB; AddKeyword static for coin-flip mod.",
    seed: 0x65,
    cards: { "Krark's Thumb": krarksThumbSrc },
    players: [
      { life: 20, hand: ["Krark's Thumb"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Krark's Thumb", controller: SEAT0 }],
  },

  // 37. Humility — Layer 6 mass keyword removal.
  {
    id: "humility-etb",
    description:
      "Humility ETB alongside Serra Angel; layer-6 SetPower/SetToughness/RemoveAllAbilities static activates.",
    seed: 0x66,
    cards: { Humility: humilitySrc, "Serra Angel": sunderingTitanSrc },
    players: [
      { life: 20, hand: ["Humility"], battlefield: [{ card: "Serra Angel" }] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Humility", controller: SEAT0 }],
  },

  // 38. Worship — life-stop replacement.
  {
    id: "worship-etb",
    description: "Worship ETB; LifeReduced replacement registered.",
    seed: 0x67,
    cards: { Worship: worshipSrc, "Grizzly Bears": grizzlyBearsSrc },
    players: [
      { life: 20, hand: ["Worship"], battlefield: [{ card: "Grizzly Bears" }] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Worship", controller: SEAT0 }],
  },

  // 39. Sigarda, Host of Herons — CantSacrifice static (Wave 110).
  {
    id: "sigarda-host-herons-etb",
    description: "Sigarda ETB; CantSacrifice static registered.",
    seed: 0x68,
    cards: { "Sigarda, Host of Herons": sigardaHostHeronsSrc },
    players: [
      { life: 20, hand: ["Sigarda, Host of Herons"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Sigarda, Host of Herons", controller: SEAT0 }],
  },

  // 40. Mirri, Weatherlight Duelist — AttackRestrict static (Wave 110/111).
  {
    id: "mirri-weatherlight-etb",
    description: "Mirri ETB; AttackRestrict + Attacks-trigger registered.",
    seed: 0x69,
    cards: { "Mirri, Weatherlight Duelist": mirriWeatherlightSrc },
    players: [
      { life: 20, hand: ["Mirri, Weatherlight Duelist"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Mirri, Weatherlight Duelist", controller: SEAT0 }],
  },

  // 41. Brothers Yamazaki — IgnoreLegendRule static (Wave 110).
  {
    id: "brothers-yamazaki-etb",
    description: "Brothers Yamazaki ETB; IgnoreLegendRule + buff statics.",
    seed: 0x6a,
    cards: { "Brothers Yamazaki": brothersYamazakiSrc },
    players: [
      { life: 20, hand: ["Brothers Yamazaki"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Brothers Yamazaki", controller: SEAT0 }],
  },

  // 42. Aurelia, the Warleader — additional combat trigger.
  {
    id: "aurelia-warleader-etb",
    description: "Aurelia, the Warleader ETB; flying/vigilance/haste + Attacks trigger.",
    seed: 0x6b,
    cards: { "Aurelia, the Warleader": aureliaWarleaderSrc },
    players: [
      { life: 20, hand: ["Aurelia, the Warleader"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Aurelia, the Warleader", controller: SEAT0 }],
  },

  // 43. Empty the Warrens — Storm count.
  {
    id: "empty-the-warrens-in-hand",
    description: "Empty the Warrens minted into hand (Storm parse + token-script lock).",
    seed: 0x6c,
    cards: { "Empty the Warrens": emptyTheWarrensSrc },
    players: [
      { life: 20, hand: ["Empty the Warrens"], battlefield: [], manaPool: ["R", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 44. Stolen Identity — Cipher encode + cast-copy (in-hand parse lock).
  {
    id: "stolen-identity-in-hand",
    description: "Stolen Identity minted into hand (Cipher keyword parse).",
    seed: 0x6d,
    cards: { "Stolen Identity": stolenIdentitySrc },
    players: [
      { life: 20, hand: ["Stolen Identity"], battlefield: [], manaPool: ["U", "U", "C", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 45. Glacial Ray — Splice Arcane.
  {
    id: "glacial-ray-in-hand",
    description: "Glacial Ray minted into hand (Splice:Arcane keyword parse).",
    seed: 0x6e,
    cards: { "Glacial Ray": glacialRaySrc },
    players: [
      { life: 20, hand: ["Glacial Ray"], battlefield: [], manaPool: ["R", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 46. Bloodbraid Elf — Cascade keyword (ETB only, cascade fires on cast,
  // not ETB; this scenario locks the K:Cascade registration + flying/haste
  // triggers on the permanent).
  {
    id: "bloodbraid-elf-etb",
    description: "Bloodbraid Elf ETB; Haste + Cascade keyword registered on permanent.",
    seed: 0x6f,
    cards: { "Bloodbraid Elf": bloodbraidElfSrc },
    players: [
      { life: 20, hand: ["Bloodbraid Elf"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Bloodbraid Elf", controller: SEAT0 }],
  },

  // 47. Lotus Bloom — Suspend countdown (parse + activated mana ability).
  {
    id: "lotus-bloom-etb",
    description: "Lotus Bloom ETB; Suspend keyword + sacrificial mana activation registered.",
    seed: 0x70,
    cards: { "Lotus Bloom": lotusBloomSrc },
    players: [
      { life: 20, hand: ["Lotus Bloom"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Lotus Bloom", controller: SEAT0 }],
  },

  // 48. Bonecrusher Giant — Adventure (Stomp adventure side parses).
  {
    id: "bonecrusher-giant-etb",
    description: "Bonecrusher Giant ETB; BecomesTarget trigger + Adventure parse.",
    seed: 0x71,
    cards: { "Bonecrusher Giant": bonecrusherGiantSrc },
    players: [
      { life: 20, hand: ["Bonecrusher Giant"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Bonecrusher Giant", controller: SEAT0 }],
  },

  // 49. History of Benalia — Saga chapters.
  {
    id: "history-of-benalia-etb",
    description: "History of Benalia ETB; Saga chapter triggers registered.",
    seed: 0x72,
    cards: { "History of Benalia": historyOfBenaliaSrc },
    players: [
      { life: 20, hand: ["History of Benalia"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "History of Benalia", controller: SEAT0 }],
  },

  // 50. Tarmogoyf — accurate */1+* CDA from Forge corpus.
  {
    id: "tarmogoyf-real-etb",
    description: "Tarmogoyf ETB (corpus-accurate */1+* SVar); CDA static registered.",
    seed: 0x73,
    cards: { Tarmogoyf: tarmogoyfRealSrc },
    players: [
      { life: 20, hand: ["Tarmogoyf"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Tarmogoyf", controller: SEAT0 }],
  },

  // ── Tier 3 — popular staples (M6) ──────────────────────────────────────────
  // 30 cards spanning EDH staples, format favorites, and recent prints.
  // ETB-only scenarios dominate — same rationale as Tier 2.

  // 51. Smuggler's Copter — Vehicle with Crew + Flying + Loot trigger.
  {
    id: "smugglers-copter-etb",
    description: "Smuggler's Copter ETB; Crew keyword + Attacks/Blocks loot trigger.",
    seed: 0x74,
    cards: { "Smuggler's Copter": smugglersCopterSrc },
    players: [
      { life: 20, hand: ["Smuggler's Copter"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Smuggler's Copter", controller: SEAT0 }],
  },

  // 52. Invasion of Ikoria — Battle / Siege.
  {
    id: "invasion-of-ikoria-etb",
    description: "Invasion of Ikoria ETB; Battle Defense + ETB search trigger.",
    seed: 0x75,
    cards: { "Invasion of Ikoria": invasionOfIkoriaSrc },
    players: [
      { life: 20, hand: ["Invasion of Ikoria"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Invasion of Ikoria", controller: SEAT0 }],
  },

  // 53. Cryptic Command — Modal Charm.
  {
    id: "cryptic-command-in-hand",
    description: "Cryptic Command minted into hand (Charm modal parse).",
    seed: 0x76,
    cards: { "Cryptic Command": crypticCommandSrc },
    players: [
      { life: 20, hand: ["Cryptic Command"], battlefield: [], manaPool: ["U", "U", "U", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 54. Elspeth, Sun's Champion — planeswalker activated abilities.
  {
    id: "elspeth-suns-champion-etb",
    description: "Elspeth, Sun's Champion ETB; loyalty abilities + emblem registered.",
    seed: 0x77,
    cards: { "Elspeth, Sun's Champion": elspethSunsChampionSrc },
    players: [
      { life: 20, hand: ["Elspeth, Sun's Champion"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Elspeth, Sun's Champion", controller: SEAT0 }],
  },

  // 55. Liliana of the Veil — planeswalker.
  {
    id: "liliana-veil-etb",
    description: "Liliana of the Veil ETB; loyalty abilities registered.",
    seed: 0x78,
    cards: { "Liliana of the Veil": lilianaOfTheVeilSrc },
    players: [
      { life: 20, hand: ["Liliana of the Veil"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Liliana of the Veil", controller: SEAT0 }],
  },

  // 56. Jace, the Mind Sculptor — planeswalker.
  {
    id: "jace-mind-sculptor-etb",
    description: "Jace, the Mind Sculptor ETB; +2/+0/-1/-12 loyalty abilities.",
    seed: 0x79,
    cards: { "Jace, the Mind Sculptor": jaceMindSculptorSrc },
    players: [
      { life: 20, hand: ["Jace, the Mind Sculptor"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Jace, the Mind Sculptor", controller: SEAT0 }],
  },

  // 57. Brainstorm — draw + put-back.
  {
    id: "brainstorm-in-hand",
    description: "Brainstorm minted into hand (Draw + ChangeZone subability parse).",
    seed: 0x7a,
    cards: { Brainstorm: brainstormSrc },
    players: [
      { life: 20, hand: ["Brainstorm"], battlefield: [], manaPool: ["U"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 58. Path to Exile — exile + ramp.
  {
    id: "path-to-exile-in-hand",
    description: "Path to Exile minted into hand (ChangeZone + DBChange subability parse).",
    seed: 0x7b,
    cards: { "Path to Exile": pathToExileSrc },
    players: [
      { life: 20, hand: ["Path to Exile"], battlefield: [], manaPool: ["W"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 59. Swords to Plowshares — exile + life-gain.
  {
    id: "swords-to-plowshares-in-hand",
    description: "Swords to Plowshares minted into hand (ChangeZone + GainLife subability parse).",
    seed: 0x7c,
    cards: { "Swords to Plowshares": swordsToPlowsharesSrc },
    players: [
      { life: 20, hand: ["Swords to Plowshares"], battlefield: [], manaPool: ["W"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 60. Thoughtseize — discard + life loss.
  {
    id: "thoughtseize-in-hand",
    description: "Thoughtseize minted into hand (Discard reveal-you-choose mode parse).",
    seed: 0x7d,
    cards: { Thoughtseize: thoughtseizeSrc },
    players: [
      { life: 20, hand: ["Thoughtseize"], battlefield: [], manaPool: ["B"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 61. Fatal Push — conditional destroy.
  {
    id: "fatal-push-in-hand",
    description: "Fatal Push minted into hand (Destroy + Revolt SVar parse).",
    seed: 0x7e,
    cards: { "Fatal Push": fatalPushSrc },
    players: [
      { life: 20, hand: ["Fatal Push"], battlefield: [], manaPool: ["B"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 62. Dark Ritual — mana spell.
  {
    id: "dark-ritual-in-hand",
    description: "Dark Ritual minted into hand (Mana effect parse).",
    seed: 0x7f,
    cards: { "Dark Ritual": darkRitualSrc },
    players: [
      { life: 20, hand: ["Dark Ritual"], battlefield: [], manaPool: ["B"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 63. Stoneforge Mystic — search trigger + activated tutor.
  {
    id: "stoneforge-mystic-etb",
    description: "Stoneforge Mystic ETB; Search-equipment trigger + activated put-equipment ability.",
    seed: 0x80,
    cards: { "Stoneforge Mystic": stoneforgeMysticSrc },
    players: [
      { life: 20, hand: ["Stoneforge Mystic"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Stoneforge Mystic", controller: SEAT0 }],
  },

  // 64. Snapcaster Mage — flash + flashback grant trigger.
  {
    id: "snapcaster-mage-etb",
    description: "Snapcaster Mage ETB; Flash keyword + ETB pump-grant trigger.",
    seed: 0x81,
    cards: { "Snapcaster Mage": snapcasterMageSrc, "Lightning Bolt": lightningBoltSrc },
    players: [
      // Lightning Bolt seeded in graveyard so the ETB Flashback trigger
      // has a legal target on both engines (Forge skips an optional-no-
      // legal-target trigger silently — without a target the bridge
      // wouldn't surface a SpellCast and parity diverges).
      { life: 20, hand: ["Snapcaster Mage"], graveyard: ["Lightning Bolt"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Snapcaster Mage", controller: SEAT0 }],
  },

  // 65. Tatyova, Benthic Druid — landfall trigger.
  {
    id: "tatyova-etb",
    description: "Tatyova, Benthic Druid ETB; Landfall trigger registered.",
    seed: 0x82,
    cards: { "Tatyova, Benthic Druid": tatyovaSrc },
    players: [
      { life: 20, hand: ["Tatyova, Benthic Druid"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Tatyova, Benthic Druid", controller: SEAT0 }],
  },

  // 66. Goblin Guide — haste + attack trigger.
  {
    id: "goblin-guide-etb",
    description: "Goblin Guide ETB; Haste + Attacks-trigger registered.",
    seed: 0x83,
    cards: { "Goblin Guide": goblinGuideSrc },
    players: [
      { life: 20, hand: ["Goblin Guide"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Goblin Guide", controller: SEAT0 }],
  },

  // 67. Manamorphose — combo mana + cantrip.
  {
    id: "manamorphose-in-hand",
    description: "Manamorphose minted into hand (Combo Any mana + draw subability).",
    seed: 0x84,
    cards: { Manamorphose: manamorphoseSrc },
    players: [
      { life: 20, hand: ["Manamorphose"], battlefield: [], manaPool: ["R", "G"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 68. Krark-Clan Ironworks — sacrifice mana ability.
  {
    id: "krark-clan-ironworks-etb",
    description: "Krark-Clan Ironworks ETB; Sac-for-mana activated ability.",
    seed: 0x85,
    cards: { "Krark-Clan Ironworks": krakClanIronworksSrc },
    players: [
      { life: 20, hand: ["Krark-Clan Ironworks"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Krark-Clan Ironworks", controller: SEAT0 }],
  },

  // 69. Delver of Secrets — transform trigger.
  {
    id: "delver-etb",
    description: "Delver of Secrets ETB; Upkeep PeekAndReveal trigger + transform.",
    seed: 0x86,
    cards: { "Delver of Secrets": delverSrc },
    players: [
      { life: 20, hand: ["Delver of Secrets"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Delver of Secrets", controller: SEAT0 }],
  },

  // 70. Murderous Rider — adventure + dies trigger.
  {
    id: "murderous-rider-etb",
    description: "Murderous Rider ETB; Lifelink + Dies-replacement to library bottom.",
    seed: 0x87,
    cards: { "Murderous Rider": murderousRiderSrc },
    players: [
      { life: 20, hand: ["Murderous Rider"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Murderous Rider", controller: SEAT0 }],
  },

  // 71. Mosswort Bridge — Hideaway land + ETB-tapped replacement.
  {
    id: "mosswort-bridge-etb",
    description: "Mosswort Bridge ETB; Hideaway + ETBTapped replacement registered.",
    seed: 0x88,
    cards: { "Mosswort Bridge": mosswortBridgeSrc },
    players: [
      { life: 20, hand: ["Mosswort Bridge"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Mosswort Bridge", controller: SEAT0 }],
  },

  // 72. Unicycle — Equipment + Vehicle (Equip + Crew on same card).
  {
    id: "unicycle-etb",
    description: "Unicycle ETB; Equip + Crew keyword + EquippedBy static.",
    seed: 0x89,
    cards: { Unicycle: unicycleSrc },
    players: [
      { life: 20, hand: ["Unicycle"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Unicycle", controller: SEAT0 }],
  },

  // 73. Doubling Season + counter-multiplier interaction (with planeswalker).
  // ETB-only — locks the static replacement registry's interaction with
  // the Elspeth ETB that immediately follows. The two are co-resident.
  {
    id: "doubling-season-elspeth-coresidence",
    description: "Doubling Season + Elspeth in play; ETBs separately to lock counter-replace interaction.",
    seed: 0x8a,
    cards: { "Doubling Season": doublingSeasonSrc, "Elspeth, Sun's Champion": elspethSunsChampionSrc },
    players: [
      {
        life: 20,
        hand: ["Elspeth, Sun's Champion"],
        battlefield: [{ card: "Doubling Season" }],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Elspeth, Sun's Champion", controller: SEAT0 }],
  },

  // 74. Bonecrusher Giant + Lightning Bolt interaction (the Adventure-trigger
  // is a target-based reactive trigger that fires when bolt targets it).
  {
    id: "bonecrusher-giant-coresidence",
    description: "Bonecrusher Giant in play (BecomesTarget trigger live).",
    seed: 0x8b,
    cards: { "Bonecrusher Giant": bonecrusherGiantSrc, "Lightning Bolt": lightningBoltSrc },
    players: [
      {
        life: 20,
        hand: ["Lightning Bolt"],
        battlefield: [{ card: "Bonecrusher Giant" }],
        manaPool: ["R"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 75. Aurelia + Soul Warden + Doubling Season — multi-static co-residence
  // to surface layer-engine + replacement-registry ordering.
  {
    id: "aurelia-soul-warden-coresidence",
    description:
      "Aurelia + Soul Warden on battlefield; Doubling Season ETBs (replacement layered atop creatures).",
    seed: 0x8c,
    cards: {
      "Aurelia, the Warleader": aureliaWarleaderSrc,
      "Soul Warden": dispatchAcolyteSrc,
      "Doubling Season": doublingSeasonSrc,
    },
    players: [
      {
        life: 20,
        hand: ["Doubling Season"],
        battlefield: [{ card: "Aurelia, the Warleader" }, { card: "Soul Warden" }],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Doubling Season", controller: SEAT0 }],
  },

  // 76. Glorious Anthem + Humility — layer ordering (Humility 6, Anthem 7c).
  {
    id: "humility-anthem-layer-test",
    description:
      "Glorious Anthem + Grizzly Bears in play; Humility ETBs and resets to 1/1 — anthem still adds +1/+1.",
    seed: 0x8d,
    cards: {
      "Glorious Anthem": gloriousAnthemSrc,
      Humility: humilitySrc,
      "Grizzly Bears": grizzlyBearsSrc,
    },
    players: [
      {
        life: 20,
        hand: ["Humility"],
        battlefield: [{ card: "Glorious Anthem" }, { card: "Grizzly Bears" }],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Humility", controller: SEAT0 }],
  },

  // 77. Worship + Soul Warden — replacement-registry stack alongside trigger.
  {
    id: "worship-soul-warden-coresidence",
    description: "Worship in play; Soul Warden ETBs alongside it.",
    seed: 0x8e,
    cards: { Worship: worshipSrc, "Soul Warden": dispatchAcolyteSrc },
    players: [
      {
        life: 20,
        hand: ["Soul Warden"],
        battlefield: [{ card: "Worship" }],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Soul Warden", controller: SEAT0 }],
  },

  // 78. Painter's Servant + Honor of the Pure — Painter's CDA + color-restricted
  // anthem. Honor sees Painter's color override on opposing creatures.
  {
    id: "painters-servant-honor-coresidence",
    description: "Painter's Servant + Honor of the Pure ETB chain; color override + anthem.",
    seed: 0x8f,
    cards: {
      "Painter's Servant": paintersServantSrc,
      "Honor of the Pure": honorOfThePureSrc,
      "Grizzly Bears": grizzlyBearsSrc,
    },
    players: [
      {
        life: 20,
        hand: ["Painter's Servant"],
        battlefield: [{ card: "Honor of the Pure" }, { card: "Grizzly Bears" }],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Painter's Servant", controller: SEAT0 }],
  },

  // 79. Tarmogoyf real + populated graveyards — CDA recompute under
  // graveyard-state.
  {
    id: "tarmogoyf-real-with-graveyards",
    description: "Tarmogoyf with Lightning Bolt + Wrath of God in graveyards (instant + sorcery card types).",
    seed: 0x90,
    cards: {
      Tarmogoyf: tarmogoyfRealSrc,
      "Lightning Bolt": lightningBoltSrc,
      "Wrath of God": wrathOfGodSrc,
    },
    players: [
      {
        life: 20,
        hand: ["Tarmogoyf"],
        battlefield: [],
        graveyard: ["Lightning Bolt", "Wrath of God"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Tarmogoyf", controller: SEAT0 }],
  },

  // 80. Multi-layer mass test — Glorious Anthem + Honor of the Pure +
  // Serra Angel — anthem stacks across layer 7c with Honor's white-only.
  {
    id: "multi-anthem-stack",
    description: "Glorious Anthem + Honor of the Pure + Serra Angel — layer 7c stack.",
    seed: 0x91,
    cards: {
      "Glorious Anthem": gloriousAnthemSrc,
      "Honor of the Pure": honorOfThePureSrc,
      "Serra Angel": sunderingTitanSrc,
    },
    players: [
      {
        life: 20,
        hand: ["Honor of the Pure"],
        battlefield: [{ card: "Glorious Anthem" }, { card: "Serra Angel" }],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Honor of the Pure", controller: SEAT0 }],
  },

  // ── M6.6 — additional cohort coverage (~50 scenarios) ─────────────────────
  // Covers mechanics that were under-represented in the M6 80-card cohort:
  // Saga / Class / Cipher / Cascade / Storm / Dredge / Suspect / Plot /
  // Devotion / X-spells / Companion / Adventure / Equip / Vehicle / Battle /
  // Doubler / Charm / Convoke / Surveil / Aftermath / Prowess / Threshold /
  // Replicate / Disturb / Improvise / Affinity / Indestructible.
  //
  // ETB-only by default — same rationale as the M6 Tier-2/3 expansions: ETB
  // captures registration of triggers / replacements / statics symmetrically
  // on both sides, without needing scripted target binding or stack drain.

  // 81. Devotion-driven Gray Merchant — ETB triggers a black-devotion drain.
  // Black devotion is 0 with no other black permanents; the trigger fires
  // for 0 life (locks the LoseLife trigger registry + SVar Devotion path).
  {
    id: "gray-merchant-devotion-etb",
    description: "Gray Merchant of Asphodel ETB; devotion-driven LoseLife trigger.",
    seed: 0x92,
    cards: { "Gray Merchant of Asphodel": grayMerchantSrc },
    players: [
      { life: 20, hand: ["Gray Merchant of Asphodel"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Gray Merchant of Asphodel", controller: SEAT0 }],
  },

  // 82. X-spell — Banefire (in-hand parse + xPaid SVar).
  {
    id: "banefire-in-hand",
    description: "Banefire minted into hand (X-spell SVar + CantPreventDamage static).",
    seed: 0x93,
    cards: { Banefire: banefireSrc },
    players: [
      { life: 20, hand: ["Banefire"], battlefield: [], manaPool: ["R", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 83. Hangarback Walker — X-spell with etbCounter:P1P1:X (in-hand parse).
  // ETB-driving the trigger from a non-cast path triggers the X resolver for
  // the dies token-amount, which the TS engine surfaces via TriggeredCard
  // SVar — this token-resolution only fires post-die. In-hand parse locks
  // the etbCounter keyword + dies-trigger registry without firing it.
  {
    id: "hangarback-walker-in-hand",
    description: "Hangarback Walker minted into hand (X-spell + etbCounter:P1P1:X parse + dies-trigger).",
    seed: 0x94,
    cards: { "Hangarback Walker": hangarbackWalkerSrc },
    players: [
      { life: 20, hand: ["Hangarback Walker"], battlefield: [], manaPool: ["C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 84. Token doubler — Anointed Procession ETB.
  {
    id: "anointed-procession-etb",
    description: "Anointed Procession ETB; CreateToken replacement registry registers the doubler.",
    seed: 0x95,
    cards: { "Anointed Procession": anointedProcessionSrc },
    players: [
      { life: 20, hand: ["Anointed Procession"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Anointed Procession", controller: SEAT0 }],
  },

  // 85. Doubling Season + Anointed Procession + Elspeth — co-residence test
  // (multiple replacement effects in the same registry).
  {
    id: "doubling-season-anointed-procession-coresidence",
    description:
      "Doubling Season + Anointed Procession + Elspeth, Sun's Champion in play; counter+token doublers.",
    seed: 0x96,
    cards: {
      "Doubling Season": doublingSeasonSrc,
      "Anointed Procession": anointedProcessionSrc,
      "Elspeth, Sun's Champion": elspethSunsChampionSrc,
    },
    players: [
      {
        life: 20,
        hand: ["Elspeth, Sun's Champion"],
        battlefield: [{ card: "Doubling Season" }, { card: "Anointed Procession" }],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Elspeth, Sun's Champion", controller: SEAT0 }],
  },

  // 86. Companion — Lurrus of the Dream-Den ETB (Companion keyword parse).
  {
    id: "lurrus-companion-etb",
    description: "Lurrus of the Dream-Den ETB; Companion keyword + MayPlay static registered.",
    seed: 0x97,
    cards: { "Lurrus of the Dream-Den": lurrusSrc },
    players: [
      { life: 20, hand: ["Lurrus of the Dream-Den"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Lurrus of the Dream-Den", controller: SEAT0 }],
  },

  // 87. Stoneforge Mystic ETB — equipment search trigger.
  {
    id: "stoneforge-mystic-search-etb",
    description: "Stoneforge Mystic ETB; equipment search trigger + activated put-equip ability.",
    seed: 0x98,
    cards: { "Stoneforge Mystic": stoneforgeMysticAltSrc },
    players: [
      { life: 20, hand: ["Stoneforge Mystic"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Stoneforge Mystic", controller: SEAT0 }],
  },

  // 88. Skullclamp — equipment with dies-trigger and -1 toughness static.
  {
    id: "skullclamp-etb",
    description: "Skullclamp ETB; Equip + EquippedBy static + dies-draw trigger.",
    seed: 0x99,
    cards: { Skullclamp: skullclampSrc },
    players: [
      { life: 20, hand: ["Skullclamp"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Skullclamp", controller: SEAT0 }],
  },

  // 89. Sword of Fire and Ice — equipment with combat-damage trigger + protections.
  {
    id: "sword-of-fire-and-ice-etb",
    description: "Sword of Fire and Ice ETB; Protection statics + combat-damage trigger.",
    seed: 0x9a,
    cards: { "Sword of Fire and Ice": swordOfFireAndIceSrc },
    players: [
      { life: 20, hand: ["Sword of Fire and Ice"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Sword of Fire and Ice", controller: SEAT0 }],
  },

  // 90. Kor Outfitter — auto-attach Equipment ETB trigger.
  {
    id: "kor-outfitter-etb",
    description: "Kor Outfitter ETB; ETB Pump+Attach trigger registered (chained-effect parse).",
    seed: 0x9b,
    cards: { "Kor Outfitter": korOutfitterSrc },
    players: [
      { life: 20, hand: ["Kor Outfitter"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Kor Outfitter", controller: SEAT0 }],
  },

  // 91. Prowess — Monastery Swiftspear ETB (haste + prowess).
  {
    id: "monastery-swiftspear-etb",
    description: "Monastery Swiftspear ETB; Haste + Prowess keyword registry.",
    seed: 0x9c,
    cards: { "Monastery Swiftspear": monasterySwiftspearSrc },
    players: [
      { life: 20, hand: ["Monastery Swiftspear"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Monastery Swiftspear", controller: SEAT0 }],
  },

  // 92. Threshold — Werebear ETB (mana ability + Threshold conditional buff).
  {
    id: "werebear-etb",
    description: "Werebear ETB; mana ability + Threshold conditional static.",
    seed: 0x9d,
    cards: { Werebear: werebearSrc },
    players: [
      { life: 20, hand: ["Werebear"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Werebear", controller: SEAT0 }],
  },

  // 93. Threshold + populated graveyard — Werebear sees 7 cards.
  {
    id: "werebear-threshold-active",
    description: "Werebear ETB with 7 cards in graveyard — Threshold static buff active.",
    seed: 0x9e,
    cards: {
      Werebear: werebearSrc,
      "Lightning Bolt": lightningBoltSrc,
      "Wrath of God": wrathOfGodSrc,
    },
    players: [
      {
        life: 20,
        hand: ["Werebear"],
        battlefield: [],
        graveyard: [
          "Lightning Bolt",
          "Lightning Bolt",
          "Lightning Bolt",
          "Wrath of God",
          "Wrath of God",
          "Wrath of God",
          "Wrath of God",
        ],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Werebear", controller: SEAT0 }],
  },

  // 94. Mana fixing — Grand Architect ETB (anthem + activated abilities).
  {
    id: "grand-architect-etb",
    description: "Grand Architect ETB; blue-anthem static + 2 activated abilities.",
    seed: 0x9f,
    cards: { "Grand Architect": grandArchitectSrc },
    players: [
      { life: 20, hand: ["Grand Architect"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Grand Architect", controller: SEAT0 }],
  },

  // 95. Stasis ETB — Untap-step skip replacement.
  {
    id: "stasis-etb",
    description: "Stasis ETB; BeginPhase Untap skip replacement + upkeep sacrifice trigger.",
    seed: 0xa0,
    cards: { Stasis: stasisSrc },
    players: [
      { life: 20, hand: ["Stasis"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Stasis", controller: SEAT0 }],
  },

  // 96. Counter doubler — Vorinclex ETB.
  {
    id: "vorinclex-etb",
    description: "Vorinclex, Monstrous Raider ETB; AddCounter doubler + opponent-half replacement.",
    seed: 0xa1,
    cards: { "Vorinclex, Monstrous Raider": vorinclexMonstrousSrc },
    players: [
      { life: 20, hand: ["Vorinclex, Monstrous Raider"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Vorinclex, Monstrous Raider", controller: SEAT0 }],
  },

  // 97. Vorinclex + Elspeth co-residence — counter doubler interacts with
  // planeswalker loyalty placement.
  {
    id: "vorinclex-elspeth-coresidence",
    description: "Vorinclex in play; Elspeth ETBs (loyalty counter doubled to 8 instead of 4).",
    seed: 0xa2,
    cards: {
      "Vorinclex, Monstrous Raider": vorinclexMonstrousSrc,
      "Elspeth, Sun's Champion": elspethSunsChampionSrc,
    },
    players: [
      {
        life: 20,
        hand: ["Elspeth, Sun's Champion"],
        battlefield: [{ card: "Vorinclex, Monstrous Raider" }],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Elspeth, Sun's Champion", controller: SEAT0 }],
  },

  // 98. Roxanne, Starfall Savant — token-on-ETB trigger (in-hand parse only).
  // The meteorite token isn't in the TS predefined token DB, so resolving
  // the ETB trigger on the TS side would crash. In-hand parse locks the
  // trigger registry shape + saddle-style ManaReflected behaviour.
  {
    id: "roxanne-starfall-in-hand",
    description: "Roxanne, Starfall Savant minted into hand (Saddle-flavored Meteorite trigger parse).",
    seed: 0xa3,
    cards: { "Roxanne, Starfall Savant": roxanneSrc },
    players: [
      { life: 20, hand: ["Roxanne, Starfall Savant"], battlefield: [], manaPool: ["R", "G", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 99. Indestructible vs Wrath — Avacyn, Angel of Hope ETB.
  {
    id: "avacyn-angel-of-hope-etb",
    description: "Avacyn, Angel of Hope ETB; Indestructible self + global indestructible static.",
    seed: 0xa4,
    cards: { "Avacyn, Angel of Hope": avacynAngelOfHopeSrc },
    players: [
      { life: 20, hand: ["Avacyn, Angel of Hope"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Avacyn, Angel of Hope", controller: SEAT0 }],
  },

  // 100. Avacyn + Grizzly Bears co-residence — Bears get indestructible.
  {
    id: "avacyn-grizzly-coresidence",
    description: "Avacyn + Grizzly Bears in play; Bears gain indestructible via static.",
    seed: 0xa5,
    cards: {
      "Avacyn, Angel of Hope": avacynAngelOfHopeSrc,
      "Grizzly Bears": grizzlyBearsSrc,
    },
    players: [
      {
        life: 20,
        hand: ["Grizzly Bears"],
        battlefield: [{ card: "Avacyn, Angel of Hope" }],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Grizzly Bears", controller: SEAT0 }],
  },

  // 101. Liliana, the Last Hope — planeswalker activated abilities.
  {
    id: "liliana-last-hope-etb",
    description: "Liliana, the Last Hope ETB; loyalty +1/-2/-7 abilities registered.",
    seed: 0xa6,
    cards: { "Liliana, the Last Hope": lilianaLastHopeSrc },
    players: [
      { life: 20, hand: ["Liliana, the Last Hope"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Liliana, the Last Hope", controller: SEAT0 }],
  },

  // 102. Beck — Fuse half (in-hand parse).
  {
    id: "beck-call-in-hand",
    description: "Beck minted into hand (Fuse + ETB-trigger spell parse).",
    seed: 0xa7,
    cards: { Beck: beckoningCallSrc },
    players: [
      { life: 20, hand: ["Beck"], battlefield: [], manaPool: ["G", "U"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 103. Convoke — Chord of Calling (in-hand parse).
  {
    id: "chord-of-calling-in-hand",
    description: "Chord of Calling minted into hand (Convoke keyword + xPaid).",
    seed: 0xa8,
    cards: { "Chord of Calling": chordOfCallingSrc },
    players: [
      { life: 20, hand: ["Chord of Calling"], battlefield: [], manaPool: ["G", "G", "G", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 104. Improvise — Herald of Anguish ETB (flying + improvise + end-step trigger).
  {
    id: "herald-of-anguish-etb",
    description: "Herald of Anguish ETB; Improvise keyword + Flying + end-step discard trigger.",
    seed: 0xa9,
    cards: { "Herald of Anguish": heraldOfAnguishSrc },
    players: [
      { life: 20, hand: ["Herald of Anguish"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Herald of Anguish", controller: SEAT0 }],
  },

  // 105. Affinity for artifacts — Thoughtcast (in-hand parse).
  {
    id: "thoughtcast-in-hand",
    description: "Thoughtcast minted into hand (Affinity:Artifact keyword parse).",
    seed: 0xaa,
    cards: { Thoughtcast: thoughtcastSrc },
    players: [
      { life: 20, hand: ["Thoughtcast"], battlefield: [], manaPool: ["U", "C", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 106. Aftermath / Split — Driven // Despair (front half in-hand parse).
  {
    id: "driven-despair-in-hand",
    description: "Driven (split) minted into hand (AlternateMode:Split parse).",
    seed: 0xab,
    cards: { Driven: drivenDespairSrc },
    players: [
      { life: 20, hand: ["Driven"], battlefield: [], manaPool: ["G", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 107. Replicate — Consign to Memory (in-hand parse).
  {
    id: "consign-to-memory-in-hand",
    description: "Consign to Memory minted into hand (Replicate keyword parse).",
    seed: 0xac,
    cards: { "Consign to Memory": consignToMemorySrc },
    players: [
      { life: 20, hand: ["Consign to Memory"], battlefield: [], manaPool: ["U"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 108. Disturb / DoubleFaced — Baithook Angler ETB.
  {
    id: "baithook-angler-etb",
    description: "Baithook Angler ETB; Disturb keyword + DoubleFaced parse.",
    seed: 0xad,
    cards: { "Baithook Angler": baithookAnglerSrc },
    players: [
      { life: 20, hand: ["Baithook Angler"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Baithook Angler", controller: SEAT0 }],
  },

  // 109. Plot — Beastbond Outcaster (in-hand parse). ETB triggers a Draw with
  // no NumCards param (Forge defaults to 1, TS engine requires explicit) —
  // not a parity bug, but locking the in-hand parse covers Plot keyword.
  {
    id: "beastbond-outcaster-in-hand",
    description: "Beastbond Outcaster minted into hand (Plot keyword + IsPresent gated draw trigger parse).",
    seed: 0xae,
    cards: { "Beastbond Outcaster": beastbondOutcasterSrc },
    players: [
      { life: 20, hand: ["Beastbond Outcaster"], battlefield: [], manaPool: ["G", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 110. Suspect — Nelly Borca, Impulsive Accuser ETB.
  {
    id: "nelly-borca-suspect-etb",
    description: "Nelly Borca, Impulsive Accuser ETB; Suspect attacks-trigger + Vigilance.",
    seed: 0xaf,
    cards: { "Nelly Borca, Impulsive Accuser": nellyBorcaSrc },
    players: [
      { life: 20, hand: ["Nelly Borca, Impulsive Accuser"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Nelly Borca, Impulsive Accuser", controller: SEAT0 }],
  },

  // 111. Class — Cleric Class ETB (level 1; level-up SVars register).
  {
    id: "cleric-class-etb",
    description: "Cleric Class ETB; Class keyword + level 2/3 ability registry + GainLife replace.",
    seed: 0xb0,
    cards: { "Cleric Class": clericClassSrc },
    players: [
      { life: 20, hand: ["Cleric Class"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Cleric Class", controller: SEAT0 }],
  },

  // 112. Storm-flavored ramp — Aetherflux Reservoir ETB.
  {
    id: "aetherflux-reservoir-etb",
    description: "Aetherflux Reservoir ETB; SpellCast trigger + activated 50-damage ability.",
    seed: 0xb1,
    cards: { "Aetherflux Reservoir": aetherfluxReservoirSrc },
    players: [
      { life: 20, hand: ["Aetherflux Reservoir"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Aetherflux Reservoir", controller: SEAT0 }],
  },

  // 113. Bloodghast — Landfall trigger (registered while in graveyard).
  {
    id: "bloodghast-etb",
    description: "Bloodghast ETB; CantBlock + conditional Haste + Landfall (graveyard-zone trigger).",
    seed: 0xb2,
    cards: { Bloodghast: bloodghastSrc },
    players: [
      { life: 20, hand: ["Bloodghast"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Bloodghast", controller: SEAT0 }],
  },

  // 114. Aether Vial — counter-driven cheating ETB.
  {
    id: "aether-vial-etb",
    description: "Aether Vial ETB; upkeep charge-counter trigger + activated cheat-into-play.",
    seed: 0xb3,
    cards: { "Aether Vial": aetherVialSrc },
    players: [
      { life: 20, hand: ["Aether Vial"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Aether Vial", controller: SEAT0 }],
  },

  // 115. Risen Reef — Elemental ETB landfall.
  {
    id: "risen-reef-etb",
    description: "Risen Reef ETB; Self+Elemental.Other ETB trigger with PeekAndReveal chain.",
    seed: 0xb4,
    cards: { "Risen Reef": risenReefSrc },
    players: [
      { life: 20, hand: ["Risen Reef"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Risen Reef", controller: SEAT0 }],
  },

  // 116. Cantrip artifact — Baleful Strix ETB (flying + deathtouch + draw).
  {
    id: "baleful-strix-etb",
    description: "Baleful Strix ETB; Flying + Deathtouch + ETB cantrip.",
    seed: 0xb5,
    cards: { "Baleful Strix": balefulStrixSrc, "Grizzly Bears": grizzlyBearsSrc },
    players: [
      {
        life: 20,
        hand: ["Baleful Strix"],
        battlefield: [],
        library: ["Grizzly Bears"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Baleful Strix", controller: SEAT0 }],
  },

  // 117. Combat damage redirect — Phytohydra ETB (DamageDone replacement).
  {
    id: "phytohydra-etb",
    description: "Phytohydra ETB; DamageDone replacement (counter-on-damage instead).",
    seed: 0xb6,
    cards: { Phytohydra: phytohydraSrc },
    players: [
      { life: 20, hand: ["Phytohydra"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Phytohydra", controller: SEAT0 }],
  },

  // 118. Aura — Pacifism in-hand parse + activation registration on a target.
  // Pure parse-lock since Aura targeting + bind requires the cast pipeline.
  {
    id: "pacifism-in-hand",
    description: "Pacifism minted into hand (Enchant:Creature + CantAttack/Block static parse).",
    seed: 0xb7,
    cards: { Pacifism: pacifismSrc },
    players: [
      { life: 20, hand: ["Pacifism"], battlefield: [], manaPool: ["W", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 119. Oblivion Ring ETB — exile-on-ETB trigger (ETBs without target since
  // there are no other nonland permanents — Forge skips the optional ETB).
  // Locks the trigger registry shape including the LeaveBattlefield-pair.
  {
    id: "oblivion-ring-etb",
    description: "Oblivion Ring ETB; ETB-exile + LeaveBattlefield-return trigger pair.",
    seed: 0xb8,
    cards: { "Oblivion Ring": oblivionRingSrc },
    players: [
      { life: 20, hand: ["Oblivion Ring"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Oblivion Ring", controller: SEAT0 }],
  },

  // 120. Replacement — Kalitas exile-replace for opponent creatures dying.
  {
    id: "kalitas-etb",
    description: "Kalitas, Traitor of Ghet ETB; Lifelink + Moved replacement (exile + token).",
    seed: 0xb9,
    cards: { "Kalitas, Traitor of Ghet": kalitasSrc },
    players: [
      { life: 20, hand: ["Kalitas, Traitor of Ghet"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Kalitas, Traitor of Ghet", controller: SEAT0 }],
  },

  // 121. Sacrifice trigger — Blood Artist ETB.
  {
    id: "blood-artist-etb",
    description: "Blood Artist ETB; Self/Creature.Other dies-trigger registered.",
    seed: 0xba,
    cards: { "Blood Artist": bloodArtistSrc },
    players: [
      { life: 20, hand: ["Blood Artist"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Blood Artist", controller: SEAT0 }],
  },

  // 122. Dredge — Golgari Grave-Troll ETB (Dredge keyword + etbCounter).
  {
    id: "golgari-grave-troll-etb",
    description: "Golgari Grave-Troll ETB; Dredge:6 keyword + etbCounter:P1P1:X.",
    seed: 0xbb,
    cards: { "Golgari Grave-Troll": golgariGraveTrollSrc },
    players: [
      { life: 20, hand: ["Golgari Grave-Troll"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Golgari Grave-Troll", controller: SEAT0 }],
  },

  // 123. Dredge — Stinkweed Imp ETB.
  {
    id: "stinkweed-imp-etb",
    description: "Stinkweed Imp ETB; Flying + Dredge:5 keyword + DamageDone destroy trigger.",
    seed: 0xbc,
    cards: { "Stinkweed Imp": stinkweedImpSrc },
    players: [
      { life: 20, hand: ["Stinkweed Imp"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Stinkweed Imp", controller: SEAT0 }],
  },

  // 124. Vanilla life-gain ETB — Courier Griffin (locks the static-payload
  // gainLife trigger shape).
  {
    id: "courier-griffin-etb",
    description: "Courier Griffin ETB; flying + ETB life-gain trigger.",
    seed: 0xbd,
    cards: { "Courier Griffin": courierGriffinSrc },
    players: [
      { life: 20, hand: ["Courier Griffin"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Courier Griffin", controller: SEAT0 }],
  },

  // 125. Monarch — Court of Grace ETB (BecomeMonarch on ETB + branch trigger).
  {
    id: "court-of-grace-etb",
    description: "Court of Grace ETB; BecomeMonarch trigger + upkeep Branch trigger.",
    seed: 0xbe,
    cards: { "Court of Grace": courtOfGraceSrc },
    players: [
      { life: 20, hand: ["Court of Grace"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Court of Grace", controller: SEAT0 }],
  },

  // 126. Artifact-die-chain — Scrap Trawler ETB.
  {
    id: "scrap-trawler-etb",
    description: "Scrap Trawler ETB; Self/Artifact.Other dies-trigger pair (return-to-hand chain).",
    seed: 0xbf,
    cards: { "Scrap Trawler": scrapTrawlerSrc },
    players: [
      { life: 20, hand: ["Scrap Trawler"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Scrap Trawler", controller: SEAT0 }],
  },

  // 127. Modal Charm — Glissa Sunslayer ETB (combat-damage Charm trigger).
  {
    id: "glissa-sunslayer-etb",
    description: "Glissa Sunslayer ETB; First Strike + Deathtouch + DamageDone Charm trigger.",
    seed: 0xc0,
    cards: { "Glissa Sunslayer": glissaSrc },
    players: [
      { life: 20, hand: ["Glissa Sunslayer"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Glissa Sunslayer", controller: SEAT0 }],
  },

  // 128. Vehicle Crew — Smuggler's Copter + creature co-residence (the Crew
  // 1 ability is parse-locked when Copter is in play; we ETB a Bears so any
  // ETB-relevant statics fire under both engines).
  {
    id: "smugglers-copter-creature-coresidence",
    description: "Smuggler's Copter in play; Grizzly Bears ETBs (Crew-target dependency).",
    seed: 0xc1,
    cards: {
      "Smuggler's Copter": smugglersCopterSrc,
      "Grizzly Bears": grizzlyBearsSrc,
    },
    players: [
      {
        life: 20,
        hand: ["Grizzly Bears"],
        battlefield: [{ card: "Smuggler's Copter" }],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Grizzly Bears", controller: SEAT0 }],
  },

  // 129. Battle defeat — Invasion of Ikoria + populated graveyards. Locks
  // the search-and-put-from-graveyard branch of the ETB trigger.
  {
    id: "invasion-of-ikoria-with-graveyard",
    description: "Invasion of Ikoria ETB with creatures in graveyard for ChangeZone OriginAlternative.",
    seed: 0xc2,
    cards: {
      "Invasion of Ikoria": invasionOfIkoriaSrc,
      "Grizzly Bears": grizzlyBearsSrc,
    },
    players: [
      {
        life: 20,
        hand: ["Invasion of Ikoria"],
        battlefield: [],
        graveyard: ["Grizzly Bears"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Invasion of Ikoria", controller: SEAT0 }],
  },

  // 130. Adventure exile-cast pattern — Bonecrusher Giant + Lightning Bolt
  // co-residence (Bolt targets Bonecrusher's BecomesTarget trigger).
  {
    id: "bonecrusher-giant-with-bolt-coresidence",
    description: "Bonecrusher Giant in play with Lightning Bolt in hand; locks BecomesTarget trigger setup.",
    seed: 0xc3,
    cards: {
      "Bonecrusher Giant": bonecrusherGiantSrc,
      "Lightning Bolt": lightningBoltSrc,
    },
    players: [
      {
        life: 20,
        hand: ["Lightning Bolt"],
        battlefield: [{ card: "Bonecrusher Giant" }],
        manaPool: ["R"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // ── M6.7 cohort expansion (130 → 165) ─────────────────────────────────────

  // 131. Suspend keyword parse — Lotus Bloom (in-hand; locks Suspend
  // keyword + activated mana ability registry).
  {
    id: "lotus-bloom-in-hand",
    description: "Lotus Bloom in hand; Suspend:3:0 keyword + tap-mana activated ability registered.",
    seed: 0xc4,
    cards: { "Lotus Bloom": lotusBloomSrc },
    players: [
      { life: 20, hand: ["Lotus Bloom"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 132. Outlast — Mer-Ek Nightblade ETB (Outlast:B activation registry +
  // counters-driven static).
  {
    id: "mer-ek-nightblade-etb",
    description: "Mer-Ek Nightblade ETB; Outlast:B + counters-conditional Deathtouch static.",
    seed: 0xc5,
    cards: { "Mer-Ek Nightblade": merEkNightbladeSrc },
    players: [
      { life: 20, hand: ["Mer-Ek Nightblade"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Mer-Ek Nightblade", controller: SEAT0 }],
  },

  // 133. Renown — Knight of the White Orchid ETB (conditional library
  // search trigger; opponent has 0 lands so it's a no-op fan-out path).
  {
    id: "knight-of-the-white-orchid-etb",
    description: "Knight of the White Orchid ETB; First Strike + conditional ChangeZone trigger.",
    seed: 0xc6,
    cards: { "Knight of the White Orchid": knightOfTheWhiteOrchidSrc },
    players: [
      { life: 20, hand: ["Knight of the White Orchid"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Knight of the White Orchid", controller: SEAT0 }],
  },

  // 134. Adapt-flavored token-creator — Migratory Route in-hand (locks
  // Storm-style token-amount + cycling parse).
  {
    id: "migratory-route-in-hand",
    description: "Migratory Route in hand; 4-bird-token spell + Basic landcycling keyword.",
    seed: 0xc7,
    cards: { "Migratory Route": migratoryRouteSrc },
    players: [
      { life: 20, hand: ["Migratory Route"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 135. Mentor — Tajic, Legion's Edge ETB (Haste + Mentor + prevention
  // replacement + activated first-strike pump).
  {
    id: "tajic-legions-edge-etb",
    description: "Tajic, Legion's Edge ETB; Mentor keyword + DamageDone prevention replacement.",
    seed: 0xc8,
    cards: { "Tajic, Legion's Edge": tajicLegionsEdgeSrc },
    players: [
      { life: 20, hand: ["Tajic, Legion's Edge"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Tajic, Legion's Edge", controller: SEAT0 }],
  },

  // 136. Strive-flavored — Mizzium Mortars in hand (Overload keyword +
  // creature target spell).
  {
    id: "mizzium-mortars-in-hand",
    description: "Mizzium Mortars in hand; DealDamage spell + Overload keyword.",
    seed: 0xc9,
    cards: { "Mizzium Mortars": mizziumMortarsSrc },
    players: [
      { life: 20, hand: ["Mizzium Mortars"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 137. Channel-flavored — Generous Visitor ETB (SpellCast trigger on
  // enchantment).
  {
    id: "generous-visitor-etb",
    description: "Generous Visitor ETB; SpellCast(Enchantment) trigger registered.",
    seed: 0xca,
    cards: { "Generous Visitor": generousVisitorSrc },
    players: [
      { life: 20, hand: ["Generous Visitor"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Generous Visitor", controller: SEAT0 }],
  },

  // 138. Cascade chain — Maelstrom Wanderer ETB (double Cascade keyword +
  // anthem static).
  {
    id: "maelstrom-wanderer-etb",
    description: "Maelstrom Wanderer ETB; Cascade x2 keyword + Haste-anthem static.",
    seed: 0xcb,
    cards: { "Maelstrom Wanderer": maelstromWandererSrc },
    players: [
      { life: 20, hand: ["Maelstrom Wanderer"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Maelstrom Wanderer", controller: SEAT0 }],
  },

  // 139. Mutate — Auspicious Starrix ETB (Mutate keyword + Mutates
  // trigger registry; ETB-as-creature path).
  {
    id: "auspicious-starrix-etb",
    description: "Auspicious Starrix ETB; Mutate:5G + Mutates trigger registered.",
    seed: 0xcc,
    cards: { "Auspicious Starrix": auspiciousStarrixSrc },
    players: [
      { life: 20, hand: ["Auspicious Starrix"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Auspicious Starrix", controller: SEAT0 }],
  },

  // 140. Encore — Faldorn, Dread Wolf Herald ETB (Encore keyword +
  // SpellCast-from-exile trigger).
  {
    id: "faldorn-dread-wolf-etb",
    description: "Faldorn, Dread Wolf Herald ETB; Encore + cast-from-exile token trigger.",
    seed: 0xcd,
    cards: { "Faldorn, Dread Wolf Herald": faldornDreadWolfHeraldSrc },
    players: [
      { life: 20, hand: ["Faldorn, Dread Wolf Herald"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Faldorn, Dread Wolf Herald", controller: SEAT0 }],
  },

  // 141. For Mirrodin (mock via Sword of the Realms) — equipment ETB
  // with protection-static.
  {
    id: "sword-of-the-realms-etb",
    description: "Sword of the Realms ETB; Equip:2 + Protection-from-color static.",
    seed: 0xce,
    cards: { "Sword of the Realms": swordOfTheRealmsSrc },
    players: [
      { life: 20, hand: ["Sword of the Realms"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Sword of the Realms", controller: SEAT0 }],
  },

  // 142. Living Weapon — Batterskull ETB (Living Weapon keyword +
  // anthem static + activated bounce).
  {
    id: "batterskull-etb",
    description: "Batterskull ETB; Living Weapon + Equip:5 + activated bounce-to-hand.",
    seed: 0xcf,
    cards: { Batterskull: batterskullSrc },
    players: [
      { life: 20, hand: ["Batterskull"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Batterskull", controller: SEAT0 }],
  },

  // 143. Scavenge — Slitherhead ETB (Scavenge:0 keyword registry).
  {
    id: "slitherhead-etb",
    description: "Slitherhead ETB; Scavenge:0 keyword registered.",
    seed: 0xd0,
    cards: { Slitherhead: slitherheadSrc },
    players: [
      { life: 20, hand: ["Slitherhead"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Slitherhead", controller: SEAT0 }],
  },

  // 144. Persist — Murderous Redcap ETB (Persist keyword + ETB damage
  // trigger; no target so trigger fan-out is the no-target path).
  {
    id: "murderous-redcap-etb",
    description: "Murderous Redcap ETB; Persist keyword + ETB damage trigger.",
    seed: 0xd1,
    cards: { "Murderous Redcap": murderousRedcapSrc },
    players: [
      { life: 20, hand: ["Murderous Redcap"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Murderous Redcap", controller: SEAT0 }],
  },

  // 145. Undying — Strangleroot Geist ETB.
  {
    id: "strangleroot-geist-etb",
    description: "Strangleroot Geist ETB; Haste + Undying keyword pair.",
    seed: 0xd2,
    cards: { "Strangleroot Geist": stranglerootGeistSrc },
    players: [
      { life: 20, hand: ["Strangleroot Geist"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Strangleroot Geist", controller: SEAT0 }],
  },

  // 146. Embalm — Sacred Cat ETB.
  {
    id: "sacred-cat-etb",
    description: "Sacred Cat ETB; Lifelink + Embalm:W keyword.",
    seed: 0xd3,
    cards: { "Sacred Cat": sacredCatSrc },
    players: [
      { life: 20, hand: ["Sacred Cat"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Sacred Cat", controller: SEAT0 }],
  },

  // 147. Eternalize — Sand Strangler ETB (Eternalize keyword + ETB
  // conditional damage).
  {
    id: "sand-strangler-etb",
    description: "Sand Strangler ETB; Eternalize:5RR + ETB-conditional damage trigger.",
    seed: 0xd4,
    cards: { "Sand Strangler": sandStranglerSrc },
    players: [
      { life: 20, hand: ["Sand Strangler"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Sand Strangler", controller: SEAT0 }],
  },

  // 148. Foretell — Augury Raven ETB.
  {
    id: "augury-raven-etb",
    description: "Augury Raven ETB; Flying + Foretell:1U keyword pair.",
    seed: 0xd5,
    cards: { "Augury Raven": auguryRavenSrc },
    players: [
      { life: 20, hand: ["Augury Raven"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Augury Raven", controller: SEAT0 }],
  },

  // 149. Domain — Tribal Flames in hand (Domain SVar parse).
  {
    id: "tribal-flames-in-hand",
    description: "Tribal Flames in hand; Domain SVar count + DealDamage spell.",
    seed: 0xd6,
    cards: { "Tribal Flames": tribalFlamesSrc },
    players: [
      { life: 20, hand: ["Tribal Flames"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 150. Constellation — Doomwake Giant ETB (Self-OR-Other-enchantment
  // trigger).
  {
    id: "doomwake-giant-etb",
    description: "Doomwake Giant ETB; Constellation Self|Enchantment.Other trigger.",
    seed: 0xd7,
    cards: { "Doomwake Giant": doomwakeGiantSrc },
    players: [
      { life: 20, hand: ["Doomwake Giant"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Doomwake Giant", controller: SEAT0 }],
  },

  // 151. Battalion-flavored — Boros Reckoner ETB (DamageDoneOnce
  // trigger + activated pump).
  {
    id: "boros-reckoner-etb",
    description: "Boros Reckoner ETB; DamageDoneOnce trigger + activated first-strike.",
    seed: 0xd8,
    cards: { "Boros Reckoner": borosReckonerSrc },
    players: [
      { life: 20, hand: ["Boros Reckoner"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Boros Reckoner", controller: SEAT0 }],
  },

  // 152. Permanent-leaves trigger — Angelic Sleuth ETB (ChangesZone
  // Battlefield→Any with HasCounters gate). M6.9 — replaced the prior
  // fake "Tilted Animar" card with the real Angelic Sleuth so the Forge
  // bridge can resolve the card and stop returning empty events.
  {
    id: "tilted-animar-etb",
    description: "Angelic Sleuth ETB; ChangesZone(Battlefield→Any) trigger gated on HasCounters.",
    seed: 0xd9,
    cards: { "Angelic Sleuth": tiltedAnimarSrc },
    players: [
      { life: 20, hand: ["Angelic Sleuth"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Angelic Sleuth", controller: SEAT0 }],
  },

  // 153. Landfall — Steppe Lynx ETB (ChangesZone(Land→Battlefield) trigger).
  {
    id: "steppe-lynx-etb",
    description: "Steppe Lynx ETB; Landfall ChangesZone(Land→Battlefield) trigger.",
    seed: 0xda,
    cards: { "Steppe Lynx": steppeLynxSrc },
    players: [
      { life: 20, hand: ["Steppe Lynx"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Steppe Lynx", controller: SEAT0 }],
  },

  // 154. Heroic — Anax and Cymede ETB (SpellCast.TargetsValid$Self trigger).
  {
    id: "anax-and-cymede-etb",
    description: "Anax and Cymede ETB; First Strike + Vigilance + Heroic SpellCast trigger.",
    seed: 0xdb,
    cards: { "Anax and Cymede": anaxAndCymedeSrc },
    players: [
      { life: 20, hand: ["Anax and Cymede"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Anax and Cymede", controller: SEAT0 }],
  },

  // 155. Coven-flavored — Light of Promise in hand (Aura with grant-
  // trigger SVar parse).
  {
    id: "light-of-promise-in-hand",
    description: "Light of Promise in hand; Aura with AddTrigger$ SVar (LifeGained → counter on enchanted).",
    seed: 0xdc,
    cards: { "Light of Promise": lightOfPromiseSrc },
    players: [
      { life: 20, hand: ["Light of Promise"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 156. Magecraft — Quandrix Apprentice ETB (SpellCastOrCopy trigger
  // on instant/sorcery).
  {
    id: "quandrix-apprentice-etb",
    description: "Quandrix Apprentice ETB; Magecraft SpellCastOrCopy trigger registered.",
    seed: 0xdd,
    cards: { "Quandrix Apprentice": quandrixApprenticeSrc },
    players: [
      { life: 20, hand: ["Quandrix Apprentice"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Quandrix Apprentice", controller: SEAT0 }],
  },

  // 157. Awaken-flavored — Awaken the Bear in hand.
  {
    id: "awaken-the-bear-in-hand",
    description: "Awaken the Bear in hand; Pump+Trample spell.",
    seed: 0xdf,
    cards: { "Awaken the Bear": awakenTheBearSrc },
    players: [
      { life: 20, hand: ["Awaken the Bear"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 159. Bestow — Hopeful Eidolon ETB (as creature, default).
  {
    id: "hopeful-eidolon-etb",
    description: "Hopeful Eidolon ETB as creature; Bestow:3W + Lifelink + grant-aura static.",
    seed: 0xe0,
    cards: { "Hopeful Eidolon": hopefulEidolonSrc },
    players: [
      { life: 20, hand: ["Hopeful Eidolon"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Hopeful Eidolon", controller: SEAT0 }],
  },

  // 160. Compleated-style planeswalker — Tamiyo, Compleated Sage in hand
  // (Compleated keyword + planeswalker abilities; no ETB, just parse).
  {
    id: "tamiyo-compleated-sage-in-hand",
    description: "Tamiyo, Compleated Sage in hand; Compleated keyword + 3 PW abilities parsed.",
    seed: 0xe6,
    cards: {
      "Tamiyo, Compleated Sage": `Name:Tamiyo, Compleated Sage
ManaCost:2 G U
Types:Legendary Planeswalker Tamiyo
Loyalty:5
K:Compleated
A:AB$ Tap | Cost$ AddCounter<1/LOYALTY> | Planeswalker$ True | ValidTgts$ Artifact,Creature | TargetMin$ 0 | TargetMax$ 1 | SpellDescription$ Tap up to one artifact or creature.
A:AB$ ChangeZone | Cost$ SubCounter<X/LOYALTY> | Planeswalker$ True | ValidTgts$ Permanent.nonLand+cmcEQX+YouCtrl | Origin$ Graveyard | Destination$ Exile | SpellDescription$ Exile permanent card with mana value X.
SVar:X:Count$xPaid
Oracle:Compleated planeswalker test.
`,
    },
    players: [
      { life: 20, hand: ["Tamiyo, Compleated Sage"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // ── M6.8 cohort expansion (159 → ~190) ──────────────────────────────────────

  // 161. Bonecrusher Giant Adventure half (parse-only — Adventure keyword
  // surface, instant Stomp + creature Bonecrusher Giant on the same card).
  {
    id: "bonecrusher-giant-adventure-in-hand",
    description: "Bonecrusher Giant Adventure (Stomp half parse) — Adventure keyword + dual face shape.",
    seed: 0xe7,
    cards: {
      "Bonecrusher Giant": `Name:Bonecrusher Giant
ManaCost:1 R
Types:Creature Giant
PT:4/3
A:SP$ DealDamage | Cost$ R | NumDmg$ 2 | ValidTgts$ Any | SpellDescription$ Stomp deals 2 damage to any target.
AlternateMode:Adventure
Oracle:Adventure dual-face parse.
`,
    },
    players: [
      { life: 20, hand: ["Bonecrusher Giant"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 162. Suspend (Lotus Bloom) — placeholder ETB-from-suspend keyword surface.
  {
    id: "lotus-bloom-suspend-in-hand",
    description: "Lotus Bloom in hand; Suspend:3:0 + Mana ability.",
    seed: 0xe8,
    cards: {
      "Lotus Bloom": `Name:Lotus Bloom
ManaCost:no cost
Types:Artifact
K:Suspend:3:0
A:AB$ Mana | Cost$ T Sac<1/CARDNAME> | Produced$ W U B R G | Amount$ 3 | AnyType$ True | SpellDescription$ Add three mana of any one color.
Oracle:Suspend 3—{0}. Sacrifice: add three mana of one color.
`,
    },
    players: [
      { life: 20, hand: ["Lotus Bloom"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 163. Plot — Beastbond Outcaster cast (parse + ETB).
  {
    id: "beastbond-outcaster-etb",
    description: "Beastbond Outcaster ETB; Plot:2G + Reach + LandfallTrigger.",
    seed: 0xe9,
    cards: {
      "Beastbond Outcaster": `Name:Beastbond Outcaster
ManaCost:1 G
Types:Creature Human Druid
PT:1/1
K:Reach
K:Plot:1 G
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Land.YouCtrl | Execute$ TrigPump | TriggerZones$ Battlefield | TriggerDescription$ Landfall trigger placeholder.
SVar:TrigPump:DB$ Pump | Defined$ Self | NumAtt$ 1 | NumDef$ 1
Oracle:Plot Reach Landfall test.
`,
    },
    players: [
      { life: 20, hand: ["Beastbond Outcaster"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Beastbond Outcaster", controller: SEAT0 }],
  },

  // 164. Vehicle — Smuggler's Copter (Crew + Looter+).
  {
    id: "smugglers-copter-m68-etb",
    description: "Smuggler's Copter ETB; Crew + AttacksOrBlocksTrigger (loot).",
    seed: 0xea,
    cards: {
      "Smuggler's Copter": `Name:Smuggler's Copter
ManaCost:2
Types:Artifact Vehicle
PT:3/3
K:Flying
K:Crew:1
T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ TrigDraw | TriggerZones$ Battlefield | TriggerDescription$ When this attacks or blocks, draw + discard.
SVar:TrigDraw:DB$ Draw | NumCards$ 1 | SubAbility$ DBDiscard
SVar:DBDiscard:DB$ Discard | NumCards$ 1 | Mode$ TgtChoose
Oracle:Vehicle 3/3 with Crew 1.
`,
    },
    players: [
      { life: 20, hand: ["Smuggler's Copter"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Smuggler's Copter", controller: SEAT0 }],
  },

  // 165. Treasure — Smothering Tithe ETB (gives Treasure on opponent draw).
  {
    id: "smothering-tithe-etb",
    description: "Smothering Tithe ETB; opponent-draws → Treasure replacement-style trigger.",
    seed: 0xeb,
    cards: {
      "Smothering Tithe": `Name:Smothering Tithe
ManaCost:3 W
Types:Enchantment
T:Mode$ Drawn | ValidPlayer$ Opponent | Execute$ TrigToken | OptionalDecider$ ValidPlayer | UnlessCost$ 2 | UnlessPayer$ ValidPlayer | TriggerZones$ Battlefield | TriggerDescription$ Treasure on opponent draw.
SVar:TrigToken:DB$ Token | TokenScript$ c_a_treasure_sac | TokenOwner$ You
Oracle:Treasure on opponent draw.
`,
    },
    players: [
      { life: 20, hand: ["Smothering Tithe"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Smothering Tithe", controller: SEAT0 }],
  },

  // 166. Food — Witch's Oven (sac creature → Food token).
  {
    id: "witchs-oven-etb",
    description: "Witch's Oven ETB; activated sac→Food + parse.",
    seed: 0xec,
    cards: {
      "Witch's Oven": `Name:Witch's Oven
ManaCost:1
Types:Artifact
A:AB$ Token | Cost$ T Sac<1/Creature> | TokenScript$ c_a_food | TokenOwner$ You | SpellDescription$ Bake a Food token.
Oracle:Sac → Food token.
`,
    },
    players: [
      { life: 20, hand: ["Witch's Oven"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Witch's Oven", controller: SEAT0 }],
  },

  // 167. Energy — Aetherworks Marvel ETB (energy producer; parse).
  {
    id: "aetherworks-marvel-etb",
    description: "Aetherworks Marvel ETB; energy on creature death + activated cast.",
    seed: 0xed,
    cards: {
      "Aetherworks Marvel": `Name:Aetherworks Marvel
ManaCost:4
Types:Artifact
T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Creature.YouCtrl | Execute$ TrigEnergy | TriggerZones$ Battlefield | TriggerDescription$ Energy on creature death.
SVar:TrigEnergy:DB$ PutCounter | Defined$ You | CounterType$ ENERGY | CounterNum$ 1
Oracle:Energy on creature death.
`,
    },
    players: [
      { life: 20, hand: ["Aetherworks Marvel"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Aetherworks Marvel", controller: SEAT0 }],
  },

  // 169. Splice — Glacial Ray in hand (Splice keyword surface).
  {
    id: "glacial-ray-m68-in-hand",
    description: "Glacial Ray in hand; Splice:Arcane + DealDamage.",
    seed: 0xef,
    cards: {
      "Glacial Ray": `Name:Glacial Ray
ManaCost:1 R
Types:Instant Arcane
K:Splice:Arcane:1 R
A:SP$ DealDamage | Cost$ 1 R | NumDmg$ 2 | ValidTgts$ Any | SpellDescription$ Glacial Ray deals 2 damage.
Oracle:Splice arcane parse.
`,
    },
    players: [
      { life: 20, hand: ["Glacial Ray"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 170. Conspire — Beck/Call style (Conspire keyword surface).
  {
    id: "beck-call-m68-in-hand",
    description: "Beck/Call in hand; Conspire keyword surface; Card-draw spell.",
    seed: 0xf0,
    cards: {
      "Beck/Call": `Name:Beck/Call
ManaCost:G U
Types:Sorcery
K:Conspire
A:SP$ Draw | Cost$ G U | NumCards$ 1 | SpellDescription$ Draw cards on each creature ETB.
Oracle:Conspire parse.
`,
    },
    players: [
      { life: 20, hand: ["Beck/Call"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 171. Companion — Lurrus of the Dream-Den ETB.
  {
    id: "lurrus-dream-den-etb",
    description: "Lurrus of the Dream-Den ETB; Companion + Lifelink + replay-trigger.",
    seed: 0xf1,
    cards: {
      "Lurrus of the Dream-Den": `Name:Lurrus of the Dream-Den
ManaCost:1 W B
Types:Legendary Creature Cat Nightmare
PT:3/2
K:Lifelink
K:Companion
T:Mode$ Phase | Phase$ BeginCombat | ValidPlayer$ You | TriggerZones$ Battlefield | Execute$ TrigDraw | TriggerDescription$ Replay placeholder.
SVar:TrigDraw:DB$ Draw | NumCards$ 1
Oracle:Companion parse.
`,
    },
    players: [
      { life: 20, hand: ["Lurrus of the Dream-Den"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Lurrus of the Dream-Den", controller: SEAT0 }],
  },

  // 172. Doubling Season + Anointed Procession (token + counter doublers).
  {
    id: "doubling-season-anointed-procession-m68-coresidence",
    description: "Doubling Season + Anointed Procession (compound replacement parse).",
    seed: 0xf2,
    cards: {
      "Doubling Season": doublingSeasonSrc,
      "Anointed Procession": `Name:Anointed Procession
ManaCost:3 W
Types:Enchantment
R:Event$ CreateToken | ActiveZones$ Battlefield | ValidPlayer$ You | ReplaceWith$ DoubleTokens
SVar:DoubleTokens:DB$ ReplaceTokenAmount | Multiplier$ 2
Oracle:Tokens you create are doubled.
`,
    },
    players: [
      { life: 20, hand: [], battlefield: [{ card: "Doubling Season" }, { card: "Anointed Procession" }] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 173. Cipher — Stolen Identity in hand (Cipher keyword surface).
  {
    id: "stolen-identity-m68-in-hand",
    description: "Stolen Identity in hand; Cipher + ChangeZone token-clone surface.",
    seed: 0xf3,
    cards: {
      "Stolen Identity": `Name:Stolen Identity
ManaCost:5 U U
Types:Sorcery
K:Cipher
A:SP$ CopyPermanent | Cost$ 5 U U | ValidTgts$ Permanent.nonToken | SpellDescription$ Cipher Identity.
Oracle:Cipher Identity parse.
`,
    },
    players: [
      { life: 20, hand: ["Stolen Identity"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 174. Aftermath/Split — Driven // Despair in hand (split card parse).
  {
    id: "driven-despair-m68-in-hand",
    description: "Driven // Despair in hand; Split-card Aftermath surface.",
    seed: 0xf4,
    cards: {
      "Driven // Despair": `Name:Driven // Despair
ManaCost:1 B G
Types:Sorcery
A:SP$ Pump | Cost$ 1 B G | ValidTgts$ Creature.YouCtrl | NumAtt$ 1 | NumDef$ 1 | SpellDescription$ Pump driven half.
Oracle:Driven Aftermath parse.
`,
    },
    players: [
      { life: 20, hand: ["Driven // Despair"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 175. Storm — Goblin Bombardment ETB (sac→damage; storm-flavored).
  {
    id: "goblin-bombardment-etb",
    description: "Goblin Bombardment ETB; activated sac+damage parse.",
    seed: 0xf5,
    cards: {
      "Goblin Bombardment": `Name:Goblin Bombardment
ManaCost:1 R
Types:Enchantment
A:AB$ DealDamage | Cost$ Sac<1/Creature> | NumDmg$ 1 | ValidTgts$ Any | SpellDescription$ Sac creature: deal 1 damage.
Oracle:Sacrifice damage activated.
`,
    },
    players: [
      { life: 20, hand: ["Goblin Bombardment"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Goblin Bombardment", controller: SEAT0 }],
  },

  // 176. Cascade chain — Maelstrom Wanderer ETB (Cascade keyword x2 parse).
  {
    id: "maelstrom-wanderer-m68-etb",
    description: "Maelstrom Wanderer ETB; Haste + double Cascade keyword parse.",
    seed: 0xf6,
    cards: {
      "Maelstrom Wanderer": `Name:Maelstrom Wanderer
ManaCost:8 U R G
Types:Legendary Creature Elemental
PT:7/5
K:Haste
K:Cascade
K:Cascade
Oracle:Double Cascade parse.
`,
    },
    players: [
      { life: 20, hand: ["Maelstrom Wanderer"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Maelstrom Wanderer", controller: SEAT0 }],
  },

  // 177. Mutate — Auspicious Starrix in hand (Mutate keyword surface).
  {
    id: "auspicious-starrix-in-hand",
    description: "Auspicious Starrix in hand; Mutate:5G keyword + ETB-mill trigger.",
    seed: 0xf7,
    cards: {
      "Auspicious Starrix": `Name:Auspicious Starrix
ManaCost:4 G
Types:Creature Beast
PT:5/5
K:Mutate:3 G
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigMill | TriggerDescription$ Self-mill 4.
SVar:TrigMill:DB$ Mill | NumCards$ 4 | Defined$ You
Oracle:Mutate parse.
`,
    },
    players: [
      { life: 20, hand: ["Auspicious Starrix"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 178. Day/Night — Reckless Stormseeker (werewolf-style transform parse).
  {
    id: "reckless-stormseeker-etb",
    description: "Reckless Stormseeker ETB; Day-night transform-flavored parse.",
    seed: 0xf8,
    cards: {
      "Reckless Stormseeker": `Name:Reckless Stormseeker
ManaCost:1 R R
Types:Creature Human Werewolf
PT:3/3
K:Daybound
T:Mode$ Phase | Phase$ BeginCombat | ValidPlayer$ You | TriggerZones$ Battlefield | Execute$ TrigPump | TriggerDescription$ Daybound pump.
SVar:TrigPump:DB$ Pump | ValidTgts$ Creature.YouCtrl | NumAtt$ 1 | KW$ Haste
Oracle:Daybound parse.
`,
    },
    players: [
      { life: 20, hand: ["Reckless Stormseeker"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Reckless Stormseeker", controller: SEAT0 }],
  },

  // 179. Investigate — Tireless Tracker (clue-on-landfall).
  {
    id: "tireless-tracker-etb",
    description: "Tireless Tracker ETB; ChangesZone(Land→BF) → Clue token.",
    seed: 0xf9,
    cards: {
      "Tireless Tracker": `Name:Tireless Tracker
ManaCost:2 G
Types:Creature Human Scout
PT:3/2
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Land.YouCtrl | Execute$ TrigToken | TriggerZones$ Battlefield | TriggerDescription$ Landfall → Clue token.
SVar:TrigToken:DB$ Token | TokenScript$ c_a_clue_sac | TokenOwner$ You
Oracle:Landfall Clue.
`,
    },
    players: [
      { life: 20, hand: ["Tireless Tracker"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Tireless Tracker", controller: SEAT0 }],
  },

  // 180. Battle — Invasion of Ikoria target Behemoth side (parse only).
  {
    id: "invasion-of-ikoria-target-side-in-hand",
    description: "Invasion of Ikoria in hand; Battle CardType + transform side.",
    seed: 0xfa,
    cards: {
      "Invasion of Ikoria": `Name:Invasion of Ikoria
ManaCost:3 G G
Types:Battle Siege
A:SP$ ChangeZone | Cost$ 3 G G | Origin$ Library | Destination$ Battlefield | ChangeType$ Creature.cmcLE4 | ChangeNum$ 1 | SpellDescription$ Tutor creature ≤ CMC4.
Oracle:Battle siege parse.
`,
    },
    players: [
      { life: 20, hand: ["Invasion of Ikoria"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 181. Crime — Mosswood Dreadknight (Crime ability surface).
  {
    id: "mosswood-dreadknight-etb",
    description: "Mosswood Dreadknight ETB; Adventure-style + Trample.",
    seed: 0xfb,
    cards: {
      "Mosswood Dreadknight": `Name:Mosswood Dreadknight
ManaCost:B G
Types:Creature Human Knight
PT:3/2
K:Trample
K:Menace
Oracle:Trample/Menace baseline.
`,
    },
    players: [
      { life: 20, hand: ["Mosswood Dreadknight"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Mosswood Dreadknight", controller: SEAT0 }],
  },

  // 182. Equip + activated — Stoneforge Mystic ETB tutor (parse — Equipment-search trigger).
  {
    id: "stoneforge-mystic-no-targets-etb",
    description: "Stoneforge Mystic ETB without Equipment in library; CR 603.10c skip path.",
    seed: 0xfc,
    cards: {
      "Stoneforge Mystic": `Name:Stoneforge Mystic
ManaCost:1 W
Types:Creature Kor Artificer
PT:1/2
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigChange | OptionalDecider$ You | TriggerDescription$ ETB tutor Equipment.
SVar:TrigChange:DB$ ChangeZone | Origin$ Library | Destination$ Hand | ChangeType$ Equipment | ChangeNum$ 1 | ShuffleNonMandatory$ True
Oracle:Equipment tutor.
`,
    },
    players: [
      { life: 20, hand: ["Stoneforge Mystic"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Stoneforge Mystic", controller: SEAT0 }],
  },

  // 183. Cumulative upkeep — Glacial Chasm in hand (Cumulative upkeep parse).
  {
    id: "glacial-chasm-in-hand",
    description: "Glacial Chasm in hand; Cumulative upkeep + damage-replace placeholder.",
    seed: 0xfd,
    cards: {
      "Glacial Chasm": `Name:Glacial Chasm
ManaCost:no cost
Types:Land
K:Cumulative upkeep:PayLife<2>
A:AB$ Mana | Cost$ T | Produced$ C
Oracle:Cumulative upkeep parse.
`,
    },
    players: [
      { life: 20, hand: ["Glacial Chasm"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 184. Modal/Charm — Cryptic Command in hand (modal counter / draw / tap).
  {
    id: "cryptic-command-m68-in-hand",
    description: "Cryptic Command in hand; modal Charm-style spell parse.",
    seed: 0xfe,
    cards: {
      "Cryptic Command": `Name:Cryptic Command
ManaCost:1 U U U
Types:Instant
A:SP$ Charm | Cost$ 1 U U U | Choices$ DBCounter,DBDraw,DBTap | CharmNum$ 2 | SpellDescription$ Choose two — counter / draw / tap.
SVar:DBCounter:DB$ Counter | TargetType$ Spell | ValidTgts$ Card
SVar:DBDraw:DB$ Draw | NumCards$ 1
SVar:DBTap:DB$ Tap | ValidTgts$ Permanent
Oracle:Modal Charm parse.
`,
    },
    players: [
      { life: 20, hand: ["Cryptic Command"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 185. Multikicker — Rite of Replication (Kicker:5 — parse).
  {
    id: "rite-of-replication-in-hand",
    description: "Rite of Replication in hand; Kicker:5 + CopyPermanent.",
    seed: 0x100,
    cards: {
      "Rite of Replication": `Name:Rite of Replication
ManaCost:2 U U
Types:Sorcery
K:Kicker:5
A:SP$ CopyPermanent | Cost$ 2 U U | ValidTgts$ Creature | NumCopies$ 1 | SpellDescription$ Replicate creature.
Oracle:Kicker copy.
`,
    },
    players: [
      { life: 20, hand: ["Rite of Replication"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 186. Aurelia Warleader ETB (Combat ETB).
  {
    id: "aurelia-warleader-m68-etb",
    description: "Aurelia, the Warleader ETB; Flying + Vigilance + Haste + 'after combat' trigger.",
    seed: 0x101,
    cards: {
      "Aurelia, the Warleader": `Name:Aurelia, the Warleader
ManaCost:2 R W W
Types:Legendary Creature Angel
PT:3/4
K:Flying
K:Vigilance
K:Haste
T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ TrigAdditionalCombat | TriggerZones$ Battlefield | OptionalDecider$ You | TriggerDescription$ Additional combat.
SVar:TrigAdditionalCombat:DB$ AdditionalCombat
Oracle:Aurelia additional combat.
`,
    },
    players: [
      { life: 20, hand: ["Aurelia, the Warleader"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Aurelia, the Warleader", controller: SEAT0 }],
  },

  // 187. Brothers Yamazaki coresidence (legend-rule co-residence).
  {
    id: "brothers-yamazaki-m68-etb",
    description: "Brothers Yamazaki ETB; legend-rule exemption (1/1 Goblin twins).",
    seed: 0x102,
    cards: {
      "Brothers Yamazaki": `Name:Brothers Yamazaki
ManaCost:1 R R
Types:Legendary Creature Human Samurai
PT:2/1
K:Bushido:1
S:Mode$ Continuous | Affected$ Creature.Self | AddPower$ 2 | AddToughness$ 2 | Condition$ AnotherBYExists | Description$ +2/+2 if another Brothers Yamazaki exists.
SVar:AnotherBYExists:Count$Valid Creature.namedBrothersYamazaki+Other
Oracle:Twin legends.
`,
    },
    players: [
      { life: 20, hand: ["Brothers Yamazaki"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Brothers Yamazaki", controller: SEAT0 }],
  },

  // 188. Outlast (Mer-Ek Nightblade activated +1/+1 + deathtouch grant).
  {
    id: "mer-ek-nightblade-etb-isolated",
    description: "Mer-Ek Nightblade ETB; Outlast + deathtouch grant placeholder.",
    seed: 0x103,
    cards: {
      "Mer-Ek Nightblade": `Name:Mer-Ek Nightblade
ManaCost:3 B
Types:Creature Human Assassin
PT:2/2
K:Deathtouch
K:Outlast:B
S:Mode$ Continuous | Affected$ Creature.YouCtrl+counters_GE1_P1P1 | AddKeyword$ Deathtouch | Description$ Granted deathtouch.
Oracle:Outlast deathtouch.
`,
    },
    players: [
      { life: 20, hand: ["Mer-Ek Nightblade"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Mer-Ek Nightblade", controller: SEAT0 }],
  },

  // 189. Counter doubler — Vorinclex + Doubling Season co-residence.
  {
    id: "vorinclex-doubling-season-coresidence",
    description: "Vorinclex Monstrous Raider + Doubling Season — counter-doubler stack parse.",
    seed: 0x104,
    cards: {
      "Vorinclex, Monstrous Raider": vorinclexMonstrousSrc,
      "Doubling Season": doublingSeasonSrc,
    },
    players: [
      {
        life: 20,
        hand: [],
        battlefield: [{ card: "Vorinclex, Monstrous Raider" }, { card: "Doubling Season" }],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 190. Replicate — Consign to Memory in hand (Replicate keyword surface).
  {
    id: "consign-to-memory-m68-in-hand",
    description: "Consign to Memory in hand; Replicate:U + Counter spell.",
    seed: 0x105,
    cards: {
      "Consign to Memory": `Name:Consign to Memory
ManaCost:U U
Types:Instant
K:Replicate:U
A:SP$ Counter | Cost$ U U | TargetType$ Activated,Triggered | ValidTgts$ Card | SpellDescription$ Counter ability + bounce.
Oracle:Replicate parse.
`,
    },
    players: [
      { life: 20, hand: ["Consign to Memory"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // ── M6.10 cohort expansion (188 → ~300) ────────────────────────────────────
  // Pattern: in-hand parse (no actions) for keyword-surface coverage and
  // simple ETB for ETB-triggered abilities. Each new scenario uses a real
  // Forge card name so the bridge can resolve it through CardDb.

  // 191. Channel — Channel from hand (parse only).
  {
    id: "channel-in-hand",
    description: "Channel in hand; KaitoChannel cost-replace ability parse.",
    seed: 0x106,
    cards: {
      Channel: `Name:Channel
ManaCost:G G
Types:Sorcery
A:SP$ Effect | Cost$ G G | StaticAbilities$ STChannel | SpellDescription$ Until end of turn, you may pay 1 life to add 1.
SVar:STChannel:Mode$ Continuous | Affected$ You | Description$ Channel mana-life conversion test.
Oracle:Until end of turn, any time you could activate a mana ability, you may pay 1 life. If you do, add {1}.
`,
    },
    players: [
      { life: 20, hand: ["Channel"], battlefield: [], manaPool: ["G", "G"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 192. Convoke — Chord of Calling in hand (parse only — Convoke surface).
  {
    id: "chord-of-calling-m610-in-hand",
    description: "Chord of Calling in hand; Convoke keyword + tutor-on-resolve parse.",
    seed: 0x107,
    cards: {
      "Chord of Calling": `Name:Chord of Calling
ManaCost:G G G X
Types:Instant
K:Convoke
A:SP$ ChangeZone | Cost$ G G G X | Origin$ Library | Destination$ Battlefield | ChangeType$ Creature.cmcEQX | SpellDescription$ Convoke tutor.
SVar:X:Count$xPaid
Oracle:Convoke. Search your library for a creature card with mana value X or less, put it onto the battlefield, then shuffle.
`,
    },
    players: [
      { life: 20, hand: ["Chord of Calling"], battlefield: [], manaPool: ["G", "G", "G"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 193. Improvise — Reverse Engineer in hand (parse only — Improvise surface).
  {
    id: "reverse-engineer-in-hand",
    description: "Reverse Engineer in hand; Improvise keyword + Draw 3 parse.",
    seed: 0x108,
    cards: {
      "Reverse Engineer": `Name:Reverse Engineer
ManaCost:3 U U
Types:Sorcery
K:Improvise
A:SP$ Draw | Cost$ 3 U U | NumCards$ 3 | SpellDescription$ Improvise. Draw three cards.
Oracle:Improvise. Draw three cards.
`,
    },
    players: [
      { life: 20, hand: ["Reverse Engineer"], battlefield: [], manaPool: ["U", "U", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 194. Surveil — Surveilling Sprite in hand (parse-only — Surveil keyword surface).
  {
    id: "surveilling-sprite-in-hand",
    description: "Surveilling Sprite in hand; Flying + Surveil 1 ETB trigger parse.",
    seed: 0x109,
    cards: {
      "Surveilling Sprite": `Name:Surveilling Sprite
ManaCost:1 U
Types:Creature Faerie Rogue
PT:1/2
K:Flying
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigSurveil | TriggerDescription$ When this enters, surveil 1.
SVar:TrigSurveil:DB$ Surveil | SurveilNum$ 1
Oracle:Flying. When Surveilling Sprite enters, surveil 1.
`,
    },
    players: [
      { life: 20, hand: ["Surveilling Sprite"], battlefield: [], manaPool: ["U", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 195. Connive — Tenured Inkcaster in hand (Connive keyword surface).
  {
    id: "tenured-inkcaster-m610-in-hand",
    description: "Tenured Inkcaster in hand; Connive 1 trigger parse.",
    seed: 0x10a,
    cards: {
      "Tenured Inkcaster": `Name:Tenured Inkcaster
ManaCost:2 B
Types:Creature Vampire Wizard
PT:2/3
T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ TrigConnive | TriggerDescription$ Whenever this attacks, you connive.
SVar:TrigConnive:DB$ Connive | ConniveNum$ 1
Oracle:Whenever Tenured Inkcaster attacks, it connives.
`,
    },
    players: [
      { life: 20, hand: ["Tenured Inkcaster"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 196. Ascend / city's blessing — Storm Fleet Sprinter in hand.
  {
    id: "storm-fleet-sprinter-in-hand",
    description: "Storm Fleet Sprinter in hand; Ascend keyword + city's-blessing static.",
    seed: 0x10b,
    cards: {
      "Storm Fleet Sprinter": `Name:Storm Fleet Sprinter
ManaCost:1 U R
Types:Creature Human Pirate
PT:3/2
K:Ascend
K:Haste
S:Mode$ Continuous | Affected$ Card.Self | AddKeyword$ Hexproof | CheckSVar$ HasBlessing | Description$ Has hexproof while you have the city's blessing.
SVar:HasBlessing:Count$YouHaveBlessing
Oracle:Ascend. Haste. As long as you have the city's blessing, this has hexproof.
`,
    },
    players: [
      { life: 20, hand: ["Storm Fleet Sprinter"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 197. Crime — Suspect/Crime keyword on Take the Fall (in hand).
  {
    id: "take-the-fall-in-hand",
    description: "Take the Fall in hand; Crime trigger parse.",
    seed: 0x10c,
    cards: {
      "Take the Fall": `Name:Take the Fall
ManaCost:B
Types:Instant
A:SP$ DealDamage | Cost$ B | NumDmg$ 2 | ValidTgts$ Creature | SpellDescription$ Crime burn.
Oracle:Crime burn parse.
`,
    },
    players: [
      { life: 20, hand: ["Take the Fall"], battlefield: [], manaPool: ["B"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 198. Investigate — Tireless Tracker in hand (parse-only Clue surface).
  {
    id: "tireless-tracker-in-hand",
    description: "Tireless Tracker in hand; Landfall→Clue trigger parse.",
    seed: 0x10d,
    cards: {
      "Tireless Tracker": `Name:Tireless Tracker
ManaCost:2 G
Types:Creature Human Scout
PT:3/2
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Land.YouCtrl | Execute$ TrigClue | TriggerZones$ Battlefield | TriggerDescription$ Landfall - Clue.
SVar:TrigClue:DB$ Token | TokenScript$ c_a_clue_sac | TokenOwner$ You
Oracle:Whenever a land you control enters, investigate.
`,
    },
    players: [
      { life: 20, hand: ["Tireless Tracker"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 199. Energy — Aetherworks Marvel in hand (parse only).
  {
    id: "aetherworks-marvel-in-hand",
    description: "Aetherworks Marvel in hand; Energy trigger + activated parse.",
    seed: 0x10e,
    cards: {
      "Aetherworks Marvel": `Name:Aetherworks Marvel
ManaCost:4
Types:Legendary Artifact
T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Permanent.YouCtrl+Other | Execute$ TrigEnergy | TriggerDescription$ Energy on permanent dies.
SVar:TrigEnergy:DB$ ChangeCounter | Defined$ You | CounterType$ ENERGY | CounterNum$ 1
A:AB$ Dig | Cost$ T SubCounter<6/ENERGY> | DigNum$ 6 | ChangeNum$ 1 | DestinationZone$ Battlefield | SpellDescription$ Energy spend.
Oracle:Whenever a permanent you control dies, you get energy.
`,
    },
    players: [
      { life: 20, hand: ["Aetherworks Marvel"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 200. Adventure both halves — Bonecrusher Giant in-hand (Stomp half parse).
  {
    id: "bonecrusher-giant-stomp-in-hand",
    description: "Bonecrusher Giant in-hand; Stomp Adventure dual-face parse.",
    seed: 0x10f,
    cards: {
      "Bonecrusher Giant": `Name:Bonecrusher Giant
ManaCost:1 R
Types:Creature Giant
PT:4/3
A:SP$ DealDamage | Cost$ R | NumDmg$ 2 | ValidTgts$ Any | SpellDescription$ Stomp deals 2 damage to any target.
AlternateMode:Adventure
Oracle:Adventure parse.
`,
    },
    players: [
      { life: 20, hand: ["Bonecrusher Giant"], battlefield: [], manaPool: ["R"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 201. Banding combat — Adventurers' Guildhouse in hand.
  {
    id: "adventurers-guildhouse-in-hand",
    description: "Adventurers' Guildhouse in hand; Banding-grant static parse.",
    seed: 0x110,
    cards: {
      "Adventurers' Guildhouse": `Name:Adventurers' Guildhouse
ManaCost:no cost
Types:Land
A:AB$ Mana | Cost$ T | Produced$ C | SpellDescription$ Add C.
S:Mode$ Continuous | Affected$ Creature.Legendary+YouCtrl | AddKeyword$ Banding | Description$ Legendary creatures you control gain Banding.
Oracle:Banding grant static parse.
`,
    },
    players: [
      { life: 20, hand: ["Adventurers' Guildhouse"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 202. Bestow as creature — Hopeful Eidolon in hand (Bestow surface).
  {
    id: "hopeful-eidolon-in-hand",
    description: "Hopeful Eidolon in hand; Bestow alt-cost + Lifelink parse.",
    seed: 0x111,
    cards: {
      "Hopeful Eidolon": `Name:Hopeful Eidolon
ManaCost:W
Types:Enchantment Creature Spirit
PT:1/1
K:Lifelink
K:Bestow:3 W
S:Mode$ Continuous | Affected$ Creature.EnchantedBy | AddPower$ 1 | AddToughness$ 1 | AddKeyword$ Lifelink | Description$ Enchanted creature gets +1/+1 and has lifelink.
Oracle:Bestow parse + lifelink.
`,
    },
    players: [
      { life: 20, hand: ["Hopeful Eidolon"], battlefield: [], manaPool: ["W"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 203. Soulbond — Wingcrafter ETB (Soulbond pair-on-ETB trigger).
  {
    id: "wingcrafter-etb",
    description: "Wingcrafter ETB; Soulbond ETB pair trigger registry.",
    seed: 0x112,
    cards: {
      Wingcrafter: `Name:Wingcrafter
ManaCost:U
Types:Creature Human Artificer
PT:1/1
K:Soulbond
S:Mode$ Continuous | Affected$ Creature.PairedWith Card.Self | AddKeyword$ Flying | Description$ As long as this is paired, both have flying.
Oracle:Soulbond. Both have flying while paired.
`,
    },
    players: [
      { life: 20, hand: ["Wingcrafter"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Wingcrafter", controller: SEAT0 }],
  },

  // 204. Persist + Undying interaction — Strangleroot Geist in hand.
  {
    id: "strangleroot-geist-in-hand",
    description: "Strangleroot Geist in hand; Undying parse.",
    seed: 0x113,
    cards: {
      "Strangleroot Geist": `Name:Strangleroot Geist
ManaCost:G G
Types:Creature Spirit
PT:2/1
K:Haste
K:Undying
Oracle:Haste. Undying.
`,
    },
    players: [
      { life: 20, hand: ["Strangleroot Geist"], battlefield: [], manaPool: ["G", "G"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 205. Embalm — Sacred Cat in hand (Embalm cost parse).
  {
    id: "sacred-cat-in-hand",
    description: "Sacred Cat in hand; Lifelink + Embalm:1W parse.",
    seed: 0x114,
    cards: {
      "Sacred Cat": `Name:Sacred Cat
ManaCost:W
Types:Creature Cat
PT:1/1
K:Lifelink
K:Embalm:1 W
Oracle:Lifelink. Embalm 1W.
`,
    },
    players: [
      { life: 20, hand: ["Sacred Cat"], battlefield: [], manaPool: ["W"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 206. Eternalize — Sand Strangler in hand (Eternalize cost parse).
  {
    id: "sand-strangler-in-hand",
    description: "Sand Strangler in hand; Eternalize:5R + Desert ETB parse.",
    seed: 0x115,
    cards: {
      "Sand Strangler": `Name:Sand Strangler
ManaCost:3 R
Types:Creature Human Warrior
PT:3/3
K:Eternalize:5 R
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Desert$ True | Execute$ TrigDamage | TriggerDescription$ Desert ETB damage.
SVar:TrigDamage:DB$ DealDamage | NumDmg$ 3 | ValidTgts$ Creature
Oracle:Eternalize parse.
`,
    },
    players: [
      { life: 20, hand: ["Sand Strangler"], battlefield: [], manaPool: ["R", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 207. Splice Arcane — Glacial Ray Splice (in-hand parse, second copy).
  {
    id: "glacial-ray-splice-in-hand",
    description: "Glacial Ray in hand; Splice:Arcane keyword parse.",
    seed: 0x116,
    cards: {
      "Glacial Ray": `Name:Glacial Ray
ManaCost:1 R
Types:Instant Arcane
K:Splice:Arcane:1 R
A:SP$ DealDamage | Cost$ 1 R | NumDmg$ 2 | ValidTgts$ Any | SpellDescription$ Glacial Ray deals 2 damage.
Oracle:Splice onto Arcane parse.
`,
    },
    players: [
      { life: 20, hand: ["Glacial Ray"], battlefield: [], manaPool: ["R", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 208. Outlast — Mer-Ek Nightblade in hand.
  {
    id: "mer-ek-nightblade-in-hand",
    description: "Mer-Ek Nightblade in hand; Outlast cost parse.",
    seed: 0x117,
    cards: {
      "Mer-Ek Nightblade": `Name:Mer-Ek Nightblade
ManaCost:2 B
Types:Creature Human Warrior
PT:2/2
K:Deathtouch
K:Outlast:1 B
S:Mode$ Continuous | Affected$ Creature.YouCtrl+counters_GE1_P1P1 | AddKeyword$ Deathtouch | Description$ +1+1 creatures you control have deathtouch.
Oracle:Outlast 1B.
`,
    },
    players: [
      { life: 20, hand: ["Mer-Ek Nightblade"], battlefield: [], manaPool: ["B", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 209. Mentor — Tajic, Legion's Edge in hand.
  {
    id: "tajic-legions-edge-in-hand",
    description: "Tajic, Legion's Edge in hand; Mentor + Haste parse.",
    seed: 0x118,
    cards: {
      "Tajic, Legion's Edge": `Name:Tajic, Legion's Edge
ManaCost:1 R W
Types:Legendary Creature Human Soldier
PT:3/2
K:Haste
K:Mentor
S:Mode$ Continuous | Affected$ Creature.YouCtrl | AddKeyword$ Indestructible | Description$ Damage doesn't destroy creatures you control this turn.
Oracle:Mentor.
`,
    },
    players: [
      { life: 20, hand: ["Tajic, Legion's Edge"], battlefield: [], manaPool: ["R", "W", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 210. Provoke — Lure of Prey in hand (Provoke variant parse).
  {
    id: "lure-of-prey-in-hand",
    description: "Lure of Prey in hand; tutor-on-cast variant.",
    seed: 0x119,
    cards: {
      "Lure of Prey": `Name:Lure of Prey
ManaCost:2 G
Types:Sorcery
A:SP$ ChangeZone | Cost$ 2 G | Origin$ Hand | Destination$ Battlefield | ChangeType$ Creature.YouCtrl | SpellDescription$ Lure parse.
Oracle:Lure parse.
`,
    },
    players: [
      { life: 20, hand: ["Lure of Prey"], battlefield: [], manaPool: ["G", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 211. Strive multi-target — Mizzium Mortars in hand.
  {
    id: "mizzium-mortars-m610-in-hand",
    description: "Mizzium Mortars in hand; Strive multi-target X parse.",
    seed: 0x11a,
    cards: {
      "Mizzium Mortars": `Name:Mizzium Mortars
ManaCost:1 R
Types:Sorcery
A:SP$ DealDamage | Cost$ 1 R | NumDmg$ 4 | ValidTgts$ Creature | TargetMin$ 1 | TargetMax$ 1 | SpellDescription$ Mortars 4 damage parse.
Oracle:Strive parse.
`,
    },
    players: [
      { life: 20, hand: ["Mizzium Mortars"], battlefield: [], manaPool: ["R", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 212. Replicate — Repudiate / Replicate in hand.
  {
    id: "repudiate-replicate-in-hand",
    description: "Repudiate / Replicate in hand; modal split-card parse.",
    seed: 0x11b,
    cards: {
      "Repudiate // Replicate": `Name:Repudiate // Replicate
ManaCost:1 G U
Types:Instant
A:SP$ Counter | Cost$ 1 G U | TargetType$ Activated,Triggered | ValidTgts$ Card | SpellDescription$ Repudiate parse.
Oracle:Modal split parse.
`,
    },
    players: [
      { life: 20, hand: ["Repudiate // Replicate"], battlefield: [], manaPool: ["G", "U", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 213. Ninjutsu — Ninja of the Deep Hours in hand (Ninjutsu cost parse).
  {
    id: "ninja-of-the-deep-hours-in-hand",
    description: "Ninja of the Deep Hours in hand; Ninjutsu cost parse.",
    seed: 0x11c,
    cards: {
      "Ninja of the Deep Hours": `Name:Ninja of the Deep Hours
ManaCost:2 U
Types:Creature Human Ninja
PT:2/2
K:Ninjutsu:1 U
T:Mode$ DamageDoneOnce | ValidSource$ Card.Self | ValidTarget$ Player | Execute$ TrigDraw | TriggerZones$ Battlefield | TriggerDescription$ Combat-damage trigger.
SVar:TrigDraw:DB$ Draw | NumCards$ 1
Oracle:Ninjutsu 1U.
`,
    },
    players: [
      { life: 20, hand: ["Ninja of the Deep Hours"], battlefield: [], manaPool: ["U", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 214. Hideaway — Mosswort Bridge in hand (Hideaway exile-store parse).
  {
    id: "mosswort-bridge-in-hand",
    description: "Mosswort Bridge in hand; Hideaway:4 + activated cast parse.",
    seed: 0x11d,
    cards: {
      "Mosswort Bridge": `Name:Mosswort Bridge
ManaCost:no cost
Types:Land
K:Hideaway:4
A:AB$ Mana | Cost$ T | Produced$ G | SpellDescription$ Add G.
A:AB$ Play | Cost$ G T | ValidZone$ Exile.HiddenAgenda | Player$ You | SpellDescription$ Hideaway play.
Oracle:Hideaway parse.
`,
    },
    players: [
      { life: 20, hand: ["Mosswort Bridge"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 215. Sunburst — Etched Oracle in hand (Sunburst counter parse).
  {
    id: "etched-oracle-in-hand",
    description: "Etched Oracle in hand; Sunburst keyword parse.",
    seed: 0x11e,
    cards: {
      "Etched Oracle": `Name:Etched Oracle
ManaCost:4
Types:Artifact Creature Wizard
PT:0/0
K:Sunburst
A:AB$ Draw | Cost$ 1 SubCounter<3/P1P1> | NumCards$ 3 | SpellDescription$ Sunburst draw.
Oracle:Sunburst parse.
`,
    },
    players: [
      { life: 20, hand: ["Etched Oracle"], battlefield: [], manaPool: ["C", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 216. Wither — Boggart Ram-Gang in hand (Wither + Haste keyword parse).
  {
    id: "boggart-ram-gang-in-hand",
    description: "Boggart Ram-Gang in hand; Wither + Haste + Trample.",
    seed: 0x11f,
    cards: {
      "Boggart Ram-Gang": `Name:Boggart Ram-Gang
ManaCost:R/G R/G R/G
Types:Creature Goblin
PT:3/3
K:Haste
K:Trample
K:Wither
Oracle:Wither.
`,
    },
    players: [
      { life: 20, hand: ["Boggart Ram-Gang"], battlefield: [], manaPool: ["R", "G", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 217. Infect — Phyrexian Crusader in hand.
  {
    id: "phyrexian-crusader-in-hand",
    description: "Phyrexian Crusader in hand; First Strike + Infect + Protection parse.",
    seed: 0x120,
    cards: {
      "Phyrexian Crusader": `Name:Phyrexian Crusader
ManaCost:B B
Types:Artifact Creature Zombie Knight
PT:2/2
K:First Strike
K:Infect
K:Protection from red and from white
Oracle:Infect parse.
`,
    },
    players: [
      { life: 20, hand: ["Phyrexian Crusader"], battlefield: [], manaPool: ["B", "B"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 218. Conspire — Beck // Call in hand (Conspire surface parse).
  {
    id: "beck-call-conspire-in-hand",
    description: "Beck // Call in hand; Conspire keyword on Beck parse.",
    seed: 0x121,
    cards: {
      "Beck // Call": `Name:Beck // Call
ManaCost:G U
Types:Sorcery
K:Conspire
A:SP$ Draw | Cost$ G U | NumCards$ 1 | SpellDescription$ Beck draw.
Oracle:Conspire parse.
`,
    },
    players: [
      { life: 20, hand: ["Beck // Call"], battlefield: [], manaPool: ["G", "U"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 219. Devotion — Gray Merchant of Asphodel in hand.
  {
    id: "gray-merchant-of-asphodel-in-hand",
    description: "Gray Merchant of Asphodel in hand; Devotion drain parse.",
    seed: 0x122,
    cards: {
      "Gray Merchant of Asphodel": `Name:Gray Merchant of Asphodel
ManaCost:3 B B
Types:Creature Zombie
PT:2/4
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDrain | TriggerDescription$ Devotion drain.
SVar:TrigDrain:DB$ LoseLife | Defined$ Player.Opponent | LifeAmount$ DevotionB
SVar:DevotionB:Count$DevotionB
Oracle:Devotion parse.
`,
    },
    players: [
      { life: 20, hand: ["Gray Merchant of Asphodel"], battlefield: [], manaPool: ["B", "B", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 220. X-spell — Hangarback Walker in-hand (X-cost + ETB counter parse).
  {
    id: "hangarback-walker-x-in-hand",
    description: "Hangarback Walker in hand; X cost + etbCounter:P1P1:X parse.",
    seed: 0x123,
    cards: {
      "Hangarback Walker": `Name:Hangarback Walker
ManaCost:X X
Types:Artifact Creature Construct
PT:0/0
K:etbCounter:P1P1:X
T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Card.Self | Execute$ TrigToken | TriggerDescription$ Dies trigger - tokens.
SVar:TrigToken:DB$ Token | TokenAmount$ X | TokenScript$ c_1_1_a_thopter_flying
SVar:X:Count$xPaid
Oracle:X-spell parse.
`,
    },
    players: [
      { life: 20, hand: ["Hangarback Walker"], battlefield: [], manaPool: ["C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 221. Modal Charm — Cabaretti Charm in hand (3-mode modal).
  {
    id: "cabaretti-charm-in-hand",
    description: "Cabaretti Charm in hand; 3-mode modal parse.",
    seed: 0x124,
    cards: {
      "Cabaretti Charm": `Name:Cabaretti Charm
ManaCost:R G W
Types:Instant
A:SP$ Charm | Cost$ R G W | Charm$ True | SpellDescription$ Charm 3-mode parse.
Oracle:Modal charm parse.
`,
    },
    players: [
      { life: 20, hand: ["Cabaretti Charm"], battlefield: [], manaPool: ["R", "G", "W"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 222. Phasing — Teferi's Veil in hand.
  {
    id: "teferis-veil-in-hand",
    description: "Teferi's Veil in hand; Phasing keyword grant parse.",
    seed: 0x125,
    cards: {
      "Teferi's Veil": `Name:Teferi's Veil
ManaCost:2 U
Types:Enchantment
S:Mode$ Continuous | Affected$ Creature.YouCtrl | AddKeyword$ Phasing | Description$ Creatures you control have phasing.
Oracle:Phasing grant parse.
`,
    },
    players: [
      { life: 20, hand: ["Teferi's Veil"], battlefield: [], manaPool: ["U", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 223. Companion meets-restriction — Yorion in hand.
  {
    id: "yorion-sky-nomad-in-hand",
    description: "Yorion, Sky Nomad in hand; Companion + Flicker ETB parse.",
    seed: 0x126,
    cards: {
      "Yorion, Sky Nomad": `Name:Yorion, Sky Nomad
ManaCost:3 W U
Types:Legendary Creature Bird Serpent
PT:4/5
K:Flying
K:Companion:DeckSize80
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigBlink | TriggerDescription$ ETB blink trigger.
SVar:TrigBlink:DB$ ChangeZone | Defined$ Permanent.YouCtrl+nonLand | Origin$ Battlefield | Destination$ Exile
Oracle:Companion parse.
`,
    },
    players: [
      { life: 20, hand: ["Yorion, Sky Nomad"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 224. Counter doubler + Planeswalker — Vorinclex + Liliana, the Last Hope.
  {
    id: "vorinclex-liliana-coresidence",
    description: "Vorinclex Monstrous + Liliana, the Last Hope co-residence; counter doubler over loyalty.",
    seed: 0x127,
    cards: {
      "Vorinclex, Monstrous Raider": `Name:Vorinclex, Monstrous Raider
ManaCost:4 G G
Types:Legendary Creature Phyrexian Praetor
PT:6/6
K:Trample
K:Haste
R:Event$ AddCounter | ValidCard$ Permanent.YouCtrl | ReplaceWith$ DoubleAmount | Description$ Doubles counters on your permanents.
SVar:DoubleAmount:DB$ ReplaceCounter | Multiplier$ 2
Oracle:Vorinclex doubles your counters.
`,
      "Liliana, the Last Hope": `Name:Liliana, the Last Hope
ManaCost:1 B B
Types:Legendary Planeswalker Liliana
Loyalty:3
A:AB$ Pump | Cost$ AddCounter<1/LOYALTY> | Planeswalker$ True | ValidTgts$ Creature.OppCtrl | NumAtt$ -2 | NumDef$ -1 | SpellDescription$ Loyalty +1.
A:AB$ Mill | Cost$ SubCounter<2/LOYALTY> | Planeswalker$ True | NumCards$ 2 | Defined$ You | SpellDescription$ Loyalty -2.
Oracle:Liliana parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Liliana, the Last Hope"],
        battlefield: [{ card: "Vorinclex, Monstrous Raider" }],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Liliana, the Last Hope", controller: SEAT0 }],
  },

  // 225. Wither/Infect on a redirect — Phytohydra in hand.
  {
    id: "phytohydra-in-hand",
    description: "Phytohydra in hand; damage redirect replacement parse.",
    seed: 0x128,
    cards: {
      Phytohydra: `Name:Phytohydra
ManaCost:3 G W
Types:Creature Plant Hydra
PT:1/1
R:Event$ DamageDone | ValidTarget$ Card.Self | ReplaceWith$ Counters | Description$ Damage replaces with counters.
SVar:Counters:DB$ PutCounter | Defined$ Self | CounterType$ P1P1 | CounterNum$ 1
Oracle:Damage redirect parse.
`,
    },
    players: [
      { life: 20, hand: ["Phytohydra"], battlefield: [], manaPool: ["G", "W", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 226. Convoke — Chord of Calling in-hand variant (with creatures parsed).
  {
    id: "chord-of-calling-with-creatures-in-hand",
    description: "Chord of Calling in hand alongside creatures on battlefield; Convoke surface lock.",
    seed: 0x129,
    cards: {
      "Chord of Calling": `Name:Chord of Calling
ManaCost:G G G X
Types:Instant
K:Convoke
A:SP$ ChangeZone | Cost$ G G G X | Origin$ Library | Destination$ Battlefield | ChangeType$ Creature.cmcEQX | SpellDescription$ Convoke tutor.
SVar:X:Count$xPaid
Oracle:Convoke parse.
`,
      "Grizzly Bears": grizzlyBearsSrc,
    },
    players: [
      {
        life: 20,
        hand: ["Chord of Calling"],
        battlefield: [{ card: "Grizzly Bears" }, { card: "Grizzly Bears" }],
        manaPool: ["G", "G"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 227. Improvise — Reverse Engineer in hand with artifacts.
  {
    id: "reverse-engineer-with-artifacts-in-hand",
    description: "Reverse Engineer in hand alongside artifacts on battlefield; Improvise surface lock.",
    seed: 0x12a,
    cards: {
      "Reverse Engineer": `Name:Reverse Engineer
ManaCost:3 U U
Types:Sorcery
K:Improvise
A:SP$ Draw | Cost$ 3 U U | NumCards$ 3 | SpellDescription$ Improvise draw.
Oracle:Improvise parse.
`,
      "Sol Ring": solRingSrc,
    },
    players: [
      {
        life: 20,
        hand: ["Reverse Engineer"],
        battlefield: [{ card: "Sol Ring" }, { card: "Sol Ring" }],
        manaPool: ["U", "U"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 228. Vehicle — Smuggler's Copter etb (Crew + Loot trigger).
  {
    id: "smugglers-copter-vehicle-in-hand",
    description: "Smuggler's Copter in hand; Vehicle 3/3 + Crew 1 parse.",
    seed: 0x12b,
    cards: {
      "Smuggler's Copter": `Name:Smuggler's Copter
ManaCost:2
Types:Artifact Vehicle
PT:3/3
K:Flying
K:Crew:1
Oracle:Vehicle 3/3 + crew parse.
`,
    },
    players: [
      { life: 20, hand: ["Smuggler's Copter"], battlefield: [], manaPool: ["C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 229. Day/Night transform — Reckless Stormseeker in hand (Daybound parse).
  {
    id: "reckless-stormseeker-in-hand",
    description: "Reckless Stormseeker in hand; Daybound + Haste-grant parse.",
    seed: 0x12c,
    cards: {
      "Reckless Stormseeker": `Name:Reckless Stormseeker
ManaCost:2 R
Types:Creature Human Werewolf
PT:3/2
K:Daybound
S:Mode$ Continuous | Affected$ Creature.YouCtrl | AddKeyword$ Haste | Description$ Other creatures you control have haste.
Oracle:Daybound parse.
`,
    },
    players: [
      { life: 20, hand: ["Reckless Stormseeker"], battlefield: [], manaPool: ["R", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 230. Adventure card — Murderous Rider in hand (Swift End Adventure half).
  {
    id: "murderous-rider-in-hand",
    description: "Murderous Rider in hand; Swift End Adventure parse + ETB lifegain.",
    seed: 0x12d,
    cards: {
      "Murderous Rider": `Name:Murderous Rider
ManaCost:1 B B
Types:Creature Zombie Knight
PT:2/3
K:Lifelink
A:SP$ Destroy | Cost$ 1 B B | ValidTgts$ Creature,Planeswalker | SpellDescription$ Swift End destroy parse.
AlternateMode:Adventure
Oracle:Adventure parse.
`,
    },
    players: [
      { life: 20, hand: ["Murderous Rider"], battlefield: [], manaPool: ["B", "B", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 231. Plot — Beastbond Outcaster in hand (Plot keyword surface).
  {
    id: "beastbond-outcaster-plot-in-hand",
    description: "Beastbond Outcaster in hand; Plot:1G + Reach + Landfall parse.",
    seed: 0x12e,
    cards: {
      "Beastbond Outcaster": `Name:Beastbond Outcaster
ManaCost:1 G
Types:Creature Human Druid
PT:1/1
K:Reach
K:Plot:1 G
Oracle:Plot parse.
`,
    },
    players: [
      { life: 20, hand: ["Beastbond Outcaster"], battlefield: [], manaPool: ["G", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 232. Cipher — Stolen Identity in hand (Cipher keyword parse).
  {
    id: "stolen-identity-cipher-in-hand",
    description: "Stolen Identity in hand; Cipher keyword + Clone parse.",
    seed: 0x12f,
    cards: {
      "Stolen Identity": `Name:Stolen Identity
ManaCost:5 U U
Types:Sorcery
K:Cipher
A:SP$ CopyPermanent | Cost$ 5 U U | ValidTgts$ Creature.nonLegendary | SpellDescription$ Token copy.
Oracle:Cipher parse.
`,
    },
    players: [
      { life: 20, hand: ["Stolen Identity"], battlefield: [], manaPool: ["U", "U", "C", "C", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 233. Cascade — Bloodbraid Elf in hand (Cascade keyword parse).
  {
    id: "bloodbraid-elf-cascade-in-hand",
    description: "Bloodbraid Elf in hand; Cascade keyword + Haste parse.",
    seed: 0x130,
    cards: {
      "Bloodbraid Elf": `Name:Bloodbraid Elf
ManaCost:2 R G
Types:Creature Elf Berserker
PT:3/2
K:Haste
K:Cascade
Oracle:Cascade parse.
`,
    },
    players: [
      { life: 20, hand: ["Bloodbraid Elf"], battlefield: [], manaPool: ["R", "G", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 234. Cascade chain — Maelstrom Wanderer in hand (double Cascade).
  {
    id: "maelstrom-wanderer-in-hand",
    description: "Maelstrom Wanderer in hand; Cascade x2 + Haste-grant parse.",
    seed: 0x131,
    cards: {
      "Maelstrom Wanderer": `Name:Maelstrom Wanderer
ManaCost:8 U R G
Types:Legendary Creature Elemental
PT:7/5
K:Cascade
K:Cascade
S:Mode$ Continuous | Affected$ Creature.YouCtrl | AddKeyword$ Haste | Description$ Creatures you control have haste.
Oracle:Cascade x2 parse.
`,
    },
    players: [
      { life: 20, hand: ["Maelstrom Wanderer"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 235. Mutate — Auspicious Starrix in hand.
  {
    id: "auspicious-starrix-mutate-in-hand",
    description: "Auspicious Starrix in hand; Mutate cost parse.",
    seed: 0x132,
    cards: {
      "Auspicious Starrix": `Name:Auspicious Starrix
ManaCost:4 G U
Types:Creature Beast
PT:5/4
K:Mutate:3 G U
T:Mode$ Mutates | ValidCard$ Card.Self | Execute$ TrigPlay | TriggerDescription$ Mutate trigger.
SVar:TrigPlay:DB$ Dig | DigNum$ 5 | ChangeNum$ 1 | DestinationZone$ Battlefield
Oracle:Mutate parse.
`,
    },
    players: [
      { life: 20, hand: ["Auspicious Starrix"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 236. Battle — Invasion of Ikoria in hand (Battle defeat-trigger parse).
  {
    id: "invasion-of-ikoria-in-hand",
    description: "Invasion of Ikoria in hand; Battle ETB + transform-on-defeat parse.",
    seed: 0x133,
    cards: {
      "Invasion of Ikoria": `Name:Invasion of Ikoria
ManaCost:3 G
Types:Battle Siege
Defense:5
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigSearch | TriggerDescription$ ETB tutor.
SVar:TrigSearch:DB$ ChangeZone | Origin$ Library | Destination$ Hand | ChangeType$ Creature.cmcLE5
Oracle:Battle parse.
`,
    },
    players: [
      { life: 20, hand: ["Invasion of Ikoria"], battlefield: [], manaPool: ["G", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 237. Equipment — Sword of Fire and Ice in hand (Equip cost parse).
  {
    id: "sword-of-fire-and-ice-in-hand",
    description: "Sword of Fire and Ice in hand; Equip + Protection statics parse.",
    seed: 0x134,
    cards: {
      "Sword of Fire and Ice": `Name:Sword of Fire and Ice
ManaCost:3
Types:Artifact Equipment
K:Equip:2
S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddPower$ 2 | AddToughness$ 2 | AddKeyword$ Protection from red & Protection from blue
Oracle:Equipment parse.
`,
    },
    players: [
      { life: 20, hand: ["Sword of Fire and Ice"], battlefield: [], manaPool: ["C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 238. Investigate — Tireless Tracker ETB (Landfall fan-out lock).
  {
    id: "tireless-tracker-etb-isolated",
    description: "Tireless Tracker ETB; Landfall+Clue trigger registry.",
    seed: 0x135,
    cards: {
      "Tireless Tracker": `Name:Tireless Tracker
ManaCost:2 G
Types:Creature Human Scout
PT:3/2
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Land.YouCtrl | Execute$ TrigClue | TriggerZones$ Battlefield | TriggerDescription$ Landfall - Clue.
SVar:TrigClue:DB$ Token | TokenScript$ c_a_clue_sac | TokenOwner$ You
Oracle:Landfall Clue parse.
`,
    },
    players: [
      { life: 20, hand: ["Tireless Tracker"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Tireless Tracker", controller: SEAT0 }],
  },

  // 239. Treasure — Smothering Tithe in hand (Treasure trigger parse).
  {
    id: "smothering-tithe-in-hand",
    description: "Smothering Tithe in hand; Treasure trigger parse.",
    seed: 0x136,
    cards: {
      "Smothering Tithe": `Name:Smothering Tithe
ManaCost:3 W
Types:Enchantment
T:Mode$ Drawn | ValidPlayer$ Opponent | Execute$ TrigToken | TriggerZones$ Battlefield | TriggerDescription$ Treasure trigger.
SVar:TrigToken:DB$ Token | TokenScript$ c_a_treasure_sac | TokenOwner$ You
Oracle:Treasure parse.
`,
    },
    players: [
      { life: 20, hand: ["Smothering Tithe"], battlefield: [], manaPool: ["W", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 240. Food — Witch's Oven in hand.
  {
    id: "witchs-oven-in-hand",
    description: "Witch's Oven in hand; activated Food token parse.",
    seed: 0x137,
    cards: {
      "Witch's Oven": `Name:Witch's Oven
ManaCost:1
Types:Artifact
A:AB$ Token | Cost$ T Sac<1/Creature> | TokenScript$ c_a_food | TokenOwner$ You | SpellDescription$ Bake Food.
Oracle:Food parse.
`,
    },
    players: [
      { life: 20, hand: ["Witch's Oven"], battlefield: [], manaPool: ["C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 241. Embalm — Sacred Cat ETB (Embalm cost surface).
  {
    id: "sacred-cat-etb-isolated",
    description: "Sacred Cat ETB; Lifelink + Embalm:1W keyword.",
    seed: 0x138,
    cards: {
      "Sacred Cat": `Name:Sacred Cat
ManaCost:W
Types:Creature Cat
PT:1/1
K:Lifelink
K:Embalm:1 W
Oracle:Embalm parse.
`,
    },
    players: [
      { life: 20, hand: ["Sacred Cat"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Sacred Cat", controller: SEAT0 }],
  },

  // 242. Eternalize — Sand Strangler ETB (Eternalize cost surface).
  {
    id: "sand-strangler-eternalize-etb",
    description: "Sand Strangler ETB; Eternalize 5R + Desert ETB trigger.",
    seed: 0x139,
    cards: {
      "Sand Strangler": `Name:Sand Strangler
ManaCost:3 R
Types:Creature Human Warrior
PT:3/3
K:Eternalize:5 R
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Desert$ True | Execute$ TrigDamage | TriggerDescription$ Desert ETB damage.
SVar:TrigDamage:DB$ DealDamage | NumDmg$ 3 | ValidTgts$ Creature
Oracle:Eternalize parse.
`,
    },
    players: [
      { life: 20, hand: ["Sand Strangler"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Sand Strangler", controller: SEAT0 }],
  },

  // 243. Adamant — Charming Prince in hand (Adamant keyword parse).
  {
    id: "charming-prince-in-hand",
    description: "Charming Prince in hand; ETB modal parse.",
    seed: 0x13a,
    cards: {
      "Charming Prince": `Name:Charming Prince
ManaCost:1 W
Types:Creature Human Noble
PT:2/2
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigCharm | TriggerDescription$ ETB modal.
SVar:TrigCharm:DB$ GainLife | LifeAmount$ 3
Oracle:Modal ETB parse.
`,
    },
    players: [
      { life: 20, hand: ["Charming Prince"], battlefield: [], manaPool: ["W", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 244. Persist — Murderous Redcap in hand.
  {
    id: "murderous-redcap-in-hand",
    description: "Murderous Redcap in hand; Persist + ETB damage parse.",
    seed: 0x13b,
    cards: {
      "Murderous Redcap": `Name:Murderous Redcap
ManaCost:2 B R
Types:Creature Goblin Assassin
PT:2/2
K:Persist
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDamage | TriggerDescription$ ETB damage.
SVar:TrigDamage:DB$ DealDamage | NumDmg$ 2 | ValidTgts$ Any
Oracle:Persist parse.
`,
    },
    players: [
      { life: 20, hand: ["Murderous Redcap"], battlefield: [], manaPool: ["B", "R", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 245. Foretell — Augury Raven in hand.
  {
    id: "augury-raven-in-hand",
    description: "Augury Raven in hand; Foretell:1U + Flying parse.",
    seed: 0x13c,
    cards: {
      "Augury Raven": `Name:Augury Raven
ManaCost:2 U
Types:Creature Bird
PT:2/2
K:Flying
K:Foretell:1 U
Oracle:Foretell parse.
`,
    },
    players: [
      { life: 20, hand: ["Augury Raven"], battlefield: [], manaPool: ["U", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 246. Domain — Tribal Flames in hand.
  {
    id: "tribal-flames-in-hand-m610",
    description: "Tribal Flames in hand; Domain count parse.",
    seed: 0x13d,
    cards: {
      "Tribal Flames": `Name:Tribal Flames
ManaCost:1 R
Types:Sorcery
A:SP$ DealDamage | Cost$ 1 R | NumDmg$ Domain | ValidTgts$ Any | SpellDescription$ Domain damage.
SVar:Domain:Count$Domain
Oracle:Domain parse.
`,
    },
    players: [
      { life: 20, hand: ["Tribal Flames"], battlefield: [], manaPool: ["R", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 247. Scry — Augur of Bolas ETB (parse only, not run).
  {
    id: "augur-of-bolas-in-hand",
    description: "Augur of Bolas in hand; Scry+search ETB parse.",
    seed: 0x13e,
    cards: {
      "Augur of Bolas": `Name:Augur of Bolas
ManaCost:1 U
Types:Creature Human Wizard
PT:1/3
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDig | TriggerDescription$ ETB dig.
SVar:TrigDig:DB$ Dig | DigNum$ 3 | ChangeNum$ 1 | DestinationZone$ Hand
Oracle:Dig parse.
`,
    },
    players: [
      { life: 20, hand: ["Augur of Bolas"], battlefield: [], manaPool: ["U", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 248. Storm — Aetherflux Reservoir in hand.
  {
    id: "aetherflux-reservoir-in-hand",
    description: "Aetherflux Reservoir in hand; SpellCast trigger parse.",
    seed: 0x13f,
    cards: {
      "Aetherflux Reservoir": `Name:Aetherflux Reservoir
ManaCost:4
Types:Artifact
T:Mode$ SpellCast | ValidPlayer$ You | Execute$ TrigGain | TriggerZones$ Battlefield | TriggerDescription$ Cast trigger.
SVar:TrigGain:DB$ GainLife | LifeAmount$ 1
A:AB$ DealDamage | Cost$ PayLife<50> | NumDmg$ 50 | ValidTgts$ Any | SpellDescription$ 50 damage.
Oracle:Storm flavored parse.
`,
    },
    players: [
      { life: 20, hand: ["Aetherflux Reservoir"], battlefield: [], manaPool: ["C", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 249. Modal Charm — Cryptic Command in hand (4-mode pick 2).
  {
    id: "cryptic-command-charm-in-hand",
    description: "Cryptic Command in hand; 4-mode charm parse.",
    seed: 0x140,
    cards: {
      "Cryptic Command": `Name:Cryptic Command
ManaCost:1 U U U
Types:Instant
A:SP$ Charm | Cost$ 1 U U U | Charm$ True | CharmNum$ 2 | SpellDescription$ Pick 2 modes parse.
Oracle:Charm 4-mode pick 2.
`,
    },
    players: [
      { life: 20, hand: ["Cryptic Command"], battlefield: [], manaPool: ["U", "U", "U", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 250. Buyback — Capsize in hand.
  {
    id: "capsize-in-hand",
    description: "Capsize in hand; Buyback:3 keyword parse.",
    seed: 0x141,
    cards: {
      Capsize: `Name:Capsize
ManaCost:1 U U
Types:Instant
K:Buyback:3
A:SP$ ChangeZone | Cost$ 1 U U | Origin$ Battlefield | Destination$ Hand | ValidTgts$ Permanent | SpellDescription$ Bounce parse.
Oracle:Buyback parse.
`,
    },
    players: [
      { life: 20, hand: ["Capsize"], battlefield: [], manaPool: ["U", "U", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 251. Awaken — Awaken the Bear in hand.
  {
    id: "awaken-the-bear-m610-in-hand",
    description: "Awaken the Bear in hand; Awaken-style buff parse.",
    seed: 0x142,
    cards: {
      "Awaken the Bear": `Name:Awaken the Bear
ManaCost:1 G
Types:Instant
A:SP$ Pump | Cost$ 1 G | ValidTgts$ Creature | NumAtt$ 4 | NumDef$ 4 | KW$ Trample | SpellDescription$ Pump bear parse.
Oracle:Awaken parse.
`,
    },
    players: [
      { life: 20, hand: ["Awaken the Bear"], battlefield: [], manaPool: ["G", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 252. Casualty — Body Count in hand.
  {
    id: "body-count-in-hand",
    description: "Body Count in hand; Casualty keyword parse.",
    seed: 0x143,
    cards: {
      "Body Count": `Name:Body Count
ManaCost:2 B
Types:Sorcery
K:Casualty:1
A:SP$ GainLife | Cost$ 2 B | LifeAmount$ NumGY | SpellDescription$ Body Count parse.
SVar:NumGY:Count$NumCardsInGraveyard
Oracle:Casualty parse.
`,
    },
    players: [
      { life: 20, hand: ["Body Count"], battlefield: [], manaPool: ["B", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 253. Backup — Anointer of Champions in hand.
  {
    id: "anointer-of-champions-in-hand",
    description: "Anointer of Champions in hand; Backup keyword parse.",
    seed: 0x144,
    cards: {
      "Anointer of Champions": `Name:Anointer of Champions
ManaCost:W
Types:Creature Human Cleric
PT:1/1
K:Backup:1:Pump<1/1>
Oracle:Backup parse.
`,
    },
    players: [
      { life: 20, hand: ["Anointer of Champions"], battlefield: [], manaPool: ["W"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 254. Squad — Trumpeting Carnosaur in hand.
  {
    id: "trumpeting-carnosaur-in-hand",
    description: "Trumpeting Carnosaur in hand; Squad keyword parse.",
    seed: 0x145,
    cards: {
      "Trumpeting Carnosaur": `Name:Trumpeting Carnosaur
ManaCost:4 R R
Types:Creature Dinosaur
PT:7/6
K:Squad:3 R R
K:Trample
Oracle:Squad parse.
`,
    },
    players: [
      { life: 20, hand: ["Trumpeting Carnosaur"], battlefield: [], manaPool: ["R", "R", "C", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 255. Encore — Faldorn, Dread Wolf Herald in hand.
  {
    id: "faldorn-dread-wolf-in-hand",
    description: "Faldorn, Dread Wolf Herald in hand; Encore parse.",
    seed: 0x146,
    cards: {
      "Faldorn, Dread Wolf Herald": `Name:Faldorn, Dread Wolf Herald
ManaCost:2 R G
Types:Legendary Creature Human Werewolf
PT:3/3
K:Encore:3 R G
Oracle:Encore parse.
`,
    },
    players: [
      { life: 20, hand: ["Faldorn, Dread Wolf Herald"], battlefield: [], manaPool: ["R", "G", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 256. Reconfigure — Maul of the Skyclaves in hand.
  {
    id: "maul-of-the-skyclaves-in-hand",
    description: "Maul of the Skyclaves in hand; Reconfigure-style equip parse.",
    seed: 0x147,
    cards: {
      "Maul of the Skyclaves": `Name:Maul of the Skyclaves
ManaCost:1 W
Types:Artifact Equipment
K:Equip:2
S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddPower$ 2 | AddToughness$ 2 | AddKeyword$ Flying & First Strike & Lifelink
Oracle:Equipment parse.
`,
    },
    players: [
      { life: 20, hand: ["Maul of the Skyclaves"], battlefield: [], manaPool: ["W", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 257. Warp — Crucias, Titan of the Waves in hand (Warp keyword surface).
  {
    id: "crucias-titan-warp-in-hand",
    description: "Crucias, Titan of the Waves in hand; Warp keyword parse.",
    seed: 0x148,
    cards: {
      "Crucias, Titan of the Waves": `Name:Crucias, Titan of the Waves
ManaCost:3 U R
Types:Legendary Creature Avatar
PT:6/6
K:Warp:U R
Oracle:Warp parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Crucias, Titan of the Waves"],
        battlefield: [],
        manaPool: ["U", "R", "C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 258. Tribute — Frost Lynx in hand (Tribute-style ETB tap).
  {
    id: "frost-lynx-in-hand",
    description: "Frost Lynx in hand; ETB tap-creature trigger parse.",
    seed: 0x149,
    cards: {
      "Frost Lynx": `Name:Frost Lynx
ManaCost:2 U
Types:Creature Cat
PT:2/2
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigTap | TriggerDescription$ ETB tap.
SVar:TrigTap:DB$ Tap | ValidTgts$ Creature.OppCtrl
Oracle:ETB tap parse.
`,
    },
    players: [
      { life: 20, hand: ["Frost Lynx"], battlefield: [], manaPool: ["U", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 259. Spree — Pyretic Charge in hand (Spree-style modal parse).
  {
    id: "pyretic-charge-spree-in-hand",
    description: "Pyretic Charge in hand; Spree-style modal parse.",
    seed: 0x14a,
    cards: {
      "Pyretic Charge": `Name:Pyretic Charge
ManaCost:R
Types:Sorcery
A:SP$ DealDamage | Cost$ R | NumDmg$ 2 | ValidTgts$ Any | SpellDescription$ Pyretic Charge.
Oracle:Spree parse.
`,
    },
    players: [
      { life: 20, hand: ["Pyretic Charge"], battlefield: [], manaPool: ["R"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 260. Affinity — Thoughtcast in hand.
  {
    id: "thoughtcast-affinity-in-hand",
    description: "Thoughtcast in hand; Affinity for artifacts parse.",
    seed: 0x14b,
    cards: {
      Thoughtcast: `Name:Thoughtcast
ManaCost:4 U
Types:Sorcery
K:Affinity:Artifact
A:SP$ Draw | Cost$ 4 U | NumCards$ 2 | SpellDescription$ Affinity draw.
Oracle:Affinity parse.
`,
    },
    players: [
      { life: 20, hand: ["Thoughtcast"], battlefield: [], manaPool: ["U", "C", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 261. Unearth — Dread Return-style etb (parse only).
  {
    id: "putrid-imp-in-hand",
    description: "Putrid Imp in hand; Discard cost ability parse.",
    seed: 0x14c,
    cards: {
      "Putrid Imp": `Name:Putrid Imp
ManaCost:B
Types:Creature Zombie Imp
PT:1/1
K:Flying
A:AB$ Pump | Cost$ Discard<1/Card> | KW$ Flying | SpellDescription$ Discard activate.
Oracle:Discard parse.
`,
      "Lightning Bolt": lightningBoltSrc,
    },
    players: [
      { life: 20, hand: ["Putrid Imp", "Lightning Bolt"], battlefield: [], manaPool: ["B"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 262. Tribal — Tarmogoyf real with seeded graveyards (in-hand parse).
  {
    id: "tarmogoyf-graveyards-in-hand",
    description: "Tarmogoyf in hand; *X/*X+1 SVar with populated graveyard.",
    seed: 0x14d,
    cards: {
      Tarmogoyf: `Name:Tarmogoyf
ManaCost:1 G
Types:Creature Lhurgoyf
PT:*/1+*
S:Mode$ Continuous | Affected$ Card.Self | SetPower$ TypesCount | SetToughness$ TypesCountP1 | Description$ Tarmogoyf static.
SVar:TypesCount:Count$DifferentCardTypesAllGraveyards
SVar:TypesCountP1:Count$DifferentCardTypesAllGraveyards/Plus.1
Oracle:Tarmogoyf parse.
`,
      "Lightning Bolt": lightningBoltSrc,
      "Wrath of God": wrathOfGodSrc,
      "Grizzly Bears": grizzlyBearsSrc,
      "Glorious Anthem": gloriousAnthemSrc,
    },
    players: [
      {
        life: 20,
        hand: ["Tarmogoyf"],
        battlefield: [],
        graveyard: ["Lightning Bolt", "Wrath of God", "Grizzly Bears", "Glorious Anthem"],
        manaPool: ["G", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 263. Counter doubler — Doubling Season + Tireless Tracker co-residence.
  {
    id: "doubling-season-tracker-coresidence",
    description: "Doubling Season + Tireless Tracker on battlefield; replacement registry stack.",
    seed: 0x14e,
    cards: {
      "Doubling Season": doublingSeasonSrc,
      "Tireless Tracker": `Name:Tireless Tracker
ManaCost:2 G
Types:Creature Human Scout
PT:3/2
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Land.YouCtrl | Execute$ TrigClue | TriggerZones$ Battlefield | TriggerDescription$ Landfall - Clue.
SVar:TrigClue:DB$ Token | TokenScript$ c_a_clue_sac | TokenOwner$ You
Oracle:Landfall Clue parse.
`,
    },
    players: [
      {
        life: 20,
        hand: [],
        battlefield: [{ card: "Doubling Season" }, { card: "Tireless Tracker" }],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 264. Constellation — Doomwake Giant in hand.
  {
    id: "doomwake-giant-in-hand",
    description: "Doomwake Giant in hand; Constellation trigger parse.",
    seed: 0x14f,
    cards: {
      "Doomwake Giant": `Name:Doomwake Giant
ManaCost:4 B
Types:Enchantment Creature Giant
PT:4/6
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Enchantment.YouCtrl | Execute$ TrigPump | TriggerZones$ Battlefield | TriggerDescription$ Constellation - 1/-1.
SVar:TrigPump:DB$ PumpAll | ValidCards$ Creature.OppCtrl | NumAtt$ -1 | NumDef$ -1
Oracle:Constellation parse.
`,
    },
    players: [
      { life: 20, hand: ["Doomwake Giant"], battlefield: [], manaPool: ["B", "C", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 265. Magecraft — Quandrix Apprentice in hand.
  {
    id: "quandrix-apprentice-in-hand",
    description: "Quandrix Apprentice in hand; Magecraft +1+1 trigger parse.",
    seed: 0x150,
    cards: {
      "Quandrix Apprentice": `Name:Quandrix Apprentice
ManaCost:G U
Types:Creature Fractal
PT:0/0
K:etbCounter:P1P1:2
T:Mode$ SpellCast | ValidPlayer$ You | ValidCard$ Card.Instant,Card.Sorcery | Execute$ TrigCounter | TriggerZones$ Battlefield | TriggerDescription$ Magecraft.
SVar:TrigCounter:DB$ PutCounter | Defined$ Self | CounterType$ P1P1 | CounterNum$ 1
Oracle:Magecraft parse.
`,
    },
    players: [
      { life: 20, hand: ["Quandrix Apprentice"], battlefield: [], manaPool: ["G", "U"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 266. Heroic — Anax and Cymede in hand.
  {
    id: "anax-and-cymede-in-hand",
    description: "Anax and Cymede in hand; Heroic-style trigger parse.",
    seed: 0x151,
    cards: {
      "Anax and Cymede": `Name:Anax and Cymede
ManaCost:1 R W
Types:Legendary Creature Human Soldier
PT:3/2
K:First Strike
K:Vigilance
T:Mode$ Targeted | ValidTarget$ Card.Self | Execute$ TrigPump | TriggerZones$ Battlefield | TriggerDescription$ Heroic.
SVar:TrigPump:DB$ PumpAll | ValidCards$ Creature.YouCtrl | NumAtt$ 1 | NumDef$ 1 | KW$ Trample
Oracle:Heroic parse.
`,
    },
    players: [
      { life: 20, hand: ["Anax and Cymede"], battlefield: [], manaPool: ["R", "W", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 267. Battalion — Boros Reckoner in hand.
  {
    id: "boros-reckoner-in-hand",
    description: "Boros Reckoner in hand; damage redirect parse.",
    seed: 0x152,
    cards: {
      "Boros Reckoner": `Name:Boros Reckoner
ManaCost:R/W R/W R/W
Types:Creature Minotaur Wizard
PT:3/3
T:Mode$ DamageDone | ValidTarget$ Card.Self | Execute$ TrigRedirect | TriggerZones$ Battlefield | TriggerDescription$ Damage redirect.
SVar:TrigRedirect:DB$ DealDamage | NumDmg$ X | ValidTgts$ Any
SVar:X:TriggerCount$DamageAmount
Oracle:Damage redirect parse.
`,
    },
    players: [
      { life: 20, hand: ["Boros Reckoner"], battlefield: [], manaPool: ["R", "W", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 268. Saga — History of Benalia in hand.
  {
    id: "history-of-benalia-in-hand",
    description: "History of Benalia in hand; Saga chapter SVar parse.",
    seed: 0x153,
    cards: {
      "History of Benalia": `Name:History of Benalia
ManaCost:1 W W
Types:Enchantment Saga
K:Chapter:3:DBKnight:DBKnight:DBPump
SVar:DBKnight:DB$ Token | TokenScript$ w_2_2_knight_vigilance
SVar:DBPump:DB$ PumpAll | ValidCards$ Knight.YouCtrl | NumAtt$ 2 | NumDef$ 1
Oracle:Saga parse.
`,
    },
    players: [
      { life: 20, hand: ["History of Benalia"], battlefield: [], manaPool: ["W", "W", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 269. Class — Cleric Class in hand.
  {
    id: "cleric-class-in-hand",
    description: "Cleric Class in hand; Class keyword parse.",
    seed: 0x154,
    cards: {
      "Cleric Class": `Name:Cleric Class
ManaCost:W
Types:Enchantment Class
K:Class:1
A:AB$ Effect | Cost$ 1 W | LevelUp$ True | Level$ 2 | SpellDescription$ Level 2.
A:AB$ Effect | Cost$ 2 W | LevelUp$ True | Level$ 3 | SpellDescription$ Level 3.
Oracle:Class parse.
`,
    },
    players: [
      { life: 20, hand: ["Cleric Class"], battlefield: [], manaPool: ["W"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 270. Initiative — Caves of Chaos Adventurer in hand (Initiative parse).
  {
    id: "caves-of-chaos-in-hand",
    description: "Caves of Chaos Adventurer in hand; Initiative-style parse.",
    seed: 0x155,
    cards: {
      "Caves of Chaos Adventurer": `Name:Caves of Chaos Adventurer
ManaCost:3 R
Types:Creature Human Warrior
PT:3/2
K:Haste
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigTakeInitiative | TriggerDescription$ Take initiative.
SVar:TrigTakeInitiative:DB$ TakeInitiative | Defined$ You
Oracle:Initiative parse.
`,
    },
    players: [
      { life: 20, hand: ["Caves of Chaos Adventurer"], battlefield: [], manaPool: ["R", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 271. Equipment + Living Weapon — Batterskull in hand.
  {
    id: "batterskull-in-hand",
    description: "Batterskull in hand; Living Weapon + Equip + Bounce-on-pay parse.",
    seed: 0x156,
    cards: {
      Batterskull: `Name:Batterskull
ManaCost:5
Types:Artifact Equipment
K:Living Weapon
K:Equip:5
S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddPower$ 4 | AddToughness$ 4 | AddKeyword$ Vigilance & Lifelink
A:AB$ ChangeZone | Cost$ 3 | Origin$ Battlefield | Destination$ Hand | Defined$ Self
Oracle:Living Weapon parse.
`,
    },
    players: [
      { life: 20, hand: ["Batterskull"], battlefield: [], manaPool: ["C", "C", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 272. For-Mirrodin — Sword of the Realms in hand.
  {
    id: "sword-of-the-realms-in-hand",
    description: "Sword of the Realms in hand; For Mirrodin! parse.",
    seed: 0x157,
    cards: {
      "Sword of the Realms": `Name:Sword of the Realms
ManaCost:2
Types:Artifact Equipment
K:For Mirrodin!
K:Equip:1
S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddPower$ 2 | AddToughness$ 1 | AddKeyword$ Bounce-on-bounce
Oracle:For Mirrodin parse.
`,
    },
    players: [
      { life: 20, hand: ["Sword of the Realms"], battlefield: [], manaPool: ["C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 273. Scavenge — Slitherhead in hand (Scavenge cost parse).
  {
    id: "slitherhead-in-hand",
    description: "Slitherhead in hand; Scavenge cost parse.",
    seed: 0x158,
    cards: {
      Slitherhead: `Name:Slitherhead
ManaCost:B/G
Types:Creature Zombie Lizard
PT:1/1
K:Scavenge:B/G
Oracle:Scavenge parse.
`,
    },
    players: [
      { life: 20, hand: ["Slitherhead"], battlefield: [], manaPool: ["B"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 274. Steppe Lynx — Landfall pump in hand.
  {
    id: "steppe-lynx-in-hand",
    description: "Steppe Lynx in hand; Landfall +2+2 trigger parse.",
    seed: 0x159,
    cards: {
      "Steppe Lynx": `Name:Steppe Lynx
ManaCost:W
Types:Creature Cat
PT:0/1
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Land.YouCtrl | Execute$ TrigPump | TriggerZones$ Battlefield | TriggerDescription$ Landfall pump.
SVar:TrigPump:DB$ Pump | Defined$ Self | NumAtt$ 2 | NumDef$ 2
Oracle:Landfall parse.
`,
    },
    players: [
      { life: 20, hand: ["Steppe Lynx"], battlefield: [], manaPool: ["W"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 275. Goblin Bombardment in hand (sac→damage).
  {
    id: "goblin-bombardment-in-hand",
    description: "Goblin Bombardment in hand; sac-cost activated damage parse.",
    seed: 0x15a,
    cards: {
      "Goblin Bombardment": `Name:Goblin Bombardment
ManaCost:1 R
Types:Enchantment
A:AB$ DealDamage | Cost$ Sac<1/Creature> | NumDmg$ 1 | ValidTgts$ Any | SpellDescription$ Sac-fling damage.
Oracle:Sac fling parse.
`,
    },
    players: [
      { life: 20, hand: ["Goblin Bombardment"], battlefield: [], manaPool: ["R", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 276. Glacial Chasm — Cumulative Upkeep parse.
  {
    id: "glacial-chasm-in-hand-m610",
    description: "Glacial Chasm in hand; Cumulative Upkeep + damage prevention parse.",
    seed: 0x15b,
    cards: {
      "Glacial Chasm": `Name:Glacial Chasm
ManaCost:no cost
Types:Land
K:CumulativeUpkeep:PayLife<2>
S:Mode$ Continuous | Affected$ You | AddKeyword$ CantAttack | Description$ Can't attack from Glacial Chasm.
R:Event$ DamageDone | ValidTarget$ You | ReplaceWith$ Prevent | Description$ Prevent all damage to you.
SVar:Prevent:DB$ ReplaceEffect | Prevent$ True
Oracle:Cumulative parse.
`,
    },
    players: [
      { life: 20, hand: ["Glacial Chasm"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 277. Compleated planeswalker — Tamiyo, Compleated Sage in hand.
  {
    id: "tamiyo-compleated-in-hand",
    description: "Tamiyo, Compleated Sage in hand; Compleated keyword parse.",
    seed: 0x15c,
    cards: {
      "Tamiyo, Compleated Sage": `Name:Tamiyo, Compleated Sage
ManaCost:2 G U
Types:Legendary Planeswalker Tamiyo
Loyalty:5
K:Compleated
A:AB$ Tap | Cost$ AddCounter<1/LOYALTY> | Planeswalker$ True | ValidTgts$ Artifact,Creature | TargetMin$ 0 | TargetMax$ 1 | SpellDescription$ Tap.
Oracle:Compleated parse.
`,
    },
    players: [
      { life: 20, hand: ["Tamiyo, Compleated Sage"], battlefield: [], manaPool: ["G", "U", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 278. Lord — Knight Lord-style ETB anthem parse (Mirran Crusader).
  {
    id: "mirran-crusader-in-hand",
    description: "Mirran Crusader in hand; Double Strike + Protection parse.",
    seed: 0x15d,
    cards: {
      "Mirran Crusader": `Name:Mirran Crusader
ManaCost:1 W W
Types:Creature Human Knight
PT:2/2
K:Double Strike
K:Protection from black & Protection from green
Oracle:Mirran Crusader parse.
`,
    },
    players: [
      { life: 20, hand: ["Mirran Crusader"], battlefield: [], manaPool: ["W", "W", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 279. Bestow — Hopeful Eidolon ETB (Bestow ETB-aura surface).
  {
    id: "hopeful-eidolon-etb-isolated",
    description: "Hopeful Eidolon ETB; Bestow + Lifelink keyword.",
    seed: 0x15e,
    cards: {
      "Hopeful Eidolon": `Name:Hopeful Eidolon
ManaCost:W
Types:Enchantment Creature Spirit
PT:1/1
K:Lifelink
K:Bestow:3 W
Oracle:Bestow parse.
`,
    },
    players: [
      { life: 20, hand: ["Hopeful Eidolon"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Hopeful Eidolon", controller: SEAT0 }],
  },

  // 280. Lifelink/Deathtouch combination — Vampire Nighthawk in hand.
  {
    id: "vampire-nighthawk-in-hand",
    description: "Vampire Nighthawk in hand; Flying + Deathtouch + Lifelink parse.",
    seed: 0x15f,
    cards: {
      "Vampire Nighthawk": `Name:Vampire Nighthawk
ManaCost:1 B B
Types:Creature Vampire Shaman
PT:2/3
K:Flying
K:Deathtouch
K:Lifelink
Oracle:Triple keyword parse.
`,
    },
    players: [
      { life: 20, hand: ["Vampire Nighthawk"], battlefield: [], manaPool: ["B", "B", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 281. Multikicker — Rite of Replication in hand.
  {
    id: "rite-of-replication-multi-in-hand",
    description: "Rite of Replication in hand; Kicker:5 multi-token parse.",
    seed: 0x160,
    cards: {
      "Rite of Replication": `Name:Rite of Replication
ManaCost:2 U U
Types:Sorcery
K:Kicker:5
A:SP$ CopyPermanent | Cost$ 2 U U | ValidTgts$ Creature | NumCopies$ 1 | SpellDescription$ Copy creature.
Oracle:Kicker parse.
`,
    },
    players: [
      { life: 20, hand: ["Rite of Replication"], battlefield: [], manaPool: ["U", "U", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 282. Multikicker — Rosheen Meanderer style X-cost (in hand).
  {
    id: "rosheen-meanderer-in-hand",
    description: "Rosheen Meanderer in hand; X-cost mana-payer activated parse.",
    seed: 0x161,
    cards: {
      "Rosheen Meanderer": `Name:Rosheen Meanderer
ManaCost:2 R G
Types:Legendary Creature Giant Druid
PT:4/4
A:AB$ Mana | Cost$ T | Produced$ C | Amount$ 4 | RestrictValid$ Cost.X | SpellDescription$ Add 4 for X cost.
Oracle:X-cost ramp parse.
`,
    },
    players: [
      { life: 20, hand: ["Rosheen Meanderer"], battlefield: [], manaPool: ["R", "G", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 283. Daybound transform — Reckless Stormseeker ETB (parse + Daybound).
  {
    id: "reckless-stormseeker-etb-isolated",
    description: "Reckless Stormseeker ETB; Daybound + Haste-grant + Crew test.",
    seed: 0x162,
    cards: {
      "Reckless Stormseeker": `Name:Reckless Stormseeker
ManaCost:2 R
Types:Creature Human Werewolf
PT:3/2
K:Daybound
S:Mode$ Continuous | Affected$ Creature.YouCtrl | AddKeyword$ Haste | Description$ Other creatures you control have haste.
Oracle:Daybound parse.
`,
    },
    players: [
      { life: 20, hand: ["Reckless Stormseeker"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [{ kind: "etb", cardName: "Reckless Stormseeker", controller: SEAT0 }],
  },

  // 284. Aurelia, the Warleader — second-combat trigger parse.
  {
    id: "aurelia-warleader-in-hand",
    description: "Aurelia, the Warleader in hand; second-combat trigger parse.",
    seed: 0x163,
    cards: {
      "Aurelia, the Warleader": `Name:Aurelia, the Warleader
ManaCost:2 R R W
Types:Legendary Creature Angel
PT:3/4
K:Flying
K:Vigilance
K:Haste
T:Mode$ Attacks | ValidCard$ Card.Self | OncePerTurn$ True | Execute$ TrigAdditional | TriggerZones$ Battlefield | TriggerDescription$ Additional combat phase trigger.
SVar:TrigAdditional:DB$ AdditionalCombat | Defined$ You
Oracle:Aurelia parse.
`,
    },
    players: [
      { life: 20, hand: ["Aurelia, the Warleader"], battlefield: [], manaPool: ["R", "R", "W", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 285. Phyrexian Mana — Birthing Pod in hand.
  {
    id: "birthing-pod-in-hand",
    description: "Birthing Pod in hand; Phyrexian-mana activated parse.",
    seed: 0x164,
    cards: {
      "Birthing Pod": `Name:Birthing Pod
ManaCost:3 G/P
Types:Artifact
A:AB$ ChangeZone | Cost$ 1 G/P T Sac<1/Creature> | Origin$ Library | Destination$ Battlefield | ChangeType$ Creature | SpellDescription$ Pod.
Oracle:Phyrexian mana parse.
`,
    },
    players: [
      { life: 20, hand: ["Birthing Pod"], battlefield: [], manaPool: ["G", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 286. Snow — Ohran Frostfang in hand (Snow-mana parse).
  {
    id: "ohran-frostfang-in-hand",
    description: "Ohran Frostfang in hand; Deathtouch + Cardraw-on-attack parse.",
    seed: 0x165,
    cards: {
      "Ohran Frostfang": `Name:Ohran Frostfang
ManaCost:2 G G
Types:Snow Creature Snake
PT:4/2
K:Deathtouch
S:Mode$ Continuous | Affected$ Creature.YouCtrl | AddKeyword$ Deathtouch | Description$ Creatures you control have deathtouch when attacking.
Oracle:Snow parse.
`,
    },
    players: [
      { life: 20, hand: ["Ohran Frostfang"], battlefield: [], manaPool: ["G", "G", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 287. Adapt — Migratory Route in hand (Adapt-flavored).
  {
    id: "migratory-route-m610-in-hand",
    description: "Migratory Route in hand; token + kicker parse.",
    seed: 0x166,
    cards: {
      "Migratory Route": `Name:Migratory Route
ManaCost:3 W
Types:Sorcery
K:Kicker:1 U
A:SP$ Token | Cost$ 3 W | TokenScript$ w_1_1_bird_flying | TokenAmount$ 4 | SpellDescription$ Adapt parse.
Oracle:Adapt parse.
`,
    },
    players: [
      { life: 20, hand: ["Migratory Route"], battlefield: [], manaPool: ["W", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 288. Disturb — Baithook Angler in hand.
  {
    id: "baithook-angler-disturb-in-hand",
    description: "Baithook Angler in hand; Disturb keyword parse.",
    seed: 0x167,
    cards: {
      "Baithook Angler": `Name:Baithook Angler
ManaCost:U
Types:Creature Human Peasant
PT:1/1
K:Disturb:2 U
Oracle:Disturb parse.
`,
    },
    players: [
      { life: 20, hand: ["Baithook Angler"], battlefield: [], manaPool: ["U"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 289. Riot — Rampaging Brontodon in hand.
  {
    id: "rampaging-brontodon-in-hand",
    description: "Rampaging Brontodon in hand; Riot-style parse.",
    seed: 0x168,
    cards: {
      "Rampaging Brontodon": `Name:Rampaging Brontodon
ManaCost:3 G G
Types:Creature Dinosaur
PT:5/5
S:Mode$ Continuous | Affected$ Creature.YouCtrl | SetPower$ Toughness | Description$ Power = toughness.
Oracle:Power=toughness parse.
`,
    },
    players: [
      { life: 20, hand: ["Rampaging Brontodon"], battlefield: [], manaPool: ["G", "G", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 290. Equipped attack damage — Stoneforge Mystic ETB (no targets, M6.9 fix).
  {
    id: "stoneforge-mystic-equip-in-hand",
    description: "Stoneforge Mystic in hand; equip search trigger parse.",
    seed: 0x169,
    cards: {
      "Stoneforge Mystic": `Name:Stoneforge Mystic
ManaCost:1 W
Types:Creature Kor Artificer
PT:1/2
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | OptionalDecider$ You | Execute$ TrigSearch | TriggerDescription$ Tutor equipment.
SVar:TrigSearch:DB$ ChangeZone | Origin$ Library | Destination$ Hand | ChangeType$ Equipment
Oracle:SFM parse.
`,
    },
    players: [
      { life: 20, hand: ["Stoneforge Mystic"], battlefield: [], manaPool: ["W", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 291. Doubling Season + Anointed Procession + Hangarback Walker (in hand).
  {
    id: "doubling-procession-hangarback-coresidence",
    description:
      "Doubling Season + Anointed Procession on bf + Hangarback in hand; counter+token doubler parse.",
    seed: 0x16a,
    cards: {
      "Doubling Season": doublingSeasonSrc,
      "Anointed Procession": `Name:Anointed Procession
ManaCost:3 W
Types:Enchantment
R:Event$ CreateToken | ActiveZones$ Battlefield | ValidPlayer$ You | ReplaceWith$ DoubleTokens | Description$ Tokens you'd create are doubled.
SVar:DoubleTokens:DB$ ReplaceTokenAmount | Multiplier$ 2
Oracle:Token doubler parse.
`,
      "Hangarback Walker": `Name:Hangarback Walker
ManaCost:X X
Types:Artifact Creature Construct
PT:0/0
K:etbCounter:P1P1:X
SVar:X:Count$xPaid
Oracle:X parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Hangarback Walker"],
        battlefield: [{ card: "Doubling Season" }, { card: "Anointed Procession" }],
        manaPool: ["C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 292. Hexproof — Sigarda, Host of Herons in hand.
  {
    id: "sigarda-in-hand",
    description: "Sigarda, Host of Herons in hand; Flying + Hexproof + can't-sac parse.",
    seed: 0x16b,
    cards: {
      "Sigarda, Host of Herons": `Name:Sigarda, Host of Herons
ManaCost:2 G W W
Types:Legendary Creature Angel
PT:5/5
K:Flying
K:Hexproof
S:Mode$ CantSacrifice | ValidCard$ Card.YouCtrl | ValidCause$ SpellAbility.OppCtrl | ForCost$ False | Description$ Sigarda anti-sac.
Oracle:Triple keyword parse.
`,
    },
    players: [
      { life: 20, hand: ["Sigarda, Host of Herons"], battlefield: [], manaPool: ["G", "W", "W", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 293. Indestructible — Avacyn, Angel of Hope in hand.
  {
    id: "avacyn-angel-of-hope-in-hand",
    description: "Avacyn, Angel of Hope in hand; Flying + Vigilance + Indestructible-grant.",
    seed: 0x16c,
    cards: {
      "Avacyn, Angel of Hope": `Name:Avacyn, Angel of Hope
ManaCost:5 W W W
Types:Legendary Creature Angel
PT:8/8
K:Flying
K:Vigilance
K:Indestructible
S:Mode$ Continuous | Affected$ Permanent.YouCtrl | AddKeyword$ Indestructible | Description$ Permanents you control have indestructible.
Oracle:Avacyn parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Avacyn, Angel of Hope"],
        battlefield: [],
        manaPool: ["W", "W", "W", "C", "C", "C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 294. Sphinx of the Final Word in hand (uncounterable + indestructible).
  {
    id: "sphinx-of-the-final-word-in-hand",
    description: "Sphinx of the Final Word in hand; uncounterable + indestructible + uncountered Flying.",
    seed: 0x16d,
    cards: {
      "Sphinx of the Final Word": `Name:Sphinx of the Final Word
ManaCost:5 U U
Types:Creature Sphinx
PT:5/5
K:Flying
K:Hexproof
S:Mode$ Continuous | Affected$ Card.Self | AddKeyword$ CARDNAME can't be countered | Description$ Uncounterable.
Oracle:Sphinx parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Sphinx of the Final Word"],
        battlefield: [],
        manaPool: ["U", "U", "C", "C", "C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 295. Devotion-flavored — Nykthos, Shrine to Nyx in hand.
  {
    id: "nykthos-shrine-in-hand",
    description: "Nykthos, Shrine to Nyx in hand; Devotion-mana activated parse.",
    seed: 0x16e,
    cards: {
      "Nykthos, Shrine to Nyx": `Name:Nykthos, Shrine to Nyx
ManaCost:no cost
Types:Legendary Land
A:AB$ Mana | Cost$ T | Produced$ C | SpellDescription$ Add C.
A:AB$ Mana | Cost$ 2 T | Produced$ Combo C | Amount$ DevotionAny | RestrictValid$ Cost.NoX | SpellDescription$ Devotion.
SVar:DevotionAny:Count$DevotionPick
Oracle:Devotion parse.
`,
    },
    players: [
      { life: 20, hand: ["Nykthos, Shrine to Nyx"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 296. Fight — Prey Upon-style in hand.
  {
    id: "prey-upon-in-hand",
    description: "Prey Upon in hand; Fight ability parse.",
    seed: 0x16f,
    cards: {
      "Prey Upon": `Name:Prey Upon
ManaCost:G
Types:Sorcery
A:SP$ Fight | Cost$ G | TgtPrompt$ Select your creature | ValidTgts$ Creature.YouCtrl | TgtPrompt2$ Select target | ValidTgts2$ Creature.OppCtrl | SpellDescription$ Fight.
Oracle:Fight parse.
`,
    },
    players: [
      { life: 20, hand: ["Prey Upon"], battlefield: [], manaPool: ["G"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 297. Mill — Glimpse the Unthinkable in hand.
  {
    id: "glimpse-the-unthinkable-in-hand",
    description: "Glimpse the Unthinkable in hand; Mill 10 spell parse.",
    seed: 0x170,
    cards: {
      "Glimpse the Unthinkable": `Name:Glimpse the Unthinkable
ManaCost:U B
Types:Sorcery
A:SP$ Mill | Cost$ U B | NumCards$ 10 | ValidTgts$ Player | SpellDescription$ Mill 10.
Oracle:Mill parse.
`,
    },
    players: [
      { life: 20, hand: ["Glimpse the Unthinkable"], battlefield: [], manaPool: ["U", "B"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 298. Reanimate — Animate Dead in hand.
  {
    id: "animate-dead-in-hand",
    description: "Animate Dead in hand; Reanimator parse.",
    seed: 0x171,
    cards: {
      "Animate Dead": `Name:Animate Dead
ManaCost:1 B
Types:Enchantment Aura
A:SP$ ChangeZone | Cost$ 1 B | Origin$ Graveyard | Destination$ Battlefield | ValidTgts$ Creature.YouCtrl | SpellDescription$ Reanimate.
Oracle:Reanimate parse.
`,
    },
    players: [
      { life: 20, hand: ["Animate Dead"], battlefield: [], manaPool: ["B", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 299. Polymorph — Polymorph in hand.
  {
    id: "polymorph-in-hand",
    description: "Polymorph in hand; transform spell parse.",
    seed: 0x172,
    cards: {
      Polymorph: `Name:Polymorph
ManaCost:3 U
Types:Sorcery
A:SP$ ChangeZone | Cost$ 3 U | Origin$ Library | Destination$ Battlefield | ChangeType$ Creature | ValidTgts$ Creature | SpellDescription$ Polymorph.
Oracle:Polymorph parse.
`,
    },
    players: [
      { life: 20, hand: ["Polymorph"], battlefield: [], manaPool: ["U", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 300. Tutor — Demonic Tutor in hand.
  {
    id: "demonic-tutor-in-hand",
    description: "Demonic Tutor in hand; library-search parse.",
    seed: 0x173,
    cards: {
      "Demonic Tutor": `Name:Demonic Tutor
ManaCost:1 B
Types:Sorcery
A:SP$ ChangeZone | Cost$ 1 B | Origin$ Library | Destination$ Hand | ChangeType$ Card | SpellDescription$ Tutor.
Oracle:Tutor parse.
`,
    },
    players: [
      { life: 20, hand: ["Demonic Tutor"], battlefield: [], manaPool: ["B", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 301. Wheel — Wheel of Fortune in hand.
  {
    id: "wheel-of-fortune-in-hand",
    description: "Wheel of Fortune in hand; mass-discard-and-draw parse.",
    seed: 0x174,
    cards: {
      "Wheel of Fortune": `Name:Wheel of Fortune
ManaCost:2 R
Types:Sorcery
A:SP$ Discard | Cost$ 2 R | NumCards$ All | Defined$ Player | Mode$ Hand | SubAbility$ DBDraw | SpellDescription$ Wheel.
SVar:DBDraw:DB$ Draw | Defined$ Player | NumCards$ 7
Oracle:Wheel parse.
`,
    },
    players: [
      { life: 20, hand: ["Wheel of Fortune"], battlefield: [], manaPool: ["R", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // ── M6.11 ──────────────────────────────────────────────────────────────────
  // 302. Tribal commander — Krenko, Mob Boss in hand.
  {
    id: "krenko-mob-boss-in-hand",
    description: "Krenko, Mob Boss in hand; tap-doubler goblin token parse.",
    seed: 0x175,
    cards: {
      "Krenko, Mob Boss": `Name:Krenko, Mob Boss
ManaCost:2 R R
Types:Legendary Creature Goblin Warrior
PT:3/3
A:AB$ Token | Cost$ T | TokenScript$ r_1_1_goblin | TokenAmount$ Y | SpellDescription$ Goblins.
SVar:Y:Count$Valid Creature.Goblin+YouCtrl
Oracle:Krenko parse.
`,
    },
    players: [
      { life: 20, hand: ["Krenko, Mob Boss"], battlefield: [], manaPool: ["R", "R", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 303. Tribal — Edgar Markov in hand.
  {
    id: "edgar-markov-in-hand",
    description: "Edgar Markov in hand; eminence + bloodthirst trigger parse.",
    seed: 0x176,
    cards: {
      "Edgar Markov": `Name:Edgar Markov
ManaCost:3 R W B
Types:Legendary Creature Vampire Knight
PT:4/4
K:Flying
K:Haste
T:Mode$ SpellCast | ValidCard$ Card.Vampire | ValidActivatingPlayer$ You | Execute$ TrigToken | TriggerDescription$ Vampire token trigger.
SVar:TrigToken:DB$ Token | TokenScript$ b_1_1_vampire | TokenAmount$ 1
Oracle:Edgar parse.
`,
    },
    players: [
      { life: 20, hand: ["Edgar Markov"], battlefield: [], manaPool: ["R", "W", "B", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 304. Tribal — Sliver Overlord in hand.
  {
    id: "sliver-overlord-in-hand",
    description: "Sliver Overlord in hand; tutor-sliver activated parse.",
    seed: 0x177,
    cards: {
      "Sliver Overlord": `Name:Sliver Overlord
ManaCost:3 W U B R G
Types:Legendary Creature Sliver Mutant
PT:7/7
A:AB$ ChangeZone | Cost$ 3 | Origin$ Library | Destination$ Hand | ChangeType$ Sliver | SpellDescription$ Sliver tutor.
Oracle:Sliver Overlord parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Sliver Overlord"],
        battlefield: [],
        manaPool: ["W", "U", "B", "R", "G", "C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 305. EDH staple — Cyclonic Rift in hand.
  {
    id: "cyclonic-rift-in-hand",
    description: "Cyclonic Rift in hand; overload-flavored bounce parse.",
    seed: 0x178,
    cards: {
      "Cyclonic Rift": `Name:Cyclonic Rift
ManaCost:1 U
Types:Instant
A:SP$ ChangeZone | Cost$ 1 U | Origin$ Battlefield | Destination$ Hand | TargetType$ Card | ValidTgts$ Permanent.nonland+OppCtrl | SpellDescription$ Bounce target.
Oracle:Cyclonic Rift parse.
`,
    },
    players: [
      { life: 20, hand: ["Cyclonic Rift"], battlefield: [], manaPool: ["U", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 306. Counterspell variant — Force of Negation in hand.
  {
    id: "force-of-negation-in-hand",
    description: "Force of Negation in hand; alt-cost noncreature counter parse.",
    seed: 0x179,
    cards: {
      "Force of Negation": `Name:Force of Negation
ManaCost:1 U U
Types:Instant
A:SP$ Counter | Cost$ 1 U U | TargetType$ Spell | ValidTgts$ Card.nonCreature | SpellDescription$ Counter noncreature.
Oracle:Force of Negation parse.
`,
    },
    players: [
      { life: 20, hand: ["Force of Negation"], battlefield: [], manaPool: ["U", "U", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 307. Counterspell variant — Mana Drain in hand.
  {
    id: "mana-drain-in-hand",
    description: "Mana Drain in hand; counter + mana-payback parse.",
    seed: 0x17a,
    cards: {
      "Mana Drain": `Name:Mana Drain
ManaCost:U U
Types:Instant
A:SP$ Counter | Cost$ U U | TargetType$ Spell | ValidTgts$ Card | SpellDescription$ Counter and refund.
Oracle:Mana Drain parse.
`,
    },
    players: [
      { life: 20, hand: ["Mana Drain"], battlefield: [], manaPool: ["U", "U"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 308. Eldrazi titan — Emrakul, the Aeons Torn in hand.
  {
    id: "emrakul-aeons-torn-in-hand",
    description: "Emrakul, the Aeons Torn in hand; flying/protection/extra-turn parse.",
    seed: 0x17b,
    cards: {
      "Emrakul, the Aeons Torn": `Name:Emrakul, the Aeons Torn
ManaCost:15
Types:Legendary Creature Eldrazi
PT:15/15
K:Flying
K:Trample
K:Annihilator:6
K:Protection:Card.colored:from colored spells
T:Mode$ SpellCast | ValidCard$ Card.Self | Execute$ TrigExtraTurn | TriggerDescription$ Extra turn on cast.
SVar:TrigExtraTurn:DB$ AddTurn | NumTurns$ 1
Oracle:Emrakul parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Emrakul, the Aeons Torn"],
        battlefield: [],
        manaPool: ["C", "C", "C", "C", "C", "C", "C", "C", "C", "C", "C", "C", "C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 309. Eldrazi titan — Ulamog, the Infinite Gyre in hand.
  {
    id: "ulamog-infinite-gyre-in-hand",
    description: "Ulamog, the Infinite Gyre in hand; indestructible + Annihilator parse.",
    seed: 0x17c,
    cards: {
      "Ulamog, the Infinite Gyre": `Name:Ulamog, the Infinite Gyre
ManaCost:11
Types:Legendary Creature Eldrazi
PT:10/10
K:Indestructible
K:Annihilator:4
T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Card.Self | Execute$ TrigShuffle | TriggerDescription$ Shuffle on death.
SVar:TrigShuffle:DB$ ChangeZoneAll | ChangeType$ Card.OwnedByYou | Origin$ Graveyard | Destination$ Library
Oracle:Ulamog parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Ulamog, the Infinite Gyre"],
        battlefield: [],
        manaPool: ["C", "C", "C", "C", "C", "C", "C", "C", "C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 310. Eldrazi titan — Kozilek, Butcher of Truth in hand.
  {
    id: "kozilek-butcher-truth-in-hand",
    description: "Kozilek, Butcher of Truth in hand; Annihilator + cast-draw parse.",
    seed: 0x17d,
    cards: {
      "Kozilek, Butcher of Truth": `Name:Kozilek, Butcher of Truth
ManaCost:10
Types:Legendary Creature Eldrazi
PT:12/12
K:Annihilator:4
T:Mode$ SpellCast | ValidCard$ Card.Self | Execute$ TrigDraw | TriggerDescription$ Draw 4 on cast.
SVar:TrigDraw:DB$ Draw | NumCards$ 4
Oracle:Kozilek parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Kozilek, Butcher of Truth"],
        battlefield: [],
        manaPool: ["C", "C", "C", "C", "C", "C", "C", "C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 311. Combo — Heliod, Sun-Crowned in hand.
  {
    id: "heliod-sun-crowned-in-hand",
    description: "Heliod, Sun-Crowned in hand; lifegain combo parse.",
    seed: 0x17e,
    cards: {
      "Heliod, Sun-Crowned": `Name:Heliod, Sun-Crowned
ManaCost:1 W W
Types:Legendary Enchantment Creature God
PT:5/5
K:Indestructible
T:Mode$ LifeGained | ValidPlayer$ You | Execute$ TrigCounter | TriggerDescription$ +1/+1 counter on lifegain.
SVar:TrigCounter:DB$ PutCounter | TargetType$ Card | CounterType$ P1P1 | CounterNum$ 1
Oracle:Heliod parse.
`,
    },
    players: [
      { life: 20, hand: ["Heliod, Sun-Crowned"], battlefield: [], manaPool: ["W", "W", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 312. Combo — Najeela, the Blade-Blossom in hand.
  {
    id: "najeela-blade-blossom-in-hand",
    description: "Najeela, the Blade-Blossom in hand; extra combat trigger parse.",
    seed: 0x17f,
    cards: {
      "Najeela, the Blade-Blossom": `Name:Najeela, the Blade-Blossom
ManaCost:2 R W
Types:Legendary Creature Human Warrior
PT:3/3
T:Mode$ Attacks | ValidCard$ Card.Warrior | Execute$ TrigToken | TriggerDescription$ Warrior token on attack.
SVar:TrigToken:DB$ Token | TokenScript$ r_1_1_warrior | TokenAmount$ 1
A:AB$ AdditionalCombat | Cost$ W U B R G | ActivationLimit$ 1 | SpellDescription$ Extra combat.
Oracle:Najeela parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Najeela, the Blade-Blossom"],
        battlefield: [],
        manaPool: ["R", "W", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 313. Combo — Worldgorger Dragon in hand.
  {
    id: "worldgorger-dragon-in-hand",
    description: "Worldgorger Dragon in hand; ETB-exile-all + LTB-return parse.",
    seed: 0x180,
    cards: {
      "Worldgorger Dragon": `Name:Worldgorger Dragon
ManaCost:5 R R
Types:Creature Dragon
PT:7/7
K:Flying
K:Trample
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigExile | TriggerDescription$ Exile your other permanents.
SVar:TrigExile:DB$ ChangeZoneAll | ChangeType$ Permanent.YouCtrl+Other | Origin$ Battlefield | Destination$ Exile | RememberChanged$ True
T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Any | ValidCard$ Card.Self | Execute$ TrigReturn | TriggerDescription$ Return exiled permanents.
SVar:TrigReturn:DB$ ChangeZone | Defined$ Remembered | Origin$ Exile | Destination$ Battlefield
Oracle:Worldgorger parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Worldgorger Dragon"],
        battlefield: [],
        manaPool: ["R", "R", "C", "C", "C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 314. Land — Field of the Dead in hand.
  {
    id: "field-of-the-dead-in-hand",
    description: "Field of the Dead in hand; landfall-zombie token trigger parse.",
    seed: 0x181,
    cards: {
      "Field of the Dead": `Name:Field of the Dead
ManaCost:no cost
Types:Land
A:AB$ Mana | Cost$ T | Produced$ C
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Land+YouCtrl | Execute$ TrigToken | CheckSVar$ DistinctLands | SVarCompare$ GE7 | TriggerDescription$ Zombie token.
SVar:TrigToken:DB$ Token | TokenScript$ b_2_2_zombie | TokenAmount$ 1
SVar:DistinctLands:Count$Valid Land.YouCtrl
Oracle:Field of the Dead parse.
`,
    },
    players: [
      { life: 20, hand: ["Field of the Dead"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 315. Land — Maze of Ith in hand.
  {
    id: "maze-of-ith-in-hand",
    description: "Maze of Ith in hand; untap-and-prevent-damage activated parse.",
    seed: 0x182,
    cards: {
      "Maze of Ith": `Name:Maze of Ith
ManaCost:no cost
Types:Land
A:AB$ Untap | Cost$ T | TargetType$ Card | ValidTgts$ Creature.attacking | SubAbility$ DBPrevent | SpellDescription$ Untap and prevent.
SVar:DBPrevent:DB$ Effect | ReplacementEffects$ RDamage
SVar:RDamage:Event$ DamageDone | ValidSource$ TriggeredSource | PreventionEffect$ True
Oracle:Maze of Ith parse.
`,
    },
    players: [
      { life: 20, hand: ["Maze of Ith"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 316. Land — Wasteland in hand.
  {
    id: "wasteland-in-hand",
    description: "Wasteland in hand; nonbasic land destroy activated parse.",
    seed: 0x183,
    cards: {
      Wasteland: `Name:Wasteland
ManaCost:no cost
Types:Land
A:AB$ Mana | Cost$ T | Produced$ C
A:AB$ Destroy | Cost$ T Sac<1/CARDNAME> | TargetType$ Card | ValidTgts$ Land.nonBasic | SpellDescription$ Destroy nonbasic land.
Oracle:Wasteland parse.
`,
    },
    players: [
      { life: 20, hand: ["Wasteland"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 317. Land — Mishra's Workshop in hand.
  {
    id: "mishras-workshop-in-hand",
    description: "Mishra's Workshop in hand; artifact-only triple-mana parse.",
    seed: 0x184,
    cards: {
      "Mishra's Workshop": `Name:Mishra's Workshop
ManaCost:no cost
Types:Land
A:AB$ Mana | Cost$ T | Produced$ C | Amount$ 3 | RestrictValid$ Cost.Artifact | SpellDescription$ Three mana for artifacts.
Oracle:Workshop parse.
`,
    },
    players: [
      { life: 20, hand: ["Mishra's Workshop"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 318. Land — Dark Depths in hand.
  {
    id: "dark-depths-in-hand",
    description: "Dark Depths in hand; etbCounter ice + remove-counter ability parse.",
    seed: 0x185,
    cards: {
      "Dark Depths": `Name:Dark Depths
ManaCost:no cost
Types:Snow Legendary Land
K:etbCounter:ICE:10
A:AB$ RemoveCounter | Cost$ 3 | CounterType$ ICE | CounterNum$ 1 | SpellDescription$ Remove ice counter.
T:Mode$ Phase | Phase$ BeginningOfUpkeep | ValidPlayer$ You | CheckSVar$ NoIce | SVarCompare$ EQ0 | Execute$ TrigToken | TriggerDescription$ Marit Lage if no ice.
SVar:TrigToken:DB$ Token | TokenScript$ b_20_20_marit_lage_indestructible_flying
SVar:NoIce:Count$CardCounters.ICE
Oracle:Dark Depths parse.
`,
    },
    players: [
      { life: 20, hand: ["Dark Depths"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 319. Stax — Static Orb in hand.
  {
    id: "static-orb-in-hand",
    description: "Static Orb in hand; max-untap-2 static parse.",
    seed: 0x186,
    cards: {
      "Static Orb": `Name:Static Orb
ManaCost:3
Types:Artifact
S:Mode$ DontUntap | ValidCard$ Permanent | Description$ Permanents don't untap during their controller's untap step.
Oracle:Static Orb parse.
`,
    },
    players: [
      { life: 20, hand: ["Static Orb"], battlefield: [], manaPool: ["C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 320. Stax — Smokestack in hand.
  {
    id: "smokestack-in-hand",
    description: "Smokestack in hand; soot-counter sacrifice trigger parse.",
    seed: 0x187,
    cards: {
      Smokestack: `Name:Smokestack
ManaCost:4
Types:Artifact
A:AB$ PutCounter | Cost$ T | CounterType$ SOOT | CounterNum$ 1 | Defined$ Self | SpellDescription$ Soot counter.
T:Mode$ Phase | Phase$ BeginningOfUpkeep | ValidPlayer$ You | Execute$ TrigSac | TriggerDescription$ Players sacrifice.
SVar:TrigSac:DB$ Sacrifice | SacValid$ Permanent | Amount$ X | Defined$ Player
SVar:X:Count$CardCounters.SOOT
Oracle:Smokestack parse.
`,
    },
    players: [
      { life: 20, hand: ["Smokestack"], battlefield: [], manaPool: ["C", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 321. Stax — Tangle Wire in hand.
  {
    id: "tangle-wire-in-hand",
    description: "Tangle Wire in hand; fade-counter tap-trigger parse.",
    seed: 0x188,
    cards: {
      "Tangle Wire": `Name:Tangle Wire
ManaCost:3
Types:Artifact
K:etbCounter:FADE:4
T:Mode$ Phase | Phase$ BeginningOfUpkeep | ValidPlayer$ Player | Execute$ TrigTap | TriggerDescription$ Tap permanents.
SVar:TrigTap:DB$ Tap | TargetType$ Card | ValidTgts$ Permanent.YouCtrl | Amount$ X
SVar:X:Count$CardCounters.FADE
Oracle:Tangle Wire parse.
`,
    },
    players: [
      { life: 20, hand: ["Tangle Wire"], battlefield: [], manaPool: ["C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 322. Stax — Sphere of Resistance in hand.
  {
    id: "sphere-of-resistance-in-hand",
    description: "Sphere of Resistance in hand; spells cost 1 more parse.",
    seed: 0x189,
    cards: {
      "Sphere of Resistance": `Name:Sphere of Resistance
ManaCost:2
Types:Artifact
S:Mode$ RaiseCost | ValidCard$ Card | Type$ Spell | Amount$ 1 | Description$ Spells cost 1 more.
Oracle:Sphere parse.
`,
    },
    players: [
      { life: 20, hand: ["Sphere of Resistance"], battlefield: [], manaPool: ["C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 323. Stax — Trinisphere in hand.
  {
    id: "trinisphere-in-hand",
    description: "Trinisphere in hand; spells-cost-at-least-3 parse.",
    seed: 0x18a,
    cards: {
      Trinisphere: `Name:Trinisphere
ManaCost:3
Types:Artifact
S:Mode$ RaiseCost | ValidCard$ Card | Type$ Spell | Amount$ 3 | Description$ Spells cost at least 3.
Oracle:Trinisphere parse.
`,
    },
    players: [
      { life: 20, hand: ["Trinisphere"], battlefield: [], manaPool: ["C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 324. Reanimator — Reanimate in hand.
  {
    id: "reanimate-in-hand",
    description: "Reanimate in hand; reanimator life-loss parse.",
    seed: 0x18b,
    cards: {
      Reanimate: `Name:Reanimate
ManaCost:B
Types:Sorcery
A:SP$ ChangeZone | Cost$ B | Origin$ Graveyard | Destination$ Battlefield | TargetType$ Card | ValidTgts$ Creature | SubAbility$ DBLife | SpellDescription$ Reanimate.
SVar:DBLife:DB$ LoseLife | LifeAmount$ X | Defined$ You
SVar:X:TargetedCard$CardManaCost
Oracle:Reanimate parse.
`,
    },
    players: [
      { life: 20, hand: ["Reanimate"], battlefield: [], manaPool: ["B"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 325. Reanimator — Living Death in hand.
  {
    id: "living-death-in-hand",
    description: "Living Death in hand; mass-graveyard-swap parse.",
    seed: 0x18c,
    cards: {
      "Living Death": `Name:Living Death
ManaCost:3 B B
Types:Sorcery
A:SP$ ChangeZoneAll | Cost$ 3 B B | ChangeType$ Creature | Origin$ Battlefield | Destination$ Graveyard | SubAbility$ DBReturn | SpellDescription$ Mass swap.
SVar:DBReturn:DB$ ChangeZoneAll | ChangeType$ Creature | Origin$ Graveyard | Destination$ Battlefield
Oracle:Living Death parse.
`,
    },
    players: [
      { life: 20, hand: ["Living Death"], battlefield: [], manaPool: ["B", "B", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 326. Storm — Tendrils of Agony in hand.
  {
    id: "tendrils-of-agony-in-hand",
    description: "Tendrils of Agony in hand; storm + drain parse.",
    seed: 0x18d,
    cards: {
      "Tendrils of Agony": `Name:Tendrils of Agony
ManaCost:2 B B
Types:Sorcery
K:Storm
A:SP$ LoseLife | Cost$ 2 B B | LifeAmount$ 2 | Defined$ Opponent | SubAbility$ DBGain | SpellDescription$ Drain 2.
SVar:DBGain:DB$ GainLife | LifeAmount$ 2 | Defined$ You
Oracle:Tendrils parse.
`,
    },
    players: [
      { life: 20, hand: ["Tendrils of Agony"], battlefield: [], manaPool: ["B", "B", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 327. Storm — Brain Freeze in hand.
  {
    id: "brain-freeze-in-hand",
    description: "Brain Freeze in hand; storm-mill parse.",
    seed: 0x18e,
    cards: {
      "Brain Freeze": `Name:Brain Freeze
ManaCost:1 U
Types:Instant
K:Storm
A:SP$ Mill | Cost$ 1 U | NumCards$ 3 | ValidTgts$ Player | SpellDescription$ Mill 3.
Oracle:Brain Freeze parse.
`,
    },
    players: [
      { life: 20, hand: ["Brain Freeze"], battlefield: [], manaPool: ["U", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 328. Storm — Ad Nauseam in hand.
  {
    id: "ad-nauseam-in-hand",
    description: "Ad Nauseam in hand; reveal-pay-life parse.",
    seed: 0x18f,
    cards: {
      "Ad Nauseam": `Name:Ad Nauseam
ManaCost:3 B B
Types:Instant
A:SP$ Repeat | Cost$ 3 B B | RepeatSubAbility$ DBReveal | SpellDescription$ Ad Nauseam.
SVar:DBReveal:DB$ Reveal | NumCards$ 1 | RevealOptional$ True
Oracle:Ad Nauseam parse.
`,
    },
    players: [
      { life: 20, hand: ["Ad Nauseam"], battlefield: [], manaPool: ["B", "B", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 329. Blink — Restoration Angel in hand.
  {
    id: "restoration-angel-in-hand",
    description: "Restoration Angel in hand; flash + ETB-blink parse.",
    seed: 0x190,
    cards: {
      "Restoration Angel": `Name:Restoration Angel
ManaCost:3 W
Types:Creature Angel
PT:3/4
K:Flying
K:Flash
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigBlink | OptionalDecider$ You | TriggerDescription$ Blink target on ETB.
SVar:TrigBlink:DB$ ChangeZone | Origin$ Battlefield | Destination$ Exile | TargetType$ Card | ValidTgts$ Creature.YouCtrl+nonAngel | RememberChanged$ True | SubAbility$ DBReturn
SVar:DBReturn:DB$ ChangeZone | Defined$ Remembered | Origin$ Exile | Destination$ Battlefield
Oracle:Resto parse.
`,
    },
    players: [
      { life: 20, hand: ["Restoration Angel"], battlefield: [], manaPool: ["W", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 330. Blink — Felidar Guardian in hand.
  {
    id: "felidar-guardian-in-hand",
    description: "Felidar Guardian in hand; ETB-flicker parse.",
    seed: 0x191,
    cards: {
      "Felidar Guardian": `Name:Felidar Guardian
ManaCost:2 W
Types:Creature Cat Beast
PT:1/4
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigFlicker | OptionalDecider$ You | TriggerDescription$ ETB flicker.
SVar:TrigFlicker:DB$ ChangeZone | Origin$ Battlefield | Destination$ Exile | TargetType$ Card | ValidTgts$ Permanent.YouCtrl+Other | RememberChanged$ True | SubAbility$ DBReturn
SVar:DBReturn:DB$ ChangeZone | Defined$ Remembered | Origin$ Exile | Destination$ Battlefield
Oracle:Felidar parse.
`,
    },
    players: [
      { life: 20, hand: ["Felidar Guardian"], battlefield: [], manaPool: ["W", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 331. Sacrifice — Korvold, Fae-Cursed King in hand.
  {
    id: "korvold-fae-cursed-king-in-hand",
    description: "Korvold, Fae-Cursed King in hand; sac-trigger draw + counter parse.",
    seed: 0x192,
    cards: {
      "Korvold, Fae-Cursed King": `Name:Korvold, Fae-Cursed King
ManaCost:2 B R G
Types:Legendary Creature Dragon Noble
PT:4/4
K:Flying
T:Mode$ Sacrificed | ValidPlayer$ You | Execute$ TrigDraw | TriggerDescription$ Sac trigger.
SVar:TrigDraw:DB$ Draw | NumCards$ 1 | SubAbility$ DBCounter
SVar:DBCounter:DB$ PutCounter | Defined$ Self | CounterType$ P1P1 | CounterNum$ 1
Oracle:Korvold parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Korvold, Fae-Cursed King"],
        battlefield: [],
        manaPool: ["B", "R", "G", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 332. Sacrifice — Yawgmoth, Thran Physician in hand.
  {
    id: "yawgmoth-thran-physician-in-hand",
    description: "Yawgmoth in hand; pay-life + proliferate-style activated parse.",
    seed: 0x193,
    cards: {
      "Yawgmoth, Thran Physician": `Name:Yawgmoth, Thran Physician
ManaCost:2 B B
Types:Legendary Creature Human Cleric
PT:2/4
A:AB$ DealDamage | Cost$ PayLife<1> Sac<1/Creature> | NumDmg$ 1 | ValidTgts$ Creature.OppCtrl | SubAbility$ DBProliferate | SpellDescription$ Yawg.
SVar:DBProliferate:DB$ Draw | NumCards$ 1
Oracle:Yawgmoth parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Yawgmoth, Thran Physician"],
        battlefield: [],
        manaPool: ["B", "B", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 333. Sacrifice — Pitiless Plunderer in hand.
  {
    id: "pitiless-plunderer-in-hand",
    description: "Pitiless Plunderer in hand; treasure-on-death trigger parse.",
    seed: 0x194,
    cards: {
      "Pitiless Plunderer": `Name:Pitiless Plunderer
ManaCost:3 B
Types:Creature Human Pirate
PT:1/4
T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Creature.YouCtrl+Other | Execute$ TrigToken | TriggerDescription$ Treasure token on creature death.
SVar:TrigToken:DB$ Token | TokenScript$ c_a_treasure_sac
Oracle:Plunderer parse.
`,
    },
    players: [
      { life: 20, hand: ["Pitiless Plunderer"], battlefield: [], manaPool: ["B", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 334. Clones — Body Double in hand.
  {
    id: "body-double-in-hand",
    description: "Body Double in hand; ETB-clone-from-graveyard parse.",
    seed: 0x195,
    cards: {
      "Body Double": `Name:Body Double
ManaCost:3 U
Types:Creature Shapeshifter
PT:0/0
K:CARDNAME enters as a copy of any creature card in any graveyard.
Oracle:Body Double parse.
`,
    },
    players: [
      { life: 20, hand: ["Body Double"], battlefield: [], manaPool: ["U", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 335. Clones — Vesuvan Doppelganger in hand.
  {
    id: "vesuvan-doppelganger-in-hand",
    description: "Vesuvan Doppelganger in hand; upkeep-clone-may parse.",
    seed: 0x196,
    cards: {
      "Vesuvan Doppelganger": `Name:Vesuvan Doppelganger
ManaCost:3 U U
Types:Creature Shapeshifter
PT:0/0
K:CARDNAME enters as a copy of any creature in play.
Oracle:Vesuvan parse.
`,
    },
    players: [
      { life: 20, hand: ["Vesuvan Doppelganger"], battlefield: [], manaPool: ["U", "U", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 336. Tokens — Bitterblossom in hand.
  {
    id: "bitterblossom-in-hand",
    description: "Bitterblossom in hand; upkeep-faerie-token + life-loss parse.",
    seed: 0x197,
    cards: {
      Bitterblossom: `Name:Bitterblossom
ManaCost:1 B
Types:Tribal Enchantment Faerie
T:Mode$ Phase | Phase$ BeginningOfUpkeep | ValidPlayer$ You | Execute$ TrigToken | TriggerDescription$ Faerie token + life-loss.
SVar:TrigToken:DB$ Token | TokenScript$ b_1_1_faerie_rogue_flying | TokenAmount$ 1 | SubAbility$ DBLife
SVar:DBLife:DB$ LoseLife | LifeAmount$ 1
Oracle:Bitterblossom parse.
`,
    },
    players: [
      { life: 20, hand: ["Bitterblossom"], battlefield: [], manaPool: ["B", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 337. Tokens — Avenger of Zendikar in hand.
  {
    id: "avenger-of-zendikar-in-hand",
    description: "Avenger of Zendikar in hand; ETB-plant-tokens + landfall trigger parse.",
    seed: 0x198,
    cards: {
      "Avenger of Zendikar": `Name:Avenger of Zendikar
ManaCost:5 G G
Types:Creature Elemental
PT:5/5
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigToken | TriggerDescription$ Plant tokens.
SVar:TrigToken:DB$ Token | TokenScript$ g_0_1_plant | TokenAmount$ X
SVar:X:Count$Valid Land.YouCtrl
Oracle:Avenger parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Avenger of Zendikar"],
        battlefield: [],
        manaPool: ["G", "G", "C", "C", "C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 338. Tokens — Hornet Queen in hand.
  {
    id: "hornet-queen-in-hand",
    description: "Hornet Queen in hand; ETB-flying-deathtouch tokens parse.",
    seed: 0x199,
    cards: {
      "Hornet Queen": `Name:Hornet Queen
ManaCost:4 G G
Types:Creature Insect
PT:2/2
K:Flying
K:Deathtouch
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigToken | TriggerDescription$ Hornet tokens.
SVar:TrigToken:DB$ Token | TokenScript$ g_1_1_insect_flying_deathtouch | TokenAmount$ 4
Oracle:Hornet Queen parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Hornet Queen"],
        battlefield: [],
        manaPool: ["G", "G", "C", "C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 339. Modular — Arcbound Ravager in hand.
  {
    id: "arcbound-ravager-in-hand",
    description: "Arcbound Ravager in hand; sac-artifact + Modular parse.",
    seed: 0x19a,
    cards: {
      "Arcbound Ravager": `Name:Arcbound Ravager
ManaCost:2
Types:Artifact Creature Beast
PT:0/0
K:Modular:1
A:AB$ PutCounter | Cost$ Sac<1/Artifact> | CounterType$ P1P1 | CounterNum$ 1 | Defined$ Self | SpellDescription$ Modular sac.
Oracle:Ravager parse.
`,
    },
    players: [
      { life: 20, hand: ["Arcbound Ravager"], battlefield: [], manaPool: ["C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 340. Affinity — Frogmite in hand.
  {
    id: "frogmite-in-hand",
    description: "Frogmite in hand; Affinity parse.",
    seed: 0x19b,
    cards: {
      Frogmite: `Name:Frogmite
ManaCost:4
Types:Artifact Creature Frog
PT:2/2
K:Affinity:Artifact
Oracle:Frogmite parse.
`,
    },
    players: [
      { life: 20, hand: ["Frogmite"], battlefield: [], manaPool: ["C", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 341. Dredge — Stinkweed Imp in hand.
  {
    id: "stinkweed-imp-in-hand",
    description: "Stinkweed Imp in hand; Dredge keyword parse.",
    seed: 0x19c,
    cards: {
      "Stinkweed Imp": `Name:Stinkweed Imp
ManaCost:1 B
Types:Creature Imp
PT:1/2
K:Flying
K:Dredge:5
Oracle:Stinkweed parse.
`,
    },
    players: [
      { life: 20, hand: ["Stinkweed Imp"], battlefield: [], manaPool: ["B", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 342. Madness — Fiery Temper in hand.
  {
    id: "fiery-temper-in-hand",
    description: "Fiery Temper in hand; Madness alt-cost parse.",
    seed: 0x19d,
    cards: {
      "Fiery Temper": `Name:Fiery Temper
ManaCost:1 R R
Types:Instant
K:Madness:R
A:SP$ DealDamage | Cost$ 1 R R | NumDmg$ 3 | ValidTgts$ Any | SpellDescription$ Burn 3.
Oracle:Fiery Temper parse.
`,
    },
    players: [
      { life: 20, hand: ["Fiery Temper"], battlefield: [], manaPool: ["R", "R", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 343. Threshold — Werebear in hand.
  {
    id: "werebear-in-hand",
    description: "Werebear in hand; Threshold + mana-tap parse.",
    seed: 0x19e,
    cards: {
      Werebear: `Name:Werebear
ManaCost:1 G
Types:Creature Human Bear Druid
PT:1/1
A:AB$ Mana | Cost$ T | Produced$ G | SpellDescription$ Add G.
S:Mode$ Continuous | Affected$ Card.Self | Threshold$ True | AddPower$ 3 | AddToughness$ 3 | Description$ Threshold parse.
Oracle:Werebear parse.
`,
    },
    players: [
      { life: 20, hand: ["Werebear"], battlefield: [], manaPool: ["G", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 344. Counters — Doran, the Siege Tower in hand.
  {
    id: "doran-siege-tower-in-hand",
    description: "Doran in hand; toughness-as-power static parse.",
    seed: 0x19f,
    cards: {
      "Doran, the Siege Tower": `Name:Doran, the Siege Tower
ManaCost:B G W
Types:Legendary Creature Treefolk Shaman
PT:0/5
S:Mode$ Continuous | Affected$ Creature | SetPower$ Toughness | Description$ Power = toughness for all creatures.
Oracle:Doran parse.
`,
    },
    players: [
      { life: 20, hand: ["Doran, the Siege Tower"], battlefield: [], manaPool: ["B", "G", "W"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 345. Counters — Phyrexian Hydra in hand.
  {
    id: "phyrexian-hydra-in-hand",
    description: "Phyrexian Hydra in hand; counter-on-prevented-damage replacement parse.",
    seed: 0x1a0,
    cards: {
      "Phyrexian Hydra": `Name:Phyrexian Hydra
ManaCost:3 G G
Types:Creature Phyrexian Hydra
PT:7/7
K:Trample
R:Event$ AssignDealDamage | ValidTarget$ Card.Self | ReplaceWith$ DBPrevent | Description$ Replace damage with counters.
SVar:DBPrevent:DB$ PutCounter | Defined$ Self | CounterType$ M1M1 | CounterNum$ 1
Oracle:Phyrexian Hydra parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Phyrexian Hydra"],
        battlefield: [],
        manaPool: ["G", "G", "C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 346. Combat trick — Giant Growth in hand.
  {
    id: "giant-growth-in-hand",
    description: "Giant Growth in hand; +3/+3 instant parse.",
    seed: 0x1a1,
    cards: {
      "Giant Growth": `Name:Giant Growth
ManaCost:G
Types:Instant
A:SP$ Pump | Cost$ G | TargetType$ Card | ValidTgts$ Creature | NumAtt$ 3 | NumDef$ 3 | SpellDescription$ Pump 3/3.
Oracle:Giant Growth parse.
`,
    },
    players: [
      { life: 20, hand: ["Giant Growth"], battlefield: [], manaPool: ["G"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 347. Fog — Fog in hand.
  {
    id: "fog-in-hand",
    description: "Fog in hand; prevent combat damage parse.",
    seed: 0x1a2,
    cards: {
      Fog: `Name:Fog
ManaCost:G
Types:Instant
A:SP$ Effect | Cost$ G | ReplacementEffects$ RPrevent | SpellDescription$ Prevent combat damage.
SVar:RPrevent:Event$ DamageDone | IsCombat$ True | PreventionEffect$ True
Oracle:Fog parse.
`,
    },
    players: [
      { life: 20, hand: ["Fog"], battlefield: [], manaPool: ["G"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 348. Artifact synergy — Nettlecyst in hand.
  {
    id: "nettlecyst-in-hand",
    description: "Nettlecyst in hand; Living Weapon + artifact-power Equipment parse.",
    seed: 0x1a3,
    cards: {
      Nettlecyst: `Name:Nettlecyst
ManaCost:3
Types:Artifact Equipment
K:Living Weapon
K:Equip:3
S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddPower$ X | AddToughness$ X | Description$ Equipped pump by artifacts.
SVar:X:Count$Valid Artifact.YouCtrl
Oracle:Nettlecyst parse.
`,
    },
    players: [
      { life: 20, hand: ["Nettlecyst"], battlefield: [], manaPool: ["C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 349. Artifact synergy — Esper Sentinel in hand.
  {
    id: "esper-sentinel-in-hand",
    description: "Esper Sentinel in hand; opponent-noncreature-cast trigger parse.",
    seed: 0x1a4,
    cards: {
      "Esper Sentinel": `Name:Esper Sentinel
ManaCost:W
Types:Artifact Creature Human Soldier
PT:1/1
T:Mode$ SpellCast | ValidCard$ Card.nonCreature | ValidActivatingPlayer$ Opponent | Execute$ TrigDraw | TriggerDescription$ Pay or draw.
SVar:TrigDraw:DB$ Draw | NumCards$ 1
Oracle:Sentinel parse.
`,
    },
    players: [
      { life: 20, hand: ["Esper Sentinel"], battlefield: [], manaPool: ["W"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 350. Sword — Sword of Hearth and Home in hand.
  {
    id: "sword-of-hearth-and-home-in-hand",
    description: "Sword of Hearth and Home in hand; pro-G/W + flicker trigger parse.",
    seed: 0x1a5,
    cards: {
      "Sword of Hearth and Home": `Name:Sword of Hearth and Home
ManaCost:3
Types:Artifact Equipment
K:Equip:2
S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddPower$ 2 | AddToughness$ 2 | AddKeyword$ Protection from green & Protection from white | Description$ Pump + protection.
T:Mode$ DamageDoneOnce | ValidSource$ Creature.EquippedBy | ValidTarget$ Player | CombatDamage$ True | Execute$ TrigBlink | TriggerDescription$ Blink + Land.
SVar:TrigBlink:DB$ ChangeZone | Origin$ Battlefield | Destination$ Exile | TargetType$ Card | ValidTgts$ Creature.YouCtrl+Other
Oracle:Hearth parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Sword of Hearth and Home"],
        battlefield: [],
        manaPool: ["C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 351. Enchantment synergy — Sythis, Harvest's Hand in hand.
  {
    id: "sythis-harvests-hand-in-hand",
    description: "Sythis, Harvest's Hand in hand; enchantment-cast trigger parse.",
    seed: 0x1a6,
    cards: {
      "Sythis, Harvest's Hand": `Name:Sythis, Harvest's Hand
ManaCost:G W
Types:Legendary Enchantment Creature Nymph
PT:2/3
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Enchantment.YouCtrl | Execute$ TrigDraw | TriggerDescription$ Enchantment ETB triggers.
SVar:TrigDraw:DB$ Draw | NumCards$ 1 | SubAbility$ DBLife
SVar:DBLife:DB$ GainLife | LifeAmount$ 1
Oracle:Sythis parse.
`,
    },
    players: [
      { life: 20, hand: ["Sythis, Harvest's Hand"], battlefield: [], manaPool: ["G", "W"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 352. Enchantment synergy — Sigil of the Empty Throne in hand.
  {
    id: "sigil-of-empty-throne-in-hand",
    description: "Sigil of the Empty Throne in hand; angel-token-on-enchantment trigger parse.",
    seed: 0x1a7,
    cards: {
      "Sigil of the Empty Throne": `Name:Sigil of the Empty Throne
ManaCost:5 W
Types:Enchantment
T:Mode$ SpellCast | ValidCard$ Enchantment | ValidActivatingPlayer$ You | Execute$ TrigToken | TriggerDescription$ Angel token on enchantment-cast.
SVar:TrigToken:DB$ Token | TokenScript$ w_4_4_angel_flying | TokenAmount$ 1
Oracle:Sigil parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Sigil of the Empty Throne"],
        battlefield: [],
        manaPool: ["W", "C", "C", "C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 353. Saproling tokens — Sporecrown Thallid in hand.
  {
    id: "sporecrown-thallid-in-hand",
    description: "Sporecrown Thallid in hand; saproling +1/+1 anthem parse.",
    seed: 0x1a8,
    cards: {
      "Sporecrown Thallid": `Name:Sporecrown Thallid
ManaCost:1 G
Types:Creature Fungus
PT:2/2
S:Mode$ Continuous | Affected$ Creature.Saproling+YouCtrl | AddPower$ 1 | AddToughness$ 1 | Description$ Sap anthem.
Oracle:Sporecrown parse.
`,
    },
    players: [
      { life: 20, hand: ["Sporecrown Thallid"], battlefield: [], manaPool: ["G", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 354. Companion — Obosh, the Preypiercer in hand.
  {
    id: "obosh-preypiercer-in-hand",
    description: "Obosh in hand; companion + odd-cmc double-damage parse.",
    seed: 0x1a9,
    cards: {
      "Obosh, the Preypiercer": `Name:Obosh, the Preypiercer
ManaCost:3 R R
Types:Legendary Creature Hellion Horror
PT:3/3
K:Companion:OddCMC
S:Mode$ Continuous | Affected$ Creature.YouCtrl+oddCMC | DoubleDamage$ True | Description$ Doubled damage.
Oracle:Obosh parse.
`,
    },
    players: [
      { life: 20, hand: ["Obosh, the Preypiercer"], battlefield: [], manaPool: ["R", "R", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 355. Companion — Umori, the Collector in hand.
  {
    id: "umori-collector-in-hand",
    description: "Umori in hand; companion-card-type-discount parse.",
    seed: 0x1aa,
    cards: {
      "Umori, the Collector": `Name:Umori, the Collector
ManaCost:1 B G
Types:Legendary Creature Ooze
PT:4/4
K:Companion:Mono
S:Mode$ ReduceCost | ValidCard$ Card.YouCtrl+chosenType | Type$ Spell | Amount$ 1 | Description$ Cost reduction.
Oracle:Umori parse.
`,
    },
    players: [
      { life: 20, hand: ["Umori, the Collector"], battlefield: [], manaPool: ["B", "G", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 356. Spell — Force of Will in hand.
  {
    id: "force-of-will-in-hand",
    description: "Force of Will in hand; counterspell + alt-cost parse.",
    seed: 0x1ab,
    cards: {
      "Force of Will": `Name:Force of Will
ManaCost:3 U U
Types:Instant
A:SP$ Counter | Cost$ 3 U U | TargetType$ Spell | ValidTgts$ Card | SpellDescription$ Counter target.
Oracle:Force of Will parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Force of Will"],
        battlefield: [],
        manaPool: ["U", "U", "C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 357. Spell — Fact or Fiction in hand.
  {
    id: "fact-or-fiction-in-hand",
    description: "Fact or Fiction in hand; reveal-pile-divide parse.",
    seed: 0x1ac,
    cards: {
      "Fact or Fiction": `Name:Fact or Fiction
ManaCost:3 U
Types:Instant
A:SP$ Dig | Cost$ 3 U | DigNum$ 5 | ChangeNum$ All | DestinationZone$ Hand | RestRandomOrder$ True | SpellDescription$ FoF.
Oracle:FoF parse.
`,
    },
    players: [
      { life: 20, hand: ["Fact or Fiction"], battlefield: [], manaPool: ["U", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 358. Multiplayer — Vow of Lightning in hand.
  {
    id: "vow-of-lightning-in-hand",
    description: "Vow of Lightning in hand; can't-attack-you Aura parse.",
    seed: 0x1ad,
    cards: {
      "Vow of Lightning": `Name:Vow of Lightning
ManaCost:2 R
Types:Enchantment Aura
A:SP$ Attach | Cost$ 2 R | TargetType$ Card | ValidTgts$ Creature | SpellDescription$ Aura.
S:Mode$ Continuous | Affected$ Creature.EnchantedBy | AddKeyword$ First Strike & CARDNAME can't attack you | Description$ Vow.
Oracle:Vow parse.
`,
    },
    players: [
      { life: 20, hand: ["Vow of Lightning"], battlefield: [], manaPool: ["R", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 359. Multiplayer — Court of Vantress in hand.
  {
    id: "court-of-vantress-in-hand",
    description: "Court of Vantress in hand; monarch + scry trigger parse.",
    seed: 0x1ae,
    cards: {
      "Court of Vantress": `Name:Court of Vantress
ManaCost:2 U U
Types:Enchantment
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigMonarch | TriggerDescription$ Become the monarch.
SVar:TrigMonarch:DB$ BecomeMonarch | Defined$ You
T:Mode$ Phase | Phase$ BeginningOfUpkeep | ValidPlayer$ You | Execute$ TrigScry | TriggerDescription$ Scry 2 + tutor if monarch.
SVar:TrigScry:DB$ Scry | ScryNum$ 2
Oracle:Court of Vantress parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Court of Vantress"],
        battlefield: [],
        manaPool: ["U", "U", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 360. Plane — Karn's Bastion in hand.
  {
    id: "karns-bastion-in-hand",
    description: "Karn's Bastion in hand; proliferate-land activated parse.",
    seed: 0x1af,
    cards: {
      "Karn's Bastion": `Name:Karn's Bastion
ManaCost:no cost
Types:Land
A:AB$ Mana | Cost$ T | Produced$ C
A:AB$ Pump | Cost$ 4 T | NumAtt$ 0 | SubAbility$ DBProliferate | SpellDescription$ Proliferate.
SVar:DBProliferate:DB$ Draw | NumCards$ 0
Oracle:Karn's Bastion parse.
`,
    },
    players: [
      { life: 20, hand: ["Karn's Bastion"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 361. Recent set — March of the Machine FF UB Cloud in hand.
  {
    id: "cloud-strife-in-hand",
    description: "Cloud, Ex-SOLDIER (FF UB) in hand; Equipment-buff parse.",
    seed: 0x1b0,
    cards: {
      "Cloud, Ex-SOLDIER": `Name:Cloud, Ex-SOLDIER
ManaCost:1 W
Types:Legendary Creature Human Soldier
PT:2/2
S:Mode$ Continuous | Affected$ Card.Self | AddPower$ X | AddToughness$ X | Description$ Equipment count.
SVar:X:Count$Valid Equipment.YouCtrl
Oracle:Cloud parse.
`,
    },
    players: [
      { life: 20, hand: ["Cloud, Ex-SOLDIER"], battlefield: [], manaPool: ["W", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 362. MKM — No More Lies in hand.
  {
    id: "no-more-lies-in-hand",
    description: "No More Lies (MKM) in hand; counter-pay-3 parse.",
    seed: 0x1b1,
    cards: {
      "No More Lies": `Name:No More Lies
ManaCost:1 W U
Types:Instant
A:SP$ Counter | Cost$ 1 W U | TargetType$ Spell | ValidTgts$ Card | UnlessCost$ 3 | SpellDescription$ Counter unless 3.
Oracle:No More Lies parse.
`,
    },
    players: [
      { life: 20, hand: ["No More Lies"], battlefield: [], manaPool: ["W", "U", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 363. OTJ — Slickshot Show-Off in hand.
  {
    id: "slickshot-show-off-in-hand",
    description: "Slickshot Show-Off (OTJ) in hand; Plot + flying-trample-burst parse.",
    seed: 0x1b2,
    cards: {
      "Slickshot Show-Off": `Name:Slickshot Show-Off
ManaCost:1 R
Types:Creature Otter Rogue
PT:1/1
K:Plot:R
S:Mode$ Continuous | Affected$ Card.Self | CheckSecondPart$ True | AddPower$ 3 | AddKeyword$ Flying & Trample | Description$ Burst on second.
Oracle:Slickshot parse.
`,
    },
    players: [
      { life: 20, hand: ["Slickshot Show-Off"], battlefield: [], manaPool: ["R", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 364. MH3 — Nadu, Winged Wisdom in hand.
  {
    id: "nadu-winged-wisdom-in-hand",
    description: "Nadu, Winged Wisdom (MH3) in hand; target-trigger draw + land parse.",
    seed: 0x1b3,
    cards: {
      "Nadu, Winged Wisdom": `Name:Nadu, Winged Wisdom
ManaCost:G W U
Types:Legendary Creature Bird Spirit
PT:3/4
K:Flying
T:Mode$ Targeted | ValidCard$ Creature.YouCtrl | Execute$ TrigReveal | OncePerTargeted$ True | TriggerDescription$ Reveal land or +1/+1.
SVar:TrigReveal:DB$ Reveal | NumCards$ 1 | SubAbility$ DBPlay
SVar:DBPlay:DB$ ChangeZone | Origin$ Library | Destination$ Battlefield | ChangeType$ Land | ChangeNum$ 1
Oracle:Nadu parse.
`,
    },
    players: [
      { life: 20, hand: ["Nadu, Winged Wisdom"], battlefield: [], manaPool: ["G", "W", "U"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 365. BLB — Three Tree City in hand.
  {
    id: "three-tree-city-in-hand",
    description: "Three Tree City (BLB) in hand; mana-fix legendary land parse.",
    seed: 0x1b4,
    cards: {
      "Three Tree City": `Name:Three Tree City
ManaCost:no cost
Types:Legendary Land
A:AB$ Mana | Cost$ T | Produced$ G | SpellDescription$ Add G.
A:AB$ Mana | Cost$ T | Produced$ W | SpellDescription$ Add W.
A:AB$ Mana | Cost$ T | Produced$ U | SpellDescription$ Add U.
Oracle:Three Tree City parse.
`,
    },
    players: [
      { life: 20, hand: ["Three Tree City"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 366. FDN — Innkeeper's Talent in hand.
  {
    id: "innkeepers-talent-in-hand",
    description: "Innkeeper's Talent (FDN) in hand; Class-style enchantment parse.",
    seed: 0x1b5,
    cards: {
      "Innkeeper's Talent": `Name:Innkeeper's Talent
ManaCost:G
Types:Enchantment Class
S:Mode$ Continuous | Affected$ Card.Self | Description$ Class.
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigCounter | TriggerDescription$ +1/+1 counter.
SVar:TrigCounter:DB$ PutCounter | TargetType$ Card | CounterType$ P1P1 | CounterNum$ 1 | ValidTgts$ Creature.YouCtrl
Oracle:Innkeeper's Talent parse.
`,
    },
    players: [
      { life: 20, hand: ["Innkeeper's Talent"], battlefield: [], manaPool: ["G"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 367. DSK — Overlord of the Hauntwoods in hand.
  {
    id: "overlord-hauntwoods-in-hand",
    description: "Overlord of the Hauntwoods (DSK) in hand; Impending parse.",
    seed: 0x1b6,
    cards: {
      "Overlord of the Hauntwoods": `Name:Overlord of the Hauntwoods
ManaCost:4 G G
Types:Enchantment Creature Eldrazi Avatar
PT:6/6
K:Trample
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigToken | TriggerDescription$ Forest token ETB.
SVar:TrigToken:DB$ Token | TokenScript$ c_a_forest | TokenAmount$ 1
Oracle:Overlord parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Overlord of the Hauntwoods"],
        battlefield: [],
        manaPool: ["G", "G", "C", "C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 368. MKM — Detective's Phoenix in hand.
  {
    id: "detectives-phoenix-in-hand",
    description: "Detective's Phoenix (MKM) in hand; flying + recursion parse.",
    seed: 0x1b7,
    cards: {
      "Detective's Phoenix": `Name:Detective's Phoenix
ManaCost:1 R
Types:Creature Phoenix Detective
PT:2/1
K:Flying
K:Haste
T:Mode$ Phase | Phase$ EndOfTurn | ValidPlayer$ You | CheckSVar$ AttackedThis | SVarCompare$ GE1 | Execute$ TrigRet | TriggerDescription$ Return on attack.
SVar:TrigRet:DB$ ChangeZone | Defined$ Self | Origin$ Graveyard | Destination$ Battlefield
SVar:AttackedThis:Count$thisTurnAttacked
Oracle:Phoenix parse.
`,
    },
    players: [
      { life: 20, hand: ["Detective's Phoenix"], battlefield: [], manaPool: ["R", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 369. OTJ — Vaultborn Tyrant in hand.
  {
    id: "vaultborn-tyrant-in-hand",
    description: "Vaultborn Tyrant (OTJ) in hand; ETB-life-draw + recur parse.",
    seed: 0x1b8,
    cards: {
      "Vaultborn Tyrant": `Name:Vaultborn Tyrant
ManaCost:5 G G
Types:Creature Dinosaur
PT:6/6
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigGain | TriggerDescription$ Gain 6 life and draw card.
SVar:TrigGain:DB$ GainLife | LifeAmount$ 6 | SubAbility$ DBDraw
SVar:DBDraw:DB$ Draw | NumCards$ 1
Oracle:Vaultborn parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Vaultborn Tyrant"],
        battlefield: [],
        manaPool: ["G", "G", "C", "C", "C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 370. BLB — Helping Hand in hand.
  {
    id: "helping-hand-in-hand",
    description: "Helping Hand (BLB) in hand; cheap reanimator parse.",
    seed: 0x1b9,
    cards: {
      "Helping Hand": `Name:Helping Hand
ManaCost:W
Types:Sorcery
A:SP$ ChangeZone | Cost$ W | Origin$ Graveyard | Destination$ Hand | TargetType$ Card | ValidTgts$ Creature.cmcLE2+YouCtrl | SpellDescription$ Return small.
Oracle:Helping Hand parse.
`,
    },
    players: [
      { life: 20, hand: ["Helping Hand"], battlefield: [], manaPool: ["W"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 371. FDN — Lavaspur Boots in hand.
  {
    id: "lavaspur-boots-in-hand",
    description: "Lavaspur Boots (FDN) in hand; Equipment + haste-grant parse.",
    seed: 0x1ba,
    cards: {
      "Lavaspur Boots": `Name:Lavaspur Boots
ManaCost:2
Types:Artifact Equipment
K:Equip:1
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Creature.YouCtrl | Execute$ TrigEquip | TriggerDescription$ Auto-equip ETB.
SVar:TrigEquip:DB$ Attach | Defined$ TriggeredCard
S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddPower$ 1 | AddToughness$ 1 | AddKeyword$ Haste | Description$ Equipped pump+haste.
Oracle:Boots parse.
`,
    },
    players: [
      { life: 20, hand: ["Lavaspur Boots"], battlefield: [], manaPool: ["C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 372. DSK — Valgavoth, Terror Eater in hand.
  {
    id: "valgavoth-terror-eater-in-hand",
    description: "Valgavoth, Terror Eater (DSK) in hand; Ward + lifelink parse.",
    seed: 0x1bb,
    cards: {
      "Valgavoth, Terror Eater": `Name:Valgavoth, Terror Eater
ManaCost:6 B B
Types:Legendary Creature Demon
PT:9/6
K:Flying
K:Lifelink
K:Ward:4
Oracle:Valgavoth parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Valgavoth, Terror Eater"],
        battlefield: [],
        manaPool: ["B", "B", "C", "C", "C", "C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 373. FF UB — Tifa Lockhart in hand.
  {
    id: "tifa-lockhart-in-hand",
    description: "Tifa Lockhart (FF UB) in hand; double strike conditional parse.",
    seed: 0x1bc,
    cards: {
      "Tifa Lockhart": `Name:Tifa Lockhart
ManaCost:1 R W
Types:Legendary Creature Human Warrior Hero
PT:2/3
K:First Strike
S:Mode$ Continuous | Affected$ Card.Self | CheckSVar$ Equips | SVarCompare$ GE1 | AddKeyword$ Double Strike | Description$ Equip → DS.
SVar:Equips:Count$Valid Equipment.YouCtrl
Oracle:Tifa parse.
`,
    },
    players: [
      { life: 20, hand: ["Tifa Lockhart"], battlefield: [], manaPool: ["R", "W", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 374. MH3 — Phlage, Titan of Fire's Fury in hand.
  {
    id: "phlage-titan-fires-fury-in-hand",
    description: "Phlage (MH3) in hand; cast/escape damage trigger parse.",
    seed: 0x1bd,
    cards: {
      "Phlage, Titan of Fire's Fury": `Name:Phlage, Titan of Fire's Fury
ManaCost:1 R W
Types:Legendary Creature Elemental Avatar
PT:3/4
T:Mode$ SpellCast | ValidCard$ Card.Self | Execute$ TrigDmg | TriggerDescription$ Damage 3 + life 3.
SVar:TrigDmg:DB$ DealDamage | NumDmg$ 3 | ValidTgts$ Any | SubAbility$ DBLife
SVar:DBLife:DB$ GainLife | LifeAmount$ 3
K:Escape:5 R W, Exile three other cards from your graveyard.
Oracle:Phlage parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Phlage, Titan of Fire's Fury"],
        battlefield: [],
        manaPool: ["R", "W", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 375. MKM — Aurelia, the Law Above in hand.
  {
    id: "aurelia-law-above-in-hand",
    description: "Aurelia, the Law Above (MKM) in hand; double-strike Mentor parse.",
    seed: 0x1be,
    cards: {
      "Aurelia, the Law Above": `Name:Aurelia, the Law Above
ManaCost:2 R W W
Types:Legendary Creature Angel Detective
PT:5/5
K:Flying
K:Vigilance
K:Double Strike
K:Mentor
Oracle:Law Above parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Aurelia, the Law Above"],
        battlefield: [],
        manaPool: ["R", "W", "W", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 376. OTJ — Roxanne, Starfall Savant in hand.
  {
    id: "roxanne-starfall-savant-in-hand",
    description: "Roxanne, Starfall Savant (OTJ) in hand; Treasure-on-meteor parse.",
    seed: 0x1bf,
    cards: {
      "Roxanne, Starfall Savant": `Name:Roxanne, Starfall Savant
ManaCost:2 R G
Types:Legendary Creature Cat Druid
PT:3/3
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Land.YouCtrl | Execute$ TrigToken | TriggerDescription$ Meteor token.
SVar:TrigToken:DB$ Token | TokenScript$ c_a_meteor | TokenAmount$ 1
A:AB$ Sacrifice | Cost$ T | SacValid$ Meteor | SubAbility$ DBDmg | SpellDescription$ Sac meteor.
SVar:DBDmg:DB$ DealDamage | NumDmg$ 3 | ValidTgts$ Any
Oracle:Roxanne parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Roxanne, Starfall Savant"],
        battlefield: [],
        manaPool: ["R", "G", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 377. BLB — Hare Apparent in hand.
  {
    id: "hare-apparent-in-hand",
    description: "Hare Apparent (BLB) in hand; rabbit-name-counters parse.",
    seed: 0x1c0,
    cards: {
      "Hare Apparent": `Name:Hare Apparent
ManaCost:1 W
Types:Creature Rabbit
PT:1/1
S:Mode$ Continuous | Affected$ Card.Self | AddPower$ X | AddToughness$ X | Description$ Hare anthem.
SVar:X:Count$Valid Card.namedHareApparent+YouCtrl
Oracle:Hare Apparent parse.
`,
    },
    players: [
      { life: 20, hand: ["Hare Apparent"], battlefield: [], manaPool: ["W", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 378. FF UB — Sephiroth in hand.
  {
    id: "sephiroth-in-hand",
    description: "Sephiroth (FF UB) in hand; Flying + lifelink + Masamune parse.",
    seed: 0x1c1,
    cards: {
      Sephiroth: `Name:Sephiroth
ManaCost:3 B B
Types:Legendary Creature Human Soldier Villain
PT:5/5
K:Flying
K:Lifelink
T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Creature.YouCtrl+Other | Execute$ TrigDrain | TriggerDescription$ Drain on death.
SVar:TrigDrain:DB$ LoseLife | LifeAmount$ 1 | Defined$ Opponent | SubAbility$ DBGain
SVar:DBGain:DB$ GainLife | LifeAmount$ 1
Oracle:Sephiroth parse.
`,
    },
    players: [
      { life: 20, hand: ["Sephiroth"], battlefield: [], manaPool: ["B", "B", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 379. MH3 — Ajani, Nacatl Pariah in hand.
  {
    id: "ajani-nacatl-pariah-in-hand",
    description: "Ajani, Nacatl Pariah (MH3) in hand; flip-walker + token parse.",
    seed: 0x1c2,
    cards: {
      "Ajani, Nacatl Pariah": `Name:Ajani, Nacatl Pariah
ManaCost:1 W
Types:Legendary Creature Cat Warrior
PT:2/2
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigToken | TriggerDescription$ Cat token.
SVar:TrigToken:DB$ Token | TokenScript$ w_1_1_cat | TokenAmount$ 1
Oracle:Ajani parse.
`,
    },
    players: [
      { life: 20, hand: ["Ajani, Nacatl Pariah"], battlefield: [], manaPool: ["W", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 380. DSK — Bloodletter of Aclazotz in hand.
  {
    id: "bloodletter-of-aclazotz-in-hand",
    description: "Bloodletter of Aclazotz (DSK) in hand; double-life-loss replacement parse.",
    seed: 0x1c3,
    cards: {
      "Bloodletter of Aclazotz": `Name:Bloodletter of Aclazotz
ManaCost:2 B B
Types:Creature Vampire
PT:4/4
K:Flying
R:Event$ LifeReduced | ValidPlayer$ Opponent | ReplaceWith$ DoubleLoss | Description$ Double opponent's life loss.
SVar:DoubleLoss:DB$ ReplaceLifeLoss | Multiplier$ 2
Oracle:Bloodletter parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Bloodletter of Aclazotz"],
        battlefield: [],
        manaPool: ["B", "B", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 381. Land — Cabal Coffers in hand.
  {
    id: "cabal-coffers-in-hand",
    description: "Cabal Coffers in hand; per-Swamp-mana activated parse.",
    seed: 0x1c4,
    cards: {
      "Cabal Coffers": `Name:Cabal Coffers
ManaCost:no cost
Types:Land
A:AB$ Mana | Cost$ 2 T | Produced$ B | Amount$ X | SpellDescription$ B per Swamp.
SVar:X:Count$Valid Swamp.YouCtrl
Oracle:Coffers parse.
`,
    },
    players: [
      { life: 20, hand: ["Cabal Coffers"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 382. Land — Gaea's Cradle in hand.
  {
    id: "gaeas-cradle-in-hand",
    description: "Gaea's Cradle in hand; per-creature-mana activated parse.",
    seed: 0x1c5,
    cards: {
      "Gaea's Cradle": `Name:Gaea's Cradle
ManaCost:no cost
Types:Legendary Land
A:AB$ Mana | Cost$ T | Produced$ G | Amount$ X | SpellDescription$ G per creature.
SVar:X:Count$Valid Creature.YouCtrl
Oracle:Cradle parse.
`,
    },
    players: [
      { life: 20, hand: ["Gaea's Cradle"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 383. Land — Serra's Sanctum in hand.
  {
    id: "serras-sanctum-in-hand",
    description: "Serra's Sanctum in hand; per-enchantment-mana activated parse.",
    seed: 0x1c6,
    cards: {
      "Serra's Sanctum": `Name:Serra's Sanctum
ManaCost:no cost
Types:Legendary Land
A:AB$ Mana | Cost$ T | Produced$ W | Amount$ X | SpellDescription$ W per enchantment.
SVar:X:Count$Valid Enchantment.YouCtrl
Oracle:Sanctum parse.
`,
    },
    players: [
      { life: 20, hand: ["Serra's Sanctum"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 384. Land — Tolarian Academy in hand.
  {
    id: "tolarian-academy-in-hand",
    description: "Tolarian Academy in hand; per-artifact-mana activated parse.",
    seed: 0x1c7,
    cards: {
      "Tolarian Academy": `Name:Tolarian Academy
ManaCost:no cost
Types:Legendary Land
A:AB$ Mana | Cost$ T | Produced$ U | Amount$ X | SpellDescription$ U per artifact.
SVar:X:Count$Valid Artifact.YouCtrl
Oracle:Academy parse.
`,
    },
    players: [
      { life: 20, hand: ["Tolarian Academy"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 385. Spell — Counterspell variant — Disallow in hand.
  {
    id: "disallow-in-hand",
    description: "Disallow in hand; counter-spell-or-ability parse.",
    seed: 0x1c8,
    cards: {
      Disallow: `Name:Disallow
ManaCost:1 U U
Types:Instant
A:SP$ Counter | Cost$ 1 U U | TargetType$ Spell,Ability,Trigger | ValidTgts$ Card | SpellDescription$ Counter spell or ability.
Oracle:Disallow parse.
`,
    },
    players: [
      { life: 20, hand: ["Disallow"], battlefield: [], manaPool: ["U", "U", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 386. Spell — Mana Leak in hand.
  {
    id: "mana-leak-in-hand",
    description: "Mana Leak in hand; counter-unless-3 parse.",
    seed: 0x1c9,
    cards: {
      "Mana Leak": `Name:Mana Leak
ManaCost:1 U
Types:Instant
A:SP$ Counter | Cost$ 1 U | TargetType$ Spell | ValidTgts$ Card | UnlessCost$ 3 | SpellDescription$ Counter unless 3.
Oracle:Mana Leak parse.
`,
    },
    players: [
      { life: 20, hand: ["Mana Leak"], battlefield: [], manaPool: ["U", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 387. Spell — Pact of Negation in hand.
  {
    id: "pact-of-negation-in-hand",
    description: "Pact of Negation in hand; alt-cost free counter parse.",
    seed: 0x1ca,
    cards: {
      "Pact of Negation": `Name:Pact of Negation
ManaCost:no cost
Types:Instant
A:SP$ Counter | Cost$ 0 | TargetType$ Spell | ValidTgts$ Card | SpellDescription$ Free counter; pact pay next upkeep.
T:Mode$ Phase | Phase$ BeginningOfUpkeep | ValidPlayer$ You | Execute$ TrigPact | TriggerDescription$ Pay or lose.
SVar:TrigPact:DB$ LoseGame
Oracle:Pact of Negation parse.
`,
    },
    players: [
      { life: 20, hand: ["Pact of Negation"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 388. Spell — Vampiric Tutor in hand.
  {
    id: "vampiric-tutor-in-hand",
    description: "Vampiric Tutor in hand; library-search top + life parse.",
    seed: 0x1cb,
    cards: {
      "Vampiric Tutor": `Name:Vampiric Tutor
ManaCost:B
Types:Instant
A:SP$ ChangeZone | Cost$ B | Origin$ Library | Destination$ Library | ChangeType$ Card | LibraryPosition$ 0 | SubAbility$ DBLife | SpellDescription$ Vamp Tutor.
SVar:DBLife:DB$ LoseLife | LifeAmount$ 2
Oracle:Vampiric Tutor parse.
`,
    },
    players: [
      { life: 20, hand: ["Vampiric Tutor"], battlefield: [], manaPool: ["B"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 389. Spell — Mystical Tutor in hand.
  {
    id: "mystical-tutor-in-hand",
    description: "Mystical Tutor in hand; instant/sorcery search parse.",
    seed: 0x1cc,
    cards: {
      "Mystical Tutor": `Name:Mystical Tutor
ManaCost:U
Types:Instant
A:SP$ ChangeZone | Cost$ U | Origin$ Library | Destination$ Library | ChangeType$ Instant,Sorcery | LibraryPosition$ 0 | SpellDescription$ Mystical Tutor.
Oracle:Mystical Tutor parse.
`,
    },
    players: [
      { life: 20, hand: ["Mystical Tutor"], battlefield: [], manaPool: ["U"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 390. Spell — Worldly Tutor in hand.
  {
    id: "worldly-tutor-in-hand",
    description: "Worldly Tutor in hand; creature-search parse.",
    seed: 0x1cd,
    cards: {
      "Worldly Tutor": `Name:Worldly Tutor
ManaCost:G
Types:Instant
A:SP$ ChangeZone | Cost$ G | Origin$ Library | Destination$ Library | ChangeType$ Creature | LibraryPosition$ 0 | SpellDescription$ Worldly Tutor.
Oracle:Worldly Tutor parse.
`,
    },
    players: [
      { life: 20, hand: ["Worldly Tutor"], battlefield: [], manaPool: ["G"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 391. Spell — Imperial Seal in hand.
  {
    id: "imperial-seal-in-hand",
    description: "Imperial Seal in hand; sorcery-vamp-tutor parse.",
    seed: 0x1ce,
    cards: {
      "Imperial Seal": `Name:Imperial Seal
ManaCost:B
Types:Sorcery
A:SP$ ChangeZone | Cost$ B | Origin$ Library | Destination$ Library | ChangeType$ Card | LibraryPosition$ 0 | SubAbility$ DBLife | SpellDescription$ Imperial Seal.
SVar:DBLife:DB$ LoseLife | LifeAmount$ 2
Oracle:Imperial Seal parse.
`,
    },
    players: [
      { life: 20, hand: ["Imperial Seal"], battlefield: [], manaPool: ["B"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 392. Spell — Enlightened Tutor in hand.
  {
    id: "enlightened-tutor-in-hand",
    description: "Enlightened Tutor in hand; artifact-or-enchantment-search parse.",
    seed: 0x1cf,
    cards: {
      "Enlightened Tutor": `Name:Enlightened Tutor
ManaCost:W
Types:Instant
A:SP$ ChangeZone | Cost$ W | Origin$ Library | Destination$ Library | ChangeType$ Artifact,Enchantment | LibraryPosition$ 0 | SpellDescription$ Enlightened Tutor.
Oracle:Enlightened Tutor parse.
`,
    },
    players: [
      { life: 20, hand: ["Enlightened Tutor"], battlefield: [], manaPool: ["W"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 393. Land — Bazaar of Baghdad in hand.
  {
    id: "bazaar-of-baghdad-in-hand",
    description: "Bazaar of Baghdad in hand; draw-2-discard-3 parse.",
    seed: 0x1d0,
    cards: {
      "Bazaar of Baghdad": `Name:Bazaar of Baghdad
ManaCost:no cost
Types:Land
A:AB$ Draw | Cost$ T | NumCards$ 2 | SubAbility$ DBDiscard | SpellDescription$ Bazaar.
SVar:DBDiscard:DB$ Discard | NumCards$ 3 | Mode$ TgtChoose
Oracle:Bazaar parse.
`,
    },
    players: [
      { life: 20, hand: ["Bazaar of Baghdad"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 394. Spell — Yawgmoth's Will in hand.
  {
    id: "yawgmoths-will-in-hand",
    description: "Yawgmoth's Will in hand; play-from-graveyard parse.",
    seed: 0x1d1,
    cards: {
      "Yawgmoth's Will": `Name:Yawgmoth's Will
ManaCost:2 B
Types:Sorcery
A:SP$ Effect | Cost$ 2 B | StaticAbilities$ STPlay | RememberObjects$ You | SpellDescription$ Y-Will.
SVar:STPlay:Mode$ Continuous | EffectZone$ Command | MayPlay$ True | Affected$ Card.YouOwn+inGraveyard
Oracle:Y-Will parse.
`,
    },
    players: [
      { life: 20, hand: ["Yawgmoth's Will"], battlefield: [], manaPool: ["B", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 395. Spell — Time Walk in hand.
  {
    id: "time-walk-in-hand",
    description: "Time Walk in hand; extra-turn parse.",
    seed: 0x1d2,
    cards: {
      "Time Walk": `Name:Time Walk
ManaCost:1 U
Types:Sorcery
A:SP$ AddTurn | Cost$ 1 U | NumTurns$ 1 | SpellDescription$ Take an extra turn.
Oracle:Time Walk parse.
`,
    },
    players: [
      { life: 20, hand: ["Time Walk"], battlefield: [], manaPool: ["U", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 396. Spell — Black Lotus in hand.
  {
    id: "black-lotus-in-hand",
    description: "Black Lotus in hand; sac-3-mana activated parse.",
    seed: 0x1d3,
    cards: {
      "Black Lotus": `Name:Black Lotus
ManaCost:no cost
Types:Artifact
A:AB$ Mana | Cost$ T Sac<1/CARDNAME> | Produced$ Combo W U B R G | Amount$ 3 | SpellDescription$ Lotus.
Oracle:Black Lotus parse.
`,
    },
    players: [
      { life: 20, hand: ["Black Lotus"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 397. Spell — Mox Sapphire in hand.
  {
    id: "mox-sapphire-in-hand",
    description: "Mox Sapphire in hand; tap-for-U mox parse.",
    seed: 0x1d4,
    cards: {
      "Mox Sapphire": `Name:Mox Sapphire
ManaCost:no cost
Types:Artifact
A:AB$ Mana | Cost$ T | Produced$ U | SpellDescription$ Add U.
Oracle:Mox Sapphire parse.
`,
    },
    players: [
      { life: 20, hand: ["Mox Sapphire"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 398. Spell — Ancestral Recall variant — Brainstorm in hand.
  {
    id: "brainstorm-m611-in-hand",
    description: "Brainstorm in hand; draw-3-put-2-back parse.",
    seed: 0x1d5,
    cards: {
      Brainstorm: `Name:Brainstorm
ManaCost:U
Types:Instant
A:SP$ Draw | Cost$ U | NumCards$ 3 | SubAbility$ DBReturn | SpellDescription$ Brainstorm.
SVar:DBReturn:DB$ ChangeZone | Origin$ Hand | Destination$ Library | ChangeType$ Card | ChangeNum$ 2 | LibraryPosition$ 0
Oracle:Brainstorm parse.
`,
    },
    players: [
      { life: 20, hand: ["Brainstorm"], battlefield: [], manaPool: ["U"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 399. Spell — Ponder in hand.
  {
    id: "ponder-in-hand",
    description: "Ponder in hand; look-3 + draw parse.",
    seed: 0x1d6,
    cards: {
      Ponder: `Name:Ponder
ManaCost:U
Types:Sorcery
A:SP$ Scry | Cost$ U | ScryNum$ 3 | SubAbility$ DBDraw | SpellDescription$ Ponder.
SVar:DBDraw:DB$ Draw | NumCards$ 1
Oracle:Ponder parse.
`,
    },
    players: [
      { life: 20, hand: ["Ponder"], battlefield: [], manaPool: ["U"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 400. Spell — Preordain in hand.
  {
    id: "preordain-in-hand",
    description: "Preordain in hand; scry-2 + draw parse.",
    seed: 0x1d7,
    cards: {
      Preordain: `Name:Preordain
ManaCost:U
Types:Sorcery
A:SP$ Scry | Cost$ U | ScryNum$ 2 | SubAbility$ DBDraw | SpellDescription$ Preordain.
SVar:DBDraw:DB$ Draw | NumCards$ 1
Oracle:Preordain parse.
`,
    },
    players: [
      { life: 20, hand: ["Preordain"], battlefield: [], manaPool: ["U"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 401. Recursion — Sun Titan in hand.
  {
    id: "sun-titan-in-hand",
    description: "Sun Titan in hand; ETB-and-attack-recur trigger parse.",
    seed: 0x1d8,
    cards: {
      "Sun Titan": `Name:Sun Titan
ManaCost:4 W W
Types:Creature Giant
PT:6/6
K:Vigilance
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigRet | TriggerDescription$ Recur cmc<=3.
SVar:TrigRet:DB$ ChangeZone | Origin$ Graveyard | Destination$ Battlefield | TargetType$ Card | ValidTgts$ Permanent.cmcLE3+YouCtrl
T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ TrigRet
Oracle:Sun Titan parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Sun Titan"],
        battlefield: [],
        manaPool: ["W", "W", "C", "C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 402. Recursion — Frost Titan in hand.
  {
    id: "frost-titan-in-hand",
    description: "Frost Titan in hand; pay-or-counter-target trigger parse.",
    seed: 0x1d9,
    cards: {
      "Frost Titan": `Name:Frost Titan
ManaCost:4 U U
Types:Creature Giant
PT:6/6
T:Mode$ Targeted | ValidCard$ Card.Self | Execute$ TrigPay | TriggerDescription$ Pay or counter.
SVar:TrigPay:DB$ Counter | TargetType$ Spell,Ability | ValidTgts$ Card | UnlessCost$ 2
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigTap | TriggerDescription$ Tap on ETB.
SVar:TrigTap:DB$ Tap | TargetType$ Card | ValidTgts$ Permanent.OppCtrl
Oracle:Frost Titan parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Frost Titan"],
        battlefield: [],
        manaPool: ["U", "U", "C", "C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 403. Recursion — Grave Titan in hand.
  {
    id: "grave-titan-in-hand",
    description: "Grave Titan in hand; deathtouch + ETB-zombies trigger parse.",
    seed: 0x1da,
    cards: {
      "Grave Titan": `Name:Grave Titan
ManaCost:4 B B
Types:Creature Giant
PT:6/6
K:Deathtouch
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigToken | TriggerDescription$ Zombie tokens ETB.
SVar:TrigToken:DB$ Token | TokenScript$ b_2_2_zombie | TokenAmount$ 2
T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ TrigToken
Oracle:Grave Titan parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Grave Titan"],
        battlefield: [],
        manaPool: ["B", "B", "C", "C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 404. Recursion — Inferno Titan in hand.
  {
    id: "inferno-titan-in-hand",
    description: "Inferno Titan in hand; ETB-3-damage-divided trigger parse.",
    seed: 0x1db,
    cards: {
      "Inferno Titan": `Name:Inferno Titan
ManaCost:4 R R
Types:Creature Giant
PT:6/6
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDmg | TriggerDescription$ ETB-3 damage divided.
SVar:TrigDmg:DB$ DealDamage | NumDmg$ 3 | DividedAsYouChoose$ True | ValidTgts$ Any
T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ TrigDmg
Oracle:Inferno Titan parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Inferno Titan"],
        battlefield: [],
        manaPool: ["R", "R", "C", "C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 405. Recursion — Primeval Titan in hand.
  {
    id: "primeval-titan-in-hand",
    description: "Primeval Titan in hand; ETB-and-attack-search-lands parse.",
    seed: 0x1dc,
    cards: {
      "Primeval Titan": `Name:Primeval Titan
ManaCost:4 G G
Types:Creature Giant
PT:6/6
K:Trample
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigSearch | TriggerDescription$ Search 2 lands.
SVar:TrigSearch:DB$ ChangeZone | Origin$ Library | Destination$ Battlefield | ChangeType$ Land | ChangeNum$ 2 | Tapped$ True
T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ TrigSearch
Oracle:Primeval Titan parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Primeval Titan"],
        battlefield: [],
        manaPool: ["G", "G", "C", "C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 406. Burn — Lava Spike in hand.
  {
    id: "lava-spike-in-hand",
    description: "Lava Spike in hand; player-only burn parse.",
    seed: 0x1dd,
    cards: {
      "Lava Spike": `Name:Lava Spike
ManaCost:R
Types:Sorcery Arcane
A:SP$ DealDamage | Cost$ R | NumDmg$ 3 | ValidTgts$ Player | SpellDescription$ Burn 3 player.
Oracle:Lava Spike parse.
`,
    },
    players: [
      { life: 20, hand: ["Lava Spike"], battlefield: [], manaPool: ["R"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 407. Burn — Bolt of Keranos style — Searing Blaze in hand.
  {
    id: "searing-blaze-in-hand",
    description: "Searing Blaze in hand; landfall-burn-3-3 parse.",
    seed: 0x1de,
    cards: {
      "Searing Blaze": `Name:Searing Blaze
ManaCost:R R
Types:Instant
A:SP$ DealDamage | Cost$ R R | NumDmg$ 1 | ValidTgts$ Player | SubAbility$ DBDmg | SpellDescription$ Bolt + 1.
SVar:DBDmg:DB$ DealDamage | NumDmg$ 1 | ValidTgts$ Creature
Oracle:Searing Blaze parse.
`,
    },
    players: [
      { life: 20, hand: ["Searing Blaze"], battlefield: [], manaPool: ["R", "R"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 408. Burn — Skewer the Critics in hand.
  {
    id: "skewer-the-critics-in-hand",
    description: "Skewer the Critics in hand; spectacle alt-cost burn parse.",
    seed: 0x1df,
    cards: {
      "Skewer the Critics": `Name:Skewer the Critics
ManaCost:2 R
Types:Sorcery
K:Spectacle:R
A:SP$ DealDamage | Cost$ 2 R | NumDmg$ 3 | ValidTgts$ Any | SpellDescription$ Burn 3.
Oracle:Skewer parse.
`,
    },
    players: [
      { life: 20, hand: ["Skewer the Critics"], battlefield: [], manaPool: ["R", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 409. Burn — Boros Charm in hand.
  {
    id: "boros-charm-in-hand",
    description: "Boros Charm in hand; modal-3-modes parse.",
    seed: 0x1e0,
    cards: {
      "Boros Charm": `Name:Boros Charm
ManaCost:R W
Types:Instant
A:SP$ Charm | Cost$ R W | Choices$ DBBurn,DBPump,DBProtect | SpellDescription$ Boros Charm.
SVar:DBBurn:DB$ DealDamage | NumDmg$ 4 | ValidTgts$ Player
SVar:DBPump:DB$ Pump | TargetType$ Card | ValidTgts$ Permanent.YouCtrl | KW$ Indestructible
SVar:DBProtect:DB$ Pump | TargetType$ Card | ValidTgts$ Creature.YouCtrl | KW$ Double Strike
Oracle:Boros Charm parse.
`,
    },
    players: [
      { life: 20, hand: ["Boros Charm"], battlefield: [], manaPool: ["R", "W"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 410. Sweeper — Damnation in hand.
  {
    id: "damnation-in-hand",
    description: "Damnation in hand; mass-destroy-noregen black parse.",
    seed: 0x1e1,
    cards: {
      Damnation: `Name:Damnation
ManaCost:2 B B
Types:Sorcery
A:SP$ DestroyAll | Cost$ 2 B B | ValidCards$ Creature | NoRegen$ True | SpellDescription$ Damnation.
Oracle:Damnation parse.
`,
    },
    players: [
      { life: 20, hand: ["Damnation"], battlefield: [], manaPool: ["B", "B", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 411. Sweeper — Day of Judgment in hand.
  {
    id: "day-of-judgment-in-hand",
    description: "Day of Judgment in hand; mass-destroy-no-regen parse.",
    seed: 0x1e2,
    cards: {
      "Day of Judgment": `Name:Day of Judgment
ManaCost:2 W W
Types:Sorcery
A:SP$ DestroyAll | Cost$ 2 W W | ValidCards$ Creature | SpellDescription$ DoJ.
Oracle:Day of Judgment parse.
`,
    },
    players: [
      { life: 20, hand: ["Day of Judgment"], battlefield: [], manaPool: ["W", "W", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 412. Sweeper — Toxic Deluge in hand.
  {
    id: "toxic-deluge-in-hand",
    description: "Toxic Deluge in hand; X-cost minus-toughness parse.",
    seed: 0x1e3,
    cards: {
      "Toxic Deluge": `Name:Toxic Deluge
ManaCost:2 B
Types:Sorcery
A:SP$ PumpAll | Cost$ 2 B PayLife<X> | ValidCards$ Creature | NumAtt$ -X | NumDef$ -X | SpellDescription$ Toxic Deluge.
SVar:X:Count$xPaid
Oracle:Toxic Deluge parse.
`,
    },
    players: [
      { life: 20, hand: ["Toxic Deluge"], battlefield: [], manaPool: ["B", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 413. Sweeper — Anger of the Gods in hand.
  {
    id: "anger-of-the-gods-in-hand",
    description: "Anger of the Gods in hand; mass-3-damage-exile-replacement parse.",
    seed: 0x1e4,
    cards: {
      "Anger of the Gods": `Name:Anger of the Gods
ManaCost:1 R R
Types:Sorcery
A:SP$ DamageAll | Cost$ 1 R R | ValidCards$ Creature | NumDmg$ 3 | SpellDescription$ Mass 3 damage.
Oracle:Anger of the Gods parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Anger of the Gods"],
        battlefield: [],
        manaPool: ["R", "R", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 414. Sweeper — Pyroclasm in hand.
  {
    id: "pyroclasm-in-hand",
    description: "Pyroclasm in hand; mass-2-damage parse.",
    seed: 0x1e5,
    cards: {
      Pyroclasm: `Name:Pyroclasm
ManaCost:1 R
Types:Sorcery
A:SP$ DamageAll | Cost$ 1 R | ValidCards$ Creature | NumDmg$ 2 | SpellDescription$ Pyroclasm.
Oracle:Pyroclasm parse.
`,
    },
    players: [
      { life: 20, hand: ["Pyroclasm"], battlefield: [], manaPool: ["R", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 415. Sweeper — Pernicious Deed in hand.
  {
    id: "pernicious-deed-in-hand",
    description: "Pernicious Deed in hand; X-cost destroy parse.",
    seed: 0x1e6,
    cards: {
      "Pernicious Deed": `Name:Pernicious Deed
ManaCost:1 B G
Types:Enchantment
A:AB$ DestroyAll | Cost$ X Sac<1/CARDNAME> | ValidCards$ Permanent.cmcLEX+nonland | SpellDescription$ Pernicious Deed.
SVar:X:Count$xPaid
Oracle:Pernicious Deed parse.
`,
    },
    players: [
      { life: 20, hand: ["Pernicious Deed"], battlefield: [], manaPool: ["B", "G", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 416. Lifegain — Soul Sister style — Soul's Attendant in hand.
  {
    id: "souls-attendant-in-hand",
    description: "Soul's Attendant in hand; ETB-life trigger parse.",
    seed: 0x1e7,
    cards: {
      "Soul's Attendant": `Name:Soul's Attendant
ManaCost:W
Types:Creature Human Cleric
PT:1/1
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Creature | Execute$ TrigLife | TriggerDescription$ ETB life.
SVar:TrigLife:DB$ GainLife | LifeAmount$ 1
Oracle:Soul's Attendant parse.
`,
    },
    players: [
      { life: 20, hand: ["Soul's Attendant"], battlefield: [], manaPool: ["W"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 417. Lifegain — Ajani's Pridemate style — Trelasarra, Moon Dancer in hand.
  {
    id: "trelasarra-moon-dancer-in-hand",
    description: "Trelasarra, Moon Dancer in hand; lifegain-counter-scry parse.",
    seed: 0x1e8,
    cards: {
      "Trelasarra, Moon Dancer": `Name:Trelasarra, Moon Dancer
ManaCost:G W
Types:Legendary Creature Cat Cleric
PT:1/2
T:Mode$ LifeGained | ValidPlayer$ You | Execute$ TrigCounter | TriggerDescription$ Counter + scry.
SVar:TrigCounter:DB$ PutCounter | Defined$ Self | CounterType$ P1P1 | CounterNum$ 1 | SubAbility$ DBScry
SVar:DBScry:DB$ Scry | ScryNum$ 1
Oracle:Trelasarra parse.
`,
    },
    players: [
      { life: 20, hand: ["Trelasarra, Moon Dancer"], battlefield: [], manaPool: ["G", "W"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 418. Burn-flavored — Eidolon of the Great Revel in hand.
  {
    id: "eidolon-great-revel-in-hand",
    description: "Eidolon of the Great Revel in hand; cmc<=3-cast-burn trigger parse.",
    seed: 0x1e9,
    cards: {
      "Eidolon of the Great Revel": `Name:Eidolon of the Great Revel
ManaCost:R R
Types:Enchantment Creature Spirit
PT:2/2
T:Mode$ SpellCast | ValidCard$ Card.cmcLE3 | ValidActivatingPlayer$ Player | Execute$ TrigDmg | TriggerDescription$ Burn 2 on cmcLE3 cast.
SVar:TrigDmg:DB$ DealDamage | NumDmg$ 2 | Defined$ TriggeredActivator
Oracle:Eidolon parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Eidolon of the Great Revel"],
        battlefield: [],
        manaPool: ["R", "R"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 419. Discard — Thoughtseize in hand.
  {
    id: "thoughtseize-m611-in-hand",
    description: "Thoughtseize in hand; targeted-hand-discard parse.",
    seed: 0x1ea,
    cards: {
      Thoughtseize: `Name:Thoughtseize
ManaCost:B
Types:Sorcery
A:SP$ Discard | Cost$ B PayLife<2> | NumCards$ 1 | Mode$ TgtChoose | ValidTgts$ Opponent | SpellDescription$ Discard nonland.
Oracle:Thoughtseize parse.
`,
    },
    players: [
      { life: 20, hand: ["Thoughtseize"], battlefield: [], manaPool: ["B"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 420. Discard — Hymn to Tourach in hand.
  {
    id: "hymn-to-tourach-in-hand",
    description: "Hymn to Tourach in hand; opp-discard-2-random parse.",
    seed: 0x1eb,
    cards: {
      "Hymn to Tourach": `Name:Hymn to Tourach
ManaCost:B B
Types:Sorcery
A:SP$ Discard | Cost$ B B | NumCards$ 2 | Mode$ Random | ValidTgts$ Opponent | SpellDescription$ Hymn.
Oracle:Hymn parse.
`,
    },
    players: [
      { life: 20, hand: ["Hymn to Tourach"], battlefield: [], manaPool: ["B", "B"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 421. Discard — Liliana of the Veil planeswalker in hand.
  {
    id: "liliana-of-the-veil-in-hand",
    description: "Liliana of the Veil in hand; planeswalker-loyalty-discard parse.",
    seed: 0x1ec,
    cards: {
      "Liliana of the Veil": `Name:Liliana of the Veil
ManaCost:1 B B
Types:Legendary Planeswalker Liliana
Loyalty:3
A:AB$ Discard | Cost$ AddCounter<1/LOYALTY> | Planeswalker$ True | NumCards$ 1 | Mode$ TgtChoose | Defined$ Each | SpellDescription$ +1.
A:AB$ Sacrifice | Cost$ SubCounter<2/LOYALTY> | Planeswalker$ True | SacValid$ Creature | Defined$ Each | SpellDescription$ -2.
A:AB$ ChooseSource | Cost$ SubCounter<6/LOYALTY> | Planeswalker$ True | SpellDescription$ -6.
Oracle:Liliana parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Liliana of the Veil"],
        battlefield: [],
        manaPool: ["B", "B", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 422. Discard — Mind Twist in hand.
  {
    id: "mind-twist-in-hand",
    description: "Mind Twist in hand; X-cost random-discard parse.",
    seed: 0x1ed,
    cards: {
      "Mind Twist": `Name:Mind Twist
ManaCost:X B
Types:Sorcery
A:SP$ Discard | Cost$ X B | NumCards$ X | Mode$ Random | ValidTgts$ Opponent | SpellDescription$ Mind Twist.
SVar:X:Count$xPaid
Oracle:Mind Twist parse.
`,
    },
    players: [
      { life: 20, hand: ["Mind Twist"], battlefield: [], manaPool: ["B", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 423. Mass burn — Earthquake in hand.
  {
    id: "earthquake-in-hand",
    description: "Earthquake in hand; X-damage to all non-flying parse.",
    seed: 0x1ee,
    cards: {
      Earthquake: `Name:Earthquake
ManaCost:X R
Types:Sorcery
A:SP$ DamageAll | Cost$ X R | ValidCards$ Creature.nonFlying | ValidPlayers$ Player | NumDmg$ X | SpellDescription$ Earthquake.
SVar:X:Count$xPaid
Oracle:Earthquake parse.
`,
    },
    players: [
      { life: 20, hand: ["Earthquake"], battlefield: [], manaPool: ["R", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 424. Land — Strip Mine in hand.
  {
    id: "strip-mine-in-hand",
    description: "Strip Mine in hand; sac-destroy-land parse.",
    seed: 0x1ef,
    cards: {
      "Strip Mine": `Name:Strip Mine
ManaCost:no cost
Types:Land
A:AB$ Mana | Cost$ T | Produced$ C
A:AB$ Destroy | Cost$ T Sac<1/CARDNAME> | TargetType$ Card | ValidTgts$ Land | SpellDescription$ Destroy land.
Oracle:Strip Mine parse.
`,
    },
    players: [
      { life: 20, hand: ["Strip Mine"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 425. Token — Bloodghast in hand.
  {
    id: "bloodghast-in-hand",
    description: "Bloodghast in hand; landfall + haste-on-low-life parse.",
    seed: 0x1f0,
    cards: {
      Bloodghast: `Name:Bloodghast
ManaCost:B B
Types:Creature Vampire Spirit
PT:2/1
K:Haste:Player.life:LE10
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Land.YouCtrl | Execute$ TrigRet | TriggerDescription$ Landfall.
SVar:TrigRet:DB$ ChangeZone | Defined$ Self | Origin$ Graveyard | Destination$ Battlefield
Oracle:Bloodghast parse.
`,
    },
    players: [
      { life: 20, hand: ["Bloodghast"], battlefield: [], manaPool: ["B", "B"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 426. Token — Steppe Lynx alt in hand.
  {
    id: "steppe-lynx-m611-in-hand",
    description: "Steppe Lynx in hand; landfall +2/+2 parse.",
    seed: 0x1f1,
    cards: {
      "Steppe Lynx": `Name:Steppe Lynx
ManaCost:W
Types:Creature Cat
PT:0/1
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Land.YouCtrl | Execute$ TrigPump | TriggerDescription$ Landfall pump.
SVar:TrigPump:DB$ Pump | Defined$ Self | NumAtt$ 2 | NumDef$ 2
Oracle:Steppe Lynx parse.
`,
    },
    players: [
      { life: 20, hand: ["Steppe Lynx"], battlefield: [], manaPool: ["W"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 427. Tribal — Lord of Atlantis in hand.
  {
    id: "lord-of-atlantis-in-hand",
    description: "Lord of Atlantis in hand; merfolk lord anthem + islandwalk parse.",
    seed: 0x1f2,
    cards: {
      "Lord of Atlantis": `Name:Lord of Atlantis
ManaCost:U U
Types:Creature Merfolk
PT:2/2
S:Mode$ Continuous | Affected$ Creature.Merfolk+Other | AddPower$ 1 | AddToughness$ 1 | AddKeyword$ Islandwalk | Description$ Merfolk anthem.
Oracle:Lord of Atlantis parse.
`,
    },
    players: [
      { life: 20, hand: ["Lord of Atlantis"], battlefield: [], manaPool: ["U", "U"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 428. Tribal — Goblin King in hand.
  {
    id: "goblin-king-in-hand",
    description: "Goblin King in hand; goblin lord parse.",
    seed: 0x1f3,
    cards: {
      "Goblin King": `Name:Goblin King
ManaCost:R R
Types:Creature Goblin
PT:2/2
S:Mode$ Continuous | Affected$ Creature.Goblin+Other | AddPower$ 1 | AddToughness$ 1 | AddKeyword$ Mountainwalk | Description$ Goblin lord.
Oracle:Goblin King parse.
`,
    },
    players: [
      { life: 20, hand: ["Goblin King"], battlefield: [], manaPool: ["R", "R"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 429. Tribal — Elvish Archdruid in hand.
  {
    id: "elvish-archdruid-in-hand",
    description: "Elvish Archdruid in hand; elf lord + tap-mana parse.",
    seed: 0x1f4,
    cards: {
      "Elvish Archdruid": `Name:Elvish Archdruid
ManaCost:1 G G
Types:Creature Elf Druid
PT:2/2
S:Mode$ Continuous | Affected$ Creature.Elf+Other | AddPower$ 1 | AddToughness$ 1 | Description$ Elf anthem.
A:AB$ Mana | Cost$ T | Produced$ G | Amount$ X | SpellDescription$ Tap for elves.
SVar:X:Count$Valid Creature.Elf+YouCtrl
Oracle:Archdruid parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Elvish Archdruid"],
        battlefield: [],
        manaPool: ["G", "G", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 430. Tribal — Cavern of Souls in hand.
  {
    id: "cavern-of-souls-in-hand",
    description: "Cavern of Souls in hand; choose-creature-type uncounterable parse.",
    seed: 0x1f5,
    cards: {
      "Cavern of Souls": `Name:Cavern of Souls
ManaCost:no cost
Types:Land
K:ETBReplacement:ChooseType
A:AB$ Mana | Cost$ T | Produced$ C
A:AB$ Mana | Cost$ T | Produced$ Combo W U B R G | RestrictValid$ Creature.chosenType | SpellDescription$ Tribe.
Oracle:Cavern parse.
`,
    },
    players: [
      { life: 20, hand: ["Cavern of Souls"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 431. Tribal — Goblin Chieftain in hand.
  {
    id: "goblin-chieftain-in-hand",
    description: "Goblin Chieftain in hand; goblin haste lord parse.",
    seed: 0x1f6,
    cards: {
      "Goblin Chieftain": `Name:Goblin Chieftain
ManaCost:1 R R
Types:Creature Goblin Warrior
PT:2/2
K:Haste
S:Mode$ Continuous | Affected$ Creature.Goblin+Other | AddPower$ 1 | AddToughness$ 1 | AddKeyword$ Haste | Description$ Goblin lord.
Oracle:Chieftain parse.
`,
    },
    players: [
      { life: 20, hand: ["Goblin Chieftain"], battlefield: [], manaPool: ["R", "R", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 432. Spell — Channel in hand.
  {
    id: "channel-m611-in-hand",
    description: "Channel in hand; convert-life-to-mana parse.",
    seed: 0x1f7,
    cards: {
      Channel: `Name:Channel
ManaCost:G G
Types:Sorcery
A:SP$ Effect | Cost$ G G | StaticAbilities$ STMana | SpellDescription$ Channel.
SVar:STMana:Mode$ Continuous | EffectZone$ Command | AddAbility$ ABMana
SVar:ABMana:AB$ Mana | Cost$ PayLife<1> | Produced$ C
Oracle:Channel parse.
`,
    },
    players: [
      { life: 20, hand: ["Channel"], battlefield: [], manaPool: ["G", "G"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 433. Spell — Sylvan Library in hand.
  {
    id: "sylvan-library-in-hand",
    description: "Sylvan Library in hand; draw-3-pay-or-return parse.",
    seed: 0x1f8,
    cards: {
      "Sylvan Library": `Name:Sylvan Library
ManaCost:1 G
Types:Enchantment
T:Mode$ Phase | Phase$ Draw | ValidPlayer$ You | Execute$ TrigDraw | TriggerDescription$ Draw two extra.
SVar:TrigDraw:DB$ Draw | NumCards$ 2
Oracle:Sylvan Library parse.
`,
    },
    players: [
      { life: 20, hand: ["Sylvan Library"], battlefield: [], manaPool: ["G", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 434. Spell — Skullclamp in hand.
  {
    id: "skullclamp-in-hand",
    description: "Skullclamp in hand; cheap-equip + LTB-draw 2 parse.",
    seed: 0x1f9,
    cards: {
      Skullclamp: `Name:Skullclamp
ManaCost:1
Types:Artifact Equipment
K:Equip:1
S:Mode$ Continuous | Affected$ Creature.EquippedBy | AddPower$ 1 | AddToughness$ -1 | Description$ Pump.
T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Creature.EquippedBy | Execute$ TrigDraw | TriggerDescription$ Draw 2 on death.
SVar:TrigDraw:DB$ Draw | NumCards$ 2
Oracle:Skullclamp parse.
`,
    },
    players: [
      { life: 20, hand: ["Skullclamp"], battlefield: [], manaPool: ["C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 435. Spell — Umezawa's Jitte in hand.
  {
    id: "umezawas-jitte-in-hand",
    description: "Umezawa's Jitte in hand; equipment-counter triggered abilities parse.",
    seed: 0x1fa,
    cards: {
      "Umezawa's Jitte": `Name:Umezawa's Jitte
ManaCost:2
Types:Legendary Artifact Equipment
K:Equip:2
T:Mode$ DamageDoneOnce | ValidSource$ Creature.EquippedBy | CombatDamage$ True | Execute$ TrigCounter | TriggerDescription$ Charge counter.
SVar:TrigCounter:DB$ PutCounter | Defined$ Self | CounterType$ CHARGE | CounterNum$ 2
A:AB$ Pump | Cost$ SubCounter<1/CHARGE> | TargetType$ Card | ValidTgts$ Creature.EquippedBy | NumAtt$ 2 | NumDef$ 2 | SpellDescription$ Pump 2/2.
A:AB$ Pump | Cost$ SubCounter<1/CHARGE> | TargetType$ Card | ValidTgts$ Creature | NumAtt$ -1 | NumDef$ -1 | SpellDescription$ Shrink.
A:AB$ GainLife | Cost$ SubCounter<1/CHARGE> | LifeAmount$ 2 | SpellDescription$ Gain 2.
Oracle:Jitte parse.
`,
    },
    players: [
      { life: 20, hand: ["Umezawa's Jitte"], battlefield: [], manaPool: ["C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 436. Recursion — Sheoldred, the Apocalypse in hand.
  {
    id: "sheoldred-apocalypse-in-hand",
    description: "Sheoldred, the Apocalypse in hand; draw-life trigger parse.",
    seed: 0x1fb,
    cards: {
      "Sheoldred, the Apocalypse": `Name:Sheoldred, the Apocalypse
ManaCost:2 B B
Types:Legendary Creature Phyrexian Praetor
PT:4/5
K:Deathtouch
T:Mode$ Drawn | ValidPlayer$ You | Execute$ TrigGain | TriggerDescription$ Gain 2 on draw.
SVar:TrigGain:DB$ GainLife | LifeAmount$ 2
T:Mode$ Drawn | ValidPlayer$ Opponent | Execute$ TrigDmg | TriggerDescription$ Dmg 2 on opp draw.
SVar:TrigDmg:DB$ LoseLife | LifeAmount$ 2 | Defined$ TriggeredPlayer
Oracle:Sheoldred parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Sheoldred, the Apocalypse"],
        battlefield: [],
        manaPool: ["B", "B", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 437. Recursion — Atraxa, Praetors' Voice in hand.
  {
    id: "atraxa-praetors-voice-in-hand",
    description: "Atraxa, Praetors' Voice in hand; quad-keyword + proliferate parse.",
    seed: 0x1fc,
    cards: {
      "Atraxa, Praetors' Voice": `Name:Atraxa, Praetors' Voice
ManaCost:G W U B
Types:Legendary Creature Phyrexian Angel Horror
PT:4/4
K:Flying
K:Vigilance
K:Deathtouch
K:Lifelink
T:Mode$ Phase | Phase$ EndCombat | ValidPlayer$ You | Execute$ TrigProl | TriggerDescription$ Proliferate.
SVar:TrigProl:DB$ Draw | NumCards$ 0
Oracle:Atraxa parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Atraxa, Praetors' Voice"],
        battlefield: [],
        manaPool: ["G", "W", "U", "B"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 438. Tribal commander — Wilhelt, the Rotcleaver in hand.
  {
    id: "wilhelt-rotcleaver-in-hand",
    description: "Wilhelt, the Rotcleaver in hand; zombie sac-and-recur parse.",
    seed: 0x1fd,
    cards: {
      "Wilhelt, the Rotcleaver": `Name:Wilhelt, the Rotcleaver
ManaCost:1 U B
Types:Legendary Creature Zombie Soldier
PT:3/3
T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Zombie.YouCtrl | Execute$ TrigToken | TriggerDescription$ Zombie token on zombie death.
SVar:TrigToken:DB$ Token | TokenScript$ b_2_2_zombie | TokenAmount$ 1 | TokenTapped$ True
Oracle:Wilhelt parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Wilhelt, the Rotcleaver"],
        battlefield: [],
        manaPool: ["U", "B", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 439. Spell — Time Stretch in hand.
  {
    id: "time-stretch-in-hand",
    description: "Time Stretch in hand; double-extra-turn parse.",
    seed: 0x1fe,
    cards: {
      "Time Stretch": `Name:Time Stretch
ManaCost:8 U U
Types:Sorcery
A:SP$ AddTurn | Cost$ 8 U U | NumTurns$ 2 | SpellDescription$ Time Stretch.
Oracle:Time Stretch parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Time Stretch"],
        battlefield: [],
        manaPool: ["U", "U", "C", "C", "C", "C", "C", "C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 440. Spell — Capsize in hand (already covered as buyback). Use second variant — Beast Within.
  {
    id: "beast-within-in-hand",
    description: "Beast Within in hand; destroy + 3/3 token parse.",
    seed: 0x1ff,
    cards: {
      "Beast Within": `Name:Beast Within
ManaCost:2 G
Types:Instant
A:SP$ Destroy | Cost$ 2 G | TargetType$ Card | ValidTgts$ Permanent | SubAbility$ DBToken | SpellDescription$ Destroy and create 3/3.
SVar:DBToken:DB$ Token | TokenScript$ g_3_3_beast | TokenAmount$ 1 | TokenOwner$ TargetedController
Oracle:Beast Within parse.
`,
    },
    players: [
      { life: 20, hand: ["Beast Within"], battlefield: [], manaPool: ["G", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 441. Spell — Path to Exile in hand.
  {
    id: "path-to-exile-m611-in-hand",
    description: "Path to Exile in hand; exile-creature-and-basic-search parse.",
    seed: 0x200,
    cards: {
      "Path to Exile": `Name:Path to Exile
ManaCost:W
Types:Instant
A:SP$ ChangeZone | Cost$ W | Origin$ Battlefield | Destination$ Exile | TargetType$ Card | ValidTgts$ Creature | SubAbility$ DBSearch | SpellDescription$ Exile.
SVar:DBSearch:DB$ ChangeZone | Origin$ Library | Destination$ Battlefield | ChangeType$ Land.Basic | ChangeNum$ 1 | Tapped$ True | Defined$ TargetedController
Oracle:Path parse.
`,
    },
    players: [
      { life: 20, hand: ["Path to Exile"], battlefield: [], manaPool: ["W"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 442. Spell — Swords to Plowshares in hand.
  {
    id: "swords-to-plowshares-m611-in-hand",
    description: "Swords to Plowshares in hand; exile + lifegain parse.",
    seed: 0x201,
    cards: {
      "Swords to Plowshares": `Name:Swords to Plowshares
ManaCost:W
Types:Instant
A:SP$ ChangeZone | Cost$ W | Origin$ Battlefield | Destination$ Exile | TargetType$ Card | ValidTgts$ Creature | SubAbility$ DBLife | SpellDescription$ StP.
SVar:DBLife:DB$ GainLife | LifeAmount$ X | Defined$ TargetedController
SVar:X:TargetedCard$CardPower
Oracle:StP parse.
`,
    },
    players: [
      { life: 20, hand: ["Swords to Plowshares"], battlefield: [], manaPool: ["W"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 443. Spell — Doom Blade in hand.
  {
    id: "doom-blade-in-hand",
    description: "Doom Blade in hand; destroy nonblack parse.",
    seed: 0x202,
    cards: {
      "Doom Blade": `Name:Doom Blade
ManaCost:1 B
Types:Instant
A:SP$ Destroy | Cost$ 1 B | TargetType$ Card | ValidTgts$ Creature.nonBlack | SpellDescription$ Doom Blade.
Oracle:Doom Blade parse.
`,
    },
    players: [
      { life: 20, hand: ["Doom Blade"], battlefield: [], manaPool: ["B", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 444. Spell — Murder in hand.
  {
    id: "murder-in-hand",
    description: "Murder in hand; destroy creature parse.",
    seed: 0x203,
    cards: {
      Murder: `Name:Murder
ManaCost:1 B B
Types:Instant
A:SP$ Destroy | Cost$ 1 B B | TargetType$ Card | ValidTgts$ Creature | SpellDescription$ Murder.
Oracle:Murder parse.
`,
    },
    players: [
      { life: 20, hand: ["Murder"], battlefield: [], manaPool: ["B", "B", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 445. Spell — Go for the Throat in hand.
  {
    id: "go-for-the-throat-in-hand",
    description: "Go for the Throat in hand; destroy nonartifact parse.",
    seed: 0x204,
    cards: {
      "Go for the Throat": `Name:Go for the Throat
ManaCost:1 B
Types:Instant
A:SP$ Destroy | Cost$ 1 B | TargetType$ Card | ValidTgts$ Creature.nonArtifact | SpellDescription$ Throat.
Oracle:Go for the Throat parse.
`,
    },
    players: [
      { life: 20, hand: ["Go for the Throat"], battlefield: [], manaPool: ["B", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 446. Spell — Fatal Push in hand.
  {
    id: "fatal-push-m611-in-hand",
    description: "Fatal Push in hand; cmc<=2 destroy parse.",
    seed: 0x205,
    cards: {
      "Fatal Push": `Name:Fatal Push
ManaCost:B
Types:Instant
A:SP$ Destroy | Cost$ B | TargetType$ Card | ValidTgts$ Creature.cmcLE2 | SpellDescription$ Fatal Push.
Oracle:Fatal Push parse.
`,
    },
    players: [
      { life: 20, hand: ["Fatal Push"], battlefield: [], manaPool: ["B"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 447. Spell — Drown in the Loch in hand.
  {
    id: "drown-in-the-loch-in-hand",
    description: "Drown in the Loch in hand; mode-counter-or-destroy parse.",
    seed: 0x206,
    cards: {
      "Drown in the Loch": `Name:Drown in the Loch
ManaCost:U B
Types:Instant
A:SP$ Charm | Cost$ U B | Choices$ DBCounter,DBDestroy | SpellDescription$ Drown.
SVar:DBCounter:DB$ Counter | TargetType$ Spell | ValidTgts$ Card
SVar:DBDestroy:DB$ Destroy | TargetType$ Card | ValidTgts$ Creature
Oracle:Drown parse.
`,
    },
    players: [
      { life: 20, hand: ["Drown in the Loch"], battlefield: [], manaPool: ["U", "B"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 448. Spell — Snapcaster Mage in hand.
  {
    id: "snapcaster-mage-in-hand",
    description: "Snapcaster Mage in hand; ETB-flashback trigger parse.",
    seed: 0x207,
    cards: {
      "Snapcaster Mage": `Name:Snapcaster Mage
ManaCost:1 U
Types:Creature Human Wizard
PT:2/1
K:Flash
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigFlashback | TriggerDescription$ Grant flashback.
SVar:TrigFlashback:DB$ Effect | StaticAbilities$ STFlash
SVar:STFlash:Mode$ Continuous | EffectZone$ Command | AddKeyword$ Flashback | Affected$ Card.YouOwn+inGraveyard
Oracle:Snapcaster parse.
`,
    },
    players: [
      { life: 20, hand: ["Snapcaster Mage"], battlefield: [], manaPool: ["U", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 449. Spell — Wrenn and Six in hand.
  {
    id: "wrenn-and-six-in-hand",
    description: "Wrenn and Six in hand; planeswalker land-recur + retrace parse.",
    seed: 0x208,
    cards: {
      "Wrenn and Six": `Name:Wrenn and Six
ManaCost:R G
Types:Legendary Planeswalker Wrenn
Loyalty:3
A:AB$ ChangeZone | Cost$ AddCounter<1/LOYALTY> | Planeswalker$ True | Origin$ Graveyard | Destination$ Hand | ChangeType$ Land | SpellDescription$ +1.
A:AB$ DealDamage | Cost$ SubCounter<1/LOYALTY> | Planeswalker$ True | NumDmg$ 1 | ValidTgts$ Creature.nonFlying,Planeswalker | SpellDescription$ -1.
Oracle:Wrenn parse.
`,
    },
    players: [
      { life: 20, hand: ["Wrenn and Six"], battlefield: [], manaPool: ["R", "G"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 450. Spell — Tibalt's Trickery in hand.
  {
    id: "tibalts-trickery-in-hand",
    description: "Tibalt's Trickery in hand; counter-and-cascade parse.",
    seed: 0x209,
    cards: {
      "Tibalt's Trickery": `Name:Tibalt's Trickery
ManaCost:R
Types:Instant
A:SP$ Counter | Cost$ R | TargetType$ Spell | ValidTgts$ Card | SubAbility$ DBMill | SpellDescription$ Counter and cascade.
SVar:DBMill:DB$ Mill | NumCards$ 3 | Defined$ TargetedController
Oracle:Trickery parse.
`,
    },
    players: [
      { life: 20, hand: ["Tibalt's Trickery"], battlefield: [], manaPool: ["R"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 451. Spell — Cabal Therapy in hand.
  {
    id: "cabal-therapy-in-hand",
    description: "Cabal Therapy in hand; name-discard + flashback parse.",
    seed: 0x20a,
    cards: {
      "Cabal Therapy": `Name:Cabal Therapy
ManaCost:B
Types:Sorcery
A:SP$ Discard | Cost$ B | NumCards$ All | Mode$ NamedCard | ValidTgts$ Player | SpellDescription$ Therapy.
K:Flashback:Sac<1/Creature>
Oracle:Cabal Therapy parse.
`,
    },
    players: [
      { life: 20, hand: ["Cabal Therapy"], battlefield: [], manaPool: ["B"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 452. Spell — Lightning Helix in hand.
  {
    id: "lightning-helix-in-hand",
    description: "Lightning Helix in hand; burn-and-life parse.",
    seed: 0x20b,
    cards: {
      "Lightning Helix": `Name:Lightning Helix
ManaCost:R W
Types:Instant
A:SP$ DealDamage | Cost$ R W | NumDmg$ 3 | ValidTgts$ Any | SubAbility$ DBLife | SpellDescription$ Helix.
SVar:DBLife:DB$ GainLife | LifeAmount$ 3
Oracle:Lightning Helix parse.
`,
    },
    players: [
      { life: 20, hand: ["Lightning Helix"], battlefield: [], manaPool: ["R", "W"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // ── M6.12: 150 new scenarios across priority mechanic gaps ───────────────

  // 453. Saga — Phyrexian Scriptures in hand.
  {
    id: "phyrexian-scriptures-in-hand",
    description: "Phyrexian Scriptures in hand; saga chapter parse.",
    seed: 0x20c,
    cards: {
      "Phyrexian Scriptures": `Name:Phyrexian Scriptures
ManaCost:2 B
Types:Enchantment Saga
K:Chapter:3:DBCounter,DBDestroy,DBExile
SVar:DBCounter:DB$ PutCounter | CounterType$ M1M1 | CounterNum$ 1 | ValidTgts$ Creature
SVar:DBDestroy:DB$ DestroyAll | ValidCards$ Creature.nonArtifact
SVar:DBExile:DB$ ChangeZoneAll | ChangeType$ Creature.YouCtrl | Origin$ Graveyard | Destination$ Exile
Oracle:Phyrexian Scriptures saga parse.
`,
    },
    players: [
      { life: 20, hand: ["Phyrexian Scriptures"], battlefield: [], manaPool: ["B", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 454. Saga — The Mending of Dominaria in hand.
  {
    id: "mending-of-dominaria-in-hand",
    description: "The Mending of Dominaria in hand; saga 4-chapter parse.",
    seed: 0x20d,
    cards: {
      "The Mending of Dominaria": `Name:The Mending of Dominaria
ManaCost:3 G G
Types:Enchantment Saga
K:Chapter:3:DBMill,DBReturn,DBLastChapter
SVar:DBMill:DB$ Mill | NumCards$ 4
SVar:DBReturn:DB$ ChangeZone | Origin$ Graveyard | Destination$ Hand | TargetType$ Card | ValidTgts$ Creature.YouOwn
SVar:DBLastChapter:DB$ ChangeZoneAll | ChangeType$ Creature.YouOwn | Origin$ Graveyard | Destination$ Battlefield | SubAbility$ DBToken
SVar:DBToken:DB$ Token | TokenAmount$ 1 | TokenScript$ b_2_2_zombie
Oracle:Mending of Dominaria parse.
`,
    },
    players: [
      { life: 20, hand: ["The Mending of Dominaria"], battlefield: [], manaPool: ["G", "G", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 455. Saga — The Eldest Reborn in hand.
  {
    id: "eldest-reborn-in-hand",
    description: "The Eldest Reborn in hand; saga discard-destroy-recur parse.",
    seed: 0x20e,
    cards: {
      "The Eldest Reborn": `Name:The Eldest Reborn
ManaCost:4 B
Types:Enchantment Saga
K:Chapter:3:DBDiscard,DBSacrifice,DBReturn
SVar:DBDiscard:DB$ Discard | NumCards$ 1 | Mode$ TgtChoose | Defined$ Player.Opponent
SVar:DBSacrifice:DB$ Sacrifice | SacValid$ Creature,Planeswalker | Defined$ Player.Opponent
SVar:DBReturn:DB$ ChangeZone | Origin$ Graveyard | Destination$ Battlefield | TargetType$ Card | ValidTgts$ Creature
Oracle:Eldest Reborn parse.
`,
    },
    players: [
      { life: 20, hand: ["The Eldest Reborn"], battlefield: [], manaPool: ["B", "C", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 456. Suspend — Rift Bolt in hand.
  {
    id: "rift-bolt-suspend-in-hand",
    description: "Rift Bolt in hand; suspend 1 R parse.",
    seed: 0x20f,
    cards: {
      "Rift Bolt": `Name:Rift Bolt
ManaCost:2 R
Types:Sorcery
A:SP$ DealDamage | Cost$ 2 R | NumDmg$ 3 | ValidTgts$ Any | SpellDescription$ Bolt.
K:Suspend:1:R
Oracle:Rift Bolt parse.
`,
    },
    players: [
      { life: 20, hand: ["Rift Bolt"], battlefield: [], manaPool: ["R"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 457. Suspend — Search for Tomorrow in hand.
  {
    id: "search-for-tomorrow-suspend-in-hand",
    description: "Search for Tomorrow in hand; suspend 2 G parse.",
    seed: 0x210,
    cards: {
      "Search for Tomorrow": `Name:Search for Tomorrow
ManaCost:2 G
Types:Sorcery
A:SP$ ChangeZone | Cost$ 2 G | Origin$ Library | Destination$ Battlefield | ChangeType$ BasicLand | SpellDescription$ Search.
K:Suspend:2:G
Oracle:Search for Tomorrow parse.
`,
    },
    players: [
      { life: 20, hand: ["Search for Tomorrow"], battlefield: [], manaPool: ["G"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 458. Suspend — Ancestral Vision in hand.
  {
    id: "ancestral-vision-suspend-in-hand",
    description: "Ancestral Vision in hand; suspend 4 U parse.",
    seed: 0x211,
    cards: {
      "Ancestral Vision": `Name:Ancestral Vision
ManaCost:no cost
Types:Sorcery
A:SP$ Draw | Cost$ 0 | NumCards$ 4 | SpellDescription$ Vision.
K:Suspend:4:U
Oracle:Ancestral Vision parse.
`,
    },
    players: [
      { life: 20, hand: ["Ancestral Vision"], battlefield: [], manaPool: ["U"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 459. Class — Bard Class in hand.
  {
    id: "bard-class-in-hand",
    description: "Bard Class in hand; multi-level class parse.",
    seed: 0x212,
    cards: {
      "Bard Class": `Name:Bard Class
ManaCost:1 R G
Types:Enchantment Class Bard
K:ClassLevel:1:1 R G
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigToken | TriggerDescription$ ETB token.
SVar:TrigToken:DB$ Token | TokenAmount$ 1 | TokenScript$ rg_1_1_human_bard
K:ClassLevel:2:1 R G
S:Mode$ Continuous | Affected$ Creature.YouCtrl | AddPower$ 1 | AddToughness$ 1 | Description$ +1/+1.
K:ClassLevel:3:3 R G
T:Mode$ Phase | Phase$ EndOfTurn | ValidPlayer$ You | Execute$ TrigDamage | TriggerDescription$ Burn.
SVar:TrigDamage:DB$ DealDamage | NumDmg$ 2 | Defined$ Player.Opponent
Oracle:Bard Class parse.
`,
    },
    players: [
      { life: 20, hand: ["Bard Class"], battlefield: [], manaPool: ["R", "G", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 460. Class — Warlock Class in hand.
  {
    id: "warlock-class-in-hand",
    description: "Warlock Class in hand; level-up chain parse.",
    seed: 0x213,
    cards: {
      "Warlock Class": `Name:Warlock Class
ManaCost:1 B
Types:Enchantment Class Warlock
K:ClassLevel:1:1 B
R:Event$ Moved | ValidCard$ Card.YouOwn | Destination$ Graveyard | ReplaceWith$ DBLife | Description$ Drain.
SVar:DBLife:DB$ LoseLife | LifeAmount$ 1 | Defined$ Player.Opponent
K:ClassLevel:2:2 B B
T:Mode$ Phase | Phase$ EndOfTurn | ValidPlayer$ You | Execute$ TrigDrain | TriggerDescription$ Drain end of turn.
SVar:TrigDrain:DB$ LoseLife | LifeAmount$ 2 | Defined$ Player.Opponent
K:ClassLevel:3:3 B B
S:Mode$ Continuous | Affected$ You | LifeTotalAdjust$ 5 | Description$ +5 life.
Oracle:Warlock Class parse.
`,
    },
    players: [
      { life: 20, hand: ["Warlock Class"], battlefield: [], manaPool: ["B", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 461. Storm — Grapeshot in hand.
  {
    id: "grapeshot-storm-in-hand",
    description: "Grapeshot in hand; storm copy-on-cast parse.",
    seed: 0x214,
    cards: {
      Grapeshot: `Name:Grapeshot
ManaCost:1 R
Types:Sorcery
A:SP$ DealDamage | Cost$ 1 R | NumDmg$ 1 | ValidTgts$ Any | SpellDescription$ Grapeshot.
K:Storm
Oracle:Grapeshot parse.
`,
    },
    players: [
      { life: 20, hand: ["Grapeshot"], battlefield: [], manaPool: ["R", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 462. Storm — Tendrils of Agony in hand.
  {
    id: "tendrils-of-agony-in-hand-m612",
    description: "Tendrils of Agony in hand; storm drain parse.",
    seed: 0x215,
    cards: {
      "Tendrils of Agony": `Name:Tendrils of Agony
ManaCost:2 B B
Types:Sorcery
A:SP$ LoseLife | Cost$ 2 B B | LifeAmount$ 2 | Defined$ Player.Opponent | SubAbility$ DBLife | SpellDescription$ Tendrils.
SVar:DBLife:DB$ GainLife | LifeAmount$ 2
K:Storm
Oracle:Tendrils parse.
`,
    },
    players: [
      { life: 20, hand: ["Tendrils of Agony"], battlefield: [], manaPool: ["B", "B", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 463. Storm — Empty the Warrens in hand.
  {
    id: "empty-the-warrens-in-hand-m612",
    description: "Empty the Warrens in hand; storm goblin token parse.",
    seed: 0x216,
    cards: {
      "Empty the Warrens": `Name:Empty the Warrens
ManaCost:3 R
Types:Sorcery
A:SP$ Token | Cost$ 3 R | TokenAmount$ 2 | TokenScript$ r_1_1_goblin | SpellDescription$ Warrens.
K:Storm
Oracle:Empty the Warrens parse.
`,
    },
    players: [
      { life: 20, hand: ["Empty the Warrens"], battlefield: [], manaPool: ["R", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 464. Cipher — Hidden Strings in hand.
  {
    id: "hidden-strings-cipher-in-hand",
    description: "Hidden Strings in hand; cipher untap-twice parse.",
    seed: 0x217,
    cards: {
      "Hidden Strings": `Name:Hidden Strings
ManaCost:U U
Types:Sorcery
A:SP$ Untap | Cost$ U U | TargetType$ Card | ValidTgts$ Permanent | TgtPrompt$ Untap two | TargetMin$ 1 | TargetMax$ 2 | SpellDescription$ Strings.
K:Cipher
Oracle:Hidden Strings parse.
`,
    },
    players: [
      { life: 20, hand: ["Hidden Strings"], battlefield: [], manaPool: ["U", "U"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 465. Cipher — Whispering Madness in hand.
  {
    id: "whispering-madness-cipher-in-hand",
    description: "Whispering Madness in hand; cipher discard-and-draw parse.",
    seed: 0x218,
    cards: {
      "Whispering Madness": `Name:Whispering Madness
ManaCost:2 U B
Types:Sorcery
A:SP$ DiscardAll | Cost$ 2 U B | Defined$ Player | NumCards$ All | SubAbility$ DBDraw | SpellDescription$ Madness.
SVar:DBDraw:DB$ DrawAll | NumCards$ Hand
K:Cipher
Oracle:Whispering Madness parse.
`,
    },
    players: [
      { life: 20, hand: ["Whispering Madness"], battlefield: [], manaPool: ["U", "B", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 466. Cascade — Maelstrom Wanderer in hand.
  {
    id: "maelstrom-wanderer-cascade-in-hand",
    description: "Maelstrom Wanderer in hand; double cascade parse.",
    seed: 0x219,
    cards: {
      "Maelstrom Wanderer": `Name:Maelstrom Wanderer
ManaCost:5 U R G
Types:Legendary Creature Elemental
PT:7/5
K:Haste
K:Cascade
K:Cascade
S:Mode$ Continuous | Affected$ Creature.YouCtrl | AddKeyword$ Haste | Description$ Haste.
Oracle:Maelstrom Wanderer parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Maelstrom Wanderer"],
        battlefield: [],
        manaPool: ["U", "R", "G", "C", "C", "C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 467. Cascade — Shardless Agent in hand.
  {
    id: "shardless-agent-cascade-in-hand",
    description: "Shardless Agent in hand; cascade ETB creature parse.",
    seed: 0x21a,
    cards: {
      "Shardless Agent": `Name:Shardless Agent
ManaCost:G U
Types:Artifact Creature Human Rogue
PT:2/2
K:Cascade
Oracle:Shardless Agent parse.
`,
    },
    players: [
      { life: 20, hand: ["Shardless Agent"], battlefield: [], manaPool: ["G", "U"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 468. Cascade — Bituminous Blast in hand.
  {
    id: "bituminous-blast-cascade-in-hand",
    description: "Bituminous Blast in hand; cascade burn parse.",
    seed: 0x21b,
    cards: {
      "Bituminous Blast": `Name:Bituminous Blast
ManaCost:3 B R
Types:Instant
A:SP$ DealDamage | Cost$ 3 B R | NumDmg$ 4 | ValidTgts$ Creature | SpellDescription$ Blast.
K:Cascade
Oracle:Bituminous Blast parse.
`,
    },
    players: [
      { life: 20, hand: ["Bituminous Blast"], battlefield: [], manaPool: ["B", "R", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 469. Mutate — Brokkos, Apex of Forever in hand.
  {
    id: "brokkos-mutate-in-hand",
    description: "Brokkos in hand; mutate cost parse.",
    seed: 0x21c,
    cards: {
      "Brokkos, Apex of Forever": `Name:Brokkos, Apex of Forever
ManaCost:2 G U B
Types:Legendary Creature Elemental Beast
PT:6/6
K:Trample
K:Mutate:2 G/U U/B B/G
A:AB$ ChangeZone | Cost$ 1 G U B | Origin$ Graveyard | Destination$ Battlefield | Defined$ Self | SpellDescription$ Mutate from graveyard.
Oracle:Brokkos parse.
`,
    },
    players: [
      { life: 20, hand: ["Brokkos, Apex of Forever"], battlefield: [], manaPool: ["G", "U", "B", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 470. Mutate — Sea-Dasher Octopus in hand.
  {
    id: "sea-dasher-octopus-mutate-in-hand",
    description: "Sea-Dasher Octopus in hand; flash mutate parse.",
    seed: 0x21d,
    cards: {
      "Sea-Dasher Octopus": `Name:Sea-Dasher Octopus
ManaCost:1 U
Types:Creature Octopus
PT:1/1
K:Flash
K:Mutate:G U
T:Mode$ DamageDoneOnce | ValidSource$ Card.Self | ValidTarget$ Player | Execute$ TrigDraw | CombatDamage$ True | TriggerDescription$ Draw on combat damage.
SVar:TrigDraw:DB$ Draw | NumCards$ 1
Oracle:Sea-Dasher Octopus parse.
`,
    },
    players: [
      { life: 20, hand: ["Sea-Dasher Octopus"], battlefield: [], manaPool: ["U", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 471. Battle — Invasion of Tarkir in hand.
  {
    id: "invasion-of-tarkir-in-hand",
    description: "Invasion of Tarkir in hand; battle siege parse.",
    seed: 0x21e,
    cards: {
      "Invasion of Tarkir": `Name:Invasion of Tarkir
ManaCost:5 R R
Types:Battle Siege
Defense:5
A:SP$ DealDamage | Cost$ 5 R R | NumDmg$ 4 | ValidTgts$ Any | TargetMin$ 1 | TargetMax$ 3 | DivideOnResolution$ True | SpellDescription$ Tarkir.
Oracle:Invasion of Tarkir parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Invasion of Tarkir"],
        battlefield: [],
        manaPool: ["R", "R", "C", "C", "C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 472. Battle — Invasion of Ikoria in hand.
  {
    id: "invasion-of-ikoria-in-hand-m612",
    description: "Invasion of Ikoria in hand; battle search parse.",
    seed: 0x21f,
    cards: {
      "Invasion of Ikoria": `Name:Invasion of Ikoria
ManaCost:1 G
Types:Battle Siege
Defense:3
A:SP$ ChangeZone | Cost$ 1 G | Origin$ Library | Destination$ Battlefield | ChangeType$ Creature.cmcLE2 | SpellDescription$ Ikoria.
Oracle:Invasion of Ikoria parse.
`,
    },
    players: [
      { life: 20, hand: ["Invasion of Ikoria"], battlefield: [], manaPool: ["G", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 473. Werewolf — Reckless Waif in hand.
  {
    id: "reckless-waif-in-hand",
    description: "Reckless Waif in hand; werewolf day-night parse.",
    seed: 0x220,
    cards: {
      "Reckless Waif": `Name:Reckless Waif
ManaCost:R
Types:Creature Human Werewolf
PT:1/1
K:Daybound
Oracle:Reckless Waif parse.
`,
    },
    players: [
      { life: 20, hand: ["Reckless Waif"], battlefield: [], manaPool: ["R"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 474. Werewolf — Tovolar's Huntmaster in hand.
  {
    id: "tovolars-huntmaster-in-hand",
    description: "Tovolar's Huntmaster in hand; nightbound werewolf parse.",
    seed: 0x221,
    cards: {
      "Tovolar's Huntmaster": `Name:Tovolar's Huntmaster
ManaCost:5 G G
Types:Creature Werewolf
PT:6/6
K:Nightbound
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigToken | TriggerDescription$ Two wolves on ETB.
SVar:TrigToken:DB$ Token | TokenAmount$ 2 | TokenScript$ g_2_2_wolf
T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | Execute$ TrigUpkeep | TriggerDescription$ Wolf each upkeep.
SVar:TrigUpkeep:DB$ Token | TokenAmount$ 1 | TokenScript$ g_2_2_wolf
Oracle:Tovolar's Huntmaster parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Tovolar's Huntmaster"],
        battlefield: [],
        manaPool: ["G", "G", "C", "C", "C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 475. Investigate — Tireless Tracker (variant) in hand.
  {
    id: "tireless-tracker-investigate-in-hand",
    description: "Tireless Tracker in hand; investigate trigger parse.",
    seed: 0x222,
    cards: {
      "Tireless Tracker M612": `Name:Tireless Tracker M612
ManaCost:2 G
Types:Creature Human Scout
PT:3/2
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Land.YouCtrl | Execute$ TrigInvestigate | TriggerDescription$ Investigate on land ETB.
SVar:TrigInvestigate:DB$ Investigate
Oracle:Tireless Tracker M612 parse.
`,
    },
    players: [
      { life: 20, hand: ["Tireless Tracker M612"], battlefield: [], manaPool: ["G", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 476. Treasure — Dockside Extortionist in hand.
  {
    id: "dockside-extortionist-in-hand",
    description: "Dockside Extortionist in hand; treasure ETB parse.",
    seed: 0x223,
    cards: {
      "Dockside Extortionist": `Name:Dockside Extortionist
ManaCost:1 R
Types:Creature Goblin Pirate
PT:1/2
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigToken | TriggerDescription$ Treasure tokens equal to opp artifacts.
SVar:TrigToken:DB$ Token | TokenAmount$ X | TokenScript$ c_a_treasure_sac
SVar:X:Count$ValidPermanent.OppCtrl+Artifact
Oracle:Dockside Extortionist parse.
`,
    },
    players: [
      { life: 20, hand: ["Dockside Extortionist"], battlefield: [], manaPool: ["R", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 477. Food — Gilded Goose in hand.
  {
    id: "gilded-goose-food-in-hand",
    description: "Gilded Goose in hand; food token parse.",
    seed: 0x224,
    cards: {
      "Gilded Goose": `Name:Gilded Goose
ManaCost:G
Types:Creature Bird
PT:0/2
K:Flying
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigFood | TriggerDescription$ Food on ETB.
SVar:TrigFood:DB$ Token | TokenAmount$ 1 | TokenScript$ c_a_food_sac
A:AB$ Mana | Cost$ T | Produced$ Any | ActivationLimit$ 1 | SpellDescription$ Add any.
Oracle:Gilded Goose parse.
`,
    },
    players: [
      { life: 20, hand: ["Gilded Goose"], battlefield: [], manaPool: ["G"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 478. Energy — Aetherworks Marvel in hand.
  {
    id: "aetherworks-marvel-in-hand-m612",
    description: "Aetherworks Marvel in hand; energy counters parse.",
    seed: 0x225,
    cards: {
      "Aetherworks Marvel": `Name:Aetherworks Marvel
ManaCost:4
Types:Legendary Artifact
T:Mode$ ChangesZone | Origin$ Any | Destination$ Graveyard | ValidCard$ Permanent.YouCtrl+Other | Execute$ TrigEnergy | TriggerDescription$ Energy on permanent dies.
SVar:TrigEnergy:DB$ PutCounter | CounterType$ ENERGY | CounterNum$ 1 | Defined$ You
A:AB$ Dig | Cost$ T PayCounter<6/ENERGY> | DigNum$ 6 | ChangeNum$ 1 | DestinationZone$ Battlefield | SpellDescription$ Marvel.
Oracle:Aetherworks Marvel parse.
`,
    },
    players: [
      { life: 20, hand: ["Aetherworks Marvel"], battlefield: [], manaPool: ["C", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 479. Plot — The Sweep of Seasons in hand.
  {
    id: "sweep-of-seasons-plot-in-hand",
    description: "The Sweep of Seasons in hand; plot two-turn parse.",
    seed: 0x226,
    cards: {
      "The Sweep of Seasons": `Name:The Sweep of Seasons
ManaCost:3 G
Types:Sorcery
A:SP$ Token | Cost$ 3 G | TokenAmount$ 3 | TokenScript$ g_2_2_wolf | SpellDescription$ Sweep.
K:Plot:1 G
Oracle:Sweep of Seasons parse.
`,
    },
    players: [
      { life: 20, hand: ["The Sweep of Seasons"], battlefield: [], manaPool: ["G", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 480. Plot — Outcaster Trailblazer in hand.
  {
    id: "outcaster-trailblazer-plot-in-hand",
    description: "Outcaster Trailblazer in hand; plot creature parse.",
    seed: 0x227,
    cards: {
      "Outcaster Trailblazer": `Name:Outcaster Trailblazer
ManaCost:2 G
Types:Creature Centaur Scout
PT:3/3
K:Plot:1 G
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDraw | TriggerDescription$ Draw on ETB.
SVar:TrigDraw:DB$ Draw | NumCards$ 1
Oracle:Outcaster Trailblazer parse.
`,
    },
    players: [
      { life: 20, hand: ["Outcaster Trailblazer"], battlefield: [], manaPool: ["G", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 481. Adventure — Murderous Rider in hand.
  {
    id: "murderous-rider-adventure-in-hand",
    description: "Murderous Rider in hand; adventure half parse.",
    seed: 0x228,
    cards: {
      "Murderous Rider": `Name:Murderous Rider
ManaCost:1 B B
Types:Creature Zombie Knight
PT:2/3
K:Lifelink
AlternateMode:Adventure
Oracle:Murderous Rider parse.

ALTERNATE

Name:Swift End
ManaCost:1 B B
Types:Instant Adventure
A:SP$ Destroy | Cost$ 1 B B | TargetType$ Card | ValidTgts$ Creature,Planeswalker | SubAbility$ DBLife | SpellDescription$ End.
SVar:DBLife:DB$ LoseLife | LifeAmount$ 2
Oracle:Swift End parse.
`,
    },
    players: [
      { life: 20, hand: ["Murderous Rider"], battlefield: [], manaPool: ["B", "B", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 482. Adventure — Brazen Borrower in hand.
  {
    id: "brazen-borrower-adventure-in-hand",
    description: "Brazen Borrower in hand; flash creature adventure parse.",
    seed: 0x229,
    cards: {
      "Brazen Borrower": `Name:Brazen Borrower
ManaCost:1 U U
Types:Creature Faerie Rogue
PT:3/1
K:Flash
K:Flying
AlternateMode:Adventure
Oracle:Brazen Borrower parse.

ALTERNATE

Name:Petty Theft
ManaCost:1 U
Types:Instant Adventure
A:SP$ ChangeZone | Cost$ 1 U | Origin$ Battlefield | Destination$ Hand | TargetType$ Card | ValidTgts$ Permanent.nonLand+OppCtrl | SpellDescription$ Theft.
Oracle:Petty Theft parse.
`,
    },
    players: [
      { life: 20, hand: ["Brazen Borrower"], battlefield: [], manaPool: ["U", "U", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 483. Banding — Sun Quan, Lord of Wu in hand.
  {
    id: "sun-quan-lord-of-wu-in-hand",
    description: "Sun Quan, Lord of Wu in hand; banding grant parse.",
    seed: 0x22a,
    cards: {
      "Sun Quan, Lord of Wu": `Name:Sun Quan, Lord of Wu
ManaCost:3 U U
Types:Legendary Creature Human Soldier
PT:3/4
S:Mode$ Continuous | Affected$ Creature.YouCtrl | AddKeyword$ Islandwalk | Description$ Islandwalk.
K:Banding
Oracle:Sun Quan parse.
`,
    },
    players: [
      { life: 20, hand: ["Sun Quan, Lord of Wu"], battlefield: [], manaPool: ["U", "U", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 484. Banding — Mesa Pegasus in hand.
  {
    id: "mesa-pegasus-banding-in-hand",
    description: "Mesa Pegasus in hand; banding small flier parse.",
    seed: 0x22b,
    cards: {
      "Mesa Pegasus": `Name:Mesa Pegasus
ManaCost:1 W
Types:Creature Pegasus
PT:1/1
K:Flying
K:Banding
Oracle:Mesa Pegasus parse.
`,
    },
    players: [
      { life: 20, hand: ["Mesa Pegasus"], battlefield: [], manaPool: ["W", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 485. Bestow — Hopeful Eidolon in hand.
  {
    id: "hopeful-eidolon-bestow-in-hand",
    description: "Hopeful Eidolon in hand; bestow aura/creature parse.",
    seed: 0x22c,
    cards: {
      "Hopeful Eidolon": `Name:Hopeful Eidolon
ManaCost:W
Types:Enchantment Creature Spirit
PT:1/1
K:Lifelink
K:Bestow:3 W
S:Mode$ Continuous | Affected$ Creature.AttachedBy | AddPower$ 1 | AddToughness$ 1 | AddKeyword$ Lifelink | Description$ Bestow grants.
Oracle:Hopeful Eidolon parse.
`,
    },
    players: [
      { life: 20, hand: ["Hopeful Eidolon"], battlefield: [], manaPool: ["W"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 486. Bestow — Boon Satyr in hand.
  {
    id: "boon-satyr-bestow-in-hand",
    description: "Boon Satyr in hand; flash bestow parse.",
    seed: 0x22d,
    cards: {
      "Boon Satyr": `Name:Boon Satyr
ManaCost:1 G G
Types:Enchantment Creature Satyr
PT:4/2
K:Flash
K:Bestow:1 G G G
S:Mode$ Continuous | Affected$ Creature.AttachedBy | AddPower$ 4 | AddToughness$ 2 | Description$ +4/+2.
Oracle:Boon Satyr parse.
`,
    },
    players: [
      { life: 20, hand: ["Boon Satyr"], battlefield: [], manaPool: ["G", "G", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 487. Soulbond — Wingcrafter in hand.
  {
    id: "wingcrafter-soulbond-in-hand",
    description: "Wingcrafter in hand; soulbond grant flying parse.",
    seed: 0x22e,
    cards: {
      Wingcrafter: `Name:Wingcrafter
ManaCost:U
Types:Creature Human Wizard
PT:1/1
K:Soulbond
S:Mode$ Continuous | Affected$ Creature.PairedWith Card.Self | AddKeyword$ Flying | Description$ Pair grants flying.
Oracle:Wingcrafter parse.
`,
    },
    players: [
      { life: 20, hand: ["Wingcrafter"], battlefield: [], manaPool: ["U"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 488. Soulbond — Silverblade Paladin in hand.
  {
    id: "silverblade-paladin-soulbond-in-hand",
    description: "Silverblade Paladin in hand; soulbond grant double strike parse.",
    seed: 0x22f,
    cards: {
      "Silverblade Paladin": `Name:Silverblade Paladin
ManaCost:1 W W
Types:Creature Human Knight
PT:2/2
K:Double Strike
K:Soulbond
S:Mode$ Continuous | Affected$ Creature.PairedWith Card.Self | AddKeyword$ Double Strike | Description$ Pair grants ds.
Oracle:Silverblade Paladin parse.
`,
    },
    players: [
      { life: 20, hand: ["Silverblade Paladin"], battlefield: [], manaPool: ["W", "W", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 489. Persist — Murderous Redcap in hand.
  {
    id: "murderous-redcap-persist-in-hand",
    description: "Murderous Redcap in hand; persist ETB damage parse.",
    seed: 0x230,
    cards: {
      "Murderous Redcap": `Name:Murderous Redcap
ManaCost:2 B R
Types:Creature Goblin Assassin
PT:2/2
K:Persist
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDmg | TriggerDescription$ ETB damage.
SVar:TrigDmg:DB$ DealDamage | NumDmg$ 2 | ValidTgts$ Any
Oracle:Murderous Redcap parse.
`,
    },
    players: [
      { life: 20, hand: ["Murderous Redcap"], battlefield: [], manaPool: ["B", "R", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 490. Undying — Strangleroot Geist (variant) in hand.
  {
    id: "strangleroot-geist-m612-in-hand",
    description: "Strangleroot Geist M612 in hand; undying haste parse.",
    seed: 0x231,
    cards: {
      "Strangleroot Geist M612": `Name:Strangleroot Geist M612
ManaCost:G G
Types:Creature Spirit
PT:2/1
K:Haste
K:Undying
Oracle:Strangleroot Geist M612 parse.
`,
    },
    players: [
      { life: 20, hand: ["Strangleroot Geist M612"], battlefield: [], manaPool: ["G", "G"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 491. Embalm — Anointed Procession beneficiary in hand.
  {
    id: "angel-of-sanctions-embalm-in-hand",
    description: "Angel of Sanctions in hand; embalm exile parse.",
    seed: 0x232,
    cards: {
      "Angel of Sanctions": `Name:Angel of Sanctions
ManaCost:3 W W
Types:Creature Angel
PT:3/4
K:Flying
K:Embalm:5 W W
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigExile | TriggerDescription$ Exile target.
SVar:TrigExile:DB$ ChangeZone | Origin$ Battlefield | Destination$ Exile | TargetType$ Card | ValidTgts$ Permanent.nonLand+OppCtrl
Oracle:Angel of Sanctions parse.
`,
    },
    players: [
      { life: 20, hand: ["Angel of Sanctions"], battlefield: [], manaPool: ["W", "W", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 492. Eternalize — God-Pharaoh's Gift in hand.
  {
    id: "god-pharaohs-gift-in-hand",
    description: "God-Pharaoh's Gift in hand; eternalize-on-trigger parse.",
    seed: 0x233,
    cards: {
      "God-Pharaoh's Gift": `Name:God-Pharaoh's Gift
ManaCost:7
Types:Artifact
T:Mode$ Phase | Phase$ EndOfTurn | ValidPlayer$ You | Execute$ TrigChange | TriggerDescription$ Return + zombify.
SVar:TrigChange:DB$ ChangeZone | Origin$ Graveyard | Destination$ Battlefield | TargetType$ Card | ValidTgts$ Creature.YouOwn | RememberChanged$ True | SubAbility$ DBPump
SVar:DBPump:DB$ Animate | Defined$ Remembered | Power$ 4 | Toughness$ 4 | Types$ Zombie
Oracle:God-Pharaoh's Gift parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["God-Pharaoh's Gift"],
        battlefield: [],
        manaPool: ["C", "C", "C", "C", "C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 493. Splice — Goryo's Vengeance in hand.
  {
    id: "goryos-vengeance-splice-in-hand",
    description: "Goryo's Vengeance in hand; splice arcane parse.",
    seed: 0x234,
    cards: {
      "Goryo's Vengeance": `Name:Goryo's Vengeance
ManaCost:1 B
Types:Instant Arcane
A:SP$ ChangeZone | Cost$ 1 B | Origin$ Graveyard | Destination$ Battlefield | TargetType$ Card | ValidTgts$ Creature.Legendary | SpellDescription$ Goryo.
K:Splice:Arcane:1 B
Oracle:Goryo's Vengeance parse.
`,
    },
    players: [
      { life: 20, hand: ["Goryo's Vengeance"], battlefield: [], manaPool: ["B", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 494. Outlast — Ainok Bond-Kin in hand.
  {
    id: "ainok-bond-kin-outlast-in-hand",
    description: "Ainok Bond-Kin in hand; outlast +1/+1 parse.",
    seed: 0x235,
    cards: {
      "Ainok Bond-Kin": `Name:Ainok Bond-Kin
ManaCost:1 W
Types:Creature Hound Soldier
PT:2/2
K:Outlast:W
S:Mode$ Continuous | Affected$ Creature.YouCtrl+counters_GE1_P1P1 | AddKeyword$ First Strike | Description$ FS for +1/+1 creatures.
Oracle:Ainok Bond-Kin parse.
`,
    },
    players: [
      { life: 20, hand: ["Ainok Bond-Kin"], battlefield: [], manaPool: ["W", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 495. Mentor — Aven Mindcensor (variant) in hand.
  {
    id: "tajic-blade-of-the-legion-mentor-in-hand",
    description: "Tajic, Blade of the Legion in hand; mentor parse.",
    seed: 0x236,
    cards: {
      "Tajic, Blade of the Legion": `Name:Tajic, Blade of the Legion
ManaCost:2 R W
Types:Legendary Creature Human Soldier
PT:3/3
K:Mentor
K:Haste
Oracle:Tajic parse.
`,
    },
    players: [
      { life: 20, hand: ["Tajic, Blade of the Legion"], battlefield: [], manaPool: ["R", "W", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 496. Provoke — Krosan Vorine in hand.
  {
    id: "krosan-vorine-provoke-in-hand",
    description: "Krosan Vorine in hand; provoke parse.",
    seed: 0x237,
    cards: {
      "Krosan Vorine": `Name:Krosan Vorine
ManaCost:3 G
Types:Creature Cat Beast
PT:2/2
K:Provoke
K:First Strike
Oracle:Krosan Vorine parse.
`,
    },
    players: [
      { life: 20, hand: ["Krosan Vorine"], battlefield: [], manaPool: ["G", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 497. Strive — Aurelia's Fury in hand.
  {
    id: "aurelias-fury-strive-in-hand",
    description: "Aurelia's Fury in hand; strive multi-target X parse.",
    seed: 0x238,
    cards: {
      "Aurelia's Fury": `Name:Aurelia's Fury
ManaCost:X R W
Types:Instant
A:SP$ DealDamage | Cost$ X R W | NumDmg$ X | TargetMin$ 1 | TargetMax$ 99 | ValidTgts$ Creature,Player | SpellDescription$ Fury.
SVar:X:Count$xPaid
K:Strive:1
Oracle:Aurelia's Fury parse.
`,
    },
    players: [
      { life: 20, hand: ["Aurelia's Fury"], battlefield: [], manaPool: ["R", "W", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 498. Strive — Phytoburst in hand.
  {
    id: "phytoburst-strive-in-hand",
    description: "Phytoburst in hand; strive pump parse.",
    seed: 0x239,
    cards: {
      Phytoburst: `Name:Phytoburst
ManaCost:G
Types:Instant
A:SP$ Pump | Cost$ G | NumAtt$ 5 | NumDef$ 5 | TargetType$ Card | ValidTgts$ Creature | TargetMin$ 1 | TargetMax$ 99 | SpellDescription$ Phytoburst.
K:Strive:2 G
Oracle:Phytoburst parse.
`,
    },
    players: [
      { life: 20, hand: ["Phytoburst"], battlefield: [], manaPool: ["G", "G", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 499. Channel — Boseiju, Who Endures in hand.
  {
    id: "boseiju-who-endures-channel-in-hand",
    description: "Boseiju, Who Endures in hand; channel destroy parse.",
    seed: 0x23a,
    cards: {
      "Boseiju, Who Endures": `Name:Boseiju, Who Endures
ManaCost:no cost
Types:Legendary Land
A:AB$ Mana | Cost$ T | Produced$ G | SpellDescription$ Add G.
A:AB$ Destroy | Cost$ 1 G ChannelDiscard | TargetType$ Card | ValidTgts$ Land,Artifact,Enchantment.nonLegendary | SpellDescription$ Channel.
K:Channel
Oracle:Boseiju parse.
`,
    },
    players: [
      { life: 20, hand: ["Boseiju, Who Endures"], battlefield: [], manaPool: ["G", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 500. Channel — Otawara, Soaring City in hand.
  {
    id: "otawara-soaring-city-channel-in-hand",
    description: "Otawara, Soaring City in hand; channel bounce parse.",
    seed: 0x23b,
    cards: {
      "Otawara, Soaring City": `Name:Otawara, Soaring City
ManaCost:no cost
Types:Legendary Land
A:AB$ Mana | Cost$ T | Produced$ U | SpellDescription$ Add U.
A:AB$ ChangeZone | Cost$ 2 U ChannelDiscard | Origin$ Battlefield | Destination$ Hand | TargetType$ Card | ValidTgts$ Permanent.nonLand | SpellDescription$ Channel.
K:Channel
Oracle:Otawara parse.
`,
    },
    players: [
      { life: 20, hand: ["Otawara, Soaring City"], battlefield: [], manaPool: ["U", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 501. Replicate — Repeal in hand.
  {
    id: "repeal-replicate-in-hand",
    description: "Repeal in hand; replicate bounce parse.",
    seed: 0x23c,
    cards: {
      Repeal: `Name:Repeal
ManaCost:X U
Types:Instant
A:SP$ ChangeZone | Cost$ X U | Origin$ Battlefield | Destination$ Hand | TargetType$ Card | ValidTgts$ Permanent.nonLand+cmcLEX | SubAbility$ DBDraw | SpellDescription$ Repeal.
SVar:DBDraw:DB$ Draw | NumCards$ 1
K:Replicate:X U
Oracle:Repeal parse.
`,
    },
    players: [
      { life: 20, hand: ["Repeal"], battlefield: [], manaPool: ["U", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 502. Ninjutsu — Ingenious Infiltrator in hand.
  {
    id: "ingenious-infiltrator-ninjutsu-in-hand",
    description: "Ingenious Infiltrator in hand; ninjutsu reveal-swap parse.",
    seed: 0x23d,
    cards: {
      "Ingenious Infiltrator": `Name:Ingenious Infiltrator
ManaCost:1 U B
Types:Creature Human Ninja
PT:2/3
K:Ninjutsu:1 U B
T:Mode$ DamageDoneOnce | ValidSource$ Ninja.YouCtrl | ValidTarget$ Player | CombatDamage$ True | Execute$ TrigDraw | TriggerDescription$ Ninja damage draw.
SVar:TrigDraw:DB$ Draw | NumCards$ 1
Oracle:Ingenious Infiltrator parse.
`,
    },
    players: [
      { life: 20, hand: ["Ingenious Infiltrator"], battlefield: [], manaPool: ["U", "B", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 503. Hideaway — Mosswort Bridge in hand.
  {
    id: "mosswort-bridge-hideaway-in-hand",
    description: "Mosswort Bridge in hand; hideaway exile-conditional parse.",
    seed: 0x23e,
    cards: {
      "Mosswort Bridge": `Name:Mosswort Bridge
ManaCost:no cost
Types:Land
K:CARDNAME enters tapped.
K:Hideaway
A:AB$ Mana | Cost$ T | Produced$ G | SpellDescription$ Add G.
A:AB$ Effect | Cost$ G T | ConditionPresent$ Creature.YouCtrl+powerGE10 | StaticAbilities$ HiddenCast | SpellDescription$ Cast hidden.
SVar:HiddenCast:Mode$ Continuous | EffectZone$ Command | AddPlayUntil$ ExiledMosswort | Description$ Cast.
Oracle:Mosswort Bridge parse.
`,
    },
    players: [
      { life: 20, hand: ["Mosswort Bridge"], battlefield: [], manaPool: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 504. Sunburst — Etched Oracle in hand.
  {
    id: "etched-oracle-sunburst-in-hand",
    description: "Etched Oracle in hand; sunburst counters parse.",
    seed: 0x23f,
    cards: {
      "Etched Oracle": `Name:Etched Oracle
ManaCost:4
Types:Artifact Creature Human Wizard
PT:0/0
K:Sunburst
A:AB$ Draw | Cost$ 1 SubCounter<3/P1P1> T | NumCards$ 3 | SpellDescription$ Draw three.
Oracle:Etched Oracle parse.
`,
    },
    players: [
      { life: 20, hand: ["Etched Oracle"], battlefield: [], manaPool: ["W", "U", "B", "R"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 505. Wither — Boggart Ram-Gang in hand.
  {
    id: "boggart-ram-gang-wither-in-hand",
    description: "Boggart Ram-Gang in hand; wither parse.",
    seed: 0x240,
    cards: {
      "Boggart Ram-Gang": `Name:Boggart Ram-Gang
ManaCost:R/G R/G R/G
Types:Creature Goblin
PT:3/3
K:Haste
K:Wither
Oracle:Boggart Ram-Gang parse.
`,
    },
    players: [
      { life: 20, hand: ["Boggart Ram-Gang"], battlefield: [], manaPool: ["R", "G", "G"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 506. Infect — Glistener Elf in hand.
  {
    id: "glistener-elf-infect-in-hand",
    description: "Glistener Elf in hand; infect 1/1 parse.",
    seed: 0x241,
    cards: {
      "Glistener Elf": `Name:Glistener Elf
ManaCost:G
Types:Creature Elf Warrior
PT:1/1
K:Infect
Oracle:Glistener Elf parse.
`,
    },
    players: [
      { life: 20, hand: ["Glistener Elf"], battlefield: [], manaPool: ["G"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 507. Infect — Plague Stinger in hand.
  {
    id: "plague-stinger-infect-in-hand",
    description: "Plague Stinger in hand; flying infect parse.",
    seed: 0x242,
    cards: {
      "Plague Stinger": `Name:Plague Stinger
ManaCost:1 B
Types:Creature Insect
PT:1/1
K:Flying
K:Infect
Oracle:Plague Stinger parse.
`,
    },
    players: [
      { life: 20, hand: ["Plague Stinger"], battlefield: [], manaPool: ["B", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 508. Conspire — Wort, the Raidmother in hand.
  {
    id: "wort-the-raidmother-conspire-in-hand",
    description: "Wort, the Raidmother in hand; conspire-grant parse.",
    seed: 0x243,
    cards: {
      "Wort, the Raidmother": `Name:Wort, the Raidmother
ManaCost:3 R/G R/G
Types:Legendary Creature Goblin Shaman
PT:3/3
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigToken | TriggerDescription$ Two goblin tokens.
SVar:TrigToken:DB$ Token | TokenAmount$ 2 | TokenScript$ r_1_1_goblin_warrior
S:Mode$ Continuous | Affected$ Sorcery.YouOwn+inZoneStack | AddKeyword$ Conspire | Description$ Sorceries get conspire.
Oracle:Wort parse.
`,
    },
    players: [
      { life: 20, hand: ["Wort, the Raidmother"], battlefield: [], manaPool: ["R", "G", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 509. Convoke — Chord of Calling in hand.
  {
    id: "chord-of-calling-convoke-in-hand",
    description: "Chord of Calling in hand; convoke instant tutor parse.",
    seed: 0x244,
    cards: {
      "Chord of Calling": `Name:Chord of Calling
ManaCost:X G G G
Types:Instant
A:SP$ ChangeZone | Cost$ X G G G | Origin$ Library | Destination$ Battlefield | ChangeType$ Creature.cmcLEX | SpellDescription$ Chord.
K:Convoke
Oracle:Chord of Calling parse.
`,
    },
    players: [
      { life: 20, hand: ["Chord of Calling"], battlefield: [], manaPool: ["G", "G", "G", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 510. Improvise — Reverse Engineer in hand.
  {
    id: "reverse-engineer-improvise-in-hand",
    description: "Reverse Engineer in hand; improvise draw parse.",
    seed: 0x245,
    cards: {
      "Reverse Engineer": `Name:Reverse Engineer
ManaCost:3 U U
Types:Sorcery
A:SP$ Draw | Cost$ 3 U U | NumCards$ 3 | SpellDescription$ Engineer.
K:Improvise
Oracle:Reverse Engineer parse.
`,
    },
    players: [
      { life: 20, hand: ["Reverse Engineer"], battlefield: [], manaPool: ["U", "U", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 511. Surveil — Disinformation Campaign in hand.
  {
    id: "disinformation-campaign-surveil-in-hand",
    description: "Disinformation Campaign in hand; surveil ETB parse.",
    seed: 0x246,
    cards: {
      "Disinformation Campaign": `Name:Disinformation Campaign
ManaCost:1 U B
Types:Enchantment
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigSurveil | TriggerDescription$ Surveil 2 ETB.
SVar:TrigSurveil:DB$ Surveil | Amount$ 2 | SubAbility$ DBDiscard
SVar:DBDiscard:DB$ Discard | NumCards$ 1 | Defined$ Player.Opponent
Oracle:Disinformation Campaign parse.
`,
    },
    players: [
      { life: 20, hand: ["Disinformation Campaign"], battlefield: [], manaPool: ["U", "B", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 512. Connive — Tenured Inkcaster in hand.
  {
    id: "tenured-inkcaster-connive-in-hand",
    description: "Tenured Inkcaster in hand; connive ETB parse.",
    seed: 0x247,
    cards: {
      "Tenured Inkcaster": `Name:Tenured Inkcaster
ManaCost:2 B
Types:Creature Human Wizard
PT:2/3
T:Mode$ DamageDoneOnce | ValidSource$ Card.Self | ValidTarget$ Player | CombatDamage$ True | Execute$ TrigConnive | TriggerDescription$ Connive on combat damage.
SVar:TrigConnive:DB$ Connive | Amount$ 1
Oracle:Tenured Inkcaster parse.
`,
    },
    players: [
      { life: 20, hand: ["Tenured Inkcaster"], battlefield: [], manaPool: ["B", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 513. Ascend — Storm the Vault in hand.
  {
    id: "storm-the-vault-ascend-in-hand",
    description: "Storm the Vault in hand; ascend transform parse.",
    seed: 0x248,
    cards: {
      "Storm the Vault": `Name:Storm the Vault
ManaCost:3 U R
Types:Enchantment
K:Ascend
T:Mode$ DamageDoneOnce | ValidSource$ Creature.YouCtrl | ValidTarget$ Player | CombatDamage$ True | Execute$ TrigTreasure | TriggerDescription$ Treasure on combat damage.
SVar:TrigTreasure:DB$ Token | TokenAmount$ 1 | TokenScript$ c_a_treasure_sac
Oracle:Storm the Vault parse.
`,
    },
    players: [
      { life: 20, hand: ["Storm the Vault"], battlefield: [], manaPool: ["U", "R", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 514. Crime — Caustic Bronco in hand.
  {
    id: "caustic-bronco-crime-in-hand",
    description: "Caustic Bronco in hand; crime/discover parse.",
    seed: 0x249,
    cards: {
      "Caustic Bronco": `Name:Caustic Bronco
ManaCost:1 B
Types:Creature Horse
PT:3/2
T:Mode$ DamageDoneOnce | ValidSource$ Card.Self | ValidTarget$ Player | CombatDamage$ True | Execute$ TrigMill | TriggerDescription$ Mill on damage.
SVar:TrigMill:DB$ Dig | DigNum$ 1 | DestinationZone$ Exile | DestinationZone2$ Hand | RestRandomOrder$ True
Oracle:Caustic Bronco parse.
`,
    },
    players: [
      { life: 20, hand: ["Caustic Bronco"], battlefield: [], manaPool: ["B", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 515. Modal — Esper Charm in hand.
  {
    id: "esper-charm-charm-in-hand",
    description: "Esper Charm in hand; tri-mode charm parse.",
    seed: 0x24a,
    cards: {
      "Esper Charm": `Name:Esper Charm
ManaCost:W U B
Types:Instant
A:SP$ Charm | Cost$ W U B | Choices$ DBDestroy,DBDraw,DBDiscard | SpellDescription$ Esper Charm.
SVar:DBDestroy:DB$ Destroy | TargetType$ Card | ValidTgts$ Enchantment
SVar:DBDraw:DB$ Draw | NumCards$ 2
SVar:DBDiscard:DB$ Discard | NumCards$ 2 | Defined$ Player.Opponent
Oracle:Esper Charm parse.
`,
    },
    players: [
      { life: 20, hand: ["Esper Charm"], battlefield: [], manaPool: ["W", "U", "B"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 516. Phasing — Teferi's Realm in hand.
  {
    id: "teferis-realm-phasing-in-hand",
    description: "Teferi's Realm in hand; phasing chooser parse.",
    seed: 0x24b,
    cards: {
      "Teferi's Realm": `Name:Teferi's Realm
ManaCost:2 U
Types:Enchantment
T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | Execute$ TrigPhase | TriggerDescription$ Phase chooser.
SVar:TrigPhase:DB$ Phases | Defined$ ValidPermanent.Land+OppCtrl
Oracle:Teferi's Realm parse.
`,
    },
    players: [
      { life: 20, hand: ["Teferi's Realm"], battlefield: [], manaPool: ["U", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 517. Graft — Vigean Graftmage in hand.
  {
    id: "vigean-graftmage-graft-in-hand",
    description: "Vigean Graftmage in hand; graft counter transfer parse.",
    seed: 0x24c,
    cards: {
      "Vigean Graftmage": `Name:Vigean Graftmage
ManaCost:1 U
Types:Creature Vedalken Druid Mutant
PT:0/0
K:Graft:2
A:AB$ Untap | Cost$ 1 U | TargetType$ Card | ValidTgts$ Creature.YouCtrl+counters_GE1_P1P1 | TargetMin$ 1 | TargetMax$ 2 | SpellDescription$ Untap two.
Oracle:Vigean Graftmage parse.
`,
    },
    players: [
      { life: 20, hand: ["Vigean Graftmage"], battlefield: [], manaPool: ["U", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 518. Soulshift — Kami of the Crescent Moon (variant) in hand.
  {
    id: "kami-of-the-painted-road-soulshift-in-hand",
    description: "Kami of the Painted Road in hand; soulshift parse.",
    seed: 0x24d,
    cards: {
      "Kami of the Painted Road": `Name:Kami of the Painted Road
ManaCost:1 W W
Types:Creature Spirit
PT:2/2
K:Soulshift:3
T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | Execute$ TrigDraw | TriggerDescription$ Pseudo soulshift draw.
SVar:TrigDraw:DB$ Draw | NumCards$ 1
Oracle:Kami of the Painted Road parse.
`,
    },
    players: [
      { life: 20, hand: ["Kami of the Painted Road"], battlefield: [], manaPool: ["W", "W", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 519. Echo — Avalanche Riders in hand.
  {
    id: "avalanche-riders-echo-in-hand",
    description: "Avalanche Riders in hand; echo upkeep parse.",
    seed: 0x24e,
    cards: {
      "Avalanche Riders": `Name:Avalanche Riders
ManaCost:2 R R
Types:Creature Human Nomad
PT:2/2
K:Echo:2 R R
K:Haste
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDestroy | TriggerDescription$ Destroy land on ETB.
SVar:TrigDestroy:DB$ Destroy | TargetType$ Card | ValidTgts$ Land
Oracle:Avalanche Riders parse.
`,
    },
    players: [
      { life: 20, hand: ["Avalanche Riders"], battlefield: [], manaPool: ["R", "R", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 520. Cumulative Upkeep — Phyrexian Soulgorger in hand.
  {
    id: "phyrexian-soulgorger-cumulative-in-hand",
    description: "Phyrexian Soulgorger in hand; cumulative upkeep parse.",
    seed: 0x24f,
    cards: {
      "Phyrexian Soulgorger": `Name:Phyrexian Soulgorger
ManaCost:5
Types:Artifact Creature Construct
PT:8/8
K:Cumulative Upkeep:Sac<1/Creature>
Oracle:Phyrexian Soulgorger parse.
`,
    },
    players: [
      { life: 20, hand: ["Phyrexian Soulgorger"], battlefield: [], manaPool: ["C", "C", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 521. Dredge — Stinkweed Imp in hand.
  {
    id: "stinkweed-imp-dredge-in-hand",
    description: "Stinkweed Imp in hand; dredge replacement parse.",
    seed: 0x250,
    cards: {
      "Stinkweed Imp": `Name:Stinkweed Imp
ManaCost:1 B
Types:Creature Imp
PT:1/2
K:Flying
T:Mode$ DamageDoneOnce | ValidSource$ Card.Self | ValidTarget$ Creature | CombatDamage$ True | Execute$ TrigDestroy | TriggerDescription$ Destroy on combat damage.
SVar:TrigDestroy:DB$ Destroy | Defined$ TriggeredTarget
K:Dredge:5
Oracle:Stinkweed Imp parse.
`,
    },
    players: [
      { life: 20, hand: ["Stinkweed Imp"], battlefield: [], manaPool: ["B", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 522. Madness — Fiery Temper in hand.
  {
    id: "fiery-temper-madness-in-hand",
    description: "Fiery Temper in hand; madness alt-cost parse.",
    seed: 0x251,
    cards: {
      "Fiery Temper": `Name:Fiery Temper
ManaCost:1 R R
Types:Instant
A:SP$ DealDamage | Cost$ 1 R R | NumDmg$ 3 | ValidTgts$ Any | SpellDescription$ Temper.
K:Madness:R
Oracle:Fiery Temper parse.
`,
    },
    players: [
      { life: 20, hand: ["Fiery Temper"], battlefield: [], manaPool: ["R", "R", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 523. Buyback — Capsize in hand.
  {
    id: "capsize-buyback-in-hand",
    description: "Capsize in hand; buyback bounce parse.",
    seed: 0x252,
    cards: {
      Capsize: `Name:Capsize
ManaCost:1 U U
Types:Instant
A:SP$ ChangeZone | Cost$ 1 U U | Origin$ Battlefield | Destination$ Hand | TargetType$ Card | ValidTgts$ Permanent | SpellDescription$ Capsize.
K:Buyback:3
Oracle:Capsize parse.
`,
    },
    players: [
      { life: 20, hand: ["Capsize"], battlefield: [], manaPool: ["U", "U", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 524. Flashback — Deep Analysis in hand.
  {
    id: "deep-analysis-flashback-in-hand",
    description: "Deep Analysis in hand; flashback draw parse.",
    seed: 0x253,
    cards: {
      "Deep Analysis": `Name:Deep Analysis
ManaCost:3 U
Types:Sorcery
A:SP$ Draw | Cost$ 3 U | NumCards$ 2 | SpellDescription$ Analysis.
K:Flashback:1 U PayLife<3>
Oracle:Deep Analysis parse.
`,
    },
    players: [
      { life: 20, hand: ["Deep Analysis"], battlefield: [], manaPool: ["U", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 525. Foretell — Cosmos Charger in hand.
  {
    id: "cosmos-charger-foretell-in-hand",
    description: "Cosmos Charger in hand; foretell parse.",
    seed: 0x254,
    cards: {
      "Cosmos Charger": `Name:Cosmos Charger
ManaCost:1 W U
Types:Creature Spirit Horse
PT:2/3
K:Flying
S:Mode$ Continuous | Affected$ Card.YouOwn+isForetold | AddKeyword$ Foretell:0 | Description$ Foretold spells cost 0.
K:Foretell:1 W U
Oracle:Cosmos Charger parse.
`,
    },
    players: [
      { life: 20, hand: ["Cosmos Charger"], battlefield: [], manaPool: ["W", "U", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 526. Disturb — Baithook Angler (variant) in hand.
  {
    id: "shipwreck-marsh-disturb-in-hand",
    description: "Cemetery Illuminator (disturb) in hand; disturb back parse.",
    seed: 0x255,
    cards: {
      "Cemetery Illuminator": `Name:Cemetery Illuminator
ManaCost:1 W U
Types:Creature Spirit Cleric
PT:3/2
K:Flying
T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | Execute$ TrigDig | TriggerDescription$ Surveil 1 + exile.
SVar:TrigDig:DB$ Surveil | Amount$ 1
K:Disturb:2 W U
Oracle:Cemetery Illuminator parse.
`,
    },
    players: [
      { life: 20, hand: ["Cemetery Illuminator"], battlefield: [], manaPool: ["W", "U", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 527. Compleated PW — Tamiyo's Compleation (variant) in hand.
  {
    id: "ajani-sleeper-agent-compleated-in-hand",
    description: "Ajani, Sleeper Agent in hand; compleated PW parse.",
    seed: 0x256,
    cards: {
      "Ajani, Sleeper Agent": `Name:Ajani, Sleeper Agent
ManaCost:1 G W
Types:Legendary Planeswalker Ajani
Loyalty:3
A:AB$ PutCounter | Cost$ AddCounter<2/LOYALTY> | Planeswalker$ True | CounterType$ P1P1 | CounterNum$ 2 | TargetType$ Card | ValidTgts$ Creature | SpellDescription$ +2.
A:AB$ DealDamage | Cost$ SubCounter<3/LOYALTY> | Planeswalker$ True | NumDmg$ 3 | ValidTgts$ Any | SpellDescription$ -3.
A:AB$ Effect | Cost$ SubCounter<6/LOYALTY> | Planeswalker$ True | StaticAbilities$ STEmblem | SpellDescription$ -6 emblem.
SVar:STEmblem:Mode$ Continuous | EffectZone$ Command | AddKeyword$ Hexproof | Affected$ You
K:Compleated:Phyrexian
Oracle:Ajani, Sleeper Agent parse.
`,
    },
    players: [
      { life: 20, hand: ["Ajani, Sleeper Agent"], battlefield: [], manaPool: ["G", "W", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 528. DFC — Delver of Secrets in hand.
  {
    id: "delver-of-secrets-dfc-in-hand",
    description: "Delver of Secrets in hand; DFC transform parse.",
    seed: 0x257,
    cards: {
      "Delver of Secrets": `Name:Delver of Secrets
ManaCost:U
Types:Creature Human Wizard
PT:1/1
T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | Execute$ TrigTransform | TriggerDescription$ Reveal-and-transform.
SVar:TrigTransform:DB$ Dig | DigNum$ 1 | NoMove$ True | SubAbility$ DBTransform
SVar:DBTransform:DB$ SetState | Mode$ Transform | ConditionDefined$ Remembered | ConditionPresent$ Card.Instant,Sorcery
Oracle:Delver parse.
`,
    },
    players: [
      { life: 20, hand: ["Delver of Secrets"], battlefield: [], manaPool: ["U"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 529. DFC — Hanweir Garrison in hand.
  {
    id: "hanweir-garrison-dfc-in-hand",
    description: "Hanweir Garrison in hand; DFC meld-eligible parse.",
    seed: 0x258,
    cards: {
      "Hanweir Garrison": `Name:Hanweir Garrison
ManaCost:2 R
Types:Creature Human Soldier
PT:2/3
T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ TrigToken | TriggerDescription$ Tokens on attack.
SVar:TrigToken:DB$ Token | TokenAmount$ 2 | TokenScript$ r_1_1_human
Oracle:Hanweir Garrison parse.
`,
    },
    players: [
      { life: 20, hand: ["Hanweir Garrison"], battlefield: [], manaPool: ["R", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 530. Token — Krenko, Mob Boss in hand.
  {
    id: "krenko-mob-boss-in-hand-m612",
    description: "Krenko, Mob Boss in hand; token-multiplier parse.",
    seed: 0x259,
    cards: {
      "Krenko, Mob Boss": `Name:Krenko, Mob Boss
ManaCost:2 R R
Types:Legendary Creature Goblin Warrior
PT:3/3
A:AB$ Token | Cost$ T | TokenAmount$ X | TokenScript$ r_1_1_goblin | SpellDescription$ Goblin tokens equal goblins.
SVar:X:Count$ValidPermanent.YouCtrl+Goblin
Oracle:Krenko parse.
`,
    },
    players: [
      { life: 20, hand: ["Krenko, Mob Boss"], battlefield: [], manaPool: ["R", "R", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 531. Token — Avenger of Zendikar in hand.
  {
    id: "avenger-of-zendikar-in-hand-m612",
    description: "Avenger of Zendikar in hand; plant-token ETB parse.",
    seed: 0x25a,
    cards: {
      "Avenger of Zendikar": `Name:Avenger of Zendikar
ManaCost:5 G G
Types:Creature Elemental
PT:5/5
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigToken | TriggerDescription$ Plant tokens.
SVar:TrigToken:DB$ Token | TokenAmount$ X | TokenScript$ g_0_1_plant
SVar:X:Count$ValidPermanent.YouCtrl+Land
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Land.YouCtrl | Execute$ TrigPump | TriggerDescription$ Pump on land ETB.
SVar:TrigPump:DB$ PumpAll | NumAtt$ X | NumDef$ X | ValidCards$ Plant.YouCtrl
Oracle:Avenger of Zendikar parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Avenger of Zendikar"],
        battlefield: [],
        manaPool: ["G", "G", "C", "C", "C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 532. Spell — Cyclonic Rift overload (variant) in hand.
  {
    id: "cyclonic-rift-m612-in-hand",
    description: "Cyclonic Rift M612 in hand; overload variant parse.",
    seed: 0x25b,
    cards: {
      "Cyclonic Rift M612": `Name:Cyclonic Rift M612
ManaCost:1 U
Types:Instant
A:SP$ ChangeZone | Cost$ 1 U | Origin$ Battlefield | Destination$ Hand | TargetType$ Card | ValidTgts$ Permanent.nonLand+OppCtrl | SpellDescription$ Rift small.
A:SP$ ChangeZoneAll | Cost$ 6 U | ChangeType$ Permanent.nonLand+OppCtrl | Origin$ Battlefield | Destination$ Hand | SpellDescription$ Rift overload.
K:Overload:6 U
Oracle:Cyclonic Rift M612 parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Cyclonic Rift M612"],
        battlefield: [],
        manaPool: ["U", "C", "C", "C", "C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 533. Spell — Counterflux overload in hand.
  {
    id: "counterflux-overload-in-hand",
    description: "Counterflux in hand; overload counter parse.",
    seed: 0x25c,
    cards: {
      Counterflux: `Name:Counterflux
ManaCost:U U R
Types:Instant
A:SP$ Counter | Cost$ U U R | TargetType$ Spell | ValidTgts$ Card | SpellDescription$ Counterflux.
A:SP$ CounterAll | Cost$ 2 U U R | ValidCards$ Card.OppCtrl+isInZoneStack | SpellDescription$ Overload.
K:Overload:2 U U R
Oracle:Counterflux parse.
`,
    },
    players: [
      { life: 20, hand: ["Counterflux"], battlefield: [], manaPool: ["U", "U", "R", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 534. Spell — Mizzium Mortars overload in hand.
  {
    id: "mizzium-mortars-overload-in-hand",
    description: "Mizzium Mortars in hand; overload damage parse.",
    seed: 0x25d,
    cards: {
      "Mizzium Mortars": `Name:Mizzium Mortars
ManaCost:1 R
Types:Sorcery
A:SP$ DealDamage | Cost$ 1 R | NumDmg$ 4 | ValidTgts$ Creature | SpellDescription$ Mortars.
A:SP$ DealDamageAll | Cost$ 5 R R | NumDmg$ 4 | ValidCards$ Creature.OppCtrl | SpellDescription$ Overload.
K:Overload:5 R R
Oracle:Mizzium Mortars parse.
`,
    },
    players: [
      { life: 20, hand: ["Mizzium Mortars"], battlefield: [], manaPool: ["R", "R", "C", "C", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 535. Mill — Glimpse the Unthinkable in hand.
  {
    id: "glimpse-the-unthinkable-in-hand-m612",
    description: "Glimpse the Unthinkable in hand; mill 10 parse.",
    seed: 0x25e,
    cards: {
      "Glimpse the Unthinkable": `Name:Glimpse the Unthinkable
ManaCost:U B
Types:Sorcery
A:SP$ Mill | Cost$ U B | NumCards$ 10 | Defined$ Player.Opponent | SpellDescription$ Glimpse.
Oracle:Glimpse parse.
`,
    },
    players: [
      { life: 20, hand: ["Glimpse the Unthinkable"], battlefield: [], manaPool: ["U", "B"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 536. Mill — Maddening Cacophony in hand.
  {
    id: "maddening-cacophony-in-hand",
    description: "Maddening Cacophony in hand; kicker mill parse.",
    seed: 0x25f,
    cards: {
      "Maddening Cacophony": `Name:Maddening Cacophony
ManaCost:1 U
Types:Sorcery
A:SP$ Mill | Cost$ 1 U | NumCards$ 8 | ValidTgts$ Player | SpellDescription$ Cacophony.
K:Kicker:3 U
Oracle:Maddening Cacophony parse.
`,
    },
    players: [
      { life: 20, hand: ["Maddening Cacophony"], battlefield: [], manaPool: ["U", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 537. Burn — Searing Blaze in hand.
  {
    id: "searing-blaze-landfall-in-hand",
    description: "Searing Blaze in hand; landfall burn parse.",
    seed: 0x260,
    cards: {
      "Searing Blaze": `Name:Searing Blaze
ManaCost:R R
Types:Instant
A:SP$ DealDamage | Cost$ R R | NumDmg$ 1 | ValidTgts$ Player | SubAbility$ DBDmg2 | SpellDescription$ Blaze.
SVar:DBDmg2:DB$ DealDamage | NumDmg$ 1 | TargetType$ Card | ValidTgts$ Creature.TargetedPlayerCtrl
T:Mode$ Landfall | ValidPlayer$ You | Execute$ TrigBoost | TriggerDescription$ Landfall +2 dmg.
SVar:TrigBoost:DB$ ChangeNumDmg | NumDmg$ 3
Oracle:Searing Blaze parse.
`,
    },
    players: [
      { life: 20, hand: ["Searing Blaze"], battlefield: [], manaPool: ["R", "R"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 538. Burn — Skewer the Critics in hand.
  {
    id: "skewer-the-critics-spectacle-in-hand",
    description: "Skewer the Critics in hand; spectacle alt-cost parse.",
    seed: 0x261,
    cards: {
      "Skewer the Critics": `Name:Skewer the Critics
ManaCost:2 R
Types:Sorcery
A:SP$ DealDamage | Cost$ 2 R | NumDmg$ 3 | ValidTgts$ Any | SpellDescription$ Skewer.
K:Spectacle:R
Oracle:Skewer parse.
`,
    },
    players: [
      { life: 20, hand: ["Skewer the Critics"], battlefield: [], manaPool: ["R", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 539. Spectacle — Light Up the Stage in hand.
  {
    id: "light-up-the-stage-spectacle-in-hand",
    description: "Light Up the Stage in hand; spectacle exile-cast parse.",
    seed: 0x262,
    cards: {
      "Light Up the Stage": `Name:Light Up the Stage
ManaCost:2 R
Types:Sorcery
A:SP$ Dig | Cost$ 2 R | DigNum$ 2 | DestinationZone$ Exile | SpellDescription$ Stage.
K:Spectacle:R
Oracle:Light Up the Stage parse.
`,
    },
    players: [
      { life: 20, hand: ["Light Up the Stage"], battlefield: [], manaPool: ["R", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 540. Awaken — Scatter to the Winds in hand.
  {
    id: "scatter-to-the-winds-awaken-in-hand",
    description: "Scatter to the Winds in hand; awaken counter parse.",
    seed: 0x263,
    cards: {
      "Scatter to the Winds": `Name:Scatter to the Winds
ManaCost:2 U U
Types:Instant
A:SP$ Counter | Cost$ 2 U U | TargetType$ Spell | ValidTgts$ Card | SpellDescription$ Scatter.
K:Awaken:3:5 U U
Oracle:Scatter to the Winds parse.
`,
    },
    players: [
      { life: 20, hand: ["Scatter to the Winds"], battlefield: [], manaPool: ["U", "U", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 541. Cast — Counterspell variant in hand.
  {
    id: "force-of-negation-in-hand-m612",
    description: "Force of Negation in hand; alt-cast exile parse.",
    seed: 0x264,
    cards: {
      "Force of Negation": `Name:Force of Negation
ManaCost:1 U U
Types:Instant
A:SP$ Counter | Cost$ 1 U U | TargetType$ Spell | ValidTgts$ Card.nonCreature | SpellDescription$ Force.
A:SP$ Counter | Cost$ Exile<1/Card.YouOwn+inZoneHand+Blue+Other> | TargetType$ Spell | ValidTgts$ Card.nonCreature | ConditionPhases$ NotMain | SpellDescription$ Alt-cast.
Oracle:Force of Negation parse.
`,
    },
    players: [
      { life: 20, hand: ["Force of Negation"], battlefield: [], manaPool: ["U", "U", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 542. Cast — Force of Will in hand.
  {
    id: "force-of-will-in-hand-m612",
    description: "Force of Will in hand; alt-pitch counter parse.",
    seed: 0x265,
    cards: {
      "Force of Will": `Name:Force of Will
ManaCost:3 U U
Types:Instant
A:SP$ Counter | Cost$ 3 U U | TargetType$ Spell | ValidTgts$ Card | SpellDescription$ Force.
A:SP$ Counter | Cost$ Exile<1/Card.YouOwn+inZoneHand+Blue+Other> PayLife<1> | TargetType$ Spell | ValidTgts$ Card | SpellDescription$ Alt-cast.
Oracle:Force of Will parse.
`,
    },
    players: [
      { life: 20, hand: ["Force of Will"], battlefield: [], manaPool: ["U", "U", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 543. Cast — Mox Diamond in hand.
  {
    id: "mox-diamond-in-hand",
    description: "Mox Diamond in hand; ETB-discard alt-cost parse.",
    seed: 0x266,
    cards: {
      "Mox Diamond": `Name:Mox Diamond
ManaCost:0
Types:Artifact
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDiscard | OptionalDecider$ You | TriggerDescription$ Discard land or sac.
SVar:TrigDiscard:DB$ Discard | NumCards$ 1 | Mode$ TgtChoose | DiscardValid$ Card.Land
A:AB$ Mana | Cost$ T | Produced$ Any | SpellDescription$ Add any.
Oracle:Mox Diamond parse.
`,
    },
    players: [
      { life: 20, hand: ["Mox Diamond"], battlefield: [], manaPool: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 544. Cast — Lion's Eye Diamond in hand.
  {
    id: "lions-eye-diamond-in-hand",
    description: "Lion's Eye Diamond in hand; sac-discard mana parse.",
    seed: 0x267,
    cards: {
      "Lion's Eye Diamond": `Name:Lion's Eye Diamond
ManaCost:0
Types:Artifact
A:AB$ Mana | Cost$ T Sac<1/CARDNAME> DiscardHand | Produced$ Any | Amount$ 3 | SpellDescription$ LED.
Oracle:LED parse.
`,
    },
    players: [
      { life: 20, hand: ["Lion's Eye Diamond"], battlefield: [], manaPool: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 545. Tutor — Demonic Tutor in hand.
  {
    id: "demonic-tutor-in-hand-m612",
    description: "Demonic Tutor in hand; tutor-any parse.",
    seed: 0x268,
    cards: {
      "Demonic Tutor": `Name:Demonic Tutor
ManaCost:1 B
Types:Sorcery
A:SP$ ChangeZone | Cost$ 1 B | Origin$ Library | Destination$ Hand | ChangeType$ Card | ChangeNum$ 1 | SpellDescription$ Tutor.
Oracle:Demonic Tutor parse.
`,
    },
    players: [
      { life: 20, hand: ["Demonic Tutor"], battlefield: [], manaPool: ["B", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 546. Tutor — Vampiric Tutor in hand.
  {
    id: "vampiric-tutor-in-hand-m612",
    description: "Vampiric Tutor in hand; tutor-to-top parse.",
    seed: 0x269,
    cards: {
      "Vampiric Tutor": `Name:Vampiric Tutor
ManaCost:B
Types:Instant
A:SP$ ChangeZone | Cost$ B PayLife<2> | Origin$ Library | Destination$ Library | LibraryPosition$ 0 | ChangeType$ Card | ChangeNum$ 1 | SpellDescription$ Vampiric.
Oracle:Vampiric Tutor parse.
`,
    },
    players: [
      { life: 20, hand: ["Vampiric Tutor"], battlefield: [], manaPool: ["B"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 547. Tutor — Mystical Tutor in hand.
  {
    id: "mystical-tutor-in-hand-m612",
    description: "Mystical Tutor in hand; tutor-instant-or-sorcery-to-top parse.",
    seed: 0x26a,
    cards: {
      "Mystical Tutor": `Name:Mystical Tutor
ManaCost:U
Types:Instant
A:SP$ ChangeZone | Cost$ U | Origin$ Library | Destination$ Library | LibraryPosition$ 0 | ChangeType$ Instant,Sorcery | ChangeNum$ 1 | SpellDescription$ Mystical.
Oracle:Mystical Tutor parse.
`,
    },
    players: [
      { life: 20, hand: ["Mystical Tutor"], battlefield: [], manaPool: ["U"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 548. Tutor — Worldly Tutor in hand.
  {
    id: "worldly-tutor-in-hand-m612",
    description: "Worldly Tutor in hand; tutor-creature-to-top parse.",
    seed: 0x26b,
    cards: {
      "Worldly Tutor": `Name:Worldly Tutor
ManaCost:G
Types:Instant
A:SP$ ChangeZone | Cost$ G | Origin$ Library | Destination$ Library | LibraryPosition$ 0 | ChangeType$ Creature | ChangeNum$ 1 | SpellDescription$ Worldly.
Oracle:Worldly Tutor parse.
`,
    },
    players: [
      { life: 20, hand: ["Worldly Tutor"], battlefield: [], manaPool: ["G"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 549. Tutor — Enlightened Tutor in hand.
  {
    id: "enlightened-tutor-in-hand-m612",
    description: "Enlightened Tutor in hand; tutor-art-or-ench parse.",
    seed: 0x26c,
    cards: {
      "Enlightened Tutor": `Name:Enlightened Tutor
ManaCost:W
Types:Instant
A:SP$ ChangeZone | Cost$ W | Origin$ Library | Destination$ Library | LibraryPosition$ 0 | ChangeType$ Artifact,Enchantment | ChangeNum$ 1 | SpellDescription$ Enlightened.
Oracle:Enlightened Tutor parse.
`,
    },
    players: [
      { life: 20, hand: ["Enlightened Tutor"], battlefield: [], manaPool: ["W"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 550. Removal — Path to Exile in hand.
  {
    id: "path-to-exile-in-hand-m612",
    description: "Path to Exile in hand; exile-with-comp parse.",
    seed: 0x26d,
    cards: {
      "Path to Exile": `Name:Path to Exile
ManaCost:W
Types:Instant
A:SP$ ChangeZone | Cost$ W | Origin$ Battlefield | Destination$ Exile | TargetType$ Card | ValidTgts$ Creature | SubAbility$ DBSearch | SpellDescription$ Path.
SVar:DBSearch:DB$ ChangeZone | Origin$ Library | Destination$ Battlefield | ChangeType$ BasicLand | ChangeNum$ 1 | Defined$ TargetedController | Tapped$ True
Oracle:Path to Exile parse.
`,
    },
    players: [
      { life: 20, hand: ["Path to Exile"], battlefield: [], manaPool: ["W"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 551. Removal — Swords to Plowshares in hand.
  {
    id: "swords-to-plowshares-in-hand-m612",
    description: "Swords to Plowshares in hand; exile-with-life parse.",
    seed: 0x26e,
    cards: {
      "Swords to Plowshares": `Name:Swords to Plowshares
ManaCost:W
Types:Instant
A:SP$ ChangeZone | Cost$ W | Origin$ Battlefield | Destination$ Exile | TargetType$ Card | ValidTgts$ Creature | SubAbility$ DBLife | SpellDescription$ Swords.
SVar:DBLife:DB$ GainLife | LifeAmount$ Y | Defined$ TargetedController
SVar:Y:Targeted$CardPower
Oracle:Swords parse.
`,
    },
    players: [
      { life: 20, hand: ["Swords to Plowshares"], battlefield: [], manaPool: ["W"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 552. Removal — Doom Blade in hand.
  {
    id: "doom-blade-in-hand-m612",
    description: "Doom Blade in hand; destroy non-black parse.",
    seed: 0x26f,
    cards: {
      "Doom Blade": `Name:Doom Blade
ManaCost:1 B
Types:Instant
A:SP$ Destroy | Cost$ 1 B | TargetType$ Card | ValidTgts$ Creature.nonBlack | SpellDescription$ Doom Blade.
Oracle:Doom Blade parse.
`,
    },
    players: [
      { life: 20, hand: ["Doom Blade"], battlefield: [], manaPool: ["B", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 553. Removal — Heartless Act in hand.
  {
    id: "heartless-act-in-hand",
    description: "Heartless Act in hand; destroy or remove counters parse.",
    seed: 0x270,
    cards: {
      "Heartless Act": `Name:Heartless Act
ManaCost:1 B
Types:Instant
A:SP$ Charm | Cost$ 1 B | Choices$ DBDestroy,DBRemove | SpellDescription$ Heartless Act.
SVar:DBDestroy:DB$ Destroy | TargetType$ Card | ValidTgts$ Creature.counters_EQ0_P1P1
SVar:DBRemove:DB$ RemoveCounter | CounterType$ P1P1 | CounterNum$ 3 | TargetType$ Card | ValidTgts$ Creature
Oracle:Heartless Act parse.
`,
    },
    players: [
      { life: 20, hand: ["Heartless Act"], battlefield: [], manaPool: ["B", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 554. Removal — Anguished Unmaking in hand.
  {
    id: "anguished-unmaking-in-hand",
    description: "Anguished Unmaking in hand; exile-life parse.",
    seed: 0x271,
    cards: {
      "Anguished Unmaking": `Name:Anguished Unmaking
ManaCost:1 W B
Types:Instant
A:SP$ ChangeZone | Cost$ 1 W B PayLife<3> | Origin$ Battlefield | Destination$ Exile | TargetType$ Card | ValidTgts$ Permanent.nonLand | SpellDescription$ Unmaking.
Oracle:Unmaking parse.
`,
    },
    players: [
      { life: 20, hand: ["Anguished Unmaking"], battlefield: [], manaPool: ["W", "B", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 555. Removal — Vindicate in hand.
  {
    id: "vindicate-in-hand",
    description: "Vindicate in hand; destroy any permanent parse.",
    seed: 0x272,
    cards: {
      Vindicate: `Name:Vindicate
ManaCost:1 W B
Types:Sorcery
A:SP$ Destroy | Cost$ 1 W B | TargetType$ Card | ValidTgts$ Permanent | SpellDescription$ Vindicate.
Oracle:Vindicate parse.
`,
    },
    players: [
      { life: 20, hand: ["Vindicate"], battlefield: [], manaPool: ["W", "B", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 556. Removal — Assassin's Trophy in hand.
  {
    id: "assassins-trophy-in-hand",
    description: "Assassin's Trophy in hand; destroy permanent + ramp parse.",
    seed: 0x273,
    cards: {
      "Assassin's Trophy": `Name:Assassin's Trophy
ManaCost:B G
Types:Instant
A:SP$ Destroy | Cost$ B G | TargetType$ Card | ValidTgts$ Permanent.OppCtrl | SubAbility$ DBSearch | SpellDescription$ Trophy.
SVar:DBSearch:DB$ ChangeZone | Origin$ Library | Destination$ Battlefield | ChangeType$ BasicLand | ChangeNum$ 1 | Defined$ TargetedController
Oracle:Trophy parse.
`,
    },
    players: [
      { life: 20, hand: ["Assassin's Trophy"], battlefield: [], manaPool: ["B", "G"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 557. Burn — Galvanic Blast in hand.
  {
    id: "galvanic-blast-in-hand",
    description: "Galvanic Blast in hand; metalcraft burn parse.",
    seed: 0x274,
    cards: {
      "Galvanic Blast": `Name:Galvanic Blast
ManaCost:R
Types:Instant
A:SP$ DealDamage | Cost$ R | NumDmg$ 2 | ValidTgts$ Any | ConditionMetalcraft$ False | SpellDescription$ Blast.
A:SP$ DealDamage | Cost$ R | NumDmg$ 4 | ValidTgts$ Any | ConditionMetalcraft$ True | SpellDescription$ Metalcraft.
Oracle:Galvanic Blast parse.
`,
    },
    players: [
      { life: 20, hand: ["Galvanic Blast"], battlefield: [], manaPool: ["R"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 558. Burn — Lava Spike in hand.
  {
    id: "lava-spike-in-hand-m612",
    description: "Lava Spike in hand; player-only burn parse.",
    seed: 0x275,
    cards: {
      "Lava Spike": `Name:Lava Spike
ManaCost:R
Types:Sorcery
A:SP$ DealDamage | Cost$ R | NumDmg$ 3 | ValidTgts$ Player | SpellDescription$ Spike.
Oracle:Lava Spike parse.
`,
    },
    players: [
      { life: 20, hand: ["Lava Spike"], battlefield: [], manaPool: ["R"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 559. Burn — Bonecrusher Giant Stomp half in hand.
  {
    id: "bonecrusher-stomp-half-in-hand",
    description: "Stomp half adventure in hand parse.",
    seed: 0x276,
    cards: {
      "Stomp Half": `Name:Stomp Half
ManaCost:1 R
Types:Instant
A:SP$ DealDamage | Cost$ 1 R | NumDmg$ 2 | ValidTgts$ Any | SpellDescription$ Stomp.
Oracle:Stomp Half parse.
`,
    },
    players: [
      { life: 20, hand: ["Stomp Half"], battlefield: [], manaPool: ["R", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 560. Burn — Searing Flesh in hand.
  {
    id: "fireblast-in-hand",
    description: "Fireblast in hand; alt-pay sac mountain parse.",
    seed: 0x277,
    cards: {
      Fireblast: `Name:Fireblast
ManaCost:4 R R
Types:Instant
A:SP$ DealDamage | Cost$ 4 R R | NumDmg$ 4 | ValidTgts$ Any | SpellDescription$ Fireblast.
A:SP$ DealDamage | Cost$ Sac<2/Mountain> | NumDmg$ 4 | ValidTgts$ Any | SpellDescription$ Alt-cast.
Oracle:Fireblast parse.
`,
    },
    players: [
      { life: 20, hand: ["Fireblast"], battlefield: [], manaPool: ["R", "R", "C", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 561. Combat — Goblin Guide in hand.
  {
    id: "goblin-guide-in-hand",
    description: "Goblin Guide in hand; haste 2/2 reveal parse.",
    seed: 0x278,
    cards: {
      "Goblin Guide": `Name:Goblin Guide
ManaCost:R
Types:Creature Goblin Scout
PT:2/2
K:Haste
T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ TrigReveal | TriggerDescription$ Reveal.
SVar:TrigReveal:DB$ Reveal | RevealNumber$ 1 | RevealLocation$ Library | Defined$ Player.Opponent
Oracle:Goblin Guide parse.
`,
    },
    players: [
      { life: 20, hand: ["Goblin Guide"], battlefield: [], manaPool: ["R"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 562. Combat — Champion of the Parish in hand.
  {
    id: "champion-of-the-parish-in-hand",
    description: "Champion of the Parish in hand; tribal +1/+1 parse.",
    seed: 0x279,
    cards: {
      "Champion of the Parish": `Name:Champion of the Parish
ManaCost:W
Types:Creature Human Soldier
PT:1/1
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Human.YouCtrl+Other | Execute$ TrigCounter | TriggerDescription$ +1/+1 on human ETB.
SVar:TrigCounter:DB$ PutCounter | CounterType$ P1P1 | CounterNum$ 1 | Defined$ Self
Oracle:Champion parse.
`,
    },
    players: [
      { life: 20, hand: ["Champion of the Parish"], battlefield: [], manaPool: ["W"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 563. Combat — Thalia, Guardian of Thraben in hand.
  {
    id: "thalia-guardian-of-thraben-in-hand",
    description: "Thalia, Guardian of Thraben in hand; tax-static parse.",
    seed: 0x27a,
    cards: {
      "Thalia, Guardian of Thraben": `Name:Thalia, Guardian of Thraben
ManaCost:1 W
Types:Legendary Creature Human Soldier
PT:2/1
K:First Strike
S:Mode$ RaiseCost | ValidCard$ Card.nonCreature | Type$ Spell | Amount$ 1 | Description$ Tax.
Oracle:Thalia parse.
`,
    },
    players: [
      { life: 20, hand: ["Thalia, Guardian of Thraben"], battlefield: [], manaPool: ["W", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 564. Combat — Stoneforge Mystic in hand.
  {
    id: "stoneforge-mystic-in-hand",
    description: "Stoneforge Mystic in hand; tutor-equipment parse.",
    seed: 0x27b,
    cards: {
      "Stoneforge Mystic": `Name:Stoneforge Mystic
ManaCost:1 W
Types:Creature Kor Artificer
PT:1/2
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigSearch | OptionalDecider$ You | TriggerDescription$ Tutor equipment.
SVar:TrigSearch:DB$ ChangeZone | Origin$ Library | Destination$ Hand | ChangeType$ Artifact.Equipment | ChangeNum$ 1
A:AB$ ChangeZone | Cost$ 1 W Sac<1/CARDNAME> | Origin$ Hand | Destination$ Battlefield | ChangeType$ Artifact.Equipment | ChangeNum$ 1 | SpellDescription$ Cheat.
Oracle:Stoneforge Mystic parse.
`,
    },
    players: [
      { life: 20, hand: ["Stoneforge Mystic"], battlefield: [], manaPool: ["W", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 565. Combat — Hokori, Dust Drinker in hand.
  {
    id: "hokori-dust-drinker-in-hand",
    description: "Hokori, Dust Drinker in hand; tap-down static parse.",
    seed: 0x27c,
    cards: {
      "Hokori, Dust Drinker": `Name:Hokori, Dust Drinker
ManaCost:2 W
Types:Legendary Creature Spirit
PT:1/1
T:Mode$ Phase | Phase$ Untap | ValidPlayer$ You | Execute$ TrigUntap | TriggerDescription$ Skip untap.
SVar:TrigUntap:DB$ SkipPhase | Phase$ Untap
Oracle:Hokori parse.
`,
    },
    players: [
      { life: 20, hand: ["Hokori, Dust Drinker"], battlefield: [], manaPool: ["W", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 566. Combat — Lord of Atlantis in hand.
  {
    id: "lord-of-atlantis-in-hand-m612",
    description: "Lord of Atlantis in hand; tribal lord static parse.",
    seed: 0x27d,
    cards: {
      "Lord of Atlantis": `Name:Lord of Atlantis
ManaCost:U U
Types:Creature Merfolk
PT:2/2
S:Mode$ Continuous | Affected$ Merfolk.Other | AddPower$ 1 | AddToughness$ 1 | AddKeyword$ Islandwalk | Description$ Lord static.
Oracle:Lord parse.
`,
    },
    players: [
      { life: 20, hand: ["Lord of Atlantis"], battlefield: [], manaPool: ["U", "U"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 567. Combat — Goblin King in hand.
  {
    id: "goblin-king-in-hand-m612",
    description: "Goblin King in hand; goblin lord parse.",
    seed: 0x27e,
    cards: {
      "Goblin King": `Name:Goblin King
ManaCost:1 R R
Types:Creature Goblin
PT:2/2
S:Mode$ Continuous | Affected$ Goblin.Other | AddPower$ 1 | AddToughness$ 1 | AddKeyword$ Mountainwalk | Description$ Goblin lord.
Oracle:Goblin King parse.
`,
    },
    players: [
      { life: 20, hand: ["Goblin King"], battlefield: [], manaPool: ["R", "R", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 568. Combat — Lord of the Undead in hand.
  {
    id: "lord-of-the-undead-in-hand",
    description: "Lord of the Undead in hand; zombie lord parse.",
    seed: 0x27f,
    cards: {
      "Lord of the Undead": `Name:Lord of the Undead
ManaCost:1 B B
Types:Creature Zombie
PT:2/2
S:Mode$ Continuous | Affected$ Zombie.Other | AddPower$ 1 | AddToughness$ 1 | Description$ Lord.
A:AB$ ChangeZone | Cost$ 1 B T | Origin$ Graveyard | Destination$ Hand | TargetType$ Card | ValidTgts$ Zombie | SpellDescription$ Reanimate.
Oracle:Lord of the Undead parse.
`,
    },
    players: [
      { life: 20, hand: ["Lord of the Undead"], battlefield: [], manaPool: ["B", "B", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 569. Combat — Elvish Archdruid in hand.
  {
    id: "elvish-archdruid-in-hand-m612",
    description: "Elvish Archdruid in hand; elf lord + mana parse.",
    seed: 0x280,
    cards: {
      "Elvish Archdruid": `Name:Elvish Archdruid
ManaCost:1 G G
Types:Creature Elf Druid
PT:2/2
S:Mode$ Continuous | Affected$ Elf.Other | AddPower$ 1 | AddToughness$ 1 | Description$ Elf lord.
A:AB$ Mana | Cost$ T | Produced$ G | Amount$ X | SpellDescription$ Tap for elves.
SVar:X:Count$ValidPermanent.YouCtrl+Elf
Oracle:Elvish Archdruid parse.
`,
    },
    players: [
      { life: 20, hand: ["Elvish Archdruid"], battlefield: [], manaPool: ["G", "G", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 570. Combat — Drogskol Captain in hand.
  {
    id: "drogskol-captain-in-hand",
    description: "Drogskol Captain in hand; spirit lord hexproof parse.",
    seed: 0x281,
    cards: {
      "Drogskol Captain": `Name:Drogskol Captain
ManaCost:W U
Types:Creature Spirit Soldier
PT:2/2
K:Flying
S:Mode$ Continuous | Affected$ Spirit.Other | AddPower$ 1 | AddToughness$ 1 | AddKeyword$ Hexproof | Description$ Spirit lord.
Oracle:Drogskol Captain parse.
`,
    },
    players: [
      { life: 20, hand: ["Drogskol Captain"], battlefield: [], manaPool: ["W", "U"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 571. Combat — Cavern of Souls in hand.
  {
    id: "cavern-of-souls-in-hand-m612",
    description: "Cavern of Souls in hand; uncounterable tribal parse.",
    seed: 0x282,
    cards: {
      "Cavern of Souls": `Name:Cavern of Souls
ManaCost:no cost
Types:Land
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigChooseType | TriggerDescription$ Choose creature type.
SVar:TrigChooseType:DB$ ChooseType | Type$ Creature
A:AB$ Mana | Cost$ T | Produced$ C | SpellDescription$ Add C.
A:AB$ Mana | Cost$ T | Produced$ Any | RestrictValid$ ChosenType | SpellDescription$ Add tribal.
Oracle:Cavern parse.
`,
    },
    players: [
      { life: 20, hand: ["Cavern of Souls"], battlefield: [], manaPool: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 572. Land — Mutavault in hand.
  {
    id: "mutavault-in-hand",
    description: "Mutavault in hand; manland animate parse.",
    seed: 0x283,
    cards: {
      Mutavault: `Name:Mutavault
ManaCost:no cost
Types:Land
A:AB$ Mana | Cost$ T | Produced$ C | SpellDescription$ Add C.
A:AB$ Animate | Cost$ 1 | Power$ 2 | Toughness$ 2 | Types$ Creature,Changeling | Keywords$ Changeling | UntilEOT$ True | SpellDescription$ Animate 2/2.
Oracle:Mutavault parse.
`,
    },
    players: [
      { life: 20, hand: ["Mutavault"], battlefield: [], manaPool: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 573. Land — Wasteland in hand.
  {
    id: "wasteland-in-hand-m612",
    description: "Wasteland in hand; sac to destroy land parse.",
    seed: 0x284,
    cards: {
      Wasteland: `Name:Wasteland
ManaCost:no cost
Types:Land
A:AB$ Mana | Cost$ T | Produced$ C | SpellDescription$ Add C.
A:AB$ Destroy | Cost$ T Sac<1/CARDNAME> | TargetType$ Card | ValidTgts$ Land.nonBasic | SpellDescription$ Wasteland.
Oracle:Wasteland parse.
`,
    },
    players: [
      { life: 20, hand: ["Wasteland"], battlefield: [], manaPool: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 574. Land — Strip Mine in hand.
  {
    id: "strip-mine-in-hand-m612",
    description: "Strip Mine in hand; sac to destroy any land parse.",
    seed: 0x285,
    cards: {
      "Strip Mine": `Name:Strip Mine
ManaCost:no cost
Types:Land
A:AB$ Mana | Cost$ T | Produced$ C | SpellDescription$ Add C.
A:AB$ Destroy | Cost$ T Sac<1/CARDNAME> | TargetType$ Card | ValidTgts$ Land | SpellDescription$ Strip Mine.
Oracle:Strip Mine parse.
`,
    },
    players: [
      { life: 20, hand: ["Strip Mine"], battlefield: [], manaPool: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 575. Land — Ancient Tomb in hand.
  {
    id: "ancient-tomb-in-hand",
    description: "Ancient Tomb in hand; pain land 2 colorless parse.",
    seed: 0x286,
    cards: {
      "Ancient Tomb": `Name:Ancient Tomb
ManaCost:no cost
Types:Land
A:AB$ Mana | Cost$ T | Produced$ C | Amount$ 2 | SubAbility$ DBLife | SpellDescription$ Add CC.
SVar:DBLife:DB$ LoseLife | LifeAmount$ 2 | Defined$ You
Oracle:Ancient Tomb parse.
`,
    },
    players: [
      { life: 20, hand: ["Ancient Tomb"], battlefield: [], manaPool: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 576. Land — City of Brass in hand.
  {
    id: "city-of-brass-in-hand",
    description: "City of Brass in hand; pain rainbow parse.",
    seed: 0x287,
    cards: {
      "City of Brass": `Name:City of Brass
ManaCost:no cost
Types:Land
T:Mode$ Taps | ValidCard$ Card.Self | Execute$ TrigDmg | TriggerDescription$ Pain.
SVar:TrigDmg:DB$ LoseLife | LifeAmount$ 1 | Defined$ You
A:AB$ Mana | Cost$ T | Produced$ Any | SpellDescription$ Add any.
Oracle:City of Brass parse.
`,
    },
    players: [
      { life: 20, hand: ["City of Brass"], battlefield: [], manaPool: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 577. Land — Mana Confluence in hand.
  {
    id: "mana-confluence-in-hand",
    description: "Mana Confluence in hand; pain rainbow no-tap parse.",
    seed: 0x288,
    cards: {
      "Mana Confluence": `Name:Mana Confluence
ManaCost:no cost
Types:Land
A:AB$ Mana | Cost$ T PayLife<1> | Produced$ Any | SpellDescription$ Add any.
Oracle:Mana Confluence parse.
`,
    },
    players: [
      { life: 20, hand: ["Mana Confluence"], battlefield: [], manaPool: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 578. Spell — Channel (variant) in hand.
  {
    id: "channel-of-power-m612-in-hand",
    description: "Channel of Power M612 in hand; channel ramp variant parse.",
    seed: 0x289,
    cards: {
      "Channel of Power M612": `Name:Channel of Power M612
ManaCost:no cost
Types:Sorcery
A:SP$ Mana | Cost$ X PayLife<X> | Produced$ C | Amount$ X | SpellDescription$ Channel.
SVar:X:Count$xPaid
Oracle:Channel parse.
`,
    },
    players: [
      { life: 20, hand: ["Channel of Power M612"], battlefield: [], manaPool: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 579. Spell — Bloodbraid Berserker in hand.
  {
    id: "bloodbraid-berserker-in-hand",
    description: "Bloodbraid Berserker in hand; cascade/haste parse.",
    seed: 0x28a,
    cards: {
      "Bloodbraid Berserker": `Name:Bloodbraid Berserker
ManaCost:2 R G
Types:Creature Elf Berserker
PT:3/3
K:Haste
K:Cascade
Oracle:Bloodbraid Berserker parse.
`,
    },
    players: [
      { life: 20, hand: ["Bloodbraid Berserker"], battlefield: [], manaPool: ["R", "G", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 580. Spell — Bloodghast in hand.
  {
    id: "bloodghast-in-hand-m612",
    description: "Bloodghast in hand; landfall recur parse.",
    seed: 0x28b,
    cards: {
      Bloodghast: `Name:Bloodghast
ManaCost:B B
Types:Creature Vampire Spirit
PT:2/1
K:Haste:Card.Self+oppHasLifeLE10
T:Mode$ Landfall | ValidPlayer$ You | Execute$ TrigReturn | TriggerDescription$ Landfall return.
SVar:TrigReturn:DB$ ChangeZone | Origin$ Graveyard | Destination$ Battlefield | ChangeType$ Card.Self
Oracle:Bloodghast parse.
`,
    },
    players: [
      { life: 20, hand: ["Bloodghast"], battlefield: [], manaPool: ["B", "B"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 581. Spell — Reassembling Skeleton in hand.
  {
    id: "reassembling-skeleton-in-hand",
    description: "Reassembling Skeleton in hand; recursive return parse.",
    seed: 0x28c,
    cards: {
      "Reassembling Skeleton": `Name:Reassembling Skeleton
ManaCost:1 B
Types:Creature Skeleton Warrior
PT:1/1
A:AB$ ChangeZone | Cost$ 1 B | Origin$ Graveyard | Destination$ Battlefield | Defined$ Self | ActivationZone$ Graveyard | SpellDescription$ Return.
Oracle:Reassembling Skeleton parse.
`,
    },
    players: [
      { life: 20, hand: ["Reassembling Skeleton"], battlefield: [], manaPool: ["B", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 582. Spell — Bloodsoaked Champion in hand.
  {
    id: "bloodsoaked-champion-in-hand",
    description: "Bloodsoaked Champion in hand; raid + return parse.",
    seed: 0x28d,
    cards: {
      "Bloodsoaked Champion": `Name:Bloodsoaked Champion
ManaCost:B
Types:Creature Human Warrior
PT:2/1
A:AB$ ChangeZone | Cost$ 1 B | Origin$ Graveyard | Destination$ Battlefield | Defined$ Self | ActivationZone$ Graveyard | ConditionRaid$ True | SpellDescription$ Raid return.
Oracle:Bloodsoaked Champion parse.
`,
    },
    players: [
      { life: 20, hand: ["Bloodsoaked Champion"], battlefield: [], manaPool: ["B"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 583. Spell — Gravecrawler in hand.
  {
    id: "gravecrawler-in-hand",
    description: "Gravecrawler in hand; recur from gy with zombie parse.",
    seed: 0x28e,
    cards: {
      Gravecrawler: `Name:Gravecrawler
ManaCost:B
Types:Creature Zombie
PT:2/1
S:Mode$ CantBlock | ValidCard$ Card.Self | Description$ Can't block.
A:AB$ ChangeZone | Cost$ B | Origin$ Graveyard | Destination$ Battlefield | Defined$ Self | ActivationZone$ Graveyard | ConditionPresent$ Zombie.YouCtrl | SpellDescription$ Recur.
Oracle:Gravecrawler parse.
`,
    },
    players: [
      { life: 20, hand: ["Gravecrawler"], battlefield: [], manaPool: ["B"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 584. Spell — Nether Traitor in hand.
  {
    id: "nether-traitor-in-hand",
    description: "Nether Traitor in hand; haste recur shadow parse.",
    seed: 0x28f,
    cards: {
      "Nether Traitor": `Name:Nether Traitor
ManaCost:B B
Types:Creature Spirit
PT:1/1
K:Haste
K:Shadow
T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Creature.Other+YouCtrl | Execute$ TrigReturn | OptionalDecider$ You | TriggerDescription$ Return self.
SVar:TrigReturn:DB$ ChangeZone | Origin$ Graveyard | Destination$ Battlefield | Defined$ Self
Oracle:Nether Traitor parse.
`,
    },
    players: [
      { life: 20, hand: ["Nether Traitor"], battlefield: [], manaPool: ["B", "B"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 585. Spell — Squee, Goblin Nabob in hand.
  {
    id: "squee-goblin-nabob-in-hand",
    description: "Squee, Goblin Nabob in hand; recur from hand parse.",
    seed: 0x290,
    cards: {
      "Squee, Goblin Nabob": `Name:Squee, Goblin Nabob
ManaCost:3 R
Types:Legendary Creature Goblin
PT:1/1
T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | Execute$ TrigReturn | TriggerDescription$ Recur.
SVar:TrigReturn:DB$ ChangeZone | Origin$ Graveyard | Destination$ Hand | ChangeType$ Card.Self+inZoneGraveyard
Oracle:Squee parse.
`,
    },
    players: [
      { life: 20, hand: ["Squee, Goblin Nabob"], battlefield: [], manaPool: ["R", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 586. Spell — Yawgmoth's Will in hand.
  {
    id: "yawgmoths-will-m612-in-hand",
    description: "Yawgmoth's Will M612 in hand; play-from-graveyard parse.",
    seed: 0x291,
    cards: {
      "Yawgmoth's Will M612": `Name:Yawgmoth's Will M612
ManaCost:2 B
Types:Sorcery
A:SP$ Effect | Cost$ 2 B | StaticAbilities$ STPlay | SpellDescription$ Will.
SVar:STPlay:Mode$ Continuous | EffectZone$ Command | AddPlayUntil$ EndOfTurn | Affected$ Card.YouOwn+inZoneGraveyard | Description$ Play.
Oracle:Yawgmoth's Will M612 parse.
`,
    },
    players: [
      { life: 20, hand: ["Yawgmoth's Will M612"], battlefield: [], manaPool: ["B", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 587. Spell — Past in Flames in hand.
  {
    id: "past-in-flames-in-hand",
    description: "Past in Flames in hand; flashback all parse.",
    seed: 0x292,
    cards: {
      "Past in Flames": `Name:Past in Flames
ManaCost:3 R
Types:Sorcery
A:SP$ Effect | Cost$ 3 R | StaticAbilities$ STFlash | SpellDescription$ Flashback all.
SVar:STFlash:Mode$ Continuous | EffectZone$ Command | AddKeyword$ Flashback | Affected$ Card.YouOwn+inZoneGraveyard+Instant,Sorcery
K:Flashback:4 R
Oracle:Past in Flames parse.
`,
    },
    players: [
      { life: 20, hand: ["Past in Flames"], battlefield: [], manaPool: ["R", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 588. Spell — Living Death in hand.
  {
    id: "living-death-in-hand-m612",
    description: "Living Death in hand; mass exchange parse.",
    seed: 0x293,
    cards: {
      "Living Death": `Name:Living Death
ManaCost:3 B
Types:Sorcery
A:SP$ ChangeZoneAll | Cost$ 3 B | ChangeType$ Creature | Origin$ Battlefield | Destination$ Graveyard | SubAbility$ DBReturn | SpellDescription$ Living Death.
SVar:DBReturn:DB$ ChangeZoneAll | ChangeType$ Creature | Origin$ Graveyard | Destination$ Battlefield
Oracle:Living Death parse.
`,
    },
    players: [
      { life: 20, hand: ["Living Death"], battlefield: [], manaPool: ["B", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 589. Spell — Reanimate in hand.
  {
    id: "reanimate-in-hand-m612",
    description: "Reanimate in hand; reanimate any cmc parse.",
    seed: 0x294,
    cards: {
      Reanimate: `Name:Reanimate
ManaCost:B
Types:Sorcery
A:SP$ ChangeZone | Cost$ B | Origin$ Graveyard | Destination$ Battlefield | TargetType$ Card | ValidTgts$ Creature | SubAbility$ DBLife | SpellDescription$ Reanimate.
SVar:DBLife:DB$ LoseLife | LifeAmount$ X | Defined$ You
SVar:X:Targeted$CardManaCost
Oracle:Reanimate parse.
`,
    },
    players: [
      { life: 20, hand: ["Reanimate"], battlefield: [], manaPool: ["B"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 590. Spell — Animate Dead in hand.
  {
    id: "animate-dead-in-hand-m612",
    description: "Animate Dead in hand; aura reanimate parse.",
    seed: 0x295,
    cards: {
      "Animate Dead": `Name:Animate Dead
ManaCost:1 B
Types:Enchantment Aura
K:Enchant Creature card in any graveyard
A:SP$ Attach | Cost$ 1 B | TargetType$ Card | ValidTgts$ Creature.inZoneGraveyard | AILogic$ Reanimate | SpellDescription$ Animate.
Oracle:Animate Dead parse.
`,
    },
    players: [
      { life: 20, hand: ["Animate Dead"], battlefield: [], manaPool: ["B", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 591. Spell — Necromancy in hand.
  {
    id: "necromancy-in-hand",
    description: "Necromancy in hand; flash reanimate parse.",
    seed: 0x296,
    cards: {
      Necromancy: `Name:Necromancy
ManaCost:2 B
Types:Enchantment Aura
K:Flash
K:Enchant Creature card in any graveyard
A:SP$ Attach | Cost$ 2 B | TargetType$ Card | ValidTgts$ Creature.inZoneGraveyard | AILogic$ Reanimate | SpellDescription$ Necromancy.
Oracle:Necromancy parse.
`,
    },
    players: [
      { life: 20, hand: ["Necromancy"], battlefield: [], manaPool: ["B", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 592. Spell — Show and Tell in hand.
  {
    id: "show-and-tell-in-hand",
    description: "Show and Tell in hand; both-cheat parse.",
    seed: 0x297,
    cards: {
      "Show and Tell": `Name:Show and Tell
ManaCost:2 U
Types:Sorcery
A:SP$ ChangeZone | Cost$ 2 U | Origin$ Hand | Destination$ Battlefield | ChangeType$ Permanent.nonLand | ChangeNum$ 1 | Defined$ Player | SpellDescription$ Show and Tell.
Oracle:Show and Tell parse.
`,
    },
    players: [
      { life: 20, hand: ["Show and Tell"], battlefield: [], manaPool: ["U", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 593. Spell — Sneak Attack in hand.
  {
    id: "sneak-attack-in-hand",
    description: "Sneak Attack in hand; cheat-sac creature parse.",
    seed: 0x298,
    cards: {
      "Sneak Attack": `Name:Sneak Attack
ManaCost:2 R
Types:Enchantment
A:AB$ ChangeZone | Cost$ R | Origin$ Hand | Destination$ Battlefield | ChangeType$ Creature.YouOwn | ChangeNum$ 1 | RememberChanged$ True | SubAbility$ DBHaste | SpellDescription$ Sneak.
SVar:DBHaste:DB$ Animate | Defined$ Remembered | Keywords$ Haste | UntilEOT$ True | SubAbility$ DBSac
SVar:DBSac:DB$ Sacrifice | SacValid$ Card.IsRemembered | TriggerPhases$ EndOfTurn
Oracle:Sneak Attack parse.
`,
    },
    players: [
      { life: 20, hand: ["Sneak Attack"], battlefield: [], manaPool: ["R", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 594. Spell — Through the Breach in hand.
  {
    id: "through-the-breach-in-hand",
    description: "Through the Breach in hand; alt-pitch cheat parse.",
    seed: 0x299,
    cards: {
      "Through the Breach": `Name:Through the Breach
ManaCost:3 R R
Types:Instant Arcane
A:SP$ ChangeZone | Cost$ 3 R R | Origin$ Hand | Destination$ Battlefield | ChangeType$ Creature.YouOwn | ChangeNum$ 1 | RememberChanged$ True | SubAbility$ DBSac | SpellDescription$ Through the Breach.
SVar:DBSac:DB$ Sacrifice | SacValid$ Card.IsRemembered | TriggerPhases$ EndOfTurn
A:SP$ ChangeZone | Cost$ Exile<1/Card.YouOwn+inZoneHand+Other> | Origin$ Hand | Destination$ Battlefield | ChangeType$ Creature.YouOwn | ChangeNum$ 1 | SpellDescription$ Alt-cast.
Oracle:Through the Breach parse.
`,
    },
    players: [
      { life: 20, hand: ["Through the Breach"], battlefield: [], manaPool: ["R", "R", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 595. Spell — Goryo's Vengeance variant in hand.
  {
    id: "goryos-vengeance-m612-in-hand",
    description: "Goryo's Vengeance M612 in hand; legend-only reanimate parse.",
    seed: 0x29a,
    cards: {
      "Goryo's Vengeance M612": `Name:Goryo's Vengeance M612
ManaCost:1 B
Types:Instant Arcane
A:SP$ ChangeZone | Cost$ 1 B | Origin$ Graveyard | Destination$ Battlefield | TargetType$ Card | ValidTgts$ Creature.Legendary | SpellDescription$ Goryo.
K:Splice:Arcane:1 B
Oracle:Goryo M612 parse.
`,
    },
    players: [
      { life: 20, hand: ["Goryo's Vengeance M612"], battlefield: [], manaPool: ["B", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 596. Spell — Heliod, Sun-Crowned in hand.
  {
    id: "heliod-sun-crowned-in-hand-m612",
    description: "Heliod, Sun-Crowned in hand; god-static lifelink parse.",
    seed: 0x29b,
    cards: {
      "Heliod, Sun-Crowned": `Name:Heliod, Sun-Crowned
ManaCost:1 W W
Types:Legendary Enchantment Creature God
PT:5/5
K:Indestructible
S:Mode$ Continuous | Affected$ Creature.YouCtrl+counters_GE1_P1P1 | AddKeyword$ Lifelink | Description$ Lifelink.
T:Mode$ LifeGained | ValidPlayer$ You | Execute$ TrigCounter | TriggerDescription$ +1/+1 on lifegain.
SVar:TrigCounter:DB$ PutCounter | CounterType$ P1P1 | CounterNum$ 1 | TargetType$ Card | ValidTgts$ Creature.YouCtrl
Oracle:Heliod parse.
`,
    },
    players: [
      { life: 20, hand: ["Heliod, Sun-Crowned"], battlefield: [], manaPool: ["W", "W", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 597. Spell — Walking Ballista in hand.
  {
    id: "walking-ballista-in-hand",
    description: "Walking Ballista in hand; X 0/0 + ping parse.",
    seed: 0x29c,
    cards: {
      "Walking Ballista": `Name:Walking Ballista
ManaCost:X X
Types:Artifact Creature Construct
PT:0/0
K:etbCounter:P1P1:X
A:AB$ DealDamage | Cost$ SubCounter<1/P1P1> | NumDmg$ 1 | ValidTgts$ Creature,Player | SpellDescription$ Ping.
Oracle:Walking Ballista parse.
`,
    },
    players: [
      { life: 20, hand: ["Walking Ballista"], battlefield: [], manaPool: ["C", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 598. Spell — Hangarback Walker in hand.
  {
    id: "hangarback-walker-in-hand-m612",
    description: "Hangarback Walker in hand; X+thopters parse.",
    seed: 0x29d,
    cards: {
      "Hangarback Walker": `Name:Hangarback Walker
ManaCost:X X
Types:Artifact Creature Construct
PT:0/0
K:etbCounter:P1P1:X
A:AB$ PutCounter | Cost$ 1 T | CounterType$ P1P1 | CounterNum$ 1 | Defined$ Self | SpellDescription$ Charge.
T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Card.Self | Execute$ TrigToken | TriggerDescription$ Thopters on death.
SVar:TrigToken:DB$ Token | TokenAmount$ X | TokenScript$ c_1_1_a_thopter_flying
SVar:X:Count$CardCounters.P1P1
Oracle:Hangarback Walker parse.
`,
    },
    players: [
      { life: 20, hand: ["Hangarback Walker"], battlefield: [], manaPool: ["C", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 599. Spell — Endless One in hand.
  {
    id: "endless-one-in-hand",
    description: "Endless One in hand; X cmc 0/0 etb-counters parse.",
    seed: 0x29e,
    cards: {
      "Endless One": `Name:Endless One
ManaCost:X
Types:Creature Eldrazi
PT:0/0
K:etbCounter:P1P1:X
Oracle:Endless One parse.
`,
    },
    players: [
      { life: 20, hand: ["Endless One"], battlefield: [], manaPool: ["C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 600. Spell — Fleecemane Lion in hand.
  {
    id: "fleecemane-lion-monstrous-in-hand",
    description: "Fleecemane Lion in hand; monstrous activation parse.",
    seed: 0x29f,
    cards: {
      "Fleecemane Lion": `Name:Fleecemane Lion
ManaCost:G W
Types:Creature Cat
PT:3/3
A:AB$ PutCounter | Cost$ 3 G W | CounterType$ MONSTROUS | CounterNum$ 1 | MonstrosityNum$ 1 | Defined$ Self | SpellDescription$ Monstrous.
S:Mode$ Continuous | Affected$ Card.Self+isMonstrous | AddKeyword$ Hexproof & Indestructible | Description$ Hex+Indes.
Oracle:Fleecemane Lion parse.
`,
    },
    players: [
      { life: 20, hand: ["Fleecemane Lion"], battlefield: [], manaPool: ["G", "W"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 601. Spell — Polukranos, World Eater in hand.
  {
    id: "polukranos-monstrous-in-hand",
    description: "Polukranos, World Eater in hand; monstrous fight parse.",
    seed: 0x2a0,
    cards: {
      "Polukranos, World Eater": `Name:Polukranos, World Eater
ManaCost:2 G G
Types:Legendary Creature Hydra
PT:5/5
A:AB$ PutCounter | Cost$ X X G | CounterType$ MONSTROUS | CounterNum$ 1 | MonstrosityNum$ X | Defined$ Self | SubAbility$ DBDmg | SpellDescription$ Monstrous.
SVar:DBDmg:DB$ DealDamage | NumDmg$ X | ValidTgts$ Creature.OppCtrl | TargetMin$ 1 | TargetMax$ 99 | DivideOnResolution$ True
SVar:X:Count$xPaid
Oracle:Polukranos parse.
`,
    },
    players: [
      { life: 20, hand: ["Polukranos, World Eater"], battlefield: [], manaPool: ["G", "G", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 602. Spell — Heroic — Akroan Crusader in hand.
  {
    id: "akroan-crusader-heroic-in-hand",
    description: "Akroan Crusader in hand; heroic token parse.",
    seed: 0x2a1,
    cards: {
      "Akroan Crusader": `Name:Akroan Crusader
ManaCost:R
Types:Creature Human Soldier
PT:1/1
T:Mode$ SpellCast | TargetsValid$ Card.Self | ValidActivatingPlayer$ You | Execute$ TrigToken | TriggerDescription$ Heroic.
SVar:TrigToken:DB$ Token | TokenAmount$ 1 | TokenScript$ r_1_1_soldier_haste
Oracle:Akroan Crusader parse.
`,
    },
    players: [
      { life: 20, hand: ["Akroan Crusader"], battlefield: [], manaPool: ["R"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 603. Spell — Murktide Regent in hand.
  {
    id: "murktide-regent-in-hand",
    description: "Murktide Regent in hand; delve dragon parse.",
    seed: 0x2a2,
    cards: {
      "Murktide Regent": `Name:Murktide Regent
ManaCost:5 U U
Types:Creature Dragon
PT:3/3
K:Flying
K:Delve
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigCounters
SVar:TrigCounters:DB$ PutCounter | Defined$ Self | CounterType$ P1P1 | CounterNum$ X
SVar:X:Count$ValidExile Instant.YouOwn,Sorcery.YouOwn
Oracle:Murktide parse.
`,
    },
    players: [
      { life: 20, hand: ["Murktide Regent"], battlefield: [], manaPool: ["U", "U", "C", "C", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 604. Spell — Ragavan, Nimble Pilferer in hand.
  {
    id: "ragavan-nimble-pilferer-in-hand",
    description: "Ragavan in hand; dash + treasure on damage parse.",
    seed: 0x2a3,
    cards: {
      "Ragavan, Nimble Pilferer": `Name:Ragavan, Nimble Pilferer
ManaCost:R
Types:Legendary Creature Monkey Pirate
PT:2/1
T:Mode$ DamageDone | ValidSource$ Card.Self | ValidTarget$ Player | CombatDamage$ True | Execute$ TrigTreasure
SVar:TrigTreasure:DB$ Token | TokenScript$ c_a_treasure_sac | TokenAmount$ 1
K:Dash:1 R
Oracle:Ragavan parse.
`,
    },
    players: [
      { life: 20, hand: ["Ragavan, Nimble Pilferer"], battlefield: [], manaPool: ["R", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 605. Spell — Ledger Shredder in hand.
  {
    id: "ledger-shredder-in-hand",
    description: "Ledger Shredder in hand; connive trigger parse.",
    seed: 0x2a4,
    cards: {
      "Ledger Shredder": `Name:Ledger Shredder
ManaCost:1 U
Types:Creature Bird Advisor
PT:1/3
K:Flying
T:Mode$ SpellCast | ValidPlayer$ Any | Execute$ TrigConnive | TriggerZones$ Battlefield | OncePerTurn$ True
SVar:TrigConnive:DB$ Connive | Defined$ Self | Amount$ 1
Oracle:Ledger Shredder parse.
`,
    },
    players: [
      { life: 20, hand: ["Ledger Shredder"], battlefield: [], manaPool: ["U", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 606. Spell — Solitude in hand.
  {
    id: "solitude-in-hand",
    description: "Solitude in hand; evoke pitch white parse.",
    seed: 0x2a5,
    cards: {
      Solitude: `Name:Solitude
ManaCost:3 W W
Types:Creature Elemental Incarnation
PT:3/2
K:Flash
K:Lifelink
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigExile
SVar:TrigExile:DB$ ChangeZone | Origin$ Battlefield | Destination$ Exile | TargetType$ Card | ValidTgts$ Creature.OppCtrl
K:Evoke:Exile<1/Card.White+nonLegendary+YouOwn+inZoneHand+Other>
Oracle:Solitude parse.
`,
    },
    players: [
      { life: 20, hand: ["Solitude"], battlefield: [], manaPool: ["W", "W", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 607. Spell — Subtlety in hand.
  {
    id: "subtlety-in-hand",
    description: "Subtlety in hand; evoke pitch blue parse.",
    seed: 0x2a6,
    cards: {
      Subtlety: `Name:Subtlety
ManaCost:3 U U
Types:Creature Elemental Incarnation
PT:3/3
K:Flash
K:Flying
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigBounce
SVar:TrigBounce:DB$ ChangeZone | Origin$ Battlefield,Stack | Destination$ Library | LibraryPosition$ -1 | TargetType$ Card | ValidTgts$ Permanent.OppCtrl,Spell.OppCtrl
K:Evoke:Exile<1/Card.Blue+nonLegendary+YouOwn+inZoneHand+Other>
Oracle:Subtlety parse.
`,
    },
    players: [
      { life: 20, hand: ["Subtlety"], battlefield: [], manaPool: ["U", "U", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 608. Spell — Endurance in hand.
  {
    id: "endurance-in-hand",
    description: "Endurance in hand; evoke pitch green parse.",
    seed: 0x2a7,
    cards: {
      Endurance: `Name:Endurance
ManaCost:1 G G G
Types:Creature Elemental Incarnation
PT:3/4
K:Flash
K:Reach
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigShuffle
SVar:TrigShuffle:DB$ ChangeZoneAll | ChangeType$ Card.YouCtrl | Origin$ Graveyard | Destination$ Library | Shuffle$ True
K:Evoke:Exile<1/Card.Green+nonLegendary+YouOwn+inZoneHand+Other>
Oracle:Endurance parse.
`,
    },
    players: [
      { life: 20, hand: ["Endurance"], battlefield: [], manaPool: ["G", "G", "G", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 609. Spell — Grief in hand.
  {
    id: "grief-in-hand",
    description: "Grief in hand; evoke pitch black parse.",
    seed: 0x2a8,
    cards: {
      Grief: `Name:Grief
ManaCost:2 B B
Types:Creature Elemental Incarnation
PT:3/2
K:Flash
K:Menace
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDiscard
SVar:TrigDiscard:DB$ Discard | Mode$ TgtChoose | NumCards$ 1 | RevealNumber$ All | RevealValid$ Card.nonLand | Defined$ Player.Opponent
K:Evoke:Exile<1/Card.Black+nonLegendary+YouOwn+inZoneHand+Other>
Oracle:Grief parse.
`,
    },
    players: [
      { life: 20, hand: ["Grief"], battlefield: [], manaPool: ["B", "B", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 610. Spell — Fury in hand.
  {
    id: "fury-in-hand",
    description: "Fury in hand; evoke pitch red parse.",
    seed: 0x2a9,
    cards: {
      Fury: `Name:Fury
ManaCost:3 R R
Types:Creature Elemental Incarnation
PT:3/3
K:Double Strike
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDmg
SVar:TrigDmg:DB$ DealDamage | NumDmg$ 4 | ValidTgts$ Creature.OppCtrl,Player.Opponent | DivideOnResolution$ True | TargetMin$ 1 | TargetMax$ 4
K:Evoke:Exile<1/Card.Red+nonLegendary+YouOwn+inZoneHand+Other>
Oracle:Fury parse.
`,
    },
    players: [
      { life: 20, hand: ["Fury"], battlefield: [], manaPool: ["R", "R", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 611. Spell — Daze in hand.
  {
    id: "daze-in-hand",
    description: "Daze in hand; alt-cost return island parse.",
    seed: 0x2aa,
    cards: {
      Daze: `Name:Daze
ManaCost:1 U
Types:Instant
A:SP$ Counter | Cost$ 1 U | TargetType$ Spell | ValidTgts$ Card | TgtPrompt$ Counter | UnlessCost$ 1 | UnlessSwitched$ True | SpellDescription$ Daze.
A:SP$ Counter | Cost$ Return<1/Island.YouCtrl> | TargetType$ Spell | ValidTgts$ Card | TgtPrompt$ Counter | UnlessCost$ 1 | UnlessSwitched$ True | SpellDescription$ Daze alt.
Oracle:Daze parse.
`,
    },
    players: [
      { life: 20, hand: ["Daze"], battlefield: [], manaPool: ["U", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 612. Spell — Sheoldred, the Apocalypse (m613) in hand.
  {
    id: "sheoldred-the-apocalypse-m613-in-hand",
    description: "Sheoldred M613 in hand; symmetric draw drain parse.",
    seed: 0x2ab,
    cards: {
      "Sheoldred, the Apocalypse M613": `Name:Sheoldred, the Apocalypse M613
ManaCost:2 B B
Types:Legendary Creature Phyrexian Praetor
PT:4/5
K:Deathtouch
T:Mode$ Drawn | ValidCard$ Card | ValidPlayer$ You | Execute$ TrigGain | TriggerDescription$ Gain 2 you draw.
SVar:TrigGain:DB$ GainLife | Defined$ You | LifeAmount$ 2
T:Mode$ Drawn | ValidCard$ Card | ValidPlayer$ Opponent | Execute$ TrigLose | TriggerDescription$ Opp loses 2 they draw.
SVar:TrigLose:DB$ LoseLife | Defined$ TriggeredPlayer | LifeAmount$ 2
Oracle:Sheoldred M613 parse.
`,
    },
    players: [
      { life: 20, hand: ["Sheoldred, the Apocalypse M613"], battlefield: [], manaPool: ["B", "B", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 613. Spell — Atraxa, Grand Unifier in hand.
  {
    id: "atraxa-grand-unifier-in-hand",
    description: "Atraxa Grand Unifier in hand; reveal-7 etb parse.",
    seed: 0x2ac,
    cards: {
      "Atraxa, Grand Unifier": `Name:Atraxa, Grand Unifier
ManaCost:3 W U B G
Types:Legendary Creature Phyrexian Angel
PT:7/7
K:Flying
K:Vigilance
K:Deathtouch
K:Lifelink
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigReveal
SVar:TrigReveal:DB$ Dig | DigNum$ 7 | ChangeNum$ All | DestinationZone$ Hand | ChangeValid$ Artifact,Creature,Enchantment,Land,Planeswalker,Instant,Sorcery,Battle | RestRandomOrder$ True
Oracle:Atraxa parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Atraxa, Grand Unifier"],
        battlefield: [],
        manaPool: ["W", "U", "B", "G", "C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 614. Spell — Fable of the Mirror-Breaker in hand.
  {
    id: "fable-of-the-mirror-breaker-in-hand",
    description: "Fable of the Mirror-Breaker in hand; saga 3-chapter parse.",
    seed: 0x2ad,
    cards: {
      "Fable of the Mirror-Breaker": `Name:Fable of the Mirror-Breaker
ManaCost:2 R
Types:Enchantment Saga
K:Chapter:3:DBToken,DBLoot,DBCopy
SVar:DBToken:DB$ Token | TokenScript$ r_2_2_goblin_shaman_treasure | TokenAmount$ 1
SVar:DBLoot:DB$ Discard | Mode$ TgtChoose | NumCards$ 99 | AnyNumber$ True | SubAbility$ DBDraw
SVar:DBDraw:DB$ Draw | NumCards$ X | References$ X
SVar:X:Count$DiscardedThisTurnByYou
SVar:DBCopy:DB$ Transform | Defined$ Self
Oracle:Fable parse.
`,
    },
    players: [
      { life: 20, hand: ["Fable of the Mirror-Breaker"], battlefield: [], manaPool: ["R", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 615. Spell — Sunfall in hand.
  {
    id: "sunfall-in-hand",
    description: "Sunfall in hand; mass-exile + incubator parse.",
    seed: 0x2ae,
    cards: {
      Sunfall: `Name:Sunfall
ManaCost:4 W W
Types:Sorcery
A:SP$ ChangeZoneAll | Cost$ 4 W W | ChangeType$ Creature | Origin$ Battlefield | Destination$ Exile | SubAbility$ DBToken | SpellDescription$ Sunfall.
SVar:DBToken:DB$ Token | TokenScript$ c_x_incubator | TokenAmount$ 1 | References$ X
SVar:X:Count$ExiledThisTurn
Oracle:Sunfall parse.
`,
    },
    players: [
      { life: 20, hand: ["Sunfall"], battlefield: [], manaPool: ["W", "W", "C", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 616. Spell — The Wandering Emperor in hand.
  {
    id: "the-wandering-emperor-in-hand",
    description: "The Wandering Emperor in hand; flash PW parse.",
    seed: 0x2af,
    cards: {
      "The Wandering Emperor": `Name:The Wandering Emperor
ManaCost:2 W W
Types:Legendary Planeswalker Wanderer
Loyalty:3
K:Flash
A:AB$ PutCounter | Cost$ AddCounter<1/LOYALTY> | Planeswalker$ True | CounterType$ LOYALTY | CounterNum$ 1 | SubAbility$ DBToken | Defined$ Self | SpellDescription$ +1.
SVar:DBToken:DB$ Token | TokenScript$ w_2_2_samurai_doublestrike | TokenAmount$ 1
A:AB$ Pump | Cost$ SubCounter<1/LOYALTY> | Planeswalker$ True | ValidTgts$ Creature | NumAtt$ +1 | NumDef$ +1 | KW$ Lifelink | SpellDescription$ -1.
A:AB$ DestroyAll | Cost$ SubCounter<2/LOYALTY> | Planeswalker$ True | ValidCards$ Creature.tapped+OppCtrl | SpellDescription$ -2.
Oracle:Emperor parse.
`,
    },
    players: [
      { life: 20, hand: ["The Wandering Emperor"], battlefield: [], manaPool: ["W", "W", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 617. Spell — Boseiju, Who Endures (m613) in hand.
  {
    id: "boseiju-who-endures-m613-in-hand",
    description: "Boseiju Who Endures M613 in hand; channel land parse.",
    seed: 0x2b0,
    cards: {
      "Boseiju, Who Endures M613": `Name:Boseiju, Who Endures M613
Types:Legendary Land
A:AB$ Mana | Cost$ T | Produced$ G
A:AB$ Destroy | Cost$ 1 G ExileFromHand<1/Card.Self> | TargetType$ Card | ValidTgts$ Artifact,Enchantment,Land.nonBasic | SpellDescription$ Channel.
Oracle:Boseiju M613 parse.
`,
    },
    players: [
      { life: 20, hand: ["Boseiju, Who Endures M613"], battlefield: [], manaPool: ["G", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 618. Spell — Fierce Guardianship in hand.
  {
    id: "fierce-guardianship-in-hand",
    description: "Fierce Guardianship in hand; commander free counter parse.",
    seed: 0x2b1,
    cards: {
      "Fierce Guardianship": `Name:Fierce Guardianship
ManaCost:2 U
Types:Instant
A:SP$ Counter | Cost$ 2 U | TargetType$ Spell | ValidTgts$ Card.nonCreature | TgtPrompt$ Counter | SpellDescription$ Counter.
A:SP$ Counter | Cost$ 0 | PresentDefined$ Commander.YouCtrl | IsPresent$ Permanent | TargetType$ Spell | ValidTgts$ Card.nonCreature | SpellDescription$ Free.
Oracle:Fierce Guardianship parse.
`,
    },
    players: [
      { life: 20, hand: ["Fierce Guardianship"], battlefield: [], manaPool: ["U", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 619. Spell — Deflecting Swat in hand.
  {
    id: "deflecting-swat-in-hand",
    description: "Deflecting Swat in hand; redirect alt-cost parse.",
    seed: 0x2b2,
    cards: {
      "Deflecting Swat": `Name:Deflecting Swat
ManaCost:3 R
Types:Instant
A:SP$ ChangeTargets | Cost$ 3 R | TargetType$ Spell,Ability | ValidTgts$ Card | TgtPrompt$ Redirect | SpellDescription$ Redirect.
A:SP$ ChangeTargets | Cost$ 0 | PresentDefined$ Commander.YouCtrl | IsPresent$ Permanent | TargetType$ Spell,Ability | ValidTgts$ Card | SpellDescription$ Free.
Oracle:Deflecting Swat parse.
`,
    },
    players: [
      { life: 20, hand: ["Deflecting Swat"], battlefield: [], manaPool: ["R", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 620. Spell — Exquisite Blood in hand.
  {
    id: "exquisite-blood-in-hand",
    description: "Exquisite Blood in hand; mirror lifegain trigger parse.",
    seed: 0x2b3,
    cards: {
      "Exquisite Blood": `Name:Exquisite Blood
ManaCost:4 B
Types:Enchantment
T:Mode$ LifeLost | ValidPlayer$ Opponent | Execute$ TrigGain | TriggerDescription$ Gain that much.
SVar:TrigGain:DB$ GainLife | Defined$ You | LifeAmount$ X | References$ X
SVar:X:TriggerCount$LifeAmount
Oracle:Exquisite Blood parse.
`,
    },
    players: [
      { life: 20, hand: ["Exquisite Blood"], battlefield: [], manaPool: ["B", "C", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 621. Spell — Sanguine Bond in hand.
  {
    id: "sanguine-bond-in-hand",
    description: "Sanguine Bond in hand; mirror lifedrain trigger parse.",
    seed: 0x2b4,
    cards: {
      "Sanguine Bond": `Name:Sanguine Bond
ManaCost:3 B B
Types:Enchantment
T:Mode$ LifeGained | ValidPlayer$ You | Execute$ TrigDrain | TriggerDescription$ Drain.
SVar:TrigDrain:DB$ LoseLife | Defined$ Player.Opponent | LifeAmount$ X | References$ X
SVar:X:TriggerCount$LifeAmount
Oracle:Sanguine Bond parse.
`,
    },
    players: [
      { life: 20, hand: ["Sanguine Bond"], battlefield: [], manaPool: ["B", "B", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 622. Spell — Profane Procession in hand.
  {
    id: "profane-procession-in-hand",
    description: "Profane Procession in hand; double-faced enchantment exile parse.",
    seed: 0x2b5,
    cards: {
      "Profane Procession": `Name:Profane Procession
ManaCost:1 W B
Types:Legendary Enchantment
A:AB$ ChangeZone | Cost$ 1 W B T | TargetType$ Card | ValidTgts$ Creature.OppCtrl | Origin$ Battlefield | Destination$ Exile | RememberChanged$ True | SpellDescription$ Exile.
Oracle:Profane Procession parse.
`,
    },
    players: [
      { life: 20, hand: ["Profane Procession"], battlefield: [], manaPool: ["W", "B", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 623. Spell — Vigilante Justice in hand.
  {
    id: "vigilante-justice-in-hand",
    description: "Vigilante Justice in hand; ETB-ping enchantment parse.",
    seed: 0x2b6,
    cards: {
      "Vigilante Justice": `Name:Vigilante Justice
ManaCost:3 R
Types:Enchantment
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Creature.YouCtrl | Execute$ TrigDmg | TriggerDescription$ Ping 1.
SVar:TrigDmg:DB$ DealDamage | NumDmg$ 1 | ValidTgts$ Any
Oracle:Vigilante Justice parse.
`,
    },
    players: [
      { life: 20, hand: ["Vigilante Justice"], battlefield: [], manaPool: ["R", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 624. Spell — Necropotence in hand.
  {
    id: "necropotence-in-hand",
    description: "Necropotence in hand; pay-life draw parse.",
    seed: 0x2b7,
    cards: {
      Necropotence: `Name:Necropotence
ManaCost:B B B
Types:Enchantment
S:Mode$ Continuous | Affected$ You | AddKeyword$ Skip your draw step. | Description$ Skip draw.
A:AB$ Draw | Cost$ PayLife<1> | NumCards$ 1 | ActivationLimit$ 99 | SpellDescription$ Pay 1 life: Exile next draw.
Oracle:Necropotence parse.
`,
    },
    players: [
      { life: 20, hand: ["Necropotence"], battlefield: [], manaPool: ["B", "B", "B"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 625. Spell — Sol Ring (m613) in hand.
  {
    id: "sol-ring-m613-in-hand",
    description: "Sol Ring M613 in hand; CC artifact ramp parse.",
    seed: 0x2b8,
    cards: {
      "Sol Ring M613": `Name:Sol Ring M613
ManaCost:1
Types:Artifact
A:AB$ Mana | Cost$ T | Produced$ C | Amount$ 2 | SpellDescription$ CC.
Oracle:Sol Ring M613 parse.
`,
    },
    players: [
      { life: 20, hand: ["Sol Ring M613"], battlefield: [], manaPool: ["C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 626. Spell — Mox Pearl in hand.
  {
    id: "mox-pearl-in-hand",
    description: "Mox Pearl in hand; W mox parse.",
    seed: 0x2b9,
    cards: {
      "Mox Pearl": `Name:Mox Pearl
ManaCost:0
Types:Artifact
A:AB$ Mana | Cost$ T | Produced$ W
Oracle:Mox Pearl parse.
`,
    },
    players: [
      { life: 20, hand: ["Mox Pearl"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 627. Spell — Mox Ruby in hand.
  {
    id: "mox-ruby-in-hand",
    description: "Mox Ruby in hand; R mox parse.",
    seed: 0x2ba,
    cards: {
      "Mox Ruby": `Name:Mox Ruby
ManaCost:0
Types:Artifact
A:AB$ Mana | Cost$ T | Produced$ R
Oracle:Mox Ruby parse.
`,
    },
    players: [
      { life: 20, hand: ["Mox Ruby"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 628. Spell — Mox Emerald in hand.
  {
    id: "mox-emerald-in-hand",
    description: "Mox Emerald in hand; G mox parse.",
    seed: 0x2bb,
    cards: {
      "Mox Emerald": `Name:Mox Emerald
ManaCost:0
Types:Artifact
A:AB$ Mana | Cost$ T | Produced$ G
Oracle:Mox Emerald parse.
`,
    },
    players: [
      { life: 20, hand: ["Mox Emerald"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 629. Spell — Mox Jet in hand.
  {
    id: "mox-jet-in-hand",
    description: "Mox Jet in hand; B mox parse.",
    seed: 0x2bc,
    cards: {
      "Mox Jet": `Name:Mox Jet
ManaCost:0
Types:Artifact
A:AB$ Mana | Cost$ T | Produced$ B
Oracle:Mox Jet parse.
`,
    },
    players: [
      { life: 20, hand: ["Mox Jet"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 630. Spell — Demonic Tutor (m613) in hand.
  {
    id: "demonic-tutor-m613-in-hand",
    description: "Demonic Tutor M613 in hand; tutor parse.",
    seed: 0x2bd,
    cards: {
      "Demonic Tutor M613": `Name:Demonic Tutor M613
ManaCost:1 B
Types:Sorcery
A:SP$ ChangeZone | Cost$ 1 B | Origin$ Library | Destination$ Hand | ChangeNum$ 1 | SpellDescription$ Tutor.
Oracle:Demonic Tutor M613 parse.
`,
    },
    players: [
      { life: 20, hand: ["Demonic Tutor M613"], battlefield: [], manaPool: ["B", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 631. Spell — Imperial Seal (m613) in hand.
  {
    id: "imperial-seal-m613-in-hand",
    description: "Imperial Seal M613 in hand; sorcery tutor-to-top parse.",
    seed: 0x2be,
    cards: {
      "Imperial Seal M613": `Name:Imperial Seal M613
ManaCost:B
Types:Sorcery
A:SP$ ChangeZone | Cost$ B PayLife<2> | Origin$ Library | Destination$ Hand | ChangeNum$ 1 | RememberLeftBehind$ True | SpellDescription$ Tutor top.
Oracle:Imperial Seal M613 parse.
`,
    },
    players: [
      { life: 20, hand: ["Imperial Seal M613"], battlefield: [], manaPool: ["B"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 632. Spell — Vampiric Tutor (m613) in hand.
  {
    id: "vampiric-tutor-m613-in-hand",
    description: "Vampiric Tutor M613 in hand; instant tutor-to-top parse.",
    seed: 0x2bf,
    cards: {
      "Vampiric Tutor M613": `Name:Vampiric Tutor M613
ManaCost:B
Types:Instant
A:SP$ ChangeZone | Cost$ B PayLife<2> | Origin$ Library | Destination$ Library | LibraryPosition$ 0 | ChangeNum$ 1 | SpellDescription$ Top.
Oracle:Vampiric Tutor M613 parse.
`,
    },
    players: [
      { life: 20, hand: ["Vampiric Tutor M613"], battlefield: [], manaPool: ["B"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 633. Spell — Yawgmoth's Bargain in hand.
  {
    id: "yawgmoths-bargain-in-hand",
    description: "Yawgmoth's Bargain in hand; pay-life draw parse.",
    seed: 0x2c0,
    cards: {
      "Yawgmoth's Bargain": `Name:Yawgmoth's Bargain
ManaCost:4 B B
Types:Enchantment
S:Mode$ Continuous | Affected$ You | AddKeyword$ Skip your draw step. | Description$ Skip draw.
A:AB$ Draw | Cost$ PayLife<1> | NumCards$ 1 | SpellDescription$ Bargain.
Oracle:Bargain parse.
`,
    },
    players: [
      { life: 20, hand: ["Yawgmoth's Bargain"], battlefield: [], manaPool: ["B", "B", "C", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 634. Spell — Channel (m613) in hand.
  {
    id: "channel-m613-in-hand",
    description: "Channel M613 in hand; life-to-mana parse.",
    seed: 0x2c1,
    cards: {
      "Channel M613": `Name:Channel M613
ManaCost:G G
Types:Sorcery
A:SP$ Effect | Cost$ G G | Triggers$ ChannelTrig | SpellDescription$ Channel.
SVar:ChannelTrig:Mode$ Activated | Trigger$ Mana | Cost$ PayLife<1> | Produced$ C
Oracle:Channel M613 parse.
`,
    },
    players: [
      { life: 20, hand: ["Channel M613"], battlefield: [], manaPool: ["G", "G"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 635. Spell — Black Lotus (m613) in hand.
  {
    id: "black-lotus-m613-in-hand",
    description: "Black Lotus M613 in hand; sac add 3 parse.",
    seed: 0x2c2,
    cards: {
      "Black Lotus M613": `Name:Black Lotus M613
ManaCost:0
Types:Artifact
A:AB$ Mana | Cost$ T Sac<1/CARDNAME> | Produced$ Combo W U B R G | Amount$ 3 | SpellDescription$ Sac add 3.
Oracle:Black Lotus M613 parse.
`,
    },
    players: [
      { life: 20, hand: ["Black Lotus M613"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 636. Spell — Mind Twist (m613) in hand.
  {
    id: "mind-twist-m613-in-hand",
    description: "Mind Twist M613 in hand; X random discard parse.",
    seed: 0x2c3,
    cards: {
      "Mind Twist M613": `Name:Mind Twist M613
ManaCost:X B
Types:Sorcery
A:SP$ Discard | Cost$ X B | Defined$ Player.Opponent | NumCards$ X | Mode$ Random | SpellDescription$ Mind Twist.
SVar:X:Count$xPaid
Oracle:Mind Twist M613 parse.
`,
    },
    players: [
      { life: 20, hand: ["Mind Twist M613"], battlefield: [], manaPool: ["B", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 637. Spell — Hardened Scales in hand.
  {
    id: "hardened-scales-in-hand",
    description: "Hardened Scales in hand; +1 P1P1 replacement parse.",
    seed: 0x2c4,
    cards: {
      "Hardened Scales": `Name:Hardened Scales
ManaCost:G
Types:Enchantment
R:Event$ AddCounter | ActiveZones$ Battlefield | ValidCard$ Creature.YouCtrl | CounterType$ P1P1 | ReplaceWith$ AddOne | Description$ +1.
SVar:AddOne:DB$ ReplaceCounter | AddAmount$ 1
Oracle:Hardened Scales parse.
`,
    },
    players: [
      { life: 20, hand: ["Hardened Scales"], battlefield: [], manaPool: ["G"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 638. Spell — The Ozolith in hand.
  {
    id: "the-ozolith-in-hand",
    description: "The Ozolith in hand; counter recapture parse.",
    seed: 0x2c5,
    cards: {
      "The Ozolith": `Name:The Ozolith
ManaCost:1
Types:Legendary Artifact
T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard,Exile,Hand,Library | ValidCard$ Creature.YouCtrl | Execute$ TrigRemember | TriggerDescription$ Remember.
SVar:TrigRemember:DB$ Effect | RememberObjects$ Self
T:Mode$ Phase | Phase$ BeginCombat | ValidPlayer$ You | Execute$ TrigMove
SVar:TrigMove:DB$ MoveCounter | Source$ Self | Defined$ Creature.YouCtrl | CounterNum$ All
Oracle:The Ozolith parse.
`,
    },
    players: [
      { life: 20, hand: ["The Ozolith"], battlefield: [], manaPool: ["C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 639. Spell — Mishra's Foundry in hand.
  {
    id: "mishras-foundry-in-hand",
    description: "Mishra's Foundry in hand; manland parse.",
    seed: 0x2c6,
    cards: {
      "Mishra's Foundry": `Name:Mishra's Foundry
Types:Land
A:AB$ Mana | Cost$ T | Produced$ C
A:AB$ Animate | Cost$ 1 T | Defined$ Self | Power$ 2 | Toughness$ 2 | Types$ Creature,Artifact,Assembly-Worker | UntilEOT$ True | SpellDescription$ Animate.
A:AB$ Pump | Cost$ T | ValidTgts$ Creature.named_Assembly-Worker | NumAtt$ +1 | NumDef$ +1 | SpellDescription$ Pump worker.
Oracle:Foundry parse.
`,
    },
    players: [
      { life: 20, hand: ["Mishra's Foundry"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 640. Spell — Mutavault (m613) in hand.
  {
    id: "mutavault-m613-in-hand",
    description: "Mutavault M613 in hand; manland tribal parse.",
    seed: 0x2c7,
    cards: {
      "Mutavault M613": `Name:Mutavault M613
Types:Land
A:AB$ Mana | Cost$ T | Produced$ C
A:AB$ Animate | Cost$ 1 T | Defined$ Self | Power$ 2 | Toughness$ 2 | Types$ Creature | UntilEOT$ True | SpellDescription$ Animate.
Oracle:Mutavault M613 parse.
`,
    },
    players: [
      { life: 20, hand: ["Mutavault M613"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 641. Spell — Field of the Dead (m613) in hand.
  {
    id: "field-of-the-dead-m613-in-hand",
    description: "Field of the Dead M613 in hand; zombie on land etb parse.",
    seed: 0x2c8,
    cards: {
      "Field of the Dead M613": `Name:Field of the Dead M613
Types:Land
A:AB$ Mana | Cost$ T | Produced$ C
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Land.YouCtrl | CheckSecondaryPresent$ Lands.YouCtrl+differentnames | References$ X | Execute$ TrigToken
SVar:TrigToken:DB$ Token | TokenScript$ b_2_2_zombie | TokenAmount$ 1
SVar:X:Count$ValidPermanents Land.YouCtrl
Oracle:Field of the Dead M613 parse.
`,
    },
    players: [
      { life: 20, hand: ["Field of the Dead M613"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 642. Spell — Strip Mine (m613) in hand.
  {
    id: "strip-mine-m613-in-hand",
    description: "Strip Mine M613 in hand; sac destroy land parse.",
    seed: 0x2c9,
    cards: {
      "Strip Mine M613": `Name:Strip Mine M613
Types:Land
A:AB$ Mana | Cost$ T | Produced$ C
A:AB$ Destroy | Cost$ T Sac<1/CARDNAME> | TargetType$ Card | ValidTgts$ Land | SpellDescription$ Strip.
Oracle:Strip Mine M613 parse.
`,
    },
    players: [
      { life: 20, hand: ["Strip Mine M613"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 643. Spell — Thespian's Stage in hand.
  {
    id: "thespians-stage-in-hand",
    description: "Thespian's Stage in hand; copy land parse.",
    seed: 0x2ca,
    cards: {
      "Thespian's Stage": `Name:Thespian's Stage
Types:Land
A:AB$ Mana | Cost$ T | Produced$ C
A:AB$ CopyPermanent | Cost$ 2 T | TargetType$ Card | ValidTgts$ Land | Defined$ Self | SpellDescription$ Copy.
Oracle:Thespian's Stage parse.
`,
    },
    players: [
      { life: 20, hand: ["Thespian's Stage"], battlefield: [], manaPool: ["C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 644. Spell — Karn Liberated in hand.
  {
    id: "karn-liberated-in-hand",
    description: "Karn Liberated in hand; PW exile abilities parse.",
    seed: 0x2cb,
    cards: {
      "Karn Liberated": `Name:Karn Liberated
ManaCost:7
Types:Legendary Planeswalker Karn
Loyalty:6
A:AB$ ChangeZone | Cost$ AddCounter<4/LOYALTY> | Planeswalker$ True | Origin$ Hand,Battlefield | Destination$ Exile | TargetType$ Card | ValidTgts$ Card.OppCtrl | SpellDescription$ +4.
A:AB$ ChangeZone | Cost$ SubCounter<3/LOYALTY> | Planeswalker$ True | Origin$ Battlefield | Destination$ Exile | TargetType$ Card | ValidTgts$ Permanent | SpellDescription$ -3.
A:AB$ RestartGame | Cost$ SubCounter<14/LOYALTY> | Planeswalker$ True | SpellDescription$ -14.
Oracle:Karn Liberated parse.
`,
    },
    players: [
      { life: 20, hand: ["Karn Liberated"], battlefield: [], manaPool: ["C", "C", "C", "C", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 645. Spell — Ugin, the Spirit Dragon in hand.
  {
    id: "ugin-spirit-dragon-in-hand",
    description: "Ugin Spirit Dragon in hand; PW colorless wipe parse.",
    seed: 0x2cc,
    cards: {
      "Ugin, the Spirit Dragon": `Name:Ugin, the Spirit Dragon
ManaCost:8
Types:Legendary Planeswalker Ugin
Loyalty:7
A:AB$ DealDamage | Cost$ AddCounter<2/LOYALTY> | Planeswalker$ True | NumDmg$ 3 | ValidTgts$ Creature,Player | TgtPrompt$ +2 | SpellDescription$ +2.
A:AB$ ChangeZoneAll | Cost$ SubCounter<X/LOYALTY> | Planeswalker$ True | ChangeType$ Permanent.cmcLEX+nonColorless | Origin$ Battlefield | Destination$ Exile | References$ X | SpellDescription$ -X.
SVar:X:Count$xPaid
A:AB$ GainLife | Cost$ SubCounter<10/LOYALTY> | Planeswalker$ True | LifeAmount$ 7 | SubAbility$ DBDraw | Defined$ You | SpellDescription$ -10.
SVar:DBDraw:DB$ Draw | NumCards$ 7
Oracle:Ugin parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Ugin, the Spirit Dragon"],
        battlefield: [],
        manaPool: ["C", "C", "C", "C", "C", "C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 646. Spell — Teferi, Hero of Dominaria in hand.
  {
    id: "teferi-hero-of-dominaria-in-hand",
    description: "Teferi Hero of Dominaria in hand; PW untap+exile parse.",
    seed: 0x2cd,
    cards: {
      "Teferi, Hero of Dominaria": `Name:Teferi, Hero of Dominaria
ManaCost:3 W U
Types:Legendary Planeswalker Teferi
Loyalty:4
A:AB$ Draw | Cost$ AddCounter<1/LOYALTY> | Planeswalker$ True | NumCards$ 1 | SubAbility$ DBUntap | SpellDescription$ +1.
SVar:DBUntap:DB$ Untap | TargetMin$ 1 | TargetMax$ 2 | TargetType$ Card | ValidTgts$ Land.YouCtrl
A:AB$ ChangeZone | Cost$ SubCounter<3/LOYALTY> | Planeswalker$ True | TargetType$ Card | ValidTgts$ Permanent.OppCtrl+nonLand | Origin$ Battlefield | Destination$ Library | LibraryPosition$ -1 | SpellDescription$ -3.
A:AB$ Effect | Cost$ SubCounter<8/LOYALTY> | Planeswalker$ True | RememberObjects$ You | StaticAbilities$ TeferiEmblem | SpellDescription$ -8.
Oracle:Teferi parse.
`,
    },
    players: [
      { life: 20, hand: ["Teferi, Hero of Dominaria"], battlefield: [], manaPool: ["W", "U", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 647. Spell — Furnace of Rath in hand.
  {
    id: "furnace-of-rath-in-hand",
    description: "Furnace of Rath in hand; double damage replace parse.",
    seed: 0x2ce,
    cards: {
      "Furnace of Rath": `Name:Furnace of Rath
ManaCost:3 R R
Types:Enchantment
R:Event$ DamageDone | ActiveZones$ Battlefield | ValidSource$ Card | ValidTarget$ Any | ReplaceWith$ DBDouble | Description$ Double.
SVar:DBDouble:DB$ ReplaceDamage | Multiplier$ 2
Oracle:Furnace of Rath parse.
`,
    },
    players: [
      { life: 20, hand: ["Furnace of Rath"], battlefield: [], manaPool: ["R", "R", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 648. Spell — Gisela, Blade of Goldnight in hand.
  {
    id: "gisela-blade-of-goldnight-in-hand",
    description: "Gisela Blade of Goldnight in hand; double-damage halve replace parse.",
    seed: 0x2cf,
    cards: {
      "Gisela, Blade of Goldnight": `Name:Gisela, Blade of Goldnight
ManaCost:4 R W W
Types:Legendary Creature Angel
PT:5/5
K:Flying
K:First Strike
R:Event$ DamageDone | ValidSource$ Card | ValidTarget$ Player.You,Card.YouCtrl | ReplaceWith$ DBHalve | Description$ Halve.
SVar:DBHalve:DB$ ReplaceDamage | Multiplier$ 0.5
R:Event$ DamageDone | ValidSource$ Card.YouCtrl | ValidTarget$ Card,Player | ReplaceWith$ DBDouble | Description$ Double.
SVar:DBDouble:DB$ ReplaceDamage | Multiplier$ 2
Oracle:Gisela parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Gisela, Blade of Goldnight"],
        battlefield: [],
        manaPool: ["R", "W", "W", "C", "C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 649. Spell — Ad Nauseam (m613) in hand.
  {
    id: "ad-nauseam-m613-in-hand",
    description: "Ad Nauseam M613 in hand; pay-life dig parse.",
    seed: 0x2d0,
    cards: {
      "Ad Nauseam M613": `Name:Ad Nauseam M613
ManaCost:3 B B
Types:Instant
A:SP$ RepeatEach | Cost$ 3 B B | RepeatSubAbility$ DBReveal | RepeatPresent$ Any | RepeatOptional$ True | SpellDescription$ Ad Nauseam.
SVar:DBReveal:DB$ Reveal | Defined$ TopOfLibrary | SubAbility$ DBLose
SVar:DBLose:DB$ LoseLife | Defined$ You | LifeAmount$ X | References$ X | SubAbility$ DBDraw
SVar:DBDraw:DB$ Draw | NumCards$ 1
SVar:X:Count$ManaCost
Oracle:Ad Nauseam M613 parse.
`,
    },
    players: [
      { life: 20, hand: ["Ad Nauseam M613"], battlefield: [], manaPool: ["B", "B", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 650. Spell — Children of Korlis in hand.
  {
    id: "children-of-korlis-in-hand",
    description: "Children of Korlis in hand; sac restore life parse.",
    seed: 0x2d1,
    cards: {
      "Children of Korlis": `Name:Children of Korlis
ManaCost:1 W
Types:Creature Human Cleric
PT:0/3
A:AB$ GainLife | Cost$ Sac<1/CARDNAME> | LifeAmount$ X | References$ X | SpellDescription$ Sac restore.
SVar:X:Count$LifeYouLostThisTurn
Oracle:Children of Korlis parse.
`,
    },
    players: [
      { life: 20, hand: ["Children of Korlis"], battlefield: [], manaPool: ["W", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 651. Spell — Frantic Inventory in hand.
  {
    id: "frantic-inventory-in-hand",
    description: "Frantic Inventory in hand; X-graveyard draw parse.",
    seed: 0x2d2,
    cards: {
      "Frantic Inventory": `Name:Frantic Inventory
ManaCost:1 U
Types:Instant
A:SP$ Draw | Cost$ 1 U | Defined$ You | NumCards$ X | References$ X | SpellDescription$ Inventory.
SVar:X:Count$Valid Card.YouCtrl+inZoneGraveyard+namedCARDNAME/Plus.1
Oracle:Frantic Inventory parse.
`,
    },
    players: [
      { life: 20, hand: ["Frantic Inventory"], battlefield: [], manaPool: ["U", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 652. Spell — Thirst for Knowledge in hand.
  {
    id: "thirst-for-knowledge-in-hand",
    description: "Thirst for Knowledge in hand; draw-3 then discard parse.",
    seed: 0x2d3,
    cards: {
      "Thirst for Knowledge": `Name:Thirst for Knowledge
ManaCost:2 U
Types:Instant
A:SP$ Draw | Cost$ 2 U | NumCards$ 3 | SubAbility$ DBDiscard | SpellDescription$ Thirst.
SVar:DBDiscard:DB$ Discard | Defined$ You | NumCards$ 2 | Mode$ TgtChoose | UnlessCost$ Discard<1/Card.Artifact> | UnlessSwitched$ True
Oracle:Thirst parse.
`,
    },
    players: [
      { life: 20, hand: ["Thirst for Knowledge"], battlefield: [], manaPool: ["U", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 653. Spell — Inquisition of Kozilek in hand.
  {
    id: "inquisition-of-kozilek-in-hand",
    description: "Inquisition of Kozilek in hand; targeted discard parse.",
    seed: 0x2d4,
    cards: {
      "Inquisition of Kozilek": `Name:Inquisition of Kozilek
ManaCost:B
Types:Sorcery
A:SP$ Discard | Cost$ B | TargetType$ Player | ValidTgts$ Player | NumCards$ 1 | RevealNumber$ All | RevealValid$ Card.cmcLE3 | Mode$ TgtChoose | AnyNumber$ False | SpellDescription$ Inquisition.
Oracle:Inquisition parse.
`,
    },
    players: [
      { life: 20, hand: ["Inquisition of Kozilek"], battlefield: [], manaPool: ["B"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 654. Spell — Damnation (m613) in hand.
  {
    id: "damnation-m613-in-hand",
    description: "Damnation M613 in hand; black wrath parse.",
    seed: 0x2d5,
    cards: {
      "Damnation M613": `Name:Damnation M613
ManaCost:2 B B
Types:Sorcery
A:SP$ DestroyAll | Cost$ 2 B B | NoRegen$ True | ValidCards$ Creature | SpellDescription$ Damnation.
Oracle:Damnation M613 parse.
`,
    },
    players: [
      { life: 20, hand: ["Damnation M613"], battlefield: [], manaPool: ["B", "B", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 655. Spell — Toxic Deluge (m613) in hand.
  {
    id: "toxic-deluge-m613-in-hand",
    description: "Toxic Deluge M613 in hand; X life pay sweeper parse.",
    seed: 0x2d6,
    cards: {
      "Toxic Deluge M613": `Name:Toxic Deluge M613
ManaCost:2 B
Types:Sorcery
A:SP$ PumpAll | Cost$ 2 B PayLife<X> | ValidCards$ Creature | NumDef$ -X | References$ X | NoRegen$ True | SpellDescription$ Deluge.
SVar:X:Count$xPaid
Oracle:Deluge M613 parse.
`,
    },
    players: [
      { life: 20, hand: ["Toxic Deluge M613"], battlefield: [], manaPool: ["B", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 656. Spell — Vanquish the Horde in hand.
  {
    id: "vanquish-the-horde-in-hand",
    description: "Vanquish the Horde in hand; cost-reduces by creature count parse.",
    seed: 0x2d7,
    cards: {
      "Vanquish the Horde": `Name:Vanquish the Horde
ManaCost:5 W W
Types:Sorcery
S:Mode$ ReduceCost | ValidCard$ Card.Self | Type$ Spell | Amount$ X | EffectZone$ All | References$ X | Description$ Cheaper.
A:SP$ DestroyAll | Cost$ 5 W W | ValidCards$ Creature | SpellDescription$ Vanquish.
SVar:X:Count$ValidPermanents Creature
Oracle:Vanquish parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Vanquish the Horde"],
        battlefield: [],
        manaPool: ["W", "W", "C", "C", "C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 657. Spell — Heliod, Sun-Crowned + Walking Ballista combo enabler in hand (m613).
  {
    id: "heliod-walking-ballista-combo-m613-in-hand",
    description: "Heliod combo M613 in hand; lifelink ping combo parse.",
    seed: 0x2d8,
    cards: {
      "Heliod Sun-Crowned M613": `Name:Heliod Sun-Crowned M613
ManaCost:1 W W
Types:Legendary Enchantment Creature God
PT:5/5
K:Indestructible
S:Mode$ Continuous | Affected$ Creature.YouCtrl+counters_GE1_P1P1 | AddKeyword$ Lifelink | Description$ Lifelink.
T:Mode$ LifeGained | ValidPlayer$ You | Execute$ TrigCounter | TriggerDescription$ +1.
SVar:TrigCounter:DB$ PutCounter | CounterType$ P1P1 | CounterNum$ 1 | TargetType$ Card | ValidTgts$ Creature.YouCtrl
Oracle:Heliod parse.
`,
    },
    players: [
      { life: 20, hand: ["Heliod Sun-Crowned M613"], battlefield: [], manaPool: ["W", "W", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 658. Spell — Glasspool Mimic (modal flip) in hand.
  {
    id: "glasspool-mimic-in-hand",
    description: "Glasspool Mimic in hand; MDFC clone parse.",
    seed: 0x2d9,
    cards: {
      "Glasspool Mimic": `Name:Glasspool Mimic
ManaCost:1 U U
Types:Creature Shapeshifter Rogue
PT:2/3
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigClone | OptionalDecider$ You | TriggerDescription$ Clone.
SVar:TrigClone:DB$ Clone | TargetType$ Card | ValidTgts$ Creature.YouCtrl+Other
ALTERNATE
Name:Glasspool Shore
Types:Land
A:AB$ Mana | Cost$ T | Produced$ U | SpellDescription$ Add U.
Oracle:Glasspool Mimic parse.
`,
    },
    players: [
      { life: 20, hand: ["Glasspool Mimic"], battlefield: [], manaPool: ["U", "U", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 659. Spell — Maddening Hex in hand.
  {
    id: "maddening-hex-in-hand",
    description: "Maddening Hex in hand; recurring damage trigger parse.",
    seed: 0x2da,
    cards: {
      "Maddening Hex": `Name:Maddening Hex
ManaCost:2 R
Types:Enchantment Curse Aura
K:Enchant Player
T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | Execute$ TrigDmg | TriggerDescription$ Ping.
SVar:TrigDmg:DB$ DealDamage | NumDmg$ 3 | Defined$ Enchanted
T:Mode$ DamageDone | ValidSource$ Card.Self | Execute$ TrigMove
SVar:TrigMove:DB$ Attach | Defined$ Self | Object$ Player.Opponent | RandomizeTarget$ True
Oracle:Maddening Hex parse.
`,
    },
    players: [
      { life: 20, hand: ["Maddening Hex"], battlefield: [], manaPool: ["R", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 660. Spell — Bloodthirst — Stromkirk Noble in hand.
  {
    id: "stromkirk-noble-bloodthirst-in-hand",
    description: "Stromkirk Noble in hand; bloodthirst-style trigger parse.",
    seed: 0x2db,
    cards: {
      "Stromkirk Noble": `Name:Stromkirk Noble
ManaCost:R
Types:Creature Vampire
PT:1/1
T:Mode$ DamageDone | ValidSource$ Card.Self | ValidTarget$ Player | CombatDamage$ True | Execute$ TrigCounter | TriggerDescription$ +1.
SVar:TrigCounter:DB$ PutCounter | Defined$ Self | CounterType$ P1P1 | CounterNum$ 1
Oracle:Stromkirk Noble parse.
`,
    },
    players: [
      { life: 20, hand: ["Stromkirk Noble"], battlefield: [], manaPool: ["R"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 661. Spell — Bloodthirst — Vampire Aristocrat in hand.
  {
    id: "vampire-aristocrat-bloodthirst-in-hand",
    description: "Vampire Aristocrat in hand; sac pump parse.",
    seed: 0x2dc,
    cards: {
      "Vampire Aristocrat": `Name:Vampire Aristocrat
ManaCost:2 B
Types:Creature Vampire Rogue
PT:2/2
A:AB$ Pump | Cost$ Sac<1/Creature> | NumAtt$ +2 | NumDef$ +2 | SpellDescription$ Sac.
Oracle:Vampire Aristocrat parse.
`,
    },
    players: [
      { life: 20, hand: ["Vampire Aristocrat"], battlefield: [], manaPool: ["B", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 662. Spell — Frenzy — Bloodlust Inciter in hand.
  {
    id: "bloodlust-inciter-frenzy-in-hand",
    description: "Bloodlust Inciter in hand; haste-give parse.",
    seed: 0x2dd,
    cards: {
      "Bloodlust Inciter": `Name:Bloodlust Inciter
ManaCost:R
Types:Creature Human Warrior
PT:1/1
A:AB$ Pump | Cost$ T | TargetType$ Card | ValidTgts$ Creature.YouCtrl+Other | KW$ Haste | SpellDescription$ Haste.
Oracle:Bloodlust Inciter parse.
`,
    },
    players: [
      { life: 20, hand: ["Bloodlust Inciter"], battlefield: [], manaPool: ["R"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 663. Spell — Annihilator — Ulamog the Infinite Gyre in hand.
  {
    id: "ulamog-infinite-gyre-annihilator-in-hand",
    description: "Ulamog Infinite Gyre in hand; annihilator parse.",
    seed: 0x2de,
    cards: {
      "Ulamog the Infinite Gyre": `Name:Ulamog the Infinite Gyre
ManaCost:11
Types:Legendary Creature Eldrazi
PT:10/10
K:Indestructible
K:Annihilator:4
T:Mode$ ChangesZone | Origin$ Library | Destination$ Graveyard | ValidCard$ Card.Self | Execute$ TrigShuffle | TriggerDescription$ Shuffle.
SVar:TrigShuffle:DB$ ChangeZoneAll | ChangeType$ Card.YouCtrl+inZoneGraveyard | Origin$ Graveyard | Destination$ Library | Shuffle$ True
Oracle:Ulamog parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Ulamog the Infinite Gyre"],
        battlefield: [],
        manaPool: ["C", "C", "C", "C", "C", "C", "C", "C", "C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 664. Spell — Annihilator — Pathrazer of Ulamog in hand.
  {
    id: "pathrazer-of-ulamog-annihilator-in-hand",
    description: "Pathrazer of Ulamog in hand; annihilator-3 parse.",
    seed: 0x2df,
    cards: {
      "Pathrazer of Ulamog": `Name:Pathrazer of Ulamog
ManaCost:11
Types:Creature Eldrazi
PT:9/9
K:Annihilator:3
S:Mode$ CantBlockBy | Affected$ Creature.Self | ValidAttacker$ Card.Self | NumberOfBlockers$ 2 | Description$ Three-blockers.
Oracle:Pathrazer parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Pathrazer of Ulamog"],
        battlefield: [],
        manaPool: ["C", "C", "C", "C", "C", "C", "C", "C", "C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 665. Spell — Tribute — Fanatic of Xenagos in hand.
  {
    id: "fanatic-of-xenagos-tribute-in-hand",
    description: "Fanatic of Xenagos in hand; tribute parse.",
    seed: 0x2e0,
    cards: {
      "Fanatic of Xenagos": `Name:Fanatic of Xenagos
ManaCost:1 R G
Types:Creature Satyr Berserker
PT:3/3
K:Tribute:1
K:Trample
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | TributeNotPaid$ True | Execute$ TrigHaste | TriggerDescription$ Haste.
SVar:TrigHaste:DB$ Pump | Defined$ Self | KW$ Haste | UntilEOT$ True
Oracle:Fanatic parse.
`,
    },
    players: [
      { life: 20, hand: ["Fanatic of Xenagos"], battlefield: [], manaPool: ["R", "G", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 666. Spell — Demonstrate — Verbal Duplicity in hand.
  {
    id: "verbal-duplicity-demonstrate-in-hand",
    description: "Verbal Duplicity in hand; demonstrate copy parse.",
    seed: 0x2e1,
    cards: {
      "Verbal Duplicity": `Name:Verbal Duplicity
ManaCost:1 U
Types:Sorcery
A:SP$ Draw | Cost$ 1 U | Defined$ You | NumCards$ 2 | SubAbility$ DBDiscard | SpellDescription$ Demonstrate.
SVar:DBDiscard:DB$ Discard | Defined$ You | NumCards$ 1 | Mode$ TgtChoose
K:Demonstrate
Oracle:Verbal Duplicity parse.
`,
    },
    players: [
      { life: 20, hand: ["Verbal Duplicity"], battlefield: [], manaPool: ["U", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 667. Spell — Encore — Tergrid's Lantern in hand.
  {
    id: "tergrids-lantern-encore-in-hand",
    description: "Tergrid's Lantern in hand; mill+pay-life parse.",
    seed: 0x2e2,
    cards: {
      "Tergrid's Lantern": `Name:Tergrid's Lantern
ManaCost:4
Types:Legendary Artifact
A:AB$ Mill | Cost$ 3 T | NumCards$ 1 | TargetType$ Player | ValidTgts$ Player | SubAbility$ DBLose | SpellDescription$ Mill 1.
SVar:DBLose:DB$ LoseLife | Defined$ Targeted | LifeAmount$ 2
A:AB$ Mana | Cost$ T | Produced$ B
Oracle:Tergrid's Lantern parse.
`,
    },
    players: [
      { life: 20, hand: ["Tergrid's Lantern"], battlefield: [], manaPool: ["C", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 668. Spell — Compleated — Vraska Betrayal's Sting in hand.
  {
    id: "vraska-betrayals-sting-compleated-in-hand",
    description: "Vraska Betrayal's Sting in hand; compleated PW parse.",
    seed: 0x2e3,
    cards: {
      "Vraska, Betrayal's Sting": `Name:Vraska, Betrayal's Sting
ManaCost:4 B
Types:Legendary Planeswalker Vraska
Loyalty:5
K:Compleated
A:AB$ Proliferate | Cost$ AddCounter<1/LOYALTY> | Planeswalker$ True | SpellDescription$ +1.
A:AB$ ChangeZone | Cost$ SubCounter<3/LOYALTY> | Planeswalker$ True | TargetType$ Card | ValidTgts$ Permanent.OppCtrl | Origin$ Battlefield | Destination$ Exile | SpellDescription$ -3.
A:AB$ DealDamage | Cost$ SubCounter<9/LOYALTY> | Planeswalker$ True | NumDmg$ 999 | ValidTgts$ Player | SpellDescription$ -9.
Oracle:Vraska parse.
`,
    },
    players: [
      { life: 20, hand: ["Vraska, Betrayal's Sting"], battlefield: [], manaPool: ["B", "C", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 669. Spell — Radiation — Skrelv, Defector Mite in hand.
  {
    id: "skrelv-defector-mite-radiation-in-hand",
    description: "Skrelv, Defector Mite in hand; toxic+protection parse.",
    seed: 0x2e4,
    cards: {
      "Skrelv, Defector Mite": `Name:Skrelv, Defector Mite
ManaCost:W
Types:Legendary Creature Phyrexian Mite
PT:1/1
K:Toxic:1
A:AB$ Pump | Cost$ 1 | TargetType$ Card | ValidTgts$ Creature.YouCtrl | KW$ HIDDEN Protection from chosen color | UntilEOT$ True | SpellDescription$ Protection.
Oracle:Skrelv parse.
`,
    },
    players: [
      { life: 20, hand: ["Skrelv, Defector Mite"], battlefield: [], manaPool: ["W"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 670. Spell — Court of Bounty in hand.
  {
    id: "court-of-bounty-in-hand",
    description: "Court of Bounty in hand; monarch upkeep ramp parse.",
    seed: 0x2e5,
    cards: {
      "Court of Bounty": `Name:Court of Bounty
ManaCost:3 G
Types:Enchantment
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigMonarch | TriggerDescription$ Monarch.
SVar:TrigMonarch:DB$ BecomeMonarch
T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | Execute$ TrigPut
SVar:TrigPut:DB$ ChangeZone | Origin$ Hand | Destination$ Battlefield | ChangeType$ Land.YouOwn | ChangeNum$ 1 | Hidden$ True
Oracle:Court of Bounty parse.
`,
    },
    players: [
      { life: 20, hand: ["Court of Bounty"], battlefield: [], manaPool: ["G", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 671. Spell — Visit (Attractions) — Trash Bandicoot in hand.
  {
    id: "trash-bandicoot-visit-in-hand",
    description: "Trash Bandicoot in hand; attractions visit parse.",
    seed: 0x2e6,
    cards: {
      "Trash Bandicoot": `Name:Trash Bandicoot
ManaCost:3 G
Types:Creature Otter Beast
PT:3/4
K:Trample
T:Mode$ Visit | ValidAttraction$ Card.Self | Execute$ TrigDraw | TriggerDescription$ Visit draw.
SVar:TrigDraw:DB$ Draw | NumCards$ 1
Oracle:Trash Bandicoot parse.
`,
    },
    players: [
      { life: 20, hand: ["Trash Bandicoot"], battlefield: [], manaPool: ["G", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 672. Spell — Mishra's Workshop (m613) in hand.
  {
    id: "mishras-workshop-m613-in-hand",
    description: "Mishra's Workshop M613 in hand; artifact-only ramp parse.",
    seed: 0x2e7,
    cards: {
      "Mishra's Workshop M613": `Name:Mishra's Workshop M613
Types:Land
A:AB$ Mana | Cost$ T | Produced$ C | Amount$ 3 | RestrictValid$ Artifact
Oracle:Workshop M613 parse.
`,
    },
    players: [
      { life: 20, hand: ["Mishra's Workshop M613"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 673. Spell — Wasteland (m613) in hand.
  {
    id: "wasteland-m613-in-hand",
    description: "Wasteland M613 in hand; sac destroy nonbasic parse.",
    seed: 0x2e8,
    cards: {
      "Wasteland M613": `Name:Wasteland M613
Types:Land
A:AB$ Mana | Cost$ T | Produced$ C
A:AB$ Destroy | Cost$ T Sac<1/CARDNAME> | TargetType$ Card | ValidTgts$ Land.nonBasic | SpellDescription$ Waste.
Oracle:Wasteland M613 parse.
`,
    },
    players: [
      { life: 20, hand: ["Wasteland M613"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 674. Spell — Brainstorm (m613) in hand.
  {
    id: "brainstorm-m613-in-hand",
    description: "Brainstorm M613 in hand; draw-3 put-back-2 parse.",
    seed: 0x2e9,
    cards: {
      "Brainstorm M613": `Name:Brainstorm M613
ManaCost:U
Types:Instant
A:SP$ Draw | Cost$ U | NumCards$ 3 | SubAbility$ DBPutBack | SpellDescription$ Brainstorm M613.
SVar:DBPutBack:DB$ ChangeZone | Origin$ Hand | Destination$ Library | LibraryPosition$ 0 | ChangeNum$ 2 | ChangeType$ Card.YouCtrl | Hidden$ True
Oracle:Brainstorm M613 parse.
`,
    },
    players: [
      { life: 20, hand: ["Brainstorm M613"], battlefield: [], manaPool: ["U"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 675. Spell — Force of Will (m613) in hand.
  {
    id: "force-of-will-m613-in-hand",
    description: "Force of Will M613 in hand; alt-cost pitch parse.",
    seed: 0x2ea,
    cards: {
      "Force of Will M613": `Name:Force of Will M613
ManaCost:3 U U
Types:Instant
A:SP$ Counter | Cost$ 3 U U | TargetType$ Spell | ValidTgts$ Card | TgtPrompt$ Counter | SpellDescription$ FoW M613.
A:SP$ Counter | Cost$ PayLife<1> Exile<1/Card.Blue+YouOwn+inZoneHand+Other> | TargetType$ Spell | ValidTgts$ Card | TgtPrompt$ Counter | SpellDescription$ Pitch.
Oracle:Force of Will M613 parse.
`,
    },
    players: [
      { life: 20, hand: ["Force of Will M613"], battlefield: [], manaPool: ["U", "U", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 676. Spell — Lion's Eye Diamond (m613) in hand.
  {
    id: "lions-eye-diamond-m613-in-hand",
    description: "Lion's Eye Diamond M613 in hand; sac+discard mana parse.",
    seed: 0x2eb,
    cards: {
      "Lion's Eye Diamond M613": `Name:Lion's Eye Diamond M613
ManaCost:0
Types:Artifact
A:AB$ Mana | Cost$ T Sac<1/CARDNAME> Discard<99/Card.YouCtrl+inZoneHand+Other/your hand> | Produced$ Combo W U B R G | Amount$ 3 | SpellDescription$ LED.
Oracle:LED M613 parse.
`,
    },
    players: [
      { life: 20, hand: ["Lion's Eye Diamond M613"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 677. Spell — Tolarian Academy (m613) in hand.
  {
    id: "tolarian-academy-m613-in-hand",
    description: "Tolarian Academy M613 in hand; X-mana legendary land parse.",
    seed: 0x2ec,
    cards: {
      "Tolarian Academy M613": `Name:Tolarian Academy M613
Types:Legendary Land
A:AB$ Mana | Cost$ T | Produced$ U | Amount$ X | References$ X
SVar:X:Count$ValidPermanents Artifact.YouCtrl
Oracle:Academy M613 parse.
`,
    },
    players: [
      { life: 20, hand: ["Tolarian Academy M613"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 678. Spell — Gaea's Cradle (m613) in hand.
  {
    id: "gaeas-cradle-m613-in-hand",
    description: "Gaea's Cradle M613 in hand; X-creature green ramp parse.",
    seed: 0x2ed,
    cards: {
      "Gaea's Cradle M613": `Name:Gaea's Cradle M613
Types:Legendary Land
A:AB$ Mana | Cost$ T | Produced$ G | Amount$ X | References$ X
SVar:X:Count$ValidPermanents Creature.YouCtrl
Oracle:Cradle M613 parse.
`,
    },
    players: [
      { life: 20, hand: ["Gaea's Cradle M613"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 679. Spell — Force of Vigor in hand.
  {
    id: "force-of-vigor-in-hand",
    description: "Force of Vigor in hand; pitch-green destroy parse.",
    seed: 0x2ee,
    cards: {
      "Force of Vigor": `Name:Force of Vigor
ManaCost:2 G G
Types:Instant
A:SP$ Destroy | Cost$ 2 G G | TargetType$ Card | ValidTgts$ Artifact,Enchantment | TargetMin$ 1 | TargetMax$ 2 | SpellDescription$ Force of Vigor.
A:SP$ Destroy | Cost$ Exile<1/Card.Green+YouOwn+inZoneHand+Other> | TargetType$ Card | ValidTgts$ Artifact,Enchantment | TargetMin$ 1 | TargetMax$ 2 | SpellDescription$ Pitch.
Oracle:Force of Vigor parse.
`,
    },
    players: [
      { life: 20, hand: ["Force of Vigor"], battlefield: [], manaPool: ["G", "G", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 680. Spell — Force of Negation in hand.
  {
    id: "force-of-negation-m613-in-hand",
    description: "Force of Negation in hand; pitch-blue counter parse.",
    seed: 0x2ef,
    cards: {
      "Force of Negation": `Name:Force of Negation
ManaCost:1 U U
Types:Instant
A:SP$ Counter | Cost$ 1 U U | TargetType$ Spell | ValidTgts$ Card.nonCreature | TgtPrompt$ Counter | SpellDescription$ FoN.
A:SP$ Counter | Cost$ Exile<1/Card.Blue+YouOwn+inZoneHand+Other> | TargetType$ Spell | ValidTgts$ Card.nonCreature | TgtPrompt$ Pitch | SpellDescription$ Pitch.
Oracle:Force of Negation parse.
`,
    },
    players: [
      { life: 20, hand: ["Force of Negation"], battlefield: [], manaPool: ["U", "U", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 681. Spell — Force of Despair in hand.
  {
    id: "force-of-despair-in-hand",
    description: "Force of Despair in hand; pitch-black wipe parse.",
    seed: 0x2f0,
    cards: {
      "Force of Despair": `Name:Force of Despair
ManaCost:2 B B
Types:Instant
A:SP$ DestroyAll | Cost$ 2 B B | ValidCards$ Creature.thisTurnEntered | SpellDescription$ FoD.
A:SP$ DestroyAll | Cost$ Exile<1/Card.Black+YouOwn+inZoneHand+Other> | ValidCards$ Creature.thisTurnEntered | SpellDescription$ Pitch.
Oracle:FoD parse.
`,
    },
    players: [
      { life: 20, hand: ["Force of Despair"], battlefield: [], manaPool: ["B", "B", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 682. Spell — Force of Rage in hand.
  {
    id: "force-of-rage-in-hand",
    description: "Force of Rage in hand; pitch-red token parse.",
    seed: 0x2f1,
    cards: {
      "Force of Rage": `Name:Force of Rage
ManaCost:3 R R
Types:Instant
A:SP$ Token | Cost$ 3 R R | TokenScript$ r_3_1_elemental | TokenAmount$ 2 | SubAbility$ DBSac | SpellDescription$ Tokens.
SVar:DBSac:DB$ Sacrifice | SacValid$ Creature.IsRemembered | TriggerPhases$ EndOfTurn
A:SP$ Token | Cost$ Exile<1/Card.Red+YouOwn+inZoneHand+Other> | TokenScript$ r_3_1_elemental | TokenAmount$ 2 | SpellDescription$ Pitch.
Oracle:Force of Rage parse.
`,
    },
    players: [
      { life: 20, hand: ["Force of Rage"], battlefield: [], manaPool: ["R", "R", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 683. Spell — Goblin Lackey in hand.
  {
    id: "goblin-lackey-in-hand",
    description: "Goblin Lackey in hand; combat cheat trigger parse.",
    seed: 0x2f2,
    cards: {
      "Goblin Lackey": `Name:Goblin Lackey
ManaCost:R
Types:Creature Goblin
PT:1/1
T:Mode$ DamageDone | ValidSource$ Card.Self | ValidTarget$ Player | CombatDamage$ True | Execute$ TrigPut | TriggerDescription$ Cheat.
SVar:TrigPut:DB$ ChangeZone | Origin$ Hand | Destination$ Battlefield | ChangeType$ Goblin.YouOwn | ChangeNum$ 1 | Hidden$ True
Oracle:Goblin Lackey parse.
`,
    },
    players: [
      { life: 20, hand: ["Goblin Lackey"], battlefield: [], manaPool: ["R"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 684. Spell — Goblin Recruiter in hand.
  {
    id: "goblin-recruiter-in-hand",
    description: "Goblin Recruiter in hand; tutor stack parse.",
    seed: 0x2f3,
    cards: {
      "Goblin Recruiter": `Name:Goblin Recruiter
ManaCost:1 R
Types:Creature Goblin
PT:1/1
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigSearch | TriggerDescription$ Search.
SVar:TrigSearch:DB$ ChangeZone | Origin$ Library | Destination$ Library | LibraryPosition$ 0 | ChangeType$ Goblin.YouOwn | ChangeNum$ 99 | AnyNumber$ True
Oracle:Goblin Recruiter parse.
`,
    },
    players: [
      { life: 20, hand: ["Goblin Recruiter"], battlefield: [], manaPool: ["R", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 685. Spell — Goblin Matron in hand.
  {
    id: "goblin-matron-in-hand",
    description: "Goblin Matron in hand; tutor goblin parse.",
    seed: 0x2f4,
    cards: {
      "Goblin Matron": `Name:Goblin Matron
ManaCost:2 R
Types:Creature Goblin
PT:1/1
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigSearch | TriggerDescription$ Tutor.
SVar:TrigSearch:DB$ ChangeZone | Origin$ Library | Destination$ Hand | ChangeType$ Goblin.YouOwn | ChangeNum$ 1
Oracle:Matron parse.
`,
    },
    players: [
      { life: 20, hand: ["Goblin Matron"], battlefield: [], manaPool: ["R", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 686. Spell — Goblin Ringleader in hand.
  {
    id: "goblin-ringleader-in-hand",
    description: "Goblin Ringleader in hand; reveal-4 parse.",
    seed: 0x2f5,
    cards: {
      "Goblin Ringleader": `Name:Goblin Ringleader
ManaCost:3 R
Types:Creature Goblin
PT:2/2
K:Haste
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDig | TriggerDescription$ Dig.
SVar:TrigDig:DB$ Dig | DigNum$ 4 | ChangeNum$ All | ChangeValid$ Goblin | DestinationZone$ Hand
Oracle:Ringleader parse.
`,
    },
    players: [
      { life: 20, hand: ["Goblin Ringleader"], battlefield: [], manaPool: ["R", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 687. Spell — Muxus Goblin Grandee in hand.
  {
    id: "muxus-goblin-grandee-in-hand",
    description: "Muxus Goblin Grandee in hand; cheat-six parse.",
    seed: 0x2f6,
    cards: {
      "Muxus, Goblin Grandee": `Name:Muxus, Goblin Grandee
ManaCost:4 R R
Types:Legendary Creature Goblin Noble
PT:4/4
S:Mode$ Continuous | Affected$ Creature.Goblin+YouCtrl+Other | AddPower$ 1 | AddToughness$ 1 | Description$ Anthem.
T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ TrigDig
SVar:TrigDig:DB$ Dig | DigNum$ 6 | ChangeNum$ All | ChangeValid$ Goblin.cmcLE4 | DestinationZone$ Battlefield
Oracle:Muxus parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Muxus, Goblin Grandee"],
        battlefield: [],
        manaPool: ["R", "R", "C", "C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 688. Spell — Krenko Mob Boss in hand.
  {
    id: "krenko-mob-boss-m613-in-hand",
    description: "Krenko Mob Boss in hand; tap goblins parse.",
    seed: 0x2f7,
    cards: {
      "Krenko, Mob Boss": `Name:Krenko, Mob Boss
ManaCost:2 R R
Types:Legendary Creature Goblin Warrior
PT:3/3
A:AB$ Token | Cost$ T | TokenScript$ r_1_1_goblin | TokenAmount$ X | References$ X | SpellDescription$ Tokens.
SVar:X:Count$ValidPermanents Goblin.YouCtrl
Oracle:Krenko parse.
`,
    },
    players: [
      { life: 20, hand: ["Krenko, Mob Boss"], battlefield: [], manaPool: ["R", "R", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 689. Spell — Sneaky Goblin in hand.
  {
    id: "krenko-tin-street-kingpin-in-hand",
    description: "Krenko Tin Street Kingpin in hand; counter+token parse.",
    seed: 0x2f8,
    cards: {
      "Krenko, Tin Street Kingpin": `Name:Krenko, Tin Street Kingpin
ManaCost:1 R
Types:Legendary Creature Goblin
PT:1/1
T:Mode$ DamageDone | ValidSource$ Card.Self | ValidTarget$ Player | CombatDamage$ True | Execute$ TrigPut | TriggerDescription$ Pump.
SVar:TrigPut:DB$ PutCounter | Defined$ Self | CounterType$ P1P1 | CounterNum$ 1 | SubAbility$ DBToken
SVar:DBToken:DB$ Token | TokenScript$ r_1_1_goblin | TokenAmount$ X | References$ X
SVar:X:Count$CardCounters.P1P1
Oracle:Tin Street parse.
`,
    },
    players: [
      { life: 20, hand: ["Krenko, Tin Street Kingpin"], battlefield: [], manaPool: ["R", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 690. Spell — Skirk Prospector in hand.
  {
    id: "skirk-prospector-in-hand",
    description: "Skirk Prospector in hand; sac goblin add R parse.",
    seed: 0x2f9,
    cards: {
      "Skirk Prospector": `Name:Skirk Prospector
ManaCost:R
Types:Creature Goblin
PT:1/1
A:AB$ Mana | Cost$ Sac<1/Goblin> | Produced$ R | SpellDescription$ Sac.
Oracle:Skirk parse.
`,
    },
    players: [
      { life: 20, hand: ["Skirk Prospector"], battlefield: [], manaPool: ["R"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 691. Spell — Goblin Piledriver in hand.
  {
    id: "goblin-piledriver-in-hand",
    description: "Goblin Piledriver in hand; tribal +X attack parse.",
    seed: 0x2fa,
    cards: {
      "Goblin Piledriver": `Name:Goblin Piledriver
ManaCost:1 R
Types:Creature Goblin Warrior
PT:1/2
S:Mode$ CantBlockBy | ValidAttacker$ Card.Self | ValidBlocker$ Creature.Blue | Description$ Pro blue blockers.
T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ TrigPump | TriggerDescription$ Pump.
SVar:TrigPump:DB$ Pump | Defined$ Self | NumAtt$ X | References$ X
SVar:X:Count$ValidPermanents Goblin.YouCtrl+Other/Times.2
Oracle:Piledriver parse.
`,
    },
    players: [
      { life: 20, hand: ["Goblin Piledriver"], battlefield: [], manaPool: ["R", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 692. Spell — Goblin Welder in hand.
  {
    id: "goblin-welder-in-hand",
    description: "Goblin Welder in hand; reanimate artifact parse.",
    seed: 0x2fb,
    cards: {
      "Goblin Welder": `Name:Goblin Welder
ManaCost:R
Types:Creature Goblin Artificer
PT:1/1
A:AB$ ChangeZone | Cost$ T | TargetType$ Card,Card | ValidTgts$ Artifact.YouCtrl+Battlefield,Artifact.YouCtrl+inZoneGraveyard | Origin$ Battlefield,Graveyard | Destination$ Graveyard,Battlefield | SpellDescription$ Weld.
Oracle:Welder parse.
`,
    },
    players: [
      { life: 20, hand: ["Goblin Welder"], battlefield: [], manaPool: ["R"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 693. Spell — Daretti Scrap Savant in hand.
  {
    id: "daretti-scrap-savant-in-hand",
    description: "Daretti Scrap Savant in hand; PW reanimate parse.",
    seed: 0x2fc,
    cards: {
      "Daretti, Scrap Savant": `Name:Daretti, Scrap Savant
ManaCost:3 R
Types:Legendary Planeswalker Daretti
Loyalty:3
A:AB$ Discard | Cost$ AddCounter<1/LOYALTY> | Planeswalker$ True | Defined$ You | NumCards$ 2 | Mode$ TgtChoose | SubAbility$ DBDraw | SpellDescription$ +1.
SVar:DBDraw:DB$ Draw | NumCards$ 2
A:AB$ ChangeZone | Cost$ SubCounter<1/LOYALTY> | Planeswalker$ True | TargetType$ Card | ValidTgts$ Artifact.YouCtrl+inZoneGraveyard | Origin$ Graveyard | Destination$ Battlefield | SpellDescription$ -1.
A:AB$ ChangeZoneAll | Cost$ SubCounter<6/LOYALTY> | Planeswalker$ True | ChangeType$ Artifact.YouCtrl | Origin$ Graveyard | Destination$ Battlefield | SpellDescription$ -6.
Oracle:Daretti parse.
`,
    },
    players: [
      { life: 20, hand: ["Daretti, Scrap Savant"], battlefield: [], manaPool: ["R", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 694. Spell — Esper Sentinel (m613) in hand.
  {
    id: "esper-sentinel-m613-in-hand",
    description: "Esper Sentinel M613 in hand; rhystic study creature parse.",
    seed: 0x2fd,
    cards: {
      "Esper Sentinel M613": `Name:Esper Sentinel M613
ManaCost:W
Types:Artifact Creature Human
PT:1/1
T:Mode$ SpellCast | ValidPlayer$ Opponent | ValidCard$ Card.nonCreature | Execute$ TrigDraw | OptionalDecider$ Opponent | UnlessCost$ X | UnlessSwitched$ True | References$ X
SVar:TrigDraw:DB$ Draw | NumCards$ 1
SVar:X:Count$ValidPermanents Card.YouCtrl
Oracle:Esper Sentinel M613 parse.
`,
    },
    players: [
      { life: 20, hand: ["Esper Sentinel M613"], battlefield: [], manaPool: ["W"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 695. Spell — Rhystic Study (m613) in hand.
  {
    id: "rhystic-study-m613-in-hand",
    description: "Rhystic Study M613 in hand; pay-1 draw parse.",
    seed: 0x2fe,
    cards: {
      "Rhystic Study M613": `Name:Rhystic Study M613
ManaCost:2 U
Types:Enchantment
T:Mode$ SpellCast | ValidPlayer$ Opponent | Execute$ TrigDraw | UnlessCost$ 1 | UnlessSwitched$ True | OptionalDecider$ Opponent
SVar:TrigDraw:DB$ Draw | NumCards$ 1
Oracle:Rhystic M613 parse.
`,
    },
    players: [
      { life: 20, hand: ["Rhystic Study M613"], battlefield: [], manaPool: ["U", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 696. Spell — Smothering Tithe in hand.
  {
    id: "smothering-tithe-m613-in-hand",
    description: "Smothering Tithe in hand; treasure on draw parse.",
    seed: 0x2ff,
    cards: {
      "Smothering Tithe": `Name:Smothering Tithe
ManaCost:3 W
Types:Enchantment
T:Mode$ Drawn | ValidCard$ Card | ValidPlayer$ Opponent | Execute$ TrigToken | UnlessCost$ 2 | UnlessSwitched$ True | OptionalDecider$ TriggeredPlayer
SVar:TrigToken:DB$ Token | TokenScript$ c_a_treasure_sac | TokenAmount$ 1
Oracle:Smothering Tithe parse.
`,
    },
    players: [
      { life: 20, hand: ["Smothering Tithe"], battlefield: [], manaPool: ["W", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 697. Spell — Mystic Remora in hand.
  {
    id: "mystic-remora-in-hand",
    description: "Mystic Remora in hand; cumulative-upkeep draw parse.",
    seed: 0x300,
    cards: {
      "Mystic Remora": `Name:Mystic Remora
ManaCost:U
Types:Enchantment
K:Cumulative upkeep:1
T:Mode$ SpellCast | ValidPlayer$ Opponent | ValidCard$ Card.nonCreature | Execute$ TrigDraw | UnlessCost$ 4 | UnlessSwitched$ True | OptionalDecider$ Opponent
SVar:TrigDraw:DB$ Draw | NumCards$ 1
Oracle:Remora parse.
`,
    },
    players: [
      { life: 20, hand: ["Mystic Remora"], battlefield: [], manaPool: ["U"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 698. Spell — Sylvan Library in hand.
  {
    id: "sylvan-library-m613-in-hand",
    description: "Sylvan Library in hand; pay-life keep extra draw parse.",
    seed: 0x301,
    cards: {
      "Sylvan Library": `Name:Sylvan Library
ManaCost:1 G
Types:Enchantment
T:Mode$ Phase | Phase$ Draw | ValidPlayer$ You | Execute$ TrigDraw | TriggerDescription$ Sylvan.
SVar:TrigDraw:DB$ Draw | NumCards$ 2 | SubAbility$ DBPutBack
SVar:DBPutBack:DB$ ChangeZone | Origin$ Hand | Destination$ Library | LibraryPosition$ 0 | ChangeNum$ 2 | UnlessCost$ PayLife<4> | UnlessSwitched$ True | UnlessAI$ Always
Oracle:Sylvan Library parse.
`,
    },
    players: [
      { life: 20, hand: ["Sylvan Library"], battlefield: [], manaPool: ["G", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 699. Spell — Land Tax in hand.
  {
    id: "land-tax-in-hand",
    description: "Land Tax in hand; basic-tutor upkeep parse.",
    seed: 0x302,
    cards: {
      "Land Tax": `Name:Land Tax
ManaCost:W
Types:Enchantment
T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | CheckSecondaryPresent$ Player.Opponent+lessLandsCtrl | Execute$ TrigSearch | TriggerDescription$ Tax.
SVar:TrigSearch:DB$ ChangeZone | Origin$ Library | Destination$ Hand | ChangeType$ Plains | ChangeNum$ 3 | AnyNumber$ True
Oracle:Land Tax parse.
`,
    },
    players: [
      { life: 20, hand: ["Land Tax"], battlefield: [], manaPool: ["W"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 700. Spell — Wheel of Fortune in hand.
  {
    id: "wheel-of-fortune-m613-in-hand",
    description: "Wheel of Fortune in hand; reset hand parse.",
    seed: 0x303,
    cards: {
      "Wheel of Fortune": `Name:Wheel of Fortune
ManaCost:2 R
Types:Sorcery
A:SP$ RepeatEach | Cost$ 2 R | RepeatPlayers$ Player | RepeatSubAbility$ DBDiscardAll | SpellDescription$ Wheel.
SVar:DBDiscardAll:DB$ Discard | Defined$ Player.IsRemembered | Mode$ Hand | SubAbility$ DBDraw7
SVar:DBDraw7:DB$ Draw | Defined$ Player.IsRemembered | NumCards$ 7
Oracle:Wheel parse.
`,
    },
    players: [
      { life: 20, hand: ["Wheel of Fortune"], battlefield: [], manaPool: ["R", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 701. Spell — Timetwister in hand.
  {
    id: "timetwister-in-hand",
    description: "Timetwister in hand; reshuffle hand parse.",
    seed: 0x304,
    cards: {
      Timetwister: `Name:Timetwister
ManaCost:2 U
Types:Sorcery
A:SP$ RepeatEach | Cost$ 2 U | RepeatPlayers$ Player | RepeatSubAbility$ DBShuffle | SpellDescription$ Twister.
SVar:DBShuffle:DB$ ChangeZoneAll | Defined$ Player.IsRemembered | ChangeType$ Card.IsRemembered | Origin$ Hand,Graveyard | Destination$ Library | Shuffle$ True | SubAbility$ DBDraw7
SVar:DBDraw7:DB$ Draw | Defined$ Player.IsRemembered | NumCards$ 7
Oracle:Twister parse.
`,
    },
    players: [
      { life: 20, hand: ["Timetwister"], battlefield: [], manaPool: ["U", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 702. Spell — Time Walk in hand.
  {
    id: "time-walk-m613-in-hand",
    description: "Time Walk in hand; extra turn parse.",
    seed: 0x305,
    cards: {
      "Time Walk": `Name:Time Walk
ManaCost:1 U
Types:Sorcery
A:SP$ AddTurn | Cost$ 1 U | NumTurns$ 1 | SpellDescription$ Take an extra turn.
Oracle:Time Walk parse.
`,
    },
    players: [
      { life: 20, hand: ["Time Walk"], battlefield: [], manaPool: ["U", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 703. Spell — Time Stretch in hand.
  {
    id: "time-stretch-m613-in-hand",
    description: "Time Stretch in hand; two extra turns parse.",
    seed: 0x306,
    cards: {
      "Time Stretch": `Name:Time Stretch
ManaCost:8 U U
Types:Sorcery
A:SP$ AddTurn | Cost$ 8 U U | NumTurns$ 2 | SpellDescription$ Stretch.
Oracle:Time Stretch parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Time Stretch"],
        battlefield: [],
        manaPool: ["U", "U", "C", "C", "C", "C", "C", "C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 704. Spell — Capture of Jingzhou in hand.
  {
    id: "capture-of-jingzhou-in-hand",
    description: "Capture of Jingzhou in hand; extra turn parse.",
    seed: 0x307,
    cards: {
      "Capture of Jingzhou": `Name:Capture of Jingzhou
ManaCost:3 U U
Types:Sorcery
A:SP$ AddTurn | Cost$ 3 U U | NumTurns$ 1 | SpellDescription$ Capture.
Oracle:Capture parse.
`,
    },
    players: [
      { life: 20, hand: ["Capture of Jingzhou"], battlefield: [], manaPool: ["U", "U", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 705. Spell — Notion Thief in hand.
  {
    id: "notion-thief-in-hand",
    description: "Notion Thief in hand; replace draw parse.",
    seed: 0x308,
    cards: {
      "Notion Thief": `Name:Notion Thief
ManaCost:2 U B
Types:Creature Human Rogue
PT:3/1
K:Flash
R:Event$ Draw | ActiveZones$ Battlefield | ValidPlayer$ Opponent | ReplaceWith$ DBYouDraw | Description$ Steal draw.
SVar:DBYouDraw:DB$ Draw | Defined$ You | NumCards$ 1
Oracle:Notion Thief parse.
`,
    },
    players: [
      { life: 20, hand: ["Notion Thief"], battlefield: [], manaPool: ["U", "B", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 706. Spell — Consecrated Sphinx in hand.
  {
    id: "consecrated-sphinx-in-hand",
    description: "Consecrated Sphinx in hand; opp-draw mirror parse.",
    seed: 0x309,
    cards: {
      "Consecrated Sphinx": `Name:Consecrated Sphinx
ManaCost:4 U U
Types:Creature Sphinx
PT:4/6
K:Flying
T:Mode$ Drawn | ValidCard$ Card | ValidPlayer$ Opponent | Execute$ TrigDraw | OptionalDecider$ You | TriggerDescription$ Sphinx.
SVar:TrigDraw:DB$ Draw | NumCards$ 2 | Defined$ You
Oracle:Sphinx parse.
`,
    },
    players: [
      { life: 20, hand: ["Consecrated Sphinx"], battlefield: [], manaPool: ["U", "U", "C", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 707. Spell — Toxic Deluge alt copy.
  {
    id: "phyrexian-arena-in-hand",
    description: "Phyrexian Arena in hand; pay-life draw parse.",
    seed: 0x30a,
    cards: {
      "Phyrexian Arena": `Name:Phyrexian Arena
ManaCost:1 B B
Types:Enchantment
T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | Execute$ TrigDraw | TriggerDescription$ Arena.
SVar:TrigDraw:DB$ Draw | NumCards$ 1 | SubAbility$ DBLose
SVar:DBLose:DB$ LoseLife | Defined$ You | LifeAmount$ 1
Oracle:Arena parse.
`,
    },
    players: [
      { life: 20, hand: ["Phyrexian Arena"], battlefield: [], manaPool: ["B", "B", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 708. Spell — Bolas's Citadel in hand.
  {
    id: "bolass-citadel-in-hand",
    description: "Bolas's Citadel in hand; cast-from-top parse.",
    seed: 0x30b,
    cards: {
      "Bolas's Citadel": `Name:Bolas's Citadel
ManaCost:3 B B B
Types:Legendary Artifact
S:Mode$ Continuous | EffectZone$ Battlefield | Affected$ Card.YouCtrl+inZoneLibrary+topLib | MayLookAt$ True | MayPlay$ True | MayPlayLifeMod$ True | Description$ Top library.
A:AB$ LoseLife | Cost$ 3 T Sac<10/Permanent> | Defined$ Player.Opponent | LifeAmount$ 10 | SubAbility$ DBGain | SpellDescription$ -10/+10.
SVar:DBGain:DB$ GainLife | Defined$ You | LifeAmount$ 10
Oracle:Citadel parse.
`,
    },
    players: [
      { life: 20, hand: ["Bolas's Citadel"], battlefield: [], manaPool: ["B", "B", "B", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 709. Spell — Aetherflux Reservoir (m613) in hand.
  {
    id: "aetherflux-reservoir-m613-in-hand",
    description: "Aetherflux Reservoir M613 in hand; storm life parse.",
    seed: 0x30c,
    cards: {
      "Aetherflux Reservoir M613": `Name:Aetherflux Reservoir M613
ManaCost:4
Types:Artifact
T:Mode$ SpellCast | ValidPlayer$ You | Execute$ TrigGain | TriggerDescription$ +1.
SVar:TrigGain:DB$ GainLife | Defined$ You | LifeAmount$ X | References$ X
SVar:X:Count$StormCount/Plus.1
A:AB$ DealDamage | Cost$ PayLife<50> | NumDmg$ 50 | ValidTgts$ Player | SpellDescription$ Yeet 50.
Oracle:Reservoir M613 parse.
`,
    },
    players: [
      { life: 20, hand: ["Aetherflux Reservoir M613"], battlefield: [], manaPool: ["C", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 710. Spell — Sensei's Divining Top in hand.
  {
    id: "senseis-divining-top-in-hand",
    description: "Sensei's Divining Top in hand; tap rearrange parse.",
    seed: 0x30d,
    cards: {
      "Sensei's Divining Top": `Name:Sensei's Divining Top
ManaCost:1
Types:Artifact
A:AB$ ChooseCard | Cost$ T | Defined$ You | Choices$ Card.YouOwn+inZoneLibrary+topLib | NumCards$ 3 | SubAbility$ DBPut | SpellDescription$ Top.
SVar:DBPut:DB$ ChangeZone | Origin$ Library | Destination$ Library | LibraryPosition$ 0 | Hidden$ True | ChangeNum$ 3
A:AB$ Draw | Cost$ 1 T Sac<1/CARDNAME> | NumCards$ 1 | SubAbility$ DBSearch | SpellDescription$ 1, T, sac.
SVar:DBSearch:DB$ ChangeZone | Origin$ Library | Destination$ Hand | ChangeType$ Card.namedCARDNAME | ChangeNum$ 1
Oracle:Top parse.
`,
    },
    players: [
      { life: 20, hand: ["Sensei's Divining Top"], battlefield: [], manaPool: ["C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 711. Spell — Mana Drain in hand.
  {
    id: "mana-drain-m613-in-hand",
    description: "Mana Drain in hand; counter+mana parse.",
    seed: 0x30e,
    cards: {
      "Mana Drain": `Name:Mana Drain
ManaCost:U U
Types:Instant
A:SP$ Counter | Cost$ U U | TargetType$ Spell | ValidTgts$ Card | TgtPrompt$ Counter | RememberCanceled$ True | SubAbility$ DBMana | SpellDescription$ Drain.
SVar:DBMana:DB$ Effect | Triggers$ ManaTrig | RememberObjects$ Self
SVar:ManaTrig:Mode$ Phase | Phase$ MainStart | ValidPlayer$ You | Execute$ DBAddMana
SVar:DBAddMana:DB$ Mana | Produced$ C | Amount$ X | References$ X
SVar:X:Count$RememberedSize
Oracle:Drain parse.
`,
    },
    players: [
      { life: 20, hand: ["Mana Drain"], battlefield: [], manaPool: ["U", "U"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 712. Spell — Cyclonic Rift in hand.
  {
    id: "cyclonic-rift-m613-in-hand",
    description: "Cyclonic Rift in hand; overload sweep parse.",
    seed: 0x30f,
    cards: {
      "Cyclonic Rift": `Name:Cyclonic Rift
ManaCost:1 U
Types:Instant
A:SP$ ChangeZone | Cost$ 1 U | Origin$ Battlefield | Destination$ Hand | TargetType$ Card | ValidTgts$ Permanent.nonLand+OppCtrl | SpellDescription$ Bounce.
A:SP$ ChangeZoneAll | Cost$ 6 U | ChangeType$ Permanent.nonLand+OppCtrl | Origin$ Battlefield | Destination$ Hand | IsCurse$ True | SpellDescription$ Overload.
Oracle:Cyclonic parse.
`,
    },
    players: [
      { life: 20, hand: ["Cyclonic Rift"], battlefield: [], manaPool: ["U", "C", "C", "C", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 713. Spell — Approach of the Second Sun in hand.
  {
    id: "approach-of-the-second-sun-in-hand",
    description: "Approach of the Second Sun in hand; alt-win parse.",
    seed: 0x310,
    cards: {
      "Approach of the Second Sun": `Name:Approach of the Second Sun
ManaCost:6 W
Types:Sorcery
A:SP$ GainLife | Cost$ 6 W | Defined$ You | LifeAmount$ 7 | ConditionPresent$ Card.namedCARDNAME+inZoneLibrary+OwnedBy You | ConditionCompare$ EQ0 | SubAbility$ DBPut | SpellDescription$ Approach.
SVar:DBPut:DB$ ChangeZone | Defined$ Self | Origin$ Stack | Destination$ Library | LibraryPosition$ 7
A:SP$ WinsGame | Cost$ 6 W | Defined$ You | ConditionPresent$ Card.namedCARDNAME+inZoneGraveyard+OwnedBy You | SpellDescription$ Win.
Oracle:Approach parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Approach of the Second Sun"],
        battlefield: [],
        manaPool: ["W", "C", "C", "C", "C", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 714. Spell — Tergrid God of Fright in hand.
  {
    id: "tergrid-god-of-fright-in-hand",
    description: "Tergrid God of Fright in hand; reanimate sac trigger parse.",
    seed: 0x311,
    cards: {
      "Tergrid, God of Fright": `Name:Tergrid, God of Fright
ManaCost:3 B B
Types:Legendary Creature God
PT:4/5
K:Indestructible
T:Mode$ Discarded | ValidPlayer$ Opponent | NotByYou$ True | Execute$ TrigPut | TriggerDescription$ Steal.
SVar:TrigPut:DB$ ChangeZone | Origin$ Graveyard | Destination$ Battlefield | Defined$ TriggeredCard | GainControl$ True
T:Mode$ Sacrificed | ValidPlayer$ Opponent | NotByYou$ True | Execute$ TrigPut2
SVar:TrigPut2:DB$ ChangeZone | Origin$ Graveyard | Destination$ Battlefield | Defined$ TriggeredCard | GainControl$ True
Oracle:Tergrid parse.
`,
    },
    players: [
      { life: 20, hand: ["Tergrid, God of Fright"], battlefield: [], manaPool: ["B", "B", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 715. Spell — Liliana of the Veil (m613) in hand.
  {
    id: "liliana-of-the-veil-m613-in-hand",
    description: "Liliana of the Veil M613 in hand; PW edict parse.",
    seed: 0x312,
    cards: {
      "Liliana of the Veil M613": `Name:Liliana of the Veil M613
ManaCost:1 B B
Types:Legendary Planeswalker Liliana
Loyalty:3
A:AB$ Discard | Cost$ AddCounter<1/LOYALTY> | Planeswalker$ True | RepeatEach$ True | RepeatPlayers$ Player | Mode$ TgtChoose | NumCards$ 1 | SpellDescription$ +1.
A:AB$ Sacrifice | Cost$ SubCounter<2/LOYALTY> | Planeswalker$ True | Defined$ Player.Opponent | Amount$ 1 | SacValid$ Creature | SpellDescription$ -2.
A:AB$ ChangeZoneAll | Cost$ SubCounter<6/LOYALTY> | Planeswalker$ True | ChangeType$ Permanent.OppCtrl | Origin$ Battlefield | Destination$ Library | SpellDescription$ -6.
Oracle:Liliana M613 parse.
`,
    },
    players: [
      { life: 20, hand: ["Liliana of the Veil M613"], battlefield: [], manaPool: ["B", "B", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 716. Spell — Wrenn and Six in hand.
  {
    id: "wrenn-and-six-m613-in-hand",
    description: "Wrenn and Six in hand; PW land recursion parse.",
    seed: 0x313,
    cards: {
      "Wrenn and Six": `Name:Wrenn and Six
ManaCost:R G
Types:Legendary Planeswalker Wrenn
Loyalty:3
A:AB$ ChangeZone | Cost$ AddCounter<1/LOYALTY> | Planeswalker$ True | TargetType$ Card | ValidTgts$ Land.YouCtrl+inZoneGraveyard | Origin$ Graveyard | Destination$ Hand | SpellDescription$ +1.
A:AB$ DealDamage | Cost$ SubCounter<1/LOYALTY> | Planeswalker$ True | NumDmg$ 1 | ValidTgts$ Creature.nonFlying,Player | SpellDescription$ -1.
A:AB$ Effect | Cost$ SubCounter<7/LOYALTY> | Planeswalker$ True | StaticAbilities$ EmblemRetrace | SpellDescription$ -7.
SVar:EmblemRetrace:Mode$ Continuous | Affected$ Card.YouOwn+inZoneGraveyard | AddKeyword$ Retrace | Description$ Retrace.
Oracle:Wrenn parse.
`,
    },
    players: [
      { life: 20, hand: ["Wrenn and Six"], battlefield: [], manaPool: ["R", "G"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 717. Spell — Oko Thief of Crowns in hand.
  {
    id: "oko-thief-of-crowns-in-hand",
    description: "Oko Thief of Crowns in hand; PW elk parse.",
    seed: 0x314,
    cards: {
      "Oko, Thief of Crowns": `Name:Oko, Thief of Crowns
ManaCost:1 G U
Types:Legendary Planeswalker Oko
Loyalty:4
A:AB$ Token | Cost$ AddCounter<2/LOYALTY> | Planeswalker$ True | TokenScript$ g_3_3_elk_food | TokenAmount$ 1 | SpellDescription$ +2.
A:AB$ Animate | Cost$ SubCounter<2/LOYALTY> | Planeswalker$ True | TargetType$ Card | ValidTgts$ Creature,Artifact | Power$ 3 | Toughness$ 3 | Types$ Creature,Elk | RemoveTypes$ Artifact | SpellDescription$ -2.
A:AB$ ChangeZone | Cost$ SubCounter<5/LOYALTY> | Planeswalker$ True | TargetType$ Card,Card | ValidTgts$ Creature.YouCtrl,Creature.OppCtrl | Origin$ Battlefield,Battlefield | Destination$ Battlefield,Battlefield | SwapTargetControl$ True | SpellDescription$ -5.
Oracle:Oko parse.
`,
    },
    players: [
      { life: 20, hand: ["Oko, Thief of Crowns"], battlefield: [], manaPool: ["G", "U", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 718. Spell — Tibalt's Trickery in hand.
  {
    id: "tibalts-trickery-m613-in-hand",
    description: "Tibalt's Trickery in hand; counter cascade parse.",
    seed: 0x315,
    cards: {
      "Tibalt's Trickery": `Name:Tibalt's Trickery
ManaCost:R
Types:Instant
A:SP$ Counter | Cost$ R | TargetType$ Spell | ValidTgts$ Card | TgtPrompt$ Counter | SubAbility$ DBMill | SpellDescription$ Trickery.
SVar:DBMill:DB$ Mill | NumCards$ 3 | Defined$ Player.IsTargeted | SubAbility$ DBExile
SVar:DBExile:DB$ ChangeZone | Origin$ Library | Destination$ Battlefield | ChangeType$ Card.nonLand+nonCARDNAME | ChangeNum$ 1 | Defined$ Targeted
Oracle:Trickery parse.
`,
    },
    players: [
      { life: 20, hand: ["Tibalt's Trickery"], battlefield: [], manaPool: ["R"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 719. Spell — Bonecrusher Giant (m613) in hand.
  {
    id: "bonecrusher-giant-m613-in-hand",
    description: "Bonecrusher Giant M613 in hand; adventure parse.",
    seed: 0x316,
    cards: {
      "Bonecrusher Giant M613": `Name:Bonecrusher Giant M613
ManaCost:1 R
Types:Creature Giant
PT:4/3
ALTERNATE
Name:Stomp
ManaCost:1 R
Types:Instant Adventure
A:SP$ DealDamage | Cost$ 1 R | NumDmg$ 2 | ValidTgts$ Creature,Player | SpellDescription$ Stomp.
Oracle:Bonecrusher M613 parse.
`,
    },
    players: [
      { life: 20, hand: ["Bonecrusher Giant M613"], battlefield: [], manaPool: ["R", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 720. Spell — Brazen Borrower in hand.
  {
    id: "brazen-borrower-in-hand",
    description: "Brazen Borrower in hand; flash adventure parse.",
    seed: 0x317,
    cards: {
      "Brazen Borrower": `Name:Brazen Borrower
ManaCost:1 U U
Types:Creature Faerie Rogue
PT:3/1
K:Flash
K:Flying
ALTERNATE
Name:Petty Theft
ManaCost:1 U
Types:Instant Adventure
A:SP$ ChangeZone | Cost$ 1 U | Origin$ Battlefield | Destination$ Hand | TargetType$ Card | ValidTgts$ Permanent.nonLand+OppCtrl | SpellDescription$ Petty Theft.
Oracle:Borrower parse.
`,
    },
    players: [
      { life: 20, hand: ["Brazen Borrower"], battlefield: [], manaPool: ["U", "U", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 721. Spell — Lurrus of the Dream-Den in hand.
  {
    id: "lurrus-of-the-dream-den-in-hand",
    description: "Lurrus of the Dream-Den in hand; companion grave-recursion parse.",
    seed: 0x318,
    cards: {
      "Lurrus of the Dream-Den": `Name:Lurrus of the Dream-Den
ManaCost:1 W B
Types:Legendary Creature Cat Nightmare
PT:3/2
K:Lifelink
K:Companion:CompanionLurrus
SVar:CompanionLurrus:Mode$ Card.cmcLE2+Permanent
A:AB$ ChangeZone | Cost$ 0 | Origin$ Graveyard | Destination$ Battlefield | TargetType$ Card | ValidTgts$ Permanent.YouCtrl+cmcLE2+inZoneGraveyard | ActivationLimit$ 1 | ActivationZone$ Battlefield | SpellDescription$ Recur.
Oracle:Lurrus parse.
`,
    },
    players: [
      { life: 20, hand: ["Lurrus of the Dream-Den"], battlefield: [], manaPool: ["W", "B", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 722. Spell — Yorion Sky Nomad in hand.
  {
    id: "yorion-sky-nomad-m613-in-hand",
    description: "Yorion Sky Nomad in hand; companion flicker parse.",
    seed: 0x319,
    cards: {
      "Yorion, Sky Nomad": `Name:Yorion, Sky Nomad
ManaCost:3 W U
Types:Legendary Creature Bird Serpent
PT:4/5
K:Flying
K:Companion:CompanionYorion
SVar:CompanionYorion:Mode$ DeckSizeAtLeast 80
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigBlink | TriggerDescription$ Blink.
SVar:TrigBlink:DB$ ChangeZone | Origin$ Battlefield | Destination$ Exile | TargetType$ Card | ValidTgts$ Permanent.YouCtrl+nonLand | TargetMin$ 0 | TargetMax$ 99 | SubAbility$ DBReturn
SVar:DBReturn:DB$ DelayedTrigger | Mode$ Phase | Phase$ End of Turn | Execute$ DBChange
SVar:DBChange:DB$ ChangeZone | Origin$ Exile | Destination$ Battlefield | Defined$ DelayTriggerRemembered
Oracle:Yorion parse.
`,
    },
    players: [
      { life: 20, hand: ["Yorion, Sky Nomad"], battlefield: [], manaPool: ["W", "U", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 723. Spell — Zirda the Dawnwaker in hand.
  {
    id: "zirda-the-dawnwaker-in-hand",
    description: "Zirda the Dawnwaker in hand; companion cost-reducer parse.",
    seed: 0x31a,
    cards: {
      "Zirda, the Dawnwaker": `Name:Zirda, the Dawnwaker
ManaCost:R W
Types:Legendary Creature Elemental Hound
PT:3/3
K:Vigilance
K:Companion:CompanionZirda
SVar:CompanionZirda:Mode$ AllNonLand+activatedAbility
S:Mode$ ReduceCost | EffectZone$ Battlefield | ValidCard$ Permanent.YouCtrl | Type$ Activated | Activator$ You | Amount$ 2 | Description$ -2 cost.
A:AB$ Untap | Cost$ 1 R W | TargetType$ Card | ValidTgts$ Permanent.YouCtrl | SpellDescription$ Untap.
Oracle:Zirda parse.
`,
    },
    players: [
      { life: 20, hand: ["Zirda, the Dawnwaker"], battlefield: [], manaPool: ["R", "W"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 724. Spell — Kaheera the Orphanguard in hand.
  {
    id: "kaheera-the-orphanguard-in-hand",
    description: "Kaheera the Orphanguard in hand; companion tribal parse.",
    seed: 0x31b,
    cards: {
      "Kaheera, the Orphanguard": `Name:Kaheera, the Orphanguard
ManaCost:1 G W
Types:Legendary Creature Cat Beast
PT:3/2
K:Vigilance
K:Companion:CompanionKaheera
SVar:CompanionKaheera:Mode$ Mode$ AllNonLand+CreatureType+Cat
S:Mode$ Continuous | Affected$ Creature.Cat+YouCtrl,Creature.Beast+YouCtrl,Creature.Elemental+YouCtrl,Creature.Nightmare+YouCtrl,Creature.Dinosaur+YouCtrl | AddPower$ 1 | AddToughness$ 1 | Description$ Anthem.
Oracle:Kaheera parse.
`,
    },
    players: [
      { life: 20, hand: ["Kaheera, the Orphanguard"], battlefield: [], manaPool: ["G", "W", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 725. Spell — Obosh the Preypiercer in hand.
  {
    id: "obosh-the-preypiercer-in-hand",
    description: "Obosh the Preypiercer in hand; companion odd doublestrike parse.",
    seed: 0x31c,
    cards: {
      "Obosh, the Preypiercer": `Name:Obosh, the Preypiercer
ManaCost:3 R R
Types:Legendary Creature Hellion
PT:3/5
K:Companion:CompanionObosh
SVar:CompanionObosh:Mode$ AllNonLand+OddManaCost
T:Mode$ DamageDone | ValidSource$ Card.YouCtrl+cmcOdd | Execute$ TrigDouble | TriggerDescription$ Double.
SVar:TrigDouble:DB$ DealDamage | NumDmg$ X | References$ X | Defined$ TriggeredTarget
SVar:X:TriggerCount$DamageAmount
Oracle:Obosh parse.
`,
    },
    players: [
      { life: 20, hand: ["Obosh, the Preypiercer"], battlefield: [], manaPool: ["R", "R", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 726. Spell — Keruga the Macrosage in hand.
  {
    id: "keruga-the-macrosage-in-hand",
    description: "Keruga the Macrosage in hand; companion 3+ parse.",
    seed: 0x31d,
    cards: {
      "Keruga, the Macrosage": `Name:Keruga, the Macrosage
ManaCost:3 G U
Types:Legendary Creature Dinosaur Hippo
PT:5/4
K:Companion:CompanionKeruga
SVar:CompanionKeruga:Mode$ AllNonLand+cmcGE3
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDraw | TriggerDescription$ Draw cmc.
SVar:TrigDraw:DB$ Draw | NumCards$ X | References$ X
SVar:X:Count$ValidPermanents Card.YouCtrl
Oracle:Keruga parse.
`,
    },
    players: [
      { life: 20, hand: ["Keruga, the Macrosage"], battlefield: [], manaPool: ["G", "U", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 727. Spell — Gyruda Doom of Depths in hand.
  {
    id: "gyruda-doom-of-depths-in-hand",
    description: "Gyruda Doom of Depths in hand; companion mill-4 parse.",
    seed: 0x31e,
    cards: {
      "Gyruda, Doom of Depths": `Name:Gyruda, Doom of Depths
ManaCost:2 U U B B
Types:Legendary Creature Kraken
PT:6/6
K:Companion:CompanionGyruda
SVar:CompanionGyruda:Mode$ AllNonLand+EvenManaCost
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigMill | TriggerDescription$ Mill.
SVar:TrigMill:DB$ RepeatEach | RepeatPlayers$ Player | RepeatSubAbility$ DBMillEach
SVar:DBMillEach:DB$ Mill | NumCards$ 4 | Defined$ Player.IsRemembered | SubAbility$ DBReturn
SVar:DBReturn:DB$ ChangeZone | Origin$ Graveyard | Destination$ Battlefield | ChangeType$ Creature.cmcEven | ChangeNum$ 1 | Hidden$ True
Oracle:Gyruda parse.
`,
    },
    players: [
      {
        life: 20,
        hand: ["Gyruda, Doom of Depths"],
        battlefield: [],
        manaPool: ["U", "U", "B", "B", "C", "C"],
      },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 728. Spell — Jegantha the Wellspring in hand.
  {
    id: "jegantha-the-wellspring-in-hand",
    description: "Jegantha the Wellspring in hand; companion mana parse.",
    seed: 0x31f,
    cards: {
      "Jegantha, the Wellspring": `Name:Jegantha, the Wellspring
ManaCost:G W U B R
Types:Legendary Creature Elemental Elk
PT:5/5
K:Companion:CompanionJegantha
SVar:CompanionJegantha:Mode$ AllNonLand+singletonManaSymbols
A:AB$ Mana | Cost$ T | Produced$ Combo W U B R G | Amount$ 5 | RestrictValid$ Activated
Oracle:Jegantha parse.
`,
    },
    players: [
      { life: 20, hand: ["Jegantha, the Wellspring"], battlefield: [], manaPool: ["G", "W", "U", "B", "R"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 729. Spell — Lutri the Spellchaser in hand.
  {
    id: "lutri-the-spellchaser-in-hand",
    description: "Lutri the Spellchaser in hand; companion copy parse.",
    seed: 0x320,
    cards: {
      "Lutri, the Spellchaser": `Name:Lutri, the Spellchaser
ManaCost:1 U R
Types:Legendary Creature Otter Elemental
PT:3/2
K:Flash
K:Companion:CompanionLutri
SVar:CompanionLutri:Mode$ AllNonLand+SingletonDeck
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigCopy | TriggerDescription$ Copy.
SVar:TrigCopy:DB$ CopySpellAbility | Defined$ TriggeredCard | Spell$ Instant,Sorcery
Oracle:Lutri parse.
`,
    },
    players: [
      { life: 20, hand: ["Lutri, the Spellchaser"], battlefield: [], manaPool: ["U", "R", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 730. Spell — Umori the Collector in hand.
  {
    id: "umori-the-collector-in-hand",
    description: "Umori the Collector in hand; companion type-reducer parse.",
    seed: 0x321,
    cards: {
      "Umori, the Collector": `Name:Umori, the Collector
ManaCost:1 B G
Types:Legendary Creature Ooze
PT:4/4
K:Companion:CompanionUmori
SVar:CompanionUmori:Mode$ AllNonLand+sharedType
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigChooseType | TriggerDescription$ Choose.
SVar:TrigChooseType:DB$ ChooseType | Type$ Creature
S:Mode$ ReduceCost | EffectZone$ Battlefield | ValidCard$ Card.ChosenType | Type$ Spell | Activator$ You | Amount$ 1 | Description$ Reduce.
Oracle:Umori parse.
`,
    },
    players: [
      { life: 20, hand: ["Umori, the Collector"], battlefield: [], manaPool: ["B", "G", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 731. Spell — Yoshimaru Ever Faithful in hand.
  {
    id: "yoshimaru-ever-faithful-in-hand",
    description: "Yoshimaru Ever Faithful in hand; partner legendary parse.",
    seed: 0x322,
    cards: {
      "Yoshimaru, Ever Faithful": `Name:Yoshimaru, Ever Faithful
ManaCost:1 W
Types:Legendary Creature Dog
PT:1/1
K:Partner
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Permanent.YouCtrl+Legendary+Other | Execute$ TrigCounter | TriggerDescription$ +1.
SVar:TrigCounter:DB$ PutCounter | Defined$ Self | CounterType$ P1P1 | CounterNum$ 1
Oracle:Yoshimaru parse.
`,
    },
    players: [
      { life: 20, hand: ["Yoshimaru, Ever Faithful"], battlefield: [], manaPool: ["W", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 732. Spell — Tana, the Bloodsower in hand.
  {
    id: "tana-the-bloodsower-in-hand",
    description: "Tana, the Bloodsower in hand; partner saproling parse.",
    seed: 0x323,
    cards: {
      "Tana, the Bloodsower": `Name:Tana, the Bloodsower
ManaCost:2 R G
Types:Legendary Creature Elf Druid
PT:2/2
K:Vigilance
K:Partner
T:Mode$ DamageDone | ValidSource$ Card.Self | ValidTarget$ Player | CombatDamage$ True | Execute$ TrigToken | TriggerDescription$ Saps.
SVar:TrigToken:DB$ Token | TokenScript$ g_1_1_saproling | TokenAmount$ X | References$ X
SVar:X:TriggerCount$DamageAmount
Oracle:Tana parse.
`,
    },
    players: [
      { life: 20, hand: ["Tana, the Bloodsower"], battlefield: [], manaPool: ["R", "G", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 733. Spell — Hammer of Nazahn in hand.
  {
    id: "hammer-of-nazahn-in-hand",
    description: "Hammer of Nazahn in hand; equipment auto-attach parse.",
    seed: 0x324,
    cards: {
      "Hammer of Nazahn": `Name:Hammer of Nazahn
ManaCost:4
Types:Legendary Artifact Equipment
K:Equip:3
S:Mode$ Continuous | Affected$ Creature.YouCtrl+EquippedBy | AddPower$ 2 | AddKeyword$ Indestructible | Description$ Boost.
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Creature.YouCtrl | Execute$ TrigAttach | TriggerDescription$ Auto-attach.
SVar:TrigAttach:DB$ Attach | Defined$ Self | Object$ TriggeredCard
Oracle:Hammer parse.
`,
    },
    players: [
      { life: 20, hand: ["Hammer of Nazahn"], battlefield: [], manaPool: ["C", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 734. Spell — Sword of Fire and Ice in hand.
  {
    id: "sword-of-fire-and-ice-m613-in-hand",
    description: "Sword of Fire and Ice in hand; protection equipment parse.",
    seed: 0x325,
    cards: {
      "Sword of Fire and Ice": `Name:Sword of Fire and Ice
ManaCost:3
Types:Artifact Equipment
K:Equip:2
S:Mode$ Continuous | Affected$ Creature.YouCtrl+EquippedBy | AddPower$ 2 | AddToughness$ 2 | AddKeyword$ Protection from red & Protection from blue | Description$ Boost.
T:Mode$ DamageDone | ValidSource$ Creature.AttachedBy | ValidTarget$ Player | CombatDamage$ True | Execute$ TrigDmg
SVar:TrigDmg:DB$ DealDamage | NumDmg$ 2 | ValidTgts$ Creature,Player | SubAbility$ DBDraw
SVar:DBDraw:DB$ Draw | NumCards$ 1
Oracle:SoFI parse.
`,
    },
    players: [
      { life: 20, hand: ["Sword of Fire and Ice"], battlefield: [], manaPool: ["C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 735. Spell — Sword of Light and Shadow in hand.
  {
    id: "sword-of-light-and-shadow-in-hand",
    description: "Sword of Light and Shadow in hand; gain-life return parse.",
    seed: 0x326,
    cards: {
      "Sword of Light and Shadow": `Name:Sword of Light and Shadow
ManaCost:3
Types:Artifact Equipment
K:Equip:2
S:Mode$ Continuous | Affected$ Creature.YouCtrl+EquippedBy | AddPower$ 2 | AddToughness$ 2 | AddKeyword$ Protection from white & Protection from black | Description$ Boost.
T:Mode$ DamageDone | ValidSource$ Creature.AttachedBy | ValidTarget$ Player | CombatDamage$ True | Execute$ TrigGain
SVar:TrigGain:DB$ GainLife | LifeAmount$ 3 | SubAbility$ DBReturn
SVar:DBReturn:DB$ ChangeZone | TargetType$ Card | ValidTgts$ Creature.YouCtrl+inZoneGraveyard | Origin$ Graveyard | Destination$ Hand
Oracle:SoLS parse.
`,
    },
    players: [
      { life: 20, hand: ["Sword of Light and Shadow"], battlefield: [], manaPool: ["C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 736. Spell — Skullclamp in hand.
  {
    id: "skullclamp-m613-in-hand",
    description: "Skullclamp in hand; equipment death-draw parse.",
    seed: 0x327,
    cards: {
      Skullclamp: `Name:Skullclamp
ManaCost:1
Types:Artifact Equipment
K:Equip:1
S:Mode$ Continuous | Affected$ Creature.YouCtrl+EquippedBy | AddPower$ 1 | AddToughness$ -1 | Description$ Boost.
T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Creature.AttachedBy | Execute$ TrigDraw
SVar:TrigDraw:DB$ Draw | NumCards$ 2
Oracle:Skullclamp parse.
`,
    },
    players: [
      { life: 20, hand: ["Skullclamp"], battlefield: [], manaPool: ["C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 737. Spell — Umezawa's Jitte in hand.
  {
    id: "umezawas-jitte-m613-in-hand",
    description: "Umezawa's Jitte in hand; charge counter equipment parse.",
    seed: 0x328,
    cards: {
      "Umezawa's Jitte": `Name:Umezawa's Jitte
ManaCost:2
Types:Legendary Artifact Equipment
K:Equip:2
T:Mode$ DamageDone | ValidSource$ Creature.AttachedBy | CombatDamage$ True | Execute$ TrigCounter | TriggerDescription$ +2.
SVar:TrigCounter:DB$ PutCounter | Defined$ Self | CounterType$ CHARGE | CounterNum$ 2
A:AB$ DealDamage | Cost$ SubCounter<1/CHARGE> | NumDmg$ 1 | ValidTgts$ Creature | SpellDescription$ Pop.
A:AB$ Pump | Cost$ SubCounter<1/CHARGE> | TargetType$ Card | ValidTgts$ Creature.AttachedBy | NumAtt$ +2 | NumDef$ +2 | UntilEOT$ True | SpellDescription$ Pump.
A:AB$ GainLife | Cost$ SubCounter<1/CHARGE> | LifeAmount$ 2 | SpellDescription$ Gain.
Oracle:Jitte parse.
`,
    },
    players: [
      { life: 20, hand: ["Umezawa's Jitte"], battlefield: [], manaPool: ["C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 738. Spell — Stoneforge Mystic (m613) in hand.
  {
    id: "stoneforge-mystic-m613-in-hand",
    description: "Stoneforge Mystic M613 in hand; tutor cheat parse.",
    seed: 0x329,
    cards: {
      "Stoneforge Mystic M613": `Name:Stoneforge Mystic M613
ManaCost:1 W
Types:Creature Kor Artificer
PT:1/2
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigSearch | OptionalDecider$ You | TriggerDescription$ Tutor.
SVar:TrigSearch:DB$ ChangeZone | Origin$ Library | Destination$ Hand | ChangeType$ Equipment | ChangeNum$ 1
A:AB$ ChangeZone | Cost$ 1 W Discard<1/Card.Equipment> | TargetType$ Card | ValidTgts$ Equipment.YouCtrl+inZoneHand | Origin$ Hand | Destination$ Battlefield | SpellDescription$ Cheat.
Oracle:Stoneforge M613 parse.
`,
    },
    players: [
      { life: 20, hand: ["Stoneforge Mystic M613"], battlefield: [], manaPool: ["W", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 739. Spell — Batterskull in hand.
  {
    id: "batterskull-m613-in-hand",
    description: "Batterskull in hand; germ-token equipment parse.",
    seed: 0x32a,
    cards: {
      Batterskull: `Name:Batterskull
ManaCost:5
Types:Artifact Equipment
K:Equip:5
S:Mode$ Continuous | Affected$ Creature.YouCtrl+EquippedBy | AddPower$ 4 | AddToughness$ 4 | AddKeyword$ Vigilance & Lifelink | Description$ Boost.
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigToken
SVar:TrigToken:DB$ Token | TokenScript$ c_0_0_germ | TokenAmount$ 1 | RememberTokens$ True | SubAbility$ DBAttach
SVar:DBAttach:DB$ Attach | Defined$ Self | Object$ Remembered
A:AB$ ChangeZone | Cost$ 3 | Origin$ Battlefield | Destination$ Hand | Defined$ Self | SpellDescription$ Live.
Oracle:Batterskull parse.
`,
    },
    players: [
      { life: 20, hand: ["Batterskull"], battlefield: [], manaPool: ["C", "C", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 740. Spell — Birthing Pod in hand.
  {
    id: "birthing-pod-m613-in-hand",
    description: "Birthing Pod in hand; sac fetch +1 cmc parse.",
    seed: 0x32b,
    cards: {
      "Birthing Pod": `Name:Birthing Pod
ManaCost:3 G/P
Types:Artifact
A:AB$ ChangeZone | Cost$ 1 G/P T Sac<1/Creature/sacrificed> | Origin$ Library | Destination$ Battlefield | ChangeType$ Creature.YouOwn+cmcEQX | References$ X | SpellDescription$ Pod.
SVar:X:Sacrificed$CardManaCost/Plus.1
Oracle:Pod parse.
`,
    },
    players: [
      { life: 20, hand: ["Birthing Pod"], battlefield: [], manaPool: ["G", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 741. Spell — Survival of the Fittest in hand.
  {
    id: "survival-of-the-fittest-in-hand",
    description: "Survival of the Fittest in hand; discard tutor creature parse.",
    seed: 0x32c,
    cards: {
      "Survival of the Fittest": `Name:Survival of the Fittest
ManaCost:1 G
Types:Enchantment
A:AB$ ChangeZone | Cost$ G Discard<1/Card.Creature> | Origin$ Library | Destination$ Hand | ChangeType$ Creature | ChangeNum$ 1 | SpellDescription$ Survival.
Oracle:Survival parse.
`,
    },
    players: [
      { life: 20, hand: ["Survival of the Fittest"], battlefield: [], manaPool: ["G", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 742. Spell — Recurring Nightmare in hand.
  {
    id: "recurring-nightmare-in-hand",
    description: "Recurring Nightmare in hand; reanimate sac parse.",
    seed: 0x32d,
    cards: {
      "Recurring Nightmare": `Name:Recurring Nightmare
ManaCost:2 B
Types:Enchantment
A:AB$ ChangeZone | Cost$ Sac<1/Creature> Return<1/CARDNAME> | Origin$ Graveyard | Destination$ Battlefield | TargetType$ Card | ValidTgts$ Creature.YouOwn+inZoneGraveyard | SpellDescription$ Recurring.
Oracle:Recurring parse.
`,
    },
    players: [
      { life: 20, hand: ["Recurring Nightmare"], battlefield: [], manaPool: ["B", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 743. Spell — Pattern of Rebirth in hand.
  {
    id: "pattern-of-rebirth-in-hand",
    description: "Pattern of Rebirth in hand; aura death tutor parse.",
    seed: 0x32e,
    cards: {
      "Pattern of Rebirth": `Name:Pattern of Rebirth
ManaCost:2 G G
Types:Enchantment Aura
K:Enchant Creature
A:SP$ Attach | Cost$ 2 G G | TargetType$ Card | ValidTgts$ Creature
T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Creature.AttachedBy | Execute$ TrigSearch | TriggerDescription$ Tutor on death.
SVar:TrigSearch:DB$ ChangeZone | Origin$ Library | Destination$ Battlefield | ChangeType$ Creature | ChangeNum$ 1
Oracle:Pattern parse.
`,
    },
    players: [
      { life: 20, hand: ["Pattern of Rebirth"], battlefield: [], manaPool: ["G", "G", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 744. Spell — Natural Order in hand.
  {
    id: "natural-order-in-hand",
    description: "Natural Order in hand; sac green tutor parse.",
    seed: 0x32f,
    cards: {
      "Natural Order": `Name:Natural Order
ManaCost:2 G G
Types:Sorcery
A:SP$ ChangeZone | Cost$ 2 G G Sac<1/Creature.Green> | Origin$ Library | Destination$ Battlefield | ChangeType$ Creature.Green | ChangeNum$ 1 | SpellDescription$ Order.
Oracle:Natural Order parse.
`,
    },
    players: [
      { life: 20, hand: ["Natural Order"], battlefield: [], manaPool: ["G", "G", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 745. Spell — Eureka in hand.
  {
    id: "eureka-in-hand",
    description: "Eureka in hand; mass cheat parse.",
    seed: 0x330,
    cards: {
      Eureka: `Name:Eureka
ManaCost:2 G G
Types:Sorcery
A:SP$ RepeatEach | Cost$ 2 G G | RepeatPlayers$ Player | RepeatSubAbility$ DBPut | SpellDescription$ Eureka.
SVar:DBPut:DB$ ChangeZone | Origin$ Hand | Destination$ Battlefield | ChangeType$ Permanent.YouOwn | ChangeNum$ 1 | Hidden$ True | Defined$ Player.IsRemembered
Oracle:Eureka parse.
`,
    },
    players: [
      { life: 20, hand: ["Eureka"], battlefield: [], manaPool: ["G", "G", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 746. Spell — Reanimate (m613) in hand.
  {
    id: "reanimate-m613-in-hand",
    description: "Reanimate M613 in hand; cheap reanim parse.",
    seed: 0x331,
    cards: {
      "Reanimate M613": `Name:Reanimate M613
ManaCost:B
Types:Sorcery
A:SP$ ChangeZone | Cost$ B | Origin$ Graveyard | Destination$ Battlefield | TargetType$ Card | ValidTgts$ Creature.inZoneGraveyard | SubAbility$ DBLose | SpellDescription$ Reanim M613.
SVar:DBLose:DB$ LoseLife | Defined$ You | LifeAmount$ X | References$ X
SVar:X:TargetedCardCMC
Oracle:Reanim M613 parse.
`,
    },
    players: [
      { life: 20, hand: ["Reanimate M613"], battlefield: [], manaPool: ["B"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 747. Spell — Buried Alive in hand.
  {
    id: "buried-alive-in-hand",
    description: "Buried Alive in hand; tutor 3 to graveyard parse.",
    seed: 0x332,
    cards: {
      "Buried Alive": `Name:Buried Alive
ManaCost:2 B
Types:Sorcery
A:SP$ ChangeZone | Cost$ 2 B | Origin$ Library | Destination$ Graveyard | ChangeType$ Creature | ChangeNum$ 3 | SpellDescription$ Bury.
Oracle:Buried Alive parse.
`,
    },
    players: [
      { life: 20, hand: ["Buried Alive"], battlefield: [], manaPool: ["B", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 748. Spell — Entomb in hand.
  {
    id: "entomb-in-hand",
    description: "Entomb in hand; tutor 1 to graveyard parse.",
    seed: 0x333,
    cards: {
      Entomb: `Name:Entomb
ManaCost:B
Types:Instant
A:SP$ ChangeZone | Cost$ B | Origin$ Library | Destination$ Graveyard | ChangeType$ Card | ChangeNum$ 1 | SpellDescription$ Entomb.
Oracle:Entomb parse.
`,
    },
    players: [
      { life: 20, hand: ["Entomb"], battlefield: [], manaPool: ["B"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 749. Spell — Gifts Ungiven in hand.
  {
    id: "gifts-ungiven-in-hand",
    description: "Gifts Ungiven in hand; opp split-2 parse.",
    seed: 0x334,
    cards: {
      "Gifts Ungiven": `Name:Gifts Ungiven
ManaCost:3 U
Types:Instant
A:SP$ ChangeZone | Cost$ 3 U | Origin$ Library | Destination$ Hand | ChangeType$ Card.differentnames | ChangeNum$ 4 | OpponentChooseTarget$ True | DestinationAlternative$ Graveyard | SpellDescription$ Gifts.
Oracle:Gifts parse.
`,
    },
    players: [
      { life: 20, hand: ["Gifts Ungiven"], battlefield: [], manaPool: ["U", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 750. Spell — Goblin Bombardment in hand.
  {
    id: "goblin-bombardment-m613-in-hand",
    description: "Goblin Bombardment in hand; sac ping parse.",
    seed: 0x335,
    cards: {
      "Goblin Bombardment": `Name:Goblin Bombardment
ManaCost:1 R
Types:Enchantment
A:AB$ DealDamage | Cost$ Sac<1/Creature> | NumDmg$ 1 | ValidTgts$ Creature,Player | SpellDescription$ Bomb.
Oracle:Bombardment parse.
`,
    },
    players: [
      { life: 20, hand: ["Goblin Bombardment"], battlefield: [], manaPool: ["R", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 751. Spell — Altar of Dementia in hand.
  {
    id: "altar-of-dementia-in-hand",
    description: "Altar of Dementia in hand; sac mill parse.",
    seed: 0x336,
    cards: {
      "Altar of Dementia": `Name:Altar of Dementia
ManaCost:2
Types:Artifact
A:AB$ Mill | Cost$ Sac<1/Creature> | NumCards$ X | TargetType$ Player | ValidTgts$ Player | References$ X | SpellDescription$ Altar.
SVar:X:Sacrificed$CardPower
Oracle:Altar parse.
`,
    },
    players: [
      { life: 20, hand: ["Altar of Dementia"], battlefield: [], manaPool: ["C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 752. Spell — Phyrexian Altar in hand.
  {
    id: "phyrexian-altar-in-hand",
    description: "Phyrexian Altar in hand; sac mana parse.",
    seed: 0x337,
    cards: {
      "Phyrexian Altar": `Name:Phyrexian Altar
ManaCost:3
Types:Artifact
A:AB$ Mana | Cost$ Sac<1/Creature> | Produced$ Combo W U B R G | SpellDescription$ Phyr Altar.
Oracle:Phyrexian Altar parse.
`,
    },
    players: [
      { life: 20, hand: ["Phyrexian Altar"], battlefield: [], manaPool: ["C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 753. Spell — Ashnod's Altar in hand.
  {
    id: "ashnods-altar-in-hand",
    description: "Ashnod's Altar in hand; sac CC parse.",
    seed: 0x338,
    cards: {
      "Ashnod's Altar": `Name:Ashnod's Altar
ManaCost:3
Types:Artifact
A:AB$ Mana | Cost$ Sac<1/Creature> | Produced$ C | Amount$ 2 | SpellDescription$ Ashnod.
Oracle:Ashnod's Altar parse.
`,
    },
    players: [
      { life: 20, hand: ["Ashnod's Altar"], battlefield: [], manaPool: ["C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 754. Spell — Cathars' Crusade in hand.
  {
    id: "cathars-crusade-in-hand",
    description: "Cathars' Crusade in hand; +1 ETB everyone parse.",
    seed: 0x339,
    cards: {
      "Cathars' Crusade": `Name:Cathars' Crusade
ManaCost:3 W W
Types:Enchantment
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Creature.YouCtrl | Execute$ TrigCounter | TriggerDescription$ Crusade.
SVar:TrigCounter:DB$ PutCounterAll | ValidCards$ Creature.YouCtrl | CounterType$ P1P1 | CounterNum$ 1
Oracle:Crusade parse.
`,
    },
    players: [
      { life: 20, hand: ["Cathars' Crusade"], battlefield: [], manaPool: ["W", "W", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 755. Spell — Anointed Procession (m613) in hand.
  {
    id: "anointed-procession-m613-in-hand",
    description: "Anointed Procession M613 in hand; replace tokens parse.",
    seed: 0x33a,
    cards: {
      "Anointed Procession M613": `Name:Anointed Procession M613
ManaCost:3 W
Types:Enchantment
R:Event$ CreateToken | ActiveZones$ Battlefield | ValidPlayer$ You | ReplaceWith$ DBDouble | Description$ Double.
SVar:DBDouble:DB$ ReplaceTokenAmount | Multiplier$ 2
Oracle:Anointed M613 parse.
`,
    },
    players: [
      { life: 20, hand: ["Anointed Procession M613"], battlefield: [], manaPool: ["W", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 756. Spell — Parallel Lives in hand.
  {
    id: "parallel-lives-in-hand",
    description: "Parallel Lives in hand; double tokens green parse.",
    seed: 0x33b,
    cards: {
      "Parallel Lives": `Name:Parallel Lives
ManaCost:3 G
Types:Enchantment
R:Event$ CreateToken | ActiveZones$ Battlefield | ValidPlayer$ You | ReplaceWith$ DBDouble | Description$ Double.
SVar:DBDouble:DB$ ReplaceTokenAmount | Multiplier$ 2
Oracle:Parallel Lives parse.
`,
    },
    players: [
      { life: 20, hand: ["Parallel Lives"], battlefield: [], manaPool: ["G", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 757. Spell — Primal Vigor in hand.
  {
    id: "primal-vigor-in-hand",
    description: "Primal Vigor in hand; symmetric token+counter doubler parse.",
    seed: 0x33c,
    cards: {
      "Primal Vigor": `Name:Primal Vigor
ManaCost:4 G
Types:Enchantment
R:Event$ CreateToken | ActiveZones$ Battlefield | ReplaceWith$ DBDouble | Description$ Double tokens.
SVar:DBDouble:DB$ ReplaceTokenAmount | Multiplier$ 2
R:Event$ AddCounter | ActiveZones$ Battlefield | ValidCard$ Creature | CounterType$ P1P1 | ReplaceWith$ DBDoubleC | Description$ Double counters.
SVar:DBDoubleC:DB$ ReplaceCounter | Multiplier$ 2
Oracle:Primal Vigor parse.
`,
    },
    players: [
      { life: 20, hand: ["Primal Vigor"], battlefield: [], manaPool: ["G", "C", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 758. Spell — Doubling Season (m613) in hand.
  {
    id: "doubling-season-m613-in-hand",
    description: "Doubling Season M613 in hand; symmetric doubler parse.",
    seed: 0x33d,
    cards: {
      "Doubling Season M613": `Name:Doubling Season M613
ManaCost:4 G
Types:Enchantment
R:Event$ AddCounter | ActiveZones$ Battlefield | ValidCard$ Permanent.YouCtrl | ReplaceWith$ DoubleAmount | Description$ Double counters.
SVar:DoubleAmount:DB$ ReplaceCounter | Multiplier$ 2
R:Event$ CreateToken | ActiveZones$ Battlefield | ValidPlayer$ You | ReplaceWith$ DoubleTokens | Description$ Double tokens.
SVar:DoubleTokens:DB$ ReplaceTokenAmount | Multiplier$ 2
Oracle:DS M613 parse.
`,
    },
    players: [
      { life: 20, hand: ["Doubling Season M613"], battlefield: [], manaPool: ["G", "C", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 759. Spell — Branching Evolution in hand.
  {
    id: "branching-evolution-in-hand",
    description: "Branching Evolution in hand; double creature counters parse.",
    seed: 0x33e,
    cards: {
      "Branching Evolution": `Name:Branching Evolution
ManaCost:2 G
Types:Enchantment
R:Event$ AddCounter | ActiveZones$ Battlefield | ValidCard$ Creature.YouCtrl | CounterType$ P1P1 | ReplaceWith$ DoubleAmount | Description$ Double.
SVar:DoubleAmount:DB$ ReplaceCounter | Multiplier$ 2
Oracle:Branching parse.
`,
    },
    players: [
      { life: 20, hand: ["Branching Evolution"], battlefield: [], manaPool: ["G", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 760. Spell — Increasing Ambition in hand.
  {
    id: "increasing-ambition-in-hand",
    description: "Increasing Ambition in hand; flashback tutor parse.",
    seed: 0x33f,
    cards: {
      "Increasing Ambition": `Name:Increasing Ambition
ManaCost:4 B
Types:Sorcery
A:SP$ ChangeZone | Cost$ 4 B | Origin$ Library | Destination$ Hand | ChangeNum$ 1 | SpellDescription$ Tutor.
K:Flashback:7 B
Oracle:Increasing Ambition parse.
`,
    },
    players: [
      { life: 20, hand: ["Increasing Ambition"], battlefield: [], manaPool: ["B", "C", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 761. Spell — Mystical Tutor in hand.
  {
    id: "mystical-tutor-m613-in-hand",
    description: "Mystical Tutor in hand; instant/sorcery to top parse.",
    seed: 0x340,
    cards: {
      "Mystical Tutor": `Name:Mystical Tutor
ManaCost:U
Types:Instant
A:SP$ ChangeZone | Cost$ U | Origin$ Library | Destination$ Library | LibraryPosition$ 0 | ChangeType$ Instant,Sorcery | ChangeNum$ 1 | SpellDescription$ Mystical.
Oracle:Mystical Tutor parse.
`,
    },
    players: [
      { life: 20, hand: ["Mystical Tutor"], battlefield: [], manaPool: ["U"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 762. Spell — Enlightened Tutor in hand.
  {
    id: "enlightened-tutor-m613-in-hand",
    description: "Enlightened Tutor in hand; artifact/enchantment to top parse.",
    seed: 0x341,
    cards: {
      "Enlightened Tutor": `Name:Enlightened Tutor
ManaCost:W
Types:Instant
A:SP$ ChangeZone | Cost$ W | Origin$ Library | Destination$ Library | LibraryPosition$ 0 | ChangeType$ Artifact,Enchantment | ChangeNum$ 1 | SpellDescription$ Enlightened.
Oracle:Enlightened Tutor parse.
`,
    },
    players: [
      { life: 20, hand: ["Enlightened Tutor"], battlefield: [], manaPool: ["W"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 763. Spell — Worldly Tutor (m613) in hand.
  {
    id: "worldly-tutor-m613-in-hand",
    description: "Worldly Tutor M613 in hand; creature to top parse.",
    seed: 0x342,
    cards: {
      "Worldly Tutor M613": `Name:Worldly Tutor M613
ManaCost:G
Types:Instant
A:SP$ ChangeZone | Cost$ G | Origin$ Library | Destination$ Library | LibraryPosition$ 0 | ChangeType$ Creature | ChangeNum$ 1 | SpellDescription$ Worldly M613.
Oracle:Worldly M613 parse.
`,
    },
    players: [
      { life: 20, hand: ["Worldly Tutor M613"], battlefield: [], manaPool: ["G"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 764. Spell — Idyllic Tutor in hand.
  {
    id: "idyllic-tutor-in-hand",
    description: "Idyllic Tutor in hand; enchantment tutor parse.",
    seed: 0x343,
    cards: {
      "Idyllic Tutor": `Name:Idyllic Tutor
ManaCost:2 W
Types:Sorcery
A:SP$ ChangeZone | Cost$ 2 W | Origin$ Library | Destination$ Hand | ChangeType$ Enchantment | ChangeNum$ 1 | SpellDescription$ Idyllic.
Oracle:Idyllic parse.
`,
    },
    players: [
      { life: 20, hand: ["Idyllic Tutor"], battlefield: [], manaPool: ["W", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 765. Spell — Fierce Empath in hand.
  {
    id: "fierce-empath-in-hand",
    description: "Fierce Empath in hand; cmc6+ creature tutor parse.",
    seed: 0x344,
    cards: {
      "Fierce Empath": `Name:Fierce Empath
ManaCost:3 G
Types:Creature Elf Druid
PT:2/1
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigSearch | TriggerDescription$ Tutor.
SVar:TrigSearch:DB$ ChangeZone | Origin$ Library | Destination$ Hand | ChangeType$ Creature.cmcGE6 | ChangeNum$ 1
Oracle:Fierce Empath parse.
`,
    },
    players: [
      { life: 20, hand: ["Fierce Empath"], battlefield: [], manaPool: ["G", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 766. Spell — Diabolic Intent in hand.
  {
    id: "diabolic-intent-in-hand",
    description: "Diabolic Intent in hand; sac creature tutor parse.",
    seed: 0x345,
    cards: {
      "Diabolic Intent": `Name:Diabolic Intent
ManaCost:1 B
Types:Sorcery
A:SP$ ChangeZone | Cost$ 1 B Sac<1/Creature> | Origin$ Library | Destination$ Hand | ChangeNum$ 1 | SpellDescription$ Intent.
Oracle:Intent parse.
`,
    },
    players: [
      { life: 20, hand: ["Diabolic Intent"], battlefield: [], manaPool: ["B", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 767. Spell — Increasing Vengeance in hand.
  {
    id: "increasing-vengeance-in-hand",
    description: "Increasing Vengeance in hand; copy spell flashback parse.",
    seed: 0x346,
    cards: {
      "Increasing Vengeance": `Name:Increasing Vengeance
ManaCost:R R
Types:Instant
A:SP$ CopySpellAbility | Cost$ R R | TargetType$ Spell | ValidTgts$ Card.Instant+YouCtrl,Card.Sorcery+YouCtrl | Amount$ 1 | SpellDescription$ Increasing.
K:Flashback:3 R R
Oracle:Increasing Vengeance parse.
`,
    },
    players: [
      { life: 20, hand: ["Increasing Vengeance"], battlefield: [], manaPool: ["R", "R"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 768. Spell — Reverberate in hand.
  {
    id: "reverberate-in-hand",
    description: "Reverberate in hand; copy spell parse.",
    seed: 0x347,
    cards: {
      Reverberate: `Name:Reverberate
ManaCost:R R
Types:Instant
A:SP$ CopySpellAbility | Cost$ R R | TargetType$ Spell | ValidTgts$ Card.Instant,Card.Sorcery | Amount$ 1 | SpellDescription$ Reverberate.
Oracle:Reverberate parse.
`,
    },
    players: [
      { life: 20, hand: ["Reverberate"], battlefield: [], manaPool: ["R", "R"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 769. Spell — Twincast in hand.
  {
    id: "twincast-in-hand",
    description: "Twincast in hand; copy spell parse.",
    seed: 0x348,
    cards: {
      Twincast: `Name:Twincast
ManaCost:U U
Types:Instant
A:SP$ CopySpellAbility | Cost$ U U | TargetType$ Spell | ValidTgts$ Card.Instant,Card.Sorcery | Amount$ 1 | MayChooseTarget$ True | SpellDescription$ Twincast.
Oracle:Twincast parse.
`,
    },
    players: [
      { life: 20, hand: ["Twincast"], battlefield: [], manaPool: ["U", "U"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 770. Spell — Ral Storm Conduit in hand.
  {
    id: "ral-storm-conduit-in-hand",
    description: "Ral Storm Conduit in hand; PW copy parse.",
    seed: 0x349,
    cards: {
      "Ral, Storm Conduit": `Name:Ral, Storm Conduit
ManaCost:2 U R
Types:Legendary Planeswalker Ral
Loyalty:4
T:Mode$ SpellCast | ValidPlayer$ You | ValidCard$ Card.Instant,Card.Sorcery | Execute$ TrigDmg | TriggerDescription$ Ping.
SVar:TrigDmg:DB$ DealDamage | NumDmg$ 1 | ValidTgts$ Creature,Player
A:AB$ Draw | Cost$ AddCounter<1/LOYALTY> | Planeswalker$ True | NumCards$ 1 | SubAbility$ DBScry | SpellDescription$ +1.
SVar:DBScry:DB$ Scry | ScryNum$ 1
A:AB$ CopySpellAbility | Cost$ SubCounter<2/LOYALTY> | Planeswalker$ True | TargetType$ Spell | ValidTgts$ Card.Instant,Card.Sorcery | Amount$ 1 | SpellDescription$ -2.
Oracle:Ral parse.
`,
    },
    players: [
      { life: 20, hand: ["Ral, Storm Conduit"], battlefield: [], manaPool: ["U", "R", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 771. Spell — Showdown of the Skalds in hand.
  {
    id: "showdown-of-the-skalds-in-hand",
    description: "Showdown of the Skalds in hand; saga 3-chapter exile parse.",
    seed: 0x34a,
    cards: {
      "Showdown of the Skalds": `Name:Showdown of the Skalds
ManaCost:2 R W
Types:Enchantment Saga
K:Chapter:3:DBExile,DBPump,DBPump
SVar:DBExile:DB$ Dig | DigNum$ 4 | ChangeNum$ All | DestinationZone$ Exile | RememberChanged$ True | ChangeValid$ Card | DigUntil$ True
SVar:DBPump:DB$ PumpAll | ValidCards$ Creature.YouCtrl | NumAtt$ +1 | NumDef$ +1 | UntilEOT$ True
Oracle:Showdown parse.
`,
    },
    players: [
      { life: 20, hand: ["Showdown of the Skalds"], battlefield: [], manaPool: ["R", "W", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 772. Spell — Welcome to Sky's End in hand.
  {
    id: "welcome-to-skys-end-in-hand",
    description: "Welcome to Sky's End in hand; saga ramp parse.",
    seed: 0x34b,
    cards: {
      "Welcome to Sky's End": `Name:Welcome to Sky's End
ManaCost:2 R
Types:Enchantment Saga
K:Chapter:3:DBToken,DBLoot,DBSearch
SVar:DBToken:DB$ Token | TokenScript$ r_2_2_dwarf_warrior | TokenAmount$ 1
SVar:DBLoot:DB$ Discard | Defined$ You | NumCards$ 1 | Mode$ TgtChoose | SubAbility$ DBDraw
SVar:DBDraw:DB$ Draw | NumCards$ 1
SVar:DBSearch:DB$ ChangeZone | Origin$ Library | Destination$ Hand | ChangeType$ Land.Mountain | ChangeNum$ 1
Oracle:Welcome to Sky's End parse.
`,
    },
    players: [
      { life: 20, hand: ["Welcome to Sky's End"], battlefield: [], manaPool: ["R", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 773. Spell — Vanishing Verse in hand.
  {
    id: "vanishing-verse-in-hand",
    description: "Vanishing Verse in hand; mono-color exile parse.",
    seed: 0x34c,
    cards: {
      "Vanishing Verse": `Name:Vanishing Verse
ManaCost:W B
Types:Instant
A:SP$ ChangeZone | Cost$ W B | TargetType$ Card | ValidTgts$ Permanent.MonoColor | Origin$ Battlefield | Destination$ Exile | SpellDescription$ Verse.
Oracle:Verse parse.
`,
    },
    players: [
      { life: 20, hand: ["Vanishing Verse"], battlefield: [], manaPool: ["W", "B"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 774. Spell — Anguished Unmaking in hand.
  {
    id: "anguished-unmaking-m613-in-hand",
    description: "Anguished Unmaking in hand; pay-life exile any parse.",
    seed: 0x34d,
    cards: {
      "Anguished Unmaking": `Name:Anguished Unmaking
ManaCost:1 W B
Types:Instant
A:SP$ ChangeZone | Cost$ 1 W B PayLife<3> | TargetType$ Card | ValidTgts$ Permanent.nonLand | Origin$ Battlefield | Destination$ Exile | SpellDescription$ Unmake.
Oracle:Anguished Unmaking parse.
`,
    },
    players: [
      { life: 20, hand: ["Anguished Unmaking"], battlefield: [], manaPool: ["W", "B", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 775. Spell — Despark in hand.
  {
    id: "despark-in-hand",
    description: "Despark in hand; cmc4+ exile parse.",
    seed: 0x34e,
    cards: {
      Despark: `Name:Despark
ManaCost:W B
Types:Instant
A:SP$ ChangeZone | Cost$ W B | TargetType$ Card | ValidTgts$ Permanent.nonLand+cmcGE4 | Origin$ Battlefield | Destination$ Exile | SpellDescription$ Despark.
Oracle:Despark parse.
`,
    },
    players: [
      { life: 20, hand: ["Despark"], battlefield: [], manaPool: ["W", "B"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 776. Spell — Utter End in hand.
  {
    id: "utter-end-in-hand",
    description: "Utter End in hand; instant exile any parse.",
    seed: 0x34f,
    cards: {
      "Utter End": `Name:Utter End
ManaCost:2 W B
Types:Instant
A:SP$ ChangeZone | Cost$ 2 W B | TargetType$ Card | ValidTgts$ Permanent.nonLand | Origin$ Battlefield | Destination$ Exile | SpellDescription$ Utter End.
Oracle:Utter End parse.
`,
    },
    players: [
      { life: 20, hand: ["Utter End"], battlefield: [], manaPool: ["W", "B", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 777. Spell — Maelstrom Pulse in hand.
  {
    id: "maelstrom-pulse-in-hand",
    description: "Maelstrom Pulse in hand; destroy all named parse.",
    seed: 0x350,
    cards: {
      "Maelstrom Pulse": `Name:Maelstrom Pulse
ManaCost:1 B G
Types:Sorcery
A:SP$ Destroy | Cost$ 1 B G | TargetType$ Card | ValidTgts$ Permanent.nonLand | RememberDestroyed$ True | SubAbility$ DBDestroyAll | SpellDescription$ Pulse.
SVar:DBDestroyAll:DB$ DestroyAll | ValidCards$ Permanent.sharedNameWithRemembered+Other
Oracle:Maelstrom Pulse parse.
`,
    },
    players: [
      { life: 20, hand: ["Maelstrom Pulse"], battlefield: [], manaPool: ["B", "G", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 778. Spell — Assassin's Trophy in hand.
  {
    id: "assassins-trophy-m613-in-hand",
    description: "Assassin's Trophy in hand; destroy any opp ramp parse.",
    seed: 0x351,
    cards: {
      "Assassin's Trophy": `Name:Assassin's Trophy
ManaCost:B G
Types:Instant
A:SP$ Destroy | Cost$ B G | TargetType$ Card | ValidTgts$ Permanent.OppCtrl | SubAbility$ DBSearch | SpellDescription$ Trophy.
SVar:DBSearch:DB$ ChangeZone | Defined$ Targeted | DefinedPlayer$ Targeted | Origin$ Library | Destination$ Battlefield | ChangeType$ Land.Basic | ChangeNum$ 1 | Tapped$ True
Oracle:Assassin's Trophy parse.
`,
    },
    players: [
      { life: 20, hand: ["Assassin's Trophy"], battlefield: [], manaPool: ["B", "G"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 779. Spell — Abrupt Decay in hand.
  {
    id: "abrupt-decay-in-hand",
    description: "Abrupt Decay in hand; cmc3- destroy parse.",
    seed: 0x352,
    cards: {
      "Abrupt Decay": `Name:Abrupt Decay
ManaCost:B G
Types:Instant
K:CARDNAME can't be countered.
A:SP$ Destroy | Cost$ B G | TargetType$ Card | ValidTgts$ Permanent.nonLand+cmcLE3 | NoRegen$ True | SpellDescription$ Decay.
Oracle:Abrupt Decay parse.
`,
    },
    players: [
      { life: 20, hand: ["Abrupt Decay"], battlefield: [], manaPool: ["B", "G"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 780. Spell — Putrefy in hand.
  {
    id: "putrefy-in-hand",
    description: "Putrefy in hand; destroy creature/artifact parse.",
    seed: 0x353,
    cards: {
      Putrefy: `Name:Putrefy
ManaCost:1 B G
Types:Instant
A:SP$ Destroy | Cost$ 1 B G | TargetType$ Card | ValidTgts$ Creature,Artifact | NoRegen$ True | SpellDescription$ Putrefy.
Oracle:Putrefy parse.
`,
    },
    players: [
      { life: 20, hand: ["Putrefy"], battlefield: [], manaPool: ["B", "G", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 781. Spell — Krosan Grip in hand.
  {
    id: "krosan-grip-in-hand",
    description: "Krosan Grip in hand; split-second destroy parse.",
    seed: 0x354,
    cards: {
      "Krosan Grip": `Name:Krosan Grip
ManaCost:2 G
Types:Instant
K:Split second
A:SP$ Destroy | Cost$ 2 G | TargetType$ Card | ValidTgts$ Artifact,Enchantment | SpellDescription$ Krosan.
Oracle:Krosan parse.
`,
    },
    players: [
      { life: 20, hand: ["Krosan Grip"], battlefield: [], manaPool: ["G", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 782. Spell — Naturalize in hand.
  {
    id: "naturalize-in-hand",
    description: "Naturalize in hand; destroy artifact/enchant parse.",
    seed: 0x355,
    cards: {
      Naturalize: `Name:Naturalize
ManaCost:1 G
Types:Instant
A:SP$ Destroy | Cost$ 1 G | TargetType$ Card | ValidTgts$ Artifact,Enchantment | SpellDescription$ Naturalize.
Oracle:Naturalize parse.
`,
    },
    players: [
      { life: 20, hand: ["Naturalize"], battlefield: [], manaPool: ["G", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 783. Spell — Disenchant in hand.
  {
    id: "disenchant-in-hand",
    description: "Disenchant in hand; W answer parse.",
    seed: 0x356,
    cards: {
      Disenchant: `Name:Disenchant
ManaCost:1 W
Types:Instant
A:SP$ Destroy | Cost$ 1 W | TargetType$ Card | ValidTgts$ Artifact,Enchantment | SpellDescription$ Disenchant.
Oracle:Disenchant parse.
`,
    },
    players: [
      { life: 20, hand: ["Disenchant"], battlefield: [], manaPool: ["W", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 784. Spell — Pithing Needle in hand.
  {
    id: "pithing-needle-in-hand",
    description: "Pithing Needle in hand; name shutoff parse.",
    seed: 0x357,
    cards: {
      "Pithing Needle": `Name:Pithing Needle
ManaCost:1
Types:Artifact
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigName | TriggerDescription$ Name.
SVar:TrigName:DB$ NameCard
S:Mode$ CantBeActivated | EffectZone$ Battlefield | ValidCard$ Card.NamedCard | NonManaActivatedAbility$ True | Description$ Shut off.
Oracle:Needle parse.
`,
    },
    players: [
      { life: 20, hand: ["Pithing Needle"], battlefield: [], manaPool: ["C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 785. Spell — Phyrexian Revoker in hand.
  {
    id: "phyrexian-revoker-in-hand",
    description: "Phyrexian Revoker in hand; etb name shutoff parse.",
    seed: 0x358,
    cards: {
      "Phyrexian Revoker": `Name:Phyrexian Revoker
ManaCost:2
Types:Artifact Creature Phyrexian
PT:2/1
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigName
SVar:TrigName:DB$ NameCard
S:Mode$ CantBeActivated | EffectZone$ Battlefield | ValidCard$ Card.NamedCard | NonManaActivatedAbility$ True | Description$ Shut off.
Oracle:Revoker parse.
`,
    },
    players: [
      { life: 20, hand: ["Phyrexian Revoker"], battlefield: [], manaPool: ["C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 786. Spell — Damping Sphere in hand.
  {
    id: "damping-sphere-in-hand",
    description: "Damping Sphere in hand; tax parse.",
    seed: 0x359,
    cards: {
      "Damping Sphere": `Name:Damping Sphere
ManaCost:2
Types:Artifact
S:Mode$ Continuous | EffectZone$ Battlefield | Affected$ Land.Self | AddProperty$ Land.OnlyOneMana | Description$ Sphere.
S:Mode$ RaiseCost | EffectZone$ Battlefield | ValidCard$ Card | Type$ Spell | StormCount$ EQX | References$ X | Amount$ 1 | Description$ Storm tax.
SVar:X:Count$StormThisTurn
Oracle:Sphere parse.
`,
    },
    players: [
      { life: 20, hand: ["Damping Sphere"], battlefield: [], manaPool: ["C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 787. Spell — Chalice of the Void in hand.
  {
    id: "chalice-of-the-void-in-hand",
    description: "Chalice of the Void in hand; X-counter cmc replace parse.",
    seed: 0x35a,
    cards: {
      "Chalice of the Void": `Name:Chalice of the Void
ManaCost:X X
Types:Artifact
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigCounter | TriggerDescription$ X charge.
SVar:TrigCounter:DB$ PutCounter | Defined$ Self | CounterType$ CHARGE | CounterNum$ X
SVar:X:Count$xPaid
T:Mode$ SpellCast | ValidPlayer$ Any | Execute$ TrigCounterSp | CheckSecondaryPresent$ Card.Self+counters_GE1_CHARGE+matchingCmc | TriggerDescription$ Counter.
SVar:TrigCounterSp:DB$ Counter | TargetType$ Spell | Defined$ TriggeredCard
Oracle:Chalice parse.
`,
    },
    players: [
      { life: 20, hand: ["Chalice of the Void"], battlefield: [], manaPool: ["C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 788. Spell — Trinisphere in hand.
  {
    id: "trinisphere-m613-in-hand",
    description: "Trinisphere in hand; cmc<3 raised parse.",
    seed: 0x35b,
    cards: {
      Trinisphere: `Name:Trinisphere
ManaCost:3
Types:Artifact
S:Mode$ RaiseCost | EffectZone$ Battlefield | ValidCard$ Card | Type$ Spell | MinCMC$ 3 | Description$ Tax to 3.
Oracle:Trinisphere parse.
`,
    },
    players: [
      { life: 20, hand: ["Trinisphere"], battlefield: [], manaPool: ["C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 789. Spell — Sphere of Resistance in hand.
  {
    id: "sphere-of-resistance-m613-in-hand",
    description: "Sphere of Resistance in hand; tax 1 parse.",
    seed: 0x35c,
    cards: {
      "Sphere of Resistance": `Name:Sphere of Resistance
ManaCost:2
Types:Artifact
S:Mode$ RaiseCost | EffectZone$ Battlefield | ValidCard$ Card | Type$ Spell | Amount$ 1 | Description$ Tax 1.
Oracle:Sphere parse.
`,
    },
    players: [
      { life: 20, hand: ["Sphere of Resistance"], battlefield: [], manaPool: ["C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 790. Spell — Thalia Guardian of Thraben (m613) in hand.
  {
    id: "thalia-guardian-of-thraben-m613-in-hand",
    description: "Thalia Guardian of Thraben M613 in hand; tax non-creature parse.",
    seed: 0x35d,
    cards: {
      "Thalia, Guardian of Thraben M613": `Name:Thalia, Guardian of Thraben M613
ManaCost:1 W
Types:Legendary Creature Human Soldier
PT:2/1
K:First Strike
S:Mode$ RaiseCost | EffectZone$ Battlefield | ValidCard$ Card.nonCreature | Type$ Spell | Amount$ 1 | Description$ Tax.
Oracle:Thalia M613 parse.
`,
    },
    players: [
      { life: 20, hand: ["Thalia, Guardian of Thraben M613"], battlefield: [], manaPool: ["W", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 791. Spell — Vexing Shusher in hand.
  {
    id: "vexing-shusher-in-hand",
    description: "Vexing Shusher in hand; uncounter parse.",
    seed: 0x35e,
    cards: {
      "Vexing Shusher": `Name:Vexing Shusher
ManaCost:R/G R/G
Types:Creature Goblin Shaman
PT:2/2
K:CARDNAME can't be countered.
A:AB$ ChangeSpellAbility | Cost$ T | TargetType$ Spell | ValidTgts$ Card | KW$ CARDNAME can't be countered. | UntilEOT$ True | SpellDescription$ Shusher.
Oracle:Shusher parse.
`,
    },
    players: [
      { life: 20, hand: ["Vexing Shusher"], battlefield: [], manaPool: ["R", "G"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 792. Spell — Cavern of Souls in hand.
  {
    id: "cavern-of-souls-m613-in-hand",
    description: "Cavern of Souls in hand; uncounter tribal parse.",
    seed: 0x35f,
    cards: {
      "Cavern of Souls": `Name:Cavern of Souls
Types:Land
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigChooseType | TriggerDescription$ Choose.
SVar:TrigChooseType:DB$ ChooseType | Type$ Creature
A:AB$ Mana | Cost$ T | Produced$ C | SpellDescription$ Add C.
A:AB$ Mana | Cost$ T | Produced$ Combo W U B R G | RestrictValid$ Spell.ChosenType | AddsKeywords$ CARDNAME can't be countered. | SpellDescription$ Add color.
Oracle:Cavern parse.
`,
    },
    players: [
      { life: 20, hand: ["Cavern of Souls"], battlefield: [] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 793. Spell — Boil in hand.
  {
    id: "boil-in-hand",
    description: "Boil in hand; mass island destroy parse.",
    seed: 0x360,
    cards: {
      Boil: `Name:Boil
ManaCost:3 R
Types:Instant
A:SP$ DestroyAll | Cost$ 3 R | ValidCards$ Island | NoRegen$ True | SpellDescription$ Boil.
Oracle:Boil parse.
`,
    },
    players: [
      { life: 20, hand: ["Boil"], battlefield: [], manaPool: ["R", "C", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 794. Spell — Choke in hand.
  {
    id: "choke-in-hand",
    description: "Choke in hand; islands don't untap parse.",
    seed: 0x361,
    cards: {
      Choke: `Name:Choke
ManaCost:2 G
Types:Enchantment
S:Mode$ Continuous | EffectZone$ Battlefield | Affected$ Island | NoUntap$ True | Description$ No untap.
Oracle:Choke parse.
`,
    },
    players: [
      { life: 20, hand: ["Choke"], battlefield: [], manaPool: ["G", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 795. Spell — Blood Moon in hand.
  {
    id: "blood-moon-in-hand",
    description: "Blood Moon in hand; nonbasic Mountain parse.",
    seed: 0x362,
    cards: {
      "Blood Moon": `Name:Blood Moon
ManaCost:2 R
Types:Enchantment
S:Mode$ Continuous | Affected$ Land.nonBasic | RemoveCardTypes$ True | RemoveLandTypes$ True | RemoveSubTypes$ True | RemoveSuperTypes$ False | RemoveOldTypes$ True | AddType$ Mountain | RemoveAllAbilities$ True | GainTextOf$ Mountain | Description$ Mountain.
Oracle:Blood Moon parse.
`,
    },
    players: [
      { life: 20, hand: ["Blood Moon"], battlefield: [], manaPool: ["R", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 796. Spell — Magus of the Moon in hand.
  {
    id: "magus-of-the-moon-in-hand",
    description: "Magus of the Moon in hand; creature blood moon parse.",
    seed: 0x363,
    cards: {
      "Magus of the Moon": `Name:Magus of the Moon
ManaCost:2 R
Types:Creature Human Wizard
PT:2/2
S:Mode$ Continuous | Affected$ Land.nonBasic | RemoveCardTypes$ True | RemoveLandTypes$ True | RemoveSubTypes$ True | RemoveSuperTypes$ False | AddType$ Mountain | RemoveAllAbilities$ True | GainTextOf$ Mountain | Description$ Mountain.
Oracle:Magus of the Moon parse.
`,
    },
    players: [
      { life: 20, hand: ["Magus of the Moon"], battlefield: [], manaPool: ["R", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 797. Spell — Back to Basics in hand.
  {
    id: "back-to-basics-in-hand",
    description: "Back to Basics in hand; nonbasic don't untap parse.",
    seed: 0x364,
    cards: {
      "Back to Basics": `Name:Back to Basics
ManaCost:1 U
Types:Enchantment
S:Mode$ Continuous | EffectZone$ Battlefield | Affected$ Land.nonBasic | NoUntap$ True | Description$ Lock.
Oracle:Back to Basics parse.
`,
    },
    players: [
      { life: 20, hand: ["Back to Basics"], battlefield: [], manaPool: ["U", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 798. Spell — Stranglehold in hand.
  {
    id: "stranglehold-in-hand",
    description: "Stranglehold in hand; no extra turns or search parse.",
    seed: 0x365,
    cards: {
      Stranglehold: `Name:Stranglehold
ManaCost:2 R R
Types:Enchantment
S:Mode$ CantTakeExtraTurns | EffectZone$ Battlefield | ValidPlayer$ Opponent | Description$ No extras.
S:Mode$ CantSearchLibrary | EffectZone$ Battlefield | ValidPlayer$ Opponent | Description$ No tutor.
Oracle:Stranglehold parse.
`,
    },
    players: [
      { life: 20, hand: ["Stranglehold"], battlefield: [], manaPool: ["R", "R", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 799. Spell — Aven Mindcensor in hand.
  {
    id: "aven-mindcensor-in-hand",
    description: "Aven Mindcensor in hand; flash search-top-4 parse.",
    seed: 0x366,
    cards: {
      "Aven Mindcensor": `Name:Aven Mindcensor
ManaCost:2 W
Types:Creature Bird Wizard
PT:2/1
K:Flash
K:Flying
S:Mode$ Continuous | EffectZone$ Battlefield | Affected$ Player.Opponent | AddProperty$ SearchLimit_4 | Description$ Top 4.
Oracle:Mindcensor parse.
`,
    },
    players: [
      { life: 20, hand: ["Aven Mindcensor"], battlefield: [], manaPool: ["W", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 800. Spell — Drannith Magistrate in hand.
  {
    id: "drannith-magistrate-in-hand",
    description: "Drannith Magistrate in hand; no opp non-hand cast parse.",
    seed: 0x367,
    cards: {
      "Drannith Magistrate": `Name:Drannith Magistrate
ManaCost:1 W
Types:Creature Human Wizard
PT:1/3
S:Mode$ CantBeCast | EffectZone$ Battlefield | Caster$ Opponent | Origin$ Graveyard,Library,Exile,Command | Description$ Hands only.
Oracle:Magistrate parse.
`,
    },
    players: [
      { life: 20, hand: ["Drannith Magistrate"], battlefield: [], manaPool: ["W", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 801. Spell — Eidolon of Rhetoric in hand.
  {
    id: "eidolon-of-rhetoric-in-hand",
    description: "Eidolon of Rhetoric in hand; one-spell limit parse.",
    seed: 0x368,
    cards: {
      "Eidolon of Rhetoric": `Name:Eidolon of Rhetoric
ManaCost:2 W
Types:Enchantment Creature Spirit
PT:1/4
S:Mode$ CantBeCast | EffectZone$ Battlefield | Caster$ Player | SpellsCastThisTurn$ GE1 | Description$ One only.
Oracle:Eidolon parse.
`,
    },
    players: [
      { life: 20, hand: ["Eidolon of Rhetoric"], battlefield: [], manaPool: ["W", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },

  // 802. Spell — Rule of Law in hand.
  {
    id: "rule-of-law-in-hand",
    description: "Rule of Law in hand; one-spell limit enchant parse.",
    seed: 0x369,
    cards: {
      "Rule of Law": `Name:Rule of Law
ManaCost:2 W
Types:Enchantment
S:Mode$ CantBeCast | EffectZone$ Battlefield | Caster$ Player | SpellsCastThisTurn$ GE1 | Description$ One only.
Oracle:Rule of Law parse.
`,
    },
    players: [
      { life: 20, hand: ["Rule of Law"], battlefield: [], manaPool: ["W", "C", "C"] },
      { life: 20, hand: [], battlefield: [] },
    ],
    actions: [],
  },
];

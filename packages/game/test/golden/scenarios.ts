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
];

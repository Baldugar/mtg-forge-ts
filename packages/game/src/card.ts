// SPDX-License-Identifier: GPL-3.0-or-later
// Live in-game Card entity. Distinct from PaperCard (the inventory-level
// identity) — a single PaperCard can instantiate many Cards across turns,
// copies, tokens, etc. Snapshot layer stores paperCardKey + live state;
// GameSnapshot (Task 42) rehydrates Cards by looking PaperCards up in a
// CardDb. Embedding the full PaperCard in every Card would bloat snapshots
// significantly.
import type {
  AbilityAst,
  Color,
  ColorSet,
  CounterType,
  EntityId,
  FaceDownState,
  KeywordAst,
  PaperCard,
  PlayerSeat,
  ReplacementAbility,
  ReplacementAst,
  SVarAst,
  StaticAbility,
  StaticAst,
  TriggerAst,
  TriggeredAbility,
  ZoneType,
} from "@mtg-forge-ts/core";
import { isStaticAbilityMode, paperCardKey } from "@mtg-forge-ts/core";
import { SpellAbility } from "./ability/spell-ability.js";
import type { CopiableCharacteristics } from "./copy/copiable-characteristics.js";
import type { Game } from "./game.js";
import { keywordHandlerRegistry } from "./keyword/keyword-handler-registry.js";
import type { FaceKind } from "./multiface/face-kind.js";
import { replacementHandlerRegistry } from "./replacement/index.js";
// Wave 6 — side-effect import: registers ReduceCost / RaiseCost handlers.
import "./static/handlers/index.js";
import { staticHandlerRegistry } from "./static/static-handler.js";
import { triggerHandlerRegistry } from "./trigger/index.js";

export class Card {
  tapped = false;
  phased = false;
  damage = 0;
  // SP2 Task 78 (fix 2) — CR 702.2b deathtouch: a creature dealt ANY
  // nonzero damage by a source with deathtouch is destroyed by SBA
  // regardless of damage < toughness. GameAction.damage sets this to
  // true when the damaging source has the deathtouch keyword; moveTo
  // clears it when the creature leaves the battlefield so its next
  // battlefield entry starts fresh. SP3's keyword registry will turn
  // this into a layered keyword read driven off Characteristics.
  damagedByDeathtouch = false;
  counters = new Map<CounterType, number>();
  attachedTo: EntityId | null = null;
  attachments: EntityId[] = [];
  // SP2 Task 3: Layer 1 copy source (CR 707.2).
  copiedFrom: CopiableCharacteristics | null = null;
  // SP2 Task 53 (CR 708.2). `{ kind: "none" }` = face-up; the five face-
  // down kinds (morph/manifest/foretell/disguise/cloak) each carry their
  // own bookkeeping needed by the turn-face-up primitive (Task 54).
  faceDown: FaceDownState = { kind: "none" };
  // SP2 Task 25: intrinsic static abilities derived from card text. SP3
  // replaces hand-population with PaperCard.definition-driven derivation.
  // `undefined` means "not yet populated"; treated identically to an
  // empty list by getIntrinsicStatics.
  intrinsicStatics?: readonly StaticAbility[] = undefined;
  // SP2 Task 31: token/emblem identity flags consumed by the SBA engine
  // (CR 704.5d — tokens in non-battlefield zones cease to exist). Token/
  // emblem factories (MoveToIntent + createToken/createEmblem, SP2
  // Milestone L) set these to true at construction time; for regular
  // cards they remain false.
  isToken = false;
  isEmblem = false;
  // SP2 Task 32: SBA support flags. Saga's final chapter resolution and
  // bestow/commander identity are all SP3-scripted triggers/effects that
  // surface as simple booleans on the live card. The SBA engine reads
  // these; nothing in SP2 sets them today (those trigger handlers land
  // when the full rules DSL comes online).
  //
  // sagaFinalChapterResolved: set by the Saga chapter-trigger handler
  //   when the final chapter ability has resolved (CR 704.5v).
  // bestowed: set by the bestow-cast pipeline when the card came down
  //   paying the bestow cost; cleared when the aura leaves the battlefield
  //   and reverts to a creature (CR 702.103).
  // isCommander: set once at commander designation (CR 903.3); stable for
  //   the life of the game.
  sagaFinalChapterResolved = false;
  bestowed = false;
  isCommander = false;
  // Wave 53 — ChangeZone `Attacking$ True` stamps this flag at battlefield
  // entry so the active combat phase treats the new permanent as an
  // attacker (CR 506.4). The combat integration is wave-54+ work; this slot
  // is the forward-compatible contract for stamping the intent at ETB.
  enteredAttacking = false;
  // SP2 Tasks 46-48 (combat damage, first-strike split) — placeholder keyword
  // set used by CombatHandler to gate trample, deathtouch, first_strike,
  // double_strike behaviors from tests. Populated ad-hoc in Milestone M tests
  // via `card.keywords = new Set(["trample"])`. SP3's keyword registry (CR
  // 702) replaces this with layered keyword grants sourced from PaperCard
  // definition + Layer 6 ability additions. Kept optional (undefined) so the
  // common case allocates no Set; readers must tolerate undefined.
  keywords?: Set<string> = undefined;
  // Part D Wave 4 — RegenerateEffect (CR 701.15). Each point represents one
  // pending regeneration shield. The first time the creature would be
  // destroyed, the shield is consumed (tap, remove damage, remove from combat)
  // instead. Consumption logic is a ReplacementAbility wired in F2; this slot
  // is the MVP contract that RegenerateEffect sets and tests verify.
  regenerationShields = 0;
  // SP2 Milestone W Task 74 — "remembered" + "imprinted" card-local slots.
  // Forge uses these for cards that stash ability-scoped references: e.g.
  // Panharmonicon-style ETB mirrors (remembered), Duplicant / Isochron
  // Scepter imprint slots. The stored values are EntityIds of live Card
  // instances; effects resolving later look them up via Game.cards.
  // snapshot/restore round-trip these verbatim.
  remembered: EntityId[] = [];
  imprinted: EntityId[] = [];
  // Wave 3 — ChooseColorEffect stores chosen colors here. Each entry is a
  // Color enum value (or null for colorless) pushed when ChooseColor resolves.
  // Downstream effects that depend on the chosen color look up index 0.
  chosenColors: (Color | null)[] = [];
  // Wave 4 — ChooseTypeEffect stores chosen type names here (creature subtypes,
  // card types). Each string is pushed when ChooseType resolves; downstream
  // effects (e.g. "if you named X") look up index 0.
  chosenTypes: string[] = [];
  // Wave 15 — ChoosePlayerEffect stores chosen player seats here. Mirrors
  // chosenColors / chosenTypes in shape; downstream effects look up index 0.
  chosenPlayers: PlayerSeat[] = [];
  // Wave 15 — NameCardEffect stores the named card name here. Forge cards
  // like Cabal Therapy / Pithing Needle read this to gate their effect.
  // Single-slot (only one card name can be named at a time per source).
  namedCard: string | null = null;
  // Wave 18 — ChooseNumberEffect stores the chosen number here. Forge cards
  // like Spike Hatcher and many counter-related effects read this slot.
  chosenNumber: number | null = null;
  // Wave 18 — ChooseDirectionEffect stores the chosen direction. "Left" or
  // "Right" relative to the chooser. Multiplayer-relevant.
  chosenDirection: "Left" | "Right" | null = null;
  // Wave 18 — Phases-out flag. When true, the card is treated as off the
  // battlefield (CR 702.26). Cleared on the controller's untap step.
  phasedOut = false;
  // Wave 18 — MustBlock target. Set by MustBlockEffect; consulted by combat
  // assignment logic when the creature is declared (or refused) as a
  // blocker.
  mustBlockTargetId: EntityId | null = null;
  // Wave 19 — Goad flag (CR 701.42). When true, the creature must attack each
  // combat if able and must attack a player other than the goader if able.
  // Combat declaration logic consults this flag.
  goaded = false;
  // Wave 19 — RemoveFromCombat marker. Set by RemoveFromCombatEffect; combat
  // resolution skips creatures with this flag for damage assignment etc.
  removedFromCombat = false;
  // Plot (Bloomburrow / CR 718) — when a card is plotted via the plot keyword,
  // it is exiled face-up from hand and may be cast for free on a LATER turn.
  // `plotted` is true while the card sits in exile under the plot mechanic;
  // `plottedOnTurn` records the turn the plot action was taken so the alt-cost
  // path can verify "a later turn" (game.turn !== plottedOnTurn).
  plotted?: boolean;
  plottedOnTurn?: number;
  // Wave 24 — Crew (Kaladesh / CR 702.121) and Saddle (Outlaws of Thunder
  // Junction / CR 702.165) transient flags. Set by Crew/Saddle effects when
  // the activated ability resolves; cleared by the EOT cleanup hook on the
  // accompanying ContinuousEffect's expiry. While `crewedUntilEot === true`
  // the Vehicle gains the Creature type via deriveBaseCharacteristics (mirror
  // of the `bestowed` flag pattern). Mounts are already creatures, so
  // `saddledUntilEot` is read by triggers (BecomesSaddled) but does not
  // change types.
  crewedUntilEot?: boolean;
  saddledUntilEot?: boolean;
  // Wave 28 — Station (CR 718, "Spaceship — The Final Frontier"). A non-
  // creature Spacecraft becomes a creature until end of turn when it is
  // "stationed" (mirror of Crew). The flag is set by StationEffect and
  // cleared by an untilEndOfTurn ContinuousEffect cleanup hook.
  // deriveBaseCharacteristics adds CardType.Creature when this is true.
  stationedUntilEot?: boolean;
  // Wave 26 — Suspend (CR 702.61). When the suspend special-action exiles
  // the card from hand, `suspendedCounters` is stamped to N (the time-counter
  // count) and `hasteFromSuspend` is set when the eventual free-cast resolves
  // (the spell gains haste until you let go of it). The upkeep tick decrement
  // and free-cast routing live in altcost/suspend.ts + a tick helper.
  suspendedCounters?: number;
  hasteFromSuspend?: boolean;
  // Wave 26 — Champion (CR 702.71). When a championing creature ETBs, it
  // exiles a chosen target until it leaves; LTB returns the exiled target.
  // `championedTarget` (set on the championer) and `championedBy` (back-
  // pointer set on the exiled card) form the link.
  // Explicit `T | undefined` (rather than `?: T`) so handlers can clear the
  // slot via `= undefined` without delete (which biome's no-delete rule
  // forbids) AND without violating exactOptionalPropertyTypes.
  championedTarget: EntityId | undefined = undefined;
  championedBy: EntityId | undefined = undefined;
  // Wave 26 — Echo (CR 702.30). On entry the echo cost is stamped; the
  // upkeep trigger consults this and, if unpaid, sacrifices the card.
  // `echoOwedCost` is the literal mana-cost string from K:Echo:<cost>.
  echoOwedCost: string | undefined = undefined;
  // Wave 26 — Cumulative Upkeep (CR 702.24). Each own-upkeep adds 1 age
  // counter, and the controller pays cost × age counters or sacrifices.
  // Stored as a plain number rather than the counters Map so SBAs don't
  // pick it up under the wrong CounterType.
  ageCounters?: number;
  // Wave 29 — Renown (CR 702.111). Stamped to true when the renown
  // trigger fires; the trigger's matches() reads this slot and refuses
  // to re-fire on already-renowned creatures.
  renowned: boolean | undefined = undefined;
  // Wave 29 — Disturb (CR 702.156). Set on the synthesized graveyard-
  // cast SpellAbility's resolution path so the card knows it's resolving
  // as the Disturb back face. The Disturb alt-cost flips the face on
  // resolution.
  disturbed: boolean | undefined = undefined;
  // Wave 40 — Dredge (CR 702.52). When K:Dredge:N stamps the card, this
  // slot stores N. The drawCards mutator reads this on each per-card
  // draw to offer the dredge alternative: mill N + return-to-hand
  // instead of drawing.
  dredgeAmount: number | undefined = undefined;
  // Wave 45 — AssembleContraption stamps the running count of contraptions
  // assembled by this source onto the card so future state-checks observe
  // the bump even when the contraption deck is empty/absent. Forge tracks
  // the same per-card counter for "for each contraption you've assembled"-
  // style triggers. Undefined = no contraptions assembled.
  attractions: number | undefined = undefined;
  // Wave 15 — ChangeTextEffect appends a record per text-change. Stored on
  // the affected card so layered char derivation can re-apply at compute
  // time. MVP: opaque records — Layer 1 application is deferred to a future
  // wave; the slot is wired so callers can introspect/test.
  textChanges: { kind: "color" | "type"; from: string; to: string }[] = [];
  // SP3 Part C Task 58 — live SpellAbility instances bound to this card.
  // Populated by activateAbilitiesFromDefinition(), called by the engine
  // when the card enters a zone where abilities are active (hand for
  // castable spells, battlefield for activated abilities). Empty until
  // activated.
  spellAbilities: SpellAbility[] = [];
  // SP3 Part E Task 4 — live TriggeredAbility instances built from the
  // card's parsed TriggerAst nodes. Populated by
  // activateTriggersFromDefinition(game); registered with game.triggerRegistry
  // by the same call so TriggerRegistry.onEvent sees them immediately.
  triggeredAbilities: TriggeredAbility[] = [];
  // SP3 Part F Task 4 — live ReplacementAbility instances built from the
  // card's parsed ReplacementAst nodes. Populated by
  // activateReplacementsFromDefinition(game); registered with
  // game.replacementRegistry by the same call so the apply-loop sees them.
  replacementAbilities: ReplacementAbility[] = [];

  // SP2 Milestone Q (Tasks 58-61) — active face selector for multi-face
  // cards. "default" means single-face or "no multi-face selection made
  // yet" (split cards off-stack use combinedSplitCharacteristics); other
  // FaceKind values select one face from PaperCard.faces. deriveBase-
  // Characteristics (layer engine input) honors this; multi-face
  // primitives (flip/transform/modal-DFC cast/adventure/meld) toggle it.
  face: FaceKind = "default";
  // SP2 Task 61 — mutate & host+augment merged-creature state.
  //   mutatedPile: top-to-bottom order (index 0 is the topmost defining
  //     entity). When non-empty, the permanent inhabits this card's
  //     slot but derives its defining face from whatever sits on top;
  //     SP3's full mutate rules populate keyword/ability unions.
  //   mutatedInto: reciprocal back-pointer set on the non-primary cards
  //     in a mutated pile — they no longer exist independently on the
  //     battlefield.
  //   isAugment: marks the augment-side of a host+augment (Unstable,
  //     CR 702.150) combination. Tracked so SBAs + unattach can restore
  //     the augment's face when the host leaves.
  //   meldedFrom: source ids of a melded permanent, captured by the
  //     meld primitive so snapshot/un-meld paths can re-materialize the
  //     two originals.
  mutatedPile?: readonly EntityId[];
  mutatedInto?: EntityId;
  isAugment?: boolean;
  meldedFrom?: readonly EntityId[];

  // Wave 34 — Battle card type. `protectorSeat` is the opponent chosen on
  // ETB (CR 310.x) to defend the Battle (a Siege subtype Battle); the
  // attack-target enumeration filters out attackers whose controller IS
  // the protector. `battleDefeated` is stamped to true by the SBA path
  // when Defense reaches 0 and the battle is exiled — paired with the
  // canonical BattleDefeated event so triggers / replay can reconstruct
  // the defeat moment without scanning zone-change events.
  // Slots are `T | undefined = undefined` so biome's no-delete rule is
  // satisfied (handlers can null them out without delete) and
  // exactOptionalPropertyTypes is honoured.
  protectorSeat: PlayerSeat | undefined = undefined;
  battleDefeated: boolean | undefined = undefined;
  // Wave 33 — token-spawn overrides for Embalm / Eternalize (CR 702.131 /
  // 702.139). When a graveyard-recursion keyword spawns a token copy of the
  // source card, the token enters with characteristic overrides applied:
  //   - colors: replaces the printed color identity (Embalm → White,
  //     Eternalize → Black);
  //   - addedTypes: appended to the type set (both → "Zombie");
  //   - clearManaCost: when true, the printed mana cost is cleared (CR
  //     702.131c — the token has no mana cost);
  //   - setPower / setToughness: overrides for Eternalize's 4/4 P/T.
  // deriveBaseCharacteristics consumes this slot AFTER the printed-card
  // population so overrides win. Slot is `T | undefined = undefined` so
  // biome's no-delete rule is satisfied (handlers can null it out without
  // delete) and exactOptionalPropertyTypes is honoured.
  tokenOverrides:
    | {
        readonly colors?: ColorSet;
        readonly addedTypes?: readonly string[];
        readonly clearManaCost?: boolean;
        readonly setPower?: number;
        readonly setToughness?: number;
      }
    | undefined = undefined;
  // Wave 37 — Soulbond (CR 702.94). When a Soulbond creature ETBs, it may
  // pair with another unpaired creature its controller controls; both cards
  // get `pairedWith` stamped to the other's id. The pairing is cleared by
  // a watch trigger on either creature leaving the battlefield or changing
  // controllers. Slot is `T | undefined = undefined` so handlers can clear
  // via `= undefined` (biome no-delete rule + exactOptionalPropertyTypes).
  pairedWith: EntityId | undefined = undefined;
  // Wave 37 — Hideaway (CR 702.74). When a Hideaway permanent ETBs, the
  // controller looks at the top N cards of their library, exiles one face
  // down, and shuffles the rest to the bottom. `hideawayCard` (set on the
  // Hideaway permanent) points at the chosen exiled card; `hideawayHost`
  // (set on the exiled card) is the back-pointer. The conditional free-cast
  // ability is card-specific — see TODO(advanced) in hideaway-keyword.
  hideawayCard: EntityId | undefined = undefined;
  hideawayHost: EntityId | undefined = undefined;
  // Wave 37 — Sunburst (CR 702.43). Set of mana colors actually spent to
  // cast this card. Populated by CostMana.pay BEFORE emitting ManaSpent;
  // SunburstKeywordHandler reads this on ETB and stamps either P1P1
  // counters (creatures) or Charge counters (non-creatures) equal to the
  // set's size. Includes only chromatic colors (Color enum values); the
  // colorless atom is never added (a colorless mana spend leaves the slot
  // unchanged when no chromatic mana was also paid).
  manaSpentColors: Set<Color> | undefined = undefined;
  // Wave 42 — Count$CastTotalManaSpent. Total count of mana symbols (any
  // color, including generic/colorless) actually spent to cast this card.
  // Populated by CostMana.pay alongside `manaSpentColors`. Distinct from
  // `manaSpentColors.size` because the latter dedupes by color and excludes
  // colorless. Used by Lavinia, Kor of the Hammer-style "<Type> matters"
  // and by post-cast amount resolvers on the source card.
  manaSpentTotal: number | undefined = undefined;
  // Wave 38 — Strive (CR 702.106a): per-extra-target surcharge cost string
  // stamped by StriveKeywordHandler.activate. Read by the cast pipeline
  // when computing total cost. Cleared by handler.deactivate.
  striveExtraCost: string | undefined = undefined;
  // Wave 49 — Kicker (CR 702.32a): optional additional cost paid at cast
  // time. Stamped by KickerKeywordHandler.activate; read by the cast
  // pipeline's stepDetermineTotalCost which emits a confirmAction and,
  // on confirm, splices the cost into base.raw. The boolean below
  // (`wasKicked`) is set on payment so Wave 51's Count$Kicked SVar
  // ternary can branch on it.
  kickerCost: string | undefined = undefined;
  // Wave 49 — Multikicker (CR 702.32b): optional additional cost paid
  // any number of times at cast. Same pipeline hook as kickerCost; the
  // confirmAction loops until the controller declines. `kickerCount`
  // captures how many times multikicker was paid.
  multikickerCost: string | undefined = undefined;
  // Wave 49 — Set true on a successful kicker payment; set to a count
  // for multikicker. Both slots are read by Wave 51's Count$Kicked SVar.
  wasKicked: boolean | undefined = undefined;
  kickerCount: number | undefined = undefined;
  // Wave 51 — alt-cost / on-cast condition flags consumed by SVar
  // conditional ternaries (Count$<Flag>.<else>.<then>). Each slot is
  // stamped by the corresponding cost handler when payment succeeds and
  // is read by the Wave 51 conditional-ternary dispatcher.
  //
  //   foretold        : true once the card has been cast via the foretell
  //                     alt-cost (set by foretell-altcost.ts on confirm).
  //   bargainPaid     : true if the controller satisfied Bargain (sac an
  //                     artifact, enchantment, or token) at cast time.
  //   surgePaid       : true if the surge alt-cost was paid (another spell
  //                     was cast this turn before this one).
  //   adamantColor    : the color spent ≥3 of when Adamant fired; undefined
  //                     if Adamant did not trigger.
  //   madnessCast     : true if the card was cast via the Madness alt-cost.
  //   spectacleCast   : true if cast via Spectacle.
  //   freerunningCast : true if cast via Freerunning.
  //
  // Slots are typed `T | undefined = undefined` so handlers can clear via
  // `= undefined` (biome no-delete + exactOptionalPropertyTypes).
  foretold: boolean | undefined = undefined;
  bargainPaid: boolean | undefined = undefined;
  surgePaid: boolean | undefined = undefined;
  adamantColor: Color | undefined = undefined;
  madnessCast: boolean | undefined = undefined;
  spectacleCast: boolean | undefined = undefined;
  freerunningCast: boolean | undefined = undefined;
  // Wave 49 — Ward (CR 702.21d): cost string stamped by
  // WardKeywordHandler. Read by the ward trigger's resolver when a
  // CardTargeted event names this card and the targeting source is
  // controlled by an opponent. Cleared on deactivate.
  wardCost: string | undefined = undefined;
  // Wave 55 — Morph / Megamorph / Disguise (CR 702.36 / 702.94 / 702.166).
  // The flip-up cost stamped by the matching keyword handler. Read by
  // the synthesized Battlefield-zone activated SA's TurnFaceUp resolver
  // (cost-payment plumbing happens via the SA's cost field; the slot is
  // the durable read used by SVar selectors and tests).
  //   morphCost — Morph cost (also covers Megamorph via the SA tag).
  //   disguiseCost — Disguise cost; the face-down state additionally
  //     carries Ward N so Wave 49's ward trigger fires for opponents.
  // Slots are typed `T | undefined = undefined` so handlers can clear via
  // `= undefined` (biome no-delete + exactOptionalPropertyTypes).
  morphCost: string | undefined = undefined;
  disguiseCost: string | undefined = undefined;
  // Wave 55 — Adventure (CR 715). Stamped to "spell" while the Adventure
  // half is on the stack / resolving; cleared (or set to "creature") when
  // the creature half is later cast from exile. Used by the
  // post-resolution zone-routing logic to send the Adventure half to
  // exile (instead of graveyard) so it can be cast later from exile.
  adventureSide: "creature" | "spell" | undefined = undefined;
  // Wave 39 — Sweep (CR Saviors of Kamigawa cycle). `sweepReturnedType` is
  // the land subtype the spell asks the controller to return; `sweepReturnedCount`
  // is the count of lands actually returned this resolution (read by SVar
  // Count$Sweep). Stamped by SweepKeywordHandler.activate; cleared on deactivate.
  sweepReturnedType: string | undefined = undefined;
  sweepReturnedCount: number | undefined = undefined;
  // Wave 39 — Companion (CR 702.139). Holds the Forge `Valid$` predicate
  // string the deckbuilder must satisfy. Stamped on activate; cleared on
  // deactivate.
  companionCondition: string | undefined = undefined;
  // Riot (Ravnica Allegiance, CR 702.135). When the controller chooses
  // "haste" on the Riot triggered ability, this flag captures the choice
  // (so tests/replay can distinguish from the +1/+1 counter branch).
  riotChoseHaste: boolean | undefined = undefined;
  // Rebound (Rise of the Eldrazi, CR 702.87). When a rebound spell resolves
  // from the hand, the cast trigger stamps this slot with `game.turn + 1`;
  // the upkeep trigger reads it to detect when the free-cast window is open.
  // Cleared by the upkeep resolver before invoking FreeCastPipeline.
  reboundUntilUpkeep: number | undefined = undefined;
  // Wave 52 — Class (CR 715). Read+written by ClassKeywordHandler's
  // synthesized activated SA. Each `K:Class:level:cost:flag:abilityKey`
  // installs an activation that, on resolve, stamps
  // `card.classLevel = max(card.classLevel ?? 1, level)`. Default 1 once
  // a Class permanent ETBs (mirror of the Level-counter SBA bump in
  // saga-class.ts, but the slot is the authoritative read used by the
  // per-level conditional trigger/static gates).
  classLevel: number | undefined = undefined;
  // Wave 52 — Saga (CR 714). Read+written by ChapterKeywordHandler. The
  // total chapter count parsed from `K:Chapter:N:DB1,DB2,...,DBN`. Used by
  // the CounterAdded watcher to detect when the final-chapter trigger has
  // resolved (Lore counter == N). The names slot stores the SVar keys for
  // chapters I..N; Wave-52 dispatch is TODO(advanced) — count + flag is
  // enough for the SBA sacrifice path.
  sagaChapterCount: number | undefined = undefined;
  sagaChapterSVars: readonly string[] | undefined = undefined;
  // Wave 57 — Cipher (CR 702.97). Stamped on a creature when an encoded
  // instant/sorcery is "ciphered" onto it; mirrors Champion's bidirectional
  // link. The encoded card carries the creature it is encoded on; the
  // creature carries the encoded card id. Combat-damage trigger on the
  // creature reads `cipherEncodedHere` to find the spell to copy.
  cipherEncodedOnId: EntityId | undefined = undefined;
  cipherEncodedHere: EntityId | undefined = undefined;
  // Wave 57 — Buyback (CR 702.26). When a buyback cast resolves, the card
  // returns to its owner's hand instead of going to the graveyard. The
  // AltCost stamps `buybackPaid = true` at cast time; the post-resolution
  // routing reads this slot. Cleared on deactivate.
  buybackPaid: boolean | undefined = undefined;
  // Wave 57 — Awaken (CR 702.112). When the awaken alt-cost is paid,
  // `awakenAmount` is set to N (the number of P1P1 counters to put on the
  // chosen target land). The handler resolution consumes the slot and
  // animates the land. Cleared after the awaken sub-effect resolves.
  awakenAmount: number | undefined = undefined;
  // Audit I-14 — CR 613.7 timestamp. Each Card carries a creation-order
  // timestamp consumed by the layer engine for tiebreaks among continuous
  // effects with the same timestamp. EntityId is monotonic at issue time
  // but not preserved across snapshot/restore reissue paths; a dedicated
  // timestamp field round-trips cleanly through GameSnapshot.
  // Default 0: Card constructed standalone (legacy test fixtures); the
  // engine's create-paths (cast, token, emblem, snapshot-restore) overwrite
  // with the next monotonic value.
  timestamp = 0;

  constructor(
    readonly id: EntityId,
    readonly paperCard: PaperCard,
    public ownerSeat: PlayerSeat,
    public controllerSeat: PlayerSeat,
    public zone: ZoneType,
  ) {}

  /**
   * SP3 Part C Task 58 — walks the PaperCard's CardDefinition.abilities and
   * constructs live SpellAbility instances bound to this card's id,
   * controller seat, and svars map. Called by the cast pipeline when the
   * card enters a zone where abilities are active. Idempotent — safe to
   * call multiple times; later calls replace the existing list.
   *
   * PaperCards without a definition (tokens, emblems) have no abilities;
   * calling this on them is a no-op.
   */
  activateAbilitiesFromDefinition(): void {
    const def = this.paperCard.definition;
    if (!def) return;
    const svars = def.svars as ReadonlyMap<string, SVarAst>;
    this.spellAbilities = (def.abilities as readonly AbilityAst[]).map(
      (ast) => new SpellAbility(ast, this.id, this.controllerSeat, svars, []),
    );
  }

  /**
   * SP3 Part E Task 4 — walks the PaperCard's CardDefinition.triggers and
   * constructs live TriggeredAbility instances via the triggerHandlerRegistry.
   * Each produced trigger is immediately registered with game.triggerRegistry
   * so TriggerRegistry.onEvent fires correctly from the next event forward.
   *
   * Trigger modes not yet handled by the registry are silently skipped; they
   * will be covered in Part E2 and later waves.
   *
   * Idempotent — safe to call multiple times; later calls replace the
   * existing list (old registrations must be unregistered by the caller
   * before re-calling if duplication is a concern).
   */
  activateTriggersFromDefinition(game: Game): void {
    const def = this.paperCard.definition;
    if (!def) return;
    this.triggeredAbilities = [];
    for (const triggerAst of def.triggers as readonly TriggerAst[]) {
      const Cls = triggerHandlerRegistry.lookup(triggerAst.mode);
      if (!Cls) continue; // silently skip unknown modes
      const handler = new Cls();
      const triggerId = game.newEntityId();
      const ta = handler.build(triggerAst, {
        game,
        sourceCardId: this.id,
        controllerSeat: this.controllerSeat,
        triggerId,
      });
      this.triggeredAbilities.push(ta);
      game.triggerRegistry.register(ta);
    }
  }

  /**
   * SP3 Part F Task 4 — walks the PaperCard's CardDefinition.replacements and
   * constructs live ReplacementAbility instances via the
   * replacementHandlerRegistry. Each produced replacement is immediately
   * registered with game.replacementRegistry so the apply-loop sees it.
   *
   * eventKind values not yet handled by the registry are silently skipped;
   * they will be covered in Part F2 and later waves.
   *
   * Idempotent — safe to call multiple times; later calls replace the
   * existing list (old registrations must be unregistered by the caller
   * before re-calling if duplication is a concern).
   */
  activateReplacementsFromDefinition(game: Game): void {
    const def = this.paperCard.definition;
    if (!def) return;
    this.replacementAbilities = [];
    for (const replacementAst of def.replacements as readonly ReplacementAst[]) {
      const Cls = replacementHandlerRegistry.lookup(replacementAst.eventKind);
      if (!Cls) continue; // silently skip unknown eventKinds
      const handler = new Cls();
      const replacementId = game.newEntityId();
      const ra = handler.build(replacementAst, {
        game,
        sourceCardId: this.id,
        controllerSeat: this.controllerSeat,
        replacementId,
      });
      this.replacementAbilities.push(ra);
      game.replacementRegistry.register(ra);
    }
  }

  /**
   * SP3 Part G Task 3 — walks the PaperCard's CardDefinition.keywords and
   * activates each one via the keywordHandlerRegistry. The resulting keyword
   * ids are stored in Card.keywords (a Set<string> of lowercase_snake_case
   * KeywordId values) so that combat helpers (hasKeyword) and SBAs can read
   * them without additional indirection.
   *
   * Always resets the Set before re-activating (idempotent). Cards without a
   * definition (tokens, emblems) are a no-op.
   */
  activateKeywordsFromDefinition(game: Game): void {
    const def = this.paperCard.definition;
    if (!def) return;
    // Reset to a fresh set — intrinsic keywords come exclusively from the
    // definition; layer-granted keywords are added on top by the layer engine.
    if (!this.keywords) this.keywords = new Set();
    else this.keywords.clear();
    for (const ast of def.keywords as readonly KeywordAst[]) {
      const Cls = keywordHandlerRegistry.lookup(ast.keyword);
      if (!Cls) continue; // silently skip unhandled keyword shapes
      const handler = new Cls();
      handler.activate(ast, {
        game,
        sourceCardId: this.id,
        controllerSeat: this.controllerSeat,
      });
    }
  }

  /**
   * Wave 6 — walks the PaperCard's CardDefinition.statics and constructs live
   * StaticAbility instances via the staticHandlerRegistry. The produced list
   * is stored in `intrinsicStatics`, which the zone-activation discipline
   * (onZoneChange) inspects on every zone transition to register/unregister
   * with game.staticEffectRegistry.
   *
   * Static modes not yet handled by the registry are silently skipped; SP3
   * later waves cover the remaining 80 modes incrementally. Idempotent —
   * later calls replace the existing list.
   */
  activateStaticsFromDefinition(game: Game): void {
    const def = this.paperCard.definition;
    if (!def) return;
    const built: StaticAbility[] = [];
    for (const ast of def.statics as readonly StaticAst[]) {
      if (!isStaticAbilityMode(ast.mode)) continue; // unknown mode — skip
      const Cls = staticHandlerRegistry.lookup(ast.mode);
      if (!Cls) continue; // silently skip unhandled modes
      const handler = new Cls();
      const staticId = game.newEntityId();
      const built1 = handler.build(ast, {
        game,
        sourceCardId: this.id,
        controllerSeat: this.controllerSeat,
        staticId,
      });
      built.push(built1);
    }
    this.intrinsicStatics = built;
  }

  toJSON(): {
    id: EntityId;
    paperCardKey: string;
    ownerSeat: PlayerSeat;
    controllerSeat: PlayerSeat;
    zone: ZoneType;
    tapped: boolean;
    phased: boolean;
    damage: number;
    counters: Record<string, number>;
    attachedTo: EntityId | null;
    attachments: EntityId[];
    remembered: EntityId[];
    imprinted: EntityId[];
  } {
    return {
      id: this.id,
      paperCardKey: paperCardKey(this.paperCard),
      ownerSeat: this.ownerSeat,
      controllerSeat: this.controllerSeat,
      zone: this.zone,
      tapped: this.tapped,
      phased: this.phased,
      damage: this.damage,
      counters: Object.fromEntries(this.counters),
      attachedTo: this.attachedTo,
      attachments: [...this.attachments],
      remembered: [...this.remembered],
      imprinted: [...this.imprinted],
    };
  }
}

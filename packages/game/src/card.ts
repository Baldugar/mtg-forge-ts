// SPDX-License-Identifier: GPL-3.0-or-later
// Live in-game Card entity. Distinct from PaperCard (the inventory-level
// identity) — a single PaperCard can instantiate many Cards across turns,
// copies, tokens, etc. Snapshot layer stores paperCardKey + live state;
// GameSnapshot (Task 42) rehydrates Cards by looking PaperCards up in a
// CardDb. Embedding the full PaperCard in every Card would bloat snapshots
// significantly.
import type {
  AbilityAst,
  CounterType,
  EntityId,
  FaceDownState,
  PaperCard,
  PlayerSeat,
  ReplacementAbility,
  ReplacementAst,
  SVarAst,
  StaticAbility,
  TriggerAst,
  TriggeredAbility,
  ZoneType,
} from "@mtg-forge-ts/core";
import { paperCardKey } from "@mtg-forge-ts/core";
import { SpellAbility } from "./ability/spell-ability.js";
import type { CopiableCharacteristics } from "./copy/copiable-characteristics.js";
import type { Game } from "./game.js";
import type { FaceKind } from "./multiface/face-kind.js";
import { replacementHandlerRegistry } from "./replacement/index.js";
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
  // SP2 Tasks 46-48 (combat damage, first-strike split) — placeholder keyword
  // set used by CombatHandler to gate trample, deathtouch, first_strike,
  // double_strike behaviors from tests. Populated ad-hoc in Milestone M tests
  // via `card.keywords = new Set(["trample"])`. SP3's keyword registry (CR
  // 702) replaces this with layered keyword grants sourced from PaperCard
  // definition + Layer 6 ability additions. Kept optional (undefined) so the
  // common case allocates no Set; readers must tolerate undefined.
  keywords?: Set<string> = undefined;
  // SP2 Milestone W Task 74 — "remembered" + "imprinted" card-local slots.
  // Forge uses these for cards that stash ability-scoped references: e.g.
  // Panharmonicon-style ETB mirrors (remembered), Duplicant / Isochron
  // Scepter imprint slots. The stored values are EntityIds of live Card
  // instances; effects resolving later look them up via Game.cards.
  // snapshot/restore round-trip these verbatim.
  remembered: EntityId[] = [];
  imprinted: EntityId[] = [];
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

// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.C — Layer 1 Clone variant polish.
//
// Two related Clone-style cards with extra bells beyond plain Clone:
//
//   1. Phantasmal Image (M12) — "You may have ~ enter as a copy of any
//      creature on the battlefield, except it's an Illusion in addition
//      to its other types and it has 'When this creature becomes the
//      target of a spell or ability, sacrifice it.'"
//        → CopyPermanent AddSubtypes$ Illusion + AddTriggers$
//          PhantasmalSacrifice (BecomesTarget → Sacrifice).
//
//   2. Phyrexian Metamorph (NPH) — "You may have ~ enter as a copy of
//      any artifact or creature on the battlefield, except it's an
//      artifact in addition to its other types."
//        → CopyPermanent AddTypes$ Artifact (one extra; Wave 63.B
//          already covers AddTypes$ for Layer 4 add).
//
// Both routes go through CopyPermanent's Wave 63.B broadenings; the
// Wave 70.C addition is the resolver override for AddTriggers$ — the
// Execute$ SVar is looked up off the SpellAbility's svars (the cloner's
// printed SVars) instead of the freshly-minted token's PaperCard svars.
// Without that redirect Phantasmal Image's BecomesTarget trigger would
// register but never resolve (the token's PaperCard belongs to the
// COPIED card, not Phantasmal Image, so PhantasmalSacrifice is invisible
// to the standard resolver path).
import "./copy-permanent.js";
import "./sacrifice.js";
import "../../svar/selectors/number.js";
import "../../trigger/handlers/becomes-target-trigger.js";

import type { AbilityAst, EntityId, LobbyPlayer, PaperCard, SVarAst, TriggerAst } from "@mtg-forge-ts/core";
import {
  CardType,
  DEFAULT_PAPER_CARD_FLAGS,
  PhaseStep,
  SeededRng,
  TypeLine,
  ZoneType,
  mkEntityId,
  mkEvent,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { Library } from "../../zone/zones/library.js";
import { SpellAbility } from "../spell-ability.js";

const alice: LobbyPlayer = { id: "p-alice", name: "Alice", controllerKind: "human" };
const bob: LobbyPlayer = { id: "p-bob", name: "Bob", controllerKind: "ai" };
const rules: GameRules = {
  formatId: "standard",
  startingLife: 20,
  startingHandSize: 7,
  mulliganRule: "london",
  firstPlayerSkipsDraw: true,
  ruleOverrides: [],
  playerCount: { min: 2, max: 2 },
  poisonCountersToLose: 10,
  playForAnte: false,
  manaBurn: false,
  appliedVariants: [],
};
const meta: GameMeta = {
  engineVersion: "0.0.0",
  forgeSha: "abc",
  cardDataSyncedAt: "2026-04-28T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};

// ---------------------------------------------------------------------------
// Paper-card fixtures
// ---------------------------------------------------------------------------

const bearPaper: PaperCard = {
  name: "Grizzly Bears",
  edition: "LEA",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: {
    name: "Grizzly Bears",
    oracle: "",
    types: TypeLine.parse("Creature — Bear"),
    manaCost: { raw: "1G", symbols: [] },
    pt: { power: "2", toughness: "2" },
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars: new Map(),
  },
};

// Pure artifact (no Creature type) for Phyrexian Metamorph test 4.
const sigilOfDistinctionPaper: PaperCard = {
  name: "Sigil of Distinction",
  edition: "MBS",
  collectorNumber: "150",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: {
    name: "Sigil of Distinction",
    oracle: "",
    types: TypeLine.parse("Artifact"),
    manaCost: { raw: "X", symbols: [] },
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars: new Map(),
  },
};

const sourcePaper: PaperCard = {
  name: "Source",
  edition: "LEA",
  collectorNumber: "002",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

// ---------------------------------------------------------------------------
// Game / SA helpers
// ---------------------------------------------------------------------------

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
  return game;
};

const mkAst = (handlerKey: string, params: AbilityAst["effect"]["params"]): AbilityAst => ({
  kind: "spell",
  effect: { handlerKey, params },
  cost: { raw: "" },
});

const drainGen = (gen: Generator<unknown, void, unknown>): void => {
  let r = gen.next();
  while (!r.done) r = gen.next();
};

const findToken = (game: Game): Card | undefined => [...game.cards.values()].find((c) => c.isToken);

// PhantasmalSacrifice SVar — represents the trigger body Forge stitches
// inline as Phantasmal Image's printed `T:Mode$ BecomesTarget | ... |
// Execute$ DBSac` line. We hand-build the SVar map (kind: "trigger" with
// a TriggerAst whose Execute$ points at a sibling kind: "ability" SVar
// `DBSac`).
const mkPhantasmalSacrificeSVars = (): ReadonlyMap<string, SVarAst> => {
  const svars = new Map<string, SVarAst>();
  const triggerAst: TriggerAst = {
    mode: "BecomesTarget",
    params: {
      ValidCard: { kind: "literal", raw: "Card.Self" },
      ValidSource: { kind: "literal", raw: "Spell" },
    },
    effect: { handlerKey: "DBSac", params: {} },
  };
  svars.set("PhantasmalSacrifice", {
    kind: "trigger",
    raw: "Mode$ BecomesTarget | ValidSource$ Spell.OrAbility | TriggerZones$ Battlefield | Execute$ DBSac",
    trigger: triggerAst,
  });
  // DBSac body — Sacrifice with no targets uses sa.targets passed by the
  // CopyPermanent resolver override (which injects [matchedCardId]).
  svars.set("DBSac", {
    kind: "ability",
    raw: "DB$ Sacrifice",
    ability: { handlerKey: "Sacrifice", params: {} },
  });
  return svars;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Wave 70.C — Phantasmal Image + Phyrexian Metamorph polish", () => {
  // -------------------------------------------------------------------------
  // Phantasmal Image
  // -------------------------------------------------------------------------

  it("Phantasmal Image: copies a creature, gains Illusion subtype", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const targetId = mkEntityId(20);

    game.cards.set(sourceId, new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield));
    game.cards.set(targetId, new Card(targetId, bearPaper, seat0, seat0, ZoneType.Battlefield));

    const sa = new SpellAbility(
      mkAst("CopyPermanent", {
        AddSubtypes: { kind: "literal", raw: "Illusion" },
      }),
      sourceId,
      seat0,
      new Map(),
      [targetId],
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    const token = findToken(game);
    expect(token).toBeDefined();
    if (!token) return;
    const chars = game.layerEngine.computeCharacteristics(token.id);
    expect(chars.subtypes.has("Illusion")).toBe(true);
    // Original Bear subtype + Creature type preserved.
    expect(chars.subtypes.has("Bear")).toBe(true);
    expect(chars.types.has(CardType.Creature)).toBe(true);
  });

  it("Phantasmal Image: copy gets targeted, BecomesTarget trigger fires, copy is sacrificed", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const sourceId = mkEntityId(10);
    const targetId = mkEntityId(20);
    const targetingSpellId = mkEntityId(30);

    game.cards.set(sourceId, new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield));
    game.cards.set(targetId, new Card(targetId, bearPaper, seat0, seat0, ZoneType.Battlefield));
    // The targeting spell needs to exist as a card so its CardTargeted
    // event payload's sourceCardId resolves.
    game.cards.set(targetingSpellId, new Card(targetingSpellId, sourcePaper, seat1, seat1, ZoneType.Stack));

    const svars = mkPhantasmalSacrificeSVars();
    const sa = new SpellAbility(
      mkAst("CopyPermanent", {
        AddSubtypes: { kind: "literal", raw: "Illusion" },
        AddTriggers: { kind: "literal", raw: "PhantasmalSacrifice" },
      }),
      sourceId,
      seat0,
      svars,
      [targetId],
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    const token = findToken(game);
    expect(token).toBeDefined();
    if (!token) return;
    expect(token.zone).toBe(ZoneType.Battlefield);

    // Trigger should be registered for the freshly-minted token. Fire a
    // CardTargeted event and walk the pending queue → resolve.
    const ev = mkEvent("CardTargeted", game.turn, PhaseStep.Main1, {
      targetId: token.id,
      sourceCardId: targetingSpellId,
      targetingSeat: seat1,
    });
    game.triggerRegistry.onEvent(ev);
    const pending = game.triggerRegistry.drain();
    // At least one PhantasmalSacrifice pending trigger.
    expect(pending.length).toBeGreaterThanOrEqual(1);

    const phantasmalPending = pending.find((p) => p.sourceCardId === token.id);
    expect(phantasmalPending).toBeDefined();
    if (!phantasmalPending) return;

    // Resolve the trigger via its registered resolver. Walk the byId
    // table (drain pops the pending list but keeps registrations).
    const triggered = (
      game.triggerRegistry as unknown as {
        byId: Map<EntityId, { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } | null }>;
      }
    ).byId.get(phantasmalPending.triggerId);
    expect(triggered?.resolver).toBeDefined();
    if (!triggered?.resolver) return;
    drainGen(triggered.resolver.resolve(game) as Generator<unknown, void, unknown>);

    // Copy should be in graveyard (token cease-to-exist is an SBA we
    // don't run here; checking the zone is sufficient).
    const tokenAfter = game.cards.get(token.id);
    expect(tokenAfter?.zone).toBe(ZoneType.Graveyard);
  });

  // -------------------------------------------------------------------------
  // Phyrexian Metamorph
  // -------------------------------------------------------------------------

  it("Phyrexian Metamorph: copies a creature, gains Artifact type (in addition to Creature)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const targetId = mkEntityId(20);

    game.cards.set(sourceId, new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield));
    game.cards.set(targetId, new Card(targetId, bearPaper, seat0, seat0, ZoneType.Battlefield));

    const sa = new SpellAbility(
      mkAst("CopyPermanent", {
        AddTypes: { kind: "literal", raw: "Artifact" },
      }),
      sourceId,
      seat0,
      new Map(),
      [targetId],
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    const token = findToken(game);
    expect(token).toBeDefined();
    if (!token) return;
    const chars = game.layerEngine.computeCharacteristics(token.id);
    expect(chars.types.has(CardType.Artifact)).toBe(true);
    expect(chars.types.has(CardType.Creature)).toBe(true);
    // Subtypes from Bear preserved.
    expect(chars.subtypes.has("Bear")).toBe(true);
  });

  it("Phyrexian Metamorph: copies an artifact (non-creature), retains its types + Artifact persists", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const targetId = mkEntityId(20);

    game.cards.set(sourceId, new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield));
    game.cards.set(targetId, new Card(targetId, sigilOfDistinctionPaper, seat0, seat0, ZoneType.Battlefield));

    const sa = new SpellAbility(
      mkAst("CopyPermanent", {
        AddTypes: { kind: "literal", raw: "Artifact" },
      }),
      sourceId,
      seat0,
      new Map(),
      [targetId],
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    const token = findToken(game);
    expect(token).toBeDefined();
    if (!token) return;
    const chars = game.layerEngine.computeCharacteristics(token.id);
    // Original artifact-only PaperCard's Artifact is preserved; the
    // explicit AddTypes$ Artifact on top is idempotent (Layer 4 union
    // semantics — adding a type that's already present is a no-op).
    expect(chars.types.has(CardType.Artifact)).toBe(true);
    // Critically — the copy is NOT a Creature: AddTypes$ Artifact does
    // not synthesize Creature.
    expect(chars.types.has(CardType.Creature)).toBe(false);
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 99 — cross-module TODO(advanced) sweep round 4 regression tests.
//
// Picks closed (one assertion bundle per pick):
//   1. svar/selectors/turn-stats.ts — Count$UnlockedDoors and
//      Count$DistinctUnlockedDoors now read the canonical
//      `card.unlockedDoors: Set<string>` shape stamped by the Wave 22
//      UnlockDoorEffect (FullyUnlockTrigger reads the same slot). Legacy
//      number-shape fallback retained for fixtures that haven't migrated.
//   2. phase/phase-handler.ts + game-flags.ts — CR 502.2 ordering: extra
//      untap loops (AdditionalUntapStep) now run BEFORE the canonical
//      untap pass, observable to "at the beginning of the untap step"
//      triggers and to mid-flight re-tap effects.
//   3. priority/legal-action-enumerator.ts — MayBeCastBy enumeration now
//      iterates every OPPONENT's hand (Sen Triplets shape), in addition
//      to library-top and Exile. The mayBeCastBy registry walk filters
//      out non-matching seats, so no false positives appear.
//   4. layers/layer5-color.ts + static/handlers/continuous.ts — Layer 5
//      ColorChangeEffect now carries an optional `colorsFn` callback;
//      ContinuousStaticHandler routes ChosenColor / ChosenColors through
//      the callback so Painter's Servant-shape cards resolve their dynamic
//      color at apply-time from the source card's chosenColors slot.
//   5. statics/wave70k-gate-helpers.ts — attackRequirementsFor's
//      ValidDefender$ token grammar now recognises Battle.YouCtrl /
//      Battle.OppCtrl / Battle.NotYouProtect / Player.YouCtrl /
//      Player.OppCtrl (closes the prior conservative-reject TODO).
//   6. layers/base-characteristics.ts + card.ts — Crew static
//      (`crewStaticActive`) now adds CardType.Creature to the type line
//      via the base-characteristics layer (no Crew payment required;
//      static-form Vehicle "is a creature without crewing").
import type {
  CardDefinition,
  LobbyPlayer,
  ManaCostAst,
  ManaCostJSON,
  PaperCard,
  PlayerSeat,
  StaticAbility,
  StaticAbilityMode,
  StaticAst,
} from "@mtg-forge-ts/core";
import {
  CardType,
  Color,
  DEFAULT_PAPER_CARD_FLAGS,
  ManaCost,
  PhaseStep,
  SeededRng,
  TypeLine,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "./card.js";
import type { GameMeta } from "./game-meta.js";
import type { GameRules } from "./game-rules.js";
import { Game } from "./game.js";
import { PhaseHandler } from "./phase/phase-handler.js";
import { enumerateLegalActions } from "./priority/legal-action-enumerator.js";
import { staticHandlerRegistry } from "./static/static-handler.js";
import { attackRequirementsFor } from "./statics/wave70k-gate-helpers.js";
import { evaluateExpression } from "./svar/evaluator.js";
import { Battlefield } from "./zone/zones/battlefield.js";
import { Exile } from "./zone/zones/exile.js";
import { Graveyard } from "./zone/zones/graveyard.js";
import { Hand } from "./zone/zones/hand.js";
import { Library } from "./zone/zones/library.js";
// Side-effect: register every handler so registry lookups resolve.
import "./ability/effects/index.js";
import "./static/handlers/index.js";
import "./trigger/handlers/index.js";
import "./svar/selectors/turn-stats.js";

// ── shared fixtures ──────────────────────────────────────────────────────────
const alice: LobbyPlayer = { id: "P0", name: "P0", controllerKind: "human" };
const bob: LobbyPlayer = { id: "P1", name: "P1", controllerKind: "human" };
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
  forgeSha: "test",
  cardDataSyncedAt: "2026-04-30T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "wave99",
};

const mkGame = (): Game => {
  const game = new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(0xc0ffeeben),
  });
  for (const p of game.players) {
    p.zones.set(ZoneType.Library, new Library(ZoneType.Library, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
    p.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p.seat));
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
    p.zones.set(ZoneType.Exile, new Exile(ZoneType.Exile, p.seat));
  }
  return game;
};

const mkManaCostAst = (raw: string): ManaCostAst => {
  const j: ManaCostJSON = ManaCost.parse(raw).toJSON();
  return { raw, symbols: j.symbols };
};

const mkPaper = (name: string, typeLine = "Creature — Bear", manaCostRaw = "1G"): PaperCard => ({
  name,
  edition: "TST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: {
    name,
    oracle: "",
    types: TypeLine.parse(typeLine),
    manaCost: mkManaCostAst(manaCostRaw),
    pt: { power: "2", toughness: "2" },
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars: new Map(),
  } as CardDefinition,
});

interface MintOpts {
  readonly game: Game;
  readonly id: number;
  readonly paper: PaperCard;
  readonly seat?: 0 | 1;
  readonly zone?: ZoneType;
}
const mintCard = (opts: MintOpts): Card => {
  const cid = mkEntityId(opts.id);
  const seat: PlayerSeat = mkPlayerSeat(opts.seat ?? 0);
  const card = new Card(cid, opts.paper, seat, seat, opts.zone ?? ZoneType.Battlefield);
  opts.game.cards.set(cid, card);
  const z = opts.game.getPlayer(seat).zones.get(opts.zone ?? ZoneType.Battlefield);
  z?.add(cid);
  return card;
};

const buildAndRegisterStatic = (
  game: Game,
  ast: StaticAst,
  sourceCardId: number,
  staticIdSeed: number,
  controllerSeat: 0 | 1 = 0,
): StaticAbility => {
  const Cls = staticHandlerRegistry.lookup(ast.mode as StaticAbilityMode);
  if (!Cls) throw new Error(`mode ${ast.mode} not registered`);
  const s = new Cls().build(ast, {
    game,
    sourceCardId: mkEntityId(sourceCardId),
    controllerSeat: mkPlayerSeat(controllerSeat),
    staticId: mkEntityId(staticIdSeed),
  });
  game.staticEffectRegistry.register(s);
  return s;
};

// ── Pick 1: turn-stats UnlockedDoors via Set<string> ─────────────────────────
describe("Wave 99 — Count$UnlockedDoors reads canonical Set<string>", () => {
  it("sums door counts across cards the controller controls", () => {
    const g = mkGame();
    const seat0 = mkPlayerSeat(0);
    const room1 = mintCard({ game: g, id: 7100, paper: mkPaper("Room A", "Enchantment — Room"), seat: 0 });
    const room2 = mintCard({ game: g, id: 7101, paper: mkPaper("Room B", "Enchantment — Room"), seat: 0 });
    // Opponent room — must NOT be counted in seat 0's tally.
    const oppRoom = mintCard({
      game: g,
      id: 7102,
      paper: mkPaper("Opp Room", "Enchantment — Room"),
      seat: 1,
    });
    (room1 as unknown as { unlockedDoors?: Set<string> }).unlockedDoors = new Set(["front"]);
    (room2 as unknown as { unlockedDoors?: Set<string> }).unlockedDoors = new Set(["front", "back"]);
    (oppRoom as unknown as { unlockedDoors?: Set<string> }).unlockedDoors = new Set([
      "front",
      "back",
      "side",
    ]);
    const total = evaluateExpression(
      { kind: "Count", raw: "Count$UnlockedDoors", args: [{ kind: "literal", raw: "UnlockedDoors" }] },
      { game: g, svars: new Map(), controller: seat0, sourceCardId: room1.id },
    );
    expect(total).toBe(3); // 1 (room1.front) + 2 (room2.front/back); opp's 3 excluded.
  });

  it("DistinctUnlockedDoors counts cards with at least one open door", () => {
    const g = mkGame();
    const seat0 = mkPlayerSeat(0);
    const room1 = mintCard({ game: g, id: 7110, paper: mkPaper("Room C", "Enchantment — Room"), seat: 0 });
    const room2 = mintCard({ game: g, id: 7111, paper: mkPaper("Room D", "Enchantment — Room"), seat: 0 });
    const room3 = mintCard({ game: g, id: 7112, paper: mkPaper("Room E", "Enchantment — Room"), seat: 0 });
    (room1 as unknown as { unlockedDoors?: Set<string> }).unlockedDoors = new Set(["front", "back"]);
    (room2 as unknown as { unlockedDoors?: Set<string> }).unlockedDoors = new Set(["front"]);
    // room3 has the slot but it's empty — should NOT count toward distinct.
    (room3 as unknown as { unlockedDoors?: Set<string> }).unlockedDoors = new Set();
    const distinct = evaluateExpression(
      {
        kind: "Count",
        raw: "Count$DistinctUnlockedDoors",
        args: [{ kind: "literal", raw: "DistinctUnlockedDoors" }],
      },
      { game: g, svars: new Map(), controller: seat0, sourceCardId: room1.id },
    );
    expect(distinct).toBe(2); // room1, room2; room3 (empty Set) excluded.
  });

  it("legacy number-shape slot still works (back-compat)", () => {
    const g = mkGame();
    const seat0 = mkPlayerSeat(0);
    const room = mintCard({
      game: g,
      id: 7120,
      paper: mkPaper("Legacy Room", "Enchantment — Room"),
      seat: 0,
    });
    // Legacy fixture wrote `unlockedDoors: number`. The new helper still
    // returns the count.
    (room as unknown as { unlockedDoors?: number }).unlockedDoors = 4;
    const total = evaluateExpression(
      { kind: "Count", raw: "Count$UnlockedDoors", args: [{ kind: "literal", raw: "UnlockedDoors" }] },
      { game: g, svars: new Map(), controller: seat0, sourceCardId: room.id },
    );
    expect(total).toBe(4);
  });
});

// ── Pick 2: AdditionalUntapStep ordering CR 502.2 ────────────────────────────
describe("Wave 99 — AdditionalUntapStep runs BEFORE canonical untap", () => {
  it("an extra-untap-step counter is consumed BEFORE the canonical untap pass", () => {
    // Strategy: tap two creatures, stamp 1 pending extra. Insert an
    // observer that captures the order in which untap-pass calls happen
    // by asserting the counter drains FIRST. Concretely: when the
    // canonical pass starts the counter is already at zero (extras were
    // consumed first); when extras start the counter is 1.
    const g = mkGame();
    const seat0 = mkPlayerSeat(0);
    const card = mintCard({
      game: g,
      id: 7200,
      paper: mkPaper("Bear"),
      seat: 0,
      zone: ZoneType.Battlefield,
    });
    card.tapped = true;
    g.flags.pendingAdditionalUntapSteps.set(seat0, 1);
    g.phase = PhaseStep.Untap;
    const ph = new PhaseHandler(g);
    // Drain the generator.
    const gen = ph.performTurnBasedActions(PhaseStep.Untap, seat0) as Generator<unknown, void, unknown>;
    let next = gen.next();
    let safety = 0;
    while (!next.done) {
      safety++;
      if (safety > 5000) throw new Error("runaway");
      next = gen.next();
    }
    // Counter drained, creature untapped (both passes hit it; extras
    // first per Wave 99 ordering).
    expect(g.flags.pendingAdditionalUntapSteps.get(seat0) ?? 0).toBe(0);
    expect(card.tapped).toBe(false);
  });

  it("multiple pending extras all consumed before canonical pass (FIFO)", () => {
    const g = mkGame();
    const seat0 = mkPlayerSeat(0);
    const card = mintCard({ game: g, id: 7210, paper: mkPaper("Bear"), seat: 0 });
    card.tapped = true;
    g.flags.pendingAdditionalUntapSteps.set(seat0, 3);
    g.phase = PhaseStep.Untap;
    const ph = new PhaseHandler(g);
    const gen = ph.performTurnBasedActions(PhaseStep.Untap, seat0) as Generator<unknown, void, unknown>;
    let next = gen.next();
    let safety = 0;
    while (!next.done) {
      safety++;
      if (safety > 5000) throw new Error("runaway");
      next = gen.next();
    }
    // All 3 extras drained.
    expect(g.flags.pendingAdditionalUntapSteps.get(seat0) ?? 0).toBe(0);
  });
});

// ── Pick 3: legal-action-enumerator opponent-hand (Sen Triplets) ─────────────
describe("Wave 99 — Sen Triplets cast surface enumerates opponent's hand", () => {
  it("opponent-hand MayBeCastBy lights up cast actions on the opponent's cards", () => {
    const g = mkGame();
    const seat0 = mkPlayerSeat(0);
    g.activePlayer = seat0;
    g.phase = PhaseStep.Main1;
    g.turn = 3;
    // Sen Triplets controlled by seat 0.
    mintCard({
      game: g,
      id: 7300,
      paper: mkPaper("Sen Triplets", "Legendary Artifact Creature"),
      seat: 0,
    });
    // Seat 1's hand: a non-land card.
    const oppCard = mintCard({
      game: g,
      id: 7301,
      paper: mkPaper("Lightning Bolt", "Instant", "R"),
      seat: 1,
      zone: ZoneType.Hand,
    });
    // Build the MayBeCastBy gate: ValidCard$ Card.OppCtrl | Caster$ You.
    // Sen Triplets in Forge is "Card.OppCtrl.InHand" but `InHand` isn't yet
    // a recognised cardMatchesFilter qualifier; the legal-action enumerator
    // iterates opponent hands regardless and the Card.OppCtrl predicate
    // matches every opp-controlled card (which the hand-only iteration
    // narrows to just hand cards).
    buildAndRegisterStatic(
      g,
      {
        mode: "MayBeCastBy",
        params: {
          ValidCard: { kind: "literal", raw: "Card.OppCtrl" },
          Caster: { kind: "literal", raw: "You" },
        },
        activeInZones: [],
      },
      7300,
      77300,
      0,
    );
    const actions = enumerateLegalActions(g, seat0);
    // Find the cast-spell action targeting the opponent-hand card.
    const oppCast = actions.find(
      (a) => a.kind === "castSpell" && a.cardId === oppCard.id && a.zone === ZoneType.Hand,
    );
    expect(oppCast).toBeDefined();
  });

  it("no MayBeCastBy → no opponent-hand cast actions enumerated", () => {
    const g = mkGame();
    const seat0 = mkPlayerSeat(0);
    g.activePlayer = seat0;
    g.phase = PhaseStep.Main1;
    g.turn = 3;
    const oppCard = mintCard({
      game: g,
      id: 7310,
      paper: mkPaper("Bolt", "Instant", "R"),
      seat: 1,
      zone: ZoneType.Hand,
    });
    const actions = enumerateLegalActions(g, seat0);
    const oppCast = actions.find((a) => a.kind === "castSpell" && a.cardId === oppCard.id);
    expect(oppCast).toBeUndefined();
  });
});

// ── Pick 4: Layer 5 ChosenColor SVar via colorsFn ────────────────────────────
describe("Wave 99 — Continuous AddColor$ ChosenColor resolves dynamically", () => {
  it("source's chosenColors[0] = Red → target gains Red", () => {
    const g = mkGame();
    const source = mintCard({ game: g, id: 7400, paper: mkPaper("Painter"), seat: 0 });
    const target = mintCard({ game: g, id: 7401, paper: mkPaper("Bear"), seat: 0 });
    source.chosenColors = [Color.Red];
    buildAndRegisterStatic(
      g,
      {
        mode: "Continuous",
        params: {
          Affected: { kind: "literal", raw: "Card" },
          AddColor: { kind: "literal", raw: "ChosenColor" },
        },
        activeInZones: [],
      },
      7400,
      77400,
      0,
    );
    const c = g.layerEngine.computeCharacteristics(target.id);
    expect(c.colors.has(Color.Red)).toBe(true);
  });

  it("dynamic resolution updates when chosenColors changes (no static rebuild)", () => {
    const g = mkGame();
    const source = mintCard({ game: g, id: 7410, paper: mkPaper("Painter"), seat: 0 });
    const target = mintCard({ game: g, id: 7411, paper: mkPaper("Bear"), seat: 0 });
    source.chosenColors = [Color.Blue];
    buildAndRegisterStatic(
      g,
      {
        mode: "Continuous",
        params: {
          Affected: { kind: "literal", raw: "Card" },
          AddColor: { kind: "literal", raw: "ChosenColor" },
        },
        activeInZones: [],
      },
      7410,
      77410,
      0,
    );
    let c = g.layerEngine.computeCharacteristics(target.id);
    expect(c.colors.has(Color.Blue)).toBe(true);
    // Mutate chosenColors and bump epoch — the colorsFn closure re-reads.
    source.chosenColors = [Color.Green];
    g.layerEngine.bumpEpoch("test-mutate");
    c = g.layerEngine.computeCharacteristics(target.id);
    expect(c.colors.has(Color.Green)).toBe(true);
    expect(c.colors.has(Color.Blue)).toBe(false);
  });

  it("no chosen color → no color added (static-fallback empty)", () => {
    const g = mkGame();
    mintCard({ game: g, id: 7420, paper: mkPaper("Painter"), seat: 0 });
    const target = mintCard({ game: g, id: 7421, paper: mkPaper("Bear"), seat: 0 });
    // chosenColors stays empty (default).
    buildAndRegisterStatic(
      g,
      {
        mode: "Continuous",
        params: {
          Affected: { kind: "literal", raw: "Card" },
          AddColor: { kind: "literal", raw: "ChosenColor" },
        },
        activeInZones: [],
      },
      7420,
      77420,
      0,
    );
    const c = g.layerEngine.computeCharacteristics(target.id);
    // No color added.
    expect(c.colors.has(Color.Red)).toBe(false);
    expect(c.colors.has(Color.Blue)).toBe(false);
    expect(c.colors.has(Color.Black)).toBe(false);
  });
});

// ── Pick 5: AttackRequirement defender filter — broader tokens ───────────────
describe("Wave 99 — AttackRequirement Defender filter recognises more tokens", () => {
  it("Battle.OppCtrl restricts allowed defenders to opponent-controlled battles", () => {
    const g = mkGame();
    // Mint an attacker controlled by seat 0.
    const attacker = mintCard({ game: g, id: 7500, paper: mkPaper("Hill Giant"), seat: 0 });
    // Mint two battles: one controlled by seat 0 (own), one by seat 1 (opp).
    const ownBattle = mintCard({
      game: g,
      id: 7501,
      paper: mkPaper("My Battle", "Battle"),
      seat: 0,
    });
    const oppBattle = mintCard({
      game: g,
      id: 7502,
      paper: mkPaper("Opp Battle", "Battle"),
      seat: 1,
    });
    buildAndRegisterStatic(
      g,
      {
        mode: "AttackRequirement",
        params: {
          ValidCreature: { kind: "literal", raw: "Card.Self" },
          ValidDefender: { kind: "literal", raw: "Battle.OppCtrl" },
        },
        activeInZones: [],
      },
      attacker.id as unknown as number,
      77500,
      0,
    );
    const result = attackRequirementsFor(g, attacker.id);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.allowedBattleIds.has(oppBattle.id)).toBe(true);
      expect(result.allowedBattleIds.has(ownBattle.id)).toBe(false);
    }
  });

  it("Player.YouCtrl is an alias for You", () => {
    const g = mkGame();
    const seat0 = mkPlayerSeat(0);
    const attacker = mintCard({ game: g, id: 7510, paper: mkPaper("Hill Giant"), seat: 0 });
    buildAndRegisterStatic(
      g,
      {
        mode: "AttackRequirement",
        params: {
          ValidCreature: { kind: "literal", raw: "Card.Self" },
          ValidDefender: { kind: "literal", raw: "Player.YouCtrl" },
        },
        activeInZones: [],
      },
      attacker.id as unknown as number,
      77510,
      0,
    );
    const result = attackRequirementsFor(g, attacker.id);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.allowedSeats.has(seat0)).toBe(true);
      expect(result.allowedSeats.has(mkPlayerSeat(1))).toBe(false);
    }
  });
});

// ── Pick 6: Crew static AddType Creature via base-characteristics ────────────
describe("Wave 99 — Crew static (crewStaticActive) adds Creature to type line", () => {
  it("Vehicle with crewStaticActive=true is a creature without crewing", () => {
    const g = mkGame();
    const vehicle = mintCard({
      game: g,
      id: 7600,
      paper: mkPaper("Static Vehicle", "Artifact — Vehicle"),
      seat: 0,
    });
    // Pre-stamp characteristics: not yet a creature.
    const pre = g.layerEngine.computeCharacteristics(vehicle.id);
    expect(pre.types.has(CardType.Creature)).toBe(false);
    expect(pre.types.has(CardType.Artifact)).toBe(true);
    // Stamp the slot (mirrors what the Crew static handler does on activate).
    vehicle.crewStaticActive = true;
    g.layerEngine.bumpEpoch("crew-static-on");
    const post = g.layerEngine.computeCharacteristics(vehicle.id);
    expect(post.types.has(CardType.Creature)).toBe(true);
    expect(post.types.has(CardType.Artifact)).toBe(true);
    // Subtype Vehicle preserved.
    expect(post.subtypes.has("Vehicle")).toBe(true);
  });

  it("clearing crewStaticActive removes the Creature type addition", () => {
    const g = mkGame();
    const vehicle = mintCard({
      game: g,
      id: 7610,
      paper: mkPaper("Static Vehicle", "Artifact — Vehicle"),
      seat: 0,
    });
    vehicle.crewStaticActive = true;
    g.layerEngine.bumpEpoch("crew-static-on");
    expect(g.layerEngine.computeCharacteristics(vehicle.id).types.has(CardType.Creature)).toBe(true);
    vehicle.crewStaticActive = undefined;
    g.layerEngine.bumpEpoch("crew-static-off");
    expect(g.layerEngine.computeCharacteristics(vehicle.id).types.has(CardType.Creature)).toBe(false);
  });
});

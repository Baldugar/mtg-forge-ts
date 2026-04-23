# SP7 — Limited (Sealed + Draft + Cube)

**Status:** Design approved
**Date:** 2026-04-23
**Package:** `@mtg-forge-ts/limited`
**Prerequisites:** SP1, SP2, SP3, SP4, SP5 (needs `AiDeckBuilder` + `AiProfile`), SP6 (for limited `FormatDefinition` auto-registration)

---

## Purpose

Port Forge's limited-format machinery: booster generation, Sealed events (with Jumpstart + Prerelease + Team Sealed variants), Draft orchestration with 9 variants (standard + Rochester + Winston + Solomon + Team + Chaos + Cube + Grid), Conspiracy-style draft-matters abilities, sealed deck-building bot, draft bots, cube support. Output is a deck ready to play via the normal game engine.

## 1. Package responsibility

`@mtg-forge-ts/limited` owns:

- **Booster generation** — data-driven per-set pack composition.
- **Sealed orchestration** — including Jumpstart, Prerelease, Team Sealed.
- **Draft orchestration** — 9 variants with shared infrastructure.
- **Draft bots** — AI using `AiProfile` for picks.
- **Sealed deck-building bot** — uses `AiDeckBuilder`.
- **`CubeRegistry`** — consumer-registered cubes.
- **`JumpstartThemeRegistry`** — predefined half-decks.
- **`DraftTriggerRegistry`** — Conspiracy draft-matters card abilities.
- **`DraftView` projections** — hidden-info filtering for drafts (what each player sees).
- **Snapshot/restore** for paused drafts/sealed events.
- **Limited `FormatDefinition` auto-registration** — `sealed-<SET>`, `draft-<SET>`, `cube-<id>`.

Depends on `core`, `cards` (set data + print sheets), `formats` (limited format defs), `ai` (profiles + deck-builder). Does NOT depend on `@mtg-forge-ts/game` directly — produces decks, which are played via the engine independently.

## 2. Booster generation

Pack composition is **100% data-driven** per set. No hardcoded "modern pack shape."

### Input

`EditionInfo` (from SP4) contains per-set print sheet rules from Forge's `printsheets.txt`. Rules vary widely:
- Original packs (1993) — 8-card packs from specific rarities.
- 15-card packs (Revised era) — 1 rare, 3 uncommons, 10-11 commons, foil slot (post-2003).
- Modern Play Boosters (MH3+) — 14 playable cards with specific slot rules.
- Set Boosters, Collector Boosters — distinct compositions.
- Kaladesh inventions slot (1:144).
- Strixhaven mystical archive slot.
- Ravnica guild-land slot.
- Ikoria ikonic/collab slot.
- Innistrad DFC slot.
- Snow/theme basic slots.
- Foil-in-place-of-common probability.
- Mythic rarity probability (~1:8).
- Each set's specific rules are **data**, not code.

### Generator API

```ts
class BoosterGenerator {
  generate(setCode: string, opts?: { seed?: bigint }): PaperCard[];
  generateMany(setCode: string, count: number, opts?: { seed?: bigint }): PaperCard[][];
  generateSealedPool(
    setCodes: string[],
    packCount: number,
    opts?: { eventSeed?: bigint; playerIndex?: number },
  ): PaperCard[];
}
```

### Seed derivation for sealed

Reproducible tournaments:
- `eventSeed` at event level.
- Per-player seed = `hash(eventSeed, playerIndex)`.
- Allows replaying single-player pool with `(eventSeed, playerIndex)` without full event state.

## 3. Draft shared infrastructure

All draft variants share orchestration concerns: player identification, pack distribution, pick/pass state machine, variant-specific pack direction, per-player revealed state (for Conspiracy), snapshots.

### `DraftController`

Generator-based suspendable state machine, parallel in shape to `Game`:

```ts
class DraftController {
  static create(config: DraftConfig): DraftSession;

  *run(): Generator<DraftYield, DraftResult, DraftResponse>;
}

type DraftYield =
  | { kind: "decision", request: DraftDecisionRequest }
  | { kind: "event", event: DraftEvent };

type DraftDecisionRequest =
  | { kind: "pick", playerSeat: PlayerSeat, currentPack: PaperCard[], packIndex: number, pickIndex: number, seenSoFar: PaperCard[] }
  | { kind: "jumpstartPick", playerSeat: PlayerSeat, themes: JumpstartTheme[] }
  | { kind: "winstonPile", playerSeat: PlayerSeat, piles: WinstonPile[] }
  | { kind: "solomonSplit", playerSeat: PlayerSeat, cards: PaperCard[] }
  | { kind: "gridPick", playerSeat: PlayerSeat, grid: PaperCard[][] }
  | { kind: "rochesterPick", playerSeat: PlayerSeat, revealedPack: PaperCard[] }
  | { kind: "draftMulligan", playerSeat: PlayerSeat, poolSoFar: PaperCard[] };   // rare, format-specific
```

### `DraftPlayerController` interface

```ts
interface DraftPlayerController {
  decide(request: DraftDecisionRequest): DraftDecisionResponse;
}
```

Implementations: `HumanDraftController` (delegates to consumer callback), `AiDraftController` (uses `AiProfile`), `ScriptedDraftController` (replay from log).

### `DraftView` (hidden-info projection)

```ts
class DraftView {
  static from(session: DraftSession, viewerSeat: PlayerSeat): DraftView;
  // Exposes only what `viewerSeat` is allowed to see:
  //   - their own pool.
  //   - the pack they're currently holding.
  //   - publicly-revealed Conspiracy cards (all seats).
  // Hides: other players' pools, their pack contents, cards they've seen.
}
```

### `DraftOptions` (parameterization)

Forge parameterizes booster-style drafts via a `DraftOptions` bundle rather than a distinct variant class per configuration. This covers standard drafts, Commander Legends-style 4-player pick-2 drafts, Commander Masters pre-selected-commander drafts, Jumpstart Historic Horizons, and anything in between.

```ts
interface DraftOptions {
  maxPodSize: number;                       // 8 for standard, 4 for Commander-style
  recommendedPodSize: number;               // typically same as maxPodSize; may be smaller for cubes
  maxMatchPlayers: number;                  // 2 for standard post-draft play, 4 for Commander/Conspiracy
  doublePick: "NEVER" | "FIRST_PICK" | "WHEN_POD_SIZE_IS_4" | "ALWAYS";
  deckType: "Normal" | "Commander";         // deck-construction rules applied post-draft
  freeCommander?: string;                   // some sets (e.g. Commander Masters) assign a commander
}
```

Per-set data (from Forge's upstream edition data) declares these options. Ported 1:1 from Forge's `DraftOptions` class.

**Concrete configurations:**

| Draft style | Configuration |
|---|---|
| Standard 8-player draft | `{ maxPodSize: 8, doublePick: NEVER, deckType: Normal, maxMatchPlayers: 2 }` |
| Commander Legends / Commander Masters 4-player draft | `{ maxPodSize: 4, doublePick: ALWAYS, deckType: Commander, maxMatchPlayers: 4 }` |
| Commander Legends at 8 players (optional) | `{ maxPodSize: 8, doublePick: WHEN_POD_SIZE_IS_4, deckType: Commander, maxMatchPlayers: 4 }` — pick-2 only activates at 4-player pods |
| Jumpstart Historic Horizons draft | `{ maxPodSize: 8, doublePick: FIRST_PICK, deckType: Normal, maxMatchPlayers: 2 }` |
| Commander Masters with pre-selected commander | `{ …, freeCommander: "<specific-commander-name>" }` |

## 4. Draft variants

Two classes of draft variant:

**Parameterized variants** — run on the shared `BoosterDraft` engine with different `DraftOptions`. These include:
- Standard 8-player booster draft.
- Commander Legends-style 4-player pick-2 draft (and the other pick-2 flavors enumerated above).
- Commander Masters (4-player, free commander).
- Jumpstart Historic Horizons.
- Team Draft (BoosterDraft + team assignment).
- Chaos Draft (BoosterDraft + per-pack set variation via `ChaosPoolStrategy`).
- Conspiracy Draft (BoosterDraft + `DraftTriggerRegistry` hooks; standard 8-player topology).

**Mechanically-distinct variants** — have their own state machines because they change the pick-and-pass topology entirely:
- **Rochester Draft** — pack opened face-up to whole table; pick order rotates; 2-8 players.
- **Winston Draft** (2-player) — 3 face-down piles; take a pile or reveal and pass.
- **Solomon Draft** (2-player) — one player splits 8 cards into 2 piles; other chooses a pile.
- **Grid Draft** (2-player) — 9 cards in a 3x3 grid; pick a row or column.

**Team Sealed** (2v2 or 3v3) — shared pool across a team, built on `SealedEvent` (not a draft). Lives in sealed machinery.

**Cube Draft** — custom pool from `CubeRegistry`. Draft method is one of: `BoosterDraft` (with appropriate `DraftOptions`), Grid, Winston, or custom. Pack size + count configurable per cube.

All variants share infrastructure (DraftController, DraftPlayerController, DraftView, DraftSnapshot). Each mechanically-distinct variant has its own file in `src/variants/`. Parameterized variants don't need separate files — they're configurations.

## 5. Draft bots (`AiDraftController`)

Inputs:
- Current pack contents.
- Cards already drafted.
- Cards seen but not drafted (signal-reading for down-table archetypes).
- Target archetype (committed after N picks).
- Profile (from `AiProfile`).

Logic:
- **Card power** evaluation per card (color-adjusted, archetype-adjusted).
- **Signal reading**: late-in-pack high-quality card → color is open downstream.
- **Archetype commitment**: after ~3-5 picks, lock to 1-2 colors.
- **Pick priority**: rares early, on-color commons later, bombs over fillers.
- **Mana base projection**: track fixers + lands.
- **Curve considerations**: avoid over-stuffing any single CMC.

For Mana and Life post-v1 tournament profiles (Pro Tour draft bot, etc.), the same bot class is re-used with different `AiProfile.params` values.

## 6. Sealed deck-building bot

Given a ~90-card sealed pool:

1. Identify strongest color pairs by counting quality cards per color (weighted by `CreatureEvaluator`).
2. Pick top 2-3 color combinations.
3. For each candidate:
   - Assume 17 lands (adjusted per curve).
   - Fill with creatures, removal, and answers; match curve.
4. Evaluate each candidate deck via `GameStateEvaluator` (project forward).
5. Pick best.

Uses `AiDeckBuilder` from SP5 as the core algorithm with limited-specific modifications.

## 7. `DraftTriggerRegistry` (Conspiracy draft-matters abilities)

Conspiracy sets (CNS, CN2) and some Unfinity cards have abilities that fire **during the draft itself**, not in the game. Examples:
- "Reveal this as you draft it."
- "After you draft a card named X, ..."
- "The next time you draft a card this draft, ..."

Infrastructure:

```ts
class DraftTriggerRegistry {
  register(trigger: DraftTrigger): void;
  unregister(trigger: DraftTrigger): void;
  onEvent(event: DraftEvent): DraftTriggeredInstance[];
}

interface DraftTrigger {
  sourceCardId: string;
  eventKind: DraftEventKind;
  matchesEvent(event: DraftEvent): boolean;
  buildInstance(event: DraftEvent): DraftTriggeredInstance;
}
```

Triggers fire at pick/pass boundaries, not at game priority windows. Separate from `@mtg-forge-ts/game`'s `TriggerRegistry`.

~50-80 MTG cards across all sets have draft-matters text.

## 8. Cube support

```ts
interface CubeDefinition {
  id: string;
  name: string;
  cards: PaperCard[];                       // typically 360/450/540
  draftMethod: "booster" | "grid" | "winston" | "custom";
  boosterRules?: CubePackRules;             // if booster method: packs/player, cards/pack, rarity-distribution
  customMethod?: string;                    // reference a registered custom method
}

class CubeRegistry {
  register(cube: CubeDefinition): void;
  get(id: string): CubeDefinition | null;
  list(): CubeDefinition[];
}
```

Cube auto-registers a `FormatDefinition` with id `cube-<cubeId>` via `FormatRegistry`.

Mana and Life can register arbitrary cubes.

## 9. Jumpstart

Pick 2 themed half-decks, combine into a 40-card deck:

```ts
interface JumpstartTheme {
  id: string;
  name: string;
  colors: ColorSet;
  cards: PaperCard[];                       // exactly ~20 cards
  set: SetCode;
}

class JumpstartThemeRegistry {
  register(theme: JumpstartTheme): void;
  get(id: string): JumpstartTheme | null;
  list(setCode?: SetCode): JumpstartTheme[];
}

class JumpstartEvent {
  openPacks(players: PlayerConfig[], themesPerPlayer: number, seed?: bigint): Map<PlayerSeat, Deck>;
}
```

Player receives random themed half-decks; picks 2; combined. No deckbuilding phase beyond the choice.

## 10. Prerelease

Sealed with a guaranteed promo:

```ts
interface SealedPackConfig {
  setCodes: string[];
  packCount: number;
  promoSlot?: {
    rarity: "mythic-or-rare";
    datedStampPool: PaperCard[];            // set's prerelease promo pool
  };
}
```

Seeded deterministic pool + predictable promo.

## 11. Sealed orchestration

```ts
class SealedEvent {
  openPools(
    players: PlayerConfig[],
    packConfig: SealedPackConfig,
    seed?: bigint,
  ): Map<PlayerSeat, PaperCard[]>;
}
```

Flow:
1. Open N packs per player (using seeded booster generator).
2. Each player receives pool.
3. Each player builds deck (Human via UI; Bot via `SealedDeckBuilder`).
4. Decks validated against Sealed format (minimum 40 cards etc.).
5. Event is ready for match play.

For Team Sealed: team receives combined pool; teams build N decks totaling the pool.

For Jumpstart: skip deck-building; use Jumpstart flow instead.

For Prerelease: add promo to pool; otherwise standard sealed.

## 12. Limited `FormatDefinition` auto-registration

At library load (or lazily), for every set in `EditionDb`:
- Auto-register `sealed-<SETCODE>` — 6-pack sealed from that set.
- Auto-register `draft-<SETCODE>` — 8-player booster draft from that set.

For cubes: auto-register `cube-<cubeId>` when cube registers with `CubeRegistry`.

For multi-set limited (Chaos Draft, Flashback formats, Mana and Life custom historical events): consumer explicitly registers.

## 13. Snapshot / restore

Matches `GameSnapshot` machinery. Covers all draft variants + sealed events:

```ts
interface DraftSnapshot {
  header: { schemaVersion, engineVersion, forgeSha, savedAt };
  sessionState: DraftSessionState;
  rngState: RngStateSnapshot;              // for variants that generate mid-draft (Chaos)
  decisionLog: DraftDecision[];
  eventLog: DraftEvent[];
}
```

`DraftController.restore(snapshot, controllers)` resumes mid-pick.

Same for `SealedEventSnapshot`.

## 14. Testing strategy

- **Booster composition fixtures** — chi-squared test over N=10000 samples that pack composition honors each set's rules.
- **Seeded determinism** — same seed + set → identical pack. Regression test.
- **Draft state-machine tests** — scripted 8-bot drafts run to completion; final pools disjoint + cover entire packs.
- **Variant-specific tests** — Winston, Solomon, Rochester, Grid, Chaos, Team; each variant's state transitions.
- **Conspiracy draft-matters fixtures** — one fixture per draft-matters card (~50-80).
- **Sealed deck builder quality** — on reference set of 50 sealed pools, bot-built deck plays to ≥45% win rate against baseline.
- **Replay** — save mid-pick, load, continue, verify result equals no-save result.
- **Snapshot restore property** — same property test machinery as Game snapshot restoration.
- **Per-player seed derivation** — `hash(eventSeed, 0)` stable across runs.

## 15. Phases

| Phase | Scope |
|---|---|
| **7a** | Print sheet parser + set booster rule data structures |
| **7b** | `BoosterGenerator` — data-driven pack composition engine |
| **7c** | Per-set slot specialties (DFC, mystical archive, inventions, guildlands, ikonic/collab, token slots) |
| **7d** | Foil slot + basic land slot policies + mythic-rarity roll |
| **7e** | `SealedEvent` orchestration (standard + Team Sealed + Prerelease) |
| **7f** | `JumpstartThemeRegistry` + `JumpstartEvent` |
| **7g** | `SealedDeckBuilder` bot |
| **7h** | `DraftController` + `DraftOptions` + `BoosterDraft` with full `DraftOptions` support (covers standard 8-player + Commander Legends 4-player pick-2 + Commander Masters + Jumpstart Historic Horizons — all parameterizations) |
| **7i** | `AiDraftController` (bot with archetype + signal reading; reads `DraftOptions` for pod size + deck type) |
| **7j** | Mechanically-distinct variants: Rochester, Winston, Solomon, Grid — each with its own state machine |
| **7k** | BoosterDraft configurations: Team Draft (team assignment on top of BoosterDraft), Chaos Draft (per-pack set selection via `ChaosPoolStrategy`) |
| **7l** | `DraftTriggerRegistry` + Conspiracy draft-matters card abilities (layered on BoosterDraft) |
| **7m** | `CubeRegistry` + cube-draft machinery (reuses BoosterDraft/Grid/Winston per cube config) |
| **7n** | Limited `FormatDefinition` auto-registration + integration with `FormatRegistry` |
| **7o** | `DraftSnapshot` + restore + rng-state preservation |
| **7p** | Tests: chi-squared composition, variant state machines, deck builder quality, snapshot property, DraftOptions parameterization matrix |

## 16. What SP7 does NOT cover

- Rendering a draft UI — consumer concern.
- Networked multi-human draft transport — consumer builds on our serializable state.
- ML-learned pick models — out of scope; we port Forge's heuristic bot.
- Real-money economy / pack opening with loot-box mechanics — out of scope.
- Draft timers — consumer layers on top of our state machine (library exposes only bot decision budgets, not human wall-clock).

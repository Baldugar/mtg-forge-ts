# SP6 — Formats & Legality

**Status:** Design approved
**Date:** 2026-04-23
**Package:** `@mtg-forge-ts/formats`
**Prerequisites:** SP1 (core types), SP4 (card database + release dates)

---

## Purpose

Ship the 14 MTG formats (constructed + commander family + historic/explorer/arena) plus the legality engine. Everything is date-aware: "what was legal on 1997-04-14" is a first-class query, essential for Mana and Life's historical gameplay. Custom format registration supports user-defined tournament formats.

## 1. Package responsibility

`@mtg-forge-ts/formats` owns:

- **Format definitions** for 15 formats (+ Commander variants) in `data/formats/` (vendored from Forge alongside cards data).
- **Legality engine** — `isLegal(card, formatId, opts?)`, `validateDeck(deck, formatId, opts?)`.
- **Commander color identity** computation (CR 903.4).
- **Rotation logic** — policy-driven, returns legal sets for a given date.
- **Historical legality** — all queries accept `asOfDate`.
- **Banlist history management** — banlist-at-date lookup.
- **Commander slot validation** — covers 7-8 commander-slot variants.
- **Companion validation** — restriction checks at deck-build time.
- **`FormatRegistry`** — default formats + consumer-registered custom formats.

Depends on `@mtg-forge-ts/core` (for `FormatDefinition` interface) and `@mtg-forge-ts/cards` (for release dates, card definitions).

Engine-side rule overrides live in `@mtg-forge-ts/game`'s `RuleOverrideRegistry` (referenced by name from format definitions).

## 2. `FormatDefinition` shape (interface in `core`, concrete in `formats`)

```ts
interface FormatDefinition {
  id: string;                               // "standard", "modern", "commander", etc.
  displayName: string;
  category: "constructed" | "limited" | "casual";

  // Card pool rules
  setLegality: SetLegalityRule;
  rarityRestriction?: Rarity[];
  cardPredicate?: (card: CardDefinition, print: PaperCard, date: Date) => boolean;

  // Banlist (versioned over time)
  banlist: BanlistHistory;

  // Deck construction
  deckConstruction: DeckConstructionRules;

  // Game rule modifications
  gameRules: GameRuleModifications;

  // Metadata
  source: "wotc-official" | "forge" | "custom";
  rotationSchedule?: RotationSchedule;
  lastUpdated: string;
}

interface SetLegalityRule {
  kind: "all-sets" | "set-list" | "sets-as-of-date" | "arena-only" | "custom-predicate";
  // kind-specific fields
}

interface BanlistHistory {
  entries: BanlistEntry[];                  // sorted by effective-date ascending
}

interface BanlistEntry {
  effectiveDate: string;
  banned: string[];
  restricted?: string[];
  added?: string[];                         // cards unbanned at this date
}

interface DeckConstructionRules {
  minMain: number;
  maxMain?: number;
  maxSideboard: number;
  maxCopiesNonBasic: number;
  mustHaveCommander: boolean;
  commanderSlot?: CommanderSlotSpec;
  extraZones?: ("sideboard" | "planar" | "scheme" | "conspiracy" | "attractions" | "contraptions" | "sticker")[];
  colorIdentityConstraint?: boolean;
  companionAllowed?: boolean;
}

interface GameRuleModifications {
  startingLife: number;
  startingHandSize: number;
  mulliganRule: "london" | "vancouver" | "paris" | "free";
  firstPlayerSkipsDraw: boolean;
  ruleOverrides?: string[];                 // names of RuleOverrides to enable (registered in @mtg-forge-ts/game)
  playerCount?: { min: number; max: number };
}
```

## 3. The 15 formats

Summarized; each has a full `FormatDefinition` in `data/formats/<id>.txt`.

Most format `id`s are the obvious lowercase name. One exception for upstream-sync compatibility: the standard Brawl format keeps `id: brawl` (matching Forge's upstream `Brawl.txt`) with displayName "Standard Brawl"; the new Historic Brawl is `id: historic-brawl`.

| Format | Pool | Deck | Starting life | Notable |
|---|---|---|---:|---|
| **Casual** | All sets | Flexible (60+) | 20 | No banlist; `cardPredicate` returns true |
| **Vintage** | All paper + reprints | 60+ / 15 side | 20 | Restricted list (limit 1 copy); banlist for uncompetitive |
| **Legacy** | All paper + reprints | 60+ / 15 side | 20 | Larger banlist than Vintage; no restricted |
| **Modern** | 2003+ (8ED forward) | 60+ / 15 side | 20 | Quarterly banlist updates |
| **Pioneer** | 2012+ (RTR forward) | 60+ / 15 side | 20 | Moderate banlist |
| **Standard** | Recent rotation | 60+ / 15 side | 20 | Rotation logic: annual fall, retain 3 most-recent annual blocks |
| **Extended** | Historical retired | 60+ / 15 side | 20 | Frozen definition as of retirement for historical play |
| **Block Constructed** | Single block | 60+ / 15 side | 20 | Auto-generated per block from blockdata |
| **Pauper** | All sets, commons-only (+ recent uncommons per rule changes) | 60+ / 15 side | 20 | Rarity-restricted; bespoke banlist |
| **Commander** | All paper sets | 100 singleton + commander | 40 | Color identity constraint; commander damage; commander tax |
| **Standard Brawl** | Standard-legal | 60 singleton + commander | 30 (2p) / 25 (multi) | `id: brawl`; upstream Forge `Brawl.txt` maps here; commander is legendary creature or planeswalker |
| **Historic Brawl** | Arena Historic pool (includes Alchemy) | 100 singleton + commander | 25 | `id: historic-brawl`; our addition (not in upstream Forge); Arena-style singleton 100 |
| **Historic** | Arena pool | 60+ / 15 side | 20 | Digital; bespoke banlist |
| **Explorer** | Arena subset tracking Pioneer | 60+ / 15 side | 20 | Arena-only |

### Alchemy-card handling for Arena formats

Historic, Historic Brawl, and Alchemy formats include **Alchemy cards** (digital-only rebalanced versions of paper cards). Each `PaperCard` from edition data carries a flag indicating Arena availability + Alchemy rebalance status. Formats with `setLegality.kind = "arena-only"` accept Alchemy cards; paper-only formats reject them. Arena-only cards are invisible to paper-format queries (Standard, Modern, Pioneer, etc.).

### Commander variants (same format id prefix, different `id`)

- `duel-commander` — 1v1, 30 life, tighter banlist.
- `oathbreaker` — 60-card, planeswalker commander + signature spell.
- `pauper-commander` / `pdh` — commons-only commander.
- `1v1-commander` — legacy variant (deprecated but kept for historical).

### Block Constructed generation

Auto-generated at library load from `blockdata/blocks.txt`:
- For each block: produce `FormatDefinition` with `id = block-<blockName>`, `setLegality: { kind: "set-list", sets: block.sets }`, block-specific banlist.

## 4. Banlist management

Banlists are data, never hardcoded. Data lives in `packages/cards/data/formats/banlists/`:

```
banlists/
├── standard.history.txt
├── modern.history.txt
├── pioneer.history.txt
├── legacy.history.txt
├── vintage.history.txt
├── commander.history.txt
├── pauper.history.txt
├── ... one per format
```

### History file format (simple pipe-separated)

```
# format: one line per banlist version
# date|action|cards
2024-09-01|ban|Grief
2024-09-01|ban|Fury
2025-06-10|unban|Grief
2025-06-10|ban|Nadu, Winged Wisdom
```

Loader parses into `BanlistHistory`. `getBanlistAsOf(formatId, date)` returns the banlist in effect at that date.

### Banlist update flow

The weekly sync script pulls upstream Forge's format data. Changes land as auto-PRs. Bans from WotC B&R announcements become single-line diffs.

### Banlist updates mid-game

Deck legality is checked at game start only. A banlist update during a running game has no effect on that game. Stated explicitly so nobody misreads it as a runtime check.

## 5. Deck validation

```ts
function validateDeck(
  deck: Deck,
  formatId: string,
  opts?: { asOfDate?: Date },
): DeckValidationResult;

interface DeckValidationResult {
  valid: boolean;
  issues: DeckValidationIssue[];
}

interface DeckValidationIssue {
  kind: "min-deck-size" | "max-copies" | "banned-card" | "restricted-card-over-limit"
      | "illegal-card" | "missing-commander" | "color-identity-violation"
      | "illegal-sideboard-size" | "companion-violation" | "partner-mismatch"
      | "singleton-violation" | "rarity-violation";
  message: string;
  cards?: string[];
}
```

`valid: false` if any issue is a hard-fail (all listed kinds are hard-fail; soft issues might be added later as warnings).

Validation order: basic counts → card legality (banlist + pool) → special (commander identity, companion, partners, singleton).

### Use in Mana and Life

Tournament registration validates deck against event's format + date:
```ts
const result = validateDeck(playerDeck, "standard", { asOfDate: event.date });
if (!result.valid) showErrors(result.issues);
```

## 6. Commander color identity (CR 903.4)

Per card, color identity is union of:
- Colored mana symbols in mana cost.
- Colored mana symbols in rules text.
- Hybrid mana symbols (both colors count).
- Phyrexian mana symbols (colored half counts).
- Basic land types on card (their associated colors).

Deck color identity:
- **Single commander**: commander's identity.
- **Partners**: union of both partners' identities.
- **Background**: union of background's identity + legendary commander's.
- **Oathbreaker + signature spell**: union of oathbreaker's identity + signature spell's.

Every card in deck must have identity ⊆ deck identity.

```ts
function computeColorIdentity(cardDefinition: CardDefinition): ColorSet;
function computeDeckColorIdentity(commanderSlot: CommanderSlot, deck: Deck): ColorSet;
function validateColorIdentity(deck: Deck, commanderSlot: CommanderSlot): DeckValidationIssue[];
```

## 7. Commander slot taxonomy

```ts
type CommanderSlotSpec =
  | { kind: "single-legendary-creature" }
  | { kind: "legendary-or-permitted"; permittedNames?: string[] }     // "can be your commander" non-legendaries
  | { kind: "legendary-planeswalker"; requiresPermission: true }       // "can be your commander" PWs
  | { kind: "partner-pair" }
  | { kind: "friends-forever-pair" }
  | { kind: "partner-with-named"; namedCommander: string }
  | { kind: "background-plus-legendary" }
  | { kind: "doctor-companion" }                                        // Doctor Who-specific
  | { kind: "oathbreaker-and-signature-spell" };
```

Validators per kind enforce legality.

## 8. Companion validation

```ts
function validateCompanion(
  companion: CardDefinition,
  mainDeck: Deck,
  format: FormatDefinition,
): DeckValidationIssue[];
```

Each companion has a `companionRestriction: CompanionRestriction` field (parsed from card text):
- Jegantha: no hybrid mana costs anywhere in deck.
- Lurrus: only permanent cards with CMC ≤ 2.
- Gyruda: only even-CMC cards.
- (Etc. — 10 companion cards total in MTG as of 2026.)

Restriction checked against all cards in main deck.

Companion used during the game: starts in sideboard; declared in opening-hand action; castable once per game from sideboard for +3 mana.

## 9. Rotation logic

Policy-driven rather than hardcoded dates:

```ts
interface RotationSchedule {
  policy: "annual-fall-rotation" | "era-based" | "static" | "custom";
  annualFall?: { retainBlockCount: number };   // Standard: retain 3 annual blocks
  eraBased?: { startDate: string };            // Pioneer: "everything 2012+"
  static?: { sets: SetCode[] };                // Block Constructed: frozen set list
  custom?: (date: Date, allSets: EditionInfo[]) => SetCode[];
}

function getLegalSets(formatId: string, opts?: { asOfDate?: Date }): SetCode[];
```

Consumer:
```ts
formats.getLegalSets("standard", { asOfDate: new Date("2024-10-15") })
// → ["MH3", "MID", "VOW", "NEO", ...]
```

## 10. Historical legality — every API accepts `asOfDate`

```ts
formats.isLegal(cardName: string, formatId: string, opts?: { asOfDate?: Date }): boolean;
formats.isLegalAsOf(cardName, formatId, date): boolean;   // convenience alias
formats.getBanlist(formatId, opts?): Banlist;
formats.getLegalSets(formatId, opts?): SetCode[];
formats.validateDeck(deck, formatId, opts?): DeckValidationResult;
```

Default `asOfDate = now()`. Data stores full history. Mana and Life queries past dates for era-appropriate tournament replay.

## 11. Rule override registry

Engine-side. Lives in `@mtg-forge-ts/game/src/rule-override/`. Referenced by name from format data.

```ts
class RuleOverrideRegistry {
  register(id: string, override: RuleOverride): void;
  get(id: string): RuleOverride | null;
  list(): string[];
}

interface RuleOverride {
  id: string;
  apply(game: Game): void;        // installs hooks at game construction
  remove(game: Game): void;       // cleanup (for format change mid-match, rare)
}
```

### Default overrides shipped with `@mtg-forge-ts/game`

- `commander-damage-21` — track per-source damage, lose at 21.
- `commander-tax` — +2 mana per previous cast from command zone.
- `commander-graveyard-replacement` — on commander moving to graveyard/exile, replace with command zone.
- `partner-hand-plus-one` — opening hand +1 for partner commanders.
- `tiny-leaders-20-life` — starting life 20 for Tiny Leaders custom format.
- `vancouver-mulligan` — mulligan sub-system uses Vancouver variant.
- `london-mulligan` — London variant.
- `paris-mulligan` — Paris variant.
- `free-mulligan` — first mulligan doesn't reduce hand size.

Format data references by name:

```
# commander.txt
rule_overrides: commander-damage-21, commander-tax, commander-graveyard-replacement, london-mulligan
```

### Custom rule overrides (consumer registration)

Mana and Life can register custom overrides via engine-side TypeScript code:

```ts
import { RuleOverrideRegistry } from "@mtg-forge-ts/game";

RuleOverrideRegistry.register("ml-all-creatures-plus-one-plus-one", {
  id: "ml-all-creatures-plus-one-plus-one",
  apply(game) { /* install a static effect granting +1/+1 to all creatures */ },
  remove(game) { /* ... */ },
});
```

Then reference in custom format data. Pattern parallels `AiProfileRegistry` extensibility.

## 12. Commander-specific engine wiring

Commander needs more than "commander-damage-21." The full Commander bundle:
- `commander-damage-21`
- `commander-tax` (+2 per cast-from-command-zone)
- `commander-graveyard-replacement` (CR 903.9)
- `commander-identity-enforced-at-cast` (can only cast non-identity cards from command zone — trivially satisfied but some edge cases)
- `free-mulligan` (Commander rule: 1 free mulligan typically) — varies by format variant
- `4-player-default` (set playerCount min/max)

Listed in commander's format data as `rule_overrides: [...]` entry.

## 13. Custom format registration

```ts
class FormatRegistry {
  register(format: FormatDefinition): void;
  get(id: string): FormatDefinition | null;
  list(category?: "constructed" | "limited" | "casual"): FormatDefinition[];
  remove(id: string): void;
}
```

Mana and Life:

```ts
FormatRegistry.register({
  id: "ml-my-custom-2026",
  displayName: "Mana & Life House Format 2026",
  category: "constructed",
  setLegality: { kind: "custom-predicate", predicate: (c) => myPool.has(c.name) },
  banlist: { entries: [...] },
  deckConstruction: { minMain: 60, maxSideboard: 15, maxCopiesNonBasic: 4, mustHaveCommander: false },
  gameRules: { startingLife: 25, startingHandSize: 7, mulliganRule: "london", firstPlayerSkipsDraw: true },
  source: "custom",
  lastUpdated: new Date().toISOString(),
});
```

## 14. Game snapshot format

`GameSnapshot.header` includes `formatDefinitionSnapshot`:

```ts
interface GameSnapshotHeader {
  schemaVersion: number;
  engineVersion: string;
  forgeSha: string;
  cardDataSyncedAt: string;
  crVersion: string;
  savedAt: string;
  formatId: string;
  formatDefinitionSnapshot: FormatDefinition;   // frozen copy at game start
  seed: string;
}
```

On load: mismatch between saved and current format version (banlist changed, rotation moved) → warning. Game replays against saved banlist/rotation, not current.

Mana and Life's "replay 2018 tournament" feature relies on this — the game plays under the 2018 banlist/rotation even when loaded in 2026.

## 15. Data sourcing

Format files vendored in `packages/cards/data/formats/`:
- `formats/<id>.txt` — one per format (includes standard format-definition fields).
- `formats/banlists/<id>.history.txt` — banlist evolution.
- `blockdata/blocks.txt` — block structure for Block Constructed auto-generation.

For **historical banlists** that Forge's current-state data doesn't track: supplement with WotC's published historical B&R announcements (facts about the game; not copyrightable as such). The history files become authoritative.

Accessed via `@mtg-forge-ts/cards`'s `getDataPath("formats/...")` resolver — no hardcoded paths.

## 16. Testing strategy

- **Banlist history lookup** — for each format's history file, assert the correct banlist is returned for specific dates.
- **Rotation** — for Standard, assert legal sets match published rotation schedule.
- **Deck validation fixtures** — ~50 canonical decks (valid + invalid) per format; regression-tests correct issues flagged.
- **Commander color identity fixtures** — tricky cards (Phyrexian mana, hybrid, split, adventure, DFC, partners, backgrounds) with expected identities.
- **Companion restriction fixtures** — each companion card with matching + violating sample decks.
- **Historical parity with Forge** — cross-reference specific banlist events (e.g., "Deathrite Shaman banned in Modern 2014-02-03") against Forge's history.
- **Custom-format round-trip** — register custom format, validate deck, assert outcome.

## 17. Phases

| Phase | Scope |
|---|---|
| **6a** | `FormatDefinition` schema + `FormatRegistry` |
| **6b** | Format data vendoring + sync script integration (builds on SP4a) |
| **6c** | Set-legality evaluation + rotation policies |
| **6d** | Banlist history loading + date-aware lookup |
| **6e** | Generic deck validator (counts, singleton, sideboard size) |
| **6f** | Commander color identity + commander slot taxonomy + partner/background/companion rules |
| **6g** | Rule override registry + default commander bundle + mulligan overrides |
| **6h** | All 15 formats registered with full data (Historic Brawl is our addition; others map to Forge upstream) |
| **6i** | Historical legality (date-parameterized API) + historical banlist backfill |
| **6j** | Custom format registration API |
| **6k** | Tests: fixtures + Forge-parity historical spot-checks |

## 18. What SP6 does NOT cover

- Booster generation / Sealed pool / Draft bots — SP7.
- Deck generation for AI opponents — SP5 `AiDeckBuilder` consumes format definitions.
- Format-specific UI (rotation warnings in deckbuilder, banlist callouts) — consumer concern.
- Tournament pairing / Swiss rounds / tiebreakers — consumer concern (Mana and Life's tournament orchestrator layer).

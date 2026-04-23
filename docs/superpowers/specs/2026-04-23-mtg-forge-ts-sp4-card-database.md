# SP4 — Card Database

**Status:** Design approved
**Date:** 2026-04-23
**Package:** `@mtg-forge-ts/cards`
**Prerequisites:** SP3a (DSL parser) for loader; SP4a (vendoring script) unblocks SP0 and SP3

---

## Purpose

Vendor Forge's card data (~87 MB), ship the loader + cache + indexes + validator + Scryfall URL helpers + historical-date helpers. After SP4, any consumer can query the card database with any of: name, set, collector number, color identity, type, keyword, release date. A pre-parsed cache can be dumped, stored in external DBs, re-loaded without re-parsing.

## 1. Package responsibility

`@mtg-forge-ts/cards` owns:

- **Vendored data** in `data/`: cardsfolder (32,303 card scripts), editions (~700 files, set metadata), blockdata (block structure), format data, tokens, predefined emblems, `SYNCED.json` (upstream SHA + date + CR version).
- **Loader** (`src/loader/`) — file walking, progress, concurrency.
- **Parser integration** — consumes `@mtg-forge-ts/cards`'s own structural validator (from SP3).
- **Indexes** (`src/indexes/`) — by name, by set, by color identity, by type, by subtype, by keyword, full-text.
- **Cache** (`src/cache/`) — msgpack export/import, streaming per-card, header versioning.
- **TokenDb + EmblemDb** (`src/tokens/`, `src/emblems/`) — predefined templates.
- **Edition / block data loading** (`src/editions/`).
- **Scryfall URL builders** (`src/scryfall/`) — ported from Forge's `ImageUtil`.
- **Historical helpers** (`src/historical/`) — `getCardsAsOf`, `getSetsReleasedBetween`.
- **Data-path resolver** — other packages query paths via `cards.getDataPath(relativePath)`.

Depends on `@mtg-forge-ts/core` for AST types. Does NOT depend on `@mtg-forge-ts/game` — no runtime, just data.

## 2. Directory layout of vendored data

```
packages/cards/data/
├── cardsfolder/              ~32,303 files, ~81 MB
│   ├── a/ ... z/             one letter dir per card-name first letter
│   └── tokens/               predefined token scripts (if Forge stores them here)
├── editions/                 ~700 files, ~5 MB
│   └── <SETCODE>.txt         per-set: release date, card list, booster rules
├── blockdata/                ~1 MB
│   ├── blocks.txt            block structure (for Block Constructed)
│   ├── boosters-special.txt  chaos draft themes
│   ├── chaosdraftthemes.txt
│   ├── fantasyblocks.txt     commander precons etc.
│   ├── printsheets.txt       booster composition rules
│   └── starters.txt          starter deck definitions
├── formats/                  format definitions + banlists
│   ├── <formatId>.txt
│   └── banlists/
│       └── <formatId>.history.txt
├── ai-profiles/              default AI profiles (Easy/Medium/Hard)
├── NOTICE.md                 attribution to Card-Forge
└── SYNCED.json               { forgeSha, forgeTag, syncedAt, crVersion }
```

Layout mirrors Forge's `forge-gui/res/` where possible for 1:1 sync. Layout variations discovered during first sync are documented here post-sync.

### Not vendored

- `quest/` — Quest mode data (GUI-specific; engine doesn't need).
- `adventure/` — Adventure mode data (GUI-specific).
- Art, sounds, fonts, translations.

## 3. Paper card, card definition, live card — locked terminology

Per C-5 in master spec:

- **`PaperCard`** — a specific printing. `(name, set, collectorNumber, language, foil, borderless, artSeries, scryfallId?)`. Data type. Used for deckbuilding.
- **`CardDefinition`** — parsed rules. One per card name (or per face for multi-face). Shared across printings. Used by engine for rules processing.
- **`Card`** — live in-game instance (defined in `@mtg-forge-ts/game`). Has zone, owner, controller, counters, damage. Not in `@mtg-forge-ts/cards`.

Relationships: `PaperCard.definition → CardDefinition`. `Card.paperCard → PaperCard`.

## 4. Loader entry points

### Lazy per-card (default)

```ts
const db = CardDb.create({ dataPath: "./data" });
const bolt = db.getDefinition("Lightning Bolt");   // parses on demand, caches
```

First access parses; subsequent calls hit memory cache. Fastest startup for deckbuilders that only touch a subset.

### Eager bulk with progress

```ts
await db.parseAll({
  onProgress: (done, total) => showLoadingBar(done, total),
  concurrency: Math.max(4, os.cpus().length - 1),
});
```

Walks cardsfolder with worker pool. Used by simulator "Loading card database..." screen.

### From pre-parsed cache

```ts
const cacheBytes = await fs.readFile("./cards.msgpack.gz");
await db.importCache(cacheBytes);   // ~10ms for 32k cards
```

No parsing at runtime.

### Filename convention

Card filenames map to canonical card names via Forge's slug function (lowercase, spaces/punctuation → underscores, special handling for "//", apostrophes, etc.). Port is **byte-for-byte** from Forge's slug utility to guarantee round-trip.

`db.getDefinition(name)` normalizes the name to the slug form to look up the file.
`db.getDefinitionByFilename(filename)` for callers that already have a filename.

## 5. Cache API (addresses 4.2 user feedback)

```ts
class CardDb {
  // Full dump (msgpack + gzip) — one-shot export.
  exportCache(): Promise<Uint8Array>;

  // Streaming per-card export — for per-row DB storage (Conflux → ArangoDB).
  streamExportCache(): AsyncIterable<{ name: string; bytes: Uint8Array }>;

  // Bulk import.
  importCache(data: Uint8Array): Promise<void>;

  // Single-card import (for per-row DB lazy loading pattern).
  importCardBytes(name: string, bytes: Uint8Array): Promise<CardDefinition>;

  // SHA validation helper.
  getVendoredForgeSha(): string;
}
```

### Cache format header

```json
{
  "cacheFormatVersion": 1,
  "forgeSha": "abc123...",
  "forgeTag": "2026-q2",
  "crVersion": "2026-03-17",
  "parsedAt": "2026-04-23T14:00:00Z",
  "cardCount": 32303
}
```

On import with `cacheFormatVersion` mismatch → throws `IncompatibleCacheFormatError` with descriptive message. Consumer must re-export.

Cache format version is **public contract**: bumping is a major semver change on `@mtg-forge-ts/cards`.

### Conflux usage pattern

```ts
// Daily cron:
const db = CardDb.create({ dataPath: "./data" });
await db.parseAll();
for await (const { name, bytes } of db.streamExportCache()) {
  await arangoDb.upsertCard(name, bytes);
}

// Per-request (deckbuilder):
const bytes = await arangoDb.fetchCard(name);
if (bytes) {
  return await db.importCardBytes(name, bytes);
}
```

### Mana and Life usage pattern

```ts
// Build step:
const db = CardDb.create({ dataPath: "./data" });
await db.parseAll();
const cacheBytes = await db.exportCache();
await fs.writeFile("cards.msgpack.gz", cacheBytes);

// App start:
const db = CardDb.create({ dataPath: "./data" });
await db.importCache(await fs.readFile("cards.msgpack.gz"));
```

## 6. Indexes

Built lazily (per-card loading) or eagerly (`parseAll` / `importCache` completion). Stored in memory:

```ts
class CardIndexes {
  byName: Map<string, CardDefinition>;
  bySet: Map<SetCode, PaperCard[]>;
  byPaperCardKey: Map<PaperCardKey, PaperCard>;
  byType: Map<CardType, Set<string>>;
  bySubtype: Map<string, Set<string>>;
  byColorIdentity: Map<ColorSetKey, Set<string>>;
  byKeyword: Map<string, Set<string>>;
  fullText: FullTextIndex;           // tokenized name + type line + oracle
  byScryfallId: Map<string, PaperCard>;
}
```

Total memory: several MB for 32k cards. Consumer can opt out via `CardDb.create({ indexes: "lazy" | "eager" | "none" })`.

For external storage (Conflux's ArangoDB), indexes can also be exported as separate msgpack files so the deckbuilder never holds the full in-memory index.

## 7. Paper card resolution

```ts
class CardDb {
  getPaperCards(name: string): PaperCard[];                           // all printings
  getPaperCard(key: PaperCardKey): PaperCard | null;                  // specific printing
  getDefaultPrinting(name: string, pool?: Format): PaperCard | null;  // most recent legal
  getPaperCardByScryfallId(id: string): PaperCard | null;             // Scryfall bridge
}
```

`getDefaultPrinting` uses: (1) the latest non-promo printing from a set in the given format, falling back to (2) the latest printing period, falling back to (3) `null`.

## 8. Token + emblem DB

### TokenDb

Predefined tokens indexed by canonical name ("Soldier 1/1 W", "Treasure", "Food", "Blood", "Clue", "Powerstone", "Role [rolename]"):

```ts
class TokenDb {
  getTemplate(canonicalName: string): TokenTemplate | null;
  listTemplates(): TokenTemplate[];
}
```

`TokenTemplate` is a `CardDefinition` variant with zero-cost + always-token flag.

### EmblemDb

Predefined emblems for planeswalker ultimates. Similar shape. Emblems have abilities but no characteristics.

## 9. Edition + block data

### Editions

Each set has a `.txt` file with:
- Set code, canonical name, release date.
- Block membership.
- Card list with collector number, rarity, foil variants.
- Booster composition rules (for Section 8 Limited).
- Print run bounds.
- Set-specific flags (Un-set, Conspiracy-draft, Silver-bordered, digital-only).

Loaded eagerly on `CardDb` creation. Exposed:

```ts
class EditionDb {
  getEdition(setCode: string): EditionInfo | null;
  listAllSets(): EditionInfo[];
  getSetsReleasedBetween(start: Date, end: Date): EditionInfo[];
  getSetsInBlock(blockId: string): EditionInfo[];
}
```

### Blocks

`blockdata/blocks.txt` defines block structure. Used by Block Constructed formats.

```ts
class BlockDb {
  getBlock(id: string): BlockInfo | null;
  listAllBlocks(): BlockInfo[];
}
```

## 10. Structural validator

Runs against all vendored files. Two modes:

### Strict (CI sync-gate)

- Every file parses without error.
- Required params present per handler-key's schema.
- SVar and SubAbility references resolve within each card.
- Type-compatible param values.

Reports errors with source location.

### Lenient (runtime)

Same checks but treats failures as warnings. Failed cards are marked `canInstantiate: false`. Deckbuilders can still list these cards (greyed out); they throw at game-start if included.

## 11. Scryfall URL helpers

Ported from Forge's `ImageUtil`. Pure functions — no network IO.

```ts
function scryfallImageUrl(paperCard: PaperCard, opts?: {
  face?: "front" | "back";
  crop?: "normal" | "small" | "large" | "art_crop" | "png";
  lang?: string;
}): string;
```

## 12. Historical helpers (for Mana and Life)

```ts
class CardDb {
  // Cards as they existed on a specific date (by release).
  getCardsAsOf(date: Date): CardDefinition[];

  // Printings released by date.
  getPaperCardsAsOf(date: Date): PaperCard[];

  // Sets in a date range.
  getSetsReleasedBetween(start: Date, end: Date): EditionInfo[];
}
```

Format legality (`isLegalAsOf`) lives in `@mtg-forge-ts/formats`, not here (formats depends on cards; we don't want a reverse dependency).

## 13. Data path resolver (for cross-package data access)

Other packages need to load format data / AI profile data from `packages/cards/data/`. They access via:

```ts
// In @mtg-forge-ts/cards:
export function getDataPath(relative: string): string {
  return path.join(CARDS_DATA_ROOT, relative);
}

// In @mtg-forge-ts/formats:
import { getDataPath } from "@mtg-forge-ts/cards";
const formatFile = await fs.readFile(getDataPath("formats/standard.txt"), "utf8");
```

If the cards data layout changes, cards' manifest changes; downstream packages update accordingly.

## 14. Unknown-card API contract

Per A-10:

- `db.getDefinition(name)` → `CardDefinition | null`.
- `db.getDefinitionOrThrow(name)` → `CardDefinition`, throws `UnknownCardError(name)`.
- `game.loadDeck(deck)` → throws `DeckContainsUnknownCardError(names)` with the full list of missing cards, before any game setup.
- `db.canInstantiate(name)` → `boolean`, false for cards flagged unimplementable by the runtime validator.

## 15. Engine + CardDb compatibility

`game.attachCardDb(db)` validates:

```ts
if (!isCompatible(db.getVendoredForgeSha(), this.engineMinForgeSha)) {
  throw new IncompatibleCardDataError(
    `Engine expects Forge SHA compatible with ${this.engineMinForgeSha}, got ${db.getVendoredForgeSha()}`);
}
```

Compat range defined in engine's package.json as `forgeShaCompatRange`.

## 16. Language / localization

- Forge's vendored data is primarily English.
- `CardDefinition.name` is the English canonical name.
- Rules engine operates on English rules text.
- Localized display names + flavor text are a consumer concern (consumer queries Scryfall).
- No engine-side localization. `CardDefinition` exposes the English oracle text; consumer renders however.

## 17. Testing strategy

- **Parse-every-file smoke test** — `parseAll` over full data, zero errors. Runs every CI build.
- **Cache round-trip** — `export → import → equal` for every card. Runs weekly.
- **Index consistency** — every card in `byName` is reachable from `bySet[card.set]`, etc. Every CI build.
- **~100 flagship cards** — explicitly parsed and asserted (name, rules text, types, costs) — regression guard against parser changes.
- **Edition coverage** — every set in `editions/` references cards that exist in `cardsfolder/`; no dangling references.
- **Scryfall URL fixture tests** — construct URLs for a set of known PaperCards; compare to hand-verified expected URLs.
- **Historical fixture tests** — `getCardsAsOf(1996-10-14)` returns a known-size result; spot-check key cards present/absent.

## 18. Phases

| Phase | Scope |
|---|---|
| **4a** | Vendoring + sync script (`tools/sync-upstream-forge/`); initial full copy of cardsfolder/editions/blockdata/formats; NOTICE + SYNCED.json generation |
| **4b** | Loader: file walker, filename-slug normalizer, per-card lazy load |
| **4c** | `parseAll` with progress + concurrency |
| **4d** | Editions DB + blocks DB loaders |
| **4e** | Cache: msgpack export/import + stream export + header versioning |
| **4f** | Indexes: byName, bySet, byType, bySubtype, byColorIdentity, byKeyword |
| **4g** | Full-text index |
| **4h** | TokenDb + EmblemDb |
| **4i** | Scryfall URL helpers |
| **4j** | Historical helpers (`getCardsAsOf`, `getSetsReleasedBetween`) |
| **4k** | Structural validator (lenient mode) |
| **4l** | Data-path resolver for cross-package access |
| **4m** | `setlookup/` and other sub-directories (verified during 4a; vendor + load) |
| **4n** | Tests: flagship fixtures, parse-every-file, cache round-trip, index consistency |

## 19. What SP4 does NOT cover

- DSL parser itself — SP3.
- Semantic validator (in `tools/dsl-validator/`) — SP8.
- Format legality — SP6.
- Booster generation — SP7.
- AI card evaluation — SP5.

# mtg-forge-ts-bot-harness

Reference **bot/AI consumer** for the [@mtg-forge-ts](../../README.md) packages.
Lives under `examples/`, marked `private: true`, **not published to npm**.

This is the deepest of the three reference examples: it actually drives the
engine's suspendable game-loop generator end-to-end with two AI controllers,
one per seat, until either the game reaches a terminal state or a configurable
turn cap fires.

| Example                 | What it shows                                               |
| ----------------------- | ----------------------------------------------------------- |
| `examples/cli`          | Parsing card .txt + validating decks + constructing a Game  |
| `examples/browser-worker` | Hosting the engine in a Web Worker for browser UIs        |
| **`examples/bot-harness`** | **Driving an actual AI vs AI game through `runGame`/`PhaseHandler.run()`** |

## What it does

1. Builds two 60-card stub libraries (every entry uses the same name —
   `Grizzly Bears` by default — so logs are readable).
2. Wires two `RandomLegalController` instances (one per seat), each with its
   own `SeededRng` branch so per-seat decision streams are independent.
3. Runs `setupGame()` to opening hands.
4. Pushes N turns onto `PhaseHandler.turnQueue` (default 5).
5. Drives `PhaseHandler.run()` to completion or step cap, dispatching every
   yielded `decision` to its seat's controller and recording every yielded
   `event`.
6. Prints an event log keyed by `turn` / `phase` / `cardName` plus a final
   summary (winner if any, turns started, total events, generator steps).

## Build & run

From the repo root:

```bash
pnpm install

# Run via tsx (no build step):
pnpm --filter mtg-forge-ts-bot-harness dev

# Run with options:
pnpm --filter mtg-forge-ts-bot-harness dev -- --turns=10 --deck-size=60

# Or build the harness and run the compiled JS:
pnpm --filter mtg-forge-ts-bot-harness build
node examples/bot-harness/dist/index.js --turns=10
```

## CLI options

| Flag                | Meaning                                                | Default      |
| ------------------- | ------------------------------------------------------ | ------------ |
| `--seed=<hex>`      | `SeededRng` root seed (BigInt-parseable hex)           | `0xb071234`  |
| `--turns=<N>`       | Turns enqueued onto the phase-handler queue            | `5`          |
| `--deck-size=<N>`   | Stub-card library size per seat (must be ≥ 7)          | `60`         |
| `-h`, `--help`      | Print usage                                            | —            |

## Sample output (truncated)

```
mtg-forge-ts-bot-harness — engine 0.0.0
seed=b071234 turnCap=2 deckSize=60
Players: Alice (seat 0, ai) vs Bob (seat 1, ai) — RandomLegalController

Event log (79/113 interesting events):
  T1 Untap CardDrawn card=Grizzly Bears
  ... (7 setup-draws per seat snipped)
  T1 Untap MulliganTaken card=—
  T1 Untap MulliganTaken card=—
  T1 Untap GameStarted card=—
  T1 Untap TurnStarted card=—
  T1 Draw CardDrawn card=Grizzly Bears
  ... (full phase walk per turn)
  T1 Cleanup CardDiscarded card=Grizzly Bears
  T1 Cleanup TurnEnded card=—
  T2 Cleanup TurnStarted card=—
  ...
  T2 Cleanup TurnEnded card=—

Final summary:
  total events:      79
  turns started:     2
  generator steps:   113
  terminal:          false
  winner:            none — turn cap reached without terminal state
```

`terminal: false` is expected with stub cards: `RandomLegalController` always
passes priority and stub-card libraries can't run a player to 0 life or
deck-out within a few turns, so the game won't end "naturally" — the harness
exits when the turn cap is reached. The success criterion is that the engine
produced events, threaded the priority loop, walked every phase step, and
didn't throw.

## Limitations / TODOs

- **Stub PaperCards only.** Each library entry is a `PaperCard` with just
  `name` + `edition` set; no `CardDefinition`, no abilities, no costs. SP4's
  `CardDb` integration replaces this with real card data. Until then, the
  harness exercises the *engine*, not the *card script catalogue*.
- **AI passes priority.** `RandomLegalController.pickPriorityAction` prefers
  `pass` whenever `pass` is in the legal-actions set. Combined with
  ability-less stub cards, this means no spells get cast and combat is empty.
  Wiring real cards will surface attack/block/cast decisions.
- **No deck-loader integration.** The cards package's deck-validation
  surface is exercised by `examples/cli`; this harness builds libraries
  directly from `Card` constructors. A future revision could read a
  `DeckEntry[]` JSON and resolve names against a card-db.
- **One match, no rematch.** Match scheduling (`run-match.ts`) isn't
  exercised — we run a single game.

## Layout

```
examples/bot-harness/
├── package.json       # private workspace package, depends on @mtg-forge-ts/* via workspace:*
├── tsconfig.json      # extends ../../tsconfig.base.json
├── src/index.ts       # entry point — buildGame → seedDecks → runHarness → printReport
└── README.md          # this file
```

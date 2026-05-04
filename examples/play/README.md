# mtg-forge-ts-play — interactive Human vs AI CLI

A runnable consumer of `@mtg-forge-ts/{core,cards,game}` that lets you actually
**play** a small Magic game against the engine's `RandomLegalController` from a
terminal. Proves the engine end-to-end: cast pipeline, priority loop, combat,
state-based actions, terminal-state detection — all driven by you typing into
stdin.

## Run

```bash
pnpm --filter mtg-forge-ts-play build
node examples/play/dist/index.js
```

Or in dev mode without a build step:

```bash
pnpm --filter mtg-forge-ts-play dev
```

## Decks

Each player starts with a 15-card deck:

- 8 basic lands (Mountains for you, Forests for the AI)
- 4 Lightning Bolt
- 3 Grizzly Bears

The AI plays a random-legal strategy (it tends to pass — `RandomLegalController`
favours pass-priority over action). You will reliably out-tempo it.

## Commands at the priority prompt

| Input               | Effect                                                  |
| ------------------- | ------------------------------------------------------- |
| (empty / `pass`)    | Pass priority — let the next phase / AI act             |
| `play <H#>`         | Play a land from your hand (e.g. `play H2`)             |
| `cast <H#>`         | Cast a spell from your hand (e.g. `cast H1`)            |
| `tap <Y#>`          | Tap a land for mana (e.g. `tap Y1`)                     |
| `attack`            | Declare ALL untapped creatures you control as attackers |
| `attack <Y#> <Y#>`  | Declare a specific subset of creatures as attackers     |
| `concede`           | Lose immediately                                        |
| `quit`              | Exit the program (no game logged)                       |

For target / mode / X choices the prompt switches into a numbered list — type
the index and hit enter.

## Indices on the board

- `[Y#]` — your battlefield, 1-based
- `[O#]` — opponent's battlefield
- `[H#]` — your hand

## Limitations

- Very small card pool (Mountain, Forest, Lightning Bolt, Grizzly Bears) — this
  is a smoke-test harness, not a Cube draft.
- The AI never casts spells (it picks pass at every priority window). This is a
  property of `RandomLegalController` — it's a coverage tool, not a brain.
- No mulligan UI: you keep your opening hand. (You can still concede on turn 1.)
- No undo. Decisions are final once enter is pressed.
- **Engine SP1 priority gap.** The current engine's `PhaseHandler.runStep`
  emits an SP1-minimal priority window (`{pass, concede}` only) — it does not
  yet route through the full `runPriorityWindow` orchestrator (Milestone S).
  This driver bridges the gap by querying `enumerateLegalActions` itself and
  driving `game.action.playLand` / `game.castPipeline.run` /
  `resolveStackItem` directly when the user picks `play <H#>` or
  `cast <H#>`, before returning `pass` to the engine. That's why the AI never
  acts on its own turn — the SP1 priority window asks `RandomLegalController`
  only for `pass` or `concede`, and random-legal favours pass.

## What it proves

If `pnpm --filter mtg-forge-ts-play dev` lets you cast Lightning Bolt at the AI
and the AI's life total drops by 3, the engine's cast pipeline, mana-payment
flow, target system, stack resolution, event log, and SBA loop are all wired
correctly end-to-end against a real PaperCard with a real `CardDefinition`.

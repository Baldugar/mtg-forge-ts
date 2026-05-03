# mtg-forge-ts-bench

Performance benchmark suite for the `@mtg-forge-ts` engine. Measures
end-to-end cast → resolve → teardown latency on representative scenarios
and reports throughput + latency percentiles.

The point is not to look fast; it's to lock a baseline so future
regressions show up as deltas in CI.

## Running

From the repo root:

```sh
pnpm bench
```

or directly:

```sh
pnpm --filter mtg-forge-ts-bench dev
```

CLI flags:

- `--iterations=<N>` — number of measured iterations (default 1000)
- `--warmup=<N>` — discarded warmup iterations (default 50)

## Scenario

Each iteration:

1. Builds a fresh `Game` with two seats.
2. Mints a Lightning Bolt in seat 0's hand and funds `{R}` in seat 0's pool.
3. Drives the cast pipeline targeting seat 1's face.
4. Calls `resolveStackItem` on the top of the stack — this fans out to
   `DealDamage` → `LifeChanged` → SBA pass → `CardChangedZone` (Bolt to
   graveyard).
5. Drops references; lets the next iteration's allocation pressure trigger GC.

Lightning Bolt was chosen because it touches the parts of the engine
most representative of a "spell"-shaped tick — cost payment, stack push,
an effect with a target, an SBA pass, and a graveyard zone-move — without
pulling in static-effect layers or replacement effects.

## Sample output format

```
mtg-forge-ts-bench — Lightning Bolt cast/resolve baseline
engine version: 0.0.0
Node:           v20.x.y
V8:             11.x.y
Platform:       win32 x64
Iterations:     1000 (warmup 50)

Scenario: Lightning Bolt at face
  - build Game (2 seats, fresh zones)
  - mint Lightning Bolt in hand, {R} in pool
  - drive cast pipeline, target seat 1
  - resolveStackItem (DealDamage → LifeChanged → graveyard move)
  - drop references for GC

Results:
  total wall time:    XXX ms
  ops / sec:          XXX
  mean latency:       XXX µs
  p50 latency:        XXX µs
  p95 latency:        XXX µs
  p99 latency:        XXX µs
  min latency:        XXX µs
  max latency:        XXX µs
```

See [BASELINE.md](./BASELINE.md) for the captured reference numbers.

## Anti-goals

- **No Java cross-comparison.** That would require the bridge running and
  is out of scope for the benchmark MVP. This suite establishes the TS
  side baseline only.
- **No per-effect microbenchmarks.** This is a macro-tick benchmark: it
  measures the amortised cost of one full spell, not internals.
- **No multi-turn games.** That's `examples/bot-harness`'s job. This
  package is single-tick, single-spell, on purpose.

## Adding scenarios

If you add a second scenario (creature ETB, planeswalker activation,
combat damage tick, etc.), follow the existing `runOneIteration` pattern:
build a one-shot harness, drive the relevant generator, drop references,
record nanoseconds via `performance.now() * 1e6`. Re-capture
`BASELINE.md` after every meaningful engine change.

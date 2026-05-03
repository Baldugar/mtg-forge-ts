# mtg-forge-ts-bench — baseline reference

This is the reference output captured for the SP1 engine at the time
the benchmark suite landed. Use it as a regression detector: a meaningful
slowdown vs. these numbers (rerun on the same hardware) means a recent
change introduced an engine-level perf regression worth investigating.

The numbers below are wall-clock and therefore hardware/OS-dependent.
What matters is the *relative* delta when the same machine reruns the
bench after engine changes — not the absolute µs figure.

## Capture metadata

- **Branch:** `sp1-engine-foundations`
- **Engine version:** `0.0.0`
- **Scenario:** Lightning Bolt at face (build Game → cast → resolve → teardown)
- **Iterations:** 1000 measured, 50 warmup discarded
- **Node:** v22.19.0
- **V8:** 12.4.254.21-node.29
- **Platform:** win32 x64

## Reference numbers

```
mtg-forge-ts-bench — Lightning Bolt cast/resolve baseline
engine version: 0.0.0
Node:           v22.19.0
V8:             12.4.254.21-node.29
Platform:       win32 x64
Iterations:     1000 (warmup 50)

Scenario: Lightning Bolt at face
  - build Game (2 seats, fresh zones)
  - mint Lightning Bolt in hand, {R} in pool
  - drive cast pipeline, target seat 1
  - resolveStackItem (DealDamage → LifeChanged → graveyard move)
  - drop references for GC

Results:
  total wall time:    48.474 ms
  ops / sec:          20629.7
  mean latency:       48.47 µs
  p50 latency:        42.00 µs
  p95 latency:        72.40 µs
  p99 latency:        158.20 µs
  min latency:        28.30 µs
  max latency:        1.046 ms
```

## How to interpret

- **ops/sec ~20k** → at this hardware, the engine sustains ~20k full
  cast-and-resolve ticks per second on a representative spell. Any drop
  below ~14k on the same machine is "look at this in a profiler"
  territory; below ~7k means a regression has landed.
- **p50 vs p99** → the ~4× spread (42 µs → 158 µs) is dominated by GC
  major collections that fire every few hundred iterations as the per-
  iteration `Game` allocations pile up. If p99 starts climbing without
  p50 moving, suspect added retained state in `Game` (event listeners,
  registries, caches).
- **max latency** at ~1.4 ms is a single outlier — usually the very first
  measured iteration after warmup or a major-GC sweep. Not load-bearing.

## Re-capturing

```sh
pnpm bench
```

After substantial engine changes (waves that touch the cast pipeline,
stack, or resolve flow), rerun on the same hardware and replace the
numbers above.

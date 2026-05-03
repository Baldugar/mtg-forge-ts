# mtg-forge-ts-browser-worker

Reference browser+Web Worker consumer for the [@mtg-forge-ts](../../README.md)
packages. This example lives under `examples/`, is marked `private: true`,
and is **not published to npm**. Copy the directory wholesale into your own
repo and adapt it as a starting template for browser apps that drive the
engine off the main thread.

It demonstrates that `@mtg-forge-ts/{core,cards,game}` ship browser-friendly
ESM bundles and can be loaded into a `Worker({ type: "module" })`:

| File              | Role                                                                              |
| ----------------- | --------------------------------------------------------------------------------- |
| `index.html`      | Tiny UI: a textarea, a button, a result panel.                                    |
| `src/main.ts`     | Main thread: spawns the worker, postMessages a card script, renders the reply.    |
| `src/worker.ts`   | Web Worker: imports `@mtg-forge-ts/cards`, runs `parseCard`, posts the summary.   |
| `src/protocol.ts` | Tiny shared message protocol between main thread and worker.                      |
| `vite.config.ts`  | Vite config that emits the worker as an ES-module chunk into `dist/assets`.       |

## Build & run

From the repo root:

```bash
# Build the workspace packages first so the worker's imports resolve
# against compiled dist/ output.
pnpm -r run build

# Dev server with HMR (open http://localhost:5173):
pnpm --filter mtg-forge-ts-browser-worker dev

# Production build — emits dist/index.html plus a separate worker chunk
# under dist/assets/. No browser is required for the build itself.
pnpm --filter mtg-forge-ts-browser-worker build

# Optional: serve the built artifact for a sanity check.
pnpm --filter mtg-forge-ts-browser-worker preview
```

## Sample card

The textarea is pre-filled with Lightning Bolt:

```
Name:Lightning Bolt
ManaCost:R
Types:Instant
A:SP$ DealDamage | Cost$ R | NumDmg$ 3 | ValidTgts$ Any | SpellDescription$ CARDNAME deals 3 damage to any target.
Oracle:Lightning Bolt deals 3 damage to any target.
```

Try Grizzly Bears too:

```
Name:Grizzly Bears
ManaCost:1 G
Types:Creature Bear
PT:2/2
Oracle:
```

Click **Parse in worker** and the result panel renders the JSON summary the
worker sends back (name, type line, mana cost, P/T, ability counts, oracle).

## How it works

The main thread spawns the worker via the standard Vite pattern:

```ts
new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
```

Vite (and Rollup) detect this exact form at build time and emit a separate
worker chunk under `dist/assets`, with `@mtg-forge-ts/cards` and its
transitive dependencies bundled into it. The main thread chunk gets a
matching reference so the `new Worker(...)` call resolves at runtime.

Messages between the threads are typed via `src/protocol.ts`:

- Main thread sends `{ type: "parse", id, source, file }`.
- Worker replies with `{ type: "parse:ok", id, summary }` or
  `{ type: "parse:err", id, message }`.

Only a structural summary is posted across the boundary — the full
`CardDefinition` AST stays in the worker, which is the realistic shape for
a UI that only needs display data.

## Layout

```
examples/browser-worker/
├── package.json       # private workspace package, depends on @mtg-forge-ts/* via workspace:*
├── tsconfig.json      # extends ../../tsconfig.base.json
├── vite.config.ts     # Vite config with module-worker output
├── index.html         # textarea + button + result UI
├── src/
│   ├── main.ts        # main thread entry
│   ├── worker.ts      # Web Worker entry
│   └── protocol.ts    # shared message types
└── README.md          # this file
```

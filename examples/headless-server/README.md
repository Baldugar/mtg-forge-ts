# mtg-forge-ts-headless-server

Reference **HTTP server consumer** for the [@mtg-forge-ts](../../README.md)
packages. Lives under `examples/`, marked `private: true`, **not published to
npm**.

This example demonstrates running the engine as a **stateless backend service**.
Each request constructs its own fresh `Game` — there is no state shared
between requests, so the same process can safely handle concurrent clients
without leaking play history.

| Example                       | What it shows                                                 |
| ----------------------------- | ------------------------------------------------------------- |
| `examples/cli`                | One-shot CLI: parse card, validate deck, build Game           |
| `examples/browser-worker`     | Hosting the engine inside a Web Worker for browser UIs        |
| `examples/bot-harness`        | Driving an AI vs AI game through `runGame` / `PhaseHandler.run()` |
| **`examples/headless-server`**| **Exposing the engine as a JSON HTTP service**                |

## Why no framework?

The server uses only the built-in `node:http` module — no Express, Fastify, or
similar runtime dependency. This keeps the example minimal and makes it
trivial to copy & adapt the routing logic into whatever framework downstream
consumers already use.

## Endpoints

| Method | Path             | Body                                          | Returns                                  |
| ------ | ---------------- | --------------------------------------------- | ---------------------------------------- |
| GET    | `/health`        | —                                             | `{ ok: true, version: "<engine ver>" }`  |
| POST   | `/parse-card`    | `{ script: string }`                          | parsed `CardDefinition` AST              |
| POST   | `/validate-deck` | `{ deck: DeckEntry[], format: FormatId }`     | `DeckValidationResult`                   |
| POST   | `/run-game`      | `{ seed: number\|string, turns: number }`     | `{ events: GameEvent[], summary: ... }`  |

`FormatId` is one of `standard | modern | legacy | vintage | pioneer | pauper | commander`.

## Build & run

From the repo root:

```bash
pnpm install

# Run via tsx (no build step):
pnpm --filter mtg-forge-ts-headless-server dev

# Override the port (default 3000):
PORT=8080 pnpm --filter mtg-forge-ts-headless-server dev

# Or build & run the compiled JS:
pnpm --filter mtg-forge-ts-headless-server build
node examples/headless-server/dist/index.js
```

## curl examples

```bash
# Health check.
curl -s http://127.0.0.1:3000/health
# {"ok":true,"version":"0.0.0"}

# Parse a card script. (Replace the body with the contents of any Forge .txt file.)
curl -s -X POST http://127.0.0.1:3000/parse-card \
  -H 'content-type: application/json' \
  -d '{"script":"Name:Lightning Bolt\nManaCost:R\nTypes:Instant\nA:SP$ DealDamage | Cost$ R | NumDmg$ 3 | ValidTgts$ Any | TgtPrompt$ Select target | SpellDescription$ CARDNAME deals 3 damage to any target.\nOracle:Lightning Bolt deals 3 damage to any target."}'

# Validate a deck.
curl -s -X POST http://127.0.0.1:3000/validate-deck \
  -H 'content-type: application/json' \
  -d '{"deck":[{"name":"Lightning Bolt","count":4},{"name":"Mountain","count":56}],"format":"modern"}'

# Run an AI vs AI game (5 turns, deterministic seed).
curl -s -X POST http://127.0.0.1:3000/run-game \
  -H 'content-type: application/json' \
  -d '{"seed":42,"turns":5}' | head -c 400
```

## Configuration

| Env var | Default | Meaning                                                |
| ------- | ------- | ------------------------------------------------------ |
| `PORT`  | `3000`  | TCP port to bind. Must be an integer in `[0, 65535]`.  |

Built-in safety caps (constants in `src/index.ts`):

| Constant         | Value     | Purpose                                                            |
| ---------------- | --------- | ------------------------------------------------------------------ |
| `MAX_BODY_BYTES` | `1 MiB`   | Rejects oversize request bodies before they buffer.                |
| `MAX_RUN_TURNS`  | `50`      | Caps the `turns` value accepted by `/run-game`.                    |
| `MAX_RUN_STEPS`  | `100_000` | Hard generator-step cap per `/run-game` call (prevents runaways).  |

## Statelessness contract

Every request constructs a brand-new `Game` from the request payload alone.
The handler functions in `src/index.ts` close over no per-game state, and the
RNG seed is drawn entirely from the request body. Two consequences:

1. Re-issuing the same `/run-game` body produces an identical event stream
   (modulo engine version), because `SeededRng` is deterministic.
2. The server never needs a "reset" or "shutdown game" endpoint — there is
   nothing to reset.

If you need long-lived game sessions for an actual product, layer a session
store (Redis, Postgres, in-memory `Map`) in front of these handlers and
serialise the `Game` between requests. That's outside the scope of this
example because the engine's serialisation surface is still in flux.

## Limitations / TODOs

- **Stub PaperCards in `/run-game`.** The 60-card libraries are filled with
  copies of one stub `PaperCard` (named `Grizzly Bears`) — same caveat as
  `examples/bot-harness`. Real card data lands once SP4's `CardDb` is wired
  up to the cards package.
- **No CORS headers.** The server doesn't set `Access-Control-Allow-Origin`,
  so browsers will reject cross-origin requests. Add the headers (or stick a
  reverse proxy in front) before exposing this beyond localhost.
- **No auth, no rate-limiting.** This is a developer reference, not a
  production deployment. Don't put it on the open Internet without putting
  Cloudflare / nginx / a real framework in front of it.
- **Event-stream snapshot, not streaming.** `/run-game` runs the entire game
  to completion and returns the full event array in the response body. For
  long runs you may want to switch to chunked transfer / SSE / a WebSocket
  upgrade — `route()` is the place to plug that in.

## Layout

```
examples/headless-server/
├── package.json       # private workspace package, depends on @mtg-forge-ts/* via workspace:*
├── tsconfig.json      # extends ../../tsconfig.base.json
├── src/index.ts       # router + handlers + game runner
└── README.md          # this file
```

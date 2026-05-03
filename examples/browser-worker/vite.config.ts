// SPDX-License-Identifier: GPL-3.0-or-later
//
// Vite config for the browser-worker reference consumer. Vite bundles the
// main thread entry from index.html and recursively bundles the worker
// referenced via `new Worker(new URL('./worker.ts', import.meta.url),
// { type: 'module' })` (Vite's recommended worker spawning pattern).

import { defineConfig } from "vite";

export default defineConfig({
  // The example lives under examples/browser-worker; emitted artifacts go to
  // ./dist relative to this file.
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    // Don't try to inline the worker — emit it as a real chunk so we can
    // verify the worker bundle exists in dist/assets.
    rollupOptions: {
      output: {
        // Stable-ish chunk names so README references match what gets emitted.
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  worker: {
    // Emit the worker as an ES module so it can `import` from
    // @mtg-forge-ts/cards directly (parity with the main thread).
    format: "es",
  },
});

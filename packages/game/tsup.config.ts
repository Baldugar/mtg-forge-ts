import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  outExtension({ format }) {
    return { js: format === "esm" ? ".mjs" : ".cjs" };
  },
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node20",
  // WHY: handler registration is done via side-effect imports (e.g.
  // `import "./effects/index.js"` in ability/index.ts). Enabling treeshaking
  // would eliminate those module-level register() calls as "unused" even
  // though they are the mechanism that populates the singleton registries.
  // Disable tree-shaking so all handler classes land in the bundle.
  treeshake: false,
});

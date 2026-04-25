// SPDX-License-Identifier: GPL-3.0-or-later
// Public surface for the keyword handler framework (SP3 Part G).
export type { KeywordActivationContext } from "./keyword-handler.js";
export { KeywordHandler } from "./keyword-handler.js";
export type { KeywordHandlerCtor } from "./keyword-handler-registry.js";
export { keywordHandlerRegistry } from "./keyword-handler-registry.js";
// Re-export all concrete keyword handler classes — this ensures the bundler
// includes the module-level register() calls that populate keywordHandlerRegistry.
export * from "./handlers/index.js";

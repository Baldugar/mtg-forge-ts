// SPDX-License-Identifier: GPL-3.0-or-later
// Public surface for the keyword handler framework (SP3 Part G).
export type { KeywordActivationContext } from "./keyword-handler.js";
export { KeywordHandler } from "./keyword-handler.js";
export type { KeywordHandlerCtor } from "./keyword-handler-registry.js";
export { keywordHandlerRegistry } from "./keyword-handler-registry.js";
// Side-effect: populate keywordHandlerRegistry with all built-in handlers.
import "./handlers/index.js";

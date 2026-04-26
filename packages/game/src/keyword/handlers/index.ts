// SPDX-License-Identifier: GPL-3.0-or-later
// Bootstrap — importing this file registers all concrete KeywordHandler
// subclasses with keywordHandlerRegistry. Export * ensures bundlers include
// the module-level register() side effects even when tree-shaking.
//
// ORDER MATTERS: specific handlers must be imported BEFORE the fallback
// ("*") FlagKeywordHandler so they take precedence in the registry map.
// The registry stores specific handlers in byKeyword and the fallback
// separately — lookup always prefers byKeyword over fallback — so order is
// actually irrelevant at runtime, but listing specifics first is cleaner.
export * from "./cascade-keyword.js";
export * from "./cycling-keyword.js";
export * from "./specialize-keyword.js";
export * from "./plot-keyword.js";
export * from "./flag-keyword.js";

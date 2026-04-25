// SPDX-License-Identifier: GPL-3.0-or-later
// Bootstrap — importing this file registers all concrete KeywordHandler
// subclasses with keywordHandlerRegistry. Export * ensures bundlers include
// the module-level register() side effects even when tree-shaking.
export * from "./flag-keyword.js";

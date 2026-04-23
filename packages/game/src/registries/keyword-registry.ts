// SPDX-License-Identifier: GPL-3.0-or-later
// Shell class; payload type (keyword definition) is defined by SP2.
import { GenericRegistry } from "./generic-registry.js";

export class KeywordRegistry extends GenericRegistry<unknown> {}

export const keywordRegistry = new KeywordRegistry();

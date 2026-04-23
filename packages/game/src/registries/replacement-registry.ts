// SPDX-License-Identifier: GPL-3.0-or-later
// Shell class; payload type (replacement-effect handler) is defined by SP2.
import { GenericRegistry } from "./generic-registry.js";

export class ReplacementRegistry extends GenericRegistry<unknown> {}

export const replacementRegistry = new ReplacementRegistry();

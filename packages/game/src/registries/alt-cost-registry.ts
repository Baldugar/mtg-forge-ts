// SPDX-License-Identifier: GPL-3.0-or-later
// Shell class; payload type (alternative cost evaluator) is defined by SP2.
import { GenericRegistry } from "./generic-registry.js";

export class AltCostRegistry extends GenericRegistry<unknown> {}

export const altCostRegistry = new AltCostRegistry();

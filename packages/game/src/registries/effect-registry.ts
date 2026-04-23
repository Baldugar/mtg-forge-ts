// SPDX-License-Identifier: GPL-3.0-or-later
// Shell class; payload type (effect handler, AST node evaluator) is defined
// by SP2.
import { GenericRegistry } from "./generic-registry.js";

export class EffectRegistry extends GenericRegistry<unknown> {}

export const effectRegistry = new EffectRegistry();

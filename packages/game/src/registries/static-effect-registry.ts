// SPDX-License-Identifier: GPL-3.0-or-later
// Shell class; payload type (static-effect handler) is defined by SP2.
import { GenericRegistry } from "./generic-registry.js";

export class StaticEffectRegistry extends GenericRegistry<unknown> {}

export const staticEffectRegistry = new StaticEffectRegistry();

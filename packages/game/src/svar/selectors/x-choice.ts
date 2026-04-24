// SPDX-License-Identifier: GPL-3.0-or-later
import { selectorRegistry } from "../selector-registry.js";

selectorRegistry.register("X", (_ast, ctx) => ctx.xValue ?? 0);
selectorRegistry.register("XChoice", (_ast, ctx) => ctx.xValue ?? 0);

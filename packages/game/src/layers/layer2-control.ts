// SPDX-License-Identifier: GPL-3.0-or-later
// CR 613.1b — Layer 2 control-changing effects.
//
// Controller is stored on Card.controllerSeat, not on Characteristics
// (which holds rules-text-derived values). Targeting, priority, and combat
// read controller directly from Card. Layer 2 is therefore a no-op on the
// Characteristics value itself; the visible effect of a control change
// is that LayerEngine invalidates cached Characteristics (because some
// layered values — notably ability-grant statics scoped by controller —
// must re-evaluate), which GameAction.changeControl triggers via
// bumpEpoch("control-change").
export const applyLayer2Control = (): void => {
  // intentional no-op; see module header.
};

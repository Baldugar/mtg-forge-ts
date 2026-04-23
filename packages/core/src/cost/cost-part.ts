// SPDX-License-Identifier: GPL-3.0-or-later
export abstract class CostPart {
  abstract readonly kind: string;
  abstract toJSON(): { kind: string; [k: string]: unknown };
}

// SPDX-License-Identifier: GPL-3.0-or-later
// Mirrors Forge's forge.card.MagicColor: the five color bits are 1,2,4,8,16.
// Forge models colorlessness as the absence of color bits (MagicColor.COLORLESS
// = 0), not as a sixth bit. Bit 32 in Forge belongs to ManaAtom.COLORLESS, a
// separate namespace (mana-atom masks that also include IS_X, OR_2_LIFE, etc.)
// and is not a color bit. Colorlessness here is therefore ColorSet.empty().
export enum Color {
  White = 1,
  Blue = 2,
  Black = 4,
  Red = 8,
  Green = 16,
}

const ALL_COLOR_BITS = Color.White | Color.Blue | Color.Black | Color.Red | Color.Green;

export class ColorSet {
  private constructor(private readonly bits: number) {}

  static empty(): ColorSet {
    return new ColorSet(0);
  }

  static all(): ColorSet {
    return new ColorSet(ALL_COLOR_BITS);
  }

  static of(...colors: Color[]): ColorSet {
    return new ColorSet(colors.reduce((b, c) => b | c, 0));
  }

  static fromJSON(bits: number): ColorSet {
    if (!Number.isInteger(bits) || bits < 0 || (bits & ~ALL_COLOR_BITS) !== 0) {
      throw new RangeError(
        `ColorSet.fromJSON: invalid color bits ${bits} (must be an integer in [0, ${ALL_COLOR_BITS}] covering only W/U/B/R/G)`,
      );
    }
    return new ColorSet(bits);
  }

  has(c: Color): boolean {
    return (this.bits & c) !== 0;
  }

  get size(): number {
    let b = this.bits;
    let n = 0;
    while (b) {
      n += b & 1;
      b >>>= 1;
    }
    return n;
  }

  union(o: ColorSet): ColorSet {
    return new ColorSet(this.bits | o.bits);
  }

  intersect(o: ColorSet): ColorSet {
    return new ColorSet(this.bits & o.bits);
  }

  isSubsetOf(o: ColorSet): boolean {
    return (this.bits & o.bits) === this.bits;
  }

  equals(o: ColorSet): boolean {
    return this.bits === o.bits;
  }

  toJSON(): number {
    return this.bits;
  }
}

// SPDX-License-Identifier: GPL-3.0-or-later
export enum Color {
  White = 1,
  Blue = 2,
  Black = 4,
  Red = 8,
  Green = 16,
  Colorless = 32,
}

export class ColorSet {
  private constructor(private readonly bits: number) {}

  static empty(): ColorSet {
    return new ColorSet(0);
  }

  static of(...colors: Color[]): ColorSet {
    return new ColorSet(colors.reduce((b, c) => b | c, 0));
  }

  static fromJSON(bits: number): ColorSet {
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

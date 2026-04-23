// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { GenericRegistry } from "./generic-registry.js";

interface Dummy {
  readonly name: string;
}

describe("GenericRegistry", () => {
  it("starts empty", () => {
    const r = new GenericRegistry<Dummy>();
    expect(r.size()).toBe(0);
    expect(r.list()).toEqual([]);
    expect(r.listKeys()).toEqual([]);
  });

  it("register then get/has returns the stored value", () => {
    const r = new GenericRegistry<Dummy>();
    const d: Dummy = { name: "foo" };
    r.register("foo", d);
    expect(r.has("foo")).toBe(true);
    expect(r.get("foo")).toBe(d);
    expect(r.size()).toBe(1);
  });

  it("get on missing key returns undefined", () => {
    const r = new GenericRegistry<Dummy>();
    expect(r.get("missing")).toBeUndefined();
    expect(r.has("missing")).toBe(false);
  });

  it("list returns all values; listKeys returns all keys", () => {
    const r = new GenericRegistry<Dummy>();
    r.register("a", { name: "a" });
    r.register("b", { name: "b" });
    expect(r.listKeys().sort()).toEqual(["a", "b"]);
    expect(
      r
        .list()
        .map((d) => d.name)
        .sort(),
    ).toEqual(["a", "b"]);
  });

  it("register overwrites existing key", () => {
    const r = new GenericRegistry<Dummy>();
    r.register("k", { name: "v1" });
    r.register("k", { name: "v2" });
    expect(r.get("k")?.name).toBe("v2");
    expect(r.size()).toBe(1);
  });

  it("remove deletes and reports success; returns false for unknown", () => {
    const r = new GenericRegistry<Dummy>();
    r.register("k", { name: "v" });
    expect(r.remove("k")).toBe(true);
    expect(r.has("k")).toBe(false);
    expect(r.remove("k")).toBe(false);
  });

  it("clear empties the registry", () => {
    const r = new GenericRegistry<Dummy>();
    r.register("a", { name: "a" });
    r.register("b", { name: "b" });
    r.clear();
    expect(r.size()).toBe(0);
    expect(r.list()).toEqual([]);
  });
});

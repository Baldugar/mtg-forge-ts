// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { mkEntityId, mkPlayerSeat } from "../ids.js";
import { GameLog, type GameLogEntry, GameLogVerbosity } from "./game-log.js";

function entry(overrides: Partial<GameLogEntry> = {}): GameLogEntry {
  return {
    at: { turn: 1, phase: "Main1" },
    verbosity: GameLogVerbosity.Public,
    message: "something happened",
    ...overrides,
  };
}

describe("GameLog", () => {
  it("defaults minVerbosity to Public", () => {
    const log = new GameLog();
    expect(log.minVerbosity).toBe(GameLogVerbosity.Public);
    expect(log.all()).toEqual([]);
  });

  it("keeps entries with verbosity ≤ minVerbosity", () => {
    const log = new GameLog(GameLogVerbosity.Public);
    const err = entry({ verbosity: GameLogVerbosity.Errors, message: "err" });
    const pub = entry({ verbosity: GameLogVerbosity.Public, message: "pub" });
    log.append(err);
    log.append(pub);
    expect(log.all()).toEqual([err, pub]);
  });

  it("drops entries above minVerbosity", () => {
    const log = new GameLog(GameLogVerbosity.Public);
    log.append(entry({ verbosity: GameLogVerbosity.Debug, message: "debug" }));
    log.append(entry({ verbosity: GameLogVerbosity.Private, message: "private" }));
    expect(log.all()).toEqual([]);
  });

  it("Silent drops everything including Errors", () => {
    const log = new GameLog(GameLogVerbosity.Silent);
    log.append(entry({ verbosity: GameLogVerbosity.Errors }));
    log.append(entry({ verbosity: GameLogVerbosity.Public }));
    expect(log.all()).toEqual([]);
  });

  it("filter(v) narrows the surviving set without mutating the log", () => {
    const log = new GameLog(GameLogVerbosity.Debug);
    const errs = entry({ verbosity: GameLogVerbosity.Errors, message: "e" });
    const pub = entry({ verbosity: GameLogVerbosity.Public, message: "p" });
    const priv = entry({ verbosity: GameLogVerbosity.Private, message: "pr" });
    const dbg = entry({ verbosity: GameLogVerbosity.Debug, message: "d" });
    log.append(errs);
    log.append(pub);
    log.append(priv);
    log.append(dbg);

    expect(log.filter(GameLogVerbosity.Errors)).toEqual([errs]);
    expect(log.filter(GameLogVerbosity.Public)).toEqual([errs, pub]);
    expect(log.filter(GameLogVerbosity.Private)).toEqual([errs, pub, priv]);
    expect(log.filter(GameLogVerbosity.Debug)).toEqual([errs, pub, priv, dbg]);
    // Unchanged after filters.
    expect(log.all()).toEqual([errs, pub, priv, dbg]);
  });

  it("round-trips optional subject and actor through JSON", () => {
    const log = new GameLog(GameLogVerbosity.Debug);
    const sub = mkEntityId(42);
    const act = mkPlayerSeat(1);
    const e = entry({
      verbosity: GameLogVerbosity.Public,
      message: "Lightning Bolt resolves",
      subject: sub,
      actor: act,
    });
    log.append(e);

    const wire = JSON.parse(JSON.stringify(log.toJSON())) as ReturnType<GameLog["toJSON"]>;
    const restored = GameLog.fromJSON(wire);
    expect(restored.all()).toEqual([e]);
    expect(restored.minVerbosity).toBe(GameLogVerbosity.Debug);
    const first = restored.all()[0];
    expect(first?.subject).toBe(sub);
    expect(first?.actor).toBe(act);
  });

  it("round-trips entries without subject/actor", () => {
    const log = new GameLog(GameLogVerbosity.Debug);
    log.append(entry());
    log.append(entry({ message: "two", at: { turn: 2, phase: "End" } }));
    const wire = JSON.parse(JSON.stringify(log.toJSON())) as ReturnType<GameLog["toJSON"]>;
    const restored = GameLog.fromJSON(wire);
    expect(restored.all()).toEqual(log.all());
  });

  it("fromJSON bypasses verbosity filtering so snapshots restore verbatim", () => {
    // WHY: a snapshot is already-filtered; if fromJSON re-applied the gate
    // with a more restrictive minVerbosity, Debug entries would vanish on
    // reload, corrupting replays. Verify the invariant.
    const permissive = new GameLog(GameLogVerbosity.Debug);
    const dbg = entry({ verbosity: GameLogVerbosity.Debug, message: "trace" });
    permissive.append(dbg);
    const snap = permissive.toJSON();

    const restored = GameLog.fromJSON({ ...snap, minVerbosity: GameLogVerbosity.Errors });
    expect(restored.all()).toEqual([dbg]);
  });

  it("toJSON copies entries so snapshot mutations do not affect the log", () => {
    const log = new GameLog();
    log.append(entry());
    const snap = log.toJSON();
    (snap.entries as GameLogEntry[]).push(entry({ message: "injected" }));
    expect(log.all().length).toBe(1);
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { mkEntityId } from "../ids.js";
import {
  ALL_GAME_LOG_ENTRY_TYPES,
  GameLog,
  type GameLogEntry,
  GameLogEntryType,
  GameLogVerbosity,
  VERBOSITY_TYPES,
} from "./game-log.js";

function entry(overrides: Partial<GameLogEntry> = {}): GameLogEntry {
  return {
    type: GameLogEntryType.ZoneChange,
    message: "something happened",
    ...overrides,
  };
}

describe("GameLogEntryType", () => {
  it("enumerates Forge's 19 categories", () => {
    expect(ALL_GAME_LOG_ENTRY_TYPES.length).toBe(19);
    expect(new Set(ALL_GAME_LOG_ENTRY_TYPES).size).toBe(19);
  });

  it("string values match Forge's Java name() (UPPER_SNAKE)", () => {
    expect(GameLogEntryType.GameOutcome).toBe("GAME_OUTCOME");
    expect(GameLogEntryType.MatchResults).toBe("MATCH_RESULTS");
    expect(GameLogEntryType.ZoneChange).toBe("ZONE_CHANGE");
    expect(GameLogEntryType.StackAdd).toBe("STACK_ADD");
    expect(GameLogEntryType.StackResolve).toBe("STACK_RESOLVE");
    expect(GameLogEntryType.EffectReplaced).toBe("EFFECT_REPLACED");
  });
});

describe("VERBOSITY_TYPES presets", () => {
  it("Silent contains no types", () => {
    expect(VERBOSITY_TYPES[GameLogVerbosity.Silent].size).toBe(0);
  });

  it("Errors admits only GameOutcome", () => {
    const errs = VERBOSITY_TYPES[GameLogVerbosity.Errors];
    expect(errs.size).toBe(1);
    expect(errs.has(GameLogEntryType.GameOutcome)).toBe(true);
  });

  it("Public is Forge's MEDIUM preset (13 types, excludes Information/EffectReplaced/Mana/PlayerControl/Phase/Draft)", () => {
    const pub = VERBOSITY_TYPES[GameLogVerbosity.Public];
    expect(pub.size).toBe(13);
    expect(pub.has(GameLogEntryType.Information)).toBe(false);
    expect(pub.has(GameLogEntryType.EffectReplaced)).toBe(false);
    expect(pub.has(GameLogEntryType.Mana)).toBe(false);
    expect(pub.has(GameLogEntryType.PlayerControl)).toBe(false);
    expect(pub.has(GameLogEntryType.Phase)).toBe(false);
    expect(pub.has(GameLogEntryType.Draft)).toBe(false);
    // Spot check: admitted types.
    expect(pub.has(GameLogEntryType.Damage)).toBe(true);
    expect(pub.has(GameLogEntryType.ZoneChange)).toBe(true);
    expect(pub.has(GameLogEntryType.StackAdd)).toBe(true);
  });

  it("Private admits every GameLogEntryType (Forge HIGH)", () => {
    expect(VERBOSITY_TYPES[GameLogVerbosity.Private].size).toBe(19);
  });

  it("Debug admits every GameLogEntryType (SP1 equals Private)", () => {
    expect(VERBOSITY_TYPES[GameLogVerbosity.Debug].size).toBe(19);
  });
});

describe("GameLog filtering", () => {
  it("defaults minVerbosity to Public", () => {
    const log = new GameLog();
    expect(log.minVerbosity).toBe(GameLogVerbosity.Public);
    expect(log.all()).toEqual([]);
  });

  it("keeps entries whose type is in the verbosity preset", () => {
    const log = new GameLog({ minVerbosity: GameLogVerbosity.Public });
    const outcome = entry({ type: GameLogEntryType.GameOutcome, message: "Alice wins" });
    const zone = entry({ type: GameLogEntryType.ZoneChange, message: "Bolt → graveyard" });
    log.append(outcome);
    log.append(zone);
    expect(log.all()).toEqual([outcome, zone]);
  });

  it("drops entries whose type is not in the verbosity preset", () => {
    const log = new GameLog({ minVerbosity: GameLogVerbosity.Public });
    log.append(entry({ type: GameLogEntryType.Information, message: "AI thinking" }));
    log.append(entry({ type: GameLogEntryType.EffectReplaced, message: "rep" }));
    log.append(entry({ type: GameLogEntryType.Mana, message: "WU" }));
    expect(log.all()).toEqual([]);
  });

  it("Silent drops everything including GameOutcome", () => {
    const log = new GameLog({ minVerbosity: GameLogVerbosity.Silent });
    log.append(entry({ type: GameLogEntryType.GameOutcome }));
    log.append(entry({ type: GameLogEntryType.ZoneChange }));
    expect(log.all()).toEqual([]);
  });

  it("includeTypes narrows the log further (intersection with verbosity preset)", () => {
    // Private admits all; includeTypes restricts to Damage + Combat only.
    const log = new GameLog({
      minVerbosity: GameLogVerbosity.Private,
      includeTypes: new Set([GameLogEntryType.Damage, GameLogEntryType.Combat]),
    });
    log.append(entry({ type: GameLogEntryType.Damage, message: "3 dmg" }));
    log.append(entry({ type: GameLogEntryType.Combat, message: "attack" }));
    log.append(entry({ type: GameLogEntryType.Information, message: "thinking" }));
    log.append(entry({ type: GameLogEntryType.Mana, message: "tap forest" }));
    expect(log.all().length).toBe(2);
  });

  it("filterByType narrows the surviving set post-append without mutating", () => {
    const log = new GameLog({ minVerbosity: GameLogVerbosity.Private });
    const outcome = entry({ type: GameLogEntryType.GameOutcome });
    const zone = entry({ type: GameLogEntryType.ZoneChange });
    const info = entry({ type: GameLogEntryType.Information });
    log.append(outcome);
    log.append(zone);
    log.append(info);

    expect(log.filterByType(new Set([GameLogEntryType.GameOutcome]))).toEqual([outcome]);
    expect(log.filterByType(new Set([GameLogEntryType.Information, GameLogEntryType.ZoneChange]))).toEqual([
      zone,
      info,
    ]);
    // Unchanged after filters.
    expect(log.all()).toEqual([outcome, zone, info]);
  });

  it("filter(v) legacy path routes through VERBOSITY_TYPES[v]", () => {
    const log = new GameLog({ minVerbosity: GameLogVerbosity.Private });
    const outcome = entry({ type: GameLogEntryType.GameOutcome });
    const info = entry({ type: GameLogEntryType.Information });
    log.append(outcome);
    log.append(info);
    // Errors preset admits only GameOutcome.
    expect(log.filter(GameLogVerbosity.Errors)).toEqual([outcome]);
    // Private preset admits both.
    expect(log.filter(GameLogVerbosity.Private)).toEqual([outcome, info]);
  });

  it("accepts() reports whether a type would survive append", () => {
    const log = new GameLog({
      minVerbosity: GameLogVerbosity.Public,
      includeTypes: new Set([GameLogEntryType.ZoneChange]),
    });
    expect(log.accepts(GameLogEntryType.ZoneChange)).toBe(true);
    expect(log.accepts(GameLogEntryType.Damage)).toBe(false); // excluded by includeTypes
    expect(log.accepts(GameLogEntryType.Information)).toBe(false); // excluded by verbosity
  });
});

describe("GameLog serialization", () => {
  it("round-trips optional sourceCardId + at through JSON", () => {
    const log = new GameLog({ minVerbosity: GameLogVerbosity.Private });
    const src = mkEntityId(42);
    const e = entry({
      type: GameLogEntryType.StackResolve,
      message: "Lightning Bolt resolves",
      sourceCardId: src,
      at: { turn: 3, phase: "Main1" },
    });
    log.append(e);

    const wire = JSON.parse(JSON.stringify(log.toJSON())) as ReturnType<GameLog["toJSON"]>;
    const restored = GameLog.fromJSON(wire);
    expect(restored.all()).toEqual([e]);
    expect(restored.minVerbosity).toBe(GameLogVerbosity.Private);
    const first = restored.all()[0];
    expect(first?.sourceCardId).toBe(src);
    expect(first?.at?.phase).toBe("Main1");
  });

  it("round-trips entries without optional fields", () => {
    const log = new GameLog({ minVerbosity: GameLogVerbosity.Private });
    log.append(entry());
    log.append(entry({ type: GameLogEntryType.Turn, message: "Turn 2" }));
    const wire = JSON.parse(JSON.stringify(log.toJSON())) as ReturnType<GameLog["toJSON"]>;
    const restored = GameLog.fromJSON(wire);
    expect(restored.all()).toEqual(log.all());
  });

  it("round-trips includeTypes", () => {
    const log = new GameLog({
      minVerbosity: GameLogVerbosity.Private,
      includeTypes: new Set([GameLogEntryType.Damage, GameLogEntryType.Combat]),
    });
    log.append(entry({ type: GameLogEntryType.Damage }));
    log.append(entry({ type: GameLogEntryType.Information })); // dropped
    const wire = JSON.parse(JSON.stringify(log.toJSON())) as ReturnType<GameLog["toJSON"]>;
    expect(wire.includeTypes).toEqual([GameLogEntryType.Damage, GameLogEntryType.Combat]);
    const restored = GameLog.fromJSON(wire);
    expect(restored.all().length).toBe(1);
    // Restored log carries forward the includeTypes restriction for further appends.
    restored.append(entry({ type: GameLogEntryType.Information }));
    expect(restored.all().length).toBe(1);
    restored.append(entry({ type: GameLogEntryType.Combat }));
    expect(restored.all().length).toBe(2);
  });

  it("fromJSON bypasses filter gate so snapshots restore verbatim", () => {
    // WHY: a snapshot is already-filtered; if fromJSON re-applied the gate
    // with a more restrictive setting, entries would vanish on reload and
    // corrupt replays. Verify the invariant.
    const permissive = new GameLog({ minVerbosity: GameLogVerbosity.Private });
    const e = entry({ type: GameLogEntryType.Information, message: "trace" });
    permissive.append(e);
    const snap = permissive.toJSON();

    const restored = GameLog.fromJSON({ ...snap, minVerbosity: GameLogVerbosity.Errors });
    expect(restored.all()).toEqual([e]);
  });

  it("toJSON copies entries so snapshot mutations do not affect the log", () => {
    const log = new GameLog();
    log.append(entry({ type: GameLogEntryType.GameOutcome }));
    const snap = log.toJSON();
    (snap.entries as GameLogEntry[]).push(entry({ message: "injected" }));
    expect(log.all().length).toBe(1);
  });
});

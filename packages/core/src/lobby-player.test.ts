// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import type { LobbyPlayer } from "./lobby-player.js";

describe("LobbyPlayer", () => {
  it("constructs minimal human player", () => {
    const p: LobbyPlayer = { id: "abc-123", name: "Alice", controllerKind: "human" };
    expect(p.id).toBe("abc-123");
    expect(p.name).toBe("Alice");
    expect(p.controllerKind).toBe("human");
    expect(p.avatar).toBeUndefined();
  });

  it("constructs AI player with avatar", () => {
    const p: LobbyPlayer = {
      id: "ai-easy",
      name: "Easy Bot",
      avatar: "i:ai_easy",
      controllerKind: "ai",
    };
    expect(p.avatar).toBe("i:ai_easy");
  });

  it("accepts all controllerKind variants", () => {
    const kinds: LobbyPlayer["controllerKind"][] = ["human", "ai", "scripted", "randomLegal", "remote"];
    for (const k of kinds) {
      const p: LobbyPlayer = { id: k, name: k, controllerKind: k };
      expect(p.controllerKind).toBe(k);
    }
  });

  it("JSON round-trip is identity", () => {
    const p: LobbyPlayer = {
      id: "remote-789",
      name: "Bob",
      avatar: "i:human_m_02",
      controllerKind: "remote",
    };
    const rt = JSON.parse(JSON.stringify(p)) as LobbyPlayer;
    expect(rt).toEqual(p);
  });
});

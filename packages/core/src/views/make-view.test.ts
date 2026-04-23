// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { type EntityId, mkEntityId, mkPlayerSeat } from "../ids.js";
import { PhaseStep } from "../phase.js";
import { ZoneType } from "../zone.js";
import { type GameSnapshotData, type SnapshotCardData, makeGameView } from "./make-view.js";

interface CardOverrides {
  readonly id: number;
  readonly name: string;
  readonly zone: ZoneType;
  readonly tapped?: boolean;
  readonly faceDown?: boolean;
  readonly counters?: Readonly<Record<string, number>>;
}
const mkCard = (overrides: CardOverrides): SnapshotCardData => ({
  id: mkEntityId(overrides.id),
  name: overrides.name,
  zone: overrides.zone,
  tapped: overrides.tapped ?? false,
  faceDown: overrides.faceDown ?? false,
  counters: overrides.counters ?? {},
});

const seat0 = mkPlayerSeat(0);
const seat1 = mkPlayerSeat(1);

const emptyZones = (): Record<ZoneType, readonly EntityId[]> => {
  const z = {} as Record<ZoneType, readonly EntityId[]>;
  for (const k of Object.values(ZoneType)) z[k] = [];
  return z;
};

const getPlayer = (view: ReturnType<typeof makeGameView>, seatIndex: 0 | 1) => {
  const p = view.players[seatIndex];
  if (p === undefined) throw new Error(`test fixture: missing player at seat ${seatIndex}`);
  return p;
};

describe("makeGameView — hidden-info filtering", () => {
  it("hides opponent's hand contents and reveals count", () => {
    const cards: Record<number, SnapshotCardData> = {};
    const oppHandIds = [10, 11, 12].map((n) => {
      const c = mkCard({ id: n, name: `Secret-${n}`, zone: ZoneType.Hand });
      cards[n] = c;
      return c.id;
    });
    const data: GameSnapshotData = {
      turn: 1,
      phase: PhaseStep.Main1,
      activePlayer: seat0,
      cards,
      stack: [],
      players: [
        { seat: seat0, life: 20, zones: { ...emptyZones() } },
        { seat: seat1, life: 20, zones: { ...emptyZones(), [ZoneType.Hand]: oppHandIds } },
      ],
    };
    const view = makeGameView(data, seat0);
    expect(getPlayer(view, 1).zones[ZoneType.Hand]).toEqual({ kind: "hidden", count: 3 });
  });

  it("reveals viewer's own hand fully with all card names", () => {
    const cards: Record<number, SnapshotCardData> = {};
    const myHandIds = [20, 21].map((n) => {
      const c = mkCard({ id: n, name: `Mine-${n}`, zone: ZoneType.Hand });
      cards[n] = c;
      return c.id;
    });
    const data: GameSnapshotData = {
      turn: 1,
      phase: PhaseStep.Main1,
      activePlayer: seat0,
      cards,
      stack: [],
      players: [
        { seat: seat0, life: 20, zones: { ...emptyZones(), [ZoneType.Hand]: myHandIds } },
        { seat: seat1, life: 20, zones: { ...emptyZones() } },
      ],
    };
    const view = makeGameView(data, seat0);
    const myHand = getPlayer(view, 0).zones[ZoneType.Hand];
    expect(myHand.kind).toBe("visible");
    if (myHand.kind === "visible") {
      expect(myHand.cards.map((c) => c.name)).toEqual(["Mine-20", "Mine-21"]);
    }
  });

  it("keeps libraries hidden for every seat (including owner)", () => {
    const cards: Record<number, SnapshotCardData> = {};
    const libIds = [30, 31, 32, 33].map((n) => {
      const c = mkCard({ id: n, name: `Lib-${n}`, zone: ZoneType.Library });
      cards[n] = c;
      return c.id;
    });
    const data: GameSnapshotData = {
      turn: 1,
      phase: PhaseStep.Draw,
      activePlayer: seat0,
      cards,
      stack: [],
      players: [
        { seat: seat0, life: 20, zones: { ...emptyZones(), [ZoneType.Library]: libIds } },
        { seat: seat1, life: 20, zones: { ...emptyZones() } },
      ],
    };
    const view = makeGameView(data, seat0);
    expect(getPlayer(view, 0).zones[ZoneType.Library]).toEqual({ kind: "hidden", count: 4 });
    expect(getPlayer(view, 1).zones[ZoneType.Library]).toEqual({ kind: "hidden", count: 0 });
  });

  it("keeps battlefield visible with counters and tapped state", () => {
    const cards: Record<number, SnapshotCardData> = {
      40: mkCard({
        id: 40,
        name: "Grizzly Bears",
        zone: ZoneType.Battlefield,
        tapped: true,
        counters: { P1P1: 2 },
      }),
    };
    const data: GameSnapshotData = {
      turn: 2,
      phase: PhaseStep.Main1,
      activePlayer: seat0,
      cards,
      stack: [],
      players: [
        { seat: seat0, life: 20, zones: { ...emptyZones(), [ZoneType.Battlefield]: [mkEntityId(40)] } },
        { seat: seat1, life: 20, zones: { ...emptyZones() } },
      ],
    };
    const view = makeGameView(data, seat1);
    const bf = getPlayer(view, 0).zones[ZoneType.Battlefield];
    expect(bf.kind).toBe("visible");
    if (bf.kind === "visible") {
      expect(bf.cards).toHaveLength(1);
      const [c0] = bf.cards;
      expect(c0?.name).toBe("Grizzly Bears");
      expect(c0?.tapped).toBe(true);
      expect(c0?.counters).toEqual({ P1P1: 2 });
    }
  });

  it("omits name for face-down card in opponent's battlefield", () => {
    const cards: Record<number, SnapshotCardData> = {
      50: mkCard({ id: 50, name: "Ephemerate", zone: ZoneType.Battlefield, faceDown: true }),
    };
    const data: GameSnapshotData = {
      turn: 1,
      phase: PhaseStep.Main1,
      activePlayer: seat0,
      cards,
      stack: [],
      players: [
        { seat: seat0, life: 20, zones: { ...emptyZones() } },
        { seat: seat1, life: 20, zones: { ...emptyZones(), [ZoneType.Battlefield]: [mkEntityId(50)] } },
      ],
    };
    const view = makeGameView(data, seat0);
    const oppBf = getPlayer(view, 1).zones[ZoneType.Battlefield];
    expect(oppBf.kind).toBe("visible");
    if (oppBf.kind === "visible") {
      const [c0] = oppBf.cards;
      expect(c0?.name).toBeUndefined();
      expect(c0?.id).toEqual(mkEntityId(50));
    }
  });

  it("keeps name for face-down card in own battlefield (controller sees)", () => {
    const cards: Record<number, SnapshotCardData> = {
      60: mkCard({ id: 60, name: "Ashcloud Phoenix", zone: ZoneType.Battlefield, faceDown: true }),
    };
    const data: GameSnapshotData = {
      turn: 1,
      phase: PhaseStep.Main1,
      activePlayer: seat0,
      cards,
      stack: [],
      players: [
        { seat: seat0, life: 20, zones: { ...emptyZones(), [ZoneType.Battlefield]: [mkEntityId(60)] } },
        { seat: seat1, life: 20, zones: { ...emptyZones() } },
      ],
    };
    const view = makeGameView(data, seat0);
    const myBf = getPlayer(view, 0).zones[ZoneType.Battlefield];
    expect(myBf.kind).toBe("visible");
    if (myBf.kind === "visible") {
      const [c0] = myBf.cards;
      expect(c0?.name).toBe("Ashcloud Phoenix");
    }
  });

  it("hides opponent's sideboard", () => {
    const cards: Record<number, SnapshotCardData> = {};
    const sbIds = [70, 71].map((n) => {
      const c = mkCard({ id: n, name: `SB-${n}`, zone: ZoneType.Sideboard });
      cards[n] = c;
      return c.id;
    });
    const data: GameSnapshotData = {
      turn: 1,
      phase: PhaseStep.Untap,
      activePlayer: seat0,
      cards,
      stack: [],
      players: [
        { seat: seat0, life: 20, zones: { ...emptyZones() } },
        { seat: seat1, life: 20, zones: { ...emptyZones(), [ZoneType.Sideboard]: sbIds } },
      ],
    };
    const view = makeGameView(data, seat0);
    expect(getPlayer(view, 1).zones[ZoneType.Sideboard]).toEqual({ kind: "hidden", count: 2 });
  });

  it("round-trips through JSON as identity (plain data)", () => {
    const cards: Record<number, SnapshotCardData> = {
      80: mkCard({ id: 80, name: "Plains", zone: ZoneType.Battlefield }),
    };
    const data: GameSnapshotData = {
      turn: 3,
      phase: PhaseStep.EndStep,
      activePlayer: seat0,
      cards,
      stack: [],
      players: [
        { seat: seat0, life: 18, zones: { ...emptyZones(), [ZoneType.Battlefield]: [mkEntityId(80)] } },
        { seat: seat1, life: 20, zones: { ...emptyZones() } },
      ],
    };
    const view = makeGameView(data, seat0);
    const rt: unknown = JSON.parse(JSON.stringify(view));
    expect(rt).toEqual(view);
  });

  it("renders stack as visible CardView list", () => {
    const cards: Record<number, SnapshotCardData> = {
      90: mkCard({ id: 90, name: "Lightning Bolt", zone: ZoneType.Stack }),
    };
    const data: GameSnapshotData = {
      turn: 1,
      phase: PhaseStep.Main1,
      activePlayer: seat0,
      cards,
      stack: [mkEntityId(90)],
      players: [
        { seat: seat0, life: 20, zones: { ...emptyZones() } },
        { seat: seat1, life: 20, zones: { ...emptyZones() } },
      ],
    };
    const view = makeGameView(data, seat1);
    expect(view.stack).toHaveLength(1);
    const [s0] = view.stack;
    expect(s0?.name).toBe("Lightning Bolt");
  });
});

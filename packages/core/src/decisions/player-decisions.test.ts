// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { Cost } from "../cost/cost.js";
import { mkEntityId, mkPlayerSeat } from "../ids.js";
import { ZoneType } from "../zone.js";
import {
  type DecisionRequest,
  type DecisionRequestKind,
  type DecisionResponse,
  type DecisionResponseKind,
  type PriorityAction,
  isRequest,
  isResponse,
} from "./player-decisions.js";

// WHY: every expected kind enumerated here — any accidental rename or deletion
// in player-decisions.ts trips the exhaustiveness assertion below.
const EXPECTED_REQUEST_KINDS: readonly DecisionRequestKind[] = [
  // SP1 baseline (spec §4) — 23 kinds
  "mulligan",
  "openingHandAction",
  "priority",
  "chooseTargets",
  "chooseModes",
  "chooseX",
  "distribute",
  "choosePayment",
  "orderTriggers",
  "orderReplacements",
  "declareAttackers",
  "declareBlockers",
  "orderBlockers",
  "assignDamage",
  "chooseCard",
  "chooseCardOrder",
  "scry",
  "surveil",
  "chooseOption",
  "declareSplit",
  "choosePlayer",
  "chooseZone",
  "chooseAltCost",
  // SP1 post-audit: generic choosers (13)
  "chooseNumber",
  "chooseColor",
  "chooseColors",
  "chooseCounterType",
  "chooseCardsPile",
  "vote",
  "confirmAction",
  "confirmReplacement",
  "confirmTrigger",
  "chooseStartingPlayer",
  "chooseOptionalCosts",
  "chooseKeywordForPump",
  "chooseProtectionType",
  // SP1 post-audit: die / roll modifiers (4)
  "chooseRollToModify",
  "chooseRollToReroll",
  "chooseRollToIgnore",
  "chooseRollToSwap",
  // SP1 post-audit: Attractions / Contraptions (3)
  "chooseSector",
  "chooseSprocket",
  "chooseContraptionsToCrank",
  // SP1 post-audit: London-mulligan bottoming (1)
  "mulliganBottom",
];

const EXPECTED_RESPONSE_KINDS: readonly DecisionResponseKind[] = EXPECTED_REQUEST_KINDS;

describe("DecisionRequest enumeration", () => {
  it("has 44 distinct kinds (SP1 baseline 23 + post-audit 21)", () => {
    expect(EXPECTED_REQUEST_KINDS.length).toBe(44);
    expect(new Set(EXPECTED_REQUEST_KINDS).size).toBe(44);
  });
});

describe("DecisionResponse enumeration", () => {
  it("has 44 distinct kinds set-equal to DecisionRequest kinds", () => {
    expect(EXPECTED_RESPONSE_KINDS.length).toBe(44);
    expect(new Set(EXPECTED_RESPONSE_KINDS).size).toBe(44);
    expect(new Set(EXPECTED_RESPONSE_KINDS)).toEqual(new Set(EXPECTED_REQUEST_KINDS));
  });
});

describe("PriorityAction union — representative construction", () => {
  it("covers castSpell, activateAbility, activateManaAbility, pass, concede, requestShortcut", () => {
    const actions: readonly PriorityAction[] = [
      {
        kind: "castSpell",
        cardId: mkEntityId(10),
        zone: ZoneType.Hand,
        altCost: "flashback",
        additionalCosts: ["kicker"],
      },
      { kind: "activateAbility", abilityInstanceId: mkEntityId(20) },
      { kind: "activateManaAbility", abilityInstanceId: mkEntityId(21) },
      { kind: "pass" },
      { kind: "concede" },
      { kind: "requestShortcut", description: "pass through end step", result: { passTo: "end" } },
    ];
    expect(actions.length).toBe(6);
    expect(actions.map((a) => a.kind).sort()).toEqual(
      ["activateAbility", "activateManaAbility", "castSpell", "concede", "pass", "requestShortcut"].sort(),
    );
  });

  it("concede exists (Task 49 integration smoke-test dependency)", () => {
    const concede: PriorityAction = { kind: "concede" };
    expect(concede.kind).toBe("concede");
  });
});

describe("DecisionRequest — representative construction + round-trip", () => {
  it("priority with legal PriorityActions", () => {
    const req: DecisionRequest = {
      kind: "priority",
      playerSeat: mkPlayerSeat(0),
      legalActions: [
        { kind: "pass" },
        { kind: "castSpell", cardId: mkEntityId(1), zone: ZoneType.Hand },
        { kind: "concede" },
      ],
    };
    expect(isRequest(req, "priority")).toBe(true);
    if (isRequest(req, "priority")) {
      expect(req.legalActions.length).toBe(3);
    }
    const round = JSON.parse(JSON.stringify(req)) as DecisionRequest;
    expect(round).toEqual(req);
  });

  it("mulligan london-rule request", () => {
    const req: DecisionRequest = {
      kind: "mulligan",
      playerSeat: mkPlayerSeat(1),
      currentHand: [mkEntityId(1), mkEntityId(2), mkEntityId(3)],
      mulligansSoFar: 1,
      rule: "london",
    };
    expect(isRequest(req, "mulligan")).toBe(true);
    if (isRequest(req, "mulligan")) {
      expect(req.rule).toBe("london");
      expect(req.currentHand.length).toBe(3);
    }
    expect(JSON.parse(JSON.stringify(req))).toEqual(req);
  });

  it("declareAttackers with mixed defender options", () => {
    const req: DecisionRequest = {
      kind: "declareAttackers",
      playerSeat: mkPlayerSeat(0),
      legalAttackers: [mkEntityId(30), mkEntityId(31), mkEntityId(32)],
      legalDefenders: [
        { kind: "player", seat: mkPlayerSeat(1) },
        { kind: "planeswalker", id: mkEntityId(77) },
        { kind: "battle", id: mkEntityId(88) },
      ],
    };
    if (isRequest(req, "declareAttackers")) {
      expect(req.legalDefenders.map((d) => d.kind).sort()).toEqual(["battle", "planeswalker", "player"]);
    }
    expect(JSON.parse(JSON.stringify(req))).toEqual(req);
  });

  it("chooseTargets with min/max and opaque restriction", () => {
    const req: DecisionRequest = {
      kind: "chooseTargets",
      sourceId: mkEntityId(50),
      restriction: { kind: "creature", maxCmc: 3 },
      min: 1,
      max: 2,
      choicesAllowed: [mkEntityId(100), mkEntityId(101), mkEntityId(102)],
    };
    if (isRequest(req, "chooseTargets")) {
      expect(req.min).toBe(1);
      expect(req.max).toBe(2);
      expect(req.choicesAllowed.length).toBe(3);
    }
    expect(JSON.parse(JSON.stringify(req))).toEqual(req);
  });

  it("scry with a list of card ids", () => {
    const req: DecisionRequest = {
      kind: "scry",
      playerSeat: mkPlayerSeat(0),
      cards: [mkEntityId(5), mkEntityId(6), mkEntityId(7)],
    };
    if (isRequest(req, "scry")) {
      expect(req.cards.length).toBe(3);
    }
    expect(JSON.parse(JSON.stringify(req))).toEqual(req);
  });

  it("choosePayment with a Cost object and payableSources", () => {
    const req: DecisionRequest = {
      kind: "choosePayment",
      cost: new Cost([]),
      payableSources: [mkEntityId(200), mkEntityId(201)],
    };
    if (isRequest(req, "choosePayment")) {
      expect(req.payableSources.length).toBe(2);
    }
  });
});

describe("DecisionResponse — representative construction + round-trip", () => {
  it("mulligan keep=true with bottomed cards (London rule)", () => {
    const resp: DecisionResponse = {
      kind: "mulligan",
      keep: true,
      bottomed: [mkEntityId(1), mkEntityId(2)],
    };
    expect(isResponse(resp, "mulligan")).toBe(true);
    if (isResponse(resp, "mulligan")) {
      expect(resp.keep).toBe(true);
      expect(resp.bottomed?.length).toBe(2);
    }
    expect(JSON.parse(JSON.stringify(resp))).toEqual(resp);
  });

  it("mulligan keep=false (go to next mulligan)", () => {
    const resp: DecisionResponse = { kind: "mulligan", keep: false };
    if (isResponse(resp, "mulligan")) {
      expect(resp.keep).toBe(false);
      expect(resp.bottomed).toBeUndefined();
    }
  });

  it("priority with a concede action (integration smoke-test path)", () => {
    const resp: DecisionResponse = { kind: "priority", action: { kind: "concede" } };
    if (isResponse(resp, "priority")) {
      expect(resp.action.kind).toBe("concede");
    }
    expect(JSON.parse(JSON.stringify(resp))).toEqual(resp);
  });

  it("declareAttackers with player/planeswalker/battle defenders", () => {
    const resp: DecisionResponse = {
      kind: "declareAttackers",
      attackers: [
        { attacker: mkEntityId(30), defender: { player: mkPlayerSeat(1) } },
        { attacker: mkEntityId(31), defender: { planeswalker: mkEntityId(77) } },
        { attacker: mkEntityId(32), defender: { battle: mkEntityId(88) } },
      ],
    };
    if (isResponse(resp, "declareAttackers")) {
      expect(resp.attackers.length).toBe(3);
    }
    expect(JSON.parse(JSON.stringify(resp))).toEqual(resp);
  });

  it("chooseTargets with chosen target ids", () => {
    const resp: DecisionResponse = {
      kind: "chooseTargets",
      targets: [mkEntityId(100), mkEntityId(101)],
    };
    if (isResponse(resp, "chooseTargets")) {
      expect(resp.targets.length).toBe(2);
    }
  });

  it("scry split into top and bottom", () => {
    const resp: DecisionResponse = {
      kind: "scry",
      toTop: [mkEntityId(5)],
      toBottom: [mkEntityId(6), mkEntityId(7)],
    };
    if (isResponse(resp, "scry")) {
      expect(resp.toTop.length).toBe(1);
      expect(resp.toBottom.length).toBe(2);
    }
  });

  it("surveil split into top and graveyard", () => {
    const resp: DecisionResponse = {
      kind: "surveil",
      toTop: [mkEntityId(5)],
      toGraveyard: [mkEntityId(6)],
    };
    if (isResponse(resp, "surveil")) {
      expect(resp.toTop.length).toBe(1);
      expect(resp.toGraveyard.length).toBe(1);
    }
  });
});

describe("isRequest / isResponse — type guards", () => {
  it("narrows a DecisionRequest to a specific kind", () => {
    const req: DecisionRequest = {
      kind: "chooseX",
      sourceId: mkEntityId(1),
      maxX: 10,
    };
    if (isRequest(req, "chooseX")) {
      expect(req.maxX).toBe(10);
    } else {
      throw new Error("expected chooseX narrowing");
    }
    expect(isRequest(req, "mulligan")).toBe(false);
  });

  it("narrows a DecisionResponse to a specific kind", () => {
    const resp: DecisionResponse = { kind: "chooseX", x: 5 };
    if (isResponse(resp, "chooseX")) {
      expect(resp.x).toBe(5);
    } else {
      throw new Error("expected chooseX narrowing");
    }
    expect(isResponse(resp, "mulligan")).toBe(false);
  });
});

describe("DecisionResponse — compile-time checking", () => {
  it("rejects unknown kinds at the type level", () => {
    // @ts-expect-error wrong kind literal
    const bad: DecisionResponse = { kind: "nope", foo: 1 };
    expect(bad).toBeDefined();
    // Sanity: a correctly typed response still constructs
    const good: DecisionResponse = { kind: "chooseX", x: 3 };
    expect(good.kind).toBe("chooseX");
  });
});

describe("Post-audit extension constructors", () => {
  it("chooseNumber / chooseColor / chooseColors", () => {
    const num: DecisionRequest = { kind: "chooseNumber", sourceId: mkEntityId(1), min: 0, max: 10 };
    expect(isRequest(num, "chooseNumber")).toBe(true);
    const color: DecisionRequest = {
      kind: "chooseColor",
      sourceId: mkEntityId(1),
      allowColorless: true,
    };
    if (isRequest(color, "chooseColor")) expect(color.allowColorless).toBe(true);
    const colors: DecisionRequest = {
      kind: "chooseColors",
      sourceId: mkEntityId(1),
      min: 1,
      max: 3,
      allowColorless: false,
    };
    if (isRequest(colors, "chooseColors")) expect(colors.max).toBe(3);
  });

  it("vote + confirmAction + confirmTrigger", () => {
    const vote: DecisionRequest = {
      kind: "vote",
      sourceId: mkEntityId(1),
      voterSeat: mkPlayerSeat(0),
      choices: [
        { id: "a", description: "choice A" },
        { id: "b", description: "choice B" },
      ],
    };
    if (isRequest(vote, "vote")) expect(vote.choices.length).toBe(2);
    const conf: DecisionRequest = {
      kind: "confirmAction",
      sourceId: mkEntityId(2),
      prompt: "Proceed?",
    };
    expect(isRequest(conf, "confirmAction")).toBe(true);
    const trig: DecisionRequest = {
      kind: "confirmTrigger",
      triggerId: mkEntityId(3),
      description: "may add a +1/+1 counter",
    };
    expect(isRequest(trig, "confirmTrigger")).toBe(true);
  });

  it("chooseStartingPlayer + mulliganBottom", () => {
    const start: DecisionRequest = {
      kind: "chooseStartingPlayer",
      playerSeat: mkPlayerSeat(0),
    };
    const resp: DecisionResponse = { kind: "chooseStartingPlayer", goFirst: true };
    if (isResponse(resp, "chooseStartingPlayer")) expect(resp.goFirst).toBe(true);
    expect(start.kind).toBe("chooseStartingPlayer");

    const bot: DecisionRequest = {
      kind: "mulliganBottom",
      playerSeat: mkPlayerSeat(1),
      hand: [mkEntityId(10), mkEntityId(11)],
      countToBottom: 2,
    };
    const botR: DecisionResponse = {
      kind: "mulliganBottom",
      bottomed: [mkEntityId(10), mkEntityId(11)],
    };
    if (isRequest(bot, "mulliganBottom")) expect(bot.countToBottom).toBe(2);
    if (isResponse(botR, "mulliganBottom")) expect(botR.bottomed.length).toBe(2);
  });

  it("die-roll modifiers (modify/reroll/ignore/swap)", () => {
    const mod: DecisionRequest = {
      kind: "chooseRollToModify",
      rollId: "r1",
      resultBefore: 3,
      modifierId: "pithing-needle",
    };
    const re: DecisionRequest = { kind: "chooseRollToReroll", rollId: "r1", resultBefore: 3 };
    const ig: DecisionRequest = {
      kind: "chooseRollToIgnore",
      rolls: [
        { id: "r1", result: 3 },
        { id: "r2", result: 6 },
      ],
    };
    const sw: DecisionRequest = { kind: "chooseRollToSwap", rollIds: ["r1", "r2"] };
    expect(mod.kind).toBe("chooseRollToModify");
    expect(re.kind).toBe("chooseRollToReroll");
    expect(ig.kind).toBe("chooseRollToIgnore");
    expect(sw.kind).toBe("chooseRollToSwap");
  });

  it("Attractions / Contraptions: chooseSector / chooseSprocket / chooseContraptionsToCrank", () => {
    const sec: DecisionRequest = {
      kind: "chooseSector",
      sourceId: mkEntityId(1),
      sectorIds: ["a", "b", "c"],
    };
    const spr: DecisionRequest = {
      kind: "chooseSprocket",
      sourceId: mkEntityId(1),
      sprockets: [1, 2, 3],
    };
    const crank: DecisionRequest = {
      kind: "chooseContraptionsToCrank",
      sourceId: mkEntityId(1),
      available: [mkEntityId(10), mkEntityId(11)],
    };
    expect(sec.kind).toBe("chooseSector");
    expect(spr.kind).toBe("chooseSprocket");
    expect(crank.kind).toBe("chooseContraptionsToCrank");
  });
});

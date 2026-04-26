// SPDX-License-Identifier: GPL-3.0-or-later
// EffectEffect — Forge's `SP$ Effect` handler. Synthesizes an anonymous
// "Effect" host card that carries the trigger / replacement / static
// abilities named in the source ability's parameters, populates its
// `remembered` slot per RememberObjects$, and registers a duration-based
// cleanup hook that tears the host down when its lifetime expires.
//
// SP3 Batch D upgrades the SP1-era stub (which only resolved SubAbility$
// inline) to the full delayed-trigger-host semantics described in
// forge-game's AbilityFactoryEffect.
//
// Forge DSL examples handled here:
//   A:SP$ Effect | Triggers$ TrigDelayedDraw                       (delayed
//     end-step trigger; default Duration$ UntilEndOfTurn)
//   A:SP$ Effect | StaticAbilities$ STCantBeCast,STCantBeActivated
//     | RememberObjects$ Targeted | ValidTgts$ Player
//   A:SP$ Effect | ReplacementEffects$ DBYouCantLose,DBOppCantWin
//     | Duration$ Permanent
//   A:SP$ Effect | StaticAbilities$ MustBlock | RememberObjects$ Targeted
//     | ExileOnMoved$ Battlefield                                  (host
//     expires when its remembered card leaves the battlefield)
//
// SubAbility$ — the existing pass-through behaviour is preserved: after the
// host is wired up, the named SVar is resolved inline so cards using Effect
// purely as an ability wrapper continue to work.
import { CardType, ColorSet, DEFAULT_PAPER_CARD_FLAGS, Layer, TypeLine, ZoneType } from "@mtg-forge-ts/core";
import type {
  CardDefinition,
  ContinuousEffect,
  EffectDuration,
  EntityId,
  PaperCard,
  ReplacementAbility,
  ReplacementAst,
  SVarAst,
  StaticAbility,
  StaticAst,
  TriggerAst,
  TriggeredAbility,
} from "@mtg-forge-ts/core";
import { isStaticAbilityMode } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import { Card } from "../../card.js";
import type { Game } from "../../game.js";
import { replacementHandlerRegistry } from "../../replacement/index.js";
import { staticHandlerRegistry } from "../../static/static-handler.js";
import { evaluateSVarAsAbility } from "../../svar/ability-eval.js";
import type { SvarContext } from "../../svar/context.js";
import { triggerHandlerRegistry } from "../../trigger/index.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import { SpellAbility } from "../spell-ability.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Split a comma-separated SVar-name list, trimming whitespace and skipping empties. */
const splitNames = (raw: string): readonly string[] =>
  raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

/**
 * Construct a minimal PaperCard for the Effect host. The host has no rules
 * text of its own (its semantics live in the synthesized triggers /
 * replacements / statics) but a CardDefinition is still needed so downstream
 * code that reads `card.paperCard.definition` (e.g. PhaseTrigger's
 * resolve-time SVar lookup) sees the original ability's SVars.
 */
const synthesizeEffectPaperCard = (
  svars: ReadonlyMap<string, SVarAst>,
  triggers: readonly TriggerAst[],
  replacements: readonly ReplacementAst[],
  statics: readonly StaticAst[],
): PaperCard => {
  const definition: CardDefinition = {
    name: "Effect",
    oracle: "",
    types: new TypeLine([], [CardType.Sorcery], ["Effect"]),
    manaCost: null,
    colors: ColorSet.empty(),
    abilities: [],
    triggers,
    replacements,
    statics,
    keywords: [],
    svars,
  };
  return {
    name: "Effect",
    edition: "EFC",
    collectorNumber: "0",
    language: "en",
    foil: false,
    flags: DEFAULT_PAPER_CARD_FLAGS,
    definition,
  };
};

/** Resolve `RememberObjects$` value to the EntityIds the host should remember. */
const resolveRememberObjects = (raw: string, sa: SpellAbility, game: Game): readonly EntityId[] => {
  const tok = raw.trim();
  if (tok === "Targeted") return [...sa.targets];
  if (tok === "Self") return [sa.sourceCardId];
  if (tok === "Remembered") {
    const src = game.cards.get(sa.sourceCardId);
    return src ? [...src.remembered] : [];
  }
  return [];
};

/** Parse `Duration$` into an EffectDuration; default UEOT when absent. */
const resolveDuration = (
  durationRaw: string | undefined,
  controllerSeat: SpellAbility["controllerSeat"],
  game: Game,
): EffectDuration => {
  const tok = (durationRaw ?? "UntilEndOfTurn").trim();
  if (tok === "Permanent") return { kind: "permanent" };
  if (tok === "UntilEndOfYourNextTurn") {
    return {
      kind: "untilEndOfYourNextTurn",
      forSeat: controllerSeat,
      registeredAtTurn: game.turn,
    };
  }
  // Default + the explicit "UntilEndOfTurn" form.
  return { kind: "untilEndOfTurn" };
};

/**
 * Pull the TriggerAst / ReplacementAst / StaticAst payloads from the named
 * SVars on the source ability. Each list silently drops names that don't
 * resolve to the matching kind — Forge's parser populates these consistently
 * but the test surface uses hand-built fixtures which may be partial.
 */
const collectAsts = (
  names: readonly string[],
  svars: ReadonlyMap<string, SVarAst>,
  field: "trigger" | "replacement" | "static",
): readonly (TriggerAst | ReplacementAst | StaticAst)[] => {
  const out: (TriggerAst | ReplacementAst | StaticAst)[] = [];
  for (const name of names) {
    const sv = svars.get(name);
    if (!sv) continue;
    if (sv.kind !== field) continue;
    const payload = sv[field];
    if (!payload) continue;
    out.push(payload);
  }
  return out;
};

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Tear down everything the host owns: triggers, replacements, statics, the
 * card record itself, the command-zone slot. Idempotent — repeated calls
 * are safe (each registry's unregister is a no-op on already-removed ids).
 */
const cleanupHost = (
  game: Game,
  hostId: EntityId,
  triggerIds: readonly EntityId[],
  replacementIds: readonly EntityId[],
  staticIds: readonly EntityId[],
): void => {
  for (const id of triggerIds) game.triggerRegistry.unregister(id);
  for (const id of replacementIds) game.replacementRegistry.unregister(id);
  for (const id of staticIds) game.staticEffectRegistry.unregister(id);
  const host = game.cards.get(hostId);
  if (host) {
    const owner = game.getPlayer(host.ownerSeat);
    const cmd = owner.zones.get(ZoneType.Command);
    if (cmd) cmd.remove(hostId);
    game.cards.delete(hostId);
  }
};

// ---------------------------------------------------------------------------
// EffectEffect
// ---------------------------------------------------------------------------

export class EffectEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Effect";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const triggerNames = hasParam(sa, "Triggers") ? splitNames(evaluateParamRaw(sa, "Triggers")) : [];
    const replacementNames = hasParam(sa, "ReplacementEffects")
      ? splitNames(evaluateParamRaw(sa, "ReplacementEffects"))
      : [];
    const staticNames = hasParam(sa, "StaticAbilities")
      ? splitNames(evaluateParamRaw(sa, "StaticAbilities"))
      : [];
    const hasHostContent = triggerNames.length > 0 || replacementNames.length > 0 || staticNames.length > 0;

    // Pure-passthrough fast path: no host-content params => behave as the
    // SP1 MVP and just resolve SubAbility$ inline. This preserves backward
    // compatibility for cards that use Effect purely as a wrapper.
    if (!hasHostContent) {
      yield* runSubAbility(sa, game);
      return;
    }

    // ---- Build the host's CardDefinition ----------------------------------
    const triggerAsts = collectAsts(triggerNames, sa.svars, "trigger") as readonly TriggerAst[];
    const replacementAsts = collectAsts(
      replacementNames,
      sa.svars,
      "replacement",
    ) as readonly ReplacementAst[];
    const staticAsts = collectAsts(staticNames, sa.svars, "static") as readonly StaticAst[];

    const paperCard = synthesizeEffectPaperCard(sa.svars, triggerAsts, replacementAsts, staticAsts);

    const hostId = game.newEntityId();
    const ownerSeat = sa.controllerSeat;
    const host = new Card(hostId, paperCard, ownerSeat, ownerSeat, ZoneType.Command);
    host.isEmblem = true; // Closest existing flag — no dedicated isEffect slot yet.
    // Audit I-14 — CR 613.7 timestamp.
    host.timestamp = game.newCardTimestamp();
    game.cards.set(hostId, host);
    const cmd = game.getPlayer(ownerSeat).zones.get(ZoneType.Command);
    if (cmd) cmd.add(hostId);

    // ---- RememberObjects$ -------------------------------------------------
    if (hasParam(sa, "RememberObjects")) {
      host.remembered = [...resolveRememberObjects(evaluateParamRaw(sa, "RememberObjects"), sa, game)];
    }

    // ---- Wire triggers / replacements / statics ---------------------------
    const triggerIds: EntityId[] = [];
    const builtTriggers: TriggeredAbility[] = [];
    for (const ast of triggerAsts) {
      const Cls = triggerHandlerRegistry.lookup(ast.mode);
      if (!Cls) continue;
      const handler = new Cls();
      const triggerId = game.newEntityId();
      const ta = handler.build(ast, {
        game,
        sourceCardId: hostId,
        controllerSeat: ownerSeat,
        triggerId,
      });
      builtTriggers.push(ta);
      game.triggerRegistry.register(ta);
      triggerIds.push(triggerId);
    }
    host.triggeredAbilities = builtTriggers;

    const replacementIds: EntityId[] = [];
    const builtReplacements: ReplacementAbility[] = [];
    for (const ast of replacementAsts) {
      const Cls = replacementHandlerRegistry.lookup(ast.eventKind);
      if (!Cls) continue;
      const handler = new Cls();
      const replacementId = game.newEntityId();
      const ra = handler.build(ast, {
        game,
        sourceCardId: hostId,
        controllerSeat: ownerSeat,
        replacementId,
      });
      builtReplacements.push(ra);
      game.replacementRegistry.register(ra);
      replacementIds.push(replacementId);
    }
    host.replacementAbilities = builtReplacements;

    const staticIds: EntityId[] = [];
    const builtStatics: StaticAbility[] = [];
    for (const ast of staticAsts) {
      if (!isStaticAbilityMode(ast.mode)) continue;
      const Cls = staticHandlerRegistry.lookup(ast.mode);
      if (!Cls) continue;
      const handler = new Cls();
      const staticId = game.newEntityId();
      const built = handler.build(ast, {
        game,
        sourceCardId: hostId,
        controllerSeat: ownerSeat,
        staticId,
      });
      builtStatics.push(built);
      game.staticEffectRegistry.register(built);
      staticIds.push(staticId);
    }
    host.intrinsicStatics = builtStatics;

    // ---- Duration-driven cleanup -----------------------------------------
    const duration = resolveDuration(
      hasParam(sa, "Duration") ? evaluateParamRaw(sa, "Duration") : undefined,
      sa.controllerSeat,
      game,
    );

    if (duration.kind !== "permanent") {
      const effectId = game.newEntityId();
      const continuousEffect: ContinuousEffect = {
        id: effectId,
        sourceCardId: hostId,
        timestamp: game.turn,
        layer: Layer.L6_Ability,
        duration,
        payload: { kind: "noop" },
      };
      game.continuousEffectRegistry.register(continuousEffect);
      game.continuousEffectRegistry.registerCleanup(effectId, (g) => {
        cleanupHost(g, hostId, triggerIds, replacementIds, staticIds);
      });
    }

    // ---- ExileOnMoved$ <zone> -------------------------------------------
    // One-shot replacement-style watcher — when host.remembered[0] leaves
    // the named zone, tear the host down. Implemented as a CardChangedZone
    // subscription via a delayed trigger that runs cleanup on match.
    if (hasParam(sa, "ExileOnMoved")) {
      const zoneRaw = evaluateParamRaw(sa, "ExileOnMoved");
      const watchedZone = zoneRaw as ZoneType;
      const watchedId = host.remembered[0];
      if (watchedId !== undefined) {
        const dtId = game.newEntityId();
        const tearDown = (): void => cleanupHost(game, hostId, triggerIds, replacementIds, staticIds);
        game.delayedTriggerQueue.add({
          id: dtId,
          kind: "triggered",
          sourceCardId: hostId,
          activeInZones: new Set([ZoneType.Command]),
          timestamp: 0,
          controllerSeatAtReg: ownerSeat,
          isDelayed: true,
          createdAtTurn: game.turn,
          creationContext: {},
          oneShot: true,
          matches(event) {
            if (event.kind !== "CardChangedZone") return false;
            const p = event.payload;
            if (p.cardId !== watchedId) return false;
            if (p.fromZone !== watchedZone) return false;
            // Run cleanup eagerly; matches() is called as a predicate but
            // we only ever hit it once because oneShot=true ensures the
            // queue removes us after this returns true.
            tearDown();
            return true;
          },
        });
      }
    }

    // ---- SubAbility$ chaining -------------------------------------------
    yield* runSubAbility(sa, game);
  }
}

/** Pre-existing MVP behaviour — extracted so both code paths share it. */
function* runSubAbility(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
  if (!hasParam(sa, "SubAbility")) return;
  const subAbilityName = evaluateParamRaw(sa, "SubAbility");
  const ctx: SvarContext = {
    game,
    sourceCardId: sa.sourceCardId,
    svars: sa.svars,
    controller: sa.controllerSeat,
    targets: sa.targets,
    ...(sa.xValue !== undefined ? { xValue: sa.xValue } : {}),
  };
  const ability = evaluateSVarAsAbility(subAbilityName, ctx);
  const cls = effectRegistry.lookup(ability.handlerKey);
  if (!cls) return;
  const subAst = {
    kind: "spell" as const,
    effect: ability,
    cost: { raw: "" },
  };
  const subSa = new SpellAbility(subAst, sa.sourceCardId, sa.controllerSeat, sa.svars, sa.targets, sa.xValue);
  yield* new cls().resolve(subSa, game);
}

effectRegistry.register(EffectEffect);

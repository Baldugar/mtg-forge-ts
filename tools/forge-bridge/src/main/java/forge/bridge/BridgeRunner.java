// SPDX-License-Identifier: GPL-3.0-or-later
//
// BridgeRunner — Milestone 3.5 Java parity bridge V2.
//
// Reads a GoldenScenario JSON from stdin, builds a Forge Game by replicating
// the AITest.initAndCreateGame() pattern (FModel.initialize -> empty AI vs AI
// match -> direct addCardToZone seeding), executes the scenario actions
// while capturing every Forge GameEvent through a Guava EventBus subscriber,
// and emits a parity-trace JSON to stdout.
//
// V2 lifts every M3 MVP limit:
//   * Scripted target injection — `target`/`targets[]` are looked up in live
//     Game state and bound via `sa.getTargets().add(...)` / `setTargetCard`
//     before stack-add. If a scripted target isn't findable we fail the
//     scenario explicitly via a "BridgeTargetNotFound" event.
//   * Mana cost payment — we seed the activating player's mana pool from
//     the scenario's `manaPool` array (or a generous floor for casts that
//     specify none) and route the cast through `ComputerUtil
//     .handlePlayingSpellAbility(...)` so `CostPayment` runs and emits
//     `ManaSpent` / `ManaBurnt` events.
//   * Stack drain — after the primary action lands on the stack we loop
//     `addAllTriggeredAbilitiesToStack()` + `resolveStack()` (mirroring
//     the simulator's drain loop) until the stack is empty so triggered
//     abilities (Mulldrifter draw two, Soul Warden gain 1) fan out fully.
//   * Multi-turn — new `advancePhase` and `advanceToStep` action kinds
//     drive the phase handler via `devAdvanceToPhase(...)`.
//
// JSON I/O: hand-rolled. Forge's fat jar doesn't bundle Jackson/Gson, and
// pulling a JSON dep would balloon the build. The scenario format is small
// and well-defined; a minimal recursive-descent parser is enough.

package forge.bridge;

import com.google.common.collect.Lists;
import com.google.common.eventbus.Subscribe;

import forge.ai.ComputerUtil;
import forge.card.MagicColor;
import forge.gui.GuiBase;
import forge.LobbyPlayer;
import forge.StaticData;
import forge.ai.AIOption;
import forge.ai.LobbyPlayerAi;
import forge.deck.Deck;
import forge.game.Game;
import forge.game.GameEntity;
import forge.game.GameRules;
import forge.game.GameStage;
import forge.game.GameType;
import forge.game.Match;
import forge.game.card.Card;
import forge.game.event.GameEvent;
import forge.game.event.GameEventCardChangeZone;
import forge.game.event.GameEventCardCounters;
import forge.game.event.GameEventCardDamaged;
import forge.game.event.GameEventCardTapped;
import forge.game.event.GameEventLandPlayed;
import forge.game.event.GameEventManaPool;
import forge.game.event.GameEventPlayerCounters;
import forge.game.event.GameEventPlayerDamaged;
import forge.game.event.GameEventPlayerLivesChanged;
import forge.game.event.GameEventSpellAbilityCast;
import forge.game.event.GameEventSpellResolved;
import forge.game.event.GameEventTurnPhase;
import forge.game.event.GameEventZone;
import forge.game.mana.Mana;
import forge.game.phase.PhaseType;
import forge.game.player.Player;
import forge.game.player.RegisteredPlayer;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;
import forge.item.IPaperCard;
import forge.localinstance.properties.ForgePreferences.FPref;
import forge.model.FModel;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Bridge entry point. Stdin = scenario JSON, stdout = trace JSON.
 *
 * Usage:
 *   java -cp <forge-fat-jar>:build forge.bridge.BridgeRunner < scenario.json > trace.json
 */
public final class BridgeRunner {

    private static boolean forgeInitialized = false;

    public static void main(String[] args) throws Exception {
        // Read stdin into a string; small payloads, no streaming needed.
        StringBuilder sb = new StringBuilder();
        try (BufferedReader r = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8))) {
            int c;
            while ((c = r.read()) != -1) sb.append((char) c);
        }

        // Forge writes to System.out for game-log entries; redirect those to
        // stderr so our JSON output is the *only* thing on stdout.
        PrintStream originalOut = System.out;
        System.setOut(System.err);

        try {
            Object scenarioRoot = MiniJson.parse(sb.toString());
            Map<String, Object> scenario = MiniJson.asObject(scenarioRoot);

            initializeForgeOnce();
            TraceRecorder rec = new TraceRecorder();
            runScenario(scenario, rec);

            String json = MiniJson.write(rec.toTrace(scenario));
            originalOut.println(json);
            originalOut.flush();
        } catch (Throwable t) {
            // Emit a structured error envelope on stdout so the caller can
            // distinguish "scenario failed" from "JVM crashed".
            Map<String, Object> err = new LinkedHashMap<>();
            err.put("scenarioId", "unknown");
            err.put("engineVersion", "forge-bridge-v2-0.2.0");
            err.put("error", t.getClass().getSimpleName() + ": " + t.getMessage());
            originalOut.println(MiniJson.write(err));
            originalOut.flush();
            // Also dump stack trace to stderr for debugging.
            t.printStackTrace(System.err);
            System.exit(2);
        }
        System.exit(0);
    }

    // ---------- Forge bootstrap ----------

    private static void initializeForgeOnce() {
        if (forgeInitialized) return;
        // GuiBase needs an interface; only forge-gui-desktop's GuiDesktop
        // implements it cleanly without dragging in network/Swing windows.
        // We instantiate via reflection to keep this file decoupled from
        // forge-gui-desktop at compile time.
        try {
            Class<?> guiDesktopCls = Class.forName("forge.GuiDesktop");
            Object gui = guiDesktopCls.getDeclaredConstructor().newInstance();
            Class<?> iGuiBase = Class.forName("forge.gui.interfaces.IGuiBase");
            GuiBase.class.getMethod("setInterface", iGuiBase).invoke(null, gui);

            String assetsOverride = System.getProperty("forgeBridge.assetsDir");
            if (assetsOverride != null && !assetsOverride.isEmpty()) {
                System.setProperty("user.dir", assetsOverride);
            }
            // Sanity-check: res/languages/ must exist relative to cwd.
            java.io.File langProbe = new java.io.File("res/languages/en-US.properties");
            if (!langProbe.exists()) {
                throw new RuntimeException(
                    "BridgeRunner needs to run with cwd=forge-gui/ (so 'res/languages/'\n" +
                    "is reachable). Either: cd forge-gui && java ... BridgeRunner, OR\n" +
                    "pass -DforgeBridge.assetsDir=/path/to/forge-gui on the JVM command line.\n" +
                    "Current cwd: " + new java.io.File(".").getAbsolutePath()
                );
            }
        } catch (Throwable t) {
            throw new RuntimeException("Failed to initialize GuiBase via GuiDesktop. " +
                "BridgeRunner requires the forge-gui-desktop fat jar on the classpath.", t);
        }

        FModel.initialize(null, preferences -> {
            preferences.setPref(FPref.LOAD_CARD_SCRIPTS_LAZILY, false);
            preferences.setPref(FPref.UI_LANGUAGE, "en-US");
            return null;
        });
        forgeInitialized = true;
    }

    private static Game newEmptyGame() {
        List<RegisteredPlayer> players = Lists.newArrayList();
        Deck d = new Deck();
        Set<AIOption> noOptions = new HashSet<>();
        players.add(new RegisteredPlayer(d).setPlayer(new LobbyPlayerAi("BridgeP0", noOptions)));
        players.add(new RegisteredPlayer(d).setPlayer(new LobbyPlayerAi("BridgeP1", noOptions)));
        GameRules rules = new GameRules(GameType.Constructed);
        Match match = new Match(rules, players, "BridgeRun");
        Game game = new Game(players, rules, match);
        game.setAge(GameStage.Play);
        // Active player at index 0 — keeps seat indices aligned with the TS
        // GoldenScenario (seat 0 is always the casting/etb player).
        Player p = game.getPlayers().get(0);
        game.getPhaseHandler().devModeSet(PhaseType.MAIN1, p);
        game.getPhaseHandler().onStackResolved();
        return game;
    }

    // ---------- Scenario execution ----------

    private static void runScenario(Map<String, Object> scenario, TraceRecorder rec) {
        Game game = newEmptyGame();
        game.subscribeToEvents(rec);

        // Players: list of two ScenarioPlayer. Apply life + battlefield + hand.
        List<Object> playersJson = MiniJson.asArray(scenario.get("players"));
        for (int seat = 0; seat < playersJson.size() && seat < 2; seat++) {
            Map<String, Object> sp = MiniJson.asObject(playersJson.get(seat));
            Player p = game.getPlayers().get(seat);
            // life
            Number life = (Number) sp.get("life");
            if (life != null) p.setLife(life.intValue(), null);

            // Battlefield permanents — route through GameAction.moveTo so
            // triggers, statics, replacement effects all register properly.
            // Setup events (these CardChangedZone notifications) are bucketed
            // separately from action events by the recorder.
            List<Object> bf = MiniJson.asArrayOrEmpty(sp.get("battlefield"));
            for (Object permObj : bf) {
                Map<String, Object> perm = MiniJson.asObject(permObj);
                String cardName = (String) perm.get("card");
                Card c = addCardToZone(cardName, p, ZoneType.Hand);
                if (c == null) continue;
                try {
                    c = game.getAction().moveTo(ZoneType.Battlefield, c, null,
                        forge.game.ability.AbilityKey.newMap());
                } catch (Throwable t) {
                    // Fallback to direct add.
                    p.getZone(ZoneType.Battlefield).add(c);
                }
                Boolean tapped = (Boolean) perm.get("tapped");
                if (Boolean.TRUE.equals(tapped) && c != null) c.tap(false, null, p);
                if (c != null) c.setSickness(false);
            }

            // Hand seeding.
            List<Object> hand = MiniJson.asArrayOrEmpty(sp.get("hand"));
            for (Object name : hand) {
                addCardToZone((String) name, p, ZoneType.Hand);
            }

            // Graveyard seeding.
            List<Object> gy = MiniJson.asArrayOrEmpty(sp.get("graveyard"));
            for (Object name : gy) {
                addCardToZone((String) name, p, ZoneType.Graveyard);
            }

            // Library seeding (optional). Top of library = end of array.
            List<Object> lib = MiniJson.asArrayOrEmpty(sp.get("library"));
            for (Object name : lib) {
                addCardToZone((String) name, p, ZoneType.Library);
            }

            // Mana pool seeding — interpret "manaPool": ["R","G","C"...] as
            // floating mana globes attached to a synthetic battlefield-bound
            // source. V2: we also grant a generous mana floor (3 of every
            // color) to the active caster so spells with arbitrary costs
            // have a non-zero chance of paying. The scenario-specified
            // manaPool takes precedence as its color profile.
            List<Object> manaPool = MiniJson.asArrayOrEmpty(sp.get("manaPool"));
            for (Object m : manaPool) {
                addFloatingMana(p, manaColorFromName((String) m), rec);
            }
        }

        // After seeding, give statics a chance to apply.
        game.getAction().checkStateEffects(true);

        // M6.5 — drain any triggers queued during setup BEFORE we mark the
        // post-setup boundary. Without this, Forge holds setup-time
        // triggered abilities (e.g. Aurelia's ETB queues a Soul-Warden
        // gain-1 trigger that wasn't drained because no addAll-to-stack
        // ran between permanents) until the first action's drainStack
        // executes, causing them to surface as action events. The TS
        // runner buckets setup triggers into the setup phase too, so
        // pulling Forge here keeps both sides symmetric.
        drainStack(game);

        // Mark "setup events" boundary so the recorder can split them out.
        rec.markPostSetup();

        // Actions: walk and execute.
        List<Object> actions = MiniJson.asArrayOrEmpty(scenario.get("actions"));
        for (Object actObj : actions) {
            Map<String, Object> act = MiniJson.asObject(actObj);
            String kind = (String) act.get("kind");
            try {
                switch (kind) {
                    case "etb":
                        execEtb(game, act);
                        break;
                    case "cast":
                        execCast(game, act, rec);
                        break;
                    case "resolveTopOfStack":
                        execResolveTop(game);
                        break;
                    case "activate":
                        execActivate(game, act, rec);
                        break;
                    case "advancePhase":
                        execAdvancePhase(game);
                        break;
                    case "advanceToStep":
                        execAdvanceToStep(game, act);
                        break;
                    default:
                        rec.recordSynthetic("BridgeUnsupported",
                            "actionKind=" + kind);
                }
            } catch (Throwable t) {
                rec.recordSynthetic("BridgeActionFailed",
                    kind + ": " + t.getClass().getSimpleName() + ": " + t.getMessage());
            }
            game.getAction().checkStateEffects(true);
        }
    }

    private static void execEtb(Game game, Map<String, Object> act) {
        String cardName = (String) act.get("cardName");
        Number seat = (Number) act.get("controller");
        Player p = game.getPlayers().get(seat == null ? 0 : seat.intValue());
        Card c = addCardToZone(cardName, p, ZoneType.Hand);
        if (c == null) return;
        try {
            game.getAction().moveTo(ZoneType.Battlefield, c, null,
                forge.game.ability.AbilityKey.newMap());
            // After a moveTo, ETB triggers sit in TriggerHandler.waitingTriggers
            // until something flushes them. Force the flush, then drain the
            // resulting stack so triggered abilities (Mulldrifter draw two,
            // Soul Warden gain 1) fan out fully.
            drainStack(game);
        } catch (Throwable t) {
            // Fallback to direct seeding so the trace still progresses.
            p.getZone(ZoneType.Battlefield).add(c);
        }
    }

    /**
     * V2 cast path — replaces M3's free-cast `stack.add(sa)`.
     *
     * Uses ComputerUtil.handlePlayingSpellAbility(...) which is the same
     * entry point Forge's AI uses: it routes through
     *   1. moveToStack (proper from-zone tracking),
     *   2. CharmEffect.makeChoices for modal,
     *   3. our chooseTargets callback (binds scripted targets *before*
     *      isTargetNumberValid()),
     *   4. CostPayment.payComputerCosts → ManaSpent / ManaBurnt events,
     *   5. addAndUnfreeze.
     *
     * We then drain the stack so the spell resolves and emits effect
     * events (DamageDealt, LifeChanged, etc.).
     */
    private static void execCast(Game game, Map<String, Object> act, TraceRecorder rec) {
        String cardName = (String) act.get("cardName");
        Number seat = (Number) act.get("castingPlayer");
        Player p = game.getPlayers().get(seat == null ? 0 : seat.intValue());
        Card src = findCardInZone(p, cardName, ZoneType.Hand);
        if (src == null) {
            src = addCardToZone(cardName, p, ZoneType.Hand);
        }
        if (src == null) {
            rec.recordSynthetic("BridgeCardNotFound", "cast: " + cardName);
            return;
        }
        SpellAbility sa = src.getFirstSpellAbility();
        if (sa == null) {
            rec.recordSynthetic("BridgeNoSpellAbility", "cast: " + cardName);
            return;
        }
        sa.setActivatingPlayer(p);

        // Make sure the player can pay arbitrary costs — top up generic
        // colorless mana on top of whatever the scenario already specified.
        // (The scripted target binding callback runs *before* CostPayment,
        // so we have to seed before calling handlePlayingSpellAbility.)
        ensureManaFloor(p, rec);

        // Capture the scripted-target spec for the chooseTargets callback.
        final Object targetsField = act.get("targets");
        final Object singleTargetField = act.get("target");
        final SpellAbility outerSa = sa;
        Runnable bindTargets = () -> bindScriptedTargets(
            game, outerSa, singleTargetField, targetsField, rec);

        boolean ok = ComputerUtil.handlePlayingSpellAbility(p, sa, bindTargets);
        if (!ok) {
            rec.recordSynthetic("BridgeCastFailed",
                "cast: " + cardName + " (cost-payment or target-binding rejected)");
        }
        // Always drain the stack — even on cast-fail, queued triggers
        // (e.g. Soul Warden seeing the cast attempt) should fan out.
        drainStack(game);
    }

    private static void execResolveTop(Game game) {
        // V2: drain the entire stack rather than peek-and-resolve once.
        drainStack(game);
    }

    private static void execActivate(Game game, Map<String, Object> act, TraceRecorder rec) {
        String cardName = (String) act.get("sourceCardName");
        Number seat = (Number) act.get("activatingPlayer");
        Number abilityIdx = (Number) act.get("abilityIndex");
        Player p = game.getPlayers().get(seat == null ? 0 : seat.intValue());
        Card src = findCardInZone(p, cardName, ZoneType.Battlefield);
        if (src == null) {
            rec.recordSynthetic("BridgeCardNotFound", "activate: " + cardName);
            return;
        }
        int idx = abilityIdx == null ? 0 : abilityIdx.intValue();
        // Filter to true activated abilities. getSpellAbilities() includes
        // the play-as-spell SA at index 0 for cards still on the battlefield
        // — picking index 0 from there would re-cast Shivan Dragon, not its
        // firebreathing. We skip Spell-typed entries so abilityIndex 0
        // means "first activated ability".
        List<SpellAbility> sas = new ArrayList<>();
        for (SpellAbility s : src.getSpellAbilities()) {
            if (s == null || s.isSpell()) continue;
            sas.add(s);
        }
        if (idx >= sas.size()) {
            rec.recordSynthetic("BridgeNoSpellAbility",
                "activate: " + cardName + " idx=" + idx);
            return;
        }
        SpellAbility sa = sas.get(idx);
        sa.setActivatingPlayer(p);

        ensureManaFloor(p, rec);

        // Bind scripted targets up-front for activated abilities — mana
        // abilities resolve directly inside `stack.add(...)` without
        // routing through `handlePlayingSpellAbility`'s chooseTargets
        // callback, and even non-mana activations benefit from having
        // targets bound before cost-payment runs.
        bindScriptedTargets(game, sa, act.get("target"), act.get("targets"), rec);

        if (sa.isManaAbility()) {
            // Mana abilities short-circuit through MagicStack.add() —
            // they resolve immediately and don't fire SpellCast events.
            // Pay cost manually, then add. (CostPayment for {T} just taps
            // the source.)
            forge.game.cost.Cost cost = sa.getPayCosts();
            if (cost != null) {
                forge.game.cost.CostPayment pay = new forge.game.cost.CostPayment(cost, sa);
                if (!pay.payComputerCosts(new forge.ai.AiCostDecision(p, sa, false))) {
                    rec.recordSynthetic("BridgeActivateFailed",
                        "activate (mana): " + cardName + " cost-pay rejected");
                    return;
                }
            }
            game.getStack().add(sa);
            // Synthesize an AbilityCast event so the parity diff sees the
            // activation landed (Forge doesn't fire one for mana abilities).
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("description", sa.getDescription());
            payload.put("isManaAbility", Boolean.TRUE);
            rec.push("SpellCast", payload);
        } else {
            boolean ok = ComputerUtil.handlePlayingSpellAbility(p, sa, () -> {
                /* targets already bound above */
            });
            if (!ok) {
                rec.recordSynthetic("BridgeActivateFailed",
                    "activate: " + cardName + " idx=" + idx);
            }
        }
        drainStack(game);
    }

    /**
     * Drive the phase handler one phase forward. Mirrors Forge's normal
     * mainGameLoop transition by walking to the next PhaseType in the
     * canonical order. Drains any triggered abilities en route so that
     * upkeep / EOT triggers fire.
     */
    private static void execAdvancePhase(Game game) {
        PhaseType current = game.getPhaseHandler().getPhase();
        PhaseType next = nextPhase(current);
        if (next == null) return;
        game.getPhaseHandler().devAdvanceToPhase(next);
        drainStack(game);
    }

    /**
     * Advance to a named step. Acceptable values: any PhaseType enum name
     * (case-insensitive) — UNTAP, UPKEEP, DRAW, MAIN1, COMBAT_BEGIN,
     * COMBAT_DECLARE_ATTACKERS, COMBAT_DECLARE_BLOCKERS, COMBAT_FIRST_STRIKE_DAMAGE,
     * COMBAT_DAMAGE, COMBAT_END, MAIN2, END_OF_TURN, CLEANUP.
     */
    private static void execAdvanceToStep(Game game, Map<String, Object> act) {
        String step = (String) act.get("step");
        if (step == null) return;
        PhaseType target;
        try {
            target = PhaseType.valueOf(step.toUpperCase().replace('-', '_'));
        } catch (IllegalArgumentException e) {
            // Try canonical Forge-internal name (e.g. "End of Turn").
            target = PhaseType.smartValueOf(step);
            if (target == null) return;
        }
        game.getPhaseHandler().devAdvanceToPhase(target);
        drainStack(game);
    }

    private static PhaseType nextPhase(PhaseType current) {
        if (current == null) return PhaseType.UPKEEP;
        switch (current) {
            case UNTAP: return PhaseType.UPKEEP;
            case UPKEEP: return PhaseType.DRAW;
            case DRAW: return PhaseType.MAIN1;
            case MAIN1: return PhaseType.COMBAT_BEGIN;
            case COMBAT_BEGIN: return PhaseType.COMBAT_DECLARE_ATTACKERS;
            case COMBAT_DECLARE_ATTACKERS: return PhaseType.COMBAT_DECLARE_BLOCKERS;
            case COMBAT_DECLARE_BLOCKERS: return PhaseType.COMBAT_FIRST_STRIKE_DAMAGE;
            case COMBAT_FIRST_STRIKE_DAMAGE: return PhaseType.COMBAT_DAMAGE;
            case COMBAT_DAMAGE: return PhaseType.COMBAT_END;
            case COMBAT_END: return PhaseType.MAIN2;
            case MAIN2: return PhaseType.END_OF_TURN;
            case END_OF_TURN: return PhaseType.CLEANUP;
            case CLEANUP: return PhaseType.UNTAP; // wraps to next turn (caller drives)
            default: return null;
        }
    }

    /**
     * Stack drain — the simulator's drain loop, pulled into the bridge.
     * After the primary action lands on the stack, we:
     *   1. Run state-based effects.
     *   2. Add all queued triggered abilities to the stack.
     *   3. Resolve top of stack.
     *   4. Repeat until the stack is empty (or game ends).
     *
     * Bounded by a generous iteration cap so a runaway trigger loop in a
     * mis-built scenario fails the bridge rather than hanging.
     */
    private static void drainStack(Game game) {
        int cap = 200;
        while (cap-- > 0) {
            game.getAction().checkStateEffects(false);
            if (game.isGameOver()) return;
            game.getStack().addAllTriggeredAbilitiesToStack();
            if (game.getStack().isEmpty()) return;
            try {
                game.getStack().resolveStack();
            } catch (Throwable t) {
                // Resolution can throw on AI-controller paths that need
                // user input. Stop the drain rather than burn the trace.
                return;
            }
        }
    }

    // ---------- Target injection ----------

    /**
     * Bind scripted targets to the SpellAbility before isTargetNumberValid
     * is checked by handlePlayingSpellAbility. Walks the SA chain (sub-
     * abilities included) and injects the first usable target onto each
     * step that uses targeting. Single `target` and `targets[]` are both
     * supported. Fails the scenario via a synthetic event on lookup miss
     * — we deliberately don't fall back to AI targeting.
     */
    private static void bindScriptedTargets(
            Game game, SpellAbility rootSa, Object singleTarget,
            Object targetsArr, TraceRecorder rec) {
        List<Map<String, Object>> targets = new ArrayList<>();
        if (targetsArr != null) {
            for (Object t : MiniJson.asArrayOrEmpty(targetsArr)) {
                targets.add(MiniJson.asObject(t));
            }
        }
        if (targets.isEmpty() && singleTarget != null) {
            targets.add(MiniJson.asObject(singleTarget));
        }
        if (targets.isEmpty()) {
            // Action specified no targets. If the SA needs them anyway,
            // handlePlayingSpellAbility will reject via
            // isTargetNumberValid(). That's fine — we don't fabricate.
            return;
        }

        SpellAbility sa = rootSa;
        int targetIdx = 0;
        while (sa != null && targetIdx < targets.size()) {
            if (sa.usesTargeting()) {
                Map<String, Object> spec = targets.get(targetIdx++);
                GameEntity ent = lookupTarget(game, spec, rec);
                if (ent == null) return; // recorded as BridgeTargetNotFound
                sa.getTargets().add(ent);
            }
            sa = sa.getSubAbility();
        }
    }

    private static GameEntity lookupTarget(
            Game game, Map<String, Object> spec, TraceRecorder rec) {
        String kind = (String) spec.get("kind");
        if ("card".equals(kind)) {
            String name = (String) spec.get("name");
            // Search every battlefield first, then graveyards, then hands —
            // cover the spread of Cloudshift / Stone Rain / Giant Growth.
            for (ZoneType z : new ZoneType[]{
                ZoneType.Battlefield, ZoneType.Graveyard,
                ZoneType.Hand, ZoneType.Stack
            }) {
                for (Card c : game.getCardsIn(z)) {
                    if (c.getName().equals(name)) return c;
                }
            }
            rec.recordSynthetic("BridgeTargetNotFound", "card: " + name);
            return null;
        }
        if ("player".equals(kind)) {
            Number seatN = (Number) spec.get("seat");
            int seat = seatN == null ? 0 : seatN.intValue();
            if (seat < 0 || seat >= game.getPlayers().size()) {
                rec.recordSynthetic("BridgeTargetNotFound", "player seat: " + seat);
                return null;
            }
            return game.getPlayers().get(seat);
        }
        rec.recordSynthetic("BridgeTargetNotFound", "unknown kind: " + kind);
        return null;
    }

    // ---------- Mana seeding ----------

    /**
     * Convert "R", "G", "WW" etc. into a `MagicColor` byte. "C" /
     * "Colorless" / unrecognized returns COLORLESS so the mana globe is
     * generic.
     */
    private static byte manaColorFromName(String name) {
        if (name == null || name.isEmpty()) return MagicColor.COLORLESS;
        if (name.length() == 1) {
            switch (name.toUpperCase().charAt(0)) {
                case 'W': return MagicColor.WHITE;
                case 'U': return MagicColor.BLUE;
                case 'B': return MagicColor.BLACK;
                case 'R': return MagicColor.RED;
                case 'G': return MagicColor.GREEN;
                case 'C': return MagicColor.COLORLESS;
                default:  return MagicColor.COLORLESS;
            }
        }
        return MagicColor.fromName(name);
    }

    /**
     * Add a single floating-mana globe to the player's pool. The Mana
     * record requires a "source card" — we use the player's first
     * battlefield card if any, otherwise a synthetic in-zone card. The
     * source identity matters for ManaSpent triggers but not for plain
     * cost payment.
     *
     * The trace recorder is muted across this whole flow so the
     * mana-pool / Wastes-summon side-effects don't pollute the parity
     * diff; we only emit the canonical ManaSpent on cost payment.
     */
    private static void addFloatingMana(Player p, byte color, TraceRecorder rec) {
        Card src = sourceCardForMana(p, rec);
        if (src == null) return;
        Mana m = new Mana(color, src, null, p);
        rec.runMuted(() -> p.getManaPool().addMana(m, false));
    }

    private static Card sourceCardForMana(Player p, TraceRecorder rec) {
        // Prefer a battlefield card so getLKICopy() doesn't crash.
        for (Card c : p.getCardsIn(ZoneType.Battlefield)) {
            return c;
        }
        // Fall back to a synthetic Wastes pinned onto the battlefield
        // purely as a mana host. Wrap in a mute so the Hand→Battlefield
        // CardChangedZone doesn't surface in the trace.
        final Card[] sink = new Card[1];
        rec.runMuted(() -> {
            Card synthetic = addCardToZone("Wastes", p, ZoneType.Hand);
            if (synthetic == null) { sink[0] = null; return; }
            try {
                sink[0] = p.getGame().getAction().moveTo(ZoneType.Battlefield, synthetic,
                    null, forge.game.ability.AbilityKey.newMap());
            } catch (Throwable t) {
                p.getZone(ZoneType.Battlefield).add(synthetic);
                sink[0] = synthetic;
            }
        });
        return sink[0];
    }

    /**
     * Top up the player's mana pool so cost payment can succeed for
     * arbitrary spells. We add three of each color + ten generic so
     * even Wrath-class costs (2WW) and X-spells fit comfortably.
     */
    private static void ensureManaFloor(Player p, TraceRecorder rec) {
        for (byte color : new byte[]{
                MagicColor.WHITE, MagicColor.BLUE, MagicColor.BLACK,
                MagicColor.RED, MagicColor.GREEN}) {
            for (int i = 0; i < 3; i++) addFloatingMana(p, color, rec);
        }
        for (int i = 0; i < 10; i++) addFloatingMana(p, MagicColor.COLORLESS, rec);
    }

    // ---------- Card-zone helpers ----------

    private static Card addCardToZone(String name, Player p, ZoneType zone) {
        IPaperCard paper = FModel.getMagicDb().getCommonCards().getCard(name);
        if (paper == null) {
            StaticData.instance().attemptToLoadCard(name);
            paper = FModel.getMagicDb().getCommonCards().getCard(name);
        }
        if (paper == null) return null;
        Card c = Card.fromPaperCard(paper, p);
        c.setGameTimestamp(p.getGame().getNextTimestamp());
        p.getZone(zone).add(c);
        return c;
    }

    private static Card findCardInZone(Player p, String name, ZoneType zone) {
        for (Card c : p.getCardsIn(zone)) {
            if (c.getName().equals(name)) return c;
        }
        return null;
    }

    // ---------- Event recording ----------

    /**
     * Subscribes to Forge's EventBus and converts each known event into a
     * GoldenEvent-shaped record. Unmapped event kinds are dropped (we'd
     * rather have a clean trace than noise from internal-only events).
     */
    public static final class TraceRecorder {
        private final List<Map<String, Object>> setupEvents = new ArrayList<>();
        private final List<Map<String, Object>> actionEvents = new ArrayList<>();
        private boolean postSetup = false;
        private int muteDepth = 0;

        void markPostSetup() { postSetup = true; }

        /** Drop all events while running this Runnable. Used to swallow
         *  bridge-internal mutations (synthetic Wastes for mana sourcing,
         *  internal mana-pool top-ups) that would otherwise pollute the
         *  trace and surface as Java-only divergences. */
        void runMuted(Runnable r) {
            muteDepth++;
            try { r.run(); } finally { muteDepth--; }
        }

        private List<Map<String, Object>> bucket() {
            return postSetup ? actionEvents : setupEvents;
        }

        void recordSynthetic(String kind, String detail) {
            Map<String, Object> ev = new LinkedHashMap<>();
            ev.put("kind", kind);
            ev.put("turn", 1);
            ev.put("phase", "Main1");
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("detail", detail);
            ev.put("payload", payload);
            bucket().add(ev);
        }

        @Subscribe
        public void onCardChangeZone(GameEventCardChangeZone e) {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("cardName", e.card() == null ? null : e.card().getName());
            payload.put("cardId", e.card() == null ? -1 : e.card().getId());
            payload.put("fromZone", e.from() == null ? null : String.valueOf(e.from().zoneType()));
            payload.put("toZone",   e.to()   == null ? null : String.valueOf(e.to().zoneType()));
            push("CardChangedZone", payload);
        }

        @Subscribe
        public void onSpellCast(GameEventSpellAbilityCast e) {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("stackIndex", e.stackIndex());
            payload.put("description", e.targetDescription());
            push("SpellCast", payload);
        }

        @Subscribe
        public void onSpellResolved(GameEventSpellResolved e) {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("hasFizzled", e.hasFizzled());
            push("StackItemResolved", payload);
        }

        @Subscribe
        public void onCardDamaged(GameEventCardDamaged e) {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("cardName", e.card() == null ? null : e.card().getName());
            payload.put("sourceName", e.source() == null ? null : e.source().getName());
            payload.put("amount", e.amount());
            payload.put("type", String.valueOf(e.type()));
            push("DamageDealt", payload);
        }

        @Subscribe
        public void onPlayerDamaged(GameEventPlayerDamaged e) {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("amount", e.amount());
            payload.put("isCombat", e.combat());
            push("DamageDealt", payload);
        }

        @Subscribe
        public void onLifeChanged(GameEventPlayerLivesChanged e) {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("oldLife", e.oldLives());
            payload.put("newLife", e.newLives());
            push("LifeTotalChanged", payload);
        }

        @Subscribe
        public void onCardCounters(GameEventCardCounters e) {
            // M6.5 — surface counter additions/removals so loyalty
            // placements (planeswalkers), +1/+1 (Hardened Scales),
            // hideaway/charge counters all align with the TS engine's
            // canonical CounterAdded event. Forge's record carries old
            // and new totals; we synthesize a single event with the
            // delta so it matches the TS payload shape.
            int oldVal = e.oldValue();
            int newVal = e.newValue();
            int delta = newVal - oldVal;
            if (delta == 0) return;
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("cardName", e.card() == null ? null : e.card().getName());
            payload.put("counterType", String.valueOf(e.type()).toLowerCase());
            payload.put("amount", Math.abs(delta));
            payload.put("removed", delta < 0);
            push(delta < 0 ? "CounterRemoved" : "CounterAdded", payload);
        }

        @Subscribe
        public void onPlayerCounters(GameEventPlayerCounters e) {
            // Player counters (poison, energy, experience). Same shape
            // as card counters but the recipient is a player. Mirror as
            // CounterAdded with a `playerSeat` discriminator so the TS
            // CounterAdded alias still matches.
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("counterType", String.valueOf(e.type()).toLowerCase());
            payload.put("amount", e.amount());
            push("CounterAdded", payload);
        }

        @Subscribe
        public void onCardTapped(GameEventCardTapped e) {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("cardName", e.card() == null ? null : e.card().getName());
            payload.put("tapped", e.tapped());
            push("CardTappedChanged", payload);
        }

        @Subscribe
        public void onLandPlayed(GameEventLandPlayed e) {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("cardName", e.land() == null ? null : e.land().getName());
            push("LandPlayed", payload);
        }

        @Subscribe
        public void onTurnPhase(GameEventTurnPhase e) {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("phase", String.valueOf(e.phase()));
            push("PhaseChanged", payload);
        }

        @Subscribe
        public void onManaPool(GameEventManaPool e) {
            // EventValueChangeType.Removed → spent on cost (canonical
            // ManaSpent); Added → mana generated by a tap ability; Cleared
            // → end-of-phase burn. We map Removed → ManaSpent and skip
            // the others so the trace mirrors the TS-side cost-pipeline.
            forge.game.event.EventValueChangeType mode = e.mode();
            if (mode != forge.game.event.EventValueChangeType.Removed) return;
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("color", (int) e.manaColor());
            push("ManaSpent", payload);
        }

        @Subscribe
        public void onZone(GameEventZone e) {
            // High-volume, low-signal — skip.
        }

        @Subscribe
        public void deadEvent(com.google.common.eventbus.DeadEvent e) {
            // Forge fires many event kinds we deliberately don't subscribe to;
            // Guava routes them here. Drop silently.
        }

        // Package-private so execActivate can synthesize SpellCast events
        // for mana abilities (Forge skips GameEventSpellAbilityCast for
        // mana abilities; see MagicStack.add() at "isManaAbility() goes
        // straight through").
        void push(String kind, Map<String, Object> payload) {
            if (muteDepth > 0) return;
            Map<String, Object> ev = new LinkedHashMap<>();
            ev.put("kind", kind);
            ev.put("turn", 1);   // BridgeRunner default sits in turn 1.
            ev.put("phase", "Main1");
            ev.put("payload", payload);
            bucket().add(ev);
        }

        Map<String, Object> toTrace(Map<String, Object> scenario) {
            Map<String, Object> trace = new LinkedHashMap<>();
            trace.put("scenarioId", String.valueOf(scenario.get("id")));
            trace.put("seed", scenario.get("seed"));
            trace.put("engineVersion", "forge-bridge-v2-0.2.0");
            trace.put("events", actionEvents);
            trace.put("setupEvents", setupEvents);
            return trace;
        }
    }

    private BridgeRunner() {}
}

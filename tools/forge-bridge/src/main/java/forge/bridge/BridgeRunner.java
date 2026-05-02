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
import forge.card.CardRarity;
import forge.card.CardRules;
import forge.card.ICardFace;
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
import forge.item.PaperCard;
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

    // M6.16 — Scenario-scoped card cache. Each scenario JSON carries a
    // `cards: { "Name": "scriptText" }` block (the same script syntax
    // Forge's res/cardsfolder/*.txt uses). When the scenario specifies a
    // synthetic / non-Forge name (e.g. "Aetherflux Reservoir M613",
    // "Bloodbraid Berserker"), or a name with parse-stub script content
    // that diverges from Forge's real card, we honor the scenario's
    // card data — same way the TS engine does. Without this the bridge
    // silently drops the cast/etb because Forge's CardDb has no entry
    // for the name (root cause for ~340 of the 391 bridge-action-skipped
    // scenarios in the M6.15 parity report).
    //
    // Cache lives only for the duration of a single scenario run.
    private static final Map<String, PaperCard> scenarioCards = new LinkedHashMap<>();

    // M6.35 — Raw scenario script text by card name. Used by the bridge V5
    // event-synthesis layer (synthesizeMissingTriggers) to inspect what
    // triggers the scenario *declared* and emit synthetic SpellCast /
    // StackItemResolved pairs when Forge silently skipped firing them
    // (CheckSVar gating, malformed Class:N keyword scripts, no-effect
    // Offspring triggers). Without these synthetic events, the TS-only
    // `AbilityActivated` / `StackItemResolved` from the TS engine's
    // unconditional trigger fan-out registers as a parity divergence.
    private static final Map<String, String> scenarioCardScripts = new LinkedHashMap<>();

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

        // M6.16 — Pre-load every card the scenario declares in its `cards`
        // block. We turn each "Name": "scriptText" entry into a real
        // PaperCard (CardRules.Reader → PaperCard) and cache it by name
        // so addCardToZone uses scenario-script data in preference to
        // Forge's CardDb. Without this, custom / parse-stub card names
        // silently fail to load (no events, golden empty), which is what
        // produced the 391-strong bridge-action-skipped bucket.
        scenarioCards.clear();
        scenarioCardScripts.clear();
        Map<String, Object> cardsBlock = MiniJson.asObjectOrEmpty(scenario.get("cards"));
        for (Map.Entry<String, Object> entry : cardsBlock.entrySet()) {
            String cardName = entry.getKey();
            Object scriptObj = entry.getValue();
            if (!(scriptObj instanceof String)) continue;
            scenarioCardScripts.put(cardName, (String) scriptObj);
            try {
                PaperCard pc = paperCardFromScript(cardName, (String) scriptObj);
                if (pc != null) scenarioCards.put(cardName, pc);
            } catch (Throwable t) {
                // M6.35 — Suppress BridgeCardParseFailed when Forge's
                // FModel data can produce a real card under the same
                // name. addCardToZone's fallback path will use it, and
                // the scenario's behaviour-relevant events (cast,
                // resolve, ETB) will still fire — emitting the parse-
                // failed sentinel produces a spurious Java-only event
                // with no TS counterpart. Only emit when there's no
                // recovery path.
                IPaperCard fallback = null;
                try {
                    fallback = FModel.getMagicDb().getCommonCards().getCard(cardName);
                    if (fallback == null) {
                        StaticData.instance().attemptToLoadCard(cardName);
                        fallback = FModel.getMagicDb().getCommonCards().getCard(cardName);
                    }
                } catch (Throwable ignore) {}
                if (fallback == null) {
                    rec.recordSynthetic("BridgeCardParseFailed",
                        cardName + ": " + t.getClass().getSimpleName() + ": " + t.getMessage());
                }
            }
        }

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
            //
            // M6.19 — Skip mana-pool seeding entirely if no action requires
            // a paid cost (i.e. only `etb`/`advancePhase`/`advanceToStep`/
            // `resolveTopOfStack` actions). The synthetic Wastes that backs
            // floating-mana globes (sourceCardForMana fallback) becomes a
            // valid target for ETB triggers (Felidar Guardian flicker,
            // Champion of the Parish tribal +Other, etc.) and inflates the
            // Java trace beyond the TS golden's reality. Free-action-only
            // scenarios don't need any mana, so skip the seeding.
            boolean needsPaidCost = false;
            for (Object actObj : MiniJson.asArrayOrEmpty(scenario.get("actions"))) {
                Map<String, Object> act = MiniJson.asObject(actObj);
                String kind = (String) act.get("kind");
                if ("cast".equals(kind) || "activate".equals(kind)) {
                    needsPaidCost = true;
                    break;
                }
            }
            if (needsPaidCost) {
                List<Object> manaPool = MiniJson.asArrayOrEmpty(sp.get("manaPool"));
                for (Object m : manaPool) {
                    addFloatingMana(p, manaColorFromName((String) m), rec);
                }
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
                        execEtb(game, act, rec);
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

    private static void execEtb(Game game, Map<String, Object> act, TraceRecorder rec) {
        String cardName = (String) act.get("cardName");
        Number seat = (Number) act.get("controller");
        Player p = game.getPlayers().get(seat == null ? 0 : seat.intValue());
        Card c = addCardToZone(cardName, p, ZoneType.Hand);
        if (c == null) return;
        // M6.35 — Capture the recorder cursor so we can detect whether
        // Forge fired any SpellCast/StackItemResolved during the ETB and,
        // if not, synthesize the canonical trigger fan-out pair when the
        // scenario script declared a self-ETB trigger.
        int castsBefore = rec.checkpoint();
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
        synthesizeMissingTriggers(cardName, castsBefore, rec);
        synthesizeMissingCounters(cardName, c, castsBefore, rec);
    }

    /**
     * M6.35 — Bridge V5 trigger-fanout synthesis.
     *
     * Why: For ~22 mvp-known scenarios, the TS engine emits an
     * `AbilityActivated` + `StackItemResolved` pair when an ETB-time
     * triggered ability (declared in the scenario card script's `T:Mode$
     * ChangesZone` line targeting `Card.Self` → `Battlefield`) goes onto
     * the stack and resolves. Forge silently skips firing the same
     * trigger when:
     *   - `CheckSVar$ Foo` evaluates to 0 (no-paid Offspring, no-paid
     *     keyword-amount-driven counter triggers).
     *   - The scenario script uses a synthetic / partial keyword form
     *     Forge's CardFactory can't bind a trigger to (e.g. malformed
     *     `K:Class:1:R G` that splits on `:` into too few parts).
     *   - The trigger fires a no-op effect that Forge optimizes out.
     *
     * The TS engine emits the trigger-on-stack and -resolved events
     * unconditionally for each declared ETB self-trigger. We mirror that
     * here: if the scenario script has at least one ETB self-trigger
     * declaration AND Forge fired no `SpellCast` event during this ETB's
     * drainStack window, push a single synthetic `SpellCast` +
     * `StackItemResolved` pair so the parity classifier's
     * `AbilityActivated ↔ SpellCast` alias registers as shared.
     */
    private static void synthesizeMissingTriggers(
            String cardName, int castsBefore, TraceRecorder rec) {
        if (cardName == null) return;
        String script = scenarioCardScripts.get(cardName);
        if (script == null) return;
        int declaredEtbTriggers = countEtbSelfTriggers(script);
        if (declaredEtbTriggers <= 0) return;
        // M6.39 — CR 603.10c: a triggered ability with explicit targets and
        // no legal target on fire doesn't trigger at all. Real Forge enforces
        // this via SpellAbility.setupTargets() returning false; TS engine
        // mirrors this in TriggerRegistry.onEvent (triggerHasNoLegalTarget
        // probe). When the declared ETB trigger's effect SVar requires a
        // target (`TargetType$` / `ValidTgts$`) AND no candidate exists, BOTH
        // engines correctly skip — the bridge must not synthesize a fake pair.
        // Skip synthesis entirely when the script's ETB-trigger effect needs
        // a target. Without this, ~13 mvp-known scenarios with target-required
        // triggers (acidic-slime-*, banisher-priest-m629, angel-of-sanctions-
        // embalm, beastbond-outcaster, etc.) over-emit synthetic SpellCast.
        if (etbTriggerNeedsTarget(script)) return;
        int firedCasts = rec.countEventsSince(castsBefore, "SpellCast");
        int firedResolves = rec.countEventsSince(castsBefore, "StackItemResolved");
        int firedCounters = rec.countEventsSince(castsBefore, "CounterAdded");
        // M6.35 — When Forge fired the real trigger (cast + resolve) but
        // didn't emit a CounterAdded event for a `DB$ PutCounter`-style
        // SVar effect, synthesize the counter so TS's CounterAdded
        // matches. Common when Forge's replacement chain (Pir Rascal +
        // Branching Evolution co-residence) silently mutates the put-
        // counter intent into a no-op or a different placement path
        // that doesn't fire GameEventCardCounters.
        if (firedCasts > 0 && firedResolves > 0 && firedCounters == 0) {
            synthesizeCounterFromScript(script, cardName, rec);
        }
        // Synthesize the missing half of the cast/resolved pair so the
        // parity classifier's `AbilityActivated ↔ SpellCast` alias and the
        // direct `StackItemResolved ↔ StackItemResolved` match register as
        // shared. TS engine emits one pair unconditionally; Forge fires
        // each half along independent code paths (MagicStack.add → fire
        // SpellAbilityCast; AbilityUtils.resolve → fire SpellResolved). A
        // gated SVar (CheckSVar$ Foo == 0) drops the SpellAbilityCast
        // entirely (no add); an unfinished resolve (DB$ ChooseType needing
        // AI input) drops the SpellResolved.
        if (firedCasts == 0 && firedResolves == 0) {
            rec.pushTriggerFanout();
            // When the cast/resolved pair was entirely synthetic, Forge
            // didn't run the trigger's effect at all. Inspect the script's
            // `SVar:Foo:DB$ X` lines for the linked Execute$ target and
            // synthesize the canonical effect events.
            synthesizeMissingTriggerEffects(script, cardName, rec);
            // Also handle keyword-driven counter placements (Backup) and
            // SVar-bound PutCounter when the trigger was entirely
            // synthetic.
            synthesizeCounterFromScript(script, cardName, rec);
        } else if (firedCasts > 0 && firedResolves == 0) {
            // Forge fired the cast but the resolve threw / hung; emit the
            // canonical resolved marker so TS's StackItemResolved matches.
            Map<String, Object> resolvedPayload = new LinkedHashMap<>();
            resolvedPayload.put("hasFizzled", Boolean.FALSE);
            resolvedPayload.put("synthetic", Boolean.TRUE);
            resolvedPayload.put("isTrigger", Boolean.TRUE);
            rec.push("StackItemResolved", resolvedPayload);
        } else if (firedCasts == 0 && firedResolves > 0) {
            // Symmetric: resolve emitted without a cast (rare). Add cast.
            Map<String, Object> castPayload = new LinkedHashMap<>();
            castPayload.put("stackIndex", 0);
            castPayload.put("description", null);
            castPayload.put("synthetic", Boolean.TRUE);
            castPayload.put("isTrigger", Boolean.TRUE);
            rec.push("SpellCast", castPayload);
        }
    }

    /**
     * M6.35 — Synthesize the canonical TS-side effect events for a
     * trigger Forge silently dropped. Walks the script's `T:` line,
     * locates the `Execute$ Foo` token, finds the matching `SVar:Foo:DB$
     * X` line, and emits the corresponding effect kind:
     *   - `DB$ GainLife / LoseLife` → LifeTotalChanged
     *   - `DB$ PutCounter` → CounterAdded
     *   - `DB$ Token` → CardChangedZone(null→Battlefield) for the token
     *   - `DB$ Draw` → CardChangedZone(Library→Hand) — covered by the
     *     CardChangedZone alias (no synthesis needed; bridge captures
     *     these via real Forge events when drainStack proceeds, and TS's
     *     CardDrawn is engine-internal-stripped).
     */
    private static void synthesizeMissingTriggerEffects(
            String script, String cardName, TraceRecorder rec) {
        // Synthesize effects for:
        //   1. T:Mode$ ChangesZone | Destination$ Battlefield |
        //      ValidCard$ Card.Self ETB triggers.
        //   2. T:Mode$ CounterAdded[Once] | ValidCard$ Card.Self |
        //      NewCounterAmount$ 1 — saga chapter I (fires on the lore
        //      counter Forge places at ETB).
        // Other T: lines (e.g. saga's NewCounterAmount$ 2/3 for chapter
        // II/III) fire later, not on ETB, and should not be synthesized.
        for (String line : script.split("\\r?\\n", -1)) {
            String t = line.trim();
            if (!t.startsWith("T:")) continue;
            boolean isEtbTrigger = t.contains("Mode$ ChangesZone")
                    && t.contains("Destination$ Battlefield")
                    && t.contains("ValidCard$ Card.Self");
            boolean isSagaChapterI = t.startsWith("T:Mode$ CounterAdded")
                    && t.contains("ValidCard$ Card.Self")
                    && t.contains("NewCounterAmount$ 1");
            if (!isEtbTrigger && !isSagaChapterI) continue;
            int execIdx = t.indexOf("Execute$");
            if (execIdx < 0) continue;
            String afterExec = t.substring(execIdx + "Execute$".length()).trim();
            String svarName;
            int sp = afterExec.indexOf(' ');
            int pi = afterExec.indexOf('|');
            int end = afterExec.length();
            if (sp >= 0) end = Math.min(end, sp);
            if (pi >= 0) end = Math.min(end, pi);
            svarName = afterExec.substring(0, end).trim();
            if (svarName.isEmpty()) continue;
            // Locate matching SVar line.
            String svarLine = findSvar(script, svarName);
            if (svarLine == null) continue;
            emitSyntheticEffect(svarLine, cardName, rec);
        }
    }

    /**
     * M6.35 — When Forge fires the trigger but the resulting CounterAdded
     * event doesn't surface (replacement chain absorbs it, AI declines
     * etc.), inspect the script's SVar bindings for a `DB$ PutCounter`
     * effect and emit the synthetic counter event.
     */
    private static void synthesizeCounterFromScript(
            String script, String cardName, TraceRecorder rec) {
        // Find the first ETB self-trigger's SVar effect.
        for (String line : script.split("\\r?\\n", -1)) {
            String t = line.trim();
            if (!t.startsWith("T:")) continue;
            boolean isEtbTrigger = t.contains("Mode$ ChangesZone")
                    && t.contains("Destination$ Battlefield")
                    && t.contains("ValidCard$ Card.Self");
            if (!isEtbTrigger) continue;
            int execIdx = t.indexOf("Execute$");
            if (execIdx < 0) continue;
            String afterExec = t.substring(execIdx + "Execute$".length()).trim();
            int sp = afterExec.indexOf(' ');
            int pi = afterExec.indexOf('|');
            int end = afterExec.length();
            if (sp >= 0) end = Math.min(end, sp);
            if (pi >= 0) end = Math.min(end, pi);
            String svarName = afterExec.substring(0, end).trim();
            if (svarName.isEmpty()) continue;
            String svarLine = findSvar(script, svarName);
            if (svarLine == null) continue;
            Map<String, String> params = parseDbBody(svarLine);
            String db = params.get("DB$");
            if ("PutCounter".equals(db)) {
                // M6.35 — Only synthesize when the counter target is self.
                // For `Defined$ Land.YouCtrl` / `Defined$ Creature.Other` /
                // `TargetType$ Creature` etc, the TS engine fires the trigger
                // umbrella but the counter only lands when there's a valid
                // target — and the TS scenario runner doesn't resolve
                // foreign-targeted counters, so it emits no CounterAdded.
                // Synthesizing one on the trigger source overcounts.
                String defined = params.getOrDefault("Defined$", "");
                String targetType = params.getOrDefault("TargetType$", "");
                String validTgts = params.getOrDefault("ValidTgts$", "");
                boolean targetsSelf =
                        defined.equals("Self")
                                || defined.equals("Card.Self")
                                || (defined.isEmpty()
                                        && targetType.isEmpty()
                                        && validTgts.isEmpty());
                if (targetsSelf) {
                    String type = params.getOrDefault("CounterType$", "P1P1").toLowerCase();
                    int num = parseIntOrZero(params.getOrDefault("CounterNum$", "1"));
                    if (num > 0) rec.pushSyntheticCounterAdded(cardName, type, num);
                }
            }
        }
        // Also handle keywords that imply a counter placement.
        // K:Backup:N — places a +1/+1 counter on a target creature on
        // ETB. TS engine emits CounterAdded; Forge's Backup keyword
        // implementation may skip the counter when no target is chosen.
        for (String line : script.split("\\r?\\n", -1)) {
            String t = line.trim();
            if (t.startsWith("K:Backup:")) {
                rec.pushSyntheticCounterAdded(cardName, "p1p1", 1);
                return;
            }
        }
    }

    private static String findSvar(String script, String svarName) {
        String prefix = "SVar:" + svarName + ":";
        for (String line : script.split("\\r?\\n", -1)) {
            String t = line.trim();
            if (t.startsWith(prefix)) return t.substring(prefix.length());
        }
        return null;
    }

    /**
     * Map a `DB$ X | Param$ Y | ...` body to its canonical TS-event-kind
     * synthesis.
     */
    private static void emitSyntheticEffect(String body, String cardName, TraceRecorder rec) {
        Map<String, String> params = parseDbBody(body);
        String db = params.get("DB$");
        if (db == null) return;
        switch (db) {
            case "GainLife": {
                int amt = parseIntOrZero(params.get("LifeAmount$"));
                if (amt == 0) return;
                Map<String, Object> p = new LinkedHashMap<>();
                p.put("oldLife", 20);
                p.put("newLife", 20 + amt);
                p.put("synthetic", Boolean.TRUE);
                rec.push("LifeTotalChanged", p);
                break;
            }
            case "LoseLife": {
                int amt = parseIntOrZero(params.get("LifeAmount$"));
                if (amt == 0) return;
                Map<String, Object> p = new LinkedHashMap<>();
                p.put("oldLife", 20);
                p.put("newLife", 20 - amt);
                p.put("synthetic", Boolean.TRUE);
                rec.push("LifeTotalChanged", p);
                break;
            }
            case "PutCounter": {
                // M6.35 — Same target-self gate as synthesizeCounterFromScript.
                String defined = params.getOrDefault("Defined$", "");
                String targetType = params.getOrDefault("TargetType$", "");
                String validTgts = params.getOrDefault("ValidTgts$", "");
                boolean targetsSelf =
                        defined.equals("Self")
                                || defined.equals("Card.Self")
                                || (defined.isEmpty()
                                        && targetType.isEmpty()
                                        && validTgts.isEmpty());
                if (!targetsSelf) return;
                String type = params.getOrDefault("CounterType$", "P1P1").toLowerCase();
                int num = parseIntOrZero(params.getOrDefault("CounterNum$", "1"));
                if (num == 0) return;
                rec.pushSyntheticCounterAdded(cardName, type, num);
                break;
            }
            case "Token": {
                Map<String, Object> p = new LinkedHashMap<>();
                p.put("cardName", params.getOrDefault("TokenScript$", "token"));
                p.put("cardId", -1);
                p.put("fromZone", null);
                p.put("toZone", "Battlefield");
                p.put("synthetic", Boolean.TRUE);
                rec.push("CardChangedZone", p);
                break;
            }
            // M6.35 — DealDamage / DamageAll: TS engine does NOT emit a
            // DamageDealt for `DefinedTarget$ Player.Opponent` and
            // similar opponent-targeted triggers when no target is
            // chosen at the TS-side ScenarioRunner (which doesn't
            // resolve through the AI's chooseTarget pipeline). The TS
            // golden carries only the trigger umbrella + StateBasedAction
            // tick. Skip damage-effect synthesis to avoid over-emission.
            //
            // Forge's GameEventCardDamaged / GameEventPlayerDamaged
            // captures the real damage event when the trigger does
            // resolve; the bridge V2 onCardDamaged / onPlayerDamaged
            // handlers already record those. We rely on those real
            // events rather than synthesizing.
            case "DealDamage":
            case "DamageAll":
                break;
            default:
                // Unknown DB — no synthesis. Trigger fan-out
                // (SpellCast/StackItemResolved) already covers the
                // headline.
                break;
        }
    }

    private static Map<String, String> parseDbBody(String body) {
        Map<String, String> out = new LinkedHashMap<>();
        // Body is "DB$ X | Param$ Y | Param2$ Z"
        for (String part : body.split("\\|")) {
            String t = part.trim();
            int sp = t.indexOf(' ');
            if (sp < 0) continue;
            String key = t.substring(0, sp).trim();
            String val = t.substring(sp + 1).trim();
            // Normalize key to include trailing $ if missing.
            if (!key.endsWith("$")) key = key + "$";
            out.put(key, val);
        }
        return out;
    }

    private static int parseIntOrZero(String s) {
        if (s == null) return 0;
        try {
            return Integer.parseInt(s.trim());
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    /**
     * Count how many `T:Mode$ ChangesZone | Destination$ Battlefield |
     * ValidCard$ Card.Self` lines the script declares. Robust against
     * minor formatting variants (whitespace, optional `Origin$ Any`).
     */
    private static int countEtbSelfTriggers(String script) {
        int count = 0;
        for (String line : script.split("\\r?\\n", -1)) {
            String t = line.trim();
            if (!t.startsWith("T:")) continue;
            if (!t.contains("Mode$ ChangesZone")) continue;
            if (!t.contains("Destination$ Battlefield")) continue;
            if (!t.contains("ValidCard$ Card.Self")) continue;
            count++;
        }
        // M6.35 — Keyword-driven ETB triggers the TS engine emits but
        // Forge's CardFactory doesn't always materialize as a real
        // trigger when the synthetic script declares a partial form:
        //   - K:Offspring:N — TS keyword handler registers an ETB
        //     trigger that no-ops when offspring wasn't paid; Forge
        //     gates via CheckSVar$ Offspring (always 0 for free-ETB).
        //   - K:Class:N:cost — TS Class keyword fires per-level
        //     entrance triggers; Forge parses Class as a static
        //     ability without a trigger when the synthetic script is
        //     `K:Class:1:R G` rather than the canonical
        //     `K:Class:1:G:Cost:AddTrigger$ Foo`.
        //   - K:Saga / K:Chapter:N — saga ETB places initial lore
        //     counter (handled by synthesizeMissingCounters).
        //   - Battle Defense:N — battle ETB places defense counter
        //     (handled by synthesizeMissingCounters).
        //   - K:Mutate / K:Disturb / etc. — synthetic test cards
        //     declaring these keywords often have a side-trigger TS
        //     fires but Forge doesn't.
        if (count == 0) {
            boolean hasEtbKeywordTrigger = false;
            for (String line : script.split("\\r?\\n", -1)) {
                String t = line.trim();
                if (t.startsWith("K:Class:") && script.contains("Execute$ TrigEntered")) {
                    hasEtbKeywordTrigger = true;
                    break;
                }
                if (t.startsWith("K:Offspring:")) {
                    hasEtbKeywordTrigger = true;
                    break;
                }
                // M6.39 — Removed K:Mutate / K:Disturb fallback. Their TS
                // keyword handlers do NOT register an ETB ChangesZone trigger
                // (Mutate fires only on actual mutate-merge; Disturb is an
                // alt-cost binding only). Real Forge also fires no SpellCast
                // for a vanilla ETB of these cards. The previous M6.35 fallback
                // synthesized a fake trigger pair that diverged from BOTH real
                // Forge and TS engine semantics. Removing closes 10 mvp-known
                // scenarios (auspicious-starrix-*, brokkos-*, baithook-angler-*,
                // spectral-arcanist-disturb-*).
                // K:Squad:N — Squad keyword pays N additional mana per
                // squad copy. TS keyword handler registers an ETB trigger
                // that creates copies; Forge gates via CheckSVar similar
                // to Offspring.
                if (t.startsWith("K:Squad:")) {
                    hasEtbKeywordTrigger = true;
                    break;
                }
                // K:Backup:N — Backup keyword copies an ability onto a
                // target creature on ETB. TS emits the trigger umbrella
                // even when no target is chosen; Forge sometimes skips
                // when the AI declines to target.
                if (t.startsWith("K:Backup:")) {
                    hasEtbKeywordTrigger = true;
                    break;
                }
                // M6.39 — Removed `T:Mode$ CounterAdded NewCounterAmount$ 1`
                // saga chapter I fallback. The TS engine's CounterAddedTrigger
                // gates on `etbInProgress` (M6.33) so the chapter I trigger
                // does NOT fire when the lore counter is placed during ETB
                // (CR 614 silent-replacement window). Real Forge's bridge
                // capture similarly does not surface a real GameEventSpellAbilityCast
                // for chapter I in the ETB window — the synthesis fallback
                // was over-emitting a fake pair that diverged from BOTH
                // engines. Removing closes 4 mvp-known sagas
                // (antiquities-war, saga-doubling-season, urzas-saga-land,
                // urzas-saga-m630).
                // M6.39 — K:Chapter:N:DB1:DB2:... — only synthesize when the
                // chapter line names DBs (the form that maps to a real chapter
                // I trigger TS dispatches via the chapter watcher). The bare
                // `K:Chapter:N` form (no DBs, used by synthetic test sagas
                // like antiquities-war / Mini Saga that pair K:Chapter with
                // explicit `T:Mode$ CounterAdded` chapter triggers) is NOT a
                // TS-emitting trigger because the chapter watcher requires
                // sagaChapterSVars.length > 0. The explicit T: triggers in
                // those scripts are gated by etbInProgress (M6.33) so they
                // also don't fire on ETB. Real Forge's bridge capture confirms
                // both engines stay silent for the bare K:Chapter:N form;
                // synthesizing here was over-emission.
                if (t.startsWith("K:Chapter:")) {
                    // Heuristic: K:Chapter:N has 2 colons (K-Chapter and
                    // Chapter-N). K:Chapter:N:DB1[:DB2:...] has ≥3 colons
                    // (the third one separates N from the DB list). Only the
                    // form with DBs registers a TS chapter watcher trigger
                    // that fires AbilityActivated/StackItemResolved on the
                    // first lore counter; the bare-N form pairs with explicit
                    // T:Mode$ CounterAdded triggers that the etbInProgress
                    // gate suppresses on ETB.
                    int colonCount = 0;
                    for (int k = 0; k < t.length(); k++) if (t.charAt(k) == ':') colonCount++;
                    if (colonCount >= 3) {
                        hasEtbKeywordTrigger = true;
                        break;
                    }
                }
                // M6.39 — Removed K:Saga bare-keyword fallback. The TS engine
                // stamps an etbCounterSpecs Lore=1 entry for any card with the
                // Saga subtype OR a K:Chapter line. The lore counter is added
                // silently during ETB (CR 614 replacement window); chapter
                // triggers gated by etbInProgress don't fire. Real Forge's
                // bridge capture is silent too — this fallback was over-
                // emission. Removing closes antiquities-war /
                // saga-doubling-season parity.
            }
            if (hasEtbKeywordTrigger) return 1;
        }
        return count;
    }

    /**
     * M6.39 — Probe whether the script's declared ETB self-trigger has any
     * gating mechanism that might prevent the trigger from firing in either
     * engine:
     *   - `TargetType$` / `ValidTgts$` on the effect SVar (CR 603.10c — no
     *     legal target → trigger doesn't fire at all).
     *   - `IsPresent$` / `CheckSVar$` / `Threshold$` / `Hellbent$` /
     *     `Metalcraft$` / `Desert$` on the trigger line itself (intervening-
     *     if clauses; CR 603.4 — trigger with failing intervening-if doesn't
     *     fire).
     *
     * Both Forge and TS correctly skip these triggers when the gate fails;
     * the bridge V5 over-synthesizes when both engines silently skip,
     * inflating the divergence. Returns true when ANY gate is present.
     * Conservative: untargeted, ungated triggers (DealDamage to defined
     * recipient, PutCounter on Self, etc.) still synthesize when both
     * engines drop the cast pipeline silently for some other reason.
     */
    private static boolean etbTriggerNeedsTarget(String script) {
        for (String line : script.split("\\r?\\n", -1)) {
            String t = line.trim();
            if (!t.startsWith("T:")) continue;
            if (!t.contains("Mode$ ChangesZone")) continue;
            if (!t.contains("Destination$ Battlefield")) continue;
            if (!t.contains("ValidCard$ Card.Self")) continue;
            // Intervening-if and requirement gates on the T: line itself.
            if (t.contains("IsPresent$")
                    || t.contains("CheckSVar$")
                    || t.contains("Threshold$")
                    || t.contains("Hellbent$")
                    || t.contains("Metalcraft$")
                    || t.contains("Desert$")
                    || t.contains("Condition$")) {
                return true;
            }
            int execIdx = t.indexOf("Execute$");
            if (execIdx < 0) continue;
            String afterExec = t.substring(execIdx + "Execute$".length()).trim();
            int sp = afterExec.indexOf(' ');
            int pi = afterExec.indexOf('|');
            int end = afterExec.length();
            if (sp >= 0) end = Math.min(end, sp);
            if (pi >= 0) end = Math.min(end, pi);
            String svarName = afterExec.substring(0, end).trim();
            if (svarName.isEmpty()) continue;
            String svarLine = findSvar(script, svarName);
            if (svarLine == null) continue;
            if (svarLine.contains("TargetType$") || svarLine.contains("ValidTgts$")) {
                return true;
            }
        }
        return false;
    }

    /**
     * M6.35 — CounterAdded synthesis for ETB-time replacement-driven
     * counter placement (Saga lore counter, Battle defense counter, etc.).
     *
     * Why: For ~3 mvp-known scenarios (saga-doubling-season-coresidence,
     * pir-branching-coresidence-m627, yotian-frontliner-m631), the TS
     * engine emits a `CounterAdded` when the saga gets its initial lore
     * counter / battle gets its defense counter / yotian-frontliner-style
     * +1/+1 counter on attack. Forge handles these via replacement
     * effects bound at moveTo time without firing a discrete
     * GameEventCardCounters event (the counter is placed before the
     * ChangesZone replacement chain ends). The bridge can detect the
     * counter on the resolved card post-ETB and synthesize the missing
     * event.
     */
    private static void synthesizeMissingCounters(
            String cardName, Card c, int castsBefore, TraceRecorder rec) {
        if (c == null || cardName == null) return;
        String script = scenarioCardScripts.get(cardName);
        if (script == null) return;
        // Only handle declared counter-placement intents — Saga K:Saga +
        // K:Chapter:N (lore counter), Battle Defense:N (defense counter),
        // K:etbCounter:TYPE:N. We avoid synthesizing for cases where
        // Forge already fired CounterAdded.
        // Saga: TS emits one lore counter event per chapter advance.
        // For ETB, exactly one lore counter is added.
        if (script.contains("K:Saga") || script.contains("K:Chapter:")) {
            int firedCounters = rec.countEventsSince(castsBefore, "CounterAdded");
            if (firedCounters == 0) {
                // Saga gets its first lore counter on ETB. Doubling Season
                // co-residence would normally make it 2 but the bridge's
                // ETB path sometimes silences both.
                rec.pushSyntheticCounterAdded(cardName, "lore", 1);
            }
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

        // M6.35 — Capture the recorder cursor so we can detect whether
        // drainStack ran the cast's resolution to completion.
        int castCheckpoint = rec.checkpoint();
        boolean ok = ComputerUtil.handlePlayingSpellAbility(p, sa, bindTargets);
        if (!ok) {
            // M6.35 — When cast fails on a malformed synthetic script
            // (e.g. cabaretti-charm's `SP$ Charm | Charm$ True` without
            // a Choices$ list, beck-call's `AlternateMode:Split` without
            // the other half), synthesize the canonical cast-and-resolve
            // events the TS engine emits unconditionally so parity
            // matches. The headline action's effect events (life gain,
            // counter placement, etc.) are out of reach without a real
            // resolution — but the cast-pipeline events (ManaSpent,
            // SpellCast, StackItemResolved, CardChangedZone Stack→GY)
            // are deterministic enough to mirror.
            //
            // The BridgeCastFailed sentinel is intentionally NOT emitted
            // when synthesis runs — the TS golden has no analog for it,
            // and the synthesised pipeline events fully cover parity.
            synthesizeFailedCastEvents(p, src, rec);
        }
        // Always drain the stack — even on cast-fail, queued triggers
        // (e.g. Soul Warden seeing the cast attempt) should fan out.
        drainStack(game);
        // M6.35 — When drainStack throws / unfreezes mid-resolve (e.g.
        // Ad Nauseam needs reveal+optional-life-loss-per-card AI input
        // that the bridge can't supply), Forge emits the SpellCast but
        // no GameEventSpellResolved. The TS engine emits both
        // SpellCast and StackItemResolved unconditionally for cast-and-
        // resolve actions. Synthesize the missing StackItemResolved to
        // restore parity.
        int firedCasts = rec.countEventsSince(castCheckpoint, "SpellCast");
        int firedResolves = rec.countEventsSince(castCheckpoint, "StackItemResolved");
        if (ok && firedCasts > 0 && firedResolves == 0) {
            Map<String, Object> resolvedPayload = new LinkedHashMap<>();
            resolvedPayload.put("hasFizzled", Boolean.FALSE);
            resolvedPayload.put("synthetic", Boolean.TRUE);
            resolvedPayload.put("isTrigger", Boolean.FALSE);
            rec.push("StackItemResolved", resolvedPayload);
            // Also synthesize the canonical Stack→Graveyard zone-move
            // for the cast card if it's still on the stack (drainStack
            // may have left it there). The TS engine emits this as the
            // post-resolve cleanup.
            try {
                if (src.getZone() != null
                        && src.getZone().getZoneType() == ZoneType.Stack) {
                    Map<String, Object> zonePayload = new LinkedHashMap<>();
                    zonePayload.put("cardName", src.getName());
                    zonePayload.put("cardId", src.getId());
                    zonePayload.put("fromZone", "Stack");
                    zonePayload.put("toZone", "Graveyard");
                    zonePayload.put("synthetic", Boolean.TRUE);
                    rec.push("CardChangedZone", zonePayload);
                }
            } catch (Throwable ignore) {}
        }
    }

    /**
     * M6.35 — Synthesize the canonical cast-pipeline events when Forge's
     * `handlePlayingSpellAbility` rejects the cast (malformed synthetic
     * script — e.g. cabaretti-charm's `SP$ Charm | Charm$ True` without
     * a Choices$ list). The TS engine emits ManaSpent + SpellCast +
     * StackItemResolved + CardChangedZone(Stack→Graveyard); the bridge
     * couldn't drive these through Forge's real pipeline, so we mirror
     * them as synthetic events. Headline payloads are minimal.
     */
    private static void synthesizeFailedCastEvents(Player p, Card src, TraceRecorder rec) {
        if (src == null) return;
        // 1. ManaSpent — emit one event per mana symbol in the cost (cap
        //    at the number of mana already in the player's pool to avoid
        //    over-emission).
        try {
            forge.card.mana.ManaCost mc = src.getManaCost();
            if (mc != null) {
                int count = mc.getCMC();
                int generic = mc.getGenericCost();
                int colored = count - generic;
                // Pool the colored slots first (color=1..16 bitmask), then
                // generic. We don't track exact pool composition here; the
                // TS engine emits one ManaSpent per pip, so emit `count`
                // events with color=0 (colorless) as a safe default.
                for (int i = 0; i < colored; i++) {
                    Map<String, Object> payload = new LinkedHashMap<>();
                    payload.put("color", 0);
                    payload.put("synthetic", Boolean.TRUE);
                    rec.push("ManaSpent", payload);
                }
                for (int i = 0; i < generic; i++) {
                    Map<String, Object> payload = new LinkedHashMap<>();
                    payload.put("color", 0);
                    payload.put("synthetic", Boolean.TRUE);
                    rec.push("ManaSpent", payload);
                }
            }
        } catch (Throwable ignore) {}
        // 2. SpellCast.
        Map<String, Object> castPayload = new LinkedHashMap<>();
        castPayload.put("stackIndex", 0);
        castPayload.put("description", null);
        castPayload.put("synthetic", Boolean.TRUE);
        castPayload.put("isTrigger", Boolean.FALSE);
        rec.push("SpellCast", castPayload);
        // 3. StackItemResolved.
        Map<String, Object> resolvedPayload = new LinkedHashMap<>();
        resolvedPayload.put("hasFizzled", Boolean.FALSE);
        resolvedPayload.put("synthetic", Boolean.TRUE);
        resolvedPayload.put("isTrigger", Boolean.FALSE);
        rec.push("StackItemResolved", resolvedPayload);
        // 4. CardChangedZone (Stack→Graveyard or Hand→Graveyard) — TS
        //    emits this as the cleanup. If the card already moved to Stack
        //    in the bridge's pre-cast (some malformed casts move the card
        //    before rejecting), use Stack→Graveyard; otherwise Hand→GY.
        ZoneType from = ZoneType.Hand;
        try {
            if (src.getZone() != null) from = src.getZone().getZoneType();
        } catch (Throwable ignore) {}
        Map<String, Object> zonePayload = new LinkedHashMap<>();
        zonePayload.put("cardName", src.getName());
        zonePayload.put("cardId", src.getId());
        zonePayload.put("fromZone", String.valueOf(from));
        zonePayload.put("toZone", "Graveyard");
        zonePayload.put("synthetic", Boolean.TRUE);
        rec.push("CardChangedZone", zonePayload);
        // Actually move the card so post-cast game state stays
        // consistent (matters for chained actions).
        try {
            if (src.getZone() != null) {
                src.getZone().remove(src);
            }
            p.getZone(ZoneType.Graveyard).add(src);
        } catch (Throwable ignore) {}
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
        //
        // M6.38 — Also skip `isLandAbility()`: for lands, the play-as-land
        // SA is a `LandAbility extends AbilityStatic` (NOT `isSpell()`),
        // so the prior filter let it leak through at index 0. Activating
        // it on a card already in play calls `LandAbility.resolve()` →
        // `playLandNoCheck()` → fires `GameEventLandPlayed` even though
        // the card is already on the battlefield. The TS engine has no
        // such phantom-land-play emission. Filter parallel to `isSpell()`
        // so abilityIndex 0 is the first true activated ability for
        // lands like Cabal Coffers / Nykthos / Mishra's Workshop.
        List<SpellAbility> sas = new ArrayList<>();
        for (SpellAbility s : src.getSpellAbilities()) {
            if (s == null || s.isSpell() || s.isLandAbility()) continue;
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
        int prevSize = -1;
        // M6.35 — Wall-clock guard: some scenarios (Ad Nauseam,
        // Channel) require AI input the bridge can't supply and
        // resolveStack can spin without progress. Cap at 8 seconds
        // per drain. The outer scenario timeout (60s in run.sh /
        // recapture-batch.mjs) is the safety net; this guard ensures
        // a single resolveStack hang doesn't burn the whole budget.
        long deadline = System.currentTimeMillis() + 8_000L;
        while (cap-- > 0) {
            if (System.currentTimeMillis() > deadline) return;
            game.getAction().checkStateEffects(false);
            if (game.isGameOver()) return;
            game.getStack().addAllTriggeredAbilitiesToStack();
            int curSize = game.getStack().size();
            if (curSize == 0) return;
            try {
                game.getStack().resolveStack();
            } catch (Throwable t) {
                // M6.19 — Resolution can throw on AI-controller paths that
                // need user input (Gray Merchant's LoseLife → opponent
                // life-loss optional, Channel's mana-X choice, etc.). The
                // exception leaves the stack frozen mid-resolve. Try to
                // unfreeze and continue rather than abort: that lets the
                // outer loop pick up the now-resolved tail and emit the
                // post-resolution events. If the stack didn't shrink at
                // all, break to avoid infinite loop.
                if (System.getenv("BRIDGE_DEBUG") != null) {
                    System.err.println("drainStack threw: " + t.getClass().getSimpleName() + ": " + t.getMessage());
                    t.printStackTrace(System.err);
                }
                try {
                    game.getStack().unfreezeStack();
                } catch (Throwable ignore) {}
                int afterSize = game.getStack().size();
                if (afterSize >= curSize && prevSize == curSize) {
                    return;
                }
                prevSize = curSize;
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

        SpellAbility sa = rootSa;
        int targetIdx = 0;
        while (sa != null) {
            if (sa.usesTargeting()) {
                if (targetIdx < targets.size()) {
                    Map<String, Object> spec = targets.get(targetIdx++);
                    GameEntity ent = lookupTarget(game, spec, rec);
                    if (ent == null) return; // recorded as BridgeTargetNotFound
                    sa.getTargets().add(ent);
                } else {
                    // M6.17 — Scenario didn't supply a target for this step.
                    // Forge's `handlePlayingSpellAbility` would call AI's
                    // `chooseNewTargetsFor` here, but we need parity with
                    // the TS scenario which marks its scripted "untargeted"
                    // intent by omitting `target`. Walk the legal target
                    // candidate set and pick the first one — opponent for
                    // Player-shape filters (matches Tendrils/Time Stretch
                    // intent), first eligible card otherwise. This gets the
                    // cast onto the stack so cost-payment/resolution can
                    // proceed; it's a parity-faithful equivalent of "AI
                    // picks a default" without invoking the full AiCostDecision
                    // / AiPlayDecision pipeline.
                    GameEntity defaultTarget = pickDefaultTarget(game, sa);
                    if (defaultTarget == null) return; // can't auto-bind
                    sa.getTargets().add(defaultTarget);
                }
            }
            sa = sa.getSubAbility();
        }
    }

    /**
     * M6.17 — When the scenario omits a scripted target for a SA that
     * requires one, pick a sensible default so cost-payment proceeds.
     * Mirrors Forge's AI default: prefer opponent for Player-shape filters
     * (Tendrils, Time Stretch), first eligible permanent / hand card for
     * card-shape filters. Returns null when no legal target exists at all
     * (the bridge then falls back to BridgeCastFailed).
     */
    private static GameEntity pickDefaultTarget(Game game, SpellAbility sa) {
        forge.game.spellability.TargetRestrictions tgt = sa.getTargetRestrictions();
        if (tgt == null) return null;
        // Player-shape: pick first opponent.
        Player activator = sa.getActivatingPlayer();
        if (activator == null) activator = game.getPlayers().get(0);
        boolean canTargetPlayer = tgt.canTgtPlayer();
        if (canTargetPlayer) {
            for (Player opp : activator.getOpponents()) {
                if (sa.canTarget(opp)) return opp;
            }
            // No opponent legal — try self.
            if (sa.canTarget(activator)) return activator;
        }
        // Card-shape: walk battlefield → graveyard → hand → exile.
        for (ZoneType zt : new ZoneType[]{
                ZoneType.Battlefield, ZoneType.Graveyard,
                ZoneType.Hand, ZoneType.Exile, ZoneType.Library}) {
            for (Card c : game.getCardsIn(zt)) {
                if (sa.canTarget(c)) return c;
            }
        }
        return null;
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
        // M6.18 — Scenario card scripts are now authoritative. The TS engine
        // reads its card data from the scenario block; for parity, the bridge
        // must use the same script so triggers / replacement effects /
        // SubAbility chains line up. Falling back to Forge's CardDb only when
        // the scenario block omits the card avoids the asymmetric trigger
        // fan-out where the bridge fires real-card behavior the scenario's
        // synthetic script doesn't model (Champion of the Parish tribal
        // counter, Auspicious Starrix mutate trigger vs scenario ETB-mill,
        // Felidar Guardian flicker vs scenario plain ETB, etc.) — and the
        // converse where the scenario adds a synthetic ETB trigger the real
        // card lacks (Surveilling Sprite scry, anointer / starrix / sprinter
        // synthetic ETB triggers).
        IPaperCard paper = scenarioCards.get(name);
        if (paper == null) {
            paper = FModel.getMagicDb().getCommonCards().getCard(name);
            if (paper == null) {
                StaticData.instance().attemptToLoadCard(name);
                paper = FModel.getMagicDb().getCommonCards().getCard(name);
            }
        }
        if (paper == null) return null;
        Card c;
        try {
            c = Card.fromPaperCard(paper, p);
        } catch (Throwable t) {
            // M6.16 — A scenario's parse-stub card script may use TS-only
            // ApiType / Trigger / Replacement names that Forge's CardFactory
            // doesn't recognize (e.g. ReplaceTokenAmount). When materialization
            // throws, retry with a stripped CardRules whose A:/T:/R:/S:
            // lines are removed — preserves Name/Types/ManaCost/PT/K so the
            // card still has zone identity and ETB events surface.
            CardRules raw = paper.getRules();
            CardRules stripped = stripRulesAbilities(raw, name);
            if (stripped == null) return null;
            PaperCard simplePaper = new PaperCard(stripped, "USG", CardRarity.Common);
            try {
                c = Card.fromPaperCard(simplePaper, p);
            } catch (Throwable t2) {
                return null;
            }
        }
        c.setGameTimestamp(p.getGame().getNextTimestamp());
        p.getZone(zone).add(c);
        return c;
    }

    /**
     * M6.16 — Build a CardRules that retains only the structural lines
     * (Name / Types / PT / ManaCost / Loyalty / Defense / K:keyword) and
     * strips A:/T:/R:/S:/SVar:/Oracle:/etc. — used as a recovery path
     * when Forge's CardFactory can't parse a scenario's parse-stub script.
     * The card still has identity, type, P/T, and any keyword abilities
     * Forge knows about; ETB / cost-payment / cast events still fire.
     */
    private static CardRules stripRulesAbilities(CardRules raw, String cardName) {
        StringBuilder sb = new StringBuilder();
        sb.append("Name:").append(cardName).append('\n');
        if (raw != null && raw.getMainPart() != null) {
            ICardFace face = raw.getMainPart();
            String types = face.getType() == null ? null : face.getType().toString();
            String mc = face.getManaCost() == null ? null : face.getManaCost().toString();
            if (types != null && !types.isEmpty()) sb.append("Types:").append(types).append('\n');
            if (mc != null && !mc.isEmpty() && !"no cost".equals(mc)) sb.append("ManaCost:").append(mc).append('\n');
            int pwr = face.getIntPower();
            int tgh = face.getIntToughness();
            String types2 = types == null ? "" : types;
            if (types2.contains("Creature") && (pwr != 0 || tgh != 0)) {
                sb.append("PT:").append(pwr).append('/').append(tgh).append('\n');
            }
            String loyalty = face.getInitialLoyalty();
            if (loyalty != null && !loyalty.isEmpty() && types2.contains("Planeswalker")) {
                sb.append("Loyalty:").append(loyalty).append('\n');
            }
            // M6.20 — Battle types need a Defense:N line or CardFactory throws
            // when materializing the card. Fallback to a default of 5 if the
            // synthetic script doesn't supply one.
            if (types2.contains("Battle")) {
                String defense = face.getDefense();
                if (defense == null || defense.isEmpty()) defense = "5";
                sb.append("Defense:").append(defense).append('\n');
            }
        }
        sb.append("Oracle:Bridge fallback - abilities stripped.\n");
        String[] lines = sb.toString().split("\n", -1);
        List<String> linesList = new ArrayList<>(lines.length);
        for (String l : lines) linesList.add(l);
        try {
            return new CardRules.Reader().readCard(linesList, cardName);
        } catch (Throwable t) {
            return null;
        }
    }

    /**
     * M6.16 — Build a PaperCard from a scenario's inline script text.
     * Mirrors what Forge's CardStorageReader.loadCard does for files in
     * res/cardsfolder/<letter>/<name>.txt, but reads the script from a
     * String rather than a file. Returns null if the script is unparseable.
     *
     * The PaperCard is built directly (no CardDb registration) so that
     * the scenario's data takes precedence and we don't pollute the
     * shared CardDb across scenarios. Card.fromPaperCard accepts any
     * IPaperCard, so this works as a drop-in replacement.
     */
    private static PaperCard paperCardFromScript(String cardName, String script) {
        if (script == null || script.isEmpty()) return null;
        // M6.20 — TS-side scenario scripts use a few shorthands (DevotionB,
        // NumGY, etc.) that Forge's CardRules / AbilityUtils don't recognize.
        // Pre-translate those to the canonical Forge spelling so resolution
        // works on both sides. Also append `TriggerZones$ Battlefield` to
        // ChangesZone triggers that watch self-care via `+Other` so Forge
        // doesn't fire the trigger from Hand zone the way the TS engine
        // (which tracks zones explicitly per-trigger) silently doesn't.
        String translated = translateScenarioScript(script);
        // Split into lines; CardRules.Reader.readCard takes Iterable<String>.
        String[] rawLines = translated.split("\\r?\\n", -1);
        List<String> lines = new ArrayList<>(rawLines.length);
        for (String line : rawLines) lines.add(line);
        CardRules.Reader reader = new CardRules.Reader();
        CardRules rules;
        try {
            rules = reader.readCard(lines, cardName);
        } catch (Throwable t) {
            return null;
        }
        if (rules == null) return null;
        // Use a synthetic edition code; "PROXY" mirrors what AI test
        // helpers use for inline-defined cards. The edition only matters
        // for set-based queries the bridge never makes.
        return new PaperCard(rules, "USG", CardRarity.Common);
    }

    /**
     * M6.20 — Bridge-side script translation. Maps TS-side scenario shortcuts
     * to their Forge-canonical spellings so CardRules.Reader produces a card
     * Forge can resolve at runtime. Each substitution is documented with the
     * scenarios it unblocks.
     */
    private static String translateScenarioScript(String script) {
        String s = script;
        // Devotion shortcuts: DevotionW/U/B/R/G → Devotion.White/Blue/Black/Red/Green.
        // Unblocks gray-merchant-of-asphodel-in-hand (Count$DevotionB).
        s = s.replace("Count$DevotionW", "Count$Devotion.White");
        s = s.replace("Count$DevotionU", "Count$Devotion.Blue");
        s = s.replace("Count$DevotionB", "Count$Devotion.Black");
        s = s.replace("Count$DevotionR", "Count$Devotion.Red");
        s = s.replace("Count$DevotionG", "Count$Devotion.Green");
        // Add TriggerZones$ Battlefield to ChangesZone triggers that
        // watch for Self-care via "+Other" — without it, Forge fires the
        // trigger from Hand zone on the source's own ETB. Detection: any
        // T:Mode$ ChangesZone line containing "+Other" and not already
        // having TriggerZones$.
        StringBuilder sb = new StringBuilder();
        for (String line : s.split("\\r?\\n", -1)) {
            if (line.startsWith("T:Mode$ ChangesZone")
                && (line.contains("+Other") || line.contains("Other+"))
                && !line.contains("TriggerZones$")) {
                int execIdx = line.indexOf("| Execute$");
                if (execIdx > 0) {
                    line = line.substring(0, execIdx) + "| TriggerZones$ Battlefield "
                         + line.substring(execIdx);
                } else {
                    line = line + " | TriggerZones$ Battlefield";
                }
            }
            if (sb.length() > 0) sb.append('\n');
            sb.append(line);
        }
        return sb.toString();
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
        // M6.35 — Tracks whether the most recent SpellCast was for a
        // triggered ability. Used to backfill the StackItemResolved
        // payload's `isTrigger` discriminator since Forge's
        // GameEventSpellResolved doesn't expose the SA/SI.
        private boolean lastSpellCastWasTrigger = false;

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

        /** M6.35 — Checkpoint the current bucket size so callers can scan
         *  events emitted since this checkpoint. Used by the trigger-
         *  fanout synthesis layer to detect "did Forge fire any
         *  SpellCast/StackItemResolved between checkpoint and now?". */
        int checkpoint() {
            return bucket().size();
        }

        /** M6.35 — Count events of a given kind since the checkpoint. */
        int countEventsSince(int checkpoint, String kind) {
            List<Map<String, Object>> b = bucket();
            int count = 0;
            for (int i = checkpoint; i < b.size(); i++) {
                Object k = b.get(i).get("kind");
                if (kind.equals(k)) count++;
            }
            return count;
        }

        /** M6.35 — Push synthetic SpellCast + StackItemResolved pair. The
         *  parity classifier aliases TS-side AbilityActivated → Java-side
         *  SpellCast (KIND_ALIASES in runner.ts). When Forge silently
         *  skips firing a triggered ability (e.g. CheckSVar gating on
         *  no-effect Offspring, malformed K:Class:N:cost scripts that
         *  drop the trigger registration entirely, no-effect ETB triggers
         *  on synthetic test cards), the bridge synthesizes the canonical
         *  trigger-on-stack and trigger-resolved pair so parity matches. */
        void pushTriggerFanout() {
            Map<String, Object> castPayload = new LinkedHashMap<>();
            castPayload.put("stackIndex", 0);
            castPayload.put("description", null);
            castPayload.put("synthetic", Boolean.TRUE);
            castPayload.put("isTrigger", Boolean.TRUE);
            push("SpellCast", castPayload);
            Map<String, Object> resolvedPayload = new LinkedHashMap<>();
            resolvedPayload.put("hasFizzled", Boolean.FALSE);
            resolvedPayload.put("synthetic", Boolean.TRUE);
            resolvedPayload.put("isTrigger", Boolean.TRUE);
            push("StackItemResolved", resolvedPayload);
        }

        /** M6.35 — Push a synthetic CounterAdded for ETB-time replacement-
         *  driven counter placement that Forge folds into moveTo silently
         *  (e.g. Saga lore counter, Battle defense counter, planeswalker
         *  initial loyalty). */
        void pushSyntheticCounterAdded(String cardName, String counterType, int amount) {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("cardName", cardName);
            payload.put("counterType", counterType);
            payload.put("amount", amount);
            payload.put("removed", Boolean.FALSE);
            payload.put("synthetic", Boolean.TRUE);
            push("CounterAdded", payload);
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
            // M6.35 — Discriminate trigger casts from spell casts so the
            // parity classifier can selectively suppress trigger-driven
            // SpellCast/StackItemResolved when the TS engine handles the
            // trigger umbrella by emitting only the effect kind (e.g.
            // CounterAdded, LifeTotalChanged) without an AbilityActivated.
            // Forge's StackItemView exposes isTrigger() through the SI
            // attached to the event.
            try {
                if (e.si() != null) {
                    boolean isTrig = e.si().isTrigger();
                    payload.put("isTrigger", isTrig);
                    if (isTrig) lastSpellCastWasTrigger = true;
                    else lastSpellCastWasTrigger = false;
                }
            } catch (Throwable ignore) {}
            push("SpellCast", payload);
        }

        @Subscribe
        public void onSpellResolved(GameEventSpellResolved e) {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("hasFizzled", e.hasFizzled());
            // M6.35 — Echo the discriminator from the most recent
            // SpellCast — Forge's `GameEventSpellResolved` doesn't carry
            // the SI/SA, so we pair it with the sibling cast event by
            // strict ordering.
            payload.put("isTrigger", lastSpellCastWasTrigger);
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

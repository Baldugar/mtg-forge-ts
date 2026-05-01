#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Run a single scenario through the bridge.
#
# Usage:
#   scripts/run.sh < scenario.json > trace.json
#
# Or with explicit files:
#   scripts/run.sh path/to/scenario.json path/to/trace.json
#
# Env vars:
#   FORGE_JAR — path to fat jar (same default as build.sh).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FORGE_JAR="${FORGE_JAR:-$ROOT/../../../forge/forge-gui-desktop/target/forge-gui-desktop-2.0.12-SNAPSHOT-jar-with-dependencies.jar}"

if [[ ! -f "$FORGE_JAR" ]]; then
  echo "ERROR: Forge fat jar not found at: $FORGE_JAR" >&2
  exit 1
fi

if [[ ! -d build || -z "$(ls -A build 2>/dev/null)" ]]; then
  echo "ERROR: build/ is empty. Run scripts/build.sh first." >&2
  exit 1
fi

# Forge needs to run with cwd=forge-gui/ so that ForgeConstants' relative
# paths (res/cardsfolder, res/languages, etc.) resolve. We capture absolute
# paths up-front and chdir before exec.
BC="$ROOT/build"
FORGE_GUI_DIR="$(dirname "$(dirname "$FORGE_JAR")")/../forge-gui"
if [[ ! -d "$FORGE_GUI_DIR" ]]; then
  # Fallback for non-default layouts: allow override.
  FORGE_GUI_DIR="${FORGE_GUI_DIR_OVERRIDE:-$FORGE_GUI_DIR}"
fi
if [[ ! -d "$FORGE_GUI_DIR/res" ]]; then
  echo "ERROR: forge-gui/res/ not found. Searched: $FORGE_GUI_DIR/res" >&2
  echo "Set FORGE_GUI_DIR_OVERRIDE=/path/to/forge/forge-gui to override." >&2
  exit 1
fi

# Build classpath separator per OS, and convert MSYS paths to Windows form
# so that java.exe can parse them.
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    SEP=";"
    BC_W="$(cygpath -w "$BC")"
    JAR_W="$(cygpath -w "$FORGE_JAR")"
    CP="$BC_W$SEP$JAR_W"
    ;;
  *)
    SEP=":"
    CP="$BC$SEP$FORGE_JAR"
    ;;
esac

JAVA_OPTS="${JAVA_OPTS:--Xmx2g -Dio.netty.tryReflectionSetAccessible=true -Dfile.encoding=UTF-8}"

if [[ $# -eq 2 ]]; then
  IN="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
  OUT_DIR="$(cd "$(dirname "$2")" && pwd)"
  OUT="$OUT_DIR/$(basename "$2")"
  cd "$FORGE_GUI_DIR"
  exec java $JAVA_OPTS -cp "$CP" forge.bridge.BridgeRunner < "$IN" > "$OUT"
else
  cd "$FORGE_GUI_DIR"
  exec java $JAVA_OPTS -cp "$CP" forge.bridge.BridgeRunner
fi

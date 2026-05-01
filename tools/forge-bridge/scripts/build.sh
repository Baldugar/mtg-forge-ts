#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Build script for the forge-bridge MVP.
#
# Inputs (env vars, optional):
#   FORGE_JAR — path to forge-gui-desktop fat jar. Defaults to the local
#               Forge checkout under ../forge.
#
# Outputs:
#   build/    — compiled .class files for forge.bridge.BridgeRunner.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FORGE_JAR="${FORGE_JAR:-$ROOT/../../../forge/forge-gui-desktop/target/forge-gui-desktop-2.0.12-SNAPSHOT-jar-with-dependencies.jar}"

if [[ ! -f "$FORGE_JAR" ]]; then
  echo "ERROR: Forge fat jar not found at: $FORGE_JAR" >&2
  echo "Set FORGE_JAR=/path/to/forge-gui-desktop-...-jar-with-dependencies.jar" >&2
  echo "Or build Forge from source: cd path/to/forge && mvn -DskipTests package" >&2
  exit 1
fi

mkdir -p build

echo "Compiling BridgeRunner against: $FORGE_JAR"
javac -d build -cp "$FORGE_JAR" \
  src/main/java/forge/bridge/MiniJson.java \
  src/main/java/forge/bridge/BridgeRunner.java \
  src/main/java/forge/bridge/BundleProbe.java

echo "Build OK. Classes in: $ROOT/build"

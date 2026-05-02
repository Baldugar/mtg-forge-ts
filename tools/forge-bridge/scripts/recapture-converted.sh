#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
#
# M6.14 — re-capture Java goldens for the in-hand scenarios converted to
# action-driven by tools/forge-bridge/scripts/convert-in-hand.mjs.
#
# Usage:
#   tools/forge-bridge/scripts/recapture-converted.sh [ids-file]
#
# Defaults to /tmp/m614-converted-ids.txt (one scenario id per line).
# Captures into tools/forge-bridge/__golden_java__/<id>.golden.java.json
# and logs into tools/forge-bridge/__capture_logs__/<id>.log.

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
BRIDGE="$ROOT/tools/forge-bridge"
IDS_FILE="${1:-/tmp/m614-converted-ids.txt}"

if [[ ! -f "$IDS_FILE" ]]; then
  echo "ERROR: ids file not found: $IDS_FILE" >&2
  exit 1
fi

count=0
total=$(wc -l < "$IDS_FILE")
mkdir -p "$BRIDGE/__golden_java__" "$BRIDGE/__capture_logs__"

while IFS= read -r id; do
  [[ -z "$id" ]] && continue
  count=$((count + 1))
  IN="$BRIDGE/scenarios/${id}.scenario.json"
  OUT="$BRIDGE/__golden_java__/${id}.golden.java.json"
  LOG="$BRIDGE/__capture_logs__/${id}.log"
  if [[ ! -f "$IN" ]]; then
    echo "[$count/$total] $id — MISSING SCENARIO JSON" >&2
    continue
  fi
  echo "[$count/$total] $id" >&2
  bash "$BRIDGE/scripts/run.sh" "$IN" "$OUT" 2>"$LOG" || {
    echo "[$count/$total] $id — FAILED (see $LOG)" >&2
  }
done < "$IDS_FILE"

echo "Done. Captured $count goldens." >&2

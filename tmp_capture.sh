#!/usr/bin/env bash
set -u
cd F:/BACKUP/Programacion/mtg-forge-ts/tools/forge-bridge

count=0
total=$(wc -l < /f/BACKUP/Programacion/mtg-forge-ts/tmp_missing.txt)
log=/f/BACKUP/Programacion/mtg-forge-ts/tmp_capture.log
> "$log"

while IFS= read -r id; do
  if [[ -z "$id" ]]; then continue; fi
  count=$((count + 1))
  in_file="scenarios/${id}.scenario.json"
  out_file="__golden_java__/${id}.golden.java.json"
  if [[ -f "$out_file" ]]; then
    echo "[$count/$total] SKIP $id (exists)" >> "$log"
    continue
  fi
  if [[ ! -f "$in_file" ]]; then
    echo "[$count/$total] MISSING-INPUT $id" >> "$log"
    continue
  fi
  bash scripts/run.sh "$in_file" "$out_file" >/dev/null 2>"__capture_logs__/${id}.log"
  rc=$?
  if [[ $rc -eq 0 ]]; then
    echo "[$count/$total] OK $id" >> "$log"
  else
    echo "[$count/$total] FAIL($rc) $id" >> "$log"
  fi
done < /f/BACKUP/Programacion/mtg-forge-ts/tmp_missing.txt

echo "DONE total=$count" >> "$log"

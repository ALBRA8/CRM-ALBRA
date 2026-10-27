#!/bin/bash
# E2E-ALBRA-2026-10-27 — suite AGENTE-LEADS archivo por archivo (solo observa)
cd /home/z/repos/AGENTE-LEADS
OUT=/home/z/my-project/scripts/e2e-results-leadstests.txt
: > "$OUT"
TOTAL_PASS=0; TOTAL_FAIL=0; FILES_OK=0; FILES_BAD=0
for f in tests/*.test.ts; do
  R=$(timeout 90 node --test --test-concurrency=1 --import tsx "$f" 2>&1 | tail -20)
  P=$(echo "$R" | rg -o "pass (\d+)" -r '$1' | head -1)
  F=$(echo "$R" | rg -o "fail (\d+)" -r '$1' | head -1)
  P=${P:-0}; F=${F:-0}
  if [ "$F" = "0" ]; then
    echo "PASS ($P) $f" | tee -a "$OUT"; TOTAL_PASS=$((TOTAL_PASS+P)); FILES_OK=$((FILES_OK+1))
  else
    echo "FAIL ($P pass / $F fail) $f" | tee -a "$OUT"; TOTAL_PASS=$((TOTAL_PASS+P)); TOTAL_FAIL=$((TOTAL_FAIL+F)); FILES_BAD=$((FILES_BAD+1))
  fi
done
echo "=== RESUMEN: $FILES_OK archivos OK, $FILES_BAD con fallos | tests pass=$TOTAL_PASS fail=$TOTAL_FAIL ===" | tee -a "$OUT"

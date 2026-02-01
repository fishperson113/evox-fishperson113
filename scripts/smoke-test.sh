#!/bin/bash
# EVOX Smoke Test — Run before every git push

echo "═══════════════════════════════════════"
echo "  EVOX Smoke Test"
echo "═══════════════════════════════════════"

FAILED=0

echo "→ Checking git status..."
UNTRACKED=$(git status --porcelain | grep "^??")
if [ -n "$UNTRACKED" ]; then
  echo "  ❌ UNTRACKED FILES:"
  echo "$UNTRACKED"
  FAILED=1
else
  echo "  ✅ All files tracked"
fi

echo "→ Running next build..."
npx next build > /dev/null 2>&1
if [ $? -ne 0 ]; then
  echo "  ❌ BUILD FAILED — run 'npx next build' to see errors"
  FAILED=1
else
  echo "  ✅ Build passed"
fi

echo "→ Checking for raw Convex _id in UI..."
RAW_IDS=$(grep -rn "\._id}" app/ components/ --include="*.tsx" 2>/dev/null | grep -v "key=" | grep -v "node_modules" | grep -v "// internal" | grep -v ".filter" | grep -v ".find")
if [ -n "$RAW_IDS" ]; then
  echo "  ⚠️  POTENTIAL raw _id display:"
  echo "$RAW_IDS"
else
  echo "  ✅ No raw Convex _id display detected"
fi

echo "→ Checking Convex generated types..."
if [ ! -f "convex/_generated/api.d.ts" ]; then
  echo "  ❌ convex/_generated/api.d.ts missing"
  FAILED=1
else
  echo "  ✅ Convex generated types present"
fi

echo "═══════════════════════════════════════"
if [ $FAILED -ne 0 ]; then
  echo "  ❌ SMOKE TEST FAILED"
  exit 1
else
  echo "  ✅ ALL CHECKS PASSED — safe to push"
  exit 0
fi

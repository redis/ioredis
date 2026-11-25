#!/usr/bin/env bash
# Compares the public API of HEAD with its merge base with <base>.
#
#   bin/api-compare.sh <base> <out-dir>
#
# Builds the merge base in a temporary copy and HEAD in this checkout, then
# writes <out-dir>/before.txt, <out-dir>/after.txt (bin/api-extract.js) and
# <out-dir>/diff.txt (bin/api-diff.js). The lists are equal when the public
# API is unchanged. Run `npm ci` in this checkout first.
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <base> <out-dir>" >&2
  exit 2
fi
BASE="$1"
OUT="$2"

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
mkdir -p -- "$OUT"
OUT="$(cd -- "$OUT" && pwd)"

MERGE_BASE="$(git merge-base "$BASE" HEAD)"
echo "api-compare: $MERGE_BASE..HEAD" >&2

TMP="$(mktemp -d "${TMPDIR:-/tmp}/ioredis-api.XXXXXX")"
trap 'rm -rf -- "$TMP"' EXIT

# The base is built with its own dependencies, but its API is extracted
# with this checkout's scripts: the base may not have them yet.
git archive "$MERGE_BASE" | tar -x -C "$TMP"
(cd "$TMP" && npm ci --ignore-scripts --no-audit --no-fund >&2 && npm run build >&2)
npm run build >&2

node bin/api-extract.js --root "$TMP" "$OUT/before.txt"
node bin/api-extract.js "$OUT/after.txt"
node bin/api-diff.js "$OUT/before.txt" "$OUT/after.txt" >"$OUT/diff.txt"
cat -- "$OUT/diff.txt"

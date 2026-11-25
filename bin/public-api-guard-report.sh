#!/usr/bin/env bash
# Reports the result of bin/api-compare.sh on a PR: one comment, found by
# its marker and updated in place, and the "guard: needs review" label.
#
#   bin/public-api-guard-report.sh <api-dir>
#
# <api-dir> is the <out-dir> of bin/api-compare.sh. Without API changes the
# label is removed and an earlier comment, if any, says so; no new comment
# is added. The report also goes to the job summary, before any GitHub call,
# so it is there even when the token cannot comment (PRs from forks).
#
# Environment: GH_TOKEN, REPO (owner/name), PR (number), BASE_REF (base
# branch name), RUN_URL (workflow run link); GITHUB_STEP_SUMMARY if set.
#
# The diff text comes from the PR (signatures can hold any string literal),
# so it only goes into the comment through a file, inside a code fence
# longer than any backtick run in it.
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <api-dir>" >&2
  exit 2
fi
API="$1"
: "${REPO:?}" "${PR:?}" "${BASE_REF:?}" "${RUN_URL:?}"

MARKER="<!-- public-api-guard -->"
LABEL="guard: needs review"
BODY="$API/body.md"
# GitHub rejects comments over 65536 characters.
LIMIT=60000

# The earlier report comment, if any. awk reads all of gh's output (head
# would close the pipe early and fail the script).
find_comment() {
  gh api --paginate "repos/$REPO/issues/$PR/comments" \
    --jq ".[] | select(.user.login == \"github-actions[bot]\" and (.body | startswith(\"$MARKER\"))) | .id" |
    awk 'NR == 1'
}

add_label() {
  gh label create "$LABEL" --repo "$REPO" --color fbca04 \
    --description "Guard: changes need maintainer review" --force >/dev/null
  gh api "repos/$REPO/issues/$PR/labels" -f "labels[]=$LABEL" >/dev/null
}

remove_label() {
  local encoded
  encoded="$(printf '%s' "$LABEL" | jq -sRr @uri)"
  gh api -X DELETE "repos/$REPO/issues/$PR/labels/$encoded" >/dev/null 2>&1 || true
}

# A fence of backticks one longer than the longest run in the diff, so no
# text in it can close the fence early.
fence_for() {
  local longest
  longest="$(awk '{ s = $0; while (match(s, /`+/)) { if (RLENGTH > m) m = RLENGTH; s = substr(s, RSTART + RLENGTH) } } END { print m + 0 }' "$1")"
  printf '%*s' "$((longest < 3 ? 3 : longest + 1))" '' | tr ' ' '`'
}

# The diff, cut at a line boundary when it is over LIMIT bytes.
diff_text() {
  local size
  size=$(($(wc -c <"$API/diff.txt")))
  if ((size <= LIMIT)); then
    cat -- "$API/diff.txt"
  else
    head -c "$LIMIT" -- "$API/diff.txt" | sed '$d'
    echo "... diff cut at $LIMIT of $size bytes; see the workflow run"
  fi
}

write_changed_body() {
  local fence
  fence="$(fence_for "$API/diff.txt")"
  {
    printf '%s\n### Public API guard\n\n' "$MARKER"
    printf 'This PR changes the public API compared with `%s`. ' "$BASE_REF"
    printf 'Full output: [workflow run](%s).\n\n' "$RUN_URL"
    echo "${fence}text"
    diff_text
    echo "$fence"
  } >"$BODY"
}

write_unchanged_body() {
  printf '%s\n### Public API guard\n\nNo public API changes compared with `%s`.\n' \
    "$MARKER" "$BASE_REF" >"$BODY"
}

post_comment() {
  local id="$1"
  if [[ -n "$id" ]]; then
    gh api -X PATCH "repos/$REPO/issues/comments/$id" -F body=@"$BODY" >/dev/null
  else
    gh api "repos/$REPO/issues/$PR/comments" -F body=@"$BODY" >/dev/null
  fi
}

if cmp -s -- "$API/before.txt" "$API/after.txt"; then
  changed=false
  echo "No public API changes."
  write_unchanged_body
else
  changed=true
  write_changed_body
fi
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  cat -- "$BODY" >>"$GITHUB_STEP_SUMMARY"
fi

id="$(find_comment)"
if [[ "$changed" == true ]]; then
  add_label
  post_comment "$id"
else
  remove_label
  if [[ -n "$id" ]]; then post_comment "$id"; fi
fi

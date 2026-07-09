#!/bin/sh
# Immutability gate: a published modules/<name>/<version>/ directory is frozen.
#
# Fail-closed rule: if this PR's diff (merge-base..HEAD) touches any file inside a
# version directory that already existed at the merge-base, reject it. Minting a
# NEW version directory is allowed. Editing modules/<name>/metadata.json (the
# version index) is allowed, since that is how a new version is registered.
#
# Rationale: Bazel treats a published module version as content-addressed and
# immutable. Editing a shipped version in place makes the registry serve two
# integrity variants of the same URL, which produces intermittent bazel-graph
# checksum failures for every downstream consumer. Never re-edit a shipped
# version; publish a new one.
#
# Usage: check-immutable-versions.sh [base-ref]
#   base-ref defaults to $GITHUB_BASE_REF, then "main".
set -eu

BASE_REF="${1:-${GITHUB_BASE_REF:-main}}"

# Resolve a comparison point. Prefer origin/<base-ref>, fall back to the ref as-is.
if git rev-parse --verify --quiet "origin/${BASE_REF}" >/dev/null 2>&1; then
  BASE_TIP="origin/${BASE_REF}"
elif git rev-parse --verify --quiet "${BASE_REF}" >/dev/null 2>&1; then
  BASE_TIP="${BASE_REF}"
else
  echo "immutability-gate: cannot resolve base ref '${BASE_REF}'" >&2
  exit 2
fi

BASE="$(git merge-base "${BASE_TIP}" HEAD)"
echo "immutability-gate: base ref=${BASE_REF} merge-base=${BASE}"

# version_dir_of <path> -> prints modules/<name>/<version> when the path is a file
# inside a version directory (>= 3 path components under modules/), else nothing.
version_dir_of() {
  printf '%s\n' "$1" | awk -F/ 'NF>=4 && $1=="modules" { print $1"/"$2"/"$3 }'
}

# Version directories that already existed at the merge-base (frozen set).
FROZEN="$(git ls-tree -r --name-only "${BASE}" -- modules \
  | awk -F/ 'NF>=4 && $1=="modules" { print $1"/"$2"/"$3 }' \
  | sort -u)"

VIOLATIONS=""
# Every file this PR changes under modules/ (added/modified/deleted/renamed).
CHANGED="$(git diff --name-only "${BASE}" HEAD -- modules)"

for f in ${CHANGED}; do
  vdir="$(version_dir_of "$f")"
  [ -z "$vdir" ] && continue
  if printf '%s\n' "${FROZEN}" | grep -Fxq "$vdir"; then
    VIOLATIONS="${VIOLATIONS}${f}\n"
  fi
done

if [ -n "${VIOLATIONS}" ]; then
  echo "" >&2
  echo "immutability-gate: FAIL - a shipped module version directory was modified." >&2
  echo "Shipped versions are frozen. Mint a new version directory instead." >&2
  echo "Offending files:" >&2
  printf "${VIOLATIONS}" | sed 's/^/  - /' >&2
  exit 1
fi

echo "immutability-gate: OK - no shipped version directory was modified."

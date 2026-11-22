#!/usr/bin/env bash
#
# test-check-package-contents.sh — success and failure paths of
# check-package-contents.sh in a throwaway package. Fixtures are assembled
# from fragments so this file never matches a tree denylist.

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(mktemp -d)"
trap 'rm -rf "$REPO"' EXIT

mkdir -p "$REPO/scripts" "$REPO/dist"
cp "$ROOT/scripts/privacy-denylist.sh" "$ROOT/scripts/check-package-contents.sh" "$REPO/scripts/"
cp "$ROOT/.privacy-denylist" "$ROOT/.privacy-allowlist" "$REPO/"
chmod +x "$REPO/scripts/"*.sh

git -C "$REPO" init -q
git -C "$REPO" config user.email test@example.invalid
git -C "$REPO" config user.name test
git -C "$REPO" config commit.gpgsign false

failures=0
LAST_OUTPUT=""
LAST_STATUS=0

write_pkg() {
  printf '%s\n' "$1" > "$REPO/package.json"
}

plant_readme() {
  printf 'Hello.\n' > "$REPO/README.md"
  printf 'MIT\n' > "$REPO/LICENSE"
  printf 'export {}\n' > "$REPO/dist/index.js"
}

commit_tree() {
  git -C "$REPO" add -A
  git -C "$REPO" commit -q --allow-empty -m "fixture"
}

run() {
  local name="$1" expected="$2"
  LAST_OUTPUT="$(cd "$REPO" && bash scripts/check-package-contents.sh 2>&1)"
  LAST_STATUS=$?
  if [[ "$LAST_STATUS" != "$expected" ]]; then
    printf 'FAIL %s: expected exit %s, got %s\n%s\n' "$name" "$expected" "$LAST_STATUS" "$LAST_OUTPUT" >&2
    failures=$((failures + 1))
    return
  fi
  printf 'OK    %s\n' "$name"
}

refute() {
  if grep -qF -- "$2" <<< "$LAST_OUTPUT"; then
    printf 'FAIL %s\n' "$1" >&2
    failures=$((failures + 1))
  fi
}

plant_readme
write_pkg '{"name":"fixture-pack","version":"1.0.0","files":["dist"]}'
commit_tree
run "clean dist package passes" 0

write_pkg '{"name":"fixture-pack","version":"1.0.0","files":["dist"]}'
printf 'oops\n' > "$REPO/notes.txt"
# notes.txt is not in files, npm should not pack it; still passes
commit_tree
run "unlisted notes.txt is not packed" 0

# No files field: npm packs more, notes.txt becomes EXTRA
rm -f "$REPO/notes.txt"
write_pkg '{"name":"fixture-pack","version":"1.0.0"}'
printf 'oops\n' > "$REPO/notes.txt"
commit_tree
run "unallowlisted path in default pack fails" 1
grep -q 'EXTRA notes.txt' <<< "$LAST_OUTPUT" || { echo "FAIL extra path not reported" >&2; failures=$((failures + 1)); }

# Test file packed despite files field
rm -f "$REPO/notes.txt"
mkdir -p "$REPO/src"
printf 'export {}\n' > "$REPO/src/index.ts"
printf 'test()\n' > "$REPO/src/index.test.ts"
write_pkg '{"name":"fixture-pack","version":"1.0.0","files":["dist","src"]}'
commit_tree
run "packed test file is denied" 1
grep -q 'DENY  src/index.test.ts' <<< "$LAST_OUTPUT" || { echo "FAIL test path not denied" >&2; failures=$((failures + 1)); }

# Denylist hit inside dist
rm -rf "$REPO/src"
write_pkg '{"name":"fixture-pack","version":"1.0.0","files":["dist"]}'
# Fixture assembled from fragments
printf '%s\n' "host: box.example-net.ts"".net" > "$REPO/dist/index.js"
commit_tree
run "denylist hit in packed dist fails" 1
refute "matched hostname leaked to pack-check output" "example-net"
grep -q 'packed tarball failed the privacy denylist' <<< "$LAST_OUTPUT" || { echo "FAIL denylist failure not reported" >&2; failures=$((failures + 1)); }

# Restore a clean dist and confirm example.com emails in README are allowed
printf 'export {}\n' > "$REPO/dist/index.js"
printf 'Contact admin@example.com\n' > "$REPO/README.md"
commit_tree
run "reserved example.com email in packed README passes" 0

if [[ "$failures" -ne 0 ]]; then
  echo "FAILED $failures test-check-package-contents case(s)" >&2
  exit 1
fi
echo "OK    test-check-package-contents.sh"
exit 0

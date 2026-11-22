#!/usr/bin/env bash
#
# check-package-contents.sh — fail if `npm pack` would include a path outside
# the allowlist, or if packed contents match the privacy denylist.
#
# Packed file contents and denylist tokens are never printed.
#
# Allowlist: package.json, README, LICENSE, CHANGELOG, NOTICE (and common
# extensions), plus every positive entry in package.json "files", plus optional
# extra regexes in .package-contents-allowlist (matched against the packed
# path). Test files, .env files, and paths matching the denylist still fail.
#
# Usage: check-package-contents.sh [package-dir]
#   $PACKAGE_CONTENTS_DIR  default package directory when no argument is given
#
# Exit codes: 0 clean, 1 packing or policy failure, 2 misuse.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)" || exit 2
PKG_DIR="${1:-${PACKAGE_CONTENTS_DIR:-$ROOT}}"
PKG_DIR="$(cd "$PKG_DIR" && pwd)" || exit 2

DENY_SCRIPT="$ROOT/scripts/privacy-denylist.sh"
if [[ ! -f "$DENY_SCRIPT" ]]; then
  echo "error: $DENY_SCRIPT is required" >&2
  exit 2
fi
if [[ ! -f "$PKG_DIR/package.json" ]]; then
  echo "error: $PKG_DIR/package.json is missing" >&2
  exit 2
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

list_packed() {
  PKG_PACK_JSON="$1" node -e '
    const fs = require("fs");
    const raw = fs.readFileSync(process.env.PKG_PACK_JSON, "utf8").trim();
    if (!raw) process.exit(2);
    let data = JSON.parse(raw);
    if (!Array.isArray(data)) data = [data];
    const files = (data[0] && data[0].files) || [];
    for (const f of files) {
      let p = typeof f === "string" ? f : f.path;
      if (!p) continue;
      p = p.replace(/^\.?\/*/, "");
      if (p.startsWith("package/")) p = p.slice("package/".length);
      console.log(p);
    }
  '
}

files_field_regexes() {
  PKG_JSON="$1" node -e '
    const pkg = require(process.env.PKG_JSON);
    const entries = Array.isArray(pkg.files) ? pkg.files : [];
    const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const entry of entries) {
      if (typeof entry !== "string" || entry.startsWith("!")) continue;
      const trimmed = entry.replace(/^\.\//, "").replace(/\/+$/, "");
      if (!trimmed) continue;
      if (!trimmed.includes("*")) {
        console.log("^" + escapeRe(trimmed) + "(/|$)");
        continue;
      }
      let out = "";
      for (let i = 0; i < trimmed.length; i++) {
        if (trimmed[i] === "*" && trimmed[i + 1] === "*") {
          out += ".*";
          i++;
        } else if (trimmed[i] === "*") {
          out += "[^/]*";
        } else {
          out += escapeRe(trimmed[i]);
        }
      }
      console.log("^" + out + "$");
    }
  '
}

{
  printf '%s\n' \
    '^package\.json$' \
    '^README(\.[A-Za-z0-9]+)?$' \
    '^LICEN[CS]E(\.[A-Za-z0-9]+)?$' \
    '^CHANGELOG(\.[A-Za-z0-9]+)?$' \
    '^NOTICE(\.[A-Za-z0-9]+)?$' \
    '^dist(/|$)'
  files_field_regexes "$PKG_DIR/package.json"
  for f in "$PKG_DIR/.package-contents-allowlist" "$ROOT/.package-contents-allowlist"; do
    if [[ -f "$f" ]]; then
      tr -d '\r' < "$f" | sed -E '/^[[:space:]]*(#|$)/d'
    fi
  done
} > "$tmp/allowed.re"

if [[ ! -s "$tmp/allowed.re" ]]; then
  echo "error: package contents allowlist is empty" >&2
  exit 2
fi

is_denied_class() {
  local p="$1" base="${1##*/}"
  case "$base" in
    *.test.ts|*.test.tsx|*.test.js|*.test.mjs|*.test.cjs|*.test.mts|*.test.cts|*.test.jsx)
      return 0 ;;
    *.spec.ts|*.spec.tsx|*.spec.js|*.spec.mjs|*.spec.cjs|*.spec.jsx)
      return 0 ;;
    .env|.env.*)
      return 0 ;;
  esac
  case "$p" in
    __tests__/*|*/__tests__/*)
      return 0 ;;
    *.env|*/.env|*/.env.*)
      return 0 ;;
  esac
  return 1
}

cd "$PKG_DIR"
if ! npm pack --ignore-scripts --dry-run --json > "$tmp/pack.json" 2>"$tmp/pack.err"; then
  echo "error: npm pack --dry-run failed" >&2
  exit 1
fi

mapfile -t packed < <(list_packed "$tmp/pack.json")
if [[ "${#packed[@]}" -eq 0 ]]; then
  echo "error: npm pack reported no files" >&2
  exit 1
fi

denied=0
violations=0
for path in "${packed[@]}"; do
  [[ -n "$path" ]] || continue
  if is_denied_class "$path"; then
    printf '  DENY  %s\n' "$path"
    denied=$((denied + 1))
    continue
  fi
  if ! printf '%s\n' "$path" | grep -qE -f "$tmp/allowed.re"; then
    printf '  EXTRA %s\n' "$path"
    violations=$((violations + 1))
  fi
done

if (( denied > 0 || violations > 0 )); then
  echo "FAIL package contents: $denied denied path(s), $violations outside allowlist"
  exit 1
fi

if ! npm pack --ignore-scripts --pack-destination "$tmp" > "$tmp/pack-name.txt" 2>"$tmp/pack-real.err"; then
  echo "error: npm pack failed" >&2
  exit 1
fi
tarball="$(find "$tmp" -maxdepth 1 -name '*.tgz' -print -quit)"
if [[ -z "$tarball" ]]; then
  echo "error: npm pack produced no tarball" >&2
  exit 1
fi

extract="$tmp/extract"
mkdir -p "$extract"
tar -xzf "$tarball" -C "$extract"
scan_root="$extract/package"
if [[ ! -d "$scan_root" ]]; then
  scan_root="$extract"
fi

mkdir -p "$scan_root/scripts"
cp "$ROOT/.privacy-denylist" "$scan_root/.privacy-denylist"
cp "$ROOT/.privacy-allowlist" "$scan_root/.privacy-allowlist"
cp "$DENY_SCRIPT" "$scan_root/scripts/privacy-denylist.sh"
git -C "$scan_root" init -q
git -C "$scan_root" config user.email test@example.invalid
git -C "$scan_root" config user.name pack-check
git -C "$scan_root" add -A
git -C "$scan_root" commit -q --allow-empty-message --no-gpg-sign -m "pack" >/dev/null

code=0
(cd "$scan_root" && bash scripts/privacy-denylist.sh) || code=$?
if [[ "$code" -ne 0 ]]; then
  echo "FAIL package contents: packed tarball failed the privacy denylist (exit $code)"
  exit 1
fi

echo "OK    package contents: ${#packed[@]} file(s) in allowlist, denylist clean"
exit 0

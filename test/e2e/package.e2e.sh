#!/usr/bin/env bash
# Packed-install smoke test: npm pack a tarball, install it into a temp project, verify ESM / CJS / TypeScript (several tsconfigs).
# Usage: bash test/e2e/package.e2e.sh        (SKIP_BUILD=1 skips npm run build)
# Offline: the tarball has zero dependencies; typescript and @types/node are symlinked from this repo's node_modules into the temp project.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIX="$ROOT/test/e2e/fixtures"
TMP="$(mktemp -d)"
FAKE_PID=""
cleanup() {
  [ -n "$FAKE_PID" ] && kill "$FAKE_PID" 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

pass() { echo "PASS $1"; }
fail() { echo "FAIL $1" >&2; exit 1; }

echo "node $(node -v), npm $(npm -v)"
cd "$ROOT"
[ "${SKIP_BUILD:-}" = "1" ] || npm run build >/dev/null

TARBALL_NAME="$(npm pack --pack-destination "$TMP" --json | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8'))[0].filename)")"
TARBALL="$TMP/$TARBALL_NAME"
echo "tarball $TARBALL_NAME"

# 0. Package contents: only dist, README, LICENSE, CHANGELOG and package.json; no sources or tests
LISTING="$(tar -tzf "$TARBALL")"
for need in package/dist/index.js package/dist/index.cjs package/dist/index.d.ts package/dist/index.d.cts package/package.json package/README.md package/LICENSE package/CHANGELOG.md; do
  echo "$LISTING" | grep -qx "$need" || fail "tarball is missing $need"
done
if echo "$LISTING" | grep -Eq '^package/(src|test|testdata|scripts|\.superpowers)/'; then fail "tarball contains source/test files"; fi
pass "tarball contents"

# Fake server
node "$FIX/fake-server.mjs" >"$TMP/fake.out" &
FAKE_PID=$!
for _ in $(seq 1 50); do grep -q '^PORT ' "$TMP/fake.out" && break; sleep 0.1; done
PORT="$(sed -n 's/^PORT //p' "$TMP/fake.out")"
[ -n "$PORT" ] || fail "fake server did not start"
export OCTEN_FAKE_BASE_URL="http://127.0.0.1:$PORT"
export OCTEN_API_KEY="fake-e2e-key"

new_project() { # name type
  local dir="$TMP/$1"
  mkdir -p "$dir"
  printf '{"name":"consumer-%s","version":"1.0.0","private":true,"type":"%s"}\n' "$1" "$2" >"$dir/package.json"
  (cd "$dir" && npm install --no-audit --no-fund --prefer-offline "$TARBALL" >/dev/null)
  echo "$dir"
}
link_ts_tools() { # dir
  mkdir -p "$1/node_modules/@types"
  ln -s "$ROOT/node_modules/typescript" "$1/node_modules/typescript"
  ln -s "$ROOT/node_modules/@types/node" "$1/node_modules/@types/node"
}

# 1. ESM
ESM="$(new_project esm module)"
cp "$FIX/esm.mjs" "$ESM/"
(cd "$ESM" && node esm.mjs) || fail "ESM consumer"
pass "ESM consumer (default === named, real request, dual-copy isOctenError)"

# 2. CJS
CJS="$(new_project cjs commonjs)"
cp "$FIX/cjs.cjs" "$CJS/"
(cd "$CJS" && node cjs.cjs) || fail "CJS consumer"
pass "CJS consumer (default === named, real request)"

# 3. TypeScript, ESM project: type-check with three tsconfigs + negative cases
TSE="$(new_project ts-esm module)"
link_ts_tools "$TSE"
cp "$FIX"/ts/*.ts "$FIX"/ts/tsconfig.*.json "$TSE/"
TSC="$TSE/node_modules/typescript/bin/tsc"
for cfg in strict exact nodenext; do
  (cd "$TSE" && node "$TSC" -p "tsconfig.$cfg.json") || fail "tsc ts-esm $cfg"
  pass "tsc --noEmit ts-esm tsconfig.$cfg.json (consumer + negative.ts expect-errors)"
done
for cfg in strict exact nodenext; do
  cat >"$TSE/tsconfig.bad.$cfg.json" <<JSON
{ "extends": "./tsconfig.$cfg.json", "files": ["bad-field.ts"] }
JSON
  if OUT="$(cd "$TSE" && node "$TSC" -p "tsconfig.bad.$cfg.json" 2>&1)"; then fail "bad-field.ts compiled under $cfg but must not"; fi
  echo "$OUT" | grep -q 'cuont' || fail "bad-field.ts failed under $cfg for the wrong reason: $OUT"
  pass "bad-field.ts (cuont) is rejected under $cfg: $(echo "$OUT" | head -1 | cut -c1-120)"
done
# Run the compiled output (ESM)
(cd "$TSE" && node "$TSC" -p tsconfig.exact.json --noEmit false --outDir out >/dev/null && node out/consumer.js) || fail "ts-esm emitted consumer run"
pass "ts-esm: compiled consumer runs against fake server (six methods)"

# 4. TypeScript, CJS project (NodeNext + type=commonjs, uses index.d.cts)
TSC_DIR="$(new_project ts-cjs commonjs)"
link_ts_tools "$TSC_DIR"
cp "$FIX"/ts/*.ts "$FIX"/ts/tsconfig.nodenext.json "$TSC_DIR/"
(cd "$TSC_DIR" && node "$TSE/node_modules/typescript/bin/tsc" -p tsconfig.nodenext.json) || fail "tsc ts-cjs nodenext"
pass "tsc --noEmit ts-cjs nodenext (resolves index.d.cts)"
(cd "$TSC_DIR" && node "$TSE/node_modules/typescript/bin/tsc" -p tsconfig.nodenext.json --noEmit false --outDir out >/dev/null && node out/consumer.js) || fail "ts-cjs emitted consumer run"
pass "ts-cjs: compiled CommonJS consumer runs against fake server (six methods)"

# 5. Every request the fake server received is well-formed (key / UA / content-type / body)
node -e "
fetch('$OCTEN_FAKE_BASE_URL/__requests').then(r => r.json()).then(seen => {
  const bad = seen.filter(s => s.problems.length);
  console.log('fake server saw ' + seen.length + ' requests, ' + bad.length + ' with problems');
  if (bad.length || seen.length < 15) process.exit(1);
});
" || fail "fake server request check"
pass "fake server saw only well-formed requests"
echo "ALL PACKAGE CHECKS PASSED on node $(node -v)"

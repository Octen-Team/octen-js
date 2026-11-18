#!/usr/bin/env bash
# Runs test/matrix/run.mjs and a type check against the packed package for each ai/zod pair.
# Exits non-zero if any combo fails scenario A, scenario B or the type check.
set -euo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MATRIX_DIR="$PKG_DIR/test/matrix"
FIXTURE="$PKG_DIR/test/fixtures/search.json"
SDK_SPEC="${MATRIX_SDK:-@octen.ai/sdk@0.1.0}"
NODE20="${MATRIX_NODE20:-npx -y node@20}"
# Type-check toolchain, pinned so results do not drift between runs. With skipLibCheck off,
# the AI SDK's own declarations import json-schema, which ships no types of its own.
TOOLCHAIN=(typescript@6.0.3 @types/node@20.19.43 @types/json-schema@7.0.15)

if [[ $# -eq 2 ]]; then
  COMBOS=("$1 $2 default")
elif [[ $# -eq 0 ]]; then
  COMBOS=(
    "5.0.291 3.25.76 default"
    "5.0.291 4.1.8 default"
    "6.0.333 3.25.76 default"
    "6.0.333 4.1.8 default"
    "7.0.176 3.25.76 default"
    "7.0.176 4.1.8 default"
    "latest latest 20"
    "latest latest default"
  )
else
  cat >&2 <<USAGE
usage: $0 [ai-version zod-version]
  With no arguments, runs the six pinned combos plus ai@latest/zod@latest under Node 20 and the default node.
  MATRIX_TMPDIR  parent for the temp projects (default: \$TMPDIR or /tmp)
  MATRIX_SDK     npm spec of the Octen SDK to install (default: @octen.ai/sdk@0.1.0)
  MATRIX_NODE20  command that runs Node 20 (default: npx -y node@20)
USAGE
  exit 2
fi

WORK="$(mktemp -d "${MATRIX_TMPDIR:-${TMPDIR:-/tmp}}/ai-sdk-tools-matrix.XXXXXX")"
echo "work dir: $WORK"

(cd "$PKG_DIR" && npm run build >/dev/null && npm pack --pack-destination "$WORK" --loglevel=error >/dev/null)
TARBALL="$(ls "$WORK"/*.tgz)"
echo "tarball: $TARBALL"

SUMMARY=()
FAILED=0

field() { # field <log> <prefix>: text after the prefix on the first matching line
  sed -n "s/^$2 //p" "$1" | head -n 1
}

for combo in "${COMBOS[@]}"; do
  read -r ai_version zod_version node_label <<<"$combo"
  dir="$(mktemp -d "$WORK/combo.XXXXXX")"
  log="$dir/matrix.log"
  echo
  echo "=== ai@$ai_version zod@$zod_version node=$node_label ($dir)"

  if ! (cd "$dir" && npm init -y >/dev/null && npm install --no-audit --no-fund --loglevel=error \
    "$TARBALL" "$SDK_SPEC" "ai@$ai_version" "zod@$zod_version" "${TOOLCHAIN[@]}" >"$dir/install.log" 2>&1); then
    cat "$dir/install.log"
    SUMMARY+=("ai@$ai_version zod@$zod_version node=$node_label | install FAILED")
    FAILED=1
    continue
  fi
  cp "$MATRIX_DIR/run.mjs" "$MATRIX_DIR/consumer.ts" "$MATRIX_DIR/consumer-is-step-count.ts" "$dir/"

  if [[ "$node_label" == "20" ]]; then runner=($NODE20); else runner=(node); fi
  run_ok=1
  (cd "$dir" && "${runner[@]}" run.mjs "$FIXTURE") >"$log" 2>&1 || run_ok=0
  cat "$log"

  # isStepCount exists only from ai 7, so that file is checked only where ai exports it.
  files=(consumer.ts)
  if (cd "$dir" && node --input-type=module -e "import('ai').then((m) => process.exit(m.isStepCount ? 0 : 1))"); then
    files+=(consumer-is-step-count.ts)
  fi
  node -e 'const fs = require("fs"); const [src, dst, ...files] = process.argv.slice(1);
    const config = JSON.parse(fs.readFileSync(src, "utf8")); config.files = files;
    fs.writeFileSync(dst, JSON.stringify(config, null, 2));' \
    "$MATRIX_DIR/tsconfig.consumer.json" "$dir/tsconfig.json" "${files[@]}"
  types=PASS
  (cd "$dir" && ./node_modules/.bin/tsc -p tsconfig.json) >"$dir/types.log" 2>&1 || types=FAIL
  if [[ "$types" == FAIL ]]; then cat "$dir/types.log"; fi
  echo "types: $types (${files[*]})"

  a="$(field "$log" 'A generateText:' | cut -d' ' -f1)"
  b="$(field "$log" 'B streamText:' | cut -d' ' -f1)"
  c="$(field "$log" 'error-behavior:' | cut -d' ' -f1)"
  cs="$(field "$log" 'stream-error-behavior:' | cut -d' ' -f1)"
  d="$(field "$log" 'no-stopwhen:' | cut -d' ' -f1)"
  versions="$(head -n 1 "$log" | sed 's/^combo: //')"
  verdict=PASS
  if [[ "$run_ok" -ne 1 || "$a" != PASS || "$b" != PASS || "$types" != PASS ]]; then verdict=FAIL; FAILED=1; fi
  SUMMARY+=("$versions | A=${a:-?} B=${b:-?} C=${c:-?} C-stream=${cs:-?} D=${d:-?} types=$types | $verdict")
done

echo
echo "=== summary"
for line in "${SUMMARY[@]}"; do echo "$line"; done
exit "$FAILED"

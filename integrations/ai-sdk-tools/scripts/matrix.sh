#!/usr/bin/env bash
# Runs test/matrix/run.mjs and a type check against the packed package for each ai/zod pair.
# Exits non-zero if any combo fails scenario A, scenario B, the schema check, the CJS load, the type check,
# installs more than one SDK version or prints a DRIFT line.
set -euo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MATRIX_DIR="$PKG_DIR/test/matrix"
FIXTURE="$PKG_DIR/test/fixtures/search.json"
EXTRACT_FIXTURE="$PKG_DIR/test/fixtures/extract.json"
SDK_SPEC="${MATRIX_SDK:-@octen.ai/sdk@0.2.0}"
NODE20="${MATRIX_NODE20:-npx -y node@20}"
# Type-check toolchain, pinned so results do not drift between runs. With skipLibCheck off,
# the AI SDK's own declarations import json-schema, which ships no types of its own.
TOOLCHAIN=(typescript@6.0.3 @types/node@20.19.43 @types/json-schema@7.0.15)

# Expected first token of each observation line, per ai major. The README documents these (Quick start
# note on stopWhen, "What the AI SDK does with the error"), so change the README together with them.
EXPECTED='
5 error-behavior tool-error/OctenAuthenticationError/message
5 stream-error-behavior tool-error/OctenAuthenticationError/message
5 conn-error-behavior tool-error/OctenConnectionError/message
5 stream-conn-error-behavior tool-error/OctenConnectionError/message
5 abort-error-behavior rejects/DOMException(AbortError)
5 stream-abort-error-behavior abort
5 no-stopwhen stops-after-1
6 error-behavior tool-error/OctenAuthenticationError/message
6 stream-error-behavior tool-error/OctenAuthenticationError/message
6 conn-error-behavior tool-error/OctenConnectionError/message
6 stream-conn-error-behavior tool-error/OctenConnectionError/message
6 abort-error-behavior rejects/DOMException(AbortError)
6 stream-abort-error-behavior abort
6 no-stopwhen stops-after-1
7 error-behavior tool-error/OctenAuthenticationError/name-message
7 stream-error-behavior tool-error/OctenAuthenticationError/name-message
7 conn-error-behavior tool-error/OctenConnectionError/name-message
7 stream-conn-error-behavior tool-error/OctenConnectionError/name-message
7 abort-error-behavior rejects/DOMException(AbortError)
7 stream-abort-error-behavior abort
7 no-stopwhen stops-after-1
'
OBSERVATIONS=(error-behavior stream-error-behavior conn-error-behavior stream-conn-error-behavior
  abort-error-behavior stream-abort-error-behavior no-stopwhen)

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
  MATRIX_SDK     npm spec of the Octen SDK to install (default: @octen.ai/sdk@0.2.0)
  MATRIX_NODE20  command that runs Node 20 (default: npx -y node@20)
  MATRIX_KEEP=1  keep the temp projects instead of deleting them on exit
USAGE
  exit 2
fi

WORK="$(mktemp -d "${MATRIX_TMPDIR:-${TMPDIR:-/tmp}}/ai-sdk-tools-matrix.XXXXXX")"
if [[ "${MATRIX_KEEP:-}" != 1 ]]; then trap 'rm -rf -- "${WORK:?}"' EXIT; fi
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
  cp "$MATRIX_DIR/run.mjs" "$MATRIX_DIR/cjs-smoke.cjs" "$MATRIX_DIR/consumer.ts" "$MATRIX_DIR/consumer-is-step-count.ts" "$dir/"

  # One SDK copy only, so MATRIX_SDK is the SDK the tools actually run on.
  sdk_versions="$(cd "$dir" && find node_modules -path '*/@octen.ai/sdk/package.json' -exec node -p 'require(require("path").resolve(process.argv[1])).version' {} \; | sort -u | tr '\n' ' ')"
  sdk=PASS
  if [[ "$(echo "$sdk_versions" | wc -w | tr -d ' ')" != 1 ]]; then sdk=FAIL; fi
  echo "sdk: $sdk (${sdk_versions% })"

  if [[ "$node_label" == "20" ]]; then runner=($NODE20); else runner=(node); fi
  run_ok=1
  (cd "$dir" && "${runner[@]}" run.mjs "$FIXTURE" "$EXTRACT_FIXTURE") >"$log" 2>&1 || run_ok=0
  cat "$log"

  cjs=PASS
  (cd "$dir" && "${runner[@]}" cjs-smoke.cjs) >"$dir/cjs.log" 2>&1 || cjs=FAIL
  if [[ "$cjs" == FAIL ]]; then cat "$dir/cjs.log"; fi
  echo "cjs: $cjs"

  # isStepCount exists from ai 7; chosen by the installed version so a broken export fails the type check.
  ai_major="$(cd "$dir" && node -p 'require("./node_modules/ai/package.json").version.split(".")[0]')"
  files=(consumer.ts)
  if [[ "$ai_major" -ge 7 ]]; then files+=(consumer-is-step-count.ts); fi
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
  schema="$(field "$log" 'schema:' | cut -d' ' -f1)"
  major="$(sed -n 's/^combo: ai@\([0-9][0-9]*\)\..*/\1/p' "$log")"
  observed=""
  drift=none
  for label in "${OBSERVATIONS[@]}"; do
    got="$(field "$log" "$label:" | cut -d' ' -f1)"
    want="$(echo "$EXPECTED" | awk -v m="$major" -v l="$label" '$1 == m && $2 == l { print $3 }')"
    observed="$observed $label=${got:-?}"
    if [[ -z "$want" || "$got" != "$want" ]]; then
      echo "DRIFT ai@${major:-?} $label: got ${got:-nothing}, expected ${want:-nothing (no expected value for this major)}"
      drift=DRIFT
    fi
  done
  versions="$(head -n 1 "$log" | sed 's/^combo: //')"
  verdict=PASS
  if [[ "$run_ok" -ne 1 || "$a" != PASS || "$b" != PASS || "$schema" != PASS || "$cjs" != PASS || "$sdk" != PASS \
    || "$types" != PASS || "$drift" != none ]]; then
    verdict=FAIL
    FAILED=1
  fi
  SUMMARY+=("$versions | A=${a:-?} B=${b:-?} schema=${schema:-?} cjs=$cjs sdk=$sdk types=$types drift=$drift |$observed | $verdict")
done

echo
echo "=== summary"
for line in "${SUMMARY[@]}"; do echo "$line"; done
exit "$FAILED"

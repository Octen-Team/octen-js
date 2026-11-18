#!/usr/bin/env bash
# Release guards shared by both jobs of release-ai-sdk-tools.yml. Run from the package directory.
# Reads GITHUB_REF_NAME and GITHUB_SHA; fails unless the tag, package name and versions agree and the commit is on main.
set -euo pipefail

NAME="$(node -p "require('./package.json').name")"
PKG="$(node -p "require('./package.json').version")"
SRC="$(node -p "require('fs').readFileSync('src/version.ts', 'utf8').match(/TOOLS_VERSION = '([^']+)'/)?.[1] ?? ''")"

if [ "$NAME" != "@octen.ai/ai-sdk-tools" ]; then
  echo "package.json name is '$NAME'; this workflow only publishes @octen.ai/ai-sdk-tools"
  exit 1
fi
if [ "${GITHUB_REF_NAME:-}" != "ai-sdk-tools-v$PKG" ] || [ "$PKG" != "$SRC" ]; then
  echo "Tag '${GITHUB_REF_NAME:-}', package.json '$PKG' and src/version.ts '$SRC' must all match (tag = ai-sdk-tools-v<version>)"
  exit 1
fi
# npm would publish a prerelease under the latest dist-tag without --tag, so refuse it
case "$PKG" in
  *-*)
    echo "Version '$PKG' is a prerelease; this workflow publishes stable versions only (it would land on the latest dist-tag)"
    exit 1
    ;;
esac

git fetch --no-tags origin main:refs/remotes/origin/main
if ! git merge-base --is-ancestor "${GITHUB_SHA:?}" origin/main; then
  echo "Commit $GITHUB_SHA is not on main; releases must be tagged from main"
  exit 1
fi

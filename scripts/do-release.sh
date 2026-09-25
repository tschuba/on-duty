#!/usr/bin/env bash
set -euo pipefail

# Usage: do-release.sh <patch|minor|major>
# Bumps package.json, commits, tags, pushes. No prompts.

TYPE=${1:-}
[[ $TYPE =~ ^(patch|minor|major)$ ]] || { echo "Usage: $0 patch|minor|major"; exit 1; }

OLD=$(node -p "require('./package.json').version")
NEW=$(npx --yes semver -i "$TYPE" "$OLD")

npm pkg set version="$NEW" > /dev/null
git add package.json
git commit -m "chore: release v$NEW"
git tag "v$NEW"
git push origin HEAD --tags

echo "$NEW"

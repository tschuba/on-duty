#!/usr/bin/env bash
set -euo pipefail

# Usage: do-release.sh [--dry-run] <patch|minor|major>
# --dry-run: print plan only, no changes

DRY_RUN=false
[[ ${1:-} == "--dry-run" ]] && { DRY_RUN=true; shift; }

TYPE=${1:-}
[[ $TYPE =~ ^(patch|minor|major)$ ]] || { echo "Usage: $0 [--dry-run] patch|minor|major"; exit 1; }

OLD=$(node -p "require('./package.json').version")
NEW=$(npx --yes semver -i "$TYPE" "$OLD")

if $DRY_RUN; then
  echo "  $OLD → $NEW"
  echo "  git commit 'chore: release v$NEW'"
  echo "  git tag v$NEW"
  echo "  git push origin HEAD --tags"
  exit 0
fi

npm pkg set version="$NEW" > /dev/null
git add package.json
git commit -m "chore: release v$NEW"
git tag "v$NEW"
git push origin HEAD --tags

echo "$NEW"

#!/usr/bin/env bash
set -euo pipefail

TYPE=${1:-}
[[ $TYPE =~ ^(patch|minor|major)$ ]] || { echo "Usage: $0 patch|minor|major"; exit 1; }

# Guards
DEFAULT="master"
[[ $(git branch --show-current) == "$DEFAULT" ]] || { echo "Not on $DEFAULT"; exit 1; }
[[ -z $(git status --porcelain) ]] || { echo "Dirty working tree"; exit 1; }

# Bump version
OLD=$(node -p "require('./package.json').version")
NEW=$(npx --yes semver -i "$TYPE" "$OLD")

# Plan anzeigen, bestätigen
echo "  $OLD → $NEW"
echo "  git commit 'chore: release v$NEW'"
echo "  git tag v$NEW"
echo "  git push origin master --tags"
read -rp "Fortfahren? (y/n) " CONFIRM
[[ $CONFIRM == y ]] || exit 0

# Ausführen
npm pkg set version="$NEW" > /dev/null
git add package.json
git commit -m "chore: release v$NEW"
git tag "v$NEW"
git push origin HEAD --tags

# Optional: GitHub Release
read -rp "GitHub Release anlegen? (y/n) " GH
[[ $GH == y ]] && gh release create "v$NEW" --generate-notes

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET_ROOT="$PROJECT_ROOT/skills-src/rainbond"

resolve_source_root() {
  local current="$PROJECT_ROOT"

  while [[ "$current" != "/" ]]; do
    if [[ -d "$current/rainbond-skills" ]]; then
      printf '%s\n' "$current/rainbond-skills"
      return 0
    fi
    current="$(cd "$current/.." && pwd)"
  done

  return 1
}

SOURCE_ROOT="$(resolve_source_root || true)"

if [[ -z "$SOURCE_ROOT" || ! -d "$SOURCE_ROOT" ]]; then
  echo "Missing source skill repository at $SOURCE_ROOT" >&2
  exit 1
fi

mkdir -p "$TARGET_ROOT"

if [[ "$#" -eq 0 ]]; then
  set -- \
    rainbond-app-assistant \
    rainbond-app-version-assistant \
    rainbond-delivery-verifier \
    rainbond-fullstack-bootstrap \
    rainbond-fullstack-troubleshooter \
    rainbond-template-installer
fi

for skill_name in "$@"; do
  source_path="$SOURCE_ROOT/$skill_name"
  target_path="$TARGET_ROOT/$skill_name"

  if [[ ! -d "$source_path" ]]; then
    echo "Missing skill directory: $source_path" >&2
    exit 1
  fi

  rm -rf "$target_path"
  rsync -a "$source_path/" "$target_path/"
  echo "Synced $skill_name -> $target_path"
done

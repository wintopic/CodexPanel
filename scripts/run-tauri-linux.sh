#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-build}"
if [[ "$MODE" != "build" && "$MODE" != "dev" ]]; then
  echo "Usage: bash scripts/run-tauri-linux.sh <build|dev>" >&2
  exit 2
fi

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$PROJECT_DIR"

missing=()
for command in node npm npx cargo rustc pkg-config; do
  if ! command -v "$command" >/dev/null 2>&1; then
    missing+=("$command")
  fi
done
if (( ${#missing[@]} )); then
  echo "Missing required commands: ${missing[*]}" >&2
  echo "Run: bash scripts/setup-ubuntu-dev.sh --yes" >&2
  exit 1
fi

if ! pkg-config --exists gtk+-3.0; then
  echo "GTK development files were not found." >&2
  echo "Run: bash scripts/setup-ubuntu-dev.sh --yes" >&2
  exit 1
fi

if [[ "$MODE" == "dev" ]]; then
  npx tauri dev
else
  npx tauri build --bundles deb,appimage
fi

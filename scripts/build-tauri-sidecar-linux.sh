#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$PROJECT_DIR"

TARGET="${1:-${TARGET:-}}"
if [[ -z "$TARGET" ]]; then
  if ! command -v rustc >/dev/null 2>&1; then
    echo "rustc is required to detect the Linux target triple." >&2
    exit 1
  fi
  TARGET="$(rustc -vV | awk '/^host:/ { print $2 }')"
fi
if [[ -z "$TARGET" ]]; then
  echo "Could not determine Rust target triple." >&2
  exit 1
fi

BUILD_DIR="$PROJECT_DIR/.build/tauri-sidecar"
PAYLOAD_DIR="$BUILD_DIR/payload"
BIN_DIR="$PROJECT_DIR/src-tauri/bin"
SIDECAR_BASE_NAME="codexpanel-node-sidecar"
SIDECAR_NAME="$SIDECAR_BASE_NAME-$TARGET"
SIDECAR_PATH="$BIN_DIR/$SIDECAR_NAME"

if [[ -d "$BUILD_DIR" ]]; then
  RESOLVED_BUILD="$(cd "$BUILD_DIR" && pwd -P)"
  case "$RESOLVED_BUILD" in
    "$PROJECT_DIR"/*) rm -rf "$RESOLVED_BUILD" ;;
    *) echo "Refusing to remove outside workspace: $RESOLVED_BUILD" >&2; exit 1 ;;
  esac
fi

mkdir -p "$PAYLOAD_DIR" "$BIN_DIR"
rm -f "$SIDECAR_PATH"

npm run check
node --check "$PROJECT_DIR/windows/node-sidecar.js"

cp "$PROJECT_DIR/package.json" "$PAYLOAD_DIR/"
cp "$PROJECT_DIR/server.js" "$PAYLOAD_DIR/"
cp -R "$PROJECT_DIR/public" "$PAYLOAD_DIR/"
if [[ -d "$PROJECT_DIR/bin" ]]; then
  cp -R "$PROJECT_DIR/bin" "$PAYLOAD_DIR/"
fi
cp "$PROJECT_DIR/windows/node-sidecar.js" "$PAYLOAD_DIR/"

FORBIDDEN_PAYLOAD_FILES="$(
  find "$PAYLOAD_DIR" -name state.json -o -name .env -o -name .env.local -o -name .env.production -o -path '*/.codex/*'
)"
if [[ -n "$FORBIDDEN_PAYLOAD_FILES" ]]; then
  echo "Refusing to bundle user secrets or local state files:" >&2
  echo "$FORBIDDEN_PAYLOAD_FILES" >&2
  exit 1
fi

PAYLOAD_HASH="$(
  find "$PAYLOAD_DIR" -type f -print0 |
    sort -z |
    xargs -0 sha256sum |
    sha256sum |
    awk '{ print substr($1, 1, 12) }'
)"
SIDECAR_IDENTIFIER="codexpanel-tauri-node-sidecar-$PAYLOAD_HASH"

npx --yes caxa \
  --input "$PAYLOAD_DIR" \
  --output "$SIDECAR_PATH" \
  --identifier "$SIDECAR_IDENTIFIER" \
  --uncompression-message "Preparing CodexPanel local service..." \
  -- "{{caxa}}/node_modules/.bin/node" "{{caxa}}/node-sidecar.js"

if [[ ! -f "$SIDECAR_PATH" ]]; then
  echo "Sidecar build did not create expected executable: $SIDECAR_PATH" >&2
  exit 1
fi

chmod +x "$SIDECAR_PATH"
SIZE_BYTES="$(stat -c%s "$SIDECAR_PATH")"
SIZE_MB="$(awk -v bytes="$SIZE_BYTES" 'BEGIN { printf "%.1f", bytes / 1048576 }')"
echo "Built Tauri sidecar: $SIDECAR_PATH"
echo "Size: $SIZE_MB MB"

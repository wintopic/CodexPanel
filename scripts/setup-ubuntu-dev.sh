#!/usr/bin/env bash
set -euo pipefail

ASSUME_YES=0
if [[ "${1:-}" == "--yes" || "${1:-}" == "-y" ]]; then
  ASSUME_YES=1
fi

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This setup script is intended for Ubuntu/Linux." >&2
  exit 1
fi

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$PROJECT_DIR"

SUDO=""
if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  SUDO="sudo"
fi

APT_YES=()
if (( ASSUME_YES )); then
  APT_YES=(-y)
fi

$SUDO apt-get update

WEBKIT_PACKAGE="libwebkit2gtk-4.1-dev"
if ! apt-cache show "$WEBKIT_PACKAGE" >/dev/null 2>&1; then
  WEBKIT_PACKAGE="libwebkit2gtk-4.0-dev"
fi

PACKAGES=(
  build-essential
  curl
  wget
  file
  pkg-config
  libssl-dev
  libgtk-3-dev
  "$WEBKIT_PACKAGE"
  libayatana-appindicator3-dev
  librsvg2-dev
  patchelf
)

$SUDO apt-get install "${APT_YES[@]}" "${PACKAGES[@]}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18+ is required. Install it with your preferred Node manager, then rerun npm install." >&2
  exit 1
fi

NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  echo "Node.js 18+ is required. Current Node version: $(node -v)" >&2
  exit 1
fi

if ! command -v go >/dev/null 2>&1; then
  echo "Go 1.23+ is required. Install Go, then rerun this script." >&2
  exit 1
fi

if ! command -v wails >/dev/null 2>&1; then
  go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0
  export PATH="$HOME/go/bin:$PATH"
fi

npm install
npm run check
go test ./...

echo "Ubuntu development dependencies are ready."
echo "Run development: npm run wails:dev"
echo "Build Linux bundle: npm run wails:build && npm run wails:sidecar"

#!/usr/bin/env bash
# Build Riff.app and install (or update) it in /Applications.
# Your library is stored separately in ~/Library/Application Support/app.riff.desktop
# and is not touched.
set -euo pipefail
cd "$(dirname "$0")/.."

BUNDLE_ID="app.riff.desktop"
SRC="src-tauri/target/release/bundle/macos/Riff.app"
DEST="/Applications/Riff.app"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

echo "→ Building Riff.app..."
npx tauri build --bundles app

# Never overwrite some other app that happens to be called Riff.
if [[ -d "$DEST" ]]; then
  existing_id=$(plutil -extract CFBundleIdentifier raw -o - "$DEST/Contents/Info.plist" 2>/dev/null || echo "unknown")
  if [[ "$existing_id" != "$BUNDLE_ID" ]]; then
    echo "✗ $DEST belongs to a different app ($existing_id). Not replacing it." >&2
    exit 1
  fi
fi

# Quit the installed copy if it's running, and wait for it to exit.
if pgrep -f "$DEST/Contents/MacOS/" >/dev/null; then
  echo "→ Quitting running Riff..."
  osascript -e "tell application id \"$BUNDLE_ID\" to quit" || true
  for _ in {1..50}; do
    pgrep -f "$DEST/Contents/MacOS/" >/dev/null || break
    sleep 0.2
  done
  if pgrep -f "$DEST/Contents/MacOS/" >/dev/null; then
    echo "✗ Riff didn't quit. Quit it manually (⌘Q) and run this again." >&2
    exit 1
  fi
fi

echo "→ Installing to ${DEST}..."
rm -rf "$DEST"
ditto "$SRC" "$DEST"

# Make the installed copy the handler for riff:// links (not the build output).
"$LSREGISTER" -u "$PWD/$SRC" >/dev/null 2>&1 || true
"$LSREGISTER" -f "$DEST" >/dev/null 2>&1 || true

echo "→ Launching Riff"
open "$DEST"
echo "✓ Installed. Right-click the Dock icon → Options → Keep in Dock / Open at Login."

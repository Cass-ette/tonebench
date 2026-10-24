#!/bin/zsh
set -euo pipefail
cd "${0:A:h}/.."
npm run build
TONEBENCH_SWIFT_BUILD="${TONEBENCH_SWIFT_BUILD:-$PWD/macos/.build}"
swift build --package-path macos -c release --scratch-path "$TONEBENCH_SWIFT_BUILD"
TONEBENCH_BIN_DIR=$(swift build --package-path macos -c release --scratch-path "$TONEBENCH_SWIFT_BUILD" --show-bin-path)
TONEBENCH_APP="$PWD/build/ToneBench.app"
mkdir -p "$TONEBENCH_APP/Contents/MacOS" "$TONEBENCH_APP/Contents/Resources/Web"
cp "$TONEBENCH_BIN_DIR/ToneBench" "$TONEBENCH_APP/Contents/MacOS/ToneBench"
cp macos/Info.plist "$TONEBENCH_APP/Contents/Info.plist"
cp macos/Resources/AppIcon.icns "$TONEBENCH_APP/Contents/Resources/AppIcon.icns"
rsync -a --delete dist/ "$TONEBENCH_APP/Contents/Resources/Web/"
# Generated bundles in cloud-synced folders may inherit Finder metadata that
# codesign rejects. Only strip attributes inside this generated app bundle.
xattr -cr "$TONEBENCH_APP"
codesign --force --sign - "$TONEBENCH_APP"
printf 'Built %s\n' "$TONEBENCH_APP"

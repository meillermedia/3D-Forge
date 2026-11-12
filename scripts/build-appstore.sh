#!/bin/sh
# Builds a Mac App Store package (.pkg) of the app. Secrets/identities come from the git-ignored .env.signing or the environment.
# Needs: APPLE_TEAM_ID, APPSTORE_APP_IDENTITY, APPSTORE_INSTALLER_IDENTITY, APPSTORE_PROVISIONING_PROFILE
# Optional: APPSTORE_BUILD_NUMBER (must increase with every upload), APPSTORE_TARGET (default universal-apple-darwin)
set -e
cd "$(dirname "$0")/.."
if [ -f .env.signing ]; then
  set -a
  . ./.env.signing
  set +a
fi
for v in APPLE_TEAM_ID APPSTORE_APP_IDENTITY APPSTORE_INSTALLER_IDENTITY APPSTORE_PROVISIONING_PROFILE; do
  case "$v" in
    APPLE_TEAM_ID) val=$APPLE_TEAM_ID ;;
    APPSTORE_APP_IDENTITY) val=$APPSTORE_APP_IDENTITY ;;
    APPSTORE_INSTALLER_IDENTITY) val=$APPSTORE_INSTALLER_IDENTITY ;;
    APPSTORE_PROVISIONING_PROFILE) val=$APPSTORE_PROVISIONING_PROFILE ;;
  esac
  if [ -z "$val" ]; then echo "$v is not set. See .env.signing.example." >&2; exit 1; fi
done
if [ ! -f "$APPSTORE_PROVISIONING_PROFILE" ]; then echo "Provisioning profile not found: $APPSTORE_PROVISIONING_PROFILE" >&2; exit 1; fi

TARGET="${APPSTORE_TARGET:-universal-apple-darwin}"
BUILD_NUMBER="${APPSTORE_BUILD_NUMBER:-1}"
BUNDLE_ID=$(node -p "require('./src-tauri/tauri.conf.json').identifier")
NAME=$(node -p "require('./src-tauri/tauri.conf.json').productName")
OUT=src-tauri/gen/appstore
mkdir -p "$OUT"

sed -e "s/__TEAM_ID__/$APPLE_TEAM_ID/g" -e "s/__BUNDLE_ID__/$BUNDLE_ID/g" src-tauri/appstore/entitlements.plist.template > "$OUT/entitlements.plist"
APP_IDENTITY="$APPSTORE_APP_IDENTITY" PROFILE="$(cd "$(dirname "$APPSTORE_PROVISIONING_PROFILE")" && pwd)/$(basename "$APPSTORE_PROVISIONING_PROFILE")" \
BUILD_NUMBER="$BUILD_NUMBER" OUT="$(pwd)/$OUT" ROOT="$(pwd)" node -e '
const fs = require("fs"), e = process.env;
fs.writeFileSync(e.OUT + "/tauri.conf.json", JSON.stringify({ bundle: { macOS: {
  signingIdentity: e.APP_IDENTITY, hardenedRuntime: false, bundleVersion: e.BUILD_NUMBER,
  entitlements: e.OUT + "/entitlements.plist", infoPlist: e.ROOT + "/src-tauri/appstore/Info.plist",
  files: { "embedded.provisionprofile": e.PROFILE }
} } }, null, 2));
'

# Notarization variables must not be set for an App Store build
unset APPLE_ID APPLE_PASSWORD APPLE_SIGNING_IDENTITY
npx tauri build --bundles app --target "$TARGET" --config "$OUT/tauri.conf.json"

APP="src-tauri/target/$TARGET/release/bundle/macos/$NAME.app"
[ -d "$APP" ] || APP="src-tauri/target/release/bundle/macos/$NAME.app"
PKG="$OUT/$NAME.pkg"
xcrun productbuild --sign "$APPSTORE_INSTALLER_IDENTITY" --component "$APP" /Applications "$PKG"
echo "Created $PKG"

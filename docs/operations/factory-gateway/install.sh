#!/bin/bash
# Installs or updates the factory gateway as a launch daemon on macOS. Run with sudo, from the
# owner's account:
#   sudo bash install.sh <staging dir> [<private key file>]
# The staging dir (the runbook's "Update the code") holds src.tar, src.rev and uv, and may hold
# gateway.json and the launch daemon's plist; a first install needs both. Pass the key file on
# the first install and when replacing the key. Whatever is not staged or passed stays as
# installed, and so do data/ (state, journal, tokens, mirrors) and the owner's token.
#
# It trusts the account that stages it: root runs the staged uv and installs the staged plist.
# Root reads the key and the configuration through that account and never writes in its home.
set -euo pipefail
umask 022
STAGE=$1 KEY_INPUT=${2:-}
ROOT=/Library/FactoryGateway
SVC=_factorygw ID=450
LABEL=dev.lushly.factory-gateway
PLIST=/Library/LaunchDaemons/$LABEL.plist
PY=$ROOT/app/venv/bin/python
OWNER_USER=${SUDO_USER:?run this with sudo}
OWNER_HOME=$(dscl . -read "/Users/$OWNER_USER" NFSHomeDirectory | sed 's/^NFSHomeDirectory: //')
[ -d "$OWNER_HOME" ] || { echo "No home directory found for $OWNER_USER" >&2; exit 2; }
as_owner() { sudo -u "$OWNER_USER" "$@"; }

KEY_RAW='' KEY_TMP='' CONFIG_TMP='' CACHE=''
cleanup() {
  [ -z "$KEY_RAW" ] || rm -f "$KEY_RAW"
  [ -z "$KEY_TMP" ] || rm -f "$KEY_TMP"
  [ -z "$CONFIG_TMP" ] || rm -f "$CONFIG_TMP"
  [ -z "$CACHE" ] || rm -rf "$CACHE"
}
trap cleanup EXIT

need() { [ -s "$STAGE/$1" ] || { echo "$STAGE/$1 is missing" >&2; exit 2; }; }
need src.tar
need src.rev
need uv
[ -s "$PLIST" ] || need "$LABEL.plist"
[ -s $ROOT/etc/gateway.json ] || need gateway.json
if [ -n "$KEY_INPUT" ]; then
  as_owner test -r "$KEY_INPUT" || { echo "$OWNER_USER cannot read $KEY_INPUT" >&2; exit 2; }
elif [ ! -s $ROOT/etc/app.pem ]; then
  echo "No key is installed yet: pass the App's private key file" >&2; exit 2
fi

# The service's account is its alone: another account with its ID, or in its group, would
# share its files, the key among them. Checked before anything is created or stopped.
attr() { dscl . -read "$1" "$2" 2>/dev/null | sed "s/^$2: *//"; }
taken() { dscl . -search "$1" "$2" $ID | awk 'NF > 1 {print $1}' | grep -vx "$SVC" || true; }
others="$(taken /Users UniqueID) $(taken /Users PrimaryGroupID) $(taken /Groups PrimaryGroupID)"
for other in $others; do
  echo "ID $ID already belongs to $other" >&2; exit 2
done
if dscl . -read /Groups/$SVC >/dev/null 2>&1; then
  [ "$(attr /Groups/$SVC PrimaryGroupID)" = $ID ] ||
    { echo "The group $SVC exists but is not group $ID" >&2; exit 2; }
  # dscl answers a missing key with a message and success, so read the keys' own lines.
  members=$(dscl . -read /Groups/$SVC GroupMembership GroupMembers 2>/dev/null |
    grep -E '^Group(Membership|Members):' || true)
  [ -z "$members" ] || { echo "The group $SVC has members: $members" >&2; exit 2; }
fi
if id $SVC >/dev/null 2>&1; then
  if [ "$(id -u $SVC)" != $ID ] || [ "$(id -g $SVC)" != $ID ] ||
    [ "$(attr /Users/$SVC UserShell)" != /usr/bin/false ]; then
    echo "The user $SVC exists but is not user and group $ID with no login shell" >&2; exit 2
  fi
fi

# Proves the staged configuration loads as the gateway reads it, from a copy only root can
# change. The owner's account does the reading, so root follows no link of its choosing.
check_config() {
  [ -n "$CONFIG_TMP" ] || CONFIG_TMP=$(mktemp)
  as_owner cat "$STAGE/gateway.json" > "$CONFIG_TMP" || return 1
  $PY -I - "$CONFIG_TMP" <<'PYEOF'
import sys
from botcore_factory.gateway.config import GatewayConfig
try:
    config = GatewayConfig.model_validate_json(open(sys.argv[1], encoding="utf-8").read())
except ValueError as exc:
    sys.exit(f"gateway.json is refused: {exc}")
if config.github_app is None:
    sys.exit("gateway.json is refused: it has no githubApp")
print("   gateway.json loads")
PYEOF
}
# Rebuilds the key as a PEM (a pasted key may arrive on one line) and proves it loads.
check_key() {
  KEY_RAW=$(mktemp) KEY_TMP=$(mktemp)
  as_owner cat "$KEY_INPUT" > "$KEY_RAW"
  $PY -I - "$KEY_RAW" "$KEY_TMP" <<'PYEOF'
import re, sys, textwrap
from cryptography.hazmat.primitives import serialization
text = open(sys.argv[1], encoding="utf-8", errors="replace").read()
match = re.search(r"-----BEGIN ([A-Z ]+)-----(.*?)-----END \1-----", text, re.S)
if not match:
    sys.exit("No PEM private key found in the key file")
kind, body = match.group(1), re.sub(r"\s+", "", match.group(2))
pem = f"-----BEGIN {kind}-----\n" + "\n".join(textwrap.wrap(body, 64)) + f"\n-----END {kind}-----\n"
try:
    serialization.load_pem_private_key(pem.encode(), password=None)
except (ValueError, TypeError) as exc:
    sys.exit(f"The key does not load: {type(exc).__name__}")
with open(sys.argv[2], "w", encoding="utf-8") as handle:
    handle.write(pem)
print(f"   the key loads ({kind})")
PYEOF
}
# Both checks need the gateway's Python: with one installed they run before the daemon stops,
# so a bad file changes nothing; on a first install the key's runs after the build.
CHECKED=''
if [ -x $PY ]; then
  echo "0. Check what was passed, before anything stops"
  [ -z "$KEY_INPUT" ] || check_key
  [ ! -s "$STAGE/gateway.json" ] || check_config
  CHECKED=1
fi

echo "1. Service account $SVC ($ID), no login, no home"
if ! dscl . -read /Groups/$SVC >/dev/null 2>&1; then
  dscl . -create /Groups/$SVC
  dscl . -create /Groups/$SVC PrimaryGroupID $ID
  dscl . -create /Groups/$SVC RealName "Factory gateway"
  dscl . -create /Groups/$SVC Password '*'
fi
if ! id $SVC >/dev/null 2>&1; then
  dscl . -create /Users/$SVC
  dscl . -create /Users/$SVC UniqueID $ID
  dscl . -create /Users/$SVC PrimaryGroupID $ID
  dscl . -create /Users/$SVC UserShell /usr/bin/false
  dscl . -create /Users/$SVC NFSHomeDirectory /var/empty
  dscl . -create /Users/$SVC RealName "Factory gateway"
  dscl . -create /Users/$SVC Password '*'
  dscl . -create /Users/$SVC IsHidden 1
fi

echo "2. Stop the daemon; directories"
launchctl bootout system/$LABEL 2>/dev/null || true
for _ in $(seq 30); do
  launchctl print system/$LABEL >/dev/null 2>&1 || break
  sleep 1
done
install -d -o root -g wheel -m 0755 $ROOT
install -d -o $SVC -g $SVC -m 0700 $ROOT/data
install -d -o root -g $SVC -m 0750 $ROOT/etc
install -d -o $SVC -g $SVC -m 0750 $ROOT/log

echo "3. The app, root-owned, from main at $(cat "$STAGE/src.rev")"
rm -rf $ROOT/app
install -d -o root -g wheel -m 0755 $ROOT/app $ROOT/app/src
tar -x -C $ROOT/app/src -f "$STAGE/src.tar"
CACHE=$(mktemp -d)
( cd $ROOT/app/src/endpoints/botcore/plugins/botcore-factory &&
  HOME=/var/root UV_CACHE_DIR=$CACHE UV_PYTHON_INSTALL_DIR=$ROOT/app/python \
  UV_PYTHON_PREFERENCE=only-managed UV_PROJECT_ENVIRONMENT=$ROOT/app/venv \
  "$STAGE/uv" sync --frozen --no-editable --extra gateway -q )
install -m 0644 "$STAGE/src.rev" $ROOT/app/REVISION
chown -R root:wheel $ROOT/app
chmod -R go-w $ROOT/app
if [ -z "$CHECKED" ] && [ -n "$KEY_INPUT" ]; then check_key; fi

echo "4. Configuration"
# Checked by the code just built, which is what will read it. A staged file the new code
# refuses is left out, and the run ends as a failure once the daemon is back up.
REFUSED=''
if [ -s "$STAGE/gateway.json" ]; then
  if check_config; then
    [ ! -s $ROOT/etc/gateway.json ] || cp -p $ROOT/etc/gateway.json $ROOT/etc/gateway.json.prev
    install -o root -g $SVC -m 0640 "$CONFIG_TMP" $ROOT/etc/gateway.json
  else
    REFUSED=1
    echo "   the new code refuses the staged gateway.json; it is not installed" >&2
  fi
else
  echo "   kept the installed gateway.json"
fi

echo "5. The App's private key, readable by $SVC only"
if [ -n "$KEY_TMP" ]; then
  install -o $SVC -g $SVC -m 0600 "$KEY_TMP" $ROOT/etc/app.pem
else
  echo "   kept the installed key"
fi

echo "6. Launch daemon"
if [ -s "$STAGE/$LABEL.plist" ]; then
  install -o root -g wheel -m 0644 "$STAGE/$LABEL.plist" "$PLIST"
else
  echo "   kept the installed launch daemon"
fi
if [ -s $ROOT/etc/gateway.json ]; then
  launchctl bootstrap system "$PLIST"
  sleep 5
  launchctl print system/$LABEL | grep -E "state|pid|last exit" | head -4
else
  echo "   not started: no configuration is installed" >&2
fi

echo "7. The owner's token, written by $OWNER_USER, never by root"
OWNER_DIR=$OWNER_HOME/.config/factory-gateway
as_owner sh -c 'umask 077; mkdir -p "$1" && chmod 700 "$1"' _ "$OWNER_DIR"
if as_owner test -s "$OWNER_DIR/owner.token"; then
  echo "   kept $OWNER_DIR/owner.token"
else
  sudo -u $SVC $ROOT/app/venv/bin/factory-gateway-admin token issue \
    --data $ROOT/data --route owner --kind human --actor owner --label "owner on $(hostname -s)" |
    $PY -I -c 'import json,sys; print(json.load(sys.stdin)["token"], end="")' |
    as_owner sh -c 'umask 077; cat > "$1"' _ "$OWNER_DIR/owner.token"
  echo "   issued (written to $OWNER_DIR/owner.token, not printed)"
fi

if [ -n "$REFUSED" ]; then
  echo "Failed: $(cat $ROOT/app/REVISION) is installed without the staged gateway.json." >&2
  exit 1
fi
echo "Done: $(cat $ROOT/app/REVISION) is installed."

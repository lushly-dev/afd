#!/bin/bash
# Installs or updates the factory gateway as a launch daemon on macOS. Run with sudo, from the
# owner's account:
#   sudo bash install.sh <staging dir> [<private key file>]
# The staging dir holds src.tar, src.rev, uv and the plist, and gateway.json on a first install
# (the runbook's "Stage" step). Pass the key file on the first install and when replacing the
# key; without it the installed key stays. Safe to run again: state, tokens and mirrors in
# data/ are kept, and so are the configuration and the owner's token when they exist.
set -euo pipefail
umask 022
STAGE=$1 KEY_INPUT=${2:-}
ROOT=/Library/FactoryGateway
SVC=_factorygw ID=450
LABEL=dev.lushly.factory-gateway
PLIST=/Library/LaunchDaemons/$LABEL.plist
OWNER_USER=${SUDO_USER:?run this with sudo}
OWNER_HOME=$(dscl . -read "/Users/$OWNER_USER" NFSHomeDirectory | awk '{print $2}')

for file in src.tar src.rev uv "$LABEL.plist"; do
  [ -s "$STAGE/$file" ] || { echo "$STAGE/$file is missing" >&2; exit 2; }
done
if [ -z "$KEY_INPUT" ] && [ ! -s $ROOT/etc/app.pem ]; then
  echo "No key is installed yet: pass the App's private key file" >&2; exit 2
fi
if [ ! -s "$STAGE/gateway.json" ] && [ ! -s $ROOT/etc/gateway.json ]; then
  echo "No configuration is installed yet: put gateway.json in $STAGE" >&2; exit 2
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
rm -rf "$CACHE"
install -m 0644 "$STAGE/src.rev" $ROOT/app/REVISION
chown -R root:wheel $ROOT/app
chmod -R go-w $ROOT/app

echo "4. Configuration"
if [ -s "$STAGE/gateway.json" ]; then
  install -o root -g $SVC -m 0640 "$STAGE/gateway.json" $ROOT/etc/gateway.json
else
  echo "   kept the installed gateway.json"
fi

echo "5. The App's private key, readable by $SVC only"
if [ -n "$KEY_INPUT" ]; then
  KEY_TMP=$(mktemp)
  # A pasted key may arrive on one line: rebuild the PEM, then prove it loads.
  $ROOT/app/venv/bin/python -I - "$KEY_INPUT" "$KEY_TMP" <<'PY'
import re, sys, textwrap
from cryptography.hazmat.primitives import serialization
text = open(sys.argv[1], encoding="utf-8").read()
match = re.search(r"-----BEGIN ([A-Z ]+)-----(.*?)-----END \1-----", text, re.S)
if not match:
    sys.exit("No PEM private key found in the input")
kind, body = match.group(1), re.sub(r"\s+", "", match.group(2))
pem = f"-----BEGIN {kind}-----\n" + "\n".join(textwrap.wrap(body, 64)) + f"\n-----END {kind}-----\n"
serialization.load_pem_private_key(pem.encode(), password=None)
with open(sys.argv[2], "w", encoding="utf-8") as handle:
    handle.write(pem)
print(f"   key loads ({kind})")
PY
  install -o $SVC -g $SVC -m 0600 "$KEY_TMP" $ROOT/etc/app.pem
  rm -f "$KEY_TMP"
else
  echo "   kept the installed key"
fi

echo "6. The owner's token, for $OWNER_USER only"
OWNER_DIR=$OWNER_HOME/.config/factory-gateway
install -d -o "$OWNER_USER" -g staff -m 0700 "$OWNER_DIR"
if [ ! -s "$OWNER_DIR/owner.token" ]; then
  TOKEN_JSON=$(sudo -u $SVC $ROOT/app/venv/bin/factory-gateway-admin token issue \
    --data $ROOT/data --route owner --kind human --actor owner --label "owner on $(hostname -s)")
  ( umask 077; printf '%s' "$TOKEN_JSON" | $ROOT/app/venv/bin/python -I -c \
      'import json,sys; print(json.load(sys.stdin)["token"], end="")' > "$OWNER_DIR/owner.token" )
  chown "$OWNER_USER":staff "$OWNER_DIR/owner.token"
  echo "   issued (written to $OWNER_DIR/owner.token, not printed)"
else
  echo "   kept $OWNER_DIR/owner.token"
fi

echo "7. Launch daemon"
install -o root -g wheel -m 0644 "$STAGE/$LABEL.plist" "$PLIST"
launchctl bootstrap system "$PLIST"
sleep 5
launchctl print system/$LABEL | grep -E "state|pid|last exit" | head -4
echo "Done: $(cat $ROOT/app/REVISION) is installed."

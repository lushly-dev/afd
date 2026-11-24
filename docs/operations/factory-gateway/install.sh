#!/bin/bash
# Installs or updates the factory gateway as a launch daemon on macOS. Run with sudo, from the
# owner's account:
#   sudo bash install.sh <staging dir> [<private key file>]
# The staging dir (the runbook's "Update the code") holds src.tar, src.rev and uv, and may hold
# gateway.json and the launch daemon's plist; a first install needs both. Pass the key file on
# the first install and when replacing the key. Whatever is not staged or passed stays as
# installed, and so do data/ (state, journal, tokens, mirrors) and the owner's token.
#
# The new code is built in a release of its own beside the running one, while the old code keeps
# serving. It checks the configuration it will read, a key passed to it and a staged plist, and
# the owner's token is issued if there is none. Only then does the daemon stop, `app` switch to
# the new release and the daemon start again. A failed build or check removes the new release
# and leaves the running gateway as it was. The last release that answered is kept, so going
# back is a switch.
#
# It trusts the account that stages it: root reads src.rev, unpacks the staged source and runs
# the staged uv.
# Root reads the configuration, the plist and the key through that account, and never writes
# in its home.
set -euo pipefail
umask 022
unset CDPATH
STAGE=$1 KEY_INPUT=${2:-}
ROOT=/Library/FactoryGateway
RELEASES=$ROOT/releases
LOCK=$ROOT/.install.lock
SVC=_factorygw ID=450
LABEL=dev.lushly.factory-gateway
PLIST=/Library/LaunchDaemons/$LABEL.plist
# How long a started daemon may take to answer. Its first start fetches each repository's
# history into its mirror before it listens, which takes minutes.
START_SECONDS=900
OWNER_USER=${SUDO_USER:?run this with sudo}
[ "$OWNER_USER" != root ] || { echo "Run this with sudo from the owner's account, not as root" >&2; exit 2; }
OWNER_HOME=$(dscl . -read "/Users/$OWNER_USER" NFSHomeDirectory | sed 's/^NFSHomeDirectory: //')
[ -d "$OWNER_HOME" ] || { echo "No home directory found for $OWNER_USER" >&2; exit 2; }
as_owner() { sudo -u "$OWNER_USER" "$@"; }

running_revision() { cat $ROOT/app/REVISION 2>/dev/null || echo "no release"; }
# Starts the daemon whether launchd still holds it or not: kickstart needs it loaded.
START="sudo launchctl kickstart -k system/$LABEL 2>/dev/null || sudo launchctl bootstrap system $PLIST"
# How to go back once `app` has switched: to the last release that answered, or to the code an
# install before releases left in place.
rollback_hint() {
  if [ -n "$PREV" ]; then
    echo "To go back to $(cat "$PREV/REVISION" 2>/dev/null || basename "$PREV"):" >&2
    echo "  sudo ln -sfh $PREV $ROOT/app && sudo ln -sfh $PREV $ROOT/app.last-good &&" >&2
    echo "    { $START; }" >&2
  elif [ -d $ROOT/app.legacy ]; then
    echo "To go back to $(cat $ROOT/app.legacy/REVISION 2>/dev/null || echo 'the code before'):" >&2
    echo "  sudo rm $ROOT/app && sudo mv $ROOT/app.legacy $ROOT/app && { $START; }" >&2
  else
    echo "No release answered before this one: fix what the log says and run again." >&2
  fi
  [ -z "$CONFIG_INSTALLED" ] || [ ! -s $ROOT/etc/gateway.json.prev ] ||
    echo "The configuration the last good release read is $ROOT/etc/gateway.json.prev." >&2
  [ -z "$PLIST_INSTALLED" ] || [ ! -s "$PLIST.prev" ] ||
    echo "The launch daemon it ran under is $PLIST.prev; to use it, bootout first, copy it" \
      "over $PLIST and bootstrap." >&2
}

KEY_RAW='' KEY_TMP='' CONFIG_TMP='' PLIST_TMP='' CACHE='' REL='' PREV='' CURRENT=''
LOCKED='' STOPPED='' SWITCHED='' ANSWERED='' CONFIG_INSTALLED='' PLIST_INSTALLED=''
cleanup() {
  local rc=$?
  [ -z "$KEY_RAW" ] || rm -f "$KEY_RAW"
  [ -z "$KEY_TMP" ] || rm -f "$KEY_TMP"
  [ -z "$CONFIG_TMP" ] || rm -f "$CONFIG_TMP"
  [ -z "$PLIST_TMP" ] || rm -f "$PLIST_TMP"
  [ -z "$CACHE" ] || rm -rf "$CACHE"
  if [ "$rc" != 0 ]; then
    if [ -n "$ANSWERED" ]; then
      echo "Failed after $(running_revision) answered: it is installed, and only the end failed." >&2
    elif [ -n "$SWITCHED" ]; then
      if [ "$rc" -ge 129 ]; then
        echo "Interrupted after the switch to $(running_revision); it may still be starting." >&2
      else
        echo "Failed after the switch to $(running_revision)." >&2
      fi
      rollback_hint
    else
      [ -z "$REL" ] || rm -rf "$REL"
      if [ -n "$STOPPED" ]; then
        echo "Failed with the daemon stopped; app still points at $(running_revision)." >&2
        [ -e $ROOT/app ] || [ ! -d $ROOT/app.legacy ] ||
          echo "The code before is $ROOT/app.legacy: sudo mv $ROOT/app.legacy $ROOT/app" >&2
        echo "To start it again: $START" >&2
      elif [ ! -e $ROOT/app ]; then
        echo "Failed before any code was installed: fix what it says and run again." >&2
      else
        echo "Failed before the daemon stopped: $(running_revision) still runs as it did." >&2
      fi
    fi
  fi
  [ -z "$LOCKED" ] || rmdir "$LOCK"
}
trap cleanup EXIT
# A signal ends the run through cleanup, with a status that says it failed.
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

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
# The revision names the release's directory, so it must be a commit and nothing else.
REV=$(cat "$STAGE/src.rev")
[[ $REV =~ ^[0-9a-f]{7,40}$ ]] || { echo "$STAGE/src.rev is not a commit: $REV" >&2; exit 2; }

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

# One run at a time: two would build and prune in the same releases.
install -d -o root -g wheel -m 0755 $ROOT
mkdir "$LOCK" 2>/dev/null || {
  echo "Another install is running, or one was killed: remove $LOCK once none runs" >&2; exit 2
}
LOCKED=1

# The last release that answered, which a failed run never replaces, so a run after a failed
# one still goes back to code that worked. What `app` points at now is kept too, since the
# owner may have gone back to another release by hand.
# Each is read as the directory it names, so a link written by hand with a trailing slash or a
# relative path names the same release.
resolve() { [ -L "$1" ] && (cd "$ROOT" && cd "$(readlink "$1")" 2>/dev/null && pwd -P) || true; }
PREV=$(resolve $ROOT/app.last-good)
CURRENT=$(resolve $ROOT/app)
# The files a run replaces are kept as .prev only while what runs is the last good release, so
# a run after a failed one keeps the copies that worked.
GOOD_NOW=''
if [ ! -L $ROOT/app ] || { [ -n "$PREV" ] && [ "$CURRENT" = "$PREV" ]; }; then GOOD_NOW=1; fi

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

echo "2. Directories"
install -d -o root -g wheel -m 0755 $RELEASES
install -d -o $SVC -g $SVC -m 0700 $ROOT/data
install -d -o root -g $SVC -m 0750 $ROOT/etc
install -d -o $SVC -g $SVC -m 0750 $ROOT/log

# The release carries its own Python and environment, whose paths name the release, so it runs
# where it was built and `app` only points at it. REVISION is written once the build succeeds.
NEW=$RELEASES/$REV-$(date -u +%Y%m%dT%H%M%SZ)
[ ! -e "$NEW" ] || { echo "$NEW already exists: run again in a second" >&2; exit 2; }
echo "3. Build $REV in $NEW, beside the running $(running_revision)"
install -d -o root -g wheel -m 0755 "$NEW"
REL=$NEW
install -d -o root -g wheel -m 0755 "$REL/src"
tar -x -C "$REL/src" -f "$STAGE/src.tar"
CACHE=$(mktemp -d)
( cd "$REL/src/endpoints/botcore/plugins/botcore-factory" &&
  HOME=/var/root UV_CACHE_DIR=$CACHE UV_PYTHON_INSTALL_DIR=$REL/python \
  UV_PYTHON_PREFERENCE=only-managed UV_PROJECT_ENVIRONMENT=$REL/venv \
  "$STAGE/uv" sync --frozen --no-editable --extra gateway -q )
install -m 0644 "$STAGE/src.rev" "$REL/REVISION"
chown -R root:wheel "$REL"
chmod -R go-w "$REL"
PY=$REL/venv/bin/python

echo "4. Check, with the new code, what it will read"
# Each staged file is read by the owner's account into a copy only root can change, so root
# follows no link of its choosing and what is checked is what is installed.
check_config() {
  $PY -I - "$1" "$2" <<'PYEOF'
import sys
from botcore_factory.gateway.config import GatewayConfig
path, name = sys.argv[1], sys.argv[2]
try:
    config = GatewayConfig.model_validate_json(open(path, encoding="utf-8").read())
except ValueError as exc:
    sys.exit(f"{name} is refused by the new code: {exc}")
if config.github_app is None:
    sys.exit(f"{name} is refused by the new code: it has no githubApp")
print(f"   {name} loads")
PYEOF
}
if [ -s "$STAGE/gateway.json" ]; then
  CONFIG_TMP=$(mktemp)
  as_owner cat "$STAGE/gateway.json" > "$CONFIG_TMP"
  check_config "$CONFIG_TMP" "the staged gateway.json"
else
  check_config $ROOT/etc/gateway.json "the installed gateway.json"
fi
# Rebuilds the key as a PEM (a pasted key may arrive on one line) and proves it loads. A key
# already installed is not read again: the running gateway has been reading it.
if [ -n "$KEY_INPUT" ]; then
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
fi
# The plist launchd will load: it must parse, and name the address and port the daemon binds,
# which is how the start is confirmed.
DAEMON_PLIST=$PLIST
if [ -s "$STAGE/$LABEL.plist" ]; then
  PLIST_TMP=$(mktemp)
  as_owner cat "$STAGE/$LABEL.plist" > "$PLIST_TMP"
  plutil -lint -s "$PLIST_TMP" || { echo "The staged launch daemon does not parse" >&2; exit 1; }
  DAEMON_PLIST=$PLIST_TMP
fi
URL=$($PY -I - "$DAEMON_PLIST" "$LABEL" "$SVC" <<'PYEOF'
import plistlib, sys
try:
    args = plistlib.load(open(sys.argv[1], "rb"))["ProgramArguments"]
    value = lambda flag: args[args.index(flag) + 1]
    url = f"http://{value('--address')}:{value('--port')}/owner/call"
except (KeyError, ValueError, IndexError, plistlib.InvalidFileException) as exc:
    sys.exit(f"The launch daemon names no --address and --port: {type(exc).__name__}")
# launchd loads it under its Label, which every launchctl call here names, and the service runs
# as its own account only.
plist = plistlib.load(open(sys.argv[1], "rb"))
for key, want in (("Label", sys.argv[2]), ("UserName", sys.argv[3]), ("GroupName", sys.argv[3])):
    if plist.get(key) != want:
        sys.exit(f"The launch daemon's {key} is {plist.get(key)!r}, not {want!r}")
print(url)
PYEOF
)
echo "   the launch daemon parses; the daemon will answer at $URL"

echo "5. The owner's token, written by $OWNER_USER, never by root"
OWNER_DIR=$OWNER_HOME/.config/factory-gateway
as_owner sh -c 'umask 077; mkdir -p "$1" && chmod 700 "$1"' _ "$OWNER_DIR"
if as_owner test -s "$OWNER_DIR/owner.token"; then
  echo "   kept $OWNER_DIR/owner.token"
else
  sudo -u $SVC "$REL/venv/bin/factory-gateway-admin" token issue \
    --data $ROOT/data --route owner --kind human --actor owner --label "owner on $(hostname -s)" |
    $PY -I -c 'import json,sys; print(json.load(sys.stdin)["token"], end="")' |
    as_owner sh -c 'umask 077; cat > "$1"' _ "$OWNER_DIR/owner.token"
  echo "   issued (written to $OWNER_DIR/owner.token, not printed)"
fi

echo "6. Stop the daemon and switch app to the new release"
STOPPED=1
launchctl bootout system/$LABEL 2>/dev/null || true
for _ in $(seq 30); do
  launchctl print system/$LABEL >/dev/null 2>&1 || break
  sleep 1
done
if launchctl print system/$LABEL >/dev/null 2>&1; then
  echo "   launchd still holds $LABEL after 30 seconds" >&2; exit 1
fi
# An install before releases built in app itself. Its paths name app, so it is moved aside
# whole: it can come back by moving it back, and is removed once the new release answers.
if [ -d $ROOT/app ] && [ ! -L $ROOT/app ]; then
  rm -rf $ROOT/app.legacy
  mv $ROOT/app $ROOT/app.legacy
fi
ln -sfh "$REL" $ROOT/app
SWITCHED=1

echo "7. Configuration"
if [ -n "$CONFIG_TMP" ]; then
  [ -z "$GOOD_NOW" ] || [ ! -s $ROOT/etc/gateway.json ] ||
    cp -p $ROOT/etc/gateway.json $ROOT/etc/gateway.json.prev
  install -o root -g $SVC -m 0640 "$CONFIG_TMP" $ROOT/etc/gateway.json
  CONFIG_INSTALLED=1
else
  echo "   kept the installed gateway.json"
fi

echo "8. The App's private key, readable by $SVC only"
if [ -n "$KEY_TMP" ]; then
  install -o $SVC -g $SVC -m 0600 "$KEY_TMP" $ROOT/etc/app.pem
else
  echo "   kept the installed key"
fi

echo "9. Launch daemon"
if [ -n "$PLIST_TMP" ]; then
  [ -z "$GOOD_NOW" ] || [ ! -s "$PLIST" ] || cp -p "$PLIST" "$PLIST.prev"
  install -o root -g wheel -m 0644 "$PLIST_TMP" "$PLIST"
  PLIST_INSTALLED=1
else
  echo "   kept the installed launch daemon"
fi
launchctl bootstrap system "$PLIST"
# The daemon has started once its address answers HTTP: an unauthenticated call is refused,
# which only a listening gateway can do. Until then it may still be fetching its mirrors, so a
# live process is waited on. A start fails once launchd shows the daemon not running for 10
# seconds, or running under another pid: launchd started it again, so the first one exited.
ANSWER=000 EXITED='' FIRST_PID='' DOWN_SINCE='' NOTED=0
BEGAN=$SECONDS
while [ $((SECONDS - BEGAN)) -lt $START_SECONDS ]; do
  ANSWER=$(curl -s -o /dev/null -w '%{http_code}' -m 2 -X POST "$URL" || true)
  [ "$ANSWER" = 000 ] || break
  STATE=$(launchctl print system/$LABEL 2>/dev/null || true)
  if [[ $STATE == *"state = running"* ]]; then
    DOWN_SINCE=''
    PID=$(sed -n 's/^[[:space:]]*pid = \([0-9]*\).*/\1/p' <<<"$STATE" | head -1)
    [ -n "$FIRST_PID" ] || FIRST_PID=$PID
    [ -z "$PID" ] || [ "$PID" = "$FIRST_PID" ] || { EXITED=1; break; }
  else
    [ -n "$DOWN_SINCE" ] || DOWN_SINCE=$SECONDS
    [ $((SECONDS - DOWN_SINCE)) -lt 10 ] || { EXITED=1; break; }
  fi
  if [ $((SECONDS - BEGAN)) -ge $((NOTED + 60)) ]; then
    NOTED=$((SECONDS - BEGAN))
    echo "   still starting after $NOTED seconds"
  fi
  sleep 1
done
if [ "$ANSWER" = 000 ]; then
  if [ -n "$EXITED" ]; then
    echo "   the daemon exited before $URL answered" >&2
  else
    echo "   $URL did not answer within $START_SECONDS seconds" >&2
  fi
  launchctl print system/$LABEL 2>/dev/null | grep -E '^\s*(state|pid|last exit code) =' >&2 || true
  tail -8 $ROOT/log/gateway.log >&2 || true
  exit 1
fi
ANSWERED=1
echo "   $URL answers ($ANSWER without a token)"

echo "10. Releases: keep this one, the last one that answered before it and the one app left"
ln -sfh "$REL" $ROOT/app.last-good
for release in "$RELEASES"/*; do
  [ "$release" -ef "$REL" ] || { [ -n "$PREV" ] && [ "$release" -ef "$PREV" ]; } ||
    { [ -n "$CURRENT" ] && [ "$release" -ef "$CURRENT" ]; } || rm -rf "$release"
done
rm -rf $ROOT/app.legacy

echo "Done: $REV is installed in $REL."
[ -z "$PREV" ] || echo "The release before it, $PREV, is kept: going back is a switch to it."

#!/bin/bash
# Installs a changed gateway.json and restarts the daemon. Run with sudo:
#   sudo bash reconfigure.sh <dir holding the new gateway.json>
# Refuses a file the gateway would not load, before anything changes. Keeps the replaced file
# as gateway.json.prev, and prints the daemon's state, the end of its log and each mirror's
# main.
set -euo pipefail
ROOT=/Library/FactoryGateway
LABEL=dev.lushly.factory-gateway
NEW=$(mktemp)
trap 'rm -f "$NEW"' EXIT
# A copy only root can change, so what is checked is what is installed. The account that ran
# sudo does the reading, so root follows no link of its choosing.
OWNER_USER=${SUDO_USER:?run this with sudo}
[ "$OWNER_USER" != root ] || { echo "Run this with sudo from the owner's account, not as root" >&2; exit 2; }
sudo -u "$OWNER_USER" cat "$1/gateway.json" > "$NEW"
$ROOT/app/venv/bin/python -I - "$NEW" <<'PYEOF'
import sys
from botcore_factory.gateway.config import GatewayConfig
try:
    config = GatewayConfig.model_validate_json(open(sys.argv[1], encoding="utf-8").read())
except ValueError as exc:
    sys.exit(f"gateway.json is refused: {exc}")
if config.github_app is None:
    sys.exit("gateway.json is refused: it has no githubApp")
PYEOF
cp -p $ROOT/etc/gateway.json $ROOT/etc/gateway.json.prev
install -o root -g _factorygw -m 0640 "$NEW" $ROOT/etc/gateway.json
launchctl kickstart -k system/$LABEL
sleep 15
# Read whole, then filtered: a pipe that closes early, or a state line not printed, would
# otherwise end the script before the log and the mirrors.
STATE=$(launchctl print system/$LABEL 2>&1 || true)
grep -E '^\s*(state|pid) =' <<<"$STATE" | head -2 || echo "launchd reports no state for $LABEL"
echo "--- log"
tail -8 $ROOT/log/gateway.log
echo "--- mirrors"
cd /var/empty
for mirror in "$ROOT"/data/mirrors/*.git; do
  [ -e "$mirror" ] || continue
  main=$(sudo -u _factorygw git --git-dir="$mirror" rev-parse --short refs/heads/main 2>/dev/null) ||
    main="not fetched yet"
  echo "$(basename "$mirror") main at $main"
done

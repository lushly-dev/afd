#!/bin/bash
# Installs a changed gateway.json and restarts the daemon. Run with sudo:
#   sudo bash reconfigure.sh <dir holding the new gateway.json>
# Prints the daemon's state, the end of its log and each mirror's main.
set -euo pipefail
STAGE=$1
install -o root -g _factorygw -m 0640 "$STAGE/gateway.json" /Library/FactoryGateway/etc/gateway.json
launchctl kickstart -k system/dev.lushly.factory-gateway
sleep 15
launchctl print system/dev.lushly.factory-gateway | grep -E "^\s*(state|pid) =" | head -2
echo "--- log"; tail -8 /Library/FactoryGateway/log/gateway.log
echo "--- mirrors"
cd /var/empty
for m in /Library/FactoryGateway/data/mirrors/*.git; do
  echo "$(basename "$m") main at $(sudo -u _factorygw git --git-dir="$m" rev-parse --short refs/heads/main 2>&1)"
done

#!/usr/bin/env bash
# AFD's own clients against a running Umbel (specification section 13): serve `umbel-todo` over
# Streamable HTTP with hello and todo enabled, then run `afd validate --surface --strict` and the
# todo example's JTBD scenarios against it, with the bearer token the server prints.
#
# Usage: external-clients.sh <umbel-todo binary> <afd bin.js> <scenario directory>
# Needs node and a free loopback port. Uses a temporary workspace and a temporary `afd` config
# directory; nothing in the repository is written.
set -euo pipefail

umbel_todo=$1
afd=$2
scenarios=$3

work=$(mktemp -d)
pid=
cleanup() {
	if [ -n "$pid" ]; then
		kill "$pid" 2>/dev/null || true
		wait "$pid" 2>/dev/null || true
	fi
	rm -rf "$work"
}
trap cleanup EXIT

port=$(node -e "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")
mkdir "$work/workspace"
cat >"$work/workspace/umbel.toml" <<TOML
config_version = 2

[plugins]
enabled = ["hello", "todo"]

[mcp]
confirmations = "off"

[http]
bind = "127.0.0.1:$port"
TOML

"$umbel_todo" --workspace "$work/workspace" serve --http --print-token >"$work/stdout" 2>"$work/stderr" &
pid=$!

url="http://127.0.0.1:$port"
for _ in $(seq 1 120); do
	token=$(head -n 1 "$work/stdout" 2>/dev/null || true)
	if [ -n "$token" ] && curl -fsS -H "Authorization: Bearer $token" "$url/health" >/dev/null 2>&1; then
		break
	fi
	if ! kill -0 "$pid" 2>/dev/null; then
		echo "umbel-todo exited before it was ready:" >&2
		cat "$work/stderr" >&2
		exit 1
	fi
	sleep 0.5
done
curl -fsS -H "Authorization: Bearer $token" "$url/health" >/dev/null

# The saved connection (`afd connect`) never holds the header; every later command passes it again.
export XDG_CONFIG_HOME="$work/config"
export HOME="$work/home"
mkdir -p "$HOME"
header="Authorization: Bearer $token"

node "$afd" connect "$url/mcp" -H "$header"
# --strict makes every warning fail. Three rules are suppressed, each for a reason outside this
# script: `description-quality` flags the one-line descriptions of Umbel's built-in commands
# (src/, which step 6 may not change) and of the todo example; `schema-overlap` flags the todo
# example's id-only commands (todo-get, todo-toggle, todo-delete) and `schema-complexity` its
# todo-list and Umbel's event-list, whose inputs the shared suites and phase 0 fix. Everything
# else (names, injection, duplicates, naming collisions) still fails.
node "$afd" validate --surface --strict \
	--suppress description-quality --suppress schema-overlap --suppress schema-complexity -H "$header"
node "$afd" scenario run "$scenarios" -s "$url/mcp" -H "$header"

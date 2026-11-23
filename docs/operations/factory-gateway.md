# Factory Gateway runbook

For the operator of the Factory Gateway: the service that makes the software factory's GitHub
writes as one GitHub App. Agents and sessions do not need this page; the gateway's own `docs`
topic tells a caller how to use it. What is built and what is not is in the
[status](../features/active/factory-gateway/STATUS.md), and the design in the
[proposal](../features/active/factory-gateway/factory-gateway.proposal.md).

## What runs where

| | |
|---|---|
| Host | `random` (macOS), reached over the tailnet at `http://100.82.142.64:8787` |
| GitHub App | `lushly-factory-gateway`, App ID `5777732`, installation `182417554` on `lushly-dev`, limited to `lushly-dev/afd` and `lushly-dev/lushly`. Its writes appear as `lushly-factory-gateway[bot]` |
| Service | The launch daemon `dev.lushly.factory-gateway`, which runs `factory-gateway-admin serve` and is set to start at boot ([Restart and boot](#restart-and-boot)) |
| Account | `_factorygw` (user and group 450): hidden, no login shell, no home |
| Code | `/Library/FactoryGateway/app`, owned by root so the service cannot change what it runs: the source (`src`), its own Python (`python`), the environment (`venv`) and `REVISION`, the commit of `main` it was built from |
| State | `/Library/FactoryGateway/data`, the service's alone: `state.json`, the journal, `tokens.json`, uploads and one bare mirror per repository |
| Configuration | `/Library/FactoryGateway/etc/gateway.json` (root's, readable by the service) and `app.pem`, the App's private key (the service's, mode 0600; the gateway refuses to start if anyone else can read it) |
| Log | `/Library/FactoryGateway/log/gateway.log`, readable by the service only: `sudo tail` it |

The files beside this page are what is installed:
[`install.sh`](factory-gateway/install.sh),
[`reconfigure.sh`](factory-gateway/reconfigure.sh),
[the launch daemon](factory-gateway/dev.lushly.factory-gateway.plist) and
[an example configuration](factory-gateway/gateway.example.json).

Run the commands on this page from the root of an AFD checkout on `random`. The two scripts run
as root and trust the account that stages them: root runs the staged `uv` and installs the
staged launch daemon. So each procedure takes the scripts from `origin/main`, never from a
branch, and installs straight after staging.

## Check it

```bash
export FACTORY_GATEWAY_URL=http://100.82.142.64:8787
export FACTORY_GATEWAY_ROUTE=owner
export FACTORY_GATEWAY_TOKEN_FILE=~/.config/factory-gateway/owner.token
uv run --frozen --project endpoints/botcore/plugins/botcore-factory factory-gateway call gateway-status
```

A healthy answer has `success: true`, `identity` `lushly-factory-gateway[bot]`, both repositories,
GitHub's remaining REST rate limit (`rateLimit`, plus `rateLimit.graphql` when GitHub supplies
the GraphQL budget), and `ages` (`appKey`: seconds since the private key file was installed or
replaced; `token`: seconds left on the current installation token). From a machine without a
checkout, the same call
is one request:

```bash
printf 'Authorization: Bearer %s\n' "$(cat ~/.config/factory-gateway/owner.token)" |
  curl -s -H @- -H 'Content-Type: application/json' -d '{"command":"gateway-status"}' \
    http://100.82.142.64:8787/owner/call
```

The header goes in on standard input so the token is never an argument another process can
read.

On `random` itself:

```bash
cat /Library/FactoryGateway/app/REVISION                    # the commit it runs
launchctl print system/dev.lushly.factory-gateway | grep -E 'state|pid|last exit'
sudo tail -30 /Library/FactoryGateway/log/gateway.log
```

At startup the gateway fetches each repository's `main` into its mirror. It logs
`Could not fetch <repo>'s main yet` when that fails and nothing when it works; an upload fetches
again.

## Callers and tokens

A caller needs the URL, its route and a token for that route. The five routes are `cell`,
`session`, `foreman`, `lane` and `owner`; the proposal says what each may do, and a token opens
only its own route. The gateway keeps a digest of each token, never the token.

The owner's token was written at install to `~/.config/factory-gateway/owner.token` on `random`,
mode 0600. Issue any other token on `random`, straight into a file only its user can read, so it
is never printed:

```bash
sudo -u _factorygw /Library/FactoryGateway/app/venv/bin/factory-gateway-admin token issue \
  --data /Library/FactoryGateway/data --route lane --kind service --actor lane@random \
  --label "the lane on random" |
  (umask 077; python3 -I -c 'import json,sys; print(json.load(sys.stdin)["token"], end="")' \
    > ~/.config/factory-gateway/lane.token)
```

`--kind` is `human`, `agent` or `service`; `--actor` is the name the journal records for every
write the token makes. Move a token to another machine over SSH, never through chat or a pull
request.

```bash
sudo -u _factorygw /Library/FactoryGateway/app/venv/bin/factory-gateway-admin token list \
  --data /Library/FactoryGateway/data
sudo -u _factorygw /Library/FactoryGateway/app/venv/bin/factory-gateway-admin token revoke \
  --data /Library/FactoryGateway/data <token id>
```

A revoked token is refused from the gateway's next call; no restart is needed for a new or a
revoked token.

## Change the configuration

`gateway.json` names the App, the bot, the owner, the repositories and what the gateway may do
in them. [The example](factory-gateway/gateway.example.json) shows the fields in use:

| Field | Meaning |
|---|---|
| `owner`, `ownerEmails` | The owner's GitHub login and every address his commits use. A push that adds a commit by any other author is refused (`COMMIT_AUTHOR_NOT_OWNER`) |
| `repositories` | The repositories the gateway serves; the App must be installed on each |
| `mergeMethods` | How `pr-merge` merges in each repository: `rebase`, `squash` or `merge` (the default). See [Merges and credit](#merges-and-credit) |
| `githubApp` | The App's ID and its installation's ID |
| `allowedVariables` | The repository variables `variable-set` may write; `FACTORY_LANE_HOST` when left out |

To change it, copy the installed file, edit the copy and install it:

```bash
CONFIG=$(mktemp -d)
git fetch origin main
git show origin/main:docs/operations/factory-gateway/reconfigure.sh > "$CONFIG/reconfigure.sh"
sudo cat /Library/FactoryGateway/etc/gateway.json > "$CONFIG/gateway.json"
# edit "$CONFIG/gateway.json"
sudo bash "$CONFIG/reconfigure.sh" "$CONFIG"
```

The script refuses a file the gateway would not load, naming what is wrong, before anything
changes. Otherwise it keeps the replaced file as `gateway.json.prev` beside the new one,
restarts the daemon and prints its state, the end of its log and each mirror's `main`. To go
back, install `gateway.json.prev` the same way.

## Update the code

The service runs the commit in `REVISION` until it is rebuilt; merging to `main` changes nothing
on `random`. Stage the new source as yourself:

```bash
STAGE=$(mktemp -d)
FILES=origin/main:docs/operations/factory-gateway
git fetch origin main
git archive -o "$STAGE/src.tar" origin/main python endpoints/botcore
git rev-parse --short origin/main > "$STAGE/src.rev"
git show $FILES/install.sh > "$STAGE/install.sh"
git show $FILES/dev.lushly.factory-gateway.plist > "$STAGE/dev.lushly.factory-gateway.plist"
cp "$(command -v uv)" "$STAGE/uv"
```

Then install it as root. The daemon is down for the minute or two the build takes; callers see
`GATEWAY_UNAVAILABLE` and retry.

```bash
sudo bash "$STAGE/install.sh" "$STAGE"
```

The script installs what is staged and keeps the rest: with no key file passed and no
`gateway.json` staged, the installed key and configuration stay. It always keeps `data` (state,
journal, tokens, mirrors) and the owner's token. Then [check it](#check-it).

It checks a key or configuration it is given before it stops the daemon, so a bad one changes
nothing. After that it removes the old code and builds the new: if the build fails (it
downloads Python packages), the gateway stays down until the script runs again and succeeds.
The new code checks a staged configuration once more before it is installed. One the new code
refuses is left out: the daemon starts on the installed file and the script ends as a failure.
A configuration that needs fields only the new code knows is refused by the first check, so
update the code first and [change the configuration](#change-the-configuration) after.

The launch daemon in the repository carries `random`'s tailnet address. If that address
changes, change it there first; an edited copy on the machine is replaced by the next update
that stages the file.

## Install from nothing

1. **The App.** In the organization's settings, create a GitHub App with no webhook and these
   repository permissions: actions and metadata read; actions variables, checks, contents,
   issues, pull requests and workflows read and write. Install it on the repositories the
   gateway serves only. Note the App ID and the installation ID (the number at the end of the
   installation's settings URL).
2. **The key.** On the App's settings page, under Credentials, then Key pairs, generate a
   private key. GitHub downloads a `.pem` file. It never goes into chat, a pull request or a
   repository: an agent that installs the gateway takes it through its harness's secret prompt.
3. **Stage** with the first block of [Update the code](#update-the-code).
4. **The configuration.** Copy [the example](factory-gateway/gateway.example.json) to
   `"$STAGE/gateway.json"` and fill in the owner, his commit addresses and the App's two IDs.
   `git log --format=%ae | sort -u` in each repository lists every author's address: keep only
   the owner's own.
5. **The address.** The launch daemon binds one address, `random`'s on the tailnet (the
   Tailscale app shows it). On another host, change `--address` in the staged plist.
6. **Install** once, from the same staging directory, with the key file as the second argument:

   ```bash
   sudo bash "$STAGE/install.sh" "$STAGE" ~/Downloads/<the key>.pem
   ```

   The script creates the account, builds the code, checks and installs the configuration and
   the key, starts the daemon and has the owner's account write the owner's token. It refuses
   to go on if another account holds the service's ID or sits in its group. Delete the
   downloaded key afterwards.

## Replace the App's key

Generate a second key under Credentials, then Key pairs (an App may hold several). Stage as in
[Update the code](#update-the-code), run `install.sh` with the new file as its second argument,
and confirm `gateway-status` answers with a fresh `ages.appKey`. Then
delete the old key on the same page and the downloaded file. Do the same at once if the key may
have left `random`: the old key works until GitHub deletes it.

## Restart and boot

```bash
sudo launchctl kickstart -k system/dev.lushly.factory-gateway
```

The daemon is set to start at boot, and launchd starts it again after any exit, at most once
every 30 seconds. It binds the tailnet address, which exists only once Tailscale is up: started
before that, it exits and launchd tries again. If Tailscale on `random` starts only when someone
logs in, the gateway answers only after that. After a restart of `random`, run
[Check it](#check-it) from another machine; the [status](../features/active/factory-gateway/STATUS.md)
says whether a restart has been tried yet.

Another service may hold port 8787 on the loopback address (an Umbel server does on `random`);
the gateway binds only the tailnet address, so the two do not meet.

## Merges and credit

Work that reaches `main` is credited to the owner: the gateway refuses a push whose commits he
did not author, and how it merges decides who authors the commit on `main`.

- **`rebase` keeps the owner as author.** GitHub lands the pull request's commits as they are.
  Merged directly (Lushly), the bot is only the committer, the commits are unsigned and their
  subjects carry no pull request number; who commits and signs a merge queue's rebase, and
  whether its subject gains one, is settled with AFD's switch ([#1809](https://github.com/lushly-dev/afd/issues/1809)). A pull
  request should hold one commit: every commit of the branch lands.
- **`squash` by the App credits the bot**, with no line for the owner. Do not merge work the
  owner should be credited for that way.
- A repository must allow the method (its settings, and any ruleset on `main`), or `pr-merge`
  answers `MERGE_METHOD_NOT_ALLOWED`.
- Where `main` merges through a merge queue, the queue merges by its own method, whatever
  `mergeMethods` says, though GitHub still refuses a `mergeMethods` value the repository does
  not allow. AFD's queue rebases and AFD allows nothing else
  ([#1809](https://github.com/lushly-dev/afd/issues/1809)), so `mergeMethods` must say `rebase`
  for AFD: with another value, `pr-merge` is refused when it would set auto-merge on a pull
  request whose check is still running.

## When something is wrong

| What you see | Likely cause | What to do |
|---|---|---|
| `GATEWAY_UNAVAILABLE`, or the connection is refused | The daemon is down, or Tailscale is, on either machine | `launchctl print` and the log on `random`; the Tailscale app on both |
| `UNAUTHORIZED` (HTTP 401) | No token, or one that was revoked or never issued here | Check the token file; issue a new token |
| `FORBIDDEN`: "This token opens /cell, not /lane" | A token used on another route | Use the token's own route, or issue one for the route |
| `GITHUB_UNAVAILABLE` | GitHub did not answer, or one of the App's rate limits is spent | Retry. `gateway-status` shows both GitHub's REST (`rateLimit`) and GraphQL (`rateLimit.graphql`) budgets and when each resets |
| `GITHUB_REFUSED` | GitHub refused the write; the message is GitHub's own | Fix what it names: a permission the App lacks, a rule on the branch |
| `MERGE_METHOD_NOT_ALLOWED` | `mergeMethods` names a method the repository does not allow | [Merges and credit](#merges-and-credit) |
| The daemon exits at once, again and again | A configuration it refuses, a key others can read, or the tailnet address is not up | The log names it |
| An upload is `BUNDLE_INVALID` | The bundle needs commits the gateway's mirror lacks | The caller fetches `main` and bundles again (`git bundle create head.bundle origin/main..<branch>`), or bundles the whole branch |

A mirror holds a copy of GitHub and the commits of uploads not yet pushed. With the daemon
stopped, removing a repository's folder under `data/mirrors` makes the next start fetch it whole
again, which the first start did for both. Uploads waiting to be pushed go with it, though
their ids still read as valid for the hour: their callers upload again.

The journal in `data` records every write with the caller that asked for it. Read it through
the gateway (`gateway-audit` on the `owner` and `foreman` routes), not from the files.

## Remove it

```bash
sudo launchctl bootout system/dev.lushly.factory-gateway
sudo rm /Library/LaunchDaemons/dev.lushly.factory-gateway.plist
sudo rm -rf /Library/FactoryGateway          # the journal, state and tokens go with it
sudo dscl . -delete /Users/_factorygw
sudo dscl . -delete /Groups/_factorygw
rm -rf ~/.config/factory-gateway             # the owner's token and any issued beside it
```

Then delete the App's key under Credentials, then Key pairs, and uninstall the App if nothing
else uses it. Tokens copied to other machines open nothing once the gateway is gone; delete
them there too.

# Loam OS session image: operator runbook

The Loam OS host runs each validation in a machine started from a session image: a container
image with the toolchains `main` pins, built from
[`endpoints/loam-os/image/Containerfile`](../../endpoints/loam-os/image/Containerfile) and named
in the host's configuration by digest, never by tag. This runbook is the operator's: building the
image, pinning it, checking it before use, moving to a new one, and installing the host as a
service. The design is the proposal's [Images](../features/active/loam-os/loam-os.proposal.md#images)
and [M0](../features/active/loam-os/loam-os.proposal.md#m0-stand-it-up); progress and
measurements are in the [STATUS](../features/active/loam-os/STATUS.md).

In M0 and M1 images are built by hand and pinned by digest (the owner's decision of 2026-11-25).
Nothing builds or publishes one automatically.

## What you need

- A container runtime with BuildKit: Docker Desktop or Docker Engine with `docker buildx`. On
  macOS and Windows it runs the machines in a Linux virtual machine.
- About 10 GB free for the build and its cache. The image is about 5.2 GB unpacked (1.4 GB of
  compressed layers).
- About 70 GB more for each check below: one `pnpm verify --all` leaves its dependencies, build
  output and caches in the container (53 to 67 GB on 2026-11-26).
- A checkout of `main`, fresh (`git fetch origin main`, then build from `origin/main`'s tree).

## Build it

Build from `main`, from the image's folder as the context; the container file copies nothing
from the repository.

```sh
git switch --detach origin/main
docker buildx build \
  --platform linux/amd64 \
  --load \
  --tag loam-os-session:$(git rev-parse --short HEAD) \
  --file endpoints/loam-os/image/Containerfile \
  endpoints/loam-os/image
```

Use `--platform linux/arm64` on an Apple silicon lane host. To build both and keep them as one
multi-architecture image, push to a registry instead of loading:
`--platform linux/amd64,linux/arm64 --push --tag <registry>/loam-os-session:<sha>`. An arm64 build
on an x86-64 machine runs under emulation and is much slower; build on the host that will run it.

The build fails, rather than drifting, when a pinned download no longer matches its sum. A pin
in the container file that no longer matches the repository (a `rust-toolchain.toml`,
`.nvmrc`, `packageManager` or Playwright change on `main`) does not fail the build; it fails the
check below, which is why the check is required.

## Pin it by digest

The host's configuration names the image by digest. Read it after the build:

```sh
docker images --digests loam-os-session
# or, for one tag:
docker image inspect loam-os-session:<sha> --format '{{.Id}}'
```

Each prints the digest with its prefix, `sha256:<hex>`, which is what goes after the `@` in
`loam-os-session@sha256:<hex>`. With Docker's containerd image store (Docker Desktop's
default), `--load` keeps the image index, and the `DIGEST` column and `.Id` are that index's
digest, which resolves locally. Docker Engine on Linux without the containerd store shows no
`DIGEST` after `--load`, and its `.Id` is the configuration's digest, which does not resolve as
`name@sha256:<hex>`: there, turn the containerd store on or push to a registry. With a registry,
read the pushed digest with `docker buildx imagetools inspect <registry>/loam-os-session:<sha>`
(`Digest:`), and refer to the image as `<registry>/loam-os-session@sha256:<hex>`.

Record the digest, the `main` commit it was built from, the build time and the image size in
the [STATUS](../features/active/loam-os/STATUS.md) before any lane uses it.

## Check it before use

An image is used only after `pnpm verify --all` on `main` passes in a container started from it.
Plain `pnpm verify` is not enough: on `main` nothing differs from `main`, so it selects no suite.

Run it from a clean clone inside the container, never with the host's checkout or
`node_modules` mounted (they hold the host system's native binaries):

```sh
sha=$(git rev-parse origin/main)
docker run --name loam-os-check --init --shm-size=2g loam-os-session@sha256:<hex> bash -c "
  git clone https://github.com/lushly-dev/afd.git ~/afd && cd ~/afd &&
  git checkout --detach $sha &&
  pnpm install --frozen-lockfile &&
  pnpm verify --all --keep-going"
```

- `--shm-size=2g`: Chromium needs more shared memory than Docker's 64 MB default.
- `--keep-going` runs every suite and prints a summary with each step's time, so one failure
  does not hide the rest.
- The container needs the network for the clone and the install, and for the first build of
  Rust, Python and C++ dependencies. What a second run without it needs (`UV_OFFLINE=1`) is in
  the STATUS's M0 measurements.

The check passes when the summary has no `FAIL`. Record its duration and per-suite result. A
suite that fails only in this image and not on CI's Linux runners is the image's to fix; a suite
that fails because of a real bug on Linux is filed as an issue under the Loam OS epic
([#2595](https://github.com/lushly-dev/afd/issues/2595)), and the image waits for its fix.

Remove the container afterwards: `docker rm loam-os-check`.

## Move to a new image

A branch cannot bring its own toolchain: the image carries what `main` pins. When `main` is to
move a pin (a new Node major, a Rust channel, a Playwright version):

1. Change the container file so the image carries the old and the new version side by side:
   - Rust: a second `rustup toolchain install <new> --profile minimal -c clippy -c rustfmt -t
     wasm32-wasip2`; each `rust-toolchain.toml` then selects its own.
   - Playwright: install the new version's browsers into the same default cache,
     `~/.cache/ms-playwright`, with `PLAYWRIGHT_SKIP_BROWSER_GC=1` so the install does not
     delete the old version's. Never a custom `PLAYWRIGHT_BROWSERS_PATH`: the hosted-fixture
     runner does not inherit it.
   - Node: a second Node in its own prefix (`/opt/node-<major>`). Nothing in the image reads
     `.nvmrc`, so the step that validates a branch on the new major puts that prefix's `bin`
     first on `PATH`; until the host can choose by the branch's `.nvmrc`, the image's default
     stays `main`'s.
2. Build it, pin its digest, and run the check above on `main` as it is.
3. Point the host's configuration at the new digest. The old image stays pinned until no machine
   uses it.
4. Merge the pin change on `main`. The branch that changes it is validated in the image that
   carries both versions.
5. Once `main` no longer names the old version, drop it from the container file, build, check
   and pin again.

The lane checks a branch's pins against the versions `host-status` lists (`images[].toolchain`)
and ejects a branch the image cannot serve, as it does for `node-missing` today (M1).

## Install the host as a service

The host is the `loam-os` binary ([`endpoints/loam-os`](../../endpoints/loam-os/README.md)):
Umbel's command line with the `loamos` plugin compiled in. It serves MCP over HTTP on loopback, on
port 7420 here so it does not take Umbel's default 7410 from an Umbel server on the same computer.
Callers present the bearer token Umbel keeps in the workspace's state (`state/keys/http.token`,
mode 0600). In M0 its command line opens the workspace itself, as Umbel's does; forwarding each
call to the running host is M1's ([The host](../features/active/loam-os/loam-os.proposal.md#the-host)).

Run it as an ordinary account that can reach the container runtime, never as root, and never with
the runtime's socket mounted into a machine. That account is only as unprivileged as the runtime
lets it be: on Linux, membership of the `docker` group for rootful Docker is equivalent to root, so
use rootless Podman or rootless Docker where the boundary matters. On macOS, Docker Desktop's
runtime runs in its own virtual machine.

The service files below have not been run yet, neither on the lane host nor on Linux. Only
`serve --http --bind 127.0.0.1:7420` has been run (on Windows, 2026-11-26). Record the first
install's result in the [Loam OS status](../features/active/loam-os/STATUS.md).

### Build and configure

```sh
cd endpoints/loam-os
cargo install --path . --locked --root ~/.local   # installs ~/.local/bin/loam-os
mkdir -p ~/loam-os && cp examples/umbel.toml ~/loam-os/umbel.toml
```

In `~/loam-os/umbel.toml`, set the image's `reference` to the digest pinned above, each repository's
`source`, the sizes, the policies and `capacity`. Under `[plugins.loamos.config.runtime]`, set
`kind = "podman"` on a Podman host (the default is `docker`), and set `command` to the runtime's
absolute path so the service does not depend on its `PATH` (Docker Desktop's per-user install puts
it in `~/.docker/bin`). Then check it:

```sh
loam-os --workspace ~/loam-os call workspace-doctor   # plugins.config_checks must pass
loam-os --workspace ~/loam-os call host-status        # runtime.reachable: true, the image by digest
```

### macOS (the lane host): a launchd agent

`~/Library/LaunchAgents/dev.lushly.loam-os.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.lushly.loam-os</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/OPERATOR/.local/bin/loam-os</string>
    <string>--workspace</string><string>/Users/OPERATOR/loam-os</string>
    <string>serve</string><string>--http</string>
    <string>--bind</string><string>127.0.0.1:7420</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>/Users/OPERATOR/loam-os/host.log</string>
</dict>
</plist>
```

Replace `OPERATOR`, and make sure `PATH` reaches the runtime's `docker` or `podman`. Then
`launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.lushly.loam-os.plist`. Docker Desktop
must start at login before the agent's first call. Until it does, `host-status` answers
`reachable: false`, and the doctor warns.

### Linux: a systemd user unit

`~/.config/systemd/user/loam-os.service`:

```ini
[Unit]
Description=Loam OS host
# The runtime may start after the host: host-status answers `reachable: false` until it does.
After=podman.socket

[Service]
ExecStart=%h/.local/bin/loam-os --workspace %h/loam-os serve --http --bind 127.0.0.1:7420
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

Run `systemctl --user daemon-reload && systemctl --user enable --now loam-os`, and
`loginctl enable-linger <account>` so the unit runs without a session.

### Upgrade

Build and install the new binary as above, restart the service (`launchctl kickstart -k
gui/$(id -u)/dev.lushly.loam-os`, or `systemctl --user restart loam-os`), then run
`workspace-doctor` and `host-status` again. M0 keeps no records of machines, so a restart loses
nothing. From M1 a restart rebuilds from the host's records and the runtime
([The record](../features/active/loam-os/loam-os.proposal.md#the-record)).

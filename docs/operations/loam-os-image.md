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

- A container runtime with BuildKit: Docker Desktop, Colima or Docker Engine with
  `docker buildx`. On macOS and Windows it runs the machines in a Linux virtual machine. The lane
  host's is Colima ([Container runtime on random](#container-runtime-on-random)).
- About 10 GB free for the build and its cache. The image is about 5.2 GB unpacked (1.4 GB of
  compressed layers).
- About 70 GB more for each check below: one `pnpm verify --all` leaves its dependencies, build
  output and caches in the container (53 to 67 GB on 2026-11-26).
- A checkout of `main`, fresh (`git fetch origin main`, then build from `origin/main`'s tree).

### Container runtime on random

The lane host (`random`, a Mac mini M4 with 10 cores and 24 GB) runs Colima, installed on
2026-11-26:

- **What:** `brew install colima docker docker-buildx` (Colima 0.10.3 on Lima 2.3.0, the Docker
  29.10.1 client, buildx 0.39.1). The engine in the virtual machine is Docker 29.5.2 (linux/arm64)
  with the containerd image store, so `--load` keeps the image index and its digest. `buildx` is
  registered with `"cliPluginsExtraDirs": ["/opt/homebrew/lib/docker/cli-plugins"]` in
  `~/.docker/config.json`.
- **Where its disk is:** `export COLIMA_HOME=/Volumes/Dev/colima` (in `~/.zprofile`; a shell that
  does not read it, such as an agent's tool shell, needs the same `export`), on the
  external Dev volume, never the internal disk, which has about 35 GB free. The virtual machine's
  20 GB boot disk is `$COLIMA_HOME/_lima/colima/disk` and its 200 GB data disk, which holds
  `/var/lib/docker` and every image, container and volume, is
  `$COLIMA_HOME/_lima/_disks/colima/datadisk`. Both are sparse: they take on the volume only what
  has been written. Only Colima's download cache of the base system image (about 320 MB) is on
  the internal disk, in `~/Library/Caches/colima`.
- **Limits:** 6 processors, 16 GB of memory and 200 GB of disk, which leaves the lanes four
  processors and 8 GB. It was started once with
  `colima start --vm-type vz --vz-rosetta --arch aarch64 --cpu 6 --memory 16 --disk 200 --mount-type virtiofs`,
  and Colima keeps those settings in `$COLIMA_HOME/default/colima.yaml`, so a plain
  `colima start` uses them again. Change them with `colima stop`, then
  `colima start --cpu <n> --memory <gb>` (the disk can grow but not shrink).
- **Start and stop:** in a shell with `COLIMA_HOME` set, `colima start`, `colima stop` and
  `colima status`. `colima start` on a running machine prints `already running, ignoring` and
  starts nothing. `docker context ls` shows the `colima` context as current.
- **At login:** the LaunchAgent `~/Library/LaunchAgents/dev.lushly.colima.plist` runs
  `/opt/homebrew/bin/colima start` with `COLIMA_HOME=/Volumes/Dev/colima` and a `PATH` with
  `/opt/homebrew/bin`, at load (`RunAtLoad`) and again whenever a volume mounts (`StartOnMount`),
  so a Dev volume that mounts after login still starts it. It is not `brew services`, which would
  not pass `COLIMA_HOME`. If the volume is not mounted, `colima start` should fail, since it cannot
  create `/Volumes/Dev` in the root-owned `/Volumes`, so no machine lands on the internal disk;
  that case has not been tried. Its log is
  `~/Library/Logs/dev.lushly.colima.log`; load it with
  `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.lushly.colima.plist`.
- **macOS privacy:** a process launchd starts needs macOS's consent to read the external volume.
  On 2026-11-26 a shell under launchd got `Operation not permitted` listing `/Volumes/Dev`, and the
  agent's first `colima start` waited with no output for about nine minutes, most likely for that
  consent, given at the screen (System Settings → Privacy & Security → Files & Folders lists what
  has it), and then found the machine already running. Every run after that worked, and with the
  virtual machine stopped, `launchctl kickstart gui/$(id -u)/dev.lushly.colima` started it within
  25 s. macOS ties the
  consent to the binary, so after `brew upgrade colima` it may ask again: check the agent's log,
  and answer the prompt or allow `colima` there.

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
- Pass anything else on standard input (`docker run -i … bash -s < script.sh`), not with a bind
  mount: Colima shares only the home folder with its virtual machine, so a path on another
  volume, such as `/Volumes/Dev`, mounts as an empty folder.

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
runtime, and Colima's, runs in its own virtual machine.

The macOS agent below ran on the lane host on 2026-11-26: launchd kept it up, it answered
`host-status` over MCP on `127.0.0.1:7420` with the runtime reachable, refused a call without the
token with HTTP 401, and `loam-os call` still worked beside it. The systemd unit has not been run
yet. Record each first install's result in the [Loam OS status](../features/active/loam-os/STATUS.md).

### Build and configure

Install from the unit's own folder, so rustup reads its `rust-toolchain.toml`. From the
repository's root, `cargo install --path endpoints/loam-os` takes the default toolchain, which
may be older than the 1.97 the crates require, and fails.

```sh
cd endpoints/loam-os
cargo install --path . --locked --root ~/.local   # installs ~/.local/bin/loam-os
mkdir -p ~/loam-os && cp examples/umbel.toml ~/loam-os/umbel.toml
```

In `~/loam-os/umbel.toml`, set the image's `reference` to the digest pinned above, each repository's
`source`, the sizes, the policies and `capacity`. Under `[plugins.loamos.config.runtime]`, set
`kind = "podman"` on a Podman host (the default is `docker`), and set `command` to the runtime's
absolute path so the service does not depend on its `PATH` (Docker Desktop's per-user install puts
it in `~/.docker/bin`; Homebrew's, which Colima uses, in `/opt/homebrew/bin`). Keep the workspace
on the internal disk, as `~/loam-os` is: a job launchd starts cannot read an external volume until
macOS has its consent for that binary (see [Container runtime on random](#container-runtime-on-random)). The Docker
client reaches Colima's socket on the Dev volume from launchd all the same. Then check it:

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
`launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.lushly.loam-os.plist`. The runtime
(Docker Desktop, or Colima's own agent on the lane host) must start at login before the agent's
first call. Until it does, `host-status` answers `reachable: false`, and the doctor warns.

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

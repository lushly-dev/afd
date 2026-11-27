# Loam OS host

The host process of [Loam OS](../../docs/features/active/loam-os/loam-os.proposal.md). It makes a
Linux machine (a container) for one piece of work, runs that work inside it with no credential,
keeps the record outside it, and destroys it afterwards. Progress lives in the feature's
[STATUS.md](../../docs/features/active/loam-os/STATUS.md).

It is a binary of its own on Umbel's host library (`endpoints/umbel`). One compiled plugin,
`loamos`, owns the `host`, `machine`, `run` and `checkpoint` domains. The MCP server announces
itself as `loam-os` (Umbel D206), and the host is exempt from Umbel's principle 11 (Umbel D207).

## What M0 has

- `host-status`: the host, its container runtime (Docker or Podman, through their command
  line), its journal, and everything the operator configured: repositories, images by digest,
  sizes, network policies, capacity and retention. It refuses nothing: an unreachable runtime is
  `reachable: false`. The journal is Umbel's default (`best-effort`) until M1 wires the required
  mode (Umbel D208).
- Configuration checks in `workspace-doctor` (`plugins.config_checks`). These catch an image not
  pinned by digest, a repository naming an image or size that does not exist, disk too small for
  the most machines of the largest size, and a runtime that does not answer (a warning).
- A fake runtime (`runtime::FakeRuntime`) that the tests drive.

`machine-*`, `run-*` and `checkpoint-*` arrive in M1 and M2.

## Run it

```sh
cd endpoints/loam-os
cargo build --release
mkdir -p ~/loam-os && cp examples/umbel.toml ~/loam-os/   # then edit the image digest and paths
./target/release/loam-os --workspace ~/loam-os call workspace-doctor
./target/release/loam-os --workspace ~/loam-os call host-status
./target/release/loam-os --workspace ~/loam-os serve --http --bind 127.0.0.1:7420   # MCP on loopback
```

The runtime is driven through `docker` or `podman` with fixed arguments (`version`, `ps`,
`volume ls`), never with a caller's input. Only Docker has been run so far: 29.9.3 on Hero, and
29.5.2 in Colima on the lane host, `random`, where the launchd service from the image runbook ran
too (both 2026-11-26). The Podman path is the same command line and has not been tried on a Podman
host.

The command line is Umbel's (`loam-os --help`). [`examples/umbel.toml`](examples/umbel.toml) is
a complete workspace, and `schemas/config.schema.json` says what each key of
`[plugins.loamos.config]` means. Building the session image and pinning it is in
[the image runbook](../../docs/operations/loam-os-image.md).

## Check it

```sh
cargo fmt --all --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --no-fail-fast --locked
```

This unit is its own Cargo workspace with a committed `Cargo.lock`. It builds Umbel's crates by
path, on the toolchain Umbel pins. CI runs it in `umbel.yml`'s `loam-os` job whenever it, Umbel
or the afd crate changes.

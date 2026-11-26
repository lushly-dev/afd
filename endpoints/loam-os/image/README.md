# Loam OS session image

The container file for the image a Loam OS machine runs: the toolchains `main` pins, so that
`pnpm verify` can run in a Linux machine with no credentials in reach. It is M0's image
([#2618](https://github.com/lushly-dev/afd/issues/2618)); the
[proposal's Images section](../../../docs/features/active/loam-os/loam-os.proposal.md#images) says
how the host uses it.

The operator builds, pins and moves to a new image with the
[runbook](../../../docs/operations/loam-os-image.md). Measurements are in the
[Loam OS STATUS](../../../docs/features/active/loam-os/STATUS.md#m0-measurements).

## What it carries

Each version comes from the repository or its CI workflows, and the [`Containerfile`](Containerfile)
says where.

| Tool | Version | Source |
| --- | --- | --- |
| Base | Ubuntu 26.04 LTS, by index digest | The owner's decision of 2026-11-25; the release CI's `ubuntu-latest` runs |
| Node | 26.13.1 | `.nvmrc` (`26`), the newest 26.x when the image was written |
| pnpm | 12.22.0 | `packageManager` in `package.json` |
| Rust | 1.100.0, `clippy`, `rustfmt`, `wasm32-wasip2` | Every `rust-toolchain.toml`; the target from Umbel's |
| Python | 3.12.16, uv's managed build, first on `PATH` | CI's single-version Python jobs (3.12); Ubuntu's own `python3` is 3.14 |
| uv | 0.13.10, by index digest | CI does not pin uv; the newest release when the image was written |
| Git | 2.53 | Ubuntu 26.04's archive; prints `%aI` in UTC as `Z`, as CI's Git does |
| C and C++ | GCC 15, CMake 4.2, OpenSSL 3.5 headers | `packages/cpp` needs CMake 3.25 and C++20 |
| Playwright | 1.64.1 Chromium and Firefox in `~/.cache/ms-playwright`, with their system libraries | `pnpm-lock.yaml`; Firefox for loam-web's `test:firefox` |
| WebKitGTK | 2.52.6 (4.1 API), with WebKitWebDriver, xvfb and dbus-x11 | `loam-desktop.yml`'s Linux packages |

It does not carry NASM (only `aws-lc-sys`'s Windows build needs it), Rust MSRV 1.97 or nightly,
`tauri-driver` or Playwright's WebKit, which are remote-only legs of `pnpm verify`.

## What it does not hold

No AFD client, no credentials and no repository checkout. It runs as `agent` (uid 1000) and its
`CMD` is a shell. uv is set to use the image's Python 3.12 and never download one (`UV_PYTHON=3.12`,
`UV_PYTHON_PREFERENCE=only-managed`, `UV_PYTHON_DOWNLOADS=never`).

`SPECIMEN_CHROMIUM_SANDBOX=0` is set: the runtime's default seccomp profile refuses the user
namespace Chromium's sandbox needs, which the Specimen host cannot detect, so Specimen's Chromium
runs without its own sandbox inside the machine, as Playwright's launches already do.

## Paths the image owns

A machine gets its checkout, build output and package caches from volumes the host makes. A
volume mounted over one of the image's own paths hides what it holds:

- `~/.cargo/bin` and `~/.rustup` (Rust). Cargo's caches, `~/.cargo/registry` and `~/.cargo/git`,
  may be a volume.
- `~/.local/bin` and `~/.local/share/uv/python` (Python). uv's cache, `~/.cache/uv`, may be a
  volume.
- `~/.cache/ms-playwright` (the browsers).
- `/usr/local` (Node and pnpm). pnpm's store, under `~/.local/share/pnpm`, may be a volume.

## How the downloads are checked

The base and uv images are pinned by index digest, and Node and rustup by per-architecture
SHA-256 sums. Debian packages come from Ubuntu's signed archive. pnpm and Playwright come from npm
at exact versions, Rust's components from rustup's channel for 1.100.0, Python from uv's managed
builds at 3.12.16, and the browsers from Playwright's own download, each over HTTPS without a
sum pinned here. The built image is then pinned by digest and checked before use, so what the
lane runs does not change after that check.

## Platforms

It builds for `linux/amd64` and `linux/arm64`; the Node and rustup downloads are chosen by
Docker's `TARGETARCH`, and every other tool picks its own architecture.

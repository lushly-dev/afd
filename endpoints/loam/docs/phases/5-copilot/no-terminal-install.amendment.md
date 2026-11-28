# Phase 5 amendment: no-terminal plugin install, approver pairing, and model key setup (D148 / Q2)

Epic: [#1544](https://github.com/lushly-dev/afd/issues/1544).

| Field | Value |
| --- | --- |
| Amends | [Phase 5 specification](spec.md) (sections 2, 4.2, 7.4, 14, 15, 18, 19, Q2, Q6); deferred amendments to [Phase 6 specification](../6-hosts/spec.md) (10.2, 10.3, 10.4, 10.6, 13, 17, P6-D4, D106, D108) and [Phase 1 specification](../1-app-contract/spec.md) (section 2) applied when step 9 lands |
| Owner | Owner approved [Q1 to Q4](#15-questions-for-the-owner-answered-2026-11-22) as recommended on 2026-11-22 (recorded as D165–D168 in [decisions.md](../../decisions.md)); revised after two-model independent trust-boundary review |
| Read first | [STATUS.md](../../STATUS.md); [Phase 5 specification](spec.md) (4.1, 4.2, 7.2, 7.4, 14, 15, Q2, D143, D146, D148, D153); [Phase 6 specification](../6-hosts/spec.md) (10.1–10.8, 13, 17, D106, D108); [Mail plugin specification](../../../plugins/mail/docs/plugin.spec.md) (sections 4, 12.4, 14, M30, M40); [Decision log](../../decisions.md) (D54, D56, D63, D95, D106, D108, D137–D148, D153, D160, D165–D168) |
| Elevation | Exact shapes, schemas, IPC surface, engine contract, OS service registrations, error codes, threat model, and tests. An implementing agent needs no further design decision; where it finds one, it stops and amends this document by pull request |

## Status

- **State: Owner-decided (D165–D168), revised after two-model trust-boundary review** (2026-11-22 against `origin/main` at `91d30fcec`). Satisfies the owner's condition on [Phase 5 Q2](spec.md#q2-engine-who-keeps-a-plugins-engine-running) (D148): a person never has to open a terminal or run a command to install a plugin engine with login auto-start, provision its approver token, or configure a copilot model key, while preserving every desktop security invariant (hash-pinned artifact, explicit human consent in the trusted host, no arbitrary command lines from webviews or agents, model keys kept out of the shell webview).
- **Last verified:** 2026-11-22 against `origin/main` at `91d30fcec`. Verified in the repository:
  - `endpoints/loam/packages/desktop/src-tauri/src/lib.rs` (6 IPC commands, `from_shell`, `MAIN`, Rust native menu, `SiteState`, `Mounts`, `Models`, `InboundState`, `on_page_load`, `may_navigate`);
  - `endpoints/loam/packages/desktop/src-tauri/capabilities/main.json` (`local: true`, `webviews: ["main"]`, exact 6 command permissions, no `core:*` or plugin permissions);
  - `endpoints/loam/packages/desktop/src-tauri/build.rs` and `tauri.conf.json` (`withGlobalTauri: false`, `capabilities: ["main"]`);
  - `endpoints/loam/packages/desktop/src-tauri/Cargo.toml` (`tauri = "=2.12.5"` with `features = ["tracing"]`, `windows-sys = "=0.61.2"` with `Win32_Security_Credentials`, `Win32_Security_Authorization`, `Win32_Storage_FileSystem`, `Win32_System_Threading`);
  - `endpoints/loam/packages/desktop/src-tauri/src/models.rs` (`read`, `resolve_key`, `keychain_read` using `CredReadW` / `/usr/bin/security` / `secret-tool`, `key_shaped`, `endpoint_allowed`, `Models`);
  - `endpoints/loam/packages/desktop/src-tauri/src/mounts.rs` (`HttpAccess`, `StdioAccess`, `read_deployed`, `read_owner_only`, `handle_owner_only` via `GetSecurityInfo`, Windows minimal child env);
  - `endpoints/loam/packages/desktop/src-tauri/src/connection.rs` (`create_owner_only` using mode `0600` + `O_NOFOLLOW` on POSIX and `CreateFileW` + `SE_DACL_PROTECTED` on Windows);
  - `endpoints/loam/packages/desktop/src-tauri/src/site.rs` (`shell_origin`, `sandbox_origin`, `Site::choose`, `serve`, `INERT_POLICY`, `meta_policy`);
  - `endpoints/loam/packages/desktop/src-tauri/tests/acl.rs` (`EXEMPT = &["plugin:__TAURI_CHANNEL__|fetch"]`) and `tests/origin.rs` (mock-runtime IPC origin gate tests);
  - `endpoints/loam/packages/desktop/scripts/build-site.mjs` (bundled empty desktop shell);
  - `endpoints/loam/packages/cli/src/copilot-key.ts` (`KEY_PATTERN`, `checkRequest`, `systemKeychain`, `copilotKeySet`);
  - `endpoints/loam/packages/cli/src/deployment.ts` (`projectionOf`, `generationOf`, `bootRecordOf`, `withDesktopConnectSrc`, `withFrameSrc`, `writeDeployment`);
  - `endpoints/loam/packages/manifest/schemas/deployment.v4.json`, `projection.v4.json`, `spec/plugin-manifest.core.v1.json`, `endpoints/loam/packages/manifest/src/approvals-rules.ts`;
  - `endpoints/loam/plugins/mail/docs/plugin.spec.md` (sections 4, 12.4, 14, M30, M40), `engine.spec.md` (3.2 `serve --port`, `server.json`, `cli.token`), and `engine/src/tokens.rs` (duplicate token-name check).
- **Owner decisions:** [Q1 to Q4](#15-questions-for-the-owner-answered-2026-11-22) approved as recommended on 2026-11-22 (D165–D168).
- **Not modified here:** Phase 5 steps 1–8 code, Mail step F's open Q1–Q5, Phase 6 M1, and D160's SQLite store migration (`#1928`).

---

## 1. Scope, Principles, and What This Amends

Phase 5's approved specification left three desktop setup flows at the terminal as development paths:
1. **Installing a plugin and its engine** (section 7.4),
2. **Creating an engine's approver token** (`mail-token-create` at the engine's terminal, section 7.2 / 7.4), and
3. **Setting a copilot model key** (`loam copilot key set <provider>`, section 4.2).

The owner's condition on Q2 (D148, 2026-11-17) and decisions D165–D168 (2026-11-22) establish that **a person never has to run a terminal command** for any of these three, while keeping CLI paths for authoring, testing, and scripted deployments.

### Design principles

1. **One Rust host pipeline for every plugin.** Mail is the first engine-backed plugin, not a special case. Future engine-backed plugins (such as Trillium) and pure-app plugins (native or view, with no engine) use the exact same manifest schema, hash-pinned consent flow, pairing contract, login-service registration, and desktop deployment materialization, with zero plugin-specific logic in Loam's core (D19, D148).
2. **Runs as the logged-in user, with zero Node.js dependency.** A real person installing Loam Desktop (`.dmg`, `.msi`, `.deb`, `.AppImage`) does not have Node.js or `@lushly-dev/loam-cli` installed, and OS installers either have no post-install script (`.dmg`, `.AppImage`) or run elevated / as `root` (`.msi`, `.deb`) where user keychains and user login services (`launchd` `gui/<uid>`, `HKCU`, `systemd --user`) are unreachable. Therefore `loam-desktop`'s Rust host owns the entire no-terminal lifecycle as the logged-in user. Optional first-party bundles shipped inside an installer live in a read-only `<resource dir>/bundled-plugins/` folder and go through the exact same consent and install pipeline on first launch or from the Plugins screen.
3. **No regression on any trust boundary.**
   - **D56 / D63:** No kernel command, app, view, or agent can install a plugin, write `mounts.json` or `models.json`, set a model key, or register a service.
   - **D106 / D165:** `main`'s capability file (`capabilities/main.json`) gains only `allow-setup-open` (7 commands total) and zero `core:*`, `shell`, `fs`, `http`, `opener`, or updater permission; `main` never passes a file path, URL, command line, or secret to Rust.
   - **D143 / T9:** Model keys never enter `main`'s webview, the copilot runtime frame, the workspace store, the journal, `models.json`, `deployment.json`, or any log.
   - **D148 / D166:** Plugin manifests name hash-pinned artifacts only — never command lines, arguments, environment variables, transport/endpoint URLs, ports, or tokens. Binary execution happens only after explicit human consent in the trusted host bound to the full staged bundle digest.
   - **D95:** Shared `provider`-mode workspaces stay unaffected; desktop is `local` only (D106).
   - **D160 compatibility:** Desktop host state lives in `<app data>/desktop-state.json` beside `mounts.json` and `models.json`, completely separate from the kernel's workspace store (IndexedDB today, SQLite in `#1928`).

### Deferred cross-document amendments (applied when step 9 lands)

| Document | Sections | Change |
| --- | --- | --- |
| Phase 5 `spec.md` | 2, 4.2, 7.4, 14, 15, 18, 19, Q2, Q6 | Incorporates this amendment's units, no-terminal key/plugin/pairing flows, `loam-desktop plugin` dev CLI, error codes, T21–T28, jobs J-NT1 to J-NT4, and tests P5-S9-1 to P5-S9-7 |
| Phase 6 `spec.md` | 10.2, 10.3, 10.4, 10.6, 13, 17, P6-D4, D106, D108 | Adds `loam-host` protocol and `capabilities/host-setup.json` for `host-setup` window; `setup_open` on `main` (7 commands total); Rust-managed deployment materialization in 10.3; `bearer_keychain` and `proof_key` in `mounts.json` (10.4); `Plugins…` and `Copilot Models…` native menu items (10.6); cross-window origin/ACL pins in P6-D4 |
| Phase 1 `spec.md` | Section 2 | Registers `loam-plugin.toml` / `plugin-manifest.json` (`loam-plugin.v1.json`) beside `app-manifest.v1/v2.json` |
| `decisions.md` | D56, D63, D106, D108, D143, D148, D165–D168 | D165–D168 recorded on 2026-11-22; D56/D63/D106/D108 amendments applied when step 9 lands |
| Mail `plugin.spec.md` | Section 14 | Links section 5's `pair` / `unpair` / `/health` proof contract for Mail's step 9 packaging follow-up |

---

## 2. Jobs (Q6)

Phase 5's Q6 noted that setting a model key and installing a plugin had no jobs because they were terminal steps, and directed this amendment to add them. Because installing a plugin, pairing a bearer token, and setting a model key are **trusted host operations** (never kernel commands — D56, D63, D143, D148), no kernel scenario can or may execute them; indeed, P5-S9-1 asserts that neither `main`, the kernel, nor any agent can invoke setup mutations. Each job maps directly to desktop acceptance tests in [section 13](#13-exit-tests-and-implementation-plan).

| # | Job | When … I want … so that … | Proven by |
| --- | --- | --- | --- |
| J-NT1 | Install a plugin and its engine without a terminal | When I receive a plugin bundle (engine-backed such as Mail or Trillium, or pure-app), I want to inspect its apps, engine hash, background login service, and approval scope inside Loam's trusted setup window and install it with one confirmation, so that it runs at sign-in and appears in Loam without me ever opening a terminal | P5-S9-2, P5-S9-4, P5-S9-7 |
| J-NT2 | Provision and revoke an approver token without a terminal | When I install or uninstall a plugin whose engine holds person-only commands, I want Loam to pair its approver token automatically after my consent, keep it in my OS keychain, let me rotate it in one click, and revoke it cleanly (retrying if offline) on uninstall, so that I never copy tokens in a terminal and no unused token remains valid | P5-S9-3, P5-S9-4 |
| J-NT3 | Configure a copilot model and key without a terminal | When I want to use the copilot with Anthropic, OpenAI, or a local OpenAI-compatible model, I want to add the provider and enter its API key in Loam's trusted setup window and verify it immediately, so that the copilot works without a terminal and the key never enters the shell webview or any app | P5-S9-5 |
| J-NT4 | Upgrade or uninstall a plugin without losing my data | When a newer plugin bundle arrives (engine or app update) or I remove a plugin, I want to review the old-to-new hashes before upgrading or remove the plugin and its startup service cleanly while keeping my mail or plugin data intact, so that updates are explicit and uninstalls are safe | P5-S9-2, P5-S9-4, P5-S9-7 |

---

## 3. The Trusted Setup Boundary (`host-setup` Window and `loam-host` Protocol)

### 3.1 Architecture (D165)

Trusted setup operations live in a **dedicated, isolated Tauri window** created and owned exclusively by `loam-desktop`'s Rust host:

| Property | `main` (existing shell window) | `host-setup` (trusted setup window) |
| --- | --- | --- |
| Tauri window / webview label | `"main"` (`MAIN`) | `"host-setup"` (`HOST_SETUP`) |
| Custom URI scheme & origin | `loam://localhost` (`http://loam.localhost` on Windows) | `loam-host://localhost` (`http://loam-host.localhost` on Windows) |
| Asset source | **`managed` mode (D168 amended):** signed shell files (`index.html`, `404.html`, `assets/*`, `sandbox/*`) served from `EmbeddedAssets` ONLY; reads only `deployment.json` and plugin `apps/*` from `<app data>/site/`. **`cli` dev mode:** full `<app data>/site/` (or bundled empty shell) | **Compiled-in static first-party assets ONLY** via `include_bytes!` outside `frontendDist` (`../dist`); NEVER reads `<app data>/site/` or any plugin/user file, and is never extracted into `<app data>/site/` |
| Third-party code / apps / kernel / copilot | Runs shell kernel, native apps, sandboxed views, copilot frame | **None.** Pure minimal first-party HTML + CSS (Loam Refined tokens & local `woff2` fonts) + JS |
| Webview storage / data directory | `<app data>/webview/` (persistent) | **macOS WKWebView:** `.incognito(true)` (`WKWebsiteDataStore.nonPersistent()`, since `data_directory` is unavailable on WKWebView). **Windows / Linux:** `.incognito(true)` plus an ephemeral per-open temporary directory `<app data>/.setup-webview-<nonce>/`, deleted best-effort on close and swept on startup / `RunEvent::Exit` (covering Windows WebView2 file-handle release lag) |
| Content-Security-Policy | Fixed desktop CSP ceiling enforced in Rust (`site.rs::desktop_shell_policy`: canonical desktop directives toggling only `frame-src` between `'none'` and `sandbox_origin()`, plus `frame-ancestors 'none'`; widened `<meta>` refused with `404`) | **HTTP header:** `default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`<br>**`<meta>` tag** (meta-valid subset matching `site.rs::meta_policy`): same directives minus `form-action` and `frame-ancestors` |
| Navigation (`on_navigation`) | `may_navigate` (`shell_origin` + non-Windows sandbox) | Strictly `host_setup_origin()` alone; every other URL refused |
| Capability file | `capabilities/main.json` (`webviews: ["main"]`, 7 commands: existing 6 + `allow-setup-open`) | `capabilities/host-setup.json` (`webviews: ["host-setup"]`, `local: true`, NO `core:*` or plugin permissions); `tauri.conf.json` lists `capabilities: ["main", "host-setup"]`, and `lib.rs` unit tests pin both files |
| Origin + label gate in Rust | `from_shell(&webview, &request)` (`label == "main"` AND `Origin == shell_origin()`) | `from_host_setup(&webview, &request)` (`label == "host-setup"` AND `Origin == host_setup_origin()`) |
| Window lifecycle & cross-window isolation | Cannot call any `setup_*` command except `setup_open`; holds no `window` reference to `host-setup`; closing `main` also closes `host-setup` so no orphaned setup window keeps the process alive | Cannot call `mount_*`, `model_*`, `inbound_reply`, or `setup_open`; holds no `window` reference to `main`; at most one `host-setup` window (re-opening focuses it and switches section only if no `PendingInstall` consent flow is active); closing `host-setup` drops any uncommitted `PendingInstall` and deletes its staging directory |

**Why this preserves T9 and D106:**
- `main` (where native apps run under D54, views sit in `loam-sandbox`, and the copilot runtime sits in its opaque frame) **never** receives a model API key, an approver token, a filesystem path, or a setup write permission.
- `host-setup` has zero apps, zero frames (`frame-src 'none'`), zero external network (`connect-src 'self' ipc: http://ipc.localhost`), zero persistent storage (nonpersistent store on macOS + ephemeral wiped profile on Windows/Linux), and serves only assets compiled into the Rust binary.
- **Honest scope of T9:** under D165, the person's typed API key briefly passes through `host-setup`'s isolated first-party JS to cross Tauri IPC to Rust, where Rust writes it straight to the OS keychain and drops it; it still never enters `main`, any app, the copilot runtime, the store, the journal, any file on disk (unless the person opts into Linux keyring-less file fallback under D166), or any log.

### 3.2 How `host-setup` opens (D165)

1. **Native Rust application menu** (`src-tauri/src/lib.rs`, `menu()`):
   - `Loam → Plugins…` opens/focuses `host-setup` on `#plugins`.
   - `Loam → Copilot Models…` opens/focuses `host-setup` on `#models`.
2. **OS file association / launch argument** (`tauri.conf.json` `bundle.fileAssociations` for `.loam-plugin`, Rust `main.rs`, `tauri-plugin-single-instance` callback, and macOS `RunEvent::Opened`):
   - `tauri-plugin-single-instance` resolves any candidate relative path against the passed `_cwd` and accepts **only** an existing regular file ending in `.loam-plugin`; all other or unrecognized CLI arguments are ignored without opening `host-setup`.
   - macOS `RunEvent::Opened` accepts **only** `file://` URLs resolving to an existing regular `.loam-plugin` file.
   - Passing a valid `.loam-plugin` path inside Rust opens/focuses `host-setup` (unless a `PendingInstall` is already active, in which case `host-setup` is focused and asks the user to finish or cancel the active review first) and runs Phase 1 Inspect (read-only, zero execution).
3. **Minimal trigger from `main` (D165):**
   - One read-only-effect IPC command on `main`: **`setup_open({ section: "models" | "plugins" })`**, guarded by `from_shell` (`label == "main"` AND `Origin == shell_origin()`, returning bare `DESKTOP_ORIGIN_REFUSED` on violation), debounced (at most once per 2 s), taking **strictly** the closed two-value enum `"models" | "plugins"` (unknown fields rejected via `#[serde(deny_unknown_fields)]`) and **no** path, URL, plugin id, provider id, or secret.
   - If `host-setup` is already open, `setup_open` focuses it and switches to `section` **only if no `PendingInstall` consent flow is active** (otherwise it focuses `host-setup` without disrupting the active consent screen).

### 3.3 `host-setup` IPC command surface (`capabilities/host-setup.json`)

Every command below is registered in `build.rs` and `handler()`, granted **exclusively** in `capabilities/host-setup.json` to `webviews: ["host-setup"]`, and begins with `from_host_setup(&webview, &request)?`.
- **Error contract:** `main` IPC commands (the existing 6 plus `setup_open`) keep **bare error codes** (e.g., `"DESKTOP_ORIGIN_REFUSED"`). `host-setup` IPC commands return structured `SetupError { code: &'static str, suggestion: &'static str }` (with Loam's own fixed words from [section 11](#11-error-codes), never secrets, raw engine output, or untrusted plugin strings). `from_host_setup` itself returns `DESKTOP_HOST_SETUP_REFUSED`.

| Command | Input (`#[serde(deny_unknown_fields)]`) | Returns | Trust / Safety Rule |
| --- | --- | --- | --- |
| `setup_state_get` | `{}` | `{ mode: "managed" \| "cli", workspace: { id, name }, plugins: InstalledPluginSummaryV1[], pendingRevocations: PendingRevocationSummaryV1[], bundled: BundledPluginSummaryV1[], models: ModelProviderSummaryV1[], reloadPending: boolean }` | Never returns any API key, bearer token, `proofKey`, or raw secret |
| `setup_plugin_pick` | `{ kind: "file" \| "folder" }` | `{ cancelled: true } \| { cancelled: false, proposal: PluginInstallProposalV1 }` | Opens **native OS dialog in Rust** (`rfd`); JS never supplies a path. Runs Phase 1 Inspect into `.staging/<proposalId>/` (zero binary execution) |
| `setup_plugin_inspect_bundled` | `{ id: string }` | `{ proposal: PluginInstallProposalV1 }` | `id` must match an entry discovered in read-only `<resource dir>/bundled-plugins/`; runs Phase 1 Inspect |
| `setup_plugin_cancel` | `{ proposalId: string }` | `{ ok: true }` | Consumes pending proposal and immediately deletes `.staging/<proposalId>/` |
| `setup_plugin_confirm` | `{ proposalId: string, expectedBundleSha256: string, allowFileFallback?: boolean }` | `{ installed: InstalledPluginSummaryV1, reloadRequired: true }` | Requires matching single-use `proposalId` + `expectedBundleSha256` from Rust memory; acquires `desktop-state.lock`; runs Phase 3 transactional commit with rollback on failure |
| `setup_plugin_uninstall` | `{ pluginId: string }` | `{ uninstalled: true, dataPreserved: true, tokenRevoked: boolean, reloadRequired: true }` | Closes live instance handles, stops/unregisters service, revokes token via `unpair` (retaining retryable `pendingRevocations` entry if `unpair` fails), deletes keychain entry, re-materializes deployment |
| `setup_plugin_retry_revocation` | `{ tokenId: string }` | `{ revoked: true }` | Retries `unpair --token-id <tokenId>` for a `pendingRevocations` entry; once `unpair` exits `0`, removes the entry, deletes the version directory `<app data>/plugins/<plugin-id>/<bundleSha256>/` holding `binaryPath` only when no installed plugin and no remaining `pendingRevocations` entry references that `binaryPath`, and deletes `<app data>/plugins/<plugin-id>/` only when no installed plugin has `pluginId` and no remaining `pendingRevocations` entry references any path inside it |
| `setup_plugin_rotate_token` | `{ pluginId: string }` | `{ rotated: true, tokenId: string, reloadRequired: false }` | Runs `pair` (unique name), verifies new token and persistent `proofKey` in memory before writing `<instance-id>.<newTokenId>` and committing `tokenId`, refreshes live `Mounts` bearer in-place, deletes `<instance-id>.<oldTokenId>`, and revokes old `tokenId` (or records in `pendingRevocations`) |
| `setup_plugin_service_action` | `{ pluginId: string, action: "start" \| "stop" \| "restart" \| "status" }` | `{ state: "running" \| "stopped" \| "unreachable", port: number }` | Fixed actions only; never accepts a command line or port |
| `setup_model_save` | `{ id, kind?, model?, endpoint?, setDefault?: boolean, apiKey?: string, skipVerify?: boolean, confirmRebindKey?: boolean, allowFileFallback?: boolean }` | `{ saved: true, checked: boolean, answered?: number, reloadRequired: boolean }` | Validates against 4.1 rules (≤ 16 providers); refuses silent key reuse when `kind`/`endpoint` changes; in `cli` mode accepts only `{ id, apiKey, skipVerify? }` bound to `models.json`; verifies via `GET .../models` (all response bodies discarded unread); checks Windows 2,560-byte credential limit; writes via `keychain.rs` (or opt-in mode `0600` file on keyring-less Linux per D166); drops key immediately |
| `setup_model_remove` | `{ id: string, deleteKey: boolean }` | `{ removed: true, reloadRequired: boolean }` | Removes provider from `desktop-state.json` / `models.json` / `deployment.json`; optionally deletes keychain entry or `<app data>/keys/<id>.key` |
| `setup_model_set_default` | `{ id: string }` | `{ default: string, reloadRequired: true }` | Switches `copilot.default` and re-materializes `deployment.json` |
| `setup_apply_reload` | `{}` | `{ action: "reloaded" \| "prompted" \| "busy" }` | Calls `main`'s shell reload guard (`requestReload()`) which checks all dirty editor tabs before reloading and focuses `main` with a save/discard/cancel prompt if any tab is unsaved |

---

## 4. The Plugin Bundle and `loam-plugin.toml` (Profile Version 1)

### 4.1 Files and bundle format

- **Authoring manifest:** `loam-plugin.toml` at the root of a plugin's source directory (e.g. `endpoints/loam/plugins/mail/loam-plugin.toml`).
- **Packed bundle manifest:** `plugin-manifest.json`, written by `loam plugin pack <dir> --out <bundle>` (a directory or `.loam-plugin` zip archive) alongside packed app directories (`apps/<id>/app-manifest.json` + assets) and engine binaries (`engines/<target>/<artifact>`).
- **Schema:** `endpoints/loam/packages/manifest/schemas/loam-plugin.v1.json` (`$id: https://afd.dev/loam/schemas/loam-plugin.v1.json`), closed with `additionalProperties: false` at every object depth. This is a Loam plugin **bundle** manifest (listing one or more `app-manifest.json` packages plus an optional engine); it does not alter `spec/plugin-manifest.core.v1.json` or Umbel.

### 4.2 Exact schema and example (`loam-plugin.toml`)

```toml
plugin_manifest_version = 1

[plugin]
id = "mail"                                          # ^[a-z][a-z0-9-]{0,31}$ (not a reserved shell id or "afd")
title = "Mail"                                       # 1..80 chars, AFD display rules, must not say "Loam"
version = "0.1.0"                                    # semver
description = "Local mail sync, search, drafts and reply sets." # 1..500 chars, AFD display rules
license = "MIT"                                      # optional SPDX
homepage = "https://afd.dev/loam/plugins/mail"       # optional https:// display metadata (never fetched or auto-opened)

# 1 to 8 packed app packages bundled inside this plugin.
[[apps]]
id = "mail"                                          # ^[a-z][a-z0-9]{0,31}$; default instance id
path = "apps/mail"                                   # relative path holding packed app-manifest.json

[[apps]]
id = "mailapp"
path = "apps/mailapp"

# Optional engine table. Omit for pure-app (native/view-only) plugins.
[engine]
id = "loam-mail"                                     # ^[a-z][a-z0-9-]{0,31}$
kind = "http-service"                                # closed enum in v1: ["http-service"]
mount_app = "mail"                                   # must match an [[apps]].id whose manifest has kind = "mounted"
service_mode = "login"                               # closed enum in v1: ["login"] (D148 / D167)

# At least one platform target artifact.
# Closed target keys: darwin-arm64 | darwin-x64 | windows-x64 | windows-arm64 | linux-x64 | linux-arm64
[engine.artifacts."darwin-arm64"]
path = "engines/darwin-arm64/loam-mail"
sha256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

[engine.artifacts."windows-x64"]
path = "engines/windows-x64/loam-mail.exe"
sha256 = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210"

[engine.artifacts."linux-x64"]
path = "engines/linux-x64/loam-mail"
sha256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

[engine.auth]
mode = "approver"                                    # "approver" | "agent" | "none"

# Declarative mount policy shown in full on the consent screen before writing deployment state.
[engine.mount]
audience = "person"                                  # "person" only on desktop (D95, D106)
labels = "per-part"                                  # "whole" | "per-part" (default "whole")
approvals = "shell"                                  # "none" | "shell" (default "none"); "shell" <-> auth.mode = "approver"
views = true                                         # optional; lets shell-open render the engine's ui:// views (D169, default false)
expose = { agent = true, palette = true }            # optional read defaults; mcp/cli/apps refused here

[engine.mount.commands."mail-draft-send"]
expose = { agent = true, apps = true }
# Optional `effects` and `destructive` overrides match deployment.v4.json ($defs/commandOverride).
preview = { command = "mail-draft-show", input = ["draft", "revision"] }

[engine.mount.commands."mail-replyset-submit"]
expose = { agent = true }
```

### 4.3 Future engine-backed plugins (e.g., Trillium) and pure-app plugins

- **Engine-backed plugin without shell approvals (e.g., Trillium v1):** uses the identical schema with `engine.auth.mode = "agent"` (or `"none"` if unauthenticated loopback), `engine.mount.approvals = "none"`, `engine.mount.labels = "per-part"` (if it labels stranger content) or `"whole"` (default), and its UI app(s) (`native` or `view`) joined to its mounted instance via `[[calls]]`.
- **Engine-backed plugin adding shell approvals later:** sets `engine.auth.mode = "approver"`, `engine.mount.approvals = "shell"`, and declares each released command's `preview`.
- **Pure-app plugin (no local engine):** omits `[engine]` entirely; Loam skips `--version`, port allocation, pairing, OS service registration, and health probes, while running the identical staging, whole-bundle digest, consent, materialization, upgrade, and uninstall flow.

### 4.4 Validation rules beyond the schema

Both `loam plugin check` (TypeScript) and `loam-desktop` Phase 1 Inspect (Rust, run **strictly on staged bytes**) enforce these identical rules:

1. **Forbidden keys (`PLUGIN_MANIFEST_INVALID`):** `additionalProperties: false` refuses `command`, `args`, `env`, `cwd`, `url`, `endpoint`, `port`, `bearer`, `bearer_file`, `bearer_env`, `token`, `install_dir`, or any unknown key anywhere in the document. `plugin.homepage`, when present, is display-only metadata validated as `https://` with no credentials/control chars and is never fetched or auto-opened by Loam.
2. **Display-safe strings & reserved names (`PLUGIN_MANIFEST_INVALID`):**
   - `plugin.id`, `plugin.title`, `plugin.description`, `apps[].id`, `engine.id`, and every command/input key must pass AFD display rules (no ASCII/Unicode `Cc` control characters, no bidi overrides `U+202A..U+202E` / `U+2066..U+2069`, no zero-width formatting characters, no line/paragraph separators).
   - `plugin.title` and every bundled app title must not say `"Loam"` as a word (matching `core-rules.ts` / `shell-name.ts` NFKC + stripped `Cf` rule).
   - `apps[].id` must not be a reserved shell/instance identifier (`"shell"`, `"loam"`, `"p"`, `"afd"`, or any shell domain listed in `read-deployment.ts`).
3. **Path containment, archive hygiene, & bounds (`PLUGIN_PATH_ESCAPE`, `PLUGIN_BUNDLE_TOO_LARGE`):**
   - Total uncompressed bundle size ≤ **256 MiB**; total files ≤ **2,000**; `plugin-manifest.json` ≤ **1 MiB**.
   - Every relative path must use `/` separators, contain only normal segments (no `.`, `..`, leading `/`, `\`, `:`, NUL, or Windows reserved names `CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`). **Made exact by step 9a** so that a bundle unpacks to the same names everywhere: a reserved name is refused with any extension and with spaces before it (`con .txt`), with `0` or a superscript digit (`COM¹`), and as `CONIN$` or `CONOUT$`; a segment may not hold `<>"|?*` or end in a dot or a space (Windows drops them); a path is at most 768 bytes of UTF-8 (within macOS's 1,024-byte limit on a whole absolute path, with room kept for the root a bundle is staged or installed under, so `check` gives one verdict on every system; added by step 9a2, and the bound an archive's size allowance derives from); a path holds no control, format or lone-surrogate character and is in Unicode normalization form C. **Step 9a2 adds:** a segment is at most 255 bytes of UTF-8 (what APFS, ext4 and NTFS each hold), and paths are compared for collisions, in a directory bundle, an archive and `apps[].path` alike, by one fold: NFC, then the full lower-case mapping, the full upper-case mapping and the full lower-case mapping again, then NFC (ECMAScript's `toLowerCase` and `toUpperCase`, or Rust's `str::to_lowercase` and `to_uppercase`: Unicode's default case mappings with SpecialCasing, no locale; `foldBundlePath` in `@lushly-dev/loam-manifest/plugin`). Lower case alone leaves `ſ` and `s`, `ß` and `ss`, and a final `ς` and `σ` apart, which a case-insensitive volume may make one (APFS folds `ß` and `ss` to one name; NTFS, which upper-cases simply, keeps them apart, and a bundle may hold only one of them either way); lowering first makes the fold stable for `ẞ` (U+1E9E), whose upper case is itself. The TypeScript side was checked against Unicode 17.0 (Node.js 26.13's ICU 78.3); 9c states the Unicode version Rust's case mappings follow, since a mapping a later Unicode changes may fold differently.
   - `.loam-plugin` zip archives MUST contain zero symbolic links (refused if any entry has Unix symlink mode `0o120000`), zero duplicate entry names and zero case-insensitive path collisions (checked across all OSes so macOS/Windows extraction cannot shadow files), and are held to the 256 MiB cumulative cap (zip-bomb defense). **Made exact by step 9a2:** an archive is read only in the one **canonical form** `loam plugin pack` writes, and any deviation, however harmless to one reader, is refused, so no field is left for another reader to read differently. (Denylisting what other readers honour left a gap three reviews running: a ZIP64 locator hidden in an unknown extra field, and libarchive's `xl` field, which makes `bsdtar` and Windows `tar` create a symbolic link from a regular file's entry.) The reader reads the whole file into memory (refusing unread one larger than 256 MiB plus the most an archive of a bundle within the bounds can add to its files: per file, a 30-byte local header, a 46-byte central entry and the name twice at its 768-byte bound; zlib's bound on what raw deflate adds, `bytes/4096 + bytes/16384 + bytes/33554432` plus 7 bytes a stream; and the 22-byte end record, so 3,319,950 bytes at the bounds, and `pack --out <name>.loam-plugin` is refused for size exactly when a directory bundle would be) and judges its whole structure before any entry's data is read; it does not stream. `loam plugin check` and 9c's inspect hold the same rules. [`loam-plugin-cases.json`](../../../packages/manifest/test/fixtures/loam-plugin-cases.json)'s `archives` section holds a case for each deviation, by code, each archive's bytes stated field by field with their SHA-256, which `node scripts/archive-cases.mjs` in `@lushly-dev/loam-manifest` (Node.js alone) builds and checks apart from the CLI's own builder; it includes both polyglots, which Python's `zipfile` and `bsdtar` read as another bundle or a link, and which Loam refuses.
     - **The canonical form** (every field little-endian):
       - **Entries:** regular files only, no directory entries; each deflated; in strictly increasing order of the name's UTF-8 bytes (so no name twice); local records written in that order from offset 0, each immediately after the last, then the central directory in the same order, immediately after the last record, then the end record, immediately after the directory, ending the file.
       - **A local header:** signature `0x04034b50`; version needed 20; flags `0x0800` (bit 11, the name is UTF-8, and nothing else: no encryption, no data descriptor); method 8; time 0; date `0x0021` (1980-01-01); the CRC-32, compressed size and uncompressed size; the name's length; extra length 0. Then the name, then the deflated data, and nothing else (no extra field, no data descriptor).
       - **A central entry:** signature `0x02014b50`; version made by `0x0314` (Unix, spec 2.0); then the local header's version, flags, method, time, date, CRC-32 and sizes, which must equal the local header's; the name's length; extra length 0; comment length 0; disk 0; internal attributes 0; external attributes `0x81a40000` (`100644` in the high half) or `0x81ed0000` (`100755`), and 0 in the low half (no MS-DOS attribute); the local record's offset. Then the same name, byte for byte, and nothing else.
       - **The end record:** signature `0x06054b50`; disk 0 and the directory's disk 0; both entry counts the number of entries; the directory's size and offset; comment length 0. It is the file's last 22 bytes. When those 22 bytes are not an end record (bytes or a comment follow one, or there is none) the refusal's reason is `end-record`, and nothing elsewhere in the file is searched to tell which; `comment` is only a non-zero comment length read in those 22 bytes, where the form puts it. No ZIP64 record, locator or field, and no value of `0xffff` or `0xffffffff` where ZIP64 would use one.
       - **The data:** each deflate stream ends (it has a final block: a stream that stops after a sync flush is refused, though Python's `zipfile` returns its data), inflates to exactly its uncompressed size, no further, matches its CRC-32, and ends exactly at its compressed size (no byte after the end of the stream).
       - **The mode:** `100755` marks exactly the engine artifacts the manifest names, and every other file is `100644` (judged last, with the bundle, `PLUGIN_MANIFEST_INVALID` keyed by the file).
     - **Codes:** a deviation is an archive Loam cannot read, `PLUGIN_MANIFEST_INVALID` keyed `(archive)`, with one exception: an entry whose external attributes or trailing `/` make it a symbolic link, directory, FIFO, character or block device, or socket is `PLUGIN_PATH_ESCAPE` keyed by its name. Past the bounds, `PLUGIN_BUNDLE_TOO_LARGE` keyed `(archive)`: more than 2,000 entries (a canonical archive holds files only, so entries are files), or declared sizes that together pass 256 MiB, both judged before any data is read, so sizes that each fit and pass together are refused, and inflating stops one byte past the declared size, so a zip bomb never grows. Then each name, `PLUGIN_PATH_ESCAPE` keyed by it: a bundle path by the rule above, claimed once by its fold (below), each directory above it too, so two names that fold alike (`aΣ` and `aσ`, `ſ` and `s`, `ẞ` and `ß`), a parent spelled two ways (`apps/sketch/a` and `apps/Sketch/b`) and a file where another entry has a directory are refused. Then what it holds: a `plugin-manifest.json` at its root and no `loam-plugin.toml` (`PLUGIN_MANIFEST_MISSING`); then its files are staged in a private, owner-only directory (a name this system cannot stage, a whole path too long for it, say, is refused as `PLUGIN_PATH_ESCAPE` keyed by the entry, never thrown) and checked there as the packed bundle they are, by every rule a directory bundle passes (rule 6 included), to the same 7.1 digest; then the mode.
     - **Reasons:** each refusal also carries a stable `reason`, one tag per rule (`extra-field`, `tiling`, `zip64`, `stored`, `mode`, `signature-in-end-record` and the rest, listed in the cases' description), which 9c gives too, so two refusals of one code are told apart; every shared case names the reason it is refused for.
     - **The order of refusals:** when an archive has more than one fault, the first in this order is reported, and nothing after it: the structure (the end record, then each central entry with its local record in the directory's order, then the directory's own bytes), then the bounds, then the data, then the names, then what it holds. Cases with faults of several kinds pin each step.
     - **Where a record signature could still appear, and why no reader can be steered there.** Every one of the six record signatures (local `PK\x03\x04`, central `PK\x01\x02`, end `PK\x05\x06`, ZIP64 end `PK\x06\x06`, ZIP64 locator `PK\x06\x07`, data descriptor `PK\x07\x08`) holds a byte from `0x01` to `0x08`, a control character no bundle path may hold, so no name can spell one; with no extra field and no comment anywhere, what is left is a header's numeric fields (a CRC-32, a size or an offset, which an author can steer by choosing data or padding) and each file's deflated data, which may hold any bytes (a deflate stream can carry stored blocks). A reader that walks local records uses each header's sizes, which the form requires, and never looks inside data; a reader that starts from the end finds the end record in the last 22 bytes, with no comment to search; a reader that honours a ZIP64 locator looks in the 20 bytes before the end record, which are the end of the central directory. So the reader keeps two signature checks, both structural, and the second also covers the names' bytes, so the argument about names is checked rather than only reasoned: nothing after the end record's first byte (its own fields: a directory size or offset could spell one) holds a signature, and the central directory holds `PK\x01\x02` only at the start of each entry and no other signature anywhere (a CRC-32, size or offset there could spell one, and a locator signature in its last 20 bytes would steer a ZIP64-aware reader into the data). File data, opaque and never read as structure by a reader that has the form's sizes and end record, is not searched.
     - **What `loam plugin pack --out <name>.loam-plugin` writes** is the canonical form, from the checked bundle's files; with one Node.js and zlib build, one source packs to the same bytes (the deflate encoding is the compressor's, and any valid encoding of the same data is read alike). It is read back and checked before it takes `--out`'s place, which it does in one rename over any earlier file, and an existing archive there is replaced only when the record beside it (`.<name>.loam-pack.json`) matches it, as a directory bundle is. A `--out` that is a symbolic link resolves to its target, as a directory `--out` does, so the archive and its record are written where the link points; a link that leads to nothing is refused (`PLUGIN_PACK_OUT_INVALID`), never replaced.
   - Folder installs open and stage only regular files (`is_file()`, refusing symlinks, FIFOs, sockets, and device nodes via `symlink_metadata` / `O_NOFOLLOW`), verify canonical containment inside the bundle root, and reject case-insensitive path collisions.
   - On POSIX, staged files strip setuid/setgid/group/other bits (`0600` for data/app files, `0700` for directories and the verified engine binary).
   - `engine.artifacts.<target>.path` MUST start with `engines/<target>/`:
     - For `windows-x64` / `windows-arm64`: basename MUST match `^[a-z][a-z0-9._-]{0,63}\.exe$` (native PE executable only; `.bat`, `.cmd`, `.com`, `.ps1`, `.vbs` refused so Rust can never dispatch through `cmd.exe`).
     - For `darwin-*` / `linux-*`: basename MUST match `^[a-z][a-z0-9._-]{0,63}$` (no `.bat`/`.cmd`/`.sh` suffixes).
4. **App manifest & deployment-reader parity (`PLUGIN_MANIFEST_INVALID`, `PLUGIN_CONFLICT`):**
   - Every `apps[].path` must contain a valid packed `app-manifest.json` (passing `readManifest`, no `MANIFEST_NOT_PACKED`), with unique `apps[].id` values and no instance or domain collision with other installed plugins (upgrades of the same `plugin.id` are allowed).
   - For `native` and `view` apps, `apps[].id` MUST equal `app-manifest.json`'s `plugin.id` (matching `read-deployment.ts`).
5. **Engine & mount coherence:**
   - `engine.mount_app` must reference an `apps[]` entry whose `app-manifest.json` has `plugin.kind == "mounted"`, `mount.transport == "http"`, and a valid `mount.prefix` listed in `plugin.domains` (matching `spec/plugin-manifest.core.v1.json`).
   - **Approver bi-implication:** `engine.mount.approvals == "shell"` **IF AND ONLY IF** `engine.auth.mode == "approver"`. (`approvals = "shell"` with non-approver auth, OR `auth.mode = "approver"` with `approvals = "none"`, is refused with `PLUGIN_MANIFEST_INVALID`, so an approver credential is never provisioned without the shell-approver consent notice and previews.)
   - `engine.mount.approvals == "shell"` requires at least one command in `engine.mount.commands` with a valid `preview` (`DEPLOYMENT_PREVIEW_REQUIRED`); `engine.mount.approvals == "none"` refuses any `preview` key (`DEPLOYMENT_PREVIEW_INVALID`).
   - Self-preview (`preview.command == commandName`) is refused (`DEPLOYMENT_PREVIEW_INVALID`, matching `approvals-rules.ts`).
   - Every command name and `preview.command` in `engine.mount.commands` must start with `<mount.prefix>-` (belonging to the mounted app's prefix domain).
   - `engine.mount.expose` admits only `agent` and `palette` booleans (`mcp`, `cli`, and `apps` at instance level are refused, matching `deployment.v4.json`).
   - `engine.mount.views`, when present, is a boolean (added by [#2894](https://github.com/lushly-dev/afd/issues/2894)): on a managed desktop it is D169's opt-in, the mounted entry's `views = true` in `loam.deployment.toml` elsewhere, so `shell-open` may render the engine's `ui://` views in the sandboxed slot only when it is `true`, which consent shows (7.2).
   - `engine.artifacts.<target>.sha256` must be exactly 64 lowercase hexadecimal characters and must equal the SHA-256 computed over the exact staged artifact bytes.
   - **A mounted app is the engine's** (added by step 9a): every bundled app whose manifest says `kind = "mounted"` must be `engine.mount_app`, so a pure-app plugin holds `native` and `view` apps only and an engine-backed plugin mounts exactly one instance; a mounted app with no engine would have no transport.
   - **One domain per instance** (added by step 9a): a `native` or `view` app's domain is its id and a mounted app's its `mount.prefix`, and no two bundled apps share one (D66, as `deployment check` refuses).
   - `[engine.mount]` is optional; left out, it is `labels = "whole"`, `approvals = "none"`, no `views` and no command overrides, and `engine.auth.mode` must then not be `"approver"`.
6. **A packed bundle holds what its manifest names, and nothing else** (added by step 9a, `PLUGIN_MANIFEST_INVALID`): `plugin-manifest.json`, each `apps[].path` directory and each artifact. A file outside them would be hashed into `bundleSha256` and installed without the consent screen naming it. An app or artifact path inside another one is refused too, since the bundle would hold its files twice. A source directory (`loam-plugin.toml`) may hold anything else; `loam plugin pack` copies only what the manifest names, writes the bundle into a private directory beside `--out`, checks it there and only then puts it in `--out`'s place. It replaces a non-empty `--out` only when the record it leaves beside it (`.<name>.loam-pack.json`, the digest it wrote) matches the bundle there now, so a file added anywhere in it, an app's directory included, keeps it from being deleted.

The reader's code and cases: `@lushly-dev/loam-manifest/plugin` (`readPluginManifest` for the manifest alone, `pluginAppsRefusals` with each packed app's manifest) and [`loam-plugin-cases.json`](../../../packages/manifest/test/fixtures/loam-plugin-cases.json), whose cases loam-desktop's Rust inspect (9c) runs too. Display text is refused when it holds any `Cc` or `Cf` character or U+2028 / U+2029, which covers rule 2's bidirectional and zero-width characters; `homepage` must also parse as an `https:` URL with a host and no user name or password. A manifest file is read as its exact bytes, decoded strictly as UTF-8 with a byte-order mark kept (so JSON refuses it, as Rust's `serde_json` does), and the digest hashes those bytes. A packed bundle's whole directory is listed for rule 6, the manifest among its files, and a directory past the bounds is refused rather than listed in part. The bounds are counted while the bundle is listed, so a tree past them stops being read or hashed; a source's `plugin-manifest.json`, as pack would write it, is held to the 1 MiB bound too. Each app's package must hold every file its manifest names (a native entry, a view's handlers, a resource). Case collisions are checked at every path segment, a file and a directory that differ only in case included.

---

## 5. The Fixed Engine Binary Contract, Pre-Bearer Proof, & Keychain Storage

Loam's Rust host **never** executes a command line from a manifest and **never** invokes a shell (`sh`, `bash`, `cmd`, `powershell`). For every `kind = "http-service"` engine, Rust constructs argv directly via `std::process::Command::new(&binary_path)` with a clean allow-listed environment matching `mounts.rs`:
- **Windows:** `SystemRoot`, `WINDIR`, `LOCALAPPDATA`, `APPDATA`, `USERPROFILE`, `TEMP`, `TMP`, and minimal `PATH` (preserving Winsock loopback and SQLite temp paths while dropping all ambient secrets/tokens).
- **macOS / Linux:** `HOME`, `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `XDG_RUNTIME_DIR`, `TMPDIR`, `LANG`, and minimal `PATH` (`/usr/bin:/bin`). Never forwards `BETTER_AUTH_*`, provider API keys, or ambient tokens.

**Desktop HTTP MCP `2026-07-28` prerequisite:** Phase 5 step 7 adds MCP `2026-07-28` framing for desktop `http` mounts (`endpoints/loam/packages/web/src/ports.ts` `era: 'modern'` for `http` and `mounts.rs` `MCP-Protocol-Version` / `Mcp-Method` / `Mcp-Name` headers); step 9 builds on that landed transport.

### 5.1 The fixed invocations and pre-bearer proof

| Purpose | Exact argv (never a shell) | Streams / Bounds / Timeout | Contract |
| --- | --- | --- | --- |
| **1. Post-consent build check** | `[binary, "--version"]` | `stdin: null`, `stdout/stderr: piped` (4 KiB cap), **5 s** timeout | Must exit `0`. Refused with `PLUGIN_ENGINE_TEST_BUILD` if stdout or stderr contains `test-doubles` (matches Mail `plugin.spec.md` 12.4). A debug-only compile gate `#[cfg(debug_assertions)]` with `LOAM_TEST_ALLOW_TEST_DOUBLES=1` lets automated CI suites test debug builds; completely compiled out of release builds. |
| **2. Runtime service** | `[binary, "serve", "--port", "<port>"]` | Loopback `127.0.0.1:<port>` only; `stdin: null`; `stdout: null`; bounded stderr per section 6 | Binds `127.0.0.1:<port>` (never `0.0.0.0`), serves MCP `2026-07-28` Streamable HTTP at `http://127.0.0.1:<port>/mcp` and unauthenticated `GET /health?nonce=<64-hex>` (returning HTTP `200` + `X-Loam-Proof: <hex HMAC-SHA256(proofKey, nonce)>` when authenticated), reads its hashed token store from its own data directory, and exits cleanly on `SIGTERM` (POSIX) or termination/Job-Object close (Windows). |
| **3a. Token pairing** (only when `engine.auth.mode` is `"approver"` or `"agent"`) | `[binary, "pair", "--role", "<approver\|agent>", "--name", "Loam Desktop (<short-id>)", "--accept-consent"]` | `stdin: null`, `stdout: piped` (4 KiB cap), `stderr: piped` (4 KiB cap), **15 s** timeout | Non-interactive (must succeed with `stdin: null` and no TTY, never failing with `PERSON_REQUIRED`; `--accept-consent` records host-collected human consent; unique `<short-id>` avoids Mail's duplicate token-name refusal). Creates a new random bearer token of the requested role (`tokenId` matching `^[A-Za-z0-9_-]{1,31}$`), ensures the engine store holds a single persistent 32-byte non-bearer instance identity key `proofKey` (generated once on engine init / first `pair` and returned unchanged on subsequent `pair` calls), stores **only the token hash**, journals the creation with secrets redacted (`source: "pair"`), prints **strictly one JSON object** to stdout (all diagnostics to stderr): `{"token":"<bearer>","tokenId":"<id>","role":"<approver\|agent>","proofKey":"<64-hex>"}`, and exits `0`. Rust deserializes with `#[serde(deny_unknown_fields)]`, rejecting trailing non-whitespace bytes, invalid `tokenId`, mismatched `role`, invalid 64-hex `proofKey`, or non-`key_shaped` `token` (`PLUGIN_PAIR_FAILED`). If the engine is already running (`serve` holds the store lock), `pair` forwards over the engine's private loopback `/cli` route using `cli.token` (matching `engine.spec.md` 3.2) so pairing works whether the service is stopped or running. |
| **3b. Token revocation** (on uninstall or rotation) | `[binary, "unpair", "--token-id", "<tokenId>"]` | `stdin: null`, `stdout/stderr: piped` (4 KiB cap), **5 s** timeout | Non-interactive (`stdin: null`, no TTY required). Revokes the named bearer token (idempotent: exit `0` if already revoked or absent) while keeping the engine's persistent instance identity `proofKey` intact so concurrent/subsequent tokens verify cleanly. Works with the engine stopped or running via `/cli`. |

### 5.2 Pre-bearer server identity verification (multi-user port-squatter defense)

Selecting a loopback port does not reserve it across process start or reboot on a multi-user machine. To guarantee Loam **never** transmits `Authorization: Bearer <token>` to another OS user's listener on `127.0.0.1:<port>`:
1. On initial install health probe AND before sending the first authenticated request on every `mount_open` (including after restarts/reboots), Rust sends an **unauthenticated** `GET http://127.0.0.1:<port>/health?nonce=<64-random-hex>` (no `Authorization` header, no redirects, no proxy, 2 s timeout, response body discarded unread).
2. Rust checks HTTP `200` and verifies header `X-Loam-Proof` in constant time against `HMAC-SHA256(proofKey, nonce)` (where `proofKey` is the non-bearer key returned by `pair` and kept in owner-only `desktop-state.json` and `mounts.json`; **made exact by step 9b2:** `proofKey` is decoded from its 64 lowercase hex characters into the 32-byte HMAC key, the 64-character lowercase hex `nonce` query parameter is hashed as its 64 ASCII bytes, and `X-Loam-Proof` must be a single header carrying 64 lowercase hex characters verified in constant time).
3. If the check fails, Rust transmits **zero** bearer token and aborts (`PLUGIN_PORT_CONFLICT` during install/probe, `MOUNT_UNREACHABLE` on `mount_open`).
4. Only after proof verification passes does Rust send the authenticated MCP request (`POST http://127.0.0.1:<port>/mcp`, `Content-Type: application/json`, `Accept: application/json, text/event-stream`, `MCP-Protocol-Version: 2026-07-28`, `Authorization: Bearer <token>`) **on that same verified HTTP/1.1 keep-alive TCP connection** (step 9b2 binds `mounts.rs` `proof_key` handles via `hyper::client::conn::http1` over a direct loopback `TcpStream`, re-running a fresh `/health` proof on any new TCP connection before sending `Authorization`, and never dialing a new connection for session `DELETE` on `mount_close`) and validate HTTP `200` with a JSON-RPC `"result"` object (no `"error"`). When `auth.mode == "none"`, there is no bearer to leak, and the probe still validates HTTP `200` + MCP JSON-RPC `"result"`.

### 5.3 Shared Rust keychain module, `mounts.json`, & profile scoping

Extend the audited module **`src-tauri/src/keychain.rs`** (which already holds `read(service, account)` for `models.rs`) with `write(service, account, secret)` and `delete(service, account)`. Every entrypoint validates `keychain_name(service)` and `keychain_name(account)` before touching the OS API:
- **Windows:** Native Win32 `CredReadW`, `CredWriteW`, and `CredDeleteW` via `windows-sys = "=0.61.2"` (`Win32_Security_Credentials`, already enabled in `Cargo.toml`) with target `<service>/<account>` and UTF-16 credential blob (`CRED_PERSIST_LOCAL_MACHINE` / `2`, matching `copilot-key.ts` and `keychain.rs`). **Zero PowerShell subprocesses.** Pre-checks Windows' 2,560-byte `CREDENTIALW.CredentialBlobSize` limit (≤ 1,280 ASCII characters encoded as UTF-16) and returns `COPILOT_KEY_TOO_LONG` / `PLUGIN_KEY_TOO_LONG` before writing.
- **macOS:** Native `Security.framework` via `security-framework = "=3.7.0"` (ordered search-list lookup) and `apple-native-keyring-store = "=1.0.2"` (`features = ["keychain"]`) + `keyring-core = "=1.0.1"` (`Cred::build(MacKeychainDomain::User, service, account)`, already locked in `Cargo.toml` and shared with Mail's `secrets.rs`) — zero `/usr/bin/security` subprocesses, secrets never on argv or in interactive stdin pipes.
- **Linux:** `secret-tool` (`lookup`, `store` with secret on stdin, `clear`), secret never on argv.

**Keychain namespaces & multi-profile scoping:**
- Default profile (`LOAM_DESKTOP_DATA_DIR` unset):
  - Model API keys: `service = "loam-copilot"`, `account = "<provider-id>"` (unchanged from step 2).
  - Plugin mount bearers: `service = "loam-plugin-mount"`, `account = "<instance-id>.<tokenId>"` (each paired token gets its own immutable slot; since `instance-id` ≤ 32 chars and `tokenId` ≤ 31 chars, `<instance-id>.<tokenId>` always fits `keychain_name`'s 64-char `[A-Za-z0-9._-]` bound, so an upgrade or rotation never overwrites the previous working credential before `desktop-state.json` commits).
- Non-default profile (`LOAM_DESKTOP_DATA_DIR` set): append `-<profile8>` (first 8 lowercase hex chars of `SHA-256(canonical_data_dir)`) to the service name (`loam-copilot-<profile8>`, `loam-plugin-mount-<profile8>`) and to all OS-wide service/Run/mutex/event identifiers in section 6, so secondary/test profiles never collide with or uninstall another profile's tokens or services.

**`mounts.rs` `HttpAccess` additions:**
- Gains optional `bearer_keychain: Option<KeychainRef>` (mutually exclusive with `bearer: Option<String>`, requiring a loopback `proof_key`; `DESKTOP_MOUNTS_INVALID` if both are present, if `bearer_keychain` lacks `proof_key`, or if either name fails `keychain_name`) and optional `proof_key: Option<String>` (64 lowercase hex chars, validated as `DESKTOP_MOUNTS_INVALID` otherwise).
- Existing `loam deployment write --mounts-out` files continue using `bearer` unchanged.
- Host-managed plugin installs write `bearer_keychain: { keychain: "<service>", account: "<instance-id>.<tokenId>" }` and `proof_key` into `mounts.json` (never the plaintext bearer on disk). `Mounts` resolves `bearer_keychain` on `mount_open` (returning bare `MOUNT_KEYCHAIN_MISSING` if absent/unreadable) and refreshes in-place on `setup_plugin_rotate_token` without dropping open handles.
- **Linux without Secret Service (D166):** If `keychain::write` fails on Linux because no Secret Service daemon is running, install fails closed with `PLUGIN_KEYCHAIN_UNAVAILABLE` by default. With explicit user consent (`allowFileFallback: true`) in `host-setup`, the bearer is stored in owner-only `mounts.json` (mode `0600` via `connection::create_owner_only`).

---

## 6. OS Login Auto-Start Registration (D148 / D167)

When an installed plugin declares `[engine]` with `service_mode = "login"`, `loam-desktop` registers the engine to start automatically when the person signs into their OS account, with **zero admin/root elevation**, so the engine runs whether Loam is open or not (e.g., Mail syncing in the background).

Every service identifier is derived strictly from the validated `plugin.id` (`^[a-z][a-z0-9-]{0,31}$`) plus the optional `-<profile8>` suffix when `LOAM_DESKTOP_DATA_DIR` is non-default: no untrusted string ever reaches a unit name, plist label, or registry key. Let `<svc-id>` be `<plugin-id>` (default profile) or `<plugin-id>-<profile8>` (non-default profile).

### 6.1 macOS — `launchd` LaunchAgent

- **Label:** `dev.lushly.loam.plugin.<svc-id>`
- **Path:** `~/Library/LaunchAgents/dev.lushly.loam.plugin.<svc-id>.plist` (atomic write, mode `0600`)
- **Contents:** XML plist with:
  - `Label`: `dev.lushly.loam.plugin.<svc-id>`
  - `ProgramArguments`: `["<app data>/plugins/<plugin-id>/<bundleSha256>/<artifact>", "serve", "--port", "<port>"]`
  - `EnvironmentVariables`: explicit minimal allow-list (`HOME`, `TMPDIR`, `LANG`, `PATH=/usr/bin:/bin`)
  - `RunAtLoad`: `true`
  - `KeepAlive`: `{ "SuccessfulExit": false }` (restarts on crash; stays stopped after clean exit)
  - `ThrottleInterval`: `10`
  - `ProcessType`: `"Background"`
  - `StandardOutPath`: `"/dev/null"`
  - `StandardErrorPath`: `"<app data>/logs/plugin-<plugin-id>.stderr.log"` (truncated/rotated at 1 MiB, max 2 files, on every start/upgrade and `loam-desktop` startup; never forwarded to `main`)
- **Start / Register:** `/bin/launchctl bootstrap gui/<uid> <plist>` (calling `bootout` first on upgrade/restart).
- **Stop / Unregister:** `/bin/launchctl bootout gui/<uid>/dev.lushly.loam.plugin.<svc-id>`, then delete the `.plist`.

### 6.2 Windows — `HKCU\...\Run` + `loam-desktop engine-run` supervisor (D167)

- **Owner-only launch descriptor:** `<app data>/plugins/<plugin-id>/launch.json` (and `launch.pending.json` during Phase 3 commit before `desktop-state.json` is written — eliminating the fresh-install/upgrade deadlock!). Written via `connection::create_owner_only` + atomic rename, containing `{ pluginId, bundleSha256, binaryPath, port }`.
- **Registry key:** `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, value name `LoamPlugin.<svc-id>` (written via native Win32 `RegCreateKeyExW` / `RegSetValueExW` / `RegDeleteValueW` in `windows-sys` — zero PowerShell, zero `reg.exe`, zero admin/UAC).
- **Value:** `"<win32-exe-path>" engine-run <plugin-id>` (plus `--data-dir "<win32-data-dir>"` when `LOAM_DESKTOP_DATA_DIR` is non-default).
  - Strips any `\\?\` verbatim prefix from `canonicalize()` before quoting so Windows `Run` / `ShellExecute` accepts the command.
  - Pre-checks Windows' 260-character `Run` value limit before mutation; refuses with `PLUGIN_SERVICE_FAILED` (suggesting installing Loam in a shorter path) if exceeded.
  - On `managed`-mode startup, refreshes any existing `LoamPlugin.<svc-id>` Run value whose executable path no longer matches `current_exe()`.
- **How `loam-desktop engine-run <plugin-id> [--pending] [--data-dir <dir>]` runs** (dispatched in `main.rs` before Tauri or `tauri-plugin-single-instance` starts, beside `loam-desktop mcp`, and **without** calling `attach_console()`):
  1. `loam-desktop.exe` is built with `windows_subsystem = "windows"`, so logon launch produces **zero console window flash**, even though plugin engines like `loam-mail.exe` are standard console binaries.
  2. Acquires a per-user named Win32 mutex (`Local\LoamPluginRun-<svc-id>` via `CreateMutexW`; `--pending` uses `Local\LoamPluginRunPending-<svc-id>`) so duplicate launches exit `0` cleanly without racing on the port.
  3. Reads `launch.pending.json` (when `--pending`) or `launch.json` (otherwise) via `read_owner_only`, verifies `binaryPath` is strictly inside `<app data>/plugins/<plugin-id>/<bundleSha256>/` and ends with `.exe`, spawns `<binary> serve --port <port>` with `CREATE_NO_WINDOW` and section 5's clean Windows env inside a **Windows Job Object** (`CreateJobObjectW` + `SetInformationJobObject` + `AssignProcessToJobObject` with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`), caps stderr log growth at 1 MiB (max 2 rotated files), and supervises crash restarts with exponential backoff (5 s to 60 s).
  4. Creates a per-user named Win32 Event (`Local\LoamPluginStop-<svc-id>` / `Local\LoamPluginStopPending-<svc-id>` via `CreateEventW`/`OpenEventW`/`SetEvent`) so `stop`, `upgrade`, rollback, and `uninstall` signal graceful shutdown and terminate the Job Object cleanly, then delete the `HKCU\...\Run` value.
  5. Visible natively in **Windows Settings → Apps → Startup** and **Task Manager → Startup Apps**.

### 6.3 Linux — `systemd --user` with XDG Autostart fallback (D167)

- **Primary (when `systemctl --user` is available and active):**
  - **Unit:** `${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/loam-plugin-<svc-id>.service` (atomic write, mode `0600`)
  - **Contents:**
    ```ini
    [Unit]
    Description=Loam plugin engine (<sanitized title>)
    After=network.target

    [Service]
    Type=simple
    ExecStart=/usr/bin/env -i HOME=<esc> XDG_DATA_HOME=<esc> XDG_CONFIG_HOME=<esc> XDG_RUNTIME_DIR=<esc> TMPDIR=<esc> LANG=<esc> PATH=/usr/bin:/bin "<escaped binary path>" serve --port <port>
    Restart=on-failure
    RestartSec=5
    StandardOutput=null
    StandardError=journal

    [Install]
    WantedBy=default.target
    ```
    Using `/usr/bin/env -i` clears the user manager's inherited environment and `execve`s directly into `<binary>` (so `systemd --user` supervises the engine directly with zero wrapper process and a clean allow-listed env; optional variables `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `XDG_RUNTIME_DIR`, `TMPDIR`, and `LANG` are emitted only when present in the user's environment, matching `mounts.rs`, never serialized as empty strings), while `StandardError=journal` keeps logs bounded by `journald` with no unbounded disk file.
  - **Register & start:** `systemctl --user daemon-reload`, then `systemctl --user enable --now loam-plugin-<svc-id>.service`.
  - **Stop & unregister:** `systemctl --user disable --now loam-plugin-<svc-id>.service`, remove unit file, `systemctl --user daemon-reload`.
- **Fallback (non-systemd Linux desktops):**
  - Honors `${XDG_CONFIG_HOME:-$HOME/.config}/autostart/loam-plugin-<svc-id>.desktop` (`Type=Application`, `NoDisplay=true`, `X-GNOME-Autostart-enabled=true`, `Exec="<escaped loam-desktop>" engine-run <plugin-id> [--data-dir <dir>]`).
  - Reuses the same small Rust `engine-run` supervisor (reading owner-only `launch.json` / `launch.pending.json`, holding an exclusive `flock` + owner-only PID/control socket under `<app data>/plugins/<plugin-id>/`, enforcing clean env and 1 MiB rotated stderr log), so every subsequent login refreshes live process ownership and uninstall cleanly stops the running engine across reboots with zero PID-reuse hazard.
- **Test-only override:** In CI / automated tests (`LOAM_DESKTOP_DATA_DIR` set), `LOAM_TEST_SERVICE_DIR` redirects service files to a temporary directory and exercises the real `engine-run` supervisor locally so tests never touch the runner's real login items while testing the real unit/plist/Run serializers and full lifecycle.

---

## 7. Plugin Install, Upgrade, Uninstall, and Token Rotation Flows

All mutating operations (`setup_plugin_*`, `setup_model_*`, and `loam-desktop plugin *`) acquire an exclusive owner-only advisory file lock **`<app data>/desktop-state.lock`** (`flock` / `LockFileEx`) before modifying state, preventing concurrent GUI and CLI corruption.

### 7.1 Phase 1 — Inspect (strictly read-only, zero execution, staged-only validation)

Triggered by `setup_plugin_pick` (native OS picker), `setup_plugin_inspect_bundled`, or OS `.loam-plugin` file open:
1. Create an owner-only staging directory `<app data>/plugins/.staging/<proposalId>/` (mode `0700` / protected DACL).
2. Stream/copy the bundle's files into staging while enforcing bundle bounds (≤ 256 MiB, ≤ 2,000 files, regular files only, zero symlinks, no path escapes, no zip duplicate entries, no case-insensitive collisions, POSIX permission bits stripped).
3. Parse and validate **only the staged** `plugin-manifest.json` and every staged `apps[].path/app-manifest.json` per section 4.4 (so nothing outside staging can change between validation and commit).
4. Compute hashes over the **exact staged bytes**:
   - If `[engine]` is present: resolve the current OS/arch target in `engine.artifacts` (`PLUGIN_TARGET_UNSUPPORTED` if missing), compute `engineSha256` on the staged target binary, and verify `engineSha256 == engine.artifacts.<target>.sha256` (`PLUGIN_HASH_MISMATCH` on mismatch, deleting staging).
   - Always (engine-backed AND pure-app): compute **`bundleSha256`**, the canonical SHA-256 over staged `plugin-manifest.json` and every staged file sorted by normalized relative path. **Exactly (fixed by step 9a, 2026-11-26):** the lowercase hex SHA-256 of the UTF-8 text made of one line per file, `plugin-manifest.json` among them, in the order of the relative paths' UTF-8 bytes, each line the file's own SHA-256 in lowercase hex, two spaces, its relative path with `/` separators, and a line feed (what `sha256sum` prints). Rule 3 of 4.4 keeps control characters, a line feed among them, out of every path. `loam plugin check` and `pack` report it; the vector is `bundleDigest` in `endpoints/loam/packages/manifest/test/fixtures/loam-plugin-cases.json`.
5. Check `desktop-state.json` for collisions or upgrades:
   - If `plugin.id` is installed with the same `bundleSha256`: delete staging and return `PLUGIN_ALREADY_INSTALLED`.
   - If `plugin.id` is installed with a different `bundleSha256` (including app-only or policy-only updates where `engineSha256` is unchanged!): mark `kind = "upgrade"` with `previous: { version, bundleSha256, engineSha256? }`.
   - If any bundled app id or domain collides with a *different* installed plugin: delete staging and return `PLUGIN_CONFLICT`.
6. Store `PendingInstall { proposalId, stagingDir, manifest, bundleSha256, engineSha256, expiresAt: now + 10m }` in Rust memory (at most one active proposal; creating a new one cleans up any previous staging directory).
7. Return sanitized `PluginInstallProposalV1` to `host-setup`. **Zero code from the plugin has executed.**

### 7.2 Phase 2 — Explicit human consent in `host-setup`

`host-setup` renders `PluginInstallProposalV1` as plain text (never HTML) and displays, in **Loam's own fixed words**:
- Plugin title, id, version, description, license, optional `https://` homepage (plain text / non-auto-navigating), and **full 64-character `bundleSha256`** (for upgrades: previous → new).
- For each bundled app: id, title, kind, declared grants; and for every `native` app, D54's explicit full-shell-trust disclosure (prominently rendered, never collapsed): *"Native app: runs with full shell trust — not sandboxed. It runs inside Loam's main window and shares Loam's desktop IPC (`mount_*`, `model_*`, `inbound_reply`, `setup_open`) and `loam:*` events; it cannot access `host-setup` or raw API keys/tokens."*
- If `[engine]` is present:
  - Artifact filename, target platform, and **full 64-character `engineSha256`** (for upgrades: previous → new, or *"unchanged"* on app-only upgrade).
  - Exact fixed launch command: `<artifact> serve --port <chosen at install>`.
  - Login auto-start notice naming the exact OS mechanism (`launchd` LaunchAgent / Windows Startup / `systemd --user` or XDG Autostart).
  - If `labels = "per-part"`: *"You are vouching that this engine labels untrusted content per part: its reads will run without asking, and its non-destructive edits keep its own policy under taint."*
  - If `auth.mode = "approver"` (which by 4.4 is bi-implicated with `approvals = "shell"`): *"Loam will pair an approver token with this engine. Loam will show a preview and ask you before running these commands: [list of each command + preview]. Any program running as your user on this computer has the same boundary as the engine's terminal."*
  - If `views = true` (D169): *"This engine's own pages may open inside Loam, in a sandbox that can read its own pages but cannot run its commands."* On an upgrade it is shown previous → new (*"not allowed"* → *"allowed"*, or the reverse), so a policy-only upgrade that turns it on is consented to again.
  - Every mutation exposed to agents or apps.
- Buttons: **"Cancel"** (`setup_plugin_cancel`) and **"Install & Start Service"** / **"Install Plugin"** / **"Upgrade Plugin"** (`setup_plugin_confirm({ proposalId, expectedBundleSha256 })`).

### 7.3 Phase 3 — Transactional commit (with full rollback & crash recovery)

`setup_plugin_confirm` acquires `desktop-state.lock` and atomically takes `PendingInstall` from memory (single-use; expired or mismatched `proposalId`/`expectedBundleSha256` returns `PLUGIN_PROPOSAL_EXPIRED` / `PLUGIN_HASH_MISMATCH` and deletes staging):

1. Atomically move staging into `<app data>/plugins/<plugin-id>/<bundleSha256>/` (owner-only directory `0700` / protected DACL; verified engine binary `0700` on POSIX).
2. **Branch for pure-app plugins (no `[engine]`):** skip steps 3–8 below and jump directly to step 9 (materialize & commit `desktop-state.json`, then remove `<old-bundleSha256>/` on upgrade).
3. **Post-consent build check (engine-backed):** run `<binary> --version` (section 5.1); refuse `PLUGIN_ENGINE_TEST_BUILD` if `test-doubles` is reported.
4. **Close live handles & stop previous service (upgrade only):** call `Mounts::close_instance(&mountInstance)` and stop the previous OS service cleanly so it releases its store lock and port (retaining its `launch.json` and keychain credential intact for rollback).
5. **Choose non-ephemeral loopback port:** reuse previous port on upgrade, or allocate from the dedicated local range **`17400..=17999`** (outside OS ephemeral bands `32768–65535`), skipping ports already in `desktop-state.json` and bind-probing `127.0.0.1:<candidate>` to confirm it is free (`PLUGIN_PORT_CONFLICT` if none free).
6. **Provision bearer token & `proofKey` into its own slot (if `auth.mode` is `"approver"` or `"agent"`):**
   - Check Windows 2,560-byte credential limit before writing (`PLUGIN_KEY_TOO_LONG`).
   - On fresh install (or if `auth.mode` changed, or no existing token in keychain): invoke `<binary> pair --role <auth.mode> --name "Loam Desktop (<short-id>)" --accept-consent`, validate `{ token, tokenId, role, proofKey }`, and store `token` under its unique per-token keychain slot **`<instance-id>.<tokenId>`** — so the previous token's slot (`<instance-id>.<oldTokenId>`) is NEVER overwritten before step 9 commits `desktop-state.json`! (On keyring-less Linux without `allowFileFallback`, fail closed with `PLUGIN_KEYCHAIN_UNAVAILABLE`.)
   - On upgrade with unchanged `auth.mode` and existing stored token + `proofKey`: keep the existing `<instance-id>.<tokenId>` credential untouched and verify it in step 8 (if `401`, pair once into a fresh `<instance-id>.<newTokenId>` slot).
7. **Start pending service:** write owner-only `launch.pending.json` (on Windows/XDG) and register/start the pending service (Windows spawns `loam-desktop.exe engine-run <plugin-id> --pending`; macOS/Linux load the new plist/unit pointing at `<bundleSha256>`).
8. **Pre-bearer proof & authenticated MCP health probe:** poll up to 10 s (250 ms intervals):
   - When authenticated: verify `GET http://127.0.0.1:<port>/health?nonce=<64-hex>` returns HTTP `200` with constant-time valid `X-Loam-Proof` (aborting with `PLUGIN_PORT_CONFLICT` and zero bearer sent if proof fails).
   - Send authenticated `POST http://127.0.0.1:<port>/mcp` (`Content-Type: application/json`, `Accept: application/json, text/event-stream`, `MCP-Protocol-Version: 2026-07-28`, `Authorization: Bearer <token>`) with JSON-RPC `initialize` / `server/discover`; require HTTP `200` and a JSON-RPC object containing `"result"` (no `"error"`).
9. **Atomic commit & publication (crash-safe commit point):**
   - Materialize `<app data>/site/`, `<app data>/mounts.json` (referencing `<instance-id>.<tokenId>` or owner-only bearer under Linux `allowFileFallback`), and `<app data>/models.json` with matching `generation` (section 9.2).
   - Atomically write `<app data>/desktop-state.json` as the **single durable commit point** (previous `launch.json` and `<instance-id>.<oldTokenId>` remain untouched until this atomic rename succeeds!).
   - After `desktop-state.json` commits: promote `launch.pending.json` → `launch.json`, switch Windows/XDG supervisor from `--pending` to normal mode (and write `HKCU\...\Run` / `.desktop` pointing at normal mode). (On any future startup after a crash before or after the commit point, `loam-desktop` reconciles `site/`, `mounts.json`, `models.json`, `launch.json`, and OS service registration directly from committed `desktop-state.json` and sweeps orphaned `.staging/*` and `launch.pending.json` files.)
   - Update in-memory `SiteState` and singleton `Mounts` config (`reloadRequired: true`). If `InboundState` was not yet started because no `mounts.json` existed at launch, start it now (requiring `main` reload so `startInbound` signals `ready: true`).
10. **Post-commit cleanup (upgrade only):** repoint any existing `pendingRevocations` entry for `pluginId` whose `binaryPath` points inside `<old-bundleSha256>/` to `newBinaryPath` (committing `desktop-state.json` first), then remove `<app data>/plugins/<plugin-id>/<old-bundleSha256>/`. If a new token replaced an old one (role change or `401` re-pair), delete the old keychain slot `<instance-id>.<oldTokenId>` and run `<binary> unpair --token-id <oldTokenId>` using the **active new** `<bundleSha256>` binary (recording `{ pluginId, tokenId: oldTokenId, binaryPath: newBinaryPath }` in `pendingRevocations` if `unpair` fails).
11. **Rollback on any failure in steps 3–9 (before `desktop-state.json` commits):** stop & unregister the pending service, delete `launch.pending.json`, best-effort `unpair` any newly minted `newTokenId` + delete its `<instance-id>.<newTokenId>` keychain slot, remove `<app data>/plugins/<plugin-id>/<bundleSha256>/`, and (if upgrading) re-register and restart the previous version's service from its untouched `launch.json` and untouched `<instance-id>.<oldTokenId>` credential (re-materializing `mounts.json`/`site/` from committed `desktop-state.json` if step 9 failed mid-write). Return `{ code, suggestion }`.

### 7.4 Uninstall, retryable revocation, and safe token rotation

- **Uninstall (`setup_plugin_uninstall`):** acquires `desktop-state.lock` after confirmation in `host-setup` explicitly stating that the plugin's own user data directory (e.g., Mail's synced store) is preserved:
  1. Close live handles for the plugin's mounted instance in singleton `Mounts` (`Mounts::close_instance`), then stop and unregister the OS login service and delete `launch.json`.
  2. If engine-backed and authenticated, run `<binary> unpair --token-id <tokenId>` (5 s timeout).
  3. Delete bearer token slot `<instance-id>.<tokenId>` from OS keychain.
  4. Remove plugin record from `desktop-state.json`; if `unpair` failed or timed out, append `{ pluginId, tokenId, binaryPath, failedAt }` to `desktop-state.json`'s `pendingRevocations` (and retain `<binaryPath>` until revoked, surfacing a **"Token revocation pending — Retry"** action in `host-setup` and retrying automatically on next `loam-desktop` startup).
  5. Re-materialize `site/` and `mounts.json`, commit `desktop-state.json`, update live `SiteState` and `Mounts` config (`reloadRequired: true`).
  6. Remove `<app data>/plugins/<plugin-id>/` only when no remaining `pendingRevocations` entry references any path inside it. When `setup_plugin_retry_revocation` (or startup auto-retry) later succeeds (`unpair` exits `0`), it removes that `pendingRevocations` entry, deletes the version directory `<app data>/plugins/<plugin-id>/<bundleSha256>/` holding `binaryPath` **only** when no installed plugin in `desktop-state.json` and no remaining `pendingRevocations` entry references that `binaryPath`, and deletes `<app data>/plugins/<plugin-id>/` **only** when no installed plugin has `pluginId` and no remaining `pendingRevocations` entry references any path inside `<app data>/plugins/<plugin-id>/`.
- **Token rotation (`setup_plugin_rotate_token`):** acquires `desktop-state.lock`:
  1. Run `<binary> pair --role <auth.mode> --name "Loam Desktop (<short-id>)" --accept-consent` to obtain `{ newToken, newTokenId, role, proofKey }` (where `proofKey` equals the engine's existing persistent instance identity key; mismatch refuses with `PLUGIN_PAIR_FAILED`).
  2. **Verify in memory BEFORE committing:** run section 5.2's pre-bearer `/health` proof with `proofKey` AND authenticated MCP probe with `newToken` (old `<instance-id>.<oldTokenId>` remains completely untouched if this fails; best-effort `unpair --token-id <newTokenId>` on failure).
  3. Write `newToken` to its fresh keychain slot `<instance-id>.<newTokenId>` (or owner-only `mounts.json` under Linux file fallback).
  4. Re-materialize `mounts.json` pointing to `<instance-id>.<newTokenId>`, atomically commit `tokenId: newTokenId` in `desktop-state.json`, and refresh the live bearer in singleton `Mounts` (`reloadRequired: false`).
  5. Delete old keychain slot `<instance-id>.<oldTokenId>` and run `<binary> unpair --token-id <oldTokenId>` (if `unpair` fails, record `{ pluginId, tokenId: oldTokenId, binaryPath: activeBinaryPath }` in `pendingRevocations` for retry — never deleting `activeBinaryPath` while the plugin remains installed).

---

## 8. No-Terminal Model Key Setup (Amending Section 4.2)

### 8.1 Adding, editing, verifying, and removing providers without TOML or a terminal

From `Loam → Copilot Models…` or `setup_open({ section: "models" })`, `host-setup` displays the Models tab:
- Lists all configured providers (`id`, `kind`, `model`, `endpoint?`, `default`, and `keyStatus: "configured" | "missing" | "file" | "not-required"` — never any secret value).
- **Add / Edit provider (`managed` mode):**
  - Kind selector: **Anthropic** (`anthropic`, fixed `https://api.anthropic.com/v1/messages`), **OpenAI** (`openai`, fixed `https://api.openai.com/v1/chat/completions`), or **Local / OpenAI-compatible** (`openai-compatible`, endpoint validated by `models::endpoint_allowed`: `https:` or loopback `http://127.0.0.1` / `http://[::1]` only — `http://localhost` is rejected, so the UI placeholder shows `http://127.0.0.1:11434/v1`).
  - Provider id (defaults to kind slug e.g. `claude`, `openai`, `local`, validated by `identifier`; max 16 providers matching 4.1, else `DEPLOYMENT_COPILOT_INVALID`), model id (validated by `model_id`), and masked API key input (`autocomplete="off"`, `spellcheck="false"`, optional for `openai-compatible`).
  - **Destination binding on edit:** when editing an existing provider:
    - If `kind` and `endpoint` are **unchanged** and `apiKey` is omitted, the existing stored key is preserved untouched.
    - If `kind` OR `endpoint` **changed** and `apiKey` is omitted, Rust **refuses** with `COPILOT_KEY_REBIND_REQUIRED` (never silently sending a stored Anthropic/OpenAI key to a different destination!). The user must either enter a new key or explicitly confirm `confirmRebindKey: true`, which reads and verifies the stored key against the new destination before saving.
    - Creating a new `anthropic` or `openai` provider requires `apiKey` (unless an entry for `loam-copilot`/`<id>` already exists in keychain and is verified).
- **Save & Verify (`setup_model_save`):** acquires `desktop-state.lock`:
  1. Validates every field in Rust (`identifier`, `model_id`, `endpoint_allowed`, `key_shaped`, ≤ 16 providers, Windows 2,560-byte `CredWriteW` cap → `COPILOT_KEY_TOO_LONG`).
  2. When `skipVerify` is false (both when `apiKey` is supplied AND for keyless local `openai-compatible` reachability checks): runs the zero-token check in Rust using `reqwest` (no redirect, no proxy, 15 s timeout, **discarding all response bodies unread** — `2xx`, `4xx`, and `5xx` — checking HTTP status alone):
     - `anthropic`: `GET https://api.anthropic.com/v1/models?limit=1` with `x-api-key` and `anthropic-version: 2023-06-01`
     - `openai`: `GET https://api.openai.com/v1/models` with `Authorization: Bearer <key>`
     - `openai-compatible`: `GET <endpoint without trailing '/'>/models` (matching `copilot-key.ts`) with `Authorization: Bearer <key>` (if key present)
     - On `401`/`403`: refuses with `MODEL_REFUSED` **without overwriting an existing working key in the keychain**.
     - On network failure: returns `MODEL_UNREACHABLE` and offers an explicit **"Save anyway (offline)"** action (`skipVerify: true`).
  3. Writes the key directly to the OS keychain via `src-tauri/src/keychain.rs` under `{ keychain: "<copilot-service>", account: "<id>" }`, then immediately zeroes/drops the key buffer in Rust. On Linux without a Secret Service daemon, fails closed with `COPILOT_KEYCHAIN_UNAVAILABLE` by default; under D166, explicit consent (`allowFileFallback: true`) stores the key in owner-only `<app data>/keys/<id>.key` (mode `0600` via `connection::create_owner_only`) referenced as `key: { file: "<abs path>" }` in `models.json` (and `setup_model_remove({ deleteKey: true })` deletes either the keychain entry or that `.key` file).
  4. In `managed` mode: materializes `models.json` and `site/deployment.json` (and refreshes `SiteState`'s in-memory `frame-src` policy for `EmbeddedAssets`, never writing `site/index.html` to disk — per section 9.2 and D168), commits `desktop-state.json`, and updates singleton `Models` config and `SiteState` in memory.
  5. If only the key of an already-configured provider changed (same destination and storage kind), `reloadRequired` is `false` (since `models.rs` resolves keys on every `model_send` call — the new key works on the next copilot turn). If a provider was added, removed, or changed model/endpoint/default, `reloadRequired` is `true` so `main` loads the updated `deployment.json` and CSP.

### 8.2 Coexistence with CLI-managed developer deployments

When `mode == "cli"` (the developer ran `loam deployment write` manually and no `desktop-state.json` exists):
- `host-setup` reads the existing `models.json` read-only and **still allows** setting, verifying, and deleting the OS keychain entry for any `{ keychain, account }` provider listed there (never overwriting the developer's `site/`, `mounts.json`, or `models.json`).
- In `cli` mode, `setup_model_save` accepts **only** `{ id, apiKey, skipVerify? }` (refusing `kind`/`endpoint`/`model` parameters with `DESKTOP_CLI_MANAGED`) and binds verification strictly to the `kind` and `endpoint` read from `models.json`.
- Adding/removing providers or installing plugins via `host-setup` returns `DESKTOP_CLI_MANAGED`.

### 8.3 Fresh-install desktop copilot empty state & updated suggestions

On a fresh managed desktop install with zero providers configured, `deployment.json` omits `copilot`. Today `endpoints/loam/packages/web/src/main.ts` leaves `copilot` unset on `LoamShell` when `read.copilot` is absent, so `loam-panel` shows only `"Output and logs will appear here."` and never mounts the copilot panel. Step 9d fixes this reachability gap cleanly:
- When `projection.host?.kind === 'desktop'` and `projection.copilot` is absent, `main.ts` / `chrome` renders a lightweight desktop empty-model notice inside `loam-panel` (loaded off first paint in the lazy `late` / `copilot` path so first-paint budgets do not regress) with a **"Configure model…"** button that calls `setup_open({ section: "models" })`.
- Update desktop error suggestions (`host === 'desktop'`) in both `endpoints/loam/packages/chrome/src/copilot/conversation.ts` (`NO_MODEL_NOTICE`) and `endpoints/loam/packages/kernel/src/copilot/commands.ts`:
  - `COPILOT_PROVIDER_MISSING` / `NO_MODEL_NOTICE`: *"Open Loam → Copilot Models… (or click Configure model…) to add a model provider."*
  - `COPILOT_KEY_MISSING`: *"Open Loam → Copilot Models… to set the API key for this provider."*
- Non-desktop hosts and CLI commands keep their existing suggestions.

---

## 9. Desktop Deployment Materialization Without Node.js (D168)

### 9.1 State file, mode detection, and crash recovery

`<app data>/desktop-state.json` (owner-only, written atomically via `connection::create_owner_only` + rename):
- **Mode detection on startup:**
  - If `<app data>/desktop-state.json` exists: `mode = "managed"` (refused as `DESKTOP_STATE_PERMISSIONS` if not owner-only, failing closed with no plugins/providers served). On startup, Rust reconciles `<app data>/site/`, `mounts.json`, `models.json`, `launch.json`, and OS service registrations against committed `desktop-state.json` whenever any generated artifact is missing, lags `desktop-state.json`'s generation, or `shell_build_id` changed on app upgrade, and sweeps orphaned `.staging/*` and `launch.pending.json` files before opening `main`.
  - If `<app data>/desktop-state.json` does NOT exist and `<app data>/site/index.html` does NOT exist (a fresh user install using the bundled empty shell; a managed `site/` holds no `index.html`, so one a crash left before its first commit counts too; made exact by step 9b1): `mode = "managed"`, initialized on first write in `host-setup` (or `loam-desktop plugin install`) with `workspace = { id: "personal", name: "Personal" }` and `inbound = true` (D137).
  - If `<app data>/desktop-state.json` does NOT exist and `<app data>/site/index.html` DOES exist (a developer ran `loam deployment write --host desktop`): `mode = "cli"` — `loam-desktop` serves `<app data>/site/`, `mounts.json`, and `models.json` untouched.

**The state file's shape (fixed by step 9b1, 2026-11-26):** `desktopStateVersion: 1`, `workspace: { id, name }` (`deployment.v4.json`'s workspace rules), `inbound: boolean`, optional `copilot: { default?, providers }` (1 to 16 providers, each exactly `models.json`'s record: `id`, `kind`, `model`, `endpoint?`, `key?` as `{ keychain, account }` or `{ file }`, under `models.rs`'s rules; `default`, when present, names one; a `file` key is D166's `<app data>/keys/<id>.key` and nothing else, so it is never inside a package the site copies or the site a commit replaces), `plugins: [{ id, bundleSha256, engine? }]` where `engine` is `{ port, tokenId?, proofKey? }` (`port` in `17400..=17999` and unique; `tokenId` and `proofKey` together or not at all), and `pendingRevocations: [{ pluginId, tokenId, binaryPath, failedAt }]` (`binaryPath` absolute). Closed at every depth (`#[serde(deny_unknown_fields)]`) and at most 1 MiB, which a commit checks before it writes anything. It holds no key, bearer or plugin text: a plugin's version, apps and mount policy are read from its installed `<app data>/plugins/<id>/<bundleSha256>/plugin-manifest.json`, the directory install named by the digest it computed (the materializer does not hash the bundle again). The materializer refuses (`DESKTOP_STATE_INVALID`) a state whose bundles do not match it: a plugin id its manifest does not say; a manifest outside `loam-plugin.v1.json`'s shape, a `null` or a command override's `effects`, `preview` or name included, since the policy is repeated into `deployment.json`; an `engine` record without an `[engine]`, or an `[engine]` without one; a `tokenId` present when `auth.mode` is `"none"`, or missing when it is not; a mounted app that is not `engine.mount_app`, not `transport = "http"`, or whose `mount.prefix` is not in its `plugin.domains`; a native or view app whose manifest id is not its instance; two instances with one domain, or an instance id the shell keeps (`shell`, `loam`, `p`, `afd`); or a link anywhere from `plugins/` to a package's files, or a package past a bundle's bounds. A number is read as JavaScript reads it and printed as it prints it. The rest of 4.4 (display text, the shell's own domains, digests) is inspect's (9c), on staged bytes.

### 9.2 Materialization algorithm (pure Rust, headless-capable, zero Node.js)

When `mode == "managed"` and state changes (or on startup recovery / `shell_build_id` upgrade):
1. Stage a fresh directory `<app data>/.site-staging/` (a fixed name under `desktop-state.lock`, so a crash's leftover, and `.site-backup/`, are swept by the next commit; made exact by step 9b1):
   - **Signed shell assets stay in the binary (D168 amended):** `site.rs` serves shell files (`index.html`, `404.html`, `assets/*`, `sandbox/*`) directly from **`tauri::generate_context!().assets()`** (compile-time signed `EmbeddedAssets`, never extracted to or read from `<app data>/site/`). `<app data>/site/` holds **only** `deployment.json` and installed plugin packages (`apps/<instance>/*`), so a disk write to `<app data>/site/` cannot tamper with shell HTML/JS/CSS or sandbox frames. Because `host-setup` assets live outside `frontendDist` (`include_bytes!`), they are never served on `loam://localhost` or present in `site/`. (`cli` dev mode continues reading the full deployer-written `<app data>/site/` under `site.rs`'s fixed desktop CSP ceiling.)
   - Copy each installed plugin's packed app packages from `<app data>/plugins/<plugin-id>/<bundleSha256>/<app.path>/` into `apps/<instance>/`.
   - Build `ProjectionV4` (`deployment.json`):
     - Top-level fields: `deployment_version: 4`, `workspace`, `sandbox_origin: site::sandbox_origin()`, `identity: { mode: "local" }`, `host: { kind: "desktop" }`, optional `copilot` (omitted when no providers are configured), `apps` (ordered deterministically by `(plugin.id, app.id)`), and `generation`.
     - For each bundled app: `instance`, `app` (from `app-manifest.json`'s `plugin.id`), `package: "apps/<instance>/"`, and `boot` computed with the exact same `bootRecordOf` rules as `deployment.ts`. For the mounted app (`engine.mount_app`), also `prefix` (from `app-manifest.json`'s `mount.prefix`, validated in `plugin.domains`), `transport: "http"`, `route: "mounts/<instance>/mcp"`, `audience: "person"`, `labels`, `approvals`, `views` (only when `engine.mount.views` is `true`, D169; added by #2894), `expose`, and `commands`.
     - Exact same `generationOf` (canonical JSON with lexicographically sorted object keys over `{ workspace, apps (without boot), host, copilot? }`, `sha256-` lowercase hex) as `endpoints/loam/packages/cli/src/deployment.ts`.
     - **Zero** ports, URLs, tokens, `proofKey`, keys, endpoints, or binary paths in `deployment.json` (D63).
   - Compute the shell's `frame-src` boolean in Rust (`has_frames = any app has kind == "view" || the mounted app has views == true || copilot.providers is non-empty`, the mounted term added by #2894 as `deployment write` has it): `site.rs` emits the Rust-constructed canonical desktop CSP HTTP header (toggling `frame-src` between `site::sandbox_origin()` and `'none'`, plus `frame-ancestors 'none'`) and rewrites the embedded `index.html` / `404.html` `<meta>` `frame-src` in memory when serving from `EmbeddedAssets` (never writing shell HTML to disk).
   - Write `.loam-shell-build` with the binary's build digest and `.loam-generation` with the projection generation.
2. Atomically swap staging into `<app data>/site/` (backup + rename on Windows/POSIX so a crash never leaves a half-written site).
3. Atomically write `<app data>/mounts.json` and `<app data>/models.json` via `connection::create_owner_only` + rename.
4. Atomically write `<app data>/desktop-state.json` last as the durable commit point.
5. **Update live host state safely (no orphaned handles or streams):**
   - `SiteState` updates behind `std::sync::RwLock<Arc<site::Site>>`.
   - `Mounts` and `Models` remain **process singletons** whose internal access/provider configuration maps live behind `RwLock` (never swapping `Arc<Mounts>` or `Arc<Models>` wholesale), so live `stdio` children, open mount handles, and in-flight model streams remain tracked by `model_cancel` and `on_page_load`.
6. **Safe reload with real dirty-tab protection (`setup_apply_reload`):**
   - `host-setup` offers **"Reload Loam now"** or **"Apply on next restart"**.
   - **"Reload Loam now"** calls `setup_apply_reload`, which invokes a fixed shell method `document.querySelector('loam-shell')?.requestReload()` in `main` (built in step 9d; Phase 4 R14 covers experiment unload only, not full-page reload). `requestReload()` inspects every open editor's dirty state via the editor controller / `editor-get`:
     - If all tabs are clean: reloads `main` via `reload_script()`.
     - If any tab has unsaved edits: focuses `main` and opens Loam's unsaved-changes confirmation dialog (**Save & Reload** / **Discard & Reload** / **Cancel**). Cancelling leaves the existing page and its compatible runtime configuration usable until the user reloads or restarts.

### 9.3 Cross-language projection parity

A shared golden test fixture (`endpoints/loam/packages/manifest/test/fixtures/desktop-projection-golden.json`) with a native app, a view app, an **authenticated** mounted engine, and a copilot provider is checked by **both** `@lushly-dev/loam-cli` (`deployment.test.ts`) and `loam-desktop` (`cargo test`), asserting:
- Byte-identical `deployment.json` (including `generation` and `boot` records), `models.json`, and rewritten CSP `frame-src`.
- Identical non-secret fields in `mounts.json` (`instance`, `url`, `inbound`), while explicitly asserting the distinct credential representations: `bearer` for CLI `deployment write` vs `bearer_keychain` + `proof_key` for managed `loam-desktop` materialization.

---

## 10. CLI Parity and Development Path (AFD Honesty Check)

The no-terminal GUI and CLI share the **exact same** validation and installation core — zero UI-only business logic. (This amends Phase 5 section 7.4's provisional `loam plugin install` name: packaging/validation lives in `@lushly-dev/loam-cli` for plugin authors, while installation/service/pairing lives in `loam-desktop` so it runs with zero Node.js.)

| Surface | Package | Subcommands | Role |
| --- | --- | --- | --- |
| Authoring & packaging CLI | `@lushly-dev/loam-cli` | `loam plugin check <dir\|bundle>`<br>`loam plugin pack <dir> --out <bundle>`<br>`loam copilot key set <provider>` (existing) | Validates `loam-plugin.toml`, packs app manifests, computes/verifies target binary SHA-256s, writes `plugin-manifest.json` / `.loam-plugin` zip. Used by plugin authors and `loam-plugins.yml` CI. |
| Desktop host CLI (before Tauri/single-instance starts, beside `loam-desktop mcp`) | `loam-desktop` (Rust) | `loam-desktop plugin install <bundle>`<br>`loam-desktop plugin uninstall <id>`<br>`loam-desktop plugin status`<br>`loam-desktop plugin rotate-token <id>`<br>`loam-desktop engine-run <id> [--pending] [--data-dir <dir>]` | Drives the exact same Rust inspect → terminal consent prompt → transactional commit / uninstall / rotation core without launching a window or display server. Enables automated integration testing and scripted developer workflows. |
| No-terminal desktop UI | `loam-desktop` (`host-setup` window) | `Loam → Plugins…`<br>`Loam → Copilot Models…`<br>Double-click `.loam-plugin`<br>`setup_open` from `main` | The everyday path for people — zero terminal commands required. |

---

## 11. Error Codes

Every `host-setup` error returns `{ code, suggestion }` in Loam's own fixed words and **never** includes a key, bearer token, `proofKey`, or untrusted plugin text. `main` IPC commands return bare codes mapped to Loam's suggestions in chrome/kernel.

| Code | Where | Retryable | Suggestion |
| --- | --- | --- | --- |
| `DESKTOP_HOST_SETUP_REFUSED` | `from_host_setup` | No | None: only Loam's trusted setup window may call setup commands |
| `DESKTOP_STATE_PERMISSIONS` | `desktop-state.json` / `launch.json` | No | Restrict `desktop-state.json` and plugin launch files to your user account |
| `DESKTOP_STATE_INVALID` | `desktop-state.json` or an installed bundle it names, at startup or materialization (added by step 9b1) | No | Reinstall the plugin from Loam → Plugins…; if this persists, Loam's data folder has been changed outside Loam |
| `DESKTOP_MATERIALIZE_FAILED` | Staging or swapping `<app data>/site/`, or writing `mounts.json`, `models.json` or `desktop-state.json` other than for the owner-only rule (added by step 9b1) | Yes | Check the space and permissions in Loam's data folder, then retry; the change is not committed, and the desktop starts from the last one that was |
| `DESKTOP_CLI_MANAGED` | `host-setup` mutations in `cli` mode | No | This desktop is managed by `loam deployment write`; update `loam.deployment.toml` or clear `<app data>/site` to use in-app plugin management |
| `PLUGIN_MANIFEST_MISSING` | `loam plugin check` / `pack` (added by step 9a), and an archive with no `plugin-manifest.json` (9a2) | No | Give the plugin's source, which holds `loam-plugin.toml`, or a bundle `loam plugin pack` wrote, which holds `plugin-manifest.json` |
| `PLUGIN_MANIFEST_INVALID` | Bundle inspect / `loam plugin check` | No | Fix the listed field in `loam-plugin.toml` and repack with `loam plugin pack` |
| `PLUGIN_PATH_ESCAPE` | Bundle inspect / `loam plugin check` | No | Remove symbolic links, duplicate or colliding paths, and paths outside the plugin root, then repack |
| `PLUGIN_BUNDLE_TOO_LARGE` | Bundle inspect / `loam plugin check` / `pack` | No | Keep the plugin bundle under 256 MiB and 2,000 files |
| `PLUGIN_PACK_FAILED` | `loam plugin pack` writing the bundle (added by step 9a) | Yes | Check the space and permissions where `--out` is, then pack again. A failure while writing or checking leaves an earlier bundle there unchanged; one while moving the bundle into place can leave `--out` empty |
| `PLUGIN_PACK_OUT_INVALID` | `loam plugin pack` (added by step 9a) | No | Pack into an empty directory of its own or a new `.loam-plugin` name, outside the source; a bundle or archive `loam plugin pack` wrote there, unchanged since, is replaced |
| `PLUGIN_TARGET_UNSUPPORTED` | Bundle inspect | No | This plugin does not include an engine binary for your operating system and architecture |
| `PLUGIN_HASH_MISMATCH` | Bundle inspect / confirm / `loam plugin check` / `pack` | No | The plugin bundle or engine binary does not match its SHA-256 digest; download the bundle again |
| `PLUGIN_ALREADY_INSTALLED` | Bundle inspect | No | This exact version of the plugin is already installed |
| `PLUGIN_CONFLICT` | Bundle inspect | No | Uninstall the conflicting plugin before installing this one |
| `PLUGIN_PROPOSAL_EXPIRED` | `setup_plugin_confirm` | Yes | Inspect the plugin bundle again to review and confirm |
| `PLUGIN_ENGINE_TEST_BUILD` | Post-consent `--version` check | No | This engine was built with `test-doubles`; install a release build instead |
| `PLUGIN_PAIR_FAILED` | `<artifact> pair` | Yes | Check the engine log and retry installation |
| `PLUGIN_KEY_TOO_LONG` | Windows `CredWriteW` 2,560-byte cap | No | Shorten or regenerate the plugin bearer token within Windows Credential Manager's 1,280-character limit |
| `PLUGIN_KEYCHAIN_UNAVAILABLE` | Keychain store (Linux without Secret Service) | No | Unlock or install a Secret Service keyring (`gnome-keyring` / `kwallet` + `secret-tool`), or explicitly choose the owner-only file fallback |
| `PLUGIN_PORT_CONFLICT` | Port allocation or pre-bearer `/health` proof mismatch | Yes | Another program is using the plugin's loopback port; retry to allocate a free port or restart the plugin service |
| `PLUGIN_SERVICE_FAILED` | OS login service registration / start / Windows 260-char Run cap | Yes | Check the plugin log, OS startup permissions, and install path length, then retry |
| `PLUGIN_HEALTH_TIMEOUT` | Post-start authenticated MCP probe | Yes | The engine did not answer with a valid MCP result on its loopback port within 10 s; check its log and retry |
| `PLUGIN_NOT_FOUND` | Uninstall / rotate / service action | No | Check the list of installed plugins |
| `MOUNT_KEYCHAIN_MISSING` | `mount_open` resolving `bearer_keychain` | No | Open Loam → Plugins… and rotate or re-pair this plugin's token |
| `COPILOT_KEY_TOO_LONG` | Windows `CredWriteW` 2,560-byte cap | No | Use an API key of at most 1,280 characters on Windows, or store it in an owner-only file |
| `COPILOT_KEY_REBIND_REQUIRED` | `setup_model_save` changing `kind`/`endpoint` without new key | No | Enter an API key for the new provider destination or confirm rebinding the stored key |

Existing codes (`COPILOT_PROVIDER_MISSING`, `COPILOT_KEY_MISSING`, `COPILOT_KEY_INVALID`, `COPILOT_KEYCHAIN_UNAVAILABLE`, `DEPLOYMENT_COPILOT_INVALID`, `MODEL_REFUSED`, `MODEL_UNREACHABLE`, `DESKTOP_ORIGIN_REFUSED`, `DESKTOP_MOUNTS_PERMISSIONS`, `DESKTOP_MOUNTS_INVALID`, `DESKTOP_MODELS_PERMISSIONS`, `DEPLOYMENT_PREVIEW_REQUIRED`, `DEPLOYMENT_PREVIEW_INVALID`) keep their meanings (with desktop suggestions updated per section 8.3).

---

## 12. Security Threat Model (Extending Section 15)

| # | An attacker tries | Through | What stops it | Test |
| --- | --- | --- | --- | --- |
| T21 | To install a plugin, read a key, or call `setup_*` mutations from the shell webview, a native app, a view, or the copilot | Tauri `invoke` or fallback transport from `main`, `loam-sandbox`, view frame, or copilot frame | `capabilities/main.json` grants only the 6 existing commands + `setup_open` (no setup mutation); `capabilities/host-setup.json` scopes setup commands strictly to `webviews: ["host-setup"]`; every `setup_*` checks `from_host_setup` (label + `host_setup_origin()`); `loam-host` serves only `include_bytes!` assets with `frame-src 'none'` and nonpersistent/ephemeral storage; `setup_open` takes only `"models" \| "plugins"`, performs no mutation, and never interrupts an active `PendingInstall` | P5-S9-1, `origin.rs`, `acl.rs` |
| T22 | To smuggle an arbitrary file, swap an app/manifest/binary after inspect, or exploit zip/path differentials (TOCTOU / zip-slip / symlink / `.bat` cmd dispatch) | Crafted `.loam-plugin` archive, symlinked folder, duplicate/case-colliding entries, Windows `.bat`, or concurrent edit after inspect | `host-setup` JS never sends a filesystem path (native `rfd` picker in Rust); Rust stages regular files first (refusing symlinks, duplicates, case collisions, path escapes), validates **only staged bytes**, restricts Windows engines strictly to `.exe`, computes whole-bundle `bundleSha256` + `engineSha256` over staged bytes, and moves staging atomically into `<bundleSha256>/` on confirm | P5-S9-2 |
| T23 | To execute plugin code before consent | Inspecting a malicious bundle | Phase 1 Inspect is pure staging + parsing + hashing with zero process spawning and zero JS loading; `--version`, `pair`, and `serve` run only after `setup_plugin_confirm` matches the single-use `proposalId` and `expectedBundleSha256` | P5-S9-2 |
| T24 | To inject arbitrary command lines, flags, environment variables, or transport URLs, or steal a bearer via multi-user loopback port squatting | `loam-plugin.toml`, `host-setup` IPC, or another OS user listening on `127.0.0.1:<port>` | Schema forbids `command`, `args`, `env`, `cwd`, `url`, `endpoint`, `port`, `bearer`, `token`; Rust hardcodes argv arrays via `Command::new` (never a shell) with a clean allow-listed env (`env -i` on systemd); URL is always `http://127.0.0.1:<port>/mcp` in non-ephemeral `17400..=17999`; Loam verifies unauthenticated `/health` `HMAC-SHA256(proofKey, nonce)` before transmitting any bearer on install AND restart | P5-S9-2, P5-S9-3, P5-S9-4 |
| T25 | To steal a model API key or approver token (including via destination edit, leftover unrevoked tokens, or provider responses) | `main` webview, `deployment.json`, `desktop-state.json`, `models.json`, logs, edited `endpoint`, failed uninstall, or `/models` bodies | Model keys enter only nonpersistent/ephemeral `host-setup`, go straight to OS keychain via Rust, all `/models` response bodies are discarded unread, and changing `kind`/`endpoint` refuses silent key reuse (`COPILOT_KEY_REBIND_REQUIRED`); approver tokens travel only over an anonymous stdout pipe into Rust and straight to per-token OS keychain slots (`<instance-id>.<tokenId>` via `bearer_keychain` in `mounts.json`), verified in memory with the persistent `proofKey` before writing/committing on rotation, with retryable `pendingRevocations` on uninstall failure; neither ever enters `main`, `deployment.json`, `desktop-state.json`, store, journal, or logs | P5-S9-3, P5-S9-5 |
| T26 | To install a `test-doubles` / debug engine on a person's desktop | Repackaged debug binary | Post-consent `<binary> --version` check refuses `test-doubles` (`PLUGIN_ENGINE_TEST_BUILD`) before `pair` or service registration; test override is compiled out of release builds | P5-S9-2 |
| T27 | To spoof consent UI or obtain an approver silently without disclosure | Control/bidi chars, `"Loam"` title spoofing, or `auth.mode = "approver"` with `approvals = "none"` | AFD display rules + `saysShellName` refuse bad chars and `"Loam"` titles during Inspect; `auth.mode == "approver"` bi-implicates `approvals == "shell"`; `host-setup` renders every field as text nodes with Loam's own fixed warning prose, the `views` notice (7.2) among them, so no engine's `ui://` views become openable without it | P5-S9-2 |
| T28 | To lose unsaved editor work on reload after install or model setup | Forced `location.reload()` of `main` | `host-setup` never force-reloads `main`; `setup_apply_reload` calls `main`'s `requestReload()` dirty-tab check, prompting Save/Discard/Cancel when any editor tab is unsaved and keeping the existing page usable on Cancel | P5-S9-6 |

**Unchanged honest limits (T14, T15, Mail F8):** A program already running as the person's OS user can still run `<artifact> pair`, read the person's keychain, or overwrite `<app data>/plugins/<id>/<bundleSha256>/` in place. Code signing and OS notarization remain gated on owner release decisions (D112, W9/W29).

---

## 13. Exit Tests and Implementation Plan

### 13.1 Exit tests for step 9

| Row | Test | Where | Passes when |
| --- | --- | --- | --- |
| P5-S9-1 | **Cross-window isolation, capability pin, & ephemeral storage** | Rust (`origin.rs`, `acl.rs`), desktop suite (WebView2, WebKitGTK, macOS WKWebView) | Positive controls + negative assertions tested separately at Tauri ACL and Rust handler layers: `main` allows the 6 existing commands + `setup_open` (strict enum only) and refuses every other `setup_*`; `host-setup` allows its `setup_*` set (excluding `setup_open`) and refuses every `main` command; `loam-sandbox`, view frames, and copilot frame cause zero privileged command executions (D153 observable counter, including fallback transport); `acl.rs` exemptions stay exclusively `plugin:__TAURI_CHANNEL__|fetch`; `host-setup` CSP has `frame-src 'none'` and `font-src 'self'`, serves no file from `<app data>/site/`; `setup_open` never interrupts an active `PendingInstall`; a storage marker written in `host-setup` disappears across close/reopen on macOS (`.incognito(true)`), Windows, and Linux while `main`'s storage marker persists |
| P5-S9-2 | **Bundle validation, whole-bundle hash pinning, & no pre-consent execution** | `@lushly-dev/loam-manifest`, `@lushly-dev/loam-cli`, Rust units | `loam-plugin.v1.json` refuses unknown/command-line/transport-URL/token keys, bad display chars, `"Loam"` titles, reserved ids (`shell`/`loam`/`p`), `native`/`view` id mismatch, self-preview, non-`mount.prefix` commands, and `auth.mode = "approver"` with `approvals = "none"`, and a non-boolean `engine.mount.views`; the proposal carries `views` for consent (previous → new on an upgrade); refuses Windows `.bat`/`.cmd` artifacts, zip duplicates, case-insensitive collisions, non-regular files, symlinks, `..`, zip-bombs (>256 MiB / >2,000 files), target mismatch, and SHA-256 mismatch; a sentinel binary is **never** executed during Inspect; modifying source apps/manifests/binary after Inspect does not alter the staged bundle installed on Confirm; an app-only upgrade with an unchanged engine binary gets a new `<bundleSha256>` dir and requires fresh consent; a `test-doubles` `--version` binary is refused with `PLUGIN_ENGINE_TEST_BUILD` and rolled back |
| P5-S9-3 | **No-terminal pairing, pre-bearer proof, keychain, rotation, revocation, & crash rollback** | Rust units + desktop integration against a fixture `http-service` engine | `pair` delivers `{ token, tokenId, role, proofKey }` over stdout pipe with `stdin: null` and zero temp file; a port squatter failing `/health` `HMAC-SHA256(proofKey, nonce)` receives **zero** bearer token on install AND restart (`PLUGIN_PORT_CONFLICT` / `MOUNT_UNREACHABLE`); valid probe checks Streamable HTTP headers + JSON-RPC `"result"`; token lives in per-token keychain slot (`<instance-id>.<tokenId>` via `bearer_keychain` in `mounts.json`) and never appears in `deployment.json`, `desktop-state.json`, `main` DOM, store, journal, or stderr; `setup_plugin_rotate_token` uses a unique `--name`, verifies new token and persistent `proofKey` in memory before writing `<instance-id>.<newTokenId>` and committing `tokenId`, updates live `Mounts` (`reloadRequired: false`), deletes `<instance-id>.<oldTokenId>`, and revokes old `tokenId`; failed/timed-out `unpair` retains retryable `pendingRevocations` (and never deletes an active installed plugin's binary or parent directory); rollback + crash-restart between each durable write (including role change and Linux file fallback) restores the previous working deployment; Windows 2,560-byte `CredWriteW` cap returns `PLUGIN_KEY_TOO_LONG` |
| P5-S9-4 | **OS login auto-start, upgrade, uninstall, & multi-profile isolation** | Rust units (all 3 OS serializers) + live desktop integration on Windows, Linux, and macOS | Generated launchd plist, Windows `HKCU\...\Run` (`\\?\`-free, 260-char checked) + `engine-run` (`launch.pending.json` → `launch.json`, Job Object), and systemd user unit (`/usr/bin/env -i`, `StandardError=journal`) + XDG `engine-run` (`$XDG_CONFIG_HOME`) match exact schemas; ports allocate from `17400..=17999`; fresh Windows profile and upgrade succeed through real `engine-run`; XDG uninstall cleanly stops the engine after a second login with Loam closed; upgrade closes live `Mounts` handles, stops old service, keeps plugin data dir, removes old `<bundleSha256>` dir only after new version passes proof + MCP probe; installing/uninstalling under a second `LOAM_DESKTOP_DATA_DIR` profile never touches the default profile's services or keychain entries |
| P5-S9-5 | **No-terminal model key setup & destination binding** | Rust units + desktop suite | Adding Anthropic, OpenAI, and keyless/keyed local `openai-compatible` providers via `setup_model_save` validates fields (≤ 16 providers, Windows 2,560-byte cap), verifies via mocked `/models` (discarding **all** `2xx`/`4xx`/`5xx` bodies unread, stripping trailing `/`), refuses `401` without overwriting existing key, refuses changing `kind`/`endpoint` without new key or explicit `confirmRebindKey` (`COPILOT_KEY_REBIND_REQUIRED`), stores key via `keychain.rs` (or opt-in mode `0600` file on keyring-less Linux), materializes `models.json` + `deployment.json` + `frame-src`, and enables a copilot turn in `main` from the fresh-install empty-model `"Configure model…"` button without any terminal command; `cli`-managed mode rejects destination overrides and binds verification to `models.json` |
| P5-S9-6 | **Headless materialization, golden parity, signed `EmbeddedAssets` shell, singleton live state, & dirty-tab reload** | `@lushly-dev/loam-cli` + Rust `cargo test` + desktop suite | Rust materializer (headless) and `loam deployment write` produce byte-identical `deployment.json` (`generation`, `boot`), `models.json`, and canonical desktop CSP `frame-src` on the shared golden fixture with an authenticated mount, while asserting `bearer` (CLI) vs `bearer_keychain` + `proof_key` (managed desktop) separately; in `managed` mode, `index.html`, `404.html`, `assets/*`, and `sandbox/*` are served strictly from `EmbeddedAssets` (an `index.html` or `assets/*` file planted in `<app data>/site/` is ignored, while `deployment.json` and `apps/*` are served from disk); `shell_build_id` change reconciles `site/` on app upgrade; singleton `Mounts` and `Models` keep live handles and cancelable in-flight streams across config updates; `setup_apply_reload` with an unsaved editor tab prompts Save/Discard/Cancel in `main` and leaves the old page usable on Cancel; `host-setup` passes axe in light, dark, and high contrast and displays the D54 "runs with full shell trust — not sandboxed" disclosure on every `native` app install |
| P5-S9-7 | **End-to-end Mail, Trillium-shaped, & pure-app smoke** | Desktop suite (fixture `http-service` & pure-app plugins + real `loam-mail` once step 7 HTTP `2026-07-28` and Mail's `pair`/`unpair`/`/health` PR land) | Installing, upgrading, and uninstalling a Mail-shaped bundle (`approvals = "shell"`, `auth.mode = "approver"`, `labels = "per-part"`, native + mounted), a Trillium-shaped bundle (`approvals = "none"`, `auth.mode = "agent"`, view + mounted), and a pure-app bundle (no `[engine]`, native/view only) side-by-side with zero terminal commands works cleanly with zero Loam core changes |

### 13.2 New dependencies (exact-pinned, past `minimumReleaseAge`)

Only in `endpoints/loam/packages/desktop/src-tauri/Cargo.toml` (all zero-JS, Rust-only):
- `sha2` and `hmac` (exact-pinned): streaming SHA-256 hashing (`bundleSha256`, `engineSha256`, `generation`) and constant-time `HMAC-SHA256` for pre-bearer `/health` proof verification.
- `zip` (exact-pinned, `default-features = false, features = ["deflate"]`): reading `.loam-plugin` zip archives with entry bounds, duplicate checks, and symlink checks.
- `rfd` (exact-pinned): native OS file/folder picker (`NSOpenPanel` / `IFileOpenDialog` / XDG Desktop Portal) called from Rust only, with no Tauri JS dialog plugin or permission.
- `windows-sys` (already `=0.61.2`): add `Win32_System_Registry` and `Win32_System_JobObjects` features (verified present in `0.61.2`; `Win32_System_Threading` and `Win32_Security_Credentials` are already enabled).
- `security-framework = "=3.7.0"`, `apple-native-keyring-store = "=1.0.2"` (`features = ["keychain"]`), and `keyring-core = "=1.0.1"` (already added under `[target.'cfg(target_os = "macos")'.dependencies]` for `keychain.rs` and shared with `loam-mail`): macOS `Security.framework` keychain read/write/delete in `keychain.rs`.

### 13.3 Implementation breakdown for step 9

Step 9 splits cleanly into five reviewable PRs after Milestone A's step 8 (and step 7's HTTP MCP `2026-07-28` framing):
- **9a — Schema, packaging CLI, and golden fixture:** `loam-plugin.v1.json`, `readPluginManifest`, `loam plugin check` and `loam plugin pack` in `@lushly-dev/loam-cli`, and the shared golden projection fixture (including authenticated mount).
- **9a2 — `.loam-plugin` archives (split from 9a on 2026-11-26):** `loam plugin pack --out <name>.loam-plugin` writes the zip, and `loam plugin check` reads one under section 4.4's archive rules (no symbolic links, duplicate or case-colliding entries, the streamed 256 MiB cap), which 9a2 made exact in rule 3 with a case for each in `loam-plugin-cases.json`'s `archives`. 9a packs and checks a directory bundle only, which the desktop's folder install (9c) reads as it is; 9c reads an archive by the same cases.
- **9b — Rust keychain, headless deployment materializer, and `mounts.rs` `bearer_keychain` + `proof_key`:** `keychain.rs` (`CredReadW`/`CredWriteW`/`CredDeleteW` + 2,560-byte check on Windows, `apple-native-keyring-store` + `keyring-core` via Security.framework on macOS, `secret-tool` on Linux), `desktop_state.rs` (with `desktop-state.lock` & crash recovery) + `materialize.rs` (signed shell served from `EmbeddedAssets`, disk `<app data>/site/` holding only `deployment.json` and `apps/*`, golden parity, `shell_build_id` reconciliation), singleton `Mounts`/`Models` config `RwLock`, `mounts.rs` `bearer_keychain` + pre-bearer `/health` proof check. (Closes step 2's follow-up on macOS/Linux keychain verification.)
- **9b's three parts (split 2026-11-26):** **9b1**, the materializer's core: `desktop_state.rs` (the state's shape, its owner-only read and 9.1's mode detection), `materialize.rs` (`deployment.json`, `models.json`, `mounts.json` with `bearer_keychain` and `proof_key`, and `frame-src`, byte for byte as `loam deployment write` on the golden fixture; the staged write with `desktop-state.json` last) and `js_json.rs` (`JSON.stringify`'s bytes and `canonicalJson`'s order, which `serde_json` does not keep); **9b2**, `keychain.rs` `write` and `delete` with profile-scoped services, and `mounts.rs` resolving `bearer_keychain` behind the pre-bearer proof; **9b3**, managed mode wired into startup: `desktop-state.lock`, crash recovery and `shell_build_id` reconciliation, the signed shell from `EmbeddedAssets` with `frame-src` rewritten in memory, and the singleton `RwLock` configs.
- **9c — Engine service lifecycle & pairing core:** `plugins.rs` (staged-only inspect, `bundleSha256` + `engineSha256`, pure-app branch, `--version` guard, non-ephemeral `17400..=17999` ports, pipe `pair`/`unpair` with unique names, persistent instance `proofKey`, per-token `<instance-id>.<tokenId>` keychain slots, safe `pendingRevocations`, & full rollback), `service.rs` (launchd / Windows `HKCU` + `engine-run` `launch.pending.json` Job Object / systemd `env -i` + `journal` / XDG `engine-run`, profile-scoped names), and `loam-desktop plugin` CLI parity; inspect reads `engine.mount.views` into `PluginInstallProposalV1`'s engine summary, and `loam-desktop plugin` prints 7.2's notice when it is `true` (#2894); an upgrade's previous mount policy is not yet in the proposal (a follow-up for 9d). **Trust review.**
- **9d — `host-setup` window, `loam-host` protocol, `main` empty-model CTA & reload guard, and Models/Plugins UI:** `capabilities/host-setup.json`, `capabilities/main.json` (`allow-setup-open`), `tauri.conf.json` (`capabilities`, `fileAssociations`), `from_host_setup`, `include_bytes!` `host-setup` UI (Refined tokens + `font-src 'self'`, `.incognito(true)`, axe-checked, explicit D54 full-shell-trust disclosure for every `native` app, and 7.2's `views` notice, previous → new on an upgrade), native menu items, sanitized OS `.loam-plugin` open handler, `setup_*` commands, `main`'s desktop empty-model CTA + `NO_MODEL_NOTICE` + `requestReload()` dirty-tab guard, and `P5-S9-1` to `P5-S9-7`. **Trust review (cross-window isolation, secret hygiene, consent).**
- **Plugin follow-up (in Mail's folder, separate PR):** add `loam-mail pair` / `unpair` / `/health` proof and `loam-plugin.toml` to `endpoints/loam/plugins/mail/`, and add the same contract to Trillium's engine spec when it starts.

---

## 14. Decisions (Approved 2026-11-22)

Approved by the owner on 2026-11-22 and recorded in [decisions.md](../../decisions.md):

| ID | Decision | Amends |
| --- | --- | --- |
| D165 | Desktop no-terminal setup (plugins, pairing, model keys) runs in a dedicated Rust-owned `host-setup` Tauri window on a `loam-host` custom protocol serving compiled-in static assets only (`include_bytes!`), with nonpersistent/ephemeral storage, its own capability file (`capabilities/host-setup.json`), `from_host_setup` origin+label gate, and native OS file pickers in Rust. `main`'s webview never sees model keys, bearer tokens, or setup mutations; `main` gains one minimal, debounced `setup_open({ section: "models" \| "plugins" })` command (Q1(a), Q2(a)) | Amends D106, D143, Phase 6 10.2 & 10.6 |
| D166 | Engine-backed plugins ship a `loam-plugin.toml` / `plugin-manifest.json` (`loam-plugin.v1.json`) naming packed apps, target-keyed binary artifacts with SHA-256 hashes, `auth.mode` (`approver` \| `agent` \| `none`), and declarative mount policies — never command lines, transport URLs, ports, or tokens. Engines implement three fixed non-shell Rust invocations (`--version`, `serve --port <port>`, and pipe-based `pair` / `unpair`) plus pre-bearer `/health` proof verification. Model keys and paired mount bearers live in the OS keychain (`loam-copilot`, `loam-plugin-mount` via `bearer_keychain` in `mounts.json`); keyring-less Linux fails closed by default with explicit consent opt-in for owner-only `0600` files (Q4(a)) | Fulfils D148 / Q2; amends Phase 1 sec 2, D56, D63, D108 |
| D167 | Login auto-start registers per-user with no elevation: `launchd` LaunchAgent on macOS, `HKCU\...\Run` invoking windowless `loam-desktop.exe engine-run <plugin-id>` (Job Object + `CREATE_NO_WINDOW`) on Windows (Q3(a)), and `systemd --user` (`/usr/bin/env -i`, `StandardError=journal`) with XDG Autostart (`engine-run`) fallback on Linux | Fulfils D148 / Q2 |
| D168 | `loam-desktop` materializes `<app data>/site/`, `mounts.json`, and `models.json` in pure Rust from owner-only `<app data>/desktop-state.json` with zero Node.js dependency (verified by a cross-language golden fixture against `@lushly-dev/loam-cli`), while preserving `cli`-managed developer deployments untouched. **Amended 2026-11-25:** `managed` mode serves signed shell files (`index.html`, `404.html`, `assets/*`, `sandbox/*`) from `EmbeddedAssets` and reads only `deployment.json` and plugin `apps/*` from `<app data>/site/`, while `site.rs` enforces a fixed desktop CSP ceiling in both modes | Amends Phase 6 10.3 |

---

## 15. Questions for the Owner (Answered 2026-11-22)

**All four questions were answered by the owner on 2026-11-22 as recommended** (recorded as D165–D168 in [decisions.md](../../decisions.md)): Q1(a), Q2(a), Q3(a), and Q4(a). Kept below for provenance.

### Q1. Trusted UI boundary: isolated `host-setup` window vs OS-native Rust dialogs?

Where should the person review plugin consent (SHA-256, released commands, previews) and type/paste a copilot model API key without a terminal?

- **(a) Dedicated isolated `host-setup` Tauri window on `loam-host` protocol + native OS file picker in Rust (approved as D165).**
  - Separate window (`label = "host-setup"`), separate capability file (`capabilities/host-setup.json`), compiled-in static assets only (never `<app data>/site/`), zero apps/kernel/copilot/sandbox, `frame-src 'none'`, nonpersistent/ephemeral webview storage, and Rust-side `rfd` file picker so JS never names a filesystem path. Styled with Loam's Refined tokens and axe-tested in light/dark/high-contrast.
  - Tradeoff: the typed API key briefly passes through `host-setup`'s isolated first-party JS across Tauri IPC to Rust (it still never enters `main`, any app, the runtime frame, the store, the journal, or any log).
- **(b) Pure OS-native Rust dialogs (zero HTML/JS webview for setup or keys).**
  - No JS engine ever touches the typed API key.
  - Tradeoff: requires either a heavy cross-platform Rust GUI toolkit or three separate native UIs (AppKit, Win32/WinUI, GTK4) at roughly 3–4× step 9d's scope.

### Q2. Opening setup from `main`: menu + OS file open only, or also a minimal `setup_open` IPC command?

When the copilot panel shows "No model configured" or Settings shows "Plugins", may a button inside `main` open the separate `host-setup` window?

- **(a) Menu bar (`Loam → Plugins…`, `Loam → Copilot Models…`) + OS file open AND one minimal `setup_open({ section: "models" | "plugins" })` IPC command on `main` (approved as D165).**
  - Gives one-click onboarding from the empty copilot panel while `main` still cannot pass any path, URL, plugin id, provider id, or key; guarded by `from_shell` and debounced.
- **(b) Menu bar + OS file open ONLY (zero new IPC commands on `main`).**
  - `capabilities/main.json` stays at 6 commands, with higher first-run friction.

### Q3. Windows login auto-start: `HKCU\...\Run` + `loam-desktop engine-run` supervisor vs Task Scheduler?

How should a plugin engine start at Windows sign-in without requiring Administrator privileges or flashing a console window?

- **(a) `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` invoking `loam-desktop.exe engine-run <plugin-id>` (approved as D167).**
  - Works for standard non-admin users with zero UAC, zero console window flash (`windows_subsystem = "windows"` + `CREATE_NO_WINDOW`), clean child-tree termination via Windows Job Object, crash-restart backoff, and native visibility in Windows Settings → Startup Apps.
- **(b) Windows Task Scheduler per-user logon task (`ITaskService` / `schtasks`).**
  - `ONLOGON` triggers can require elevation under some Windows policies, and console Rust engines still need a hidden wrapper or Windows-subsystem build.

### Q4. Key and pairing-token storage on Linux without a Secret Service keyring: opt-in owner-only file fallback vs strict keychain-only?

On macOS, Windows, and desktop Linux with `gnome-keyring`/`kwallet`, model API keys and paired plugin tokens live in the OS keychain (`loam-copilot` and `loam-plugin-mount`). What happens on a minimal Linux desktop without a Secret Service daemon?

- **(a) Fail closed by default (`PLUGIN_KEYCHAIN_UNAVAILABLE` / `COPILOT_KEYCHAIN_UNAVAILABLE`), with an explicit consent option in `host-setup` to store the bearer in owner-only `mounts.json` (mode `0600`) or the model key in owner-only `<app data>/keys/<id>.key` (mode `0600`) (approved as D166).**
  - Matches 4.2's existing fallback (`key = { file = … }`) for model keys on headless/minimal Linux, while keeping keychain-only by default everywhere a keyring exists.
- **(b) Strict keychain-only (refuse plugin install and model key save if Secret Service is unavailable).**
  - Blocks no-terminal plugin installs and model key setup on minimal Linux WMs without a Secret Service daemon.

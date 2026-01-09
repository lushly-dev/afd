# Part 2: Mint - Distribution Framework

> **Goal**: Create a new repository that combines AFD (commands), Violet (theming), and automated multi-platform distribution into a cohesive framework for building and shipping AI/MCP/API-enabled apps.

## Vision

Mint is the "create-react-app" for AFD applications. It provides:

1. **Project Scaffolding** - `mint new my-app` creates a ready-to-ship project
2. **Language Choice** - TypeScript, Python, or Rust backend
3. **Violet Integration** - Design tokens and themed UI out of the box
4. **Multi-Platform Build** - Single command builds all distribution targets
5. **Automated Releases** - GitHub Actions for cross-platform releases

```
┌────────────────────────────────────────────────────────────────────┐
│                          Your App Idea                              │
└─────────────────────────────────┬──────────────────────────────────┘
                                  │
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│                        mint new my-app                             │
├────────────────────────────────────────────────────────────────────┤
│  Language: [TypeScript] [Python] [Rust]                            │
│  Features: [✓] MCP Server  [✓] REST API  [✓] Web UI                │
│  Theme:    [✓] Violet Dark  [ ] Violet Light  [ ] Custom           │
└─────────────────────────────────┬──────────────────────────────────┘
                                  │
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│                      Generated Project                              │
├────────────────────────────────────────────────────────────────────┤
│  my-app/                                                           │
│  ├── commands/           # Your AFD commands                       │
│  ├── ui/                 # Violet-themed web UI                    │
│  ├── dist/               # Distribution configs                    │
│  │   ├── cargo-dist.toml # Rust releases                          │
│  │   ├── goreleaser.yaml # Go releases (if applicable)            │
│  │   └── docker/         # Container configs                       │
│  └── .github/workflows/  # CI/CD pipelines                        │
└─────────────────────────────────┬──────────────────────────────────┘
                                  │
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│                        mint build --all                            │
├────────────────────────────────────────────────────────────────────┤
│  Outputs:                                                          │
│  ├── Native binaries (Windows, Mac, Linux)                         │
│  ├── Docker image (multi-arch)                                     │
│  ├── Cloudflare Worker (WASM) - Rust only                         │
│  ├── npm package (wrapped binary)                                  │
│  └── Homebrew formula                                              │
└─────────────────────────────────┬──────────────────────────────────┘
                                  │
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│                        mint release v1.0.0                         │
├────────────────────────────────────────────────────────────────────┤
│  Publishes to:                                                     │
│  ├── GitHub Releases (with all binaries)                           │
│  ├── Homebrew tap                                                  │
│  ├── npm registry                                                  │
│  ├── Docker Hub / GHCR                                             │
│  └── Cloudflare Workers (Rust only)                               │
└────────────────────────────────────────────────────────────────────┘
```

## Repository Structure

```
mint/                         # New repo: github.com/Falkicon/mint
├── packages/
│   ├── cli/                       # mint CLI tool
│   │   ├── src/
│   │   │   ├── main.rs           # CLI entry point (Rust for portability)
│   │   │   ├── commands/
│   │   │   │   ├── new.rs        # mint new
│   │   │   │   ├── build.rs      # mint build
│   │   │   │   ├── dev.rs        # mint dev
│   │   │   │   ├── release.rs    # mint release
│   │   │   │   └── doctor.rs     # mint doctor
│   │   │   └── templates/        # Embedded templates
│   │   └── Cargo.toml
│   │
│   └── templates/                 # Project templates
│       ├── rust/
│       │   ├── Cargo.toml.tmpl
│       │   ├── src/
│       │   │   ├── main.rs.tmpl
│       │   │   └── commands/
│       │   │       └── mod.rs.tmpl
│       │   ├── ui/               # Violet-themed web UI
│       │   │   ├── index.html
│       │   │   ├── app.js
│       │   │   └── tokens.css    # Generated from Violet
│       │   └── dist/
│       │       ├── cargo-dist.toml.tmpl
│       │       ├── Dockerfile.tmpl
│       │       └── wrangler.toml.tmpl  # Cloudflare Worker
│       │
│       ├── typescript/
│       │   ├── package.json.tmpl
│       │   ├── src/
│       │   │   ├── server.ts.tmpl
│       │   │   └── commands/
│       │   │       └── index.ts.tmpl
│       │   ├── ui/
│       │   └── dist/
│       │
│       └── python/
│           ├── pyproject.toml.tmpl
│           ├── src/
│           │   └── server.py.tmpl
│           ├── ui/
│           └── dist/
│
├── integrations/
│   ├── violet/                    # Violet design token integration
│   │   ├── themes/               # Pre-built themes
│   │   │   ├── dark.json
│   │   │   ├── light.json
│   │   │   └── custom.json.tmpl
│   │   └── export.rs             # Token → CSS/SCSS export
│   │
│   └── distribution/              # Distribution engine
│       ├── cargo-dist.rs         # Rust releases
│       ├── goreleaser.rs         # Go releases (future)
│       ├── docker.rs             # Docker builds
│       ├── cloudflare.rs         # Worker deployment
│       └── npm.rs                # npm packaging
│
├── examples/
│   ├── hello-world/              # Minimal example
│   ├── todo-app/                 # AFD Todo (all 3 languages)
│   └── design-tokens/            # Violet-powered example
│
├── docs/
│   ├── getting-started.md
│   ├── templates.md
│   ├── distribution.md
│   └── violet-integration.md
│
├── Cargo.toml                    # Workspace root
├── README.md
└── AGENTS.md
```

## CLI Commands

### `mint new <name>`

Create a new AFD project.

```bash
# Interactive mode
mint new my-app

# With options
mint new my-app --language rust --features mcp,api,ui --theme violet-dark

# From existing commands (import from another AFD app)
mint new my-app --from ../existing-app/commands
```

**Generated structure:**
```
my-app/
├── src/
│   ├── main.rs              # Entry point
│   ├── commands/
│   │   ├── mod.rs
│   │   └── hello.rs         # Example command
│   └── server.rs            # MCP + API server
├── ui/
│   ├── index.html
│   ├── app.js
│   └── tokens.css           # Violet tokens
├── dist/
│   ├── cargo-dist.toml
│   ├── Dockerfile
│   └── wrangler.toml
├── .github/
│   └── workflows/
│       └── release.yml
├── Cargo.toml
├── mint.toml               # Mint configuration
└── README.md
```

### `mint dev`

Start development server with hot reload.

```bash
mint dev                    # Start all surfaces
mint dev --mcp              # MCP stdio only
mint dev --api              # REST API only
mint dev --ui               # Web UI only
```

### `mint build`

Build distribution targets.

```bash
mint build                  # Build for current platform
mint build --all            # Build all 10 targets
mint build --target cli     # Native CLI only
mint build --target desktop # Tauri desktop apps
mint build --target mobile  # Tauri iOS + Android
mint build --target wasm    # Browser + Edge worker
mint build --target docker  # Docker multi-arch

# Output:
# ✓ Built my-app-cli-windows-x64.exe (4.2 MB)
# ✓ Built my-app-cli-macos-x64 (4.0 MB)
# ✓ Built my-app-cli-macos-arm64 (3.8 MB)
# ✓ Built my-app-cli-linux-x64 (4.1 MB)
# ✓ Built my-app-desktop-windows.msi (12.3 MB)
# ✓ Built my-app-desktop-macos.dmg (11.8 MB)
# ✓ Built my-app-desktop-linux.AppImage (14.2 MB)
# ✓ Built my-app-ios.ipa (8.2 MB)
# ✓ Built my-app-android.apk (9.1 MB)
# ✓ Built my-app-worker.wasm (2.1 MB)
# ✓ Built my-app-browser.wasm (2.3 MB)
# ✓ Built my-app:latest (Docker multi-arch)
```

### `mint release <version>`

Tag and release to all configured targets.

```bash
mint release 1.0.0          # Tag and trigger release
mint release 1.0.0 --dry    # Preview what would happen
mint release 1.0.0 --skip docker  # Skip specific target
```

### `mint doctor`

Check environment and dependencies.

```bash
mint doctor

# Output:
# ✓ Rust toolchain (1.83.0)
# ✓ wasm-pack (0.13.0)
# ✓ cargo-dist (0.25.0)
# ✓ Docker (27.4.0)
# ✓ wrangler (3.95.0)
# ⚠ Homebrew tap not configured (optional)
```

### `mint docs`

Auto-generate documentation from the command registry.

```bash
mint docs                     # Generate docs/cli-reference.md
mint docs --format json       # Output as JSON schema
mint docs --output api.md     # Custom output path
```

**Why this matters:**
- Documentation stays in sync with code (generated from command registry)
- Command schemas, descriptions, and examples are the source of truth
- Agents can read accurate docs to understand available commands
- No manual documentation maintenance

> Pattern from Mechanic: `mech call docs.generate` — the app documents itself.

## Tauri Mobile Integration

Mint uses **Tauri 2.0** for desktop and mobile apps, enabling a single web UI to run on all platforms.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Tauri Shell                              │
│  (Native wrapper: Rust backend + System WebView)                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Web UI (Violet themed)               │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐    │   │
│  │  │  HTML   │  │   CSS   │  │   JS    │  │  WASM   │    │   │
│  │  │ (index) │  │(tokens) │  │ (app)   │  │(optional)│    │   │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘    │   │
│  └───────────────────────────┬─────────────────────────────┘   │
│                              │                                  │
│                              │ Tauri Commands (IPC)             │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    AFD Commands (Rust)                  │   │
│  │       create()   get()   list()   update()   delete()   │   │
│  └───────────────────────────┬─────────────────────────────┘   │
│                              │                                  │
│                              │ Service Layer                    │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Platform Services                          │   │
│  │  Mobile: SQLite + FileSystem + Keychain                 │   │
│  │  Desktop: SQLite + FileSystem + OS Keyring              │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

Platforms: Windows, macOS, Linux, iOS, Android
```

### Tauri Configuration

```json
// src-tauri/tauri.conf.json
{
  "productName": "{{project_name}}",
  "version": "{{version}}",
  "identifier": "com.{{author}}.{{project_name}}",
  "build": {
    "beforeBuildCommand": "mint build --target ui",
    "frontendDist": "../ui/dist"
  },
  "bundle": {
    "active": true,
    "targets": ["app", "dmg", "msi", "deb", "appimage"],
    "iOS": {
      "developmentTeam": "{{APPLE_TEAM_ID}}"
    },
    "android": {
      "minSdkVersion": 24
    }
  },
  "app": {
    "withGlobalTauri": true,
    "security": {
      "csp": "default-src 'self'; style-src 'self' 'unsafe-inline'"
    }
  }
}
```

### Mobile-Specific Commands

```rust
// src-tauri/src/mobile.rs
use tauri::Manager;

#[tauri::command]
async fn share_content(content: String) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        // Use iOS share sheet
        tauri::api::ios::share(&content)?;
    }
    #[cfg(target_os = "android")]
    {
        // Use Android share intent
        tauri::api::android::share(&content)?;
    }
    Ok(())
}

#[tauri::command]
async fn haptic_feedback(style: String) -> Result<(), String> {
    #[cfg(any(target_os = "ios", target_os = "android"))]
    {
        tauri::api::haptics::impact(&style)?;
    }
    Ok(())
}
```

### Build Commands

```bash
# Desktop builds
mint build --target desktop

# Mobile builds (requires Xcode / Android Studio)
mint build --target ios
mint build --target android

# All platforms
mint build --target tauri  # desktop + mobile
```

---

## Violet Integration

Mint includes first-class Violet integration for themed UI surfaces.

### Configuration

```toml
# mint.toml
[project]
name = "my-app"
version = "0.1.0"
language = "rust"

[features]
mcp = true
api = true
ui = true

[theme]
source = "violet"           # Use Violet design tokens
node = "xbox-dark"          # Specific node in hierarchy
# OR
source = "custom"           # Custom theme file
path = "./theme.json"

[distribution]
targets = ["linux", "macos", "windows", "wasm", "docker"]
homebrew = "Falkicon/homebrew-tap"
npm = "@falkicon/my-app"
cloudflare = "my-app-worker"
```

### Token Export Pipeline

```
Violet Database
      │
      ▼
┌─────────────────┐
│ violet export   │
│ css xbox-dark   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   tokens.css    │──────► ui/tokens.css
│                 │
│ :root {         │
│   --color-bg:   │
│     #1a1a1a;    │
│   --color-fg:   │
│     #ffffff;    │
│   ...           │
│ }               │
└─────────────────┘
```

### Themed UI Template

```html
<!-- ui/index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>{{project_name}}</title>
  <link rel="stylesheet" href="tokens.css">
  <style>
    body {
      background: var(--color-background-primary);
      color: var(--color-text-primary);
      font-family: var(--typography-font-family-body);
    }
    .card {
      background: var(--color-background-secondary);
      border-radius: var(--spacing-border-radius-md);
      padding: var(--spacing-padding-lg);
    }
  </style>
</head>
<body>
  <div id="app"></div>
  <script src="app.js"></script>
</body>
</html>
```

## Distribution Engine

### Multi-Target Build Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                       mint build --all                          │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
          ▼                       ▼                       ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Native Build   │     │   WASM Build    │     │  Docker Build   │
│  (cargo-dist)   │     │  (wasm-pack)    │     │  (buildx)       │
├─────────────────┤     ├─────────────────┤     ├─────────────────┤
│ - linux-x64     │     │ - wasm32        │     │ - linux/amd64   │
│ - linux-arm64   │     │ - JS bindings   │     │ - linux/arm64   │
│ - macos-x64     │     │                 │     │                 │
│ - macos-arm64   │     │                 │     │                 │
│ - windows-x64   │     │                 │     │                 │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │      dist/ folder       │
                    ├─────────────────────────┤
                    │ my-app-linux-x64.tar.gz │
                    │ my-app-linux-arm64.tar.gz│
                    │ my-app-macos-x64.tar.gz │
                    │ my-app-macos-arm64.tar.gz│
                    │ my-app-windows-x64.zip  │
                    │ my-app.wasm             │
                    │ my-app.js               │
                    │ docker-manifest.json    │
                    └─────────────────────────┘
```

### Release Pipeline

```yaml
# Generated .github/workflows/release.yml
name: Release

on:
  push:
    tags: ['v*']

jobs:
  build:
    strategy:
      matrix:
        include:
          - os: ubuntu-latest
            target: x86_64-unknown-linux-gnu
          - os: ubuntu-latest
            target: aarch64-unknown-linux-gnu
          - os: macos-latest
            target: x86_64-apple-darwin
          - os: macos-latest
            target: aarch64-apple-darwin
          - os: windows-latest
            target: x86_64-pc-windows-msvc
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: cargo build --release --target ${{ matrix.target }}
      - uses: actions/upload-artifact@v4

  wasm:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: wasm32-unknown-unknown
      - run: cargo install wasm-pack
      - run: wasm-pack build --target web
      - uses: actions/upload-artifact@v4

  docker:
    runs-on: ubuntu-latest
    steps:
      - uses: docker/setup-buildx-action@v3
      - uses: docker/build-push-action@v5
        with:
          platforms: linux/amd64,linux/arm64

  cloudflare:
    runs-on: ubuntu-latest
    needs: wasm
    steps:
      - uses: cloudflare/wrangler-action@v3
        with:
          command: deploy

  release:
    runs-on: ubuntu-latest
    needs: [build, wasm, docker]
    steps:
      - uses: softprops/action-gh-release@v1
        with:
          files: |
            dist/*
          generate_release_notes: true
```

## Service Layer Integration

Mint integrates the service abstraction layer (Part 3) for local/cloud parity.

### Configuration

```toml
# mint.toml

[project]
name = "my-app"
version = "0.1.0"
language = "rust"

[features]
mcp = true
api = true
ui = true
mobile = true

[theme]
source = "violet"
node = "xbox-dark"

# Service configuration by environment
[services]
default = "local"  # Use local services by default

[services.local]
database = "sqlite:./data/app.db"
storage = "./data/files"
cache = "memory:1000"
queue = "channel"
auth = "dev"

[services.cloudflare]
database = "d1:MY_DB"
storage = "r2:MY_BUCKET"
cache = "kv:MY_CACHE"
queue = "queue:MY_QUEUE"
auth = "access"

[services.aws]
database = "postgres:${DATABASE_URL}"
storage = "s3:${S3_BUCKET}"
cache = "redis:${REDIS_URL}"
queue = "sqs:${SQS_QUEUE_URL}"
auth = "cognito:${USER_POOL_ID}"

[distribution]
targets = ["cli", "desktop", "mobile", "wasm", "docker"]
homebrew = "{{author}}/homebrew-tap"
npm = "@{{author}}/{{name}}"
cloudflare = "{{name}}-worker"
```

### Runtime Selection

```bash
# Development with local services (default)
mint dev

# Development with cloud services
mint dev --services cloudflare
mint dev --services aws

# Mixed (database cloud, cache local)
mint dev --services hybrid

# Production build with baked-in service config
mint build --all --services cloudflare
```

### Generated Service Context

```rust
// src/context.rs (generated by mint)
use mint::services::*;

pub fn build_context(config: &MintConfig) -> AppContext {
    match config.services.default.as_str() {
        "local" => build_local_context(&config.services.local),
        "cloudflare" => build_cloudflare_context(&config.services.cloudflare),
        "aws" => build_aws_context(&config.services.aws),
        _ => panic!("Unknown service configuration"),
    }
}
```

---

## Implementation Phases

### Phase 2.1: CLI Foundation (Days 1-2)
- [ ] Create `mint` repository
- [ ] Implement `mint` CLI in Rust
- [ ] `mint new` with basic template
- [ ] `mint doctor` environment check
- [ ] `mint config` for service configuration

### Phase 2.2: Templates (Days 3-4)
- [ ] Rust project template
- [ ] TypeScript project template
- [ ] Python project template
- [ ] Template variable substitution engine
- [ ] Service layer boilerplate generation

### Phase 2.3: Violet Integration (Days 5-6)
- [ ] Token export pipeline
- [ ] Pre-built themes (dark, light)
- [ ] Themed UI template
- [ ] Custom theme support
- [ ] CSS/SCSS/Tailwind output

### Phase 2.4: Tauri Integration (Days 7-8)
- [ ] Tauri desktop template
- [ ] Tauri mobile template (iOS/Android)
- [ ] Tauri command bridging to AFD commands
- [ ] Platform-specific features (share, haptics)
- [ ] Build configuration for all platforms

### Phase 2.5: Build Engine (Days 9-10)
- [ ] `mint build` command
- [ ] Native CLI build (cargo-dist)
- [ ] Tauri desktop build
- [ ] Tauri mobile build
- [ ] WASM build pipeline
- [ ] Docker build integration

### Phase 2.6: Release Pipeline (Days 11-12)
- [ ] `mint release` command
- [ ] GitHub Actions workflow generation
- [ ] Homebrew formula generation
- [ ] npm package wrapper
- [ ] Cloudflare Worker deployment
- [ ] App Store / Play Store preparation

### Phase 2.7: Documentation & Examples (Days 13-14)
- [ ] Getting started guide
- [ ] Template documentation
- [ ] Service layer configuration guide
- [ ] Mobile deployment guide
- [ ] Example projects (hello-world, todo-app)
- [ ] AGENTS.md for AI context

## Success Criteria

1. **Scaffolding Works**: `mint new my-app --language rust` creates runnable project
2. **Build Succeeds**: `mint build --all` produces all 10+ target artifacts
3. **Mobile Works**: iOS and Android apps build and run via Tauri
4. **Services Swap**: Same app runs with local and cloud services via config
5. **Release Automated**: Tag push triggers full release pipeline
6. **Violet Themed**: Generated UI uses Violet design tokens
7. **Documentation Complete**: Users can follow docs to ship an app
8. **Example Deployed**: Todo app running on all platforms

## Distribution Target Checklist

| Target | Build Command | Output |
|--------|---------------|--------|
| CLI (Windows) | `mint build --target cli` | `my-app.exe` |
| CLI (macOS) | `mint build --target cli` | `my-app` (universal) |
| CLI (Linux) | `mint build --target cli` | `my-app` |
| Desktop (Windows) | `mint build --target desktop` | `my-app.msi` |
| Desktop (macOS) | `mint build --target desktop` | `my-app.dmg` |
| Desktop (Linux) | `mint build --target desktop` | `my-app.AppImage` |
| iOS | `mint build --target ios` | `my-app.ipa` |
| Android | `mint build --target android` | `my-app.apk` |
| Browser WASM | `mint build --target wasm` | `my-app.wasm` + `my-app.js` |
| Edge Worker | `mint build --target worker` | `worker.wasm` |
| Docker | `mint build --target docker` | `my-app:latest` |
| npm | `mint build --target npm` | `@org/my-app` |

## Future Enhancements

- **mint deploy** - Direct deployment to various platforms
- **mint upgrade** - Update AFD/Mint dependencies
- **mint plugin** - Plugin system for custom targets
- **mint cloud** - Managed hosting option (SaaS)
- **mint sync** - Sync data between local and cloud
- **mint test** - Cross-platform test runner

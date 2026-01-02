# Mint Distribution Framework - Plan Overview

> **Goal**: Build a private distribution framework that combines AFD (commands), Violet (theming), and automated multi-platform release tooling to ship AI/MCP/API-enabled apps to 12+ distribution targets.

**Note**: This plan describes "Mint," a private framework that builds ON TOP of the public AFD package. See [AFD Rust Support](../rust-support/00-overview.md) for the prerequisite Rust implementation in AFD core.

## The Vision

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Mint (New Repo)                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌─────────────────────┐  │
│  │    AFD    │  │  Violet   │  │  Service  │  │    Distribution     │  │
│  │ (Commands)│ +│  (Style)  │ +│   Layer   │ +│       Engine        │  │
│  └───────────┘  └───────────┘  └───────────┘  └─────────────────────┘  │
│                                                                         │
│  Define cmds     Theme &        Local/Cloud     Ship everywhere:        │
│  in any lang     design         abstraction     - Desktop apps          │
│  (TS/Py/Rust)    tokens                         - Mobile apps           │
│                                                 - Edge workers          │
│                                                 - Docker/npm/brew       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Complete Distribution Matrix

One AFD app, **multiple UI heads**, **10+ distribution targets**:

```
                              AFD App (Commands)
                                     │
     ┌───────────────────────────────┼───────────────────────────────┐
     │                               │                               │
     ▼                               ▼                               ▼
┌─────────┐                    ┌─────────┐                    ┌─────────┐
│   UI    │                    │ Service │                    │  Distro │
│  Heads  │                    │  Layer  │                    │ Targets │
└────┬────┘                    └────┬────┘                    └────┬────┘
     │                              │                              │
┌────┼────┬────┬────┬────┐    ┌────┼────┐              ┌───────────┼───────────┐
│    │    │    │    │    │    │         │              │     │     │     │     │
▼    ▼    ▼    ▼    ▼    ▼    ▼         ▼              ▼     ▼     ▼     ▼     ▼
CLI  Web  Desk Mobile Voice Watch   Local  Cloud      Native Desktop Mobile Edge  Container
                                    SQLite  D1/S3     CLI    App    App   Worker  Docker
                                    Files   R2/Postgres      Tauri  Tauri  WASM
                                    Memory  Redis/KV
```

**UI Heads** (same commands, different presentations):

| Head | Interaction | Best For | Phase |
|------|-------------|----------|-------|
| CLI | Keyboard | Power users, scripts, automation | A |
| Web | Mouse/Touch | Broad access, no install | A |
| Desktop | Mouse/Keyboard | Heavy users, OS integration | A |
| Mobile | Touch/Gesture | On-the-go, notifications | B |
| Agent | MCP/API | AI integration | A |
| Voice | Speech | Hands-free, ambient | Future |
| Watch | Tap/Crown | Quick glance, timely | Future |

**Distribution Targets** (12 total):
- Native CLI (Windows, macOS, Linux)
- Desktop App (Windows, macOS, Linux via Tauri)
- Mobile App (iOS, Android via Tauri)
- Edge Worker (Cloudflare WASM)
- Browser WASM (standalone)
- Docker Container (multi-arch)
- npm package, Homebrew, Winget

## Why Rust?

| Target | TS/Python | Rust |
|--------|-----------|------|
| Desktop CLI | Via bundler (50-150MB) | Native (3-8MB) |
| Desktop App | Electron (150MB+) | Tauri (5-15MB) |
| iOS App | React Native only | Tauri Mobile |
| Android App | React Native only | Tauri Mobile |
| Cloudflare Workers | TS only | WASM |
| Browser Standalone | Requires server | WASM |
| npm package | Complex | Native via cargo-dist |

## Prerequisite: AFD Rust

Mint requires AFD Rust support. See **[AFD Rust Support](../rust-support/00-overview.md)** for the implementation plan that adds Rust as a third language to the public AFD package.

---

## Minimum Viable Mint (MVP)

The smallest shippable subset to validate the core architecture:

| Component | MVP Scope |
|-----------|-----------|
| **Platform** | Windows only (your dev machine) |
| **Head** | CLI only |
| **Services** | Local only (SQLite, filesystem) |
| **Sync** | None (single user) |
| **Distribution** | Single binary via `cargo build` |

**MVP validates:**
- Command execution through Mint
- Local service abstractions work
- CLI head consumes commands correctly

---

## Implementation Phases

Work is organized into phases with explicit **STOP & TEST** milestones.

### Phase A - MVP (Windows First)

```
A.1: CLI Head (Windows)           → STOP & TEST
A.2: Web Head                     → STOP & TEST  
A.3: Desktop Head (Windows)       → STOP & TEST
─────────────────────────────────────────────────
EVALUATION A: Core platform validated
- All heads invoke same commands
- Local services work
- Build pipeline produces artifacts
```

### Phase B - Mobile & Cross-Platform

```
B.1: Mobile Head (Android first)  → STOP & TEST
B.2: Service Layer + Cloud        → STOP & TEST
B.3: Cross-platform CLI (Mac/Linux) → STOP & TEST
─────────────────────────────────────────────────
EVALUATION B: Multi-platform validated
- Tauri mobile builds work
- Cloud adapters function
- Same code runs everywhere
```

### Phase C - Collaboration (Optional)

```
C.1: Basic sync (queue mode)      → STOP & TEST
C.2: Real-time (CRDT) - if needed → STOP & TEST
─────────────────────────────────────────────────
EVALUATION C: Collaboration validated
- Offline + sync works
- Multi-user scenarios function
```

### Phase D - Future (Not Committed)

See [Part 6: Future Phases](./06-future-phases.md) for:
- Voice Head
- Watch Head
- Advanced collaboration features

---

## Six-Part Plan

### Part 1: Mint Distribution Framework

New repository that combines AFD + Violet + distribution tooling.

**Deliverables:**
- Project scaffolding CLI (`mint new my-app`)
- Template system (Rust, TypeScript, Python)
- Violet integration for themed UI
- Tauri integration for desktop + mobile
- One-command multi-platform builds
- GitHub Actions for automated releases

**See:** [01-mint.md](./01-mint.md)

### Part 2: Service Abstraction Layer

Clean interface between local and cloud services.

**Deliverables:**
- Service traits (Database, Storage, Cache, Queue, Auth)
- Local adapters (SQLite, Filesystem, Memory)
- Cloudflare adapters (D1, R2, KV, Queues)
- AWS adapters (Postgres, S3, Redis, SQS)
- Same commands work everywhere

**See:** [02-service-layer.md](./02-service-layer.md)

### Part 3: Multi-Head UI Architecture

Multiple UI "heads" optimized for different platforms and interaction modes.

**Deliverables:**
- Head registry and trait system
- CLI Head (terminal interface)
- Web Head (browser SPA)
- Desktop Head (Tauri with native features)
- Mobile Head (touch-optimized)
- Agent Head (MCP/API for AI agents)
- Shared component library with Violet tokens

**Future (Part 6):** Voice Head, Watch Head

**See:** [03-ui-heads.md](./03-ui-heads.md)

### Part 4: Testing Strategy

Four-layer testing from conformance (foundation) through JTBD scenarios (behavior).

**Deliverables:**
- Layer 1: Conformance tests (type parity across TS/Py/Rust)
- Layer 2: Unit tests (commands with mocks)
- Layer 3: Integration tests (adapter parity)
- Layer 4: JTBD scenarios (complete user workflows)
- Tiered CI/CD pipeline (smoke → full → nightly)

**See:** [04-testing-conformance.md](./04-testing-conformance.md)

**Related:** [JTBD Testing Framework](../jtbd-testing/00-overview.plan.md) - Layer 4 detailed specification

### Part 5: Collaboration & Sync

Real-time human-AI collaboration where agents are first-class participants.

**Deliverables:**
- Presence layer (awareness of all collaborators)
- Command envelopes with actor + vector clock
- Three sync modes: `none`, `queue`, `realtime`
- Conflict handling (same notification for humans and agents)
- Automerge integration for CRDT collaboration

**See:** [05-collaboration-sync.md](./05-collaboration-sync.md)

### Part 6: Future Phases (Not Committed)

Deferred features with designs preserved for future implementation.

**Contents:**
- Voice Head (Alexa, Google Assistant via Claude MCP routing)
- Watch Head (WatchOS, Wear OS minimal UI)
- Advanced CRDT collaboration
- Command versioning strategy
- Degraded mode design

**See:** [06-future-phases.md](./06-future-phases.md)

## Cross-Cutting Concerns

These requirements are embedded across multiple parts:

| Concern | Location | Status |
|---------|----------|--------|
| **Observability** | Part 3 - Telemetry trait | Documented |
| **Security** | Part 3 - RateLimit, Validation traits | Documented |
| **Secrets** | Part 3 - Secrets trait | Documented |
| **Accessibility** | Part 4 - Per-head requirements | Documented |
| **Internationalization** | Part 3 (I18n trait) + Part 4 (per-head) | Documented |
| **Real-time Sync** | Part 6 - Collaboration & Sync | Documented |
| **Human-AI Collaboration** | Part 6 - Presence, Conflict handling | Documented |
| **State Management** | Part 6 - State hierarchy (Domain/Session/UI) | Documented |

## Relationship Diagram

```
                    ┌──────────────────┐
                    │   AFD (GitHub)   │
                    │   Falkicon/afd   │
                    ├──────────────────┤
                    │ packages/        │
                    │   core/     (TS) │
                    │   server/   (TS) │
                    │   cli/      (TS) │
                    │   rust/    (NEW) │◄─── Prerequisite (see rust-support)
                    │ python/          │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
     ┌────────────┐  ┌────────────┐  ┌────────────┐
     │  Violet    │  │  Noisett   │  │ Your Apps  │
     │  (dsas)    │  │  (image)   │  │            │
     │ 35 commands│  │ 19 commands│  │ N commands │
     └─────┬──────┘  └────────────┘  └────────────┘
           │
           │ Theme tokens
           ▼
┌─────────────────────────────────────────────────────┐
│              Mint (PRIVATE REPO)                    │◄─── Parts 1-5 + Future (Part 6)
│              Falkicon/mint                          │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │ Scaffolding │  │   Service   │  │Distribution │ │
│  │    CLI      │  │    Layer    │  │   Engine    │ │
│  └─────────────┘  └─────────────┘  └─────────────┘ │
│                                                     │
│  Templates:        Adapters:        Targets:        │
│  - Rust            - SQLite/D1      - Desktop CLI   │
│  - TypeScript      - Files/R2/S3    - Desktop App   │
│  - Python          - Memory/KV      - iOS App       │
│                    - Channel/SQS    - Android App   │
│  Integrations:                      - Edge Worker   │
│  - Violet theme    Config:          - Docker        │
│  - Tauri mobile    - mint.toml      - npm/brew      │
│                    - Local/Cloud    - Browser WASM  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

## Service Layer Architecture

Commands are decoupled from infrastructure:

```
┌─────────────────────────────────────────────────────────────────┐
│                    AFD Commands (Business Logic)                │
│        create()   get()   list()   update()   delete()          │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Service Traits (Ports)                       │
│   Database     Storage     Cache      Queue       Auth          │
└───────────────────────────┬─────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│     Local     │   │  Cloudflare   │   │      AWS      │
├───────────────┤   ├───────────────┤   ├───────────────┤
│ SQLite        │   │ D1            │   │ Postgres      │
│ Filesystem    │   │ R2            │   │ S3            │
│ Memory Cache  │   │ KV            │   │ Redis         │
│ Channel Queue │   │ Queues        │   │ SQS           │
│ Dev Auth      │   │ Access        │   │ Cognito       │
└───────────────┘   └───────────────┘   └───────────────┘
```

**Same command, different environments:**
```rust
// This code runs identically on laptop, phone, or Cloudflare Worker
async fn create_item(ctx: &AppContext, input: Input) -> CommandResult<Item> {
    ctx.database().execute("INSERT INTO items ...", &[...]).await?;
    ctx.storage().put("items/123/data", bytes).await?;
    ctx.cache().delete("items:list").await?;
    success(item)
}
```

## Success Criteria

**Prerequisite**: AFD Rust implementation complete (see [rust-support](../rust-support/00-overview.md))

1. **Part 1 (Mint Framework) Complete** when:
   - `mint new my-app --language rust` creates working project
   - `mint build --all` produces all 12 distribution targets
   - Tauri mobile builds for iOS and Android
   - Example app deployed to Cloudflare Workers

2. **Part 2 (Service Layer) Complete** when:
   - Same commands work with local and cloud adapters
   - `mint dev --services local` runs entirely offline
   - `mint dev --services cloud` connects to real infrastructure
   - Configuration-only switch between environments
   - Telemetry, Secrets, RateLimit, I18n traits implemented

3. **Part 3 (UI Heads) Complete** when:
   - All core UI heads (CLI, Web, Desktop, Mobile, Agent) invoke identical AFD commands
   - Each head is optimized for its interaction mode
   - Violet design tokens work across all visual heads
   - `mint build --heads web,mobile` builds selected heads
   - All visual heads pass WCAG 2.1 AA accessibility tests
   - I18n works across all heads with RTL support

4. **Part 4 (Testing) Complete** when:
   - Conformance tests pass for all three languages (TS/Py/Rust)
   - Mock adapters enable fast unit testing
   - Adapter parity tests ensure identical behavior
   - JTBD scenarios validate complete user workflows
   - Tiered CI pipeline (smoke < 30s, full < 10m)
   - Coverage thresholds enforced per layer

5. **Part 5 (Collaboration) Complete** when:
   - Humans and agents use identical command API
   - All collaborators appear with presence indicators
   - Conflicts notify both humans and agents
   - App can choose sync mode via configuration
   - Real-time changes propagate in < 100ms

## Timeline Estimate

**Prerequisite**: AFD Rust (~1 week) - see [rust-support](../rust-support/00-overview.md)

### Phase A: MVP (Windows First) — ~4-5 weeks

| Milestone | Tasks | Effort |
|-----------|-------|--------|
| **A.1: CLI Head** | Scaffolding CLI, Templates, CLI head | 3-4 days |
| ⏸️ **STOP & TEST** | CLI invokes commands correctly | 1 day |
| **A.2: Web Head** | Shared components, Web head, Violet tokens | 3-4 days |
| ⏸️ **STOP & TEST** | Web UI works, same commands as CLI | 1 day |
| **A.3: Desktop Head** | Tauri integration, native features | 2-3 days |
| ⏸️ **STOP & TEST** | Desktop app works on Windows | 1 day |
| **EVALUATION A** | Full review: Core platform validated | 1-2 days |

### Phase B: Mobile & Cross-Platform — ~3-4 weeks

| Milestone | Tasks | Effort |
|-----------|-------|--------|
| **B.1: Mobile Head** | Tauri mobile, touch layouts | 3-4 days |
| ⏸️ **STOP & TEST** | Android build works | 1 day |
| **B.2: Service Layer** | Cloud adapters, Telemetry, Secrets | 3-4 days |
| ⏸️ **STOP & TEST** | Local/Cloud switch works | 1 day |
| **B.3: Cross-Platform** | Mac/Linux CLI, iOS build | 2-3 days |
| ⏸️ **STOP & TEST** | All platforms build | 1 day |
| **EVALUATION B** | Full review: Multi-platform validated | 1-2 days |

### Phase C: Collaboration (Optional) — ~2-3 weeks

| Milestone | Tasks | Effort |
|-----------|-------|--------|
| **C.1: Basic Sync** | Queue mode, offline support | 3-4 days |
| ⏸️ **STOP & TEST** | Offline + sync works | 1 day |
| **C.2: Real-time** | CRDT mode (if needed) | 3-4 days |
| ⏸️ **STOP & TEST** | Multi-user works | 1 day |
| **EVALUATION C** | Full review: Collaboration validated | 1-2 days |

### Phase D: Future (Not Committed)

See [Part 6: Future Phases](./06-future-phases.md)

**Total: ~7-10 weeks** (Phases A+B required, Phase C optional)

## Design-to-Code Integration

Mint works seamlessly with the **Design-to-Code** pipeline for rapid prototyping:

```bash
# 1. Figma Make generates UI head (calls AFD commands)
figma-make generate --project my-app --output heads/web/

# 2. Mint wraps and deploys
mint build --heads web
mint deploy --target internal-test
```

**Rapid prototype flow**: Figma design → Generated code → Mint build → Deployed (minutes)

This enables fast internal dogfooding — design in Figma, ship to test environment, iterate.

See: [Design-to-Code Plan](../design-to-code/00-overview.md)

## Quick Start (After Implementation)

```bash
# Install Mint
cargo install mint

# Create new app
mint new my-app --language rust --platform cloudflare

# Develop locally (all services local)
cd my-app
mint dev

# Build all distribution targets
mint build --all

# Release to all platforms
mint release 1.0.0
```

**Output:**
```
✓ Built my-app-cli-windows-x64.exe (4.2 MB)
✓ Built my-app-cli-macos-arm64 (3.8 MB)
✓ Built my-app-cli-linux-x64 (4.1 MB)
✓ Built my-app-desktop-windows.msi (12.3 MB)
✓ Built my-app-desktop-macos.dmg (11.8 MB)
✓ Built my-app-ios.ipa (8.2 MB)
✓ Built my-app-android.apk (9.1 MB)
✓ Built my-app-worker.wasm (2.1 MB)
✓ Built my-app-browser.wasm (2.3 MB)
✓ Built my-app:latest (Docker multi-arch)
✓ Published @my-org/my-app (npm)
✓ Updated homebrew-tap/my-app
✓ Deployed to my-app.workers.dev
```

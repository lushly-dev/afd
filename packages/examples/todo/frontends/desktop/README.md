# AFD Todo Desktop

Tauri 2.0 desktop application for the AFD Todo example. Bundles the TypeScript backend as a sidecar executable for a single-file distribution.

## Features

- **Cross-platform**: Builds for Windows, macOS, and Linux
- **Sidecar Pattern**: TypeScript backend bundled as an external binary
- **Single Executable**: Users get one file to run
- **Auto-start Backend**: Server starts automatically with the app
- **Same UI**: React-based Todo interface

## Architecture

```
┌─────────────────────────────────────┐
│          Tauri Application          │
│  ┌─────────────────────────────────┐│
│  │     React Frontend (WebView)    ││
│  │  ┌───────────────────────────┐  ││
│  │  │  App.tsx + Components     │  ││
│  │  └───────────────────────────┘  ││
│  │              │ HTTP              ││
│  │              ▼ (localhost:3100)  ││
│  │  ┌───────────────────────────┐  ││
│  │  │  Todo Server (Sidecar)    │  ││
│  │  │  TypeScript MCP Backend   │  ││
│  │  └───────────────────────────┘  ││
│  └─────────────────────────────────┘│
└─────────────────────────────────────┘
```

## Prerequisites

1. **Node.js 18+** and **pnpm**
2. **Rust** (install via [rustup](https://rustup.rs/))
3. Platform-specific requirements:
   - **Windows**: Visual Studio Build Tools with C++ workload
   - **macOS**: Xcode Command Line Tools
   - **Linux**: `build-essential`, `libwebkit2gtk-4.0-dev`, `libssl-dev`

## Development

```bash
# Install dependencies
pnpm install

# Build the TypeScript backend first
cd ../backends/typescript && pnpm build && cd -

# Run in development mode (hot reload)
pnpm tauri:dev
```

## Building for Production

### 1. Build the Sidecar Backend

```bash
pnpm build:sidecar
```

The built binary should be placed in `src-tauri/binaries/todo-server-{target-triple}`:

| Platform | Target Triple | Binary Name |
|----------|---------------|-------------|
| Windows x64 | x86_64-pc-windows-msvc | todo-server-x86_64-pc-windows-msvc.exe |
| macOS x64 | x86_64-apple-darwin | todo-server-x86_64-apple-darwin |
| macOS ARM | aarch64-apple-darwin | todo-server-aarch64-apple-darwin |
| Linux x64 | x86_64-unknown-linux-gnu | todo-server-x86_64-unknown-linux-gnu |

### 2. Build the Tauri App

```bash
pnpm tauri:build
```

## Project Structure

```
desktop/
├── index.html              # HTML entry point
├── package.json            # Node.js dependencies
├── vite.config.ts          # Vite bundler config
├── tsconfig.json           # TypeScript config
├── src/                    # React frontend
│   ├── main.tsx            # Entry point
│   ├── App.tsx             # Main component
│   ├── api.ts              # Backend API client
│   └── types.ts            # TypeScript types
├── scripts/
│   └── build-sidecar.mjs   # Sidecar build script
└── src-tauri/              # Rust/Tauri backend
    ├── Cargo.toml          # Rust dependencies
    ├── tauri.conf.json     # Tauri configuration
    ├── src/main.rs         # Sidecar management
    └── binaries/           # Sidecar executables
```

## Tauri Commands

The Rust backend exposes these commands:

- `start_server()` - Start the sidecar backend
- `stop_server()` - Stop the sidecar backend
- `get_server_status()` - Check if server is running

//! The process-wide wasmtime `Engine`, its epoch ticker, the linker and the compiled-component
//! cache (specification section 6.2).
//!
//! One engine serves every component of the process (the specification says one per host; a
//! process-wide engine lets hosts and tests share compiled components, and its epoch thread runs
//! once). The linker is built once as well: it links the worlds `umbel:plugin/plugin@1.0.0` and
//! `@1.1.0` and the virtualized WASI 0.2 interfaces, and **no** `wasi:sockets` and no
//! `wasi:http`, so a component that imports them cannot even be instantiated, whatever the import
//! check says.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use sha2::{Digest, Sha256};
use wasmtime::component::{Component, HasData, Linker, ResourceTable};
use wasmtime::{Config, Engine};
use wasmtime_wasi::WasiView as _;
use wasmtime_wasi::cli::{WasiCli, WasiCliView as _};
use wasmtime_wasi::clocks::{WasiClocks, WasiClocksView as _};
use wasmtime_wasi::filesystem::{WasiFilesystem, WasiFilesystemView as _};
use wasmtime_wasi::p2::bindings::{cli, clocks, filesystem, random};
use wasmtime_wasi::random::{WasiRandom, WasiRandomView as _};

use super::state::CallState;

/// How often the epoch advances; a call's `timeout_ms` is a number of these.
pub(super) const EPOCH_MS: u64 = 10;

/// Compiled components kept for the life of the process, keyed by the SHA-256 of their bytes. A
/// host seals once and a test binary seals many hosts over a few components; this keeps the
/// second compile away. It is bounded: past this many entries the cache is emptied.
const CACHE_LIMIT: usize = 64;

pub(super) struct Shared {
    pub(super) engine: Engine,
    pub(super) linker: Linker<CallState>,
    cache: Mutex<HashMap<[u8; 32], Component>>,
}

static SHARED: OnceLock<Result<Shared, String>> = OnceLock::new();

/// The shared engine and linker, built on first use.
pub(super) fn shared() -> Result<&'static Shared, String> {
    SHARED.get_or_init(build).as_ref().map_err(Clone::clone)
}

impl Shared {
    /// Compile `bytes` (or return the component compiled from the same bytes before).
    pub(super) fn compile(&self, bytes: &[u8]) -> Result<Component, String> {
        let key: [u8; 32] = Sha256::digest(bytes).into();
        if let Ok(cache) = self.cache.lock()
            && let Some(component) = cache.get(&key)
        {
            return Ok(component.clone());
        }
        let component =
            Component::new(&self.engine, bytes).map_err(|error| format!("{error:#}"))?;
        if let Ok(mut cache) = self.cache.lock() {
            if cache.len() >= CACHE_LIMIT {
                cache.clear();
            }
            cache.insert(key, component.clone());
        }
        Ok(component)
    }
}

fn build() -> Result<Shared, String> {
    let mut config = Config::new();
    config
        .wasm_component_model(true)
        .consume_fuel(true)
        .epoch_interruption(true)
        // A trap's message is the trap, with no stack of the plugin's internal frames.
        .wasm_backtrace_max_frames(None)
        // On macOS, catch wasm traps with signal handlers, as on Linux, not Wasmtime's Mach
        // exception thread: in Wasmtime 48 that thread aborts the process when any signal lands
        // on it, and the host takes `SIGCHLD` for every mounted child it starts (#2458). Fixed
        // upstream in Wasmtime 50 (bytecodealliance/wasmtime#14414), which Umbel skips (D39): drop
        // this call on the move to the 60 long-term line, or a 48.x release with the fix.
        .macos_use_mach_ports(false);
    let engine =
        Engine::new(&config).map_err(|error| format!("cannot create the engine: {error:#}"))?;

    // The epoch advances every EPOCH_MS for the life of the process; a store's deadline is a
    // number of ticks beyond the epoch it starts in.
    let ticker = engine.clone();
    std::thread::Builder::new()
        .name("umbel-epoch".to_owned())
        .spawn(move || {
            loop {
                std::thread::sleep(Duration::from_millis(EPOCH_MS));
                ticker.increment_epoch();
            }
        })
        .map_err(|error| format!("cannot start the epoch thread: {error}"))?;

    let mut linker = Linker::new(&engine);
    link(&mut linker).map_err(|error| format!("cannot build the linker: {error:#}"))?;
    Ok(Shared {
        engine,
        linker,
        cache: Mutex::new(HashMap::new()),
    })
}

struct HasTable;

impl HasData for HasTable {
    type Data<'a> = &'a mut ResourceTable;
}

/// The world, then WASI 0.2 without sockets: what a component may import, and nothing else.
fn link(linker: &mut Linker<CallState>) -> wasmtime::Result<()> {
    super::state::add_world_to_linker(linker)?;

    wasmtime_wasi_io::bindings::wasi::io::error::add_to_linker::<CallState, HasTable>(
        linker,
        |t| t.ctx().table,
    )?;
    wasmtime_wasi_io::bindings::wasi::io::poll::add_to_linker::<CallState, HasTable>(
        linker,
        |t| t.ctx().table,
    )?;
    wasmtime_wasi_io::bindings::wasi::io::streams::add_to_linker::<CallState, HasTable>(
        linker,
        |t| t.ctx().table,
    )?;

    clocks::wall_clock::add_to_linker::<CallState, WasiClocks>(linker, CallState::clocks)?;
    clocks::monotonic_clock::add_to_linker::<CallState, WasiClocks>(linker, CallState::clocks)?;
    random::random::add_to_linker::<CallState, WasiRandom>(linker, CallState::random)?;
    random::insecure::add_to_linker::<CallState, WasiRandom>(linker, CallState::random)?;
    random::insecure_seed::add_to_linker::<CallState, WasiRandom>(linker, CallState::random)?;
    // No preopened directory is ever added, so these give a component no file at all.
    filesystem::preopens::add_to_linker::<CallState, WasiFilesystem>(
        linker,
        CallState::filesystem,
    )?;
    filesystem::types::add_to_linker::<CallState, WasiFilesystem>(linker, CallState::filesystem)?;
    cli::exit::add_to_linker::<CallState, WasiCli>(linker, CallState::cli)?;
    cli::environment::add_to_linker::<CallState, WasiCli>(linker, CallState::cli)?;
    cli::stdin::add_to_linker::<CallState, WasiCli>(linker, CallState::cli)?;
    cli::stdout::add_to_linker::<CallState, WasiCli>(linker, CallState::cli)?;
    cli::stderr::add_to_linker::<CallState, WasiCli>(linker, CallState::cli)?;
    cli::terminal_input::add_to_linker::<CallState, WasiCli>(linker, CallState::cli)?;
    cli::terminal_output::add_to_linker::<CallState, WasiCli>(linker, CallState::cli)?;
    cli::terminal_stdin::add_to_linker::<CallState, WasiCli>(linker, CallState::cli)?;
    cli::terminal_stdout::add_to_linker::<CallState, WasiCli>(linker, CallState::cli)?;
    cli::terminal_stderr::add_to_linker::<CallState, WasiCli>(linker, CallState::cli)?;
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::shared;
    use std::process::Command;

    /// Set in the child process the test below starts.
    const CHILD: &str = "UMBEL_ENGINE_SIGNAL_CHILD";
    const NAME: &str =
        "plugins::component::engine::tests::the_engine_lives_through_signals_to_any_of_its_threads";

    /// A process with the engine and a `SIGCHLD` handler (tokio installs one to reap children)
    /// takes a flood of `SIGCHLD`, which the OS hands to any thread of the process. Wasmtime 48's
    /// Mach exception thread on macOS aborted when one landed on it (`mach_msg` returns
    /// `MACH_RCV_INTERRUPTED`), which aborted Umbel's `it` binary beside the mounted tests (#2458).
    #[test]
    fn the_engine_lives_through_signals_to_any_of_its_threads() {
        if std::env::var_os(CHILD).is_some() {
            child();
            return;
        }
        let output = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", NAME, "--nocapture", "--test-threads=1"])
            .env(CHILD, "1")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "the child did not live through the signals: {}\n{}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(
            String::from_utf8_lossy(&output.stdout).contains("1 passed"),
            "the child ran the test: {}",
            String::from_utf8_lossy(&output.stdout)
        );
    }

    fn child() {
        assert!(shared().is_ok(), "the engine");
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let _handler =
                tokio::signal::unix::signal(tokio::signal::unix::SignalKind::child()).unwrap();
            let status = Command::new("sh")
                .args([
                    "-c",
                    "i=0; while [ $i -lt 3000 ]; do kill -s CHLD \"$0\" || exit 1; i=$((i+1)); done",
                    &std::process::id().to_string(),
                ])
                .status()
                .unwrap();
            assert!(status.success(), "the signals were sent: {status}");
        });
    }
}

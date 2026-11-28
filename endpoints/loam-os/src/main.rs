//! `loam-os`: the Loam OS host, Umbel's command line with the `loamos` plugin compiled in and the
//! MCP server announced as `loam-os` (Umbel D206). Enable the plugin in the host's `umbel.toml`
//! with `plugins.enabled = ["loamos"]` and its configuration under `[plugins.loamos.config]`
//! (see `examples/umbel.toml`).
#![forbid(unsafe_code)]

use std::io::Write;

use umbel::cli::{Environment, is_serve, run};

#[tokio::main]
async fn main() {
    let environment = Environment::from_process();
    // The plugin keeps its records in the workspace's state, and the host journals each of its
    // commands by its policy (Umbel D224), reported live by `host-status`.
    let catalog = |builder: umbel::HostBuilder| {
        loam_os_host::install(
            builder,
            loam_os_host::plugin(),
            loam_os_host::journal_policies(),
        )
    };
    // Not `.lock()`: `serve --stdio` writes JSON-RPC through the same stdout from another
    // thread (as Umbel's own binaries do).
    let mut stdout = std::io::stdout();
    let code = {
        let mut work = Box::pin(run(std::env::args_os(), &environment, &mut stdout, catalog));
        if is_serve(std::env::args_os()) {
            work.await
        } else {
            tokio::select! {
                code = &mut work => code,
                _ = tokio::signal::ctrl_c() => 130,
            }
        }
    };
    let _ = stdout.flush();
    std::process::exit(code);
}

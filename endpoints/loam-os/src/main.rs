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
    let catalog = |builder: umbel::HostBuilder| {
        builder
            .with_compiled(umbel::plugins::sdk(loam_os_host::plugin()))
            .with_server_identity(loam_os_host::HOST_NAME, loam_os_host::HOST_VERSION)
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

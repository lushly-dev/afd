//! `umbel-knowledge`: the `umbel` command line with the `sources` and `knowledge` plugins compiled
//! in (decision D57). Enable them in `umbel.toml` with `plugins.enabled = ["sources",
//! "knowledge"]`; the stock `umbel` binary compiles in no plugin.
#![forbid(unsafe_code)]

use std::io::Write;

use umbel::cli::{Environment, is_serve, run};

#[tokio::main]
async fn main() {
    let environment = Environment::from_process();
    let catalog = |builder: umbel::HostBuilder| {
        builder
            .with_compiled(umbel::plugins::sdk(
                umbel_plugin_sources_filesystem::plugin(),
            ))
            .with_compiled(umbel::plugins::sdk(umbel_plugin_knowledge::plugin()))
    };
    // Not `.lock()`: `umbel serve --stdio` writes JSON-RPC through the same stdout from another
    // thread (the same reasoning as the stock binary's `main`).
    let mut stdout = std::io::stdout();
    let code = if is_serve(std::env::args_os()) {
        run(std::env::args_os(), &environment, &mut stdout, catalog).await
    } else {
        tokio::select! {
            code = run(std::env::args_os(), &environment, &mut stdout, catalog) => code,
            _ = tokio::signal::ctrl_c() => 130,
        }
    };
    let _ = stdout.flush();
    std::process::exit(code);
}

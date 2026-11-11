//! `umbel-first-party`: the `umbel` command line with the six first-party plugins compiled in,
//! `sources`, `knowledge`, `memory`, `context`, `components` and `curator` (decisions D57, D80,
//! D90 and D151). Enable
//! them in `umbel.toml` with `plugins.enabled` and allow their write grants for a space; the stock
//! `umbel` binary compiles in no plugin. It is what `umbel-hook` runs by default.
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
            .with_compiled(umbel::plugins::sdk(umbel_plugin_memory::plugin()))
            .with_compiled(umbel::plugins::sdk(umbel_plugin_context::plugin()))
            .with_compiled(umbel::plugins::sdk(umbel_plugin_components::plugin()))
            .with_compiled(umbel::plugins::sdk(umbel_plugin_curator::plugin()))
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

//! `umbel-memory`: the `umbel` command line with the `memory` plugin compiled
//! in (decisions D57 and D80). Enable it in `umbel.toml` with `plugins.enabled = ["memory"]` and
//! allow its `memory_write` grant for a space; the stock `umbel` binary compiles in no plugin.
#![forbid(unsafe_code)]

use std::io::Write;

use umbel::cli::{Environment, is_serve, run};

#[tokio::main]
async fn main() {
    let environment = Environment::from_process();
    let catalog = |builder: umbel::HostBuilder| {
        builder.with_compiled(umbel::plugins::sdk(umbel_plugin_memory::plugin()))
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

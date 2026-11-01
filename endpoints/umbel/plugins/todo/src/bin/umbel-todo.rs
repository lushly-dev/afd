//! `umbel-todo`: the `umbel` command line with the todo plugin compiled in, for the todo example's
//! conformance suite (`--backend umbel`). Enable the plugin in `umbel.toml` with
//! `plugins.enabled = ["todo"]`. The reference hello plugin is in the catalog too and loads only
//! when `plugins.enabled` names it, so the external-client checks can serve both from one binary.
#![forbid(unsafe_code)]

use std::io::Write;

use umbel::cli::{Environment, is_serve, run};

#[tokio::main]
async fn main() {
    let environment = Environment::from_process();
    let catalog = |builder: umbel::HostBuilder| {
        builder
            .with_compiled(umbel_plugin_todo::plugin())
            .with_compiled(umbel::plugins::sdk(umbel_plugin_hello::plugin()))
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

//! The `umbel` binary: the command line of [`umbel::cli`].

use std::io::Write;
use umbel::cli::{Environment, is_serve, run};

#[tokio::main]
async fn main() {
    let environment = Environment::from_process();
    // Not `.lock()`: `umbel serve --stdio` writes JSON-RPC through the same stdout from another
    // thread, which a lock held here for the whole run would block for good.
    let mut stdout = std::io::stdout();
    let code = if is_serve(std::env::args_os()) {
        // `serve` handles SIGINT and SIGTERM itself and exits 0.
        run(std::env::args_os(), &environment, &mut stdout, |builder| {
            builder
        })
        .await
    } else {
        tokio::select! {
            code = run(std::env::args_os(), &environment, &mut stdout, |builder| builder) => code,
            // A one-shot command interrupted with Ctrl+C.
            _ = tokio::signal::ctrl_c() => 130,
        }
    };
    let _ = stdout.flush();
    // Exit here rather than return: the runtime would wait for a blocking read of stdin that
    // nothing can cancel (a stdio server stopped by a signal, a prompt interrupted by Ctrl+C).
    std::process::exit(code);
}

//! The `umbel` binary: the command line of [`umbel::cli`].

use std::process::ExitCode;
use umbel::cli::{Environment, run};

#[tokio::main]
async fn main() -> ExitCode {
    let environment = Environment::from_process();
    let mut stdout = std::io::stdout().lock();
    let code = tokio::select! {
        code = run(std::env::args_os(), &environment, &mut stdout, |builder| builder) => code,
        // A one-shot command interrupted with Ctrl+C.
        _ = tokio::signal::ctrl_c() => 130,
    };
    ExitCode::from(u8::try_from(code).unwrap_or(1))
}

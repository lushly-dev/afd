//! `loam-mail`, the engine's program.

use std::io::IsTerminal;
use std::process::ExitCode;
use std::sync::Arc;

use loam_mail::cli::Caller;
use loam_mail::engine::Engine;
use loam_mail::home::Home;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let home = Home::resolve(|name| std::env::var(name).ok()).ok();
    let mut engine = Engine::new(home);
    if std::io::stderr().is_terminal() {
        engine = engine.with_progress(Arc::new(|line| eprintln!("{line}")));
    }
    let registry = match loam_mail::registry(&Arc::new(engine)) {
        Ok(registry) => registry,
        Err(broken) => {
            eprintln!(
                "{}: the command registry breaks its rules:\n{broken}",
                loam_mail::PROGRAM
            );
            return ExitCode::FAILURE;
        }
    };
    let caller = if std::io::stdin().is_terminal() {
        Caller::Terminal
    } else {
        Caller::Script
    };
    let mut out = std::io::stdout().lock();
    let mut err = std::io::stderr().lock();
    match loam_mail::cli::run(&args, &registry, caller, &mut out, &mut err) {
        Ok(status) => ExitCode::from(status),
        // A closed pipe (`loam-mail help | head -1`) is not a failure to report.
        Err(_) => ExitCode::FAILURE,
    }
}

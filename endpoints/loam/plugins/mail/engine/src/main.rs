//! `loam-mail`, the engine's program.

use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let registry = match loam_mail::registry() {
        Ok(registry) => registry,
        Err(broken) => {
            eprintln!(
                "{}: the command registry breaks its rules:\n{broken}",
                loam_mail::PROGRAM
            );
            return ExitCode::FAILURE;
        }
    };
    let mut out = std::io::stdout().lock();
    let mut err = std::io::stderr().lock();
    match loam_mail::cli::run(&args, &registry, &mut out, &mut err) {
        Ok(status) => ExitCode::from(status),
        // A closed pipe (`loam-mail help | head -1`) is not a failure to report.
        Err(_) => ExitCode::FAILURE,
    }
}

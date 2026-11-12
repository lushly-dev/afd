//! `loam-mail`, the engine's program.

use std::io::{IsTerminal, Write};
use std::process::ExitCode;
use std::sync::Arc;

use loam_mail::cli::{Caller, Tty};
use loam_mail::engine::Engine;
use loam_mail::home::Home;
use loam_mail::provider::ProviderError;
use loam_mail::provider::imap::{Credentials, Endpoint, ICLOUD_NAMES, ImapConnector};
use loam_mail::secrets::{Keychain, Secrets, account_key};

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let home = Home::resolve(|name| std::env::var(name).ok()).ok();
    let secrets: Arc<dyn Secrets> = Arc::new(Keychain);
    // An account signs in with what the keychain holds for it; iCloud's user
    // name is the address.
    let keychain = Arc::clone(&secrets);
    let icloud = ImapConnector::new(Endpoint::icloud(), ICLOUD_NAMES, move |account| {
        let key = account_key(&account.provider, &account.address);
        match keychain.get(&key) {
            Ok(Some(password)) => Ok(Credentials {
                user: account.address.clone(),
                password,
            }),
            Ok(None) => Err(ProviderError::NoCredential),
            Err(_) => Err(ProviderError::Keychain),
        }
    });
    let mut engine = Engine::new(home)
        .with_connector(Arc::new(icloud))
        .with_secrets(Arc::clone(&secrets));
    if std::io::stderr().is_terminal() {
        engine = engine.with_progress(Arc::new(|line| eprintln!("{line}")));
    }
    let registry = match loam_mail::registry(&Arc::new(engine)) {
        Ok(registry) => registry,
        Err(broken) => {
            eprintln!(
                "{}: the command registry could not be built:\n{broken}",
                loam_mail::PROGRAM
            );
            return ExitCode::FAILURE;
        }
    };
    let mut tty = Tty;
    let caller = if std::io::stdin().is_terminal() {
        Caller::Terminal(&mut tty)
    } else {
        Caller::Script
    };
    let mut out = std::io::stdout().lock();
    let mut err = std::io::stderr().lock();
    match loam_mail::cli::run(
        &args,
        &registry,
        caller,
        secrets.as_ref(),
        &mut out,
        &mut err,
    ) {
        Ok(status) => ExitCode::from(status),
        // A closed pipe (`loam-mail help | head -1`) is not a failure to report.
        Err(error) if error.kind() == std::io::ErrorKind::BrokenPipe => ExitCode::FAILURE,
        Err(error) => {
            let _ = writeln!(err, "{}: {error}", loam_mail::PROGRAM);
            ExitCode::FAILURE
        }
    }
}

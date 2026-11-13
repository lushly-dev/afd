//! `loam-mail`, the engine's program.

use std::io::{IsTerminal, Write};
use std::process::ExitCode;
use std::sync::Arc;

use afd::CommandRegistry;
use loam_mail::cli::{Caller, Runner, Tty};
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
    let mut engine = Engine::new(home.clone())
        .with_connector(Arc::new(icloud))
        .with_secrets(Arc::clone(&secrets));
    if std::io::stderr().is_terminal() {
        engine = engine.with_progress(Arc::new(|line| eprintln!("{line}")));
    }
    let engine = Arc::new(engine);
    let registry = match loam_mail::registry(&engine) {
        Ok(registry) => registry,
        Err(broken) => {
            eprintln!(
                "{}: the command registry could not be built:\n{broken}",
                loam_mail::PROGRAM
            );
            return ExitCode::FAILURE;
        }
    };
    match args.first().map(String::as_str) {
        Some("serve") => return serve(&args[1..], engine, registry),
        Some("mcp") if args.len() == 1 => return mcp(&engine, registry),
        _ => {}
    }
    // A command opens the store before it runs, to learn whether a server
    // owns it; if one does, the call goes to the server instead.
    let server = match args.first() {
        Some(name) if is_command(&registry, name) => match engine.open_store() {
            Err(loam_mail::store::StoreError::InUse) => {
                home.as_ref().and_then(loam_mail::forward::Server::find)
            }
            _ => None,
        },
        _ => None,
    };
    let local = loam_mail::cli::Local(&registry);
    let runner: &(dyn Runner + Sync) = match &server {
        Some(server) => server,
        None => &local,
    };
    let mut tty = Tty;
    let caller = if std::io::stdin().is_terminal() {
        Caller::Terminal(&mut tty)
    } else {
        Caller::Script
    };
    let mut out = std::io::stdout().lock();
    let mut err = std::io::stderr().lock();
    match loam_mail::cli::run_on(
        &args,
        &registry,
        runner,
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

/// Whether `name` is a command the command line may run.
fn is_command(registry: &CommandRegistry, name: &str) -> bool {
    registry
        .list()
        .iter()
        .any(|command| command.name == name && command.expose.cli)
}

/// The runtime a server runs on: several threads, so that a command that
/// waits for the store holds up no other request.
fn server_runtime() -> std::io::Result<tokio::runtime::Runtime> {
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
}

/// `loam-mail serve [--port N]`.
fn serve(args: &[String], engine: Arc<Engine>, registry: CommandRegistry) -> ExitCode {
    let port = match args {
        [] => 0,
        [flag, port] if flag == "--port" => match port.parse::<u16>() {
            Ok(port) => port,
            Err(_) => {
                eprintln!("{}: `--port` takes a port number.", loam_mail::PROGRAM);
                return ExitCode::from(loam_mail::cli::EXIT_USAGE);
            }
        },
        _ => {
            eprintln!("{}: `serve` takes only `--port N`.", loam_mail::PROGRAM);
            return ExitCode::from(loam_mail::cli::EXIT_USAGE);
        }
    };
    let runtime = match server_runtime() {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("{}: {error}", loam_mail::PROGRAM);
            return ExitCode::FAILURE;
        }
    };
    // Listening for a request to end starts before the store is taken, so
    // one that comes after the server writes its files reaches the code
    // that removes them.
    let stop = {
        let _inside = runtime.enter();
        loam_mail::cli::stopped()
    };
    let served = runtime.block_on(loam_mail::serve::serve(
        engine,
        Arc::new(registry),
        port,
        stop,
        |line| eprintln!("{}: {line}", loam_mail::PROGRAM),
    ));
    match served {
        Ok(()) => ExitCode::SUCCESS,
        Err(problem) => {
            eprintln!("{}: {problem}", loam_mail::PROGRAM);
            ExitCode::FAILURE
        }
    }
}

/// `loam-mail mcp`.
fn mcp(engine: &Engine, registry: CommandRegistry) -> ExitCode {
    let runtime = match server_runtime() {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("{}: {error}", loam_mail::PROGRAM);
            return ExitCode::FAILURE;
        }
    };
    match runtime.block_on(loam_mail::serve::serve_stdio(engine, Arc::new(registry))) {
        Ok(()) => ExitCode::SUCCESS,
        Err(problem) => {
            eprintln!("{}: {problem}", loam_mail::PROGRAM);
            ExitCode::FAILURE
        }
    }
}

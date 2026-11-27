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
use loam_mail::provider::smtp::{SmtpEndpoint, SmtpSender};
use loam_mail::secrets::{Keychain, Secrets, account_key};

fn main() -> ExitCode {
    // Everything the program creates is its owner's alone (the specification's
    // 3.1), including the files of libraries that use the default mode, such as
    // the search index's.
    #[cfg(unix)]
    rustix::process::umask(rustix::fs::Mode::from_raw_mode(0o077));
    let args: Vec<String> = std::env::args().skip(1).collect();

    #[cfg(feature = "test-doubles")]
    if args.first().map(String::as_str) == Some("test-world") {
        return test_world(&args[1..]);
    }

    let is_meta = matches!(
        args.first().map(String::as_str),
        None | Some("help" | "--help" | "-h" | "version" | "--version" | "-V")
    );

    let home = Home::resolve(|name| std::env::var(name).ok()).ok();

    let (secrets, imap_endpoint, smtp_endpoint, unsubscribe_poster, transport_tag) =
        match build_transport(is_meta) {
            Ok(transport) => transport,
            Err(problem) => {
                eprintln!("{}: {problem}", loam_mail::PROGRAM);
                return ExitCode::FAILURE;
            }
        };

    // An account signs in with what the keychain (or test secrets file) holds
    // for it; iCloud's user name is the address.
    let keychain = Arc::clone(&secrets);
    let icloud = ImapConnector::new(imap_endpoint, ICLOUD_NAMES, move |account| {
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
        .with_secrets(Arc::clone(&secrets))
        .with_transport_tag(transport_tag)
        // A change run at the terminal stops after the batch in hand on Ctrl-C.
        .with_interrupts();
    if let Some(smtp_endpoint) = smtp_endpoint {
        let smtp_keychain = Arc::clone(&secrets);
        let smtp = SmtpSender::new(smtp_endpoint, move |account| {
            let key = account_key(&account.provider, &account.address);
            match smtp_keychain.get(&key) {
                Ok(Some(password)) => Ok(Credentials {
                    user: account.address.clone(),
                    password,
                }),
                Ok(None) => Err(ProviderError::NoCredential),
                Err(_) => Err(ProviderError::Keychain),
            }
        });
        engine = engine.with_sender(Arc::new(smtp));
    }
    if let Some(poster) = unsubscribe_poster {
        engine = engine.with_unsubscribe_poster(poster);
    }
    if std::io::stderr().is_terminal() {
        engine = engine.with_progress(Arc::new(|line| eprintln!("{line}")));
    }
    let engine = Arc::new(engine);
    match args.first().map(String::as_str) {
        Some("pair") => {
            let mut out = std::io::stdout().lock();
            let mut err = std::io::stderr().lock();
            return match loam_mail::pair::run_pair_cli(
                &args[1..],
                &engine,
                home.as_ref(),
                &mut out,
                &mut err,
            ) {
                Ok(status) => ExitCode::from(status),
                Err(error) if error.kind() == std::io::ErrorKind::BrokenPipe => ExitCode::FAILURE,
                Err(error) => {
                    let _ = writeln!(err, "{}: {error}", loam_mail::PROGRAM);
                    ExitCode::FAILURE
                }
            };
        }
        Some("unpair") => {
            let mut out = std::io::stdout().lock();
            let mut err = std::io::stderr().lock();
            return match loam_mail::pair::run_unpair_cli(
                &args[1..],
                &engine,
                home.as_ref(),
                &mut out,
                &mut err,
            ) {
                Ok(status) => ExitCode::from(status),
                Err(error) if error.kind() == std::io::ErrorKind::BrokenPipe => ExitCode::FAILURE,
                Err(error) => {
                    let _ = writeln!(err, "{}: {error}", loam_mail::PROGRAM);
                    ExitCode::FAILURE
                }
            };
        }
        _ => {}
    }
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
    // owns it; if one does, the call goes to the server instead, provided both
    // use the same transport (real vs. test-doubles endpoints).
    let server = match args.first() {
        Some(name) if is_command(&registry, name) => match engine.open_store() {
            Err(loam_mail::store::StoreError::InUse) => {
                home.as_ref().and_then(loam_mail::forward::Server::find)
            }
            _ => None,
        },
        _ => None,
    };
    if let Some(server) = &server
        && server.transport() != engine.transport_tag()
    {
        eprintln!(
            "{}: a running server owns the store with a different transport configuration (`{}` vs `{}`); stop the server or match its environment before running commands.",
            loam_mail::PROGRAM,
            server.transport(),
            engine.transport_tag()
        );
        return ExitCode::FAILURE;
    }
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

type Transport = (
    Arc<dyn Secrets>,
    Endpoint,
    Option<SmtpEndpoint>,
    Option<Arc<dyn loam_mail::provider::http::UnsubscribePoster>>,
    String,
);

/// Builds the sign-in store and provider endpoints. Under `test-doubles`,
/// honours `LOAM_MAIL_TEST_SECRETS` + `LOAM_MAIL_TEST_ENDPOINTS` (both or
/// neither; loopback IP literals only; never silently falling back on empty or
/// non-UTF-8 values). Without `test-doubles`, ignores both variables and always
/// uses the real keychain and iCloud endpoints.
fn build_transport(is_meta: bool) -> Result<Transport, String> {
    #[cfg(feature = "test-doubles")]
    if !is_meta
        && let Some(config) =
            loam_mail::doubles::config::TestDoubleConfig::from_env(|name| std::env::var_os(name))?
    {
        let tag = config.transport_tag();
        let imap = Endpoint {
            host: config.endpoints.imap.ip().to_string(),
            port: config.endpoints.imap.port(),
            tls: false,
        };
        let smtp = config
            .endpoints
            .smtp
            .map(|addr| SmtpEndpoint::plain(addr.ip().to_string(), addr.port()));
        let poster: Arc<dyn loam_mail::provider::http::UnsubscribePoster> =
            match config.endpoints.http {
                Some(addr) => Arc::new(loam_mail::provider::http::HttpsPoster::for_test_endpoint(
                    addr,
                )),
                None => Arc::new(loam_mail::doubles::config::RefusingPoster),
            };
        return Ok((Arc::new(config.secrets), imap, smtp, Some(poster), tag));
    }
    #[cfg(not(feature = "test-doubles"))]
    let _ = is_meta;
    Ok((
        Arc::new(Keychain),
        Endpoint::icloud(),
        Some(SmtpEndpoint::icloud()),
        None,
        "real".to_string(),
    ))
}

#[cfg(feature = "test-doubles")]
fn test_world(args: &[String]) -> ExitCode {
    let (seed, home, out) = match loam_mail::doubles::world::parse_args(args) {
        Ok(parsed) => parsed,
        Err(problem) => {
            eprintln!("{}: {problem}", loam_mail::PROGRAM);
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
    let stop = {
        let _inside = runtime.enter();
        loam_mail::cli::stopped()
    };
    let result = runtime.block_on(async move {
        let running = loam_mail::doubles::world::start_world(&seed, &home, &out).await?;
        let line = serde_json::to_string(&running.outputs).map_err(|error| error.to_string())?;
        {
            let mut stdout = std::io::stdout().lock();
            writeln!(stdout, "{line}").map_err(|error| error.to_string())?;
            stdout.flush().map_err(|error| error.to_string())?;
        }
        stop.await;
        drop(running);
        Ok::<(), String>(())
    });
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(problem) => {
            eprintln!("{}: {problem}", loam_mail::PROGRAM);
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
fn serve(args: &[String], engine: Arc<Engine>, registry: Arc<CommandRegistry>) -> ExitCode {
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
        registry,
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
fn mcp(engine: &Arc<Engine>, registry: Arc<CommandRegistry>) -> ExitCode {
    let runtime = match server_runtime() {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("{}: {error}", loam_mail::PROGRAM);
            return ExitCode::FAILURE;
        }
    };
    match runtime.block_on(loam_mail::serve::serve_stdio(engine, registry)) {
        Ok(()) => ExitCode::SUCCESS,
        Err(problem) => {
            eprintln!("{}: {problem}", loam_mail::PROGRAM);
            ExitCode::FAILURE
        }
    }
}

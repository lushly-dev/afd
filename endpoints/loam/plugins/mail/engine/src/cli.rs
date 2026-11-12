//! The command line's entry point.
//!
//! It answers `help` and `version`, and runs a command the registry exposes
//! to the command line: `loam-mail <command> [input]`, where the input is a
//! JSON object. `serve` and `mcp` arrive with later steps, and with them the
//! forwarding of a command to a running server; until then a command opens
//! the store itself.
//!
//! A person's command (the specification's section 3.5) is held by the
//! approval middleware. At a terminal the command line shows what will
//! happen, in the engine's words, asks, and on "yes" runs it again with the
//! approval. A secret the command needs, such as an account's app-specific
//! password, is asked for then, without echo, and kept in the keychain: it
//! never passes through the command. With no terminal the command fails with
//! `PERSON_REQUIRED`.

use std::io::Write;

use afd::{ActorKind, CommandContext, CommandError, CommandInterface, CommandRegistry, failure};

/// What a person at a terminal asks of a command's output budget: more than
/// any command allows, so each gives its largest.
const PERSON_BUDGET: u64 = 1 << 40;

use crate::PROGRAM;
use crate::commands::credential_for;
use crate::secrets::Secrets;

/// Exit status of a run that did what was asked.
pub const EXIT_OK: u8 = 0;
/// Exit status of a command that ran and failed.
pub const EXIT_FAILED: u8 = 1;
/// Exit status of a run whose arguments were not understood.
pub const EXIT_USAGE: u8 = 2;
/// Exit status of a run the person stopped with Ctrl-C.
pub const EXIT_INTERRUPTED: u8 = 130;

/// A person at the terminal, who can be asked.
pub trait Person {
    /// Asks a yes-or-no question; anything but "y" or "yes" is no.
    ///
    /// # Errors
    /// When the terminal cannot be read or written.
    fn confirm(&mut self, question: &str) -> std::io::Result<bool>;

    /// Asks for a secret without showing it as it is typed.
    ///
    /// # Errors
    /// When the terminal cannot be read or written, or cannot stop echoing.
    fn secret(&mut self, prompt: &str) -> std::io::Result<String>;
}

/// Who is at the command line (the specification's section 3.3).
pub enum Caller<'a> {
    /// Standard input is a terminal: a person, who can be asked.
    Terminal(&'a mut dyn Person),
    /// It is not: a script.
    Script,
}

/// Runs the command line with `args` (the program's name already removed),
/// writing what was asked for to `out` and problems to `err`. Returns the exit
/// status.
///
/// # Errors
/// Returns an error only when writing to `out` or `err` fails.
pub fn run(
    args: &[String],
    registry: &CommandRegistry,
    caller: Caller<'_>,
    secrets: &dyn Secrets,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> std::io::Result<u8> {
    match args.first().map(String::as_str) {
        None | Some("help" | "--help" | "-h") => {
            write_help(registry, out)?;
            Ok(EXIT_OK)
        }
        Some("version" | "--version" | "-V") => {
            writeln!(out, "{PROGRAM} {}", env!("CARGO_PKG_VERSION"))?;
            Ok(EXIT_OK)
        }
        Some(name) if exposed(registry, name) => {
            run_command(name, &args[1..], registry, caller, secrets, out, err)
        }
        Some(other) => {
            // The argument is echoed with control characters removed, so that
            // text pasted from a message cannot rewrite the terminal.
            let shown: String = other.chars().filter(|c| !c.is_control()).take(64).collect();
            writeln!(
                err,
                "{PROGRAM}: `{shown}` is not something this build can do."
            )?;
            writeln!(err, "Run `{PROGRAM} help` to see what it can.")?;
            Ok(EXIT_USAGE)
        }
    }
}

/// Whether `name` is a command the registry exposes to the command line.
fn exposed(registry: &CommandRegistry, name: &str) -> bool {
    registry
        .list()
        .iter()
        .any(|command| command.name == name && command.expose.cli)
}

/// Runs one command through the registry and prints its result as JSON.
fn run_command(
    name: &str,
    rest: &[String],
    registry: &CommandRegistry,
    caller: Caller<'_>,
    secrets: &dyn Secrets,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> std::io::Result<u8> {
    let input = match rest {
        [] => serde_json::Value::Object(serde_json::Map::new()),
        [input] => match serde_json::from_str::<serde_json::Value>(input) {
            Ok(input @ serde_json::Value::Object(_)) => input,
            _ => {
                writeln!(err, "{PROGRAM}: the input of `{name}` is a JSON object.")?;
                return Ok(EXIT_USAGE);
            }
        },
        _ => {
            writeln!(
                err,
                "{PROGRAM}: `{name}` takes one input, a JSON object in quotes."
            )?;
            return Ok(EXIT_USAGE);
        }
    };
    let mut context = CommandContext::new()
        .with_interface(CommandInterface::Cli)
        .with_actor(match caller {
            Caller::Terminal(_) => ActorKind::Human,
            Caller::Script => ActorKind::Script,
        });
    // A person at a terminal reads what a command gives, not a model's
    // context: each command's largest budget, which the ask is clamped to.
    if matches!(caller, Caller::Terminal(_)) {
        context = context.with_output_budget_ask(PERSON_BUDGET);
    }
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let mut result = runtime.block_on(registry.execute(name, input.clone(), Some(context.clone())));
    if let Some((summary, token)) = held(&result) {
        match caller {
            Caller::Script => {
                result = failure(
                    CommandError::new(
                        "PERSON_REQUIRED",
                        format!("`{name}` is a person's command, and there is no terminal to ask"),
                    )
                    .with_suggestion("Run it at a terminal."),
                );
            }
            Caller::Terminal(person) => {
                writeln!(err, "{summary}.")?;
                if !person.confirm("Go ahead? [y/N] ")? {
                    writeln!(err, "Nothing was done.")?;
                    return Ok(EXIT_FAILED);
                }
                let mut token = token;
                // What the keychain held before: put back if the command fails
                // or is interrupted, so that a mistyped password never takes
                // the place of one that works.
                let mut kept = None;
                if let Some(ask) = credential_for(name, &input) {
                    // The keychain is asked first, so that a locked one is
                    // known before a password is typed.
                    let before = match secrets.get(&ask.key) {
                        Ok(before) => before,
                        Err(error) => {
                            writeln!(err, "{PROGRAM}: {error}. Nothing was done.")?;
                            return Ok(EXIT_FAILED);
                        }
                    };
                    let secret = person.secret(&ask.prompt)?;
                    if secret.is_empty() {
                        writeln!(err, "No password was given. Nothing was done.")?;
                        return Ok(EXIT_FAILED);
                    }
                    // Making the password may have taken a while: a fresh
                    // hold gives a fresh token.
                    let again = runtime.block_on(registry.execute(
                        name,
                        input.clone(),
                        Some(context.clone()),
                    ));
                    if let Some((_, fresh)) = held(&again) {
                        token = fresh;
                    }
                    writeln!(err, "Signing in to check it.")?;
                    // Kept just before the sign-in that checks it, which
                    // Ctrl-C can stop; it is put back below if it does.
                    if let Err(error) = secrets.set(&ask.key, &secret) {
                        writeln!(err, "{PROGRAM}: {error}. Nothing was done.")?;
                        return Ok(EXIT_FAILED);
                    }
                    kept = Some((ask.key, before));
                }
                let approved = context.with_approval(token);
                // The stop is listened for first, so that it is caught from
                // the start of the sign-in.
                let finished = runtime.block_on(async {
                    tokio::select! {
                        biased;
                        () = stopped() => None,
                        result = registry.execute(name, input, Some(approved)) => Some(result),
                    }
                });
                let interrupted = finished.is_none();
                if let Some(finished) = finished {
                    result = finished;
                }
                if let Some((key, before)) = kept
                    && (interrupted || !result.success)
                {
                    let restored = match before {
                        Some(before) => secrets.set(&key, &before),
                        None => secrets.delete(&key),
                    };
                    if let Err(error) = restored {
                        writeln!(
                            err,
                            "{PROGRAM}: {error}; the password just typed is still kept."
                        )?;
                    }
                }
                if interrupted {
                    writeln!(err, "Stopped. Nothing was added.")?;
                    return Ok(EXIT_INTERRUPTED);
                }
            }
        }
    }
    let mut rendered = serde_json::to_value(&result).map_err(std::io::Error::other)?;
    // A token is never printed: whoever holds one can run the command.
    if let Some(details) = rendered
        .pointer_mut("/error/details")
        .and_then(serde_json::Value::as_object_mut)
    {
        details.remove("approvalToken");
    }
    let rendered = serde_json::to_string_pretty(&rendered).map_err(std::io::Error::other)?;
    writeln!(out, "{rendered}")?;
    Ok(if result.success { EXIT_OK } else { EXIT_FAILED })
}

/// Waits until the person stops the program: Ctrl-C, or, on unix, the
/// terminal closing or a request to end. A signal that cannot be listened
/// for is never taken for one that came.
async fn stopped() {
    let interrupt = async {
        if tokio::signal::ctrl_c().await.is_err() {
            std::future::pending::<()>().await;
        }
    };
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        let other = async {
            match (
                signal(SignalKind::hangup()),
                signal(SignalKind::terminate()),
            ) {
                (Ok(mut hangup), Ok(mut terminate)) => {
                    tokio::select! {
                        _ = hangup.recv() => {}
                        _ = terminate.recv() => {}
                    }
                }
                _ => std::future::pending::<()>().await,
            }
        };
        tokio::select! {
            () = interrupt => {}
            () = other => {}
        }
    }
    #[cfg(not(unix))]
    interrupt.await;
}

/// The summary and token of a call the approval middleware held.
fn held(result: &afd::CommandResult<serde_json::Value>) -> Option<(String, String)> {
    let error = result.error.as_ref()?;
    if error.code != "APPROVAL_REQUIRED" {
        return None;
    }
    let details = error.details.as_ref()?;
    let token = details.get("approvalToken")?.as_str()?.to_string();
    let summary = details
        .get("summary")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("This command needs your approval")
        .to_string();
    Some((summary, token))
}

/// The terminal on standard input and standard error.
#[derive(Debug, Default, Clone, Copy)]
pub struct Tty;

impl Person for Tty {
    fn confirm(&mut self, question: &str) -> std::io::Result<bool> {
        let mut err = std::io::stderr().lock();
        write!(err, "{question}")?;
        err.flush()?;
        let mut answer = String::new();
        std::io::stdin().read_line(&mut answer)?;
        Ok(matches!(
            answer.trim().to_ascii_lowercase().as_str(),
            "y" | "yes"
        ))
    }

    fn secret(&mut self, prompt: &str) -> std::io::Result<String> {
        let mut err = std::io::stderr().lock();
        write!(err, "{prompt}")?;
        err.flush()?;
        let secret = read_without_echo()?;
        writeln!(err)?;
        Ok(secret)
    }
}

/// Reads a line from standard input with the terminal's echo off, and puts
/// the echo back on every path the program itself takes. A signal that ends
/// the process while it reads (Ctrl-C) leaves the echo off; an interactive
/// shell turns it back on when the program ends.
#[cfg(unix)]
fn read_without_echo() -> std::io::Result<String> {
    use rustix::termios::{LocalModes, OptionalActions, tcgetattr, tcsetattr};
    let stdin = std::io::stdin();
    let before = tcgetattr(&stdin)?;
    let mut quiet = before.clone();
    quiet.local_modes.remove(LocalModes::ECHO);
    tcsetattr(&stdin, OptionalActions::Now, &quiet)?;
    let mut line = String::new();
    let read = stdin.read_line(&mut line);
    tcsetattr(&stdin, OptionalActions::Now, &before)?;
    read?;
    Ok(line.trim_end_matches(['\r', '\n']).to_string())
}

/// Without a way to turn the echo off, no secret is read.
#[cfg(not(unix))]
fn read_without_echo() -> std::io::Result<String> {
    Err(std::io::Error::other(
        "this platform's terminal cannot hide a password yet",
    ))
}

/// Writes the help text: what the program is, how to call it, and the commands
/// the registry exposes to the command line.
fn write_help(registry: &CommandRegistry, out: &mut dyn Write) -> std::io::Result<()> {
    writeln!(
        out,
        "{PROGRAM}: your mail on this machine, as AFD commands."
    )?;
    writeln!(out)?;
    writeln!(out, "Usage:")?;
    writeln!(out, "  {PROGRAM} help                 Show this text")?;
    writeln!(out, "  {PROGRAM} version              Show the version")?;
    writeln!(
        out,
        "  {PROGRAM} <command> [input]    Run a command; the input is a JSON object"
    )?;
    writeln!(out)?;
    let mut commands: Vec<_> = registry
        .list()
        .into_iter()
        .filter(|command| command.expose.cli)
        .collect();
    commands.sort_by(|a, b| a.name.cmp(&b.name));
    if commands.is_empty() {
        writeln!(out, "Commands: none.")?;
    } else {
        writeln!(out, "Commands:")?;
        let width = commands.iter().map(|c| c.name.len()).max().unwrap_or(0);
        for command in commands {
            writeln!(out, "  {:width$}  {}", command.name, command.description)?;
        }
    }
    Ok(())
}

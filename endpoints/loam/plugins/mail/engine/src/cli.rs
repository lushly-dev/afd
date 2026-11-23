//! The command line's entry point.
//!
//! It answers `help` and `version`, and runs a command the registry exposes
//! to the command line: `loam-mail <command> [input]`, where the input is a
//! JSON object. The program runs a command itself when no server owns the
//! store, and forwards it to the running server's own route when one does
//! ([`Runner`]); either way it passes through the same registry, middleware
//! and journal. `serve` and `mcp` are the program's, in `main`.
//!
//! A person's command (the specification's section 3.5) is held by the
//! approval middleware. At a terminal the command line shows what will
//! happen, in the engine's words, asks, and on "yes" runs it again with the
//! approval. A secret the command needs, such as an account's app-specific
//! password, is asked for then, without echo, and kept in the keychain: it
//! never passes through the command. With no terminal the command fails with
//! `PERSON_REQUIRED`.

use std::io::Write;

use afd::{
    ActorKind, CommandContext, CommandError, CommandInterface, CommandRegistry, CommandResult,
    failure,
};
use async_trait::async_trait;

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

    /// Reads one line of text from the terminal (for example, typing a new
    /// recipient address to confirm it for a send).
    ///
    /// # Errors
    /// When the terminal cannot be read or written.
    fn type_text(&mut self, _prompt: &str) -> std::io::Result<String> {
        Ok(String::new())
    }
}

/// Where the command line's commands run.
#[async_trait]
pub trait Runner {
    /// Runs `name` with `input` as the command line: a person's when
    /// `terminal`, a script's otherwise, with the approval of a held call
    /// the person said yes to.
    async fn run(
        &self,
        name: &str,
        input: serde_json::Value,
        terminal: bool,
        approval: Option<String>,
    ) -> CommandResult<serde_json::Value>;
}

/// The context a command runs with at the command line, in this process or
/// on a server's route for it (the specification's 3.3).
#[must_use]
pub fn command_line_context(terminal: bool) -> CommandContext {
    let context = CommandContext::new()
        .with_interface(CommandInterface::Cli)
        .with_actor(if terminal {
            ActorKind::Human
        } else {
            ActorKind::Script
        });
    // A person at a terminal reads what a command gives, not a model's
    // context: each command's largest budget, which the ask is clamped to.
    if terminal {
        context.with_output_budget_ask(PERSON_BUDGET)
    } else {
        context
    }
}

/// Runs commands on a registry in this process.
pub struct Local<'a>(pub &'a CommandRegistry);

#[async_trait]
impl Runner for Local<'_> {
    async fn run(
        &self,
        name: &str,
        input: serde_json::Value,
        terminal: bool,
        approval: Option<String>,
    ) -> CommandResult<serde_json::Value> {
        let mut context = command_line_context(terminal);
        if let Some(approval) = approval {
            context = context.with_approval(approval);
        }
        self.0.execute(name, input, Some(context)).await
    }
}

/// Runs commands on the server that owns the store.
#[async_trait]
impl Runner for crate::forward::Server {
    async fn run(
        &self,
        name: &str,
        input: serde_json::Value,
        terminal: bool,
        approval: Option<String>,
    ) -> CommandResult<serde_json::Value> {
        self.call(&crate::serve::Forwarded {
            command: name.to_string(),
            input,
            terminal,
            approval,
        })
        .await
    }
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
    run_on(args, registry, &Local(registry), caller, secrets, out, err)
}

/// [`run`], running each command through `runner`: this process's
/// registry, or a running server. `registry` still answers `help` and says
/// which commands the command line may run.
///
/// # Errors
/// Returns an error only when writing to `out` or `err` fails.
pub fn run_on(
    args: &[String],
    registry: &CommandRegistry,
    runner: &(dyn Runner + Sync),
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
            if crate::BUILD_FEATURES.is_empty() {
                writeln!(out, "{PROGRAM} {}", env!("CARGO_PKG_VERSION"))?;
            } else {
                writeln!(
                    out,
                    "{PROGRAM} {} (features: {})",
                    env!("CARGO_PKG_VERSION"),
                    crate::BUILD_FEATURES.join(", ")
                )?;
            }
            Ok(EXIT_OK)
        }
        Some(name) if exposed(registry, name) => {
            run_command(name, &args[1..], runner, caller, secrets, out, err)
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

/// Parses command arguments: an optional JSON object input, plus `--out <file>`
/// for `mail-token-create` alone (plugin.spec.md, section 4.1).
fn parse_command_args(
    name: &str,
    rest: &[String],
    err: &mut dyn Write,
) -> std::io::Result<Result<(serde_json::Value, Option<std::path::PathBuf>), u8>> {
    let mut json_arg: Option<&str> = None;
    let mut out_path: Option<std::path::PathBuf> = None;
    let mut index = 0;
    while index < rest.len() {
        let arg = &rest[index];
        if arg == "--out" {
            if name != crate::tokens::CREATE {
                writeln!(
                    err,
                    "{PROGRAM}: `--out` is only supported for `{}`.",
                    crate::tokens::CREATE
                )?;
                return Ok(Err(EXIT_USAGE));
            }
            if out_path.is_some() {
                writeln!(err, "{PROGRAM}: `--out` may be given only once.")?;
                return Ok(Err(EXIT_USAGE));
            }
            let Some(path) = rest.get(index + 1) else {
                writeln!(err, "{PROGRAM}: `--out` requires a file path.")?;
                return Ok(Err(EXIT_USAGE));
            };
            if path.is_empty() {
                writeln!(err, "{PROGRAM}: `--out` requires a non-empty file path.")?;
                return Ok(Err(EXIT_USAGE));
            }
            out_path = Some(std::path::PathBuf::from(path));
            index += 2;
            continue;
        }
        if json_arg.is_some() {
            writeln!(
                err,
                "{PROGRAM}: `{name}` takes one input, a JSON object in quotes."
            )?;
            return Ok(Err(EXIT_USAGE));
        }
        json_arg = Some(arg.as_str());
        index += 1;
    }
    let input = match json_arg {
        None => serde_json::Value::Object(serde_json::Map::new()),
        Some(raw) => match serde_json::from_str::<serde_json::Value>(raw) {
            Ok(input @ serde_json::Value::Object(_)) => input,
            _ => {
                writeln!(err, "{PROGRAM}: the input of `{name}` is a JSON object.")?;
                return Ok(Err(EXIT_USAGE));
            }
        },
    };
    Ok(Ok((input, out_path)))
}

/// Checks whether `--out <path>` can be used on this platform and that no file
/// exists there yet, before asking the person or creating a token.
fn check_token_out_path(path: &std::path::Path, err: &mut dyn Write) -> std::io::Result<bool> {
    #[cfg(not(unix))]
    {
        let _ = path;
        writeln!(
            err,
            "{PROGRAM}: `--out` is refused on this platform because owner-only file access lists are not yet supported; omit `--out` to print the token once."
        )?;
        Ok(false)
    }
    #[cfg(unix)]
    {
        if let Some(parent) = path.parent()
            && !parent.as_os_str().is_empty()
            && !parent.is_dir()
        {
            writeln!(
                err,
                "{PROGRAM}: parent directory `{}` does not exist for `--out`.",
                parent.display()
            )?;
            return Ok(false);
        }
        match std::fs::symlink_metadata(path) {
            Ok(_) => {
                writeln!(
                    err,
                    "{PROGRAM}: `{}` already exists; `--out` refuses to overwrite an existing file.",
                    path.display()
                )?;
                Ok(false)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(true),
            Err(error) => {
                writeln!(
                    err,
                    "{PROGRAM}: cannot inspect `{}`: {error}",
                    path.display()
                )?;
                Ok(false)
            }
        }
    }
}

/// Reserves a brand-new `0600` file at `path` (atomically via `create_new(true)`)
/// before issuing the token so concurrent creation or permission errors fail
/// before any active credential is created.
#[cfg(unix)]
fn reserve_token_out_file(path: &std::path::Path) -> std::io::Result<std::fs::File> {
    crate::home::private_file().create_new(true).open(path)
}

/// Writes `secret` into a previously reserved `0600` file and syncs it to disk.
#[cfg(unix)]
fn finish_token_out_file(file: &mut std::fs::File, secret: &str) -> std::io::Result<()> {
    file.write_all(secret.as_bytes())?;
    file.sync_all()?;
    Ok(())
}

/// Runs one command through the registry and prints its result as JSON.
fn run_command(
    name: &str,
    rest: &[String],
    runner: &(dyn Runner + Sync),
    caller: Caller<'_>,
    secrets: &dyn Secrets,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> std::io::Result<u8> {
    let (input, token_out) = match parse_command_args(name, rest, err)? {
        Ok(parsed) => parsed,
        Err(status) => return Ok(status),
    };
    if let Some(path) = token_out.as_deref()
        && !check_token_out_path(path, err)?
    {
        return Ok(EXIT_FAILED);
    }
    let terminal = matches!(caller, Caller::Terminal(_));
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    // A person's large change to mail is shown by its count, and asked
    // about, before it runs (the specification's 9.4).
    let mut caller = caller;
    let mut input = input;
    let mut preloaded_preview: Option<Vec<String>> = None;
    if let Caller::Terminal(person) = &mut caller
        && name == crate::drafts::SEND
    {
        match prepare_draft_send(&mut input, runner, &runtime, *person, err)? {
            DraftSendPrep::Ready(lines) => preloaded_preview = Some(lines),
            DraftSendPrep::Reject(error) => {
                let result: afd::CommandResult<serde_json::Value> = failure(error);
                let rendered =
                    serde_json::to_string_pretty(&result).map_err(std::io::Error::other)?;
                writeln!(out, "{rendered}")?;
                return Ok(EXIT_FAILED);
            }
            DraftSendPrep::Stop => return Ok(EXIT_FAILED),
        }
    }
    if let Caller::Terminal(_) = &mut caller
        && name == crate::unsubscribe::UNSUBSCRIBE
    {
        match prepare_unsubscribe(&mut input, runner, &runtime, err)? {
            DraftSendPrep::Ready(lines) => preloaded_preview = Some(lines),
            DraftSendPrep::Reject(error) => {
                let result: afd::CommandResult<serde_json::Value> = failure(error);
                let rendered =
                    serde_json::to_string_pretty(&result).map_err(std::io::Error::other)?;
                writeln!(out, "{rendered}")?;
                return Ok(EXIT_FAILED);
            }
            DraftSendPrep::Stop => return Ok(EXIT_FAILED),
        }
    }
    if let Caller::Terminal(_) = &mut caller
        && name == crate::replysets::SEND
    {
        match prepare_replyset_send(&mut input, runner, &runtime, err)? {
            DraftSendPrep::Ready(lines) => preloaded_preview = Some(lines),
            DraftSendPrep::Reject(error) => {
                let result: afd::CommandResult<serde_json::Value> = failure(error);
                let rendered =
                    serde_json::to_string_pretty(&result).map_err(std::io::Error::other)?;
                writeln!(out, "{rendered}")?;
                return Ok(EXIT_FAILED);
            }
            DraftSendPrep::Stop => return Ok(EXIT_FAILED),
        }
    }
    if let Caller::Terminal(person) = &mut caller
        && let Some(change) = large_change(name, &input, runner, &runtime)
    {
        writeln!(err, "{change}.")?;
        if !person.confirm("Go ahead? [y/N] ")? {
            writeln!(err, "Nothing was done.")?;
            return Ok(EXIT_FAILED);
        }
    }
    let mut result = runtime.block_on(runner.run(name, input.clone(), terminal, None));
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
                // A command whose detail comes through its preview is not
                // asked about without it.
                let Some(lines) = preloaded_preview
                    .take()
                    .or_else(|| preview(name, &input, runner, &runtime))
                else {
                    let why = if name == crate::operations::APPROVE {
                        "`mail-operation-show` with the operation"
                    } else if name == crate::drafts::SEND {
                        "`mail-draft-show` with the draft"
                    } else if name == crate::replysets::SEND {
                        "`mail-replyset-show` with the reply set"
                    } else if name == crate::unsubscribe::UNSUBSCRIBE {
                        "`mail-unsubscribe-show` with the message"
                    } else {
                        "`mail-sender-show` with the suggestion"
                    };
                    writeln!(
                        err,
                        "{PROGRAM}: `{name}` cannot go ahead now, or what it would do could not be read; {why} says why. Nothing was done."
                    )?;
                    return Ok(EXIT_FAILED);
                };
                for line in lines {
                    writeln!(err, "{line}")?;
                }
                // The summary is the engine's words, with a token's name, the
                // person's own; made safe all the same.
                let shown_summary = printable(&summary);
                if shown_summary.ends_with('.') {
                    writeln!(err, "{shown_summary}")?;
                } else {
                    writeln!(err, "{shown_summary}.")?;
                }
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
                    let again = runtime.block_on(runner.run(name, input.clone(), terminal, None));
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
                // Reserve the `--out` file atomically (`0600`, `create_new`)
                // right before issuing the token so concurrent creation or
                // permission errors fail before any active token is stored.
                #[cfg(unix)]
                let mut reserved_out: Option<std::fs::File> = None;
                #[cfg(unix)]
                if name == crate::tokens::CREATE
                    && let Some(path) = token_out.as_deref()
                {
                    match reserve_token_out_file(path) {
                        Ok(file) => reserved_out = Some(file),
                        Err(error) => {
                            writeln!(
                                err,
                                "{PROGRAM}: could not create `{}` for `--out`: {error}. Nothing was done.",
                                path.display()
                            )?;
                            return Ok(EXIT_FAILED);
                        }
                    }
                }
                // The stop is listened for first, so that it is caught from
                // the start of the sign-in.
                let finished = runtime.block_on(async {
                    tokio::select! {
                        biased;
                        () = stopped() => None,
                        result = runner.run(name, input, terminal, Some(token)) => Some(result),
                    }
                });
                let interrupted = finished.is_none();
                if let Some(finished) = finished {
                    result = finished;
                }
                #[cfg(unix)]
                if let Some(path) = token_out.as_deref()
                    && (interrupted || !result.success)
                {
                    drop(reserved_out.take());
                    let _ = std::fs::remove_file(path);
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
                    if name == crate::drafts::SEND {
                        writeln!(
                            err,
                            "Stopped. If the message was already handed over, check your Sent mailbox and mail-status before trying again."
                        )?;
                    } else if name == crate::replysets::SEND {
                        writeln!(
                            err,
                            "Stopped. Check your Sent mailbox, mail-replyset-show, and mail-status before trying again."
                        )?;
                    } else if name == crate::unsubscribe::UNSUBSCRIBE {
                        writeln!(
                            err,
                            "Stopped. If the unsubscribe request was already sent, check mail-status before trying again."
                        )?;
                    } else if name == "mail-account-add" {
                        writeln!(err, "Stopped. Nothing was added.")?;
                    } else {
                        writeln!(err, "Stopped.")?;
                    }
                    return Ok(EXIT_INTERRUPTED);
                }
                #[cfg(unix)]
                if result.success
                    && name == crate::tokens::CREATE
                    && let (Some(path), Some(mut file)) =
                        (token_out.as_deref(), reserved_out.take())
                {
                    let mut rendered =
                        serde_json::to_value(&result).map_err(std::io::Error::other)?;
                    let secret = rendered
                        .pointer_mut("/data")
                        .and_then(serde_json::Value::as_object_mut)
                        .and_then(|data| data.remove("secret"))
                        .and_then(|value| value.as_str().map(str::to_string));
                    let Some(secret) = secret else {
                        drop(file);
                        let _ = std::fs::remove_file(path);
                        writeln!(
                            err,
                            "{PROGRAM}: `mail-token-create` returned no token to write."
                        )?;
                        return Ok(EXIT_FAILED);
                    };
                    if let Err(error) = finish_token_out_file(&mut file, &secret) {
                        drop(file);
                        let _ = std::fs::remove_file(path);
                        let id = rendered
                            .pointer("/data/token")
                            .and_then(serde_json::Value::as_str)
                            .unwrap_or("unknown");
                        writeln!(
                            err,
                            "{PROGRAM}: could not write token {id} to `{}`: {error}; revoke it with `{PROGRAM} mail-token-revoke '{{\"token\":\"{id}\"}}'`.",
                            path.display()
                        )?;
                        return Ok(EXIT_FAILED);
                    }
                    if let Some(data) = rendered
                        .pointer_mut("/data")
                        .and_then(serde_json::Value::as_object_mut)
                    {
                        data.insert(
                            "out".to_string(),
                            serde_json::Value::String(path.display().to_string()),
                        );
                    }
                    let rendered =
                        serde_json::to_string_pretty(&rendered).map_err(std::io::Error::other)?;
                    writeln!(out, "{rendered}")?;
                    return Ok(EXIT_OK);
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
    if result.success && name == crate::tokens::CREATE && token_out.is_some() {
        // On Unix, `--out` is reserved before the held retry and written
        // directly in the approval branch above; never print a secret if
        // `mail-token-create` ever returns without passing through a hold.
        writeln!(
            err,
            "{PROGRAM}: `{name}` completed without an approval hold; refusing to print token with `--out`."
        )?;
        return Ok(EXIT_FAILED);
    }
    let rendered = serde_json::to_string_pretty(&rendered).map_err(std::io::Error::other)?;
    writeln!(out, "{rendered}")?;
    Ok(if result.success { EXIT_OK } else { EXIT_FAILED })
}

/// What completes when the person stops the program: Ctrl-C, or, on Unix,
/// the terminal closing or a request to end. It listens from the moment it
/// is called, not from when it is first awaited, so a signal that arrives in
/// between is not lost and does not end the process without its cleanup. A
/// signal that cannot be listened for is never taken for one that came.
///
/// Call it inside a Tokio runtime.
#[cfg(unix)]
pub fn stopped() -> impl std::future::Future<Output = ()> + Send + 'static {
    use tokio::signal::unix::{Signal, SignalKind, signal};
    async fn arrives(signal: Option<Signal>) {
        if let Some(mut signal) = signal
            && signal.recv().await.is_some()
        {
            return;
        }
        std::future::pending::<()>().await;
    }
    let [interrupt, hangup, terminate] = [
        SignalKind::interrupt(),
        SignalKind::hangup(),
        SignalKind::terminate(),
    ]
    .map(|kind| signal(kind).ok());
    async move {
        tokio::select! {
            () = arrives(interrupt) => {}
            () = arrives(hangup) => {}
            () = arrives(terminate) => {}
        }
    }
}

/// What completes when the person presses Ctrl-C. A signal that cannot be
/// listened for is never taken for one that came.
#[cfg(not(unix))]
pub async fn stopped() {
    if tokio::signal::ctrl_c().await.is_err() {
        std::future::pending::<()>().await;
    }
}

/// What the person reads before approving a command, beside its summary:
/// the values from mail the summary leaves out (the specification's 3.5),
/// each named as it is shown. Read with the command's preview command.
/// `None` when a command has a preview and it could not be read.
fn preview(
    name: &str,
    input: &serde_json::Value,
    runner: &(dyn Runner + Sync),
    runtime: &tokio::runtime::Runtime,
) -> Option<Vec<String>> {
    if name == crate::operations::APPROVE {
        return proposal_preview(input, runner, runtime);
    }
    if name != crate::screening::ACCEPT {
        return Some(Vec::new());
    }
    let suggestion = input.get("suggestion").cloned()?;
    let shown = runtime.block_on(runner.run(
        "mail-sender-show",
        serde_json::json!({ "suggestion": suggestion }),
        true,
        None,
    ));
    let shown = shown.data.filter(|_| shown.success)?;
    // A suggestion that cannot be accepted now (closed, screening not
    // ready, or its address now the person's) is not asked about.
    if shown.pointer("/preview/acceptable") != Some(&serde_json::Value::Bool(true)) {
        return None;
    }
    let text = |pointer: &str| {
        shown
            .pointer(pointer)
            .and_then(serde_json::Value::as_str)
            .map(printable)
            .unwrap_or_default()
    };
    let mut lines = vec![format!(
        "The sender's address, as written in its mail: {}",
        text("/content/address")
    )];
    let sender_name = text("/content/name");
    if !sender_name.is_empty() {
        lines.push(format!(
            "The sender's name, as written in its mail: {sender_name}"
        ));
    }
    let written = shown
        .pointer("/preview/written")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    lines.push(match written {
        0 => "You have never written to it.".to_string(),
        1 => "You have written to it once.".to_string(),
        n => format!("You have written to it {n} times."),
    });
    let proposer = |field: &str| {
        shown
            .pointer(&format!("/preview/proposer/{field}"))
            .and_then(serde_json::Value::as_str)
            .map(printable)
    };
    let by = match (proposer("name"), proposer("token")) {
        (Some(name), Some(token)) => format!("the agent with the token \"{name}\" ({token})"),
        (None, Some(token)) => format!("the agent with the token {token}"),
        _ => proposer("kind").map_or_else(
            || "an unknown caller".to_string(),
            |kind| format!("a caller of kind {kind}"),
        ),
    };
    lines.push(format!("Suggested by {by}."));
    Some(lines)
}

/// Who a result's proposer is, in words for the terminal: a token's name is
/// the person's own, and is shown made safe all the same.
fn proposer_line(proposer: Option<&serde_json::Value>) -> String {
    let field = |name: &str| {
        proposer
            .and_then(|proposer| proposer.get(name))
            .and_then(serde_json::Value::as_str)
            .map(printable)
    };
    match (field("kind").as_deref(), field("name"), field("token")) {
        (Some("agent"), Some(name), Some(token)) => {
            format!("the agent with the token \"{name}\" ({token})")
        }
        (Some("agent"), None, Some(token)) => format!("the agent with the token {token}"),
        (Some("agent"), _, None) => "the agent on standard input".to_string(),
        (Some("script"), _, _) => "a script at the command line".to_string(),
        (Some(kind), _, _) => format!("a caller of kind {kind}"),
        (None, _, _) => "an unknown caller".to_string(),
    }
}

/// What the person reads before approving a proposal (the specification's
/// 9.4): who proposed it, the query it was made with, where its messages
/// are and go, their classes, and a line of its own for mail from senders
/// the person knows. Text from mail, a mailbox's name or the query, is named
/// as it is shown. `None` when the proposal cannot be approved now.
fn proposal_preview(
    input: &serde_json::Value,
    runner: &(dyn Runner + Sync),
    runtime: &tokio::runtime::Runtime,
) -> Option<Vec<String>> {
    let id = crate::operations::operation_input(input)?;
    let shown = runtime.block_on(runner.run(
        "mail-operation-show",
        serde_json::json!({ "operation": id, "limit": 1 }),
        true,
        None,
    ));
    let shown = shown.data.filter(|_| shown.success)?;
    let preview = shown.get("preview")?;
    if preview.get("approvable") != Some(&serde_json::Value::Bool(true)) {
        return None;
    }
    let number = |value: &serde_json::Value, field: &str| {
        value
            .get(field)
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0)
    };
    let command = shown
        .get("command")
        .and_then(serde_json::Value::as_str)
        .map(printable)
        .unwrap_or_default();
    let mut lines = vec![format!(
        "Operation {id} ({command}), proposed by {}.",
        proposer_line(shown.pointer("/proposal/proposer"))
    )];
    if let Some(query) = shown.pointer("/query/written") {
        lines.push(format!(
            "The query it was made with, as the proposer wrote it: {}",
            printable(&query.to_string())
        ));
    }
    let places = |value: &serde_json::Value| {
        let name = value
            .pointer("/name/text")
            .and_then(serde_json::Value::as_str)
            .map(printable)
            .unwrap_or_default();
        let role = value
            .get("role")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("none");
        format!(
            "mailbox {} of account {} ({role}; its name, as the provider writes it: {name}): {} places",
            number(value, "mailbox"),
            number(value, "account"),
            number(value, "places"),
        )
    };
    let list = |field: &str| {
        preview
            .get(field)
            .and_then(serde_json::Value::as_array)
            .cloned()
            .unwrap_or_default()
    };
    for account in list("byAccount") {
        let provider = account
            .get("provider")
            .and_then(serde_json::Value::as_str)
            .map(printable)
            .unwrap_or_default();
        lines.push(format!(
            "In the {provider} account {}: {} places.",
            number(&account, "account"),
            number(&account, "places")
        ));
    }
    for mailbox in list("byMailbox") {
        lines.push(format!("From {}.", places(&mailbox)));
    }
    for mailbox in list("destinations") {
        lines.push(format!("Into {}.", places(&mailbox)));
    }
    let classes = preview.get("byClass");
    let class = |name: &str| classes.map_or(0, |classes| number(classes, name));
    lines.push(format!(
        "By class: {} known, {} bulk, {} unknown, {} blocked, {} your own.",
        class("known"),
        class("bulk"),
        class("unknown"),
        class("blocked"),
        class("own"),
    ));
    let unreturned = number(preview, "unreturned");
    if unreturned > 0 {
        lines.push(format!(
            "{unreturned} places are messages the provider never returned."
        ));
    }
    if let Some(known) = preview.get("knownSenders") {
        let (messages, senders) = (number(known, "messages"), number(known, "senders"));
        if messages > 0 {
            let senders = if senders == 1 {
                "1 sender".to_string()
            } else {
                format!("{senders} senders")
            };
            let messages = if messages == 1 {
                "1 message".to_string()
            } else {
                format!("{messages} messages")
            };
            lines.push(format!(
                "Mail from senders you know: it holds {messages} from {senders} you know."
            ));
        }
    }
    Some(lines)
}

/// What a person's change to mail does, in counts, when it is larger than
/// the policy's count to ask above: `None` for any other command, a change
/// within the count, or one whose count cannot be read (the handler then
/// says why it cannot run).
fn large_change(
    name: &str,
    input: &serde_json::Value,
    runner: &(dyn Runner + Sync),
    runtime: &tokio::runtime::Runtime,
) -> Option<String> {
    let stated = || -> Option<u64> {
        input
            .get("expectedCount")
            .and_then(serde_json::Value::as_u64)
            .or_else(|| {
                input
                    .get("messages")
                    .and_then(serde_json::Value::as_array)
                    .map(|ids| ids.len() as u64)
            })
    };
    let operation = || -> Option<(i64, serde_json::Value)> {
        let id = crate::operations::operation_input(input)?;
        let shown = runtime.block_on(runner.run(
            "mail-operation-show",
            serde_json::json!({ "operation": id, "limit": 1 }),
            true,
            None,
        ));
        Some((id, shown.data.filter(|_| shown.success)?))
    };
    let count = |value: &serde_json::Value, field: &str| {
        value.get(field).and_then(serde_json::Value::as_u64)
    };
    let (count, what) = match name {
        "mail-archive" => (stated()?, "Archive {n} messages".to_string()),
        "mail-trash" => (stated()?, "Move {n} messages to the trash".to_string()),
        "mail-mark" => (stated()?, "Mark {n} messages".to_string()),
        "mail-label" => {
            let mailbox = input.get("mailbox").and_then(serde_json::Value::as_i64)?;
            let verb = if input.get("copy") == Some(&serde_json::Value::Bool(true)) {
                "Copy"
            } else {
                "Move"
            };
            (
                stated()?,
                format!("{verb} {{n}} messages to mailbox {mailbox}"),
            )
        }
        crate::operations::RESUME => {
            let (id, shown) = operation()?;
            (
                count(&shown, "waiting")?,
                format!("Carry on operation {id}: {{n}} places left"),
            )
        }
        crate::operations::UNDO => {
            let (id, shown) = operation()?;
            (
                count(&shown, "changed")?,
                format!("Undo operation {id}: put back {{n}} places it changed"),
            )
        }
        _ => return None,
    };
    let policy =
        runtime.block_on(runner.run("mail-policy-show", serde_json::json!({}), true, None));
    let ask_above = policy
        .data
        .filter(|_| policy.success)?
        .pointer("/policy/askAbove")?
        .as_u64()?;
    (count > ask_above).then(|| what.replace("{n}", &count.to_string()))
}

/// Text from mail made safe to write to a terminal: control characters
/// and the marks that reorder text are shown as U+FFFD, so the text cannot
/// move the cursor, clear the screen or hide what follows.
fn printable(text: &str) -> String {
    text.chars()
        .map(|c| {
            // Unicode's Bidi_Control set, and the line and paragraph
            // separators.
            let reorders = matches!(
                c,
                '\u{061c}'
                    | '\u{200e}'
                    | '\u{200f}'
                    | '\u{202a}'..='\u{202e}'
                    | '\u{2066}'..='\u{2069}'
                    | '\u{2028}'
                    | '\u{2029}'
            );
            if c.is_control() || reorders {
                '\u{fffd}'
            } else {
                c
            }
        })
        .collect()
}

/// Like [`printable`], keeping plain line breaks so a multi-line draft body is
/// readable at the terminal while every other control or bidi character is
/// replaced.
fn printable_body(text: &str) -> String {
    text.replace("\r\n", "\n")
        .split('\n')
        .map(printable)
        .collect::<Vec<_>>()
        .join("\n")
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

    fn type_text(&mut self, prompt: &str) -> std::io::Result<String> {
        let mut err = std::io::stderr().lock();
        write!(err, "{prompt}")?;
        err.flush()?;
        let mut answer = String::new();
        std::io::stdin().read_line(&mut answer)?;
        Ok(answer.trim_end_matches(['\r', '\n']).to_string())
    }
}

enum DraftSendPrep {
    Ready(Vec<String>),
    Reject(CommandError),
    Stop,
}

/// Reads the draft preview before a terminal send: strips any pre-supplied
/// `typedRecipients`, fills in `revision` only when omitted, refuses drafts
/// that cannot be sent or changed since the asked revision with structured
/// errors before asking, shows every recipient with its basis, and asks the
/// person to type any `new` address verbatim for this send (the specification's
/// 9.5).
fn prepare_draft_send(
    input: &mut serde_json::Value,
    runner: &(dyn Runner + Sync),
    runtime: &tokio::runtime::Runtime,
    person: &mut dyn Person,
    err: &mut dyn Write,
) -> std::io::Result<DraftSendPrep> {
    // Never accept pre-populated `typedRecipients` from CLI arguments; the
    // person must type each new address at the terminal now.
    if let Some(obj) = input.as_object_mut() {
        obj.remove("typedRecipients");
    }
    let Some(draft_id) = input.get("draft").and_then(serde_json::Value::as_i64) else {
        // Let the registry return its standard validation error.
        return Ok(DraftSendPrep::Ready(Vec::new()));
    };
    // If `revision` was given as a non-integer, let the registry return its
    // standard schema validation error rather than overwriting it.
    if let Some(raw_rev) = input.get("revision")
        && raw_rev.as_i64().is_none()
    {
        return Ok(DraftSendPrep::Ready(Vec::new()));
    }
    let shown = runtime.block_on(runner.run(
        "mail-draft-show",
        serde_json::json!({ "draft": draft_id }),
        true,
        None,
    ));
    let Some(data) = shown.data.filter(|_| shown.success) else {
        if let Some(error) = shown.error {
            return Ok(DraftSendPrep::Reject(error));
        }
        writeln!(
            err,
            "{PROGRAM}: draft {draft_id} could not be read; `mail-draft-show` says why. Nothing was sent."
        )?;
        return Ok(DraftSendPrep::Stop);
    };
    let state = data
        .get("state")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("unknown");
    if state != "open" {
        let error = match state {
            "unknown" => CommandError::new(
                "SEND_OUTCOME_UNKNOWN",
                format!(
                    "a previous send of draft {draft_id} ended with an unknown outcome and is never retried"
                ),
            )
            .with_retryable(false)
            .with_suggestion(
                "Check your Sent mailbox and mail-status before deciding whether to write a new draft.",
            ),
            "sending" => CommandError::new(
                "WORK_RUNNING",
                format!("draft {draft_id} is already being sent"),
            )
            .with_retryable(true)
            .with_suggestion("Wait for the send to finish, then check mail-draft-show."),
            _ => CommandError::new(
                "INVALID_INPUT",
                format!("draft {draft_id} is {state} and cannot be sent"),
            )
            .with_suggestion("Inspect the draft with mail-draft-show."),
        };
        return Ok(DraftSendPrep::Reject(error));
    }
    let current_rev = data
        .get("revision")
        .and_then(serde_json::Value::as_i64)
        .unwrap_or(0);
    if let Some(asked_rev) = input.get("revision").and_then(serde_json::Value::as_i64) {
        if asked_rev != current_rev {
            return Ok(DraftSendPrep::Reject(
                CommandError::new(
                    "PREVIEW_CHANGED",
                    format!(
                        "The draft changed since its preview was read (now at revision {current_rev}). Nothing was sent."
                    ),
                )
                .with_retryable(false)
                .with_suggestion("Read it again with mail-draft-show and ask the person again."),
            ));
        }
    } else if let Some(obj) = input.as_object_mut() {
        obj.insert("revision".to_string(), serde_json::json!(current_rev));
    }
    let recipient_count = data
        .get("recipients")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    if recipient_count == 0 {
        return Ok(DraftSendPrep::Reject(
            CommandError::new(
                "INVALID_INPUT",
                format!("draft {draft_id} has no recipients"),
            )
            .with_suggestion("Add at least one recipient with mail-draft-update before sending."),
        ));
    }
    let from = data
        .get("from")
        .and_then(serde_json::Value::as_str)
        .map(printable)
        .unwrap_or_default();
    let mut lines = vec![format!(
        "Draft {draft_id} (revision {current_rev}), from account {} ({from}):",
        data.get("account")
            .and_then(serde_json::Value::as_i64)
            .unwrap_or(0)
    )];
    if data.get("replyToDiffers") == Some(&serde_json::Value::Bool(true)) {
        lines.push(
            "Warning: the message being answered has a Reply-To header that differs from its sender."
                .to_string(),
        );
    }
    let mut new_recipients: Vec<String> = Vec::new();
    for (label, field) in [("To", "to"), ("Cc", "cc"), ("Bcc", "bcc")] {
        let addresses = data
            .pointer(&format!("/content/{field}"))
            .and_then(serde_json::Value::as_array)
            .cloned()
            .unwrap_or_default();
        let bases = data
            .pointer(&format!("/recipientBasis/{field}"))
            .and_then(serde_json::Value::as_array)
            .cloned()
            .unwrap_or_default();
        for (index, addr_val) in addresses.iter().enumerate() {
            let Some(addr) = addr_val.as_str() else {
                continue;
            };
            let basis = bases
                .get(index)
                .and_then(serde_json::Value::as_str)
                .unwrap_or("new");
            lines.push(format!(
                "{label}, as written in the draft: {} [{basis}]",
                printable(addr)
            ));
            let key = crate::store::normalize_domain(addr);
            if basis == "new"
                && !new_recipients
                    .iter()
                    .any(|seen| crate::store::normalize_domain(seen) == key)
            {
                new_recipients.push(addr.to_string());
            }
        }
    }
    let subject = data
        .pointer("/content/subject")
        .and_then(serde_json::Value::as_str)
        .map(printable)
        .unwrap_or_default();
    lines.push(format!("Subject, as written in the draft: {subject}"));
    let body = data
        .pointer("/content/body")
        .and_then(serde_json::Value::as_str)
        .map(printable_body)
        .unwrap_or_default();
    lines.push(format!("Body, as written in the draft:\n{body}"));
    lines.push(format!(
        "Written by: recipients {}, subject {}, body {}.",
        proposer_line(data.pointer("/authors/recipients")),
        proposer_line(data.pointer("/authors/subject")),
        proposer_line(data.pointer("/authors/body")),
    ));
    if !new_recipients.is_empty() {
        for line in &lines {
            writeln!(err, "{line}")?;
        }
        let mut confirmed = Vec::with_capacity(new_recipients.len());
        for addr in &new_recipients {
            let prompt = format!(
                "New recipient (never written to and not in this thread): {}. Type the address verbatim to allow it for this send: ",
                printable(addr)
            );
            let typed = person.type_text(&prompt)?;
            if typed != addr.as_str() {
                writeln!(err, "Address did not match. Nothing was sent.")?;
                return Ok(DraftSendPrep::Stop);
            }
            confirmed.push(addr.clone());
        }
        if let Some(obj) = input.as_object_mut() {
            obj.insert("typedRecipients".to_string(), serde_json::json!(confirmed));
        }
        // Preview was already printed above before typing the new recipients.
        return Ok(DraftSendPrep::Ready(Vec::new()));
    }
    Ok(DraftSendPrep::Ready(lines))
}

/// Reads the unsubscribe preview before a terminal unsubscribe: verifies the
/// message has a usable `List-Unsubscribe` header, fills in `digest` when
/// omitted, refuses unusable headers or stale digests before asking, and
/// formats the exact target labelled as content (the specification's 9.5 and
/// 12.1).
fn prepare_unsubscribe(
    input: &mut serde_json::Value,
    runner: &(dyn Runner + Sync),
    runtime: &tokio::runtime::Runtime,
    err: &mut dyn Write,
) -> std::io::Result<DraftSendPrep> {
    let Some(message_id) = input.get("message").and_then(serde_json::Value::as_i64) else {
        // Let the registry return its standard validation error.
        return Ok(DraftSendPrep::Ready(Vec::new()));
    };
    if let Some(raw_account) = input.get("account")
        && !raw_account.is_null()
        && raw_account.as_i64().is_none()
    {
        return Ok(DraftSendPrep::Ready(Vec::new()));
    }
    if let Some(raw_digest) = input.get("digest")
        && !raw_digest.is_null()
        && raw_digest.as_str().is_none()
    {
        return Ok(DraftSendPrep::Ready(Vec::new()));
    }
    let mut show_input = serde_json::Map::new();
    show_input.insert("message".to_string(), serde_json::json!(message_id));
    if let Some(account) = input.get("account").and_then(serde_json::Value::as_i64) {
        show_input.insert("account".to_string(), serde_json::json!(account));
    }
    if let Some(digest) = input.get("digest").and_then(serde_json::Value::as_str) {
        show_input.insert("digest".to_string(), serde_json::json!(digest));
    }
    let shown = runtime.block_on(runner.run(
        crate::unsubscribe::SHOW,
        serde_json::Value::Object(show_input),
        true,
        None,
    ));
    let Some(data) = shown.data.filter(|_| shown.success) else {
        if let Some(error) = shown.error {
            return Ok(DraftSendPrep::Reject(error));
        }
        writeln!(
            err,
            "{PROGRAM}: unsubscribe preview for message {message_id} could not be read; `mail-unsubscribe-show` says why. Nothing was contacted."
        )?;
        return Ok(DraftSendPrep::Stop);
    };
    let Some(unsub) = data.get("unsubscribe") else {
        return Ok(DraftSendPrep::Stop);
    };
    let current_digest = unsub
        .get("digest")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    if input.get("digest").is_none_or(serde_json::Value::is_null)
        && let Some(obj) = input.as_object_mut()
    {
        obj.insert("digest".to_string(), serde_json::json!(current_digest));
    }
    let account_id = unsub
        .pointer("/account/id")
        .and_then(serde_json::Value::as_i64)
        .unwrap_or(0);
    let account_addr = unsub
        .pointer("/account/address")
        .and_then(serde_json::Value::as_str)
        .map(printable)
        .unwrap_or_default();
    let method = unsub
        .get("method")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("unknown");
    let text = |pointer: &str| {
        unsub
            .pointer(pointer)
            .and_then(serde_json::Value::as_str)
            .map(printable)
            .unwrap_or_default()
    };
    let mut lines = vec![format!(
        "Unsubscribe from message {message_id} (account {account_id}, {account_addr}):"
    )];
    if method == "one-click" {
        lines.push(
            "Method: one-click HTTPS POST (List-Unsubscribe-Post: List-Unsubscribe=One-Click)"
                .to_string(),
        );
        lines.push(format!(
            "Target URL, as written in the message's header: {}",
            text("/content/target")
        ));
    } else {
        lines.push("Method: send mail via SMTP".to_string());
        lines.push(format!(
            "Recipient, as written in the message's header: {}",
            text("/content/mailto/to")
        ));
        lines.push(format!(
            "Subject, as written in the message's header: {}",
            text("/content/mailto/subject")
        ));
        let body = unsub
            .pointer("/content/mailto/body")
            .and_then(serde_json::Value::as_str)
            .map(printable_body)
            .unwrap_or_default();
        if !body.is_empty() {
            lines.push(format!("Body, as written in the message's header:\n{body}"));
        }
    }
    let list_id = text("/content/listId");
    if !list_id.is_empty() {
        lines.push(format!(
            "List-Id, as written in the message's header: {list_id}"
        ));
    }
    let sender_addr = text("/content/sender/address");
    if !sender_addr.is_empty() {
        lines.push(format!(
            "Sender, as written in the message's header: {sender_addr}"
        ));
    }
    let subject = text("/content/subject");
    if !subject.is_empty() {
        lines.push(format!(
            "Message subject, as written by the sender: {subject}"
        ));
    }
    Ok(DraftSendPrep::Ready(lines))
}

/// Reads the reply-set preview before a terminal send: fills in `revision`
/// only when omitted, refuses non-sendable, incomplete, or stale sets before
/// asking, shows the shared text once, lists every recipient derived from its
/// source message, and marks every reply whose text differs from the shared
/// text (the specification's 10.3 and 12.1).
fn prepare_replyset_send(
    input: &mut serde_json::Value,
    runner: &(dyn Runner + Sync),
    runtime: &tokio::runtime::Runtime,
    err: &mut dyn Write,
) -> std::io::Result<DraftSendPrep> {
    let Some(set_id) = input.get("replyset").and_then(serde_json::Value::as_i64) else {
        return Ok(DraftSendPrep::Ready(Vec::new()));
    };
    if let Some(raw_rev) = input.get("revision")
        && !raw_rev.is_null()
        && raw_rev.as_i64().is_none()
    {
        return Ok(DraftSendPrep::Ready(Vec::new()));
    }
    let mut show_input = serde_json::Map::new();
    show_input.insert("replyset".to_string(), serde_json::json!(set_id));
    if let Some(rev) = input.get("revision").and_then(serde_json::Value::as_i64) {
        show_input.insert("revision".to_string(), serde_json::json!(rev));
    }
    let shown = runtime.block_on(runner.run(
        crate::replysets::SHOW,
        serde_json::Value::Object(show_input),
        true,
        None,
    ));
    let Some(data) = shown.data.filter(|_| shown.success) else {
        if let Some(error) = shown.error {
            return Ok(DraftSendPrep::Reject(error));
        }
        writeln!(
            err,
            "{PROGRAM}: reply set {set_id} could not be read; `mail-replyset-show` says why. Nothing was sent."
        )?;
        return Ok(DraftSendPrep::Stop);
    };
    let Some(set) = data.get("replyset") else {
        return Ok(DraftSendPrep::Stop);
    };
    let state = set
        .get("state")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("unknown");
    if state != "open" && state != "partial" {
        let error = match state {
            "unknown" => CommandError::new(
                "SEND_OUTCOME_UNKNOWN",
                format!(
                    "a previous send of reply set {set_id} ended with an unknown outcome and is never retried"
                ),
            )
            .with_retryable(false)
            .with_suggestion(
                "Check your Sent mailbox and mail-status before deciding how to proceed.",
            ),
            "sending" => CommandError::new(
                "WORK_RUNNING",
                format!("reply set {set_id} is already being sent"),
            )
            .with_retryable(true)
            .with_suggestion("Wait for the send to finish, then check mail-replyset-show."),
            _ => CommandError::new(
                "INVALID_INPUT",
                format!("reply set {set_id} is {state} and cannot be sent"),
            )
            .with_suggestion("Inspect the reply set with mail-replyset-show."),
        };
        return Ok(DraftSendPrep::Reject(error));
    }
    let current_rev = set
        .get("revision")
        .and_then(serde_json::Value::as_i64)
        .unwrap_or(0);
    if input.get("revision").is_none_or(serde_json::Value::is_null)
        && let Some(obj) = input.as_object_mut()
    {
        obj.insert("revision".to_string(), serde_json::json!(current_rev));
    }
    let replies = set
        .get("replies")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default();
    let missing = replies
        .iter()
        .filter(|r| {
            r.pointer("/content/text")
                .and_then(serde_json::Value::as_str)
                .is_none_or(|t| t.trim().is_empty())
        })
        .count();
    if missing > 0 {
        let phrase = if missing == 1 {
            "1 reply has no text".to_string()
        } else {
            format!("{missing} replies have no text")
        };
        return Ok(DraftSendPrep::Reject(
            CommandError::new(
                "REPLYSET_INCOMPLETE",
                format!("reply set {set_id} is not complete: {phrase}"),
            )
            .with_retryable(false)
            .with_suggestion(
                "Write every reply with mail-replyset-next or mail-replyset-update before sending.",
            ),
        ));
    }
    let account_id = set
        .pointer("/account/id")
        .and_then(serde_json::Value::as_i64)
        .unwrap_or(0);
    let from = set
        .pointer("/account/address")
        .and_then(serde_json::Value::as_str)
        .map(printable)
        .unwrap_or_default();
    let mut lines = vec![format!(
        "Reply set {set_id} (revision {current_rev}, state {state}), from account {account_id} ({from}):"
    )];
    let shared_text = set
        .pointer("/content/sharedText")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    if !shared_text.is_empty() {
        lines.push(format!(
            "Shared text, as written in the reply set:\n{}",
            printable_body(shared_text)
        ));
    }
    let already_sent = replies
        .iter()
        .filter(|r| r.get("state").and_then(serde_json::Value::as_str) == Some("sent"))
        .count();
    if already_sent > 0 {
        lines.push(format!(
            "{already_sent} reply/replies already sent and will not be sent again."
        ));
    }
    for reply in &replies {
        let r_state = reply
            .get("state")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("open");
        let r_id = reply
            .get("reply")
            .and_then(serde_json::Value::as_i64)
            .unwrap_or(0);
        let msg_id = reply
            .get("message")
            .and_then(serde_json::Value::as_i64)
            .unwrap_or(0);
        let addr = reply
            .pointer("/content/recipient/address")
            .and_then(serde_json::Value::as_str)
            .map(printable)
            .unwrap_or_default();
        let name = reply
            .pointer("/content/recipient/name")
            .and_then(serde_json::Value::as_str)
            .map(printable)
            .unwrap_or_default();
        let recipient_desc = if name.is_empty() {
            addr
        } else {
            format!("{name} <{addr}>")
        };
        if r_state == "sent" {
            lines.push(format!(
                "Reply {r_id} [already sent; will not be sent again] -> Recipient, derived from message {msg_id}: {recipient_desc}"
            ));
        } else {
            lines.push(format!(
                "Reply {r_id} -> Recipient, derived from message {msg_id}: {recipient_desc}"
            ));
        }
        if reply.get("replyToDiffers") == Some(&serde_json::Value::Bool(true)) {
            lines.push(format!(
                "  Warning: message {msg_id} has a Reply-To header that differs from its sender; sending to the sender address above."
            ));
        }
        let subject = reply
            .pointer("/content/subject")
            .and_then(serde_json::Value::as_str)
            .map(printable)
            .unwrap_or_default();
        lines.push(format!(
            "  Subject, derived from message {msg_id}: {subject}"
        ));
        let differs = reply.get("differs") == Some(&serde_json::Value::Bool(true));
        let body = reply
            .pointer("/content/text")
            .and_then(serde_json::Value::as_str)
            .map(printable_body)
            .unwrap_or_default();
        if differs {
            lines.push(format!("  Text [DIFFERS from shared text]:\n{body}"));
        } else {
            lines.push("  Text [matches shared text].".to_string());
        }
        let source = reply
            .get("source")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("unknown");
        let unit = reply
            .get("unit")
            .and_then(serde_json::Value::as_str)
            .map(printable)
            .unwrap_or_else(|| "none".to_string());
        lines.push(format!(
            "  Written by: {source} by {} (unit {unit}).",
            proposer_line(reply.get("author"))
        ));
    }
    Ok(DraftSendPrep::Ready(lines))
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
    writeln!(
        out,
        "  {PROGRAM} serve [--port N]     Serve on 127.0.0.1: MCP for agents, and the commands run here"
    )?;
    writeln!(
        out,
        "  {PROGRAM} mcp                  Serve MCP on standard input and output"
    )?;
    #[cfg(feature = "test-doubles")]
    writeln!(
        out,
        "  {PROGRAM} test-world --seed <name> --home <dir> --out <dir>  Run scripted servers for tests"
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

#[cfg(test)]
mod tests {
    use super::printable;

    #[test]
    fn text_from_mail_cannot_drive_the_terminal() {
        // A screen clear, a carriage return over the line, and marks that
        // would show `moc.elpmaxe` the other way round.
        assert_eq!(
            printable("a\u{1b}[2Jb\rc\u{202e}moc.elpmaxe\u{2066}d"),
            "a\u{fffd}[2Jb\u{fffd}c\u{fffd}moc.elpmaxe\u{fffd}d"
        );
        assert_eq!(printable("x\u{61c}y\u{2028}z"), "x\u{fffd}y\u{fffd}z");
        assert_eq!(printable("Ada Lovelace"), "Ada Lovelace");
    }
}

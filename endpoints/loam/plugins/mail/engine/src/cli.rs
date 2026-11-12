//! The command line's entry point.
//!
//! It answers `help` and `version`, and runs a command the registry exposes
//! to the command line: `loam-mail <command> [input]`, where the input is a
//! JSON object. `serve` and `mcp` arrive with later steps, and with them the
//! forwarding of a command to a running server; until then a command opens
//! the store itself.

use std::io::Write;

use afd::{ActorKind, CommandContext, CommandInterface, CommandRegistry};

use crate::PROGRAM;

/// Exit status of a run that did what was asked.
pub const EXIT_OK: u8 = 0;
/// Exit status of a command that ran and failed.
pub const EXIT_FAILED: u8 = 1;
/// Exit status of a run whose arguments were not understood.
pub const EXIT_USAGE: u8 = 2;

/// Who is at the command line (the specification's section 3.3).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Caller {
    /// Standard input is a terminal: a person.
    Terminal,
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
    caller: Caller,
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
            run_command(name, &args[1..], registry, caller, out, err)
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
    caller: Caller,
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
    let context = CommandContext::new()
        .with_interface(CommandInterface::Cli)
        .with_actor(match caller {
            Caller::Terminal => ActorKind::Human,
            Caller::Script => ActorKind::Script,
        });
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()?;
    let result = runtime.block_on(registry.execute(name, input, Some(context)));
    let rendered = serde_json::to_string_pretty(&result).map_err(std::io::Error::other)?;
    writeln!(out, "{rendered}")?;
    Ok(if result.success { EXIT_OK } else { EXIT_FAILED })
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

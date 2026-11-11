//! The command line's entry point.
//!
//! In this step it answers `help` and `version` and refuses everything else.
//! Running a command, `serve` and `mcp` arrive with later steps.

use std::io::Write;

use afd::CommandRegistry;

use crate::PROGRAM;

/// Exit status of a run that did what was asked.
pub const EXIT_OK: u8 = 0;
/// Exit status of a run whose arguments were not understood.
pub const EXIT_USAGE: u8 = 2;

/// Runs the command line with `args` (the program's name already removed),
/// writing what was asked for to `out` and problems to `err`. Returns the exit
/// status.
///
/// # Errors
/// Returns an error only when writing to `out` or `err` fails.
pub fn run(
    args: &[String],
    registry: &CommandRegistry,
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

/// Writes the help text: what the program is, how to call it, and the commands
/// the registry exposes to the command line.
fn write_help(registry: &CommandRegistry, out: &mut dyn Write) -> std::io::Result<()> {
    writeln!(
        out,
        "{PROGRAM}: your mail on this machine, as AFD commands."
    )?;
    writeln!(out)?;
    writeln!(out, "Usage:")?;
    writeln!(out, "  {PROGRAM} help       Show this text")?;
    writeln!(out, "  {PROGRAM} version    Show the version")?;
    writeln!(out)?;
    let mut commands: Vec<_> = registry
        .list()
        .into_iter()
        .filter(|command| command.expose.cli)
        .collect();
    commands.sort_by(|a, b| a.name.cmp(&b.name));
    if commands.is_empty() {
        writeln!(
            out,
            "Commands: none yet. This build is the engine's skeleton."
        )?;
    } else {
        writeln!(out, "Commands:")?;
        let width = commands.iter().map(|c| c.name.len()).max().unwrap_or(0);
        for command in commands {
            writeln!(out, "  {:width$}  {}", command.name, command.description)?;
        }
    }
    Ok(())
}

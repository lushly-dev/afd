//! The command line, as `clap` reads it.
//!
//! ```text
//! umbel [--workspace <dir>] [--format json|text] [--log <filter>] <verb or command> [args]
//! ```
//!
//! Every word after a command name belongs to the command's input, so `--approve` and `--yes` are
//! picked out of those words by [`split_flags`] rather than by `clap`.

use clap::{Parser, Subcommand, ValueEnum};
use std::path::PathBuf;

/// `--format`.
#[derive(Clone, Copy, Debug, Default, ValueEnum)]
pub(crate) enum FormatArg {
    #[default]
    Json,
    Text,
}

/// The `umbel` command line.
#[derive(Debug, Parser)]
#[command(
    name = "umbel",
    version,
    about = "AFD Umbel: an empty host for capability plugins over MCP and CLI",
    disable_help_subcommand = true,
    subcommand_required = true,
    arg_required_else_help = true
)]
pub(crate) struct Cli {
    /// The workspace directory (else UMBEL_WORKSPACE, else the nearest umbel.toml upward).
    #[arg(long, global = true, value_name = "DIR")]
    pub workspace: Option<PathBuf>,
    /// How a result prints.
    #[arg(long, value_enum, default_value_t = FormatArg::Json)]
    pub format: FormatArg,
    /// A tracing filter for stderr (else UMBEL_LOG, else log.level).
    #[arg(long, global = true, value_name = "FILTER")]
    pub log: Option<String>,
    #[command(subcommand)]
    pub command: Verb,
}

/// A process verb, a bootstrap verb, `call`, `batch`, or `<domain> <action>`.
#[derive(Debug, Subcommand)]
pub(crate) enum Verb {
    /// Create a workspace.
    Init {
        /// The directory to create it in (default: the current directory).
        dir: Option<PathBuf>,
        /// The workspace name written to umbel.toml.
        #[arg(long)]
        name: Option<String>,
    },
    /// Serve MCP over stdio or Streamable HTTP.
    Serve {
        /// Serve over stdio.
        #[arg(long, conflicts_with = "http")]
        stdio: bool,
        /// Serve over Streamable HTTP on a loopback address.
        #[arg(long)]
        http: bool,
        /// The loopback address to bind (overrides http.bind and UMBEL_HTTP_BIND).
        #[arg(long, value_name = "ADDR")]
        bind: Option<String>,
        /// Print the bearer token once on stdout.
        #[arg(long)]
        print_token: bool,
    },
    /// List the commands the CLI can run (afd-help).
    Help {
        /// Only commands whose name or description contains this text.
        filter: Option<String>,
        /// Show every field.
        #[arg(long)]
        full: bool,
    },
    /// Describe commands (afd-docs).
    Docs {
        /// One command; absent lists them all.
        command: Option<String>,
    },
    /// Print the command schemas (afd-schema).
    Schema {
        /// `json` (default) or `typescript`.
        #[arg(long = "format", id = "schema_format", value_name = "FORMAT")]
        schema_format: Option<String>,
    },
    /// Run a command by its full name.
    #[command(trailing_var_arg = true)]
    Call {
        /// The command name, then its input: one JSON object, or key=value pairs; then
        /// `--approve` and `--yes` if wanted.
        #[arg(
            required = true,
            allow_hyphen_values = true,
            value_name = "COMMAND [INPUT]"
        )]
        words: Vec<String>,
    },
    /// Run an afd-batch request: a JSON object, or the path to a .json file holding one.
    Batch {
        /// The request.
        request: String,
    },
    /// `<domain> <action> [input]` runs the command `<domain>-<action>`.
    #[command(external_subcommand)]
    External(Vec<String>),
}

/// The words after a command name, without `--approve` and `--yes`, and whether each was given.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct Flags {
    pub approve: bool,
    pub yes: bool,
}

/// Remove `--approve` and `--yes` from `words`.
pub(crate) fn split_flags(words: &[String]) -> (Vec<String>, Flags) {
    let mut flags = Flags::default();
    let mut rest = Vec::with_capacity(words.len());
    for word in words {
        match word.as_str() {
            "--approve" => flags.approve = true,
            "--yes" => flags.yes = true,
            _ => rest.push(word.clone()),
        }
    }
    (rest, flags)
}

/// The command a `<domain> <action>` projection names, and its remaining words.
pub(crate) fn project(words: &[String]) -> Result<(String, Vec<String>), String> {
    match words {
        [domain, action, rest @ ..] => Ok((format!("{domain}-{action}"), rest.to_vec())),
        [only] => Err(format!(
            "'{only}' needs an action: umbel {only} <action>, or umbel call <command>"
        )),
        [] => Err("Missing command".to_owned()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn words(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| (*item).to_owned()).collect()
    }

    #[test]
    fn flags_are_picked_out_wherever_they_are() {
        let (rest, flags) = split_flags(&words(&["a=1", "--approve", "b=2", "--yes"]));
        assert_eq!(rest, words(&["a=1", "b=2"]));
        assert_eq!(
            flags,
            Flags {
                approve: true,
                yes: true
            }
        );
    }

    #[test]
    fn a_projection_splits_at_the_first_dash() {
        let (name, rest) = project(&words(&["a", "b-c", "x=1"])).unwrap();
        assert_eq!(name, "a-b-c");
        assert_eq!(rest, words(&["x=1"]));
        assert!(project(&words(&["workspace"])).is_err());
    }

    #[test]
    fn the_cli_definition_is_valid() {
        use clap::CommandFactory;
        Cli::command().debug_assert();
    }

    #[test]
    fn the_verbs_parse() {
        let cli = Cli::try_parse_from(["umbel", "--format", "text", "workspace", "show"]).unwrap();
        assert!(matches!(cli.format, FormatArg::Text));
        assert!(
            matches!(cli.command, Verb::External(ref w) if w == &words(&["workspace", "show"]))
        );
        let cli = Cli::try_parse_from(["umbel", "call", "workspace-show", "--yes"]).unwrap();
        assert!(matches!(cli.command, Verb::Call { ref words } if words.len() == 2));
        let cli = Cli::try_parse_from(["umbel", "schema", "--format", "typescript"]).unwrap();
        assert!(
            matches!(cli.command, Verb::Schema { schema_format: Some(ref f) } if f == "typescript")
        );
    }
}

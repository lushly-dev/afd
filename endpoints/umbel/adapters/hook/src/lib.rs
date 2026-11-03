//! `umbel-hook`: harness events to Umbel commands (phase 3 specification, section 10.3, D79).
//!
//! `umbel-hook <profile> <event>` reads the harness's JSON on stdin and runs `$UMBEL_BIN`
//! (default `umbel-first-party`) as a child process: `memory-capture` for the windows of a
//! session's user and assistant text, `context-bundle` at a session's start. It links no host, so
//! it builds in seconds. The profiles are `claude-code`, which reads the session's transcript
//! itself, and `generic`, which forwards the capture contract it is given unchanged.
//!
//! **It always fails open**: any failure is one line on stderr, exit code 0 and no harness output,
//! and `last-error.json` in the state directory, which the next success removes. A memory problem
//! never blocks a person's session.
//!
//! `umbel-hook print-settings <profile>` prints a harness's settings fragment and writes nothing;
//! `umbel-hook status` prints the last unresolved failure.
//!
//! `umbel-hook import <harness> <dir>` and `umbel-hook export <harness> <dir>` (section 10.5) move
//! memory between a harness's memory directory, which the person names, and Umbel, through
//! `memory-import` and `memory-export`. They are a person's commands, not hook events: a failure
//! exits 1 and records nothing in the state directory.
#![forbid(unsafe_code)]

use std::ffi::OsString;
use std::io::{Read, Write};
use std::path::PathBuf;

mod child;
mod claude_code;
mod export;
mod failure;
mod files;
mod generic;
mod import;
mod project;
mod settings;
mod state;
mod transcript;
mod window;

pub use failure::Failure;

/// The binary run when `UMBEL_BIN` is not set.
pub const DEFAULT_BIN: &str = "umbel-first-party";
/// The most bytes read from stdin: the host's own limit for `@-` (section 10.6).
pub const MAX_STDIN_BYTES: usize = 16 * 1024 * 1024;

/// What the hook reads from its environment, so a test or an embedder passes it explicitly.
#[derive(Clone, Debug)]
pub struct Environment {
    /// The Umbel binary to run (`UMBEL_BIN`, default [`DEFAULT_BIN`]).
    pub bin: OsString,
    /// Passed as `--workspace` when set (`UMBEL_WORKSPACE`).
    pub workspace: Option<OsString>,
    /// The state directory, `$XDG_STATE_HOME/umbel-hook`, else `~/.local/state/umbel-hook`.
    /// `None` when neither variable is set: the hook then keeps no state and records no failure.
    pub state_dir: Option<PathBuf>,
    /// The task of a session-start bundle (`UMBEL_TASK`).
    pub task: Option<String>,
}

impl Environment {
    /// Read `UMBEL_BIN`, `UMBEL_WORKSPACE`, `XDG_STATE_HOME`, `HOME` and `UMBEL_TASK`.
    #[must_use]
    pub fn from_process() -> Self {
        let set = |name: &str| std::env::var_os(name).filter(|value| !value.is_empty());
        let state_dir = set("XDG_STATE_HOME")
            .map(PathBuf::from)
            .or_else(|| set("HOME").map(|home| PathBuf::from(home).join(".local/state")))
            .map(|base| base.join("umbel-hook"));
        Self {
            bin: set("UMBEL_BIN").unwrap_or_else(|| DEFAULT_BIN.into()),
            workspace: set("UMBEL_WORKSPACE"),
            state_dir,
            task: set("UMBEL_TASK").map(|task| task.to_string_lossy().into_owned()),
        }
    }
}

/// The profiles.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Profile {
    ClaudeCode,
    Generic,
}

impl Profile {
    fn parse(word: &str) -> Option<Self> {
        match word {
            "claude-code" => Some(Self::ClaudeCode),
            "generic" => Some(Self::Generic),
            _ => None,
        }
    }

    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::ClaudeCode => "claude-code",
            Self::Generic => "generic",
        }
    }
}

const USAGE: &str = "usage: umbel-hook <claude-code|generic> <event> [--sweep] | umbel-hook print-settings claude-code | umbel-hook status | umbel-hook import <harness> <dir> [--project p] [--class c] | umbel-hook export <harness> <dir> [--project p]";

/// Run `umbel-hook` with `args` (without the program name) and return its exit code.
///
/// A hook event always returns 0, whatever fails; `print-settings` and `status` return 2 for a
/// usage error; `import` and `export` return 1 when they fail and 2 for a usage error. Library
/// callers, such as the exit test, pass the same arguments the binary gets.
pub fn run(
    args: &[OsString],
    environment: &Environment,
    stdin: &mut dyn Read,
    stdout: &mut dyn Write,
    stderr: &mut dyn Write,
) -> i32 {
    let words: Vec<String> = args
        .iter()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    match words.first().map(String::as_str) {
        Some("print-settings") => {
            return match words.get(1).map(String::as_str) {
                Some("claude-code") if words.len() == 2 => {
                    let _ = writeln!(stdout, "{}", settings::claude_code());
                    0
                }
                Some("generic") => {
                    let _ = writeln!(
                        stderr,
                        "umbel-hook: the generic profile has no settings to print: a deployer runs `umbel-hook generic <event>` from their own harness, with the capture contract on stdin"
                    );
                    2
                }
                _ => {
                    let _ = writeln!(stderr, "{USAGE}");
                    2
                }
            };
        }
        Some("status") if words.len() == 1 => {
            let _ = writeln!(
                stdout,
                "{}",
                state::status(environment.state_dir.as_deref())
            );
            return 0;
        }
        Some(which @ ("import" | "export")) => {
            let import = which == "import";
            let outcome = match files::Args::parse(&args[1..], import) {
                Ok(parsed) if import => import::run(&parsed, environment, stdout),
                Ok(parsed) => export::run(&parsed, environment, stdout),
                Err(failure) => {
                    let _ = writeln!(stderr, "umbel-hook: {}: {}", failure.code, failure.message);
                    let _ = writeln!(stderr, "{USAGE}");
                    return 2;
                }
            };
            let _ = stdout.flush();
            return match outcome {
                Ok(()) => 0,
                Err(failure) => {
                    let _ = writeln!(stderr, "umbel-hook: {}: {}", failure.code, failure.message);
                    1
                }
            };
        }
        Some("--help" | "-h" | "help") => {
            let _ = writeln!(stdout, "{USAGE}");
            return 0;
        }
        _ => {}
    }
    let profile = words.first().and_then(|word| Profile::parse(word));
    let event = words.get(1).cloned().unwrap_or_default();
    let outcome = match profile {
        None => Err(Failure::new(
            "invalid-arguments",
            "the first argument is claude-code, generic, print-settings, status, import or export",
        )),
        Some(profile) => {
            let flags = &words[2.min(words.len())..];
            let sweep = flags.iter().any(|flag| flag == "--sweep");
            if flags.iter().any(|flag| flag != "--sweep") {
                Err(Failure::new(
                    "invalid-arguments",
                    "the only option is --sweep, on session-end",
                ))
            } else {
                read_stdin(stdin).and_then(|input| match profile {
                    Profile::ClaudeCode => {
                        claude_code::run(&event, sweep, &input, environment, stdout)
                    }
                    Profile::Generic => generic::run(&event, sweep, &input, environment, stdout),
                })
            }
        }
    };
    let profile_name = profile.map_or("unknown", Profile::name);
    match outcome {
        Ok(notes) => {
            state::clear_error(environment.state_dir.as_deref());
            if let Some(notes) = notes {
                let _ = writeln!(stderr, "umbel-hook: {notes}");
            }
        }
        Err(failure) => {
            let _ = writeln!(stderr, "umbel-hook: {}: {}", failure.code, failure.message);
            state::record_error(
                environment.state_dir.as_deref(),
                profile_name,
                &event,
                &failure.code,
            );
        }
    }
    let _ = stdout.flush();
    0
}

/// The harness's stdin, as bytes, at most [`MAX_STDIN_BYTES`].
fn read_stdin(stdin: &mut dyn Read) -> Result<Vec<u8>, Failure> {
    let mut bytes = Vec::new();
    stdin
        .take(MAX_STDIN_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| Failure::new("invalid-stdin", "stdin cannot be read"))?;
    if bytes.len() > MAX_STDIN_BYTES {
        return Err(Failure::new("invalid-stdin", "stdin is over 16 MiB"));
    }
    Ok(bytes)
}

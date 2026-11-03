//! The `umbel` command line.
//!
//! [`run`] is the whole CLI: it parses the arguments, finds and opens the workspace, seals a host
//! and runs one command through [`Host::cli_client`](crate::Host::cli_client), so the registry
//! enforces `expose.cli`. The `umbel` binary calls it with the process's terminal; tests call it
//! with a fixture-registering `configure` and a scripted [`Console`].
//!
//! stdout holds exactly one JSON document (or the text layout with `--format text`); prompts and
//! logs go to stderr.

mod args;
mod output;
mod parse;
mod prompt;
mod serve;
mod stdin;
mod terminal;
// The test kit's stand-ins for a frozen clock and a person at a terminal: never in a normal build.
#[cfg(feature = "testkit")]
mod test_env;

pub use prompt::Console;

use crate::host::{Host, HostBuilder, HostError};
use crate::plugins::CompiledCatalog;
use crate::workspace::{
    Located, LogFormat, Overrides, WORKSPACE_ENV, Workspace, WorkspaceError, discover,
};
use crate::{doctor, logging, surfaces};
use afd::{BatchRequest, CommandInterface, CommandResult, error_codes};
use clap::Parser;
use output::Format;
use parse::{Cli, FormatArg, Verb};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::ffi::OsString;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

/// What the CLI reads from its surroundings: the current directory, `UMBEL_WORKSPACE`, the
/// `UMBEL_LOG` and `UMBEL_HTTP_BIND` overrides, and the terminal.
pub struct Environment {
    /// The current directory: where `init` creates a workspace and the upward search starts.
    pub cwd: PathBuf,
    /// `UMBEL_WORKSPACE`.
    pub workspace: Option<OsString>,
    /// `UMBEL_LOG` and `UMBEL_HTTP_BIND`.
    pub overrides: Overrides,
    /// Where prompts go and answers come from, and where `@-` reads its input.
    pub console: Arc<dyn Console>,
    /// The environment variables, for the agent variables that withhold
    /// `dev.umbel/human-present` (phase 3 section 3.3).
    pub vars: BTreeMap<String, String>,
    /// A fixed clock for every call, in epoch milliseconds; `None` is the system clock.
    pub clock: Option<i64>,
}

impl Environment {
    /// The process's current directory, environment variables and terminal.
    pub fn from_process() -> Self {
        let console: Arc<dyn Console> = Arc::new(prompt::StdConsole);
        let clock = None;
        #[cfg(feature = "testkit")]
        let (console, clock) = {
            let console: Arc<dyn Console> = if test_env::human_present() {
                Arc::new(test_env::PersonAtTerminal)
            } else {
                console
            };
            (console, test_env::clock().or(clock))
        };
        Self {
            cwd: std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
            workspace: std::env::var_os(WORKSPACE_ENV),
            overrides: Overrides::from_env(),
            console,
            vars: std::env::vars_os()
                .map(|(key, value)| {
                    (
                        key.to_string_lossy().into_owned(),
                        value.to_string_lossy().into_owned(),
                    )
                })
                .collect(),
            clock,
        }
    }
}

/// Where the CLI writes its result. Prompts and logs go to stderr by themselves.
struct Writers<'a> {
    out: &'a mut dyn Write,
    format: Format,
}

impl Writers<'_> {
    fn result(&mut self, result: &CommandResult<Value>) {
        let value = serde_json::to_value(result).unwrap_or(Value::Null);
        let text = match self.format {
            Format::Json => output::json_document(&value),
            Format::Text => output::result_text(&value),
        };
        let _ = self.out.write_all(text.as_bytes());
        let _ = self.out.flush();
    }

    fn batch(&mut self, value: &Value) {
        let text = match self.format {
            Format::Json => output::json_document(value),
            Format::Text => output::batch_text(value),
        };
        let _ = self.out.write_all(text.as_bytes());
        let _ = self.out.flush();
    }

    fn failure(&mut self, code: &str, message: &str, suggestion: &str) -> i32 {
        self.result(&output::pre_run_failure(code, message, suggestion));
        1
    }

    fn host_error(&mut self, error: HostError) -> i32 {
        self.result(&error.into_result());
        1
    }

    fn exit_for(&mut self, result: &CommandResult<Value>) -> i32 {
        self.result(result);
        i32::from(!result.success)
    }
}

/// Run the `umbel` command line and return its exit code: 0 on success, 1 when the command
/// failed, the command line was invalid or the workspace could not be opened, 2 when `batch`
/// completed with failed commands.
///
/// `configure` receives the builder before it is sealed; the binary passes the identity, and
/// tests register fixtures through it.
pub async fn run<I, T>(
    args: I,
    environment: &Environment,
    out: &mut dyn Write,
    configure: impl FnOnce(HostBuilder) -> HostBuilder,
) -> i32
where
    I: IntoIterator<Item = T>,
    T: Into<OsString> + Clone,
{
    let args: Vec<OsString> = args.into_iter().map(Into::into).collect();
    let serving = names_serve(&args);
    let clock = environment.clock;
    let configure = move |builder: HostBuilder| {
        let builder = configure(builder);
        match clock {
            Some(at) => builder.with_clock(afd::fixed_clock(at)),
            None => builder,
        }
    };
    let cli = match Cli::try_parse_from(&args) {
        Ok(cli) => cli,
        Err(error) => {
            use clap::error::ErrorKind;
            if matches!(
                error.kind(),
                ErrorKind::DisplayHelp | ErrorKind::DisplayVersion
            ) {
                let _ = out.write_all(error.to_string().as_bytes());
                return 0;
            }
            if serving {
                return fail_on_stderr(&output::pre_run_failure(
                    error_codes::INVALID_INPUT,
                    error.to_string().trim_end(),
                    "Run umbel serve --help for the usage.",
                ));
            }
            let mut writers = Writers {
                out,
                format: Format::Json,
            };
            return writers.failure(
                error_codes::INVALID_INPUT,
                error.to_string().trim_end(),
                "Run umbel --help for the usage.",
            );
        }
    };
    let format = match cli.format {
        FormatArg::Json => Format::Json,
        FormatArg::Text => Format::Text,
    };
    let mut writers = Writers { out, format };

    let (command, words, flags) = match cli.command {
        Verb::Init { dir, name } => {
            let dir = environment.cwd.join(dir.unwrap_or_default());
            return init(&dir, name.as_deref(), &mut writers);
        }
        Verb::Serve {
            stdio,
            http,
            bind,
            print_token,
        } => {
            let mode = match (stdio, http) {
                (true, false) if bind.is_none() && !print_token => serve::Mode::Stdio,
                (false, true) => serve::Mode::Http { print_token },
                _ => {
                    return fail_on_stderr(&output::pre_run_failure(
                        error_codes::INVALID_INPUT,
                        "Choose exactly one transport: --stdio, or --http with the optional --bind and --print-token",
                        "Run umbel serve --stdio, or umbel serve --http [--bind <addr>] [--print-token].",
                    ));
                }
            };
            return serve_host(
                &cli.workspace,
                &cli.log,
                bind,
                environment,
                configure,
                mode,
                writers.out,
            )
            .await;
        }
        Verb::Help { filter, full } => {
            let mut input = json!({ "format": if full { "full" } else { "brief" } });
            if let Some(filter) = filter {
                input["filter"] = json!(filter);
            }
            (
                "afd-help".to_owned(),
                Target::Input(input),
                parse::Flags::default(),
            )
        }
        Verb::Docs { command } => {
            let input = command.map_or_else(|| json!({}), |command| json!({ "command": command }));
            (
                "afd-docs".to_owned(),
                Target::Input(input),
                parse::Flags::default(),
            )
        }
        Verb::Schema { schema_format } => {
            let input =
                schema_format.map_or_else(|| json!({}), |format| json!({ "format": format }));
            (
                "afd-schema".to_owned(),
                Target::Input(input),
                parse::Flags::default(),
            )
        }
        Verb::Call { words } => {
            let (words, flags) = parse::split_flags(&words);
            let Some((command, rest)) = words.split_first() else {
                return writers.failure(
                    error_codes::INVALID_INPUT,
                    "Missing command",
                    "Run umbel call <command> [input], or umbel help to list the commands.",
                );
            };
            (command.clone(), Target::Words(rest.to_vec()), flags)
        }
        Verb::External(words) => {
            let (words, flags) = parse::split_flags(&words);
            match parse::project(&words) {
                Ok((command, rest)) => (command, Target::Words(rest), flags),
                Err(message) => {
                    return writers.failure(
                        error_codes::INVALID_INPUT,
                        &message,
                        "Run umbel help to list the commands.",
                    );
                }
            }
        }
        Verb::Batch { request } => {
            let request = match read_batch_request(&request, &environment.cwd) {
                Ok(request) => request,
                Err(message) => {
                    return writers.failure(
                        error_codes::INVALID_INPUT,
                        &message,
                        "Pass an afd-batch request object, {\"commands\":[...]}, or the path to a .json file holding one.",
                    );
                }
            };
            let Some(host) = open_host(
                &cli.workspace,
                &cli.log,
                environment,
                configure,
                &mut writers,
                None,
            )
            .await
            else {
                return 1;
            };
            return run_batch(&host, request, &mut writers).await;
        }
    };

    let input = match words {
        Target::Input(input) => Input::Ready(input),
        Target::Words(words) if stdin::is_stdin(&words) => Input::Stdin,
        Target::Words(words) => match args::parse_input(&words) {
            Ok(input) => Input::Ready(input),
            Err(reason) => {
                return writers.failure(
                    error_codes::INVALID_INPUT,
                    &args::describe_error(&reason),
                    "Pass one JSON object, key=value pairs such as space=main, or @- to read one JSON object from stdin.",
                );
            }
        },
    };
    let Some(host) = open_host(
        &cli.workspace,
        &cli.log,
        environment,
        configure,
        &mut writers,
        Some(&command),
    )
    .await
    else {
        return 1;
    };
    run_command(&host, &command, input, &flags, environment, &mut writers).await
}

/// Whether the arguments name the `serve` verb, loosely: a startup failure of `serve` is written
/// to stderr, never stdout, even when the arguments do not parse.
fn names_serve(args: &[OsString]) -> bool {
    args.iter().skip(1).any(|arg| arg == "serve")
}

/// Whether `umbel` is invoked as `umbel ... serve ...`. The binary does not turn Ctrl+C into exit
/// code 130 for it: `serve` stops on SIGINT and SIGTERM with exit code 0.
pub fn is_serve<I, T>(args: I) -> bool
where
    I: IntoIterator<Item = T>,
    T: Into<OsString> + Clone,
{
    Cli::try_parse_from(args).is_ok_and(|cli| matches!(cli.command, Verb::Serve { .. }))
}

/// A startup failure of `serve`: one failure `CommandResult` as JSON on one line of stderr,
/// nothing on stdout, exit code 1.
fn fail_on_stderr(result: &CommandResult<Value>) -> i32 {
    let line = serde_json::to_string(result).unwrap_or_else(|_| "null".to_owned());
    let _ = writeln!(std::io::stderr(), "{line}");
    1
}

async fn serve_host(
    flag: &Option<PathBuf>,
    log: &Option<String>,
    bind: Option<String>,
    environment: &Environment,
    configure: impl FnOnce(HostBuilder) -> HostBuilder,
    mode: serve::Mode,
    out: &mut dyn Write,
) -> i32 {
    let (sealed, _, _) = build_host(flag, log, bind, environment, configure);
    let outcome = match sealed {
        Ok(host) => serve::serve(&host, mode, out).await,
        Err(error) => Err(error),
    };
    match outcome {
        Ok(()) => 0,
        Err(error) => fail_on_stderr(&error.into_result()),
    }
}

/// The input of a command: ready, or still words to parse.
enum Target {
    Input(Value),
    Words(Vec<String>),
}

/// A parsed input, or `@-`: one JSON object to read from stdin once the command is known.
enum Input {
    Ready(Value),
    Stdin,
}

fn init(dir: &Path, name: Option<&str>, writers: &mut Writers<'_>) -> i32 {
    match Workspace::init(dir, name) {
        Ok(workspace) => {
            let result = afd::success(json!({
                "workspace": workspace.root().display().to_string(),
                "name": workspace.config().name,
                "config": workspace.layout().config_file().display().to_string(),
                "spaces": workspace.spaces().iter().map(|space| space.id.as_str()).collect::<Vec<_>>(),
            }));
            writers.exit_for(&result)
        }
        Err(error) => {
            writers.result(&error.into_result::<Value>());
            1
        }
    }
}

/// Find the workspace, open it, install logging and seal a host. On failure prints the failure
/// and returns `None`; `workspace-doctor` instead prints the doctor's report of the workspace as
/// far as it opens, because that is its job.
async fn open_host(
    flag: &Option<PathBuf>,
    log: &Option<String>,
    environment: &Environment,
    configure: impl FnOnce(HostBuilder) -> HostBuilder,
    writers: &mut Writers<'_>,
    command: Option<&str>,
) -> Option<Host> {
    let (sealed, located, catalog) = build_host(flag, log, None, environment, configure);
    match sealed {
        Ok(host) => Some(host),
        Err(error) => {
            if command == Some("workspace-doctor") {
                let report = doctor::inspect_with_catalog(located, catalog.as_ref());
                let result = report.into_result();
                writers.exit_for(&result);
            } else {
                writers.host_error(error);
            }
            None
        }
    }
}

/// Find the workspace, open it, install logging and seal a host; also the discovery result, which
/// the doctor reports when the workspace does not open, and the binary's compiled plugins, which
/// it resolves `compiled:` sources against even when `seal` fails. The catalog is `None` when the
/// workspace never opened, so `configure` never ran.
fn build_host(
    flag: &Option<PathBuf>,
    log: &Option<String>,
    bind: Option<String>,
    environment: &Environment,
    configure: impl FnOnce(HostBuilder) -> HostBuilder,
) -> (
    Result<Host, HostError>,
    Result<Located, WorkspaceError>,
    Option<CompiledCatalog>,
) {
    let located = discover(
        flag.as_deref(),
        environment.workspace.as_ref(),
        &environment.cwd,
    );
    let opened = open_with(&located, log, bind, environment);
    let mut catalog = None;
    let sealed = opened.and_then(|workspace| {
        logging::init(
            workspace.config().log.filter(),
            workspace.config().log.format == LogFormat::Json,
        );
        let builder = configure(HostBuilder::from_workspace(workspace));
        catalog = builder.compiled_catalog().ok();
        builder.seal()
    });
    (sealed, located, catalog)
}

fn open_with(
    located: &Result<Located, WorkspaceError>,
    log: &Option<String>,
    bind: Option<String>,
    environment: &Environment,
) -> Result<Workspace, HostError> {
    let located = located.clone().map_err(HostError::from)?;
    let flags = Overrides {
        http_bind: bind,
        log_filter: log.clone(),
    };
    Workspace::open_located(&located, &flags.or(environment.overrides.clone()))
        .map_err(HostError::from)
}

async fn run_command(
    host: &Host,
    command: &str,
    input: Input,
    flags: &parse::Flags,
    environment: &Environment,
    writers: &mut Writers<'_>,
) -> i32 {
    let gate = host.registry().get(command).and_then(|definition| {
        definition
            .confirm_prompt
            .clone()
            .filter(|_| definition.expose.cli)
    });
    // `confirm = "require-human"` (phase 2 specification, section 3.4): whatever
    // `mcp.confirmations` says, only a person at a terminal confirms, and neither `--yes` nor
    // `--approve` stands in for them.
    let require_human = host.requires_human(command);
    if require_human && (flags.yes || flags.approve) {
        return writers.exit_for(&afd::failure(
            afd::CommandError::new(
                afd::error_codes::CONFIRMATION_REQUIRED,
                format!("'{command}' must be confirmed by a person at a terminal; --yes and --approve do not count"),
            )
            .with_suggestion("Run it at a terminal without --yes or --approve, and answer its prompt.")
            .with_retryable(false),
        ));
    }
    // `@-` (phase 3 section 10.6): a require-human command's stdin is the prompt's.
    let from_stdin = matches!(input, Input::Stdin);
    if from_stdin && require_human {
        return writers.exit_for(&afd::failure(stdin::require_human_refusal(command)));
    }
    let input = match input {
        Input::Ready(input) => input,
        Input::Stdin => match stdin::read_object(environment.console.as_ref()) {
            Ok(input) => input,
            Err(error) => return writers.exit_for(&afd::failure(*error)),
        },
    };
    // Whether a person is at the terminal (phase 3 section 3.3): stdin and stderr are terminals,
    // the input is not `@-`, neither `--yes` nor `--approve`, and no agent variable is set.
    let agent = crate::authority::agent_env_set(
        |name| environment.vars.contains_key(name),
        &host.workspace().config().principal.agent_env,
    );
    let present = environment.console.is_interactive()
        && !from_stdin
        && !flags.yes
        && !flags.approve
        && agent.is_none();
    if let Some(prompt) = gate {
        let mode = if require_human {
            afd::server::ConfirmationMode::RequireHuman
        } else {
            surfaces::mcp::mode(host.workspace().config().mcp.confirmations)
        };
        let console = Arc::clone(&environment.console);
        if let Err(error) = prompt::confirm(mode, command, &prompt, flags.yes, console).await {
            return writers.exit_for(&afd::failure(*error));
        }
    }
    // The authority prompt (D86), after any confirm prompt, and only where a person is present:
    // otherwise nothing is asked and the write goes ahead as `tool` or `agent`.
    let mut answered = false;
    if present && let Some(prompt) = host.authority_prompt(command) {
        let console = Arc::clone(&environment.console);
        if let Err(error) = prompt::authority(command, &prompt, console).await {
            return writers.exit_for(&afd::failure(*error));
        }
        answered = true;
    }
    let client = host
        .cli_client()
        .with_on_approval_needed(prompt::approval_hook(
            flags.approve && !require_human,
            Arc::clone(&environment.console),
        ));
    let mut context = host.cli_context();
    if present {
        context.extra.insert(
            crate::authority::HUMAN_PRESENT_KEY.to_owned(),
            Value::String(command.to_owned()),
        );
    }
    if require_human || answered {
        // The prompt was answered by a person; the plugin gate refuses a require-human command
        // without it, and the host gives `person` only with both marks naming this command.
        context.extra.insert(
            crate::middleware::HUMAN_CONFIRMED_KEY.to_owned(),
            Value::String(command.to_owned()),
        );
    }
    let trace_id = context.trace_id.clone();
    let started = Instant::now();
    let result = client.call(command, input, Some(context)).await;
    logging::log_call(
        command,
        trace_id.as_deref(),
        started.elapsed().as_millis(),
        result.success,
    );
    writers.exit_for(&result)
}

async fn run_batch(
    host: &Host,
    mut request: BatchRequest<Value>,
    writers: &mut Writers<'_>,
) -> i32 {
    // The request's `context` is caller input merged into `extra`, where host-owned keys such as
    // the terminal confirmation mark live, so it is dropped, as the MCP route ignores it.
    request.context = None;
    let mut context = host.cli_context();
    context.interface = Some(CommandInterface::Cli);
    let result = host
        .registry()
        .execute_batch_with_context(request, context)
        .await;
    let value = serde_json::to_value(&result).unwrap_or(Value::Null);
    writers.batch(&value);
    if !result.success {
        1
    } else if result.summary.failure_count > 0 {
        2
    } else {
        0
    }
}

/// An afd-batch request: a JSON object, or the path to a `.json` file holding one.
fn read_batch_request(argument: &str, cwd: &Path) -> Result<BatchRequest<Value>, String> {
    let text = if argument.trim_start().starts_with('{') {
        argument.to_owned()
    } else if argument.ends_with(".json") {
        std::fs::read_to_string(cwd.join(argument))
            .map_err(|error| format!("Cannot read {argument}: {error}"))?
    } else {
        return Err(format!(
            "'{argument}' is neither a JSON object nor a path ending in .json"
        ));
    };
    let value: Value =
        serde_json::from_str(&text).map_err(|error| format!("Invalid batch request: {error}"))?;
    if !value.is_object() {
        return Err("A batch request is a JSON object: {\"commands\":[...]}".to_owned());
    }
    serde_json::from_value(value).map_err(|error| format!("Invalid batch request: {error}"))
}

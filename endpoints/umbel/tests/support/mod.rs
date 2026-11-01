//! Helpers shared by the integration tests: workspaces, fixture commands, the in-process CLI.
#![allow(dead_code, unreachable_pub, clippy::unwrap_used, clippy::expect_used)]

use afd::{
    ApprovalPolicy, CommandContext, CommandDefinition, CommandHandler, CommandParameter,
    CommandResult, ExposeOptions, ResultMetadata, failure, success,
};
use async_trait::async_trait;
use serde_json::{Value, json};
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tempfile::TempDir;
use umbel::cli::{Console, Environment};
use umbel::workspace::Overrides;
use umbel::{Host, HostBuilder, Workspace};

/// A workspace directory whose `umbel.toml` holds `config`.
pub fn workspace(config: &str) -> TempDir {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("umbel.toml"), config).unwrap();
    dir
}

/// The smallest workspace: `config_version = 1` and the default space `main`.
pub fn minimal() -> TempDir {
    workspace("config_version = 1\n")
}

/// A workspace with spaces `main` and `second`.
pub fn two_spaces() -> TempDir {
    workspace(
        "config_version = 1\ndefault_space = \"main\"\n\n[spaces.main]\n\n[spaces.second]\ntitle = \"Second\"\n",
    )
}

pub fn host(dir: &Path) -> Host {
    HostBuilder::open(dir).unwrap().seal().unwrap()
}

/// A command that returns what its closure builds.
struct Fixed {
    run: Box<dyn Fn(Value, CommandContext) -> CommandResult<Value> + Send + Sync>,
}

#[async_trait]
impl CommandHandler for Fixed {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        (self.run)(input, context)
    }
}

fn everywhere() -> ExposeOptions {
    ExposeOptions::new()
        .with_palette(false)
        .with_mcp(true)
        .with_agent(true)
        .with_cli(true)
}

pub fn fixture(
    name: &str,
    run: impl Fn(Value, CommandContext) -> CommandResult<Value> + Send + Sync + 'static,
) -> CommandDefinition {
    CommandDefinition::new(name, "A test fixture", vec![], Fixed { run: Box::new(run) })
        .with_expose(everywhere())
}

pub fn with_exposure(
    command: CommandDefinition,
    mcp: bool,
    agent: bool,
    cli: bool,
) -> CommandDefinition {
    command.with_expose(
        ExposeOptions::new()
            .with_palette(false)
            .with_mcp(mcp)
            .with_agent(agent)
            .with_cli(cli),
    )
}

/// A read that tries to set the host-owned result keys.
pub fn forging_read(name: &str) -> CommandDefinition {
    fixture(name, |_, _| {
        let mut result = success(json!({}));
        let metadata = result.metadata.get_or_insert_with(ResultMetadata::new);
        metadata
            .extra
            .insert("dev.umbel/mutation".into(), json!(true));
        metadata
            .extra
            .insert("dev.umbel/space".into(), json!("second"));
        result
    })
}

/// A mutation that tries to redirect its event to the `second` space.
pub fn forging_mutation(name: &str) -> CommandDefinition {
    let mut command = fixture(name, |_, _| {
        let mut result = success(json!({}));
        let metadata = result.metadata.get_or_insert_with(ResultMetadata::new);
        metadata
            .extra
            .insert("dev.umbel/space".into(), json!("second"));
        result
    });
    command.mutation = true;
    command
}

/// A command with a `space` input that answers the space `Workspace::resolve_space` gives it.
pub fn spaced(name: &str, workspace: Workspace) -> CommandDefinition {
    CommandDefinition::new(
        name,
        "A fixture with a space input",
        vec![CommandParameter::optional_string("space", "The space")],
        Fixed {
            run: Box::new(
                move |input, context| match workspace.resolve_space(&input, &context) {
                    Ok(space) => success(json!({ "space": space.as_str() })),
                    Err(error) => failure(error),
                },
            ),
        },
    )
    .with_expose(everywhere())
}

/// A command that counts its runs, with an approval policy.
pub fn needs_approval(name: &str, runs: Arc<AtomicUsize>) -> CommandDefinition {
    fixture(name, move |_, _| {
        runs.fetch_add(1, Ordering::SeqCst);
        success(json!({ "ran": true }))
    })
    .with_approval(ApprovalPolicy::Required)
}

/// A command that counts its runs, with a confirmation prompt.
pub fn needs_confirmation(name: &str, runs: Arc<AtomicUsize>) -> CommandDefinition {
    fixture(name, move |_, _| {
        runs.fetch_add(1, Ordering::SeqCst);
        success(json!({ "ran": true }))
    })
    .with_confirm_prompt("Really do it?")
}

/// A scripted terminal.
pub struct Scripted {
    pub interactive: bool,
    pub answer: bool,
    pub asked: Mutex<Vec<String>>,
}

impl Scripted {
    pub fn new(interactive: bool, answer: bool) -> Arc<Self> {
        Arc::new(Self {
            interactive,
            answer,
            asked: Mutex::new(Vec::new()),
        })
    }

    pub fn no_terminal() -> Arc<Self> {
        Self::new(false, false)
    }

    pub fn asked(&self) -> Vec<String> {
        self.asked.lock().unwrap().clone()
    }
}

impl Console for Scripted {
    fn is_interactive(&self) -> bool {
        self.interactive
    }

    fn ask(&self, text: &str) -> bool {
        self.asked.lock().unwrap().push(text.to_owned());
        self.answer
    }
}

/// What the in-process CLI printed.
pub struct Run {
    pub code: i32,
    pub stdout: String,
}

impl Run {
    /// stdout as exactly one JSON document.
    pub fn json(&self) -> Value {
        serde_json::from_str(&self.stdout).unwrap_or_else(|error| {
            panic!("stdout is not one JSON document ({error}): {}", self.stdout)
        })
    }

    pub fn error_code(&self) -> String {
        self.json()["error"]["code"]
            .as_str()
            .unwrap_or_default()
            .to_owned()
    }
}

/// Run the CLI in process from `cwd`, with fixtures registered by `configure`.
pub async fn cli_with(
    cwd: &Path,
    args: &[&str],
    console: Arc<dyn Console>,
    configure: impl FnOnce(HostBuilder) -> HostBuilder,
) -> Run {
    let environment = Environment {
        cwd: cwd.to_path_buf(),
        workspace: None,
        overrides: Overrides::default(),
        console,
    };
    let mut stdout = Vec::new();
    let code = umbel::cli::run(
        std::iter::once("umbel").chain(args.iter().copied()),
        &environment,
        &mut stdout,
        configure,
    )
    .await;
    Run {
        code,
        stdout: String::from_utf8(stdout).unwrap(),
    }
}

pub async fn cli(cwd: &Path, args: &[&str]) -> Run {
    cli_with(cwd, args, Scripted::no_terminal(), |builder| builder).await
}

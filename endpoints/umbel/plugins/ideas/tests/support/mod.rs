//! A workspace with the ideas plugin and its grants (the specification's section 11.4, cut to
//! what a test needs), and the means to call it: as an agent acting for the space's person over
//! MCP, as the operator at the command line, and as the person at a terminal. Every text is an
//! invented fixture about gardening.
#![allow(dead_code, unreachable_pub, clippy::unwrap_used, clippy::expect_used)]

pub mod stub;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use afd::{Actor, ActorKind, CommandInterface, CommandResult, fixed_clock};
use serde_json::{Value, json};
use tempfile::TempDir;
use umbel::cli::{Console, Environment};
use umbel::plugins::sdk;
use umbel::{Host, HostBuilder};

/// The host's clock: 2026-01-01T00:00:00Z.
pub const NOW: i64 = 1_767_225_600_000;

/// The space `main`, whose person is `human:ada`, and `beta`, which has none; the CLI's caller
/// is `ada` and the stdio agent acts for her; the ideas plugin writes records the whole space
/// reads, in both.
pub fn config() -> String {
    config_with("default_access = \"space\"")
}

/// [`config`] with `grant` in place of the write grant's `default_access` line.
pub fn config_with(grant: &str) -> String {
    format!(
        r#"config_version = 6
default_space = "main"

[principal]
local_id = "ada"
on_behalf_of = "ada"

[spaces.main]
person = "human:ada"

[spaces.beta]

[plugins]
enabled = ["ideas"]

[plugins.ideas]
source = "compiled:ideas"

[plugins.ideas.grants.records_write]
allow = ["main", "beta"]
{grant}
"#
    )
}

pub struct Fx {
    pub dir: TempDir,
    pub host: Host,
    pub clock: i64,
}

pub fn build(dir: &Path, clock: i64) -> Host {
    HostBuilder::open(dir)
        .unwrap()
        .with_compiled(Arc::new(sdk(umbel_plugin_ideas::plugin())))
        .with_clock(fixed_clock(clock))
        .seal()
        .unwrap()
}

impl Fx {
    pub fn new() -> Self {
        Self::with(&config())
    }

    pub fn with(config: &str) -> Self {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("umbel.toml"), config).unwrap();
        let host = build(dir.path(), NOW);
        Self {
            dir,
            host,
            clock: NOW,
        }
    }

    pub fn path(&self, relative: &str) -> PathBuf {
        self.dir.path().join(relative)
    }

    /// Reopen the workspace, with the clock at `clock`.
    pub fn at(&mut self, clock: i64) {
        self.clock = clock;
        self.host = build(self.dir.path(), clock);
    }

    /// Override the vocabulary pack in `space` with the default pack, `file` replaced by `text`
    /// (or removed when `None`), and reopen.
    pub fn pack_override(&mut self, space: &str, file: &str, text: Option<&str>) {
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("packs/vocabulary");
        let target = self.path(&format!("spaces/{space}/packs/ideas/vocabulary"));
        std::fs::create_dir_all(target.join("data")).unwrap();
        for name in [
            "pack.toml",
            "data/types.toml",
            "data/matching.toml",
            "data/limits.toml",
        ] {
            std::fs::copy(source.join(name), target.join(name)).unwrap();
        }
        match text {
            Some(text) => std::fs::write(target.join(file), text).unwrap(),
            None => std::fs::remove_file(target.join(file)).unwrap(),
        }
        self.host = build(self.dir.path(), self.clock);
    }

    pub async fn call(
        &self,
        actor: Actor,
        interface: CommandInterface,
        command: &str,
        input: Value,
    ) -> Value {
        let context = self.host.context(actor).with_interface(interface);
        json_of(
            self.host
                .registry()
                .execute(command, input, Some(context))
                .await,
        )
    }

    /// The stdio agent over MCP, asking for an output budget of `ask` bytes.
    pub async fn agent_with_budget(&self, command: &str, input: Value, ask: u64) -> Value {
        let context = self
            .host
            .context(agent_for("gardener-bot", "ada"))
            .with_interface(CommandInterface::Mcp)
            .with_output_budget_ask(ask);
        json_of(
            self.host
                .registry()
                .execute(command, input, Some(context))
                .await,
        )
    }

    /// The stdio agent acting for the space's person, over MCP.
    pub async fn agent(&self, command: &str, input: Value) -> Value {
        self.call(
            agent_for("gardener-bot", "ada"),
            CommandInterface::Mcp,
            command,
            input,
        )
        .await
    }

    /// Another agent, acting for another person, over MCP.
    pub async fn stranger(&self, command: &str, input: Value) -> Value {
        self.call(
            agent_for("other-bot", "rowan"),
            CommandInterface::Mcp,
            command,
            input,
        )
        .await
    }

    /// Run the command line in process, as `principal.local_id`, with `console` for a terminal
    /// and these environment variables.
    pub async fn command_line(
        &self,
        console: Arc<dyn Console>,
        args: &[&str],
        vars: &[(&str, &str)],
    ) -> (i32, Value) {
        let mut environment = Environment::from_process();
        environment.cwd = self.dir.path().to_path_buf();
        environment.workspace = None;
        environment.console = console;
        environment.vars.clear();
        for (name, value) in vars {
            environment
                .vars
                .insert((*name).to_owned(), (*value).to_owned());
        }
        let clock = self.clock;
        let mut stdout = Vec::new();
        let code = umbel::cli::run(
            std::iter::once("umbel").chain(args.iter().copied()),
            &environment,
            &mut stdout,
            move |builder: HostBuilder| {
                builder
                    .with_compiled(Arc::new(sdk(umbel_plugin_ideas::plugin())))
                    .with_clock(fixed_clock(clock))
            },
        )
        .await;
        let text = String::from_utf8(stdout).unwrap();
        let value = serde_json::from_str(&text)
            .unwrap_or_else(|error| panic!("stdout is not one JSON document ({error}): {text}"));
        (code, value)
    }

    /// `command` at the command line with no person at the terminal: the operator.
    pub async fn operator(&self, command: &str, input: Value) -> Value {
        self.command_line(
            Terminal::new(false, false),
            &["call", command, &input.to_string()],
            &[],
        )
        .await
        .1
    }

    /// `command` at a terminal where the person answers `answer`, with `extra` arguments and
    /// environment variables; the result and what was asked.
    pub async fn terminal(
        &self,
        command: &str,
        input: Value,
        answer: bool,
        extra: &[&str],
        vars: &[(&str, &str)],
    ) -> (Value, Vec<String>) {
        let console = Terminal::new(true, answer);
        let input = input.to_string();
        let mut args = vec!["call", command, input.as_str()];
        args.extend_from_slice(extra);
        let (_, value) = self.command_line(console.clone(), &args, vars).await;
        (value, console.asked())
    }

    /// The person at a terminal, answering yes.
    pub async fn person(&self, command: &str, input: Value) -> Value {
        self.terminal(command, input, true, &[], &[]).await.0
    }

    /// Capture `statements` as the agent, each a `principle` the person said; their ids.
    pub async fn capture(&self, statements: &[&str]) -> Vec<String> {
        let ideas: Vec<Value> = statements
            .iter()
            .map(|s| json!({ "statement": s, "type": "principle", "said": "person" }))
            .collect();
        let result = self.agent("ideas-capture", json!({ "ideas": ideas })).await;
        data(&result)["ideas"]
            .as_array()
            .unwrap()
            .iter()
            .map(|idea| idea["id"].as_str().unwrap().to_owned())
            .collect()
    }

    /// Every byte of the journal, the log and the event streams, as text.
    pub fn journaled_text(&self) -> String {
        let mut text = String::new();
        for relative in ["state/journal.jsonl", "state/log.jsonl"] {
            text.push_str(&std::fs::read_to_string(self.path(relative)).unwrap_or_default());
        }
        for space in ["main", "beta"] {
            text.push_str(
                &std::fs::read_to_string(self.path(&format!("state/spaces/{space}/events.jsonl")))
                    .unwrap_or_default(),
            );
        }
        text
    }
}

/// A store whose ideas `statements` hold, the wordings at `affirm` affirmed by its person.
/// Version 1 affirms only in a confirmed review (step C3) or a restore, so the ideas are
/// captured in a first store, exported, marked affirmed as an archive of a store that had
/// affirmed them would be, and imported by the person into a fresh store, which is answered
/// with the ideas' ids.
pub async fn affirmed_store(statements: &[&str], affirm: &[usize]) -> (Fx, Vec<String>) {
    let first = Fx::new();
    let ids = first.capture(statements).await;
    let exported = first.operator("ideas-export", json!({})).await;
    let mut items = data(&exported)["items"].as_array().unwrap().clone();
    for item in &mut items {
        let marked = affirm
            .iter()
            .any(|index| item["kind"] == "wording" && item["body"]["idea"] == ids[*index].as_str());
        if marked {
            item["affirmed"] = json!({ "at": "2025-12-31T09:00:00.000Z", "level": "terminal" });
        }
    }
    let second = Fx::new();
    let imported = second
        .person("ideas-import", json!({ "items": items }))
        .await;
    assert_eq!(data(&imported)["affirmed"], affirm.len(), "{imported}");
    (second, ids)
}

/// A scripted terminal: whether a person can answer, what they answer, and what was asked.
pub struct Terminal {
    pub interactive: bool,
    pub answer: bool,
    pub asked: Mutex<Vec<String>>,
}

impl Terminal {
    pub fn new(interactive: bool, answer: bool) -> Arc<Self> {
        Arc::new(Self {
            interactive,
            answer,
            asked: Mutex::new(Vec::new()),
        })
    }

    pub fn asked(&self) -> Vec<String> {
        self.asked.lock().unwrap().clone()
    }
}

impl Console for Terminal {
    fn is_interactive(&self) -> bool {
        self.interactive
    }

    fn ask(&self, text: &str) -> bool {
        self.asked.lock().unwrap().push(text.to_owned());
        self.answer
    }
}

pub fn agent_for(id: &str, person: &str) -> Actor {
    Actor::new(ActorKind::Agent)
        .with_id(id)
        .with_on_behalf_of(person)
}

pub fn json_of(result: CommandResult<Value>) -> Value {
    serde_json::to_value(result).unwrap()
}

/// `data` of a successful result.
#[track_caller]
pub fn data(result: &Value) -> &Value {
    assert_eq!(result["success"], true, "{result}");
    &result["data"]
}

/// The error code of a failed result.
#[track_caller]
pub fn code(result: &Value) -> &str {
    assert_eq!(result["success"], false, "{result}");
    result["error"]["code"].as_str().unwrap()
}

/// The warning with this code, if the result has one.
pub fn warning<'a>(result: &'a Value, code: &str) -> Option<&'a Value> {
    result["warnings"]
        .as_array()?
        .iter()
        .find(|warning| warning["code"] == code)
}

/// Panic if any needle appears in `haystack`.
#[track_caller]
pub fn never_mentions(haystack: &str, needles: &[&str]) {
    for needle in needles {
        assert!(
            !haystack.contains(needle),
            "`{needle}` appears in {haystack}"
        );
    }
}

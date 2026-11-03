//! Pipeline attestation (phase 4 specification, section 10.1, D91): the host gives each step of a
//! plugin pipeline a fresh random trace id and records the step, keyed by it, in a table of its
//! own, and `CallContext.pipeline` (the SDK) and `CallServices::pipeline` (a raw compiled plugin)
//! read only that table.
//!
//! - **Set for steps:** every step of a pipeline sees `{ plugin, instance, pipeline, run }`, the
//!   plugin and instance that ship the pipeline and the pipeline call's trace id, over the library
//!   and the CLI; each step's trace id is 128 random bits, not AFD's `<id>-step-<i>`.
//! - **Absent for direct calls** on every surface: the library, the CLI, `umbel batch`, and MCP's
//!   `afd-call`, `afd-batch` and `afd-pipe` on every lane.
//! - **Absent after the step:** a call under a finished step's trace id, or the run's, has none.
//! - **A guessed trace refused:** while a step runs, calls under guessed trace ids, AFD's step id
//!   pattern included, have none, and neither does a call over MCP.
//! - **The wrong command refused:** under a running step's own trace id, any command but the
//!   step's has none, and so does a service handle made without naming the command.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::sync::mpsc::{Receiver, Sender, channel};
use std::sync::{Arc, Mutex, OnceLock, Weak};

use afd::{CommandContext, CommandHandler, CommandRegistry, CommandResult};
use async_trait::async_trait;
use serde_json::{Value, json};
use support::mcp::{Client, Era, Transport};
use support::plugins::{Raw, config, seal};
use support::{Scripted, agent, cli_with};
use umbel::plugins::{PipelineAttestation, PluginCommand, Services, sdk};
use umbel_sdk::{Cx, Outcome, Plugin};

const ANY: &str = "{ type = \"object\" }";

/// The `drafter` plugin: two own commands and two pipelines over its own and `sink`'s commands.
fn drafter_manifest() -> String {
    format!(
        r#"manifest_version = 4
protocol = 1

[plugin]
id = "drafter"
title = "Drafter"
version = "0.1.0"
description = "Runs pipelines whose steps report their attestation."
kind = "compiled"
domains = ["drafter"]

[[commands]]
name = "drafter-plan"
description = "Report this step's attestation."
effects = ["inspect"]
input_schema = {ANY}

[[commands]]
name = "drafter-probe"
description = "Try the attestation under other names and handles."
effects = ["inspect"]
input_schema = {ANY}

[[pipelines]]
name = "drafter-run"
description = "Plan, take, probe."
effects = ["inspect"]
input_schema = {ANY}
steps = [
  {{ command = "drafter-plan", as = "plan" }},
  {{ command = "sink-take", as = "take" }},
  {{ command = "drafter-probe", as = "probe" }},
]

[[pipelines]]
name = "drafter-hold"
description = "Hold a step open."
effects = ["inspect"]
input_schema = {ANY}
steps = [ {{ command = "sink-hold", as = "hold" }} ]
"#
    )
}

const SINK_MANIFEST: &str = r#"manifest_version = 4
protocol = 1

[plugin]
id = "sink"
title = "Sink"
version = "0.1.0"
description = "An SDK plugin whose commands report CallContext.pipeline."
kind = "compiled"
domains = ["sink"]

[[commands]]
name = "sink-take"
description = "Report CallContext.pipeline and the trace id."
effects = ["inspect"]
input_schema = { type = "object" }

[[commands]]
name = "sink-hold"
description = "Report, then wait until the test releases it."
effects = ["inspect"]
input_schema = { type = "object" }
"#;

fn attestation_json(attestation: Option<&PipelineAttestation>) -> Value {
    attestation.map_or(Value::Null, |a| {
        json!({ "plugin": a.plugin, "instance": a.instance, "pipeline": a.pipeline, "run": a.run })
    })
}

/// What `sink-hold` uses to say it started and to wait for its release.
#[derive(Clone)]
struct Hold {
    started: Arc<Mutex<Sender<String>>>,
    release: Arc<Mutex<Receiver<()>>>,
}

struct Sink {
    hold: Option<Hold>,
}

impl Plugin for Sink {
    fn manifest(&self) -> &'static str {
        SINK_MANIFEST
    }

    fn handle(&self, name: &str, _input: Value, cx: &mut Cx) -> Outcome {
        let call = cx.call();
        let report = json!({
            "pipeline": attestation_json(call.pipeline.as_ref()),
            "trace": call.trace_id,
        });
        if name == "sink-hold"
            && let Some(hold) = &self.hold
        {
            let _ = hold.started.lock().unwrap().send(call.trace_id.clone());
            let _ = hold.release.lock().unwrap().recv();
        }
        umbel_sdk::success(report)
    }
}

/// `drafter-plan`: the step's attestation through the raw services.
struct Plan {
    services: Services,
}

#[async_trait]
impl CommandHandler for Plan {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let own = self
            .services
            .call_command("drafter-plan", &input, &context)
            .pipeline();
        afd::success(json!({
            "pipeline": attestation_json(own.as_ref()),
            "trace": context.trace_id,
        }))
    }
}

/// `drafter-probe`: under its own trace id, the attestation through every other handle.
struct Probe {
    services: Services,
    registry: Arc<OnceLock<Weak<CommandRegistry>>>,
}

#[async_trait]
impl CommandHandler for Probe {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let own = self
            .services
            .call_command("drafter-probe", &input, &context)
            .pipeline();
        // Another command of the same instance, under this step's trace id.
        let other = self
            .services
            .call_command("drafter-plan", &input, &context)
            .pipeline();
        // A handle that names no command.
        let unnamed = self.services.call(&input, &context).pipeline();
        // Another plugin's command, called under this step's trace id (a library embedder's
        // move: the step's handler has the trace id).
        let nested = match self.registry.get().and_then(Weak::upgrade) {
            Some(registry) => {
                registry
                    .execute("sink-take", json!({}), Some(context.clone()))
                    .await
            }
            None => afd::success(json!({ "error": "no registry" })),
        };
        afd::success(json!({
            "own": attestation_json(own.as_ref()),
            "other": attestation_json(other.as_ref()),
            "unnamed": attestation_json(unnamed.as_ref()),
            "nested": nested.data,
            "trace": context.trace_id,
        }))
    }
}

struct Fixture {
    _dir: tempfile::TempDir,
    host: umbel::Host,
}

fn boot(hold: Option<Hold>) -> Fixture {
    let registry: Arc<OnceLock<Weak<CommandRegistry>>> = Arc::new(OnceLock::new());
    let cell = Arc::clone(&registry);
    let drafter = Raw::new(drafter_manifest(), move |services| {
        Ok(vec![
            PluginCommand::handler(
                "drafter-plan",
                Plan {
                    services: services.clone(),
                },
            ),
            PluginCommand::handler(
                "drafter-probe",
                Probe {
                    services,
                    registry: Arc::clone(&cell),
                },
            ),
        ])
    });
    let dir = support::workspace(&config(
        &[("author", "source = \"compiled:drafter\""), ("sink", "")],
        "",
    ));
    let host = seal(dir.path(), |b| {
        b.with_compiled(drafter).with_compiled(sdk(Sink { hold }))
    })
    .unwrap();
    let _ = registry.set(Arc::downgrade(&host.registry()));
    Fixture { _dir: dir, host }
}

fn is_step_trace(trace: &Value) -> bool {
    trace
        .as_str()
        .is_some_and(|t| t.len() == 32 && t.chars().all(|c| c.is_ascii_hexdigit()))
}

/// The step named `alias` of a pipeline result.
fn step<'a>(data: &'a Value, alias: &str) -> &'a Value {
    data["steps"]
        .as_array()
        .unwrap()
        .iter()
        .find(|step| step["as"] == alias)
        .unwrap_or_else(|| panic!("no step {alias}: {data}"))
}

fn expected(run: &str) -> Value {
    json!({ "plugin": "drafter", "instance": "author", "pipeline": "drafter-run", "run": run })
}

/// Every `pipeline` key in `value` is null: a direct call saw no attestation.
fn assert_unattested(value: &Value) {
    let text = value.to_string();
    assert!(
        text.contains("\"pipeline\":null"),
        "the call did not run: {text}"
    );
    assert!(
        !text.contains("\"run\":"),
        "an attestation reached a direct call: {text}"
    );
}

// ── Set for steps ────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn every_step_is_attested_with_the_owner_the_pipeline_and_the_run() {
    let fx = boot(None);
    let context = fx.host.context(agent("a"));
    let run = context.trace_id.clone().unwrap();
    let result = fx
        .host
        .registry()
        .execute("drafter-run", json!({}), Some(context))
        .await;
    assert!(result.success, "{result:?}");
    let data = result.data.unwrap();
    let (plan, take, probe) = (
        step(&data, "plan"),
        step(&data, "take"),
        step(&data, "probe"),
    );
    // The raw services and the SDK's CallContext see the same attestation.
    assert_eq!(plan["data"]["pipeline"], expected(&run), "{data}");
    assert_eq!(take["data"]["pipeline"], expected(&run), "{data}");
    assert_eq!(probe["data"]["own"], expected(&run), "{data}");

    // Each step has a trace id of its own: 128 random bits, not the run's, not AFD's pattern.
    let traces: Vec<&Value> = [plan, take, probe]
        .iter()
        .map(|step| &step["data"]["trace"])
        .collect();
    for trace in &traces {
        assert!(is_step_trace(trace), "{trace}");
        assert_ne!(trace.as_str(), Some(run.as_str()));
        assert!(!trace.as_str().unwrap().contains("-step-"));
    }
    assert_ne!(traces[0], traces[1]);
    assert_ne!(traces[1], traces[2]);
    assert_ne!(traces[0], traces[2]);

    // The wrong command refused: under the probe step's own trace id, another command of the
    // same instance, a handle that names no command and another plugin's command all see none.
    assert_eq!(probe["data"]["other"], Value::Null, "{data}");
    assert_eq!(probe["data"]["unnamed"], Value::Null, "{data}");
    assert_eq!(probe["data"]["nested"]["pipeline"], Value::Null, "{data}");
    assert_eq!(probe["data"]["nested"]["trace"], probe["data"]["trace"]);
}

#[tokio::test]
async fn over_the_cli_the_steps_are_attested_too() {
    let fx = boot(None);
    let run = cli_with(
        fx._dir.path(),
        &["call", "drafter-run"],
        Scripted::no_terminal(),
        |b| {
            b.with_compiled(drafter_for_cli())
                .with_compiled(sdk(Sink { hold: None }))
        },
    )
    .await;
    assert_eq!(run.code, 0, "{}", run.stdout);
    let data = run.json()["data"].clone();
    let plan = step(&data, "plan")["data"]["pipeline"].clone();
    let take = step(&data, "take")["data"]["pipeline"].clone();
    assert_eq!(plan, take, "{data}");
    assert_eq!(plan["plugin"], "drafter");
    assert_eq!(plan["instance"], "author");
    assert_eq!(plan["pipeline"], "drafter-run");
    // The CLI's trace id, which the CLI drew for the pipeline call.
    assert!(is_step_trace(&plan["run"]), "{plan}");
    assert_ne!(plan["run"], step(&data, "take")["data"]["trace"]);
}

/// The drafter for a CLI run, which seals a host of its own: `drafter-probe` has no registry.
fn drafter_for_cli() -> Raw {
    Raw::new(drafter_manifest(), |services| {
        Ok(vec![
            PluginCommand::handler(
                "drafter-plan",
                Plan {
                    services: services.clone(),
                },
            ),
            PluginCommand::handler(
                "drafter-probe",
                Probe {
                    services,
                    registry: Arc::new(OnceLock::new()),
                },
            ),
        ])
    })
}

// ── Absent for direct calls ──────────────────────────────────────────────────────────────────

#[tokio::test]
async fn a_direct_call_is_never_attested_on_any_surface() {
    let fx = boot(None);
    let host = &fx.host;
    let direct = support::call(host, agent("a"), "sink-take", json!({})).await;
    assert!(direct.success, "{direct:?}");
    assert_unattested(&serde_json::to_value(&direct).unwrap());

    let configure = |b: umbel::HostBuilder| {
        b.with_compiled(drafter_for_cli())
            .with_compiled(sdk(Sink { hold: None }))
    };
    let cli = cli_with(
        fx._dir.path(),
        &["call", "sink-take"],
        Scripted::no_terminal(),
        configure,
    )
    .await;
    assert_eq!(cli.code, 0, "{}", cli.stdout);
    assert_unattested(&cli.json());
    let batch = cli_with(
        fx._dir.path(),
        &[
            "batch",
            r#"{"commands":[{"command":"sink-take","input":{}},{"command":"drafter-plan","input":{}}]}"#,
        ],
        Scripted::no_terminal(),
        configure,
    )
    .await;
    assert_eq!(batch.code, 0, "{}", batch.stdout);
    assert_unattested(&batch.json());

    for mut client in Client::lanes(host).await {
        let label = client.label();
        let called = client.afd_call("sink-take", json!({})).await;
        assert_eq!(called["success"], true, "{label}: {called}");
        assert_unattested(&called);
        let batched = client
            .call(
                "afd-batch",
                json!({ "commands": [{ "command": "sink-take", "input": {} }] }),
            )
            .await;
        assert_unattested(&batched);
        // `afd-pipe` runs its steps under AFD's `<id>-step-<i>` trace ids: not attested.
        let piped = client
            .call(
                "afd-pipe",
                json!({ "steps": [{ "command": "sink-take", "input": {} }, { "command": "drafter-plan" }] }),
            )
            .await;
        assert_unattested(&piped);
        assert!(
            piped.to_string().contains("-step-"),
            "{label}: afd-pipe's own step ids: {piped}"
        );
    }
}

// ── Absent after the step ────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn the_attestation_ends_with_the_step() {
    let fx = boot(None);
    let context = fx.host.context(agent("a"));
    let run = context.trace_id.clone().unwrap();
    let result = fx
        .host
        .registry()
        .execute("drafter-run", json!({}), Some(context))
        .await;
    let data = result.data.unwrap();
    let take = step(&data, "take")["data"]["trace"]
        .as_str()
        .unwrap()
        .to_owned();
    let plan = step(&data, "plan")["data"]["trace"]
        .as_str()
        .unwrap()
        .to_owned();
    // A library embedder may choose any trace id: a finished step's, for the step's own
    // command, has nothing left to read; nor does the run's.
    for (command, trace) in [
        ("sink-take", take.as_str()),
        ("drafter-plan", plan.as_str()),
        ("sink-take", run.as_str()),
        ("drafter-plan", run.as_str()),
    ] {
        let context = fx.host.context(agent("a")).with_trace_id(trace);
        let again = fx
            .host
            .registry()
            .execute(command, json!({}), Some(context))
            .await;
        assert!(again.success, "{again:?}");
        assert_eq!(
            again.data.unwrap()["pipeline"],
            Value::Null,
            "{command} under {trace}"
        );
    }
}

// ── A guessed trace refused ──────────────────────────────────────────────────────────────────

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_guessed_trace_is_refused_while_a_step_runs() {
    let (started_tx, started_rx) = channel::<String>();
    let (release_tx, release_rx) = channel::<()>();
    let fx = boot(Some(Hold {
        started: Arc::new(Mutex::new(started_tx)),
        release: Arc::new(Mutex::new(release_rx)),
    }));
    let host = Arc::new(fx.host);
    let context = host.context(agent("a"));
    let run = context.trace_id.clone().unwrap();
    let running = {
        let host = Arc::clone(&host);
        tokio::spawn(async move {
            host.registry()
                .execute("drafter-hold", json!({}), Some(context))
                .await
        })
    };
    let live = tokio::task::spawn_blocking(move || started_rx.recv().unwrap())
        .await
        .unwrap();
    assert_eq!(live.len(), 32, "{live}");

    // Guesses: AFD's step id pattern, the run's trace id with a suffix, and random ids.
    let millis = chrono_millis();
    let mut guesses: Vec<String> = (0..3)
        .flat_map(|i| {
            [
                format!("pipeline-{millis}-step-{i}"),
                format!("pipeline-{}-step-{i}", millis - 1),
                format!("{run}-step-{i}"),
                format!("{run}-{i}"),
            ]
        })
        .collect();
    guesses.push("0".repeat(32));
    guesses.push(format!(
        "{:032x}",
        u128::from_str_radix(&live, 16).unwrap() ^ 1
    ));
    for guess in &guesses {
        let context = host.context(agent("a")).with_trace_id(guess);
        let answer = host
            .registry()
            .execute("sink-take", json!({}), Some(context))
            .await;
        assert_eq!(answer.data.unwrap()["pipeline"], Value::Null, "{guess}");
    }
    // The live trace id itself, for a command the step does not run.
    let context = host.context(agent("a")).with_trace_id(&live);
    let wrong = host
        .registry()
        .execute("sink-take", json!({}), Some(context))
        .await;
    assert_eq!(wrong.data.unwrap()["pipeline"], Value::Null);
    // Over MCP, the server makes the trace id; the step's is not reachable.
    let mut client = Client::connect(&host, Transport::Stdio, Era::Legacy).await;
    assert_unattested(&client.afd_call("sink-take", json!({})).await);

    release_tx.send(()).unwrap();
    let held = running.await.unwrap();
    assert!(held.success, "{held:?}");
    let hold = step(held.data.as_ref().unwrap(), "hold")["data"].clone();
    assert_eq!(hold["trace"], live);
    assert_eq!(
        hold["pipeline"],
        json!({ "plugin": "drafter", "instance": "author", "pipeline": "drafter-hold", "run": run })
    );
}

fn chrono_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| i64::try_from(elapsed.as_millis()).unwrap_or(0))
}

// ── Runs apart ───────────────────────────────────────────────────────────────────────────────

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_runs_are_attested_apart() {
    let fx = boot(None);
    let host = Arc::new(fx.host);
    let mut runs = Vec::new();
    for _ in 0..8 {
        let host = Arc::clone(&host);
        runs.push(tokio::spawn(async move {
            let context = host.context(agent("a"));
            let run = context.trace_id.clone().unwrap();
            let result = host
                .registry()
                .execute("drafter-run", json!({}), Some(context))
                .await;
            (run, result)
        }));
    }
    let mut traces = std::collections::BTreeSet::new();
    for handle in runs {
        let (run, result) = handle.await.unwrap();
        let data = result.data.unwrap();
        for alias in ["plan", "take"] {
            assert_eq!(step(&data, alias)["data"]["pipeline"], expected(&run));
            assert!(traces.insert(step(&data, alias)["data"]["trace"].to_string()));
        }
    }
    assert_eq!(traces.len(), 16);
}

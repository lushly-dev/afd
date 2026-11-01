//! Compiled-plugin fixtures: a probe SDK plugin whose commands report what its grants allow, and
//! a raw `CompiledPlugin` whose commands a test builds.
#![allow(dead_code, unreachable_pub, clippy::unwrap_used, clippy::expect_used)]

use afd::{CommandContext, CommandHandler, CommandResult, ResultMetadata, success};
use async_trait::async_trait;
use serde_json::{Value, json};
use umbel::HostBuilder;
use umbel::plugins::{Asset, CompiledPlugin, PluginCommand, PluginError, Services};
use umbel_sdk::{Cx, HostError, Outcome, Plugin};

/// Leak a string: manifests are `&'static str` in the SDK, and a test process is short.
pub fn leak(text: String) -> &'static str {
    Box::leak(text.into_boxed_str())
}

pub static PROBE_ASSETS: &[Asset] = &[
    Asset {
        path: "packs/p/pack.toml",
        bytes: b"pack_version = 1\nid = \"p\"\nplugin = \"probe\"\nversion = \"1.0.0\"\ntitle = \"P\"\ndescription = \"d\"\n",
    },
    Asset {
        path: "packs/p/data/x.txt",
        bytes: b"salt\nsecond line\n",
    },
    Asset {
        path: "skills/probe-guide/SKILL.md",
        bytes: b"---\nname: probe-guide\ndescription: d\n---\n# guide\n",
    },
];

/// A `[[grants]]` list.
pub fn grants_toml(names: &[&str], required: bool) -> String {
    names
        .iter()
        .map(|name| {
            format!("[[grants]]\nname = \"{name}\"\nrequired = {required}\nreason = \"the probe uses {name}\"\n")
        })
        .collect()
}

const SPACE_INPUT: &str = "{ type = \"object\", properties = { space = { type = \"string\" }, text = { type = \"string\" }, events_space = { type = \"string\" }, after = { type = \"string\" } }, additionalProperties = false }";
const PLAIN_INPUT: &str = "{ type = \"object\", properties = {}, additionalProperties = false }";

/// The probe plugin's manifest with `grants` (a `[[grants]]` list) and `extra` appended.
pub fn probe_manifest(grants: &str, extra: &str) -> String {
    format!(
        r#"manifest_version = 1
protocol = 1

[plugin]
id = "probe"
title = "Probe"
version = "0.3.0"
description = "A plugin whose commands report what its grants allow."
kind = "compiled"
domains = ["probe"]

{grants}
[[commands]]
name = "probe-grants"
description = "Report which host services this call may use."
effects = ["inspect"]
input_schema = {PLAIN_INPUT}

[[commands]]
name = "probe-note"
description = "Record a note, in a space."
effects = ["plugin-state"]
input_schema = {SPACE_INPUT}

[[commands]]
name = "probe-events"
description = "Read events through the events grant."
effects = ["inspect"]
input_schema = {SPACE_INPUT}

[[commands]]
name = "probe-panic"
description = "Panic."
effects = ["inspect"]
input_schema = {PLAIN_INPUT}

[[commands]]
name = "probe-forge"
description = "Try to set the host's result keys."
effects = ["plugin-state"]
input_schema = {PLAIN_INPUT}

[[packs]]
id = "p"
path = "packs/p"

[[skills]]
name = "probe-guide"
path = "skills/probe-guide"
{extra}"#
    )
}

fn label<T>(result: Result<T, HostError>) -> Value {
    match result {
        Ok(_) => json!("ok"),
        Err(HostError::NotGranted(_)) => json!("not-granted"),
        Err(other) => json!(format!("other: {other}")),
    }
}

/// The probe's code, as an SDK plugin.
pub struct Probe {
    manifest: &'static str,
}

impl Probe {
    pub fn new(grants: &[&str]) -> Self {
        Self::with_manifest(probe_manifest(&grants_toml(grants, true), ""))
    }

    pub fn optional(grants: &[&str]) -> Self {
        Self::with_manifest(probe_manifest(&grants_toml(grants, false), ""))
    }

    pub fn with_manifest(text: String) -> Self {
        Self {
            manifest: leak(text),
        }
    }
}

impl Plugin for Probe {
    fn manifest(&self) -> &'static str {
        self.manifest
    }

    fn assets(&self) -> &'static [Asset] {
        PROBE_ASSETS
    }

    fn handle(&self, name: &str, input: Value, cx: &mut Cx) -> Outcome {
        match name {
            "probe-grants" => {
                cx.log(umbel_sdk::Level::Info, "probing");
                umbel_sdk::success(json!({
                    "config": label(cx.config()),
                    "packs": label(cx.pack_read("p", "data/x.txt")),
                    "events": label(cx.events(None, None, 10)),
                    "clock": label(cx.now_ms()),
                    "random": label(cx.random()),
                }))
            }
            "probe-note" => {
                let text = input.get("text").and_then(Value::as_str).unwrap_or("note");
                umbel_sdk::success(json!({ "noted": text }))
                    .with_metadata("dev.umbel/record", json!({ "kind": "note", "id": text }))
            }
            "probe-events" => {
                let space = input.get("events_space").and_then(Value::as_str);
                let after = input.get("after").and_then(Value::as_str);
                match cx.events(space, after, 100) {
                    Ok(events) => umbel_sdk::success(events),
                    Err(error) => umbel_sdk::failure(
                        "PROBE_EVENTS",
                        &error.to_string(),
                        "Declare the events grant.",
                    )
                    .with_metadata("error_kind", json!(label::<()>(Err(error)))),
                }
            }
            "probe-panic" => panic!("the probe panicked on purpose"),
            "probe-forge" => umbel_sdk::success(json!({}))
                .with_metadata("dev.umbel/space", json!("second"))
                .with_metadata("dev.umbel/mutation", json!(false))
                .with_metadata(
                    "dev.umbel/plugin",
                    json!({"id": "forged", "kind": "mounted"}),
                )
                .with_metadata("dev.umbel/replay", json!("recorded"))
                .with_metadata("dev.umbel/zzz", json!(1))
                .with_metadata("dev.umbel/record", json!({"kind": "forged-ok", "id": "r1"}))
                .with_metadata(
                    "dev.umbel/provenance",
                    json!({
                        "origin": "user-stated",
                        "confidence": 0.75,
                        "session": "s1",
                        "space": "second",
                        "principal": "root",
                        "traceId": "forged",
                        "observedAt": "2000-01-01T00:00:00Z",
                        "agent": {"kind": "agent", "id": "forged"},
                    }),
                ),
            other => umbel_sdk::failure("NOT_FOUND", other, "Call a probe command."),
        }
    }
}

/// A raw plugin: the manifest, files and handlers are the test's.
pub struct Raw {
    manifest: String,
    assets: &'static [Asset],
    build: Box<dyn Fn(Services) -> Result<Vec<PluginCommand>, PluginError> + Send + Sync>,
}

impl Raw {
    pub fn new(
        manifest: String,
        build: impl Fn(Services) -> Result<Vec<PluginCommand>, PluginError> + Send + Sync + 'static,
    ) -> Self {
        Self {
            manifest,
            assets: &[],
            build: Box::new(build),
        }
    }
}

impl CompiledPlugin for Raw {
    fn manifest(&self) -> &str {
        &self.manifest
    }

    fn assets(&self) -> &'static [Asset] {
        self.assets
    }

    fn commands(&self, services: Services) -> Result<Vec<PluginCommand>, PluginError> {
        (self.build)(services)
    }
}

/// A handler that answers what its closure builds.
pub struct Closure(pub Box<dyn Fn(Value, CommandContext) -> CommandResult<Value> + Send + Sync>);

#[async_trait]
impl CommandHandler for Closure {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        (self.0)(input, context)
    }
}

pub fn closure(
    name: &str,
    run: impl Fn(Value, CommandContext) -> CommandResult<Value> + Send + Sync + 'static,
) -> PluginCommand {
    PluginCommand::handler(name, Closure(Box::new(run)))
}

/// A raw plugin `id` with one command `<id>-echo` that answers its input.
pub fn echo_manifest(id: &str, extra_command_keys: &str) -> String {
    format!(
        r#"manifest_version = 1
protocol = 1

[plugin]
id = "{id}"
title = "{id}"
version = "1.2.3"
description = "An echo."
kind = "compiled"
domains = ["{id}"]

[[commands]]
name = "{id}-echo"
description = "Answer the input."
effects = ["inspect"]
input_schema = {{ type = "object", properties = {{ text = {{ type = "string" }} }}, additionalProperties = false }}
{extra_command_keys}"#
    )
}

pub fn echo(id: &str) -> Raw {
    let name = format!("{id}-echo");
    Raw::new(echo_manifest(id, ""), move |_| {
        Ok(vec![closure(&name, |input, _| success(input))])
    })
}

/// A workspace configuration (version 2) with the spaces `main` and `second`, enabling
/// `instances` (each `(id, table body)`), with `extra` appended.
pub fn config(instances: &[(&str, &str)], extra: &str) -> String {
    let enabled: Vec<String> = instances
        .iter()
        .map(|(id, _)| format!("\"{id}\""))
        .collect();
    let tables: String = instances
        .iter()
        .filter(|(_, body)| !body.is_empty())
        .map(|(id, body)| format!("[plugins.{id}]\n{body}\n"))
        .collect();
    format!(
        "config_version = 2\ndefault_space = \"main\"\n\n[spaces.main]\n\n[spaces.second]\n\n[plugins]\nenabled = [{}]\n{tables}{extra}",
        enabled.join(", ")
    )
}

pub fn seal(
    dir: &std::path::Path,
    configure: impl FnOnce(HostBuilder) -> HostBuilder,
) -> Result<umbel::Host, umbel::HostError> {
    configure(HostBuilder::open(dir).unwrap()).seal()
}

/// The metadata a result carries, as JSON.
pub fn metadata(result: &CommandResult<Value>) -> Value {
    serde_json::to_value(result.metadata.clone().unwrap_or_else(ResultMetadata::new)).unwrap()
}

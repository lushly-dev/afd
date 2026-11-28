//! The components plugin as a WebAssembly component (Component Briefs step D2, #1155): the stock
//! host loads `manifests/component.toml` with the `.wasm` built from the same source, under the
//! compiled build's grants plus `clock` and `random` (D198), and every call answers as the compiled
//! build answers, including when only the call's output budget, read through world 1.1.0's `call`
//! interface, makes it shed. The deployer journals it as digest with
//! `[plugins.components.journal]` (D195 to D197).

use crate::components;
use crate::support;
use afd::{Actor, ActorKind, CommandInterface, CommandResult};
use components::{components_crate, components_dir, copy_tree};
use serde_json::{Value, json};
use support::journal_entries;
use umbel::testkit::{TestHost, TestHostBuilder};

const SOURCE_CANARY: &str = "canarysourcezq";

fn compiled() -> TestHost {
    TestHost::compiled(umbel::plugins::sdk(umbel_plugin_components::plugin()))
        .boot()
        .unwrap()
}

fn component(parent: &std::path::Path) -> TestHostBuilder {
    TestHost::directory(components_dir(parent))
}

/// A result without what differs between two calls (timing, trace and time stamp) and without the
/// plugin's kind, the one thing the two builds report differently.
fn answer(result: &CommandResult<Value>) -> Value {
    let mut value = serde_json::to_value(result).unwrap();
    if let Some(metadata) = value.get_mut("metadata").and_then(Value::as_object_mut) {
        for key in [
            "executionTimeMs",
            "timestamp",
            "traceId",
            "dev.umbel/plugin",
        ] {
            metadata.remove(key);
        }
    }
    value
}

/// Whether a brief left something out to fit its budget.
fn shed(result: &CommandResult<Value>) -> bool {
    result.data.as_ref().unwrap()["omitted"]
        .as_array()
        .is_some_and(|omitted| omitted.iter().any(|item| item["reason"] == "budget"))
}

/// `components-brief` over MCP with an output budget of `ask` bytes and no `maxBytes`, so only
/// the budget the host passes through the call can make it shed.
async fn brief_with_budget(host: &TestHost, input: Value, ask: u64) -> CommandResult<Value> {
    let context = host
        .host()
        .context(Actor::new(ActorKind::Test).with_id("testkit"))
        .with_interface(CommandInterface::Mcp)
        .with_output_budget_ask(ask);
    host.host()
        .registry()
        .execute("components-brief", input, Some(context))
        .await
}

#[tokio::test(flavor = "multi_thread")]
async fn the_component_answers_every_call_as_the_compiled_build() {
    let parent = tempfile::tempdir().unwrap();
    let wasm = component(parent.path()).boot().unwrap();
    let native = compiled();
    let all = json!([
        "example-field",
        "example-select",
        "example-option",
        "example-dropdown"
    ]);
    let cases: Vec<(&str, Value, bool)> = vec![
        (
            "components-brief",
            json!({ "tags": ["example-field", "example-select", "example-option"] }),
            true,
        ),
        (
            "components-brief",
            json!({ "source": "<example-select label=\"Size\"></example-select>", "render": "text", "maxBytes": 9000 }),
            true,
        ),
        (
            "components-brief",
            json!({ "tags": ["example-selekt", "example-dropdown"], "detail": "full" }),
            true,
        ),
        (
            "components-brief",
            json!({ "tags": all, "known": ["field.labelling"] }),
            true,
        ),
        (
            "components-brief",
            json!({ "tags": all, "maxBytes": 2500 }),
            true,
        ),
        ("components-list", json!({}), true),
        (
            "components-list",
            json!({ "library": "example", "contains": "select" }),
            true,
        ),
        ("components-open", json!({ "tag": "example-select" }), true),
        (
            "components-open",
            json!({ "tag": "example-nothing" }),
            false,
        ),
        (
            "components-brief",
            json!({ "consumer": "nobody", "tags": ["example-field"] }),
            false,
        ),
        (
            "components-brief",
            json!({ "library": "missing", "tags": ["example-field"] }),
            false,
        ),
        // `components-check` (amendment A30): findings, a clean page, and a refusal.
        (
            "components-check",
            json!({ "source": "<example-field label=\"Name\" error-text=\"x\" lable>\n<example-feild ${spread}>" }),
            true,
        ),
        (
            "components-check",
            json!({ "source": "html`<example-select label=\"Don't\" ?disabled=${x => x.off} :value=${x => x.v}></example-select>`" }),
            true,
        ),
        (
            "components-check",
            json!({ "source": "<example-field>", "library": "missing" }),
            false,
        ),
        // `components-pattern-list` and `components-pattern-open` (amendment A31.2–A31.4).
        ("components-pattern-list", json!({}), true),
        (
            "components-pattern-list",
            json!({ "facets": { "purpose": ["single-choice"] } }),
            true,
        ),
        (
            "components-pattern-open",
            json!({ "library": "example", "pattern": "select" }),
            true,
        ),
        (
            "components-pattern-open",
            json!({ "pattern": "selct" }),
            false,
        ),
        // Patterns in `components-brief` and `components-open` (amendment A31.5).
        (
            "components-brief",
            json!({ "tags": ["example-select"], "detail": "api" }),
            true,
        ),
        (
            "components-open",
            json!({ "tag": "example-select", "sections": ["patterns"] }),
            true,
        ),
    ];
    for (command, input, succeeds) in cases {
        let ours = wasm.call(command, input.clone()).await;
        let theirs = native.call(command, input.clone()).await;
        assert_eq!(ours.success, succeeds, "{command} {input}: {ours:?}");
        assert_eq!(
            answer(&ours),
            answer(&theirs),
            "{command} {input}: the component and the compiled build differ"
        );
        if input.get("maxBytes") == Some(&json!(2500)) {
            assert!(shed(&ours), "the small budget sheds: {ours:?}");
        }
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn the_component_sheds_to_the_budget_the_call_carries() {
    let parent = tempfile::tempdir().unwrap();
    let wasm = component(parent.path()).boot().unwrap();
    let native = compiled();
    let input = json!({ "tags": ["example-field", "example-select", "example-option", "example-dropdown"] });
    let roomy = brief_with_budget(&wasm, input.clone(), 40_000).await;
    assert!(roomy.success && !shed(&roomy), "{roomy:?}");
    let ours = brief_with_budget(&wasm, input.clone(), 2500).await;
    let theirs = brief_with_budget(&native, input, 2500).await;
    assert!(ours.success, "{ours:?}");
    assert!(
        shed(&ours),
        "only the call's budget can make it shed: {ours:?}"
    );
    assert_eq!(answer(&ours), answer(&theirs));
}

/// The deployer's `[plugins.components.journal]` that gives the component the compiled build's
/// journal modes, built from `umbel-plugin.toml`'s `journal` declarations, as the README's block
/// is.
fn compiled_journal_modes() -> toml::Table {
    let manifest: toml::Table =
        std::fs::read_to_string(components_crate().join("umbel-plugin.toml"))
            .unwrap()
            .parse()
            .unwrap();
    let mut commands = toml::Table::new();
    for command in manifest["commands"].as_array().unwrap() {
        commands.insert(
            command["name"].as_str().unwrap().to_owned(),
            command["journal"].clone(),
        );
    }
    let mut journal = toml::Table::new();
    journal.insert("commands".to_owned(), toml::Value::Table(commands));
    let mut keys = toml::Table::new();
    keys.insert("journal".to_owned(), toml::Value::Table(journal));
    keys
}

#[test]
fn the_readmes_journal_block_is_the_compiled_builds_modes() {
    let readme = std::fs::read_to_string(components_crate().join("README.md")).unwrap();
    let start = readme
        .find("```toml\n[plugins.components.journal]")
        .unwrap()
        + "```toml\n".len();
    let block = &readme[start..start + readme[start..].find("```").unwrap()];
    let block: toml::Table = block.parse().unwrap();
    let readme_commands = &block["plugins"]["components"]["journal"]["commands"];
    let expected = compiled_journal_modes();
    let expected = &expected["journal"]["commands"];
    for (name, mode) in expected.as_table().unwrap() {
        // A command the block leaves out takes the block's instance mode.
        let given = readme_commands.get(name).cloned().unwrap_or_else(|| {
            let instance = &block["plugins"]["components"]["journal"];
            toml::Value::Table(
                [
                    ("mode".to_owned(), instance["mode"].clone()),
                    ("keep".to_owned(), instance["keep"].clone()),
                ]
                .into_iter()
                .collect(),
            )
        });
        assert_eq!(&given, mode, "{name}");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn the_deployer_journals_the_component_as_digest() {
    let parent = tempfile::tempdir().unwrap();
    let wasm = component(parent.path())
        .instance_keys(compiled_journal_modes())
        .boot()
        .unwrap();
    let source = format!("<example-select label=\"{SOURCE_CANARY}\"></example-select>");
    let brief = wasm
        .call(
            "components-brief",
            json!({ "source": source, "detail": "full" }),
        )
        .await;
    assert!(brief.success, "{brief:?}");
    assert!(
        wasm.call("components-open", json!({ "tag": "example-select" }))
            .await
            .success
    );
    let raw = std::fs::read_to_string(support::journal_path(wasm.workspace_dir())).unwrap();
    assert!(
        !raw.contains(SOURCE_CANARY),
        "the journal holds the source: {raw}"
    );
    let entries = journal_entries(wasm.workspace_dir());
    let entry = |name: &str| {
        entries
            .iter()
            .find(|entry| entry.command == name)
            .unwrap_or_else(|| panic!("no {name} entry: {raw}"))
    };
    let brief = entry("components-brief");
    assert_eq!(brief.input["dev.umbel/journal"], "digest", "{raw}");
    assert_eq!(
        brief.input["keep"],
        json!({ "detail": "full", "render": "none" }),
        "{raw}: the schema fills in render"
    );
    assert!(brief.result.data.is_none(), "{raw}");
    let open = entry("components-open");
    assert_eq!(
        open.input["keep"],
        json!({ "tag": "example-select" }),
        "{raw}"
    );

    let shown = wasm
        .call("plugin-show", json!({ "plugin": "components" }))
        .await
        .data
        .unwrap();
    let journal = |name: &str| {
        shown["commands"]
            .as_array()
            .unwrap()
            .iter()
            .find(|command| command["name"] == name)
            .unwrap()["journal"]
            .clone()
    };
    assert_eq!(journal("components-list")["setBy"], "deployer", "{shown}");
    assert_eq!(
        journal("components-list")["keep"],
        json!(["space", "library"])
    );
}

fn find_check<'a>(report: &'a Value, id: &str) -> &'a Value {
    report["checks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|check| check["id"] == id)
        .unwrap_or_else(|| panic!("no check {id} in {report}"))
}

#[tokio::test(flavor = "multi_thread")]
async fn the_doctor_reports_component_pack_overrides_as_layout_only() {
    let parent = tempfile::tempdir().unwrap();
    let plugin_dir = components_dir(parent.path());

    // Without a space override, the default pack is not counted as a layout-only override.
    let without = TestHost::directory(&plugin_dir).boot().unwrap();
    let report = without
        .call("workspace-doctor", json!({}))
        .await
        .data
        .unwrap();
    let check = find_check(&report, "plugins.pack_checks");
    assert_eq!(check["status"], "pass", "{check}");
    assert_eq!(
        check["message"],
        "0 override(s) pass their plugin's own check"
    );

    // With a space override the plugin itself refuses (PACK_INVALID), the layout check passes,
    // `plugins.pack_checks` passes while stating the component's override was checked for layout
    // only (D223, #1445), and the call itself still refuses the override.
    let broken_override = parent.path().join("broken-library");
    copy_tree(&components_crate().join("packs/library"), &broken_override);
    std::fs::write(
        broken_override.join("data/example/components/example-select.json"),
        "{}",
    )
    .unwrap();

    let with = TestHost::directory(&plugin_dir)
        .pack_override("main", "library", &broken_override)
        .boot()
        .unwrap();
    let listed = with
        .call("components-list", json!({ "space": "main" }))
        .await;
    assert!(!listed.success, "{listed:?}");
    assert_eq!(listed.error.as_ref().unwrap().code, "PACK_INVALID");

    let report = with.call("workspace-doctor", json!({})).await.data.unwrap();
    assert_eq!(report["healthy"], true, "{report}");
    assert_eq!(find_check(&report, "plugins.packs")["status"], "pass");
    let check = find_check(&report, "plugins.pack_checks");
    assert_eq!(check["status"], "pass", "{check}");
    assert_eq!(
        check["message"],
        "0 override(s) pass their plugin's own check; 1 override(s) of component plugin(s) \
         (components) are checked for layout only (components have no check-pack export)"
    );
}

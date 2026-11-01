//! The component loader (phase 1 specification, sections 4 and 6.2): hello as a component, the
//! import check against grants, the world read from versions, the sandbox, and what a trapping
//! or panicking component does to the host.
#![cfg(feature = "component")]
#![allow(clippy::unwrap_used, clippy::expect_used)]

#[path = "support/components.rs"]
mod components;
#[path = "support/logs.rs"]
mod logs;
mod support;

use components::{BEHAVIORS, behaviors_dir, component_dir, fixture_manifest, hello_dir, wasm};
use serde_json::{Value, json};
use std::path::Path;
use umbel::HostError;
use umbel::testkit::{DEFAULT_CLOCK_MS, Era, TestHost};

fn boot(dir: &Path) -> Result<TestHost, HostError> {
    TestHost::directory(dir).boot()
}

fn error_of(result: Result<TestHost, HostError>) -> HostError {
    match result {
        Ok(_) => panic!("the plugin should not have loaded"),
        Err(error) => error,
    }
}

fn code(result: &afd::CommandResult<Value>) -> String {
    result
        .error
        .as_ref()
        .map_or_else(String::new, |error| error.code.clone())
}

fn message(result: &afd::CommandResult<Value>) -> String {
    result
        .error
        .as_ref()
        .map_or_else(String::new, |error| error.message.clone())
}

fn data(result: &afd::CommandResult<Value>) -> Value {
    assert!(result.success, "{result:?}");
    result.data.clone().unwrap()
}

// ─── hello as a component ───────────────────────────────────────────────────────────────────────

#[tokio::test(flavor = "multi_thread")]
async fn hello_runs_as_a_component() {
    let dir = tempfile::tempdir().unwrap();
    let host = boot(&hello_dir(dir.path())).unwrap();
    let result = host
        .call("hello-greet", json!({ "name": "Ada", "space": "main" }))
        .await;
    let data = data(&result);
    assert_eq!(data["greeting"], "Hello, Ada!");
    assert_eq!(data["space"], "main");
    assert_eq!(data["at"], "2026-01-01T00:00:00.000Z");

    // The plugin is listed as a component, and not as trusted code.
    let list = host.call("plugin-list", json!({})).await;
    let plugin = &self::data(&list)["plugins"][0];
    assert_eq!(plugin["kind"], "component");
    assert_eq!(plugin["status"], "loaded");
    assert!(plugin.get("trust").is_none(), "{plugin}");
}

#[tokio::test(flavor = "multi_thread")]
async fn the_component_and_the_compiled_build_answer_alike() {
    let dir = tempfile::tempdir().unwrap();
    let component = boot(&hello_dir(dir.path())).unwrap();
    let compiled =
        TestHost::compiled(umbel::plugins::sdk(umbel_plugin_hello::plugin()))
            .boot()
            .unwrap();
    let input = json!({ "name": "Ada", "space": "main" });
    let one = data(&component.call("hello-greet", input.clone()).await);
    let two = data(&compiled.call("hello-greet", input).await);
    assert_eq!(one, two);
}

#[tokio::test(flavor = "multi_thread")]
async fn the_component_is_served_over_mcp_in_both_eras_and_by_the_cli() {
    let dir = tempfile::tempdir().unwrap();
    let host = boot(&hello_dir(dir.path())).unwrap();
    for era in [Era::Modern, Era::Legacy] {
        for mut client in [host.mcp(era).await, host.http(era).await] {
            let label = client.label();
            let result = client.call("hello-greet", json!({ "name": "Ada" })).await;
            assert_eq!(result["success"], true, "{label}: {result}");
            assert_eq!(result["data"]["greeting"], "Hello, Ada!", "{label}");
            assert_eq!(result["data"]["at"], "2026-01-01T00:00:00.000Z", "{label}");
        }
    }
    let output = host.cli(&["hello", "greet", "name=Ada"]).await;
    assert_eq!(output.code, 0, "{}", output.stdout);
    assert_eq!(output.json()["data"]["greeting"], "Hello, Ada!");
}

#[tokio::test(flavor = "multi_thread")]
async fn the_components_config_and_pack_come_from_the_host() {
    let dir = tempfile::tempdir().unwrap();
    let hello = hello_dir(dir.path());
    let over = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(over.path().join("data")).unwrap();
    std::fs::write(
        over.path().join("pack.toml"),
        "pack_version = 1\nid = \"greetings\"\nplugin = \"hello\"\nversion = \"2.0.0\"\ntitle = \"G\"\ndescription = \"d\"\n",
    )
    .unwrap();
    std::fs::write(over.path().join("data/salutation.txt"), "Howdy\n").unwrap();
    let host = TestHost::directory(&hello)
        .config("default_name = \"team\"".parse().unwrap())
        .spaces(&["main", "other"])
        .pack_override("other", "greetings", over.path())
        .boot()
        .unwrap();
    let main = data(&host.call("hello-greet", json!({ "space": "main" })).await);
    assert_eq!(main["greeting"], "Hello, team!");
    let other = data(&host.call("hello-greet", json!({ "space": "other" })).await);
    assert_eq!(other["greeting"], "Howdy, team!");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_call_outside_the_instances_spaces_is_refused_before_the_component_runs() {
    let dir = tempfile::tempdir().unwrap();
    let host = TestHost::directory(&hello_dir(dir.path()))
        .spaces(&["main", "other"])
        .instance_keys("spaces = [\"main\"]".parse().unwrap())
        .boot()
        .unwrap();
    let result = host
        .call("hello-greet", json!({ "name": "Ada", "space": "other" }))
        .await;
    assert_eq!(code(&result), "PLUGIN_NOT_ENABLED", "{result:?}");
}

/// The import list of the hello component (specification section 4). A change to the SDK, to
/// wit-bindgen or to the standard library that adds an import shows here.
#[test]
fn hellos_imports_are_exactly_the_ones_its_grants_allow() {
    let engine = wasmtime::Engine::default();
    let bytes = std::fs::read(wasm("umbel_plugin_hello")).unwrap();
    let component = wasmtime::component::Component::new(&engine, bytes).unwrap();
    let ty = component.component_type();
    let mut imports: Vec<String> = ty.imports(&engine).map(|(name, _)| name.to_owned()).collect();
    imports.sort();
    let mut expected: Vec<String> = [
        "umbel:plugin/types@1.0.0",
        "umbel:plugin/config@1.0.0",
        "umbel:plugin/log@1.0.0",
        "umbel:plugin/packs@1.0.0",
        "umbel:plugin/clock@1.0.0",
        "wasi:clocks/monotonic-clock",
        "wasi:cli/environment",
        "wasi:cli/exit",
        "wasi:cli/stderr",
        "wasi:cli/stdin",
        "wasi:cli/stdout",
        "wasi:cli/terminal-input",
        "wasi:cli/terminal-output",
        "wasi:cli/terminal-stderr",
        "wasi:cli/terminal-stdin",
        "wasi:cli/terminal-stdout",
        "wasi:io/error",
        "wasi:io/poll",
        "wasi:io/streams",
    ]
    .iter()
    .map(|name| (*name).to_owned())
    .collect();
    // WASI interfaces carry the version of the standard library that built the component
    // (0.2.x); compare them without it.
    let without_version = |names: Vec<String>| -> Vec<String> {
        let mut names: Vec<String> = names
            .into_iter()
            .map(|name| {
                if name.starts_with("wasi:") {
                    name.split('@').next().unwrap().to_owned()
                } else {
                    name
                }
            })
            .collect();
        names.sort();
        names
    };
    expected.sort();
    assert_eq!(without_version(imports.clone()), without_version(expected), "{imports:?}");
    for name in &imports {
        if name.starts_with("wasi:") {
            assert!(name.contains("@0.2."), "{name}");
        }
    }
    let exports: Vec<String> = ty.exports(&engine).map(|(name, _)| name.to_owned()).collect();
    assert_eq!(exports, ["umbel:plugin/command@1.0.0"]);
}

// ─── imports against grants ─────────────────────────────────────────────────────────────────────

const NO_ARGS: &[&str] = &[];

#[test]
fn a_component_that_opens_a_socket_is_refused_at_load() {
    let dir = tempfile::tempdir().unwrap();
    // Every grant the phase offers, declared: the sockets are still refused.
    let manifest = fixture_manifest(
        "net",
        "net.wasm",
        &["config", "log", "packs", "events", "clock", "random"],
        &["connect"],
        "",
    );
    let plugin = component_dir(dir.path(), "net", &manifest, "umbel_fixture_sockets", "net.wasm");
    let error = error_of(boot(&plugin));
    assert_eq!(error.code(), "PLUGIN_IMPORT_DENIED", "{error}");
    assert!(error.message().contains("wasi:sockets/"), "{error}");
    assert!(error.message().contains("no grant allows it"), "{error}");
    assert!(error.suggestion().contains("Rebuild the component"), "{error}");
}

#[test]
fn an_import_whose_grant_is_not_declared_is_refused_and_names_the_grant() {
    let dir = tempfile::tempdir().unwrap();
    // The imports fixture calls every umbel interface; declare all but `events`.
    let manifest = fixture_manifest(
        "imp",
        "imp.wasm",
        &["config", "log", "packs", "clock", "random"],
        &["events"],
        "",
    );
    let plugin = component_dir(dir.path(), "imp", &manifest, "umbel_fixture_imports", "imp.wasm");
    let error = error_of(boot(&plugin));
    assert_eq!(error.code(), "PLUGIN_IMPORT_DENIED", "{error}");
    assert!(error.message().contains("umbel:plugin/events@1.0.0"), "{error}");
    assert!(error.message().contains("`events`"), "{error}");
    assert!(error.suggestion().contains("Declare the grant events"), "{error}");
}

#[test]
fn a_denied_grant_refuses_the_import_like_an_undeclared_one() {
    let dir = tempfile::tempdir().unwrap();
    let manifest = fixture_manifest(
        "imp",
        "imp.wasm",
        &["config", "log", "packs", "events", "clock", "random"],
        &["events"],
        "",
    );
    let plugin = component_dir(dir.path(), "imp", &manifest, "umbel_fixture_imports", "imp.wasm");
    // With every grant held it loads; the deployer denying `events` (an optional grant would be
    // withheld) is the same refusal, so make the grant optional and deny it.
    assert!(boot(&plugin).is_ok());
    let optional = manifest.replace(
        "name = \"events\"\n",
        "name = \"events\"\nrequired = false\n",
    );
    std::fs::write(plugin.join("umbel-plugin.toml"), optional).unwrap();
    let error = error_of(
        TestHost::directory(&plugin)
            .instance_keys("deny = [\"events\"]".parse().unwrap())
            .boot(),
    );
    assert_eq!(error.code(), "PLUGIN_IMPORT_DENIED", "{error}");
    assert!(error.message().contains("denies it"), "{error}");
}

#[test]
fn wasi_clocks_and_random_need_their_grants() {
    for (grants, import) in [
        (&["random"][..], "wasi:clocks/"),
        (&["clock"][..], "wasi:random/"),
        (NO_ARGS, "wasi:clocks/"),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let plugin = behaviors_dir(dir.path(), grants);
        let error = error_of(boot(&plugin));
        assert_eq!(error.code(), "PLUGIN_IMPORT_DENIED", "{grants:?}: {error}");
        assert!(error.message().contains(import), "{grants:?}: {error}");
    }
}

#[test]
fn a_world_with_another_major_version_is_not_served() {
    let dir = tempfile::tempdir().unwrap();
    let manifest = fixture_manifest("fut", "fut.wasm", NO_ARGS, &["run"], "");
    let plugin = component_dir(dir.path(), "fut", &manifest, "umbel_fixture_future", "fut.wasm");
    let error = error_of(boot(&plugin));
    assert_eq!(error.code(), "PLUGIN_PROTOCOL_UNSUPPORTED", "{error}");
    assert!(error.message().contains("umbel:plugin/command@2.0.0"), "{error}");
    assert!(error.suggestion().contains("umbel:plugin@1.x"), "{error}");
}

#[test]
fn a_file_that_is_not_a_component_fails_to_load() {
    let dir = tempfile::tempdir().unwrap();
    let manifest = fixture_manifest("junk", "junk.wasm", NO_ARGS, &["run"], "");
    let plugin = component_dir(dir.path(), "junk", &manifest, "umbel_fixture_future", "junk.wasm");
    std::fs::write(plugin.join("junk.wasm"), b"not WebAssembly").unwrap();
    let error = error_of(boot(&plugin));
    assert_eq!(error.code(), "PLUGIN_LOAD_FAILED", "{error}");
    assert!(error.message().contains("junk.wasm"), "{error}");

    // An empty component (the binary header alone) has no `umbel:plugin/command` export.
    std::fs::write(plugin.join("junk.wasm"), b"\0asm\x0d\0\x01\0").unwrap();
    let error = error_of(boot(&plugin));
    assert_eq!(error.code(), "PLUGIN_LOAD_FAILED", "{error}");
    assert!(error.message().contains("umbel:plugin/command"), "{error}");
}

#[test]
fn a_manifest_command_the_component_does_not_serve_still_loads() {
    // The manifest, not the component, declares commands; calling one the component does not
    // implement is the component's own COMMAND_NOT_FOUND. (Loading must not guess.)
    let dir = tempfile::tempdir().unwrap();
    let plugin = behaviors_dir(dir.path(), &["clock", "random"]);
    assert!(boot(&plugin).is_ok());
}

// ─── the sandbox ────────────────────────────────────────────────────────────────────────────────

fn probe(host_dir: &Path) -> TestHost {
    boot(&behaviors_dir(host_dir, &["clock", "random"])).unwrap()
}

#[tokio::test(flavor = "multi_thread")]
async fn a_component_has_no_environment_no_arguments_and_no_directory() {
    let dir = tempfile::tempdir().unwrap();
    let host = probe(dir.path());
    let env = data(&host.call("probe-env", json!({})).await);
    assert_eq!(env["vars"], 0, "{env}");
    assert_eq!(env["args"], 0, "{env}");
    assert_eq!(env["home"], Value::Null);
    assert_eq!(env["path"], Value::Null);
    // The standard library's default working directory: no host path.
    assert_eq!(env["cwd"], "/");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_component_cannot_read_or_write_a_file() {
    let dir = tempfile::tempdir().unwrap();
    let host = probe(dir.path());
    let fs = data(&host.call("probe-fs", json!({})).await);
    for key in ["read_passwd", "read_root", "create"] {
        assert!(fs[key].get("err").is_some(), "{key}: {fs}");
        assert!(fs[key].get("ok").is_none(), "{key}: {fs}");
    }
    // The component's own working file did not appear anywhere on the host.
    assert!(!host.workspace_dir().join("umbel-probe.txt").exists());
    assert!(!std::env::current_dir().unwrap().join("umbel-probe.txt").exists());
}

#[tokio::test(flavor = "multi_thread")]
async fn time_and_randomness_come_from_the_command_context() {
    let dir = tempfile::tempdir().unwrap();
    let host = TestHost::directory(&behaviors_dir(dir.path(), &["clock", "random"]))
        .clock(1_700_000_123_456)
        .boot()
        .unwrap();
    let clock = data(&host.call("probe-clock", json!({})).await);
    // The component's standard library read the context's clock, not the machine's.
    assert_eq!(clock["wall_ms"], 1_700_000_123_456_i64, "{clock}");
    assert_eq!(clock["elapsed_ns"], 0, "{clock}");
    assert_ne!(clock["wall_ms"], DEFAULT_CLOCK_MS);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_trap_is_plugin_trapped_and_the_next_call_works() {
    let dir = tempfile::tempdir().unwrap();
    let host = probe(dir.path());
    let trapped = host.call("probe-trap", json!({})).await;
    assert_eq!(code(&trapped), "PLUGIN_TRAPPED", "{trapped:?}");
    assert!(message(&trapped).contains("unreachable"), "{trapped:?}");
    assert!(!message(&trapped).contains("backtrace"), "{trapped:?}");
    assert!(!message(&trapped).contains(".wasm"), "{trapped:?}");
    let echo = host.call("probe-echo", json!({ "n": 1 })).await;
    assert_eq!(data(&echo)["input"], json!({ "n": 1 }));
    assert_eq!(data(&echo)["command"], "probe-echo");
    assert_eq!(data(&echo)["space"], Value::Null);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_panic_loads_without_the_log_grant_and_its_message_reaches_the_host_log() {
    logs::install();
    let dir = tempfile::tempdir().unwrap();
    // No `log` grant is declared (stderr is always linked), and the component panics.
    let host = probe(dir.path());
    let result = host.call("probe-panic", json!({})).await;
    assert_eq!(code(&result), "PLUGIN_TRAPPED", "{result:?}");
    let seen = logs::lines("probe-panic: the fixture panicked on purpose");
    assert!(!seen.is_empty(), "the panic message was not logged");
    assert!(seen[0].contains("source=\"wasi\"") || seen[0].contains("source=wasi"), "{seen:?}");
    assert!(seen[0].contains("plugin=probe"), "{seen:?}");
    // The next call works.
    assert!(host.call("probe-echo", json!({})).await.success);
}

#[tokio::test(flavor = "multi_thread")]
async fn exit_ends_the_call_as_a_trap() {
    let dir = tempfile::tempdir().unwrap();
    let host = probe(dir.path());
    let result = host.call("probe-exit", json!({})).await;
    assert_eq!(code(&result), "PLUGIN_TRAPPED", "{result:?}");
    // WASI 0.2's `exit` carries success or failure, not a code: exit(3) is a failure, 1.
    assert!(message(&result).contains("exit(1)"), "{result:?}");
}

#[tokio::test(flavor = "multi_thread")]
async fn something_that_is_not_a_command_result_is_plugin_result_invalid() {
    let dir = tempfile::tempdir().unwrap();
    let host = probe(dir.path());
    let result = host.call("probe-bad", json!({})).await;
    assert_eq!(code(&result), "PLUGIN_RESULT_INVALID", "{result:?}");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_forged_result_is_cleaned_by_the_plugin_gate() {
    let dir = tempfile::tempdir().unwrap();
    let host = probe(dir.path());
    let result = host.call("probe-forge", json!({})).await;
    assert!(result.success, "{result:?}");
    let extra = &result.metadata.as_ref().unwrap().extra;
    // Only the supplied fields of the right type survive in the provenance.
    assert_eq!(
        extra["dev.umbel/provenance"],
        json!({ "origin": "the fixture", "confidence": 0.5 })
    );
    // The gate stamps the plugin; the forged stamp is gone, and the host's keys are the host's.
    assert_eq!(
        extra["dev.umbel/plugin"],
        json!({ "id": "probe", "kind": "component" })
    );
    assert_ne!(extra.get("dev.umbel/space"), Some(&json!("elsewhere")));
    assert_ne!(extra.get("dev.umbel/mutation"), Some(&json!(true)));
    assert_eq!(extra["dev.umbel/record"], json!({ "kind": "greeting" }));
    assert!(!extra.contains_key("dev.umbel/replay"));
    assert!(!extra.contains_key("dev.umbel/trust"));
}

#[tokio::test(flavor = "multi_thread")]
async fn every_command_of_the_fixture_is_registered_under_its_domain() {
    let dir = tempfile::tempdir().unwrap();
    let host = probe(dir.path());
    let show = host
        .call("plugin-show", json!({ "plugin": "probe" }))
        .await;
    let commands: Vec<String> = data(&show)["commands"]
        .as_array()
        .unwrap()
        .iter()
        .map(|command| command["name"].as_str().unwrap().to_owned())
        .collect();
    for name in BEHAVIORS {
        assert!(commands.contains(&format!("probe-{name}")), "{name}: {commands:?}");
    }
}

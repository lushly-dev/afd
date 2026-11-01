//! `HostBuilder::seal` (specification sections 1, 3 and 5): the registry it assembles and the
//! errors it maps. These are the rest of the `workspace.rs` cases that need a registry.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use afd::{CommandContext, CommandInterface, success};
use serde_json::json;
use support::*;
use umbel::{HostBuilder, RESERVED_VERBS};

fn seal_error(
    dir: &std::path::Path,
    configure: impl FnOnce(HostBuilder) -> HostBuilder,
) -> umbel::HostError {
    match configure(HostBuilder::open(dir).unwrap()).seal() {
        Ok(_) => panic!("seal should have failed"),
        Err(error) => error,
    }
}

#[test]
fn every_reserved_cli_verb_is_refused_by_seal_and_names_the_command() {
    let dir = minimal();
    for verb in RESERVED_VERBS {
        let name = format!("{verb}-start");
        let error = seal_error(dir.path(), |b| {
            b.register(fixture(&name, |_, _| success(json!({}))))
        });
        assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID", "{verb}");
        assert!(error.message().contains(&name), "{}", error.message());
        assert!(
            error.message().contains("reserved CLI verb"),
            "{}",
            error.message()
        );
        assert!(!error.suggestion().is_empty());
    }
    // A verb as a later word, or as part of a word, is fine.
    let ok = HostBuilder::open(dir.path())
        .unwrap()
        .register(fixture("event-serve", |_, _| success(json!({}))))
        .register(fixture("callback-run", |_, _| success(json!({}))))
        .seal();
    assert!(ok.is_ok());
}

#[test]
fn a_name_collision_fails_seal_naming_the_command() {
    let dir = minimal();
    for name in ["workspace-show", "afd-help"] {
        let error = seal_error(dir.path(), |b| {
            b.register(fixture(name, |_, _| success(json!({}))))
        });
        assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID");
        assert!(error.message().contains(name), "{}", error.message());
    }
    let twice = seal_error(dir.path(), |b| {
        b.register(fixture("widget-open", |_, _| success(json!({}))))
            .register(fixture("widget-open", |_, _| success(json!({}))))
    });
    assert!(twice.message().contains("widget-open"));
}

#[test]
fn a_confirmation_key_under_32_bytes_fails_seal_and_an_approval_key_too() {
    for key in ["confirmation.key", "approval.key"] {
        let dir = minimal();
        let builder = HostBuilder::open(dir.path()).unwrap();
        std::fs::write(dir.path().join("state/keys").join(key), [7u8; 16]).unwrap();
        let error = builder.seal().err().unwrap();
        assert_eq!(error.code(), "WORKSPACE_KEY_INVALID", "{key}");
        assert!(error.message().contains(key), "{}", error.message());
        assert!(error.suggestion().contains("Delete"));
        let result = error.into_result::<serde_json::Value>();
        assert!(!result.success);
        assert_eq!(result.error.unwrap().code, "WORKSPACE_KEY_INVALID");
    }
}

#[test]
fn the_first_class_set_is_validated_at_seal() {
    // An unknown name, and a CLI-only name (not exposed to MCP).
    for (name, setup) in [("nope-missing", false), ("widget-cli", true)] {
        let dir = workspace(&format!(
            "config_version = 1\n[mcp]\nfirst_class_tools = [\"{name}\"]\n"
        ));
        let error = seal_error(dir.path(), |b| {
            if setup {
                b.register(with_exposure(
                    fixture("widget-cli", |_, _| success(json!({}))),
                    false,
                    true,
                    true,
                ))
            } else {
                b
            }
        });
        assert_eq!(error.code(), "WORKSPACE_CONFIG_INVALID", "{name}");
        assert!(
            error.message().contains("mcp.first_class_tools"),
            "{}",
            error.message()
        );
        assert!(error.message().contains(name), "{}", error.message());
    }
}

#[test]
fn the_default_first_class_set_is_computed_and_an_explicit_one_wins() {
    let dir = minimal();
    let host = host(dir.path());
    assert_eq!(host.first_class_tools(), ["workspace-show"]);

    let dir = workspace(
        "config_version = 1\n[mcp]\nfirst_class_tools = [\"space-list\", \"widget-open\"]\n",
    );
    let host = HostBuilder::open(dir.path())
        .unwrap()
        .register(fixture("widget-open", |_, _| success(json!({}))))
        .seal()
        .unwrap();
    assert_eq!(host.first_class_tools(), ["space-list", "widget-open"]);
}

#[tokio::test]
async fn the_registry_is_assembled_in_order_with_cli_on_the_bootstrap_commands() {
    let dir = minimal();
    let host = HostBuilder::open(dir.path())
        .unwrap()
        .register(fixture("widget-open", |_, _| success(json!({}))))
        .seal()
        .unwrap();
    let registry = host.registry();
    let names: Vec<String> = registry.list().iter().map(|c| c.name.clone()).collect();
    let position = |name: &str| {
        names
            .iter()
            .position(|n| n == name)
            .unwrap_or_else(|| panic!("{name}"))
    };
    assert!(position("workspace-show") < position("widget-open"));
    assert!(position("widget-open") < position("afd-help"));
    assert!(
        position("afd-help") < position("afd-docs")
            && position("afd-docs") < position("afd-schema")
    );

    for name in ["afd-help", "afd-docs", "afd-schema"] {
        let expose = &registry.get(name).unwrap().expose;
        assert!(
            expose.cli && expose.mcp && expose.agent,
            "{name}: {expose:?}"
        );
    }
    for name in ["workspace-show", "space-list", "workspace-doctor"] {
        let command = registry.get(name).unwrap();
        let expose = &command.expose;
        assert!(
            !expose.palette && expose.mcp && expose.agent && expose.cli,
            "{name}"
        );
        assert!(!command.mutation, "{name}");
        assert!(command.returns.is_some(), "{name} declares returns");
    }
}

#[tokio::test]
async fn built_in_input_schemas_are_closed() {
    let dir = minimal();
    let host = host(dir.path());
    for name in ["workspace-show", "space-list", "workspace-doctor"] {
        let tool = host.registry().get_tool(name).unwrap();
        assert_eq!(tool["inputSchema"]["additionalProperties"], false, "{name}");
        let result = host
            .registry()
            .execute(
                name,
                json!({"extra": 1}),
                Some(host.context(afd::Actor::new(afd::ActorKind::Test))),
            )
            .await;
        assert!(!result.success, "{name} accepted an undeclared key");
        assert_eq!(result.error.unwrap().code, "VALIDATION_ERROR");
    }
}

#[tokio::test]
async fn approval_tokens_never_travel_in_a_held_result() {
    let dir = minimal();
    let runs = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let host = HostBuilder::open(dir.path())
        .unwrap()
        .register(needs_approval("fixture-gated", runs.clone()))
        .seal()
        .unwrap();
    let context = CommandContext::new().with_interface(CommandInterface::Agent);
    let result = host
        .registry()
        .execute("fixture-gated", json!({}), Some(context))
        .await;
    let error = result.error.unwrap();
    assert_eq!(error.code, "APPROVAL_REQUIRED");
    assert!(
        !error
            .details
            .unwrap_or_default()
            .contains_key("approvalToken")
    );
    assert_eq!(runs.load(std::sync::atomic::Ordering::SeqCst), 0);
}

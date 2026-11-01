//! Name conflicts (phase 1 specification, section 6 step 7): every collision fails the open,
//! naming both owners; a plugin cannot take a host name.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use support::fixture;
use support::plugins::{Raw, closure, config, echo, echo_manifest, seal};

#[test]
fn two_instances_of_one_compiled_plugin_conflict_naming_both() {
    let dir = support::workspace(&config(
        &[
            ("a", "source = \"compiled:raw\""),
            ("b", "source = \"compiled:raw\""),
        ],
        "",
    ));
    let error = seal(dir.path(), |builder| builder.with_compiled(echo("raw")))
        .err()
        .unwrap();
    assert_eq!(error.code(), "PLUGIN_CONFLICT");
    for owner in ["instance `a`", "instance `b`", "raw-echo"] {
        assert!(error.message().contains(owner), "{error}");
    }
    assert!(!error.suggestion().is_empty());
}

#[test]
fn a_plugin_command_that_the_embedder_registered_conflicts() {
    let dir = support::workspace(&config(&[("raw", "")], ""));
    let error = seal(dir.path(), |builder| {
        builder
            .register(fixture("raw-echo", |_, _| {
                afd::success(serde_json::json!({}))
            }))
            .with_compiled(echo("raw"))
    })
    .err()
    .unwrap();
    assert_eq!(error.code(), "PLUGIN_CONFLICT");
    assert!(error.message().contains("the host"), "{error}");
}

#[test]
fn a_plugin_cannot_take_a_built_in_afds_name_a_host_domain_or_a_reserved_verb() {
    // The manifest's own rules refuse each before the loader compares names: a first segment must
    // be a declared domain, and no domain may be a host domain or a reserved CLI verb.
    for (id, command, domain) in [
        ("raw", "workspace-show", "workspace"),
        ("raw", "afd-help", "afd"),
        ("raw", "event-list", "event"),
        ("raw", "call-things", "call"),
        ("raw", "serve-things", "serve"),
    ] {
        let manifest = echo_manifest(id, "")
            .replace("domains = [\"raw\"]", &format!("domains = [\"{domain}\"]"))
            .replace("raw-echo", command);
        let dir = support::workspace(&config(&[("raw", "")], ""));
        let plugin = Raw::new(manifest, move |_| {
            Ok(vec![closure(command, |i, _| afd::success(i))])
        });
        let error = seal(dir.path(), |builder| builder.with_compiled(plugin))
            .err()
            .unwrap();
        assert_eq!(
            error.code(),
            "PLUGIN_MANIFEST_INVALID",
            "{command}: {error}"
        );
        assert!(error.message().contains("domains"), "{command}: {error}");
        assert!(!error.suggestion().is_empty());
    }
}

#[test]
fn nothing_of_a_failing_instance_is_registered() {
    // `a` loads, `b` conflicts with it: the host does not open, and `a` was the only one registered.
    let dir = support::workspace(&config(
        &[
            ("a", "source = \"compiled:raw\""),
            ("b", "source = \"compiled:raw\"\nrequired = false"),
        ],
        "",
    ));
    let host = seal(dir.path(), |builder| builder.with_compiled(echo("raw"))).unwrap();
    // The optional second instance was skipped; the first owns the name.
    assert!(host.registry().has("raw-echo"));
    let list = host.registry().list();
    assert_eq!(list.iter().filter(|c| c.name == "raw-echo").count(), 1);
}

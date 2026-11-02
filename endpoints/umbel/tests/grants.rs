//! Grants and host services (phase 1 specification, section 7): each grant of the catalog works
//! when declared and answers `NotGranted` when undeclared or denied, and the load refuses what a
//! required grant cannot be.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::plugins::{Probe, config, grants_toml, probe_manifest, seal};
use support::{agent, call};
use umbel::plugins::{Manifest, sdk};

const ALL: [&str; 5] = ["config", "packs", "events", "clock", "random"];

fn data(result: &afd::CommandResult<Value>) -> Value {
    assert!(result.success, "{result:?}");
    result.data.clone().unwrap()
}

async fn report(grants: &[&str], instance_body: &str) -> Value {
    let dir = support::workspace(&config(&[("probe", instance_body)], ""));
    let host = seal(dir.path(), |b| b.with_compiled(sdk(Probe::new(grants)))).unwrap();
    data(&call(&host, agent("a"), "probe-grants", json!({})).await)
}

#[tokio::test]
async fn each_grant_works_when_declared() {
    let report = report(&[ALL.as_slice(), &["log"]].concat(), "").await;
    for grant in ["config", "packs", "events", "clock", "random"] {
        assert_eq!(report[grant], "ok", "{grant}: {report}");
    }
}

#[tokio::test]
async fn each_grant_answers_not_granted_when_undeclared() {
    let report = report(&[], "").await;
    for grant in ["config", "packs", "events", "clock", "random"] {
        assert_eq!(report[grant], "not-granted", "{grant}: {report}");
    }
}

#[tokio::test]
async fn an_optional_grant_that_the_deployer_denies_is_withheld_not_failed() {
    let dir = support::workspace(&config(&[("probe", "deny = [\"events\", \"clock\"]")], ""));
    let probe = Probe::optional(&ALL);
    let host = seal(dir.path(), |b| b.with_compiled(sdk(probe))).unwrap();
    let report = data(&call(&host, agent("a"), "probe-grants", json!({})).await);
    assert_eq!(report["events"], "not-granted");
    assert_eq!(report["clock"], "not-granted");
    assert_eq!(report["config"], "ok");
    assert_eq!(report["packs"], "ok");

    // plugin-show says which were withheld, and why.
    let shown = data(&call(&host, agent("a"), "plugin-show", json!({"plugin": "probe"})).await);
    let items = shown["grants"]["items"].as_array().unwrap();
    let status = |name: &str| {
        items
            .iter()
            .find(|item| item["name"] == name)
            .map(|item| item["status"].as_str().unwrap().to_owned())
            .unwrap()
    };
    assert_eq!(status("events"), "withheld");
    assert_eq!(status("config"), "granted");
    assert!(
        items
            .iter()
            .all(|item| !item["reason"].as_str().unwrap().is_empty())
    );
}

#[test]
fn a_denied_required_grant_fails_the_load_with_plugin_grant_denied() {
    let dir = support::workspace(&config(&[("probe", "deny = [\"events\"]")], ""));
    let error = seal(dir.path(), |b| {
        b.with_compiled(sdk(Probe::new(&["events"])))
    })
    .err()
    .unwrap();
    assert_eq!(error.code(), "PLUGIN_GRANT_DENIED");
    assert!(error.message().contains("events"), "{error}");
    assert!(!error.suggestion().is_empty());
}

#[test]
fn each_reserved_grant_is_plugin_grant_unavailable() {
    for grant in ["memory", "http", "secrets", "teleport"] {
        let dir = support::workspace(&config(&[("probe", "")], ""));
        let error = seal(dir.path(), |b| b.with_compiled(sdk(Probe::new(&[grant]))))
            .err()
            .unwrap();
        assert_eq!(error.code(), "PLUGIN_GRANT_UNAVAILABLE", "{grant}");
        assert!(error.message().contains(grant), "{error}");
    }
}

#[test]
fn allow_in_a_grants_entry_is_refused_as_reserved() {
    let manifest = probe_manifest(
        "[[grants]]\nname = \"config\"\nreason = \"r\"\nallow = [\"x\"]\n",
        "",
    );
    let error = Manifest::parse(&manifest, "umbel-plugin.toml").unwrap_err();
    assert_eq!(error.code(), "PLUGIN_MANIFEST_INVALID");
    assert!(error.message().contains("allow"), "{error}");
}

#[test]
fn any_grant_on_a_mounted_manifest_is_refused() {
    let manifest = format!(
        r#"manifest_version = 1
protocol = 1
[plugin]
id = "m"
title = "m"
version = "1.0.0"
description = "d"
kind = "mounted"
domains = ["m"]
[mount]
prefix = "m"
transport = "stdio"
command = ["bin/server"]
{}"#,
        grants_toml(&["config"], true)
    );
    let error = Manifest::parse(&manifest, "umbel-plugin.toml").unwrap_err();
    assert_eq!(error.code(), "PLUGIN_MANIFEST_INVALID");
}

#[tokio::test]
async fn events_outside_the_instances_spaces_are_not_granted() {
    let dir = support::workspace(&config(&[("probe", "spaces = [\"main\"]")], ""));
    let host = seal(dir.path(), |b| {
        b.with_compiled(sdk(Probe::new(&["events"])))
    })
    .unwrap();
    // The instance's own space reads.
    let own = call(
        &host,
        agent("a"),
        "probe-events",
        json!({"events_space": "main"}),
    )
    .await;
    assert!(own.success, "{own:?}");
    // Another declared space is not-granted; an undeclared one is invalid.
    let other = call(
        &host,
        agent("a"),
        "probe-events",
        json!({"events_space": "second"}),
    )
    .await;
    assert!(!other.success);
    let extra = &other.metadata.as_ref().unwrap().extra;
    assert_eq!(extra["error_kind"], "not-granted", "{other:?}");
    let nowhere = call(
        &host,
        agent("a"),
        "probe-events",
        json!({"events_space": "nowhere"}),
    )
    .await;
    assert!(!nowhere.success);
    assert_ne!(
        nowhere.metadata.as_ref().unwrap().extra["error_kind"],
        "not-granted"
    );
}

#[tokio::test]
async fn events_read_under_the_callers_principal_and_with_no_space_the_calls_space() {
    let dir = support::workspace(&config(&[("probe", "")], ""));
    let host = seal(dir.path(), |b| {
        b.with_compiled(sdk(Probe::new(&["events"])))
    })
    .unwrap();
    for text in ["one", "two"] {
        let noted = call(&host, agent("writer"), "probe-note", json!({"text": text})).await;
        assert!(noted.success, "{noted:?}");
    }
    let note_in_second = call(
        &host,
        agent("writer"),
        "probe-note",
        json!({"text": "other", "space": "second"}),
    )
    .await;
    assert!(note_in_second.success);

    // Agent `a` acknowledged the first event; its read starts after it. Agent `b` has not.
    let acked = call(
        &host,
        agent("a"),
        "event-ack",
        json!({"cursor": "v0:main:1"}),
    )
    .await;
    assert!(acked.success, "{acked:?}");
    let seen_by = |who: &'static str, input: Value| {
        let host = &host;
        async move {
            let result = call(host, agent(who), "probe-events", input).await;
            data(&result)
        }
    };
    let a = seen_by("a", json!({})).await;
    let b = seen_by("b", json!({})).await;
    assert_eq!(a["events"].as_array().unwrap().len(), 1, "{a}");
    assert_eq!(b["events"].as_array().unwrap().len(), 2, "{b}");
    assert_eq!(a["space"], "main");

    // With no space, the call's resolved space: a call in `second` reads `second`.
    let second = seen_by("b", json!({"space": "second"})).await;
    assert_eq!(second["space"], "second");
    assert_eq!(second["events"].as_array().unwrap().len(), 1, "{second}");

    // The read did not acknowledge anything: `a`'s cursor is where it was.
    let again = seen_by("a", json!({})).await;
    assert_eq!(again["acknowledged"], "v0:main:1");
}

#[tokio::test]
async fn plugin_show_prints_trusted_not_sandboxed_for_a_compiled_instance_only() {
    let dir = support::workspace(&config(&[("probe", ""), ("guide", "")], ""));
    write_pack_plugin(dir.path(), "guide");
    let host = seal(dir.path(), |b| {
        b.with_compiled(sdk(Probe::new(&["config", "clock"])))
    })
    .unwrap();

    let compiled = data(&call(&host, agent("a"), "plugin-show", json!({"plugin": "probe"})).await);
    assert_eq!(compiled["grants"]["trust"], "trusted, not sandboxed");
    assert!(compiled.to_string().contains("trusted, not sandboxed"));
    assert!(!compiled["grants"]["items"].as_array().unwrap().is_empty());

    let pack = data(&call(&host, agent("a"), "plugin-show", json!({"plugin": "guide"})).await);
    assert_eq!(pack["plugin"]["kind"], "pack");
    assert!(
        !pack.to_string().contains("trusted, not sandboxed"),
        "{pack}"
    );
    assert!(pack["grants"].get("trust").is_none());

    let list = data(&call(&host, agent("a"), "plugin-list", json!({})).await);
    let trust: Vec<_> = list["plugins"]
        .as_array()
        .unwrap()
        .iter()
        .map(|plugin| {
            (
                plugin["id"].as_str().unwrap(),
                plugin.get("trust").is_some(),
            )
        })
        .collect();
    assert_eq!(trust, [("probe", true), ("guide", false)]);
}

fn write_pack_plugin(root: &std::path::Path, id: &str) {
    let dir = root.join("plugins").join(id);
    std::fs::create_dir_all(dir.join("packs/voice/data")).unwrap();
    std::fs::write(
        dir.join("umbel-plugin.toml"),
        format!(
            "manifest_version = 1\nprotocol = 1\n[plugin]\nid = \"{id}\"\ntitle = \"{id}\"\nversion = \"1.0.0\"\ndescription = \"d\"\nkind = \"pack\"\n[[packs]]\nid = \"voice\"\npath = \"packs/voice\"\n"
        ),
    )
    .unwrap();
    std::fs::write(
        dir.join("packs/voice/pack.toml"),
        format!("pack_version = 1\nid = \"voice\"\nplugin = \"{id}\"\nversion = \"1.0.0\"\ntitle = \"V\"\ndescription = \"d\"\n"),
    )
    .unwrap();
    std::fs::write(dir.join("packs/voice/data/words.txt"), "hello").unwrap();
}

//! Phase 5's configuration and manifest shapes (phase 5 specification, sections 2, 2.2 and 2.3):
//! the workspace configuration version 5 and the plugin manifest version 5. Every example validates
//! in `every_example_validates_against_its_schema`; these tests hold that each schema refuses what
//! the host refuses and admits what it admits, that the examples open in the host, and that every
//! version constant names a schema file. The record shapes are in `phase5_records.rs`.

use std::path::Path;

use serde_json::{Value, json};
use umbel::plugins::Manifest;
use umbel::workspace::ConfigFile;

use super::{as_toml, assert_refuses, edited, example, examples, schemas_dir, validator};

fn opens(instance: &Value) -> bool {
    ConfigFile::parse(&as_toml(instance))
        .and_then(|file| file.into_config(Path::new("/w/example")))
        .is_ok()
}

// ── Versions ───────────────────────────────────────────────────────────────────────────────────

#[test]
fn every_version_constant_names_a_schema_file() {
    let exists = |stem: String| {
        assert!(
            schemas_dir().join(format!("{stem}.json")).is_file(),
            "{stem}"
        );
    };
    for version in umbel::CONFIG_VERSIONS {
        exists(format!("workspace-config.v{version}"));
    }
    for version in umbel::MANIFEST_VERSIONS {
        exists(format!("plugin-manifest.v{version}"));
    }
    for (stem, versions) in [
        ("principal", umbel::PRINCIPAL_VERSIONS),
        ("provenance-envelope", umbel::ENVELOPE_VERSIONS),
        ("event", umbel::EVENT_VERSIONS),
        ("proposal", umbel::PROPOSAL_VERSIONS),
        ("memory-record", umbel::MEMORY_VERSIONS),
        ("cursor", umbel::CURSOR_VERSIONS),
        ("locator", umbel::LOCATOR_VERSIONS),
    ] {
        for version in versions {
            exists(format!("{stem}.v{version}"));
        }
    }
    exists(format!("task-record.v{}", umbel::TASK_VERSION));
    exists(format!("usage-event.v{}", umbel::USAGE_VERSION));
    exists(format!("person-decision.v{}", umbel::PERSON_VERSION));
    exists("protected-resource.v1".to_owned());
    assert_eq!(umbel::CONFIG_VERSIONS, [1, 2, 3, 4, 5]);
    assert_eq!(umbel::PRINCIPAL_VERSIONS, [0, 1]);
    assert_eq!(umbel::ENVELOPE_VERSIONS, [0, 1, 2, 3]);
    assert_eq!(umbel::EVENT_VERSIONS, [0, 1, 2, 3]);
    assert_eq!(umbel::PROPOSAL_VERSIONS, [1, 2, 3]);
    assert_eq!(umbel::CURSOR_VERSIONS, [0, 1]);
    assert_eq!(umbel::LOCATOR_VERSIONS, [1, 2]);
    // The versions this host writes stay where they were until the step that writes the next.
    assert_eq!(umbel::PRINCIPAL_VERSION, 1);
    assert_eq!(umbel::PROVENANCE_VERSION, 2);
    assert_eq!(umbel::EVENT_VERSION, 2);
    assert_eq!(umbel::PROPOSAL_VERSION, 2);
    assert_eq!(umbel::CURSOR_VERSION, 0);
}

// ── Workspace configuration, version 5 (section 2.2) ───────────────────────────────────────────

/// An `oauth` workspace on a loopback bind with one namespace, a person login and an issuer.
fn oauth() -> Value {
    json!({
        "config_version": 5,
        "principal": { "local_id": "corp/U1" },
        "http": {
            "public_url": "https://umbel.example.com/mcp",
            "allowed_hosts": ["umbel.example.com"]
        },
        "auth": {
            "mode": "oauth",
            "namespaces": { "corp": { "person": {
                "issuer": "corp-idp", "client_id": "umbel", "client_secret_env": "UMBEL_SECRET",
                "acr_values": ["phr"], "uv_amr": ["pin"]
            } } },
            "issuers": { "corp-idp": { "issuer": "https://idp.example.com", "namespace": "corp", "access_tokens": true } }
        }
    })
}

#[test]
fn the_version_5_config_schema_admits_what_the_host_admits() {
    let validator = validator("workspace-config.v5");
    let base = oauth();
    let ok = [
        json!({ "config_version": 5 }),
        json!({ "config_version": 5, "auth": { "mode": "none", "scope_prefix": "corp.umbel" } }),
        base.clone(),
        edited(&base, |c| {
            c["http"]["bind"] = json!("0.0.0.0:8443");
            c["http"]["tls"] =
                json!({ "cert": "c.pem", "key": "/etc/k.pem", "client_auth": "any" });
            c["auth"]["require_bound_tokens"] = json!(true);
        }),
        edited(&base, |c| {
            c["auth"]["issuers"]["corp-idp"]["verify"] = json!("introspection");
            c["auth"]["issuers"]["corp-idp"]["introspection"] =
                json!({ "client_id": "u", "client_secret_env": "S" });
        }),
        edited(&base, |c| {
            c["access"] = json!({ "groups": { "eng": { "members": [], "claim": { "issuer": "corp-idp", "name": "groups", "value": "eng" } } } });
            c["usage"] = json!({ "readers": ["group:eng", "human:corp/U1"], "retention_days": 30 });
            c["limits"] = json!({ "calls_per_minute": 1 });
            c["principal"]["equivalents"] = json!({ "human:ada": "human:corp/U1" });
        }),
    ];
    for instance in &ok {
        if let Err(error) = validator.validate(instance) {
            panic!("the schema refused {instance}: {error}");
        }
        assert!(opens(instance), "the host refused {instance}");
    }
}

#[test]
fn the_version_5_config_schema_refuses_what_the_host_refuses() {
    let validator = validator("workspace-config.v5");
    let base = oauth();
    let with = |edit: &dyn Fn(&mut Value)| edited(&base, |c| edit(c));
    let bad = [
        json!({ "config_version": 4, "auth": { "mode": "none" } }),
        json!({ "config_version": 6 }),
        // A non-loopback bind needs a hosted mode and TLS.
        json!({ "config_version": 5, "http": { "bind": "0.0.0.0:8443" } }),
        with(&|c| c["http"]["bind"] = json!("0.0.0.0:8443")),
        // A hosted mode needs the public URL, https, with no query.
        with(&|c| c["http"].as_object_mut().unwrap().clear()),
        with(&|c| c["http"]["public_url"] = json!("http://umbel.example.com/mcp")),
        with(&|c| c["http"]["public_url"] = json!("https://umbel.example.com/mcp?a=1")),
        with(&|c| c["http"]["public_url"] = json!("https://u@umbel.example.com/mcp")),
        // TLS: the CA exactly with client_auth = "ca".
        with(&|c| {
            c["http"]["tls"] = json!({ "cert": "c.pem", "key": "k.pem", "client_auth": "ca" })
        }),
        with(&|c| {
            c["http"]["tls"] = json!({ "cert": "c.pem", "key": "k.pem", "client_ca": "ca.pem" })
        }),
        with(&|c| c["http"]["tls"] = json!({ "cert": "c.pem" })),
        with(&|c| c["http"]["tls"] = json!({ "cert": "../c.pem", "key": "k.pem" })),
        with(&|c| c["http"]["tls"] = json!({ "cert": "state/c.pem", "key": "k.pem" })),
        // [auth].
        with(&|c| c["auth"]["mode"] = json!("jwt")),
        with(&|c| c["auth"]["scope_prefix"] = json!("Umbel")),
        with(&|c| c["auth"]["clock_skew_s"] = json!(301)),
        with(&|c| c["auth"]["max_token_lifetime_s"] = json!(0)),
        with(&|c| c["auth"]["tenant"] = json!("t")),
        with(&|c| c["auth"]["require_bound_tokens"] = json!(true)),
        json!({ "config_version": 5, "auth": { "require_bound_tokens": true } }),
        with(&|c| c["auth"]["issuers"] = json!({})),
        with(
            &|c| c["auth"]["gateway"] = json!({ "alias": "edge", "namespace": "corp", "issuer": "https://g.example.com", "keys": "k.json", "max_scopes": ["umbel:read"] }),
        ),
        json!({ "config_version": 5, "principal": { "local_id": "corp/U1" }, "http": { "public_url": "https://h.test/mcp", "allowed_hosts": ["h.test"] }, "auth": { "mode": "gateway", "namespaces": { "corp": {} } } }),
        // Namespaces and person logins (owner decision 6).
        with(&|c| c["auth"]["namespaces"] = json!({ "Corp": {} })),
        with(&|c| {
            c["auth"]["namespaces"]["corp"]["person"]["acr_values"] = json!([]);
        }),
        with(&|c| {
            c["auth"]["namespaces"]["corp"]["person"]["uv_amr"] = json!([]);
        }),
        with(&|c| {
            c["auth"]["namespaces"]["corp"]["person"]["uv_amr"] = json!(["pwd"]);
        }),
        with(&|c| {
            c["auth"]["namespaces"]["corp"]["person"]
                .as_object_mut()
                .unwrap()
                .remove("acr_values");
        }),
        with(&|c| {
            c["auth"]["namespaces"]["corp"]["person"]["client_secret_env"] = json!("not a name");
        }),
        with(&|c| {
            c["auth"]["namespaces"]["corp"]["person"]["subject_claim"] = json!("email");
        }),
        with(&|c| {
            c["auth"]["namespaces"]["corp"]["person"]["max_age_s"] = json!(3601);
        }),
        // Issuers.
        with(&|c| c["auth"]["issuers"]["corp-idp"]["issuer"] = json!("http://idp.example.com")),
        with(&|c| c["auth"]["issuers"]["corp-idp"]["algorithms"] = json!(["HS256"])),
        with(&|c| c["auth"]["issuers"]["corp-idp"]["algorithms"] = json!(["none"])),
        with(&|c| c["auth"]["issuers"]["corp-idp"]["algorithms"] = json!(["ES512"])),
        with(&|c| c["auth"]["issuers"]["corp-idp"]["algorithms"] = json!([])),
        with(&|c| c["auth"]["issuers"]["corp-idp"]["subject_claim"] = json!("preferred_username")),
        with(&|c| c["auth"]["issuers"]["corp-idp"]["verify"] = json!("introspection")),
        with(&|c| {
            c["auth"]["issuers"]["corp-idp"]["introspection"] =
                json!({ "client_id": "u", "client_secret_env": "S" })
        }),
        with(&|c| c["auth"]["issuers"]["corp-idp"]["services"] = json!({})),
        with(&|c| c["auth"]["issuers"]["corp-idp"]["services"] = json!({ "clients": [] })),
        // In mode gateway an issuer serves only a person login.
        json!({ "config_version": 5, "principal": { "local_id": "corp/U1" }, "http": { "public_url": "https://h.test/mcp", "allowed_hosts": ["h.test"] }, "auth": { "mode": "gateway", "namespaces": { "corp": { "person": { "issuer": "idp", "client_id": "u", "client_secret_env": "S", "acr_values": ["phr"], "uv_amr": ["pin"] } } }, "issuers": { "idp": { "issuer": "https://idp.example.com", "namespace": "corp", "access_tokens": true } }, "gateway": { "alias": "edge", "namespace": "corp", "issuer": "https://g.example.com", "keys": "k.json", "max_scopes": ["umbel:read"] } } }),
        with(&|c| c["auth"]["issuers"]["corp-idp"]["delegation"] = json!("chain")),
        with(&|c| {
            c["auth"]["issuers"]["Corp"] =
                json!({ "issuer": "https://x.example.com", "namespace": "corp" })
        }),
        // Groups, limits, usage, equivalents.
        with(
            &|c| c["access"] = json!({ "groups": { "eng": { "members": [], "claim": { "issuer": "corp-idp", "name": "groups" } } } }),
        ),
        with(&|c| c["limits"] = json!({ "calls_per_minute": 0 })),
        with(&|c| c["limits"] = json!({ "burst": 1 })),
        with(&|c| c["usage"] = json!({ "readers": ["*"] })),
        with(&|c| c["usage"] = json!({ "retention_days": 0 })),
        with(&|c| c["principal"]["equivalents"] = json!({ "ada": "human:corp/U1" })),
        with(&|c| c["principal"]["equivalents"] = json!({ "human:ada": 3 })),
    ];
    for instance in &bad {
        assert!(
            !validator.is_valid(instance),
            "the schema accepted {instance}"
        );
        assert!(!opens(instance), "the host accepted {instance}");
    }
    // Cross-table rules are the host's: the schema admits these, the host refuses them.
    let host_only = [
        // A login issuer that does not say whether it issues tokens.
        with(&|c| {
            c["auth"]["issuers"]["corp-idp"]
                .as_object_mut()
                .unwrap()
                .remove("access_tokens");
        }),
        with(&|c| c["principal"]["local_id"] = json!("ada")),
        with(&|c| c["auth"]["issuers"]["corp-idp"]["namespace"] = json!("other")),
        with(&|c| c["http"]["public_url"] = json!("https://elsewhere.example.com/mcp")),
        with(&|c| c["principal"]["equivalents"] = json!({ "human:ada": "human:other/U1" })),
        with(
            &|c| c["access"] = json!({ "groups": { "eng": { "members": [], "claim": { "issuer": "nowhere", "name": "g", "value": "e" } } } }),
        ),
        with(&|c| c["usage"] = json!({ "readers": ["group:nowhere"] })),
    ];
    for instance in &host_only {
        assert!(validator.is_valid(instance), "{instance}");
        assert!(!opens(instance), "the host accepted {instance}");
    }
    // The memory_write table's version 5 keys.
    let memory = |table: Value| json!({ "config_version": 5, "plugins": { "enabled": ["memory"], "memory": { "source": "compiled:memory", "grants": { "memory_write": table } } } });
    let fine = memory(
        json!({ "allow": ["main"], "editors": ["group:a"], "erasers": ["group:a"], "erase_approvals": 2, "erase_approval_window_s": 600 }),
    );
    assert!(validator.is_valid(&fine) && opens(&fine));
    let refused = [
        memory(json!({ "allow": ["main"], "erasers": ["space"] })),
        memory(json!({ "allow": ["main"], "erase_approvals": 3 })),
        memory(json!({ "allow": ["main"], "erase_approval_window_s": 599 })),
        memory(json!({ "allow": ["main"], "editors": ["human:ada"] })),
        memory(json!({ "allow": ["main"], "editors": ["space"] })),
    ];
    assert_refuses(&validator, "workspace-config.v5 memory_write", &refused);
    for instance in &refused {
        assert!(!opens(instance), "the host accepted {instance}");
    }
}

#[test]
fn the_version_5_config_examples_open_in_the_host_too() {
    let validator = validator("workspace-config.v5");
    let found = examples("workspace-config.v5");
    assert_eq!(
        found.len(),
        4,
        "minimal, full (oauth), gateway and reserved"
    );
    for (name, example) in found {
        assert!(validator.is_valid(&example), "{name}");
        ConfigFile::parse(&as_toml(&example))
            .and_then(|file| file.into_config(Path::new("/w/example")))
            .unwrap_or_else(|e| panic!("{name}: {e}"));
    }
    // The version 4 schema refuses version 5's keys and still describes version 4 files.
    let v4 = validator_v4();
    assert!(!v4.is_valid(&example("workspace-config.v5", "full")));
    assert!(v4.is_valid(&example("workspace-config.v4", "full")));
    assert!(!validator.is_valid(&example("workspace-config.v4", "full")));
}

fn validator_v4() -> jsonschema::Validator {
    validator("workspace-config.v4")
}

// ── Plugin manifest, version 5 (section 2.3) ───────────────────────────────────────────────────

#[test]
fn the_version_5_manifest_schema_refuses_what_the_host_refuses() {
    let validator = validator("plugin-manifest.v5");
    let base = example("plugin-manifest.v5", "");
    assert!(validator.is_valid(&base));
    let with = |edit: &dyn Fn(&mut Value)| edited(&base, |m| edit(m));
    // commands: [0] approve (person mcp), [1] reject (person cli verified), [2] preview,
    // [3] scan, [4] count, [5] refresh (task); pipelines: [0] sweep, [1] refresh-all (task),
    // [2] approve-verified (person).
    let cases = [
        with(&|m| m["manifest_version"] = json!(4)),
        // person: values, keys, beside require-human only, mcp needing MCP exposure.
        with(&|m| m["commands"][0]["person"] = json!({ "mcp": "terminal" })),
        with(&|m| m["commands"][0]["person"] = json!({ "cli": "strong" })),
        with(&|m| m["commands"][0]["person"] = json!({ "agent": "verified" })),
        with(&|m| m["commands"][2]["person"] = json!({ "cli": "terminal" })),
        with(&|m| m["commands"][0]["expose"]["mcp"] = json!(false)),
        with(&|m| m["commands"][0]["expose"]["agent"] = json!(true)),
        with(&|m| {
            m["commands"][0].as_object_mut().unwrap().remove("person");
        }),
        // A person-page decision declares a preview and a digest journal.
        with(&|m| {
            m["commands"][1]
                .as_object_mut()
                .unwrap()
                .remove("confirm_preview");
        }),
        with(&|m| {
            m["commands"][1].as_object_mut().unwrap().remove("journal");
        }),
        with(&|m| m["commands"][1]["journal"] = json!({ "mode": "plain" })),
        // task: values and refusals.
        with(&|m| m["commands"][5]["task"] = json!("sometimes")),
        with(&|m| m["commands"][5]["journal"] = json!({ "mode": "digest" })),
        with(&|m| m["commands"][5]["expose"] = json!({ "mcp": false })),
        with(&|m| m["commands"][5]["approval"] = json!("required")),
        with(&|m| m["commands"][5]["confirm_prompt"] = json!("Sure?")),
        with(&|m| m["commands"][3]["task"] = json!("optional")),
        with(&|m| m["commands"][0]["task"] = json!("optional")),
        // A pipeline's task and person.
        with(&|m| m["pipelines"][1]["task"] = json!("later")),
        with(&|m| m["pipelines"][1]["expose"]["mcp"] = json!(false)),
        with(&|m| m["pipelines"][1]["journal"] = json!({ "mode": "digest" })),
        with(&|m| m["pipelines"][1]["person"] = json!({ "cli": "verified" })),
        with(&|m| m["pipelines"][0]["task"] = json!("optional")),
        with(&|m| m["pipelines"][2]["person"] = json!({ "mcp": "terminal" })),
        with(&|m| m["pipelines"][2]["person"] = json!({ "cli": "verified" })),
        with(&|m| m["pipelines"][2]["person"] = json!({ "mcp": "verified" })),
        // scopes stays reserved.
        with(&|m| m["commands"][5]["scopes"] = json!(["umbel:write"])),
    ];
    assert_refuses(&validator, "plugin-manifest.v5", &cases);
    for (index, case) in cases.iter().enumerate() {
        assert!(
            Manifest::parse(&as_toml(case), "m").is_err(),
            "case {index}: the host accepted {case}"
        );
    }
    // A component command and a mounted tool take no task.
    let mut component = example("plugin-manifest.v1", "component");
    component["manifest_version"] = json!(5);
    assert!(validator.is_valid(&component));
    let refused = edited(&component, |m| {
        m["commands"][0]["effects"] = json!(["plugin-state"]);
        m["commands"][0]["task"] = json!("optional");
    });
    assert!(!validator.is_valid(&refused));
    assert!(Manifest::parse(&as_toml(&refused), "c").is_err());
    let mut mounted = example("plugin-manifest.v1", "mounted");
    mounted["manifest_version"] = json!(5);
    assert!(validator.is_valid(&mounted));
    mounted["mount"]["tools"] = json!([{ "tool": "a", "task": "optional" }]);
    assert!(!validator.is_valid(&mounted));
    assert!(Manifest::parse(&as_toml(&mounted), "m").is_err());
    // What needs the preview's schema or the steps is the reader's to check: the schema admits
    // these, the host refuses them (the second at seal, in manifest_v5.rs).
    let keepless = with(&|m| m["commands"][1]["journal"]["keep"] = json!(["change"]));
    assert!(validator.is_valid(&keepless));
    assert!(Manifest::parse(&as_toml(&keepless), "m").is_err());
    // Version 4 files stay version 4: the version 4 schema refuses what version 5 adds.
    let v4 = super::validator("plugin-manifest.v4");
    assert!(!v4.is_valid(&base));
    let mut lifted = example("plugin-manifest.v4", "");
    assert!(v4.is_valid(&lifted));
    lifted["commands"][0]["person"] = json!({ "cli": "terminal" });
    assert!(!v4.is_valid(&lifted));
}

#[test]
fn the_version_5_manifest_examples_are_manifests_to_the_host_too() {
    let validator = validator("plugin-manifest.v5");
    let found = examples("plugin-manifest.v5");
    assert_eq!(found.len(), 2, "every key, and none of them");
    for (name, example) in found {
        assert!(validator.is_valid(&example), "{name}");
        let manifest =
            Manifest::parse(&as_toml(&example), &name).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_eq!(manifest.manifest_version, 5, "{name}");
    }
    let manifest = Manifest::parse(&as_toml(&example("plugin-manifest.v5", "")), "x").unwrap();
    let approve = manifest.commands[0].person.unwrap();
    assert!(approve.mcp.is_some() && approve.cli == umbel::plugins::Assurance::Terminal);
    assert_eq!(
        manifest.commands[1].person.unwrap().cli,
        umbel::plugins::Assurance::Verified
    );
    assert_eq!(
        manifest.commands[5].task,
        umbel::plugins::TaskMode::Optional
    );
    assert_eq!(
        manifest.pipelines[1].task,
        umbel::plugins::TaskMode::Required
    );
    assert!(manifest.pipelines[2].person.is_some());
    let defaults =
        Manifest::parse(&as_toml(&example("plugin-manifest.v5", "defaults")), "x").unwrap();
    assert!(
        defaults
            .commands
            .iter()
            .all(|c| c.task == umbel::plugins::TaskMode::Never)
    );
}

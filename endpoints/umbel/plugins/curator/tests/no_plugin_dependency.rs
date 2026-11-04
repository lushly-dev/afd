//! Plugins do not depend on each other (principle 2, D3; phase 4 specification, section 1):
//! `cargo metadata` shows that the curator crate has no dependency, of any kind, on another plugin
//! crate (it renders through `umbel-okf`, which the knowledge plugin shares), and none directly on
//! an HTTP client, since no model drafts in phase 4 (owner decision 3).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::Path;
use std::process::Command;

use serde_json::Value;

fn metadata() -> Value {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../Cargo.toml");
    let output = Command::new(env!("CARGO"))
        .args([
            "metadata",
            "--format-version",
            "1",
            "--no-deps",
            "--offline",
        ])
        .arg("--manifest-path")
        .arg(&manifest)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

/// Every dependency of `package`, of every kind (normal, dev and build), as `(name, kind)`.
fn dependencies(metadata: &Value, package: &str) -> Vec<(String, String)> {
    let found = metadata["packages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["name"] == package)
        .unwrap_or_else(|| panic!("{package} is not a workspace member"));
    found["dependencies"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| {
            (
                d["name"].as_str().unwrap().to_owned(),
                d["kind"].as_str().unwrap_or("normal").to_owned(),
            )
        })
        .collect()
}

#[test]
fn the_curator_depends_on_no_plugin_crate_of_any_kind() {
    let dependencies = dependencies(&metadata(), "umbel-plugin-curator");
    let plugins: Vec<_> = dependencies
        .iter()
        .filter(|(name, _)| name.starts_with("umbel-plugin-"))
        .collect();
    assert!(plugins.is_empty(), "the curator depends on {plugins:?}");
    // It renders through the shared library instead.
    assert!(
        dependencies
            .iter()
            .any(|(name, kind)| name == "umbel-okf" && kind == "normal")
    );
}

#[test]
fn the_curator_depends_on_no_http_client() {
    let dependencies = dependencies(&metadata(), "umbel-plugin-curator");
    for client in ["reqwest", "hyper", "ureq", "hyper-util", "isahc", "surf"] {
        assert!(
            !dependencies.iter().any(|(name, _)| name == client),
            "the curator depends directly on {client}"
        );
    }
}

#[test]
fn no_plugin_crate_depends_on_the_curator_but_the_first_party_binary() {
    let metadata = metadata();
    for package in metadata["packages"].as_array().unwrap() {
        let name = package["name"].as_str().unwrap();
        if name == "umbel-first-party" || name == "umbel-plugin-curator" {
            continue;
        }
        let uses = dependencies(&metadata, name)
            .iter()
            .any(|(dep, _)| dep == "umbel-plugin-curator");
        assert!(!uses, "{name} depends on the curator");
    }
}

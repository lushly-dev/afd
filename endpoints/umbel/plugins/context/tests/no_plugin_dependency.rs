//! Plugins do not depend on each other (principle 2, D3, D78): `cargo metadata` shows that neither
//! the memory nor the context plugin crate has a dependency, of any kind, on another plugin
//! crate, and that no crate but `umbel-first-party` (D80) depends on both.
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
fn neither_plugin_crate_depends_on_another_plugin_crate() {
    let metadata = metadata();
    for package in ["umbel-plugin-memory", "umbel-plugin-context"] {
        let plugins: Vec<_> = dependencies(&metadata, package)
            .into_iter()
            .filter(|(name, _)| name.starts_with("umbel-plugin-") && name != package)
            .collect();
        assert!(plugins.is_empty(), "{package} depends on {plugins:?}");
    }
}

#[test]
fn only_the_first_party_binary_depends_on_memory_and_context_together() {
    let metadata = metadata();
    for package in metadata["packages"].as_array().unwrap() {
        let name = package["name"].as_str().unwrap();
        let names: Vec<(String, String)> = dependencies(&metadata, name);
        let has = |dep: &str| names.iter().any(|(n, _)| n == dep);
        if has("umbel-plugin-memory") && has("umbel-plugin-context") {
            assert_eq!(name, "umbel-first-party", "{name} links memory and context");
        }
    }
}

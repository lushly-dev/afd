//! A plugin depends on no other plugin (D3): `cargo metadata` shows no dependency, of any kind,
//! on another plugin crate.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::Path;
use std::process::Command;

use serde_json::Value;

#[test]
fn the_crate_depends_on_no_other_plugin_crate() {
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
    let metadata: Value = serde_json::from_slice(&output.stdout).unwrap();
    let package = metadata["packages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["name"] == "umbel-plugin-components")
        .unwrap();
    let plugins: Vec<&str> = package["dependencies"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|d| d["name"].as_str())
        .filter(|name| name.starts_with("umbel-plugin-"))
        .collect();
    assert!(plugins.is_empty(), "depends on {plugins:?}");
}

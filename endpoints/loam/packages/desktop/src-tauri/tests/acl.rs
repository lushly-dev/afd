//! P6-D4's pin on Tauri's framework transport (phase 6 specification, P6-D4, as amended 2026-11-16).
//!
//! "`invoke` of anything else from the main webview is refused" covers every command an app or plugin can
//! register. Tauri exempts some of its own internals from the ACL check in `Webview::on_message`; in 2.12.7
//! that is exactly the channel-fetch command, which hands a webview data its own `Channel` queued under an
//! identifier, and Loam uses no `Channel`. This test reads the Tauri source the build compiled and requires
//! the exemptions to be exactly that list, so an upgrade that adds one fails here and is reviewed.
use std::path::PathBuf;
use std::process::Command;

/// The framework transport commands the ACL check skips, as the specification names them.
const EXEMPT: &[&str] = &["plugin:__TAURI_CHANNEL__|fetch"];

fn tauri_source() -> PathBuf {
    let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".into());
    let output = Command::new(cargo)
        .args([
            "metadata",
            "--format-version",
            "1",
            "--locked",
            "--manifest-path",
        ])
        .arg(concat!(env!("CARGO_MANIFEST_DIR"), "/Cargo.toml"))
        .output()
        .expect("cargo metadata");
    assert!(output.status.success(), "cargo metadata failed");
    let metadata: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    let tauri = metadata["packages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|package| package["name"] == "tauri")
        .expect("tauri in the graph");
    PathBuf::from(tauri["manifest_path"].as_str().unwrap())
        .parent()
        .unwrap()
        .join("src")
}

/// The string value of `pub const <name>: &str = "...";` in `source`.
fn constant(source: &str, name: &str) -> Option<String> {
    let start = source.find(&format!("pub const {name}: &str = \""))?;
    let rest = &source[start..];
    let value = rest.split('"').nth(1)?;
    Some(value.to_owned())
}

#[test]
fn p6_d4_tauri_exempts_only_its_channel_fetch_from_the_acl() {
    let src = tauri_source();
    let webview = std::fs::read_to_string(src.join("webview/mod.rs")).unwrap();
    let channel = std::fs::read_to_string(src.join("ipc/channel.rs")).unwrap();

    // The ACL check: from its condition to the rejection, every `request.cmd !=` is an exemption.
    let start = webview
        .find("if (plugin_command.is_some() || has_app_acl_manifest || !is_local)")
        .expect(
            "Webview::on_message's ACL condition moved: read the new check and update P6-D4's list",
        );
    let end = start
        + webview[start..]
            .find("invoke.acl.is_none()")
            .expect("the ACL condition's end");
    let condition = &webview[start..end];
    // The whole condition, comments dropped and spaces collapsed: an exemption in another form changes it.
    let normalised = condition
        .lines()
        .map(|line| line.split("//").next().unwrap_or(""))
        .collect::<Vec<_>>()
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    assert_eq!(
        normalised,
        "if (plugin_command.is_some() || has_app_acl_manifest || !is_local) && request.cmd != crate::ipc::channel::FETCH_CHANNEL_DATA_COMMAND &&",
        "Webview::on_message's ACL condition changed: review it and amend P6-D4"
    );
    let mut found: Vec<String> = Vec::new();
    for part in condition.split("request.cmd != ").skip(1) {
        let expression: String = part
            .chars()
            .take_while(|c| c.is_alphanumeric() || *c == '_' || *c == ':')
            .collect();
        let name = expression.rsplit("::").next().unwrap();
        let value = constant(&channel, name)
            .unwrap_or_else(|| panic!("an exemption P6-D4 does not know: {expression}"));
        found.push(value);
    }
    assert_eq!(
        found, EXEMPT,
        "Tauri's ACL exemptions changed: review them and amend P6-D4"
    );

    // Nothing else in Tauri compares a command name to skip the check.
    let mut others = Vec::new();
    let mut stack = vec![src.clone()];
    while let Some(directory) = stack.pop() {
        for entry in std::fs::read_dir(directory).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().is_some_and(|extension| extension == "rs") {
                let text = std::fs::read_to_string(&path).unwrap();
                if text.contains("acl.is_none()") && path != src.join("webview/mod.rs") {
                    others.push(path);
                }
            }
        }
    }
    assert!(
        others.is_empty(),
        "another ACL decision in Tauri: {others:?}"
    );
}

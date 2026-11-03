//! The default `tools/list` with the four first-party plugins (phase 3 specification, section 9.7,
//! D77; principle 12): `workspace-show`, `event-list`, `knowledge-search`, `knowledge-open`,
//! `context-bundle`, `memory-remember` and the five meta-tools, six of the cap of 8, and its
//! measured size.
//!
//! The host does not depend on the plugin crates (D3; D80 keeps memory and context together in
//! `umbel-first-party` alone), so each plugin is loaded from its directory: its real manifest,
//! schemas, packs and skills, with handlers that answer `{}`. What `tools/list` shows comes from
//! the manifest and the schemas alone.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::path::Path;
use std::sync::Arc;

use serde_json::{Value, json};
use support::mcp::{Client, Era, Transport};
use support::plugins::closure;
use umbel::HostBuilder;
use umbel::plugins::{Asset, CompiledPlugin, PluginCommand, PluginError, Services};

/// The four first-party plugins, in the order this workspace enables them.
const PLUGINS: [(&str, &str); 4] = [
    ("sources", "sources-filesystem"),
    ("knowledge", "knowledge"),
    ("context", "context"),
    ("memory", "memory"),
];

/// The most bytes the default `tools/list` result may hold. It measured 16 292 bytes when this
/// test was written; the margin leaves room for wording, not for another tool.
const MAX_LIST_BYTES: usize = 20_000;

/// A plugin as its directory holds it.
struct OnDisk {
    manifest: String,
    assets: &'static [Asset],
    commands: Vec<String>,
}

fn leak(text: String) -> &'static str {
    Box::leak(text.into_boxed_str())
}

fn files(root: &Path, dir: &Path, out: &mut Vec<Asset>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<_> = entries.map(|entry| entry.unwrap().path()).collect();
    entries.sort();
    for path in entries {
        if path.is_dir() {
            files(root, &path, out);
        } else {
            let relative = path
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            out.push(Asset {
                path: leak(relative),
                bytes: Box::leak(std::fs::read(&path).unwrap().into_boxed_slice()),
            });
        }
    }
}

impl OnDisk {
    fn load(dir: &str) -> Self {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("plugins")
            .join(dir);
        let manifest = std::fs::read_to_string(root.join("umbel-plugin.toml")).unwrap();
        let parsed: toml::Value = toml::from_str(&manifest).unwrap();
        let commands = parsed
            .get("commands")
            .and_then(toml::Value::as_array)
            .map(|commands| {
                commands
                    .iter()
                    .map(|c| c["name"].as_str().unwrap().to_owned())
                    .collect()
            })
            .unwrap_or_default();
        let mut assets = Vec::new();
        for part in ["packs", "skills", "schemas"] {
            files(&root, &root.join(part), &mut assets);
        }
        Self {
            manifest,
            assets: Box::leak(assets.into_boxed_slice()),
            commands,
        }
    }
}

impl CompiledPlugin for OnDisk {
    fn manifest(&self) -> &str {
        &self.manifest
    }

    fn assets(&self) -> &'static [Asset] {
        self.assets
    }

    fn commands(&self, _: Services) -> Result<Vec<PluginCommand>, PluginError> {
        Ok(self
            .commands
            .iter()
            .map(|name| closure(name, |_, _| afd::success(json!({}))))
            .collect())
    }
}

const CONFIG: &str = r#"config_version = 4
default_space = "main"

[spaces.main]

[plugins]
enabled = ["sources", "knowledge", "context", "memory"]

[plugins.sources]
source = "compiled:sources"
[plugins.sources.grants.documents_write]
allow = ["main/*"]
[plugins.sources.grants.records_write]
allow = ["main"]

[plugins.knowledge]
source = "compiled:knowledge"
[plugins.knowledge.grants.index_write]
allow = ["main"]
[plugins.knowledge.grants.graph_write]
allow = ["main"]
[plugins.knowledge.grants.records_write]
allow = ["main"]

[plugins.context]
source = "compiled:context"

[plugins.memory]
source = "compiled:memory"
[plugins.memory.grants.memory_write]
allow = ["main"]
"#;

fn first_party(config: &str) -> (tempfile::TempDir, umbel::Host) {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("umbel.toml"), config).unwrap();
    let mut builder = HostBuilder::open(dir.path()).unwrap();
    for (_, path) in PLUGINS {
        builder = builder.with_compiled(Arc::new(OnDisk::load(path)));
    }
    let host = builder.seal().unwrap();
    (dir, host)
}

const EXPECTED: [&str; 11] = [
    "afd-discover",
    "afd-detail",
    "afd-call",
    "afd-batch",
    "afd-pipe",
    "workspace-show",
    "event-list",
    "knowledge-search",
    "knowledge-open",
    "context-bundle",
    "memory-remember",
];

#[tokio::test]
async fn the_default_list_is_the_hot_path_and_measured() {
    let (_dir, host) = first_party(CONFIG);
    let first: Vec<String> = EXPECTED[5..].iter().map(|n| (*n).to_owned()).collect();
    assert_eq!(
        host.first_class_tools(),
        first.as_slice(),
        "six of the cap of 8"
    );
    for era in [Era::Modern, Era::Legacy] {
        let mut client = Client::connect(&host, Transport::Stdio, era).await;
        assert_eq!(client.tool_names().await, EXPECTED, "{era:?}");
        let response = client.request("tools/list", json!({})).await;
        let tools: &Value = &response["result"]["tools"];
        let bytes = serde_json::to_string(tools).unwrap().len();
        println!(
            "default tools/list ({era:?}): {} tools, {bytes} bytes",
            EXPECTED.len()
        );
        assert!(bytes <= MAX_LIST_BYTES, "{era:?}: {bytes} bytes");
    }
    // memory-recall is a lazy-discovery call away, not suggested.
    assert!(
        !host
            .first_class_tools()
            .contains(&"memory-recall".to_owned())
    );
}

#[tokio::test]
async fn the_deployers_list_still_wins() {
    let config = CONFIG.replace(
        "[spaces.main]\n",
        "[spaces.main]\n\n[mcp]\nfirst_class_tools = [\"memory-recall\", \"context-bundle\"]\n",
    );
    let (_dir, host) = first_party(&config);
    assert_eq!(
        host.first_class_tools(),
        &["memory-recall".to_owned(), "context-bundle".to_owned()]
    );
}

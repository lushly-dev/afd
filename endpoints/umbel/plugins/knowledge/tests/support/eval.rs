//! The seeded fixture as a running host, for the eval tests.
#![allow(dead_code, unreachable_pub, clippy::unwrap_used, clippy::expect_used)]

use serde_json::{Value, json};
use tempfile::TempDir;
use umbel::Host;
use umbel_plugin_knowledge::eval::fixture::{self, DEFAULT_SEED, FixtureManifest};

use super::{Terminal, build, run_cli};

/// The generated workspace and a host over it.
pub struct Seeded {
    pub dir: TempDir,
    pub host: Host,
    pub manifest: FixtureManifest,
}

/// Generate the fixture with the default seed and open a host over it.
pub fn seeded() -> Seeded {
    let dir = tempfile::tempdir().unwrap();
    let manifest = fixture::generate(DEFAULT_SEED, dir.path()).unwrap();
    let host = build(dir.path());
    Seeded {
        dir,
        host,
        manifest,
    }
}

impl Seeded {
    /// Write a file under the workspace.
    pub fn write(&self, relative: &str, bytes: &[u8]) {
        let path = self.dir.path().join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
    }

    /// Call `command` as a person at the command line (`human:local`, a member of `restricted`).
    pub async fn cli(&self, command: &str, input: Value) -> Value {
        run_cli(
            self.dir.path(),
            false,
            Terminal::new(true, true),
            &["call", command, &input.to_string()],
        )
        .await
        .1
    }

    /// Read the files into the stores of both spaces and index them from scratch.
    pub async fn refresh_all(&self) {
        for space in ["alpha", "beta"] {
            let sync = self.cli("sources-sync", json!({ "space": space })).await;
            assert_eq!(sync["success"], true, "{sync}");
            assert_eq!(sync["data"]["remaining"], false, "{sync}");
            let index = self
                .cli(
                    "knowledge-index",
                    json!({ "space": space, "rebuild": true }),
                )
                .await;
            assert_eq!(index["success"], true, "{index}");
        }
    }

    /// `knowledge-eval` over both spaces and the workspace's own query set.
    pub async fn eval(&self) -> Value {
        self.cli("knowledge-eval", json!({ "spaces": ["alpha", "beta"] }))
            .await
    }
}

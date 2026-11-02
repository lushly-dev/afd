//! The doctor's store checks on a sealed host (phase 2 specification, section 3.5):
//! `stores.version`, `stores.access` and `stores.lag`. They open the stores of every space that
//! already has one; a space nothing has written to is not given an empty store by a health check.

use crate::doctor::Check;
use crate::store::Hub;
use crate::workspace::Workspace;
use umbel_store::StoreError;

/// The three checks, in order.
pub(crate) fn checks(workspace: &Workspace, stores: &Hub) -> [Check; 3] {
    let mut opened = Vec::new();
    let mut version = None;
    for space in workspace.spaces() {
        let dir = workspace.layout().space_state_dir(&space.id);
        if !dir.join("store").join("store.sqlite3").is_file() && !dir.join("index").is_dir() {
            continue;
        }
        match stores.space(space.id.as_str()) {
            Ok(space_stores) => opened.push((space.id.to_string(), space_stores)),
            Err(StoreError::VersionUnsupported { found, supported }) => {
                version = Some(Check::fail(
                    "stores.version",
                    format!(
                        "the store of `{}` is version {found}; this build serves up to version {supported}",
                        space.id
                    ),
                    "Upgrade umbel to a version that serves this store.",
                ));
            }
            Err(error) => {
                version = Some(Check::fail(
                    "stores.version",
                    format!("the stores of `{}` cannot be opened: {error}", space.id),
                    "Run store-check for the space.",
                ));
            }
        }
    }
    let version = version.unwrap_or_else(|| {
        Check::pass(
            "stores.version",
            if opened.is_empty() {
                "No space has a store yet".to_owned()
            } else {
                format!("{} space store(s) open at a served version", opened.len())
            },
        )
    });
    let mut broken = Vec::new();
    let mut behind = Vec::new();
    for (space, stores) in &opened {
        match stores.sqlite.access_problems() {
            Ok(problems) if problems.is_empty() => {}
            Ok(problems) => broken.push(format!("{space}: {}", problems.join(", "))),
            Err(error) => broken.push(format!("{space}: {error}")),
        }
        let head = stores.documents.head().unwrap_or(0);
        let index = stores.index.applied().unwrap_or(0);
        let graph = stores.graph.applied().unwrap_or(0);
        if index < head || graph < head {
            behind.push(format!(
                "{space}: index {index}, graph {graph}, head {head}"
            ));
        }
    }
    let access = if broken.is_empty() {
        Check::pass("stores.access", "every stored row has an access token")
    } else {
        Check::fail(
            "stores.access",
            format!("rows without an access token: {}", broken.join("; ")),
            "Run store-check for the space and restore from a store-backup.",
        )
    };
    let lag = if behind.is_empty() {
        Check::pass(
            "stores.lag",
            "every index and graph reflects its store's head",
        )
    } else {
        Check::warn(
            "stores.lag",
            format!("behind the head: {}", behind.join("; ")),
            "Run knowledge-index (or knowledge-refresh) for the space.",
        )
    };
    [version, access, lag]
}

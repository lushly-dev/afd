//! `sources-sync` against a collection named as the person's own (records host specification,
//! section 3, rule 2): the host holds each document the sync puts to its file on disk, so the
//! sync must put exactly the file's bytes, a byte order mark and CRLF line endings included. A
//! first sync, an unchanged tree, an update and a delete all pass the rule, and every document
//! the sync stored is recorded as held to its file; a collection that is not own is as it was.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::json;
use support::*;
use umbel_store::ContentHash;

const OWN: &str = r#"
config_version = 6
default_space = "main"

[spaces.main]
person = "human:local"
[spaces.main.collections.handbook]
root = "spaces/main/handbook"
own = true
[spaces.main.collections.code]
root = "spaces/main/code"
kind = "code"

[spaces.beta]
[spaces.beta.collections.notes]
root = "spaces/beta/notes"

[plugins]
enabled = ["sources"]

[plugins.sources]
source = "compiled:sources"

[plugins.sources.grants.documents_write]
allow = ["main/*", "beta/*"]
[plugins.sources.grants.records_write]
allow = ["main", "beta"]
"#;

const PLAIN: &str = "# Pruning\n\nPrune roses in late winter, before the buds swell.\n";
const BOM: &str = "\u{feff}# Mulch\n\nMulch the roses in autumn.\n";
const CRLF: &str = "---\r\ntitle: Sun\r\n---\r\n# Sun\r\n\r\nRoses want morning sun.\r\n";

/// Each stored document of `main` that the host held to its file, with the hash it was held at.
fn held(fx: &Fx) -> Vec<(String, String)> {
    let conn = fx.store("main");
    let mut statement = conn
        .prepare("SELECT doc, doc_hash FROM doc_held ORDER BY doc")
        .unwrap();
    statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

/// A document's id with the hash of the file's bytes as they are on disk.
fn on_disk(id: &str, bytes: &str) -> (String, String) {
    (id.to_owned(), ContentHash::of(bytes.as_bytes()).to_string())
}

#[tokio::test]
async fn a_sync_of_an_own_collection_puts_each_file_as_it_is_on_disk_and_is_held_to_it() {
    let fx = Fx::with(OWN);
    fx.handbook("pruning.md", PLAIN);
    fx.handbook("mulch.md", BOM);
    fx.handbook("deep/sun.md", CRLF);
    fx.write("spaces/main/code/shed.rs", b"fn shed() {}\n");

    // Add: every file is stored, none is refused as differing from its file, and each
    // document's content is the file's bytes, the byte order mark and the CRLFs included.
    let first = fx.sync(json!({})).await;
    let handbook = collection(&first, "handbook");
    assert_eq!(handbook["added"], 3, "{first}");
    assert_eq!(handbook["skipped"]["total"], 0, "{first}");
    assert!(
        warning(&first, "STORE_OWN_SOURCE_MISMATCH").is_none(),
        "{first}"
    );
    let expected = vec![
        on_disk("handbook/deep/sun", CRLF),
        on_disk("handbook/mulch", BOM),
        on_disk("handbook/pruning", PLAIN),
    ];
    assert_eq!(
        held(&fx),
        expected,
        "each is held to its file, and only they are"
    );
    for (id, hash) in &expected {
        assert_eq!(fx.record("main", id)["contentHash"], json!(hash), "{id}");
    }
    assert_eq!(fx.record("main", "handbook/mulch")["size"], BOM.len());
    // The collection that is not own is stored as it always was, and nothing holds it.
    assert!(fx.ids("main").iter().any(|id| id.starts_with("code/")));

    // Unchanged: nothing is read again, nothing is written, and what was held stays held.
    let head = fx.head("main");
    let again = fx.sync(json!({})).await;
    assert_eq!(collection(&again, "handbook")["unchanged"], 3, "{again}");
    assert_eq!(fx.head("main"), head);
    assert_eq!(held(&fx), expected);

    // Update: the changed file is stored again and held at its new content.
    let longer = format!("{CRLF}\r\nAnd shelter from the wind.\r\n");
    fx.handbook("deep/sun.md", &longer);
    let updated = fx.sync(json!({})).await;
    let handbook = collection(&updated, "handbook");
    assert_eq!(handbook["updated"], 1, "{updated}");
    assert_eq!(handbook["skipped"]["total"], 0, "{updated}");
    assert_eq!(
        held(&fx),
        vec![
            on_disk("handbook/deep/sun", &longer),
            on_disk("handbook/mulch", BOM),
            on_disk("handbook/pruning", PLAIN),
        ]
    );

    // Delete: the document goes with its file, and the fact with the document.
    fx.remove("spaces/main/handbook/mulch.md");
    let deleted = fx.sync(json!({})).await;
    assert_eq!(collection(&deleted, "handbook")["deleted"], 1, "{deleted}");
    assert_eq!(
        held(&fx),
        vec![
            on_disk("handbook/deep/sun", &longer),
            on_disk("handbook/pruning", PLAIN),
        ]
    );
    assert_eq!(
        fx.ids("main")
            .iter()
            .filter(|id| id.starts_with("handbook/"))
            .count(),
        2
    );
}

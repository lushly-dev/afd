//! Permission mirroring (specification section 5.3): a document's own `access` key, else the
//! nearest `.umbel-access.toml`, else the collection's `access` and `sensitivity`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::json;
use support::*;

fn with_collection_defaults() -> String {
    CONFIG.replace(
        "root = \"spaces/main/handbook\"",
        "root = \"spaces/main/handbook\"\naccess = [\"group:platform\"]\nsensitivity = \"confidential\"",
    )
}

#[tokio::test]
async fn the_collection_defaults_apply_when_nothing_else_says() {
    let fx = Fx::new();
    fx.handbook("plain.md", "# Plain\n");
    fx.sync(json!({})).await;
    assert_eq!(fx.access("main", "handbook/plain"), ["space"]);
    assert_eq!(
        fx.record("main", "handbook/plain")["sensitivity"],
        "internal"
    );

    let mut fx = Fx::new();
    fx.reopen(&with_collection_defaults());
    fx.handbook("plain.md", "# Plain\n");
    fx.sync(json!({})).await;
    assert_eq!(fx.access("main", "handbook/plain"), ["group:platform"]);
    assert_eq!(
        fx.record("main", "handbook/plain")["sensitivity"],
        "confidential"
    );
    assert_eq!(
        fx.record("main", "handbook/plain")["envelope"]["access"],
        json!(["group:platform"])
    );
}

#[tokio::test]
async fn the_nearest_access_file_wins_whole_and_a_missing_key_falls_back_to_the_collection() {
    let mut fx = Fx::new();
    fx.reopen(&with_collection_defaults());
    fx.handbook(
        ".umbel-access.toml",
        "access = [\"principal:human:ada\"]\nsensitivity = \"restricted\"\n",
    );
    fx.handbook("top.md", "# Top\n");
    fx.handbook("a/inherits.md", "# Inherits the root rule\n");
    fx.handbook("a/b/.umbel-access.toml", "access = [\"space\"]\n");
    fx.handbook("a/b/nearest.md", "# Nearest rule\n");
    fx.handbook("a/b/c/deeper.md", "# Deeper still\n");
    fx.handbook("a/c/.umbel-access.toml", "sensitivity = \"public\"\n");
    fx.handbook("a/c/sensitivity-only.md", "# Sensitivity only\n");
    fx.handbook(
        "sibling/.umbel-access.toml",
        "access = [\"group:platform\"]\n",
    );
    fx.handbook("other/plain.md", "# Not under the sibling's rule\n");
    fx.sync(json!({})).await;

    let access = |id: &str| {
        (
            fx.access("main", id),
            fx.record("main", id)["sensitivity"]
                .as_str()
                .unwrap()
                .to_owned(),
        )
    };
    assert_eq!(
        access("handbook/top"),
        (
            vec!["principal:human:ada".to_owned()],
            "restricted".to_owned()
        )
    );
    assert_eq!(
        access("handbook/a/inherits"),
        (
            vec!["principal:human:ada".to_owned()],
            "restricted".to_owned()
        )
    );
    // The nearest file wins as a whole: its access, and the collection's sensitivity for the key it
    // leaves out (not the root file's).
    assert_eq!(
        access("handbook/a/b/nearest"),
        (vec!["space".to_owned()], "confidential".to_owned())
    );
    assert_eq!(
        access("handbook/a/b/c/deeper"),
        (vec!["space".to_owned()], "confidential".to_owned())
    );
    // Likewise for access when the nearest file names only a sensitivity.
    assert_eq!(
        access("handbook/a/c/sensitivity-only"),
        (vec!["group:platform".to_owned()], "public".to_owned())
    );
    // A rule in a sibling directory does not leak sideways.
    assert_eq!(
        access("handbook/other/plain"),
        (
            vec!["principal:human:ada".to_owned()],
            "restricted".to_owned()
        )
    );
}

#[tokio::test]
async fn the_documents_own_keys_beat_the_access_file() {
    let fx = Fx::new();
    fx.handbook(
        ".umbel-access.toml",
        "access = [\"group:platform\"]\nsensitivity = \"restricted\"\n",
    );
    fx.handbook(
        "both.md",
        "---\naccess: [space]\nsensitivity: public\n---\nBody\n",
    );
    fx.handbook("access-only.md", "---\naccess: space\n---\nBody\n");
    fx.handbook(
        "sensitivity-only.md",
        "---\nsensitivity: internal\n---\nBody\n",
    );
    fx.handbook("neither.md", "---\ntitle: x\n---\nBody\n");
    fx.sync(json!({})).await;
    let both = fx.record("main", "handbook/both");
    assert_eq!(
        (
            fx.access("main", "handbook/both"),
            both["sensitivity"].as_str().unwrap()
        ),
        (vec!["space".to_owned()], "public")
    );
    // The key a document leaves out is inherited.
    let access_only = fx.record("main", "handbook/access-only");
    assert_eq!(fx.access("main", "handbook/access-only"), ["space"]);
    assert_eq!(access_only["sensitivity"], "restricted");
    assert_eq!(
        fx.access("main", "handbook/sensitivity-only"),
        ["group:platform"]
    );
    assert_eq!(
        fx.record("main", "handbook/sensitivity-only")["sensitivity"],
        "internal"
    );
    assert_eq!(fx.access("main", "handbook/neither"), ["group:platform"]);
}

#[tokio::test]
async fn an_access_file_that_does_not_read_blocks_the_files_it_governs_and_no_others() {
    for (n, bad) in [
        "access = [\"nobody\"]\n",
        "access = []\n",
        "access = \"space\"\n",
        "access = [\"group:Bad\"]\n",
        "acess = [\"space\"]\n",
        "sensitivity = \"secret\"\n",
        "access = [",
        "access = [\"space\"]\nextra = 1\n",
    ]
    .iter()
    .enumerate()
    {
        let fx = Fx::new();
        fx.handbook("fine.md", "# Fine, ungoverned\n");
        fx.handbook("gov/.umbel-access.toml", bad);
        fx.handbook("gov/a.md", "# Governed\n");
        fx.handbook("gov/deeper/b.md", "# Governed too\n");
        let result = fx.sync(json!({})).await;
        let handbook = collection(&result, "handbook");
        assert_eq!(handbook["added"], 1, "case {n} {bad:?}: {result}");
        assert_eq!(
            handbook["skipped"]["reasons"]["ACCESS_INVALID"], 2,
            "case {n}"
        );
        assert_eq!(fx.ids("main"), ["handbook/fine"], "case {n}");
    }
    // Too large to read: the same.
    let fx = Fx::new();
    fx.handbook(
        "gov/.umbel-access.toml",
        &format!("# {}\naccess = [\"space\"]\n", "x".repeat(70_000)),
    );
    fx.handbook("gov/a.md", "# Governed\n");
    let result = fx.sync(json!({})).await;
    assert_eq!(
        collection(&result, "handbook")["skipped"]["reasons"]["ACCESS_INVALID"],
        1
    );
}

#[tokio::test]
async fn a_documents_access_key_that_does_not_read_is_never_widened() {
    let fx = Fx::new();
    for (name, value) in [
        ("a", "[nobody]"),
        ("b", "[]"),
        ("c", "5"),
        ("d", "{x: y}"),
        ("e", "[space, \"group:Bad\"]"),
    ] {
        fx.handbook(
            &format!("{name}.md"),
            &format!("---\naccess: {value}\n---\nBody\n"),
        );
    }
    let result = fx.sync(json!({})).await;
    assert_eq!(
        collection(&result, "handbook")["skipped"]["reasons"]["ACCESS_INVALID"],
        5
    );
    assert_eq!(fx.documents("main"), 0);
}

#[tokio::test]
async fn changing_the_access_file_changes_the_access_of_files_that_did_not_change() {
    let fx = Fx::new();
    fx.handbook("a/doc.md", "# Doc\n");
    fx.handbook(
        "a/pinned.md",
        "---\naccess: [space]\n---\nPinned by its own key, which the rule cannot override\n",
    );
    fx.sync(json!({})).await;
    assert_eq!(fx.access("main", "handbook/a/doc"), ["space"]);

    fx.handbook("a/.umbel-access.toml", "access = [\"group:platform\"]\n");
    let tightened = fx.sync(json!({})).await;
    let handbook = collection(&tightened, "handbook");
    assert_eq!(
        handbook["updated"], 1,
        "only the file whose access changed is written: {tightened}"
    );
    assert_eq!(handbook["unchanged"], 1);
    assert_eq!(fx.access("main", "handbook/a/doc"), ["group:platform"]);
    assert_eq!(
        fx.access("main", "handbook/a/pinned"),
        ["space"],
        "its own key wins"
    );
    let hash_before = fx.record("main", "handbook/a/doc")["contentHash"].clone();

    // The bytes did not change, only who may read them.
    let quiet = fx.sync(json!({})).await;
    assert_eq!(collection(&quiet, "handbook")["unchanged"], 2);

    std::fs::remove_file(fx.path("spaces/main/handbook/a/.umbel-access.toml")).unwrap();
    let loosened = fx.sync(json!({})).await;
    assert_eq!(collection(&loosened, "handbook")["updated"], 1);
    assert_eq!(fx.access("main", "handbook/a/doc"), ["space"]);
    assert_eq!(
        fx.record("main", "handbook/a/doc")["contentHash"],
        hash_before
    );
}

#[tokio::test]
async fn changing_a_collections_defaults_in_the_configuration_is_noticed() {
    let mut fx = Fx::new();
    fx.handbook("a.md", "# A\n");
    fx.sync(json!({})).await;
    assert_eq!(fx.access("main", "handbook/a"), ["space"]);
    fx.reopen(&with_collection_defaults());
    let result = fx.sync(json!({})).await;
    assert_eq!(collection(&result, "handbook")["updated"], 1);
    assert_eq!(fx.access("main", "handbook/a"), ["group:platform"]);
}

#[tokio::test]
async fn the_access_file_is_never_a_document_and_hidden_rules_do_not_make_hidden_documents() {
    let mut fx = Fx::new();
    fx.reopen(&CONFIG.replace(
        "root = \"spaces/main/handbook\"",
        "root = \"spaces/main/handbook\"\ninclude = [\"**/*\"]",
    ));
    fx.handbook(".umbel-access.toml", "access = [\"space\"]\n");
    fx.handbook("a.md", "# A\n");
    let result = fx.sync(json!({})).await;
    assert_eq!(collection(&result, "handbook")["added"], 1);
    assert_eq!(collection(&result, "handbook")["skipped"]["total"], 0);
    assert_eq!(fx.ids("main"), ["handbook/a"]);
}

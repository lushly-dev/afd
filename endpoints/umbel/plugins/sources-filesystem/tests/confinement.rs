//! Confinement and limits (specification sections 4.1, 5.2 and 11): paths that try to leave a
//! root, symbolic links and hard links, names that cannot be ids, size caps, the file-count cap,
//! and markdown built to be slow.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::MetadataExt;
use std::time::{Duration, Instant};

use serde_json::json;
use support::*;

#[tokio::test]
async fn a_collection_or_space_named_with_a_path_reads_nothing() {
    let fx = Fx::new();
    fx.write("secret.md", b"# Outside every root\n");
    for collection in [
        "../..",
        "../handbook",
        "handbook/..",
        "/etc",
        "handbook/../../..",
        ".",
        "",
    ] {
        let result = fx
            .cli("sources-sync", json!({ "collection": collection }))
            .await;
        assert!(!result.success, "{collection:?}: {result:?}");
        let code = failure_code(&result);
        assert!(
            matches!(code.as_str(), "COLLECTION_NOT_FOUND" | "VALIDATION_ERROR"),
            "{collection:?}: {code}"
        );
    }
    for space in ["../x", "..", "main/../beta"] {
        let result = fx.cli("sources-sync", json!({ "space": space })).await;
        assert!(!result.success, "{space:?}");
    }
    assert_eq!(fx.documents("main"), 0);
    assert!(
        !text(&json_of(
            fx.cli("sources-status", json!({"collection": "../.."}))
                .await
        ))
        .contains("Outside every root")
    );
}

#[tokio::test]
async fn a_symbolic_link_inside_a_root_is_never_followed() {
    let fx = Fx::new();
    let outside = tempfile::tempdir().unwrap();
    std::fs::write(
        outside.path().join("stolen.md"),
        "# Stolen\n\nthe contents of a file outside the workspace\n",
    )
    .unwrap();
    std::fs::create_dir_all(outside.path().join("dir")).unwrap();
    std::fs::write(
        outside.path().join("dir/inside.md"),
        "# Inside a linked directory\n",
    )
    .unwrap();
    let root = fx.path("spaces/main/handbook");
    std::os::unix::fs::symlink(outside.path().join("stolen.md"), root.join("link.md")).unwrap();
    std::os::unix::fs::symlink(outside.path().join("dir"), root.join("linked-dir")).unwrap();
    std::os::unix::fs::symlink(root.join("real.md"), root.join("loop.md")).unwrap();
    std::os::unix::fs::symlink("/nonexistent/target.md", root.join("dangling.md")).unwrap();
    fx.handbook("real.md", "# Real\n");
    let result = fx.sync(json!({})).await;
    assert_eq!(collection(&result, "handbook")["added"], 1);
    assert_eq!(fx.ids("main"), ["handbook/real"]);
    assert!(!text(&result).contains("Stolen"));
    // A link to a file inside the same root is a link too: only the real file is a document.
    assert_eq!(fx.documents("main"), 1);
}

#[tokio::test]
async fn a_directory_replaced_by_a_link_after_a_sync_removes_its_documents() {
    let fx = Fx::new();
    fx.handbook("sub/a.md", "# A\n");
    fx.sync(json!({})).await;
    assert_eq!(fx.documents("main"), 1);
    let outside = tempfile::tempdir().unwrap();
    std::fs::write(outside.path().join("a.md"), "# Elsewhere\n").unwrap();
    std::fs::remove_dir_all(fx.path("spaces/main/handbook/sub")).unwrap();
    std::os::unix::fs::symlink(outside.path(), fx.path("spaces/main/handbook/sub")).unwrap();
    let result = fx.sync(json!({})).await;
    assert_eq!(collection(&result, "handbook")["deleted"], 1);
    assert_eq!(fx.documents("main"), 0);
}

#[tokio::test]
async fn a_root_that_is_a_link_to_a_directory_inside_the_workspace_is_read() {
    let fx = Fx::new();
    std::fs::remove_dir_all(fx.path("spaces/main/handbook")).unwrap();
    fx.write("elsewhere/inside/a.md", b"# Through the root link\n");
    std::os::unix::fs::symlink(fx.path("elsewhere/inside"), fx.path("spaces/main/handbook"))
        .unwrap();
    let result = fx.sync(json!({})).await;
    assert_eq!(collection(&result, "handbook")["added"], 1);
    assert_eq!(fx.ids("main"), ["handbook/a"]);
}

#[tokio::test]
async fn a_hard_link_reads_as_the_regular_file_it_is_and_the_sync_never_writes_through_it() {
    let fx = Fx::new();
    let outside = tempfile::tempdir().unwrap();
    let original = outside.path().join("shared.md");
    std::fs::write(&original, "# Shared with another place\n").unwrap();
    std::fs::hard_link(&original, fx.path("spaces/main/handbook/hard.md")).unwrap();
    let before = std::fs::metadata(&original).unwrap();
    assert_eq!(before.nlink(), 2);
    let result = fx.sync(json!({})).await;
    // Section 5.2: a hard link is indistinguishable from a file and is read.
    assert_eq!(collection(&result, "handbook")["added"], 1);
    assert_eq!(
        fx.record("main", "handbook/hard")["title"],
        "Shared with another place"
    );
    // Reading changed nothing: same bytes, same inode, same link count, same mtime.
    let after = std::fs::metadata(&original).unwrap();
    assert_eq!(
        (after.ino(), after.nlink(), after.mtime(), after.len()),
        (before.ino(), before.nlink(), before.mtime(), before.len())
    );
    assert_eq!(
        std::fs::read_to_string(&original).unwrap(),
        "# Shared with another place\n"
    );
}

#[tokio::test]
async fn names_that_cannot_be_ids_are_skipped_not_followed() {
    let fx = Fx::new();
    fx.handbook("ok.md", "# Fine\n");
    fx.handbook("new\nline.md", "# Newline in the name\n");
    fx.handbook("back\\slash.md", "# Backslash in the name\n");
    fx.handbook("tab\there.md", "# Tab\n");
    fx.handbook(".dotfile.md", "# Dotfile\n");
    fx.handbook("a/.hidden/b.md", "# Hidden directory\n");
    fx.handbook("dot.dot..md", "# Dots inside are fine\n");
    fx.handbook(
        &format!("{}.md", "x".repeat(240)),
        "# Long but within 512 bytes\n",
    );
    fx.handbook(
        &format!("{0}/{0}/{0}/{1}.md", "d".repeat(200), "y".repeat(100)),
        "# Id over 512 bytes\n",
    );
    // A name that is not UTF-8 is invisible to the walk: it neither fails the sync nor appears.
    let raw = std::ffi::OsStr::from_bytes(b"raw-\xff.md");
    // Some file systems (APFS) refuse such a name outright; where it exists the walk skips it.
    let _ = std::fs::write(fx.path("spaces/main/handbook").join(raw), "# Raw bytes\n");
    let result = fx.sync(json!({})).await;
    let handbook = collection(&result, "handbook");
    assert_eq!(
        handbook["skipped"]["reasons"]["SOURCE_PATH_INVALID"], 6,
        "{result}"
    );
    let ids = fx.ids("main");
    assert_eq!(ids.len(), 3, "{ids:?}");
    assert!(
        ids.contains(&"handbook/ok".to_owned()) && ids.contains(&"handbook/dot.dot.".to_owned())
    );
    assert!(ids.contains(&format!("handbook/{}", "x".repeat(240))));
}

#[tokio::test]
async fn two_files_that_would_share_an_id_keep_the_first_and_skip_the_second() {
    let mut fx = Fx::new();
    fx.reopen(&CONFIG.replace(
        "root = \"spaces/main/handbook\"",
        "root = \"spaces/main/handbook\"\ninclude = [\"**/*.md\", \"**/*\"]",
    ));
    fx.handbook("same.md", "# With the extension\n");
    fx.handbook("same", "# Without the extension\n");
    let result = fx.sync(json!({})).await;
    let handbook = collection(&result, "handbook");
    assert_eq!(handbook["added"], 1);
    assert_eq!(handbook["skipped"]["reasons"]["SOURCE_PATH_INVALID"], 1);
    assert_eq!(fx.ids("main"), ["handbook/same"]);
}

#[tokio::test]
async fn the_default_file_size_cap_is_one_mebibyte_and_frontmatter_is_capped_at_64_kib() {
    let fx = Fx::new();
    let mut at_cap = b"# At the cap\n\n".to_vec();
    at_cap.resize(1024 * 1024, b'a');
    fx.write("spaces/main/handbook/at-cap.md", &at_cap);
    let mut over = b"# Over the cap\n\n".to_vec();
    over.resize(1024 * 1024 + 1, b'a');
    fx.write("spaces/main/handbook/over.md", &over);
    // A frontmatter block of 70 KiB inside a small file.
    fx.handbook(
        "big-front.md",
        &format!("---\nnote: {}\n---\nBody\n", "n".repeat(70_000)),
    );
    let result = fx.sync(json!({})).await;
    let handbook = collection(&result, "handbook");
    assert_eq!(handbook["added"], 1);
    assert_eq!(
        handbook["skipped"]["reasons"],
        json!({ "FRONTMATTER_INVALID": 1, "SOURCE_TOO_LARGE": 1 })
    );
    assert_eq!(fx.ids("main"), ["handbook/at-cap"]);
}

#[tokio::test]
async fn markdown_built_to_be_slow_is_read_within_limits() {
    let fx = Fx::new();
    let started = Instant::now();
    fx.handbook("quotes.md", &format!("{} deep\n", ">".repeat(200_000)));
    let mut nested = String::new();
    for depth in 0..3_000 {
        nested.push_str(&" ".repeat(depth.min(200)));
        nested.push_str("- item\n");
    }
    fx.handbook("lists.md", &nested);
    fx.handbook("one-line.md", &"word ".repeat(150_000));
    fx.handbook(
        "brackets.md",
        &format!("{}x{}\n", "[".repeat(100_000), "](u)".repeat(10_000)),
    );
    fx.handbook("emphasis.md", &"*a ".repeat(150_000));
    fx.handbook("headings.md", &"## same\n".repeat(30_000));
    fx.handbook("links.md", &"[a](b.md) ".repeat(60_000));
    fx.handbook("backticks.md", &"`".repeat(300_000));
    fx.handbook("zero-width.md", &"\u{200B}".repeat(200_000));
    fx.handbook("newlines.md", &"\n".repeat(900_000));
    let result = fx.sync(json!({})).await;
    let handbook = collection(&result, "handbook");
    assert_eq!(handbook["added"], 10, "{result}");
    assert!(
        started.elapsed() < Duration::from_secs(120),
        "took {:?}",
        started.elapsed()
    );
    // Whatever they hold, they are stored, titled and flagged where they should be.
    assert!(
        fx.record("main", "handbook/zero-width")["flags"]
            .as_array()
            .unwrap()
            .contains(&json!("hidden-text"))
    );
    assert_eq!(
        fx.record("main", "handbook/headings")["title"],
        "headings",
        "no level-1 heading: the file name"
    );
}

#[tokio::test]
async fn a_deeply_nested_directory_tree_is_walked() {
    let fx = Fx::new();
    let path = (0..60)
        .map(|n| format!("level{n}"))
        .collect::<Vec<_>>()
        .join("/");
    fx.handbook(&format!("{path}/leaf.md"), "# Leaf\n");
    let result = fx.sync(json!({})).await;
    assert_eq!(collection(&result, "handbook")["added"], 1);
}

#[tokio::test]
async fn more_than_100000_files_in_a_collection_is_source_limit_and_writes_nothing() {
    let fx = Fx::new();
    let root = fx.path("spaces/main/handbook");
    for shard in 0..100 {
        let dir = root.join(format!("d{shard:03}"));
        std::fs::create_dir_all(&dir).unwrap();
        for n in 0..1000 {
            std::fs::write(dir.join(format!("f{n:04}.md")), "").unwrap();
        }
    }
    std::fs::write(root.join("one-more.md"), "").unwrap();
    let head = fx.head("main");
    let result = fx.sync(json!({})).await;
    let handbook = collection(&result, "handbook");
    assert_eq!(handbook["limited"], true);
    assert_eq!(handbook["added"], 0);
    assert!(warning(&result, "SOURCE_LIMIT").is_some());
    assert_eq!(fx.head("main"), head);
    assert_eq!(fx.documents("main"), 0);
}

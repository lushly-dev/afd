//! Re-verification and inconsistencies (phase 4 specification, section 6; D95): `verify`
//! proposals for the readable documents due within `lead_days` of `stale_after` whose checks pass,
//! each check a `text` evidence entry; a failed check reported, not proposed; `deprecate`
//! proposals for documents naming a resolving successor; deprecated documents whose successor
//! does not resolve reported. The curator never attests: a person approving is the verification.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use serde_json::{Value, json};
use support::*;
use umbel_plugin_curator::review::review_id;
use umbel_store::memory::format_instant;
use umbel_store::{Flag, Status};

/// `notes/<name>` with `stale_after` at `stale` (an instant), readable by the space.
fn due(fx: &mut Fx, name: &str, stale: Option<i64>) {
    fx.markdown(&format!("notes/{name}"), &format!("# {name}\n"), |write| {
        write.stale_after = stale.map(format_instant);
    });
}

/// The stub drafted for `doc`.
fn stub_for(fx: &Fx, doc: &str) -> Option<Value> {
    fx.stubs().into_iter().find(|s| s["doc"] == doc)
}

fn doc_hash(fx: &Fx, doc: &str) -> String {
    use umbel_store::DocumentStore;
    let store = umbel_store_embedded::SqliteStore::open(
        &fx.space_dir("main"),
        "main",
        umbel_store_embedded::StoreOptions::default(),
    )
    .unwrap();
    store
        .get_document(doc, &everyone())
        .unwrap()
        .unwrap()
        .write
        .content_hash
        .as_str()
        .to_owned()
}

#[tokio::test]
async fn a_document_due_within_the_lead_is_proposed_for_verification_with_its_checks() {
    let mut fx = Fx::new();
    due(&mut fx, "due", Some(day(20)));
    due(&mut fx, "later", Some(day(40)));
    due(&mut fx, "never", None);
    fx.at(day(6));
    let report = fx.report().await;
    assert_eq!(report["counts"]["reverify"], 1, "{report}");
    assert_eq!(fx.stubs().len(), 1);
    let stub = stub_for(&fx, "notes/due").unwrap();
    assert_eq!(stub["op"], "verify");
    let id = review_id("main", "human:local", "notes/due");
    assert_eq!(stub["key"], format!("curator/{id}/0"));
    let item = &stub["item"];
    assert_eq!(item["drafter"], json!({ "mode": "scheduled" }));
    assert_eq!(item["change"]["baseHash"], doc_hash(&fx, "notes/due"));
    assert_eq!(
        item["change"]["verification"]["staleAfter"],
        format_instant(day(6) + 180 * DAY)
    );
    assert_eq!(
        item["evidence"],
        json!([
            { "kind": "text", "ref": "check:links-resolve", "excerpt": "pass" },
            { "kind": "text", "ref": "check:sources-unchanged", "excerpt": "pass" },
            { "kind": "text", "ref": "check:not-flagged", "excerpt": "pass" },
        ])
    );
    assert!(item.get("derivedFrom").is_none() && item.get("conflictSet").is_none());
    // The review record keeps the draft, so it is not drafted again while it is open.
    let review = fx.curator_body("review", &id).unwrap();
    assert!(record_validator().is_valid(&review), "{review:#}");
    assert_eq!(review["status"], "drafted");
    assert_eq!(review["proposal"], stub["id"]);
    fx.at(day(7));
    assert_eq!(fx.report().await["counts"]["reverify"], 0);
    assert_eq!(fx.stubs().len(), 1);
    // The curator never attests: the document is unchanged until a person approves.
    assert_eq!(item["change"]["baseHash"], doc_hash(&fx, "notes/due"));
}

#[tokio::test]
async fn a_failed_check_is_reported_not_proposed() {
    let mut fx = Fx::new();
    fx.markdown("notes/broken", "# broken\n", |write| {
        write.stale_after = Some(format_instant(day(10)));
        write.flags = vec![Flag::BrokenLinks];
    });
    fx.markdown("notes/flagged", "# flagged\n", |write| {
        write.stale_after = Some(format_instant(day(10)));
        write.flags = vec![Flag::InstructionLike];
    });
    due(&mut fx, "source", None);
    let cited = format!("sha256:{}", "7".repeat(64));
    fx.markdown("notes/cites", "# cites\n", |write| {
        write.stale_after = Some(format_instant(day(10)));
        write.frontmatter.insert(
            "sources".into(),
            json!([{ "resource": "source", "contentHash": cited }]),
        );
    });
    fx.at(day(1));
    let report = fx.report().await;
    assert_eq!(report["counts"]["reverify"], 0, "{report}");
    assert!(fx.stubs().is_empty());
    let found = report["inconsistencies"].as_array().unwrap();
    for (doc, check) in [
        ("notes/broken", "links-resolve"),
        ("notes/flagged", "not-flagged"),
        ("notes/cites", "sources-unchanged"),
    ] {
        assert!(
            found.contains(&json!({ "kind": "check-failed", "doc": doc, "check": check })),
            "{doc}: {report}"
        );
    }
    // A cited source still at its hash passes.
    let current = doc_hash(&fx, "notes/source");
    fx.markdown("notes/cites", "# cites\n", |write| {
        write.stale_after = Some(format_instant(day(10)));
        write.frontmatter.insert(
            "sources".into(),
            json!([{ "resource": "source", "contentHash": current }]),
        );
    });
    let report = fx.report().await;
    assert_eq!(report["counts"]["reverify"], 1, "{report}");
    assert!(stub_for(&fx, "notes/cites").is_some());
}

#[tokio::test]
async fn a_named_successor_is_proposed_as_a_deprecation_and_a_missing_one_reported() {
    let mut fx = Fx::new();
    due(&mut fx, "new", None);
    fx.markdown("notes/old", "# old\n", |write| {
        write.superseded_by = Some("new".into());
        // Due too: deprecating it comes first.
        write.stale_after = Some(format_instant(day(5)));
    });
    fx.markdown("notes/gone", "# gone\n", |write| {
        write.status = Status::Deprecated;
        write.superseded_by = Some("nowhere".into());
    });
    fx.markdown("notes/kept", "# kept\n", |write| {
        write.status = Status::Deprecated;
        write.superseded_by = Some("new".into());
        write.stale_after = Some(format_instant(day(5)));
    });
    fx.at(day(1));
    let report = fx.report().await;
    assert_eq!(report["counts"]["deprecate"], 1, "{report}");
    assert_eq!(
        report["counts"]["reverify"], 0,
        "a deprecated document is never verified"
    );
    let stub = stub_for(&fx, "notes/old").unwrap();
    assert_eq!(stub["op"], "deprecate");
    assert_eq!(stub["item"]["change"]["supersededBy"], "new");
    assert_eq!(
        stub["item"]["evidence"],
        json!([{ "kind": "document", "ref": "notes/new", "contentHash": doc_hash(&fx, "notes/new") }])
    );
    assert!(
        report["inconsistencies"]
            .as_array()
            .unwrap()
            .contains(&json!({ "kind": "successor-missing", "doc": "notes/gone" })),
        "{report}"
    );
    assert!(stub_for(&fx, "notes/kept").is_none());
}

#[tokio::test]
async fn a_rejected_review_is_quiet_and_a_changed_document_withdraws_its_draft() {
    let mut fx = Fx::new();
    due(&mut fx, "a", Some(day(10)));
    due(&mut fx, "b", Some(day(10)));
    fx.at(day(1));
    let report = fx.report().await;
    assert_eq!(report["counts"]["reverify"], 2, "{report}");
    let (a, b) = (
        stub_for(&fx, "notes/a").unwrap(),
        stub_for(&fx, "notes/b").unwrap(),
    );
    fx.decide(a["id"].as_str().unwrap(), "rejected", Some("still wrong"))
        .await;
    // Someone edits b: its verify's base is stale, so the run withdraws it.
    fx.markdown("notes/b", "# b, edited\n", |write| {
        write.stale_after = Some(format_instant(day(10)));
    });
    let report = fx.report().await;
    assert_eq!(report["counts"]["rejected"], 1, "{report}");
    assert_eq!(report["counts"]["withdrawn"], 1);
    assert_eq!(
        report["counts"]["reverify"], 0,
        "not drafted again the same run"
    );
    let withdrawn: Vec<Value> = fx
        .stubs()
        .into_iter()
        .filter(|s| s["id"] == b["id"])
        .collect();
    assert_eq!(withdrawn[0]["state"], "withdrawn");
    let rejected = fx
        .curator_body("review", &review_id("main", "human:local", "notes/a"))
        .unwrap();
    assert!(record_validator().is_valid(&rejected), "{rejected:#}");
    assert_eq!(rejected["status"], "rejected");
    assert_eq!(rejected["quietUntil"], format_instant(day(1) + 90 * DAY));
    never_mentions(&rejected.to_string(), &["still wrong"]);
    // The next run drafts the edited document again; the rejected one stays quiet.
    let report = fx.report().await;
    assert_eq!(report["counts"]["reverify"], 1, "{report}");
    assert_eq!(
        fx.stubs().iter().filter(|s| s["doc"] == "notes/b").count(),
        2
    );
    assert_eq!(
        fx.stubs().iter().filter(|s| s["doc"] == "notes/a").count(),
        1
    );
}

#[tokio::test]
async fn at_most_max_per_run_reviews_in_document_id_order() {
    let mut fx = Fx::new();
    for name in ["c", "a", "d", "b"] {
        due(&mut fx, name, Some(day(10)));
    }
    fx.pack(|pack| pack.replace("max_per_run = 20", "max_per_run = 2"));
    fx.at(day(1));
    let report = fx.report().await;
    assert_eq!(report["counts"]["reverify"], 2, "{report}");
    assert_eq!(report["counts"]["remaining"], 2);
    let docs: Vec<String> = fx
        .stubs()
        .iter()
        .map(|s| s["doc"].as_str().unwrap().to_owned())
        .collect();
    assert!(
        docs.contains(&"notes/a".to_owned()) && docs.contains(&"notes/b".to_owned()),
        "{docs:?}"
    );
    let next = fx.report().await;
    assert_eq!(next["counts"]["reverify"], 2);
    assert_eq!(fx.stubs().len(), 4);
}

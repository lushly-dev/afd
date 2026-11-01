//! Group `index`: the query syntax of section 8.1 against a fixed corpus with expected hit
//! sets, the mandatory reader clause, the refused `access` field, structured filters, ordering,
//! and `commit` (atomic, and never lowering `applied`). Skipped when the backend has no index.

use std::collections::BTreeSet;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::json;

use super::{
    CaseResult, Ctx, Env, Fresh, ensure, ensure_eq, everyone, expect_err, invalid, pass, reader,
    samples, skip,
};
use crate::{
    ChunkHit, IndexChunk, IndexFilters, IndexQuery, ReaderFilter, SearchIndex, StoreError,
};

pub(super) const CASES: &[(&str, super::CaseFn)] = &[
    ("terms_booleans_phrases_and_fields", syntax),
    ("ranges_and_prefixes", ranges_and_prefixes),
    ("prefix_expansions_are_bounded", expansions),
    ("boosts_change_order_not_sets", boosts),
    ("syntax_errors_and_limits_are_invalid", errors),
    ("the_access_field_cannot_be_queried", access_refused),
    ("the_reader_clause_is_mandatory", reader_clause),
    ("structured_filters_are_clauses", filters),
    ("ties_and_rounding_are_deterministic", ordering),
    ("a_commit_is_seen_whole_or_not_at_all", atomic),
    ("applied_never_lowers", applied),
    ("replace_and_clear", replace_and_clear),
];

fn chunk(doc: &str, title: &str, body: &str) -> IndexChunk {
    samples::chunk(doc, 0, title, body, &["space"])
}

/// The fixed corpus. Dates, tags and meta are set where a case asks about them.
fn corpus() -> Vec<IndexChunk> {
    let mut rollback = chunk(
        "handbook/rollback",
        "Rolling back a deployment",
        "Revert the canary before the fleet. A rollback restores the previous release.",
    );
    rollback.tags = vec!["platform".into(), "ops".into()];
    rollback.doc_type = "runbook".into();
    rollback.updated = Some("2026-03-01T00:00:00Z".into());
    rollback.verified = "human".into();
    rollback.heading_path = vec!["Operations".into(), "Rollbacks".into()];
    rollback.meta = json!({"team": "infra", "tier": 1})
        .as_object()
        .cloned()
        .unwrap_or_default();

    let mut canary = chunk(
        "handbook/canary",
        "Canary releases",
        "A canary release exposes a small share of traffic. Use blue-green when the canary is not enough.",
    );
    canary.tags = vec!["platform".into()];
    canary.aliases = vec!["progressive delivery".into()];
    canary.doc_type = "guide".into();
    canary.updated = Some("2025-06-01T00:00:00Z".into());
    canary.meta = json!({"team": "infra"})
        .as_object()
        .cloned()
        .unwrap_or_default();

    let mut flags = chunk(
        "handbook/feature-flags",
        "Feature flags",
        "A feature flag turns a feature on or off without a release. Name each flag after its feature.",
    );
    flags.tags = vec!["product".into()];
    flags.doc_type = "guide".into();
    flags.status = "draft".into();
    flags.updated = Some("2026-06-01T00:00:00Z".into());
    flags.verified = "owner".into();
    flags.meta = json!({"team": "growth"})
        .as_object()
        .cloned()
        .unwrap_or_default();

    let mut legacy = chunk(
        "handbook/legacy",
        "Legacy deploys",
        "The legacy deploy script is deprecated. Rollback of legacy deploys is manual.",
    );
    legacy.tags = vec!["ops".into()];
    legacy.doc_type = "runbook".into();
    legacy.status = "deprecated".into();
    legacy.updated = Some("2024-01-01T00:00:00Z".into());

    let mut staging = chunk(
        "handbook/staging",
        "Staging environment",
        "Staging mirrors production. Deploy to staging before the canary.",
    );
    staging.tags = vec!["ops".into(), "platform".into()];
    staging.doc_type = "guide".into();
    staging.sensitivity = "confidential".into();

    let mut keys = samples::chunk(
        "secret/keys",
        0,
        "Signing keys",
        "Signing key rotation. Rollback of a rotation is forbidden.",
        &["group:sec"],
    );
    keys.tags = vec!["security".into()];
    keys.doc_type = "runbook".into();

    let monitoring0 = chunk(
        "handbook/monitoring",
        "Monitoring",
        "Dashboards show latency and saturation.",
    );
    let mut monitoring1 = chunk(
        "handbook/monitoring",
        "Monitoring",
        "Alerts page the on-call when latency rises.",
    );
    monitoring1.ordinal = 1;

    let mut parser = chunk("src/parser", "Parser", "Parses queries.");
    parser.doc_type = "code".into();
    parser.code = Some("parse_query QueryParser".into());
    parser.lang = Some("rust".into());

    vec![
        rollback,
        canary,
        flags,
        legacy,
        staging,
        keys,
        monitoring0,
        monitoring1,
        parser,
    ]
}

/// Write `chunks` as one commit at `applied`, grouping them by document.
fn commit(index: &dyn SearchIndex, chunks: Vec<IndexChunk>, applied: u64) -> Result<(), String> {
    let mut writer = index.writer().ctx("writer")?;
    let mut docs: Vec<String> = chunks.iter().map(|c| c.doc.clone()).collect();
    docs.dedup();
    for doc in docs {
        let own = chunks.iter().filter(|c| c.doc == doc).cloned().collect();
        writer.replace(&doc, own).ctx("replace")?;
    }
    writer.commit(applied).ctx("commit")
}

struct Loaded {
    _fresh: Fresh,
    index: Arc<dyn SearchIndex>,
}

fn loaded(env: &Env<'_>, chunks: Vec<IndexChunk>) -> Result<Option<Loaded>, String> {
    let fresh = env.fresh()?;
    let Some(index) = fresh.stores.index.clone() else {
        return Ok(None);
    };
    commit(&*index, chunks, 1)?;
    Ok(Some(Loaded {
        _fresh: fresh,
        index,
    }))
}

fn ask(text: &str) -> IndexQuery {
    IndexQuery {
        text: text.to_owned(),
        filters: IndexFilters::default(),
        limit: 100,
    }
}

fn found(
    index: &dyn SearchIndex,
    reader: &ReaderFilter,
    text: &str,
) -> Result<BTreeSet<String>, String> {
    let hits = index
        .search(&ask(text), reader)
        .map_err(|e| format!("`{text}`: {e}"))?;
    Ok(hits.into_iter().map(|h| h.doc).collect())
}

fn set(docs: &[&str]) -> BTreeSet<String> {
    docs.iter().map(|d| (*d).to_owned()).collect()
}

/// Each `(query, expected documents)` as a reader of `space`.
fn expect_sets(index: &dyn SearchIndex, cases: &[(&str, &[&str])]) -> Result<(), String> {
    let space = everyone();
    for (text, docs) in cases {
        ensure_eq(found(index, &space, text)?, set(docs), &format!("`{text}`"))?;
    }
    Ok(())
}

fn syntax(env: &Env<'_>) -> CaseResult {
    let Some(l) = loaded(env, corpus())? else {
        return skip("this backend has no search index");
    };
    expect_sets(
        &*l.index,
        &[
            // Terms: OR by default, case-folded, stemmed.
            ("rollback", &["handbook/rollback", "handbook/legacy"]),
            ("ROLLBACK", &["handbook/rollback", "handbook/legacy"]),
            (
                "rollback canary",
                &[
                    "handbook/rollback",
                    "handbook/legacy",
                    "handbook/canary",
                    "handbook/staging",
                ],
            ),
            (
                "deployments",
                &["handbook/rollback", "handbook/legacy", "handbook/staging"],
            ),
            // Required, excluded and Boolean.
            ("+rollback -legacy", &["handbook/rollback"]),
            ("rollback NOT legacy", &["handbook/rollback"]),
            ("rollback AND (canary OR flags)", &["handbook/rollback"]),
            (
                "-rollback",
                &[
                    "handbook/canary",
                    "handbook/feature-flags",
                    "handbook/staging",
                    "handbook/monitoring",
                    "src/parser",
                ],
            ),
            // Phrases and slop.
            ("\"feature flag\"", &["handbook/feature-flags"]),
            ("\"flag feature\"", &[]),
            ("\"flag feature\"~3", &["handbook/feature-flags"]),
            ("\"canary release\"", &["handbook/canary"]),
            // Fields.
            ("title:canary", &["handbook/canary"]),
            ("title:\"feature flags\"", &["handbook/feature-flags"]),
            (
                "tags:platform",
                &["handbook/rollback", "handbook/canary", "handbook/staging"],
            ),
            ("type:runbook", &["handbook/rollback", "handbook/legacy"]),
            ("aliases:delivery", &["handbook/canary"]),
            ("headings:operations", &["handbook/rollback"]),
            ("status:draft", &["handbook/feature-flags"]),
            ("collection:src", &["src/parser"]),
            ("lang:rust", &["src/parser"]),
            ("code:parse_query", &["src/parser"]),
            ("code:queryparser", &["src/parser"]),
            ("path:legacy", &["handbook/legacy"]),
            ("meta.team:infra", &["handbook/rollback", "handbook/canary"]),
            ("meta.tier:1", &["handbook/rollback"]),
            ("meta.team:nobody", &[]),
            // The default fields include the code field.
            ("queryparser", &["src/parser"]),
            // Boosts do not change which documents match.
            (
                "rollback^3 canary",
                &[
                    "handbook/rollback",
                    "handbook/legacy",
                    "handbook/canary",
                    "handbook/staging",
                ],
            ),
        ],
    )?;
    pass()
}

fn ranges_and_prefixes(env: &Env<'_>) -> CaseResult {
    let Some(l) = loaded(env, corpus())? else {
        return skip("this backend has no search index");
    };
    expect_sets(
        &*l.index,
        &[
            (
                "updated:[2026-01-01T00:00:00Z TO *]",
                &["handbook/rollback", "handbook/feature-flags"],
            ),
            (
                "updated:[* TO 2025-12-31T23:59:59Z]",
                &["handbook/canary", "handbook/legacy"],
            ),
            (
                "updated:{2026-03-01T00:00:00Z TO *]",
                &["handbook/feature-flags"],
            ),
            (
                "updated:[2026-03-01T00:00:00Z TO 2026-03-01T00:00:00Z]",
                &["handbook/rollback"],
            ),
            (
                "updated:[2026-03-01T01:00:00+01:00 TO 2026-03-01T01:00:00+01:00]",
                &["handbook/rollback"],
            ),
            // A prefix is lower-cased and not stemmed; the expansions are of the indexed (stemmed)
            // terms.
            ("roll*", &["handbook/rollback", "handbook/legacy"]),
            ("Roll*", &["handbook/rollback", "handbook/legacy"]),
            ("rollb*", &["handbook/rollback", "handbook/legacy"]),
            ("title:roll*", &["handbook/rollback"]),
            (
                "canar*",
                &["handbook/rollback", "handbook/canary", "handbook/staging"],
            ),
            ("canary*", &[]),
            (
                "deploy*",
                &["handbook/rollback", "handbook/legacy", "handbook/staging"],
            ),
            ("\"feature fl\"*", &["handbook/feature-flags"]),
            ("+roll* -legacy", &["handbook/rollback"]),
        ],
    )?;
    pass()
}

fn expansions(env: &Env<'_>) -> CaseResult {
    // 300 terms share a prefix; a document holding only the last of them is out of reach of a
    // prefix that expands to 256 terms.
    let all: Vec<String> = (0..300).map(|i| format!("zzw{i:03}")).collect();
    let many = chunk("bulk/many", "Many", &all.join(" "));
    let last = chunk("bulk/last", "Last", "zzw299");
    let Some(l) = loaded(env, vec![many, last])? else {
        return skip("this backend has no search index");
    };
    let space = everyone();
    ensure_eq(
        found(&*l.index, &space, "zzw299")?,
        set(&["bulk/many", "bulk/last"]),
        "the exact term",
    )?;
    let prefixed = found(&*l.index, &space, "zzw*")?;
    ensure(
        prefixed.contains("bulk/many"),
        "the prefix finds the document with the early terms",
    )?;
    ensure(
        !prefixed.contains("bulk/last"),
        "a prefix expands to at most 256 terms, so the 300th is out of reach",
    )?;
    pass()
}

fn top(index: &dyn SearchIndex, text: &str) -> Result<Vec<ChunkHit>, String> {
    index
        .search(&ask(text), &everyone())
        .map_err(|e| format!("`{text}`: {e}"))
}

fn boosts(env: &Env<'_>) -> CaseResult {
    let Some(l) = loaded(env, corpus())? else {
        return skip("this backend has no search index");
    };
    let legacy = top(&*l.index, "legacy^20 canary")?;
    let canary = top(&*l.index, "legacy canary^20")?;
    ensure_eq(
        legacy.first().map(|h| h.doc.as_str()),
        Some("handbook/legacy"),
        "boosting `legacy` puts its document first",
    )?;
    ensure_eq(
        canary.first().map(|h| h.doc.as_str()),
        Some("handbook/canary"),
        "boosting `canary` puts its document first",
    )?;
    for hits in [&legacy, &canary] {
        let gap = hits[0].score - hits[1].score;
        ensure(
            gap >= 0.001,
            "an exact-order assertion needs a gap of 0.001",
        )?;
    }
    pass()
}

fn nested(levels: usize) -> String {
    let mut text = "a OR b".to_owned();
    for _ in 1..levels {
        text = format!("a OR ({text})");
    }
    text
}

fn errors(env: &Env<'_>) -> CaseResult {
    let Some(l) = loaded(env, corpus())? else {
        return skip("this backend has no search index");
    };
    let space = everyone();
    let words = |n: usize| {
        (0..n)
            .map(|i| format!("w{i}"))
            .collect::<Vec<_>>()
            .join(" ")
    };
    let mut bad: Vec<(String, &str)> = Vec::new();
    for text in [
        "nope:x",
        "*b",
        "*",
        "title:*",
        "r*",
        "title:",
        "\"unterminated",
        "(rollback",
        "rollback)",
        "\"a b\"~9",
        "rollback^0",
        "rollback^101",
        "title:[a TO b]",
        "updated:[x TO *]",
        "updated:[* TO *]",
        "[2026-01-01T00:00:00Z TO *]",
        "tags:plat*",
        "tags:\"a b\"~2",
        "/roll.*/",
        "",
        "   ",
    ] {
        bad.push((text.to_owned(), "an invalid query"));
    }
    bad.push((words(65), "65 clauses"));
    bad.push((
        "title:a body:a tags:a type:a status:a lang:a path:a collection:a verified:a".to_owned(),
        "9 fields",
    ));
    bad.push((nested(17), "17 levels"));
    bad.push(("a".repeat(1025), "1025 characters"));
    for (text, what) in &bad {
        expect_err(
            l.index.search(&ask(text), &space),
            &format!("{what}: `{}`", text.chars().take(40).collect::<String>()),
            invalid,
        )?;
    }
    // The limits are inclusive.
    for (text, what) in [
        (words(64), "64 clauses"),
        (
            "title:a body:a tags:a type:a status:a lang:a path:a collection:a".to_owned(),
            "8 fields",
        ),
        (nested(16), "16 levels"),
        ("\"a b\"~8".to_owned(), "slop 8"),
        ("rollback^100".to_owned(), "boost 100"),
        ("ro*".to_owned(), "a prefix of 2 characters"),
        ("a".repeat(1024), "1024 characters"),
    ] {
        l.index
            .search(&ask(&text), &space)
            .map_err(|e| format!("{what} is allowed: {e}"))?;
    }
    // A syntax error names where.
    let Err(StoreError::Invalid(why)) = l.index.search(&ask("title:"), &space) else {
        return Err("`title:` is invalid".to_owned());
    };
    ensure(
        why.contains("position"),
        "a syntax error names its position",
    )?;
    for limit in [0, 401] {
        let query = IndexQuery {
            limit,
            ..ask("rollback")
        };
        expect_err(
            l.index.search(&query, &space),
            &format!("limit {limit}"),
            invalid,
        )?;
    }
    pass()
}

fn access_refused(env: &Env<'_>) -> CaseResult {
    let Some(l) = loaded(env, corpus())? else {
        return skip("this backend has no search index");
    };
    // Even a reader who holds the token cannot name the field, in any position.
    let sec = reader(&["space", "group:sec"]);
    for text in [
        "access:space",
        "access:\"group:sec\"",
        "-access:group:sec",
        "+access:space rollback",
        "rollback OR access:space",
        "rollback AND (canary OR access:space)",
        "access:[a TO z]",
        "access:sp*",
        "access:space^2",
    ] {
        expect_err(
            l.index.search(&ask(text), &sec),
            &format!("`{text}`"),
            invalid,
        )?;
    }
    pass()
}

fn reader_clause(env: &Env<'_>) -> CaseResult {
    let Some(l) = loaded(env, corpus())? else {
        return skip("this backend has no search index");
    };
    let space = everyone();
    let sec = reader(&["space", "group:sec"]);
    let nobody = ReaderFilter::tokens(Vec::<String>::new()).ctx("a reader")?;
    let derivation = ReaderFilter::derivation();
    let with_secret = set(&["handbook/rollback", "handbook/legacy", "secret/keys"]);
    ensure_eq(
        found(&*l.index, &space, "rollback")?,
        set(&["handbook/rollback", "handbook/legacy"]),
        "a reader of `space`",
    )?;
    ensure_eq(
        found(&*l.index, &sec, "rollback")?,
        with_secret.clone(),
        "a reader of `space` and `group:sec`",
    )?;
    ensure_eq(
        found(&*l.index, &derivation, "rollback")?,
        with_secret,
        "a derivation read",
    )?;
    ensure(
        found(&*l.index, &nobody, "rollback")?.is_empty(),
        "a reader with no tokens finds nothing",
    )?;
    // No way of writing the query widens the reader's view.
    for text in [
        "-zzzznothing",
        "secret/keys",
        "title:signing OR rotation OR keys",
        "path:keys",
        "tags:security",
        "collection:secret",
        "sig*",
        "NOT rollback",
    ] {
        ensure(
            !found(&*l.index, &space, text)?.contains("secret/keys"),
            &format!("`{text}` showed an outsider the restricted document"),
        )?;
    }
    ensure(
        found(&*l.index, &sec, "tags:security")?.contains("secret/keys"),
        "the group's reader finds it",
    )?;
    ensure(
        l.index
            .chunks("secret/keys", &space)
            .ctx("chunks")?
            .is_empty(),
        "an unreadable document has no chunks, as an absent one has none",
    )?;
    ensure_eq(
        l.index.chunks("secret/keys", &sec).ctx("chunks")?.len(),
        1,
        "its reader reads them",
    )?;
    ensure(
        l.index
            .chunks("nope/absent", &space)
            .ctx("chunks")?
            .is_empty(),
        "an absent document has no chunks",
    )?;
    // Snippets and stored fields of an unreadable chunk never appear in a reader's hits.
    for hit in top(&*l.index, "rollback OR keys OR rotation OR signing")? {
        ensure(
            hit.doc != "secret/keys" && !hit.chunk.body.contains("rotation"),
            "no hit carries the restricted text",
        )?;
    }
    pass()
}

fn filters(env: &Env<'_>) -> CaseResult {
    let Some(l) = loaded(env, corpus())? else {
        return skip("this backend has no search index");
    };
    let space = everyone();
    let with = |text: &str, filters: IndexFilters| -> Result<BTreeSet<String>, String> {
        let query = IndexQuery {
            filters,
            ..ask(text)
        };
        let hits = l.index.search(&query, &space).ctx("search")?;
        Ok(hits.into_iter().map(|h| h.doc).collect())
    };
    let none = IndexFilters::default;
    ensure_eq(
        with(
            "rollback",
            IndexFilters {
                collection: Some("handbook".into()),
                ..none()
            },
        )?,
        set(&["handbook/rollback", "handbook/legacy"]),
        "collection",
    )?;
    ensure_eq(
        with(
            "canary",
            IndexFilters {
                tags: vec!["platform".into(), "ops".into()],
                ..none()
            },
        )?,
        set(&["handbook/rollback", "handbook/staging"]),
        "tags: all of them",
    )?;
    ensure_eq(
        with(
            "release",
            IndexFilters {
                verified: vec!["human".into(), "owner".into()],
                ..none()
            },
        )?,
        set(&["handbook/rollback", "handbook/feature-flags"]),
        "verified: any of them",
    )?;
    ensure_eq(
        with(
            "staging",
            IndexFilters {
                sensitivity: Some("confidential".into()),
                ..none()
            },
        )?,
        set(&["handbook/staging"]),
        "sensitivity",
    )?;
    ensure_eq(
        with(
            "release",
            IndexFilters {
                status: Some("draft".into()),
                ..none()
            },
        )?,
        set(&["handbook/feature-flags"]),
        "status",
    )?;
    ensure_eq(
        with(
            "release",
            IndexFilters {
                doc_type: Some("guide".into()),
                ..none()
            },
        )?,
        set(&["handbook/canary", "handbook/feature-flags"]),
        "type",
    )?;
    ensure_eq(
        with(
            "release",
            IndexFilters {
                updated_after: Some("2026-01-01T00:00:00Z".into()),
                ..none()
            },
        )?,
        set(&["handbook/rollback", "handbook/feature-flags"]),
        "updated after",
    )?;
    // Filters apply before the limit: the only matching document comes back even at limit 1.
    let query = IndexQuery {
        limit: 1,
        filters: IndexFilters {
            status: Some("draft".into()),
            ..none()
        },
        ..ask("release OR canary OR rollback")
    };
    let hits = l.index.search(&query, &space).ctx("search")?;
    ensure_eq(
        hits.iter().map(|h| h.doc.as_str()).collect::<Vec<_>>(),
        vec!["handbook/feature-flags"],
        "a filter is applied before the limit",
    )?;
    expect_err(
        l.index.search(
            &IndexQuery {
                filters: IndexFilters {
                    updated_after: Some("yesterday".into()),
                    ..none()
                },
                ..ask("rollback")
            },
            &space,
        ),
        "a bad date filter",
        invalid,
    )?;
    pass()
}

fn ordering(env: &Env<'_>) -> CaseResult {
    // Three chunks with identical text, written in reverse order across two commits, tie on
    // score: they come back by document id.
    let text = "Identical words about migration planning";
    let fresh = env.fresh()?;
    let Some(index) = fresh.stores.index.clone() else {
        return skip("this backend has no search index");
    };
    commit(&*index, vec![chunk("tie/c", "Tie", text)], 1)?;
    commit(
        &*index,
        vec![chunk("tie/b", "Tie", text), chunk("tie/a", "Tie", text)],
        2,
    )?;
    commit(
        &*index,
        vec![chunk("other/x", "Other", "Something else entirely")],
        3,
    )?;
    let space = everyone();
    let docs = |query: &IndexQuery| -> Result<Vec<String>, String> {
        Ok(index
            .search(query, &space)
            .ctx("search")?
            .into_iter()
            .map(|h| h.doc)
            .collect())
    };
    ensure_eq(
        docs(&ask("migration"))?,
        vec!["tie/a".to_owned(), "tie/b".into(), "tie/c".into()],
        "ties order by document id",
    )?;
    let cut = IndexQuery {
        limit: 2,
        ..ask("migration")
    };
    ensure_eq(
        docs(&cut)?,
        vec!["tie/a".to_owned(), "tie/b".into()],
        "the cut-off among ties is by document id too",
    )?;
    for hit in index
        .search(&ask("migration planning"), &space)
        .ctx("search")?
    {
        let rounded = ((f64::from(hit.score) * 10_000.0).round() / 10_000.0) as f32;
        ensure(
            hit.score.to_bits() == rounded.to_bits(),
            "scores are rounded to four decimals",
        )?;
        ensure(hit.score > 0.0, "a match scores above zero")?;
    }
    pass()
}

fn atomic(env: &Env<'_>) -> CaseResult {
    let fresh = env.fresh()?;
    let Some(index) = fresh.stores.index.clone() else {
        return skip("this backend has no search index");
    };
    const N: usize = 50;
    let done = AtomicBool::new(false);
    let seen: Result<(), String> = std::thread::scope(|scope| {
        let reader_thread = scope.spawn(|| -> Result<(), String> {
            let space = everyone();
            loop {
                let finished = done.load(Ordering::SeqCst);
                let query = IndexQuery {
                    limit: 400,
                    ..ask("atomicword")
                };
                let count = index.search(&query, &space).ctx("search")?.len();
                ensure(
                    count == 0 || count == N,
                    &format!("a reader saw {count} of {N} chunks of one commit"),
                )?;
                if finished && count == N {
                    return Ok(());
                }
            }
        });
        let write = || -> Result<(), String> {
            let mut writer = index.writer().ctx("writer")?;
            for n in 0..N {
                let doc = format!("atomic/doc-{n:03}");
                writer
                    .replace(&doc, vec![chunk(&doc, "Atomic", "an atomicword here")])
                    .ctx("replace")?;
            }
            // Staged, not committed: nothing is visible yet.
            let before = index
                .search(&ask("atomicword"), &everyone())
                .ctx("search")?
                .len();
            ensure_eq(before, 0, "staged chunks are invisible")?;
            writer.commit(1).ctx("commit")
        };
        let written = write();
        done.store(true, Ordering::SeqCst);
        let read = reader_thread
            .join()
            .map_err(|_| "the reader thread panicked".to_owned())?;
        written?;
        read
    });
    seen?;
    pass()
}

fn applied(env: &Env<'_>) -> CaseResult {
    let fresh = env.fresh()?;
    let Some(index) = fresh.stores.index.clone() else {
        return skip("this backend has no search index");
    };
    ensure_eq(
        index.applied().ctx("applied")?,
        0,
        "an empty index reflects 0",
    )?;
    {
        let mut w = index.writer().ctx("writer")?;
        ensure_eq(w.applied().ctx("applied")?, 0, "the session's applied")?;
        w.replace(
            &"a/one".to_owned(),
            vec![chunk("a/one", "One", "first note")],
        )
        .ctx("replace")?;
        w.commit(5).ctx("commit")?;
    }
    ensure_eq(index.applied().ctx("applied")?, 5, "after commit(5)")?;
    {
        let mut w = index.writer().ctx("writer")?;
        ensure_eq(w.applied().ctx("applied")?, 5, "read under the writer")?;
        w.replace(
            &"a/two".to_owned(),
            vec![chunk("a/two", "Two", "second note")],
        )
        .ctx("replace")?;
        let refused = w.commit(4);
        expect_err(refused, "a lower revision", super::conflict)?;
        if let Err(StoreError::Conflict { current }) = w.commit(2) {
            ensure_eq(
                current,
                Some("5".to_owned()),
                "the conflict names the current revision",
            )?;
        }
        w.abort();
    }
    ensure_eq(
        index.applied().ctx("applied")?,
        5,
        "a refused commit moved nothing",
    )?;
    ensure(
        found(&*index, &everyone(), "second")?.is_empty(),
        "a refused commit published nothing",
    )?;
    {
        let mut w = index.writer().ctx("writer")?;
        w.replace(
            &"a/two".to_owned(),
            vec![chunk("a/two", "Two", "second note")],
        )
        .ctx("replace")?;
        w.commit(5).ctx("the same revision is allowed")?;
    }
    ensure(
        found(&*index, &everyone(), "second")?.contains("a/two"),
        "a commit at the same revision publishes",
    )?;
    {
        let mut w = index.writer().ctx("writer")?;
        w.commit(9).ctx("a higher revision")?;
    }
    ensure_eq(
        index.applied().ctx("applied")?,
        9,
        "an empty commit records its revision",
    )?;
    pass()
}

fn replace_and_clear(env: &Env<'_>) -> CaseResult {
    let fresh = env.fresh()?;
    let Some(index) = fresh.stores.index.clone() else {
        return skip("this backend has no search index");
    };
    let space = everyone();
    let numbered = |doc: &str, n: u32, body: &str| {
        let mut c = chunk(doc, "Doc", body);
        c.ordinal = n;
        c.heading_path = vec![format!("Heading {n}")];
        c.updated = Some("2026-02-03T04:05:06Z".into());
        c.meta = json!({"team": "infra"})
            .as_object()
            .cloned()
            .unwrap_or_default();
        c.aliases = vec!["alias".into()];
        c.description = Some("a description".into());
        c
    };
    let wrote = vec![
        numbered("d/one", 0, "alpha zero"),
        numbered("d/one", 1, "alpha one"),
        numbered("d/one", 2, "alpha two"),
    ];
    {
        let mut w = index.writer().ctx("writer")?;
        w.replace(&"d/one".to_owned(), wrote.clone())
            .ctx("replace")?;
        w.replace(&"d/two".to_owned(), vec![numbered("d/two", 0, "beta zero")])
            .ctx("replace")?;
        // Duplicate ordinals, and a chunk of another document, stage nothing.
        expect_err(
            w.replace(
                &"d/bad".to_owned(),
                vec![numbered("d/bad", 0, "x"), numbered("d/bad", 0, "y")],
            ),
            "two chunks with one ordinal",
            invalid,
        )?;
        expect_err(
            w.replace(&"d/bad".to_owned(), vec![numbered("d/other", 0, "x")]),
            "a chunk of another document",
            invalid,
        )?;
        w.commit(1).ctx("commit")?;
    }
    ensure_eq(
        index.chunks("d/one", &space).ctx("chunks")?,
        wrote,
        "chunks come back as written, by ordinal",
    )?;
    ensure(
        index.chunks("d/bad", &space).ctx("chunks")?.is_empty(),
        "a refused replace staged nothing",
    )?;
    {
        let mut w = index.writer().ctx("writer")?;
        w.replace(
            &"d/one".to_owned(),
            vec![numbered("d/one", 0, "gamma only")],
        )
        .ctx("replace")?;
        w.replace(&"d/two".to_owned(), Vec::new()).ctx("replace")?;
        w.commit(2).ctx("commit")?;
    }
    let one = index.chunks("d/one", &space).ctx("chunks")?;
    ensure_eq(
        one.len(),
        1,
        "a replace removes the chunks it does not list",
    )?;
    ensure_eq(one[0].body.as_str(), "gamma only", "and replaces the rest")?;
    ensure(
        index.chunks("d/two", &space).ctx("chunks")?.is_empty(),
        "an empty list removes the document",
    )?;
    ensure(
        found(&*index, &space, "alpha OR beta")?.is_empty(),
        "removed text is not searchable",
    )?;
    {
        let mut w = index.writer().ctx("writer")?;
        w.clear().ctx("clear")?;
        w.replace(&"d/three".to_owned(), vec![numbered("d/three", 0, "delta")])
            .ctx("replace")?;
        w.commit(3).ctx("commit")?;
    }
    ensure_eq(
        found(&*index, &space, "gamma OR delta")?,
        set(&["d/three"]),
        "a clear removes everything staged or committed before it, not what follows",
    )?;
    pass()
}

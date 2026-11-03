//! Group `memory_recall`: every query form with its hit set, `+a b`, stemming, field weights,
//! order and ties, hostile strings, scope and class filters, snippets and ranks (section 5.2).
//! The corpus holds filler records so that no term is common enough for BM25 to discount it.

use std::collections::BTreeSet;

use super::{ADA, BO, MemoryEnv, P_ADA, T0, ada, recall_ids, recall_query, write};
use crate::conformance::{CaseResult, Ctx, ensure, ensure_eq, invalid, pass, samples};
use crate::memory::{MemoryStore, MemoryWrite, ProjectMatch};
use crate::{Actor, ActorKind, Authority, MemoryClass, MemoryQuery, StoreError};

/// One change to a recall query.
type QueryEdit = dyn Fn(&mut crate::memory::RecallQuery);

pub(super) const CASES: &[(&str, super::MemoryCaseFn)] = &[
    ("every_query_form_returns_its_hit_set", forms),
    ("a_required_term_beside_a_plain_one", plus_a_b),
    ("stemming_matches_inflections", stemming),
    ("subject_outweighs_tags_outweighs_text", field_weights),
    ("ties_order_by_recorded_then_id", ties),
    ("hostile_strings_are_text_or_invalid", hostile),
    ("scope_class_tag_and_authority_filters", filters),
    ("hits_carry_ranks_and_snippets", ranks_and_snippets),
];

const NOW: crate::memory::Millis = T0 + 60_000;

struct Doc {
    n: u64,
    owner: &'static str,
    access: &'static str,
    subject: &'static str,
    text: &'static str,
    tags: &'static [&'static str],
    project: Option<&'static str>,
    class: MemoryClass,
    authority: Authority,
}

const DOCS: &[Doc] = &[
    Doc {
        n: 1,
        owner: ADA,
        access: P_ADA,
        subject: "Rollbacks in staging",
        text: "Rollbacks go through the canary flag",
        tags: &["deploy"],
        project: Some("afd"),
        class: MemoryClass::Semantic,
        authority: Authority::Agent,
    },
    Doc {
        n: 2,
        owner: BO,
        access: "space",
        subject: "Canary releases",
        text: "The watcher tracks error rates",
        tags: &["release"],
        project: None,
        class: MemoryClass::Semantic,
        authority: Authority::Person,
    },
    Doc {
        n: 3,
        owner: ADA,
        access: P_ADA,
        subject: "Database backups",
        text: "Nightly backups run at two",
        tags: &["ops"],
        project: Some("other"),
        class: MemoryClass::Semantic,
        authority: Authority::Agent,
    },
    Doc {
        n: 4,
        owner: ADA,
        access: P_ADA,
        subject: "Rolling restarts",
        text: "Restart pods one by one with a rollback plan",
        tags: &["deploy"],
        project: Some("afd"),
        class: MemoryClass::Procedural,
        authority: Authority::Agent,
    },
];

const FILLER: &[&str] = &[
    "alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet",
    "kilo", "lima",
];

fn entry(doc: &Doc) -> MemoryWrite {
    let mut e = samples::memory_entry(doc.n, doc.owner, &[doc.access], doc.subject, doc.text);
    e.tags = doc.tags.iter().map(|t| (*t).to_owned()).collect();
    e.scope.project = doc.project.map(str::to_owned);
    e.class = doc.class;
    samples::set_authority(&mut e, doc.authority);
    if doc.n == 1 {
        e.scope.session = Some("s-1".into());
        e.scope.agent = Some(Actor {
            kind: ActorKind::Agent,
            id: Some("ada-agent".into()),
            label: None,
            on_behalf_of: Some(ADA.into()),
        });
    }
    samples::agree(&mut e);
    e
}

/// Write the four documents and the filler.
fn corpus(m: &dyn MemoryStore) -> Result<(), String> {
    for doc in DOCS {
        write(m, T0, vec![entry(doc)])?;
    }
    let filler = (50..)
        .zip(FILLER)
        .map(|(n, word)| {
            samples::memory_entry(
                n,
                ADA,
                &[P_ADA],
                &format!("Filler note {word}"),
                &format!("{word} lorem ipsum dolor"),
            )
        })
        .collect();
    write(m, T0, filler).map(|_| ())
}

fn set(m: &dyn MemoryStore, text: &str) -> Result<BTreeSet<String>, String> {
    Ok(recall_ids(m, &recall_query(text, NOW)?, &ada())
        .map_err(|e| format!("`{text}`: {e}"))?
        .into_iter()
        .collect())
}

fn ids(ns: &[u64]) -> BTreeSet<String> {
    ns.iter().map(|n| samples::memory_id(*n)).collect()
}

fn forms(env: &MemoryEnv<'_>) -> CaseResult {
    let f = env.fresh()?;
    let m = &*f.memory;
    corpus(m)?;
    let cases: [(&str, &[u64]); 11] = [
        ("canary", &[1, 2]),
        ("\"canary flag\"", &[1]),
        ("roll*", &[1, 4]),
        ("canary -flag", &[2]),
        ("subject:canary", &[2]),
        ("body:canary", &[1]),
        ("tags:deploy", &[1, 4]),
        ("backups OR nothing", &[3]),
        ("+canary +flag", &[1]),
        ("+subject:canary body:tracks", &[2]),
        ("canary backups", &[1, 2, 3]),
    ];
    for (query, want) in cases {
        ensure_eq(set(m, query)?, ids(want), query)?;
    }
    pass()
}

fn plus_a_b(env: &MemoryEnv<'_>) -> CaseResult {
    let f = env.fresh()?;
    let m = &*f.memory;
    corpus(m)?;
    let hits = recall_ids(m, &recall_query("+canary rollbacks", NOW)?, &ada())?;
    ensure_eq(
        hits,
        vec![samples::memory_id(1), samples::memory_id(2)],
        "only rows with canary; the one with rollbacks first",
    )?;
    let hits = recall_ids(m, &recall_query("rollbacks +canary", NOW)?, &ada())?;
    ensure_eq(hits.len(), 2, "the order of terms does not matter")?;
    pass()
}

fn stemming(env: &MemoryEnv<'_>) -> CaseResult {
    let f = env.fresh()?;
    let m = &*f.memory;
    corpus(m)?;
    ensure_eq(
        set(m, "rollback")?,
        ids(&[1, 4]),
        "rollback finds rollbacks",
    )?;
    ensure_eq(
        set(m, "rollbacks")?,
        ids(&[1, 4]),
        "rollbacks finds rollback",
    )?;
    ensure_eq(set(m, "restarts")?, ids(&[4]), "restarts finds restart")?;
    pass()
}

fn field_weights(env: &MemoryEnv<'_>) -> CaseResult {
    let f = env.fresh()?;
    let m = &*f.memory;
    corpus(m)?;
    let mut in_subject =
        samples::memory_entry(20, ADA, &[P_ADA], "zebra yak", "quill vortex wombat");
    let mut in_tags = samples::memory_entry(21, ADA, &[P_ADA], "quill yak", "vortex wombat");
    in_tags.tags = vec!["zebra".into()];
    let mut in_text = samples::memory_entry(22, ADA, &[P_ADA], "quill yak", "zebra vortex wombat");
    for e in [&mut in_subject, &mut in_tags, &mut in_text] {
        samples::agree(e);
    }
    write(m, T0, vec![in_subject, in_tags, in_text])?;
    let hits = recall_ids(m, &recall_query("zebra", NOW)?, &ada())?;
    ensure_eq(
        hits,
        vec![
            samples::memory_id(20),
            samples::memory_id(21),
            samples::memory_id(22),
        ],
        "subject, then tags, then text",
    )?;
    pass()
}

fn ties(env: &MemoryEnv<'_>) -> CaseResult {
    let f = env.fresh()?;
    let m = &*f.memory;
    corpus(m)?;
    let tied = |n: u64, project: &str| {
        let mut e = samples::memory_entry(n, ADA, &[P_ADA], "Tied entry", "kumquat orchard");
        e.scope.project = Some(project.into());
        samples::agree(&mut e);
        e
    };
    write(m, T0, vec![tied(31, "p31"), tied(30, "p30")])?;
    write(m, T0 + 5000, vec![tied(32, "p32")])?;
    let hits = recall_ids(m, &recall_query("kumquat", NOW)?, &ada())?;
    ensure_eq(
        hits,
        vec![
            samples::memory_id(32),
            samples::memory_id(30),
            samples::memory_id(31),
        ],
        "equal scores: newest recorded first, then id",
    )?;
    pass()
}

fn hostile(env: &MemoryEnv<'_>) -> CaseResult {
    let f = env.fresh()?;
    let m = &*f.memory;
    corpus(m)?;
    let strings = [
        "\"",
        "*",
        "NEAR(",
        "col:",
        "NEAR(canary flag)",
        "canary:",
        "\"unterminated",
        "a*b",
        "-",
        "+",
        "(",
        ")",
        "AND",
        "subject:",
        "^canary",
        "canary NOT flag",
        "'",
        "canary*:",
        "{x}",
        "\"\"",
        "\"a\"\"b\"",
        "subject:\"",
        "x\"y",
        "rank:1",
        "OR canary",
    ];
    for text in strings {
        match MemoryQuery::parse(text) {
            Err(StoreError::Invalid(_)) => {}
            Err(other) => return Err(format!("`{text}`: parse answered {other}")),
            Ok(query) => {
                let mut q = recall_query("canary", NOW)?;
                q.query = query;
                m.recall(&q, &ada())
                    .map_err(|e| format!("`{text}` parsed, then recall failed: {e}"))?;
            }
        }
    }
    pass()
}

fn filters(env: &MemoryEnv<'_>) -> CaseResult {
    let f = env.fresh()?;
    let m = &*f.memory;
    corpus(m)?;
    let base = recall_query("canary rollback", NOW)?;
    let run = |edit: &dyn Fn(&mut crate::memory::RecallQuery)| -> Result<BTreeSet<String>, String> {
        let mut q = base.clone();
        edit(&mut q);
        Ok(recall_ids(m, &q, &ada())?.into_iter().collect())
    };
    ensure_eq(run(&|_| {})?, ids(&[1, 2, 4]), "no filter")?;
    let cases: [(&str, &QueryEdit, &[u64]); 9] = [
        (
            "Exact",
            &|q| q.scope.project = ProjectMatch::Exact("afd".into()),
            &[1, 4],
        ),
        (
            "ExactOrUnset",
            &|q| q.scope.project = ProjectMatch::ExactOrUnset("afd".into()),
            &[1, 2, 4],
        ),
        (
            "Exact other",
            &|q| q.scope.project = ProjectMatch::Exact("other".into()),
            &[],
        ),
        (
            "classes",
            &|q| q.classes = vec![MemoryClass::Procedural],
            &[4],
        ),
        (
            "authorities",
            &|q| q.authorities = vec![Authority::Person],
            &[2],
        ),
        ("tags", &|q| q.tags = vec!["deploy".into()], &[1, 4]),
        ("principal", &|q| q.scope.principal = Some(BO.into()), &[2]),
        ("session", &|q| q.scope.session = Some("s-1".into()), &[1]),
        ("agent", &|q| q.scope.agent = Some("ada-agent".into()), &[1]),
    ];
    for (what, edit, want) in cases {
        ensure_eq(run(edit)?, ids(want), what)?;
    }
    let outsider = crate::conformance::reader(&["space"]);
    let got: BTreeSet<_> = recall_ids(m, &base, &outsider)?.into_iter().collect();
    ensure_eq(got, ids(&[2]), "the reader filter")?;
    pass()
}

fn ranks_and_snippets(env: &MemoryEnv<'_>) -> CaseResult {
    let f = env.fresh()?;
    let m = &*f.memory;
    corpus(m)?;
    let page = m
        .recall(&recall_query("canary rollback", NOW)?, &ada())
        .ctx("recall")?;
    let ranks: Vec<u32> = page.hits.iter().map(|h| h.rank).collect();
    ensure_eq(ranks, vec![1, 2, 3], "ranks from 1")?;
    let first = page
        .hits
        .iter()
        .find(|h| h.record.id == samples::memory_id(1))
        .ok_or("the canary record")?;
    ensure(
        first.snippet.contains("**canary**"),
        "the snippet marks the match",
    )?;
    ensure_eq(
        first.record.text.as_str(),
        DOCS[0].text,
        "the hit carries its record",
    )?;
    let mut one = recall_query("canary", NOW)?;
    one.limit = 1;
    ensure_eq(
        m.recall(&one, &ada()).ctx("recall")?.hits.len(),
        1,
        "limit 1",
    )?;
    for bad in [0, 201] {
        one.limit = bad;
        crate::conformance::expect_err(m.recall(&one, &ada()), "a bad limit", invalid)?;
    }
    pass()
}

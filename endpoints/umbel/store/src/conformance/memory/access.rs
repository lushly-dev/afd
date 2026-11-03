//! Group `memory_access`: three readers over the 40-record fixture. No unreadable id, subject,
//! tag or change comes back from any read; an unreadable record answers as an absent or
//! forgotten one; derivation is refused; idempotency is the owner's; `left_out` counts only what
//! the reader can read; and an absent store answers `NotProvisioned` and creates nothing.

use std::collections::{BTreeMap, BTreeSet};

use super::fixture::{self, Fixture, NOW};
use super::{
    ADA, BO, MemoryEnv, P_ADA, T0, ada, get_at, list_ids, list_query, not_found, recall_ids,
    recall_query, write,
};
use crate::conformance::{
    CaseResult, Ctx, ensure, ensure_eq, expect_err, invalid, pass, reader, samples,
};
use crate::memory::{
    AsOf, Confirm, DAY_MS, EntryState, Forget, ForgetSelector, Invalidate, InvalidationReason,
    LeftOutCounts, MemoryStore, ProjectMatch, PushFilter, ReadFlags, ScopeQuery,
};
use crate::{Authority, MemoryClass, ReaderFilter, StoreError};

pub(super) const CASES: &[(&str, super::MemoryCaseFn)] = &[
    ("every_read_returns_only_readable_records", per_reader),
    (
        "an_unreadable_record_answers_as_an_absent_one",
        indistinguishable,
    ),
    ("a_derivation_read_is_refused", derivation),
    ("an_idempotency_key_is_the_owners", idempotency),
    ("left_out_counts_only_what_the_reader_reads", left_out),
    ("list_and_recall_apply_the_push_rule", push_rule),
    (
        "an_absent_store_is_not_provisioned_and_stays_absent",
        not_provisioned,
    ),
];

struct Setup {
    fresh: super::MemoryFresh,
    fixture: Fixture,
}

fn setup(env: &MemoryEnv<'_>) -> Result<Setup, String> {
    let fresh = env.fresh()?;
    let fixture = fixture::load()?;
    fixture::populate(&*fresh.memory, &fixture)?;
    Ok(Setup { fresh, fixture })
}

fn readers(fixture: &Fixture) -> Result<Vec<(String, Vec<String>, ReaderFilter)>, String> {
    fixture
        .readers
        .iter()
        .map(|(name, tokens)| {
            ReaderFilter::tokens(tokens.iter().cloned())
                .ctx("a reader")
                .map(|r| (name.clone(), tokens.clone(), r))
        })
        .collect()
}

fn per_reader(env: &MemoryEnv<'_>) -> CaseResult {
    let s = setup(env)?;
    let m = &*s.fresh.memory;
    for (name, tokens, r) in readers(&s.fixture)? {
        let mut readable: Vec<_> = s
            .fixture
            .records
            .iter()
            .filter(|x| x.readable(&tokens))
            .collect();
        readable.sort_by(|a, b| b.n.cmp(&a.n));
        let want: Vec<String> = readable.iter().map(|x| x.id()).collect();
        let what = |w: &str| format!("{name}: {w}");
        ensure_eq(
            list_ids(m, &list_query(NOW), &r)?,
            want.clone(),
            &what("list, newest first"),
        )?;
        let mut paged = list_query(NOW);
        paged.limit = 3;
        ensure_eq(
            list_ids(m, &paged, &r)?,
            want.clone(),
            &what("list in pages of 3"),
        )?;
        let page = m.list(&list_query(NOW), &r).ctx("list")?;
        for item in &page.items {
            let source = s
                .fixture
                .records
                .iter()
                .find(|x| x.id() == item.id)
                .ok_or("an id")?;
            ensure_eq(
                item.subject.as_str(),
                source.subject.as_str(),
                &what("subject"),
            )?;
            ensure_eq(item.tags.clone(), source.tags.clone(), &what("tags"))?;
        }
        for x in &s.fixture.records {
            let got = get_at(m, &x.id(), NOW, &r)?;
            ensure_eq(
                got.is_some(),
                x.readable(&tokens),
                &what(&format!("get {}", x.id())),
            )?;
            let history = m.history(&x.id(), &r).ctx("history")?;
            ensure_eq(!history.is_empty(), x.readable(&tokens), &what("history"))?;
            let unique = x.subject.rsplit(' ').next().unwrap_or_default();
            let hits = recall_ids(m, &recall_query(unique, NOW)?, &r)?;
            let expected: Vec<String> = if x.readable(&tokens) {
                vec![x.id()]
            } else {
                vec![]
            };
            ensure_eq(hits, expected, &what(&format!("recall of {unique}")))?;
        }
        let hits: BTreeSet<_> = recall_ids(m, &recall_query("fixture", NOW)?, &r)?
            .into_iter()
            .collect();
        ensure_eq(
            hits,
            want.iter().cloned().collect(),
            &what("recall of a shared term"),
        )?;
        let changes = m.changes(0, 1000, &r, None).ctx("changes")?;
        let ids: BTreeSet<_> = changes.iter().map(|c| c.id.clone()).collect();
        ensure_eq(ids, want.iter().cloned().collect(), &what("changes"))?;
        let counts = m.counts(NOW, 14 * DAY_MS, &r).ctx("counts")?;
        ensure_eq(counts.total(), want.len() as u64, &what("counts"))?;
        let flagged = readable.iter().filter(|x| x.flagged()).count() as u64;
        let counted: u64 = counts.by_class.values().map(|c| c.flagged).sum();
        ensure_eq(counted, flagged, &what("flagged counts"))?;
    }
    pass()
}

fn indistinguishable(env: &MemoryEnv<'_>) -> CaseResult {
    let s = setup(env)?;
    let m = &*s.fresh.memory;
    let outsider = reader(&["space"]);
    let private = s
        .fixture
        .records
        .iter()
        .find(|x| x.access == [P_ADA])
        .ok_or("a private record")?;
    let absent = samples::memory_id(999);
    m.forget(Forget {
        owner: ADA.into(),
        selector: ForgetSelector::Ids(vec![samples::memory_id(7)]),
        at: NOW,
        trace_id: None,
    })
    .ctx("forget")?;
    let forgotten = samples::memory_id(7);
    for (id, r, what) in [
        (private.id(), &outsider, "unreadable"),
        (absent.clone(), &ada(), "absent"),
        (forgotten.clone(), &ada(), "forgotten"),
    ] {
        ensure_eq(
            get_at(m, &id, NOW, r)?,
            None,
            &format!("get of an {what} record"),
        )?;
        ensure(
            m.history(&id, r).ctx("history")?.is_empty(),
            &format!("history: {what}"),
        )?;
        expect_err(
            m.invalidate(
                Invalidate {
                    id: id.clone(),
                    at: NOW,
                    valid_until: NOW,
                    by: ADA.into(),
                    reason: InvalidationReason::Wrong,
                    note: None,
                    expect_version: None,
                    trace_id: None,
                },
                r,
            ),
            &format!("invalidate: {what}"),
            not_found,
        )?;
        expect_err(
            m.confirm(
                Confirm {
                    id: id.clone(),
                    at: NOW,
                    by: ADA.into(),
                    content_hash: "0".repeat(16),
                    trace_id: None,
                },
                r,
            ),
            &format!("confirm: {what}"),
            not_found,
        )?;
    }
    pass()
}

fn derivation(env: &MemoryEnv<'_>) -> CaseResult {
    let s = setup(env)?;
    let m = &*s.fresh.memory;
    let d = ReaderFilter::derivation();
    let id = samples::memory_id(3);
    let push = PushFilter {
        caller: ADA.into(),
        own: vec![Authority::Person],
        foreign: vec![Authority::Person],
        unset_project: vec![Authority::Person],
    };
    expect_err(
        m.get(&id, AsOf::at(NOW), ReadFlags::at(NOW), &d),
        "get",
        invalid,
    )?;
    expect_err(m.history(&id, &d), "history", invalid)?;
    expect_err(m.list(&list_query(NOW), &d), "list", invalid)?;
    expect_err(
        m.recall(&recall_query("fixture", NOW)?, &d),
        "recall",
        invalid,
    )?;
    expect_err(
        m.left_out(&ScopeQuery::default(), &[], &push, AsOf::at(NOW), NOW, &d),
        "left_out",
        invalid,
    )?;
    expect_err(m.changes(0, 10, &d, None), "changes", invalid)?;
    expect_err(m.counts(NOW, DAY_MS, &d), "counts", invalid)?;
    pass()
}

fn idempotency(env: &MemoryEnv<'_>) -> CaseResult {
    let f = env.fresh()?;
    let m = &*f.memory;
    let keyed = |n, owner: &str, token: &str, authority| {
        let mut e = samples::memory_entry(n, owner, &[token], "Keyed", &format!("keyed {n}"));
        samples::set_authority(&mut e, authority);
        let mut batch = samples::memory_batch(T0, vec![e]);
        batch.idempotency = Some("k".into());
        m.write(batch).ctx("write")
    };
    let first = keyed(1, ADA, P_ADA, Authority::Agent)?;
    ensure_eq(first.entries[0].state, EntryState::Created, "ada's first")?;
    let other = keyed(2, BO, super::P_BO, Authority::Agent)?;
    ensure(!other.replayed, "bo's key is bo's own")?;
    ensure_eq(
        other.entries[0].id.clone(),
        samples::memory_id(2),
        "bo's record",
    )?;
    let person = keyed(3, ADA, P_ADA, Authority::Person)?;
    ensure(!person.replayed, "the key is scoped by authority")?;
    let again = keyed(4, ADA, P_ADA, Authority::Agent)?;
    ensure(again.replayed, "ada's key replays")?;
    ensure_eq(
        again.entries.clone(),
        first.entries.clone(),
        "ada's receipt",
    )?;
    ensure(
        get_at(m, &samples::memory_id(4), T0, &ada())?.is_none(),
        "no record",
    )?;
    pass()
}

fn push() -> PushFilter {
    PushFilter {
        caller: ADA.into(),
        own: vec![Authority::Person, Authority::Transcript],
        foreign: vec![Authority::Person],
        unset_project: vec![Authority::Person],
    }
}

fn left_out(env: &MemoryEnv<'_>) -> CaseResult {
    let s = setup(env)?;
    let m = &*s.fresh.memory;
    let push = push();
    for project in [ProjectMatch::Any, ProjectMatch::ExactOrUnset("afd".into())] {
        let scope = ScopeQuery {
            project: project.clone(),
            ..ScopeQuery::default()
        };
        for (name, tokens, r) in readers(&s.fixture)? {
            let mut want: BTreeMap<MemoryClass, LeftOutCounts> = MemoryClass::ALL
                .into_iter()
                .map(|c| (c, LeftOutCounts::default()))
                .collect();
            for x in s.fixture.records.iter().filter(|x| x.readable(&tokens)) {
                if !project.admits(x.project.as_deref()) {
                    continue;
                }
                let entry = want.entry(x.class()).or_default();
                if x.flagged() {
                    entry.flagged += 1;
                } else if !x.pushed(&push, &project) {
                    entry.authority += 1;
                }
            }
            let got = m
                .left_out(&scope, &MemoryClass::ALL, &push, AsOf::at(NOW), NOW, &r)
                .ctx("left_out")?;
            for class in MemoryClass::ALL {
                ensure_eq(
                    got.by_class.get(&class).copied().unwrap_or_default(),
                    want[&class],
                    &format!("{name}, {project:?}, {}", class.as_str()),
                )?;
            }
        }
    }
    pass()
}

fn push_rule(env: &MemoryEnv<'_>) -> CaseResult {
    let s = setup(env)?;
    let m = &*s.fresh.memory;
    let push = push();
    for project in [ProjectMatch::Any, ProjectMatch::ExactOrUnset("afd".into())] {
        for (name, tokens, r) in readers(&s.fixture)? {
            let mut want: Vec<_> = s
                .fixture
                .records
                .iter()
                .filter(|x| x.readable(&tokens) && project.admits(x.project.as_deref()))
                .filter(|x| x.pushed(&push, &project))
                .collect();
            want.sort_by(|a, b| b.n.cmp(&a.n));
            let want: Vec<String> = want.iter().map(|x| x.id()).collect();
            let mut query = list_query(NOW);
            query.scope.project = project.clone();
            query.push = Some(push.clone());
            query.flags.include_flagged = false;
            ensure_eq(
                list_ids(m, &query, &r)?,
                want.clone(),
                &format!("{name}: list"),
            )?;
            let mut recall = recall_query("fixture", NOW)?;
            recall.scope.project = project.clone();
            recall.push = Some(push.clone());
            recall.flags.include_flagged = true;
            let got: BTreeSet<_> = recall_ids(m, &recall, &r)?.into_iter().collect();
            ensure_eq(
                got,
                want.into_iter().collect(),
                &format!("{name}: recall, never flagged"),
            )?;
        }
    }
    pass()
}

fn not_provisioned(env: &MemoryEnv<'_>) -> CaseResult {
    let f = env.fresh()?;
    let m: &dyn MemoryStore = &*f.memory;
    let listing = |dir: &std::path::Path| -> Result<BTreeSet<String>, String> {
        let mut out = BTreeSet::new();
        for entry in walk(dir)? {
            out.insert(entry);
        }
        Ok(out)
    };
    let before = listing(f.dir.path())?;
    let np = |e: &StoreError| matches!(e, StoreError::NotProvisioned);
    let id = samples::memory_id(1);
    let r = ada();
    expect_err(m.get(&id, AsOf::at(T0), ReadFlags::at(T0), &r), "get", np)?;
    expect_err(m.history(&id, &r), "history", np)?;
    expect_err(m.list(&list_query(T0), &r), "list", np)?;
    expect_err(m.recall(&recall_query("anything", T0)?, &r), "recall", np)?;
    expect_err(
        m.left_out(&ScopeQuery::default(), &[], &push(), AsOf::at(T0), T0, &r),
        "left_out",
        np,
    )?;
    expect_err(m.changes(0, 10, &r, None), "changes", np)?;
    expect_err(m.head(), "head", np)?;
    expect_err(m.counts(T0, DAY_MS, &r), "counts", np)?;
    expect_err(m.usage(ADA, None, T0), "usage", np)?;
    expect_err(m.key_status(), "key_status", np)?;
    ensure_eq(listing(f.dir.path())?, before, "a read creates no file")?;
    write(m, T0, vec![super::write::note(1, "provisioned")])?;
    ensure_eq(m.head().ctx("head")?, 1, "a write provisions")?;
    pass()
}

/// Every path under `dir`, relative.
fn walk(dir: &std::path::Path) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_owned()];
    while let Some(next) = stack.pop() {
        for entry in std::fs::read_dir(&next).map_err(|e| format!("listing: {e}"))? {
            let path = entry.map_err(|e| format!("listing: {e}"))?.path();
            out.push(
                path.strip_prefix(dir)
                    .unwrap_or(&path)
                    .display()
                    .to_string(),
            );
            if path.is_dir() {
                stack.push(path);
            }
        }
    }
    Ok(out)
}

//! Group `memory_erasure`: after a forget every read is empty, the record's changes hold no
//! text, a second forget answers `not_found`, the idempotency key replays without recreating,
//! only the owner's records go, and a `backup` copy made before the forget cannot be read once
//! restored, while a record not forgotten still reads from it (sections 5.4, 5.5 and 7.2).

use super::write::note;
use super::{
    ADA, BO, MemoryEnv, P_ADA, P_BO, T0, ada, all_flags, bo, get_at, list_ids, list_query,
    recall_ids, recall_query, write,
};
use crate::conformance::{CaseResult, Ctx, SPACE, ensure, ensure_eq, pass, samples, skip};
use crate::memory::{
    AsOf, DAY_MS, Forget, ForgetReceipt, ForgetSelector, MemoryChangeKind, MemoryStore,
    MemoryWrite, Millis, ProjectMatch, PushFilter, ScopeQuery,
};
use crate::{Authority, Source};

pub(super) const CASES: &[(&str, super::MemoryCaseFn)] = &[
    ("a_forget_leaves_nothing_readable", forget_reads),
    ("a_forget_takes_only_the_owners_records", owners_only),
    ("a_backup_from_before_a_forget_cannot_be_read", backup_copy),
];

const NOW: Millis = T0 + DAY_MS;
const CANARY: &str = "zqxcanary";

/// A record holding the canary in its subject, text, tag, constraint and source.
fn canary(n: u64) -> MemoryWrite {
    let mut e = samples::memory_entry(
        n,
        ADA,
        &[P_ADA],
        &format!("{CANARY}subject{n}"),
        &format!("the {CANARY}text{n} body"),
    );
    e.tags = vec![format!("{CANARY}tag{n}")];
    e.envelope.constraints = Some(vec![format!("{CANARY}constraint{n}")]);
    e.envelope.sources = Some(vec![Source {
        resource: format!("{CANARY}source{n}"),
        id: None,
        title: None,
        author: None,
        last_modified: None,
    }]);
    e
}

fn forget(
    m: &dyn MemoryStore,
    owner: &str,
    selector: ForgetSelector,
) -> Result<ForgetReceipt, String> {
    m.forget(Forget {
        owner: owner.to_owned(),
        selector,
        at: NOW,
        trace_id: Some("t-forget".into()),
    })
    .ctx("forget")
}

fn forget_reads(env: &MemoryEnv<'_>) -> CaseResult {
    let f = env.fresh()?;
    let m = &*f.memory;
    let (gone, kept) = (samples::memory_id(1), samples::memory_id(2));
    let mut batch = samples::memory_batch(T0, vec![canary(1)]);
    batch.idempotency = Some("k-gone".into());
    m.write(batch.clone()).ctx("write")?;
    write(m, T0, vec![note(2, "kept")])?;
    let receipt = forget(m, ADA, ForgetSelector::Ids(vec![gone.clone()]))?;
    ensure_eq(
        (
            receipt.erased,
            receipt.ids.clone(),
            receipt.not_found.clone(),
        ),
        (1, vec![gone.clone()], Vec::new()),
        "the receipt",
    )?;
    ensure_eq(get_at(m, &gone, NOW, &ada())?, None, "get")?;
    ensure(
        m.history(&gone, &ada()).ctx("history")?.is_empty(),
        "history",
    )?;
    let mut list = list_query(NOW);
    list.flags.include_expired = true;
    ensure_eq(list_ids(m, &list, &ada())?, vec![kept.clone()], "list")?;
    for term in [
        format!("{CANARY}subject1"),
        format!("{CANARY}text1"),
        format!("{CANARY}tag1"),
        format!("{CANARY}*"),
    ] {
        ensure(
            recall_ids(m, &recall_query(&term, NOW)?, &ada())?.is_empty(),
            &term,
        )?;
    }
    ensure_eq(
        m.counts(NOW, DAY_MS, &ada()).ctx("counts")?.total(),
        1,
        "counts",
    )?;
    let push = PushFilter {
        caller: ADA.into(),
        own: vec![Authority::Person],
        foreign: vec![Authority::Person],
        unset_project: vec![Authority::Person],
    };
    let left = m
        .left_out(
            &ScopeQuery::default(),
            &[],
            &push,
            AsOf::at(NOW),
            NOW,
            &ada(),
        )
        .ctx("left_out")?;
    let counted: u64 = left
        .by_class
        .values()
        .map(|c| c.authority + c.flagged)
        .sum();
    ensure_eq(counted, 1, "left_out counts only the kept record")?;
    let changes = m.changes(0, 1000, &ada(), None).ctx("changes")?;
    let kinds: Vec<_> = changes
        .iter()
        .filter(|c| c.id == gone)
        .map(|c| c.kind)
        .collect();
    ensure_eq(
        kinds,
        vec![MemoryChangeKind::Created, MemoryChangeKind::Erased],
        "its changes",
    )?;
    ensure(
        !format!("{changes:?}").contains(CANARY),
        "no change holds its text",
    )?;
    let again = forget(m, ADA, ForgetSelector::Ids(vec![gone.clone()]))?;
    ensure_eq(
        (again.erased, again.not_found.clone()),
        (0, vec![gone.clone()]),
        "a second forget finds nothing, without an error",
    )?;
    let head = m.head().ctx("head")?;
    batch.at = NOW;
    let replay = m.write(batch).ctx("replay")?;
    ensure(replay.replayed, "the idempotency key still replays")?;
    ensure_eq(m.head().ctx("head")?, head, "and writes nothing")?;
    ensure_eq(
        get_at(m, &gone, NOW, &ada())?,
        None,
        "the record is not recreated",
    )?;
    pass()
}

fn owners_only(env: &MemoryEnv<'_>) -> CaseResult {
    let f = env.fresh()?;
    let m = &*f.memory;
    let labelled = |n: u64, owner: &str, token: &str, session: &str, project: &str| {
        let mut e = samples::memory_entry(
            n,
            owner,
            &[token],
            &format!("Label {n}"),
            &format!("labelled {n}"),
        );
        e.scope.session = Some(session.into());
        e.scope.project = Some(project.into());
        samples::agree(&mut e);
        e
    };
    write(
        m,
        T0,
        vec![
            labelled(1, ADA, P_ADA, "s1", "p1"),
            labelled(2, ADA, P_ADA, "s2", "p2"),
        ],
    )?;
    write(m, T0 + 10, vec![labelled(3, ADA, P_ADA, "s3", "p3")])?;
    write(
        m,
        T0,
        vec![
            labelled(4, BO, P_BO, "s1", "p1"),
            labelled(5, BO, P_BO, "s1", "p3"),
        ],
    )?;
    let r = forget(
        m,
        ADA,
        ForgetSelector::Ids(vec![samples::memory_id(4), samples::memory_id(9)]),
    )?;
    ensure_eq(
        (r.erased, r.not_found.len()),
        (0, 2),
        "another's id and an absent one",
    )?;
    let r = forget(m, ADA, ForgetSelector::Session("s1".into()))?;
    ensure_eq(
        r.ids.clone(),
        vec![samples::memory_id(1)],
        "by session, ada's only",
    )?;
    let r = forget(m, ADA, ForgetSelector::Project("p3".into()))?;
    ensure_eq(
        r.ids.clone(),
        vec![samples::memory_id(3)],
        "by project, ada's only",
    )?;
    let r = forget(m, ADA, ForgetSelector::Before(T0 + 1))?;
    ensure_eq(
        r.ids.clone(),
        vec![samples::memory_id(2)],
        "by before, ada's only",
    )?;
    for n in [4, 5] {
        ensure(
            get_at(m, &samples::memory_id(n), NOW, &bo())?.is_some(),
            "bo's records stay",
        )?;
    }
    let mut q = list_query(NOW);
    q.scope.project = ProjectMatch::Any;
    ensure(list_ids(m, &q, &ada())?.is_empty(), "ada has nothing left")?;
    pass()
}

fn backup_copy(env: &MemoryEnv<'_>) -> CaseResult {
    let Some(restore) = env.restore else {
        return skip("the backend supplied no memory_restore");
    };
    let f = env.fresh()?;
    let (gone, kept) = (samples::memory_id(1), samples::memory_id(2));
    write(&*f.memory, T0, vec![canary(1)])?;
    write(&*f.memory, T0, vec![note(2, "kept through the restore")])?;
    let copy = tempfile::tempdir().map_err(|e| format!("a temporary directory: {e}"))?;
    f.memory.backup(copy.path()).ctx("backup")?;
    let receipt = forget(&*f.memory, ADA, ForgetSelector::Ids(vec![gone.clone()]))?;
    ensure_eq(receipt.erased, 1, "forgotten")?;
    let dir = f.dir.path().to_owned();
    let super::MemoryFresh { dir: guard, memory } = f;
    drop(memory);
    restore(&dir, SPACE, copy.path()).map_err(|e| format!("restoring the copy: {e}"))?;
    let m = env.reopen(&dir)?;
    ensure_eq(
        get_at(&*m, &gone, NOW, &ada())?,
        None,
        "the forgotten record does not open",
    )?;
    ensure(
        m.history(&gone, &ada()).ctx("history")?.is_empty(),
        "nor its history",
    )?;
    ensure(
        recall_ids(&*m, &recall_query(&format!("{CANARY}text1"), NOW)?, &ada())?.is_empty(),
        "nor its text by recall",
    )?;
    let record = m
        .get(&kept, AsOf::at(NOW), all_flags(NOW), &ada())
        .ctx("get")?
        .ok_or("the kept record reads from the copy")?;
    ensure_eq(record.text.as_str(), "kept through the restore", "its text")?;
    drop(guard);
    pass()
}

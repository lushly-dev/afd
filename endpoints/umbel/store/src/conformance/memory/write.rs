//! Group `memory_write`: create, observe, replay, erased prefixes, atomic batches, envelope
//! refusals, size caps, supersede, and no update path (section 5.2).

use super::{ADA, BO, MemoryEnv, P_ADA, T0, ada, bo, get_at, refused, refused_write, write};
use crate::conformance::{CaseResult, Ctx, ensure, ensure_eq, expect_err, pass, samples};
use crate::memory::{
    DAY_MS, EntryState, Forget, ForgetSelector, InvalidationReason, MemoryChangeKind, MemoryWrite,
    Observations, Renew, WriteRefusal, memory_content_hash,
};
use crate::{Actor, ActorKind, Authority, MemoryClass, Origin, Sensitivity, StoreError};

pub(super) const CASES: &[(&str, super::MemoryCaseFn)] = &[
    ("a_write_creates_version_one", creates),
    (
        "the_same_content_is_observed_with_authority_in_the_key",
        observes,
    ),
    ("an_idempotency_key_replays_its_first_receipt", replays),
    ("a_capture_under_an_erased_prefix_is_refused", erased_prefix),
    ("a_failing_batch_writes_nothing", atomic),
    ("envelope_refusals", envelope_refusals),
    ("size_caps", size_caps),
    ("a_supersede_closes_its_targets", supersede),
    ("there_is_no_update_path", no_update),
];

/// Ada's private semantic note `n` with `text`.
pub(super) fn note(n: u64, text: &str) -> MemoryWrite {
    samples::memory_entry(n, ADA, &[P_ADA], &format!("Note {n}"), text)
}

fn creates(env: &MemoryEnv<'_>) -> CaseResult {
    let f = env.fresh()?;
    let m = &*f.memory;
    let mut entry = samples::memory_entry(
        1,
        ADA,
        &[P_ADA],
        "Staging rollbacks use the canary flag",
        "Rollbacks in staging go through the canary flag, not the deploy script.",
    );
    entry.scope.project = Some("afd".into());
    entry.scope.session = Some("s-81".into());
    entry.scope.agent = Some(Actor {
        kind: ActorKind::Agent,
        id: Some("ada".into()),
        label: None,
        on_behalf_of: Some("human:ada".into()),
    });
    entry.tags = vec!["deploy".into()];
    samples::agree(&mut entry);
    let receipt = write(m, T0, vec![entry.clone()])?;
    ensure(
        !receipt.replayed && receipt.refused.is_none(),
        "a plain write",
    )?;
    ensure_eq(receipt.entries.len(), 1, "one entry")?;
    let first = &receipt.entries[0];
    ensure_eq(first.state, EntryState::Created, "created")?;
    ensure_eq(first.id.as_str(), entry.id.as_str(), "the entry's id")?;
    ensure_eq(first.record_version, 1, "version one")?;
    ensure_eq(first.expires_at, entry.expires_at, "its expiry")?;
    ensure_eq(
        (receipt.from_rev, receipt.to_rev),
        (Some(1), Some(1)),
        "revisions",
    )?;
    let record = get_at(m, &entry.id, T0, &ada())?.ok_or("the record does not read back")?;
    ensure_eq(record.record_version, 1, "record version")?;
    ensure_eq(record.class, MemoryClass::Semantic, "class")?;
    ensure_eq(record.scope.clone(), entry.scope.clone(), "scope")?;
    ensure_eq(record.subject.as_str(), entry.subject.as_str(), "subject")?;
    ensure_eq(record.text.as_str(), entry.text.as_str(), "text")?;
    ensure_eq(record.tags.clone(), entry.tags.clone(), "tags")?;
    ensure_eq(record.access.clone(), entry.access.clone(), "access")?;
    ensure_eq(record.sensitivity, Sensitivity::Internal, "sensitivity")?;
    ensure_eq((record.valid_from, record.valid_until), (T0, None), "valid")?;
    ensure_eq(
        (record.recorded_at, record.recorded_until),
        (T0, None),
        "recorded",
    )?;
    ensure_eq(record.expires_at, entry.expires_at, "expires")?;
    ensure_eq(
        record.content_hash.clone(),
        memory_content_hash(&entry.subject, &entry.text),
        "content hash",
    )?;
    ensure_eq(
        record.observations,
        Observations {
            first: T0,
            last: T0,
            count: 1,
            sessions: 1,
        },
        "observations",
    )?;
    ensure(
        record.supersedes.is_empty()
            && record.superseded_by.is_none()
            && record.invalidation.is_none(),
        "no supersede or invalidation",
    )?;
    ensure_eq(record.authority(), Some(Authority::Agent), "authority")?;
    ensure_eq(record.provenance.version, 2, "envelope version")?;
    let json = record.to_json();
    ensure_eq(
        json["verification"].as_str(),
        Some("unverified"),
        "verification",
    )?;
    ensure_eq(json["trust"].as_str(), Some("content"), "trust")?;
    let changes = m.changes(0, 100, &ada(), None).ctx("changes")?;
    ensure_eq(changes.len(), 1, "one change")?;
    ensure_eq(changes[0].kind, MemoryChangeKind::Created, "change kind")?;
    ensure_eq(
        (
            changes[0].rev,
            changes[0].id.as_str(),
            changes[0].record_version,
            changes[0].at,
        ),
        (1, entry.id.as_str(), 1, T0),
        "the change",
    )?;
    ensure_eq(m.head().ctx("head")?, 1, "head")?;
    pass()
}

fn observes(env: &MemoryEnv<'_>) -> CaseResult {
    let f = env.fresh()?;
    let m = &*f.memory;
    let text = "Deploys go out on Tuesdays.";
    let with = |n: u64, session: &str, edit: &dyn Fn(&mut MemoryWrite)| {
        let mut e = note(n, text);
        e.subject = "Deploy day".into();
        e.scope.session = Some(session.into());
        edit(&mut e);
        samples::agree(&mut e);
        e
    };
    let first = write(m, T0, vec![with(1, "s-1", &|_| {})])?;
    let id = first.entries[0].id.clone();
    let again = write(m, T0 + 1000, vec![with(2, "s-2", &|_| {})])?;
    ensure_eq(
        again.entries[0].state,
        EntryState::Observed,
        "the same content",
    )?;
    ensure_eq(
        again.entries[0].id.as_str(),
        id.as_str(),
        "observes the first record",
    )?;
    ensure_eq(again.entries[0].record_version, 1, "no new version")?;
    ensure_eq(
        again.entries[0].expires_at,
        first.entries[0].expires_at,
        "no renewal",
    )?;
    ensure(
        get_at(m, &samples::memory_id(2), T0 + 1000, &ada())?.is_none(),
        "no new record",
    )?;
    let record = get_at(m, &id, T0 + 1000, &ada())?.ok_or("the record")?;
    ensure_eq(
        record.observations,
        Observations {
            first: T0,
            last: T0 + 1000,
            count: 2,
            sessions: 2,
        },
        "observations",
    )?;
    let kinds: Vec<_> = m
        .changes(0, 100, &ada(), None)
        .ctx("changes")?
        .into_iter()
        .map(|c| c.kind)
        .collect();
    ensure_eq(
        kinds,
        vec![MemoryChangeKind::Created, MemoryChangeKind::Observed],
        "an observation takes a revision",
    )?;
    // Each part of the key makes a new record: authority, access, project, class.
    let person = |e: &mut MemoryWrite| {
        samples::set_authority(e, Authority::Person);
        e.envelope.origin = Origin::UserStated;
    };
    let keyed: [(&str, &dyn Fn(&mut MemoryWrite)); 4] = [
        ("authority", &person),
        ("access", &|e| {
            e.access = crate::AccessSet::new(["space"]).unwrap_or_else(|_| unreachable!())
        }),
        ("project", &|e| e.scope.project = Some("afd".into())),
        ("class", &|e| e.class = MemoryClass::Procedural),
    ];
    for (n, (part, edit)) in (3_u64..).zip(keyed) {
        let r = write(m, T0 + 2000, vec![with(n, "s-1", edit)])?;
        ensure_eq(r.entries[0].state, EntryState::Created, part)?;
    }
    // A renewal sets the later of the current expiry and min(at + ttl, first + max).
    let renewed = write(
        m,
        T0 + 5000,
        vec![with(9, "s-3", &|e| {
            person(e);
            e.renew = Some(Renew {
                ttl_ms: 400 * DAY_MS,
                max_ttl_ms: 365 * DAY_MS,
            });
        })],
    )?;
    ensure_eq(
        renewed.entries[0].state,
        EntryState::Observed,
        "a person's re-remember",
    )?;
    ensure_eq(
        renewed.entries[0].expires_at,
        T0 + 2000 + 365 * DAY_MS,
        "renewed, capped at first + max",
    )?;
    let person_id = renewed.entries[0].id.clone();
    let record = get_at(m, &person_id, T0 + 5000, &ada())?.ok_or("the person's record")?;
    ensure_eq(
        record.expires_at,
        T0 + 2000 + 365 * DAY_MS,
        "the stored expiry",
    )?;
    pass()
}

fn replays(env: &MemoryEnv<'_>) -> CaseResult {
    let f = env.fresh()?;
    let m = &*f.memory;
    let mut batch = samples::memory_batch(T0, vec![note(1, "first")]);
    batch.idempotency = Some("k-1".into());
    let first = m.write(batch.clone()).ctx("write")?;
    ensure(!first.replayed, "the first write is not a replay")?;
    batch.entries = vec![note(2, "something else")];
    batch.at = T0 + 1000;
    let again = m.write(batch).ctx("replay")?;
    ensure(again.replayed, "the second write replays")?;
    ensure_eq(
        again.entries.clone(),
        first.entries.clone(),
        "the first receipt's entries",
    )?;
    ensure_eq(
        (again.from_rev, again.to_rev),
        (first.from_rev, first.to_rev),
        "the first receipt's revisions",
    )?;
    ensure_eq(m.head().ctx("head")?, 1, "nothing written")?;
    ensure(
        get_at(m, &samples::memory_id(2), T0 + 1000, &ada())?.is_none(),
        "no record",
    )?;
    pass()
}

fn captured(n: u64, owner: &str, token: &str, session: &str, text: &str) -> MemoryWrite {
    let mut e = samples::memory_entry(n, owner, &[token], &format!("Turn {n}"), text);
    e.class = MemoryClass::Episodic;
    e.scope.session = Some(session.into());
    samples::set_authority(&mut e, Authority::Transcript);
    samples::agree(&mut e);
    e
}

fn erased_prefix(env: &MemoryEnv<'_>) -> CaseResult {
    let f = env.fresh()?;
    let m = &*f.memory;
    let capture = |at, key: &str, entry: MemoryWrite| {
        let mut batch = samples::memory_batch(at, vec![entry]);
        batch.capture_key = Some(key.to_owned());
        m.write(batch).ctx("capture")
    };
    capture(T0, "h:s1:w1", captured(1, ADA, P_ADA, "s1", "window one"))?;
    capture(T0, "h:s1:w10", captured(2, ADA, P_ADA, "s1", "window ten"))?;
    let forget = |selector| {
        m.forget(Forget {
            owner: ADA.into(),
            selector,
            at: T0 + 1000,
            trace_id: None,
        })
        .ctx("forget")
    };
    let gone = forget(ForgetSelector::Ids(vec![samples::memory_id(1)]))?;
    ensure_eq(gone.erased, 1, "one record erased")?;
    let head = m.head().ctx("head")?;
    let r = capture(
        T0 + 2000,
        "h:s1:w1",
        captured(3, ADA, P_ADA, "s1", "a late tail"),
    )?;
    ensure_eq(
        r.refused,
        Some(WriteRefusal::Erased),
        "the window is erased",
    )?;
    ensure(r.entries.is_empty(), "nothing written")?;
    ensure_eq(m.head().ctx("head")?, head, "no revision")?;
    let r = capture(
        T0 + 2000,
        "h:s1:w10",
        captured(4, ADA, P_ADA, "s1", "window ten, later"),
    )?;
    ensure_eq(r.refused, None, "w1 does not cover w10")?;
    let gone = forget(ForgetSelector::Session("s1".into()))?;
    ensure_eq(gone.erased, 2, "the session's two records")?;
    let r = capture(
        T0 + 3000,
        "h:s1:w99",
        captured(5, ADA, P_ADA, "s1", "another window"),
    )?;
    ensure_eq(
        r.refused,
        Some(WriteRefusal::Erased),
        "the session is erased",
    )?;
    let r = capture(
        T0 + 3000,
        "h:s2:w1",
        captured(6, ADA, P_ADA, "s2", "another session"),
    )?;
    ensure_eq(r.refused, None, "another session")?;
    let r = capture(
        T0 + 3000,
        "h:s1:w1",
        captured(7, BO, super::P_BO, "s1", "bo's window"),
    )?;
    ensure_eq(r.refused, None, "erased prefixes are the owner's")?;
    ensure(
        get_at(m, &samples::memory_id(7), T0 + 3000, &bo())?.is_some(),
        "bo's capture",
    )?;
    pass()
}

fn atomic(env: &MemoryEnv<'_>) -> CaseResult {
    let f = env.fresh()?;
    let m = &*f.memory;
    write(m, T0, vec![note(10, "provisioned")])?;
    let mut bad = note(3, "bad");
    bad.subject = String::new();
    let batch = samples::memory_batch(T0, vec![note(1, "one"), note(2, "two"), bad]);
    refused(m, batch, "a batch with a bad entry", refused_write)?;
    let mut target = note(2, "supersedes a missing record");
    target.supersedes = vec![samples::memory_id(99)];
    let batch = samples::memory_batch(T0, vec![note(1, "one"), target]);
    refused(m, batch, "a supersede of a missing record", |e| {
        matches!(e, StoreError::NotFound | StoreError::Invalid(_))
    })?;
    let mut other = samples::memory_entry(2, BO, &[super::P_BO], "Bo's", "bo's");
    samples::agree(&mut other);
    let batch = samples::memory_batch(T0, vec![note(1, "one"), other]);
    refused(m, batch, "two principals in one batch", refused_write)?;
    let batch = samples::memory_batch(T0, vec![note(1, "one"), note(1, "one again")]);
    refused(m, batch, "one id twice", refused_write)?;
    let mut person = note(2, "a person's");
    samples::set_authority(&mut person, Authority::Person);
    let batch = samples::memory_batch(T0, vec![note(1, "one"), person]);
    refused(m, batch, "two authorities in one batch", refused_write)?;
    ensure(
        get_at(m, &samples::memory_id(1), T0, &ada())?.is_none(),
        "nothing kept",
    )?;
    pass()
}

fn envelope_refusals(env: &MemoryEnv<'_>) -> CaseResult {
    let f = env.fresh()?;
    let m = &*f.memory;
    write(m, T0, vec![note(10, "provisioned")])?;
    let edits: [(&str, fn(&mut MemoryWrite)); 13] = [
        ("a null authority", |e| e.envelope.authority = None),
        ("an authority outside the set", |e| {
            e.envelope.authority = Some("robot".into())
        }),
        ("an unspecified origin", |e| {
            e.envelope.origin = Origin::Unspecified
        }),
        ("an empty access", |e| e.envelope.access.clear()),
        ("envelope version 1", |e| e.envelope.version = 1),
        ("a disagreeing access", |e| {
            e.envelope.access = vec!["space".into()]
        }),
        ("a disagreeing sensitivity", |e| {
            e.envelope.sensitivity = Some(Sensitivity::Public)
        }),
        ("a disagreeing session", |e| {
            e.envelope.session = Some("s-9".into())
        }),
        ("a disagreeing validFrom", |e| {
            e.envelope.valid_from = Some(crate::memory::format_instant(T0 + 1));
        }),
        ("a disagreeing validUntil", |e| {
            e.envelope.valid_until = Some(crate::memory::format_instant(T0 + DAY_MS));
        }),
        ("a disagreeing principal", |e| {
            e.envelope.principal = Some(BO.into())
        }),
        ("a disagreeing content hash", |e| {
            e.envelope.content_hash = Some(memory_content_hash("x", "y").as_str().to_owned());
        }),
        ("a confirmation from the writer", |e| {
            e.envelope.confirmation = Some(crate::Confirmation {
                by: ADA.into(),
                at: crate::memory::format_instant(T0),
                prior_authority: Authority::Agent,
            });
        }),
    ];
    for (what, edit) in edits {
        let mut e = note(1, "refused");
        edit(&mut e);
        refused(m, samples::memory_batch(T0, vec![e]), what, refused_write)?;
    }
    ensure(
        get_at(m, &samples::memory_id(1), T0, &ada())?.is_none(),
        "nothing kept",
    )?;
    pass()
}

fn size_caps(env: &MemoryEnv<'_>) -> CaseResult {
    let f = env.fresh()?;
    let m = &*f.memory;
    let mut at_cap = note(1, &"x".repeat(64 * 1024));
    at_cap.subject = "s".repeat(256);
    at_cap.tags = (0..32).map(|n| format!("{n:0>64}")).collect();
    write(m, T0, vec![at_cap]).map_err(|e| format!("every field at its cap: {e}"))?;
    let edits: [(&str, fn(&mut MemoryWrite)); 12] = [
        ("a subject of 257 characters", |e| {
            e.subject = "s".repeat(257)
        }),
        ("an empty subject", |e| e.subject.clear()),
        ("a subject of two lines", |e| e.subject = "one\ntwo".into()),
        ("text over 64 KiB", |e| e.text = "x".repeat(64 * 1024 + 1)),
        ("text with NUL", |e| e.text = "a\0b".into()),
        ("33 tags", |e| {
            e.tags = (0..33).map(|n| format!("t{n}")).collect()
        }),
        ("a tag of 65 characters", |e| e.tags = vec!["t".repeat(65)]),
        ("a project that is a path", |e| {
            e.scope.project = Some("../x".into())
        }),
        ("a session with a space", |e| {
            e.scope.session = Some("s 1".into())
        }),
        ("17 supersedes", |e| {
            e.supersedes = (100..117).map(samples::memory_id).collect();
        }),
        ("a malformed id", |e| e.id = "mem-1".into()),
        ("validUntil at validFrom", |e| {
            e.valid_until = Some(e.valid_from)
        }),
    ];
    for (what, edit) in edits {
        let mut e = note(2, "refused");
        edit(&mut e);
        samples::agree(&mut e);
        refused(m, samples::memory_batch(T0, vec![e]), what, refused_write)?;
    }
    let many: Vec<_> = (10..267).map(|n| note(n, &format!("entry {n}"))).collect();
    refused(
        m,
        samples::memory_batch(T0, many),
        "257 entries",
        refused_write,
    )?;
    let mut batch = samples::memory_batch(T0, vec![note(2, "a long key")]);
    batch.idempotency = Some("k".repeat(257));
    refused(
        m,
        batch,
        "an idempotency key of 257 characters",
        refused_write,
    )?;
    pass()
}

fn supersede(env: &MemoryEnv<'_>) -> CaseResult {
    let f = env.fresh()?;
    let m = &*f.memory;
    let target = samples::memory_id(1);
    write(m, T0, vec![note(1, "the old fact")])?;
    let mut new = note(2, "the new fact");
    new.valid_from = T0 + 1000;
    new.supersedes = vec![target.clone()];
    samples::agree(&mut new);
    let receipt = write(m, T0 + 1000, vec![new])?;
    ensure_eq(
        receipt.superseded.clone(),
        vec![target.clone()],
        "superseded",
    )?;
    let (from, to) = (receipt.from_rev.unwrap_or(0), receipt.to_rev.unwrap_or(0));
    ensure_eq(
        to.saturating_sub(from),
        1,
        "two revisions: created and superseded",
    )?;
    let history = m.history(&target, &ada()).ctx("history")?;
    ensure_eq(history.len(), 2, "the target has two versions")?;
    let (old, closed) = (&history[0], &history[1]);
    ensure_eq(old.recorded_until, Some(T0 + 1000), "version 1 closed")?;
    ensure(
        old.invalidation.is_none() && old.superseded_by.is_none(),
        "version 1 unchanged",
    )?;
    ensure_eq(closed.record_version, 2, "version 2")?;
    ensure_eq(
        closed.superseded_by.clone(),
        Some(samples::memory_id(2)),
        "superseded by",
    )?;
    ensure_eq(
        (closed.valid_from, closed.valid_until),
        (T0, Some(T0 + 1000)),
        "valid",
    )?;
    ensure_eq(
        (closed.recorded_at, closed.recorded_until),
        (T0 + 1000, None),
        "recorded",
    )?;
    let invalidation = closed.invalidation.clone().ok_or("an invalidation")?;
    ensure_eq(
        invalidation.reason,
        InvalidationReason::Other,
        "reason other",
    )?;
    ensure_eq(invalidation.by.as_str(), ADA, "by the writer")?;
    ensure_eq(
        closed.text.as_str(),
        "the old fact",
        "the text is unchanged",
    )?;
    let replacement = get_at(m, &samples::memory_id(2), T0 + 2000, &ada())?.ok_or("the new")?;
    ensure_eq(
        replacement.supersedes.clone(),
        vec![target.clone()],
        "supersedes",
    )?;
    ensure(
        get_at(m, &target, T0 + 2000, &ada())?.is_none(),
        "the target is not valid now",
    )?;
    let kinds: Vec<_> = m
        .changes(0, 100, &ada(), None)
        .ctx("changes")?
        .into_iter()
        .map(|c| (c.id, c.kind))
        .collect();
    ensure(
        kinds.contains(&(target, MemoryChangeKind::Invalidated)),
        "the target's change is Invalidated",
    )?;
    pass()
}

fn no_update(env: &MemoryEnv<'_>) -> CaseResult {
    let f = env.fresh()?;
    let m = &*f.memory;
    let id = samples::memory_id(1);
    write(m, T0, vec![note(1, "first")])?;
    refused(
        m,
        samples::memory_batch(T0 + 1000, vec![note(1, "second")]),
        "a write to a used id",
        |e| matches!(e, StoreError::Invalid(_) | StoreError::Conflict { .. }),
    )?;
    let record = get_at(m, &id, T0 + 1000, &ada())?.ok_or("the record")?;
    ensure_eq(record.text.as_str(), "first", "the text is unchanged")?;
    ensure_eq(
        m.history(&id, &ada()).ctx("history")?.len(),
        1,
        "one version",
    )?;
    m.forget(Forget {
        owner: ADA.into(),
        selector: ForgetSelector::Ids(vec![id.clone()]),
        at: T0 + 2000,
        trace_id: None,
    })
    .ctx("forget")?;
    expect_err(
        m.write(samples::memory_batch(T0 + 3000, vec![note(1, "third")])),
        "a write to a forgotten id",
        |e| matches!(e, StoreError::Invalid(_) | StoreError::Conflict { .. }),
    )?;
    ensure(
        get_at(m, &id, T0 + 3000, &ada())?.is_none(),
        "still forgotten",
    )?;
    pass()
}

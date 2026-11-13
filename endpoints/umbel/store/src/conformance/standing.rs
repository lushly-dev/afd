//! Group `standing`: what a standing record is read as (records host specification, section 6
//! and 15.1; D160 to D162). A label is computed at each read from four facts only the store
//! writes: a decision row, an evidence row, the cited document's row, and whether that document
//! is the person's own now, which the view of the read says.
//!
//! Every case reaches the backend through [`DocumentStore`]'s lane methods alone; a backend
//! without a record lane skips the group, as it skips `lane`. The cases hold what an agent's
//! call must never be able to move: a decision writes only where its reader may read; attested
//! is never stored, and lapses when the cited document changes, when its collection stops being
//! own, when a mark is withdrawn and when a marked document's collection becomes
//! command-writable; a reader who may not read a cited document sees how it is the person's own
//! and nothing else. Every text is invented and about gardening.

use serde_json::{Value, json};

use super::lane::{
    AT, NO_LANE, NS, ids, lane, no_scan, pointer, ranked_by_the_formulas, text, writer,
};
use super::matching::{by_the_formulas, near};
use super::{
    CaseResult, Ctx, Env, conflict, ensure, ensure_eq, everyone, expect_err, invalid, pass, reader,
    samples, skip,
};
use crate::lane::{
    Decision, Evidence, FindOrder, FindPage, LaneRecord, LaneState, LaneWrite, MATCH_POOL,
    MAX_MATCH_K, MatchResult, OwnBasis, OwnCollection, OwnMark, RecordDecision, RecordDecl,
    RecordFind, RecordMatch, Standing, StandingLabel, StandingView,
};
use crate::{
    Assurance, ByAt, ChangeKind, ContentHash, DocumentStore, Expect, ReaderFilter, StoreError,
    canonical_json, record_target,
};

pub(super) const CASES: &[(&str, super::CaseFn)] = &[
    (
        "a_standing_record_reads_unverified_and_its_wording_is_fixed",
        unverified_and_fixed,
    ),
    (
        "affirm_and_withdraw_each_write_once_with_a_change_row",
        affirm_and_withdraw,
    ),
    (
        "a_decision_reaches_only_a_record_its_reader_may_read_whatever_a_read_admits",
        decisions_need_a_reader,
    ),
    (
        "attested_by_an_own_collection_by_a_mark_by_both_and_by_neither",
        attested_four_ways,
    ),
    ("the_speaker_must_agree", speakers_agree),
    (
        "a_changed_document_lapses_attestation_and_citing_it_again_restores_it",
        changed_document,
    ),
    (
        "a_mark_names_the_content_it_was_made_on_and_is_withdrawn_by_an_unmark",
        marks,
    ),
    (
        "a_mark_does_not_count_where_the_view_names_the_collection_command_writable",
        command_writable,
    ),
    (
        "a_rebuild_clears_what_stood_on_a_wording_changed_while_undeclared",
        rebuild_clears,
    ),
    (
        "admit_narrows_reads_finds_matches_totals_and_statistics",
        admit_narrows,
    ),
    (
        "evidence_must_cite_a_document_the_writer_reads_at_its_stored_content",
        evidence_checked,
    ),
    (
        "a_reader_who_cannot_read_the_cited_document_sees_the_basis_alone",
        basis_alone,
    ),
    (
        "a_document_of_an_own_collection_attests_only_once_the_host_held_it_to_its_file",
        held_to_file,
    ),
    (
        "a_former_persons_decisions_and_marks_are_set_aside",
        former_person,
    ),
    (
        "levels_admit_an_affirmation_only_at_a_level_they_list",
        levels_admit,
    ),
    (
        "documents_a_reader_cannot_read_change_none_of_its_reads",
        differential_uncited,
    ),
    (
        "an_unreadable_cited_document_moves_only_that_records_standing",
        differential_cited,
    ),
];

const ALL: &[Standing] = &[Standing::Unverified, Standing::Attested, Standing::Affirmed];
const DECIDED_AT: &str = "2026-11-03T08:30:00.000Z";
const PERSON: &str = "human:local";
const ROSES: &str = "Prune roses in late winter, before the buds swell.";

/// A standing kind `note`: one statement, matched, and one key.
fn decl() -> Result<RecordDecl, String> {
    Ok(RecordDecl {
        kind: "note".to_owned(),
        standing: true,
        text: vec![pointer("/statement")?],
        keys: vec![pointer("/bed")?],
        matched: Some(0),
    })
}

/// The view the host would build: these own collections, each with its speaker, these
/// command-writable ones, admitting these standings.
fn view(
    own: &[(&str, Option<&str>)],
    command_writable: &[&str],
    admit: &[Standing],
) -> StandingView {
    StandingView {
        own: own
            .iter()
            .map(|(id, speaker)| OwnCollection {
                id: (*id).to_owned(),
                speaker: speaker.map(str::to_owned),
            })
            .collect(),
        command_writable: command_writable.iter().map(|id| (*id).to_owned()).collect(),
        person: vec![PERSON.to_owned()],
        admit: admit.to_vec(),
        levels: Vec::new(),
    }
}

/// A space with no own collection and no command-writable one, every standing admitted.
fn plain() -> StandingView {
    view(&[], &[], ALL)
}

/// A space whose collection `journal` is the person's own, with no speaker.
fn journal() -> StandingView {
    view(&[("journal", None)], &[], ALL)
}

fn body(statement: &str, bed: &str) -> Value {
    json!({ "statement": statement, "bed": bed })
}

fn put(
    d: &dyn DocumentStore,
    decl: &RecordDecl,
    id: &str,
    body: Value,
    access: &[&str],
    evidence: Option<Evidence>,
) -> Result<crate::lane::DeclaredPut, StoreError> {
    d.put_declared_record(
        NS,
        decl,
        id,
        body,
        samples::envelope(access, "capture", AT),
        Expect::Any,
        LaneWrite {
            evidence,
            flags: Vec::new(),
            model: None,
        },
        &writer(),
    )
}

/// Store a document as the host does once it held it to its file on disk (section 3, rule 2),
/// and answer its content hash.
fn document(
    d: &dyn DocumentStore,
    id: &str,
    access: &[&str],
    text: &str,
) -> Result<ContentHash, String> {
    let write = samples::document(id, access, text, "sync");
    let hash = write.content_hash.clone();
    d.put_document_held(write, Expect::Any)
        .ctx("put_document_held")?;
    Ok(hash)
}

/// Store a document as a command does: nothing held it to a file.
fn unheld(
    d: &dyn DocumentStore,
    id: &str,
    access: &[&str],
    text: &str,
) -> Result<ContentHash, String> {
    let write = samples::document(id, access, text, "command");
    let hash = write.content_hash.clone();
    d.put_document(write, Expect::Any).ctx("put_document")?;
    Ok(hash)
}

/// Evidence that the wording is units 2 and 3 of `doc` at `hash`, word for word.
fn cites(doc: &str, hash: &ContentHash, speaker: Option<&str>) -> Evidence {
    Evidence {
        doc: doc.to_owned(),
        doc_hash: hash.clone(),
        units: vec![2, 3],
        rule: "sentences/1".to_owned(),
        speaker: speaker.map(str::to_owned),
        verbatim: true,
    }
}

fn decision(decision: Decision) -> RecordDecision {
    RecordDecision {
        decision,
        by: PERSON.to_owned(),
        at: DECIDED_AT.to_owned(),
        assurance: Assurance::terminal(),
        trace_id: Some("review".to_owned()),
    }
}

fn mark(doc: &str, hash: &ContentHash, speaker: Option<&str>) -> OwnMark {
    OwnMark {
        doc: doc.to_owned(),
        doc_hash: hash.clone(),
        speaker: speaker.map(str::to_owned),
        by: PERSON.to_owned(),
        at: DECIDED_AT.to_owned(),
        assurance: Assurance::terminal(),
        trace_id: Some("mark".to_owned()),
    }
}

/// The record as `who` reads it under `view`.
fn read(
    d: &dyn DocumentStore,
    decl: &RecordDecl,
    id: &str,
    view: &StandingView,
    who: &ReaderFilter,
) -> Result<Option<LaneRecord>, String> {
    d.read_record(NS, decl, id, view, who).ctx("read_record")
}

/// The label of a record `who` reads under `view`.
fn label(
    d: &dyn DocumentStore,
    decl: &RecordDecl,
    id: &str,
    view: &StandingView,
    who: &ReaderFilter,
) -> Result<StandingLabel, String> {
    read(d, decl, id, view, who)?
        .ok_or_else(|| format!("the record {id} is not read"))?
        .label
        .ok_or_else(|| format!("the record {id} of a standing kind carries no label"))
}

fn standing_of(
    d: &dyn DocumentStore,
    decl: &RecordDecl,
    id: &str,
    view: &StandingView,
) -> Result<Standing, String> {
    Ok(label(d, decl, id, view, &writer())?.standing)
}

fn basis_of(label: &StandingLabel) -> Option<OwnBasis> {
    label.source.as_ref().map(|source| source.basis)
}

fn find_all(decl: &RecordDecl) -> RecordFind {
    RecordFind {
        kind: decl.kind.clone(),
        keys: Vec::new(),
        standings: Vec::new(),
        verified_only: false,
        text: None,
        order: FindOrder::Id,
        after: None,
        limit: 200,
        total: true,
    }
}

fn find(
    d: &dyn DocumentStore,
    decl: &RecordDecl,
    query: &RecordFind,
    view: &StandingView,
    who: &ReaderFilter,
) -> Result<FindPage, String> {
    d.find_records(NS, decl, query, view, who)
        .ctx("find_records")
}

/// One text matched against the kind under `view`, asking for the 20 nearest: its result, each
/// hit carrying the label a read of the same record gives the same reader.
fn matched(
    d: &dyn DocumentStore,
    decl: &RecordDecl,
    text: &str,
    view: &StandingView,
    who: &ReaderFilter,
) -> Result<MatchResult, String> {
    let query = RecordMatch {
        kind: decl.kind.clone(),
        texts: vec![text.to_owned()],
        k: MAX_MATCH_K,
        keys: Vec::new(),
        standings: Vec::new(),
        verified_only: false,
        exclude: Vec::new(),
    };
    let page = d
        .match_records(NS, decl, &query, None, view, who)
        .ctx("match_records")?;
    ensure_eq(
        page.admitted.clone(),
        view.admit.clone(),
        "a match says what was admitted",
    )?;
    let result = page
        .results
        .into_iter()
        .next()
        .ok_or("a match of one text answers one result")?;
    for hit in result.identical.iter().chain(&result.nearest) {
        let read = read(d, decl, &hit.id, view, who)?
            .ok_or("a record a match returns is one a read returns")?;
        ensure_eq(
            (&hit.label, hit.rev),
            (&read.label, read.record.rev),
            "a hit carries the label a read gives the record",
        )?;
    }
    Ok(result)
}

fn hit_ids(hits: &[crate::lane::MatchHit]) -> Vec<&str> {
    hits.iter().map(|hit| hit.id.as_str()).collect()
}

fn not_found(error: &StoreError) -> bool {
    matches!(error, StoreError::NotFound)
}

fn evidence_invalid(error: &StoreError) -> bool {
    matches!(error, StoreError::EvidenceInvalid(_))
}

fn unverified_and_fixed(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    put(d, &decl, "a", body(ROSES, "north"), &["space"], None).ctx("a put")?;
    let label = label(d, &decl, "a", &plain(), &everyone())?;
    ensure_eq(
        label.clone(),
        StandingLabel {
            standing: Standing::Unverified,
            affirmed: None,
            source: None,
        },
        "a standing record with no standing fact reads unverified, with nothing behind it",
    )?;
    ensure_eq(
        label.to_json(),
        json!({ "standing": "unverified", "affirmed": null, "source": null }),
        "the label's wire form",
    )?;
    // Nothing a body holds is read as standing.
    let claims = json!({
        "statement": "Roses want morning sun.", "bed": "east",
        "standing": "affirmed", "dev.umbel/standing": { "standing": "affirmed" },
        "affirmed": true, "verified": true,
    });
    put(d, &decl, "claims", claims, &["space"], None).ctx("a body that claims standing")?;
    ensure_eq(
        standing_of(d, &decl, "claims", &plain())?,
        Standing::Unverified,
        "a body's fields are the plugin's, never standing",
    )?;
    // Wording is fixed by the first put; keys and other fields are not.
    expect_err(
        put(
            d,
            &decl,
            "a",
            body("Prune roses in early spring.", "north"),
            &["space"],
            None,
        ),
        "a put that changes the wording",
        |error| matches!(error, StoreError::WordingFixed),
    )?;
    put(d, &decl, "a", body(ROSES, "south"), &["space"], None).ctx("a put that changes a key")?;
    let moved = read(d, &decl, "a", &plain(), &everyone())?.ok_or("the record is read")?;
    ensure_eq(
        moved.record.body["bed"].clone(),
        json!("south"),
        "the key changed",
    )?;
    ensure_eq(
        moved.record.body["statement"].clone(),
        json!(ROSES),
        "and the wording did not",
    )?;
    // The three standings, and none of the tiers of verified knowledge.
    for standing in ALL {
        let name = standing.as_str();
        ensure(
            !matches!(name, "machine" | "human" | "owner"),
            "a standing is never spelled as a tier of verified knowledge",
        )?;
        ensure_eq(json!(standing), json!(name), "a standing's wire form")?;
    }
    pass()
}

fn affirm_and_withdraw(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    let journal_hash = document(d, "journal/roses", &["space"], "Roses.\n")?;
    put(d, &decl, "a", body(ROSES, "north"), &["space"], None).ctx("a put")?;
    let head = d.head().ctx("head")?;
    let documents = d
        .last_readable_document(head, &everyone())
        .ctx("position")?;
    let affirmed = d
        .decide_record(
            NS,
            &decl,
            "a",
            decision(Decision::Affirm),
            &plain(),
            &everyone(),
        )
        .ctx("affirm")?;
    ensure_eq(
        affirmed.rev,
        Some(head + 1),
        "an affirmation takes the next revision",
    )?;
    ensure_eq(
        affirmed.label.to_json(),
        json!({
            "standing": "affirmed",
            "affirmed": { "by": PERSON, "at": DECIDED_AT,
                "assurance": { "level": "terminal", "method": "cli-terminal" } },
            "source": null,
        }),
        "the label names who affirmed it, when and how",
    )?;
    ensure_eq(
        label(d, &decl, "a", &plain(), &everyone())?,
        affirmed.label.clone(),
        "the next read carries the same label",
    )?;
    // Repeated, it writes nothing and answers the label as it is.
    let again = d
        .decide_record(
            NS,
            &decl,
            "a",
            decision(Decision::Affirm),
            &plain(),
            &everyone(),
        )
        .ctx("affirm again")?;
    ensure_eq(
        again.rev,
        None,
        "an affirmation of an affirmed record takes no revision",
    )?;
    ensure_eq(
        again.label,
        affirmed.label.clone(),
        "and answers the label as it is",
    )?;
    ensure_eq(d.head().ctx("head")?, head + 1, "nothing more was written")?;
    // The decision's change: kind `standing`, the record's target, no content hash, readable
    // by the record's access set.
    let changes = d.changes(head, 10, &everyone(), None).ctx("changes")?;
    ensure_eq(changes.len(), 1, "one change for the decision")?;
    let change = &changes[0];
    ensure_eq(change.kind, ChangeKind::Standing, "its kind")?;
    ensure_eq(
        change.target.clone(),
        record_target(NS, "note", "a"),
        "its target",
    )?;
    ensure_eq(
        change.content_hash.clone(),
        None,
        "it carries no content hash",
    )?;
    ensure_eq(change.trace_id.as_deref(), Some("review"), "its trace")?;
    ensure_eq(change.at.as_str(), DECIDED_AT, "its time")?;
    ensure_eq(
        d.changes(head, 10, &reader(&["group:other"]), None)
            .ctx("changes")?
            .len(),
        0,
        "a reader who may not read the record does not see its decision",
    )?;
    ensure_eq(
        d.last_readable_document(d.head().ctx("head")?, &everyone())
            .ctx("position")?,
        documents,
        "a decision is not a change to a document: no sealed position moves",
    )?;
    ensure_eq(
        d.lane_status(NS, &decl).ctx("status")?.affirmed,
        1,
        "the status counts it",
    )?;
    // An affirmed record that a source attests keeps its source in the label.
    put(
        d,
        &decl,
        "a",
        body(ROSES, "north"),
        &["space"],
        Some(cites("journal/roses", &journal_hash, None)),
    )
    .ctx("cite")?;
    let both = label(d, &decl, "a", &journal(), &everyone())?;
    ensure_eq(both.standing, Standing::Affirmed, "affirmed comes first")?;
    ensure_eq(
        basis_of(&both),
        Some(OwnBasis::Collection),
        "and the source is still shown",
    )?;
    // Withdraw, and withdraw again.
    let head = d.head().ctx("head")?;
    let withdrawn = d
        .decide_record(
            NS,
            &decl,
            "a",
            decision(Decision::Withdraw),
            &plain(),
            &everyone(),
        )
        .ctx("withdraw")?;
    ensure_eq(
        withdrawn.rev,
        Some(head + 1),
        "a withdrawal takes the next revision",
    )?;
    ensure_eq(
        withdrawn.label.standing,
        Standing::Unverified,
        "the record is no longer affirmed",
    )?;
    ensure(withdrawn.label.affirmed.is_none(), "and names no decision")?;
    let again = d
        .decide_record(
            NS,
            &decl,
            "a",
            decision(Decision::Withdraw),
            &plain(),
            &everyone(),
        )
        .ctx("withdraw again")?;
    ensure_eq(
        again.rev,
        None,
        "a withdrawal from a record that is not affirmed writes nothing",
    )?;
    ensure_eq(d.head().ctx("head")?, head + 1, "nothing more was written")?;
    ensure_eq(
        d.changes(head, 10, &everyone(), None)
            .ctx("changes")?
            .iter()
            .map(|change| change.kind)
            .collect::<Vec<_>>(),
        vec![ChangeKind::Standing],
        "the withdrawal's change",
    )?;
    ensure_eq(
        d.lane_status(NS, &decl).ctx("status")?.affirmed,
        0,
        "the status counts none",
    )?;
    // Under the own collection the withdrawn record reads attested: attested was never stored.
    ensure_eq(
        standing_of(d, &decl, "a", &journal())?,
        Standing::Attested,
        "what attests it still does",
    )?;
    pass()
}

fn decisions_need_a_reader(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    put(d, &decl, "mine", body(ROSES, "north"), &["space"], None).ctx("a put")?;
    put(
        d,
        &decl,
        "theirs",
        body("Roses want morning sun.", "east"),
        &["group:other"],
        None,
    )
    .ctx("a record the reader may not read")?;
    let head = d.head().ctx("head")?;
    for id in ["theirs", "absent"] {
        expect_err(
            d.decide_record(
                NS,
                &decl,
                id,
                decision(Decision::Affirm),
                &plain(),
                &everyone(),
            ),
            "a decision on a record its reader may not read",
            not_found,
        )?;
    }
    ensure_eq(
        d.head().ctx("head")?,
        head,
        "a refused decision writes nothing",
    )?;
    ensure_eq(
        standing_of(d, &decl, "theirs", &plain())?,
        Standing::Unverified,
        "the unreadable record was not affirmed",
    )?;
    expect_err(
        d.decide_record(
            NS,
            &decl,
            "mine",
            decision(Decision::Affirm),
            &plain(),
            &ReaderFilter::derivation(),
        ),
        "a decision with no reader",
        invalid,
    )?;
    let mut forged = decision(Decision::Affirm);
    forged.assurance.level = "owner".to_owned();
    expect_err(
        d.decide_record(NS, &decl, "mine", forged, &plain(), &everyone()),
        "a decision whose assurance is neither the terminal's nor the person page's",
        invalid,
    )?;
    let plain_kind = RecordDecl {
        standing: false,
        ..decl.clone()
    };
    put(
        d,
        &RecordDecl {
            kind: "bed".to_owned(),
            ..plain_kind.clone()
        },
        "north",
        body("The north bed.", "north"),
        &["space"],
        None,
    )
    .ctx("a record of a kind without standing")?;
    expect_err(
        d.decide_record(
            NS,
            &RecordDecl {
                kind: "bed".to_owned(),
                ..plain_kind
            },
            "north",
            decision(Decision::Affirm),
            &plain(),
            &everyone(),
        ),
        "a decision on a kind without standing",
        invalid,
    )?;
    ensure_eq(
        d.head().ctx("head")?,
        head + 1,
        "only the bed's put was written",
    )?;
    // No standing filter applies to a decision: a view that admits nothing still decides, and
    // one that admits only affirmed records still reaches an unverified one.
    for admit in [&[][..], &[Standing::Affirmed][..]] {
        let narrow = view(&[], &[], admit);
        let done = d
            .decide_record(
                NS,
                &decl,
                "mine",
                decision(Decision::Affirm),
                &narrow,
                &everyone(),
            )
            .ctx("a decision under a view that would not admit the record")?;
        ensure_eq(
            done.label.standing,
            Standing::Affirmed,
            "the label after the decision",
        )?;
        let back = d
            .decide_record(
                NS,
                &decl,
                "mine",
                decision(Decision::Withdraw),
                &narrow,
                &everyone(),
            )
            .ctx("a withdrawal under the same view")?;
        ensure_eq(
            back.label.standing,
            Standing::Unverified,
            "the label after the withdrawal",
        )?;
        ensure(
            done.rev.is_some() && back.rev.is_some(),
            "each took a revision",
        )?;
    }
    pass()
}

fn attested_four_ways(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    let mut write = samples::document(
        "journal/roses",
        &["space"],
        "Roses.\nPrune roses in late winter, before the buds swell.\n",
        "sync",
    );
    write.envelope.generated = Some(ByAt {
        by: "human:local".to_owned(),
        at: "2026-10-30T07:00:00.000Z".to_owned(),
    });
    let hash = write.content_hash.clone();
    d.put_document_held(write, Expect::Any)
        .ctx("put_document_held")?;
    put(
        d,
        &decl,
        "a",
        body(ROSES, "north"),
        &["space"],
        Some(cites("journal/roses", &hash, None)),
    )
    .ctx("a cited put")?;
    ensure_eq(
        d.lane_status(NS, &decl).ctx("status")?.evidence,
        1,
        "the evidence row",
    )?;
    // By neither: evidence alone attests nothing.
    ensure_eq(
        label(d, &decl, "a", &plain(), &everyone())?,
        StandingLabel {
            standing: Standing::Unverified,
            affirmed: None,
            source: None,
        },
        "a document that is nobody's own attests nothing",
    )?;
    ensure_eq(
        d.document_own("journal/roses", &plain(), &everyone())
            .ctx("document_own")?,
        None,
        "and is not the person's own",
    )?;
    // By collection.
    let by_collection = label(d, &decl, "a", &journal(), &everyone())?;
    ensure_eq(
        by_collection.to_json(),
        json!({
            "standing": "attested",
            "affirmed": null,
            "source": {
                "doc": "journal/roses", "contentHash": hash.as_str(), "basis": "collection",
                "speaker": null, "units": [2, 3], "rule": "sentences/1",
                "storedAt": "2026-11-02T10:00:00.000Z", "generatedAt": "2026-10-30T07:00:00.000Z",
            },
        }),
        "attested by an own collection, with the two dates the host holds",
    )?;
    let own = d
        .document_own("journal/roses", &journal(), &everyone())
        .ctx("document_own")?
        .ok_or("a document of an own collection is the person's own")?;
    ensure_eq(
        (own.basis, own.speaker.clone(), own.content_hash.clone()),
        (OwnBasis::Collection, None, hash.clone()),
        "how it is the person's own",
    )?;
    ensure_eq(
        (own.stored_at.as_str(), own.generated_at.as_deref()),
        ("2026-11-02T10:00:00.000Z", Some("2026-10-30T07:00:00.000Z")),
        "and its two dates",
    )?;
    // By mark.
    let marked = d
        .mark_document_own(mark("journal/roses", &hash, None), &everyone())
        .ctx("mark")?;
    ensure(marked.wrote, "a first mark writes")?;
    let by_mark = label(d, &decl, "a", &plain(), &everyone())?;
    ensure_eq(by_mark.standing, Standing::Attested, "attested by a mark")?;
    ensure_eq(
        basis_of(&by_mark),
        Some(OwnBasis::Marked),
        "the basis is the mark",
    )?;
    ensure_eq(
        d.document_own("journal/roses", &plain(), &everyone())
            .ctx("document_own")?
            .map(|own| own.basis),
        Some(OwnBasis::Marked),
        "the document is the person's own by the mark",
    )?;
    // By both: the deployer's configuration is read first.
    let by_both = label(d, &decl, "a", &journal(), &everyone())?;
    ensure_eq(
        basis_of(&by_both),
        Some(OwnBasis::Collection),
        "collection when both hold",
    )?;
    ensure_eq(
        d.document_own("journal/roses", &journal(), &everyone())
            .ctx("document_own")?
            .map(|own| own.basis),
        Some(OwnBasis::Collection),
        "for the document too",
    )?;
    // A collection that stops being own lapses what rested on it alone.
    d.unmark_document_own("journal/roses", DECIDED_AT, Some("unmark"), &everyone())
        .ctx("unmark")?;
    ensure_eq(
        standing_of(d, &decl, "a", &journal())?,
        Standing::Attested,
        "own by collection",
    )?;
    ensure_eq(
        standing_of(d, &decl, "a", &plain())?,
        Standing::Unverified,
        "a collection that is no longer own attests nothing, with nothing written",
    )?;
    ensure_eq(
        standing_of(d, &decl, "a", &view(&[("talks", None)], &[], ALL))?,
        Standing::Unverified,
        "another own collection does not make this document the person's",
    )?;
    // Evidence that does not say word for word attests nothing, under any view.
    let mut loose = cites("journal/roses", &hash, None);
    loose.verbatim = false;
    put(d, &decl, "a", body(ROSES, "north"), &["space"], Some(loose)).ctx("a looser citation")?;
    ensure_eq(
        standing_of(d, &decl, "a", &journal())?,
        Standing::Unverified,
        "only a word-for-word citation attests",
    )?;
    ensure_eq(
        d.lane_status(NS, &decl).ctx("status")?.evidence,
        1,
        "the evidence was replaced",
    )?;
    pass()
}

fn speakers_agree(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    let hash = document(
        d,
        "talks/pruning",
        &["space"],
        "Gardener: prune roses in late winter.\n",
    )?;
    let talks = view(&[("talks", Some("Gardener"))], &[], ALL);
    let silent = view(&[("talks", None)], &[], ALL);
    for (id, speaker) in [
        ("none", None),
        ("gardener", Some("Gardener")),
        ("visitor", Some("Visitor")),
    ] {
        put(
            d,
            &decl,
            id,
            body(&format!("{ROSES} ({id})"), "north"),
            &["space"],
            Some(cites("talks/pruning", &hash, speaker)),
        )
        .ctx("a cited put")?;
    }
    for (id, under_talks, under_silent) in [
        ("none", Standing::Unverified, Standing::Attested),
        ("gardener", Standing::Attested, Standing::Unverified),
        ("visitor", Standing::Unverified, Standing::Unverified),
    ] {
        ensure_eq(
            standing_of(d, &decl, id, &talks)?,
            under_talks,
            "the evidence's speaker must be the collection's",
        )?;
        ensure_eq(
            standing_of(d, &decl, id, &silent)?,
            under_silent,
            "and none when the collection names none",
        )?;
    }
    let attested = label(d, &decl, "gardener", &talks, &everyone())?;
    ensure_eq(
        attested
            .source
            .and_then(|source| source.seen)
            .and_then(|seen| seen.speaker),
        Some("Gardener".to_owned()),
        "the label carries the speaker",
    )?;
    ensure_eq(
        d.document_own("talks/pruning", &talks, &everyone())
            .ctx("document_own")?
            .and_then(|own| own.speaker),
        Some("Gardener".to_owned()),
        "the collection's speaker reaches a plugin through the host",
    )?;
    // The same for a mark: its speaker must be the evidence's.
    d.mark_document_own(mark("talks/pruning", &hash, Some("Gardener")), &everyone())
        .ctx("mark")?;
    for (id, expected) in [
        ("none", Standing::Unverified),
        ("gardener", Standing::Attested),
        ("visitor", Standing::Unverified),
    ] {
        ensure_eq(
            standing_of(d, &decl, id, &plain())?,
            expected,
            "the evidence's speaker must be the mark's",
        )?;
    }
    ensure_eq(
        d.document_own("talks/pruning", &plain(), &everyone())
            .ctx("document_own")?
            .map(|own| (own.basis, own.speaker)),
        Some((OwnBasis::Marked, Some("Gardener".to_owned()))),
        "the mark's speaker reaches a plugin through the host",
    )?;
    // Marked again with no speaker, it is the citation without one that is attested.
    let again = d
        .mark_document_own(mark("talks/pruning", &hash, None), &everyone())
        .ctx("mark again")?;
    ensure(again.wrote, "a mark with another speaker is a new mark")?;
    ensure_eq(
        standing_of(d, &decl, "none", &plain())?,
        Standing::Attested,
        "no speaker on both sides",
    )?;
    ensure_eq(
        standing_of(d, &decl, "gardener", &plain())?,
        Standing::Unverified,
        "the speaker moved",
    )?;
    pass()
}

fn changed_document(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    let first = document(
        d,
        "journal/roses",
        &["space"],
        "Prune roses in late winter.\n",
    )?;
    let marked_first = document(
        d,
        "talks/pruning",
        &["space"],
        "Prune roses in late winter.\n",
    )?;
    put(
        d,
        &decl,
        "own",
        body(ROSES, "north"),
        &["space"],
        Some(cites("journal/roses", &first, None)),
    )
    .ctx("a put citing an own collection's document")?;
    put(
        d,
        &decl,
        "marked",
        body("Roses want morning sun.", "east"),
        &["space"],
        Some(cites("talks/pruning", &marked_first, None)),
    )
    .ctx("a put citing a marked document")?;
    d.mark_document_own(mark("talks/pruning", &marked_first, None), &everyone())
        .ctx("mark")?;
    ensure_eq(
        standing_of(d, &decl, "own", &journal())?,
        Standing::Attested,
        "attested",
    )?;
    ensure_eq(
        standing_of(d, &decl, "marked", &journal())?,
        Standing::Attested,
        "attested",
    )?;
    // Each document changes: the evidence names the old content.
    let second = document(
        d,
        "journal/roses",
        &["space"],
        "Prune roses in late winter. Mulch after.\n",
    )?;
    let marked_second = document(
        d,
        "talks/pruning",
        &["space"],
        "Prune roses in late winter. Feed in spring.\n",
    )?;
    for id in ["own", "marked"] {
        ensure_eq(
            label(d, &decl, id, &journal(), &everyone())?,
            StandingLabel {
                standing: Standing::Unverified,
                affirmed: None,
                source: None,
            },
            "a changed document lapses the attestation of the records that cite it",
        )?;
    }
    ensure_eq(
        d.document_own("talks/pruning", &journal(), &everyone())
            .ctx("document_own")?,
        None,
        "a replaced document keeps its mark row, which no longer matches",
    )?;
    // Citing the old content again is refused; citing the new content restores it.
    expect_err(
        put(
            d,
            &decl,
            "own",
            body(ROSES, "north"),
            &["space"],
            Some(cites("journal/roses", &first, None)),
        ),
        "evidence naming the content the document no longer has",
        evidence_invalid,
    )?;
    put(
        d,
        &decl,
        "own",
        body(ROSES, "north"),
        &["space"],
        Some(cites("journal/roses", &second, None)),
    )
    .ctx("cite the new content")?;
    ensure_eq(
        standing_of(d, &decl, "own", &journal())?,
        Standing::Attested,
        "a second put with evidence restores it",
    )?;
    // The marked document needs both: the new citation and a mark on the new content.
    put(
        d,
        &decl,
        "marked",
        body("Roses want morning sun.", "east"),
        &["space"],
        Some(cites("talks/pruning", &marked_second, None)),
    )
    .ctx("cite the new content")?;
    ensure_eq(
        standing_of(d, &decl, "marked", &journal())?,
        Standing::Unverified,
        "the mark was made on the old content",
    )?;
    expect_err(
        d.mark_document_own(mark("talks/pruning", &marked_first, None), &everyone()),
        "a mark naming content the document no longer has",
        conflict,
    )?;
    d.mark_document_own(mark("talks/pruning", &marked_second, None), &everyone())
        .ctx("mark the new content")?;
    ensure_eq(
        standing_of(d, &decl, "marked", &journal())?,
        Standing::Attested,
        "marked again",
    )?;
    // A document put back to the content a citation names is that content again.
    document(
        d,
        "journal/roses",
        &["space"],
        "Prune roses in late winter.\n",
    )?;
    ensure_eq(
        standing_of(d, &decl, "own", &journal())?,
        Standing::Unverified,
        "the citation names the second content",
    )?;
    document(
        d,
        "journal/roses",
        &["space"],
        "Prune roses in late winter. Mulch after.\n",
    )?;
    ensure_eq(
        standing_of(d, &decl, "own", &journal())?,
        Standing::Attested,
        "and holds for it again",
    )?;
    // A deleted document attests nothing, and loses its mark for good.
    d.delete_document(
        "talks/pruning",
        Expect::Any,
        samples::envelope(&["space"], "sync", AT),
    )
    .ctx("delete_document")?;
    ensure_eq(
        standing_of(d, &decl, "marked", &journal())?,
        Standing::Unverified,
        "the document is gone",
    )?;
    document(
        d,
        "talks/pruning",
        &["space"],
        "Prune roses in late winter. Feed in spring.\n",
    )?;
    ensure_eq(
        standing_of(d, &decl, "marked", &journal())?,
        Standing::Unverified,
        "a document stored again is not the one the person marked",
    )?;
    expect_err(
        d.unmark_document_own("talks/pruning", DECIDED_AT, None, &everyone()),
        "an unmark of a document whose mark went with it",
        not_found,
    )?;
    pass()
}

fn marks(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    let hash = document(
        d,
        "talks/pruning",
        &["space"],
        "Prune roses in late winter.\n",
    )?;
    let hidden = document(
        d,
        "talks/private",
        &["group:other"],
        "Roses want morning sun.\n",
    )?;
    put(
        d,
        &decl,
        "a",
        body(ROSES, "north"),
        &["space"],
        Some(cites("talks/pruning", &hash, None)),
    )
    .ctx("a cited put")?;
    let head = d.head().ctx("head")?;
    let documents = d
        .last_readable_document(head, &everyone())
        .ctx("position")?;
    // The mark's first two checks.
    for (doc, hash) in [("talks/private", &hidden), ("talks/absent", &hash)] {
        expect_err(
            d.mark_document_own(mark(doc, hash, None), &everyone()),
            "a mark on a document its reader may not read",
            not_found,
        )?;
    }
    match d.mark_document_own(mark("talks/pruning", &hidden, None), &everyone()) {
        Err(StoreError::Conflict { current }) => ensure_eq(
            current,
            Some(hash.as_str().to_owned()),
            "the conflict names the content the document has",
        )?,
        other => return Err(format!("a mark naming other content: {other:?}")),
    }
    expect_err(
        d.mark_document_own(
            mark("talks/pruning", &hash, None),
            &ReaderFilter::derivation(),
        ),
        "a mark with no reader",
        invalid,
    )?;
    expect_err(
        d.mark_document_own(mark("talks/pruning", &hash, Some("")), &everyone()),
        "a mark with an empty speaker",
        invalid,
    )?;
    ensure_eq(d.head().ctx("head")?, head, "a refused mark writes nothing")?;
    ensure_eq(
        standing_of(d, &decl, "a", &plain())?,
        Standing::Unverified,
        "nothing is marked",
    )?;
    // A mark takes a revision and writes a `standing` change on the document's id.
    let marked = d
        .mark_document_own(mark("talks/pruning", &hash, None), &everyone())
        .ctx("mark")?;
    ensure_eq(
        (marked.rev, marked.wrote),
        (head + 1, true),
        "the mark's revision",
    )?;
    ensure_eq(
        standing_of(d, &decl, "a", &plain())?,
        Standing::Attested,
        "every record that cites the document word for word reads attested at once",
    )?;
    let changes = d.changes(head, 10, &everyone(), None).ctx("changes")?;
    ensure_eq(changes.len(), 1, "one change for the mark")?;
    ensure_eq(
        (
            changes[0].kind,
            changes[0].target.as_str(),
            changes[0].content_hash.clone(),
            changes[0].trace_id.as_deref(),
        ),
        (ChangeKind::Standing, "talks/pruning", None, Some("mark")),
        "the mark's change",
    )?;
    ensure_eq(
        d.last_readable_document(d.head().ctx("head")?, &everyone())
            .ctx("position")?,
        documents,
        "a mark is not a change to a document: no sealed position moves",
    )?;
    // A mark that changes nothing answers the stored revision.
    let again = d
        .mark_document_own(mark("talks/pruning", &hash, None), &everyone())
        .ctx("mark again")?;
    ensure_eq(
        (again.rev, again.wrote),
        (head + 1, false),
        "a repeated mark writes nothing",
    )?;
    ensure_eq(d.head().ctx("head")?, head + 1, "nothing more was written")?;
    // Unmarking: a reader who may not read the document cannot, and the mark stands.
    expect_err(
        d.unmark_document_own("talks/pruning", DECIDED_AT, None, &reader(&["group:other"])),
        "an unmark by a reader who may not read the document",
        not_found,
    )?;
    ensure_eq(
        standing_of(d, &decl, "a", &plain())?,
        Standing::Attested,
        "the mark stands",
    )?;
    let unmarked = d
        .unmark_document_own("talks/pruning", DECIDED_AT, Some("unmark"), &everyone())
        .ctx("unmark")?;
    ensure_eq(unmarked, head + 2, "an unmark takes the next revision")?;
    ensure_eq(
        label(d, &decl, "a", &plain(), &everyone())?,
        StandingLabel {
            standing: Standing::Unverified,
            affirmed: None,
            source: None,
        },
        "the records that cited it read unverified again, with nothing written to them",
    )?;
    ensure_eq(
        d.changes(head + 1, 10, &everyone(), None)
            .ctx("changes")?
            .iter()
            .map(|change| (change.kind, change.target.clone(), change.trace_id.clone()))
            .collect::<Vec<_>>(),
        vec![(
            ChangeKind::Standing,
            "talks/pruning".to_owned(),
            Some("unmark".to_owned()),
        )],
        "the unmark's change",
    )?;
    expect_err(
        d.unmark_document_own("talks/pruning", DECIDED_AT, None, &everyone()),
        "an unmark with no mark",
        not_found,
    )?;
    ensure_eq(d.head().ctx("head")?, head + 2, "which writes nothing")?;
    pass()
}

fn command_writable(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    let hash = document(
        d,
        "wiki/pruning",
        &["space"],
        "Prune roses in late winter.\n",
    )?;
    put(
        d,
        &decl,
        "a",
        body(ROSES, "north"),
        &["space"],
        Some(cites("wiki/pruning", &hash, None)),
    )
    .ctx("a cited put")?;
    d.mark_document_own(mark("wiki/pruning", &hash, None), &everyone())
        .ctx("mark")?;
    ensure_eq(
        standing_of(d, &decl, "a", &plain())?,
        Standing::Attested,
        "the mark counts",
    )?;
    let head = d.head().ctx("head")?;
    // The configuration changes: a command can now write files where the document lies.
    let writable = view(&[], &["notes", "wiki"], ALL);
    ensure_eq(
        label(d, &decl, "a", &writable, &everyone())?,
        StandingLabel {
            standing: Standing::Unverified,
            affirmed: None,
            source: None,
        },
        "a mark on a document of a command-writable collection does not count",
    )?;
    ensure_eq(
        d.document_own("wiki/pruning", &writable, &everyone())
            .ctx("document_own")?,
        None,
        "and the document is not the person's own",
    )?;
    let only = view(
        &[],
        &["notes", "wiki"],
        &[Standing::Attested, Standing::Affirmed],
    );
    ensure_eq(
        find(d, &decl, &find_all(&decl), &only, &everyone())?.total,
        Some(0),
        "nor is the record admitted as verified",
    )?;
    // Another collection being command-writable changes nothing, and the mark was not deleted:
    // it counts again when the collection is no longer one.
    ensure_eq(
        standing_of(d, &decl, "a", &view(&[], &["notes"], ALL))?,
        Standing::Attested,
        "a mark counts where no command writes files",
    )?;
    ensure_eq(d.head().ctx("head")?, head, "none of this wrote anything")?;
    pass()
}

fn rebuild_clears(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    let hash = document(
        d,
        "journal/roses",
        &["space"],
        "Prune roses in late winter.\n",
    )?;
    for (id, statement) in [("edited", ROSES), ("kept", "Roses want morning sun.")] {
        put(
            d,
            &decl,
            id,
            body(statement, "north"),
            &["space"],
            Some(cites("journal/roses", &hash, None)),
        )
        .ctx("a cited put")?;
        d.decide_record(
            NS,
            &decl,
            id,
            decision(Decision::Affirm),
            &plain(),
            &everyone(),
        )
        .ctx("affirm")?;
    }
    // A version of the plugin that does not declare the kind rewrites one wording.
    d.put_record(
        NS,
        "note",
        "edited",
        body("Prune roses in early spring.", "north"),
        samples::envelope(&["space"], "edit", AT),
        Expect::Any,
    )
    .ctx("an undeclared edit")?;
    expect_err(
        d.decide_record(
            NS,
            &decl,
            "kept",
            decision(Decision::Withdraw),
            &plain(),
            &everyone(),
        ),
        "a decision on a stale kind",
        |error| matches!(error, StoreError::LaneStale),
    )?;
    let report = d
        .reindex_records(NS, &decl, &no_scan, None, false)
        .ctx("a rebuild")?;
    ensure_eq(
        (report.records, report.wordings_changed, report.superseded),
        (2, 1, false),
        "the rebuild counts the wording that changed",
    )?;
    ensure_eq(
        label(d, &decl, "edited", &journal(), &everyone())?,
        StandingLabel {
            standing: Standing::Unverified,
            affirmed: None,
            source: None,
        },
        "the edited wording kept neither its affirmation nor its evidence",
    )?;
    let kept = label(d, &decl, "kept", &journal(), &everyone())?;
    ensure_eq(
        kept.standing,
        Standing::Affirmed,
        "the other record kept its affirmation",
    )?;
    ensure_eq(
        basis_of(&kept),
        Some(OwnBasis::Collection),
        "and its evidence",
    )?;
    let status = d.lane_status(NS, &decl).ctx("status")?;
    ensure_eq(
        (status.affirmed, status.evidence),
        (1, 1),
        "the status counts one of each",
    )?;
    // A kind whose `standing` changes and whose wording does not keeps what the person
    // decided: declared without standing and then with it again, the record reads affirmed.
    let without = RecordDecl {
        standing: false,
        ..decl.clone()
    };
    let report = d
        .reindex_records(NS, &without, &no_scan, None, false)
        .ctx("without standing")?;
    ensure_eq(report.wordings_changed, 0, "no wording changed")?;
    ensure(
        read(d, &without, "kept", &plain(), &everyone())?
            .ok_or("the record is read")?
            .label
            .is_none(),
        "a kind without standing carries no label",
    )?;
    // While it is without standing a put may change the wording, and that clears what stood
    // on the old one.
    document(d, "journal/sun", &["space"], "Roses want morning sun.\n")?;
    put(
        d,
        &without,
        "edited",
        body("Prune roses when the forsythia blooms.", "north"),
        &["space"],
        None,
    )
    .ctx("a put on a kind without standing")?;
    put(
        d,
        &without,
        "kept",
        body("Roses want afternoon sun.", "north"),
        &["space"],
        None,
    )
    .ctx("a wording changed while the kind has no standing")?;
    put(
        d,
        &without,
        "kept",
        body("Roses want morning sun.", "north"),
        &["space"],
        None,
    )
    .ctx("and changed back")?;
    let report = d
        .reindex_records(NS, &decl, &no_scan, None, false)
        .ctx("with standing again")?;
    ensure_eq(
        report.wordings_changed,
        0,
        "the rebuild found no wording changed",
    )?;
    ensure_eq(
        label(d, &decl, "kept", &journal(), &everyone())?,
        StandingLabel {
            standing: Standing::Unverified,
            affirmed: None,
            source: None,
        },
        "an affirmation is of a wording that never moved: one that moved and came back lost it",
    )?;
    ensure_eq(
        d.lane_status(NS, &decl).ctx("status")?.state,
        LaneState::Ready,
        "the kind is ready",
    )?;
    pass()
}

/// Four records, one of each standing a record can have, and one that is both affirmed and
/// attested: `u` unverified, `t` attested, `a` affirmed, `b` both.
fn four(d: &dyn DocumentStore, decl: &RecordDecl) -> Result<(), String> {
    let hash = document(
        d,
        "journal/roses",
        &["space"],
        "Prune roses in late winter.\n",
    )?;
    for (id, statement, cited) in [
        ("a", "Mulch the roses in autumn.", false),
        ("b", "Feed the roses in spring.", true),
        ("t", "Prune roses in late winter.", true),
        ("u", "Roses want morning sun.", false),
    ] {
        let evidence = cited.then(|| cites("journal/roses", &hash, None));
        put(d, decl, id, body(statement, "north"), &["space"], evidence).ctx("a put")?;
    }
    for id in ["a", "b"] {
        d.decide_record(
            NS,
            decl,
            id,
            decision(Decision::Affirm),
            &plain(),
            &everyone(),
        )
        .ctx("affirm")?;
    }
    Ok(())
}

fn admit_narrows(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    four(d, &decl)?;
    use Standing::{Affirmed, Attested, Unverified};
    for (admit, expected) in [
        (
            &[Unverified, Attested, Affirmed][..],
            &["a", "b", "t", "u"][..],
        ),
        (&[Affirmed][..], &["a", "b"][..]),
        (&[Attested, Affirmed][..], &["a", "b", "t"][..]),
        (&[Unverified][..], &["u"][..]),
        (&[Attested][..], &["t"][..]),
        (&[Unverified, Attested][..], &["t", "u"][..]),
        (&[Unverified, Affirmed][..], &["a", "b", "u"][..]),
        (&[][..], &[][..]),
    ] {
        let narrowed = view(&[("journal", None)], &[], admit);
        for order in [FindOrder::Id, FindOrder::Recent] {
            let page = find(
                d,
                &decl,
                &RecordFind {
                    order,
                    ..find_all(&decl)
                },
                &narrowed,
                &everyone(),
            )?;
            let mut found = ids(&page);
            found.sort_unstable();
            ensure_eq(
                found,
                expected.to_vec(),
                "a find returns only what the view admits",
            )?;
            ensure_eq(
                page.total,
                Some(expected.len() as u64),
                "and counts only that",
            )?;
            ensure_eq(
                page.admitted.clone(),
                admit.to_vec(),
                "the page says what was admitted",
            )?;
        }
        let ranked = RecordFind {
            text: text("roses"),
            order: FindOrder::Rank,
            ..find_all(&decl)
        };
        let page = find(d, &decl, &ranked, &narrowed, &everyone())?;
        let mut found = ids(&page);
        found.sort_unstable();
        ensure_eq(
            found,
            expected.to_vec(),
            "a ranked find's candidates are admitted records",
        )?;
        ensure_eq(
            page.total,
            Some(expected.len() as u64),
            "and its total counts them",
        )?;
        for id in ["a", "b", "t", "u"] {
            ensure_eq(
                read(d, &decl, id, &narrowed, &everyone())?.is_some(),
                expected.contains(&id),
                "a read returns a record only when the view admits it",
            )?;
        }
        // A match: every record says `roses`, and `t` is the text itself.
        let result = matched(
            d,
            &decl,
            "Prune roses in late winter.",
            &narrowed,
            &everyone(),
        )?;
        let mut found = hit_ids(&result.nearest);
        found.sort_unstable();
        ensure_eq(
            found,
            expected.to_vec(),
            "a match's nearest are admitted records",
        )?;
        ensure_eq(
            hit_ids(&result.identical),
            if expected.contains(&"t") {
                vec!["t"]
            } else {
                Vec::new()
            },
            "an identical record is given only when the view admits it",
        )?;
    }
    // The same record under a view without the own collection: `t` is unverified there, so
    // what a view admits follows what the configuration says is the person's own.
    let no_own = view(&[], &[], &[Attested, Affirmed]);
    ensure_eq(
        ids(&find(d, &decl, &find_all(&decl), &no_own, &everyone())?),
        vec!["a", "b"],
        "attested is computed under the view of the read",
    )?;
    // Statistics count only admitted records. Three affirmed records and two unverified ones,
    // chosen so that counting the two in any statistic changes the order of the three: a
    // ranked page carries no score, so only its order can show what was counted.
    let affirmed = [
        ("m1", "Mulch."),
        ("m2", "Straw."),
        ("m3", "Mulch, mulch, soil."),
    ];
    let unverified = [
        ("n1", "Mulch soil soil soil soil soil soil soil soil."),
        ("n2", "Mulch soil soil soil soil soil soil soil soil."),
    ];
    let mulch = RecordDecl {
        kind: "mulch".to_owned(),
        ..decl.clone()
    };
    let mut own = Vec::new();
    let mut every = Vec::new();
    for (id, statement) in affirmed {
        let done = put(
            d,
            &mulch,
            id,
            json!({ "statement": statement }),
            &["space"],
            None,
        )
        .ctx("put")?;
        d.decide_record(
            NS,
            &mulch,
            id,
            decision(Decision::Affirm),
            &plain(),
            &everyone(),
        )
        .ctx("affirm")?;
        own.push((id.to_owned(), done.meta.rev, statement.to_owned()));
    }
    every.extend(own.iter().cloned());
    for (id, statement) in unverified {
        let done = put(
            d,
            &mulch,
            id,
            json!({ "statement": statement }),
            &["space"],
            None,
        )
        .ctx("put")?;
        every.push((id.to_owned(), done.meta.rev, statement.to_owned()));
    }
    let query = "mulch straw";
    let expected = ranked_by_the_formulas(query, &own, &own);
    ensure(
        expected != ranked_by_the_formulas(query, &own, &every),
        "the case has teeth: counting the unverified records would change the order",
    )?;
    let ranked = RecordFind {
        text: text(query),
        order: FindOrder::Rank,
        ..find_all(&mulch)
    };
    let page = find(
        d,
        &mulch,
        &ranked,
        &view(&[], &[], &[Affirmed]),
        &everyone(),
    )?;
    ensure_eq(
        ids(&page)
            .into_iter()
            .map(str::to_owned)
            .collect::<Vec<_>>(),
        expected,
        "the order is the one the admitted records give",
    )?;
    ensure_eq(page.total, Some(3), "and the total is theirs")?;
    // A match's scores are over the admitted records too: its corpus, its tokens and each
    // term's count.
    let statements = |records: &[(String, u64, String)]| -> Vec<(String, String)> {
        records
            .iter()
            .map(|(id, _, statement)| (id.clone(), statement.clone()))
            .collect()
    };
    let (affirmed_only, all_five) = (statements(&own), statements(&every));
    let by = |records: &[(String, String)], corpus: &[(String, String)]| {
        by_the_formulas(query, records, corpus, MATCH_POOL, MAX_MATCH_K as usize)
    };
    ensure(
        by(&affirmed_only, &affirmed_only) != by(&affirmed_only, &all_five),
        "the case has teeth: counting the unverified records would change a score",
    )?;
    ensure_eq(
        near(&matched(
            d,
            &mulch,
            query,
            &view(&[], &[], &[Affirmed]),
            &everyone(),
        )?),
        by(&affirmed_only, &affirmed_only),
        "a match's scores are the ones the admitted records give",
    )?;
    ensure_eq(
        near(&matched(d, &mulch, query, &plain(), &everyone())?),
        by(&all_five, &all_five),
        "a view that admits every record is scored over every record",
    )?;
    let page = find(d, &mulch, &ranked, &plain(), &everyone())?;
    ensure_eq(
        ids(&page)
            .into_iter()
            .map(str::to_owned)
            .collect::<Vec<_>>(),
        ranked_by_the_formulas(query, &every, &every),
        "a view that admits every record is ranked over every record",
    )?;
    // Eight unverified records identical to the affirmed `m1`, whose ids come before it: a
    // record the view does not admit takes none of the eight places an identical list has.
    for index in 0..8 {
        put(
            d,
            &mulch,
            &format!("c{index}"),
            json!({ "statement": "Mulch." }),
            &["space"],
            None,
        )
        .ctx("put")?;
    }
    ensure_eq(
        hit_ids(
            &matched(
                d,
                &mulch,
                "Mulch.",
                &view(&[], &[], &[Affirmed]),
                &everyone(),
            )?
            .identical,
        ),
        vec!["m1"],
        "identical records the view does not admit take no place among the eight",
    )?;
    ensure_eq(
        hit_ids(&matched(d, &mulch, "Mulch.", &plain(), &everyone())?.identical).len(),
        8,
        "a view that admits them is given eight",
    )?;
    pass()
}

fn evidence_checked(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    let hash = document(
        d,
        "journal/roses",
        &["space"],
        "Prune roses in late winter.\n",
    )?;
    let other = document(d, "journal/sun", &["space"], "Roses want morning sun.\n")?;
    let hidden = document(
        d,
        "journal/private",
        &["group:hidden"],
        "Mulch the roses in autumn.\n",
    )?;
    let head = d.head().ctx("head")?;
    let refused = |evidence: Evidence| -> Result<String, String> {
        match put(
            d,
            &decl,
            "a",
            body(ROSES, "north"),
            &["space"],
            Some(evidence),
        ) {
            Err(StoreError::EvidenceInvalid(rule)) => Ok(rule),
            other => Err(format!("expected the evidence to be refused: {other:?}")),
        }
    };
    // A document that is absent, one the writer may not read and one with another content
    // hash get one answer: the refusal says nothing of a document the writer may not read.
    let absent = refused(cites("journal/absent", &hash, None))?;
    let unreadable = refused(cites("journal/private", &hidden, None))?;
    let wrong = refused(cites("journal/roses", &other, None))?;
    ensure_eq(
        unreadable.clone(),
        absent.clone(),
        "unreadable and absent alike",
    )?;
    ensure_eq(wrong, absent, "and another content hash alike")?;
    ensure(
        !unreadable.contains("journal/private") && !unreadable.contains(hidden.as_str()),
        "the refusal names no document and no hash",
    )?;
    // Its shape, each rule named and no value.
    let shaped = |change: &dyn Fn(&mut Evidence)| -> Result<String, String> {
        let mut evidence = cites("journal/roses", &hash, None);
        change(&mut evidence);
        refused(evidence)
    };
    for (rule, change) in [
        (
            "units",
            &(|e: &mut Evidence| e.units = Vec::new()) as &dyn Fn(&mut Evidence),
        ),
        ("units", &|e: &mut Evidence| e.units = vec![0, 1]),
        ("units", &|e: &mut Evidence| e.units = vec![3, 2]),
        ("units", &|e: &mut Evidence| e.units = vec![2, 2]),
        ("units", &|e: &mut Evidence| e.units = (1..=257).collect()),
        ("rule", &|e: &mut Evidence| e.rule = "sentences".to_owned()),
        ("rule", &|e: &mut Evidence| {
            e.rule = "Sentences/1".to_owned()
        }),
        ("rule", &|e: &mut Evidence| {
            e.rule = "sentences/1234567".to_owned()
        }),
        ("rule", &|e: &mut Evidence| {
            e.rule = "sentences/v1".to_owned()
        }),
        ("speaker", &|e: &mut Evidence| {
            e.speaker = Some(String::new())
        }),
        ("speaker", &|e: &mut Evidence| {
            e.speaker = Some("canary\u{7}speaker".to_owned())
        }),
        ("speaker", &|e: &mut Evidence| {
            e.speaker = Some("x".repeat(129))
        }),
        ("doc", &|e: &mut Evidence| e.doc = String::new()),
    ] {
        let why = shaped(change)?;
        ensure(
            why.starts_with(rule),
            &format!("the refusal names {rule}: {why}"),
        )?;
        ensure(!why.contains("canary"), "and never a value")?;
    }
    ensure_eq(d.head().ctx("head")?, head, "a refused put writes nothing")?;
    ensure(
        read(d, &decl, "a", &plain(), &writer())?.is_none(),
        "the record was not written",
    )?;
    // A put with evidence is stored; one without leaves the stored evidence; one with another
    // replaces it.
    put(
        d,
        &decl,
        "a",
        body(ROSES, "north"),
        &["space"],
        Some(cites("journal/roses", &hash, None)),
    )
    .ctx("a cited put")?;
    put(d, &decl, "a", body(ROSES, "south"), &["space"], None).ctx("a put without evidence")?;
    ensure_eq(
        standing_of(d, &decl, "a", &journal())?,
        Standing::Attested,
        "a put without evidence leaves the stored evidence as it is",
    )?;
    // A refused citation leaves the stored one in place too.
    refused(cites("journal/absent", &hash, None))?;
    ensure_eq(
        standing_of(d, &decl, "a", &journal())?,
        Standing::Attested,
        "still attested",
    )?;
    ensure_eq(
        d.lane_status(NS, &decl).ctx("status")?.evidence,
        1,
        "one evidence row",
    )?;
    // Evidence is for a standing kind.
    let bed = RecordDecl {
        kind: "bed".to_owned(),
        standing: false,
        ..decl.clone()
    };
    expect_err(
        put(
            d,
            &bed,
            "north",
            body("The north bed.", "north"),
            &["space"],
            Some(cites("journal/roses", &hash, None)),
        ),
        "evidence on a kind without standing",
        invalid,
    )?;
    pass()
}

fn basis_alone(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    // A document the reader `everyone` may not read, in an own collection and in one that is
    // not, each cited by a record that reader may read.
    // Each document says when the host stored it and when it was generated, at times no record
    // of the case carries.
    let dated = |id: &str, text: &str| -> Result<ContentHash, String> {
        let mut write = samples::document(id, &["group:other"], text, "sync");
        write.envelope.observed_at = "2026-10-01T06:00:00.000Z".to_owned();
        write.envelope.generated = Some(ByAt {
            by: "human:local".to_owned(),
            at: "2026-09-15T05:00:00.000Z".to_owned(),
        });
        let hash = write.content_hash.clone();
        d.put_document_held(write, Expect::Any)
            .ctx("put_document_held")?;
        Ok(hash)
    };
    let own_hash = dated(
        "journal/private",
        "canary-own-text: prune roses in late winter.\n",
    )?;
    let marked_hash = dated(
        "talks/private",
        "canary-marked-text: roses want morning sun.\n",
    )?;
    put(
        d,
        &decl,
        "own",
        body(ROSES, "north"),
        &["space"],
        Some(cites("journal/private", &own_hash, None)),
    )
    .ctx("a put citing an unreadable own document")?;
    let mut spoken = cites("talks/private", &marked_hash, Some("canary-speaker"));
    spoken.rule = "canary-rule/7".to_owned();
    put(
        d,
        &decl,
        "marked",
        body("Roses want morning sun.", "east"),
        &["space"],
        Some(spoken),
    )
    .ctx("a put citing an unreadable marked document")?;
    d.mark_document_own(
        mark("talks/private", &marked_hash, Some("canary-speaker")),
        &writer(),
    )
    .ctx("mark")?;
    for (id, basis, doc, hash) in [
        ("own", "collection", "journal/private", &own_hash),
        ("marked", "marked", "talks/private", &marked_hash),
    ] {
        let hidden = read(d, &decl, id, &journal(), &everyone())?.ok_or("the record is read")?;
        let shown = hidden.label.clone().ok_or("a label")?;
        ensure_eq(
            shown.to_json(),
            json!({
                "standing": "attested",
                "affirmed": null,
                "source": {
                    "doc": null, "contentHash": null, "basis": basis, "speaker": null,
                    "units": null, "rule": null, "storedAt": null, "generatedAt": null,
                },
            }),
            "a reader who may not read the cited document sees the basis and nothing else",
        )?;
        // A match's hit carries that same label, and nothing more of the document.
        let statement = hidden.record.body["statement"]
            .as_str()
            .ok_or("a statement")?;
        let result = matched(d, &decl, statement, &journal(), &everyone())?;
        let hit = result
            .identical
            .iter()
            .find(|hit| hit.id == id)
            .ok_or("the record is identical to its own statement")?;
        ensure_eq(
            hit.label.as_ref(),
            Some(&shown),
            "a hit shows the basis alone to a reader who may not read the cited document",
        )?;
        ensure(
            result
                .nearest
                .iter()
                .any(|near| near.id == id && near.label.as_ref() == Some(&shown)),
            "in the nearest as in the identical",
        )?;
        let text = canonical_json(&hidden.to_json());
        for secret in [
            doc,
            hash.as_str(),
            "canary",
            "sentences/1",
            "2026-10-01T06:00:00.000Z",
            "2026-09-15T05:00:00.000Z",
        ] {
            ensure(
                !text.contains(secret),
                &format!(
                    "the record as that reader sees it holds nothing of the document ({secret})"
                ),
            )?;
        }
        // A reader of the document sees all of it.
        let seen = label(d, &decl, id, &journal(), &writer())?;
        let source = seen.source.ok_or("a source")?;
        let seen = source
            .seen
            .ok_or("a reader of the document sees the source")?;
        ensure_eq(
            (seen.doc.as_str(), &seen.content_hash),
            (doc, hash),
            "the cited document",
        )?;
        ensure_eq(seen.units, vec![2, 3], "its units")?;
        ensure_eq(
            (seen.stored_at.as_str(), seen.generated_at.as_deref()),
            ("2026-10-01T06:00:00.000Z", Some("2026-09-15T05:00:00.000Z")),
            "and its two dates",
        )?;
    }
    // `document_own` answers nothing of a document its reader may not read.
    ensure_eq(
        d.document_own("journal/private", &journal(), &everyone())
            .ctx("document_own")?,
        None,
        "an unreadable document is not said to be anyone's",
    )?;
    ensure(
        d.document_own("journal/private", &journal(), &writer())
            .ctx("document_own")?
            .is_some(),
        "its reader is told",
    )?;
    pass()
}

fn held_to_file(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    // A command stored these while `journal` was not the person's own: one with no file at
    // all, one that differs from its file. Nothing held either to a file. Records cite them.
    let text = "Prune roses whenever an agent says so.\n";
    let hash = unheld(d, "journal/unfiled", &["space"], text)?;
    put(
        d,
        &decl,
        "a",
        body(ROSES, "north"),
        &["space"],
        Some(cites("journal/unfiled", &hash, None)),
    )
    .ctx("a put citing a document nothing held to a file")?;
    ensure_eq(
        d.unheld_documents("journal").ctx("unheld_documents")?,
        1,
        "the document is counted as not held",
    )?;
    // The deployer names the collection as the person's own. That alone attests nothing.
    let verified = view(
        &[("journal", None)],
        &[],
        &[Standing::Attested, Standing::Affirmed],
    );
    let not_own = |what: &str| -> Result<(), String> {
        ensure_eq(
            label(d, &decl, "a", &journal(), &everyone())?,
            StandingLabel {
                standing: Standing::Unverified,
                affirmed: None,
                source: None,
            },
            what,
        )?;
        ensure_eq(
            d.document_own("journal/unfiled", &journal(), &everyone())
                .ctx("document_own")?,
            None,
            "and the document is not the person's own",
        )?;
        ensure_eq(
            find(d, &decl, &find_all(&decl), &verified, &everyone())?.total,
            Some(0),
            "nor is the record verified content",
        )
    };
    not_own("a document stored before its collection was named own attests nothing")?;
    // The host holds a document to its file at one content: another hash, and a document that
    // is not stored, are not held.
    let other = ContentHash::of(b"Roses want morning sun.\n");
    ensure(
        !d.hold_document("journal/unfiled", &other)
            .ctx("hold_document")?,
        "a document is held only at the content it has",
    )?;
    ensure(
        !d.hold_document("journal/absent", &hash)
            .ctx("hold_document")?,
        "an absent document is not held",
    )?;
    not_own("a refused hold attests nothing")?;
    let head = d.head().ctx("head")?;
    ensure(
        d.hold_document("journal/unfiled", &hash)
            .ctx("hold_document")?,
        "the host held the document to its file",
    )?;
    ensure_eq(d.head().ctx("head")?, head, "which takes no revision")?;
    let held = label(d, &decl, "a", &journal(), &everyone())?;
    ensure_eq(
        held.standing,
        Standing::Attested,
        "held to its file, it attests",
    )?;
    ensure_eq(basis_of(&held), Some(OwnBasis::Collection), "by collection")?;
    ensure_eq(
        d.unheld_documents("journal").ctx("unheld_documents")?,
        0,
        "and is no longer counted",
    )?;
    ensure_eq(
        find(d, &decl, &find_all(&decl), &verified, &everyone())?.total,
        Some(1),
        "the record is verified content where attested is admitted",
    )?;
    // A put that nothing held to a file clears the fact, even of the same content: what was
    // held is what was read from disk then.
    unheld(d, "journal/unfiled", &["space"], text)?;
    not_own("a document a command put again is not held")?;
    document(d, "journal/unfiled", &["space"], text)?;
    ensure_eq(
        standing_of(d, &decl, "a", &journal())?,
        Standing::Attested,
        "a put the host held to its file is",
    )?;
    // A deleted document loses the fact with its row.
    d.delete_document(
        "journal/unfiled",
        Expect::Any,
        samples::envelope(&["space"], "sync", AT),
    )
    .ctx("delete_document")?;
    unheld(d, "journal/unfiled", &["space"], text)?;
    not_own("a document stored again is not the one that was held")?;
    // A mark is the person's own say-so: it counts in an own collection too, and says so.
    d.mark_document_own(mark("journal/unfiled", &hash, None), &everyone())
        .ctx("mark")?;
    let marked = label(d, &decl, "a", &journal(), &everyone())?;
    ensure_eq(
        basis_of(&marked),
        Some(OwnBasis::Marked),
        "marked and not held, the basis is the mark",
    )?;
    ensure_eq(
        d.document_own("journal/unfiled", &journal(), &everyone())
            .ctx("document_own")?
            .map(|own| own.basis),
        Some(OwnBasis::Marked),
        "for the document too",
    )?;
    pass()
}

/// The view's `levels` (the Ideas host-review specification, section 6.5): a call for verified
/// content admits an affirmation, and an attestation through a person's mark, only at a level
/// the space lists; a record affirmed or attested only through a mark at another level is
/// admitted at no standing, not read as attested in its place. A decision on the
/// local page (`local`) is stored as any other.
fn levels_admit(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    let hash = document(
        d,
        "talks/pruning",
        &["space"],
        "Prune roses in late winter.\n",
    )?;
    d.mark_document_own(mark("talks/pruning", &hash, None), &everyone())
        .ctx("mark")?;
    let cited = || Some(cites("talks/pruning", &hash, None));
    // A document the person marked on the local page, and a record attested only through it.
    let sun = document(d, "talks/sun", &["space"], "Roses want morning sun.\n")?;
    d.mark_document_own(
        OwnMark {
            assurance: Assurance::local(),
            ..mark("talks/sun", &sun, None)
        },
        &everyone(),
    )
    .ctx("mark on the local page")?;
    put(
        d,
        &decl,
        "k",
        body(ROSES, "south"),
        &["space"],
        Some(cites("talks/sun", &sun, None)),
    )
    .ctx("put k")?;
    put(d, &decl, "t", body(ROSES, "north"), &["space"], None).ctx("put t")?;
    put(d, &decl, "l", body(ROSES, "east"), &["space"], cited()).ctx("put l")?;
    put(d, &decl, "m", body(ROSES, "west"), &["space"], cited()).ctx("put m")?;
    d.decide_record(
        NS,
        &decl,
        "t",
        decision(Decision::Affirm),
        &plain(),
        &everyone(),
    )
    .ctx("affirm at a terminal")?;
    d.decide_record(
        NS,
        &decl,
        "l",
        RecordDecision {
            assurance: Assurance::local(),
            ..decision(Decision::Affirm)
        },
        &plain(),
        &everyone(),
    )
    .ctx("affirm on the local page")?;
    let ids = |page: FindPage| -> Vec<String> {
        page.items
            .iter()
            .map(|item| item.record.id.clone())
            .collect()
    };
    let of = |admit: &[Standing], levels: &[&str]| StandingView {
        admit: admit.to_vec(),
        levels: levels.iter().map(|level| (*level).to_owned()).collect(),
        ..plain()
    };
    let verified = &[Standing::Attested, Standing::Affirmed][..];
    let affirmed = &[Standing::Affirmed][..];
    for (admit, levels, want, why) in [
        (
            verified,
            &[][..],
            vec!["k", "l", "m", "t"],
            "no levels: every affirmation and mark",
        ),
        (
            verified,
            &["terminal", "verified"][..],
            vec!["m", "t"],
            "the default levels leave the local affirmation and the local mark out, and read neither as attested",
        ),
        (
            verified,
            &["terminal", "verified", "local"][..],
            vec!["k", "l", "m", "t"],
            "listed, both are admitted",
        ),
        (
            affirmed,
            &["terminal", "verified"][..],
            vec!["t"],
            "affirmed alone",
        ),
        (affirmed, &["local"][..], vec!["l"], "local alone"),
        (
            &[Standing::Attested][..],
            &["local"][..],
            vec!["k"],
            "attested only through the local mark",
        ),
        (
            &[Standing::Attested][..],
            &["terminal", "verified"][..],
            vec!["m"],
            "an affirmed record is never attested, nor one attested by a local mark",
        ),
    ] {
        let page = find(d, &decl, &find_all(&decl), &of(admit, levels), &everyone())?;
        ensure_eq(page.total, Some(want.len() as u64), why)?;
        ensure_eq(
            ids(page),
            want.iter().map(|id| (*id).to_owned()).collect::<Vec<_>>(),
            why,
        )?;
    }
    // A read by id under the default levels finds nothing of the local affirmation.
    ensure(
        read(
            d,
            &decl,
            "l",
            &of(verified, &["terminal", "verified"]),
            &everyone(),
        )?
        .is_none(),
        "a read by id leaves it out too",
    )?;
    ensure_eq(
        label(d, &decl, "l", &plain(), &everyone())?
            .affirmed
            .map(|affirmed| affirmed.level),
        Some("local".to_owned()),
        "its label says local",
    )?;
    pass()
}

fn former_person(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    const SUCCESSOR: &str = "human:successor";
    let of = |person: &[&str]| StandingView {
        person: person.iter().map(|id| (*id).to_owned()).collect(),
        ..plain()
    };
    let by = |person: &str, decision: Decision| RecordDecision {
        by: person.to_owned(),
        ..self::decision(decision)
    };
    let hash = document(
        d,
        "talks/pruning",
        &["space"],
        "Prune roses in late winter.\n",
    )?;
    put(d, &decl, "a", body(ROSES, "north"), &["space"], None).ctx("a put")?;
    put(
        d,
        &decl,
        "m",
        body("Roses want morning sun.", "east"),
        &["space"],
        Some(cites("talks/pruning", &hash, None)),
    )
    .ctx("a cited put")?;
    d.decide_record(
        NS,
        &decl,
        "a",
        by(PERSON, Decision::Affirm),
        &of(&[PERSON]),
        &everyone(),
    )
    .ctx("affirm")?;
    d.mark_document_own(mark("talks/pruning", &hash, None), &everyone())
        .ctx("mark")?;
    ensure_eq(
        standing_of(d, &decl, "a", &of(&[PERSON]))?,
        Standing::Affirmed,
        "affirmed by the space's person",
    )?;
    ensure_eq(
        standing_of(d, &decl, "m", &of(&[PERSON]))?,
        Standing::Attested,
        "attested by the person's mark",
    )?;
    // The space's person changes, or the space has none: what the former person decided is
    // set aside, with nothing written.
    let head = d.head().ctx("head")?;
    for person in [&[SUCCESSOR][..], &[][..]] {
        let now = of(person);
        for id in ["a", "m"] {
            ensure_eq(
                label(d, &decl, id, &now, &everyone())?,
                StandingLabel {
                    standing: Standing::Unverified,
                    affirmed: None,
                    source: None,
                },
                "a former person's decision and mark give no standing",
            )?;
        }
        ensure_eq(
            d.document_own("talks/pruning", &now, &everyone())
                .ctx("document_own")?,
            None,
            "nor is the document the person's own",
        )?;
        let verified = StandingView {
            admit: vec![Standing::Attested, Standing::Affirmed],
            ..now
        };
        ensure_eq(
            find(d, &decl, &find_all(&decl), &verified, &everyone())?.total,
            Some(0),
            "nor is either record verified content",
        )?;
    }
    ensure_eq(d.head().ctx("head")?, head, "none of this wrote anything")?;
    // A person named by more than one principal string decides as each of them.
    ensure_eq(
        standing_of(d, &decl, "a", &of(&[SUCCESSOR, PERSON]))?,
        Standing::Affirmed,
        "every identity of the space's person counts",
    )?;
    // The new person affirms and marks again: each is a new decision, in their name.
    let again = d
        .decide_record(
            NS,
            &decl,
            "a",
            by(SUCCESSOR, Decision::Affirm),
            &of(&[SUCCESSOR]),
            &everyone(),
        )
        .ctx("the new person affirms")?;
    ensure(
        again.rev.is_some(),
        "an affirmation of a record that does not read affirmed is written",
    )?;
    ensure_eq(
        again
            .label
            .affirmed
            .and_then(|affirmed| affirmed.seen)
            .map(|seen| seen.by),
        Some(SUCCESSOR.to_owned()),
        "in the new person's name",
    )?;
    ensure_eq(
        standing_of(d, &decl, "a", &of(&[PERSON]))?,
        Standing::Unverified,
        "which the former person's view does not count",
    )?;
    let remarked = d
        .mark_document_own(
            OwnMark {
                by: SUCCESSOR.to_owned(),
                ..mark("talks/pruning", &hash, None)
            },
            &everyone(),
        )
        .ctx("the new person marks")?;
    ensure(
        remarked.wrote,
        "a mark by another person is a new mark, on the same content",
    )?;
    ensure_eq(
        standing_of(d, &decl, "m", &of(&[SUCCESSOR]))?,
        Standing::Attested,
        "and counts for the new person",
    )?;
    // A withdrawal clears a former person's decision too.
    put(
        d,
        &decl,
        "w",
        body("Mulch the roses in autumn.", "west"),
        &["space"],
        None,
    )
    .ctx("a put")?;
    d.decide_record(
        NS,
        &decl,
        "w",
        by(PERSON, Decision::Affirm),
        &of(&[PERSON]),
        &everyone(),
    )
    .ctx("affirm")?;
    let withdrawn = d
        .decide_record(
            NS,
            &decl,
            "w",
            by(SUCCESSOR, Decision::Withdraw),
            &of(&[SUCCESSOR]),
            &everyone(),
        )
        .ctx("withdraw")?;
    ensure(
        withdrawn.rev.is_some(),
        "the new person withdraws what the former affirmed",
    )?;
    ensure_eq(
        standing_of(d, &decl, "w", &of(&[PERSON]))?,
        Standing::Unverified,
        "and it is withdrawn for every view",
    )?;
    pass()
}

/// Everything `who` reads of the kind under the own collection `journal`, as text: each record
/// by id under every admit set, every find with its total, and `document_own` of each document
/// named.
fn everything(
    d: &dyn DocumentStore,
    decl: &RecordDecl,
    records: &[&str],
    documents: &[&str],
    who: &ReaderFilter,
) -> Result<Vec<String>, String> {
    use Standing::{Affirmed, Attested, Unverified};
    let mut out = Vec::new();
    for admit in [
        &[Unverified, Attested, Affirmed][..],
        &[Affirmed][..],
        &[Attested, Affirmed][..],
        &[Unverified][..],
    ] {
        let narrowed = view(&[("journal", None)], &[], admit);
        let name = admit
            .iter()
            .map(|s| s.as_str())
            .collect::<Vec<_>>()
            .join("+");
        for id in records {
            let got = read(d, decl, id, &narrowed, who)?;
            out.push(format!(
                "read {id} under {name}: {:?}",
                got.map(|record| canonical_json(&record.to_json()))
            ));
        }
        for (label, query) in [
            ("id", find_all(decl)),
            (
                "recent",
                RecordFind {
                    order: FindOrder::Recent,
                    ..find_all(decl)
                },
            ),
            (
                "text",
                RecordFind {
                    text: text("roses mulch"),
                    ..find_all(decl)
                },
            ),
            (
                "rank",
                RecordFind {
                    text: text("roses mulch"),
                    order: FindOrder::Rank,
                    ..find_all(decl)
                },
            ),
        ] {
            let page = find(d, decl, &query, &narrowed, who)?;
            out.push(format!(
                "find {label} under {name}: total {:?} cut {} next {:?} items {:?}",
                page.total,
                page.cut,
                page.next,
                page.items
                    .iter()
                    .map(|item| canonical_json(&item.to_json()))
                    .collect::<Vec<_>>()
            ));
        }
    }
    for doc in documents {
        let own = d.document_own(doc, &journal(), who).ctx("document_own")?;
        out.push(format!("own {doc}: {own:?}"));
    }
    Ok(out)
}

/// The reader's records for the differential cases: one of each standing, all readable by
/// `space`, citing a document `space` reads.
fn readable_corpus(d: &dyn DocumentStore, decl: &RecordDecl) -> Result<(), String> {
    four(d, decl)?;
    put(
        d,
        decl,
        "v",
        body("Mulch keeps the soil cool.", "south"),
        &["space"],
        None,
    )
    .ctx("a put")?;
    Ok(())
}

fn differential_uncited(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    readable_corpus(d, &decl)?;
    let records = ["a", "b", "t", "u", "v", "hidden"];
    let documents = ["journal/roses", "journal/private", "talks/private"];
    let before = everything(d, &decl, &records, &documents, &everyone())?;
    // Documents the reader may not read, which no record it reads cites, are written, cited by
    // a record it may not read, changed, marked, unmarked and deleted.
    let other = reader(&["group:other"]);
    let step = |what: &str| -> Result<(), String> {
        let after = everything(d, &decl, &records, &documents, &everyone())?;
        for (index, (was, now)) in before.iter().zip(&after).enumerate() {
            if was != now {
                return Err(format!(
                    "{what} changed a read (line {index}): {was} became {now}"
                ));
            }
        }
        ensure_eq(after.len(), before.len(), "the same reads")
    };
    let first = document(
        d,
        "journal/private",
        &["group:other"],
        "Mulch the roses in autumn.\n",
    )?;
    let talk = document(
        d,
        "talks/private",
        &["group:other"],
        "Roses want morning sun.\n",
    )?;
    step("writing unreadable documents")?;
    put(
        d,
        &decl,
        "hidden",
        body("Mulch the roses in autumn, deeply.", "west"),
        &["group:other"],
        Some(cites("journal/private", &first, None)),
    )
    .ctx("an unreadable record citing one")?;
    step("an unreadable record that cites one")?;
    d.decide_record(
        NS,
        &decl,
        "hidden",
        decision(Decision::Affirm),
        &plain(),
        &other,
    )
    .ctx("affirm it")?;
    step("affirming an unreadable record")?;
    d.mark_document_own(mark("talks/private", &talk, None), &other)
        .ctx("mark")?;
    step("marking an unreadable document")?;
    let second = document(
        d,
        "journal/private",
        &["group:other"],
        "Mulch the roses in autumn, and again in spring.\n",
    )?;
    document(
        d,
        "talks/private",
        &["group:other"],
        "Roses want afternoon shade.\n",
    )?;
    step("changing unreadable documents")?;
    put(
        d,
        &decl,
        "hidden",
        body("Mulch the roses in autumn, deeply.", "west"),
        &["group:other"],
        Some(cites("journal/private", &second, None)),
    )
    .ctx("cite the new content")?;
    d.decide_record(
        NS,
        &decl,
        "hidden",
        decision(Decision::Withdraw),
        &plain(),
        &other,
    )
    .ctx("withdraw")?;
    step("citing again and withdrawing")?;
    d.unmark_document_own("talks/private", DECIDED_AT, None, &other)
        .ctx("unmark")?;
    step("unmarking an unreadable document")?;
    for doc in ["journal/private", "talks/private"] {
        d.delete_document(
            doc,
            Expect::Any,
            samples::envelope(&["group:other"], "sync", AT),
        )
        .ctx("delete_document")?;
    }
    step("deleting unreadable documents")?;
    d.reindex_records(NS, &decl, &no_scan, None, false)
        .ctx("a rebuild")?;
    step("a rebuild")?;
    pass()
}

fn differential_cited(env: &Env<'_>) -> CaseResult {
    let Some((s, _)) = lane(env)? else {
        return skip(NO_LANE);
    };
    let d = &*s.stores.documents;
    let decl = decl()?;
    readable_corpus(d, &decl)?;
    // A record the reader may read cites a document it may not, in the own collection.
    let first = document(
        d,
        "journal/private",
        &["group:other"],
        "Mulch keeps the soil cool.\n",
    )?;
    put(
        d,
        &decl,
        "v",
        body("Mulch keeps the soil cool.", "south"),
        &["space"],
        Some(cites("journal/private", &first, None)),
    )
    .ctx("cite the unreadable document")?;
    let records = ["a", "b", "t", "u", "v"];
    let lines =
        |d: &dyn DocumentStore| everything(d, &decl, &records, &["journal/private"], &everyone());
    // What a reader sees of each record with the standing taken out, and the standing apart.
    let split = |d: &dyn DocumentStore| -> Result<Vec<(Value, Value)>, String> {
        records
            .iter()
            .map(|id| {
                let mut record = read(d, &decl, id, &journal(), &everyone())?
                    .ok_or("the record is read")?
                    .to_json();
                let standing = record["dev.umbel/standing"].take();
                Ok((record, standing))
            })
            .collect()
    };
    let totals = |d: &dyn DocumentStore| -> Result<Vec<Option<u64>>, String> {
        use Standing::{Affirmed, Attested, Unverified};
        [
            &[Unverified, Attested, Affirmed][..],
            &[Attested, Affirmed][..],
            &[Unverified][..],
            &[Affirmed][..],
        ]
        .into_iter()
        .map(|admit| {
            Ok(find(
                d,
                &decl,
                &find_all(&decl),
                &view(&[("journal", None)], &[], admit),
                &everyone(),
            )?
            .total)
        })
        .collect()
    };
    let attested = json!({
        "standing": "attested", "affirmed": null,
        "source": { "doc": null, "contentHash": null, "basis": "collection", "speaker": null,
            "units": null, "rule": null, "storedAt": null, "generatedAt": null },
    });
    let unverified = json!({ "standing": "unverified", "affirmed": null, "source": null });
    let before = split(d)?;
    ensure_eq(
        before[4].1.clone(),
        attested.clone(),
        "attested by a document the reader may not read",
    )?;
    ensure_eq(
        totals(d)?,
        vec![Some(5), Some(4), Some(1), Some(2)],
        "the totals before",
    )?;
    let whole_before = lines(d)?;
    // The unreadable document changes.
    document(
        d,
        "journal/private",
        &["group:other"],
        "Mulch keeps the soil cool and damp.\n",
    )?;
    let after = split(d)?;
    for (index, id) in records.iter().enumerate() {
        ensure_eq(
            after[index].0.clone(),
            before[index].0.clone(),
            &format!("nothing of {id} but its standing changes"),
        )?;
        if *id != "v" {
            ensure_eq(
                after[index].1.clone(),
                before[index].1.clone(),
                "another record's standing",
            )?;
        }
    }
    ensure_eq(
        after[4].1.clone(),
        unverified,
        "the only difference is that record's standing and basis",
    )?;
    ensure_eq(
        totals(d)?,
        vec![Some(5), Some(3), Some(2), Some(2)],
        "and its place in a filter and a total",
    )?;
    // Put back, every read is what it was, byte for byte.
    document(
        d,
        "journal/private",
        &["group:other"],
        "Mulch keeps the soil cool.\n",
    )?;
    ensure_eq(
        lines(d)?,
        whole_before,
        "the document as it was cited: every read as it was",
    )?;
    // Deleted, and stored again in a collection that is not own and marked: the basis moves,
    // and nothing else is shown.
    d.delete_document(
        "journal/private",
        Expect::Any,
        samples::envelope(&["group:other"], "sync", AT),
    )
    .ctx("delete_document")?;
    ensure_eq(
        split(d)?[4].1.clone(),
        json!({ "standing": "unverified", "affirmed": null, "source": null }),
        "the document is gone",
    )?;
    let moved = document(
        d,
        "talks/private",
        &["group:other"],
        "Mulch keeps the soil cool.\n",
    )?;
    put(
        d,
        &decl,
        "v",
        body("Mulch keeps the soil cool.", "south"),
        &["space"],
        Some(cites("talks/private", &moved, None)),
    )
    .ctx("cite the document where it is now")?;
    d.mark_document_own(
        mark("talks/private", &moved, None),
        &reader(&["group:other"]),
    )
    .ctx("mark")?;
    let marked = split(d)?;
    ensure_eq(
        marked[4].1["source"].clone(),
        json!({ "doc": null, "contentHash": null, "basis": "marked", "speaker": null,
            "units": null, "rule": null, "storedAt": null, "generatedAt": null }),
        "marked by someone who reads it: the basis, and nothing else",
    )?;
    ensure_eq(
        marked[4].0.clone(),
        {
            // The put that cited the new document took a revision: only that moved.
            let mut expected = before[4].0.clone();
            expected["rev"] = marked[4].0["rev"].clone();
            expected["envelope"] = marked[4].0["envelope"].clone();
            expected
        },
        "the record is otherwise what it was",
    )?;
    d.unmark_document_own("talks/private", DECIDED_AT, None, &reader(&["group:other"]))
        .ctx("unmark")?;
    ensure_eq(
        split(d)?[4].1["standing"].clone(),
        json!("unverified"),
        "unmarked",
    )?;
    pass()
}

//! Standing (records host specification, section 6; D161, D162): the label a record carries,
//! the clause that admits it, a person's decision on a record and a person's mark on a document.
//!
//! **A label is computed at each read from four facts, each written only by the store on the
//! host's word**: whether a decision row affirms the record (`record_lane.affirmed_seq`), its
//! evidence row, the cited document's row, and whether that document is the person's own now.
//! Nothing in a record's body, and nothing a call passes, is read as standing. Attested is never
//! stored: it is [`push_attested`]'s condition, evaluated in the statement that reads.
//!
//! **Affirmed is read, as attested is.** A record reads affirmed when the decision its lane row
//! names is an affirmation, of the wording the row holds now, made by the space's person as the
//! view of the read names them ([`push_affirmed`]). So D160 holds at each read as well as at
//! each write, and a space whose person changes sets the former person's decisions aside.
//!
//! **The person's own now** (section 6.2) is decided by the [`StandingView`] the host built from
//! its configuration for the call: a document of a collection the view names own, whose current
//! content the host held to its file on disk (`doc_held`), with the speaker that collection
//! names; or a document a mark names at its current content hash, made by the space's person,
//! in a collection the view does not name command-writable, with the speaker the mark names. So
//! a document stored before its collection was named own attests nothing until the host has
//! held it to its file, and a mark stops counting when its document changes, when the mark is
//! withdrawn, when the space's person changes, and when the configuration makes its collection
//! command-writable, with nothing written to any record.
//!
//! **What a reader may see of a source** (section 6.5): the standing is the same for every
//! reader of a record. The source's document, content hash, speaker, units, rule and dates are
//! shown only to a reader who may read the cited document; any other reader sees how the
//! document is the person's own, and nothing else.

use std::collections::BTreeMap;

use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params_from_iter};
use umbel_store::lane::{
    Affirmation, AffirmationSeen, Decided, Decision, Evidence, LabelSource, Marked, OwnBasis,
    OwnInfo, OwnMark, RecordDecision, RecordDecl, SourceSeen, Standing, StandingLabel,
    StandingView,
};
use umbel_store::{ContentHash, ReaderFilter, Rev, StoreError, check_identifier, record_target};

use super::{LANE_ACCESS, LANE_BATCH, Read, refuse_derivation, require_ready};
use crate::SqliteStore;
use crate::documents::{insert_standing_change, next_rev, parse_json};
use crate::error::{Fail, to_i64, to_u64};
use crate::sql::Sql;

/// When the host stored a document's content, and what the file says of itself (section 6.5),
/// over `documents d`.
const STORED_AT: &str = "json_extract(d.record, '$.envelope.observedAt')";
const GENERATED_AT: &str = "json_extract(d.record, '$.envelope.generated.at')";

/// `<the host held d's current content to its file on disk>` over `documents d`: what makes a
/// document of an own collection the person's, and not only stored there (section 3, rule 2).
const HELD: &str =
    "EXISTS (SELECT 1 FROM doc_held h WHERE h.doc = d.doc AND h.doc_hash = d.content_hash)";

/// `<expr> IN (<the principals the space's person decides as>)`; nothing when the space has no
/// person.
fn push_by_person(sql: &mut Sql, expr: &str, view: &StandingView) {
    if view.person.is_empty() {
        sql.push("0");
    } else {
        sql.push(expr).push(" IN ").bind_list(view.person.iter());
    }
}

/// `<a decision affirms the record now>` over `record_lane l` (section 6.1): the decision the
/// lane row names is an affirmation of the wording the row holds, made by the space's person.
/// The row's pointer alone is not read as standing: a decision on another wording, a
/// withdrawal, or a decision of someone who is not the space's person now affirms nothing.
pub(super) fn push_affirmed(sql: &mut Sql, view: &StandingView) {
    sql.push(
        "EXISTS (SELECT 1 FROM record_decisions c WHERE c.seq = l.affirmed_seq \
         AND c.decision = 'affirm' AND c.wording_hash = l.wording_hash AND ",
    );
    push_by_person(sql, "c.by", view);
    sql.push(")");
}

/// `<the document d is of an own collection, held to its file, whose speaker is the
/// evidence's>` over `documents d` and `record_evidence e`: section 6.3's first branch, once
/// for each own collection.
fn push_by_collection(sql: &mut Sql, view: &StandingView) {
    if view.own.is_empty() {
        sql.push("0");
        return;
    }
    sql.push("(").push(HELD).push(" AND (");
    for (index, own) in view.own.iter().enumerate() {
        if index > 0 {
            sql.push(" OR ");
        }
        sql.push("(d.collection = ")
            .bind(own.id.as_str())
            .push(" AND e.speaker IS ")
            .bind(own.speaker.as_deref())
            .push(")");
    }
    sql.push("))");
}

/// `<no command writes files where d lies, and a mark of the space's person names d's content
/// now>` over `documents d`: what makes a document the person's own by a mark, without the
/// speaker.
///
/// With `at_levels`, the mark was also made at one of the view's `levels` (the Ideas host-review
/// specification, section 6.5), as [`push_affirmed_at`] holds a decision: a mark made on the
/// local page attests nothing to a call for verified content unless the space lists `local`.
fn push_marked(sql: &mut Sql, view: &StandingView, mark: &str, at_levels: bool) {
    sql.push("(");
    if !view.command_writable.is_empty() {
        sql.push("d.collection NOT IN ")
            .bind_list(view.command_writable.iter())
            .push(" AND ");
    }
    sql.push(
        "EXISTS (SELECT 1 FROM doc_own o WHERE o.doc = d.doc AND o.doc_hash = d.content_hash AND ",
    );
    push_by_person(sql, "o.by", view);
    if at_levels && !view.levels.is_empty() {
        sql.push(" AND json_extract(o.assurance, '$.level') IN ")
            .bind_list(view.levels.iter());
    }
    sql.push(mark).push("))");
}

/// `<the document d is the person's own now for the evidence e>`: by collection, or by a mark
/// whose speaker is the evidence's (section 6.3's two branches).
fn push_own(sql: &mut Sql, view: &StandingView, at_levels: bool) {
    sql.push("(");
    push_by_collection(sql, view);
    sql.push(" OR ");
    push_marked(sql, view, " AND o.speaker IS e.speaker", at_levels);
    sql.push(")");
}

/// Section 6.3's condition over `record_lane l`, as one expression: the record's evidence says
/// the plugin found its wording to be exactly the cited units; the cited document is stored now
/// with the cited content hash; that document is the person's own now; and the speaker the
/// plugin's check used is the speaker the collection or the mark names.
///
/// It does not ask whether the reader may read the cited document: standing is a fact about the
/// record, and the same for every reader of it.
pub(super) fn push_attested(sql: &mut Sql, view: &StandingView) {
    push_attested_as(sql, view, false);
}

/// [`push_attested`], its mark held to the view's `levels` when `at_levels`.
fn push_attested_as(sql: &mut Sql, view: &StandingView, at_levels: bool) {
    sql.push(
        "EXISTS (SELECT 1 FROM record_evidence e JOIN documents d ON d.doc = e.doc \
         AND d.content_hash = e.doc_hash WHERE e.lane = l.lane AND e.verbatim = 1 AND ",
    );
    push_own(sql, view, at_levels);
    sql.push(")");
}

/// [`push_affirmed`] with the view's `levels` (the Ideas host-review specification, section
/// 6.5): the affirming decision's assurance was made at one of them.
fn push_affirmed_at(sql: &mut Sql, view: &StandingView) {
    sql.push(
        "EXISTS (SELECT 1 FROM record_decisions c WHERE c.seq = l.affirmed_seq \
         AND c.decision = 'affirm' AND c.wording_hash = l.wording_hash AND ",
    );
    push_by_person(sql, "c.by", view);
    sql.push(" AND json_extract(c.assurance, '$.level') IN ")
        .bind_list(view.levels.iter());
    sql.push(")");
}

/// ` AND <the view admits the record's standing>` over `record_lane l` (section 6.6): a clause
/// of the statement, so a total, a statistic and a candidate count only admitted records. A
/// record is affirmed when [`push_affirmed`]'s condition holds, else attested when section
/// 6.3's does, else unverified. A kind without standing has no standing to filter on.
///
/// A view that names `levels` admits an affirmed record only when its decision was made at one
/// of them, and a record affirmed at another level at no standing (the Ideas host-review
/// specification, section 6.5): it is still affirmed, so it is neither attested nor unverified.
/// It admits an attested record only when its document is the person's own by its collection,
/// or by a mark made at one of the levels; one attested only through a mark at another level is
/// admitted at no standing either.
pub(super) fn and_admitted(sql: &mut Sql, decl: &RecordDecl, view: &StandingView) {
    if !decl.standing {
        return;
    }
    if !view.levels.is_empty() {
        let mut arms: Vec<fn(&mut Sql, &StandingView)> = Vec::new();
        if view.admits(Standing::Affirmed) {
            arms.push(push_affirmed_at);
        }
        if view.admits(Standing::Attested) {
            arms.push(|sql, view| {
                // Attested through a mark made at a listed level, as an affirmation is held.
                sql.push("(NOT ");
                push_affirmed(sql, view);
                sql.push(" AND ");
                push_attested_as(sql, view, true);
                sql.push(")");
            });
        }
        if view.admits(Standing::Unverified) {
            arms.push(|sql, view| {
                sql.push("(NOT ");
                push_affirmed(sql, view);
                sql.push(" AND NOT ");
                push_attested(sql, view);
                sql.push(")");
            });
        }
        if arms.is_empty() {
            sql.push(" AND 0");
            return;
        }
        sql.push(" AND (");
        for (index, arm) in arms.iter().enumerate() {
            if index > 0 {
                sql.push(" OR ");
            }
            arm(sql, view);
        }
        sql.push(")");
        return;
    }
    let admits = (
        view.admits(Standing::Unverified),
        view.admits(Standing::Attested),
        view.admits(Standing::Affirmed),
    );
    match admits {
        (true, true, true) => {}
        (false, false, false) => {
            sql.push(" AND 0");
        }
        (false, false, true) => {
            sql.push(" AND ");
            push_affirmed(sql, view);
        }
        (true, true, false) => {
            sql.push(" AND NOT ");
            push_affirmed(sql, view);
        }
        (false, true, true) => {
            sql.push(" AND (");
            push_affirmed(sql, view);
            sql.push(" OR ");
            push_attested(sql, view);
            sql.push(")");
        }
        (true, false, false) => {
            sql.push(" AND NOT ");
            push_affirmed(sql, view);
            sql.push(" AND NOT ");
            push_attested(sql, view);
        }
        (false, true, false) => {
            sql.push(" AND NOT ");
            push_affirmed(sql, view);
            sql.push(" AND ");
            push_attested(sql, view);
        }
        (true, false, true) => {
            sql.push(" AND (");
            push_affirmed(sql, view);
            sql.push(" OR NOT ");
            push_attested(sql, view);
            sql.push(")");
        }
    }
}

/// The decision that affirms each of `lanes` now, by lane: one statement over `record_lane l`
/// and `record_decisions`, under the reader clause as every statement of a read is, with
/// [`push_affirmed`]'s conditions: an affirmation, of the wording the lane row holds, by the
/// space's person.
fn affirmations(
    conn: &Connection,
    lanes: &[i64],
    view: &StandingView,
    reader: &ReaderFilter,
) -> Result<BTreeMap<i64, Affirmation>, Fail> {
    let mut sql = Sql::new(
        "SELECT l.lane, c.by, c.at, c.assurance FROM record_lane l \
         JOIN record_decisions c ON c.seq = l.affirmed_seq AND c.decision = 'affirm' \
         AND c.wording_hash = l.wording_hash WHERE l.lane IN ",
    );
    sql.bind_list(lanes.iter().copied());
    sql.push(" AND ");
    push_by_person(&mut sql, "c.by", view);
    sql.and_readable("record_access", LANE_ACCESS, reader);
    let mut statement = conn.prepare_cached(&sql.text)?;
    let mut rows = statement.query(params_from_iter(&sql.params))?;
    let mut found = BTreeMap::new();
    while let Some(row) = rows.next()? {
        let assurance: umbel_store::Assurance = parse_json(&row.get::<_, String>(3)?)?;
        found.insert(
            row.get(0)?,
            Affirmation {
                at: row.get(2)?,
                level: assurance.level.clone(),
                seen: Some(AffirmationSeen {
                    by: row.get(1)?,
                    assurance,
                }),
            },
        );
    }
    Ok(found)
}

/// The source that attests each of `lanes` now, by lane, as `reader` may see it: one statement
/// over `record_evidence` and `documents` for a page's lanes, with section 6.3's condition, and
/// `doc_access` deciding whether anything but the basis is shown.
fn sources(
    conn: &Connection,
    lanes: &[i64],
    view: &StandingView,
    reader: &ReaderFilter,
) -> Result<BTreeMap<i64, LabelSource>, Fail> {
    let mut sql = Sql::new("SELECT l.lane, e.doc, e.doc_hash, e.units, e.rule, e.speaker, ");
    push_by_collection(&mut sql, view);
    sql.push(", ")
        .push(STORED_AT)
        .push(", ")
        .push(GENERATED_AT)
        .push(", (1 = 1");
    sql.and_doc_readable("d.doc", reader);
    sql.push(
        ") FROM record_lane l JOIN record_evidence e ON e.lane = l.lane \
         JOIN documents d ON d.doc = e.doc AND d.content_hash = e.doc_hash WHERE l.lane IN ",
    );
    sql.bind_list(lanes.iter().copied());
    sql.push(" AND e.verbatim = 1 AND ");
    push_own(&mut sql, view, false);
    sql.and_readable("record_access", LANE_ACCESS, reader);
    let mut statement = conn.prepare_cached(&sql.text)?;
    let mut rows = statement.query(params_from_iter(&sql.params))?;
    let mut found = BTreeMap::new();
    while let Some(row) = rows.next()? {
        let basis = if row.get::<_, bool>(6)? {
            OwnBasis::Collection
        } else {
            OwnBasis::Marked
        };
        // A reader who may not read the cited document sees the basis and nothing else: not
        // its id, its hash, its dates, the speaker, a unit or the rule.
        let seen = if row.get::<_, bool>(9)? {
            Some(SourceSeen {
                doc: row.get(1)?,
                content_hash: ContentHash::parse(&row.get::<_, String>(2)?)?,
                units: parse_json(&row.get::<_, String>(3)?)?,
                rule: row.get(4)?,
                speaker: row.get(5)?,
                stored_at: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                generated_at: row.get(8)?,
            })
        } else {
            None
        };
        found.insert(row.get(0)?, LabelSource { basis, seen });
    }
    Ok(found)
}

/// Give each of `rows` its label (section 6.5): `None` for a kind without standing; else
/// affirmed when a decision affirms the record, attested when a source attests it, unverified
/// otherwise, with the decision and the source that back it. The source is given whenever
/// section 6.3's condition holds, affirmed or not.
pub(super) fn label(
    conn: &Connection,
    decl: &RecordDecl,
    view: &StandingView,
    reader: &ReaderFilter,
    rows: &mut [Read],
) -> Result<(), Fail> {
    if !decl.standing {
        return Ok(());
    }
    for page in rows.chunks_mut(LANE_BATCH) {
        let lanes: Vec<i64> = page.iter().map(|row| row.lane).collect();
        let mut affirmed = affirmations(conn, &lanes, view, reader)?;
        let mut attested = sources(conn, &lanes, view, reader)?;
        for row in page {
            // A lane row whose pointer names no affirmation of its wording by the space's
            // person is not affirmed: the pointer alone is never read as standing.
            let affirmation = affirmed.remove(&row.lane);
            let source = attested.remove(&row.lane);
            let standing = if affirmation.is_some() {
                Standing::Affirmed
            } else if source.is_some() {
                Standing::Attested
            } else {
                Standing::Unverified
            };
            row.record.label = Some(StandingLabel {
                standing,
                affirmed: affirmation,
                source,
            });
        }
    }
    Ok(())
}

/// Step 7.5 of a declared put (section 4.2), inside its transaction: the cited document is
/// stored with the cited content hash and `writer` may read it. One answer for an absent
/// document, an unreadable one and another hash, so the refusal says nothing of a document the
/// writer may not read.
pub(super) fn check_evidence(
    tx: &Transaction<'_>,
    evidence: &Evidence,
    writer: &ReaderFilter,
) -> Result<(), Fail> {
    let mut sql = Sql::new("SELECT d.content_hash FROM documents d WHERE d.doc = ");
    sql.bind(evidence.doc.as_str())
        .and_doc_readable("d.doc", writer);
    let stored: Option<String> = tx
        .query_row(&sql.text, params_from_iter(&sql.params), |row| row.get(0))
        .optional()?;
    if stored.as_deref() == Some(evidence.doc_hash.as_str()) {
        Ok(())
    } else {
        Err(StoreError::EvidenceInvalid(
            "the cited document must be stored with the cited content hash and readable by the writer"
                .to_owned(),
        )
        .into())
    }
}

/// Replace a lane's evidence row with `evidence`.
pub(super) fn write_evidence(
    tx: &Transaction<'_>,
    lane: i64,
    evidence: &Evidence,
) -> Result<(), Fail> {
    let units = serde_json::Value::from(evidence.units.clone()).to_string();
    tx.execute(
        "INSERT INTO record_evidence (lane, doc, doc_hash, units, rule, speaker, verbatim)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT (lane) DO UPDATE SET doc = excluded.doc, doc_hash = excluded.doc_hash,
           units = excluded.units, rule = excluded.rule, speaker = excluded.speaker,
           verbatim = excluded.verbatim",
        rusqlite::params![
            lane,
            evidence.doc,
            evidence.doc_hash.as_str(),
            units,
            evidence.rule,
            evidence.speaker,
            evidence.verbatim
        ],
    )?;
    Ok(())
}

/// The access tokens a row of `table` holds for the key `column = value`s, in order.
fn tokens_of(tx: &Transaction<'_>, sql: &Sql) -> Result<Vec<String>, Fail> {
    let mut statement = tx.prepare_cached(&sql.text)?;
    let tokens = statement
        .query_map(params_from_iter(&sql.params), |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    Ok(tokens)
}

/// A document's stored content hash when `reader` may read it: `None` for one that is absent
/// or unreadable, alike.
fn readable_document(
    conn: &Connection,
    doc: &str,
    reader: &ReaderFilter,
) -> Result<Option<String>, Fail> {
    let mut sql = Sql::new("SELECT d.content_hash FROM documents d WHERE d.doc = ");
    sql.bind(doc).and_doc_readable("d.doc", reader);
    Ok(conn
        .query_row(&sql.text, params_from_iter(&sql.params), |row| row.get(0))
        .optional()?)
}

fn document_tokens(tx: &Transaction<'_>, doc: &str) -> Result<Vec<String>, Fail> {
    let mut sql = Sql::new("SELECT token FROM doc_access WHERE doc = ");
    sql.bind(doc).push(" ORDER BY token");
    tokens_of(tx, &sql)
}

impl SqliteStore {
    /// `decide_record` (section 6.1).
    pub(crate) fn lane_decide(
        &self,
        ns: &str,
        decl: &RecordDecl,
        id: &str,
        decision: &RecordDecision,
        view: &StandingView,
        reader: &ReaderFilter,
    ) -> Result<Decided, StoreError> {
        refuse_derivation(reader)?;
        if !decl.standing {
            return Err(StoreError::invalid(
                "a decision is made on a record of a standing kind",
            ));
        }
        decision.check()?;
        let kind = decl.kind.as_str();
        let assurance = serde_json::to_string(&decision.assurance)
            .map_err(|e| StoreError::Corrupt(format!("an assurance would not serialise: {e}")))?;
        // The record as its reader may read it: readable is all, and no standing filter applies.
        let mut found = super::find::select(super::RECORD_COLUMNS, ns, kind);
        found.push(" AND l.id = ").bind(id);
        found.and_readable("record_access", LANE_ACCESS, reader);
        self.pool().with(|conn| {
            let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
            require_ready(&tx, ns, decl)?;
            let mut select = Sql::new("SELECT l.lane, l.wording_hash, l.affirmed_seq, ");
            push_affirmed(&mut select, view);
            select.push(" FROM record_lane l WHERE l.ns = ");
            select
                .bind(ns)
                .push(" AND l.kind = ")
                .bind(kind)
                .push(" AND l.id = ")
                .bind(id);
            select.and_readable("record_access", LANE_ACCESS, reader);
            let row: Option<(i64, Option<String>, Option<i64>, bool)> = tx
                .query_row(&select.text, params_from_iter(&select.params), |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
                })
                .optional()?;
            // Absent and unreadable alike.
            let Some((lane, wording, pointer, affirmed)) = row else {
                return Err(StoreError::NotFound.into());
            };
            // An affirmation writes whenever the record does not read affirmed, so a space's
            // new person affirms what a former person had. A withdrawal writes whenever the
            // row names a decision, whoever made it.
            let writes = match decision.decision {
                Decision::Affirm => !affirmed,
                Decision::Withdraw => pointer.is_some(),
            };
            let mut taken = None;
            if writes {
                let wording = wording.ok_or_else(|| {
                    StoreError::Corrupt("a standing record's lane row holds no wording".to_owned())
                })?;
                let rev = next_rev(&tx)?;
                let seq = to_i64(rev)?;
                tx.execute(
                    "INSERT INTO record_decisions (seq, ns, kind, id, decision, wording_hash, by, at, assurance, trace_id)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    rusqlite::params![
                        seq,
                        ns,
                        kind,
                        id,
                        decision.decision.as_str(),
                        wording,
                        decision.by,
                        decision.at,
                        assurance,
                        decision.trace_id
                    ],
                )?;
                let now: Option<i64> = match decision.decision {
                    Decision::Affirm => Some(seq),
                    Decision::Withdraw => None,
                };
                tx.execute(
                    "UPDATE record_lane SET affirmed_seq = ?2 WHERE lane = ?1",
                    rusqlite::params![lane, now],
                )?;
                let mut access = Sql::new("SELECT token FROM record_access WHERE ns = ");
                access
                    .bind(ns)
                    .push(" AND kind = ")
                    .bind(kind)
                    .push(" AND id = ")
                    .bind(id)
                    .push(" ORDER BY token");
                let tokens = tokens_of(&tx, &access)?;
                insert_standing_change(
                    &tx,
                    rev,
                    &record_target(ns, kind, id),
                    decision.trace_id.as_deref(),
                    &decision.at,
                    &tokens,
                )?;
                taken = Some(rev);
            }
            // The label after the decision, whatever a read would admit.
            let read = super::find::records(&tx, &found, decl, view, reader)?
                .into_iter()
                .next()
                .and_then(|read| read.record.label)
                .ok_or_else(|| {
                    StoreError::Corrupt("a decided record is not labelled".to_owned())
                })?;
            tx.commit()?;
            Ok(Decided {
                label: read,
                rev: taken,
            })
        })
    }

    /// `mark_document_own` (section 6.2).
    pub(crate) fn own_mark(
        &self,
        mark: &OwnMark,
        reader: &ReaderFilter,
    ) -> Result<Marked, StoreError> {
        refuse_derivation(reader)?;
        mark.check()?;
        self.pool().with(|conn| {
            let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
            // 1. Readable, else not found: absent and unreadable alike.
            let Some(current) = readable_document(&tx, &mark.doc, reader)? else {
                return Err(StoreError::NotFound.into());
            };
            // 2. A person marks the bytes they were shown.
            if current != mark.doc_hash.as_str() {
                return Err(StoreError::Conflict {
                    current: Some(current),
                }
                .into());
            }
            let stored: Option<(String, Option<String>, i64, String)> = tx
                .query_row(
                    "SELECT doc_hash, speaker, rev, by FROM doc_own WHERE doc = ?1",
                    [&mark.doc],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )
                .optional()?;
            if let Some((hash, speaker, rev, by)) = &stored
                && hash == mark.doc_hash.as_str()
                && *speaker == mark.speaker
                && *by == mark.by
            {
                // A mark that changes nothing.
                return Ok(Marked {
                    rev: to_u64(*rev)?,
                    wrote: false,
                });
            }
            let assurance = serde_json::to_string(&mark.assurance).map_err(|e| {
                StoreError::Corrupt(format!("an assurance would not serialise: {e}"))
            })?;
            let rev = next_rev(&tx)?;
            tx.execute(
                "INSERT INTO doc_own (doc, doc_hash, speaker, rev, by, at, assurance, trace_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT (doc) DO UPDATE SET doc_hash = excluded.doc_hash,
                   speaker = excluded.speaker, rev = excluded.rev, by = excluded.by,
                   at = excluded.at, assurance = excluded.assurance, trace_id = excluded.trace_id",
                rusqlite::params![
                    mark.doc,
                    mark.doc_hash.as_str(),
                    mark.speaker,
                    to_i64(rev)?,
                    mark.by,
                    mark.at,
                    assurance,
                    mark.trace_id
                ],
            )?;
            let tokens = document_tokens(&tx, &mark.doc)?;
            insert_standing_change(
                &tx,
                rev,
                &mark.doc,
                mark.trace_id.as_deref(),
                &mark.at,
                &tokens,
            )?;
            tx.commit()?;
            Ok(Marked { rev, wrote: true })
        })
    }

    /// `unmark_document_own` (section 6.2).
    pub(crate) fn own_unmark(
        &self,
        doc: &str,
        at: &str,
        trace_id: Option<&str>,
        reader: &ReaderFilter,
    ) -> Result<Rev, StoreError> {
        refuse_derivation(reader)?;
        check_identifier("a document id", doc)?;
        self.pool().with(|conn| {
            let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
            if readable_document(&tx, doc, reader)?.is_none() {
                return Err(StoreError::NotFound.into());
            }
            let removed = tx.execute("DELETE FROM doc_own WHERE doc = ?1", [doc])?;
            if removed == 0 {
                return Err(StoreError::NotFound.into());
            }
            let rev = next_rev(&tx)?;
            let tokens = document_tokens(&tx, doc)?;
            insert_standing_change(&tx, rev, doc, trace_id, at, &tokens)?;
            tx.commit()?;
            Ok(rev)
        })
    }

    /// `document_own` (section 6.2).
    pub(crate) fn own_of(
        &self,
        doc: &str,
        view: &StandingView,
        reader: &ReaderFilter,
    ) -> Result<Option<OwnInfo>, StoreError> {
        refuse_derivation(reader)?;
        let mut sql = Sql::new("SELECT d.collection, d.content_hash, ");
        sql.push(STORED_AT).push(", ").push(GENERATED_AT).push(", ");
        // Whether a mark makes it the person's own, the speaker that mark names, and whether
        // the host held its content to its file.
        push_marked(&mut sql, view, "", false);
        sql.push(
            ", (SELECT o.speaker FROM doc_own o WHERE o.doc = d.doc AND o.doc_hash = d.content_hash), ",
        )
        .push(HELD)
        .push(" FROM documents d WHERE d.doc = ");
        sql.bind(doc).and_doc_readable("d.doc", reader);
        self.pool().with(|conn| {
            type Row = (
                String,
                String,
                Option<String>,
                Option<String>,
                bool,
                Option<String>,
                bool,
            );
            let row: Option<Row> = conn
                .query_row(&sql.text, params_from_iter(&sql.params), |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                    ))
                })
                .optional()?;
            let Some((collection, hash, stored_at, generated_at, marked, mark_speaker, held)) = row
            else {
                return Ok(None);
            };
            // The deployer's configuration is read first: `collection` when both hold. A
            // document of an own collection is the person's only when the host held it to its
            // file: one stored before the collection was named own is not.
            let own = view.own.iter().find(|own| own.id == collection);
            let (basis, speaker) = match own {
                Some(own) if held => (OwnBasis::Collection, own.speaker.clone()),
                _ if marked => (OwnBasis::Marked, mark_speaker),
                _ => return Ok(None),
            };
            Ok(Some(OwnInfo {
                basis,
                speaker,
                content_hash: ContentHash::parse(&hash)?,
                stored_at: stored_at.unwrap_or_default(),
                generated_at,
            }))
        })
    }
}

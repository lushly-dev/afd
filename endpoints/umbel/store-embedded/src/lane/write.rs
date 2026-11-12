//! `put_declared_record`: a declared record and its lane rows in one transaction (records host
//! specification, section 4.2, step 7).

use rusqlite::{OptionalExtension, Transaction, TransactionBehavior, params, params_from_iter};
use serde_json::Value as Json;
use umbel_store::lane::{DeclaredPut, Extracted, LaneWrite, RecordDecl, extract};
use umbel_store::{
    ContentHash, Envelope, Expect, ReaderFilter, RecordMeta, Rev, StoreError, canonical_json,
    check_record, record_target,
};

use super::standing::{check_evidence, write_evidence};
use super::{any_record, flags_text, kind_row, position, refuse_derivation};
use crate::SqliteStore;
use crate::documents::{check_expect, insert_change, next_rev, parse_json};
use crate::error::{Fail, to_i64, to_u64};
use crate::sql::Sql;

/// A record's lane row, as a write needs it.
pub(super) struct LaneRow {
    pub(super) lane: i64,
    pub(super) wording_hash: Option<String>,
    pub(super) match_digest: Option<Vec<u8>>,
}

pub(super) fn lane_row(
    tx: &Transaction<'_>,
    ns: &str,
    kind: &str,
    id: &str,
) -> Result<Option<LaneRow>, Fail> {
    Ok(tx
        .query_row(
            "SELECT lane, wording_hash, match_digest FROM record_lane WHERE ns = ?1 AND kind = ?2 AND id = ?3",
            params![ns, kind, id],
            |row| {
                Ok(LaneRow {
                    lane: row.get(0)?,
                    wording_hash: row.get(1)?,
                    match_digest: row.get(2)?,
                })
            },
        )
        .optional()?)
}

/// Step 7.1: the kind's declaration row. Absent with no record of the kind stored, it is
/// inserted; a different hash, a stale mark, or absent with records stored, is `LaneStale`.
fn claim_kind(tx: &Transaction<'_>, ns: &str, decl: &RecordDecl) -> Result<(), Fail> {
    let hash = decl.hash();
    match kind_row(tx, ns, &decl.kind)? {
        Some(row) if !row.stale && row.decl_hash == hash.as_str() => Ok(()),
        Some(_) => Err(StoreError::LaneStale.into()),
        None if any_record(tx, ns, &decl.kind)? => Err(StoreError::LaneStale.into()),
        None => {
            tx.execute(
                "INSERT INTO record_kinds (ns, kind, decl_hash, decl) VALUES (?1, ?2, ?3, ?4)",
                params![
                    ns,
                    decl.kind,
                    hash.as_str(),
                    canonical_json(&decl.to_json())
                ],
            )?;
            Ok(())
        }
    }
}

/// The stored content hash of a record, and whether `writer` may read it.
fn stored_record(
    tx: &Transaction<'_>,
    ns: &str,
    kind: &str,
    id: &str,
    writer: &ReaderFilter,
) -> Result<Option<(String, bool)>, Fail> {
    let mut sql = Sql::new("SELECT r.content_hash, (1 = 1");
    sql.and_readable(
        "record_access",
        &[("ns", "r.ns"), ("kind", "r.kind"), ("id", "r.id")],
        writer,
    );
    sql.push(") FROM records r WHERE r.ns = ")
        .bind(ns)
        .push(" AND r.kind = ")
        .bind(kind)
        .push(" AND r.id = ")
        .bind(id);
    Ok(tx
        .query_row(&sql.text, params_from_iter(&sql.params), |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .optional()?)
}

/// The revision and time of a record's first put, from the change log: one pass over it, for a
/// record that is stored and has no lane row.
fn first_put(tx: &Transaction<'_>, target: &str) -> Result<Option<(Rev, String)>, Fail> {
    let found: Option<(i64, String)> = tx
        .query_row(
            "SELECT rev, at FROM changes WHERE kind = 'record' AND target = ?1 ORDER BY rev LIMIT 1",
            [target],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    found.map(|(rev, at)| Ok((to_u64(rev)?, at))).transpose()
}

/// Add `delta` to the kind's count of postings (schema version 4), in the caller's
/// transaction. Every statement that adds or removes rows of `record_terms` is followed by one
/// of these with the rows it changed, so the count a match compares with its bound (section
/// 8.2) is the kind's rows, with no scan.
pub(super) fn add_postings(
    tx: &Transaction<'_>,
    ns: &str,
    kind: &str,
    delta: i64,
) -> Result<(), Fail> {
    if delta != 0 {
        tx.execute(
            "INSERT INTO record_postings (ns, kind, postings) VALUES (?1, ?2, 0)
             ON CONFLICT (ns, kind) DO NOTHING",
            params![ns, kind],
        )?;
        tx.execute(
            "UPDATE record_postings SET postings = postings + ?3 WHERE ns = ?1 AND kind = ?2",
            params![ns, kind, delta],
        )?;
    }
    Ok(())
}

/// Replace a lane's terms with `found`'s, and the kind's count of postings with it.
pub(super) fn write_terms(
    tx: &Transaction<'_>,
    ns: &str,
    kind: &str,
    lane: i64,
    found: &Extracted,
) -> Result<(), Fail> {
    let removed: i64 = tx.query_row(
        "SELECT COUNT(*) FROM record_terms WHERE lane = ?1",
        [lane],
        |row| row.get(0),
    )?;
    tx.execute("DELETE FROM record_terms WHERE lane = ?1", [lane])?;
    let mut insert = tx.prepare_cached(
        "INSERT INTO record_terms (ns, kind, field, term, lane, tf) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )?;
    let mut added = 0i64;
    for (field, term, frequency) in &found.terms {
        insert.execute(params![ns, kind, position(*field), term, lane, frequency])?;
        added += 1;
    }
    add_postings(tx, ns, kind, added - removed)
}

/// Replace a lane's key values with `found`'s, unless they are the ones stored.
pub(super) fn write_keys(
    tx: &Transaction<'_>,
    ns: &str,
    kind: &str,
    lane: i64,
    found: &Extracted,
) -> Result<(), Fail> {
    let stored: Vec<(i64, String)> = {
        let mut select = tx.prepare_cached(
            "SELECT key, value FROM record_keys WHERE lane = ?1 ORDER BY key, value",
        )?;
        select
            .query_map([lane], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<_, _>>()?
    };
    let same = stored.len() == found.keys.len()
        && stored
            .iter()
            .zip(&found.keys)
            .all(|((key, value), (new_key, new_value))| {
                *key == position(*new_key) && value == new_value
            });
    if same {
        return Ok(());
    }
    tx.execute("DELETE FROM record_keys WHERE lane = ?1", [lane])?;
    let mut insert = tx.prepare_cached(
        "INSERT INTO record_keys (ns, kind, key, value, lane) VALUES (?1, ?2, ?3, ?4, ?5)",
    )?;
    for (key, value) in &found.keys {
        insert.execute(params![ns, kind, position(*key), value, lane])?;
    }
    Ok(())
}

/// What a lane row holds of `found`: its wording hash, match digest and token counts.
pub(super) struct LaneValues<'a> {
    pub(super) wording: Option<&'a str>,
    pub(super) digest: Option<&'a [u8]>,
    pub(super) lengths: [u32; 4],
}

impl<'a> LaneValues<'a> {
    pub(super) fn of(found: &'a Extracted) -> Self {
        Self {
            wording: found.wording_hash.as_ref().map(ContentHash::as_str),
            digest: found.match_digest.as_ref().map(<[u8; 32]>::as_slice),
            lengths: found.lengths,
        }
    }
}

/// Insert a record's lane row and answer its lane number.
#[allow(clippy::too_many_arguments)]
pub(super) fn insert_lane(
    tx: &Transaction<'_>,
    ns: &str,
    kind: &str,
    id: &str,
    created_rev: Rev,
    created_at: &str,
    values: &LaneValues<'_>,
    flags: &str,
) -> Result<i64, Fail> {
    let [n0, n1, n2, n3] = values.lengths;
    tx.execute(
        "INSERT INTO record_lane (ns, kind, id, created_rev, created_at, wording_hash, match_digest, n0, n1, n2, n3, flags)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            ns, kind, id, to_i64(created_rev)?, created_at, values.wording, values.digest, n0, n1,
            n2, n3, flags
        ],
    )?;
    Ok(tx.last_insert_rowid())
}

/// Update what a lane row holds of its record's text; its number, first revision and time stay.
pub(super) fn update_lane(
    tx: &Transaction<'_>,
    lane: i64,
    values: &LaneValues<'_>,
    flags: &str,
) -> Result<(), Fail> {
    let [n0, n1, n2, n3] = values.lengths;
    tx.execute(
        "UPDATE record_lane SET wording_hash = ?2, match_digest = ?3, n0 = ?4, n1 = ?5, n2 = ?6, n3 = ?7, flags = ?8
         WHERE lane = ?1",
        params![lane, values.wording, values.digest, n0, n1, n2, n3, flags],
    )?;
    Ok(())
}

/// Take from a lane what stood on a wording that is no longer the record's: its affirmation and
/// its evidence. The decision rows stay, as the history of what the person decided on the
/// wording they name.
pub(super) fn clear_standing(tx: &Transaction<'_>, lane: i64) -> Result<(), Fail> {
    tx.execute(
        "UPDATE record_lane SET affirmed_seq = NULL WHERE lane = ?1",
        [lane],
    )?;
    tx.execute("DELETE FROM record_evidence WHERE lane = ?1", [lane])?;
    Ok(())
}

impl SqliteStore {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn lane_put(
        &self,
        ns: &str,
        decl: &RecordDecl,
        id: &str,
        body: Json,
        mut envelope: Envelope,
        expect: Expect,
        lane: LaneWrite,
        writer: &ReaderFilter,
    ) -> Result<DeclaredPut, StoreError> {
        refuse_derivation(writer)?;
        if let Some(evidence) = &lane.evidence {
            // Step 6: evidence is for a standing kind, and its shape is checked before anything
            // is read.
            if !decl.standing {
                return Err(StoreError::invalid(
                    "evidence is for a record of a standing kind",
                ));
            }
            evidence.check()?;
        }
        let kind = decl.kind.as_str();
        let (hash, access) = check_record(ns, kind, id, &body, &envelope, self.space())?;
        let found = extract(decl, &body)?;
        let body_text = canonical_json(&body);
        let flags = flags_text(&lane.flags);
        let target = record_target(ns, kind, id);
        self.pool().with(|conn| {
            let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
            claim_kind(&tx, ns, decl)?;
            let stored = stored_record(&tx, ns, kind, id, writer)?;
            if matches!(stored, Some((_, false))) {
                // To this writer the id is taken, and nothing more is said.
                return Err(StoreError::Conflict { current: None }.into());
            }
            let current = stored.as_ref().map(|(hash, _)| hash.as_str());
            check_expect(&expect, current)?;
            let row = lane_row(&tx, ns, kind, id)?;
            let values = LaneValues::of(&found);
            let wording_changed = row
                .as_ref()
                .is_some_and(|row| row.wording_hash.as_deref() != values.wording);
            if decl.standing && wording_changed {
                return Err(StoreError::WordingFixed.into());
            }
            // Step 7.5: the cited document, as the writer may read it, in this transaction.
            if let Some(evidence) = &lane.evidence {
                check_evidence(&tx, evidence, writer)?;
            }
            // The match value is one of the text values, so it moved only if the wording did.
            let match_changed = match (&row, decl.match_pointer()) {
                (Some(_), Some(pointer)) if wording_changed => {
                    let old: String = tx.query_row(
                        "SELECT body FROM records WHERE ns = ?1 AND kind = ?2 AND id = ?3",
                        params![ns, kind, id],
                        |r| r.get(0),
                    )?;
                    let old: Json = parse_json(&old)?;
                    pointer.get(&old).and_then(Json::as_str)
                        != pointer.get(&body).and_then(Json::as_str)
                }
                _ => false,
            };
            let rev = next_rev(&tx)?;
            // A record that exists keeps its access set, which its stored envelope then carries.
            let tokens: Vec<String> = if stored.is_some() {
                let mut select = tx.prepare_cached(
                    "SELECT token FROM record_access WHERE ns = ?1 AND kind = ?2 AND id = ?3 ORDER BY token",
                )?;
                let tokens = select
                    .query_map(params![ns, kind, id], |r| r.get(0))?
                    .collect::<Result<Vec<String>, _>>()?;
                envelope.access.clone_from(&tokens);
                tokens
            } else {
                access.tokens().to_vec()
            };
            let envelope_text = serde_json::to_string(&envelope).map_err(|e| {
                StoreError::Corrupt(format!("an envelope would not serialise: {e}"))
            })?;
            tx.execute(
                "INSERT INTO records (ns, kind, id, rev, content_hash, body, envelope) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT (ns, kind, id) DO UPDATE SET rev = excluded.rev,
                   content_hash = excluded.content_hash, body = excluded.body, envelope = excluded.envelope",
                params![ns, kind, id, to_i64(rev)?, hash.as_str(), body_text, envelope_text],
            )?;
            if stored.is_none() {
                for token in &tokens {
                    tx.execute(
                        "INSERT INTO record_access (ns, kind, id, token) VALUES (?1, ?2, ?3, ?4)",
                        params![ns, kind, id, token],
                    )?;
                }
            }
            let lane_id = match &row {
                Some(row) => {
                    update_lane(&tx, row.lane, &values, &flags)?;
                    if wording_changed {
                        write_terms(&tx, ns, kind, row.lane, &found)?;
                        // Only a kind without standing reaches here: what stood on the old
                        // wording, from a time when the kind had standing, goes (section 4.3).
                        clear_standing(&tx, row.lane)?;
                    }
                    write_keys(&tx, ns, kind, row.lane, &found)?;
                    if match_changed {
                        tx.execute("DELETE FROM record_vectors WHERE lane = ?1", [row.lane])?;
                    }
                    row.lane
                }
                None => {
                    // A record stored without a lane row is one a rebuild could not index: its
                    // first put is in the change log.
                    let (created_rev, created_at) = match stored {
                        Some(_) => first_put(&tx, &target)?,
                        None => None,
                    }
                    .unwrap_or_else(|| (rev, envelope.observed_at.clone()));
                    let lane_id =
                        insert_lane(&tx, ns, kind, id, created_rev, &created_at, &values, &flags)?;
                    write_terms(&tx, ns, kind, lane_id, &found)?;
                    write_keys(&tx, ns, kind, lane_id, &found)?;
                    lane_id
                }
            };
            if let Some(evidence) = &lane.evidence {
                write_evidence(&tx, lane_id, evidence)?;
            }
            insert_change(&tx, rev, "record", &target, hash.as_str(), &envelope, &tokens)?;
            let embed = match (&lane.model, found.match_digest) {
                (Some(model), Some(digest)) => {
                    let held: bool = tx.query_row(
                        "SELECT EXISTS (SELECT 1 FROM record_vectors WHERE lane = ?1 AND model = ?2)",
                        params![lane_id, model.as_str()],
                        |r| r.get(0),
                    )?;
                    (!held).then_some(digest)
                }
                _ => None,
            };
            tx.commit()?;
            Ok(DeclaredPut {
                meta: RecordMeta {
                    ns: ns.to_owned(),
                    kind: kind.to_owned(),
                    id: id.to_owned(),
                    rev,
                    content_hash: hash,
                },
                embed,
            })
        })
    }
}

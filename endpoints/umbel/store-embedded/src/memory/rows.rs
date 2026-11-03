//! Rows to records and back: the columns every statement selects, the sealed parts opened through
//! [`super::seal`], and the version and change rows every writer inserts.

use rusqlite::{Connection, OptionalExtension, Row, params};
use serde_json::{Value, json};
use umbel_store::memory::{
    Invalidation, InvalidationReason, MemoryChangeKind, MemoryMeta, MemoryScope, Observations,
};
use umbel_store::{
    AccessSet, Actor, Authority, ContentHash, Envelope, MemoryClass, MemoryFlag, MemoryRecord,
    Millis, Rev, Sensitivity, StoreError,
};

use super::seal::{Part, RecordKey, Seal};
use crate::error::{Fail, to_i64, to_u64};

/// The `records` columns, aliased `r`, in [`RecordRow::from_row`]'s order.
pub(crate) const RECORD_COLS: &str = "r.rowid, r.id, r.class, r.owner, r.project, r.agent, \
    r.session, r.flags, r.expires, r.sensitivity, r.access, r.supersedes, r.sealed";
/// How many columns [`RECORD_COLS`] holds.
pub(crate) const RECORD_WIDTH: usize = 13;
/// The `versions` columns, aliased `v`, in [`VersionRow::from_row`]'s order.
pub(crate) const VERSION_COLS: &str = "v.record_version, v.valid_from, v.valid_until, \
    v.recorded_at, v.recorded_until, v.authority, v.inv_at, v.inv_by, v.inv_reason, \
    v.superseded_by, v.envelope, v.sealed";

fn corrupt(what: &str) -> Fail {
    StoreError::Corrupt(format!("a stored memory {what} is unreadable")).into()
}

fn json_text<T: serde::de::DeserializeOwned>(text: &str, what: &str) -> Result<T, Fail> {
    serde_json::from_str(text).map_err(|_| corrupt(what))
}

pub(crate) fn class_text(class: MemoryClass) -> &'static str {
    class.as_str()
}

fn parse_class(text: &str) -> Result<MemoryClass, Fail> {
    MemoryClass::parse(text).ok_or_else(|| corrupt("class"))
}

pub(crate) fn flag_texts(flags: &[MemoryFlag]) -> String {
    json!(flags.iter().map(|f| f.as_str()).collect::<Vec<_>>()).to_string()
}

fn parse_flags(text: &str) -> Result<Vec<MemoryFlag>, Fail> {
    let names: Vec<String> = json_text(text, "flag list")?;
    names
        .iter()
        .map(|name| match name.as_str() {
            "hidden-text" => Ok(MemoryFlag::HiddenText),
            "instruction-like" => Ok(MemoryFlag::InstructionLike),
            _ => Err(corrupt("flag")),
        })
        .collect()
}

pub(crate) fn sensitivity_text(sensitivity: Sensitivity) -> Result<String, Fail> {
    match serde_json::to_value(sensitivity) {
        Ok(Value::String(text)) => Ok(text),
        _ => Err(corrupt("sensitivity")),
    }
}

fn parse_sensitivity(text: &str) -> Result<Sensitivity, Fail> {
    serde_json::from_value(Value::String(text.to_owned())).map_err(|_| corrupt("sensitivity"))
}

fn parse_authority(text: &str) -> Result<Authority, Fail> {
    Authority::parse(text).ok_or_else(|| corrupt("authority"))
}

pub(crate) fn reason_text(reason: InvalidationReason) -> &'static str {
    reason.as_str()
}

fn parse_reason(text: &str) -> Result<InvalidationReason, Fail> {
    match text {
        "wrong" => Ok(InvalidationReason::Wrong),
        "outdated" => Ok(InvalidationReason::Outdated),
        "duplicate" => Ok(InvalidationReason::Duplicate),
        "other" => Ok(InvalidationReason::Other),
        _ => Err(corrupt("invalidation reason")),
    }
}

pub(crate) fn change_kind_text(kind: MemoryChangeKind) -> &'static str {
    match kind {
        MemoryChangeKind::Created => "created",
        MemoryChangeKind::Observed => "observed",
        MemoryChangeKind::Invalidated => "invalidated",
        MemoryChangeKind::Confirmed => "confirmed",
        MemoryChangeKind::Erased => "erased",
        MemoryChangeKind::Purged => "purged",
    }
}

pub(crate) fn parse_change_kind(text: &str) -> Result<MemoryChangeKind, Fail> {
    Ok(match text {
        "created" => MemoryChangeKind::Created,
        "observed" => MemoryChangeKind::Observed,
        "invalidated" => MemoryChangeKind::Invalidated,
        "confirmed" => MemoryChangeKind::Confirmed,
        "erased" => MemoryChangeKind::Erased,
        "purged" => MemoryChangeKind::Purged,
        _ => return Err(corrupt("change kind")),
    })
}

/// The access set as stored in `records.access`: its sorted tokens as a JSON array, so equal sets
/// compare equal as text.
pub(crate) fn access_text(access: &AccessSet) -> String {
    json!(access.tokens()).to_string()
}

/// One `records` row.
pub(crate) struct RecordRow {
    pub(crate) rowid: i64,
    pub(crate) id: String,
    pub(crate) class: MemoryClass,
    pub(crate) owner: String,
    pub(crate) project: Option<String>,
    pub(crate) agent: Option<Actor>,
    pub(crate) session: Option<String>,
    pub(crate) flags: Vec<MemoryFlag>,
    pub(crate) expires: Millis,
    pub(crate) sensitivity: Sensitivity,
    pub(crate) access: AccessSet,
    pub(crate) supersedes: Vec<String>,
    pub(crate) sealed: Vec<u8>,
}

impl RecordRow {
    /// The row from [`RECORD_COLS`], starting at column `at`.
    pub(crate) fn from_row(row: &Row<'_>, at: usize) -> Result<Self, Fail> {
        let agent: Option<String> = row.get(at + 5)?;
        Ok(Self {
            rowid: row.get(at)?,
            id: row.get(at + 1)?,
            class: parse_class(&row.get::<_, String>(at + 2)?)?,
            owner: row.get(at + 3)?,
            project: row.get(at + 4)?,
            agent: agent.map(|a| json_text(&a, "agent")).transpose()?,
            session: row.get(at + 6)?,
            flags: parse_flags(&row.get::<_, String>(at + 7)?)?,
            expires: row.get(at + 8)?,
            sensitivity: parse_sensitivity(&row.get::<_, String>(at + 9)?)?,
            access: json_text(&row.get::<_, String>(at + 10)?, "access set")?,
            supersedes: json_text(&row.get::<_, String>(at + 11)?, "supersede list")?,
            sealed: row.get(at + 12)?,
        })
    }

    fn seal<'a>(&'a self, space: &'a str, part: Part) -> Seal<'a> {
        Seal {
            space,
            id: &self.id,
            owner: &self.owner,
            part,
        }
    }

    /// Open the body under the record's key.
    pub(crate) fn body(&self, space: &str, key: &RecordKey) -> Result<Body, Fail> {
        let plain = self.seal(space, Part::Body).open(key, &self.sealed)?;
        let invalid = || -> Fail {
            StoreError::SealInvalid {
                id: self.id.clone(),
            }
            .into()
        };
        let value: Value = serde_json::from_slice(&plain).map_err(|_| invalid())?;
        let text = |key: &str| value[key].as_str().map(str::to_owned).ok_or_else(invalid);
        let tags = value["tags"]
            .as_array()
            .ok_or_else(invalid)?
            .iter()
            .map(|t| t.as_str().map(str::to_owned).ok_or_else(invalid))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Body {
            subject: text("subject")?,
            text: text("text")?,
            tags,
            content_hash: ContentHash::parse(&text("contentHash")?).map_err(|_| invalid())?,
        })
    }

    /// Open a version row of this record under the record's key.
    pub(crate) fn version(
        &self,
        space: &str,
        key: &RecordKey,
        row: VersionRow,
    ) -> Result<FullVersion, Fail> {
        let sealed = match &row.sealed {
            Some(blob) => {
                let plain = self
                    .seal(space, Part::Version(row.number))
                    .open(key, blob)?;
                Some(
                    serde_json::from_slice::<Value>(&plain).map_err(|_| -> Fail {
                        StoreError::SealInvalid {
                            id: self.id.clone(),
                        }
                        .into()
                    })?,
                )
            }
            None => None,
        };
        let mut envelope: Envelope = json_text(&row.envelope, "envelope")?;
        let mut note = None;
        if let Some(sealed) = sealed {
            envelope.sources = sealed_field(&sealed, "sources")?;
            envelope.derived_from = sealed_field(&sealed, "derivedFrom")?;
            envelope.constraints = sealed_field(&sealed, "constraints")?;
            envelope.generated = sealed_field(&sealed, "generated")?;
            envelope.content_hash = sealed_field(&sealed, "contentHash")?;
            note = sealed_field(&sealed, "note")?;
        }
        let invalidation = match (row.inv_at, row.inv_by, row.inv_reason) {
            (Some(at), Some(by), Some(reason)) => Some(Invalidation {
                at,
                by,
                reason: parse_reason(&reason)?,
                note,
            }),
            _ => None,
        };
        Ok(FullVersion {
            number: row.number,
            valid_from: row.valid_from,
            valid_until: row.valid_until,
            recorded_at: row.recorded_at,
            recorded_until: row.recorded_until,
            invalidation,
            superseded_by: row.superseded_by,
            envelope,
        })
    }

    /// The scope tuple.
    pub(crate) fn scope(&self, space: &str) -> MemoryScope {
        MemoryScope {
            space: space.to_owned(),
            project: self.project.clone(),
            principal: self.owner.clone(),
            agent: self.agent.clone(),
            session: self.session.clone(),
        }
    }

    /// The record at version `v`, its body opened and its observations counted.
    pub(crate) fn record(
        &self,
        conn: &Connection,
        space: &str,
        key: &RecordKey,
        v: FullVersion,
    ) -> Result<MemoryRecord, Fail> {
        let body = self.body(space, key)?;
        Ok(MemoryRecord {
            id: self.id.clone(),
            record_version: v.number,
            class: self.class,
            scope: self.scope(space),
            subject: body.subject,
            text: body.text,
            tags: body.tags,
            access: self.access.clone(),
            sensitivity: self.sensitivity,
            flags: self.flags.clone(),
            valid_from: v.valid_from,
            valid_until: v.valid_until,
            recorded_at: v.recorded_at,
            recorded_until: v.recorded_until,
            expires_at: self.expires,
            observations: observations(conn, &self.id)?,
            supersedes: self.supersedes.clone(),
            superseded_by: v.superseded_by,
            invalidation: v.invalidation,
            content_hash: body.content_hash,
            provenance: v.envelope,
        })
    }

    /// The listed form at version `v`: subject and tags, no text.
    pub(crate) fn meta(
        &self,
        space: &str,
        key: &RecordKey,
        v: &VersionRow,
    ) -> Result<MemoryMeta, Fail> {
        let body = self.body(space, key)?;
        let envelope: Envelope = json_text(&v.envelope, "envelope")?;
        Ok(MemoryMeta {
            id: self.id.clone(),
            record_version: v.number,
            class: self.class,
            scope: self.scope(space),
            subject: body.subject,
            tags: body.tags,
            access: self.access.clone(),
            sensitivity: self.sensitivity,
            flags: self.flags.clone(),
            authority: v.authority,
            origin: envelope.origin,
            valid_from: v.valid_from,
            valid_until: v.valid_until,
            recorded_at: v.recorded_at,
            expires_at: self.expires,
        })
    }

    /// The current version, opened.
    pub(crate) fn current(
        &self,
        conn: &Connection,
        space: &str,
        key: &RecordKey,
    ) -> Result<FullVersion, Fail> {
        let sql = format!(
            "SELECT {VERSION_COLS} FROM versions v WHERE v.id = ?1 AND v.recorded_until IS NULL"
        );
        let row = conn
            .query_row(&sql, [&self.id], |row| Ok(VersionRow::from_row(row, 0)))
            .optional()?
            .ok_or_else(|| corrupt("record without a current version"))??;
        self.version(space, key, row)
    }
}

fn sealed_field<T: serde::de::DeserializeOwned>(sealed: &Value, key: &str) -> Result<T, Fail> {
    serde_json::from_value(sealed.get(key).cloned().unwrap_or(Value::Null))
        .map_err(|_| corrupt("sealed envelope field"))
}

/// The opened body.
pub(crate) struct Body {
    pub(crate) subject: String,
    pub(crate) text: String,
    pub(crate) tags: Vec<String>,
    pub(crate) content_hash: ContentHash,
}

/// The body as sealed: subject, text, tags and content hash.
pub(crate) fn body_plain(
    subject: &str,
    text: &str,
    tags: &[String],
    hash: &ContentHash,
) -> Vec<u8> {
    json!({"subject": subject, "text": text, "tags": tags, "contentHash": hash.as_str()})
        .to_string()
        .into_bytes()
}

/// One `versions` row, its sealed part still closed.
pub(crate) struct VersionRow {
    pub(crate) number: u32,
    pub(crate) valid_from: Millis,
    pub(crate) valid_until: Option<Millis>,
    pub(crate) recorded_at: Millis,
    pub(crate) recorded_until: Option<Millis>,
    pub(crate) authority: Authority,
    inv_at: Option<Millis>,
    inv_by: Option<String>,
    inv_reason: Option<String>,
    superseded_by: Option<String>,
    envelope: String,
    sealed: Option<Vec<u8>>,
}

impl VersionRow {
    /// The row from [`VERSION_COLS`], starting at column `at`.
    pub(crate) fn from_row(row: &Row<'_>, at: usize) -> Result<Self, Fail> {
        Ok(Self {
            number: row.get(at)?,
            valid_from: row.get(at + 1)?,
            valid_until: row.get(at + 2)?,
            recorded_at: row.get(at + 3)?,
            recorded_until: row.get(at + 4)?,
            authority: parse_authority(&row.get::<_, String>(at + 5)?)?,
            inv_at: row.get(at + 6)?,
            inv_by: row.get(at + 7)?,
            inv_reason: row.get(at + 8)?,
            superseded_by: row.get(at + 9)?,
            envelope: row.get(at + 10)?,
            sealed: row.get(at + 11)?,
        })
    }
}

/// A version, opened: what a writer copies into the next.
#[derive(Clone)]
pub(crate) struct FullVersion {
    pub(crate) number: u32,
    pub(crate) valid_from: Millis,
    pub(crate) valid_until: Option<Millis>,
    pub(crate) recorded_at: Millis,
    pub(crate) recorded_until: Option<Millis>,
    pub(crate) invalidation: Option<Invalidation>,
    pub(crate) superseded_by: Option<String>,
    pub(crate) envelope: Envelope,
}

impl FullVersion {
    /// The version's authority, from its envelope.
    pub(crate) fn authority(&self) -> Result<Authority, Fail> {
        parse_authority(self.envelope.authority.as_deref().unwrap_or(""))
    }
}

/// Insert version `v` of record `id`: the envelope in clear without its sealed fields, and those
/// fields with the invalidation's note sealed under the record's key, or null when all are null
/// (section 5.4's table).
pub(crate) fn insert_version(
    conn: &Connection,
    space: &str,
    owner: &str,
    id: &str,
    key: &RecordKey,
    v: &FullVersion,
) -> Result<(), Fail> {
    let mut clear = v.envelope.clone();
    let sealed_fields = json!({
        "sources": clear.sources.take(),
        "derivedFrom": clear.derived_from.take(),
        "constraints": clear.constraints.take(),
        "generated": clear.generated.take(),
        "contentHash": clear.content_hash.take(),
        "note": v.invalidation.as_ref().and_then(|i| i.note.clone()),
    });
    let all_null = sealed_fields
        .as_object()
        .is_some_and(|o| o.values().all(Value::is_null));
    let sealed = if all_null {
        None
    } else {
        Some(
            Seal {
                space,
                id,
                owner,
                part: Part::Version(v.number),
            }
            .seal(key, sealed_fields.to_string().as_bytes())?,
        )
    };
    let envelope = serde_json::to_string(&clear).map_err(|_| corrupt("envelope"))?;
    let authority = v.authority()?;
    conn.execute(
        "INSERT INTO versions (id, record_version, valid_from, valid_until, recorded_at, \
         recorded_until, authority, inv_at, inv_by, inv_reason, superseded_by, envelope, sealed) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            id,
            v.number,
            v.valid_from,
            v.valid_until,
            v.recorded_at,
            v.recorded_until,
            authority.as_str(),
            v.invalidation.as_ref().map(|i| i.at),
            v.invalidation.as_ref().map(|i| i.by.clone()),
            v.invalidation.as_ref().map(|i| reason_text(i.reason)),
            v.superseded_by,
            envelope,
            sealed,
        ],
    )?;
    Ok(())
}

/// The record's observation counts.
pub(crate) fn observations(conn: &Connection, id: &str) -> Result<Observations, Fail> {
    let (first, last, count, sessions): (Millis, Millis, i64, i64) = conn.query_row(
        "SELECT COALESCE(MIN(at), 0), COALESCE(MAX(at), 0), COUNT(*), COUNT(DISTINCT session) \
         FROM observations WHERE id = ?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )?;
    Ok(Observations {
        first,
        last,
        count: to_u64(count)?,
        sessions: to_u64(sessions)?,
    })
}

/// The next revision. Called inside a `BEGIN IMMEDIATE`, so no other writer can take it.
pub(crate) fn next_rev(conn: &Connection) -> Result<Rev, Fail> {
    let head: i64 = conn.query_row("SELECT COALESCE(MAX(rev), 0) FROM changes", [], |r| {
        r.get(0)
    })?;
    Ok(to_u64(head)? + 1)
}

/// One change row: what happened, never text.
pub(crate) struct ChangeRow<'a> {
    pub(crate) kind: MemoryChangeKind,
    pub(crate) id: &'a str,
    pub(crate) record_version: u32,
    pub(crate) trace_id: Option<&'a str>,
    pub(crate) at: Millis,
    pub(crate) owner: &'a str,
    pub(crate) agent: Option<&'a str>,
    pub(crate) bytes: u64,
    pub(crate) access: &'a AccessSet,
}

/// Insert a change at the next revision, with the access the record has now; returns it.
pub(crate) fn insert_change(conn: &Connection, change: &ChangeRow<'_>) -> Result<Rev, Fail> {
    let rev = next_rev(conn)?;
    let rev_i = to_i64(rev)?;
    conn.execute(
        "INSERT INTO changes (rev, kind, id, record_version, trace_id, at, owner, agent, bytes) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            rev_i,
            change_kind_text(change.kind),
            change.id,
            change.record_version,
            change.trace_id,
            change.at,
            change.owner,
            change.agent,
            to_i64(change.bytes)?,
        ],
    )?;
    for token in change.access.tokens() {
        conn.execute(
            "INSERT INTO change_access (rev, token) VALUES (?1, ?2)",
            params![rev_i, token],
        )?;
    }
    Ok(rev)
}

/// The record `id`'s row, whoever may read it.
pub(crate) fn record_row(conn: &Connection, id: &str) -> Result<Option<RecordRow>, Fail> {
    let sql = format!("SELECT {RECORD_COLS} FROM records r WHERE r.id = ?1");
    conn.query_row(&sql, [id], |row| Ok(RecordRow::from_row(row, 0)))
        .optional()?
        .transpose()
}

/// Remove every row of a record (section 5.4's step 3): its index row first, by rowid, which
/// needs no key, then derived rows, observations, access rows, versions and the record.
/// `secure_delete` and FTS5's `secure-delete` overwrite what they free. Without `index`, the
/// database is a restored copy with no `records_fts` or `record_derived` yet.
pub(crate) fn erase_rows(conn: &Connection, rec: &RecordRow, index: bool) -> Result<(), Fail> {
    if index {
        conn.execute("DELETE FROM records_fts WHERE rowid = ?1", [rec.rowid])?;
        conn.execute("DELETE FROM record_derived WHERE id = ?1", [&rec.id])?;
    }
    for table in ["observations", "record_access", "versions"] {
        conn.execute(&format!("DELETE FROM {table} WHERE id = ?1"), [&rec.id])?;
    }
    conn.execute("DELETE FROM records WHERE rowid = ?1", [rec.rowid])?;
    Ok(())
}

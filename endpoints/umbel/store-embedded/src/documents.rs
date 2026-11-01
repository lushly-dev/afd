//! `DocumentStore` over SQLite: documents, plugin records and the change log.

use rusqlite::{
    OptionalExtension, Row, Transaction, TransactionBehavior, params, params_from_iter,
};
use serde::de::DeserializeOwned;
use serde_json::Value as Json;
use umbel_store::{
    Change, ChangeKind, ContentHash, DocMeta, Document, DocumentStore, DocumentWrite, Envelope,
    Expect, ListQuery, MAX_CHANGES_LIMIT, MAX_LIST_LIMIT, Page, ReaderFilter, Record, RecordMeta,
    Rev, StoreError, check_identifier, check_record, record_target,
};

use crate::SqliteStore;
use crate::error::{Fail, to_i64, to_u64};
use crate::sql::Sql;

/// Compare a write's condition with what is stored.
fn check_expect(expect: &Expect, current: Option<&str>) -> Result<(), Fail> {
    let holds = match expect {
        Expect::Any => true,
        Expect::Absent => current.is_none(),
        Expect::Hash(hash) => current == Some(hash.as_str()),
    };
    if holds {
        Ok(())
    } else {
        Err(StoreError::Conflict {
            current: current.map(str::to_owned),
        }
        .into())
    }
}

/// The next revision. Called inside a `BEGIN IMMEDIATE`, so no other writer can take it.
fn next_rev(tx: &Transaction<'_>) -> Result<Rev, Fail> {
    let head: i64 = tx.query_row("SELECT COALESCE(MAX(rev), 0) FROM changes", [], |r| {
        r.get(0)
    })?;
    Ok(to_u64(head)? + 1)
}

fn insert_change(
    tx: &Transaction<'_>,
    rev: Rev,
    kind: &str,
    target: &str,
    content_hash: &str,
    envelope: &Envelope,
    access: &[String],
) -> Result<(), Fail> {
    let rev = to_i64(rev)?;
    tx.execute(
        "INSERT INTO changes (rev, kind, target, content_hash, trace_id, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![rev, kind, target, content_hash, envelope.trace_id, envelope.observed_at],
    )?;
    for token in access {
        tx.execute(
            "INSERT INTO change_access (rev, token) VALUES (?1, ?2)",
            params![rev, token],
        )?;
    }
    Ok(())
}

fn enum_text<T: serde::Serialize>(value: &T) -> Result<String, Fail> {
    match serde_json::to_value(value) {
        Ok(Json::String(text)) => Ok(text),
        _ => Err(StoreError::Corrupt("an enum did not serialise to text".to_owned()).into()),
    }
}

fn parse_enum<T: DeserializeOwned>(text: &str) -> Result<T, Fail> {
    serde_json::from_value(Json::String(text.to_owned()))
        .map_err(|e| StoreError::Corrupt(format!("a stored value `{text}` is unknown: {e}")).into())
}

fn parse_json<T: DeserializeOwned>(text: &str) -> Result<T, Fail> {
    serde_json::from_str(text)
        .map_err(|e| StoreError::Corrupt(format!("a stored JSON value is unreadable: {e}")).into())
}

fn check_limit(limit: u32, max: u32) -> Result<(), Fail> {
    if (1..=max).contains(&limit) {
        Ok(())
    } else {
        Err(StoreError::invalid(format!("limit must be 1 to {max}")).into())
    }
}

fn meta_from_row(row: &Row<'_>) -> Result<DocMeta, Fail> {
    let access: Option<String> = row.get(11)?;
    let tokens = access
        .as_deref()
        .unwrap_or("")
        .split('\u{1f}')
        .filter(|t| !t.is_empty());
    Ok(DocMeta {
        id: row.get(0)?,
        rev: to_u64(row.get(1)?)?,
        collection: row.get(2)?,
        path: row.get(3)?,
        doc_type: row.get(4)?,
        title: row.get(5)?,
        status: parse_enum(&row.get::<_, String>(6)?)?,
        content_hash: ContentHash::parse(&row.get::<_, String>(7)?)?,
        size: to_u64(row.get(8)?)?,
        sensitivity: parse_enum(&row.get::<_, String>(9)?)?,
        flags: parse_json(&row.get::<_, String>(10)?)?,
        access: umbel_store::AccessSet::new(tokens.map(str::to_owned)).map_err(|_| {
            StoreError::Corrupt("a stored document has no access tokens".to_owned())
        })?,
    })
}

impl DocumentStore for SqliteStore {
    fn put_document(&self, doc: DocumentWrite, expect: Expect) -> Result<DocMeta, StoreError> {
        doc.check(self.space())?;
        let record = doc.metadata_json()?;
        let flags = serde_json::to_string(&doc.flags)
            .map_err(|e| StoreError::Corrupt(format!("flags would not serialise: {e}")))?;
        let status = enum_text(&doc.status)?;
        let sensitivity = enum_text(&doc.sensitivity)?;
        self.pool().with(|conn| {
            let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let current: Option<String> = tx
                .query_row("SELECT content_hash FROM documents WHERE doc = ?1", [&doc.id], |r| r.get(0))
                .optional()?;
            check_expect(&expect, current.as_deref())?;
            let rev = next_rev(&tx)?;
            tx.execute(
                "INSERT INTO documents (doc, rev, collection, path, doc_type, title, status, content_hash, size, sensitivity, flags, record, bytes)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
                 ON CONFLICT (doc) DO UPDATE SET rev = excluded.rev, collection = excluded.collection,
                   path = excluded.path, doc_type = excluded.doc_type, title = excluded.title,
                   status = excluded.status, content_hash = excluded.content_hash, size = excluded.size,
                   sensitivity = excluded.sensitivity, flags = excluded.flags, record = excluded.record,
                   bytes = excluded.bytes",
                params![
                    doc.id, to_i64(rev)?, doc.collection, doc.path, doc.doc_type, doc.title, status,
                    doc.content_hash.as_str(), to_i64(doc.size)?, sensitivity, flags, record, doc.bytes
                ],
            )?;
            tx.execute("DELETE FROM doc_access WHERE doc = ?1", [&doc.id])?;
            for token in doc.access.tokens() {
                tx.execute("INSERT INTO doc_access (doc, token) VALUES (?1, ?2)", params![doc.id, token])?;
            }
            insert_change(&tx, rev, "put", &doc.id, doc.content_hash.as_str(), &doc.envelope, doc.access.tokens())?;
            tx.commit()?;
            Ok(doc.meta(rev))
        })
    }

    fn delete_document(
        &self,
        id: &str,
        expect: Expect,
        envelope: Envelope,
    ) -> Result<Rev, StoreError> {
        check_identifier("a document id", id)?;
        envelope.check(self.space())?;
        self.pool().with(|conn| {
            let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let current: Option<String> = tx
                .query_row(
                    "SELECT content_hash FROM documents WHERE doc = ?1",
                    [id],
                    |r| r.get(0),
                )
                .optional()?;
            let Some(hash) = current else {
                return Err(StoreError::NotFound.into());
            };
            check_expect(&expect, Some(&hash))?;
            let access: Vec<String> = {
                let mut statement =
                    tx.prepare("SELECT token FROM doc_access WHERE doc = ?1 ORDER BY token")?;
                statement
                    .query_map([id], |r| r.get(0))?
                    .collect::<Result<_, _>>()?
            };
            let rev = next_rev(&tx)?;
            tx.execute("DELETE FROM doc_access WHERE doc = ?1", [id])?;
            tx.execute("DELETE FROM documents WHERE doc = ?1", [id])?;
            insert_change(&tx, rev, "delete", id, &hash, &envelope, &access)?;
            tx.commit()?;
            Ok(rev)
        })
    }

    fn get_document(
        &self,
        id: &str,
        reader: &ReaderFilter,
    ) -> Result<Option<Document>, StoreError> {
        let mut sql = Sql::new("SELECT d.rev, d.record, d.bytes FROM documents d WHERE d.doc = ");
        sql.bind(id).and_doc_readable("d.doc", reader);
        self.pool().with(|conn| {
            let row = conn
                .query_row(&sql.text, params_from_iter(&sql.params), |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, Vec<u8>>(2)?,
                    ))
                })
                .optional()?;
            row.map(|(rev, record, bytes)| {
                Ok(Document {
                    rev: to_u64(rev)?,
                    write: DocumentWrite::from_metadata_json(&record, bytes)?,
                })
            })
            .transpose()
        })
    }

    fn list_documents(
        &self,
        query: &ListQuery,
        reader: &ReaderFilter,
    ) -> Result<Page<DocMeta>, StoreError> {
        check_limit(query.limit, MAX_LIST_LIMIT)?;
        let mut sql = Sql::new(
            "SELECT d.doc, d.rev, d.collection, d.path, d.doc_type, d.title, d.status, d.content_hash,
                    d.size, d.sensitivity, d.flags,
                    (SELECT group_concat(a.token, char(31)) FROM doc_access a WHERE a.doc = d.doc)
             FROM documents d WHERE 1 = 1",
        );
        if let Some(collection) = &query.collection {
            sql.push(" AND d.collection = ").bind(collection.as_str());
        }
        if let Some(doc_type) = &query.doc_type {
            sql.push(" AND d.doc_type = ").bind(doc_type.as_str());
        }
        if let Some(prefix) = &query.prefix {
            sql.push(" AND d.doc >= ").bind(prefix.as_str());
            sql.push(" AND substr(d.doc, 1, ")
                .bind(prefix.chars().count() as i64);
            sql.push(") = ").bind(prefix.as_str());
        }
        if let Some(after) = &query.after {
            sql.push(" AND d.doc > ").bind(after.as_str());
        }
        sql.and_doc_readable("d.doc", reader);
        sql.push(" ORDER BY d.doc LIMIT ")
            .bind(i64::from(query.limit) + 1);
        self.pool().with(|conn| {
            let mut statement = conn.prepare_cached(&sql.text)?;
            let mut rows = statement.query(params_from_iter(&sql.params))?;
            let mut items = Vec::new();
            while let Some(row) = rows.next()? {
                items.push(meta_from_row(row)?);
            }
            let next = if items.len() > query.limit as usize {
                items.truncate(query.limit as usize);
                items.last().map(|m| m.id.clone())
            } else {
                None
            };
            Ok(Page { items, next })
        })
    }

    fn changes(
        &self,
        after: Rev,
        limit: u32,
        reader: &ReaderFilter,
        trace: Option<&str>,
    ) -> Result<Vec<Change>, StoreError> {
        check_limit(limit, MAX_CHANGES_LIMIT)?;
        let mut sql = Sql::new(
            "SELECT c.rev, c.kind, c.target, c.content_hash, c.trace_id, c.at FROM changes c WHERE c.rev > ",
        );
        sql.bind(to_i64(after)?);
        if let Some(trace) = trace {
            sql.push(" AND c.trace_id = ").bind(trace);
        }
        sql.and_readable("change_access", &[("rev", "c.rev")], reader);
        sql.push(" ORDER BY c.rev LIMIT ").bind(i64::from(limit));
        self.pool().with(|conn| {
            let mut statement = conn.prepare_cached(&sql.text)?;
            let mut rows = statement.query(params_from_iter(&sql.params))?;
            let mut changes = Vec::new();
            while let Some(row) = rows.next()? {
                let kind: String = row.get(1)?;
                changes.push(Change {
                    rev: to_u64(row.get(0)?)?,
                    kind: match kind.as_str() {
                        "put" => ChangeKind::Put,
                        "delete" => ChangeKind::Delete,
                        "record" => ChangeKind::Record,
                        other => {
                            return Err(StoreError::Corrupt(format!(
                                "unknown change kind `{other}`"
                            ))
                            .into());
                        }
                    },
                    target: row.get(2)?,
                    content_hash: row.get(3)?,
                    trace_id: row.get(4)?,
                    at: row.get(5)?,
                });
            }
            Ok(changes)
        })
    }

    fn head(&self) -> Result<Rev, StoreError> {
        self.pool().with(|conn| {
            let head: i64 =
                conn.query_row("SELECT COALESCE(MAX(rev), 0) FROM changes", [], |r| {
                    r.get(0)
                })?;
            Ok(to_u64(head)?)
        })
    }

    fn put_record(
        &self,
        ns: &str,
        kind: &str,
        id: &str,
        body: Json,
        envelope: Envelope,
        expect: Expect,
    ) -> Result<RecordMeta, StoreError> {
        let (hash, access) = check_record(ns, kind, id, &body, &envelope, self.space())?;
        let body_text = umbel_store::canonical_json(&body);
        let envelope_text = serde_json::to_string(&envelope)
            .map_err(|e| StoreError::Corrupt(format!("an envelope would not serialise: {e}")))?;
        self.pool().with(|conn| {
            let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let current: Option<String> = tx
                .query_row(
                    "SELECT content_hash FROM records WHERE ns = ?1 AND kind = ?2 AND id = ?3",
                    params![ns, kind, id],
                    |r| r.get(0),
                )
                .optional()?;
            check_expect(&expect, current.as_deref())?;
            let rev = next_rev(&tx)?;
            tx.execute(
                "INSERT INTO records (ns, kind, id, rev, content_hash, body, envelope) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT (ns, kind, id) DO UPDATE SET rev = excluded.rev,
                   content_hash = excluded.content_hash, body = excluded.body, envelope = excluded.envelope",
                params![ns, kind, id, to_i64(rev)?, hash.as_str(), body_text, envelope_text],
            )?;
            tx.execute(
                "DELETE FROM record_access WHERE ns = ?1 AND kind = ?2 AND id = ?3",
                params![ns, kind, id],
            )?;
            for token in access.tokens() {
                tx.execute(
                    "INSERT INTO record_access (ns, kind, id, token) VALUES (?1, ?2, ?3, ?4)",
                    params![ns, kind, id, token],
                )?;
            }
            insert_change(&tx, rev, "record", &record_target(ns, kind, id), hash.as_str(), &envelope, access.tokens())?;
            tx.commit()?;
            Ok(RecordMeta { ns: ns.to_owned(), kind: kind.to_owned(), id: id.to_owned(), rev, content_hash: hash })
        })
    }

    fn get_record(
        &self,
        ns: &str,
        kind: &str,
        id: &str,
        reader: &ReaderFilter,
    ) -> Result<Option<Record>, StoreError> {
        let mut sql = Sql::new(
            "SELECT r.ns, r.kind, r.id, r.rev, r.content_hash, r.body, r.envelope FROM records r WHERE r.ns = ",
        );
        sql.bind(ns)
            .push(" AND r.kind = ")
            .bind(kind)
            .push(" AND r.id = ")
            .bind(id);
        sql.and_readable(
            "record_access",
            &[("ns", "r.ns"), ("kind", "r.kind"), ("id", "r.id")],
            reader,
        );
        self.pool().with(|conn| {
            let mut statement = conn.prepare_cached(&sql.text)?;
            let mut rows = statement.query(params_from_iter(&sql.params))?;
            rows.next()?.map(record_from_row).transpose()
        })
    }

    fn list_records(
        &self,
        ns: &str,
        kind: &str,
        after: Option<&str>,
        limit: u32,
        reader: &ReaderFilter,
    ) -> Result<Page<Record>, StoreError> {
        check_limit(limit, MAX_LIST_LIMIT)?;
        let mut sql = Sql::new(
            "SELECT r.ns, r.kind, r.id, r.rev, r.content_hash, r.body, r.envelope FROM records r WHERE r.ns = ",
        );
        sql.bind(ns).push(" AND r.kind = ").bind(kind);
        if let Some(after) = after {
            sql.push(" AND r.id > ").bind(after);
        }
        sql.and_readable(
            "record_access",
            &[("ns", "r.ns"), ("kind", "r.kind"), ("id", "r.id")],
            reader,
        );
        sql.push(" ORDER BY r.id LIMIT ").bind(i64::from(limit) + 1);
        self.pool().with(|conn| {
            let mut statement = conn.prepare_cached(&sql.text)?;
            let mut rows = statement.query(params_from_iter(&sql.params))?;
            let mut items = Vec::new();
            while let Some(row) = rows.next()? {
                items.push(record_from_row(row)?);
            }
            let next = if items.len() > limit as usize {
                items.truncate(limit as usize);
                items.last().map(|r| r.id.clone())
            } else {
                None
            };
            Ok(Page { items, next })
        })
    }

    fn checkpoint(&self) -> Result<(), StoreError> {
        self.pool().with(|conn| {
            // Best effort: a busy checkpoint (a reader holds the WAL) is not an error.
            match conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(())) {
                Ok(()) => Ok(()),
                Err(error) if matches!(crate::error::map_sql(&error), StoreError::Busy) => Ok(()),
                Err(error) => Err(error.into()),
            }
        })
    }
}

fn record_from_row(row: &Row<'_>) -> Result<Record, Fail> {
    Ok(Record {
        ns: row.get(0)?,
        kind: row.get(1)?,
        id: row.get(2)?,
        rev: to_u64(row.get(3)?)?,
        content_hash: ContentHash::parse(&row.get::<_, String>(4)?)?,
        body: parse_json(&row.get::<_, String>(5)?)?,
        envelope: parse_json(&row.get::<_, String>(6)?)?,
    })
}

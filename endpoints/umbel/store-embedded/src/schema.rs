//! The SQLite schema, version 1 (specification section 3.2).

/// `PRAGMA user_version` of the schema this build writes and serves.
pub(crate) const SCHEMA_VERSION: u32 = 1;

/// Tables are `STRICT`. Access is a join table per kind of row, so a reader filter is a semi-join
/// inside the same statement as the selection, ordering and limit. `change_access` holds the
/// access set a change had when it was made, so a change stays exactly as readable as the write
/// it records, whatever the document's access becomes. The graph has no access tables of its
/// own: a node or edge is readable through its origin document's `doc_access`.
pub(crate) const SCHEMA: &str = "
CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE documents (
    doc          TEXT PRIMARY KEY,
    rev          INTEGER NOT NULL,
    collection   TEXT NOT NULL,
    path         TEXT NOT NULL,
    doc_type     TEXT NOT NULL,
    title        TEXT NOT NULL,
    status       TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    size         INTEGER NOT NULL,
    sensitivity  TEXT NOT NULL,
    flags        TEXT NOT NULL,
    record       TEXT NOT NULL,
    bytes        BLOB NOT NULL
) STRICT, WITHOUT ROWID;
CREATE INDEX documents_by_collection ON documents (collection, doc);
CREATE INDEX documents_by_type ON documents (doc_type, doc);

CREATE TABLE doc_access (
    doc   TEXT NOT NULL REFERENCES documents (doc) ON DELETE CASCADE,
    token TEXT NOT NULL,
    PRIMARY KEY (doc, token)
) STRICT, WITHOUT ROWID;
CREATE INDEX doc_access_by_token ON doc_access (token, doc);

CREATE TABLE records (
    ns           TEXT NOT NULL,
    kind         TEXT NOT NULL,
    id           TEXT NOT NULL,
    rev          INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    body         TEXT NOT NULL,
    envelope     TEXT NOT NULL,
    PRIMARY KEY (ns, kind, id)
) STRICT, WITHOUT ROWID;

CREATE TABLE record_access (
    ns    TEXT NOT NULL,
    kind  TEXT NOT NULL,
    id    TEXT NOT NULL,
    token TEXT NOT NULL,
    PRIMARY KEY (ns, kind, id, token),
    FOREIGN KEY (ns, kind, id) REFERENCES records (ns, kind, id) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;
CREATE INDEX record_access_by_token ON record_access (token, ns, kind, id);

CREATE TABLE changes (
    rev          INTEGER PRIMARY KEY,
    kind         TEXT NOT NULL,
    target       TEXT NOT NULL,
    content_hash TEXT,
    trace_id     TEXT,
    at           TEXT NOT NULL
) STRICT;
CREATE INDEX changes_by_trace ON changes (trace_id, rev) WHERE trace_id IS NOT NULL;

CREATE TABLE change_access (
    rev   INTEGER NOT NULL REFERENCES changes (rev),
    token TEXT NOT NULL,
    PRIMARY KEY (rev, token)
) STRICT, WITHOUT ROWID;

CREATE TABLE nodes (
    origin TEXT NOT NULL,
    id     TEXT NOT NULL,
    kind   TEXT NOT NULL,
    label  TEXT NOT NULL,
    PRIMARY KEY (origin, id)
) STRICT, WITHOUT ROWID;
CREATE INDEX nodes_by_id ON nodes (id, origin);

CREATE TABLE edges (
    origin    TEXT NOT NULL,
    from_node TEXT NOT NULL,
    to_node   TEXT NOT NULL,
    kind      TEXT NOT NULL,
    weight    INTEGER NOT NULL,
    PRIMARY KEY (origin, from_node, to_node, kind)
) STRICT, WITHOUT ROWID;
CREATE INDEX edges_from ON edges (from_node, kind);
CREATE INDEX edges_to ON edges (to_node, kind);
CREATE INDEX edges_by_kind ON edges (kind, from_node, to_node);

CREATE TABLE graph_applied (
    id  INTEGER PRIMARY KEY CHECK (id = 1),
    rev INTEGER NOT NULL
) STRICT;
INSERT INTO graph_applied (id, rev) VALUES (1, 0);
";

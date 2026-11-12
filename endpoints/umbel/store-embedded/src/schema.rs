//! The SQLite schema, version 4: version 1's tables (specification section 3.2) and the record
//! lane's (records host specification, section 5.1).

/// `PRAGMA user_version` of the schema this build writes and serves. Version 2 adds the record
/// lane's tables ([`LANE_SCHEMA`]), version 3 the table of documents held to their files
/// ([`HELD_SCHEMA`]) and version 4 each declared kind's count of postings
/// ([`POSTINGS_SCHEMA`]); a store at an earlier version gains them when it is opened.
pub const SCHEMA_VERSION: u32 = 4;

/// Schema version 4 (records host specification, section 5.1, after step B4's review): how many
/// postings, rows of `record_terms`, each declared kind holds over all its text fields. A match
/// compares it with its bound before it reads anything else (section 8.2), so the count is kept
/// by the put and by the rebuild in their own transactions, never found by a scan at a match. A
/// table and not a column of `record_kinds`, as version 3's is: a store that migrates then has
/// the schema of a new one, statement for statement. A kind with no row holds none.
pub(crate) const POSTINGS_SCHEMA: &str = "
CREATE TABLE record_postings (
    ns       TEXT NOT NULL,
    kind     TEXT NOT NULL,
    postings INTEGER NOT NULL CHECK (postings >= 0), -- rows of record_terms of the kind
    PRIMARY KEY (ns, kind),
    FOREIGN KEY (ns, kind) REFERENCES record_kinds (ns, kind) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;
";

/// What a store at version 2 or 3 holds, counted once as it migrates to version 4: one row a
/// declared kind, with every posting its lane has.
pub(crate) const POSTINGS_BACKFILL: &str = "
INSERT INTO record_postings (ns, kind, postings)
SELECT k.ns, k.kind, (SELECT COUNT(*) FROM record_terms t WHERE t.ns = k.ns AND t.kind = k.kind)
FROM record_kinds k;
";

/// Schema version 3 (records host specification, section 5.1): which documents the host held to
/// their file on disk, and at which content. A row is written only by the host, when it read
/// `<root>/<path>` and found its hash to be the document's. It hangs from `documents`, so a
/// deleted document loses it, and it names a content hash, so it says nothing of a document
/// whose content changed. A table and not a column: a store that migrates then has the schema
/// of a new one, statement for statement.
pub(crate) const HELD_SCHEMA: &str = "
CREATE TABLE doc_held (
    doc      TEXT PRIMARY KEY REFERENCES documents (doc) ON DELETE CASCADE,
    doc_hash TEXT NOT NULL                -- the content the host held to its file on disk
) STRICT, WITHOUT ROWID;
";

/// Version 1's tables. Tables are `STRICT`. Access is a join table per kind of row, so a reader filter is a semi-join
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

/// The record lane's tables, schema version 2 (records host specification, section 5.1), as that
/// section gives them. A new store runs these after [`SCHEMA`]; a store at version 1 runs them
/// alone, in its opening transaction. Every lane row hangs from `record_lane`, which hangs from
/// `records`, by `ON DELETE CASCADE`: deleting the `records` row removes all of it in one
/// statement (section 5.2). `record_vectors`, `record_evidence`, `record_decisions` and `doc_own`
/// are written from that specification's steps B3 and B5.
pub(crate) const LANE_SCHEMA: &str = "
CREATE TABLE record_kinds (
    ns        TEXT NOT NULL,
    kind      TEXT NOT NULL,
    decl_hash TEXT NOT NULL,              -- sha256: of the declaration's canonical JSON
    decl      TEXT NOT NULL,              -- that JSON, for store-records-reindex and the doctor
    stale     INTEGER NOT NULL DEFAULT 0, -- 1: written while undeclared, or a rebuild is under way (section 2, 12.1)
    generation INTEGER NOT NULL DEFAULT 0, -- raised by each undeclared put and each rebuild's start (12.1)
    PRIMARY KEY (ns, kind)
) STRICT, WITHOUT ROWID;

CREATE TABLE record_lane (
    lane         INTEGER PRIMARY KEY,     -- stable for the record's life
    ns           TEXT NOT NULL,
    kind         TEXT NOT NULL,
    id           TEXT NOT NULL,
    created_rev  INTEGER NOT NULL,        -- the revision of the first put
    created_at   TEXT NOT NULL,           -- its envelope's observedAt
    wording_hash TEXT,                    -- NULL for a kind with no text pointer
    match_digest BLOB,                    -- 32 bytes (8.1); NULL with no match value
    n0           INTEGER NOT NULL,        -- tokens of the value at text pointer 0; 0 when absent
    n1           INTEGER NOT NULL,
    n2           INTEGER NOT NULL,
    n3           INTEGER NOT NULL,
    flags        TEXT NOT NULL,           -- JSON array of scan findings
    affirmed_seq INTEGER,                 -- the record_decisions row that affirms it now, else NULL
    UNIQUE (ns, kind, id),
    FOREIGN KEY (ns, kind, id) REFERENCES records (ns, kind, id) ON DELETE CASCADE
) STRICT;
CREATE INDEX record_lane_by_recency ON record_lane (ns, kind, created_rev, id);
CREATE INDEX record_lane_by_digest ON record_lane (ns, kind, match_digest) WHERE match_digest IS NOT NULL;

CREATE TABLE record_terms (
    ns    TEXT NOT NULL,
    kind  TEXT NOT NULL,
    field INTEGER NOT NULL,               -- the text pointer's position in the declaration, 0 to 3
    term  TEXT NOT NULL,                  -- one token, as the tokenizer gives it
    lane  INTEGER NOT NULL REFERENCES record_lane (lane) ON DELETE CASCADE,
    tf    INTEGER NOT NULL,               -- how often the field holds the term
    PRIMARY KEY (ns, kind, field, term, lane)
) STRICT, WITHOUT ROWID;
CREATE INDEX record_terms_by_lane ON record_terms (lane, field);

CREATE TABLE record_keys (
    ns    TEXT NOT NULL,
    kind  TEXT NOT NULL,
    key   INTEGER NOT NULL,               -- the key pointer's position in the declaration, 0 to 15
    value TEXT NOT NULL,
    lane  INTEGER NOT NULL REFERENCES record_lane (lane) ON DELETE CASCADE,
    PRIMARY KEY (ns, kind, key, value, lane)
) STRICT, WITHOUT ROWID;
CREATE INDEX record_keys_by_lane ON record_keys (lane, key);

CREATE TABLE record_vectors (
    lane   INTEGER NOT NULL REFERENCES record_lane (lane) ON DELETE CASCADE,
    model  TEXT NOT NULL,                 -- the model id (9.2)
    vector BLOB NOT NULL,                 -- dimensions x f32, little-endian, of length 1
    PRIMARY KEY (lane, model)
) STRICT, WITHOUT ROWID;

CREATE TABLE record_evidence (
    lane     INTEGER PRIMARY KEY REFERENCES record_lane (lane) ON DELETE CASCADE,
    doc      TEXT NOT NULL,
    doc_hash TEXT NOT NULL,
    units    TEXT NOT NULL,               -- JSON array of unit numbers
    rule     TEXT NOT NULL,
    speaker  TEXT,
    verbatim INTEGER NOT NULL             -- 1: the plugin found the wording to be exactly those units
) STRICT;
CREATE INDEX record_evidence_by_doc ON record_evidence (doc, doc_hash);

CREATE TABLE record_decisions (
    seq          INTEGER PRIMARY KEY,     -- the revision the decision took
    ns           TEXT NOT NULL,
    kind         TEXT NOT NULL,
    id           TEXT NOT NULL,
    decision     TEXT NOT NULL CHECK (decision IN ('affirm', 'withdraw')),
    wording_hash TEXT NOT NULL,           -- the wording decided on
    by           TEXT NOT NULL,           -- the person's effective principal
    at           TEXT NOT NULL,
    assurance    TEXT NOT NULL,           -- JSON, umbel_store::Assurance
    trace_id     TEXT
) STRICT;
CREATE INDEX record_decisions_by_record ON record_decisions (ns, kind, id, seq);

CREATE TABLE doc_own (
    doc       TEXT PRIMARY KEY REFERENCES documents (doc) ON DELETE CASCADE,
    doc_hash  TEXT NOT NULL,              -- the content the person marked
    speaker   TEXT,
    rev       INTEGER NOT NULL,           -- the revision the mark took
    by        TEXT NOT NULL,
    at        TEXT NOT NULL,
    assurance TEXT NOT NULL,
    trace_id  TEXT
) STRICT, WITHOUT ROWID;
";

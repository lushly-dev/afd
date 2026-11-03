//! The memory database's schema, version 1 (phase 3 section 5.3).

/// `PRAGMA user_version` of the memory schema this build writes and serves.
pub const MEMORY_SCHEMA_VERSION: u32 = 1;

/// The tables of section 5.3 that a `store-backup` copy keeps: every one but `record_derived`
/// ([`DERIVED_SCHEMA`]) and `records_fts` ([`CREATE_FTS`]). Tables are `STRICT`. `sealed`
/// columns hold what [`super::seal`] returns, XChaCha20-Poly1305 under the record's own key.
/// Access is a join table, so a reader filter is a semi-join inside the same statement as the
/// selection, ordering and limit. `changes` and `change_access` keep ids, times, owner, agent and
/// byte counts, never text. `tombstones` hold no owner, class, project, session or text.
pub(crate) const MEMORY_SCHEMA: &str = "
CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE records (
    rowid        INTEGER PRIMARY KEY,
    id           TEXT NOT NULL UNIQUE,
    class        TEXT NOT NULL,
    owner        TEXT NOT NULL,
    project      TEXT,
    agent_id     TEXT,
    agent        TEXT,
    session      TEXT,
    capture_key  TEXT,
    flags        TEXT NOT NULL,
    flagged      INTEGER NOT NULL,
    expires      INTEGER NOT NULL,
    created_rev  INTEGER NOT NULL,
    stored_bytes INTEGER NOT NULL,
    indexed      INTEGER NOT NULL,
    sensitivity  TEXT NOT NULL,
    access       TEXT NOT NULL,
    supersedes   TEXT NOT NULL,
    sealed       BLOB NOT NULL
) STRICT;
CREATE INDEX records_by_owner ON records (owner, class);
CREATE INDEX records_by_expiry ON records (expires);

CREATE TABLE versions (
    id             TEXT NOT NULL,
    record_version INTEGER NOT NULL,
    valid_from     INTEGER NOT NULL,
    valid_until    INTEGER,
    recorded_at    INTEGER NOT NULL,
    recorded_until INTEGER,
    authority      TEXT NOT NULL,
    inv_at         INTEGER,
    inv_by         TEXT,
    inv_reason     TEXT,
    superseded_by  TEXT,
    envelope       TEXT NOT NULL,
    sealed         BLOB,
    PRIMARY KEY (id, record_version)
) STRICT, WITHOUT ROWID;
CREATE INDEX versions_current ON versions (id) WHERE recorded_until IS NULL;

CREATE TABLE record_access (
    id    TEXT NOT NULL,
    token TEXT NOT NULL,
    PRIMARY KEY (id, token)
) STRICT, WITHOUT ROWID;
CREATE INDEX record_access_by_token ON record_access (token, id);

CREATE TABLE observations (
    id      TEXT NOT NULL,
    session TEXT,
    at      INTEGER NOT NULL
) STRICT;
CREATE INDEX observations_by_id ON observations (id);

CREATE TABLE changes (
    rev            INTEGER PRIMARY KEY,
    kind           TEXT NOT NULL,
    id             TEXT NOT NULL,
    record_version INTEGER NOT NULL,
    trace_id       TEXT,
    at             INTEGER NOT NULL,
    owner          TEXT NOT NULL,
    agent          TEXT,
    bytes          INTEGER NOT NULL
) STRICT;
CREATE INDEX changes_by_id ON changes (id);
CREATE INDEX changes_by_owner ON changes (owner, at);
CREATE INDEX changes_by_trace ON changes (trace_id, rev) WHERE trace_id IS NOT NULL;

CREATE TABLE change_access (
    rev   INTEGER NOT NULL,
    token TEXT NOT NULL,
    PRIMARY KEY (rev, token)
) STRICT, WITHOUT ROWID;

CREATE TABLE tombstones (
    id        TEXT PRIMARY KEY,
    erased_at INTEGER NOT NULL,
    trace_id  TEXT,
    kind      TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE capture_erasures (
    owner      TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    erased_at  INTEGER NOT NULL,
    trace_id   TEXT,
    PRIMARY KEY (owner, key_prefix)
) STRICT, WITHOUT ROWID;

CREATE TABLE idempotency (
    owner     TEXT NOT NULL,
    authority TEXT NOT NULL,
    key       TEXT NOT NULL,
    rev       INTEGER NOT NULL,
    at        INTEGER NOT NULL,
    receipt   TEXT NOT NULL,
    PRIMARY KEY (owner, authority, key)
) STRICT, WITHOUT ROWID;
";

/// `record_derived`: what the observation key and the tag filter need in clear, the content hash
/// and the tags. Derived from the sealed body, so left out of backups and rebuilt (section 5.4);
/// `IF NOT EXISTS`, since the rebuild of a restored copy creates it.
pub(crate) const DERIVED_SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS record_derived (
    id           TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,
    tags         TEXT NOT NULL
) STRICT, WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS record_derived_by_hash ON record_derived (content_hash);
";

/// [`MEMORY_SCHEMA`]'s statements with every table and index created in the attached schema
/// `schema`, for `backup`'s copy.
pub(crate) fn qualified(schema: &str) -> String {
    MEMORY_SCHEMA
        .split(';')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|statement| {
            let statement = if let Some(rest) = statement.strip_prefix("CREATE TABLE ") {
                format!("CREATE TABLE {schema}.{rest}")
            } else if let Some(rest) = statement.strip_prefix("CREATE INDEX ") {
                format!("CREATE INDEX {schema}.{rest}")
            } else {
                statement.to_owned()
            };
            format!("{statement};\n")
        })
        .collect()
}

/// The tables a `store-backup` copy holds, in [`MEMORY_SCHEMA`]'s order, and whether each has
/// an implicit rowid to carry over.
pub(crate) const BACKUP_TABLES: &[(&str, bool)] = &[
    ("meta", false),
    ("records", false),
    ("versions", false),
    ("record_access", false),
    ("observations", true),
    ("changes", false),
    ("change_access", false),
    ("tombstones", false),
    ("capture_erasures", false),
    ("idempotency", false),
];

/// The lexical lane: an ordinary FTS5 table holding its own plaintext copy, `rowid` equal to
/// `records.rowid` (section 5.3). Not `content=` and not contentless: see 5.3 and the
/// experiments in `tests/memory_sqlite.rs`.
pub(crate) const CREATE_FTS: &str = "CREATE VIRTUAL TABLE records_fts USING fts5(
    subject, tags, text,
    tokenize = 'porter unicode61 remove_diacritics 2'
)";

/// FTS5's `secure-delete` is a configuration row, not a create option, and is lost with the
/// table: every path that creates `records_fts` runs this after [`CREATE_FTS`].
pub(crate) const FTS_SECURE_DELETE: &str =
    "INSERT INTO records_fts (records_fts, rank) VALUES ('secure-delete', 1)";

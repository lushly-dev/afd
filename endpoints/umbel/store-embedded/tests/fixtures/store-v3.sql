-- A store at embedded schema version 3, with a declared kind's lane in it and one document held to
-- its file, for `lane_schema.rs`.
--
-- `store-v2.sql` brought to version 3 as the code before schema version 4 did it, statement for
-- statement, in the `sqlite3` shell: the version 3 migration's one table (`doc_held`, the
-- `HELD_SCHEMA` of `store-embedded/src/schema.rs` at that version), the row `hold_document` writes
-- for `journal/roses` at its stored content, and `PRAGMA user_version=3`; then `.dump`. Nothing
-- here is edited by hand but this header and the last line, which a dump leaves out. Every text
-- is invented and about gardening.
--
-- It holds what `store-v2.sql` holds: two documents, two records of the standing kind
-- `notes/note` with their lane rows (nine postings), and one of `notes/sync`.
PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
) STRICT, WITHOUT ROWID;
INSERT INTO meta VALUES('lane_normalisation','1');
INSERT INTO meta VALUES('space','main');
INSERT INTO meta VALUES('store_traits_version','3');
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
INSERT INTO documents VALUES('journal/roses',1,'journal','roses.md','note','Title of journal/roses','stable','sha256:cc35b8af266138ce0cfb4eac5929279605d20e6c99f6b1dde783e63f78d70610',28,'internal','[]','{"access":["space"],"aliases":[],"collection":"journal","contentHash":"sha256:cc35b8af266138ce0cfb4eac5929279605d20e6c99f6b1dde783e63f78d70610","description":null,"envelope":{"access":["space"],"agent":null,"authority":null,"confidence":null,"contentHash":null,"derivedFrom":null,"generated":null,"observedAt":"2026-11-02T10:00:00.000Z","origin":"document-derived","plugin":"suite","principal":"human:local","sensitivity":"internal","session":null,"sources":null,"space":"main","traceId":"sync","validFrom":null,"validUntil":null,"version":1},"flags":[],"frontmatter":{},"id":"journal/roses","lines":1,"owners":[],"path":"roses.md","sensitivity":"internal","size":28,"space":"main","staleAfter":null,"status":"stable","supersededBy":null,"tags":[],"title":"Title of journal/roses","type":"note","verification":{"count":0,"last":null,"tier":"unverified"},"version":1}',x'5072756e6520726f73657320696e206c6174652077696e7465722e0a');
INSERT INTO documents VALUES('talks/pruning',2,'talks','pruning.md','note','Title of talks/pruning','stable','sha256:59aeda7314d81e0d2a210bf9903ed07e5333733374390b8c992a0a0cc7fc08a6',24,'internal','[]','{"access":["group:growers"],"aliases":[],"collection":"talks","contentHash":"sha256:59aeda7314d81e0d2a210bf9903ed07e5333733374390b8c992a0a0cc7fc08a6","description":null,"envelope":{"access":["group:growers"],"agent":null,"authority":null,"confidence":null,"contentHash":null,"derivedFrom":null,"generated":null,"observedAt":"2026-11-02T10:00:00.000Z","origin":"document-derived","plugin":"suite","principal":"human:local","sensitivity":"internal","session":null,"sources":null,"space":"main","traceId":"sync","validFrom":null,"validUntil":null,"version":1},"flags":[],"frontmatter":{},"id":"talks/pruning","lines":1,"owners":[],"path":"pruning.md","sensitivity":"internal","size":24,"space":"main","staleAfter":null,"status":"stable","supersededBy":null,"tags":[],"title":"Title of talks/pruning","type":"note","verification":{"count":0,"last":null,"tier":"unverified"},"version":1}',x'526f7365732077616e74206d6f726e696e672073756e2e0a');
CREATE TABLE doc_access (
    doc   TEXT NOT NULL REFERENCES documents (doc) ON DELETE CASCADE,
    token TEXT NOT NULL,
    PRIMARY KEY (doc, token)
) STRICT, WITHOUT ROWID;
INSERT INTO doc_access VALUES('talks/pruning','group:growers');
INSERT INTO doc_access VALUES('journal/roses','space');
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
INSERT INTO records VALUES('notes','note','n1',3,'sha256:bdfc04fe6587ccd9e37deb9c43d16801ef06da016718e509bb5215b331577988','{"bed":"north","statement":"Prune roses in late winter."}','{"version":1,"origin":"document-derived","space":"main","plugin":"suite","agent":null,"principal":"human:local","session":null,"traceId":"capture","observedAt":"2026-11-02T10:00:00.000Z","validFrom":null,"validUntil":null,"confidence":null,"authority":null,"sources":null,"generated":null,"contentHash":null,"derivedFrom":null,"access":["space"],"sensitivity":"internal"}');
INSERT INTO records VALUES('notes','note','n2',4,'sha256:e61a0a91a224fd434f0c53ed0567cc3d8b2fb937f9ad49339f7d0807369f4aa8','{"bed":"north","statement":"Roses want morning sun."}','{"version":1,"origin":"document-derived","space":"main","plugin":"suite","agent":null,"principal":"human:local","session":null,"traceId":"capture","observedAt":"2026-11-02T10:00:00.000Z","validFrom":null,"validUntil":null,"confidence":null,"authority":null,"sources":null,"generated":null,"contentHash":null,"derivedFrom":null,"access":["group:growers"],"sensitivity":"internal"}');
INSERT INTO records VALUES('notes','sync','journal',5,'sha256:2b7f65c1ddb395428632a639972debf44841839c27c6cdc87b39dbfab20d92c2','{"files":2}','{"version":1,"origin":"document-derived","space":"main","plugin":"suite","agent":null,"principal":"human:local","session":null,"traceId":"sync","observedAt":"2026-11-02T10:00:00.000Z","validFrom":null,"validUntil":null,"confidence":null,"authority":null,"sources":null,"generated":null,"contentHash":null,"derivedFrom":null,"access":["space"],"sensitivity":"internal"}');
CREATE TABLE record_access (
    ns    TEXT NOT NULL,
    kind  TEXT NOT NULL,
    id    TEXT NOT NULL,
    token TEXT NOT NULL,
    PRIMARY KEY (ns, kind, id, token),
    FOREIGN KEY (ns, kind, id) REFERENCES records (ns, kind, id) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;
INSERT INTO record_access VALUES('notes','note','n2','group:growers');
INSERT INTO record_access VALUES('notes','note','n1','space');
INSERT INTO record_access VALUES('notes','sync','journal','space');
CREATE TABLE changes (
    rev          INTEGER PRIMARY KEY,
    kind         TEXT NOT NULL,
    target       TEXT NOT NULL,
    content_hash TEXT,
    trace_id     TEXT,
    at           TEXT NOT NULL
) STRICT;
INSERT INTO changes VALUES(1,'put','journal/roses','sha256:cc35b8af266138ce0cfb4eac5929279605d20e6c99f6b1dde783e63f78d70610','sync','2026-11-02T10:00:00.000Z');
INSERT INTO changes VALUES(2,'put','talks/pruning','sha256:59aeda7314d81e0d2a210bf9903ed07e5333733374390b8c992a0a0cc7fc08a6','sync','2026-11-02T10:00:00.000Z');
INSERT INTO changes VALUES(3,'record','notes/note/n1','sha256:bdfc04fe6587ccd9e37deb9c43d16801ef06da016718e509bb5215b331577988','capture','2026-11-02T10:00:00.000Z');
INSERT INTO changes VALUES(4,'record','notes/note/n2','sha256:e61a0a91a224fd434f0c53ed0567cc3d8b2fb937f9ad49339f7d0807369f4aa8','capture','2026-11-02T10:00:00.000Z');
INSERT INTO changes VALUES(5,'record','notes/sync/journal','sha256:2b7f65c1ddb395428632a639972debf44841839c27c6cdc87b39dbfab20d92c2','sync','2026-11-02T10:00:00.000Z');
CREATE TABLE change_access (
    rev   INTEGER NOT NULL REFERENCES changes (rev),
    token TEXT NOT NULL,
    PRIMARY KEY (rev, token)
) STRICT, WITHOUT ROWID;
INSERT INTO change_access VALUES(1,'space');
INSERT INTO change_access VALUES(2,'group:growers');
INSERT INTO change_access VALUES(3,'space');
INSERT INTO change_access VALUES(4,'group:growers');
INSERT INTO change_access VALUES(5,'space');
CREATE TABLE nodes (
    origin TEXT NOT NULL,
    id     TEXT NOT NULL,
    kind   TEXT NOT NULL,
    label  TEXT NOT NULL,
    PRIMARY KEY (origin, id)
) STRICT, WITHOUT ROWID;
CREATE TABLE edges (
    origin    TEXT NOT NULL,
    from_node TEXT NOT NULL,
    to_node   TEXT NOT NULL,
    kind      TEXT NOT NULL,
    weight    INTEGER NOT NULL,
    PRIMARY KEY (origin, from_node, to_node, kind)
) STRICT, WITHOUT ROWID;
CREATE TABLE graph_applied (
    id  INTEGER PRIMARY KEY CHECK (id = 1),
    rev INTEGER NOT NULL
) STRICT;
INSERT INTO graph_applied VALUES(1,0);
CREATE TABLE record_kinds (
    ns        TEXT NOT NULL,
    kind      TEXT NOT NULL,
    decl_hash TEXT NOT NULL,              -- sha256: of the declaration's canonical JSON
    decl      TEXT NOT NULL,              -- that JSON, for store-records-reindex and the doctor
    stale     INTEGER NOT NULL DEFAULT 0, -- 1: written while undeclared, or a rebuild is under way (section 2, 12.1)
    generation INTEGER NOT NULL DEFAULT 0, -- raised by each undeclared put and each rebuild's start (12.1)
    PRIMARY KEY (ns, kind)
) STRICT, WITHOUT ROWID;
INSERT INTO record_kinds VALUES('notes','note','sha256:470af4965056449da225757bbf92f08a84a38ecd4f3922b65ac395690d94a0bf','{"keys":["/bed"],"kind":"note","match":"/statement","standing":true,"text":["/statement"]}',0,0);
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
INSERT INTO record_lane VALUES(1,'notes','note','n1',3,'2026-11-02T10:00:00.000Z','sha256:9d243afbd23ca8bf08abe5f221fef89c964d871dba5f4d43befe3813d6927ddc',x'6a0cc5ff6a484b006b5137a9378874dfe54247e4b70e608aeb33b27b655e54d9',5,0,0,0,'[]',NULL);
INSERT INTO record_lane VALUES(2,'notes','note','n2',4,'2026-11-02T10:00:00.000Z','sha256:8839c42c4fd5ee1ef31b018a0434926334a3f0923f27946cc42d647492a60b61',x'07b95816ae7f0e26fb83754a42dab9472884e820c2c72c30979eda7a19ef1ead',4,0,0,0,'[]',NULL);
CREATE TABLE record_terms (
    ns    TEXT NOT NULL,
    kind  TEXT NOT NULL,
    field INTEGER NOT NULL,               -- the text pointer's position in the declaration, 0 to 3
    term  TEXT NOT NULL,                  -- one token, as the tokenizer gives it
    lane  INTEGER NOT NULL REFERENCES record_lane (lane) ON DELETE CASCADE,
    tf    INTEGER NOT NULL,               -- how often the field holds the term
    PRIMARY KEY (ns, kind, field, term, lane)
) STRICT, WITHOUT ROWID;
INSERT INTO record_terms VALUES('notes','note',0,'in',1,1);
INSERT INTO record_terms VALUES('notes','note',0,'late',1,1);
INSERT INTO record_terms VALUES('notes','note',0,'morn',2,1);
INSERT INTO record_terms VALUES('notes','note',0,'prune',1,1);
INSERT INTO record_terms VALUES('notes','note',0,'rose',1,1);
INSERT INTO record_terms VALUES('notes','note',0,'rose',2,1);
INSERT INTO record_terms VALUES('notes','note',0,'sun',2,1);
INSERT INTO record_terms VALUES('notes','note',0,'want',2,1);
INSERT INTO record_terms VALUES('notes','note',0,'winter',1,1);
CREATE TABLE record_keys (
    ns    TEXT NOT NULL,
    kind  TEXT NOT NULL,
    key   INTEGER NOT NULL,               -- the key pointer's position in the declaration, 0 to 15
    value TEXT NOT NULL,
    lane  INTEGER NOT NULL REFERENCES record_lane (lane) ON DELETE CASCADE,
    PRIMARY KEY (ns, kind, key, value, lane)
) STRICT, WITHOUT ROWID;
INSERT INTO record_keys VALUES('notes','note',0,'north',1);
INSERT INTO record_keys VALUES('notes','note',0,'north',2);
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
CREATE TABLE doc_held (
    doc      TEXT PRIMARY KEY REFERENCES documents (doc) ON DELETE CASCADE,
    doc_hash TEXT NOT NULL                -- the content the host held to its file on disk
) STRICT, WITHOUT ROWID;
INSERT INTO doc_held VALUES('journal/roses','sha256:cc35b8af266138ce0cfb4eac5929279605d20e6c99f6b1dde783e63f78d70610');
CREATE INDEX documents_by_collection ON documents (collection, doc);
CREATE INDEX documents_by_type ON documents (doc_type, doc);
CREATE INDEX doc_access_by_token ON doc_access (token, doc);
CREATE INDEX record_access_by_token ON record_access (token, ns, kind, id);
CREATE INDEX changes_by_trace ON changes (trace_id, rev) WHERE trace_id IS NOT NULL;
CREATE INDEX nodes_by_id ON nodes (id, origin);
CREATE INDEX edges_from ON edges (from_node, kind);
CREATE INDEX edges_to ON edges (to_node, kind);
CREATE INDEX edges_by_kind ON edges (kind, from_node, to_node);
CREATE INDEX record_lane_by_recency ON record_lane (ns, kind, created_rev, id);
CREATE INDEX record_lane_by_digest ON record_lane (ns, kind, match_digest) WHERE match_digest IS NOT NULL;
CREATE INDEX record_terms_by_lane ON record_terms (lane, field);
CREATE INDEX record_keys_by_lane ON record_keys (lane, key);
CREATE INDEX record_evidence_by_doc ON record_evidence (doc, doc_hash);
CREATE INDEX record_decisions_by_record ON record_decisions (ns, kind, id, seq);
COMMIT;
PRAGMA user_version=3;

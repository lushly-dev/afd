-- A store at embedded schema version 1, with records in it, for `lane_schema.rs`.
--
-- Written by the code before the record lane (commit dd72d6b6, step B1 of the records host
-- specification): `SqliteStore::open`, one `put_document` and five `put_record` calls, a
-- checkpoint, then `sqlite3 store.sqlite3 .dump`. Nothing here is edited by hand but this
-- header and the last line, which a dump leaves out. Every text is invented and about gardening.
--
-- It holds one document, three records of `notes/note` (one readable by the space, one by a
-- principal, one by a group, and the first written twice) and one of `notes/sync`.
PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
) STRICT, WITHOUT ROWID;
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
INSERT INTO documents VALUES('journal/roses',1,'journal','roses.md','note','Title of journal/roses','stable','sha256:c9b90818dd704e0166f9c6ecaef4574510f5683d5e9d95e9475898e92be46999',27,'internal','[]','{"access":["space"],"aliases":[],"collection":"journal","contentHash":"sha256:c9b90818dd704e0166f9c6ecaef4574510f5683d5e9d95e9475898e92be46999","description":null,"envelope":{"access":["space"],"agent":null,"authority":null,"confidence":null,"contentHash":null,"derivedFrom":null,"generated":null,"observedAt":"2026-11-02T10:00:00.000Z","origin":"document-derived","plugin":"suite","principal":"human:local","sensitivity":"internal","session":null,"sources":null,"space":"main","traceId":"t1","validFrom":null,"validUntil":null,"version":1},"flags":[],"frontmatter":{},"id":"journal/roses","lines":1,"owners":[],"path":"roses.md","sensitivity":"internal","size":27,"space":"main","staleAfter":null,"status":"stable","supersededBy":null,"tags":[],"title":"Title of journal/roses","type":"note","verification":{"count":0,"last":null,"tier":"unverified"},"version":1}',x'5072756e6520726f73657320696e206c6174652077696e7465722e');
CREATE TABLE doc_access (
    doc   TEXT NOT NULL REFERENCES documents (doc) ON DELETE CASCADE,
    token TEXT NOT NULL,
    PRIMARY KEY (doc, token)
) STRICT, WITHOUT ROWID;
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
INSERT INTO records VALUES('notes','note','n1',6,'sha256:f3d534217d1f11cbd247ec345ce51e46628445d14e329c7c3e919916203ac471','{"bed":"east","statement":"Prune roses in late winter, before the buds swell.","tags":["roses","pruning"]}','{"version":1,"origin":"document-derived","space":"main","plugin":"suite","agent":null,"principal":"human:local","session":null,"traceId":"t4","observedAt":"2026-11-03T08:30:00.000Z","validFrom":null,"validUntil":null,"confidence":null,"authority":null,"sources":null,"generated":null,"contentHash":null,"derivedFrom":null,"access":["space"],"sensitivity":"internal"}');
INSERT INTO records VALUES('notes','note','n2',3,'sha256:f4a0f450aeabb7b2428f0914ade0fc6c174ae94a1285850588ce7e774f7e1b02','{"bed":"south","statement":"Mulch keeps the soil cool and holds water through summer.","tags":["soil","watering"]}','{"version":1,"origin":"document-derived","space":"main","plugin":"suite","agent":null,"principal":"human:local","session":null,"traceId":"t2","observedAt":"2026-11-02T10:00:00.000Z","validFrom":null,"validUntil":null,"confidence":null,"authority":null,"sources":null,"generated":null,"contentHash":null,"derivedFrom":null,"access":["principal:human:local"],"sensitivity":"internal"}');
INSERT INTO records VALUES('notes','note','n3',4,'sha256:82d881e7f03c1961f19c303a61ac6c555023b6e370a5f242abb08700e0d3c2a1','{"bed":"south","statement":"Water tomatoes at the base, never on the leaves.","tags":["tomatoes","watering"]}','{"version":1,"origin":"document-derived","space":"main","plugin":"suite","agent":null,"principal":"human:local","session":null,"traceId":"t2","observedAt":"2026-11-02T10:00:00.000Z","validFrom":null,"validUntil":null,"confidence":null,"authority":null,"sources":null,"generated":null,"contentHash":null,"derivedFrom":null,"access":["group:growers"],"sensitivity":"internal"}');
INSERT INTO records VALUES('notes','sync','state',5,'sha256:f743721c5679bdef371b58eaa6b2a0df9d869c2653301090ea92a75025881f8b','{"cursor":7}','{"version":1,"origin":"document-derived","space":"main","plugin":"suite","agent":null,"principal":"human:local","session":null,"traceId":"t3","observedAt":"2026-11-02T10:00:00.000Z","validFrom":null,"validUntil":null,"confidence":null,"authority":null,"sources":null,"generated":null,"contentHash":null,"derivedFrom":null,"access":["space"],"sensitivity":"internal"}');
CREATE TABLE record_access (
    ns    TEXT NOT NULL,
    kind  TEXT NOT NULL,
    id    TEXT NOT NULL,
    token TEXT NOT NULL,
    PRIMARY KEY (ns, kind, id, token),
    FOREIGN KEY (ns, kind, id) REFERENCES records (ns, kind, id) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;
INSERT INTO record_access VALUES('notes','note','n3','group:growers');
INSERT INTO record_access VALUES('notes','note','n2','principal:human:local');
INSERT INTO record_access VALUES('notes','note','n1','space');
INSERT INTO record_access VALUES('notes','sync','state','space');
CREATE TABLE changes (
    rev          INTEGER PRIMARY KEY,
    kind         TEXT NOT NULL,
    target       TEXT NOT NULL,
    content_hash TEXT,
    trace_id     TEXT,
    at           TEXT NOT NULL
) STRICT;
INSERT INTO changes VALUES(1,'put','journal/roses','sha256:c9b90818dd704e0166f9c6ecaef4574510f5683d5e9d95e9475898e92be46999','t1','2026-11-02T10:00:00.000Z');
INSERT INTO changes VALUES(2,'record','notes/note/n1','sha256:1b154be0dabc47d179bafa4228cc2b9b683677e8cdb55b158af1eac1efe1fdf5','t2','2026-11-02T10:00:00.000Z');
INSERT INTO changes VALUES(3,'record','notes/note/n2','sha256:f4a0f450aeabb7b2428f0914ade0fc6c174ae94a1285850588ce7e774f7e1b02','t2','2026-11-02T10:00:00.000Z');
INSERT INTO changes VALUES(4,'record','notes/note/n3','sha256:82d881e7f03c1961f19c303a61ac6c555023b6e370a5f242abb08700e0d3c2a1','t2','2026-11-02T10:00:00.000Z');
INSERT INTO changes VALUES(5,'record','notes/sync/state','sha256:f743721c5679bdef371b58eaa6b2a0df9d869c2653301090ea92a75025881f8b','t3','2026-11-02T10:00:00.000Z');
INSERT INTO changes VALUES(6,'record','notes/note/n1','sha256:f3d534217d1f11cbd247ec345ce51e46628445d14e329c7c3e919916203ac471','t4','2026-11-03T08:30:00.000Z');
CREATE TABLE change_access (
    rev   INTEGER NOT NULL REFERENCES changes (rev),
    token TEXT NOT NULL,
    PRIMARY KEY (rev, token)
) STRICT, WITHOUT ROWID;
INSERT INTO change_access VALUES(1,'space');
INSERT INTO change_access VALUES(2,'space');
INSERT INTO change_access VALUES(3,'principal:human:local');
INSERT INTO change_access VALUES(4,'group:growers');
INSERT INTO change_access VALUES(5,'space');
INSERT INTO change_access VALUES(6,'space');
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
CREATE INDEX documents_by_collection ON documents (collection, doc);
CREATE INDEX documents_by_type ON documents (doc_type, doc);
CREATE INDEX doc_access_by_token ON doc_access (token, doc);
CREATE INDEX record_access_by_token ON record_access (token, ns, kind, id);
CREATE INDEX changes_by_trace ON changes (trace_id, rev) WHERE trace_id IS NOT NULL;
CREATE INDEX nodes_by_id ON nodes (id, origin);
CREATE INDEX edges_from ON edges (from_node, kind);
CREATE INDEX edges_to ON edges (to_node, kind);
CREATE INDEX edges_by_kind ON edges (kind, from_node, to_node);
COMMIT;
PRAGMA user_version = 1;

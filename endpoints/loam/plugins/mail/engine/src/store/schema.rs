//! The store's schema and its migrations (the specification's section 4.3).
//!
//! A migration runs forward only, inside a transaction, when the store is
//! opened. The schema's version is SQLite's `user_version`: the number of
//! migrations applied.

use rusqlite::Connection;

use super::StoreError;

/// The migrations, oldest first. One is never edited once it has merged: a
/// change to the schema is a new entry.
pub(super) const MIGRATIONS: &[&str] = &[
    // 1: what is not derived from the log. An account and its mailboxes, a
    // message's identity and which of its bytes are held, and the record of
    // what the provider showed.
    "
    CREATE TABLE account (
        id INTEGER PRIMARY KEY,
        provider TEXT NOT NULL,
        address TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (provider, address)
    ) STRICT;

    CREATE TABLE mailbox (
        id INTEGER PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES account (id),
        -- The provider's own name for the mailbox: an IMAP mailbox name, a Gmail label id.
        provider_key TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL
            CHECK (role IN ('inbox', 'sent', 'trash', 'junk', 'archive', 'all', 'none')),
        -- Bodies are fetched only when someone opens a message (section 5.3).
        header_only INTEGER NOT NULL CHECK (header_only IN (0, 1)),
        -- The generation the provider's ids belong to: IMAP's UIDVALIDITY, or '' without one.
        validity TEXT NOT NULL DEFAULT '',
        -- Where sync resumes. Opaque to the store.
        cursor TEXT,
        last_pass_at INTEGER,
        -- The engine's own words; never text from a message.
        last_error TEXT,
        UNIQUE (account_id, provider_key)
    ) STRICT;

    -- A message is the hash of its header block and the size the provider reports (4.2).
    CREATE TABLE message (
        id INTEGER PRIMARY KEY,
        header_hash BLOB NOT NULL CHECK (length(header_hash) = 32),
        reported_size INTEGER NOT NULL CHECK (reported_size >= 0),
        first_seen_at INTEGER NOT NULL,
        UNIQUE (header_hash, reported_size)
    ) STRICT;

    -- Which of a message's bytes the log holds.
    CREATE TABLE held (
        message_id INTEGER NOT NULL REFERENCES message (id),
        -- 'header', 'whole', or a part's place in the message ('1.2').
        part TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('header', 'whole', 'text', 'attachment')),
        blob BLOB NOT NULL CHECK (length(blob) = 32),
        size INTEGER NOT NULL CHECK (size >= 0),
        PRIMARY KEY (message_id, part)
    ) STRICT, WITHOUT ROWID;

    -- A message seen in a mailbox. A row is never deleted: when the provider shows something
    -- else, the row is ended and a new one is written.
    CREATE TABLE observation (
        id INTEGER PRIMARY KEY,
        message_id INTEGER NOT NULL REFERENCES message (id),
        mailbox_id INTEGER NOT NULL REFERENCES mailbox (id),
        validity TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        provider_thread TEXT,
        -- A JSON array of the flags or labels seen, sorted.
        flags TEXT NOT NULL,
        internal_date INTEGER,
        seen_at INTEGER NOT NULL,
        ended_at INTEGER,
        ended_by TEXT CHECK (ended_by IN ('superseded', 'removed', 'closed')),
        CHECK ((ended_at IS NULL) = (ended_by IS NULL))
    ) STRICT;
    CREATE UNIQUE INDEX observation_current
        ON observation (mailbox_id, validity, provider_id) WHERE ended_at IS NULL;
    CREATE INDEX observation_message ON observation (message_id);

    -- A listed message that did not arrive (section 5.4).
    CREATE TABLE unreturned (
        mailbox_id INTEGER NOT NULL REFERENCES mailbox (id),
        validity TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        tries INTEGER NOT NULL CHECK (tries > 0),
        first_tried_at INTEGER NOT NULL,
        last_tried_at INTEGER NOT NULL,
        PRIMARY KEY (mailbox_id, validity, provider_id)
    ) STRICT, WITHOUT ROWID;

    -- One row per change to anything a view shows, in order.
    CREATE TABLE change (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        kind TEXT NOT NULL,
        subject INTEGER NOT NULL
    ) STRICT;
    ",
    // 2: what is derived from the log, and can be rebuilt from it (4.3): what a message's
    // headers and body say, its parts, its thread, and where each thread shows. Beside them,
    // what the derivation itself has to remember: which messages the search index still lacks,
    // and how far a rebuild has come.
    "
    -- When the provider received the message, as first reported. Not derived: it is what the
    -- provider showed, and a message's date falls back to it.
    ALTER TABLE message ADD COLUMN received_at INTEGER;

    CREATE TABLE envelope (
        message_id INTEGER PRIMARY KEY REFERENCES message (id),
        -- The version of the derivation that wrote the row (4.3).
        parser INTEGER NOT NULL,
        thread_id INTEGER NOT NULL,
        -- The date the message is listed under, in milliseconds: its Date header when that is
        -- not in the future, else when the provider received it, else when it was first seen.
        date INTEGER NOT NULL,
        sent_at INTEGER,
        sender_address TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        subject TEXT NOT NULL,
        -- From the body, once it is held whole; '' and 0 until then.
        snippet TEXT NOT NULL DEFAULT '',
        attachments INTEGER NOT NULL DEFAULT 0,
        -- Why the headers, or the body, could not be read; the engine's own words.
        unparsed TEXT
    ) STRICT;
    CREATE INDEX envelope_thread ON envelope (thread_id, date, message_id);

    CREATE TABLE part (
        message_id INTEGER NOT NULL REFERENCES message (id),
        -- The part's place in the message, as IMAP numbers it ('1.2').
        place TEXT NOT NULL,
        content_type TEXT NOT NULL,
        name TEXT NOT NULL,
        size INTEGER NOT NULL CHECK (size >= 0),
        attachment INTEGER NOT NULL CHECK (attachment IN (0, 1)),
        PRIMARY KEY (message_id, place)
    ) STRICT, WITHOUT ROWID;

    -- A Message-ID a message has, or names in References or In-Reply-To, and the thread it
    -- belongs to (5.6). The key is the first 16 bytes of the id's SHA-256.
    CREATE TABLE thread_key (
        key BLOB PRIMARY KEY CHECK (length(key) = 16),
        thread_id INTEGER NOT NULL
    ) STRICT, WITHOUT ROWID;
    CREATE INDEX thread_key_thread ON thread_key (thread_id);

    -- A thread, with what a list shows. Its id is the lowest id of its messages.
    CREATE TABLE thread (
        id INTEGER PRIMARY KEY,
        last_date INTEGER NOT NULL,
        messages INTEGER NOT NULL,
        attachments INTEGER NOT NULL,
        last_message INTEGER NOT NULL,
        subject TEXT NOT NULL,
        snippet TEXT NOT NULL,
        last_sender TEXT NOT NULL
    ) STRICT;

    -- A thread in a mailbox: the messages of the thread the mailbox currently shows. This is
    -- what a list of a mailbox reads, newest first.
    CREATE TABLE thread_place (
        mailbox_id INTEGER NOT NULL REFERENCES mailbox (id),
        thread_id INTEGER NOT NULL,
        last_date INTEGER NOT NULL,
        messages INTEGER NOT NULL,
        PRIMARY KEY (mailbox_id, thread_id)
    ) STRICT, WITHOUT ROWID;
    CREATE INDEX thread_place_by_date ON thread_place (mailbox_id, last_date DESC, thread_id DESC);
    CREATE INDEX thread_place_thread ON thread_place (thread_id);

    -- Which mailboxes currently show a message.
    CREATE INDEX observation_shown ON observation (message_id, mailbox_id) WHERE ended_at IS NULL;

    -- A message whose document the search index does not yet hold on the disk. The index
    -- records the highest seq it has committed; rows up to it are removed.
    CREATE TABLE index_pending (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL
    ) STRICT;

    -- What the engine remembers about its own work: how far a rebuild has come, and the
    -- highest index_pending.seq the index has committed.
    CREATE TABLE engine_state (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL
    ) STRICT, WITHOUT ROWID;

    -- Messages recorded before these tables existed have no rows in them. A rebuild is due,
    -- and until `mail-rebuild` has run, new mail waits for it too.
    INSERT INTO engine_state (key, value) SELECT 'rebuild', 0 WHERE EXISTS (SELECT 1 FROM message);
    ",
    // 3: what sync needs (5.2 to 5.7). How many messages a mailbox's last listing named, and
    // whether the provider still lists the mailbox; the files a read found damaged, for sync to
    // fetch again; bodies the provider did not return; and how many of a thread's messages in a
    // mailbox are unread.
    "
    -- How many ids the mailbox's last listing named; NULL until it is first listed.
    ALTER TABLE mailbox ADD COLUMN listed INTEGER CHECK (listed >= 0);
    -- When the provider stopped listing the mailbox. Its observations are closed then.
    ALTER TABLE mailbox ADD COLUMN gone_at INTEGER;

    -- A file a read found damaged or missing: sync fetches its bytes again, and storing them
    -- repairs the file (4.1). The part is 'header' or 'whole'. After three fetches that return
    -- other bytes, it is left for a person to look at.
    CREATE TABLE refetch (
        message_id INTEGER NOT NULL REFERENCES message (id),
        part TEXT NOT NULL CHECK (part IN ('header', 'whole')),
        tries INTEGER NOT NULL DEFAULT 0 CHECK (tries >= 0),
        noted_at INTEGER NOT NULL,
        PRIMARY KEY (message_id, part)
    ) STRICT, WITHOUT ROWID;

    -- A message whose body the provider did not return when asked: tried again an hour later,
    -- given up after three tries until a week has passed (5.4, for bodies).
    CREATE TABLE body_missing (
        message_id INTEGER PRIMARY KEY REFERENCES message (id),
        tries INTEGER NOT NULL CHECK (tries > 0),
        last_tried_at INTEGER NOT NULL
    ) STRICT;

    -- Derived like the rest of the row: the messages the mailbox shows that no current
    -- observation in it marks \\Seen.
    ALTER TABLE thread_place ADD COLUMN unread INTEGER NOT NULL DEFAULT 0 CHECK (unread >= 0);
    UPDATE thread_place SET unread = (
        SELECT count(*) FROM envelope
        WHERE envelope.thread_id = thread_place.thread_id
          AND EXISTS (SELECT 1 FROM observation
                      WHERE observation.message_id = envelope.message_id
                        AND observation.mailbox_id = thread_place.mailbox_id
                        AND observation.ended_at IS NULL)
          AND NOT EXISTS (SELECT 1 FROM observation
                          WHERE observation.message_id = envelope.message_id
                            AND observation.mailbox_id = thread_place.mailbox_id
                            AND observation.ended_at IS NULL
                            AND instr(observation.flags, '\"\\\\Seen\"') > 0));
    ",
    // 4: the evidence of section 6.1, derived from the log like the rest of `envelope` and
    // `part`. Rows written by the derivation before it are stale (their `parser` is 1) and are
    // derived again (4.3).
    "
    -- What the headers say about where the message came from and how it may be answered.
    ALTER TABLE envelope ADD COLUMN list_id TEXT NOT NULL DEFAULT '';
    -- 0 no unsubscribe header, 1 List-Unsubscribe, 2 that and one-click.
    ALTER TABLE envelope ADD COLUMN unsubscribe INTEGER NOT NULL DEFAULT 0
        CHECK (unsubscribe IN (0, 1, 2));
    ALTER TABLE envelope ADD COLUMN precedence TEXT NOT NULL DEFAULT '';
    ALTER TABLE envelope ADD COLUMN auto_submitted TEXT NOT NULL DEFAULT '';
    ALTER TABLE envelope ADD COLUMN reply_to TEXT NOT NULL DEFAULT '';
    ALTER TABLE envelope ADD COLUMN reply_to_differs INTEGER NOT NULL DEFAULT 0
        CHECK (reply_to_differs IN (0, 1));
    -- The topmost Authentication-Results header: the server that wrote it and its results.
    -- Whether that server is the account's provider is decided by who reads it.
    ALTER TABLE envelope ADD COLUMN auth_server TEXT NOT NULL DEFAULT '';
    ALTER TABLE envelope ADD COLUMN auth_spf TEXT NOT NULL DEFAULT '';
    ALTER TABLE envelope ADD COLUMN auth_dkim TEXT NOT NULL DEFAULT '';
    ALTER TABLE envelope ADD COLUMN auth_dmarc TEXT NOT NULL DEFAULT '';
    -- From the body, once it is held whole (6.1, 6.3).
    ALTER TABLE envelope ADD COLUMN hidden_chars INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE envelope ADD COLUMN links INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE envelope ADD COLUMN mismatched_links INTEGER NOT NULL DEFAULT 0;
    -- The template key's first half, from the headers; the key itself once the body is held.
    ALTER TABLE envelope ADD COLUMN template_head BLOB CHECK (length(template_head) = 16);
    ALTER TABLE envelope ADD COLUMN template_key BLOB CHECK (length(template_key) = 16);
    ALTER TABLE envelope ADD COLUMN body_shape BLOB CHECK (length(body_shape) = 16);
    CREATE INDEX envelope_template ON envelope (template_key) WHERE template_key IS NOT NULL;
    CREATE INDEX envelope_stale ON envelope (parser, message_id);

    -- A part's bytes, read for what they are.
    ALTER TABLE part ADD COLUMN detected TEXT NOT NULL DEFAULT '';
    ALTER TABLE part ADD COLUMN type_differs INTEGER NOT NULL DEFAULT 0
        CHECK (type_differs IN (0, 1));
    ALTER TABLE part ADD COLUMN hash BLOB CHECK (length(hash) = 32);

    -- A link in a message, with the host the text shown for it names (6.1).
    CREATE TABLE link (
        message_id INTEGER NOT NULL REFERENCES message (id),
        ordinal INTEGER NOT NULL,
        target TEXT NOT NULL,
        target_host TEXT NOT NULL,
        text_host TEXT NOT NULL,
        mismatched INTEGER NOT NULL CHECK (mismatched IN (0, 1)),
        PRIMARY KEY (message_id, ordinal)
    ) STRICT, WITHOUT ROWID;
    ",
];

/// Brings `connection` to the newest schema, one migration and one
/// transaction at a time.
///
/// # Errors
/// [`StoreError::Newer`] when the store was written by a newer program. A
/// migration that fails leaves the store at the version before it.
pub(super) fn migrate(connection: &mut Connection, migrations: &[&str]) -> Result<(), StoreError> {
    let found: u32 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    let supported = u32::try_from(migrations.len()).unwrap_or(u32::MAX);
    if found > supported {
        return Err(StoreError::Newer { found, supported });
    }
    for (index, migration) in migrations.iter().enumerate().skip(found as usize) {
        let transaction = connection.transaction()?;
        transaction.execute_batch(migration)?;
        // A pragma takes no bound parameter; the value is this loop's own number.
        transaction.execute_batch(&format!("PRAGMA user_version = {}", index + 1))?;
        transaction.commit()?;
    }
    Ok(())
}

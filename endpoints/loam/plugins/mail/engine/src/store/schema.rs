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

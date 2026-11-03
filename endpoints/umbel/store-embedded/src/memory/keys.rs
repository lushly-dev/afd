//! The key file, `memory.keys` (phase 3 section 5.4, D83): a small SQLite database in
//! rollback-journal mode beside `memory.sqlite3`, holding one key per record and, for a destroyed
//! key, a marker with the record's id, the time and the kind (`forget` or `purge`).
//!
//! Every connection sets `journal_mode=DELETE`, `secure_delete=ON`, `synchronous=EXTRA`, the lock
//! timeout and, on macOS, full fsync, because they reset per connection. `EXTRA` syncs the
//! directory after the journal's unlink, so a power loss cannot bring a destroyed key back. Lock
//! order: a path that holds both locks takes the memory database's first. Readers take this file's
//! shared lock for one `SELECT` and hold no memory write lock.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use rusqlite::{Connection, ErrorCode, OpenFlags, TransactionBehavior, params, params_from_iter};
use umbel_store::{Millis, StoreError};

use super::exclusion;
use super::points;
use super::seal::{RecordKey, random};
use crate::error::{Fail, map_sql};

/// The key file's name under a space's `store/` directory.
pub const KEYS_FILE: &str = "memory.keys";
/// `PRAGMA application_id` of a key file: "UMBK".
pub(crate) const KEYS_APPLICATION_ID: i64 = 0x554D_424B;
/// `PRAGMA user_version` of the key file this build writes and serves.
pub(crate) const KEYS_VERSION: i64 = 1;

const KEYS_SCHEMA: &str = "
CREATE TABLE meta (store_id TEXT NOT NULL);
CREATE TABLE record_keys (
  id TEXT PRIMARY KEY, key BLOB, destroyed_at INTEGER, kind TEXT, settled INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX unsettled ON record_keys (id) WHERE settled = 0;
";

/// How many ids one lookup binds.
const CHUNK: usize = 400;

/// Why a key was destroyed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MarkerKind {
    /// A forget (tombstone, erased prefixes).
    Forget,
    /// A purge by a sweep or before a write (no tombstone).
    Purge,
}

impl MarkerKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Forget => "forget",
            Self::Purge => "purge",
        }
    }

    fn parse(text: &str) -> Result<Self, Fail> {
        match text {
            "forget" => Ok(Self::Forget),
            "purge" => Ok(Self::Purge),
            _ => Err(StoreError::Corrupt("a key marker has an unknown kind".to_owned()).into()),
        }
    }
}

/// One `record_keys` entry.
pub(crate) enum KeyEntry {
    /// A live key.
    Live(RecordKey),
    /// A destroyed marker: the record is forgotten or purged.
    Destroyed {
        kind: MarkerKind,
        at: Millis,
        settled: bool,
    },
}

/// Key entries by record id. An id with no entry is **absent**.
#[derive(Default)]
pub(crate) struct Keys(HashMap<String, KeyEntry>);

impl Keys {
    /// The entry of `id`, if any.
    pub(crate) fn entry(&self, id: &str) -> Option<&KeyEntry> {
        self.0.get(id)
    }

    /// Whether `id` has a destroyed marker.
    pub(crate) fn destroyed(&self, id: &str) -> Option<(MarkerKind, Millis)> {
        match self.0.get(id) {
            Some(KeyEntry::Destroyed { kind, at, .. }) => Some((*kind, *at)),
            _ => None,
        }
    }

    /// The live key of `id`: `NotFound` for a marker, since the record is forgotten, and
    /// `KeyAbsent` for an id with no entry (section 5.4's table).
    pub(crate) fn require(&self, id: &str) -> Result<&RecordKey, Fail> {
        match self.0.get(id) {
            Some(KeyEntry::Live(key)) => Ok(key),
            Some(KeyEntry::Destroyed { .. }) => Err(StoreError::NotFound.into()),
            None => Err(StoreError::KeyAbsent { id: id.to_owned() }.into()),
        }
    }

    /// Ids with a live key.
    pub(crate) fn live_ids(&self) -> impl Iterator<Item = &str> {
        self.0.iter().filter_map(|(id, e)| match e {
            KeyEntry::Live(_) => Some(id.as_str()),
            KeyEntry::Destroyed { .. } => None,
        })
    }

    /// `(destroyed, unsettled)` marker counts.
    pub(crate) fn marker_counts(&self) -> (u64, u64) {
        let mut out = (0, 0);
        for entry in self.0.values() {
            if let KeyEntry::Destroyed { settled, .. } = entry {
                out.0 += 1;
                if !settled {
                    out.1 += 1;
                }
            }
        }
        out
    }
}

/// What the key file's `PRAGMA`s say on a new connection made as every one is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoryKeysInfo {
    /// `PRAGMA journal_mode`; `delete`.
    pub journal_mode: String,
    /// `PRAGMA synchronous`; 3 is `EXTRA`.
    pub synchronous: i64,
    /// Whether `secure_delete` is on.
    pub secure_delete: bool,
    /// Whether `fullfsync` is on (macOS only).
    pub full_fsync: bool,
    /// The connection's busy timeout, in milliseconds.
    pub busy_timeout_ms: u64,
    /// `PRAGMA application_id`; `0x554D424B`.
    pub application_id: i64,
    /// `PRAGMA user_version`; 1.
    pub user_version: i64,
    /// The store id it belongs to.
    pub store_id: String,
}

/// A file's identity, so a pooled connection is dropped when the file is replaced.
fn file_id(meta: &std::fs::Metadata) -> (u64, u64) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        (meta.dev(), meta.ino())
    }
    #[cfg(not(unix))]
    {
        let _ = meta;
        (0, 0)
    }
}

/// The key file of one memory store, with one pooled connection.
pub(crate) struct KeyFile {
    path: PathBuf,
    timeout: Duration,
    idle: Mutex<Option<(Connection, (u64, u64))>>,
}

impl KeyFile {
    pub(crate) fn new(path: PathBuf, timeout: Duration) -> Self {
        Self {
            path,
            timeout,
            idle: Mutex::new(None),
        }
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn exists(&self) -> bool {
        self.path.exists()
    }

    /// Run `work` on a connection to the key file that belongs to `store_id`.
    ///
    /// # Errors
    /// `KeysMissing` when the file does not exist; `KeysMismatch` when it is not a key file or
    /// belongs to another store; whatever `work` answers.
    pub(crate) fn with<T>(
        &self,
        store_id: &str,
        work: impl FnOnce(&mut Connection) -> Result<T, Fail>,
    ) -> Result<T, Fail> {
        let meta = match std::fs::metadata(&self.path) {
            Ok(meta) => meta,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Err(StoreError::KeysMissing.into());
            }
            Err(e) => return Err(StoreError::Io(format!("{}: {e}", self.path.display())).into()),
        };
        let id = file_id(&meta);
        let pooled = self.idle.lock().ok().and_then(|mut idle| idle.take());
        let mut conn = match pooled {
            Some((conn, seen)) if seen == id => conn,
            _ => {
                let conn = connect(&self.path, self.timeout)?;
                if identity(&conn)? != store_id {
                    return Err(StoreError::KeysMismatch.into());
                }
                conn
            }
        };
        let result = work(&mut conn);
        if result.is_ok()
            && let Ok(mut idle) = self.idle.lock()
        {
            *idle = Some((conn, id));
        }
        result
    }

    /// The key file's settings on a new connection.
    pub(crate) fn info(&self) -> Result<MemoryKeysInfo, Fail> {
        let conn = connect(&self.path, self.timeout)?;
        let int = |pragma: &str| -> Result<i64, Fail> {
            Ok(conn.query_row(&format!("PRAGMA {pragma}"), [], |r| r.get(0))?)
        };
        Ok(MemoryKeysInfo {
            journal_mode: conn.query_row("PRAGMA journal_mode", [], |r| r.get(0))?,
            synchronous: int("synchronous")?,
            secure_delete: int("secure_delete")? == 1,
            full_fsync: int("fullfsync")? == 1,
            busy_timeout_ms: u64::try_from(int("busy_timeout")?).unwrap_or(0),
            application_id: int("application_id")?,
            user_version: int("user_version")?,
            store_id: identity(&conn)?,
        })
    }
}

/// A key file's own failure: a lock wait is `Busy`, anything else says the file is not a key
/// file, so `KeysMismatch`.
fn not_a_key_file(error: &rusqlite::Error) -> Fail {
    match map_sql(error) {
        StoreError::Busy => StoreError::Busy.into(),
        _ => StoreError::KeysMismatch.into(),
    }
}

/// One connection to an existing key file with its per-connection pragmas. Never creates it.
fn connect(path: &Path, timeout: Duration) -> Result<Connection, Fail> {
    if !path.exists() {
        return Err(StoreError::KeysMissing.into());
    }
    let flags = OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let conn = Connection::open_with_flags(path, flags).map_err(|e| not_a_key_file(&e))?;
    pragmas(&conn, timeout).map_err(|e| not_a_key_file(&e))?;
    Ok(conn)
}

fn pragmas(conn: &Connection, timeout: Duration) -> Result<(), rusqlite::Error> {
    conn.busy_timeout(timeout)?;
    conn.query_row("PRAGMA journal_mode = DELETE", [], |r| {
        r.get::<_, String>(0)
    })?;
    conn.query_row("PRAGMA secure_delete = ON", [], |r| r.get::<_, i64>(0))?;
    conn.pragma_update(None, "synchronous", "EXTRA")?;
    if cfg!(target_os = "macos") {
        conn.pragma_update(None, "fullfsync", "ON")?;
    }
    Ok(())
}

/// The store id a key file belongs to, after checking that it is one.
fn identity(conn: &Connection) -> Result<String, Fail> {
    let int = |pragma: &str| -> Result<i64, Fail> {
        conn.query_row(&format!("PRAGMA {pragma}"), [], |r| r.get(0))
            .map_err(|e| not_a_key_file(&e))
    };
    if int("application_id")? != KEYS_APPLICATION_ID {
        return Err(StoreError::KeysMismatch.into());
    }
    let version = int("user_version")?;
    if version > KEYS_VERSION {
        return Err(StoreError::VersionUnsupported {
            found: u32::try_from(version).unwrap_or(u32::MAX),
            supported: 1,
        }
        .into());
    }
    if version != KEYS_VERSION {
        return Err(StoreError::KeysMismatch.into());
    }
    conn.query_row("SELECT store_id FROM meta", [], |r| r.get(0))
        .map_err(|e| not_a_key_file(&e))
}

/// The store id of the key file at `path` (provisioning's adoption, section 5.4 step 3).
pub(crate) fn identity_of(path: &Path, timeout: Duration) -> Result<String, Fail> {
    identity(&connect(path, timeout)?)
}

/// Create `memory.keys` for `store_id` (section 5.4 step 3): remove any leftover temporary file,
/// write the schema and the store id, with no keys, to `.memory-keys-<random>.tmp` (mode `0600`,
/// excluded from machine backups before it is renamed when `exclude`), commit, rename it into
/// place and fsync the directory.
pub(crate) fn create(path: &Path, store_id: &str, exclude: bool) -> Result<(), Fail> {
    let dir = path
        .parent()
        .ok_or_else(|| StoreError::Io("the key file has no directory".to_owned()))?;
    let io =
        |e: std::io::Error| -> Fail { StoreError::Io(format!("{}: {e}", dir.display())).into() };
    for entry in std::fs::read_dir(dir).map_err(io)? {
        let entry = entry.map_err(io)?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with(".memory-keys-") && name.ends_with(".tmp") {
            // A dead process's leftover: it holds only a store id. Provisioning runs under the
            // memory database's write lock, so no live process is writing one.
            std::fs::remove_file(entry.path()).map_err(io)?;
        }
    }
    let mut suffix = [0_u8; 8];
    random(&mut suffix)?;
    let suffix: String = suffix.iter().map(|b| format!("{b:02x}")).collect();
    let temp = dir.join(format!(".memory-keys-{suffix}.tmp"));
    super::pool::create_private(&temp).map_err(io)?;
    // Best effort, as on every writer's open; the doctor reports a file left unmarked.
    let _ = exclusion::apply(&temp, exclude);
    let written = (|| -> Result<(), rusqlite::Error> {
        let flags = OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX;
        let mut conn = Connection::open_with_flags(&temp, flags)?;
        pragmas(&conn, Duration::from_secs(5))?;
        conn.pragma_update(None, "application_id", KEYS_APPLICATION_ID)?;
        conn.pragma_update(None, "user_version", KEYS_VERSION)?;
        let tx = conn.transaction()?;
        tx.execute_batch(KEYS_SCHEMA)?;
        tx.execute("INSERT INTO meta (store_id) VALUES (?1)", [store_id])?;
        tx.commit()?;
        conn.close().map_err(|(_, e)| e)
    })();
    if let Err(error) = written {
        let _ = std::fs::remove_file(&temp);
        return Err(map_sql(&error).into());
    }
    std::fs::rename(&temp, path).map_err(io)?;
    sync_dir(dir).map_err(io)?;
    points::crash("provision-keys");
    Ok(())
}

/// fsync a directory, so a rename in it is durable. Windows cannot open a directory for this.
fn sync_dir(dir: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        std::fs::File::open(dir)?.sync_all()
    }
    #[cfg(not(unix))]
    {
        let _ = dir;
        Ok(())
    }
}

fn entry_from_row(row: &rusqlite::Row<'_>) -> Result<(String, KeyEntry), Fail> {
    let id: String = row.get(0)?;
    let key = row
        .get_ref(1)?
        .as_blob_or_null()
        .map_err(|_| StoreError::Corrupt(format!("the key of {id} is not a blob")))?;
    let entry = match key {
        Some(bytes) => KeyEntry::Live(
            RecordKey::from_slice(bytes)
                .ok_or_else(|| StoreError::Corrupt(format!("the key of {id} is malformed")))?,
        ),
        None => KeyEntry::Destroyed {
            kind: MarkerKind::parse(&row.get::<_, String>(3)?)?,
            at: row.get::<_, Option<Millis>>(2)?.unwrap_or(0),
            settled: row.get::<_, i64>(4)? != 0,
        },
    };
    Ok((id, entry))
}

const ENTRY_COLS: &str = "id, key, destroyed_at, kind, settled";

/// The entries of `ids`, in one `SELECT` per few hundred ids.
pub(crate) fn lookup(conn: &Connection, ids: &[&str]) -> Result<Keys, Fail> {
    let mut out = Keys::default();
    for chunk in ids.chunks(CHUNK) {
        let marks = vec!["?"; chunk.len()].join(", ");
        let sql = format!("SELECT {ENTRY_COLS} FROM record_keys WHERE id IN ({marks})");
        let mut stmt = conn.prepare(&sql)?;
        let mut rows = stmt.query(params_from_iter(chunk.iter()))?;
        while let Some(row) = rows.next()? {
            let (id, entry) = entry_from_row(row)?;
            out.0.insert(id, entry);
        }
    }
    Ok(out)
}

/// Every entry.
pub(crate) fn all(conn: &Connection) -> Result<Keys, Fail> {
    let mut out = Keys::default();
    let mut stmt = conn.prepare(&format!("SELECT {ENTRY_COLS} FROM record_keys"))?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let (id, entry) = entry_from_row(row)?;
        out.0.insert(id, entry);
    }
    Ok(out)
}

/// Commit new records' keys, in one transaction. An id that already has an entry is a used id.
pub(crate) fn insert(conn: &mut Connection, keys: &[(String, RecordKey)]) -> Result<(), Fail> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    for (id, key) in keys {
        match tx.execute(
            "INSERT INTO record_keys (id, key, destroyed_at, kind, settled) \
             VALUES (?1, ?2, NULL, NULL, 1)",
            params![id, key.bytes()],
        ) {
            Ok(_) => {}
            Err(rusqlite::Error::SqliteFailure(f, _))
                if f.code == ErrorCode::ConstraintViolation =>
            {
                return Err(StoreError::invalid(format!(
                    "memory write: id {id} is already used; there is no update path"
                ))
                .into());
            }
            Err(other) => return Err(other.into()),
        }
    }
    tx.commit()?;
    Ok(())
}

/// Destroy the keys of `ids` (section 5.4 step 2): each entry's key set to null with the time and
/// kind, unsettled. An upsert, because a record whose entry is absent needs a marker too. The
/// commit is the erasure point.
pub(crate) fn destroy(
    conn: &mut Connection,
    ids: &[&str],
    at: Millis,
    kind: MarkerKind,
) -> Result<(), Fail> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    for id in ids {
        tx.execute(
            "INSERT INTO record_keys (id, key, destroyed_at, kind, settled) \
             VALUES (?1, NULL, ?2, ?3, 0) \
             ON CONFLICT (id) DO UPDATE SET key = NULL, destroyed_at = excluded.destroyed_at, \
             kind = excluded.kind, settled = 0",
            params![id, at, kind.as_str()],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// The unsettled markers: `(id, kind, destroyed_at)`.
pub(crate) fn unsettled(conn: &Connection) -> Result<Vec<(String, MarkerKind, Millis)>, Fail> {
    let mut stmt = conn
        .prepare("SELECT id, kind, destroyed_at FROM record_keys WHERE settled = 0 ORDER BY id")?;
    let mut rows = stmt.query([])?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        out.push((
            row.get(0)?,
            MarkerKind::parse(&row.get::<_, String>(1)?)?,
            row.get::<_, Option<Millis>>(2)?.unwrap_or(0),
        ));
    }
    Ok(out)
}

/// Mark `ids`' markers settled (section 5.4 step 5), in one commit holding nothing else.
pub(crate) fn settle(conn: &mut Connection, ids: &[&str]) -> Result<(), Fail> {
    if ids.is_empty() {
        return Ok(());
    }
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    for id in ids {
        tx.execute(
            "UPDATE record_keys SET settled = 1 WHERE id = ?1 AND key IS NULL",
            [id],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Remove orphan keys: live entries of `ids` (`memory-reindex` with `removeOrphans`, D89). A
/// marker is never an orphan and is never removed.
pub(crate) fn remove_live(conn: &mut Connection, ids: &[&str]) -> Result<u64, Fail> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let mut removed = 0;
    for id in ids {
        removed += tx.execute(
            "DELETE FROM record_keys WHERE id = ?1 AND key IS NOT NULL",
            [id],
        )? as u64;
    }
    tx.commit()?;
    Ok(removed)
}

/// Orphans: live keys of ids with no row in `rows`.
pub(crate) fn orphans<'a>(keys: &'a Keys, rows: &HashSet<String>) -> Vec<&'a str> {
    let mut out: Vec<&str> = keys.live_ids().filter(|id| !rows.contains(*id)).collect();
    out.sort_unstable();
    out
}

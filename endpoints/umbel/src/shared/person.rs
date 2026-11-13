//! Person decisions and their logins (phase 5 specification, sections 7.2 and 10.2; D115, D126):
//! `state/shared/person.sqlite3`, shared by every process behind one URL and by the CLI, so a
//! decision one process (or `umbel call` at a terminal) begins, any process's person page can
//! decide and any process can resume.
//!
//! **What a row holds.** A decision holds `person-decision.v1`'s fields (ids, the input digest and
//! the preview's declared properties, which manifest version 5 keeps to `journal.keep`'s ids),
//! and, beside them, what the page shows of who asked (the call's spaces and delegation chain, ids
//! only) and the trace of the call that began it, under which the decision is journaled. A login
//! holds its PKCE verifier, its `nonce`, the SHA-256 of the browser's cookie and, once the login
//! returned, its `auth_time`, its `acr` and the SHA-256 of the preview the page rendered. No row
//! holds a preview's text, a token, a code or a secret.
//!
//! **Single use.** A login is taken once when its browser returns (`started` to `returning`), so a
//! replayed `state` finds nothing; it is spent once when its person decides (`verified` to
//! `used`), in the same transaction that moves the decision from `pending`, so of two concurrent
//! decisions on one login, or two logins on one decision, exactly one is recorded.
//!
//! **Pages** (the Ideas host-review specification, sections 2 and 3). A decision's row also holds
//! each page of its preview the page rendered (its number, the SHA-256 of what it showed and the
//! ids of its items), the number of pages they said there were, and the item ids the person
//! unchecked. Ids only: an item's text is never stored. A page that renders with another number
//! of pages, or a page seen before that renders with another hash, clears them all.
//!
//! **Lifetime.** A decision waits `person.decision_ttl_s` (600 seconds by default), and each page
//! rendered moves its expiry to the render's time plus that, never more than
//! [`crate::workspace::PERSON_DECISION_TTL_MAX_S`] after it began. A login for a decision lives as
//! long as its decision, moved with it; a login for the list of pending decisions lives ten
//! minutes. Rows are purged an hour after they expire (at most 64 per write), with
//! `secure_delete` on. The file is WAL, mode 0600 in a 0700 `state/shared/`, schema `user_version`
//! 2 (version 1, without the pages, is migrated in place); it is opened on first use, and a lock
//! wait past `store.lock_timeout_ms` is `WORKSPACE_SHARED_TIMEOUT`.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use afd::ActorKind;
use rusqlite::{Connection, ErrorCode, OptionalExtension, TransactionBehavior, params};
use serde_json::{Map, Value};

use super::SharedError;
use crate::auth::ChainEntry;
pub(crate) use crate::person::{ActorRef, DecisionFor};
use crate::workspace::WorkspaceError;

/// The store's name in errors and logs (`details.store`).
pub(crate) const STORE: &str = "person";
/// The schema version this host writes (`PRAGMA user_version`).
const SCHEMA_VERSION: i64 = 2;
/// The most expired rows one write purges, per table.
const PURGE_BATCH: i64 = 64;
/// How long a row is kept after it expires (section 10.2): one hour.
pub(crate) const KEEP_AFTER_EXPIRY_MS: i64 = 3_600_000;
/// The most logins one decision may start: opening its link is unauthenticated, so the rows one
/// decision id can make are bounded.
pub(crate) const MAX_LOGINS_PER_DECISION: i64 = 8;
/// The most item ids one decision records as pulled out (`MAX_EXCLUDED`).
pub(crate) const MAX_EXCLUDED: usize = 2000;
/// The longest a decision lives after it began, however often its pages render.
pub(crate) const MAX_DECISION_LIFE_MS: i64 =
    crate::workspace::PERSON_DECISION_TTL_MAX_S.saturating_mul(1000) as i64;

/// One page of a decision's preview, as the page rendered it.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SeenPage {
    /// Its number, from 1.
    pub(crate) page: u32,
    /// `sha256:<hex>` of what it showed.
    pub(crate) hash: String,
    /// Its items' ids, in the order shown.
    pub(crate) items: Vec<String>,
}

/// A decision's status (`person-decision.v1`): a pending decision past `expires` is expired.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Status {
    Pending,
    Approved,
    Declined,
}

impl Status {
    fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Approved => "approved",
            Self::Declined => "declined",
        }
    }

    fn parse(text: &str) -> Option<Self> {
        Some(match text {
            "pending" => Self::Pending,
            "approved" => Self::Approved,
            "declined" => Self::Declined,
            _ => return None,
        })
    }
}

/// A decision to begin.
#[derive(Clone, Debug)]
pub(crate) struct NewDecision {
    pub(crate) id: String,
    pub(crate) for_: DecisionFor,
    pub(crate) command: String,
    pub(crate) input_digest: String,
    /// Only the preview's declared properties (2.3's rule keeps them to ids).
    pub(crate) properties: Map<String, Value>,
    /// The call's spaces, shown on the page.
    pub(crate) spaces: Vec<String>,
    /// The call's delegation chain, shown on the page.
    pub(crate) chain: Vec<ChainEntry>,
    /// The trace of the call that began it; the decision is journaled under it.
    pub(crate) trace_id: Option<String>,
    pub(crate) created_ms: i64,
    pub(crate) expires_ms: i64,
}

/// A stored decision.
#[derive(Clone, Debug)]
pub(crate) struct Decision {
    pub(crate) id: String,
    pub(crate) for_: DecisionFor,
    pub(crate) command: String,
    pub(crate) input_digest: String,
    pub(crate) properties: Map<String, Value>,
    pub(crate) spaces: Vec<String>,
    pub(crate) chain: Vec<ChainEntry>,
    pub(crate) trace_id: Option<String>,
    pub(crate) created_ms: i64,
    pub(crate) expires_ms: i64,
    pub(crate) status: Status,
    pub(crate) decided_ms: Option<i64>,
    pub(crate) auth_time_ms: Option<i64>,
    pub(crate) acr: Option<String>,
    pub(crate) preview_hash: Option<String>,
    /// The number of pages the rendered pages said there were; `None` before the first.
    pub(crate) pages_total: Option<u32>,
    /// The pages rendered, by number.
    pub(crate) pages: Vec<SeenPage>,
    /// The item ids the person unchecked.
    pub(crate) excluded: Vec<String>,
}

impl Decision {
    /// Whether it may still be decided or used at `now_ms`.
    pub(crate) fn live(&self, now_ms: i64) -> bool {
        now_ms < self.expires_ms
    }

    /// Whether every page from 1 to the number of pages was rendered, each with that number.
    pub(crate) fn every_page_seen(&self) -> bool {
        self.pages_total.is_some_and(|total| {
            (1..=total).all(|number| self.pages.iter().any(|seen| seen.page == number))
        })
    }

    /// The page `number` as it was rendered.
    pub(crate) fn seen(&self, number: u32) -> Option<&SeenPage> {
        self.pages.iter().find(|seen| seen.page == number)
    }

    /// The decision as `person-decision.v2.json` gives it: the fields of section 7.2, and the
    /// pages rendered and the items pulled out (the Ideas host-review specification, section
    /// 3), never the page's own columns.
    #[cfg(test)]
    pub(crate) fn to_v2(&self) -> Value {
        use crate::person::iso;
        let decided = self.status != Status::Pending;
        serde_json::json!({
            "version": crate::versions::PERSON_VERSION,
            "id": self.id,
            "for": self.for_,
            "command": self.command,
            "inputDigest": self.input_digest,
            "properties": self.properties,
            "createdAt": iso(self.created_ms),
            "expires": iso(self.expires_ms),
            "status": self.status.as_str(),
            "decidedAt": self.decided_ms.filter(|_| decided).map(iso),
            "level": decided.then_some("verified"),
            "authTime": self.auth_time_ms.filter(|_| decided).map(iso),
            "acr": self.acr.as_ref().filter(|_| decided),
            "previewHash": self.preview_hash.as_ref().filter(|_| decided),
            "pages": self.pages,
            "excluded": self.excluded,
        })
    }
}

/// A login to start, on the page's `GET <path>/d/<id>`.
#[derive(Clone, Debug)]
pub(crate) struct NewLogin {
    pub(crate) id: String,
    pub(crate) decision: String,
    /// The PKCE verifier, kept server-side.
    pub(crate) verifier: String,
    /// The `nonce`, kept server-side.
    pub(crate) nonce: String,
    /// The SHA-256 of the browser's cookie value, hex.
    pub(crate) browser_hash: String,
    pub(crate) created_ms: i64,
    pub(crate) expires_ms: i64,
}

/// A login for the list of a person's pending decisions (section 5 of the Ideas host-review
/// specification): no decision, the namespace whose login it is.
#[derive(Clone, Debug)]
pub(crate) struct NewListLogin {
    pub(crate) id: String,
    pub(crate) namespace: String,
    pub(crate) verifier: String,
    pub(crate) nonce: String,
    pub(crate) browser_hash: String,
    pub(crate) created_ms: i64,
    pub(crate) expires_ms: i64,
}

/// Where a login is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum LoginStatus {
    /// Sent to the identity provider.
    Started,
    /// Its browser returned once; being checked.
    Returning,
    /// Checked: the person may decide on the page it rendered.
    Verified,
    /// Its person decided.
    Used,
    /// Refused on its return.
    Failed,
}

impl LoginStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Started => "started",
            Self::Returning => "returning",
            Self::Verified => "verified",
            Self::Used => "used",
            Self::Failed => "failed",
        }
    }

    fn parse(text: &str) -> Option<Self> {
        Some(match text {
            "started" => Self::Started,
            "returning" => Self::Returning,
            "verified" => Self::Verified,
            "used" => Self::Used,
            "failed" => Self::Failed,
            _ => return None,
        })
    }
}

/// A stored login.
#[derive(Clone)]
pub(crate) struct Login {
    pub(crate) id: String,
    /// Its decision; empty for a login to the list of pending decisions.
    pub(crate) decision: String,
    /// The namespace of a login to the list; `None` for a decision's.
    pub(crate) namespace: Option<String>,
    pub(crate) verifier: String,
    pub(crate) nonce: String,
    pub(crate) created_ms: i64,
    pub(crate) status: LoginStatus,
}

impl std::fmt::Debug for Login {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Login")
            .field("status", &self.status)
            .finish_non_exhaustive()
    }
}

/// What a verified login carries to its decision.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Verified {
    pub(crate) auth_time_ms: i64,
    pub(crate) acr: String,
    /// `sha256:<hex>` of the first page the login rendered.
    pub(crate) preview_hash: String,
    /// Whether that page could be shown. Approve is gated on the decision's pages, not on this.
    pub(crate) preview_ok: bool,
}

/// A page the page rendered, to record against its decision.
#[derive(Clone, Debug)]
pub(crate) struct Render {
    pub(crate) decision: String,
    /// The login that rendered it, whose expiry moves with the decision's.
    pub(crate) login: String,
    pub(crate) page: u32,
    pub(crate) pages: u32,
    /// `sha256:<hex>` of what it showed.
    pub(crate) hash: String,
    pub(crate) items: Vec<String>,
    /// `person.decision_ttl_s`, in milliseconds.
    pub(crate) ttl_ms: i64,
}

/// What recording a render found.
#[derive(Clone, Debug)]
pub(crate) enum Rendered {
    /// Recorded: the decision as it now stands.
    Recorded(Box<Decision>),
    /// The page said another number of pages, or a page seen before showed something else: the
    /// pages and the choices were cleared, and the person starts again from page 1.
    Changed,
    /// An item id of the page is another page's: the page cannot be shown.
    Duplicate,
    /// The decision is no longer pending and live.
    Gone,
}

/// What the person posted from a page: its number, the action, and the zero-based positions of
/// the items left checked.
#[derive(Clone, Debug)]
pub(crate) struct Choice {
    pub(crate) page: u32,
    pub(crate) action: Action,
    pub(crate) checked: Vec<usize>,
}

/// A form's action.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Action {
    Next,
    Previous,
    Approve,
    Decline,
}

impl Action {
    pub(crate) fn parse(text: &str) -> Option<Self> {
        Some(match text {
            "next" => Self::Next,
            "previous" => Self::Previous,
            "approve" => Self::Approve,
            "decline" => Self::Decline,
            _ => return None,
        })
    }
}

/// What starting a login found.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum LoginStart {
    Started,
    /// No pending, unexpired decision has that id.
    NoDecision,
    /// The decision has started [`MAX_LOGINS_PER_DECISION`] logins.
    TooMany,
}

/// What a posted page found.
#[derive(Clone, Debug)]
pub(crate) enum Decided {
    /// Recorded: the decision as it now stands, approved or declined.
    Recorded(Box<Decision>),
    /// `next` or `previous`: the page's choices were kept; show the page with this number.
    Moved(u32),
    /// Nothing was recorded: the page posted from is not the one rendered (a position past its
    /// items, a page not rendered, a move past the first or last page), or an approval came
    /// before every page was rendered.
    Changed,
    /// Nothing was recorded: the login is not a verified login of this decision in this browser,
    /// has expired or was used, or the decision is no longer pending and live.
    Refused,
}

/// The person store (section 10.2). A networked backend for several machines implements the same
/// trait (phase 6).
pub(crate) trait PersonStore: Send + Sync {
    /// Record a new pending decision.
    ///
    /// # Errors
    /// A [`SharedError`]; the caller fails closed.
    fn create(&self, decision: &NewDecision, now_ms: i64) -> Result<(), SharedError>;

    /// The decision with `id`, if it is still stored.
    ///
    /// # Errors
    /// A [`SharedError`].
    fn decision(&self, id: &str) -> Result<Option<Decision>, SharedError>;

    /// Start `login` for its decision, when that decision is pending and live at `now_ms` and has
    /// started fewer than [`MAX_LOGINS_PER_DECISION`] logins.
    ///
    /// # Errors
    /// A [`SharedError`].
    fn start_login(&self, login: &NewLogin, now_ms: i64) -> Result<LoginStart, SharedError>;

    /// Take the login `id` once, on its browser's return, when the browser's cookie hashes to
    /// `browser_hash`: a `started`, live login becomes `returning` and is returned; anything else
    /// is `None`, and a login presented without its cookie is left as it was, so whoever holds a
    /// leaked `state` cannot spend the person's login.
    ///
    /// # Errors
    /// A [`SharedError`].
    fn take_login(
        &self,
        id: &str,
        browser_hash: &str,
        now_ms: i64,
    ) -> Result<Option<Login>, SharedError>;

    /// Finish a `returning` login: `verified` with what it proved, or `failed`.
    ///
    /// # Errors
    /// A [`SharedError`].
    fn finish_login(&self, id: &str, verified: Option<&Verified>) -> Result<bool, SharedError>;

    /// Start a login for the list of pending decisions.
    ///
    /// # Errors
    /// A [`SharedError`].
    fn start_list_login(&self, login: &NewListLogin, now_ms: i64) -> Result<(), SharedError>;

    /// Whether `login` is a verified, live login of `decision` in the browser whose cookie hashes
    /// to `browser_hash`, with the decision pending and live.
    ///
    /// # Errors
    /// A [`SharedError`].
    fn verified_login(
        &self,
        decision: &str,
        login: &str,
        browser_hash: &str,
        now_ms: i64,
    ) -> Result<bool, SharedError>;

    /// Record a page rendered for a pending, live decision, and move its expiry and its login's.
    ///
    /// # Errors
    /// A [`SharedError`].
    fn render(&self, render: &Render, now_ms: i64) -> Result<Rendered, SharedError>;

    /// What the person posted from a page, through the verified login `login` of `decision`,
    /// from the browser whose cookie hashes to `browser_hash`: the page's choices kept on a move,
    /// or the decision recorded on Approve or Decline, atomically spending the login. The
    /// checked positions map to the ids of the page as it was rendered.
    ///
    /// # Errors
    /// A [`SharedError`].
    fn decide(
        &self,
        decision: &str,
        login: &str,
        browser_hash: &str,
        choice: &Choice,
        now_ms: i64,
    ) -> Result<Decided, SharedError>;

    /// The pending, live decisions for the person `subject` of `namespace`, oldest first.
    ///
    /// # Errors
    /// A [`SharedError`].
    fn pending_for(
        &self,
        namespace: &str,
        subject: &str,
        now_ms: i64,
    ) -> Result<Vec<Decision>, SharedError>;
}

/// The SQLite person store, opened on first use.
pub(crate) struct SqlitePerson {
    path: PathBuf,
    lock_timeout_ms: u64,
    connection: Mutex<Option<Connection>>,
}

impl std::fmt::Debug for SqlitePerson {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SqlitePerson").finish_non_exhaustive()
    }
}

fn shared_error(error: &rusqlite::Error) -> SharedError {
    match error.sqlite_error_code() {
        Some(ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked) => {
            SharedError::Timeout { store: STORE }
        }
        _ => SharedError::Failed {
            store: STORE,
            message: error.to_string(),
        },
    }
}

fn failed(error: &dyn std::fmt::Display) -> SharedError {
    SharedError::Failed {
        store: STORE,
        message: error.to_string(),
    }
}

const DECISION_COLUMNS: &str = "id, for_json, command, input_digest, properties, spaces, chain, trace_id, created_ms, expires_ms, status, decided_ms, auth_time_ms, acr, preview_hash, pages_total, pages, excluded";

/// A decision row as read, before its JSON columns are checked.
type RawDecision = (Decision, String, String, String, String);

fn decision_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RawDecision> {
    let for_json: String = row.get(1)?;
    let properties: String = row.get(4)?;
    let chain: String = row.get(6)?;
    let status: String = row.get(10)?;
    let decision = Decision {
        id: row.get(0)?,
        for_: serde_json::from_str(&for_json).unwrap_or(DecisionFor {
            actor: ActorRef {
                kind: ActorKind::Test,
                id: None,
                on_behalf_of: None,
            },
            client_id: None,
            issuer: None,
            namespace: String::new(),
            subject: String::new(),
        }),
        command: row.get(2)?,
        input_digest: row.get(3)?,
        properties: serde_json::from_str(&properties).unwrap_or_default(),
        spaces: serde_json::from_str(&row.get::<_, String>(5)?).unwrap_or_default(),
        chain: serde_json::from_str(&chain).unwrap_or_default(),
        trace_id: row.get(7)?,
        created_ms: row.get(8)?,
        expires_ms: row.get(9)?,
        status: Status::Pending,
        decided_ms: row.get(11)?,
        auth_time_ms: row.get(12)?,
        acr: row.get(13)?,
        preview_hash: row.get(14)?,
        pages_total: row.get(15)?,
        pages: Vec::new(),
        excluded: Vec::new(),
    };
    Ok((decision, status, for_json, row.get(16)?, row.get(17)?))
}

/// A row read back: a status, a `for`, pages or excluded ids this host cannot read make the row
/// unusable, never a default that could match someone or include an item the person pulled out.
fn checked(found: Option<RawDecision>) -> Result<Option<Decision>, SharedError> {
    let Some((mut decision, status, for_json, pages, excluded)) = found else {
        return Ok(None);
    };
    let status =
        Status::parse(&status).ok_or_else(|| failed(&"a person decision has an unknown status"))?;
    if serde_json::from_str::<DecisionFor>(&for_json).is_err() {
        return Err(failed(&"a person decision's `for` cannot be read"));
    }
    decision.pages = serde_json::from_str(&pages)
        .map_err(|_| failed(&"a person decision's pages cannot be read"))?;
    decision.excluded = serde_json::from_str(&excluded)
        .map_err(|_| failed(&"a person decision's excluded items cannot be read"))?;
    decision.status = status;
    Ok(Some(decision))
}

/// The ids pulled out once the person posted `checked` from page `number` of `decision`: the
/// page's items at no checked position, beside what other pages pulled out. `None` when the page
/// was not rendered, a position names no item of it or is repeated, or more than
/// [`MAX_EXCLUDED`] would be pulled out.
fn excluded_after(decision: &Decision, number: u32, checked: &[usize]) -> Option<Vec<String>> {
    let seen = decision.seen(number)?;
    let mut kept = vec![false; seen.items.len()];
    for &position in checked {
        let slot = kept.get_mut(position)?;
        if *slot {
            return None;
        }
        *slot = true;
    }
    let mut excluded: Vec<String> = decision
        .excluded
        .iter()
        .filter(|id| !seen.items.contains(id))
        .cloned()
        .collect();
    excluded.extend(
        seen.items
            .iter()
            .zip(kept)
            .filter(|(_, kept)| !kept)
            .map(|(id, _)| id.clone()),
    );
    (excluded.len() <= MAX_EXCLUDED).then_some(excluded)
}

/// What a login row proves for a decision, when it is usable now: its `auth_time`, its `acr` and
/// the hash of the first page it rendered.
type Proof = (i64, String, String);

/// The proof of `login` for `decision` in the browser whose cookie hashes to `browser_hash`, when
/// it is a verified, live login of that decision.
fn usable_login(
    connection: &Connection,
    decision: &str,
    login: &str,
    browser_hash: &str,
    now_ms: i64,
) -> Result<Option<Proof>, SharedError> {
    type Row = (
        String,
        String,
        i64,
        String,
        Option<i64>,
        Option<String>,
        Option<String>,
    );
    let found: Option<Row> = connection
        .query_row(
            "SELECT decision, browser_hash, expires_ms, status, auth_time_ms, acr, preview_hash
             FROM logins WHERE id = ?1",
            params![login],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                ))
            },
        )
        .optional()
        .map_err(|error| shared_error(&error))?;
    let Some((of, hash, expires_ms, status, Some(auth_time_ms), Some(acr), Some(preview_hash))) =
        found
    else {
        return Ok(None);
    };
    let usable = !decision.is_empty()
        && of == decision
        && same_digest(&hash, browser_hash)
        && now_ms < expires_ms
        && LoginStatus::parse(&status) == Some(LoginStatus::Verified);
    Ok(usable.then_some((auth_time_ms, acr, preview_hash)))
}

fn json_text(value: &impl serde::Serialize) -> Result<String, SharedError> {
    serde_json::to_string(value).map_err(|error| failed(&error))
}

impl SqlitePerson {
    /// The store at `path`, waiting up to `lock_timeout_ms` for another process's write. Nothing
    /// is opened until the first use.
    pub(crate) fn new(path: &Path, lock_timeout_ms: u64) -> Self {
        Self {
            path: path.to_path_buf(),
            lock_timeout_ms,
            connection: Mutex::new(None),
        }
    }

    fn open_patiently(&self) -> Result<Connection, SharedError> {
        let deadline =
            std::time::Instant::now() + Duration::from_millis(self.lock_timeout_ms.max(1));
        loop {
            match self.open() {
                Ok(connection) => return Ok(connection),
                Err(error) => {
                    let text = error.to_string();
                    let busy =
                        text.contains("database is locked") || text.contains("database is busy");
                    if !busy {
                        return Err(failed(&error));
                    }
                    if std::time::Instant::now() >= deadline {
                        return Err(SharedError::Timeout { store: STORE });
                    }
                    std::thread::sleep(Duration::from_millis(5));
                }
            }
        }
    }

    fn open(&self) -> Result<Connection, WorkspaceError> {
        let path = &self.path;
        let unwritable = |error: &dyn std::fmt::Display| WorkspaceError::unwritable(path, error);
        if let Some(dir) = path.parent() {
            super::ensure_dir(dir)?;
        }
        super::ensure_private_file(path)?;
        let connection = Connection::open(path).map_err(|error| unwritable(&error))?;
        connection
            .busy_timeout(Duration::from_millis(self.lock_timeout_ms))
            .map_err(|error| unwritable(&error))?;
        let mode: String = connection
            .query_row("PRAGMA journal_mode = WAL", [], |row| row.get(0))
            .map_err(|error| unwritable(&error))?;
        if !mode.eq_ignore_ascii_case("wal") {
            return Err(unwritable(&format!(
                "the store could not enter WAL mode (it reports {mode})"
            )));
        }
        connection
            .execute_batch(
                "PRAGMA synchronous = NORMAL;
                 PRAGMA secure_delete = ON;
                 BEGIN IMMEDIATE;
                 CREATE TABLE IF NOT EXISTS decisions (
                     id TEXT PRIMARY KEY NOT NULL,
                     for_json TEXT NOT NULL,
                     command TEXT NOT NULL,
                     input_digest TEXT NOT NULL,
                     properties TEXT NOT NULL,
                     spaces TEXT NOT NULL,
                     chain TEXT NOT NULL,
                     trace_id TEXT,
                     created_ms INTEGER NOT NULL,
                     expires_ms INTEGER NOT NULL,
                     status TEXT NOT NULL,
                     decided_ms INTEGER,
                     auth_time_ms INTEGER,
                     acr TEXT,
                     preview_hash TEXT,
                     pages_total INTEGER,
                     pages TEXT NOT NULL DEFAULT '[]',
                     excluded TEXT NOT NULL DEFAULT '[]'
                 ) WITHOUT ROWID;
                 CREATE INDEX IF NOT EXISTS decisions_expires ON decisions (expires_ms);
                 CREATE TABLE IF NOT EXISTS logins (
                     id TEXT PRIMARY KEY NOT NULL,
                     decision TEXT NOT NULL,
                     verifier TEXT NOT NULL,
                     nonce TEXT NOT NULL,
                     browser_hash TEXT NOT NULL,
                     created_ms INTEGER NOT NULL,
                     expires_ms INTEGER NOT NULL,
                     status TEXT NOT NULL,
                     auth_time_ms INTEGER,
                     acr TEXT,
                     preview_hash TEXT,
                     preview_ok INTEGER NOT NULL DEFAULT 0,
                     namespace TEXT
                 ) WITHOUT ROWID;
                 CREATE INDEX IF NOT EXISTS logins_expires ON logins (expires_ms);
                 CREATE INDEX IF NOT EXISTS logins_decision ON logins (decision);
                 COMMIT;",
            )
            .map_err(|error| unwritable(&error))?;
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(|error| unwritable(&error))?;
        match version {
            0 => connection
                .execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION}"))
                .map_err(|error| unwritable(&error))?,
            // Version 1 had no pages and no list logins: its rows read as having rendered none.
            1 => connection
                .execute_batch(&format!(
                    "BEGIN IMMEDIATE;
                     ALTER TABLE decisions ADD COLUMN pages_total INTEGER;
                     ALTER TABLE decisions ADD COLUMN pages TEXT NOT NULL DEFAULT '[]';
                     ALTER TABLE decisions ADD COLUMN excluded TEXT NOT NULL DEFAULT '[]';
                     ALTER TABLE logins ADD COLUMN namespace TEXT;
                     PRAGMA user_version = {SCHEMA_VERSION};
                     COMMIT;"
                ))
                .map_err(|error| unwritable(&error))?,
            SCHEMA_VERSION => {}
            other => {
                return Err(unwritable(&format!(
                    "the store has schema version {other}; this host reads {SCHEMA_VERSION}"
                )));
            }
        }
        Ok(connection)
    }

    /// Run `work` on the open connection.
    fn with<T>(
        &self,
        work: impl FnOnce(&mut Connection) -> Result<T, SharedError>,
    ) -> Result<T, SharedError> {
        let mut guard = self
            .connection
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if guard.is_none() {
            *guard = Some(self.open_patiently()?);
        }
        let Some(connection) = guard.as_mut() else {
            return Err(failed(&"the store is not open"));
        };
        work(connection)
    }
}

/// Purge at most [`PURGE_BATCH`] rows of each table that expired more than an hour before
/// `now_ms`.
fn purge(transaction: &rusqlite::Transaction<'_>, now_ms: i64) -> Result<(), SharedError> {
    let before = now_ms.saturating_sub(KEEP_AFTER_EXPIRY_MS);
    for table in ["decisions", "logins"] {
        transaction
            .execute(
                &format!(
                    "DELETE FROM {table} WHERE id IN
                     (SELECT id FROM {table} WHERE expires_ms < ?1 LIMIT ?2)"
                ),
                params![before, PURGE_BATCH],
            )
            .map_err(|error| shared_error(&error))?;
    }
    Ok(())
}

/// Whether two hex digests are equal, in time independent of where they differ.
pub(crate) fn same_digest(a: &str, b: &str) -> bool {
    a.len() == b.len()
        && a.bytes()
            .zip(b.bytes())
            .fold(0u8, |difference, (x, y)| difference | (x ^ y))
            == 0
}

fn read_decision(connection: &Connection, id: &str) -> Result<Option<Decision>, SharedError> {
    let found = connection
        .query_row(
            &format!("SELECT {DECISION_COLUMNS} FROM decisions WHERE id = ?1"),
            params![id],
            decision_row,
        )
        .optional()
        .map_err(|error| shared_error(&error))?;
    checked(found)
}

impl PersonStore for SqlitePerson {
    fn create(&self, decision: &NewDecision, now_ms: i64) -> Result<(), SharedError> {
        let for_json = serde_json::to_string(&decision.for_).map_err(|error| failed(&error))?;
        let properties =
            serde_json::to_string(&decision.properties).map_err(|error| failed(&error))?;
        let chain = serde_json::to_string(&decision.chain).map_err(|error| failed(&error))?;
        let spaces = serde_json::to_string(&decision.spaces).map_err(|error| failed(&error))?;
        self.with(|connection| {
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(|error| shared_error(&error))?;
            let inserted = transaction
                .execute(
                    &format!(
                        "INSERT INTO decisions ({DECISION_COLUMNS}) VALUES
                         (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'pending', NULL, NULL, NULL, NULL,
                          NULL, '[]', '[]')
                         ON CONFLICT (id) DO NOTHING"
                    ),
                    params![
                        decision.id,
                        for_json,
                        decision.command,
                        decision.input_digest,
                        properties,
                        spaces,
                        chain,
                        decision.trace_id,
                        decision.created_ms,
                        decision.expires_ms,
                    ],
                )
                .map_err(|error| shared_error(&error))?;
            if inserted != 1 {
                // 128 random bits never collide; a collision is a broken random source.
                return Err(failed(&"a person decision id was already taken"));
            }
            purge(&transaction, now_ms)?;
            transaction.commit().map_err(|error| shared_error(&error))
        })
    }

    fn decision(&self, id: &str) -> Result<Option<Decision>, SharedError> {
        self.with(|connection| read_decision(connection, id))
    }

    fn start_login(&self, login: &NewLogin, now_ms: i64) -> Result<LoginStart, SharedError> {
        self.with(|connection| {
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(|error| shared_error(&error))?;
            let Some(decision) = read_decision(&transaction, &login.decision)? else {
                return Ok(LoginStart::NoDecision);
            };
            if decision.status != Status::Pending || !decision.live(now_ms) {
                return Ok(LoginStart::NoDecision);
            }
            let count: i64 = transaction
                .query_row(
                    "SELECT COUNT(*) FROM logins WHERE decision = ?1",
                    params![login.decision],
                    |row| row.get(0),
                )
                .map_err(|error| shared_error(&error))?;
            if count >= MAX_LOGINS_PER_DECISION {
                return Ok(LoginStart::TooMany);
            }
            let expires_ms = login.expires_ms.min(decision.expires_ms);
            let inserted = transaction
                .execute(
                    "INSERT INTO logins (id, decision, verifier, nonce, browser_hash, created_ms, expires_ms, status)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'started') ON CONFLICT (id) DO NOTHING",
                    params![
                        login.id,
                        login.decision,
                        login.verifier,
                        login.nonce,
                        login.browser_hash,
                        login.created_ms,
                        expires_ms,
                    ],
                )
                .map_err(|error| shared_error(&error))?;
            if inserted != 1 {
                return Err(failed(&"a login id was already taken"));
            }
            purge(&transaction, now_ms)?;
            transaction.commit().map_err(|error| shared_error(&error))?;
            Ok(LoginStart::Started)
        })
    }

    fn take_login(
        &self,
        id: &str,
        browser_hash: &str,
        now_ms: i64,
    ) -> Result<Option<Login>, SharedError> {
        self.with(|connection| {
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(|error| shared_error(&error))?;
            let held: Option<String> = transaction
                .query_row(
                    "SELECT browser_hash FROM logins WHERE id = ?1",
                    params![id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|error| shared_error(&error))?;
            if !held.is_some_and(|held| same_digest(&held, browser_hash)) {
                return Ok(None);
            }
            let taken = transaction
                .execute(
                    "UPDATE logins SET status = 'returning'
                     WHERE id = ?1 AND status = 'started' AND expires_ms > ?2",
                    params![id, now_ms],
                )
                .map_err(|error| shared_error(&error))?;
            if taken != 1 {
                return Ok(None);
            }
            let login = transaction
                .query_row(
                    "SELECT id, decision, verifier, nonce, browser_hash, created_ms, expires_ms, status, namespace
                     FROM logins WHERE id = ?1",
                    params![id],
                    |row| {
                        let status: String = row.get(7)?;
                        Ok(Login {
                            id: row.get(0)?,
                            decision: row.get(1)?,
                            namespace: row.get(8)?,
                            verifier: row.get(2)?,
                            nonce: row.get(3)?,
                            created_ms: row.get(5)?,
                            status: LoginStatus::parse(&status).unwrap_or(LoginStatus::Failed),
                        })
                    },
                )
                .map_err(|error| shared_error(&error))?;
            transaction.commit().map_err(|error| shared_error(&error))?;
            Ok(Some(login))
        })
    }

    fn finish_login(&self, id: &str, verified: Option<&Verified>) -> Result<bool, SharedError> {
        self.with(|connection| {
            let changed = match verified {
                Some(verified) => connection.execute(
                    "UPDATE logins SET status = 'verified', auth_time_ms = ?2, acr = ?3,
                         preview_hash = ?4, preview_ok = ?5
                     WHERE id = ?1 AND status = 'returning'",
                    params![
                        id,
                        verified.auth_time_ms,
                        verified.acr,
                        verified.preview_hash,
                        i64::from(verified.preview_ok),
                    ],
                ),
                None => connection.execute(
                    "UPDATE logins SET status = 'failed' WHERE id = ?1 AND status = 'returning'",
                    params![id],
                ),
            }
            .map_err(|error| shared_error(&error))?;
            Ok(changed == 1)
        })
    }

    fn start_list_login(&self, login: &NewListLogin, now_ms: i64) -> Result<(), SharedError> {
        self.with(|connection| {
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(|error| shared_error(&error))?;
            let inserted = transaction
                .execute(
                    "INSERT INTO logins (id, decision, verifier, nonce, browser_hash, created_ms, expires_ms, status, namespace)
                     VALUES (?1, '', ?2, ?3, ?4, ?5, ?6, 'started', ?7) ON CONFLICT (id) DO NOTHING",
                    params![
                        login.id,
                        login.verifier,
                        login.nonce,
                        login.browser_hash,
                        login.created_ms,
                        login.expires_ms,
                        login.namespace,
                    ],
                )
                .map_err(|error| shared_error(&error))?;
            if inserted != 1 {
                return Err(failed(&"a login id was already taken"));
            }
            purge(&transaction, now_ms)?;
            transaction.commit().map_err(|error| shared_error(&error))
        })
    }

    fn verified_login(
        &self,
        decision: &str,
        login: &str,
        browser_hash: &str,
        now_ms: i64,
    ) -> Result<bool, SharedError> {
        self.with(|connection| {
            if usable_login(connection, decision, login, browser_hash, now_ms)?.is_none() {
                return Ok(false);
            }
            Ok(
                read_decision(connection, decision)?.is_some_and(|decision| {
                    decision.status == Status::Pending && decision.live(now_ms)
                }),
            )
        })
    }

    fn render(&self, render: &Render, now_ms: i64) -> Result<Rendered, SharedError> {
        self.with(|connection| {
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(|error| shared_error(&error))?;
            let Some(mut decision) = read_decision(&transaction, &render.decision)? else {
                return Ok(Rendered::Gone);
            };
            if decision.status != Status::Pending || !decision.live(now_ms) {
                return Ok(Rendered::Gone);
            }
            let changed = decision
                .pages_total
                .is_some_and(|total| total != render.pages)
                || decision
                    .seen(render.page)
                    .is_some_and(|seen| !same_digest(&seen.hash, &render.hash));
            if changed {
                transaction
                    .execute(
                        "UPDATE decisions SET pages_total = NULL, pages = '[]', excluded = '[]'
                         WHERE id = ?1",
                        params![render.decision],
                    )
                    .map_err(|error| shared_error(&error))?;
                transaction.commit().map_err(|error| shared_error(&error))?;
                return Ok(Rendered::Changed);
            }
            let elsewhere = decision
                .pages
                .iter()
                .filter(|seen| seen.page != render.page)
                .any(|seen| seen.items.iter().any(|id| render.items.contains(id)));
            if elsewhere {
                return Ok(Rendered::Duplicate);
            }
            decision.pages.retain(|seen| seen.page != render.page);
            decision.pages.push(SeenPage {
                page: render.page,
                hash: render.hash.clone(),
                items: render.items.clone(),
            });
            decision.pages.sort_by_key(|seen| seen.page);
            decision.pages_total = Some(render.pages);
            // The lifetime runs from the last page shown, never past a day after it began.
            let cap = decision.created_ms.saturating_add(MAX_DECISION_LIFE_MS);
            decision.expires_ms = decision
                .expires_ms
                .max(now_ms.saturating_add(render.ttl_ms).min(cap));
            transaction
                .execute(
                    "UPDATE decisions SET pages_total = ?2, pages = ?3, expires_ms = ?4 WHERE id = ?1",
                    params![
                        render.decision,
                        render.pages,
                        json_text(&decision.pages)?,
                        decision.expires_ms
                    ],
                )
                .map_err(|error| shared_error(&error))?;
            transaction
                .execute(
                    "UPDATE logins SET expires_ms = MAX(expires_ms, ?3) WHERE id = ?1 AND decision = ?2",
                    params![render.login, render.decision, decision.expires_ms],
                )
                .map_err(|error| shared_error(&error))?;
            transaction.commit().map_err(|error| shared_error(&error))?;
            Ok(Rendered::Recorded(Box::new(decision)))
        })
    }

    fn decide(
        &self,
        decision: &str,
        login: &str,
        browser_hash: &str,
        choice: &Choice,
        now_ms: i64,
    ) -> Result<Decided, SharedError> {
        self.with(|connection| {
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(|error| shared_error(&error))?;
            let Some((auth_time_ms, acr, first_hash)) =
                usable_login(&transaction, decision, login, browser_hash, now_ms)?
            else {
                return Ok(Decided::Refused);
            };
            let Some(row) = read_decision(&transaction, decision)? else {
                return Ok(Decided::Refused);
            };
            if row.status != Status::Pending || !row.live(now_ms) {
                return Ok(Decided::Refused);
            }
            let total = row.pages_total.unwrap_or(0);
            let (status, excluded, preview_hash) = match choice.action {
                Action::Next | Action::Previous => {
                    let target = if choice.action == Action::Next {
                        choice.page.checked_add(1)
                    } else {
                        choice.page.checked_sub(1)
                    };
                    let Some(target) = target.filter(|target| (1..=total).contains(target)) else {
                        return Ok(Decided::Changed);
                    };
                    let Some(excluded) = excluded_after(&row, choice.page, &choice.checked) else {
                        return Ok(Decided::Changed);
                    };
                    transaction
                        .execute(
                            "UPDATE decisions SET excluded = ?2 WHERE id = ?1",
                            params![decision, json_text(&excluded)?],
                        )
                        .map_err(|error| shared_error(&error))?;
                    transaction.commit().map_err(|error| shared_error(&error))?;
                    return Ok(Decided::Moved(target));
                }
                Action::Approve => {
                    // Every page shown before Approve (section 2), and the choices of the page
                    // posted from, final.
                    if !row.every_page_seen() {
                        return Ok(Decided::Changed);
                    }
                    let Some(excluded) = excluded_after(&row, choice.page, &choice.checked) else {
                        return Ok(Decided::Changed);
                    };
                    let Some(seen) = row.seen(choice.page) else {
                        return Ok(Decided::Changed);
                    };
                    (Status::Approved, excluded, seen.hash.clone())
                }
                Action::Decline => {
                    // Decline is always offered: no page need have been shown, and nothing runs.
                    let hash = row
                        .seen(choice.page)
                        .map_or(first_hash, |seen| seen.hash.clone());
                    (Status::Declined, row.excluded.clone(), hash)
                }
            };
            let spent = transaction
                .execute(
                    "UPDATE logins SET status = ?2 WHERE id = ?1 AND status = 'verified'",
                    params![login, LoginStatus::Used.as_str()],
                )
                .map_err(|error| shared_error(&error))?;
            let recorded = transaction
                .execute(
                    "UPDATE decisions SET status = ?2, decided_ms = ?3, auth_time_ms = ?4, acr = ?5,
                         preview_hash = ?6, excluded = ?7
                     WHERE id = ?1 AND status = 'pending' AND expires_ms > ?3",
                    params![
                        decision,
                        status.as_str(),
                        now_ms,
                        auth_time_ms,
                        acr,
                        preview_hash,
                        json_text(&excluded)?
                    ],
                )
                .map_err(|error| shared_error(&error))?;
            if spent != 1 || recorded != 1 {
                // Dropping the transaction rolls both back: nothing is recorded.
                return Ok(Decided::Refused);
            }
            let decided = read_decision(&transaction, decision)?;
            transaction.commit().map_err(|error| shared_error(&error))?;
            Ok(decided.map_or(Decided::Refused, |decided| {
                Decided::Recorded(Box::new(decided))
            }))
        })
    }

    fn pending_for(
        &self,
        namespace: &str,
        subject: &str,
        now_ms: i64,
    ) -> Result<Vec<Decision>, SharedError> {
        self.with(|connection| {
            let mut statement = connection
                .prepare(&format!(
                    "SELECT {DECISION_COLUMNS} FROM decisions
                     WHERE status = 'pending' AND expires_ms > ?1 ORDER BY created_ms, id"
                ))
                .map_err(|error| shared_error(&error))?;
            let rows = statement
                .query_map(params![now_ms], decision_row)
                .map_err(|error| shared_error(&error))?;
            let mut found = Vec::new();
            for row in rows {
                // A row this host cannot read is no one's to list.
                let Ok(Some(decision)) = checked(Some(row.map_err(|error| shared_error(&error))?))
                else {
                    continue;
                };
                if decision.for_.namespace == namespace && decision.for_.subject == subject {
                    found.push(decision);
                }
            }
            Ok(found)
        })
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    fn store(dir: &Path) -> SqlitePerson {
        SqlitePerson::new(&dir.join("shared").join("person.sqlite3"), 1_000)
    }

    fn decision(id: &str, now: i64) -> NewDecision {
        NewDecision {
            id: id.to_owned(),
            for_: DecisionFor {
                actor: ActorRef {
                    kind: ActorKind::Agent,
                    id: Some("corp/client".into()),
                    on_behalf_of: Some("corp/ada".into()),
                },
                client_id: Some("client".into()),
                issuer: Some("as".into()),
                namespace: "corp".into(),
                subject: "ada".into(),
            },
            command: "gate-approve".into(),
            input_digest: "d".repeat(43),
            properties: serde_json::from_value(serde_json::json!({ "proposal": "p-1" })).unwrap(),
            spaces: vec!["main".into()],
            chain: Vec::new(),
            trace_id: Some("t".into()),
            created_ms: now,
            expires_ms: now + 600_000,
        }
    }

    fn login(id: &str, decision: &str, now: i64) -> NewLogin {
        NewLogin {
            id: id.to_owned(),
            decision: decision.to_owned(),
            verifier: "v".into(),
            nonce: "n".into(),
            browser_hash: "ab".repeat(32),
            created_ms: now,
            expires_ms: now + 600_000,
        }
    }

    fn choice(action: Action) -> Choice {
        Choice {
            page: 1,
            action,
            checked: Vec::new(),
        }
    }

    const APPROVE: Action = Action::Approve;
    const DECLINE: Action = Action::Decline;

    fn rendered(store: &SqlitePerson, id: &str, login: &str, page: u32, items: &[&str], now: i64) {
        rendered_of(store, id, login, page, 2, items, now);
    }

    fn rendered_of(
        store: &SqlitePerson,
        id: &str,
        login: &str,
        page: u32,
        pages: u32,
        items: &[&str],
        now: i64,
    ) -> Rendered {
        store
            .render(
                &Render {
                    decision: id.to_owned(),
                    login: login.to_owned(),
                    page,
                    pages,
                    hash: format!("sha256:{}", format!("{page}").repeat(64)),
                    items: items.iter().map(|&id| id.to_owned()).collect(),
                    ttl_ms: 600_000,
                },
                now,
            )
            .unwrap()
    }

    fn verified(ok: bool) -> Verified {
        Verified {
            auth_time_ms: 1,
            acr: "phr".into(),
            preview_hash: format!("sha256:{}", "0".repeat(64)),
            preview_ok: ok,
        }
    }

    #[test]
    fn a_login_is_taken_once_and_decides_once() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(dir.path());
        let now = 1_000_000;
        store.create(&decision("d1", now), now).unwrap();
        assert_eq!(
            store.start_login(&login("l1", "d1", now), now).unwrap(),
            LoginStart::Started
        );
        // Deciding before the login returned records nothing.
        assert!(matches!(
            store
                .decide("d1", "l1", &"ab".repeat(32), &choice(APPROVE), now)
                .unwrap(),
            Decided::Refused
        ));
        // Without its browser's cookie the login is not taken, and stays to be taken.
        assert!(
            store
                .take_login("l1", &"cd".repeat(32), now)
                .unwrap()
                .is_none()
        );
        assert!(
            store
                .take_login("l1", &"ab".repeat(32), now)
                .unwrap()
                .is_some()
        );
        // A replayed return finds nothing.
        assert!(
            store
                .take_login("l1", &"ab".repeat(32), now)
                .unwrap()
                .is_none()
        );
        assert!(store.finish_login("l1", Some(&verified(true))).unwrap());
        // Another browser, another decision, or after the login's expiry: nothing.
        assert!(matches!(
            store
                .decide("d1", "l1", &"cd".repeat(32), &choice(APPROVE), now)
                .unwrap(),
            Decided::Refused
        ));
        assert!(matches!(
            store
                .decide("d2", "l1", &"ab".repeat(32), &choice(APPROVE), now)
                .unwrap(),
            Decided::Refused
        ));
        assert!(matches!(
            store
                .decide(
                    "d1",
                    "l1",
                    &"ab".repeat(32),
                    &choice(APPROVE),
                    now + 600_000
                )
                .unwrap(),
            Decided::Refused
        ));
        // Approve needs every page rendered.
        assert!(matches!(
            store
                .decide("d1", "l1", &"ab".repeat(32), &choice(APPROVE), now)
                .unwrap(),
            Decided::Changed
        ));
        rendered_of(&store, "d1", "l1", 1, 1, &[], now);
        let Decided::Recorded(decided) = store
            .decide("d1", "l1", &"ab".repeat(32), &choice(APPROVE), now)
            .unwrap()
        else {
            panic!("not recorded");
        };
        assert_eq!(decided.status, Status::Approved);
        // Once: neither the login nor the decision decides again.
        assert!(matches!(
            store
                .decide("d1", "l1", &"ab".repeat(32), &choice(DECLINE), now)
                .unwrap(),
            Decided::Refused
        ));
        let stored = store.decision("d1").unwrap().unwrap();
        assert_eq!(stored.status, Status::Approved);
        // The stored decision reads back as `person-decision.v2`: its members and no more.
        let v2 = stored.to_v2();
        let mut members: Vec<&String> = v2.as_object().unwrap().keys().collect();
        members.sort();
        assert_eq!(
            members,
            [
                "acr",
                "authTime",
                "command",
                "createdAt",
                "decidedAt",
                "excluded",
                "expires",
                "for",
                "id",
                "inputDigest",
                "level",
                "pages",
                "previewHash",
                "properties",
                "status",
                "version"
            ]
        );
        assert_eq!(v2["level"], "verified");
        assert_eq!(v2["status"], "approved");
        assert_eq!(v2["for"]["clientId"], "client");
        assert_eq!(v2["properties"], serde_json::json!({ "proposal": "p-1" }));
        let pending = {
            store.create(&decision("d9", now), now).unwrap();
            store.decision("d9").unwrap().unwrap().to_v2()
        };
        for member in ["decidedAt", "level", "authTime", "acr", "previewHash"] {
            assert!(pending[member].is_null(), "{member}: {pending}");
        }
    }

    #[test]
    fn an_approval_needs_a_shown_preview_and_a_live_decision() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(dir.path());
        let now = 5_000_000;
        store.create(&decision("d1", now), now).unwrap();
        store.start_login(&login("l1", "d1", now), now).unwrap();
        store
            .take_login("l1", &"ab".repeat(32), now)
            .unwrap()
            .unwrap();
        store.finish_login("l1", Some(&verified(false))).unwrap();
        // No page was shown: nothing to approve.
        assert!(matches!(
            store
                .decide("d1", "l1", &"ab".repeat(32), &choice(APPROVE), now)
                .unwrap(),
            Decided::Changed
        ));
        // Declining needs no preview.
        let Decided::Recorded(decided) = store
            .decide("d1", "l1", &"ab".repeat(32), &choice(DECLINE), now)
            .unwrap()
        else {
            panic!("not recorded");
        };
        assert_eq!(decided.status, Status::Declined);
        // An expired decision starts no login.
        store.create(&decision("d2", now), now).unwrap();
        assert_eq!(
            store
                .start_login(&login("l2", "d2", now), now + 600_000)
                .unwrap(),
            LoginStart::NoDecision
        );
        assert_eq!(
            store.start_login(&login("l3", "nope", now), now).unwrap(),
            LoginStart::NoDecision
        );
    }

    #[test]
    fn one_decision_starts_a_bounded_number_of_logins_and_rows_are_purged() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(dir.path());
        let now = 9_000_000;
        store.create(&decision("d1", now), now).unwrap();
        for index in 0..MAX_LOGINS_PER_DECISION {
            assert_eq!(
                store
                    .start_login(&login(&format!("l{index}"), "d1", now), now)
                    .unwrap(),
                LoginStart::Started
            );
        }
        assert_eq!(
            store.start_login(&login("lx", "d1", now), now).unwrap(),
            LoginStart::TooMany
        );
        // An hour after expiry the next write purges the rows.
        let later = now + 600_000 + KEEP_AFTER_EXPIRY_MS + 1;
        store.create(&decision("d2", later), later).unwrap();
        assert!(store.decision("d1").unwrap().is_none());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(dir.path().join("shared").join("person.sqlite3"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
    }

    fn ready(store: &SqlitePerson, id: &str, login_id: &str, now: i64) {
        store.create(&decision(id, now), now).unwrap();
        store.start_login(&login(login_id, id, now), now).unwrap();
        store
            .take_login(login_id, &"ab".repeat(32), now)
            .unwrap()
            .unwrap();
        store.finish_login(login_id, Some(&verified(true))).unwrap();
    }

    fn post(
        store: &SqlitePerson,
        page: u32,
        action: Action,
        checked: &[usize],
        now: i64,
    ) -> Decided {
        store
            .decide(
                "d1",
                "l1",
                &"ab".repeat(32),
                &Choice {
                    page,
                    action,
                    checked: checked.to_vec(),
                },
                now,
            )
            .unwrap()
    }

    #[test]
    fn pages_are_kept_and_items_pulled_out_by_position() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(dir.path());
        let now = 7_000_000;
        ready(&store, "d1", "l1", now);
        assert!(
            store
                .verified_login("d1", "l1", &"ab".repeat(32), now)
                .unwrap()
        );
        assert!(
            !store
                .verified_login("d1", "l1", &"cd".repeat(32), now)
                .unwrap()
        );
        rendered(&store, "d1", "l1", 1, &["a", "b", "c"], now);
        // Not every page seen: no approval, and nothing recorded.
        assert!(matches!(
            post(&store, 1, APPROVE, &[0, 1, 2], now),
            Decided::Changed
        ));
        // A position past the page, or repeated: refused, nothing kept.
        assert!(matches!(
            post(&store, 1, Action::Next, &[3], now),
            Decided::Changed
        ));
        assert!(matches!(
            post(&store, 1, Action::Next, &[0, 0], now),
            Decided::Changed
        ));
        // No page before the first.
        assert!(matches!(
            post(&store, 1, Action::Previous, &[], now),
            Decided::Changed
        ));
        // Next keeps the page's choices: `b` unchecked.
        assert!(matches!(
            post(&store, 1, Action::Next, &[0, 2], now),
            Decided::Moved(2)
        ));
        assert_eq!(store.decision("d1").unwrap().unwrap().excluded, ["b"]);
        // No page past the last; an id of another page cannot be shown.
        assert!(matches!(
            rendered_of(&store, "d1", "l1", 2, 2, &["a"], now),
            Rendered::Duplicate
        ));
        rendered(&store, "d1", "l1", 2, &["d"], now);
        assert!(matches!(
            post(&store, 2, Action::Next, &[0], now),
            Decided::Changed
        ));
        // Approve from page 2 with `d` unchecked: final, beside page 1's.
        let Decided::Recorded(decided) = post(&store, 2, APPROVE, &[], now) else {
            panic!("not recorded");
        };
        assert_eq!(decided.status, Status::Approved);
        assert_eq!(decided.excluded, ["b", "d"]);
        assert_eq!(
            decided.preview_hash.as_deref(),
            Some(&*format!("sha256:{}", "2".repeat(64)))
        );
        let v2 = decided.to_v2();
        assert_eq!(v2["excluded"], serde_json::json!(["b", "d"]));
        assert_eq!(v2["pages"][0]["items"], serde_json::json!(["a", "b", "c"]));
        assert_eq!(v2["pages"][1]["page"], 2);
    }

    #[test]
    fn a_changed_review_clears_the_pages_and_the_choices() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(dir.path());
        let now = 8_000_000;
        ready(&store, "d1", "l1", now);
        rendered(&store, "d1", "l1", 1, &["a", "b"], now);
        assert!(matches!(
            post(&store, 1, Action::Next, &[0], now),
            Decided::Moved(2)
        ));
        // Another number of pages: cleared.
        assert!(matches!(
            rendered_of(&store, "d1", "l1", 2, 3, &["c"], now),
            Rendered::Changed
        ));
        let cleared = store.decision("d1").unwrap().unwrap();
        assert!(cleared.pages.is_empty() && cleared.excluded.is_empty());
        assert_eq!(cleared.pages_total, None);
        // A page seen before with another hash: cleared too.
        rendered(&store, "d1", "l1", 1, &["a", "b"], now);
        let changed = store
            .render(
                &Render {
                    decision: "d1".into(),
                    login: "l1".into(),
                    page: 1,
                    pages: 2,
                    hash: format!("sha256:{}", "f".repeat(64)),
                    items: vec!["a".into(), "b".into()],
                    ttl_ms: 600_000,
                },
                now,
            )
            .unwrap();
        assert!(matches!(changed, Rendered::Changed));
        assert!(store.decision("d1").unwrap().unwrap().pages.is_empty());
    }

    #[test]
    fn each_render_moves_the_expiry_never_past_a_day() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(dir.path());
        let now = 10_000_000;
        ready(&store, "d1", "l1", now);
        let later = now + 500_000;
        let Rendered::Recorded(moved) = rendered_of(&store, "d1", "l1", 1, 1, &[], later) else {
            panic!("not recorded");
        };
        assert_eq!(moved.expires_ms, later + 600_000);
        // The login moved with it.
        assert!(
            store
                .verified_login("d1", "l1", &"ab".repeat(32), later + 599_000)
                .unwrap()
        );
        // Rendered again and again, it never lives past a day from its beginning.
        let mut at = later;
        while at < now + MAX_DECISION_LIFE_MS {
            at += 590_000;
            if let Rendered::Recorded(decision) = rendered_of(&store, "d1", "l1", 1, 1, &[], at) {
                assert!(decision.expires_ms <= now + MAX_DECISION_LIFE_MS);
            }
        }
        assert_eq!(
            store.decision("d1").unwrap().unwrap().expires_ms,
            now + MAX_DECISION_LIFE_MS
        );
        assert!(matches!(
            rendered_of(&store, "d1", "l1", 1, 1, &[], now + MAX_DECISION_LIFE_MS),
            Rendered::Gone
        ));
    }

    #[test]
    fn the_pending_list_is_the_persons_own_live_decisions() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(dir.path());
        let now = 11_000_000;
        store.create(&decision("d1", now), now).unwrap();
        let mut other = decision("d2", now + 1);
        other.for_.subject = "bo".into();
        store.create(&other, now).unwrap();
        let mut late = decision("d3", now + 2);
        late.expires_ms = now + 10;
        store.create(&late, now).unwrap();
        let ids = |at: i64| -> Vec<String> {
            store
                .pending_for("corp", "ada", at)
                .unwrap()
                .into_iter()
                .map(|decision| decision.id)
                .collect()
        };
        assert_eq!(ids(now), ["d1", "d3"]);
        assert_eq!(ids(now + 10), ["d1"]);
        assert!(store.pending_for("else", "ada", now).unwrap().is_empty());
        // A list login has no decision: it decides nothing.
        store
            .start_list_login(
                &NewListLogin {
                    id: "ll".into(),
                    namespace: "corp".into(),
                    verifier: "v".into(),
                    nonce: "n".into(),
                    browser_hash: "ab".repeat(32),
                    created_ms: now,
                    expires_ms: now + 600_000,
                },
                now,
            )
            .unwrap();
        let taken = store
            .take_login("ll", &"ab".repeat(32), now)
            .unwrap()
            .unwrap();
        assert_eq!(taken.decision, "");
        assert_eq!(taken.namespace.as_deref(), Some("corp"));
        store.finish_login("ll", Some(&verified(true))).unwrap();
        assert!(matches!(
            store
                .decide("", "ll", &"ab".repeat(32), &choice(DECLINE), now)
                .unwrap(),
            Decided::Refused
        ));
    }

    #[test]
    fn a_version_1_store_is_migrated_in_place() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("shared").join("person.sqlite3");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        {
            let connection = Connection::open(&path).unwrap();
            connection
                .execute_batch(
                    "CREATE TABLE decisions (id TEXT PRIMARY KEY NOT NULL, for_json TEXT NOT NULL,
                         command TEXT NOT NULL, input_digest TEXT NOT NULL, properties TEXT NOT NULL,
                         spaces TEXT NOT NULL, chain TEXT NOT NULL, trace_id TEXT,
                         created_ms INTEGER NOT NULL, expires_ms INTEGER NOT NULL, status TEXT NOT NULL,
                         decided_ms INTEGER, auth_time_ms INTEGER, acr TEXT, preview_hash TEXT) WITHOUT ROWID;
                     CREATE TABLE logins (id TEXT PRIMARY KEY NOT NULL, decision TEXT NOT NULL,
                         verifier TEXT NOT NULL, nonce TEXT NOT NULL, browser_hash TEXT NOT NULL,
                         created_ms INTEGER NOT NULL, expires_ms INTEGER NOT NULL, status TEXT NOT NULL,
                         auth_time_ms INTEGER, acr TEXT, preview_hash TEXT,
                         preview_ok INTEGER NOT NULL DEFAULT 0) WITHOUT ROWID;
                     PRAGMA user_version = 1;",
                )
                .unwrap();
            let for_json = serde_json::to_string(&decision("d1", 0).for_).unwrap();
            connection
                .execute(
                    "INSERT INTO decisions VALUES ('d1', ?1, 'gate-approve', 'x', '{}', '[]', '[]',
                         NULL, 1, 2, 'pending', NULL, NULL, NULL, NULL)",
                    params![for_json],
                )
                .unwrap();
        }
        let store = SqlitePerson::new(&path, 1_000);
        let read = store.decision("d1").unwrap().unwrap();
        assert!(read.pages.is_empty() && read.excluded.is_empty());
        assert_eq!(read.pages_total, None);
        let version: i64 = Connection::open(&path)
            .unwrap()
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
    }
}

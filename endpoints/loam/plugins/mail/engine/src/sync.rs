//! Sync (the specification's section 5): brings an account's mail from its
//! provider into the store, and resumes after any stop.
//!
//! - **The unit of progress is a batch.** Each batch of headers or bytes is
//!   recorded in one transaction, and the mailbox's cursor moves only once
//!   every listed message has been tried. After a stop, a mailbox without a
//!   cursor is listed again and only what it does not yet show is fetched;
//!   one with a cursor asks the provider what changed since.
//! - **Mailboxes take turns, a batch each** (5.3), the inbox and the sent
//!   mailbox first, so a mailbox of 283 000 messages cannot hold back the
//!   inbox. Within a mailbox, newest first, and headers before bodies.
//! - **A listed message that does not arrive** counts a try, at most one an
//!   hour; after three it no longer holds the mailbox back (5.4). It is tried
//!   again each pass until then, weekly after, and whenever the mailbox is
//!   listed in full.
//! - **Bodies** of messages of 1 MiB or less are fetched whole, except in the
//!   junk and trash mailboxes (M20, 5.3).
//! - **A damaged file** a read reported is fetched again; storing the same
//!   bytes repairs it (4.1).
//! - **A dropped connection** is opened again with backoff, and the step
//!   that failed is tried again. A batch that keeps failing on a connection
//!   that otherwise works is asked for a message at a time, and a message
//!   that still fails is counted as not returned, so one message the engine
//!   cannot read never holds back a mailbox.

use std::collections::{HashMap, HashSet, VecDeque};
use std::time::Duration;

use afd::Clock;

use crate::engine::Engine;
use crate::provider::{Connector, Gone, Provider, ProviderError, Since};
use crate::store::{
    AccountRow, MailboxId, MailboxRow, MessageId, PartSeen, Place, Refetch, Refetched, Role,
    StoreError, Tried, UNRETURNED_AFTER_TRIES,
};

/// How sync sizes its work.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Options {
    /// Headers asked for in one request (5.2).
    pub header_batch: usize,
    /// Whole messages asked for in one request, at most.
    pub body_batch: usize,
    /// The bytes of whole messages asked for in one request, at most; a
    /// single larger message is still asked for alone.
    pub body_batch_bytes: u64,
    /// The largest message fetched whole (M20).
    pub whole_limit: u64,
    /// How many times in a row a connection is opened again before the
    /// pass gives up.
    pub retries: u32,
    /// The wait before the first new connection; it doubles each time.
    pub backoff: Duration,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            header_batch: 250,
            body_batch: 50,
            body_batch_bytes: 8 * 1024 * 1024,
            whole_limit: WHOLE_LIMIT,
            retries: 5,
            backoff: Duration::from_secs(1),
        }
    }
}

/// The largest message fetched whole on IMAP: 1 MiB (M20).
pub const WHOLE_LIMIT: u64 = 1024 * 1024;

/// A listed message that did not arrive counts at most one try an hour.
const TRY_SPACING_MS: i64 = 60 * 60 * 1000;

/// One that is unreturned is tried again weekly.
const RETRY_UNRETURNED_MS: i64 = 7 * 24 * 60 * 60 * 1000;

/// A mailbox whose generation changes more often than this in one pass is
/// left with an error until the next.
const MOST_RESTARTS: u32 = 3;

/// After this many failures of one batch, it is asked for a message at a
/// time.
const SPLIT_AFTER: u32 = 2;

/// After this many failures asking for one message, it is passed over.
const PASS_OVER_AFTER: u32 = 4;

/// After this many failed requests in a row across the account, on
/// connections that could be opened, the pass gives up: the provider is not
/// answering, whatever is asked.
const MOST_BATCH_FAILURES: u32 = 24;

/// Why a pass stopped.
#[derive(Debug)]
pub enum SyncError {
    /// The provider refused the sign-in, or there is none.
    Provider(ProviderError),
    /// The store refused.
    Store(StoreError),
}

impl std::fmt::Display for SyncError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Provider(error) => error.fmt(f),
            Self::Store(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for SyncError {}

impl From<StoreError> for SyncError {
    fn from(error: StoreError) -> Self {
        Self::Store(error)
    }
}

/// What a pass did in one mailbox. Counts only: nothing from a message.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MailboxReport {
    /// The mailbox.
    pub mailbox: i64,
    /// Its role.
    pub role: &'static str,
    /// Messages it newly shows.
    pub added: u64,
    /// Messages whose flags changed.
    pub changed: u64,
    /// Messages that left it.
    pub removed: u64,
    /// Listed messages that did not arrive, with a try counted.
    pub not_returned: u64,
    /// Messages now held whole.
    pub bodies: u64,
    /// Damaged files made whole again.
    pub repaired: u64,
    /// Bodies set aside because other bytes are held for them.
    pub set_aside: u64,
    /// Whether it was listed in full this pass, rather than asked for changes.
    pub listed_in_full: bool,
    /// Why the pass in this mailbox stopped short, in the engine's words.
    pub error: Option<String>,
}

/// What a pass did in an account.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AccountReport {
    /// The account.
    pub account: i64,
    /// Each mailbox it synced, in the order they took turns.
    pub mailboxes: Vec<MailboxReport>,
}

/// Where a mailbox's pass has come to.
#[derive(Debug)]
enum Stage {
    /// It is to be opened and listed, or asked what changed.
    Start,
    /// Headers to fetch, newest first; the cursor to store once they are in.
    Headers {
        queue: VecDeque<String>,
        cursor: String,
    },
    /// Whole messages to fetch, newest first.
    Bodies {
        queue: VecDeque<(String, MessageId, u64)>,
    },
    /// Damaged files to fetch again.
    Repairs { wanted: Vec<Refetch> },
    /// Nothing more this pass.
    Done,
}

/// One mailbox's pass.
#[derive(Debug)]
struct Plan {
    row: MailboxRow,
    validity: String,
    stage: Stage,
    tried: HashMap<String, Tried>,
    restarts: u32,
    /// Failures of the batch in hand, on connections that otherwise work.
    batch_failures: u32,
    /// Failures of this mailbox's steps that a new connection did not mend.
    open_failures: u32,
    /// How many more requests ask for a single message, after a batch that
    /// kept failing.
    single: usize,
    report: MailboxReport,
}

impl Plan {
    /// How many messages the next request may ask for.
    fn batch(&self, size: usize) -> usize {
        if self.single > 0 { 1 } else { size.max(1) }
    }
}

/// Runs one pass over `account`: every mailbox the provider lists, until
/// each has fetched what it can this pass. Reports progress to `progress`
/// after each batch.
///
/// # Errors
/// [`SyncError::Provider`] when the provider refuses the sign-in, or cannot
/// be reached after [`Options::retries`] new connections, and
/// [`SyncError::Store`] when the store refuses. What was recorded before the
/// error stays, and the next pass carries on from it.
pub async fn sync_account(
    engine: &Engine,
    connector: &dyn Connector,
    account: &AccountRow,
    options: &Options,
    clock: &dyn Clock,
    progress: &(dyn Fn(&str) + Sync),
) -> Result<AccountReport, SyncError> {
    let mut connection = Connection {
        connector,
        account,
        options,
        provider: None,
        open: None,
        failures: 0,
        batch_failures: 0,
    };
    let plans = mailboxes(engine, &mut connection, clock).await?;
    let mut plans: Vec<Plan> = plans;
    loop {
        let mut working = false;
        for plan in &mut plans {
            if matches!(plan.stage, Stage::Done) {
                continue;
            }
            working = true;
            let step = step(engine, &mut connection, plan, options, clock).await;
            match step {
                Ok(()) => {
                    connection.failures = 0;
                    connection.batch_failures = 0;
                    plan.batch_failures = 0;
                    plan.open_failures = 0;
                    progress(&describe(plan));
                }
                Err(Failure::Batch(error)) => {
                    // The connection worked and the request failed. A new
                    // connection is opened without counting toward giving up
                    // the pass, which only a connection that cannot be made
                    // does; a request that keeps failing is narrowed instead.
                    connection.drop_connection();
                    connection.batch_failures += 1;
                    // A short wait, so that a provider that accepts sign-ins
                    // and fails every request is not signed in to at once.
                    tokio::time::sleep(options.backoff).await;
                    if connection.batch_failures > MOST_BATCH_FAILURES {
                        let message = error.to_string();
                        engine.with_store(|store| store.set_error(plan.row.id, &message))?;
                        connection.close().await;
                        return Err(SyncError::Provider(error));
                    }
                    plan.batch_failures += 1;
                    if plan.single == 0 && plan.batch_failures >= SPLIT_AFTER {
                        plan.single = match plan.stage {
                            Stage::Bodies { .. } => options.body_batch,
                            _ => options.header_batch,
                        };
                        plan.batch_failures = 0;
                    } else if plan.single > 0 && plan.batch_failures >= PASS_OVER_AFTER {
                        pass_over(engine, plan, clock)?;
                        plan.batch_failures = 0;
                    }
                }
                Err(Failure::Again(error)) => {
                    // A mailbox whose opening keeps failing on connections
                    // that could be made stops for this pass. A connection
                    // that cannot be made is the account's failure, below.
                    if connection.provider.is_some() {
                        plan.open_failures += 1;
                    }
                    if plan.open_failures > options.retries.max(2) {
                        let message = error.to_string();
                        engine.with_store(|store| store.set_error(plan.row.id, &message))?;
                        plan.report.error = Some(message);
                        plan.stage = Stage::Done;
                        connection.drop_connection();
                        continue;
                    }
                    if let Err(error) = connection.recover(error).await {
                        let message = error.to_string();
                        engine.with_store(|store| store.set_error(plan.row.id, &message))?;
                        return Err(SyncError::Provider(error));
                    }
                }
                Err(Failure::Mailbox(error)) => {
                    let message = error.to_string();
                    engine.with_store(|store| store.set_error(plan.row.id, &message))?;
                    plan.report.error = Some(message);
                    plan.stage = Stage::Done;
                }
                Err(Failure::Stop(error)) => {
                    if let SyncError::Provider(provider) = &error {
                        let message = provider.to_string();
                        engine.with_store(|store| store.set_error(plan.row.id, &message))?;
                    }
                    connection.close().await;
                    return Err(error);
                }
            }
        }
        if !working {
            break;
        }
    }
    connection.close().await;
    Ok(AccountReport {
        account: account.id.0,
        mailboxes: plans.into_iter().map(|plan| plan.report).collect(),
    })
}

/// How a step failed.
#[derive(Debug)]
enum Failure {
    /// The connection failed: open a new one and try the step again.
    Again(ProviderError),
    /// A request for a batch failed on a connection that was working.
    Batch(ProviderError),
    /// This mailbox cannot go on this pass; the others can.
    Mailbox(ProviderError),
    /// The pass cannot go on.
    Stop(SyncError),
}

impl From<StoreError> for Failure {
    fn from(error: StoreError) -> Self {
        Self::Stop(SyncError::Store(error))
    }
}

impl Failure {
    /// A failure of a request for a batch.
    fn of_batch(error: ProviderError) -> Self {
        match Self::from(error) {
            Self::Again(error) => Self::Batch(error),
            other => other,
        }
    }
}

impl From<ProviderError> for Failure {
    fn from(error: ProviderError) -> Self {
        match error {
            ProviderError::SignIn | ProviderError::NoCredential => {
                Self::Stop(SyncError::Provider(error))
            }
            ProviderError::Refused(_) => Self::Mailbox(error),
            ProviderError::Unavailable(_) | ProviderError::Protocol(_) => Self::Again(error),
        }
    }
}

/// The connection to the provider, opened again when it fails.
struct Connection<'a> {
    connector: &'a dyn Connector,
    account: &'a AccountRow,
    options: &'a Options,
    provider: Option<Box<dyn Provider>>,
    /// The mailbox the provider has open.
    open: Option<MailboxId>,
    /// Connections that could not be made since the last step that worked.
    failures: u32,
    /// Requests that failed on a connection that was made, since the last
    /// step that worked.
    batch_failures: u32,
}

impl Connection<'_> {
    /// The provider, connecting first if there is no connection.
    async fn provider(&mut self) -> Result<&mut Box<dyn Provider>, ProviderError> {
        if self.provider.is_none() {
            self.open = None;
            self.provider = Some(self.connector.connect(self.account).await?);
        }
        self.provider
            .as_mut()
            .ok_or(ProviderError::Unavailable("no connection"))
    }

    /// Drops the connection, to open a new one for the next request.
    fn drop_connection(&mut self) {
        self.provider = None;
        self.open = None;
    }

    /// Drops the failed connection and waits before the next, or gives up.
    async fn recover(&mut self, error: ProviderError) -> Result<(), ProviderError> {
        self.provider = None;
        self.open = None;
        self.failures += 1;
        if self.failures > self.options.retries {
            return Err(error);
        }
        let wait = self
            .options
            .backoff
            .saturating_mul(2u32.saturating_pow(self.failures - 1));
        tokio::time::sleep(wait).await;
        Ok(())
    }

    async fn close(&mut self) {
        if let Some(mut provider) = self.provider.take() {
            provider.close().await;
        }
    }
}

/// Lists the account's mailboxes at the provider, records them, retires
/// the ones it no longer lists, and plans a pass for each, in turn order.
async fn mailboxes(
    engine: &Engine,
    connection: &mut Connection<'_>,
    clock: &dyn Clock,
) -> Result<Vec<Plan>, SyncError> {
    let remote = loop {
        let listed = match connection.provider().await {
            Ok(provider) => provider.mailboxes().await,
            Err(error) => Err(error),
        };
        match listed {
            Ok(remote) => break remote,
            Err(error) => match Failure::from(error) {
                Failure::Again(error) | Failure::Batch(error) | Failure::Mailbox(error) => {
                    connection
                        .recover(error)
                        .await
                        .map_err(SyncError::Provider)?;
                }
                Failure::Stop(error) => return Err(error),
            },
        }
    };
    connection.failures = 0;
    let account = connection.account.id;
    // A listing without the inbox is not taken as the account's mailboxes
    // having gone: nothing is retired on its word.
    let whole = remote.iter().any(|mailbox| mailbox.role == Role::Inbox);
    let rows = engine.with_store(|store| {
        let keys: HashSet<&str> = remote.iter().map(|mailbox| mailbox.key.as_str()).collect();
        for mailbox in &remote {
            store.upsert_mailbox(
                account,
                &crate::store::MailboxSeen {
                    provider_key: &mailbox.key,
                    name: &mailbox.name,
                    role: mailbox.role,
                },
            )?;
        }
        for row in store.mailboxes(account)? {
            if whole && !row.gone && !keys.contains(row.provider_key.as_str()) {
                store.retire_mailbox(row.id, clock.now())?;
            }
        }
        store.mailboxes(account)
    })?;
    let mut plans: Vec<Plan> = rows
        .into_iter()
        .filter(|row| !row.gone)
        .map(|row| Plan {
            validity: row.validity.clone(),
            report: MailboxReport {
                mailbox: row.id.0,
                role: row.role.as_str(),
                ..MailboxReport::default()
            },
            row,
            stage: Stage::Start,
            tried: HashMap::new(),
            restarts: 0,
            batch_failures: 0,
            open_failures: 0,
            single: 0,
        })
        .collect();
    // The inbox and the sent mailbox first (5.3); the rest in the order they
    // were first seen.
    plans.sort_by_key(|plan| match plan.row.role {
        Role::Inbox => 0,
        Role::Sent => 1,
        _ => 2,
    });
    Ok(plans)
}

/// Does one step of a mailbox's pass: at most one request for a batch, and
/// the transaction that records it.
async fn step(
    engine: &Engine,
    connection: &mut Connection<'_>,
    plan: &mut Plan,
    options: &Options,
    clock: &dyn Clock,
) -> Result<(), Failure> {
    // Moving from one stage to the next needs no request, and opens nothing.
    loop {
        match &plan.stage {
            Stage::Headers { queue, .. } if queue.is_empty() => {
                finish_headers(engine, plan, options, clock)?;
            }
            Stage::Bodies { queue } if queue.is_empty() => {
                let (mailbox, validity) = (plan.row.id, plan.validity.clone());
                let wanted = engine.with_store(|store| store.refetch_wanted(mailbox, &validity))?;
                plan.stage = Stage::Repairs { wanted };
            }
            Stage::Repairs { wanted } if wanted.is_empty() => plan.stage = Stage::Done,
            Stage::Done => return Ok(()),
            _ => break,
        }
    }
    // Any request needs the mailbox open, in the generation the plan began in.
    if connection.open != Some(plan.row.id) || matches!(plan.stage, Stage::Start) {
        let provider = connection.provider().await?;
        let opened = provider.open(&plan.row.provider_key).await?;
        connection.open = Some(plan.row.id);
        if !matches!(plan.stage, Stage::Start) && opened.validity != plan.validity {
            restart(plan)?;
        }
        if matches!(plan.stage, Stage::Start) {
            return start(engine, connection, plan, &opened.validity, clock).await;
        }
    }
    match &mut plan.stage {
        Stage::Start | Stage::Done => Ok(()),
        Stage::Headers { .. } => headers(engine, connection, plan, options, clock).await,
        Stage::Bodies { .. } => bodies(engine, connection, plan, options, clock).await,
        Stage::Repairs { .. } => repairs(engine, connection, plan, clock).await,
    }
}

/// The mailbox's generation changed during the pass: begin it again.
fn restart(plan: &mut Plan) -> Result<(), Failure> {
    plan.restarts += 1;
    if plan.restarts > MOST_RESTARTS {
        return Err(Failure::Mailbox(ProviderError::Protocol(
            "the mailbox's UIDVALIDITY keeps changing",
        )));
    }
    plan.stage = Stage::Start;
    Ok(())
}

/// Opens a mailbox's pass: records its generation, then lists it in full or
/// asks what changed since its cursor, and records what left it and the
/// flags that changed.
async fn start(
    engine: &Engine,
    connection: &mut Connection<'_>,
    plan: &mut Plan,
    validity: &str,
    clock: &dyn Clock,
) -> Result<(), Failure> {
    let mailbox = plan.row.id;
    let now = clock.now();
    let cursor = engine.with_store(|store| {
        store.set_validity(mailbox, validity, now)?;
        Ok(store.mailbox_position(mailbox)?.1)
    })?;
    plan.validity = validity.to_string();
    let (shown, tried) = engine.with_store(|store| {
        Ok((
            store.shown_ids(mailbox, validity)?,
            store.unreturned_tries(mailbox, validity)?,
        ))
    })?;
    let provider = connection.provider().await?;
    let since = match &cursor {
        Some(cursor) => provider.changes(cursor).await?,
        None => Since::TooOld,
    };
    let (queue, cursor, remaining, gone_named, flags) = match since {
        Since::NewGeneration => {
            connection.open = None;
            return restart(plan);
        }
        Since::Changes(changes) => {
            // New mail, then the listed messages that are due another try.
            let mut queue: VecDeque<String> = changes
                .added
                .into_iter()
                .filter(|id| !shown.contains(id))
                .collect();
            let queued: HashSet<&String> = queue.iter().collect();
            let mut due: Vec<String> = tried
                .iter()
                .filter(|(id, tried)| due(tried, now) && !queued.contains(id))
                .map(|(id, _)| id.clone())
                .collect();
            // Newest first, for ids that are numbers.
            due.sort_by(|a, b| (b.len(), b).cmp(&(a.len(), a)));
            queue.extend(due);
            let (remaining, named) = match changes.gone {
                // Only what the mailbox shows or awaits can leave it.
                Gone::Named(ids) => (
                    None,
                    ids.into_iter()
                        .filter(|id| shown.contains(id) || tried.contains_key(id))
                        .collect(),
                ),
                Gone::Remaining(ids) => (Some(ids), Vec::new()),
            };
            (queue, changes.cursor, remaining, named, changes.flags)
        }
        Since::TooOld => {
            let listing = provider.list().await?;
            plan.report.listed_in_full = true;
            // Everything listed that the mailbox does not show, newest
            // first; a listing in full tries every unreturned message again.
            let queue = listing
                .ids
                .iter()
                .filter(|id| !shown.contains(*id))
                .cloned()
                .collect();
            let listed = u64::try_from(listing.ids.len()).unwrap_or(u64::MAX);
            engine.with_store(|store| store.set_listed(mailbox, listed))?;
            // Messages already shown, from a pass that stopped before its
            // cursor was stored, may have changed flags since: the cursor
            // this listing stores will not cover those changes.
            let flags = if shown.is_empty() {
                Vec::new()
            } else {
                provider.flags().await?
            };
            (queue, listing.cursor, Some(listing.ids), Vec::new(), flags)
        }
    };
    // What left: what the provider names, or what the mailbox shows or
    // awaits that the provider no longer has.
    let mut removed = gone_named;
    if let Some(remaining) = remaining {
        let remaining: HashSet<&String> = remaining.iter().collect();
        removed.extend(
            shown
                .iter()
                .chain(tried.keys())
                .filter(|id| !remaining.contains(id))
                .cloned(),
        );
    }
    let removed_ids: Vec<&str> = removed.iter().map(String::as_str).collect();
    let (ended, changed) = engine.with_store(|store| {
        let ended = store.record_removed(mailbox, validity, &removed_ids, now)?;
        let changed = store.record_flags(mailbox, validity, &flags, now)?;
        Ok((ended, changed))
    })?;
    plan.report.removed += ended;
    plan.report.changed += changed;
    plan.tried = tried;
    for id in &removed {
        plan.tried.remove(id);
    }
    plan.stage = Stage::Headers { queue, cursor };
    Ok(())
}

/// Whether a listed message that has not arrived is due another try in a
/// pass that is not a listing in full.
fn due(tried: &Tried, now: i64) -> bool {
    let since = now.saturating_sub(tried.last_tried_at);
    if tried.tries < UNRETURNED_AFTER_TRIES {
        since >= TRY_SPACING_MS
    } else {
        since >= RETRY_UNRETURNED_MS
    }
}

/// Every listed message has been tried: stores the cursor the next pass
/// starts from, and moves on to bodies.
fn finish_headers(
    engine: &Engine,
    plan: &mut Plan,
    options: &Options,
    clock: &dyn Clock,
) -> Result<(), Failure> {
    let Stage::Headers { cursor, .. } = &plan.stage else {
        return Ok(());
    };
    let cursor = cursor.clone();
    let mailbox = plan.row.id;
    let now = clock.now();
    let header_only = plan.row.header_only || plan.row.role.header_only();
    let validity = plan.validity.clone();
    let bodies = engine.with_store(|store| {
        store.set_cursor(mailbox, Some(&cursor), now)?;
        let counts = store.mailbox_counts(mailbox)?;
        store.set_listed(
            mailbox,
            counts.headers_held + counts.awaited + counts.unreturned,
        )?;
        if header_only {
            Ok(Vec::new())
        } else {
            store.bodies_wanted(mailbox, &validity, options.whole_limit, now)
        }
    })?;
    plan.stage = Stage::Bodies {
        queue: bodies
            .into_iter()
            .map(|wanted| (wanted.provider_id, wanted.message, wanted.size))
            .collect(),
    };
    Ok(())
}

/// Fetches and records one batch of headers.
async fn headers(
    engine: &Engine,
    connection: &mut Connection<'_>,
    plan: &mut Plan,
    options: &Options,
    clock: &dyn Clock,
) -> Result<(), Failure> {
    let limit = plan.batch(options.header_batch);
    let Stage::Headers { queue, .. } = &mut plan.stage else {
        return Ok(());
    };
    let mailbox = plan.row.id;
    let take = queue.len().min(limit);
    let batch: Vec<String> = queue.iter().take(take).cloned().collect();
    let provider = connection.provider().await?;
    let returned = provider.headers(&batch).await.map_err(Failure::of_batch)?;
    let now = clock.now();
    let arrived: HashSet<&str> = returned
        .iter()
        .map(|seen| seen.provider_id.as_str())
        .collect();
    // A try counts at most once an hour (5.4).
    let missing: Vec<&str> = batch
        .iter()
        .map(String::as_str)
        .filter(|id| !arrived.contains(id))
        .filter(|id| {
            plan.tried
                .get(*id)
                .is_none_or(|tried| now.saturating_sub(tried.last_tried_at) >= TRY_SPACING_MS)
        })
        .collect();
    let validity = plan.validity.clone();
    let outcome = engine.with_store(|store| {
        let outcome = store.record_headers(mailbox, &validity, &returned, now)?;
        store.record_not_returned(mailbox, &validity, &missing, now)?;
        Ok(outcome)
    })?;
    plan.report.added += outcome.added;
    plan.report.changed += outcome.changed;
    plan.report.not_returned += u64::try_from(missing.len()).unwrap_or(u64::MAX);
    for id in &missing {
        let tried = plan.tried.entry((*id).to_string()).or_insert(Tried {
            tries: 0,
            last_tried_at: now,
        });
        tried.tries += 1;
        tried.last_tried_at = now;
    }
    for id in &arrived {
        plan.tried.remove(*id);
    }
    if let Stage::Headers { queue, .. } = &mut plan.stage {
        queue.drain(..take);
    }
    plan.single = plan.single.saturating_sub(1);
    Ok(())
}

/// Passes over the message at the head of the queue, whose request keeps
/// failing alone: as not returned, so that its tries are counted (5.4).
fn pass_over(engine: &Engine, plan: &mut Plan, clock: &dyn Clock) -> Result<(), SyncError> {
    let now = clock.now();
    let mailbox = plan.row.id;
    let validity = plan.validity.clone();
    match &mut plan.stage {
        Stage::Headers { queue, .. } => {
            if let Some(id) = queue.pop_front() {
                let counts = plan
                    .tried
                    .get(&id)
                    .is_none_or(|tried| now.saturating_sub(tried.last_tried_at) >= TRY_SPACING_MS);
                if counts {
                    engine.with_store(|store| {
                        store.record_not_returned(mailbox, &validity, &[id.as_str()], now)
                    })?;
                    plan.report.not_returned += 1;
                }
            }
        }
        Stage::Bodies { queue } => {
            if let Some((_, message, _)) = queue.pop_front() {
                engine.with_store(|store| store.record_bodies_not_returned(&[message], now))?;
            }
        }
        _ => {}
    }
    plan.single = plan.single.saturating_sub(1);
    Ok(())
}

/// Fetches and records one batch of whole messages.
async fn bodies(
    engine: &Engine,
    connection: &mut Connection<'_>,
    plan: &mut Plan,
    options: &Options,
    clock: &dyn Clock,
) -> Result<(), Failure> {
    let Stage::Bodies { queue } = &mut plan.stage else {
        return Ok(());
    };
    // At least one message, then as many as fit the batch's limits.
    let limit = if plan.single > 0 {
        1
    } else {
        options.body_batch
    };
    let mut take = 0;
    let mut bytes = 0u64;
    for (_, _, size) in queue.iter() {
        if take > 0 && (take >= limit || bytes + size > options.body_batch_bytes) {
            break;
        }
        take += 1;
        bytes += size;
    }
    let batch: Vec<(String, MessageId, u64)> = queue.iter().take(take).cloned().collect();
    let ids: Vec<String> = batch.iter().map(|(id, ..)| id.clone()).collect();
    let provider = connection.provider().await?;
    let fetched = provider.messages(&ids).await.map_err(Failure::of_batch)?;
    let messages: HashMap<&str, MessageId> = batch
        .iter()
        .map(|(id, message, _)| (id.as_str(), *message))
        .collect();
    let parts: Vec<PartSeen<'_>> = fetched
        .iter()
        .filter_map(|fetched| {
            messages
                .get(fetched.provider_id.as_str())
                .map(|message| PartSeen {
                    message: *message,
                    place: Place::Whole,
                    bytes: &fetched.bytes,
                })
        })
        .collect();
    let now = clock.now();
    // A body asked for and not returned counts a try, as a header does.
    let returned: HashSet<&str> = fetched
        .iter()
        .map(|fetched| fetched.provider_id.as_str())
        .collect();
    let missing: Vec<MessageId> = batch
        .iter()
        .filter(|(id, ..)| !returned.contains(id.as_str()))
        .map(|(_, message, _)| *message)
        .collect();
    if !missing.is_empty() {
        engine.with_store(|store| store.record_bodies_not_returned(&missing, now))?;
    }
    let (recorded, set_aside) =
        engine.with_store(|store| match store.record_parts(&parts, now) {
            Ok(_) => Ok((parts.len(), 0)),
            // Other bytes are held for one of them: record each alone, and set
            // aside the ones that conflict, so one cannot hold back the rest.
            Err(StoreError::Conflict) => {
                let mut recorded = 0;
                let mut set_aside = 0;
                for part in &parts {
                    match store.record_parts(std::slice::from_ref(part), now) {
                        Ok(_) => recorded += 1,
                        Err(StoreError::Conflict) => set_aside += 1,
                        Err(other) => return Err(other),
                    }
                }
                Ok((recorded, set_aside))
            }
            Err(other) => Err(other),
        })?;
    plan.report.bodies += u64::try_from(recorded).unwrap_or(u64::MAX);
    plan.report.set_aside += set_aside;
    if let Stage::Bodies { queue } = &mut plan.stage {
        queue.drain(..take);
    }
    plan.single = plan.single.saturating_sub(1);
    Ok(())
}

/// Fetches again every damaged file the mailbox can supply, then ends the
/// mailbox's pass.
async fn repairs(
    engine: &Engine,
    connection: &mut Connection<'_>,
    plan: &mut Plan,
    clock: &dyn Clock,
) -> Result<(), Failure> {
    let Stage::Repairs { wanted } = &plan.stage else {
        return Ok(());
    };
    let wanted = wanted.clone();
    let now = clock.now();
    {
        let provider = connection.provider().await?;
        let ids = |part: &str| -> Vec<String> {
            wanted
                .iter()
                .filter(|refetch| refetch.part == part)
                .map(|refetch| refetch.provider_id.clone())
                .collect()
        };
        let mut fetched: Vec<(String, &'static str, Vec<u8>)> = Vec::new();
        let header_ids = ids("header");
        if !header_ids.is_empty() {
            for seen in provider.headers(&header_ids).await? {
                fetched.push((seen.provider_id, "header", seen.header_block));
            }
        }
        let whole_ids = ids("whole");
        if !whole_ids.is_empty() {
            for message in provider.messages(&whole_ids).await? {
                fetched.push((message.provider_id, "whole", message.bytes));
            }
        }
        let repaired = engine.with_store(|store| {
            let mut repaired = 0;
            for (provider_id, part, bytes) in &fetched {
                let Some(refetch) = wanted
                    .iter()
                    .find(|refetch| refetch.part == *part && refetch.provider_id == *provider_id)
                else {
                    continue;
                };
                if store.record_refetched(refetch.message, part, bytes, now)? == Refetched::Repaired
                {
                    repaired += 1;
                }
            }
            Ok(repaired)
        })?;
        plan.report.repaired += repaired;
    }
    plan.stage = Stage::Done;
    Ok(())
}

/// A progress line: ids and counts, never a mailbox's name or anything from
/// a message.
fn describe(plan: &Plan) -> String {
    let report = &plan.report;
    let stage = match &plan.stage {
        Stage::Start => "opening".to_string(),
        Stage::Headers { queue, .. } => format!("{} headers to fetch", queue.len()),
        Stage::Bodies { queue } => format!("{} bodies to fetch", queue.len()),
        Stage::Repairs { wanted } => format!("{} files to repair", wanted.len()),
        Stage::Done => "done".to_string(),
    };
    format!(
        "mailbox {} ({}): {} added, {} bodies, {} not returned; {stage}",
        report.mailbox, report.role, report.added, report.bodies, report.not_returned
    )
}

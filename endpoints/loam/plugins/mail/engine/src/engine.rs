//! What the engine's commands share: the data directory, and the store once
//! a command needs it.

use std::collections::HashSet;
use std::fmt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError, RwLock};

use crate::home::{Home, HomeError};
use crate::operate::ChangeOptions;
use crate::provider::Connector;
use crate::provider::http::{HttpsPoster, UnsubscribePoster};
use crate::provider::smtp::MailSender;
use crate::secrets::{InMemory, Secrets};
use crate::store::{Store, StoreError, TokenRole, TokenRow};
use crate::sync::Options;

/// Where a command that runs for a while says how far it has come.
pub type Progress = Arc<dyn Fn(&str) + Send + Sync>;

/// The engine a registry's commands act on.
pub struct Engine {
    /// `None` when the platform names no place for it and `LOAM_MAIL_HOME`
    /// is unset: `help` still runs, and a command that needs the store fails.
    home: Option<Home>,
    /// Opened by the first command that needs it, so that `help` takes no
    /// lock and makes no directory.
    store: Mutex<Option<Store>>,
    /// Whether this process has opened the store, and so holds its lock:
    /// once set it stays set, since the store is never closed. Read without
    /// waiting for a command that is using the store.
    owns_store: AtomicBool,
    progress: Option<Progress>,
    /// How sync reaches accounts' providers; `None` in a build that syncs
    /// nothing.
    connector: Option<Arc<dyn Connector>>,
    /// How outbound mail is sent; `None` in a build that sends nothing.
    sender: Option<Arc<dyn MailSender>>,
    /// How one-click HTTPS unsubscribes are posted.
    unsubscribe_poster: Arc<dyn UnsubscribePoster>,
    sync: Options,
    /// Where accounts' sign-ins are kept.
    secrets: Arc<dyn Secrets>,
    /// The tokens a running server accepts from agents, as the store keeps
    /// them: read when the server starts and again whenever a token command
    /// changes them, so that the layer in front of every route never waits
    /// for the store.
    agent_tokens: RwLock<Vec<TokenRow>>,
    /// The persistent 32-byte non-bearer instance identity key for pre-bearer
    /// `/health` proof verification (amendment 5.1/5.2): loaded when the store
    /// opens so `/health` never blocks on the store mutex.
    proof_key: RwLock<Option<[u8; 32]>>,
    /// The shared file-backed journal sink for this engine's `home`, shared by
    /// `CommandRegistry` and `pair`/`unpair` so `seq` stays strictly monotonic.
    journal_sink: Option<Arc<dyn afd::JournalSink>>,
    /// What a server carries on in the background.
    work: crate::work::Work,
    limits: Limits,
    /// How operations size their work.
    change: ChangeOptions,
    /// The operations this process is running now.
    operating: Mutex<HashSet<i64>>,
    /// Whether an operation run at the terminal stops after the batch in
    /// hand when the person presses Ctrl-C: the program's, not a test's.
    interrupts: bool,
    /// Identifies the transport wiring (`"real"` or a `test-doubles:...` tag)
    /// written into `server.json` so CLI forwarding refuses mismatched
    /// transports.
    transport_tag: String,
}

/// What a call to a running server may take: the limits Loam sets on a
/// mount (the specification's 3.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    /// How long a call may run.
    pub call: std::time::Duration,
    /// The largest reply, in bytes.
    pub reply: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            call: std::time::Duration::from_secs(60),
            reply: 4 * 1024 * 1024,
        }
    }
}

impl fmt::Debug for Engine {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Engine")
            .field("home", &self.home)
            .finish_non_exhaustive()
    }
}

impl Engine {
    /// An engine over the data directory `home`. Nothing is opened yet.
    #[must_use]
    pub fn new(home: Option<Home>) -> Self {
        let journal_sink = home.as_ref().map(crate::journal::sink);
        Self {
            home,
            store: Mutex::new(None),
            owns_store: AtomicBool::new(false),
            progress: None,
            connector: None,
            sender: None,
            unsubscribe_poster: Arc::new(HttpsPoster::new()),
            sync: Options::default(),
            // The program gives the keychain; an engine made without one
            // keeps nothing beyond the process, so a test never reaches the
            // person's keychain by accident.
            secrets: Arc::new(InMemory::default()),
            agent_tokens: RwLock::new(Vec::new()),
            proof_key: RwLock::new(None),
            journal_sink,
            work: crate::work::Work::default(),
            limits: Limits::default(),
            change: ChangeOptions::default(),
            operating: Mutex::new(HashSet::new()),
            interrupts: false,
            transport_tag: "real".to_string(),
        }
    }

    /// Labels this engine's transport configuration for `server.json`
    /// forwarding checks.
    #[must_use]
    pub fn with_transport_tag(mut self, tag: impl Into<String>) -> Self {
        self.transport_tag = tag.into();
        self
    }

    /// The engine's transport label (`"real"` by default).
    #[must_use]
    pub fn transport_tag(&self) -> &str {
        &self.transport_tag
    }

    /// The same engine, sizing operations by `options`.
    #[must_use]
    pub fn with_change_options(mut self, options: ChangeOptions) -> Self {
        self.change = options;
        self
    }

    /// How operations size their work.
    #[must_use]
    pub fn change_options(&self) -> &ChangeOptions {
        &self.change
    }

    /// The same engine, stopping an operation that runs at the terminal
    /// after the batch in hand when the person presses Ctrl-C.
    #[must_use]
    pub fn with_interrupts(mut self) -> Self {
        self.interrupts = true;
        self
    }

    /// Whether an operation at the terminal listens for Ctrl-C.
    #[must_use]
    pub fn interrupts(&self) -> bool {
        self.interrupts
    }

    /// Marks operation `id` as running in this process; `false` when it
    /// already is.
    pub(crate) fn begin_operating(&self, id: i64) -> bool {
        self.operating
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(id)
    }

    /// Marks operation `id` as no longer running in this process.
    pub(crate) fn end_operating(&self, id: i64) {
        self.operating
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&id);
    }

    /// Whether operation `id` runs in this process now, or waits for the
    /// server's work.
    #[must_use]
    pub fn operation_busy(&self, id: i64) -> bool {
        self.operating
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .contains(&id)
            || self.work.operation_waits(id)
    }

    /// The same engine, keeping sign-ins in `secrets`: the keychain, in the
    /// program.
    #[must_use]
    pub fn with_secrets(mut self, secrets: Arc<dyn Secrets>) -> Self {
        self.secrets = secrets;
        self
    }

    /// Where accounts' sign-ins are kept.
    #[must_use]
    pub fn secrets(&self) -> &Arc<dyn Secrets> {
        &self.secrets
    }

    /// The same engine, reaching providers through `connector`.
    #[must_use]
    pub fn with_connector(mut self, connector: Arc<dyn Connector>) -> Self {
        self.connector = Some(connector);
        self
    }

    /// The same engine, sending outbound mail through `sender`.
    #[must_use]
    pub fn with_sender(mut self, sender: Arc<dyn MailSender>) -> Self {
        self.sender = Some(sender);
        self
    }

    /// The same engine, posting one-click unsubscribes through `poster`.
    #[must_use]
    pub fn with_unsubscribe_poster(mut self, poster: Arc<dyn UnsubscribePoster>) -> Self {
        self.unsubscribe_poster = poster;
        self
    }

    /// The same engine, sizing sync's work by `options`.
    #[must_use]
    pub fn with_sync_options(mut self, options: Options) -> Self {
        self.sync = options;
        self
    }

    /// Other limits for a call to a running server.
    #[must_use]
    pub fn with_limits(mut self, limits: Limits) -> Self {
        self.limits = limits;
        self
    }

    /// The limits of a call to a running server.
    #[must_use]
    pub fn limits(&self) -> Limits {
        self.limits
    }

    /// What a server carries on in the background, if one runs.
    #[must_use]
    pub fn work(&self) -> &crate::work::Work {
        &self.work
    }

    /// The data directory, when there is one.
    #[must_use]
    pub fn home(&self) -> Option<&Home> {
        self.home.as_ref()
    }

    /// How sync reaches providers.
    #[must_use]
    pub fn connector(&self) -> Option<&Arc<dyn Connector>> {
        self.connector.as_ref()
    }

    /// How outbound mail is sent.
    #[must_use]
    pub fn sender(&self) -> Option<&Arc<dyn MailSender>> {
        self.sender.as_ref()
    }

    /// How one-click HTTPS unsubscribes are posted.
    #[must_use]
    pub fn unsubscribe_poster(&self) -> &Arc<dyn UnsubscribePoster> {
        &self.unsubscribe_poster
    }

    /// How sync sizes its work.
    #[must_use]
    pub fn sync_options(&self) -> &Options {
        &self.sync
    }

    /// The same engine, reporting the progress of long commands to
    /// `progress`: the command line's standard error, at a terminal.
    #[must_use]
    pub fn with_progress(mut self, progress: Progress) -> Self {
        self.progress = Some(progress);
        self
    }

    /// Says how far a long command has come, in the engine's own words:
    /// never text from a message.
    pub fn report(&self, line: &str) {
        if let Some(progress) = &self.progress {
            progress(line);
        }
    }

    /// Opens the store now, taking the data directory's lock, when it is not
    /// open yet: the command line does this before it runs a command, to
    /// learn whether a server owns the store.
    ///
    /// # Errors
    /// [`StoreError::InUse`] when another process owns the store.
    pub fn open_store(&self) -> Result<(), StoreError> {
        self.with_store(|_| Ok(()))
    }

    /// Runs `work` on the store, opening it first if this is its first use.
    ///
    /// Inside a server's runtime the work leaves the async thread it was
    /// called on, so that a command waiting for the store, or writing to it,
    /// never holds up the requests the runtime is serving.
    ///
    /// # Errors
    /// [`StoreError::InUse`] when another process owns the store, and
    /// whatever `work` returns.
    pub fn with_store<T>(
        &self,
        work: impl FnOnce(&mut Store) -> Result<T, StoreError>,
    ) -> Result<T, StoreError> {
        let on_server = tokio::runtime::Handle::try_current().is_ok_and(|handle| {
            handle.runtime_flavor() == tokio::runtime::RuntimeFlavor::MultiThread
        });
        if on_server {
            tokio::task::block_in_place(|| self.with_store_here(work))
        } else {
            self.with_store_here(work)
        }
    }

    fn with_store_here<T>(
        &self,
        work: impl FnOnce(&mut Store) -> Result<T, StoreError>,
    ) -> Result<T, StoreError> {
        // A command that panicked left the store as SQLite and the log keep
        // it: every write is a transaction, so the next command may go on.
        let mut held = self.store.lock().unwrap_or_else(PoisonError::into_inner);
        let store = match held.as_mut() {
            Some(store) => store,
            None => {
                let home = self
                    .home
                    .as_ref()
                    .ok_or(StoreError::Home(HomeError::Unknown))?;
                let opened = Store::open(home)?;
                let key = opened.proof_key()?;
                self.set_proof_key(key);
                let store = held.insert(opened);
                self.owns_store.store(true, Ordering::Release);
                store
            }
        };
        work(store)
    }

    /// Whether this process owns the store: it has opened it and holds the
    /// data directory's lock. Only the owner writes the journal.
    #[must_use]
    pub fn owns_store(&self) -> bool {
        self.owns_store.load(Ordering::Acquire)
    }

    /// Reads the agents' tokens from the store into what the server checks.
    ///
    /// # Errors
    /// When the store cannot be opened or read.
    pub fn load_agent_tokens(&self) -> Result<(), StoreError> {
        let tokens = self.with_store(|store| store.tokens())?;
        self.set_agent_tokens(tokens);
        Ok(())
    }

    /// Replaces what the server checks with `tokens`.
    pub fn set_agent_tokens(&self, tokens: Vec<TokenRow>) {
        *self
            .agent_tokens
            .write()
            .unwrap_or_else(PoisonError::into_inner) = tokens;
    }

    /// Evicts the token `id` from the in-memory server cache, if present.
    pub fn remove_agent_token(&self, id: &str) {
        self.agent_tokens
            .write()
            .unwrap_or_else(PoisonError::into_inner)
            .retain(|token| token.id != id);
    }

    /// The id of the agent whose token hashes to `hash`, compared with every
    /// token kept in constant time.
    #[must_use]
    pub fn agent_for(&self, hash: &[u8; 32]) -> Option<String> {
        let tokens = self
            .agent_tokens
            .read()
            .unwrap_or_else(PoisonError::into_inner);
        let mut found = None;
        for token in tokens.iter() {
            if crate::tokens::same(&token.hash, hash) {
                found = Some(token.id.clone());
            }
        }
        found
    }

    /// Whether `id` is currently loaded as an active token with role
    /// [`TokenRole::Approver`].
    #[must_use]
    pub fn is_approver_token(&self, id: &str) -> bool {
        let tokens = self
            .agent_tokens
            .read()
            .unwrap_or_else(PoisonError::into_inner);
        tokens
            .iter()
            .any(|token| token.id == id && token.role == TokenRole::Approver)
    }

    /// Caches the persistent 32-byte non-bearer instance identity proof key.
    pub fn set_proof_key(&self, key: [u8; 32]) {
        *self
            .proof_key
            .write()
            .unwrap_or_else(PoisonError::into_inner) = Some(key);
    }

    /// Returns the cached persistent 32-byte instance identity proof key, if
    /// loaded.
    #[must_use]
    pub fn proof_key(&self) -> Option<[u8; 32]> {
        *self
            .proof_key
            .read()
            .unwrap_or_else(PoisonError::into_inner)
    }

    /// Returns the shared journal sink for this engine, if `home` is set.
    #[must_use]
    pub(crate) fn journal_sink(&self) -> Option<Arc<dyn afd::JournalSink>> {
        self.journal_sink.as_ref().map(Arc::clone)
    }

    /// Appends a redacted record to the engine's journal when this process owns
    /// the store. Failures are reported via [`Self::report`] and never fail the
    /// completed action, matching [`afd::JournalRecorder`].
    pub(crate) async fn append_journal(&self, record: afd::JournalRecord) {
        if !self.owns_store() {
            return;
        }
        let Some(sink) = self.journal_sink() else {
            return;
        };
        let Some(redacted) = crate::journal::redact(record) else {
            return;
        };
        if sink.append(redacted).await.is_err() {
            self.report("the journal could not be written");
        }
    }
}

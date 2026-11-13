//! What the engine's commands share: the data directory, and the store once
//! a command needs it.

use std::fmt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError, RwLock};

use crate::home::{Home, HomeError};
use crate::provider::Connector;
use crate::secrets::{InMemory, Secrets};
use crate::store::{Store, StoreError, TokenRow};
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
    sync: Options,
    /// Where accounts' sign-ins are kept.
    secrets: Arc<dyn Secrets>,
    /// The tokens a running server accepts from agents, as the store keeps
    /// them: read when the server starts and again whenever a token command
    /// changes them, so that the layer in front of every route never waits
    /// for the store.
    agent_tokens: RwLock<Vec<TokenRow>>,
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
        Self {
            home,
            store: Mutex::new(None),
            owns_store: AtomicBool::new(false),
            progress: None,
            connector: None,
            sync: Options::default(),
            // The program gives the keychain; an engine made without one
            // keeps nothing beyond the process, so a test never reaches the
            // person's keychain by accident.
            secrets: Arc::new(InMemory::default()),
            agent_tokens: RwLock::new(Vec::new()),
        }
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

    /// The same engine, sizing sync's work by `options`.
    #[must_use]
    pub fn with_sync_options(mut self, options: Options) -> Self {
        self.sync = options;
        self
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
                let store = held.insert(Store::open(home)?);
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
}

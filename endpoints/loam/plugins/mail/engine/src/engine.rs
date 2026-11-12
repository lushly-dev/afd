//! What the engine's commands share: the data directory, and the store once
//! a command needs it.

use std::fmt;
use std::sync::{Arc, Mutex, PoisonError};

use crate::home::{Home, HomeError};
use crate::provider::Connector;
use crate::secrets::{InMemory, Secrets};
use crate::store::{Store, StoreError};
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
    progress: Option<Progress>,
    /// How sync reaches accounts' providers; `None` in a build that syncs
    /// nothing.
    connector: Option<Arc<dyn Connector>>,
    sync: Options,
    /// Where accounts' sign-ins are kept.
    secrets: Arc<dyn Secrets>,
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
            progress: None,
            connector: None,
            sync: Options::default(),
            // The program gives the keychain; an engine made without one
            // keeps nothing beyond the process, so a test never reaches the
            // person's keychain by accident.
            secrets: Arc::new(InMemory::default()),
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

    /// Runs `work` on the store, opening it first if this is its first use.
    ///
    /// # Errors
    /// [`StoreError::InUse`] when another process owns the store, and
    /// whatever `work` returns.
    pub fn with_store<T>(
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
                held.insert(Store::open(home)?)
            }
        };
        work(store)
    }
}

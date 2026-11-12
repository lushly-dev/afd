//! What the engine's commands share: the data directory, and the store once
//! a command needs it.

use std::fmt;
use std::sync::{Arc, Mutex, PoisonError};

use crate::home::{Home, HomeError};
use crate::store::{Store, StoreError};

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
        }
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

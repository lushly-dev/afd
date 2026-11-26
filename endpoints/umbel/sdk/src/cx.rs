//! What a handler may use: the call and the host services its plugin was granted.

use serde_json::Value;
use std::fmt;

use crate::services::{AllServices, NoServices};

/// What the command is called with (WIT `call-context`). The principal is a summary: plugins
/// never see credentials or tokens.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CallContext {
    /// The registered command name.
    pub command: String,
    /// The call's trace id.
    pub trace_id: String,
    /// The resolved space for a command with a `space` input; `None` otherwise.
    pub space: Option<String>,
    /// The spaces the call may use: the checked `spaces` of a command with a `spaces` input,
    /// else the call's one space (the default space for a command with no space input). The
    /// store methods refuse a space outside it.
    pub spaces: Vec<String>,
    /// The effective output budget in bytes, for a command that declares one; `None` otherwise.
    /// A component reads it through WIT world 1.1.0's `call` interface.
    pub output_budget: Option<u64>,
    /// The actor's kind: `human`, `agent`, `service` or `script`.
    pub actor_kind: String,
    /// The actor's id, when it has one.
    pub actor_id: Option<String>,
    /// The person the actor acts for, when known.
    pub on_behalf_of: Option<String>,
    /// `mcp`, `cli`, `agent` or `palette`.
    pub interface: String,
    /// The host's attestation that this call is a step of a plugin pipeline (phase 4
    /// specification, section 10.1, D91); `None` for any other call.
    ///
    /// The host fills it for a compiled plugin's command only, from a table it keeps itself,
    /// keyed by the fresh random trace id it gave the step, and only when the entry names the
    /// command called. Nothing a caller sends sets it: not the input, not `extra`, not a trace id
    /// chosen by a client. A component (WIT worlds 1.0.0 and 1.1.0) and a mounted server never see it.
    pub pipeline: Option<PipelineAttestation>,
    /// Whether the host counts the caller as a person for this command (phase 3 specification,
    /// sections 3.3 and 8.7; D86): a human through the library, or a human at the command line
    /// whose human-present mark names this command (stdin and stderr are terminals, the input is
    /// not `@-`, neither `--yes` nor `--approve`, and no agent environment variable is set). The
    /// same check the host makes before `memory-confirm` gives a record authority `person`;
    /// `curator-promote` makes it before a person widens their own records (phase 4 step 4,
    /// amendment 9). **Not an attestation**: it rests on a terminal check until phase 5.
    ///
    /// The host fills it for a compiled plugin's command only; a component (WIT worlds 1.0.0 and 1.1.0) and
    /// a mounted server always see `false`.
    pub person: bool,
    /// The legacy principal strings the caller's effective principal stands for (phase 5
    /// specification, section 4.6, `[principal.equivalents]`, one way): every principal
    /// comparison a plugin makes consults them beside the effective principal, so a person's
    /// namespaced principal is never a different person from their legacy one. Empty when none
    /// maps to it.
    ///
    /// The host fills it for a compiled plugin's command only; a component (WIT worlds 1.0.0 and 1.1.0) and
    /// a mounted server always see none.
    pub equivalents: Vec<String>,
    /// Whether the host seals this caller's positions (phase 5 section 9.3, D125): a hosted
    /// caller that is neither the operator nor stdio. A plugin then shows every store revision
    /// through [`crate::Cx::doc_position`] (it does in any case) and counts in its totals only
    /// what the caller can read.
    ///
    /// The host fills it for a compiled plugin's command only; a component (WIT worlds 1.0.0 and 1.1.0) and
    /// a mounted server always see `false`.
    pub sealed_positions: bool,
    /// The caller's delegation chain, outermost first (phase 5 sections 2.1 and 2.4): the
    /// verified client, or the RFC 8693 `act` chain of an issuer configured for it; empty without
    /// a token or an assertion. A plugin copies it into a version 3 envelope it writes in a record
    /// body (a proposal's `provenance`); the store envelope's own chain is the host's to fill.
    ///
    /// The host fills it for a compiled plugin's command only; a component (WIT worlds 1.0.0 and 1.1.0) and
    /// a mounted server always see none.
    pub delegation_chain: Vec<umbel_store::ChainLink>,
    /// The host's attestation that a person decided this very call on the person page (phase 5
    /// sections 7.2 and 7.3): `Some` only when the host's own mark on the call names this command,
    /// the surface it came on and the digest of this validated input, for the person the caller
    /// acts for, after the plugin gate admitted it once. Nothing a caller sends sets it. `None` at
    /// a terminal (the CLI's check is [`Self::person`]'s) and everywhere else.
    ///
    /// The host fills it for a compiled plugin's command only; a component (WIT worlds 1.0.0 and 1.1.0) and
    /// a mounted server always see none.
    pub person_decision: Option<PersonDecision>,
    /// The call a person is about to be asked to decide on the person page, when this call is
    /// that command's `confirm_preview` run by the host as the caller before the decision is
    /// begun (phase 5 step 6): the plugin answers a failure for a call it would refuse, so no
    /// person is asked about it. `None` for every other call, the page's own rendering included.
    /// It only ever adds refusals, so it carries no authority. The host runs this check as its own
    /// in-process call: [`Self::interface`] is then empty, and [`PersonCheck::surface`] says where
    /// the call it checks came from.
    ///
    /// The host fills it for a compiled plugin's command only; a component (WIT worlds 1.0.0 and 1.1.0) and
    /// a mounted server always see none.
    pub person_check: Option<PersonCheck>,
    /// The page of its preview the person page asks a `confirm_preview` command for (the Ideas
    /// host-review specification, section 2): `Some(n)`, from 1, on every render of a decision's
    /// page; `None` everywhere else, the CLI and the host's own check included, where the preview
    /// answers exactly `{ preview }`. The page number is never part of the command's input, so it
    /// is never part of the digest the decision binds. Host-owned, as [`Self::person_check`] is.
    ///
    /// The host fills it for a compiled plugin's command only; a component (WIT worlds 1.0.0 and 1.1.0) and
    /// a mounted server always see none.
    pub preview_page: Option<u32>,
}

/// The call the host is about to ask a person to decide (phase 5 step 6), as
/// [`CallContext::person_check`] names it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PersonCheck {
    /// The gated command.
    pub command: String,
    /// Where its call came from: `mcp` (the approval relay) or `cli` (the command line's URL
    /// flow).
    pub surface: String,
}

/// A person's decision on the person page that a call carries, as the host attests it (phase 5
/// sections 7.2 and 7.3): who decided and how they were proven, never the decision's content.
///
/// `Default` lets a test build one with `..PersonDecision::default()`, so a field the host adds
/// later does not break every plugin's tests (the Ideas host-review specification, step H0). Only
/// the host attests a decision; a plugin that builds one gains nothing.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PersonDecision {
    /// Where the call came from: `mcp` (through the approval relay) or `cli` (the command line's
    /// URL flow).
    pub surface: String,
    /// The person who logged in and decided, `<namespace>/<subject>`: the person the call is for.
    pub person: String,
    /// The identity namespace of the login.
    pub namespace: String,
    /// The login's `auth_time`, ISO 8601 UTC with milliseconds.
    pub auth_time: String,
    /// The login's `acr`.
    pub acr: String,
    /// How the person was proven: `verified` (the person page, after a login with user
    /// verification) or `local` (the local person page, with no login; the Ideas host-review
    /// specification, section 6.5). A `local` decision has an empty `namespace`, `auth_time` and
    /// `acr`.
    pub level: String,
    /// The ids of the preview's items the person pulled out on the page before confirming (the
    /// Ideas host-review specification, section 3); empty when the preview had none. The command's
    /// input and its digest are unchanged: this is how the run learns what was pulled out, and a
    /// plugin whose preview answers items must leave those out of what it applies.
    pub excluded: Vec<String>,
}

/// Who ran a pipeline step, as the host attests it (phase 4 specification, section 10.1): the
/// plugin and instance that ship the pipeline, the pipeline, and the run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PipelineAttestation {
    /// The `plugin.id` of the plugin that ships the pipeline.
    pub plugin: String,
    /// The instance of that plugin whose pipeline is running.
    pub instance: String,
    /// The pipeline's command name.
    pub pipeline: String,
    /// The pipeline call's trace id: one run of the pipeline, shared by all of its steps.
    pub run: String,
}

/// Why a host service refused (WIT `host-error`; world 1.1.0 adds `Conflict`, `Busy`, `Corrupt`
/// and `Io`, and world 1.0.0's four cases stay frozen). The memory
/// variants are phase 3's (section 5.2); each names the error code a plugin answers with.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum HostError {
    /// The grant was not declared, or the deployer denied it.
    NotGranted(String),
    /// What was asked for does not exist.
    NotFound(String),
    /// The arguments were not acceptable.
    Invalid(String),
    /// The answer would exceed a cap.
    TooLarge(String),
    /// A compare-and-set or revision check failed and nothing was written. `current` is the
    /// current content hash, or the current revision for an applied revision.
    Conflict {
        /// What the store holds now.
        current: Option<String>,
    },
    /// A lock wait ran past `store.lock_timeout_ms`; retry.
    Busy(String),
    /// The stored data is not what the store wrote; run `store-check`.
    Corrupt(String),
    /// The operating system or the database failed.
    Io(String),
    /// A memory write met a limit of its quota and wrote nothing (`MEMORY_QUOTA_EXCEEDED`).
    /// Retryable when the limit is a rate, which `retry_after_ms` then says.
    QuotaExceeded {
        /// Which limit.
        limit: umbel_store::memory::QuotaLimit,
        /// When a rate limit admits the write again; `None` for the stored limits.
        retry_after_ms: Option<u64>,
    },
    /// Nothing has been written to the space's memory store yet; a read creates nothing.
    NotProvisioned,
    /// The memory key file does not exist (`MEMORY_KEYS_MISSING`).
    KeysMissing,
    /// The memory key file belongs to another database, or is not one (`MEMORY_KEYS_MISMATCH`).
    KeysMismatch,
    /// A readable record's key entry is absent (`MEMORY_KEY_ABSENT`).
    KeyAbsent {
        /// The record.
        id: String,
    },
    /// A readable record's sealed blob does not open (`MEMORY_SEAL_INVALID`).
    SealInvalid {
        /// The record.
        id: String,
    },
    /// A memory query matches more readable records than recall ranks
    /// (`MEMORY_QUERY_TOO_BROAD`, phase 5 section 9.2); nothing was returned.
    QueryTooBroad {
        /// The most readable matches a recall ranks.
        limit: u64,
    },
}

impl fmt::Display for HostError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotGranted(message) => write!(f, "not granted: {message}"),
            Self::NotFound(message) => write!(f, "not found: {message}"),
            Self::Invalid(message) => write!(f, "invalid: {message}"),
            Self::TooLarge(message) => write!(f, "too large: {message}"),
            Self::Conflict { current: Some(c) } => write!(f, "conflict: the store holds {c}"),
            Self::Conflict { current: None } => write!(f, "conflict: nothing is stored there"),
            Self::Busy(message) => write!(f, "busy: {message}"),
            Self::Corrupt(message) => write!(f, "corrupt: {message}"),
            Self::Io(message) => write!(f, "i/o: {message}"),
            Self::QuotaExceeded {
                limit,
                retry_after_ms: Some(ms),
            } => write!(
                f,
                "MEMORY_QUOTA_EXCEEDED: the limit {} is reached; retry after {ms} ms",
                limit.as_str()
            ),
            Self::QuotaExceeded { limit, .. } => write!(
                f,
                "MEMORY_QUOTA_EXCEEDED: the limit {} is reached",
                limit.as_str()
            ),
            Self::NotProvisioned => write!(f, "not provisioned: nothing is stored in memory yet"),
            Self::KeysMissing => write!(
                f,
                "MEMORY_KEYS_MISSING: the memory key file memory.keys does not exist"
            ),
            Self::KeysMismatch => write!(
                f,
                "MEMORY_KEYS_MISMATCH: the memory key file does not belong to this memory database"
            ),
            Self::KeyAbsent { id } => {
                write!(f, "MEMORY_KEY_ABSENT: the record {id} has no key entry")
            }
            Self::SealInvalid { id } => {
                write!(f, "MEMORY_SEAL_INVALID: the record {id} does not open")
            }
            Self::QueryTooBroad { limit } => write!(
                f,
                "MEMORY_QUERY_TOO_BROAD: the query matches more than {limit} readable records"
            ),
        }
    }
}

impl std::error::Error for HostError {}

/// What a reporting checkpoint of the document store achieved (
/// [`MaintenanceServices::truncate_wal`](crate::MaintenanceServices::truncate_wal),
/// phase 4 specification section 9.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WalCheckpoint {
    /// Every frame is in the database file and the write-ahead log is empty, so with
    /// `secure_delete` on no replaced or removed bytes remain in either.
    Clean,
    /// A reader holds the write-ahead log, or a lock was busy: the earlier bytes stay in it until
    /// a later checkpoint (a later write's, or `store-check`'s) truncates it.
    Pending,
}

/// A log level (WIT `log.level`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
    /// Something failed.
    Error,
    /// Something needs attention.
    Warn,
    /// Normal operation.
    Info,
    /// Detail for diagnosing.
    Debug,
    /// Finer detail still.
    Trace,
}

pub(crate) fn not_granted<T>(grant: &str) -> Result<T, HostError> {
    Err(HostError::NotGranted(format!(
        "the grant `{grant}` was not declared or was denied"
    )))
}

/// What a handler may use. Each method fails with [`HostError::NotGranted`] when the grant was
/// not declared or was denied.
pub struct Cx {
    call: CallContext,
    services: Services,
}

/// Where a handle's services come from. A component calls its imports directly (never through a
/// trait object), so an interface the plugin never uses is not imported by the component and the
/// manifest need not declare its grant.
enum Services {
    Dyn(Box<dyn AllServices>),
    #[cfg(feature = "component")]
    Component,
}

impl fmt::Debug for Cx {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Cx").field("call", &self.call).finish()
    }
}

impl Cx {
    /// A handle over `services` for the call `call`. Hosts build it; tests may too.
    pub fn new(call: CallContext, services: impl AllServices + 'static) -> Self {
        Self {
            call,
            services: Services::Dyn(Box::new(services)),
        }
    }

    /// A handle over the component's imports (the `component` feature).
    #[cfg(feature = "component")]
    pub(crate) fn component(call: CallContext) -> Self {
        Self {
            call,
            services: Services::Component,
        }
    }

    /// A handle with no grants: every service answers `NotGranted`.
    pub fn without_grants(call: CallContext) -> Self {
        Self::new(call, NoServices)
    }

    /// The command, trace id, space, actor summary and interface.
    pub fn call(&self) -> &CallContext {
        &self.call
    }

    /// The host services behind this handle, for the store methods. A component holds no store
    /// grant in protocol 1, so for one every store method answers `NotGranted`.
    pub(crate) fn host(&self) -> Result<&dyn AllServices, HostError> {
        match &self.services {
            Services::Dyn(services) => Ok(services.as_ref()),
            #[cfg(feature = "component")]
            Services::Component => not_granted("documents"),
        }
    }

    /// Grant `config`.
    ///
    /// # Errors
    /// [`HostError::NotGranted`].
    pub fn config(&self) -> Result<Value, HostError> {
        match &self.services {
            Services::Dyn(services) => services.config(),
            #[cfg(feature = "component")]
            Services::Component => crate::component::config(),
        }
    }

    /// Grant `log`; a no-op without the grant.
    pub fn log(&self, level: Level, message: &str) {
        match &self.services {
            Services::Dyn(services) => services.log(level, message),
            #[cfg(feature = "component")]
            Services::Component => crate::component::log(level, message),
        }
    }

    /// Grant `packs`: one file of one of the plugin's packs.
    ///
    /// # Errors
    /// See [`PackServices::pack_read`](crate::PackServices::pack_read).
    pub fn pack_read(&self, pack: &str, path: &str) -> Result<Vec<u8>, HostError> {
        match &self.services {
            Services::Dyn(services) => services.pack_read(pack, path),
            #[cfg(feature = "component")]
            Services::Component => crate::component::pack_read(pack, path),
        }
    }

    /// Grant `packs`: the files of one of the plugin's packs.
    ///
    /// # Errors
    /// See [`PackServices::pack_list`](crate::PackServices::pack_list).
    pub fn pack_list(&self, pack: &str) -> Result<Vec<String>, HostError> {
        match &self.services {
            Services::Dyn(services) => services.pack_list(pack),
            #[cfg(feature = "component")]
            Services::Component => crate::component::pack_list(pack),
        }
    }

    /// Grant `events`.
    ///
    /// # Errors
    /// See [`EventServices::events`](crate::EventServices::events).
    pub fn events(
        &self,
        space: Option<&str>,
        after: Option<&str>,
        limit: u32,
    ) -> Result<Value, HostError> {
        match &self.services {
            Services::Dyn(services) => services.events(space, after, limit),
            #[cfg(feature = "component")]
            Services::Component => crate::component::events(space, after, limit),
        }
    }

    /// Grant `clock`: epoch milliseconds from the command context's clock.
    ///
    /// # Errors
    /// [`HostError::NotGranted`].
    pub fn now_ms(&self) -> Result<i64, HostError> {
        match &self.services {
            Services::Dyn(services) => services.now_ms(),
            #[cfg(feature = "component")]
            Services::Component => Ok(crate::component::now_ms()),
        }
    }

    /// Grant `random`: the command context's random source, in `[0, 1)`.
    ///
    /// # Errors
    /// [`HostError::NotGranted`].
    pub fn random(&self) -> Result<f64, HostError> {
        match &self.services {
            Services::Dyn(services) => services.random(),
            #[cfg(feature = "component")]
            Services::Component => Ok(crate::component::random()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_handle_without_grants_answers_not_granted_everywhere() {
        let cx = Cx::without_grants(CallContext::default());
        assert!(matches!(cx.config(), Err(HostError::NotGranted(_))));
        assert!(matches!(
            cx.pack_read("p", "data/x"),
            Err(HostError::NotGranted(_))
        ));
        assert!(matches!(cx.pack_list("p"), Err(HostError::NotGranted(_))));
        assert!(matches!(
            cx.events(None, None, 10),
            Err(HostError::NotGranted(_))
        ));
        assert!(matches!(cx.now_ms(), Err(HostError::NotGranted(_))));
        assert!(matches!(cx.random(), Err(HostError::NotGranted(_))));
        cx.log(Level::Info, "a no-op");
    }
}

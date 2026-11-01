//! What a handler may use: the call and the host services its plugin was granted.

use serde_json::Value;
use std::fmt;

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
    /// The actor's kind: `human`, `agent`, `service` or `script`.
    pub actor_kind: String,
    /// The actor's id, when it has one.
    pub actor_id: Option<String>,
    /// The person the actor acts for, when known.
    pub on_behalf_of: Option<String>,
    /// `mcp`, `cli`, `agent` or `palette`.
    pub interface: String,
}

/// Why a host service refused (WIT `host-error`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostError {
    /// The grant was not declared, or the deployer denied it.
    NotGranted(String),
    /// What was asked for does not exist.
    NotFound(String),
    /// The arguments were not acceptable.
    Invalid(String),
    /// The answer would exceed a cap.
    TooLarge(String),
}

impl fmt::Display for HostError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotGranted(message) => write!(f, "not granted: {message}"),
            Self::NotFound(message) => write!(f, "not found: {message}"),
            Self::Invalid(message) => write!(f, "invalid: {message}"),
            Self::TooLarge(message) => write!(f, "too large: {message}"),
        }
    }
}

impl std::error::Error for HostError {}

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

/// The host services of one call, by grant. The host implements it for a compiled plugin; a
/// component and a mounted server get their own implementations in later steps. Every method
/// answers [`HostError::NotGranted`] for a grant that was not declared or was denied.
pub trait HostServices: Send + Sync {
    /// Grant `config`: the instance's configuration, validated, defaults applied.
    ///
    /// # Errors
    /// [`HostError::NotGranted`].
    fn config(&self) -> Result<Value, HostError>;
    /// Grant `log`: a line in the host's log, tagged with the instance id. A no-op without the
    /// grant.
    fn log(&self, level: Level, message: &str);
    /// Grant `packs`: the files of one of the plugin's packs, as paths inside the pack.
    ///
    /// # Errors
    /// [`HostError::NotGranted`], [`HostError::NotFound`].
    fn pack_list(&self, pack: &str) -> Result<Vec<String>, HostError>;
    /// Grant `packs`: one file of one of the plugin's packs.
    ///
    /// # Errors
    /// [`HostError::NotGranted`], [`HostError::NotFound`], [`HostError::Invalid`] for a path
    /// outside the pack, [`HostError::TooLarge`] past the per-call cap.
    fn pack_read(&self, pack: &str, path: &str) -> Result<Vec<u8>, HostError>;
    /// Grant `events`: `event-list`'s read under the caller's principal, without acknowledging.
    ///
    /// # Errors
    /// [`HostError::NotGranted`], including for a space the instance is not enabled for;
    /// [`HostError::Invalid`].
    fn events(
        &self,
        space: Option<&str>,
        after: Option<&str>,
        limit: u32,
    ) -> Result<Value, HostError>;
    /// Grant `clock`: the command context's clock, in epoch milliseconds.
    ///
    /// # Errors
    /// [`HostError::NotGranted`].
    fn now_ms(&self) -> Result<i64, HostError>;
    /// Grant `random`: the command context's random source, in `[0, 1)`.
    ///
    /// # Errors
    /// [`HostError::NotGranted`].
    fn random(&self) -> Result<f64, HostError>;
}

/// Services for a call whose plugin was granted nothing: every method answers `NotGranted`.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoServices;

fn not_granted<T>(grant: &str) -> Result<T, HostError> {
    Err(HostError::NotGranted(format!(
        "the grant `{grant}` was not declared or was denied"
    )))
}

impl HostServices for NoServices {
    fn config(&self) -> Result<Value, HostError> {
        not_granted("config")
    }
    fn log(&self, _level: Level, _message: &str) {}
    fn pack_list(&self, _pack: &str) -> Result<Vec<String>, HostError> {
        not_granted("packs")
    }
    fn pack_read(&self, _pack: &str, _path: &str) -> Result<Vec<u8>, HostError> {
        not_granted("packs")
    }
    fn events(
        &self,
        _space: Option<&str>,
        _after: Option<&str>,
        _limit: u32,
    ) -> Result<Value, HostError> {
        not_granted("events")
    }
    fn now_ms(&self) -> Result<i64, HostError> {
        not_granted("clock")
    }
    fn random(&self) -> Result<f64, HostError> {
        not_granted("random")
    }
}

/// What a handler may use. Each method fails with [`HostError::NotGranted`] when the grant was
/// not declared or was denied.
pub struct Cx {
    call: CallContext,
    services: Box<dyn HostServices>,
}

impl fmt::Debug for Cx {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Cx").field("call", &self.call).finish()
    }
}

impl Cx {
    /// A handle over `services` for the call `call`. Hosts build it; tests may too.
    pub fn new(call: CallContext, services: impl HostServices + 'static) -> Self {
        Self {
            call,
            services: Box::new(services),
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

    /// Grant `config`.
    ///
    /// # Errors
    /// [`HostError::NotGranted`].
    pub fn config(&self) -> Result<Value, HostError> {
        self.services.config()
    }

    /// Grant `log`; a no-op without the grant.
    pub fn log(&self, level: Level, message: &str) {
        self.services.log(level, message);
    }

    /// Grant `packs`: one file of one of the plugin's packs.
    ///
    /// # Errors
    /// See [`HostServices::pack_read`].
    pub fn pack_read(&self, pack: &str, path: &str) -> Result<Vec<u8>, HostError> {
        self.services.pack_read(pack, path)
    }

    /// Grant `packs`: the files of one of the plugin's packs.
    ///
    /// # Errors
    /// See [`HostServices::pack_list`].
    pub fn pack_list(&self, pack: &str) -> Result<Vec<String>, HostError> {
        self.services.pack_list(pack)
    }

    /// Grant `events`.
    ///
    /// # Errors
    /// See [`HostServices::events`].
    pub fn events(
        &self,
        space: Option<&str>,
        after: Option<&str>,
        limit: u32,
    ) -> Result<Value, HostError> {
        self.services.events(space, after, limit)
    }

    /// Grant `clock`: epoch milliseconds from the command context's clock.
    ///
    /// # Errors
    /// [`HostError::NotGranted`].
    pub fn now_ms(&self) -> Result<i64, HostError> {
        self.services.now_ms()
    }

    /// Grant `random`: the command context's random source, in `[0, 1)`.
    ///
    /// # Errors
    /// [`HostError::NotGranted`].
    pub fn random(&self) -> Result<f64, HostError> {
        self.services.random()
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

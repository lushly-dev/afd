//! Plugin errors: the `PLUGIN_*`, `PACK_*` and `SKILL_*` codes of the phase 1 specification,
//! section 9.3. Every error carries a suggestion.

use std::fmt;

use afd::{CommandError, CommandResult};

/// The Umbel package codes of the plugin contract. They do not join AFD's shared catalog.
pub mod codes {
    /// A source does not resolve.
    pub const PLUGIN_NOT_FOUND: &str = "PLUGIN_NOT_FOUND";
    /// The manifest breaks a rule; the message names the key.
    pub const PLUGIN_MANIFEST_INVALID: &str = "PLUGIN_MANIFEST_INVALID";
    /// The manifest version, protocol or WIT major version is not served.
    pub const PLUGIN_PROTOCOL_UNSUPPORTED: &str = "PLUGIN_PROTOCOL_UNSUPPORTED";
    /// The host was built without that loader.
    pub const PLUGIN_KIND_UNAVAILABLE: &str = "PLUGIN_KIND_UNAVAILABLE";
    /// The instance configuration fails the schema, or a kind rule.
    pub const PLUGIN_CONFIG_INVALID: &str = "PLUGIN_CONFIG_INVALID";
    /// A grant this host does not provide yet.
    pub const PLUGIN_GRANT_UNAVAILABLE: &str = "PLUGIN_GRANT_UNAVAILABLE";
    /// A required grant is in `deny`.
    pub const PLUGIN_GRANT_DENIED: &str = "PLUGIN_GRANT_DENIED";
    /// A component imports something no grant allows.
    pub const PLUGIN_IMPORT_DENIED: &str = "PLUGIN_IMPORT_DENIED";
    /// A name is taken; the message names both owners.
    pub const PLUGIN_CONFLICT: &str = "PLUGIN_CONFLICT";
    /// Compilation, linking or the mount's connection failed.
    pub const PLUGIN_LOAD_FAILED: &str = "PLUGIN_LOAD_FAILED";
    /// The call's space is not one of the instance's spaces.
    pub const PLUGIN_NOT_ENABLED: &str = "PLUGIN_NOT_ENABLED";
    /// A component trapped.
    pub const PLUGIN_TRAPPED: &str = "PLUGIN_TRAPPED";
    /// A per-call limit was reached; `details.limit` names it.
    pub const PLUGIN_LIMIT_EXCEEDED: &str = "PLUGIN_LIMIT_EXCEEDED";
    /// A component returned something that is not a `CommandResult`.
    pub const PLUGIN_RESULT_INVALID: &str = "PLUGIN_RESULT_INVALID";
    /// A mounted tool answered `isError: true`.
    pub const PLUGIN_TOOL_ERROR: &str = "PLUGIN_TOOL_ERROR";
    /// A mounted tool skipped at load because no command name could be made (a diagnostic).
    pub const PLUGIN_TOOL_UNNAMEABLE: &str = "PLUGIN_TOOL_UNNAMEABLE";
    /// A mounted tool skipped at load because no checkable schema could be made (a diagnostic).
    pub const PLUGIN_TOOL_SCHEMA_UNSUPPORTED: &str = "PLUGIN_TOOL_SCHEMA_UNSUPPORTED";
    /// A mounted server is not reachable now.
    pub const PLUGIN_UNAVAILABLE: &str = "PLUGIN_UNAVAILABLE";
    /// A pack or override breaks a rule.
    pub const PACK_INVALID: &str = "PACK_INVALID";
    /// A skill breaks a rule.
    pub const SKILL_INVALID: &str = "SKILL_INVALID";
}

/// A plugin rule that a manifest, an instance or a pack breaks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginError {
    code: &'static str,
    message: String,
    suggestion: String,
    retryable: bool,
    /// `details.limit` of a `PLUGIN_LIMIT_EXCEEDED`.
    limit: Option<&'static str>,
}

impl PluginError {
    fn new(code: &'static str, message: String, suggestion: String) -> Self {
        Self {
            code,
            message,
            suggestion,
            retryable: false,
            limit: None,
        }
    }

    /// The error code, one of [`codes`].
    pub fn code(&self) -> &str {
        self.code
    }

    /// What went wrong; names the file and the key at fault.
    pub fn message(&self) -> &str {
        &self.message
    }

    /// What the caller can do about it.
    pub fn suggestion(&self) -> &str {
        &self.suggestion
    }

    /// The error as AFD's [`CommandError`].
    pub fn to_command_error(&self) -> CommandError {
        let error = CommandError::new(self.code, &self.message)
            .with_suggestion(&self.suggestion)
            .with_retryable(self.retryable);
        match self.limit {
            Some(limit) => error.with_details(
                [(
                    "limit".to_owned(),
                    serde_json::Value::String(limit.to_owned()),
                )]
                .into(),
            ),
            None => error,
        }
    }

    /// The error as a failure [`CommandResult`].
    pub fn into_result<T>(self) -> CommandResult<T> {
        afd::failure(self.to_command_error())
    }

    /// `PLUGIN_MANIFEST_INVALID` naming `file` and the manifest `key`.
    pub(crate) fn manifest_invalid(file: &str, key: &str, problem: impl fmt::Display) -> Self {
        Self::new(
            codes::PLUGIN_MANIFEST_INVALID,
            format!("{file}: `{key}` {problem}"),
            format!("Fix `{key}` in {file}: {problem}. Run umbel plugin check path=<dir>."),
        )
    }

    /// `PLUGIN_PROTOCOL_UNSUPPORTED` for a `manifest_version` or `protocol` this host does not
    /// serve.
    pub(crate) fn protocol_unsupported(file: &str, key: &str, found: impl fmt::Display) -> Self {
        Self::new(
            codes::PLUGIN_PROTOCOL_UNSUPPORTED,
            format!(
                "{file}: `{key}` is {found}; this umbel serves manifest {}, protocol {} and umbel:plugin@1.x",
                super::MANIFEST_VERSION,
                super::PLUGIN_PROTOCOL_VERSION
            ),
            "This umbel serves manifest 1, protocol 1 and umbel:plugin@1.x; rebuild the plugin against them or upgrade umbel.".to_owned(),
        )
    }

    /// `PLUGIN_NOT_FOUND` for the source of `instance`.
    pub(crate) fn not_found(instance: &str, problem: impl fmt::Display) -> Self {
        Self::new(
            codes::PLUGIN_NOT_FOUND,
            format!("plugins.{instance}: {problem}"),
            format!(
                "Check plugins.{instance}.source: compiled:<id> needs a binary built with that plugin; a path needs <dir>/umbel-plugin.toml."
            ),
        )
    }

    /// `PLUGIN_CONFLICT` for two owners of one name.
    pub(crate) fn conflict(problem: impl fmt::Display) -> Self {
        Self::new(
            codes::PLUGIN_CONFLICT,
            problem.to_string(),
            "Rename one of them, or disable one instance.".to_owned(),
        )
    }

    /// `PLUGIN_CONFIG_INVALID` for `instance`, naming the `key` (a dotted path or a JSON pointer).
    pub(crate) fn config_invalid(instance: &str, key: &str, problem: impl fmt::Display) -> Self {
        Self::new(
            codes::PLUGIN_CONFIG_INVALID,
            format!("plugins.{instance}: `{key}` {problem}"),
            format!("Fix `{key}` in the plugins.{instance} table of umbel.toml: {problem}."),
        )
    }

    /// `PLUGIN_GRANT_UNAVAILABLE` for a grant this host does not provide yet.
    pub(crate) fn grant_unavailable(
        instance: &str,
        grant: &str,
        problem: impl fmt::Display,
    ) -> Self {
        Self::new(
            codes::PLUGIN_GRANT_UNAVAILABLE,
            format!("plugins.{instance}: the grant `{grant}` {problem}"),
            format!(
                "Remove the grant `{grant}` from the manifest, or wait for the phase that adds it ({problem})."
            ),
        )
    }

    /// `PLUGIN_GRANT_DENIED` for a required grant that `deny` withholds.
    pub(crate) fn grant_denied(instance: &str, grant: &str) -> Self {
        Self::new(
            codes::PLUGIN_GRANT_DENIED,
            format!(
                "plugins.{instance}: the grant `{grant}` is required by the plugin and listed in `deny`"
            ),
            format!("Remove `{grant}` from plugins.{instance}.deny, or disable the plugin."),
        )
    }

    /// `PLUGIN_LOAD_FAILED` for `instance`: preparing the plugin failed.
    pub fn load_failed(instance: &str, problem: impl fmt::Display) -> Self {
        Self::new(
            codes::PLUGIN_LOAD_FAILED,
            format!("plugins.{instance}: {problem}"),
            "Run umbel plugin check path=<dir>; for a mount, check that its server starts."
                .to_owned(),
        )
    }

    /// `PLUGIN_UNAVAILABLE` for `instance`: its mounted server is not reachable now. Retryable,
    /// and never retried by the host, because the call may have run.
    #[cfg_attr(not(feature = "mounted"), allow(dead_code))]
    pub(crate) fn unavailable(instance: &str, problem: impl fmt::Display) -> Self {
        let mut error = Self::new(
            codes::PLUGIN_UNAVAILABLE,
            format!("plugins.{instance}: {problem}"),
            format!("Retry; if it persists, run umbel plugin show plugin={instance}."),
        );
        error.retryable = true;
        error
    }

    /// `PLUGIN_LIMIT_EXCEEDED` for `instance`: the per-call limit `limit` (`details.limit`) was
    /// reached.
    #[cfg_attr(not(feature = "mounted"), allow(dead_code))]
    pub(crate) fn limit_exceeded(
        instance: &str,
        limit: &'static str,
        problem: impl fmt::Display,
    ) -> Self {
        let mut error = Self::new(
            codes::PLUGIN_LIMIT_EXCEEDED,
            format!("plugins.{instance}: {problem}"),
            format!(
                "Raise plugins.{instance}.max_result_bytes within the host cap, or reduce the input."
            ),
        );
        error.limit = Some(limit);
        error
    }

    /// `PLUGIN_LIMIT_EXCEEDED` for a component call: a per-call limit of section 6.2 stopped it.
    #[cfg_attr(not(feature = "component"), allow(dead_code))]
    pub(crate) fn component_limit(
        instance: &str,
        limit: &'static str,
        problem: impl fmt::Display,
    ) -> Self {
        let mut error = Self::new(
            codes::PLUGIN_LIMIT_EXCEEDED,
            format!("plugins.{instance}: {problem}"),
            format!(
                "Raise plugins.{instance}.limits.{limit} within the host cap, or reduce the input."
            ),
        );
        error.limit = Some(limit);
        error
    }

    /// `PLUGIN_IMPORT_DENIED`: a component imports something no grant allows. `grant` is the
    /// grant that would allow it, when there is one.
    #[cfg_attr(not(feature = "component"), allow(dead_code))]
    pub(crate) fn import_denied(instance: &str, import: &str, grant: Option<&str>) -> Self {
        let (why, suggestion) = match grant {
            Some(grant) => (
                format!(
                    "needs the grant `{grant}`, which the instance does not hold (it is not declared in the manifest, or the instance denies it)"
                ),
                format!(
                    "Declare the grant {grant} in umbel-plugin.toml, or rebuild without {import}."
                ),
            ),
            None => (
                "is not provided to components: no grant allows it".to_owned(),
                format!("Rebuild the component without {import}."),
            ),
        };
        Self::new(
            codes::PLUGIN_IMPORT_DENIED,
            format!("plugins.{instance}: the component imports `{import}`, which {why}"),
            suggestion,
        )
    }

    /// `PLUGIN_PROTOCOL_UNSUPPORTED` for a component built against a world this host does not
    /// serve.
    #[cfg_attr(not(feature = "component"), allow(dead_code))]
    pub(crate) fn world_unsupported(instance: &str, problem: impl fmt::Display) -> Self {
        Self::new(
            codes::PLUGIN_PROTOCOL_UNSUPPORTED,
            format!("plugins.{instance}: {problem}"),
            "This umbel serves manifest 1, protocol 1 and umbel:plugin@1.x; rebuild the plugin against them or upgrade umbel.".to_owned(),
        )
    }

    /// `PLUGIN_TRAPPED`: a component trapped during a call.
    #[cfg_attr(not(feature = "component"), allow(dead_code))]
    pub(crate) fn trapped(instance: &str, problem: impl fmt::Display) -> Self {
        Self::new(
            codes::PLUGIN_TRAPPED,
            format!("plugins.{instance}: the component trapped: {problem}"),
            "The plugin failed; report it to its author with the trace id.".to_owned(),
        )
    }

    /// `PLUGIN_RESULT_INVALID`: a component returned something that is not a `CommandResult`.
    #[cfg_attr(not(feature = "component"), allow(dead_code))]
    pub(crate) fn result_invalid(instance: &str, problem: impl fmt::Display) -> Self {
        Self::new(
            codes::PLUGIN_RESULT_INVALID,
            format!("plugins.{instance}: the component returned something that is not a CommandResult: {problem}"),
            "The plugin failed; report it to its author with the trace id.".to_owned(),
        )
    }

    /// `PLUGIN_KIND_UNAVAILABLE`: this build has no loader for the plugin's kind.
    pub(crate) fn kind_unavailable(instance: &str, kind: impl fmt::Display) -> Self {
        Self::new(
            codes::PLUGIN_KIND_UNAVAILABLE,
            format!("plugins.{instance}: this build has no loader for `{kind}` plugins"),
            "Build umbel with the component or mounted feature.".to_owned(),
        )
    }

    /// `PLUGIN_NOT_ENABLED`: the call's space is not one of the instance's spaces.
    pub(crate) fn not_enabled(instance: &str, space: &str, spaces: &[String]) -> Self {
        Self::new(
            codes::PLUGIN_NOT_ENABLED,
            format!(
                "plugins.{instance} is not enabled for the space `{space}`; it is enabled for: {}",
                spaces.join(", ")
            ),
            format!(
                "Call it in one of {}, or add the space to plugins.{instance}.spaces.",
                spaces.join(", ")
            ),
        )
    }

    /// `PACK_INVALID` naming the pack `path`.
    pub(crate) fn pack_invalid(path: &str, problem: impl fmt::Display) -> Self {
        Self::new(
            codes::PACK_INVALID,
            format!("{path}: the pack {problem}"),
            format!("Fix the pack at {path}: {problem}."),
        )
    }

    /// `SKILL_INVALID` naming the skill `path`.
    pub(crate) fn skill_invalid(path: &str, problem: impl fmt::Display) -> Self {
        Self::new(
            codes::SKILL_INVALID,
            format!("{path}: the skill {problem}"),
            format!("Fix the skill at {path}: {problem}."),
        )
    }
}

impl fmt::Display for PluginError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for PluginError {}

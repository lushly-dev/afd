//! Error types for AFD commands.
//!
//! Errors should be actionable - they tell the user what went wrong
//! AND what they can do about it.

use serde::{de, Deserialize, Deserializer, Serialize};
use std::collections::{HashMap, HashSet};
use std::fmt::{self, Display};

/// The kinds of [`Recovery`], in `spec/recovery.md` order.
pub const RECOVERY_KINDS: &[&str] = &["call", "fix-input", "retry", "external", "stop"];

/// The largest `afterMs`, 2^53 − 1: the schema's maximum, and the largest whole number every
/// language reads exactly (a double holds it, so `30000.0`-style values up to it read exactly).
pub const MAX_AFTER_MS: u64 = 9_007_199_254_740_991;

const MAX_EXACT_WHOLE_FLOAT: f64 = 9_007_199_254_740_991.0;

/// The step a failed command's `suggestion` describes, in a form a program can follow and a test
/// can check (`spec/recovery.md`). It sits beside the prose `suggestion`, never in its place:
/// agents read the prose, and tools and tests read this.
///
/// Each kind carries only the fields that belong to it (rule 4), so a recovery that puts
/// `command` on a `retry` or `afterMs` on a `call` cannot be built. It serializes as the spec's
/// object: `{"kind": "call", "command": "lane-resume", "thenRetry": true}`, with unset fields
/// omitted.
///
/// # Building one
///
/// Every variant is `#[non_exhaustive]`, so code outside this crate builds a recovery only through
/// its constructors, and a field added to a kind later breaks no caller. The constructors refuse
/// what `spec/schema/error.json`'s `$defs/recovery` refuses ([`InvalidRecovery`]): an empty
/// `command`; an empty `input` or one carrying `confirm` (rule 5); an empty `needs`, or one with an
/// empty or repeated name; and a `fix-input` with neither `input` nor `needs`. The fields stay
/// public to read by pattern (`Recovery::Call { command, .. }`); a value changed through a `&mut`
/// pattern is not checked again, and [`Recovery::validate`] checks it.
///
/// # Reading one
///
/// Reading checks the same rules, as JSON Schema reads them: `afterMs` is a whole number of at
/// least 0, and `30000.0` reads as `30000` (written with a fraction part, up to 2^53 − 1), while
/// `"30000"`, `true` and `1.5` are refused, as are an unknown member and a `null` one. A
/// [`CommandError`] whose recovery is refused reads as having none, with the rest of the error kept
/// (rule 7).
///
/// New kinds may be added without a breaking change, so a `match` needs a wildcard arm.
///
/// # Example
///
/// ```rust
/// use afd::{CommandError, Recovery};
///
/// let error = CommandError::new("ALREADY_CLAIMED", "Issue #205 is claimed")
///     .with_suggestion("Take another issue from issue-check's dispatchable list")
///     .with_recovery(Recovery::call("issue-check")?);
/// assert_eq!(
///     serde_json::to_value(&error.recovery).unwrap(),
///     serde_json::json!({ "kind": "call", "command": "issue-check" })
/// );
/// assert!(Recovery::call("").is_err());
/// # Ok::<(), afd::InvalidRecovery>(())
/// ```
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", try_from = "RawRecovery")]
#[non_exhaustive]
pub enum Recovery {
    /// Call `command`. With `then_retry`, the call fixes what refused the original, so the
    /// original call is repeated after it succeeds; without it, the call is the way forward.
    /// Built with [`Recovery::call`] or [`Recovery::call_with`].
    #[serde(rename_all = "camelCase")]
    #[non_exhaustive]
    Call {
        /// The command to call next, by its registered name: one the caller can call on the
        /// surface that returned the error (rule 2). Never empty.
        command: String,
        /// Arguments for `command` that are known to work (rule 3). At least one member, never
        /// `confirm` (rule 5).
        #[serde(skip_serializing_if = "Option::is_none")]
        input: Option<HashMap<String, serde_json::Value>>,
        /// Top-level input fields of `command` the caller must choose: at least one, distinct and
        /// non-empty, and never in `input`.
        #[serde(skip_serializing_if = "Option::is_none")]
        needs: Option<Vec<String>>,
        /// Once `command` succeeds, repeat the failed call unchanged.
        #[serde(skip_serializing_if = "Option::is_none")]
        then_retry: Option<bool>,
    },
    /// Call the same command again with changed input. Built with [`Recovery::fix_input`].
    #[serde(rename_all = "camelCase")]
    #[non_exhaustive]
    FixInput {
        /// Replacement values for the failed call's input that are known to fix it (rule 3). At
        /// least one member, never `confirm` (rule 5).
        #[serde(skip_serializing_if = "Option::is_none")]
        input: Option<HashMap<String, serde_json::Value>>,
        /// Top-level input fields the caller must choose: at least one, distinct and non-empty,
        /// and never in `input`. At least one of `input` and `needs` is set.
        #[serde(skip_serializing_if = "Option::is_none")]
        needs: Option<Vec<String>>,
    },
    /// Call the same command again with the same input, after `after_ms`. Only for a transient
    /// failure: the error **must** set `retryable: true`. Built with [`Recovery::retry`].
    #[serde(rename_all = "camelCase")]
    #[non_exhaustive]
    Retry {
        /// Wait at least this many milliseconds before repeating the call.
        #[serde(skip_serializing_if = "Option::is_none")]
        after_ms: Option<u64>,
    },
    /// The step is outside the command surface (a configuration change, a person's decision, a
    /// shell command); the suggestion says what. Built with [`Recovery::external`].
    #[non_exhaustive]
    External {},
    /// No step makes this call succeed; do something else. The error **must not** set
    /// `retryable: true`. Built with [`Recovery::stop`].
    #[non_exhaustive]
    Stop {},
}

impl Recovery {
    /// A `call` recovery to `command`, with no input, needs or retry. Refused when `command` is
    /// empty.
    pub fn call(command: impl Into<String>) -> Result<Self, InvalidRecovery> {
        Self::call_with(command, None, None, None)
    }

    /// A `call` recovery with every field: `input` holds arguments known to work, `needs` the
    /// fields the caller must choose, and `then_retry` repeats the failed call once `command`
    /// succeeds. Refused when it breaks `$defs/recovery` (see [`Recovery`]).
    pub fn call_with(
        command: impl Into<String>,
        input: Option<HashMap<String, serde_json::Value>>,
        needs: Option<Vec<String>>,
        then_retry: Option<bool>,
    ) -> Result<Self, InvalidRecovery> {
        Self::Call {
            command: command.into(),
            input,
            needs,
            then_retry,
        }
        .checked()
    }

    /// A `fix-input` recovery: `input` replaces members of the failed call's input and `needs`
    /// names the fields the caller must choose. Refused unless at least one is set, or when
    /// either breaks `$defs/recovery` (see [`Recovery`]).
    pub fn fix_input(
        input: Option<HashMap<String, serde_json::Value>>,
        needs: Option<Vec<String>>,
    ) -> Result<Self, InvalidRecovery> {
        Self::FixInput { input, needs }.checked()
    }

    /// A `retry` recovery, waiting at least `after_ms` milliseconds when it is set. A wait above
    /// [`MAX_AFTER_MS`] is refused.
    pub fn retry(after_ms: Option<u64>) -> Result<Self, InvalidRecovery> {
        Self::Retry { after_ms }.checked()
    }

    /// An `external` recovery: the step is outside the command surface.
    pub fn external() -> Self {
        Self::External {}
    }

    /// A `stop` recovery: no step makes the call succeed.
    pub fn stop() -> Self {
        Self::Stop {}
    }

    /// The recovery's `kind` as written on the wire: one of [`RECOVERY_KINDS`].
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Call { .. } => "call",
            Self::FixInput { .. } => "fix-input",
            Self::Retry { .. } => "retry",
            Self::External {} => "external",
            Self::Stop {} => "stop",
        }
    }

    /// Check the recovery against `spec/schema/error.json`'s `$defs/recovery`. The constructors
    /// and the reader already do; this checks a value changed through a `&mut` pattern since.
    /// It does not check rule 3 (`needs` and `input` naming the same field), which the schema
    /// does not check either.
    pub fn validate(&self) -> Result<(), InvalidRecovery> {
        match self {
            Self::Call {
                command,
                input,
                needs,
                ..
            } => {
                if command.is_empty() {
                    return Err(InvalidRecovery::new("a call recovery names its command"));
                }
                check_input(input.as_ref())?;
                check_needs(needs.as_deref())
            }
            Self::FixInput { input, needs } => {
                if input.is_none() && needs.is_none() {
                    return Err(InvalidRecovery::new(
                        "a fix-input recovery sets input or needs",
                    ));
                }
                check_input(input.as_ref())?;
                check_needs(needs.as_deref())
            }
            Self::Retry { after_ms, .. } => match after_ms {
                Some(ms) if *ms > MAX_AFTER_MS => {
                    Err(InvalidRecovery::new("afterMs is at most 2^53 - 1"))
                }
                _ => Ok(()),
            },
            Self::External {} | Self::Stop {} => Ok(()),
        }
    }

    fn checked(self) -> Result<Self, InvalidRecovery> {
        self.validate()?;
        Ok(self)
    }

    /// A `call` recovery to an engine command (`spec/recovery.md`, "Engine errors"): `command` is
    /// one of the engine's own non-empty names, so the recovery is always valid.
    pub(crate) fn engine_call(command: &'static str, then_retry: bool) -> Self {
        Self::Call {
            command: command.to_owned(),
            input: None,
            needs: None,
            then_retry: then_retry.then_some(true),
        }
    }

    /// The `retry` recovery of an engine's `RATE_LIMITED`: `afterMs` is `seconds` × 1000 when the
    /// wait is known and fits `afterMs`'s range, and absent otherwise.
    pub(crate) fn engine_retry(seconds: Option<u64>) -> Self {
        let after_ms = seconds
            .and_then(|seconds| seconds.checked_mul(1000))
            .filter(|ms| *ms <= MAX_AFTER_MS);
        Self::Retry { after_ms }
    }
}

fn check_input(input: Option<&HashMap<String, serde_json::Value>>) -> Result<(), InvalidRecovery> {
    match input {
        Some(input) if input.is_empty() => {
            Err(InvalidRecovery::new("input has at least one member"))
        }
        Some(input) if input.contains_key("confirm") => Err(InvalidRecovery::new(
            "input never carries confirm, the acknowledgement of a confirmation (rule 5)",
        )),
        _ => Ok(()),
    }
}

fn check_needs(needs: Option<&[String]>) -> Result<(), InvalidRecovery> {
    let Some(needs) = needs else {
        return Ok(());
    };
    if needs.is_empty() {
        return Err(InvalidRecovery::new("needs names at least one field"));
    }
    let mut seen = HashSet::new();
    if !needs
        .iter()
        .all(|need| !need.is_empty() && seen.insert(need))
    {
        return Err(InvalidRecovery::new(
            "needs holds distinct, non-empty field names",
        ));
    }
    Ok(())
}

/// Why a [`Recovery`] breaks `spec/schema/error.json`'s `$defs/recovery`, from a constructor,
/// [`Recovery::validate`] or reading one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvalidRecovery {
    reason: &'static str,
}

impl InvalidRecovery {
    fn new(reason: &'static str) -> Self {
        Self { reason }
    }

    /// The rule the recovery breaks, in words.
    pub fn reason(&self) -> &'static str {
        self.reason
    }
}

impl Display for InvalidRecovery {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "invalid recovery: {}", self.reason)
    }
}

impl std::error::Error for InvalidRecovery {}

/// A recovery as read from the wire, before its fields are checked against its kind. Every member
/// is read as its schema type, with no coercion: `"30000"` is not a number and `"true"` not a
/// boolean.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawRecovery {
    kind: String,
    #[serde(default, deserialize_with = "present")]
    command: Option<String>,
    #[serde(default, deserialize_with = "present")]
    input: Option<HashMap<String, serde_json::Value>>,
    #[serde(default, deserialize_with = "present")]
    needs: Option<Vec<String>>,
    #[serde(default, deserialize_with = "present")]
    then_retry: Option<bool>,
    #[serde(default, deserialize_with = "present")]
    after_ms: Option<WholeMillis>,
}

/// An optional field that, when present, holds a value of its type: `null` is refused, as the
/// schema refuses it, rather than read as absent.
fn present<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

/// `afterMs` read as JSON Schema reads `"type": "integer", "minimum": 0, "maximum": 2^53 − 1`: a
/// whole number from 0 to 2^53 − 1, written as `30000` or `30000.0`. A string, a boolean, a
/// fraction, a negative number and a larger number are refused.
struct WholeMillis(u64);

impl<'de> Deserialize<'de> for WholeMillis {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Visitor;

        impl de::Visitor<'_> for Visitor {
            type Value = WholeMillis;

            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("a whole number of milliseconds, at least 0")
            }

            fn visit_u64<E: de::Error>(self, value: u64) -> Result<WholeMillis, E> {
                if value <= MAX_AFTER_MS {
                    Ok(WholeMillis(value))
                } else {
                    Err(E::invalid_value(de::Unexpected::Unsigned(value), &self))
                }
            }

            fn visit_i64<E: de::Error>(self, value: i64) -> Result<WholeMillis, E> {
                u64::try_from(value)
                    .ok()
                    .filter(|ms| *ms <= MAX_AFTER_MS)
                    .map(WholeMillis)
                    .ok_or_else(|| E::invalid_value(de::Unexpected::Signed(value), &self))
            }

            fn visit_f64<E: de::Error>(self, value: f64) -> Result<WholeMillis, E> {
                if value.fract() == 0.0 && (0.0..=MAX_EXACT_WHOLE_FLOAT).contains(&value) {
                    // Exact: a whole number in 0..=2^53 − 1 converts without rounding.
                    Ok(WholeMillis(value as u64))
                } else {
                    Err(E::invalid_value(de::Unexpected::Float(value), &self))
                }
            }
        }

        deserializer.deserialize_any(Visitor)
    }
}

impl TryFrom<RawRecovery> for Recovery {
    type Error = InvalidRecovery;

    fn try_from(raw: RawRecovery) -> Result<Self, Self::Error> {
        let RawRecovery {
            kind,
            command,
            input,
            needs,
            then_retry,
            after_ms,
        } = raw;
        let set = [
            ("command", command.is_some()),
            ("input", input.is_some()),
            ("needs", needs.is_some()),
            ("thenRetry", then_retry.is_some()),
            ("afterMs", after_ms.is_some()),
        ];
        // Rule 4: a member on a kind it does not belong to is refused, not ignored.
        let only = |allowed: &[&str]| {
            if set
                .iter()
                .any(|(name, is_set)| *is_set && !allowed.contains(name))
            {
                Err(InvalidRecovery::new(
                    "command and thenRetry belong to call, afterMs to retry, and input and needs \
                     to call and fix-input (rule 4)",
                ))
            } else {
                Ok(())
            }
        };
        let recovery = match kind.as_str() {
            "call" => {
                only(&["command", "input", "needs", "thenRetry"])?;
                Self::Call {
                    command: command
                        .ok_or_else(|| InvalidRecovery::new("a call recovery names its command"))?,
                    input,
                    needs,
                    then_retry,
                }
            }
            "fix-input" => {
                only(&["input", "needs"])?;
                Self::FixInput { input, needs }
            }
            "retry" => {
                only(&["afterMs"])?;
                Self::Retry {
                    after_ms: after_ms.map(|WholeMillis(ms)| ms),
                }
            }
            "external" => {
                only(&[])?;
                Self::External {}
            }
            "stop" => {
                only(&[])?;
                Self::Stop {}
            }
            _ => {
                return Err(InvalidRecovery::new(
                    "kind is one of call, fix-input, retry, external, stop",
                ))
            }
        };
        recovery.checked()
    }
}

/// Reads `CommandError.recovery` leniently (`spec/recovery.md`, rule 7): a recovery that breaks
/// `$defs/recovery` (an unknown kind or member, a `null` member, a member of the wrong type or on
/// the wrong kind, a value out of range) is no recovery, and the rest of the error still reads.
fn read_recovery_leniently<'de, D>(deserializer: D) -> Result<Option<Box<Recovery>>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(serde_json::from_value(value).ok())
}

/// Standard error structure for command failures.
///
/// All errors should be actionable - users should know what to do next.
///
/// # Example
///
/// ```rust
/// use afd::CommandError;
///
/// let error = CommandError::new("RATE_LIMITED", "API rate limit exceeded")
///     .with_suggestion("Wait 60 seconds and try again")
///     .with_retryable(true);
/// assert_eq!(error.to_string(), "RATE_LIMITED: API rate limit exceeded");
/// ```
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct CommandError {
    /// Machine-readable error code.
    ///
    /// Use SCREAMING_SNAKE_CASE for consistency.
    /// Should be unique within your application.
    pub code: String,

    /// Human-readable error message.
    ///
    /// Should be clear and concise, describing what went wrong.
    pub message: String,

    /// What the user can do about this error.
    ///
    /// This is the most important field for UX - it turns an error
    /// from a dead-end into a recoverable situation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggestion: Option<String>,

    /// Whether retrying the same request might succeed.
    ///
    /// - `true`: Transient error, retry may work (rate limits, timeouts)
    /// - `false`: Permanent error, retry won't help (not found, validation)
    /// - `None`: Unknown, treat as non-retryable
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retryable: Option<bool>,

    /// The step `suggestion` describes, in a form a program can follow and a test can check
    /// (`spec/recovery.md`). Set `suggestion` too: agents read the prose.
    ///
    /// A `retry` recovery needs `retryable: Some(true)`, and a `stop` recovery must not have it.
    /// An error read from the wire whose recovery breaks `$defs/recovery` has `None` here (rule 7).
    /// Boxed, as `cause` is, so an error without one stays small.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "read_recovery_leniently"
    )]
    pub recovery: Option<Box<Recovery>>,

    /// Additional technical details for debugging.
    ///
    /// May include stack traces, request IDs, timestamps, etc.
    /// Avoid exposing sensitive information.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<HashMap<String, serde_json::Value>>,

    /// Original error that caused this error, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cause: Option<Box<CommandError>>,
}

impl fmt::Display for CommandError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for CommandError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        self.cause
            .as_deref()
            .map(|cause| cause as &(dyn std::error::Error + 'static))
    }
}

impl CommandError {
    /// Create a new CommandError with standard fields.
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            suggestion: None,
            retryable: None,
            recovery: None,
            details: None,
            cause: None,
        }
    }

    /// Add a suggestion to the error.
    pub fn with_suggestion(mut self, suggestion: impl Into<String>) -> Self {
        self.suggestion = Some(suggestion.into());
        self
    }

    /// Set whether the error is retryable.
    pub fn with_retryable(mut self, retryable: bool) -> Self {
        self.retryable = Some(retryable);
        self
    }

    /// Set the structured step the suggestion describes (`spec/recovery.md`).
    pub fn with_recovery(mut self, recovery: Recovery) -> Self {
        self.recovery = Some(Box::new(recovery));
        self
    }

    /// Add details to the error.
    pub fn with_details(mut self, details: HashMap<String, serde_json::Value>) -> Self {
        self.details = Some(details);
        self
    }

    /// Set the error that caused this one.
    pub fn with_cause(mut self, cause: CommandError) -> Self {
        self.cause = Some(Box::new(cause));
        self
    }

    /// Create a not found error.
    ///
    /// # Example
    ///
    /// ```rust
    /// use afd::CommandError;
    ///
    /// let error = CommandError::not_found("Todo", "123");
    /// assert_eq!(error.code, "NOT_FOUND");
    /// ```
    pub fn not_found(resource: &str, id: &str) -> Self {
        let mut details = HashMap::new();
        details.insert("resourceType".to_string(), serde_json::json!(resource));
        details.insert("resourceId".to_string(), serde_json::json!(id));

        Self {
            code: "NOT_FOUND".to_string(),
            message: format!("{} with ID '{}' not found", resource, id),
            suggestion: Some(format!(
                "Verify the {} ID exists and try again",
                resource.to_lowercase()
            )),
            retryable: Some(false),
            recovery: None,
            details: Some(details),
            cause: None,
        }
    }

    /// Create a validation error.
    ///
    /// # Example
    ///
    /// ```rust
    /// use afd::CommandError;
    ///
    /// let error = CommandError::validation("Invalid email format", Some("Use a valid email address"));
    /// assert_eq!(error.code, "VALIDATION_ERROR");
    /// ```
    pub fn validation(message: &str, suggestion: Option<&str>) -> Self {
        Self {
            code: "VALIDATION_ERROR".to_string(),
            message: message.to_string(),
            suggestion: suggestion.map(|s| s.to_string()),
            retryable: Some(false),
            recovery: None,
            details: None,
            cause: None,
        }
    }

    /// Create a rate limit error, with a `retry` recovery whose `afterMs` is the wait in
    /// milliseconds when it is given (`spec/recovery.md`, "Engine errors").
    pub fn rate_limited(retry_after_seconds: Option<u32>) -> Self {
        let suggestion = match retry_after_seconds {
            Some(secs) => format!("Wait {} seconds and try again", secs),
            None => "Wait a moment and try again".to_string(),
        };

        let details = retry_after_seconds.map(|secs| {
            let mut d = HashMap::new();
            d.insert("retryAfterSeconds".to_string(), serde_json::json!(secs));
            d
        });

        Self {
            code: "RATE_LIMITED".to_string(),
            message: "Rate limit exceeded".to_string(),
            suggestion: Some(suggestion),
            retryable: Some(true),
            recovery: Some(Box::new(Recovery::engine_retry(
                retry_after_seconds.map(u64::from),
            ))),
            details,
            cause: None,
        }
    }

    /// Create a timeout error.
    pub fn timeout(operation_name: &str, timeout_ms: u64) -> Self {
        let mut details = HashMap::new();
        details.insert(
            "operationName".to_string(),
            serde_json::json!(operation_name),
        );
        details.insert("timeoutMs".to_string(), serde_json::json!(timeout_ms));

        Self {
            code: "TIMEOUT".to_string(),
            message: format!(
                "Operation '{}' timed out after {}ms",
                operation_name, timeout_ms
            ),
            suggestion: Some(
                "Try again with a simpler request or contact support if this persists".to_string(),
            ),
            retryable: Some(true),
            recovery: None,
            details: Some(details),
            cause: None,
        }
    }

    /// Create an internal error.
    pub fn internal(message: &str) -> Self {
        Self {
            code: "INTERNAL_ERROR".to_string(),
            message: message.to_string(),
            suggestion: Some("Please try again. If this persists, contact support.".to_string()),
            retryable: Some(true),
            recovery: None,
            details: None,
            cause: None,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STANDARD ERROR CODES
// ═══════════════════════════════════════════════════════════════════════════════

/// Standard error codes for common scenarios.
///
/// Use these for consistency across AFD applications. This is the shared
/// catalog in `spec/error-codes.md`: TypeScript, Python and C++ define the same
/// codes.
pub mod error_codes {
    // Validation Errors (4xx range)
    /// Input failed schema or semantic validation.
    pub const VALIDATION_ERROR: &str = "VALIDATION_ERROR";
    /// Input value is invalid for the operation.
    pub const INVALID_INPUT: &str = "INVALID_INPUT";
    /// A required input field was omitted.
    pub const MISSING_REQUIRED_FIELD: &str = "MISSING_REQUIRED_FIELD";
    /// An input value does not match its expected format.
    pub const INVALID_FORMAT: &str = "INVALID_FORMAT";

    // Resource Errors
    /// The requested resource was not found.
    pub const NOT_FOUND: &str = "NOT_FOUND";
    /// A resource with the same identity already exists.
    pub const ALREADY_EXISTS: &str = "ALREADY_EXISTS";
    /// The operation conflicts with the resource's current state.
    pub const CONFLICT: &str = "CONFLICT";

    // Authorization Errors
    /// The caller is not authenticated.
    pub const UNAUTHORIZED: &str = "UNAUTHORIZED";
    /// The authenticated caller lacks permission for the operation.
    pub const FORBIDDEN: &str = "FORBIDDEN";
    /// The caller's authentication token has expired.
    pub const TOKEN_EXPIRED: &str = "TOKEN_EXPIRED";

    // Rate Limiting
    /// The caller exceeded the allowed request rate.
    pub const RATE_LIMITED: &str = "RATE_LIMITED";
    /// The caller exceeded an allocated usage quota.
    pub const QUOTA_EXCEEDED: &str = "QUOTA_EXCEEDED";

    // Network/Service Errors
    /// A downstream dependency or service is unavailable.
    pub const SERVICE_UNAVAILABLE: &str = "SERVICE_UNAVAILABLE";
    /// The operation exceeded its deadline.
    pub const TIMEOUT: &str = "TIMEOUT";
    /// A network connection could not be established or was lost.
    pub const CONNECTION_ERROR: &str = "CONNECTION_ERROR";

    // Internal Errors
    /// An unexpected internal failure occurred.
    pub const INTERNAL_ERROR: &str = "INTERNAL_ERROR";
    /// The requested capability is not implemented.
    pub const NOT_IMPLEMENTED: &str = "NOT_IMPLEMENTED";
    /// An unclassified error occurred.
    pub const UNKNOWN_ERROR: &str = "UNKNOWN_ERROR";

    // Command-specific
    /// No registered command matches the requested name.
    pub const COMMAND_NOT_FOUND: &str = "COMMAND_NOT_FOUND";
    /// Command arguments were malformed or incompatible.
    pub const INVALID_COMMAND_ARGS: &str = "INVALID_COMMAND_ARGS";
    /// Command execution was cancelled before completion.
    pub const COMMAND_CANCELLED: &str = "COMMAND_CANCELLED";
    /// A command handler crashed (panicked) instead of returning a result.
    /// See [`execution_failure`](crate::execution_failure).
    pub const COMMAND_EXECUTION_ERROR: &str = "COMMAND_EXECUTION_ERROR";
    /// The command exists but is not exposed to the calling interface.
    pub const COMMAND_NOT_EXPOSED: &str = "COMMAND_NOT_EXPOSED";
    /// The command exists but is not available in the active context.
    pub const COMMAND_NOT_IN_CONTEXT: &str = "COMMAND_NOT_IN_CONTEXT";
    /// A client's allow-list does not include the command.
    pub const COMMAND_NOT_ALLOWED: &str = "COMMAND_NOT_ALLOWED";
    /// An in-process client was asked for a command it cannot call.
    pub const UNKNOWN_TOOL: &str = "UNKNOWN_TOOL";
    /// A grouped tool's action matches more than one command.
    pub const AMBIGUOUS_ACTION: &str = "AMBIGUOUS_ACTION";
    /// A grouped tool was called without a valid `action`.
    pub const INVALID_GROUPED_CALL: &str = "INVALID_GROUPED_CALL";

    // Contexts
    /// Entering or exiting a context needs a session.
    pub const SESSION_REQUIRED: &str = "SESSION_REQUIRED";
    /// The requested context is not configured.
    pub const CONTEXT_NOT_FOUND: &str = "CONTEXT_NOT_FOUND";
    /// The context stack is full.
    pub const CONTEXT_DEPTH_EXCEEDED: &str = "CONTEXT_DEPTH_EXCEEDED";

    // Batch and pipeline
    /// The batch envelope is malformed or empty.
    pub const INVALID_BATCH_REQUEST: &str = "INVALID_BATCH_REQUEST";
    /// The batch deadline passed before the command finished.
    pub const BATCH_TIMEOUT: &str = "BATCH_TIMEOUT";
    /// A batch stopped after a failure before running the command.
    pub const COMMAND_SKIPPED: &str = "COMMAND_SKIPPED";
    /// The pipeline envelope is malformed.
    pub const INVALID_PIPELINE_REQUEST: &str = "INVALID_PIPELINE_REQUEST";
    /// The pipeline deadline passed.
    pub const PIPELINE_TIMEOUT: &str = "PIPELINE_TIMEOUT";
    /// The request uses an option this build does not support.
    pub const UNSUPPORTED_OPTION: &str = "UNSUPPORTED_OPTION";

    // Streaming
    /// The caller aborted the stream.
    pub const STREAM_ABORTED: &str = "STREAM_ABORTED";
    /// The stream deadline passed.
    pub const STREAM_TIMEOUT: &str = "STREAM_TIMEOUT";
    /// The stream executor failed outside the command.
    pub const STREAM_ERROR: &str = "STREAM_ERROR";
    /// A stream ended without a complete or error chunk.
    pub const STREAM_ENDED_UNEXPECTEDLY: &str = "STREAM_ENDED_UNEXPECTEDLY";
    /// A streamed command failed without an error of its own.
    pub const COMMAND_FAILED: &str = "COMMAND_FAILED";
    /// The command declares `confirm_prompt` and the call carried no accepted confirmation.
    pub const CONFIRMATION_REQUIRED: &str = "CONFIRMATION_REQUIRED";
    /// The user declined or cancelled the confirmation.
    pub const CONFIRMATION_DECLINED: &str = "CONFIRMATION_DECLINED";
    /// The command's approval policy requires a human's approval and the call carried no
    /// valid approval token.
    pub const APPROVAL_REQUIRED: &str = "APPROVAL_REQUIRED";
    /// The command declares an approval policy other than `not-required`, and the server has no
    /// approval step that admitted the call, so nothing ran: [`CommandRegistry::execute`](crate::CommandRegistry::execute)
    /// answers it before the handler, with `details.reason` `no-approval-step` or
    /// `admission-mismatch`.
    pub const APPROVAL_UNAVAILABLE: &str = "APPROVAL_UNAVAILABLE";
    /// A command's successful result was larger than the call's output budget
    /// (`spec/output-budgets.md`, B5): a read fails with it, a mutation keeps its result and
    /// carries it as a warning's code.
    pub const OUTPUT_BUDGET_EXCEEDED: &str = "OUTPUT_BUDGET_EXCEEDED";
    /// The caller's token lacks a scope the call needs, found after routing
    /// (`spec/authorization.md`, M6): `details.scopes` lists every missing scope. Over HTTP the
    /// same case is usually an HTTP 403 before dispatch instead.
    pub const INSUFFICIENT_SCOPE: &str = "INSUFFICIENT_SCOPE";
    /// A task was still working when the token that started it expired, so it was stopped and
    /// completes with this failure (`spec/command-metadata.md`, "Tasks"): start it again with a
    /// new token. Retryable unless the command is a mutation whose handler started, which may
    /// have made its change.
    pub const TASK_TOKEN_EXPIRED: &str = "TASK_TOKEN_EXPIRED";
    /// An app's call (the `apps` interface) to a command it may not call: the command does not
    /// exist, does not set `expose.apps`, or the registry's call grant does not grant it
    /// (`spec/command-metadata.md`, "App-to-app calls"). One answer for every case.
    pub const CALL_NOT_GRANTED: &str = "CALL_NOT_GRANTED";
    /// The idempotency key is already held for a call with another input
    /// (`spec/idempotency.md`, "Errors"). No Rust engine sends it yet (#2676).
    pub const IDEMPOTENCY_KEY_REUSED: &str = "IDEMPOTENCY_KEY_REUSED";
    /// An earlier call with the same idempotency key and input is still running
    /// (`spec/idempotency.md`, "Errors"). No Rust engine sends it yet (#2676).
    pub const IDEMPOTENCY_IN_PROGRESS: &str = "IDEMPOTENCY_IN_PROGRESS";
    /// An earlier call may have run and nobody can say whether it was applied: a client's lost
    /// answer, or the idempotency step's never-settled reservation (`spec/idempotency.md`).
    pub const OUTCOME_UNKNOWN: &str = "OUTCOME_UNKNOWN";
}

/// Standard error code alias for parity with other AFD implementations.
pub type ErrorCode = String;

/// Reserved prefix for host-defined error codes (`spec/error-codes.md`, "Host-defined error codes").
/// AFD will never add a catalog code starting with this prefix.
pub const HOST_ERROR_CODE_PREFIX: &str = "HOST_";

/// Metadata for one entry in the shared error-code catalog (`spec/vectors/error-codes.json`).
///
/// `retryable` is `Some(true)` when always retryable, `Some(false)` when never retryable,
/// and `None` when retryability varies by emitting site (`"varies"`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ErrorCodeInfo {
    /// Machine-readable error code string.
    pub code: &'static str,
    /// `Some(true)` if retryable, `Some(false)` if not, or `None` when context-dependent.
    pub retryable: Option<bool>,
    /// Contract profile that defines this code (for example `core` or `server`).
    pub profile: &'static str,
}

/// The shared error-code catalog with retryability and contract profile, in catalog order
/// (`spec/error-codes.md`, `spec/vectors/error-codes.json`).
pub const ERROR_CODE_CATALOG: &[ErrorCodeInfo] = &[
    ErrorCodeInfo {
        code: error_codes::VALIDATION_ERROR,
        retryable: Some(false),
        profile: "core",
    },
    ErrorCodeInfo {
        code: error_codes::INVALID_INPUT,
        retryable: Some(false),
        profile: "core",
    },
    ErrorCodeInfo {
        code: error_codes::MISSING_REQUIRED_FIELD,
        retryable: Some(false),
        profile: "core",
    },
    ErrorCodeInfo {
        code: error_codes::INVALID_FORMAT,
        retryable: Some(false),
        profile: "core",
    },
    ErrorCodeInfo {
        code: error_codes::NOT_FOUND,
        retryable: Some(false),
        profile: "core",
    },
    ErrorCodeInfo {
        code: error_codes::ALREADY_EXISTS,
        retryable: Some(false),
        profile: "core",
    },
    ErrorCodeInfo {
        code: error_codes::CONFLICT,
        retryable: Some(false),
        profile: "core",
    },
    ErrorCodeInfo {
        code: error_codes::UNAUTHORIZED,
        retryable: Some(false),
        profile: "core",
    },
    ErrorCodeInfo {
        code: error_codes::FORBIDDEN,
        retryable: Some(false),
        profile: "core",
    },
    ErrorCodeInfo {
        code: error_codes::TOKEN_EXPIRED,
        retryable: Some(false),
        profile: "core",
    },
    ErrorCodeInfo {
        code: error_codes::RATE_LIMITED,
        retryable: Some(true),
        profile: "core",
    },
    ErrorCodeInfo {
        code: error_codes::QUOTA_EXCEEDED,
        retryable: Some(false),
        profile: "core",
    },
    ErrorCodeInfo {
        code: error_codes::SERVICE_UNAVAILABLE,
        retryable: Some(true),
        profile: "core",
    },
    ErrorCodeInfo {
        code: error_codes::TIMEOUT,
        retryable: Some(true),
        profile: "core",
    },
    ErrorCodeInfo {
        code: error_codes::CONNECTION_ERROR,
        retryable: Some(true),
        profile: "core",
    },
    ErrorCodeInfo {
        code: error_codes::INTERNAL_ERROR,
        retryable: None,
        profile: "core",
    },
    ErrorCodeInfo {
        code: error_codes::NOT_IMPLEMENTED,
        retryable: Some(false),
        profile: "core",
    },
    ErrorCodeInfo {
        code: error_codes::UNKNOWN_ERROR,
        retryable: Some(true),
        profile: "core",
    },
    ErrorCodeInfo {
        code: error_codes::COMMAND_NOT_FOUND,
        retryable: Some(false),
        profile: "core",
    },
    ErrorCodeInfo {
        code: error_codes::INVALID_COMMAND_ARGS,
        retryable: Some(false),
        profile: "core",
    },
    ErrorCodeInfo {
        code: error_codes::COMMAND_CANCELLED,
        retryable: Some(false),
        profile: "core",
    },
    ErrorCodeInfo {
        code: error_codes::COMMAND_EXECUTION_ERROR,
        retryable: Some(false),
        profile: "core",
    },
    ErrorCodeInfo {
        code: error_codes::COMMAND_NOT_EXPOSED,
        retryable: Some(false),
        profile: "core",
    },
    ErrorCodeInfo {
        code: error_codes::COMMAND_NOT_IN_CONTEXT,
        retryable: Some(false),
        profile: "contexts",
    },
    ErrorCodeInfo {
        code: error_codes::COMMAND_NOT_ALLOWED,
        retryable: Some(false),
        profile: "core",
    },
    ErrorCodeInfo {
        code: error_codes::UNKNOWN_TOOL,
        retryable: Some(false),
        profile: "core",
    },
    ErrorCodeInfo {
        code: error_codes::AMBIGUOUS_ACTION,
        retryable: Some(false),
        profile: "core",
    },
    ErrorCodeInfo {
        code: error_codes::INVALID_GROUPED_CALL,
        retryable: Some(false),
        profile: "core",
    },
    ErrorCodeInfo {
        code: error_codes::SESSION_REQUIRED,
        retryable: Some(false),
        profile: "contexts",
    },
    ErrorCodeInfo {
        code: error_codes::CONTEXT_NOT_FOUND,
        retryable: Some(false),
        profile: "contexts",
    },
    ErrorCodeInfo {
        code: error_codes::CONTEXT_DEPTH_EXCEEDED,
        retryable: Some(false),
        profile: "contexts",
    },
    ErrorCodeInfo {
        code: error_codes::INVALID_BATCH_REQUEST,
        retryable: Some(false),
        profile: "core",
    },
    ErrorCodeInfo {
        code: error_codes::BATCH_TIMEOUT,
        retryable: Some(true),
        profile: "core",
    },
    ErrorCodeInfo {
        code: error_codes::COMMAND_SKIPPED,
        retryable: Some(false),
        profile: "core",
    },
    ErrorCodeInfo {
        code: error_codes::INVALID_PIPELINE_REQUEST,
        retryable: Some(false),
        profile: "core",
    },
    ErrorCodeInfo {
        code: error_codes::PIPELINE_TIMEOUT,
        retryable: Some(true),
        profile: "core",
    },
    ErrorCodeInfo {
        code: error_codes::UNSUPPORTED_OPTION,
        retryable: Some(false),
        profile: "core",
    },
    ErrorCodeInfo {
        code: error_codes::STREAM_ABORTED,
        retryable: Some(true),
        profile: "streaming",
    },
    ErrorCodeInfo {
        code: error_codes::STREAM_TIMEOUT,
        retryable: Some(true),
        profile: "streaming",
    },
    ErrorCodeInfo {
        code: error_codes::STREAM_ERROR,
        retryable: None,
        profile: "streaming",
    },
    ErrorCodeInfo {
        code: error_codes::STREAM_ENDED_UNEXPECTEDLY,
        retryable: Some(true),
        profile: "streaming",
    },
    ErrorCodeInfo {
        code: error_codes::COMMAND_FAILED,
        retryable: Some(false),
        profile: "streaming",
    },
    ErrorCodeInfo {
        code: error_codes::CONFIRMATION_REQUIRED,
        retryable: None,
        profile: "confirmations",
    },
    ErrorCodeInfo {
        code: error_codes::CONFIRMATION_DECLINED,
        retryable: Some(false),
        profile: "confirmations",
    },
    ErrorCodeInfo {
        code: error_codes::APPROVAL_REQUIRED,
        retryable: Some(false),
        profile: "approvals",
    },
    ErrorCodeInfo {
        code: error_codes::APPROVAL_UNAVAILABLE,
        retryable: Some(false),
        profile: "approvals",
    },
    ErrorCodeInfo {
        code: error_codes::OUTPUT_BUDGET_EXCEEDED,
        retryable: Some(false),
        profile: "output-budgets",
    },
    ErrorCodeInfo {
        code: error_codes::INSUFFICIENT_SCOPE,
        retryable: Some(false),
        profile: "authorization",
    },
    ErrorCodeInfo {
        code: error_codes::TASK_TOKEN_EXPIRED,
        retryable: None,
        profile: "tasks",
    },
    ErrorCodeInfo {
        code: error_codes::CALL_NOT_GRANTED,
        retryable: Some(false),
        profile: "app-calls",
    },
    ErrorCodeInfo {
        code: error_codes::IDEMPOTENCY_KEY_REUSED,
        retryable: Some(false),
        profile: "idempotency",
    },
    ErrorCodeInfo {
        code: error_codes::IDEMPOTENCY_IN_PROGRESS,
        retryable: Some(true),
        profile: "idempotency",
    },
    ErrorCodeInfo {
        code: error_codes::OUTCOME_UNKNOWN,
        retryable: Some(false),
        profile: "idempotency",
    },
];

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR FACTORY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/// Create a CommandError with standard fields.
pub fn create_error(code: &str, message: &str) -> CommandError {
    CommandError::new(code, message)
}

/// Create a validation error.
pub fn validation_error(
    message: &str,
    details: Option<HashMap<String, serde_json::Value>>,
) -> CommandError {
    CommandError {
        code: error_codes::VALIDATION_ERROR.to_string(),
        message: message.to_string(),
        suggestion: Some("Check the input and try again".to_string()),
        retryable: Some(false),
        recovery: None,
        details,
        cause: None,
    }
}

/// Create a not found error.
pub fn not_found_error(resource_type: &str, resource_id: &str) -> CommandError {
    CommandError::not_found(resource_type, resource_id)
}

/// Create a rate limit error, with a `retry` recovery whose `afterMs` is the wait in milliseconds
/// when it is given (`spec/recovery.md`, "Engine errors").
pub fn rate_limit_error(retry_after_seconds: Option<u32>) -> CommandError {
    CommandError::rate_limited(retry_after_seconds)
}

/// Create a timeout error.
pub fn timeout_error(operation_name: &str, timeout_ms: u64) -> CommandError {
    CommandError::timeout(operation_name, timeout_ms)
}

/// Create an internal error.
pub fn internal_error(message: &str) -> CommandError {
    CommandError::internal(message)
}

/// Wrap an arbitrary error-like value in a safe, non-retryable [`CommandError`].
///
/// The raw `Display` output of `error` is intentionally omitted from the returned
/// [`CommandError::message`] so internal paths, SQL text, credentials, or stack details cannot
/// reach an agent. This always produces a fresh generic `INTERNAL_ERROR` (even when passed a
/// [`CommandError`], which implements `Display`). Log `error` on the host side before calling
/// this helper, or construct a domain-specific [`CommandError`] with sanitized prose and an
/// explicit retryability flag.
pub fn wrap_error(_error: impl Display) -> CommandError {
    CommandError::new(error_codes::INTERNAL_ERROR, "An internal error occurred")
        .with_suggestion("Check the server logs or contact the server operator.")
        .with_retryable(false)
}

/// Whether `value` is a recovery a reader keeps: it matches `$defs/recovery` in
/// `spec/schema/error.json` (`spec/recovery.md`, rule 7). The same test as TypeScript's
/// `isCommandRecovery`, and the same test [`CommandError`] reads `recovery` with.
///
/// ```rust
/// use afd::is_command_recovery;
/// use serde_json::json;
///
/// assert!(is_command_recovery(&json!({ "kind": "call", "command": "issue-check" })));
/// assert!(!is_command_recovery(&json!({ "kind": "fix-input", "input": { "confirm": true } })));
/// ```
pub fn is_command_recovery(value: &serde_json::Value) -> bool {
    Recovery::deserialize(value).is_ok()
}

/// Type guard to check if a value is a CommandError.
pub fn is_command_error<T: Serialize>(value: &T) -> bool {
    if let Ok(json) = serde_json::to_value(value) {
        json.get("code").is_some() && json.get("message").is_some()
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_not_found_error() {
        let error = CommandError::not_found("Todo", "123");
        assert_eq!(error.code, "NOT_FOUND");
        assert!(error.message.contains("Todo"));
        assert!(error.message.contains("123"));
        assert_eq!(error.retryable, Some(false));
    }

    #[test]
    fn test_validation_error() {
        let error = CommandError::validation("Invalid email", Some("Use a valid format"));
        assert_eq!(error.code, "VALIDATION_ERROR");
        assert_eq!(error.suggestion, Some("Use a valid format".to_string()));
    }

    #[test]
    fn test_rate_limited_error() {
        let error = CommandError::rate_limited(Some(60));
        assert_eq!(error.code, "RATE_LIMITED");
        assert_eq!(error.retryable, Some(true));
        assert!(error.suggestion.as_ref().unwrap().contains("60"));
    }

    /// `spec/recovery.md`, "Engine errors": the rate-limit helpers set a `retry` recovery, with
    /// the wait they are given; the other helpers set none.
    #[test]
    fn helpers_set_the_recovery_the_table_gives() {
        for error in [
            rate_limit_error(Some(60)),
            CommandError::rate_limited(Some(60)),
        ] {
            assert_eq!(
                serde_json::to_value(&error.recovery).unwrap(),
                serde_json::json!({ "kind": "retry", "afterMs": 60000 })
            );
        }
        assert_eq!(
            serde_json::to_value(&rate_limit_error(None).recovery).unwrap(),
            serde_json::json!({ "kind": "retry" })
        );
        for error in [
            validation_error("bad", None),
            CommandError::validation("bad", None),
            not_found_error("Todo", "1"),
            timeout_error("op", 10),
            internal_error("boom"),
            CommandError::internal("boom"),
            create_error("CUSTOM", "custom"),
        ] {
            assert!(error.recovery.is_none(), "{}", error.code);
        }
    }

    #[test]
    fn test_json_serialization() {
        let error = CommandError::not_found("Item", "abc");
        let json = serde_json::to_string(&error).unwrap();

        // Verify camelCase serialization
        assert!(json.contains("\"code\":\"NOT_FOUND\""));
        assert!(json.contains("\"resourceType\""));
        assert!(json.contains("\"resourceId\""));
    }

    #[test]
    fn test_builder_pattern() {
        let error = CommandError::new("CUSTOM_ERROR", "Something went wrong")
            .with_suggestion("Try again later")
            .with_retryable(true);

        assert_eq!(error.code, "CUSTOM_ERROR");
        assert_eq!(error.suggestion, Some("Try again later".to_string()));
        assert_eq!(error.retryable, Some(true));
    }

    #[test]
    fn test_display_and_error_source() {
        let error = CommandError::new("OUTER", "outer failed")
            .with_cause(CommandError::new("INNER", "inner failed"));
        assert_eq!(error.to_string(), "OUTER: outer failed");
        let source = std::error::Error::source(&error).expect("cause is the source");
        assert_eq!(source.to_string(), "INNER: inner failed");
    }

    #[test]
    fn test_wrap_error() {
        let error = wrap_error("failed to open /private/secret-path: permission denied");
        assert_eq!(error.code, "INTERNAL_ERROR");
        assert_eq!(error.message, "An internal error occurred");
        assert_eq!(error.retryable, Some(false));
        assert!(error.suggestion.is_some());
        assert!(error.recovery.is_none());
        assert!(error.details.is_none());
        assert!(error.cause.is_none());
        let serialized = serde_json::to_string(&error).unwrap();
        assert!(!serialized.contains("secret-path"));
        assert!(!serialized.contains("permission denied"));
    }
}

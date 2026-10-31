//! The approval middleware: holds a call whose command's approval policy requires a human's
//! sign-off and returns `APPROVAL_REQUIRED` before the handler runs.
//!
//! Token format: `afdap1.<payload>.<mac>`, both parts unpadded base64url. The payload is JSON,
//! with its keys in this order:
//!
//! - `c`: the command name;
//! - `i`: HMAC-SHA256 of the canonical JSON of the validated input;
//! - `a`: HMAC-SHA256 of the canonical JSON of the actor's `kind`, `id` and `onBehalfOf`
//!   (`null` when the call has no actor);
//! - `iat`, `exp`: issue and expiry times in epoch milliseconds;
//! - `n`: a 128-bit random nonce.
//!
//! The MAC is HMAC-SHA256 over `afdap1.<payload>` with the application's secret. The input and
//! actor are keyed digests rather than plain hashes, so a token reveals neither a low-entropy
//! input (such as a record ID) nor the actor ID. Every comparison is constant-time.

use async_trait::async_trait;
use chrono::{DateTime, SecondsFormat};
use serde_json::{json, Value};
use std::borrow::Borrow;
use std::collections::HashMap;
use std::fmt;
use std::sync::{Arc, Mutex, PoisonError};

use super::token::{
    actor_json, base64url_decode, base64url_encode, canonical_json, digest, hmac_sha256, safe_equal,
};
use super::{ApprovalDecision, ApprovalPolicy, ApprovalRejection};
use crate::actor::Actor;
use crate::clock::{Clock, SYSTEM_CLOCK};
use crate::commands::{BoxFuture, CommandContext, CommandDefinition, CommandMiddleware};
use crate::errors::{error_codes, CommandError};
use crate::result::{failure, CommandResult};

const TOKEN_PREFIX: &str = "afdap1";
const MIN_SECRET_BYTES: usize = 32;
const DEFAULT_TTL_MS: u64 = 5 * 60_000;
const MAX_TTL_MS: u64 = 24 * 60 * 60_000;
/// Longer evidence is rejected unread, so a caller cannot make the server hash megabytes.
const MAX_TOKEN_LENGTH: usize = 1024;

/// How often a token may run its command.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ApprovalReplay {
    /// A token runs the command once; a second call with it is held again with
    /// `already-used` (the default).
    #[default]
    SingleUse,
    /// A token runs the same command, input and actor as often as it is presented until it
    /// expires, so one approval also covers repeats (for example duplicate batch items).
    WithinTtl,
}

/// Records which single-use tokens have been spent. The default keeps them in memory, which
/// holds only within one middleware instance: give servers that run several instances a shared
/// store.
#[async_trait]
pub trait ApprovalNonceStore: Send + Sync {
    /// Mark `nonce` as used until `expires_at` (epoch milliseconds; it can be forgotten after).
    /// Return `false` when it was already used. Must be atomic: of two concurrent calls with the
    /// same nonce, exactly one returns `true`.
    async fn consume(&self, nonce: &str, expires_at: i64) -> bool;
}

/// A call held for approval, as passed to the `on_approval_required` callback.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct ApprovalRequest {
    /// The command name.
    pub command: String,
    /// The validated input the token is bound to.
    pub input: Value,
    /// The calling actor, if any.
    pub actor: Option<Actor>,
    /// The token that approves this call.
    pub approval_token: String,
    /// ISO 8601 expiry of `approval_token`.
    pub expires_at: String,
    /// The text shown to the human who approves.
    pub summary: String,
    /// Set when the call carried a token that was rejected.
    pub rejected: Option<ApprovalRejection>,
}

type Summarize = Arc<dyn Fn(&str, &Value, &CommandContext) -> Option<String> + Send + Sync>;
type OnApprovalRequired = Arc<dyn Fn(ApprovalRequest) -> BoxFuture<'static, ()> + Send + Sync>;

/// What the middleware reads from a command: its approval policy and confirmation prompt.
struct GatedCommand {
    approval: Option<ApprovalPolicy>,
    confirm_prompt: Option<String>,
}

/// Options for [`create_approval_middleware`].
pub struct ApprovalMiddlewareOptions {
    secrets: Vec<Vec<u8>>,
    commands: HashMap<String, GatedCommand>,
    ttl_ms: u64,
    replay: ApprovalReplay,
    nonce_store: Option<Arc<dyn ApprovalNonceStore>>,
    summarize: Option<Summarize>,
    include_token: bool,
    on_approval_required: Option<OnApprovalRequired>,
    clock: Option<Arc<dyn Clock>>,
}

impl ApprovalMiddlewareOptions {
    /// Gate `commands` (pass the registry's, for example `registry.list()`), signing tokens with
    /// `secret`: at least 32 bytes, with no default. Keep it out of source. A command that is
    /// not in `commands` is never held, whatever its approval policy says.
    pub fn new<C>(secret: impl AsRef<[u8]>, commands: impl IntoIterator<Item = C>) -> Self
    where
        C: Borrow<CommandDefinition>,
    {
        let commands = commands
            .into_iter()
            .map(|command| {
                let command = command.borrow();
                let gated = GatedCommand {
                    approval: command.approval.clone(),
                    confirm_prompt: command.confirm_prompt.clone(),
                };
                (command.name.clone(), gated)
            })
            .collect();
        Self {
            secrets: vec![secret.as_ref().to_vec()],
            commands,
            ttl_ms: DEFAULT_TTL_MS,
            replay: ApprovalReplay::default(),
            nonce_store: None,
            summarize: None,
            include_token: true,
            on_approval_required: None,
            clock: None,
        }
    }

    /// Also accept tokens signed with `secret`, during a key rotation. The secret given to
    /// [`ApprovalMiddlewareOptions::new`] signs; any of them verifies.
    pub fn with_previous_secret(mut self, secret: impl AsRef<[u8]>) -> Self {
        self.secrets.push(secret.as_ref().to_vec());
        self
    }

    /// How long a token stays valid, in milliseconds. Default: 300000 (5 minutes); at most
    /// 24 hours.
    pub fn with_ttl_ms(mut self, ttl_ms: u64) -> Self {
        self.ttl_ms = ttl_ms;
        self
    }

    /// Whether a token runs its command once (the default) or until it expires.
    pub fn with_replay(mut self, replay: ApprovalReplay) -> Self {
        self.replay = replay;
        self
    }

    /// Where single-use nonces are recorded. Default: in memory, for this middleware instance
    /// only. Share one store between every instance that uses the same secret, or a token works
    /// once on each.
    pub fn with_nonce_store(mut self, store: impl ApprovalNonceStore + 'static) -> Self {
        self.nonce_store = Some(Arc::new(store));
        self
    }

    /// The text shown to the human who approves, from the call. Default (also for `None` or an
    /// empty string): the command's `confirm_prompt`, else `Run <command>`.
    pub fn with_summarize<F>(mut self, summarize: F) -> Self
    where
        F: Fn(&str, &Value, &CommandContext) -> Option<String> + Send + Sync + 'static,
    {
        self.summarize = Some(Arc::new(summarize));
        self
    }

    /// Whether the `APPROVAL_REQUIRED` result carries `details.approvalToken`. Default: `true`,
    /// which is safe only while the gated caller cannot set [`CommandContext::approval`] itself
    /// (true of MCP tool calls, whose arguments never reach the context). Set `false` when the
    /// caller must not hold the token, and deliver it through `on_approval_required`.
    pub fn with_include_token(mut self, include_token: bool) -> Self {
        self.include_token = include_token;
        self
    }

    /// Called for every held call, before the result is returned, for example to notify a
    /// human.
    pub fn with_on_approval_required<F>(mut self, callback: F) -> Self
    where
        F: Fn(ApprovalRequest) -> BoxFuture<'static, ()> + Send + Sync + 'static,
    {
        self.on_approval_required = Some(Arc::new(callback));
        self
    }

    /// Source of time for issuing and expiring tokens and for forgetting spent nonces.
    /// Default: the system clock. The context's clock is never used: a caller can set it, and
    /// this is security time.
    pub fn with_clock(mut self, clock: impl Clock + 'static) -> Self {
        self.clock = Some(Arc::new(clock));
        self
    }
}

impl fmt::Debug for ApprovalMiddlewareOptions {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Never print the secrets.
        f.debug_struct("ApprovalMiddlewareOptions")
            .field(
                "secrets",
                &format_args!("[{} redacted]", self.secrets.len()),
            )
            .field("commands", &self.commands.keys().collect::<Vec<_>>())
            .field("ttl_ms", &self.ttl_ms)
            .field("replay", &self.replay)
            .field("include_token", &self.include_token)
            .finish_non_exhaustive()
    }
}

/// Create a middleware that runs a command whose approval policy requires approval only when
/// [`CommandContext::approval`] holds a valid token for this command, input and actor.
/// Otherwise it returns `APPROVAL_REQUIRED` with a fresh token, and the handler does not run.
///
/// Add it after any middleware that sets or refines the actor (such as auth), since tokens are
/// bound to the actor. [`CommandContext::approval`] must only ever be set by trusted surface
/// code once a human approved, never from tool arguments: whoever holds a token can use it.
///
/// # Errors
/// A secret is shorter than 32 bytes, or `ttl_ms` is zero or longer than 24 hours.
///
/// # Example
///
/// ```rust
/// use afd::{
///     create_approval_middleware, success, ApprovalMiddlewareOptions, ApprovalPolicy,
///     CommandContext, CommandDefinition, CommandHandler, CommandRegistry, CommandResult,
/// };
///
/// struct Delete;
/// #[async_trait::async_trait]
/// impl CommandHandler for Delete {
///     async fn execute(&self, _: serde_json::Value, _: CommandContext) -> CommandResult<serde_json::Value> {
///         success(serde_json::json!({ "deleted": true }))
///     }
/// }
///
/// let registry = CommandRegistry::new();
/// registry
///     .register(CommandDefinition::new("todo-delete", "Delete a todo", vec![], Delete)
///         .with_approval(ApprovalPolicy::Required))
///     .unwrap();
/// let secret = "an application secret of 32 bytes or more";
/// let approval = create_approval_middleware(ApprovalMiddlewareOptions::new(secret, registry.list()))
///     .unwrap();
/// registry.add_middleware(approval);
/// ```
pub fn create_approval_middleware(
    options: ApprovalMiddlewareOptions,
) -> Result<CommandMiddleware, String> {
    if options
        .secrets
        .iter()
        .any(|secret| secret.len() < MIN_SECRET_BYTES)
    {
        return Err(format!(
            "Approval secret must be at least {MIN_SECRET_BYTES} bytes"
        ));
    }
    if options.ttl_ms == 0 || options.ttl_ms > MAX_TTL_MS {
        return Err(
            "Approval ttl_ms must be a positive number of milliseconds, at most 24 hours".into(),
        );
    }
    let gate = Arc::new(Gate {
        memory: options
            .nonce_store
            .is_none()
            .then(|| Mutex::new(HashMap::new())),
        options,
    });
    Ok(Arc::new(move |name, input, context, next| {
        let gate = Arc::clone(&gate);
        Box::pin(async move { gate.run(name, input, context, next).await })
    }))
}

struct Gate {
    options: ApprovalMiddlewareOptions,
    /// Spent single-use nonces and their expiry, when no store was supplied.
    memory: Option<Mutex<HashMap<String, i64>>>,
}

/// A verified token: its nonce and expiry.
struct Accepted {
    nonce: String,
    expires_at: i64,
}

impl Gate {
    fn clock(&self) -> &dyn Clock {
        match &self.options.clock {
            Some(clock) => clock.as_ref(),
            None => &SYSTEM_CLOCK,
        }
    }

    async fn requires_approval(&self, name: &str, input: &Value, context: &CommandContext) -> bool {
        match self
            .options
            .commands
            .get(name)
            .and_then(|command| command.approval.as_ref())
        {
            None => false,
            // Fail closed: anything but an explicit `NotRequired` holds the call.
            Some(policy) => policy.decide(input, context).await != ApprovalDecision::NotRequired,
        }
    }

    async fn run(
        &self,
        name: String,
        input: Value,
        context: CommandContext,
        next: crate::commands::MiddlewareNext,
    ) -> CommandResult<Value> {
        if !self.requires_approval(&name, &input, &context).await {
            return next().await;
        }

        let now = self.clock().now();
        let input_binding = match canonical_json(&input) {
            Ok(binding) => binding,
            Err(message) => {
                return failure(
                    CommandError::new(error_codes::COMMAND_EXECUTION_ERROR, message)
                        .with_suggestion("Pass plain JSON input: integers within ±2^53")
                        .with_retryable(false),
                )
            }
        };
        let actor_binding = actor_json(context.actor.as_ref());

        let mut rejected = None;
        let evidence = context.direct_approval.as_ref().map_or_else(
            || context.approval.clone(),
            |state| crate::direct::locked(state).take(),
        );
        if let Some(evidence) = &evidence {
            match self.verify(evidence, &name, &input_binding, &actor_binding, now) {
                Ok(accepted) => {
                    if self.consume(&accepted, now).await {
                        return next().await;
                    }
                    rejected = Some(ApprovalRejection::AlreadyUsed);
                }
                Err(reason) => rejected = Some(reason),
            }
        }

        let nonce = match random_nonce() {
            Ok(nonce) => nonce,
            Err(message) => {
                return failure(
                    CommandError::new(error_codes::COMMAND_EXECUTION_ERROR, message)
                        .with_suggestion("The system random source failed; try again later"),
                )
            }
        };
        let expires = now.saturating_add(self.options.ttl_ms as i64);
        let approval_token = self.sign(&name, &input_binding, &actor_binding, now, expires, &nonce);
        let expires_at = iso_time(expires);
        let command = self.options.commands.get(&name);
        let summary = self
            .options
            .summarize
            .as_ref()
            .and_then(|summarize| summarize(&name, &input, &context))
            .filter(|summary| !summary.is_empty())
            .or_else(|| {
                command
                    .and_then(|command| command.confirm_prompt.clone())
                    .filter(|prompt| !prompt.is_empty())
            })
            .unwrap_or_else(|| format!("Run {name}"));

        if let Some(callback) = &self.options.on_approval_required {
            callback(ApprovalRequest {
                command: name.clone(),
                input,
                actor: context.actor.clone(),
                approval_token: approval_token.clone(),
                expires_at: expires_at.clone(),
                summary: summary.clone(),
                rejected,
            })
            .await;
        }

        let single_use = self.options.replay == ApprovalReplay::SingleUse;
        if let Some(state) = &context.direct_approval {
            crate::direct::locked(state).hold(crate::direct::Hold {
                token: approval_token.clone(),
                summary: summary.clone(),
                expires_at: expires_at.clone(),
                reason: rejected.map(|reason| reason.as_str().to_owned()),
            });
        }
        let include_token = self.options.include_token && context.direct_approval.is_none();
        let why = rejected
            .map(|reason| format!("The approval token was not accepted ({reason}). "))
            .unwrap_or_default();
        // Addressed to whoever relays the decision: the token is the approval, so the gated
        // caller must not resubmit it on its own, and tool arguments cannot carry it.
        let retry = if include_token {
            format!(
                "once they approve, the application retries the same call with the same input and details.approvalToken as its approval evidence (tool arguments cannot carry it). The token expires at {expires_at}{}.",
                if single_use { " and works once" } else { "" }
            )
        } else {
            "the application retries the same call once it has recorded the approval.".to_owned()
        };
        let mut details = HashMap::from([
            ("expiresAt".to_owned(), json!(expires_at)),
            ("summary".to_owned(), json!(summary)),
        ]);
        if include_token {
            details.insert("approvalToken".to_owned(), json!(approval_token));
        }
        if let Some(reason) = rejected {
            details.insert("reason".to_owned(), json!(reason.as_str()));
        }
        failure(
            CommandError::new(
                error_codes::APPROVAL_REQUIRED,
                format!("{name} needs approval before it runs"),
            )
            .with_suggestion(format!(
                "{why}Ask the user to approve \"{summary}\"; {retry}"
            ))
            .with_retryable(false)
            .with_details(details),
        )
    }

    fn verify(
        &self,
        evidence: &str,
        name: &str,
        input: &str,
        actor: &str,
        now: i64,
    ) -> Result<Accepted, ApprovalRejection> {
        // TypeScript counts UTF-16 units; a UTF-8 byte count above 3× the cap is over it anyway.
        if evidence.len() > 3 * MAX_TOKEN_LENGTH
            || evidence.encode_utf16().count() > MAX_TOKEN_LENGTH
        {
            return Err(ApprovalRejection::Malformed);
        }
        let parts: Vec<&str> = evidence.split('.').collect();
        let [prefix, encoded_payload, encoded_mac] = parts[..] else {
            return Err(ApprovalRejection::Malformed);
        };
        if prefix != TOKEN_PREFIX {
            return Err(ApprovalRejection::Malformed);
        }
        let signing_input = format!("{TOKEN_PREFIX}.{encoded_payload}");
        // Compare the encoded MACs, so that a token has exactly one valid spelling. The key that
        // signed the token also keyed its digests. Every key is tried, so the time taken does
        // not reveal which one matched.
        let mut key = None;
        for candidate in &self.options.secrets {
            let expected = base64url_encode(&hmac_sha256(candidate, signing_input.as_bytes()));
            if safe_equal(encoded_mac.as_bytes(), expected.as_bytes()) && key.is_none() {
                key = Some(candidate);
            }
        }
        let key = key.ok_or(ApprovalRejection::InvalidSignature)?;

        let payload = parse_payload(encoded_payload).ok_or(ApprovalRejection::Malformed)?;
        if now as f64 >= payload.exp {
            return Err(ApprovalRejection::Expired);
        }
        if !safe_equal(payload.c.as_bytes(), name.as_bytes()) {
            return Err(ApprovalRejection::CommandMismatch);
        }
        let matches = |encoded: &str, purpose: &str, value: &str| {
            base64url_decode(encoded)
                .is_some_and(|bytes| safe_equal(&bytes, &digest(key, purpose, value)))
        };
        if !matches(&payload.i, "input", input) {
            return Err(ApprovalRejection::InputMismatch);
        }
        if !matches(&payload.a, "actor", actor) {
            return Err(ApprovalRejection::ActorMismatch);
        }
        Ok(Accepted {
            nonce: payload.n,
            expires_at: payload.exp as i64,
        })
    }

    /// Whether a verified token may run now: always under `WithinTtl`, else once per nonce.
    async fn consume(&self, accepted: &Accepted, now: i64) -> bool {
        if self.options.replay == ApprovalReplay::WithinTtl {
            return true;
        }
        if let Some(memory) = &self.memory {
            let mut used = memory.lock().unwrap_or_else(PoisonError::into_inner);
            used.retain(|_, until| *until > now);
            return used
                .insert(accepted.nonce.clone(), accepted.expires_at)
                .is_none();
        }
        match &self.options.nonce_store {
            Some(store) => store.consume(&accepted.nonce, accepted.expires_at).await,
            None => false,
        }
    }

    fn sign(
        &self,
        name: &str,
        input: &str,
        actor: &str,
        issued: i64,
        expires: i64,
        nonce: &str,
    ) -> String {
        let key = &self.options.secrets[0];
        // The key order and spelling of TypeScript's `JSON.stringify(payload)`.
        let payload = format!(
            "{{\"c\":{},\"i\":\"{}\",\"a\":\"{}\",\"iat\":{issued},\"exp\":{expires},\"n\":\"{nonce}\"}}",
            serde_json::to_string(name).expect("strings serialize"),
            base64url_encode(&digest(key, "input", input)),
            base64url_encode(&digest(key, "actor", actor)),
        );
        let signing_input = format!("{TOKEN_PREFIX}.{}", base64url_encode(payload.as_bytes()));
        let mac = base64url_encode(&hmac_sha256(key, signing_input.as_bytes()));
        format!("{signing_input}.{mac}")
    }
}

struct Payload {
    c: String,
    i: String,
    a: String,
    exp: f64,
    n: String,
}

fn parse_payload(encoded: &str) -> Option<Payload> {
    let bytes = base64url_decode(encoded)?;
    let value: Value = serde_json::from_slice(&bytes).ok()?;
    let object = value.as_object()?;
    let text = |field: &str| object.get(field)?.as_str().map(str::to_owned);
    // `iat` is checked for shape only, as TypeScript does.
    object.get("iat")?.as_f64()?;
    Some(Payload {
        c: text("c")?,
        i: text("i")?,
        a: text("a")?,
        exp: object.get("exp")?.as_f64()?,
        n: text("n")?,
    })
}

fn random_nonce() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes)
        .map_err(|error| format!("Cannot draw an approval nonce: {error}"))?;
    Ok(base64url_encode(&bytes))
}

/// JavaScript's `Date.prototype.toISOString`.
fn iso_time(millis: i64) -> String {
    DateTime::from_timestamp_millis(millis)
        .unwrap_or_default()
        .to_rfc3339_opts(SecondsFormat::Millis, true)
}

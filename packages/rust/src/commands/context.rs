//! The context a command runs in: [`CommandContext`], and the per-request filters the MCP server
//! puts on it.

use std::collections::HashMap;
use std::fmt;
use std::sync::Arc;

use crate::actor::Actor;
use crate::clock::{Clock, RandomSource, SYSTEM_CLOCK, SYSTEM_RANDOM};
use crate::credentials::Credentials;
use crate::errors::CommandError;
use crate::journal::JournalContextState;

use super::{CommandDefinition, CommandInterface};

/// How an MCP server lists its tools, for `afd-help` (`spec/tool-strategies.md`, H8). Only the
/// MCP server sets it, so `afd-help` run in process reports none of it.
#[derive(Clone, Debug)]
pub(crate) struct ToolSurface {
    pub(crate) strategy: &'static str,
    /// The first-class tool names in list order, on a hybrid server.
    pub(crate) first_class_tools: Option<Arc<Vec<String>>>,
    /// Which commands the caller may see on the describing surfaces (`afd-help`, `afd-docs`,
    /// `afd-schema`), when the server filters listings by scope (`spec/authorization.md`, M6).
    pub(crate) visible: Option<Visibility>,
}

/// A filter the MCP server sets for one request (which commands the caller may list, or which
/// exist for it): the names it admits, decided once when the request arrives.
#[derive(Clone)]
pub(crate) struct Visibility(pub(crate) Arc<std::collections::HashSet<String>>);

impl Visibility {
    pub(crate) fn allows(&self, command: &CommandDefinition) -> bool {
        self.0.contains(&command.name)
    }

    pub(crate) fn allows_name(&self, name: &str) -> bool {
        self.0.contains(name)
    }

    /// `names` without those it does not admit, in order: a command's `requires` as this caller
    /// may read it (`spec/authorization.md`, M6, "Hidden commands").
    pub(crate) fn admitted(&self, names: &[String]) -> Vec<String> {
        names
            .iter()
            .filter(|name| self.allows_name(name))
            .cloned()
            .collect()
    }
}

/// The execute-time scope decision an authorized MCP server sets for a caller with credentials
/// when a host resolver is installed (`spec/authorization.md`, M6, "At execution"): asked with
/// the command, its validated input and the credentials; `Some` refuses the call before the
/// middleware and the handler run.
#[derive(Clone)]
pub(crate) struct ScopeCheck(pub(crate) Arc<ScopeCheckFn>);

/// What a [`ScopeCheck`] calls.
pub(crate) type ScopeCheckFn =
    dyn Fn(&str, &serde_json::Value, &Credentials) -> Option<CommandError> + Send + Sync;

impl fmt::Debug for ScopeCheck {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ScopeCheck(..)")
    }
}

impl fmt::Debug for Visibility {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Visibility(..)")
    }
}

/// Context provided to command handlers.
///
/// Build it with [`CommandContext::new`] and the `with_*` methods.
#[derive(Clone, Default)]
#[non_exhaustive]
pub struct CommandContext {
    /// Unique ID for this command invocation.
    pub trace_id: Option<String>,

    /// Deadline for the command in milliseconds.
    ///
    /// [`CommandRegistry::execute`](super::CommandRegistry::execute) enforces it with `tokio::time::timeout`
    /// (the `native` feature, inside a Tokio runtime with time enabled) and
    /// returns `TIMEOUT` when it passes. Without `native`, a context with a
    /// timeout is rejected with `UNSUPPORTED_OPTION` before the handler runs.
    pub timeout_ms: Option<u64>,

    /// The interface invoking the command.
    ///
    /// When set, [`CommandRegistry::execute`](super::CommandRegistry::execute) rejects commands that are not
    /// exposed to it with `COMMAND_NOT_EXPOSED`. Leave it unset for trusted
    /// in-process calls.
    pub interface: Option<CommandInterface>,

    /// Who is calling: a human, an agent, a service, a script or a test.
    ///
    /// The MCP server (feature `server`) sets `agent` unless configured otherwise. When it is
    /// set, [`CommandRegistry::execute`](super::CommandRegistry::execute) reports its kind as `metadata.actorKind` on the
    /// handler's result (never the id).
    pub actor: Option<Actor>,

    /// The verified claims of the request's access token, on a server configured with
    /// authorization (`spec/authorization.md`, M4; the `server-auth` feature). Only the server
    /// sets it, from a verified request, never from tool arguments, `_meta` or a header; the
    /// context hook sees it and cannot change it. In process it is absent unless trusted host
    /// code sets it ([`CommandContext::with_credentials`]). It never holds the raw token, is not
    /// journaled, and prints redacted. A middleware cannot change it: the handler runs with the
    /// credentials the call had before the middleware chain.
    pub credentials: Option<Arc<Credentials>>,

    /// Approval evidence for a command whose approval policy requires it: the
    /// `details.approvalToken` of an `APPROVAL_REQUIRED` result, set by the surface once a human
    /// approved (`spec/approvals.md`, "Approvals"). Only trusted surface code sets it,
    /// never tool arguments: whoever holds a valid token can run the call. The MCP server never
    /// sets it.
    pub approval: Option<String>,

    /// Source of the current time. Read time from [`CommandContext::clock`] instead of the
    /// system time so tests and replays can control it.
    ///
    /// [`CommandRegistry::execute`](super::CommandRegistry::execute) always sets it for the handler (to
    /// [`SYSTEM_CLOCK`] unless the caller set one).
    pub clock: Option<Arc<dyn Clock>>,

    /// Source of randomness. Read random numbers from [`CommandContext::random`] so tests
    /// and replays can seed them.
    ///
    /// [`CommandRegistry::execute`](super::CommandRegistry::execute) always sets it for the handler (to
    /// [`SYSTEM_RANDOM`] unless the caller set one).
    pub random: Option<Arc<dyn RandomSource>>,

    /// Custom context values.
    pub extra: HashMap<String, serde_json::Value>,

    /// The call's idempotency key (`spec/idempotency.md`, K1): set in process with
    /// [`CommandContext::with_idempotency_key`], and by the MCP server from
    /// `_meta["dev.afd/idempotencyKey"]` or a meta-tool's `meta` argument (a value the context hook
    /// sets wins). [`CommandRegistry::execute`](super::CommandRegistry::execute) checks its form
    /// (K2) before any middleware runs and fails a call whose key is not 1 to 200 characters of
    /// `A-Z a-z 0-9 . _ ~ -` with `VALIDATION_ERROR`; the handler then reads it here (K3), each
    /// batch item and pipeline step runs under a key derived from it (K4), and a command the
    /// handler runs through the registry on this context starts without it (K6).
    pub idempotency_key: Option<String>,

    /// What a journal recorder and replay pass to nested calls.
    pub(crate) journal_state: JournalContextState,
    pub(crate) direct_approval: Option<Arc<std::sync::Mutex<crate::direct::Exchange>>>,
    /// The active-context state: a session stack, one request's context, or no session.
    pub(crate) context_scope: Option<crate::contexts::ContextScope>,
    /// The caller's output budget ask (`spec/output-budgets.md`, B2) in its `_meta` form,
    /// `{ "maxBytes": n }`, not yet validated: [`CommandRegistry::execute`](super::CommandRegistry::execute) checks it after the
    /// declared context fields. Set in process by [`CommandContext::with_output_budget_ask`], and
    /// by the MCP server from `_meta["dev.afd/outputBudget"]`.
    pub(crate) output_budget_ask: Option<serde_json::Value>,
    /// The effective output budget (B3, B4): set by [`CommandRegistry::execute`](super::CommandRegistry::execute) for the
    /// middleware and the handler.
    pub(crate) output_budget: Option<u64>,
    /// The cancellation signal of a call (`spec/execution-controls.md`, `spec/command-metadata.md`):
    /// set by a caller with [`CommandContext::with_cancellation`], by a command deadline, or by the
    /// MCP server when running a task. Read it with [`CommandContext::cancellation`].
    pub(crate) cancellation: Option<crate::cancellation::CancellationSignal>,
    /// Optional per-call override for the registry's `default_timeout_ms`:
    /// `Some(Some(ms))` applies a server default deadline without mutating `timeout_ms`
    /// (preserving journal context digests), and `Some(None)` disables the default deadline
    /// (e.g. `McpServer::with_default_timeout_ms(None)` or MCP Tasks bounded by TTL).
    pub(crate) default_timeout_override: Option<Option<u64>>,
    /// Which command this call runs and whether an approval step admitted it (#1886): only
    /// [`CommandRegistry::execute`](super::CommandRegistry::execute) sets it, afresh for every
    /// call, and it is removed before the handler runs.
    pub(crate) approval_admission: Option<Arc<crate::approval::admission::Admission>>,
    /// The state of a call that only the MCP server sets (its caller's filters, the approval
    /// relay and evidence, an approver client, a task's progress): `None` for every call made
    /// in process. Shared, so copying a context does not copy it.
    pub(crate) server: Option<Arc<ServerCall>>,
    /// The dispatch id (`spec/dispatch.md`, "The dispatch id"): set by
    /// [`CommandRegistry::execute`](super::CommandRegistry::execute) for each call, read through
    /// [`CommandContext::dispatch_id`].
    pub(crate) dispatch_id: Option<Arc<str>>,
    /// Who set [`Self::idempotency_key`], when the crate did (K4, K6).
    pub(crate) idempotency_mark: crate::idempotency::key::KeyMark,
    /// The registry's idempotency step and the call it acts on, for the innermost link: only
    /// [`CommandRegistry::execute`](super::CommandRegistry::execute) sets it, afresh for every call.
    pub(crate) idempotency: Option<Arc<crate::idempotency::step::StepCall>>,
}

/// Execute-time guard set by `McpServer` when `ServerInstances::Multiple` is active, checked
/// atomically against the exact middleware snapshot `CommandRegistry::execute` is about to run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct InstanceGuard {
    pub(crate) require_shared_key_for_relay: bool,
    pub(crate) has_human_relay: bool,
}

impl InstanceGuard {
    /// Whether `state` (the exact middleware snapshot about to execute) breaks the server's
    /// `ServerInstances::Multiple` contract.
    pub(crate) fn violated_by(
        self,
        state: crate::middleware::process_state::ApprovalProcessState,
    ) -> bool {
        (self.require_shared_key_for_relay && state.relay)
            || state.per_process_nonces
            || (self.has_human_relay && state.per_process_relay_nonces)
    }
}

/// The state of one call that only the MCP server sets ([`CommandContext::server`]).
#[derive(Clone, Default)]
pub(crate) struct ServerCall {
    /// A remote MCP caller: an unexposed command looks unknown, and recovery points to
    /// `afd-discover` (`spec/error-codes.md`, D4). Only the MCP server sets it.
    pub(crate) remote: bool,
    /// How the MCP server lists its tools: read by `afd-help`. Only the MCP server sets it.
    pub(crate) tool_surface: Option<ToolSurface>,
    /// Which commands exist for the caller (`spec/authorization.md`, M6, "Hidden commands"):
    /// one it rejects is looked up as a name that does not exist, before anything else, by every
    /// execution under this context (batch items, pipeline steps, nested calls that pass the
    /// context on). Only the MCP server sets it.
    pub(crate) known: Option<Visibility>,
    /// The execute-time scope decision (`spec/authorization.md`, M6, "At execution"). Only the
    /// MCP server sets it, and every execution under this context (batch items, pipeline steps,
    /// nested calls that pass the context on) is decided again on its validated input.
    pub(crate) scope_check: Option<ScopeCheck>,
    /// Relay evidence (`spec/command-metadata.md`, "Relay evidence"): only the MCP server sets it,
    /// after the host's [`HumanRelay`](crate::server::HumanRelay) returned `Approved` for this
    /// call; the approval middleware then considers it and nothing else. Never read from a
    /// request, never serialized, and removed before the handler runs, so a command the handler
    /// calls in process never sees it.
    pub(crate) relay_evidence: Option<Arc<crate::approval::relay::RelayEvidence>>,
    /// The form-mode approval relay of one MCP tool call (`spec/command-metadata.md`, "Asking the
    /// human over MCP"): only the MCP server sets it. The handler gets one that never asks.
    pub(crate) approval_relay: Option<Arc<crate::approval::relay::ApprovalRelayChannel>>,
    /// The up-front approval of an `afd-batch` or `afd-pipe` (#459): only the MCP server sets
    /// it, on every step's context, and it is removed before the handler runs.
    pub(crate) up_front_approval: Option<Arc<crate::approval::relay::UpFrontApproval>>,
    /// An approver client's call (`spec/command-metadata.md`, "Approval evidence from an approver
    /// client"): only the MCP server sets it, for a caller its `with_approver` predicate names. It
    /// holds the evidence of `_meta["dev.afd/approval"]` until the first approval check takes it.
    pub(crate) approver: Option<Arc<crate::approval::approver::ApproverCall>>,
    /// Where a task's progress goes ([`CommandContext::report_progress`]): only the server sets it.
    pub(crate) task_progress: Option<Arc<crate::cancellation::TaskProgress>>,
    /// Multi-instance middleware guard (`ServerInstances::Multiple`): checked atomically against
    /// the exact middleware snapshot `CommandRegistry::execute` runs.
    pub(crate) instance_guard: Option<InstanceGuard>,
    /// Who the transport says the caller is, for the idempotency step (`spec/idempotency.md`,
    /// S3). Only the MCP server sets it.
    pub(crate) idempotency_caller: Option<crate::idempotency::step::IdempotencyCaller>,
}

impl fmt::Debug for ServerCall {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ServerCall")
            .field("remote", &self.remote)
            .field("tool_surface", &self.tool_surface)
            .field("known", &self.known)
            .field("scope_check", &self.scope_check)
            // Relay evidence names the caller: never print it.
            .field(
                "relay_evidence",
                &self.relay_evidence.as_ref().map(|_| "[redacted]"),
            )
            .field("approval_relay", &self.approval_relay)
            .field("up_front_approval", &self.up_front_approval)
            .field("approver", &self.approver)
            .field("task_progress", &self.task_progress)
            .field("instance_guard", &self.instance_guard)
            .field("idempotency_caller", &self.idempotency_caller)
            .finish()
    }
}

/// A call with no server state, read through [`CommandContext::server`].
static NO_SERVER_CALL: ServerCall = ServerCall {
    remote: false,
    tool_surface: None,
    known: None,
    scope_check: None,
    relay_evidence: None,
    approval_relay: None,
    up_front_approval: None,
    approver: None,
    task_progress: None,
    instance_guard: None,
    idempotency_caller: None,
};

impl fmt::Debug for CommandContext {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("CommandContext")
            .field("trace_id", &self.trace_id)
            .field("timeout_ms", &self.timeout_ms)
            .field("interface", &self.interface)
            // The actor's id and principal may come from the credentials (a client id and a
            // subject), so they print redacted, as the credentials do.
            .field("actor", &self.actor.as_ref().map(RedactedActor))
            .field("credentials", &self.credentials)
            // An approval token is a credential: never print it.
            .field("approval", &self.approval.as_ref().map(|_| "[redacted]"))
            .field("clock", &self.clock.as_ref().map(|_| ".."))
            .field("random", &self.random.as_ref().map(|_| ".."))
            .field("extra", &self.extra)
            .field("journal_state", &self.journal_state)
            .field("context_scope", &self.context_scope)
            .field("output_budget_ask", &self.output_budget_ask)
            .field("output_budget", &self.output_budget)
            .field("cancellation", &self.cancellation)
            .field("approval_admission", &self.approval_admission)
            .field("server", &self.server)
            .field("dispatch_id", &self.dispatch_id)
            .field("idempotency_key", &self.idempotency_key)
            .field("idempotency", &self.idempotency)
            .finish()
    }
}

/// An actor in debug output: its kind and label, with `[redacted]` for its id and principal.
struct RedactedActor<'a>(&'a Actor);

impl fmt::Debug for RedactedActor<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        const REDACTED: &str = "[redacted]";
        f.debug_struct("Actor")
            .field("kind", &self.0.kind)
            .field("id", &self.0.id.as_ref().map(|_| REDACTED))
            .field("label", &self.0.label)
            .field(
                "on_behalf_of",
                &self.0.on_behalf_of.as_ref().map(|_| REDACTED),
            )
            .finish()
    }
}

/// The state of one call that only the crate sets, with the interface, the verified credentials,
/// and the clock and random source the call runs with (the journal's recording wrappers, or a
/// replay's tape): what [`CommandRegistry::execute`](super::CommandRegistry::execute) built
/// before the middleware ran. Every step of the chain (each inner layer and the handler) restores
/// it onto the context the layer before passed to `next`, so a middleware can refine only the
/// other public fields (`trace_id`, `actor`, `extra`, `approval`, ...): one that passes a new or
/// stale context cannot strip a caller's restrictions, an output budget or an approval admission
/// from the layers after it, or detach the journal's tape.
#[derive(Clone)]
pub(crate) struct CallState {
    interface: Option<CommandInterface>,
    credentials: Option<Arc<Credentials>>,
    clock: Option<Arc<dyn Clock>>,
    random: Option<Arc<dyn RandomSource>>,
    journal_state: JournalContextState,
    direct_approval: Option<Arc<std::sync::Mutex<crate::direct::Exchange>>>,
    context_scope: Option<crate::contexts::ContextScope>,
    output_budget_ask: Option<serde_json::Value>,
    output_budget: Option<u64>,
    cancellation: Option<crate::cancellation::CancellationSignal>,
    default_timeout_override: Option<Option<u64>>,
    approval_admission: Option<Arc<crate::approval::admission::Admission>>,
    server: Option<Arc<ServerCall>>,
    dispatch_id: Option<Arc<str>>,
    idempotency_key: Option<String>,
    idempotency_mark: crate::idempotency::key::KeyMark,
    idempotency: Option<Arc<crate::idempotency::step::StepCall>>,
}

impl CallState {
    /// The call state of `context`.
    pub(crate) fn of(context: &CommandContext) -> Self {
        // Every field is named, so a field added to `CommandContext` does not compile here
        // until it is restored below or listed as one a middleware may refine.
        let CommandContext {
            trace_id: _,
            timeout_ms: _,
            actor: _,
            approval: _,
            extra: _,
            interface,
            credentials,
            clock,
            random,
            journal_state,
            direct_approval,
            context_scope,
            output_budget_ask,
            output_budget,
            cancellation,
            default_timeout_override,
            approval_admission,
            server,
            dispatch_id,
            idempotency_key,
            idempotency_mark,
            idempotency,
        } = context;
        Self {
            interface: *interface,
            credentials: credentials.clone(),
            clock: clock.clone(),
            random: random.clone(),
            journal_state: journal_state.clone(),
            direct_approval: direct_approval.clone(),
            context_scope: context_scope.clone(),
            output_budget_ask: output_budget_ask.clone(),
            output_budget: *output_budget,
            cancellation: cancellation.clone(),
            default_timeout_override: *default_timeout_override,
            approval_admission: approval_admission.clone(),
            server: server.clone(),
            dispatch_id: dispatch_id.clone(),
            idempotency_key: idempotency_key.clone(),
            idempotency_mark: idempotency_mark.clone(),
            idempotency: idempotency.clone(),
        }
    }

    /// Put this call state back on `context`. The clock and random source are the call's too:
    /// a journaled call records the reads of the ones the recorder gave it, and a replay reads
    /// its tape, whatever context a middleware passes on.
    pub(crate) fn restore(&self, context: &mut CommandContext) {
        context.interface = self.interface;
        context.credentials.clone_from(&self.credentials);
        context.clock.clone_from(&self.clock);
        context.random.clone_from(&self.random);
        context.journal_state.clone_from(&self.journal_state);
        context.direct_approval.clone_from(&self.direct_approval);
        context.context_scope.clone_from(&self.context_scope);
        context
            .output_budget_ask
            .clone_from(&self.output_budget_ask);
        context.output_budget = self.output_budget;
        context.cancellation.clone_from(&self.cancellation);
        context.default_timeout_override = self.default_timeout_override;
        context
            .approval_admission
            .clone_from(&self.approval_admission);
        context.server.clone_from(&self.server);
        // A middleware cannot change the dispatch id the later links read (I3), nor put another
        // value in `extra` under its reserved name.
        context.dispatch_id.clone_from(&self.dispatch_id);
        // The key the engine checked and delivered (K2, K3), and the step's call: a middleware
        // cannot change the key the handler sees or the step acts on.
        context.idempotency_key.clone_from(&self.idempotency_key);
        context.idempotency_mark.clone_from(&self.idempotency_mark);
        context.idempotency.clone_from(&self.idempotency);
        if !context.extra.is_empty() {
            context.extra.remove("dispatch_id");
            context.extra.remove("dispatchId");
        }
    }
}

impl CommandContext {
    /// The call's server state, or an empty one for a call made in process.
    pub(crate) fn server(&self) -> &ServerCall {
        self.server.as_deref().unwrap_or(&NO_SERVER_CALL)
    }

    /// The call's server state to change: shared state is copied first, so the change stays
    /// with this context.
    #[cfg_attr(not(feature = "server"), allow(dead_code))]
    pub(crate) fn server_mut(&mut self) -> &mut ServerCall {
        Arc::make_mut(self.server.get_or_insert_with(Default::default))
    }

    /// The id of this dispatch (`spec/dispatch.md`, "The dispatch id"): 22 characters of
    /// unpadded base64url holding 128 bits from the OS random source, never from
    /// [`CommandContext::random`], so a journal's tape is unchanged.
    ///
    /// [`CommandRegistry::execute`](super::CommandRegistry::execute) sets a fresh one before any
    /// check, for every call it runs: each call, batch item and pipeline step, and each command a
    /// handler runs through the registry (the outer call keeps its own). Every middleware layer
    /// and the handler read the same value, a retry included: no caller or middleware can set it,
    /// and a context a middleware passes on gets the call's id back. `extra` values under
    /// `dispatch_id` or `dispatchId` are removed before the call runs, and declaring a context
    /// field of either name fails registration.
    ///
    /// A host that keeps its own record of a call (an intent written before the handler, the
    /// approval that admitted it, the outcome) keys it by this id. It is not stamped on the
    /// result, not written to a journal entry and not among the journal's context digest `keys`.
    /// `None` outside the registry, such as in [`CommandDefinition::execute`](super::CommandDefinition::execute),
    /// and on `wasm32-unknown-unknown` without the `wasm` feature, which has no random source.
    pub fn dispatch_id(&self) -> Option<&str> {
        self.dispatch_id.as_deref()
    }

    /// Create an empty context.
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the call's idempotency key (`spec/idempotency.md`, K1), as a caller's: the registry
    /// checks its form (K2). See [`Self::idempotency_key`].
    pub fn with_idempotency_key(mut self, key: impl Into<String>) -> Self {
        self.idempotency_key = Some(key.into());
        self.idempotency_mark = crate::idempotency::key::KeyMark::None;
        self
    }

    /// Set the trace ID.
    pub fn with_trace_id(mut self, trace_id: impl Into<String>) -> Self {
        self.trace_id = Some(trace_id.into());
        self
    }

    /// Set the deadline in milliseconds.
    pub fn with_timeout(mut self, timeout_ms: u64) -> Self {
        self.timeout_ms = Some(timeout_ms);
        self
    }

    /// Set the invoking interface, which turns on exposure checks.
    pub fn with_interface(mut self, interface: CommandInterface) -> Self {
        self.interface = Some(interface);
        self
    }

    /// Set the calling actor.
    pub fn with_actor(mut self, actor: impl Into<Actor>) -> Self {
        self.actor = Some(actor.into());
        self
    }

    /// Set the verified credentials of the caller's token. Trusted host code only: commands,
    /// middleware and scope checks believe them.
    pub fn with_credentials(mut self, credentials: impl Into<Arc<Credentials>>) -> Self {
        self.credentials = Some(credentials.into());
        self
    }

    /// Set the approval evidence: a token a human approved. Trusted surface code only.
    pub fn with_approval(mut self, token: impl Into<String>) -> Self {
        self.approval = Some(token.into());
        self
    }

    /// Set the clock, for example a [`fixed_clock`](crate::fixed_clock).
    pub fn with_clock(mut self, clock: impl Clock + 'static) -> Self {
        self.clock = Some(Arc::new(clock));
        self
    }

    /// Set the random source, for example a [`seeded_random`](crate::seeded_random).
    pub fn with_random(mut self, random: impl RandomSource + 'static) -> Self {
        self.random = Some(Arc::new(random));
        self
    }

    /// The context's clock, or [`SYSTEM_CLOCK`] when it has none.
    pub fn clock(&self) -> &dyn Clock {
        match &self.clock {
            Some(clock) => clock.as_ref(),
            None => &SYSTEM_CLOCK,
        }
    }

    /// The context's random source, or [`SYSTEM_RANDOM`] when it has none.
    pub fn random(&self) -> &dyn RandomSource {
        match &self.random {
            Some(random) => random.as_ref(),
            None => &SYSTEM_RANDOM,
        }
    }

    /// Run with `context` active, for this call only: commands outside it return
    /// `COMMAND_NOT_IN_CONTEXT`, and `afd-context-enter` and `afd-context-exit` report that
    /// nothing persists (see [`crate::contexts`]).
    pub fn with_active_context(mut self, context: impl Into<String>) -> Self {
        self.context_scope = Some(crate::contexts::ContextScope::Request(Some(context.into())));
        self
    }

    /// Run in the session whose contexts `stack` holds: its top is the active context, and
    /// `afd-context-enter` and `afd-context-exit` change it (see [`crate::contexts`]).
    pub fn with_context_stack(mut self, stack: crate::contexts::ContextStack) -> Self {
        self.context_scope = Some(crate::contexts::ContextScope::Session(stack));
        self
    }

    /// Attach a cooperative cancellation signal to this call (`spec/execution-controls.md`).
    pub fn with_cancellation(mut self, signal: crate::cancellation::CancellationSignal) -> Self {
        self.cancellation = Some(signal);
        self
    }

    /// The cancellation signal of this call (`spec/execution-controls.md`, `spec/command-metadata.md`):
    /// set by a caller via [`Self::with_cancellation`], linked to a command deadline, or attached by
    /// the MCP server for a task. `None` when none applies.
    pub fn cancellation(&self) -> Option<&crate::cancellation::CancellationSignal> {
        self.cancellation.as_ref()
    }

    /// Whether this call's cancellation signal has fired (see [`Self::cancellation`]).
    pub fn is_cancelled(&self) -> bool {
        self.cancellation
            .as_ref()
            .is_some_and(crate::cancellation::CancellationSignal::is_cancelled)
    }

    /// Whether this call is running as an MCP task (`spec/tasks.md`).
    pub fn is_task(&self) -> bool {
        self.server().task_progress.is_some()
    }

    /// Report progress: for a call the MCP server runs as a task, `message` becomes the task's
    /// `statusMessage` and moves its `lastUpdatedAt` (`spec/tasks.md`); no
    /// progress or log notification is sent. A message longer than
    /// [`MAX_PROGRESS_MESSAGE_BYTES`](crate::MAX_PROGRESS_MESSAGE_BYTES) is cut. Any other call
    /// ignores it. The client sees `statusMessage` and may show it to a person or a model, so
    /// report a phase or a count, never content.
    pub fn report_progress(&self, message: impl Into<String>) {
        if let Some(progress) = &self.server().task_progress {
            progress.report(message.into());
        }
    }

    /// The active context, if any.
    pub fn active_context(&self) -> Option<String> {
        self.context_scope
            .as_ref()
            .and_then(crate::contexts::ContextScope::active)
    }

    /// Ask for an output budget of at most `max_bytes` for this call (`spec/output-budgets.md`,
    /// B2): the in-process form of `_meta["dev.afd/outputBudget"] = { "maxBytes": n }`.
    ///
    /// It matters only for a command that declares a budget
    /// ([`CommandDefinition::with_output_budget`]): its effective budget is then
    /// `min(max_bytes, maxBytes)`, a larger ask being clamped. [`CommandRegistry::execute`](super::CommandRegistry::execute)
    /// validates the ask like any call's: `max_bytes` must be from 1 to 9007199254740991, or the
    /// call fails with `VALIDATION_ERROR` before the middleware and the handler run, whether or
    /// not the command declares a budget. A value set here is trusted code's: the MCP server's
    /// context hook may set it, and it is never overwritten from `_meta`.
    pub fn with_output_budget_ask(mut self, max_bytes: u64) -> Self {
        self.output_budget_ask = Some(crate::output_budget::ask_value(max_bytes));
        self
    }

    /// The effective output budget of this call in bytes (B3, B4): the command's declared default
    /// or the caller's ask clamped to its maximum. `None` for a command without a declaration.
    /// [`CommandRegistry::execute`](super::CommandRegistry::execute) sets it before the middleware and the handler run; a handler
    /// of a budgeted command should fit its result to it structurally (fewer items, shorter
    /// excerpts, a window with a way to read on) and never cut a JSON value in the middle.
    pub fn output_budget(&self) -> Option<u64> {
        self.output_budget
    }

    /// Add a custom context value.
    pub fn with_extra(mut self, key: impl Into<String>, value: serde_json::Value) -> Self {
        self.extra.insert(key.into(), value);
        self
    }
}

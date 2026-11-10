//! What a call needs (phase 5 specification, section 5.2; D112, owner decision 3), decided once
//! for the two places that ask: Umbel's [`ScopeResolver`] before dispatch and at execution
//! (section 3.3; AFD's M6), and the host's scope gate inside the registry
//! ([`super::scope_gate`]).
//!
//! **The rows of 5.2, as a union.** A call needs, for each space it runs in (its `space` or
//! `spaces` input, else the default space), `read` there; `write` there for a mutating command;
//! `approve` there for a command with an approval policy, a host-verified confirmation or
//! `confirm = "require-human"`; `erase` there for `memory-erase` and any command named like an
//! erase. A space-less command (a host built-in without a space input, a meta-tool or
//! `afd-context-*`) needs any Umbel scope, and the verbs above that it would need beyond `read`
//! unqualified. A mounted tool without `bind_space`, the space-less `external` command of 5.2,
//! needs unqualified `write`, beside its default space. A pipeline needs every step's needs. A
//! command's static `scopes` are needed exactly. `afd-call`, `afd-batch` and `afd-pipe` are
//! resolved step by step by AFD.
//!
//! **Readability before scope (5.4).** Before any scope is named, every space of the call must be
//! one the token grants a verb in and the caller may read; otherwise the decision is
//! [`Verdict::Unreadable`], which the resolver turns into `Defer` so that the registry answers
//! `SPACE_NOT_READABLE`, the same answer an undeclared space gets. A missing scope is named only
//! for a space the caller reads and its token grants a verb in, so naming it tells the caller
//! nothing new. When the caller's readability cannot be known (the resolver could not find the
//! request's mapped caller), a call that would be refused defers too, and the scope gate, which
//! always knows its caller, answers exactly.
//!
//! **A token with no Umbel scope** needs `<prefix>:read` for every call and every request: the
//! "any Umbel scope" of 5.2's space-less rows, applied to everything, decided on the token alone.

use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::sync::Arc;

use afd::CommandRegistry;
use serde_json::Value;

use super::{Scope, ScopeVerb};
use crate::plugins::{GateEntry, PluginKind};
use crate::workspace::{SpaceId, Workspace};

/// Where a command runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Placement {
    /// Nowhere: a host built-in without a space input, a meta-tool, `afd-context-*`.
    Spaceless,
    /// In the default space: a plugin command without a space input, or an embedder's command.
    Default,
    /// In the spaces its input names (`space`, `spaces`), else the default space.
    Input { space: bool, spaces: bool },
}

/// What one registered command needs, fixed at seal.
#[derive(Debug, Clone)]
struct Needs {
    placement: Placement,
    /// Whether MCP exposes the command; the resolver treats any other as unknown.
    mcp: bool,
    /// The verbs needed in each space of the call, in 5.1's order; `read` always.
    verbs: BTreeSet<ScopeVerb>,
    /// The verbs needed unqualified.
    unqualified: BTreeSet<ScopeVerb>,
    /// The command's static `scopes`, needed exactly.
    fixed: Vec<String>,
    /// For a plugin command, the spaces its instance serves (the listings' candidates).
    #[cfg_attr(not(feature = "auth"), allow(dead_code))]
    served: Option<Vec<String>>,
}

/// What a call gets.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Verdict {
    /// Every need is held.
    Allowed,
    /// These scopes are missing, each a scope token, in the order of 5.1's verbs: unqualified
    /// ones first, then each space's, then the static ones.
    Missing(Vec<String>),
    /// A space of the call is one the caller may not read, or its token grants no verb in, or
    /// is not declared: the registry answers it (5.4).
    Unreadable,
    /// A plugin command whose instance serves no space the caller reads: to that caller the
    /// command does not exist (section 9.4 hides the instance), so it is decided as an unknown
    /// name, and the host answers it as one.
    Hidden,
    /// The call cannot be decided here (its spaces are malformed, or the caller's readability is
    /// unknown): the registry answers it.
    Undecided,
}

/// Section 5.2's rules over one sealed host's commands.
pub(crate) struct ScopePolicy {
    workspace: Arc<Workspace>,
    prefix: String,
    needs: BTreeMap<String, Needs>,
    /// Every registered command, in registration order, for an unknown name's suggestions.
    definitions: Vec<Arc<afd::CommandDefinition>>,
    /// The commands a person decides over MCP, and which namespaces serve them (phase 5
    /// section 7.1), set once at seal in a hosted mode.
    #[cfg(feature = "auth")]
    person: std::sync::OnceLock<Arc<crate::person::service::PersonService>>,
}

impl std::fmt::Debug for ScopePolicy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ScopePolicy")
            .field("prefix", &self.prefix)
            .field("commands", &self.needs.len())
            .finish_non_exhaustive()
    }
}

/// Whether `command` erases: `memory-erase`, or any command whose name ends in `-erase`, whatever
/// its instance prefix (amendment from step 2b).
fn erases(command: &str) -> bool {
    command == "memory-erase" || command.ends_with("-erase")
}

impl ScopePolicy {
    /// The policy of `registry`'s commands, as sealed: `gate` holds the plugin commands,
    /// `builtins` the host's own, and `with_space` and `with_spaces` the commands whose input
    /// the host resolves a `space` or `spaces` from.
    pub(crate) fn new(
        workspace: Arc<Workspace>,
        registry: &CommandRegistry,
        gate: &BTreeMap<String, GateEntry>,
        builtins: &HashSet<String>,
        with_space: &HashSet<String>,
        with_spaces: &HashSet<String>,
    ) -> Self {
        let prefix = workspace.config().auth.scope_prefix.clone();
        let mut needs: BTreeMap<String, Needs> = BTreeMap::new();
        let definitions = registry.list();
        for definition in &definitions {
            let name = definition.name.as_str();
            let entry = gate.get(name);
            let placement = match entry {
                Some(entry) if entry.space_command || entry.spaces_command => Placement::Input {
                    space: entry.space_command,
                    spaces: entry.spaces_command,
                },
                Some(_) => Placement::Default,
                None if with_space.contains(name) || with_spaces.contains(name) => {
                    Placement::Input {
                        space: with_space.contains(name),
                        spaces: with_spaces.contains(name),
                    }
                }
                // Meta-tools, AFD's bootstrap commands and `afd-context-*`.
                None if name.starts_with("afd-") => Placement::Spaceless,
                None if builtins.contains(name) => Placement::Spaceless,
                // An embedder's command runs in the default space, where its events go.
                None => Placement::Default,
            };
            let mut verbs = BTreeSet::from([ScopeVerb::Read]);
            if definition.mutation {
                verbs.insert(ScopeVerb::Write);
            }
            if definition.approval.is_some()
                || definition.confirmation_mode.is_some()
                || entry.is_some_and(|entry| entry.require_human)
            {
                verbs.insert(ScopeVerb::Approve);
            }
            if erases(name) {
                verbs.insert(ScopeVerb::Erase);
            }
            let mut unqualified = BTreeSet::new();
            if placement == Placement::Spaceless {
                unqualified.extend(verbs.iter().copied().filter(|v| *v != ScopeVerb::Read));
            }
            if entry.is_some_and(|entry| entry.kind == PluginKind::Mounted && !entry.space_command)
            {
                // 5.2: a space-less `external` command (a mount without `bind_space`).
                unqualified.insert(ScopeVerb::Write);
            }
            needs.insert(
                name.to_owned(),
                Needs {
                    placement,
                    mcp: definition.expose.mcp,
                    verbs,
                    unqualified,
                    fixed: definition.scopes.clone().unwrap_or_default(),
                    served: entry.map(|entry| entry.spaces.clone()),
                },
            );
        }
        // A pipeline needs every step's needs, in the pipeline's own spaces.
        for (name, entry) in gate.iter().filter(|(_, entry)| entry.pipeline) {
            let steps: Vec<Needs> = entry
                .steps
                .iter()
                .filter_map(|step| needs.get(step).cloned())
                .collect();
            if let Some(pipeline) = needs.get_mut(name) {
                for step in steps {
                    pipeline.verbs.extend(step.verbs);
                    pipeline.unqualified.extend(step.unqualified);
                    for scope in step.fixed {
                        if !pipeline.fixed.contains(&scope) {
                            pipeline.fixed.push(scope);
                        }
                    }
                }
            }
        }
        Self {
            workspace,
            prefix,
            needs,
            definitions,
            #[cfg(feature = "auth")]
            person: std::sync::OnceLock::new(),
        }
    }

    /// Serve the commands `service` decides over MCP only to callers whose namespace serves
    /// verified commands (7.1); set once, at seal.
    #[cfg(feature = "auth")]
    pub(crate) fn set_person(&self, service: Arc<crate::person::service::PersonService>) {
        let _ = self.person.set(service);
    }

    /// Whether `command` is decided on the person page over MCP and the caller in `namespace`
    /// may not be served it: elsewhere it is not listed and is refused as an unexposed command
    /// (7.1), so it does not exist for that caller.
    #[cfg(feature = "auth")]
    pub(crate) fn person_withheld(&self, command: &str, namespace: Option<&str>) -> bool {
        let Some(service) = self.person.get() else {
            return false;
        };
        service.mcp_commands().contains(command)
            && !namespace.is_some_and(|namespace| service.served(namespace))
    }

    /// Whether `command` is a plugin command whose instance serves no space `reads` admits: one
    /// section 9.4's listings never name to this caller.
    pub(crate) fn hidden(&self, command: &str, reads: &dyn Fn(&str) -> bool) -> bool {
        self.needs
            .get(command)
            .and_then(|needs| needs.served.as_ref())
            .is_some_and(|served| !served.iter().any(|space| reads(space)))
    }

    /// Whether `command` exists for a caller (AFD's `ScopeResolver::known`, M6 "Hidden
    /// commands"): it is exposed to MCP and, for a plugin command, its instance serves a space
    /// `reads` admits ([`Self::hidden`]). When the caller's readability cannot be known (`None`),
    /// no plugin command exists for it, so a guess never reveals one; every other command does.
    /// A command that exists for the caller but that it may not call stays callable, so a missing
    /// scope it may learn is still named (5.4).
    #[cfg_attr(not(feature = "auth"), allow(dead_code))]
    pub(crate) fn known(&self, command: &str, reads: Option<&dyn Fn(&str) -> bool>) -> bool {
        let Some(needs) = self.needs_of(command, true) else {
            return false;
        };
        match (&needs.served, reads) {
            (None, _) => true,
            (Some(_), Some(reads)) => !self.hidden(command, reads),
            (Some(_), None) => false,
        }
    }

    /// AFD's `COMMAND_NOT_FOUND` for a remote caller naming `name`, exactly as the registry words
    /// it for a name it does not know: the message, and a suggestion naming up to three close
    /// matches among the MCP-exposed commands the caller may call in `context`'s active context
    /// that `listed` admits, then pointing to `afd-discover`.
    pub(crate) fn unknown_command(
        &self,
        name: &str,
        context: &afd::CommandContext,
        listed: &dyn Fn(&str) -> bool,
    ) -> afd::CommandError {
        let active = context.active_context();
        let callable: Vec<String> = self
            .definitions
            .iter()
            .filter(|command| command.expose.mcp)
            .filter(|command| command.is_accessible_in_context(active.as_deref()))
            .filter(|command| listed(&command.name))
            .map(|command| command.name.clone())
            .collect();
        let list = "Use afd-discover to list all commands.";
        let mut matches = afd::find_similar_tools(name, &callable, Some(3)).into_iter();
        let suggestion = match matches.next() {
            None => list.to_owned(),
            Some(best) => {
                let others: Vec<String> = matches.map(|other| format!("'{other}'")).collect();
                let also = if others.is_empty() {
                    String::new()
                } else {
                    format!(" Other close matches: {}.", others.join(", "))
                };
                format!("Did you mean '{best}'?{also} {list}")
            }
        };
        afd::CommandError::new(
            afd::error_codes::COMMAND_NOT_FOUND,
            format!("Command '{name}' not found"),
        )
        .with_suggestion(suggestion)
        .with_retryable(false)
    }

    /// The workspace.
    pub(crate) fn workspace(&self) -> &Workspace {
        &self.workspace
    }

    /// The Umbel scopes among `scopes` (5.1): the others are ignored.
    #[cfg_attr(not(feature = "auth"), allow(dead_code))]
    pub(crate) fn umbel_scopes(&self, scopes: &[String]) -> Vec<Scope> {
        scopes
            .iter()
            .filter_map(|scope| Scope::parse(&self.prefix, scope))
            .collect()
    }

    /// `<prefix>:read`, what a token with no Umbel scope is told to obtain.
    pub(crate) fn read_scope(&self) -> String {
        Scope {
            verb: ScopeVerb::Read,
            space: None,
        }
        .to_scope_string(&self.prefix)
    }

    fn needs_of(&self, command: &str, mcp_only: bool) -> Option<&Needs> {
        self.needs
            .get(command)
            .filter(|needs| !mcp_only || needs.mcp)
    }

    /// The spaces a call of `needs` runs in, from `input` as the host resolves them
    /// (`Workspace::resolve_spaces`), without asking whether they exist: `None` when the input
    /// names them in a form the host refuses (the registry then answers it).
    fn call_spaces(&self, needs: &Needs, input: &Value) -> Option<Vec<String>> {
        let default = || self.workspace.default_space().as_str().to_owned();
        match needs.placement {
            Placement::Spaceless => Some(Vec::new()),
            Placement::Default => Some(vec![default()]),
            Placement::Input { spaces, .. } => {
                if spaces {
                    match input.get("spaces") {
                        None | Some(Value::Null) => {}
                        Some(Value::Array(listed)) => {
                            if matches!(input.get("space"), Some(value) if !value.is_null())
                                || listed.is_empty()
                            {
                                return None;
                            }
                            let mut names: Vec<String> = Vec::with_capacity(listed.len());
                            for entry in listed {
                                let name = entry.as_str()?;
                                if names.iter().any(|seen| seen == name) {
                                    return None;
                                }
                                names.push(name.to_owned());
                            }
                            return Some(names);
                        }
                        Some(_) => return None,
                    }
                }
                match input.get("space") {
                    None | Some(Value::Null) => Some(vec![default()]),
                    Some(Value::String(space)) => Some(vec![space.clone()]),
                    Some(_) => None,
                }
            }
        }
    }

    /// Decide a call of `command` with `input` for a token holding `held` (its Umbel scopes) and
    /// `held_text` (every scope as sent, for static `scopes`). `reads` says whether the caller
    /// may read a space and its token grants a verb there; `None` when that cannot be known.
    /// `mcp_only` treats a command MCP does not expose as unknown, as the resolver must (a scope
    /// must never reveal a command a remote caller cannot see).
    pub(crate) fn decide(
        &self,
        command: &str,
        input: &Value,
        held: &[Scope],
        held_text: &[String],
        reads: Option<&dyn Fn(&str) -> bool>,
        mcp_only: bool,
    ) -> Verdict {
        if held.is_empty() {
            return Verdict::Missing(vec![self.read_scope()]);
        }
        let Some(needs) = self.needs_of(command, mcp_only) else {
            // An unknown or unexposed name, a tool that names no command: any Umbel scope.
            return Verdict::Allowed;
        };
        if reads.is_some_and(|reads| self.hidden(command, reads)) {
            return Verdict::Hidden;
        }
        let Some(spaces) = self.call_spaces(needs, input) else {
            return Verdict::Undecided;
        };
        for space in &spaces {
            if !grants_a_verb(held, space) || reads.is_some_and(|reads| !reads(space)) {
                return Verdict::Unreadable;
            }
        }
        let missing = self.missing(needs, &spaces, held, held_text);
        if missing.is_empty() {
            Verdict::Allowed
        } else if reads.is_none() && !spaces.is_empty() {
            Verdict::Undecided
        } else {
            Verdict::Missing(missing)
        }
    }

    fn missing(
        &self,
        needs: &Needs,
        spaces: &[String],
        held: &[Scope],
        held_text: &[String],
    ) -> Vec<String> {
        let holds = |wanted: &Scope| held.iter().any(|scope| scope.implies(wanted));
        let mut missing: Vec<String> = Vec::new();
        for verb in &needs.unqualified {
            let wanted = Scope {
                verb: *verb,
                space: None,
            };
            if !holds(&wanted) {
                missing.push(wanted.to_scope_string(&self.prefix));
            }
        }
        for space in spaces {
            // Every space here passed `grants_a_verb`, so it parses.
            let Ok(id) = SpaceId::parse(space) else {
                continue;
            };
            for verb in &needs.verbs {
                let wanted = Scope {
                    verb: *verb,
                    space: Some(id.clone()),
                };
                if !holds(&wanted) {
                    missing.push(wanted.to_scope_string(&self.prefix));
                }
            }
        }
        for scope in &needs.fixed {
            if !held_text.contains(scope) && !missing.contains(scope) {
                missing.push(scope.clone());
            }
        }
        missing
    }

    /// Whether a caller may see `command` on the listings (section 3.3's `visible`): it holds an
    /// Umbel scope, and some call of the command could be allowed in a space it may read and its
    /// token grants (`reads`), or, for a space-less command, it holds the unqualified verbs and
    /// static scopes the command needs. The candidates are only spaces the caller reads, so the
    /// answer depends on nothing it cannot see.
    #[cfg_attr(not(feature = "auth"), allow(dead_code))]
    pub(crate) fn visible(
        &self,
        command: &str,
        held: &[Scope],
        held_text: &[String],
        reads: &dyn Fn(&str) -> bool,
    ) -> bool {
        if held.is_empty() {
            return false;
        }
        let Some(needs) = self.needs_of(command, true) else {
            return false;
        };
        let candidates: Vec<String> = match needs.placement {
            Placement::Spaceless => return self.missing(needs, &[], held, held_text).is_empty(),
            Placement::Default => vec![self.workspace.default_space().as_str().to_owned()],
            Placement::Input { .. } => match &needs.served {
                Some(served) => served.clone(),
                None => self
                    .workspace
                    .spaces()
                    .iter()
                    .map(|space| space.id.as_str().to_owned())
                    .collect(),
            },
        };
        candidates.iter().any(|space| {
            grants_a_verb(held, space)
                && reads(space)
                && self
                    .missing(needs, std::slice::from_ref(space), held, held_text)
                    .is_empty()
        })
    }
}

/// Whether `held` grants some verb in `space`: a scope implying `read` there (5.1). A space id
/// that does not parse is granted nothing.
pub(crate) fn grants_a_verb(held: &[Scope], space: &str) -> bool {
    SpaceId::parse(space).is_ok_and(|space| {
        let read = Scope {
            verb: ScopeVerb::Read,
            space: Some(space),
        };
        held.iter().any(|scope| scope.implies(&read))
    })
}

/// Umbel's `ScopeResolver` (section 3.3) for mode `oauth`: [`ScopePolicy::decide`] for the
/// verified caller of the request in flight that holds the credentials asked about.
#[cfg(feature = "auth")]
pub(crate) struct UmbelScopes {
    policy: Arc<ScopePolicy>,
    book: super::caller::CallerBook,
}

#[cfg(feature = "auth")]
impl UmbelScopes {
    pub(crate) fn new(policy: Arc<ScopePolicy>, book: super::caller::CallerBook) -> Self {
        Self { policy, book }
    }

    /// The access caller of the request in flight whose mapped caller holds `credentials`;
    /// `None` when there is none, more than one that differ, or one vouched for otherwise than
    /// the workspace's `auth.mode` vouches (a token's caller in mode `gateway`, an assertion's in
    /// mode `oauth`). Its claim groups are [`super::caller::VerifiedCaller::claim_groups`], so
    /// never a gateway's.
    /// The namespace of the request in flight whose mapped caller holds `credentials`, vouched
    /// for as the workspace's `auth.mode` vouches; `None` otherwise.
    fn namespace(&self, credentials: &afd::Credentials) -> Option<String> {
        let verified = self.book.caller_for(credentials)?;
        verified
            .vouched_for(self.policy.workspace().config().auth.mode)
            .then(|| verified.namespace.clone())
    }

    fn caller(&self, credentials: &afd::Credentials) -> Option<crate::access::Caller> {
        let verified = self.book.caller_for(credentials)?;
        let config = self.policy.workspace().config();
        if !verified.vouched_for(config.auth.mode) {
            return None;
        }
        Some(crate::access::Caller::new(
            config,
            verified.effective_principal(),
            verified.claim_groups().to_vec(),
            crate::access::Narrowing::Token(self.policy.umbel_scopes(&verified.scopes)),
            false,
        ))
    }
}

#[cfg(feature = "auth")]
fn reads_for<'a>(
    config: &'a crate::workspace::Config,
    caller: &'a crate::access::Caller,
) -> impl Fn(&str) -> bool + 'a {
    move |space: &str| {
        config
            .spaces
            .iter()
            .find(|candidate| candidate.id.as_str() == space)
            .is_some_and(|declared| caller.reads(config, declared))
    }
}

#[cfg(feature = "auth")]
impl afd::server::auth::ScopeResolver for UmbelScopes {
    fn resolve(
        &self,
        command: &str,
        input: &Value,
        credentials: &afd::Credentials,
    ) -> afd::server::auth::ScopeDecision {
        use afd::server::auth::ScopeDecision;
        let held = self.policy.umbel_scopes(&credentials.scopes);
        let config = self.policy.workspace().config();
        let caller = self.caller(credentials);
        let reads = caller.as_ref().map(|caller| reads_for(config, caller));
        let reads: Option<&dyn Fn(&str) -> bool> = reads.as_ref().map(|reads| reads as _);
        match self
            .policy
            .decide(command, input, &held, &credentials.scopes, reads, true)
        {
            // A hidden command is an unknown name to this caller, which any Umbel scope admits.
            Verdict::Allowed | Verdict::Hidden => ScopeDecision::Allowed,
            Verdict::Missing(missing) => ScopeDecision::Missing(missing),
            Verdict::Unreadable | Verdict::Undecided => ScopeDecision::Defer,
        }
    }

    /// A plugin command whose instance serves no space the caller reads does not exist for it
    /// (section 9.4), so AFD answers its call exactly as a name nobody registered, on every
    /// route and before its input is validated. Any other exposed command exists, listed or
    /// not, so a call the token cannot make is still told which scope to obtain.
    ///
    /// AFD requires `known` to be a pure function of the command and the credentials. It reads
    /// the caller from the in-flight [`super::caller::CallerBook`], which holds a request's
    /// caller only while that request is in flight: AFD asks `known` only then (once per request,
    /// as it arrives; a `tasks/*` request is itself in flight), and a task's runner uses the
    /// answer given when the task was created, never asking again after the request is
    /// answered. Without the caller, no plugin command exists, so a lookup that fails never
    /// reveals one.
    fn known(&self, command: &str, credentials: &afd::Credentials) -> bool {
        if self
            .policy
            .person_withheld(command, self.namespace(credentials).as_deref())
        {
            return false;
        }
        let config = self.policy.workspace().config();
        let caller = self.caller(credentials);
        let reads = caller.as_ref().map(|caller| reads_for(config, caller));
        let reads: Option<&dyn Fn(&str) -> bool> = reads.as_ref().map(|reads| reads as _);
        self.policy.known(command, reads)
    }

    fn visible(&self, command: &str, credentials: &afd::Credentials) -> bool {
        if self
            .policy
            .person_withheld(command, self.namespace(credentials).as_deref())
        {
            return false;
        }
        let Some(caller) = self.caller(credentials) else {
            // Without the caller nothing here can tell which spaces it reads: list nothing
            // rather than guess.
            return false;
        };
        let held = self.policy.umbel_scopes(&credentials.scopes);
        let config = self.policy.workspace().config();
        self.policy.visible(
            command,
            &held,
            &credentials.scopes,
            &reads_for(config, &caller),
        )
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use afd::{CommandContext, CommandDefinition, CommandHandler, CommandResult, ExposeOptions};
    use serde_json::json;

    struct Nothing;

    #[async_trait::async_trait]
    impl CommandHandler for Nothing {
        async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
            afd::success(Value::Null)
        }
    }

    fn command(name: &str, mutation: bool) -> CommandDefinition {
        let mut command = CommandDefinition::new(name, "A command.", vec![], Nothing);
        command.expose = ExposeOptions {
            mcp: true,
            ..ExposeOptions::default()
        };
        command.mutation = mutation;
        command
    }

    fn entry(spaces: &[&str], space_command: bool, kind: PluginKind) -> GateEntry {
        GateEntry {
            instance: "p".into(),
            kind,
            spaces: spaces.iter().map(|s| (*s).to_owned()).collect(),
            space_command,
            spaces_command: space_command,
            require_human: false,
            person: None,
            preview: None,
            pipeline: false,
            memory_writer: false,
            digest: None,
            authority_prompt: None,
            steps: Vec::new(),
        }
    }

    /// A policy over: `p-read` (a plugin command with a space input), `p-write` (the same, a
    /// mutation), `p-plain` (a plugin command without one), `m-tool` (a mount without
    /// `bind_space`), `p-flow` (a pipeline of `p-write`), `x-erase`, `x-gated` (an approval
    /// policy) and `x-plain` (an embedder's), `x-show` (a space-less built-in), `x-hidden` (not on
    /// MCP), and `afd-help`.
    fn policy(dir: &std::path::Path) -> ScopePolicy {
        policy_with(
            dir,
            "config_version = 3\ndefault_space = \"main\"\n[spaces.main]\n[spaces.alpha]\n[spaces.beta]\n",
        )
    }

    /// [`policy`]'s commands over the workspace `text` configures.
    fn policy_with(dir: &std::path::Path, text: &str) -> ScopePolicy {
        std::fs::write(dir.join("umbel.toml"), text).unwrap();
        let workspace = Arc::new(Workspace::open(dir).unwrap());
        let registry = CommandRegistry::new();
        let mut gated = command("x-gated", false);
        gated.approval = Some(afd::ApprovalPolicy::Required);
        let mut hidden = command("x-hidden", true);
        hidden.expose.mcp = false;
        for command in [
            command("p-read", false),
            command("p-write", true),
            command("p-plain", false),
            command("m-tool", false),
            command("p-flow", false),
            command("x-erase", true),
            gated,
            command("x-plain", false),
            command("x-show", false),
            hidden,
            command("afd-help", false),
        ] {
            registry.register(command).unwrap();
        }
        let mut gate = BTreeMap::new();
        gate.insert(
            "p-read".to_owned(),
            entry(&["main", "alpha"], true, PluginKind::Compiled),
        );
        gate.insert(
            "p-write".to_owned(),
            entry(&["main", "alpha"], true, PluginKind::Compiled),
        );
        gate.insert(
            "p-plain".to_owned(),
            entry(&["main"], false, PluginKind::Compiled),
        );
        gate.insert(
            "m-tool".to_owned(),
            entry(&["main"], false, PluginKind::Mounted),
        );
        let mut flow = entry(&["main", "alpha"], true, PluginKind::Compiled);
        flow.pipeline = true;
        flow.steps = vec!["p-write".into()];
        gate.insert("p-flow".to_owned(), flow);
        let builtins = HashSet::from(["x-show".to_owned(), "x-hidden".to_owned()]);
        let none = HashSet::new();
        ScopePolicy::new(workspace, &registry, &gate, &builtins, &none, &none)
    }

    fn held(policy: &ScopePolicy, scopes: &[&str]) -> Vec<Scope> {
        let text: Vec<String> = scopes.iter().map(|s| (*s).to_owned()).collect();
        policy.umbel_scopes(&text)
    }

    fn decide(policy: &ScopePolicy, command: &str, input: Value, scopes: &[&str]) -> Verdict {
        let reads = |space: &str| space == "main" || space == "alpha";
        policy.decide(
            command,
            &input,
            &held(policy, scopes),
            &[],
            Some(&reads),
            true,
        )
    }

    fn missing(scopes: &[&str]) -> Verdict {
        Verdict::Missing(scopes.iter().map(|s| (*s).to_owned()).collect())
    }

    #[test]
    fn a_call_needs_the_union_of_every_row_in_each_of_its_spaces() {
        let dir = tempfile::tempdir().unwrap();
        let policy = policy(dir.path());
        let alpha = json!({ "space": "alpha" });
        assert_eq!(
            decide(&policy, "p-read", alpha.clone(), &["umbel:read:alpha"]),
            Verdict::Allowed
        );
        assert_eq!(
            decide(&policy, "p-write", alpha.clone(), &["umbel:read:alpha"]),
            missing(&["umbel:write:alpha"])
        );
        // Every verb on a space implies read there; an unqualified verb, every space.
        assert_eq!(
            decide(&policy, "p-write", alpha.clone(), &["umbel:write:alpha"]),
            Verdict::Allowed
        );
        assert_eq!(
            decide(&policy, "p-write", alpha.clone(), &["umbel:write"]),
            Verdict::Allowed
        );
        // A plugin command without a space input runs in the default space.
        assert_eq!(
            decide(
                &policy,
                "p-plain",
                json!({ "space": "alpha" }),
                &["umbel:read:alpha"]
            ),
            Verdict::Unreadable
        );
        assert_eq!(
            decide(&policy, "p-plain", json!({}), &["umbel:read:main"]),
            Verdict::Allowed
        );
        // `spaces` names several; each needs its own.
        assert_eq!(
            decide(
                &policy,
                "p-write",
                json!({ "spaces": ["main", "alpha"] }),
                &["umbel:write:alpha", "umbel:read:main"]
            ),
            missing(&["umbel:write:main"])
        );
        // An approval policy needs approve, an erase erase, beside write; in the default space.
        assert_eq!(
            decide(&policy, "x-gated", json!({}), &["umbel:write"]),
            missing(&["umbel:approve:main"])
        );
        assert_eq!(
            decide(&policy, "x-erase", json!({}), &["umbel:approve"]),
            missing(&["umbel:write:main", "umbel:erase:main"])
        );
        // A pipeline needs its steps' needs.
        assert_eq!(
            decide(&policy, "p-flow", alpha, &["umbel:read:alpha"]),
            missing(&["umbel:write:alpha"])
        );
        // A mount without bind_space needs unqualified write, beside its default space.
        assert_eq!(
            decide(&policy, "m-tool", json!({}), &["umbel:write:main"]),
            missing(&["umbel:write"])
        );
    }

    #[test]
    fn readability_comes_before_scope_and_space_less_commands_need_any_umbel_scope() {
        let dir = tempfile::tempdir().unwrap();
        let policy = policy(dir.path());
        // beta is unreadable to this caller, ghost undeclared, and a token for neither grants
        // anything: all defer, never naming a scope.
        for (space, scopes) in [
            ("beta", &["umbel:read:beta"][..]),
            ("ghost", &["umbel:read:ghost"][..]),
            ("alpha", &["umbel:read:main"][..]),
            ("Not A Space", &["umbel:write"][..]),
        ] {
            assert_eq!(
                decide(&policy, "p-write", json!({ "space": space }), scopes),
                Verdict::Unreadable,
                "{space}"
            );
        }
        // One unreadable space defers the whole call.
        assert_eq!(
            decide(
                &policy,
                "p-write",
                json!({ "spaces": ["alpha", "beta"] }),
                &["umbel:read"]
            ),
            Verdict::Unreadable
        );
        // A malformed list is the registry's to answer.
        assert_eq!(
            decide(
                &policy,
                "p-read",
                json!({ "spaces": ["alpha", "alpha"] }),
                &["umbel:read"]
            ),
            Verdict::Undecided
        );
        // Without knowing what the caller reads, a call that would be refused is undecided.
        assert_eq!(
            policy.decide(
                "p-write",
                &json!({ "space": "alpha" }),
                &held(&policy, &["umbel:read:alpha"]),
                &[],
                None,
                true
            ),
            Verdict::Undecided
        );
        // Space-less: any Umbel scope, even one naming a space nobody declared.
        for command in ["x-show", "afd-help", "not-a-command", "x-hidden"] {
            assert_eq!(
                decide(&policy, command, json!({}), &["umbel:read:ghost"]),
                Verdict::Allowed,
                "{command}"
            );
            assert_eq!(
                decide(&policy, command, json!({}), &["openid"]),
                missing(&["umbel:read"]),
                "{command}"
            );
        }
        // The gate decides commands MCP does not expose by their own needs.
        let reads = |_: &str| true;
        assert_eq!(
            policy.decide(
                "x-hidden",
                &json!({}),
                &held(&policy, &["umbel:read"]),
                &[],
                Some(&reads),
                false
            ),
            missing(&["umbel:write"])
        );
    }

    #[test]
    fn visible_depends_only_on_spaces_the_caller_reads() {
        let dir = tempfile::tempdir().unwrap();
        let policy = policy(dir.path());
        let reads = |space: &str| space == "main" || space == "alpha";
        let visible = |command: &str, scopes: &[&str]| {
            policy.visible(command, &held(&policy, scopes), &[], &reads)
        };
        assert!(visible("p-read", &["umbel:read:alpha"]));
        assert!(!visible("p-write", &["umbel:read:alpha"]));
        assert!(visible("p-write", &["umbel:write:alpha"]));
        // The instance serves main and alpha only: a token for beta (unreadable) and one for a
        // space nobody declared see the same.
        assert_eq!(
            visible("p-read", &["umbel:read:beta"]),
            visible("p-read", &["umbel:read:ghost"])
        );
        assert!(!visible("p-read", &["umbel:read:beta"]));
        assert!(visible("x-show", &["umbel:read:ghost"]));
        assert!(!visible("x-show", &["openid"]));
        assert!(!visible("x-hidden", &["umbel:write"]));
        assert!(!visible("m-tool", &["umbel:write:main"]));
        assert!(visible("m-tool", &["umbel:write"]));
    }

    #[test]
    fn a_command_exists_unless_its_instance_serves_no_space_the_caller_reads() {
        let dir = tempfile::tempdir().unwrap();
        let policy = policy(dir.path());
        let alpha = |space: &str| space == "alpha";
        let beta = |space: &str| space == "beta";
        // The instance serves main and alpha: it exists for a reader of alpha, whatever the
        // token may call there, so a missing scope is still named for it.
        assert!(policy.known("p-write", Some(&alpha)));
        assert!(!policy.known("p-write", Some(&beta)));
        assert!(!policy.known("p-plain", Some(&beta)));
        // A command of no instance always exists; an unexposed or unknown one never does.
        assert!(policy.known("x-show", Some(&beta)));
        assert!(policy.known("afd-help", None));
        assert!(!policy.known("x-hidden", Some(&alpha)));
        assert!(!policy.known("not-a-command", Some(&alpha)));
        // Without what the caller reads, no plugin command exists for it.
        assert!(!policy.known("p-read", None));
    }

    #[cfg(feature = "auth")]
    #[test]
    fn without_the_requests_caller_the_resolver_defers_and_lists_nothing() {
        use afd::server::auth::{ScopeDecision, ScopeResolver};
        let dir = tempfile::tempdir().unwrap();
        let policy = Arc::new(policy(dir.path()));
        let resolver = UmbelScopes::new(policy, super::super::caller::CallerBook::default());
        let credentials = afd::Credentials::new("https://as", "ada", "app", "https://r/mcp", 1, 2)
            .with_scopes(["umbel:read:alpha"]);
        // A call that would be refused needs to know what the caller reads: deferred.
        assert_eq!(
            resolver.resolve("p-write", &json!({ "space": "alpha" }), &credentials),
            ScopeDecision::Defer
        );
        // One allowed, or refused on the token alone, is decided.
        assert_eq!(
            resolver.resolve("p-read", &json!({ "space": "alpha" }), &credentials),
            ScopeDecision::Allowed
        );
        let none = afd::Credentials::new("https://as", "ada", "app", "https://r/mcp", 1, 2)
            .with_scopes(["openid"]);
        assert_eq!(
            resolver.resolve("p-read", &json!({}), &none),
            ScopeDecision::Missing(vec!["umbel:read".to_owned()])
        );
        // Nothing is listed when no request in flight holds the credentials, and no plugin
        // command exists for them.
        assert!(!resolver.visible("p-read", &credentials));
        assert!(!resolver.visible("x-show", &credentials));
        assert!(!resolver.known("p-read", &credentials));
        assert!(resolver.known("x-show", &credentials));
    }

    #[cfg(feature = "auth")]
    #[test]
    fn the_resolver_takes_no_group_from_a_gateway_and_no_caller_of_another_mode() {
        use super::super::caller::{CallerBook, CallerSlot, TokenBinding, VerifiedCaller, Vouched};
        use afd::server::auth::ScopeResolver;
        let head = |mode: &str, auth: &str| {
            format!(
                "config_version = 5\ndefault_space = \"main\"\n[principal]\nlocal_id = \"corp/ada\"\n[http]\npublic_url = \"https://h.test/mcp\"\nallowed_hosts = [\"h.test\"]\n[auth]\nmode = \"{mode}\"\n[auth.namespaces.corp]\n{auth}\n[spaces.main]\nreaders = [\"group:eng\"]\n[spaces.alpha]\nreaders = [\"group:eng\"]\n[spaces.beta]\n"
            )
        };
        let oauth = head(
            "oauth",
            "[auth.issuers.as]\nissuer = \"https://as.example.com\"\nnamespace = \"corp\"\n[access.groups.eng]\nmembers = []\nclaim = { issuer = \"as\", name = \"groups\", value = \"eng\" }\n",
        );
        let gateway = head(
            "gateway",
            "[auth.gateway]\nalias = \"edge\"\nnamespace = \"corp\"\nissuer = \"https://g.example.com\"\nkeys = \"k.json\"\nmax_scopes = [\"umbel:read\"]\n[access.groups.eng]\nmembers = []\n",
        );
        let credentials =
            afd::Credentials::new("https://x", "ada", "app", "https://h.test/mcp", 1, 2)
                .with_scopes(["umbel:read"]);
        // A caller in flight whose `claim_groups` field says `eng`, vouched for as given.
        let in_flight = |vouched: Vouched| {
            let caller = VerifiedCaller {
                credentials: credentials.clone(),
                namespace: "corp".into(),
                issuer: "x".into(),
                actor: afd::Actor::new(afd::ActorKind::Agent)
                    .with_id("corp/app")
                    .with_on_behalf_of("corp/ada"),
                chain: Vec::new(),
                vouched,
                scopes: vec!["umbel:read".into()],
                claim_groups: vec!["eng".into()],
            };
            let book = CallerBook::default();
            let slot = CallerSlot::default();
            assert!(slot.fill(caller));
            let entry = book.enter(slot);
            (book, entry)
        };
        let token = Vouched::Token(TokenBinding::Bearer);
        let sees = |text: &str, vouched: Vouched| {
            let dir = tempfile::tempdir().unwrap();
            let policy = Arc::new(policy_with(dir.path(), text));
            let (book, _entry) = in_flight(vouched);
            UmbelScopes::new(policy, book).visible("p-read", &credentials)
        };
        // The control: a token's groups count in mode oauth.
        assert!(sees(&oauth, token.clone()));
        // A gateway's caller never has groups, whatever its field holds.
        assert!(!sees(&gateway, Vouched::Gateway));
        // And a caller one mode made is no one in the other.
        assert!(!sees(&oauth, Vouched::Gateway));
        assert!(!sees(&gateway, token));
    }
}

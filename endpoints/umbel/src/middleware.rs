//! The host's middleware: the event stamp and the space check.
//!
//! AFD middleware receives the validated input and the context and calls `next()`, which takes no
//! arguments: it can refuse before the handler or rewrite the result after it, but it cannot
//! change what the handler sees. So the host owns two result keys, `dev.umbel/space` and
//! `dev.umbel/mutation`, and these layers **always overwrite** them: a handler (or a plugin) can
//! neither forge a mutation, nor hide one, nor redirect an event to another space.
//!
//! Outermost first: the event stamp, then the hidden-instance check (`auth::scope_gate`), the
//! space check, the access check, the scope gate (`auth::scope_gate`), the read limit
//! (`shared::read_limit`, hosted modes), the plugin gate, the shared store's spend reporting
//! (`shared::nonces`, hosted modes) and (installed by `seal`) the approval middleware, as phase 5
//! section 6.3's layer 7 orders them. The
//! event stamp is outermost so that it runs last on the way out and can put the default space on
//! a mutation of a command that has no `space` input.

use crate::access::{Caller, listed_for, reader_filter};
use crate::events::CHANGES_KEY;
use crate::plugins::{GateEntry, Ledger, PluginError, PluginKind};
use crate::provenance::{AUTHORITY_KEY, PROVENANCE_KEY, supplied_fields};
use crate::versions::EVENT_VERSION;
use crate::workspace::Workspace;
use afd::{
    BoxFuture, CommandContext, CommandError, CommandInterface, CommandMiddleware, CommandResult,
    MiddlewareNext, ResultMetadata, error_codes, failure,
};
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, HashSet};
use std::sync::Arc;

/// `result.metadata` key: the space a result belongs to. Written only by the host.
pub(crate) const SPACE_KEY: &str = "dev.umbel/space";
/// `result.metadata` key: `true` on the successful result of a mutation that is projected into an
/// event. Written only by the host.
pub(crate) const MUTATION_KEY: &str = "dev.umbel/mutation";

/// `result.metadata` key: the event version the host that journaled the call writes
/// ([`EVENT_VERSION`]), on the successful result of a mutation that is projected into an event.
/// Written only by the host: an entry without it was journaled before event version 1 and
/// projects as version 0.
pub(crate) const EVENT_VERSION_KEY: &str = "dev.umbel/event-version";

/// `result.metadata` key: the plugin that answered, `{ "id", "kind" }`. Written only by the plugin
/// gate.
pub(crate) const PLUGIN_KEY: &str = "dev.umbel/plugin";
/// `result.metadata` key: `"recorded"` on a mounted result, which the journal keeps and replay
/// skips. Written only by the plugin gate.
pub(crate) const REPLAY_KEY: &str = "dev.umbel/replay";
/// `result.metadata` key: `"external"` on a mounted result, and `"content"` on the result of a
/// compiled or component command that returns stored content. Written only by the plugin gate,
/// which keeps a plugin's own value only when it is `"content"`.
pub(crate) const TRUST_KEY: &str = "dev.umbel/trust";
/// `result.metadata` key: `{ <space>: { applied, head, schema } }`, how far a space's index
/// reflects the store. A compiled or component plugin may supply it for the spaces of its call.
pub(crate) const INDEX_KEY: &str = "dev.umbel/index";
/// `CommandContext.extra` key: the command a person confirmed at the terminal. Set only by the
/// CLI, after it showed the prompt of a `confirm = "require-human"` command and was answered.
pub(crate) const HUMAN_CONFIRMED_KEY: &str = "dev.umbel/human-confirmed";
/// `result.metadata` key: a command's record, which the event projector reads (phase 0).
pub(crate) const RECORD_KEY: &str = "dev.umbel/record";
/// `result.metadata` key: `true` on a successful call of a plugin holding `memory_write` that
/// wrote no memory revision (phase 3 section 6.4). Set only by the plugin gate; the event stamp,
/// which is outer, then leaves the result unstamped, so a no-op makes no event.
pub(crate) const NO_CHANGE_KEY: &str = "dev.umbel/no-change";
/// The envelope fields the host nulls in a memory writer's event (phase 3 sections 6.2 and 7.3):
/// they stay sealed on the stored record.
const MEMORY_SEALED_FIELDS: &[&str] = &[
    "sources",
    "contentHash",
    "derivedFrom",
    "constraints",
    "generated",
];
/// The prefix of every key the host owns.
const HOST_PREFIX: &str = "dev.umbel/";

/// Commands whose successful result is never projected into an event: the cursor the caller
/// stores, the rebuild of the streams themselves, the export of skills to a directory and the
/// scaffold of a plugin directory, and the copy of a space's stores (a workspace write that
/// changes no knowledge).
pub(crate) const UNPROJECTED_MUTATIONS: &[&str] = &[
    "event-ack",
    "event-rebuild",
    "skill-export",
    "plugin-new",
    "store-backup",
];

/// Resolves a call's space (`Workspace::resolve_space`).
pub(crate) type ResolveSpace =
    Arc<dyn Fn(&Value, &CommandContext) -> Result<String, CommandError> + Send + Sync>;

/// Resolves a call's spaces (`Workspace::resolve_spaces`): the `spaces` input, else the one space.
pub(crate) type ResolveSpaces =
    Arc<dyn Fn(&Value, &CommandContext) -> Result<Vec<String>, CommandError> + Send + Sync>;

fn metadata_mut(result: &mut CommandResult<Value>) -> &mut ResultMetadata {
    result.metadata.get_or_insert_with(ResultMetadata::new)
}

fn set(result: &mut CommandResult<Value>, key: &str, value: Value) {
    metadata_mut(result).extra.insert(key.to_owned(), value);
}

fn remove(result: &mut CommandResult<Value>, key: &str) {
    if let Some(metadata) = result.metadata.as_mut() {
        metadata.extra.remove(key);
    }
}

/// The event stamp: `dev.umbel/mutation = true` and `dev.umbel/event-version` on a successful
/// result of a command declared `mutation: true` (other than [`UNPROJECTED_MUTATIONS`]) that the
/// plugin gate did not mark [`NO_CHANGE_KEY`], both removed from every other result. A stamped result of a command with no `space` input also
/// gets the default space.
pub(crate) fn event_stamp(
    mutations: HashSet<String>,
    with_space: Arc<HashSet<String>>,
    default_space: String,
) -> CommandMiddleware {
    let mutations = Arc::new(mutations);
    Arc::new(
        move |name: String,
              _input: Value,
              context: CommandContext,
              next: MiddlewareNext|
              -> BoxFuture<'static, CommandResult<Value>> {
            let stamped = mutations.contains(&name);
            let has_space = with_space.contains(&name);
            let default_space = default_space.clone();
            // The writing principal's chain (envelope version 3), from the principal the host
            // set; empty without one.
            let chain = crate::principal::Principal::from_context(&context)
                .map(|principal| principal.delegation_chain)
                .unwrap_or_default();
            Box::pin(async move {
                let mut result = next().await;
                let unchanged = result.metadata.as_ref().is_some_and(|metadata| {
                    metadata.extra.get(NO_CHANGE_KEY) == Some(&Value::Bool(true))
                });
                if stamped && result.success && !unchanged {
                    set(&mut result, MUTATION_KEY, Value::Bool(true));
                    set(&mut result, EVENT_VERSION_KEY, Value::from(EVENT_VERSION));
                    set(
                        &mut result,
                        crate::provenance::DELEGATION_KEY,
                        serde_json::to_value(&chain).unwrap_or_else(|_| Value::Array(Vec::new())),
                    );
                    if !has_space {
                        set(&mut result, SPACE_KEY, Value::String(default_space));
                    }
                } else {
                    remove(&mut result, MUTATION_KEY);
                    remove(&mut result, EVENT_VERSION_KEY);
                    remove(&mut result, crate::provenance::DELEGATION_KEY);
                }
                result
            })
        },
    )
}

/// The space check (D26): for a command whose input has a `space` or a `spaces` property,
/// resolves them and refuses an undeclared one with `SPACE_NOT_FOUND` (and `space` together with
/// `spaces`, an empty list or a repeat with `VALIDATION_ERROR`) before the handler runs; after
/// the handler, overwrites `dev.umbel/space` with the resolved `space`. For any other command,
/// and for a command that has only `spaces`, removes the key.
///
/// In a hosted mode every caller but the operator gets section 5.4's one answer for an undeclared
/// space instead of `SPACE_NOT_FOUND` (phase 5 section 5.4), the answer the access check gives a
/// space it may not read.
///
/// **One reading of a call's spaces.** A `space` or `spaces` member the command does not declare
/// is refused with `VALIDATION_ERROR` before anything reads it, in every mode: `spaces` on a
/// command that takes only `space`, `space` on one that takes only `spaces`, and either on a
/// compiled or component plugin command that takes neither (`stray` names the commands and the
/// members refused; a pipeline is exempt, since its steps each meet every check on their own
/// input). Otherwise a member the scope rules never looked at could name the spaces a
/// plugin's host services reach (phase 5 step 3's review). A mounted tool's own arguments are the
/// server's and are left alone.
pub(crate) fn space_check(
    workspace: Arc<Workspace>,
    with_space: Arc<HashSet<String>>,
    with_spaces: Arc<HashSet<String>>,
    stray: Arc<BTreeMap<String, Vec<&'static str>>>,
    resolve: ResolveSpace,
    resolve_many: ResolveSpaces,
) -> CommandMiddleware {
    Arc::new(
        move |name: String,
              input: Value,
              context: CommandContext,
              next: MiddlewareNext|
              -> BoxFuture<'static, CommandResult<Value>> {
            if let Some(member) = stray.get(&name).and_then(|members| {
                members
                    .iter()
                    .find(|member| input.get(**member).is_some_and(|value| !value.is_null()))
            }) {
                let error = CommandError::new(
                    error_codes::VALIDATION_ERROR,
                    format!("This command takes no `{member}` input"),
                )
                .with_suggestion(
                    "Leave the member out; pass only the space input the command's schema declares.",
                )
                .with_retryable(false);
                return Box::pin(async move {
                    let mut result = failure(error);
                    remove(&mut result, SPACE_KEY);
                    result
                });
            }
            let has_space = with_space.contains(&name);
            let has_spaces = with_spaces.contains(&name);
            let one_answer = (has_space || has_spaces)
                && Caller::of(workspace.config(), &context).gets_one_answer();
            let hide = move |error: CommandError| {
                if one_answer && error.code == crate::host::SPACE_NOT_FOUND {
                    crate::access::space_unavailable()
                } else {
                    error
                }
            };
            let many = has_spaces.then(|| resolve_many(&input, &context).map_err(hide));
            let resolved = if has_space {
                Some(resolve(&input, &context).map_err(hide))
            } else {
                None
            };
            Box::pin(async move {
                if let Some(Err(error)) = many {
                    let mut result = failure(error);
                    remove(&mut result, SPACE_KEY);
                    return result;
                }
                match resolved {
                    Some(Err(error)) => {
                        let mut result = failure(error);
                        remove(&mut result, SPACE_KEY);
                        result
                    }
                    Some(Ok(space)) => {
                        let mut result = next().await;
                        let refused = result
                            .error
                            .as_ref()
                            .is_some_and(|error| error.code == crate::access::SPACE_NOT_READABLE);
                        if one_answer && refused {
                            // Section 5.4's one answer carries nothing of the space: an
                            // undeclared one never resolved, so a declared one must not say so.
                            remove(&mut result, SPACE_KEY);
                        } else {
                            set(&mut result, SPACE_KEY, Value::String(space));
                        }
                        result
                    }
                    None => {
                        let mut result = next().await;
                        remove(&mut result, SPACE_KEY);
                        result
                    }
                }
            })
        },
    )
}

/// The access check (phase 5 sections 5.3 and 5.4), after the space check: for a command that
/// runs in spaces (its `space` or `spaces` input, or the default space for a plugin command or an
/// embedder's command without one), refuses a space the caller may not read by its `readers`, or
/// that its token grants no verb in, with `SPACE_NOT_READABLE` before anything else looks at the
/// call: section 5.4's one answer for every hosted caller but the operator, which the space check
/// also gives an undeclared space. So readability comes before scope, and before the plugin
/// gate's `PLUGIN_NOT_ENABLED`. It applies to every hosted caller but the operator, and to any
/// caller a token narrows; mode `none` and the operator are unchanged.
///
/// `spaced` maps each such command to whether its spaces come from its input (`true`) or are the
/// default space (`false`: a mounted tool's own `space` argument is the server's, not Umbel's).
pub(crate) fn access_check(
    workspace: Arc<Workspace>,
    spaced: Arc<BTreeMap<String, bool>>,
    resolve_many: ResolveSpaces,
) -> CommandMiddleware {
    Arc::new(
        move |name: String,
              input: Value,
              context: CommandContext,
              next: MiddlewareNext|
              -> BoxFuture<'static, CommandResult<Value>> {
            let spaces = match spaced.get(&name) {
                None => return next(),
                Some(true) => resolve_many(&input, &context),
                Some(false) => Ok(vec![workspace.default_space().as_str().to_owned()]),
            };
            let config = workspace.config();
            let caller = Caller::of(config, &context);
            // Mode `none` and the operator keep phases 2 to 4's checks (each handler's own, and the
            // plugin gate's), as section 14's point 10 asks.
            if !caller.gets_one_answer() && caller.narrowing() == &crate::access::Narrowing::None {
                return next();
            }
            let refused = match spaces {
                Ok(spaces) => spaces
                    .iter()
                    .find_map(|space| reader_filter(config, space, &caller).err()),
                // The space check refused these already; a refusal here names nothing new.
                Err(error) => Some(
                    if caller.gets_one_answer() && error.code == crate::host::SPACE_NOT_FOUND {
                        crate::access::space_unavailable()
                    } else {
                        error
                    },
                ),
            };
            match refused {
                Some(error) => Box::pin(async move { failure(error) }),
                None => next(),
            }
        },
    )
}

/// What the plugin gate needs beyond the entries: the workspace (the spaces' readers) and the
/// ledger of what calls did to the stores.
pub(crate) struct GateContext {
    pub(crate) workspace: Arc<Workspace>,
    pub(crate) ledger: Arc<Ledger>,
    pub(crate) resolve_many: ResolveSpaces,
    pub(crate) default_space: String,
    /// The stores, to seal `dev.umbel/index` for a caller whose positions are sealed.
    pub(crate) stores: crate::store::Hub,
    /// Where a sealed result's host metadata waits for the journal.
    pub(crate) stash: Arc<crate::positions::Stash>,
    /// The shared stores a person-decided call is checked and spent against (phase 5 section
    /// 7.2, step 5); `None` in mode `none` and without the `auth` feature, where nothing is
    /// decided on the person page.
    pub(crate) decisions: Option<Arc<dyn crate::person::DecisionLedger>>,
}

/// The plugin gate (specification section 8.1), between the space check and approvals. For a
/// plugin command it resolves the space or spaces (the default space for a command with no
/// space input) and, before the handler runs, refuses one the instance is not enabled for with
/// `PLUGIN_NOT_ENABLED` (naming to a hosted caller only the instance's spaces it reads), one the
/// caller may not read with `SPACE_NOT_READABLE`, and a
/// `confirm = "require-human"` command that no person confirmed at the terminal with
/// `CONFIRMATION_REQUIRED`. After the handler it removes every `dev.umbel/` key a plugin may not
/// set, keeps `dev.umbel/record`, reduces `dev.umbel/provenance` to the fields a command may
/// supply, keeps `dev.umbel/index` (for the call's spaces) and `dev.umbel/trust` only with the
/// value `"content"`, sets `dev.umbel/changes` from what the call wrote and
/// `dev.umbel/replay = "recorded"` when it used a store, and stamps `dev.umbel/plugin`. The event
/// stamp and the space check are outer, so `dev.umbel/space` and `dev.umbel/mutation` remain the
/// host's.
pub(crate) fn plugin_gate(
    entries: Arc<BTreeMap<String, GateEntry>>,
    gate: GateContext,
) -> CommandMiddleware {
    let gate = Arc::new(gate);
    Arc::new(
        move |name: String,
              input: Value,
              context: CommandContext,
              next: MiddlewareNext|
              -> BoxFuture<'static, CommandResult<Value>> {
            let Some(entry) = entries.get(&name).cloned() else {
                return next();
            };
            let gate = Arc::clone(&gate);
            let spaces = if entry.space_command || entry.spaces_command {
                (gate.resolve_many)(&input, &context)
            } else {
                Ok(vec![gate.default_space.clone()])
            };
            Box::pin(async move {
                let spaces = match spaces {
                    Ok(spaces) => spaces,
                    Err(error) => return failure(error),
                };
                let config = gate.workspace.config();
                let caller = Caller::of(config, &context);
                // For every hosted caller but the operator, and any caller a token narrows, the
                // access check has already refused a space it may not read, so the spaces named
                // here are readable (phase 5 section 5.4); mode `none` keeps phases 2 to 4's order.
                for space in &spaces {
                    if !entry.spaces.contains(space) {
                        // A hosted caller who is not the operator is told only of the instance's
                        // spaces it may read (section 9.4).
                        let shown: Vec<String> = match listed_for(config, &caller) {
                            Some(listed) => entry
                                .spaces
                                .iter()
                                .filter(|space| listed.contains(space))
                                .cloned()
                                .collect(),
                            None => entry.spaces.clone(),
                        };
                        return failure(
                            PluginError::not_enabled(&entry.instance, space, &shown)
                                .to_command_error(),
                        );
                    }
                }
                for space in &spaces {
                    if let Err(error) = reader_filter(config, space, &caller) {
                        return failure(error);
                    }
                }
                if entry.require_human
                    && let Err(error) = person_gate(
                        &entry,
                        &name,
                        &input,
                        &context,
                        config,
                        gate.decisions.as_deref(),
                    )
                {
                    return failure(error);
                }
                let trace = context.trace_id.clone().unwrap_or_default();
                let mut result = next().await;
                let record = gate.ledger.take(&trace);
                sanitize(&mut result, &entry, &spaces, record);
                if caller.seals_positions() {
                    present_sealed(&mut result, &gate, &caller);
                }
                result
            })
        },
    )
}

/// The `require-human` gate (phase 2 section 3.4; phase 5 sections 7.1 and 7.2, step 5): on each
/// surface, the assurance the command's `person` names for it. At the CLI, `terminal` takes the
/// CLI's mark after its prompt, and `verified` a decision on the person page for this call; over
/// MCP only `verified`, and only a decision for this call; anywhere else (a batch, an in-process
/// agent, the library) nothing. The terminal mark never stands in for `verified`.
fn person_gate(
    entry: &GateEntry,
    name: &str,
    input: &Value,
    context: &CommandContext,
    config: &crate::workspace::Config,
    ledger: Option<&dyn crate::person::DecisionLedger>,
) -> Result<(), CommandError> {
    use crate::plugins::Assurance;
    let person = entry.person.unwrap_or_default();
    // The CLI interface counts only on the host's own command line (sealed, phase 5 step 10); a
    // library context that sets it without the seal is the library's, which no gate admits.
    let interface = context.interface.filter(|interface| {
        *interface != CommandInterface::Cli || crate::authority::is_cli(context)
    });
    match interface {
        Some(CommandInterface::Cli) if person.cli == Assurance::Verified => crate::person::admit(
            config,
            name,
            input,
            context,
            crate::person::Surface::Cli,
            ledger,
        ),
        Some(CommandInterface::Cli) => {
            if confirmed_by_a_person(name, context) {
                Ok(())
            } else {
                Err(require_human_refusal(name))
            }
        }
        Some(CommandInterface::Mcp) if person.mcp == Some(Assurance::Verified) => {
            crate::person::admit(
                config,
                name,
                input,
                context,
                crate::person::Surface::Mcp,
                ledger,
            )
        }
        _ if person.needs_preview() => Err(crate::person::not_decided(name)),
        _ => Err(require_human_refusal(name)),
    }
}

/// Whether a person at a terminal confirmed `command`: the call came through the CLI and the CLI
/// marked it after the prompt was answered. A batch, MCP, an in-process agent and the library
/// never carry the mark.
fn confirmed_by_a_person(command: &str, context: &CommandContext) -> bool {
    crate::authority::is_cli(context)
        && context
            .extra
            .get(HUMAN_CONFIRMED_KEY)
            .and_then(Value::as_str)
            == Some(command)
}

/// `CONFIRMATION_REQUIRED` for a `require-human` command run any way but at a terminal.
pub(crate) fn require_human_refusal(command: &str) -> CommandError {
    CommandError::new(
        error_codes::CONFIRMATION_REQUIRED,
        format!("'{command}' must be confirmed by a person at a terminal"),
    )
    .with_suggestion(
        "Run it with the umbel command at a terminal, without --yes or --approve, and answer its prompt.",
    )
    .with_retryable(false)
}

/// Reduce a plugin result's metadata to what a plugin may supply, record what the call did to
/// the stores, and stamp the plugin.
fn sanitize(
    result: &mut CommandResult<Value>,
    entry: &GateEntry,
    spaces: &[String],
    record: crate::plugins::CallRecord,
) {
    let mounted = entry.kind == PluginKind::Mounted;
    let success = result.success;
    let metadata = metadata_mut(result);
    // A mounted server supplies no provenance: it is outside the host.
    let provenance = metadata
        .extra
        .get(PROVENANCE_KEY)
        .and_then(supplied_fields)
        .filter(|_| !mounted);
    // The named allow-list (phase 2 specification, section 3.3, rule 7), for compiled and
    // component plugins only: the index state of the call's spaces, and the content trust label
    // with its one value.
    let index = metadata
        .extra
        .get(INDEX_KEY)
        .and_then(|value| index_state(value, spaces))
        .filter(|_| !mounted);
    let content = (metadata.extra.get(TRUST_KEY).and_then(Value::as_str) == Some("content")
        && !mounted)
        .then(|| Value::String("content".to_owned()));
    // A compiled or component result may carry a record for the event projector; nothing a
    // mounted server says about the host is kept.
    metadata
        .extra
        .retain(|key, _| !key.starts_with(HOST_PREFIX) || (key == RECORD_KEY && !mounted));
    if let Some(provenance) = provenance {
        metadata.extra.insert(PROVENANCE_KEY.to_owned(), provenance);
    }
    if let Some(index) = index {
        metadata.extra.insert(INDEX_KEY.to_owned(), index);
    }
    if let Some(content) = content {
        metadata.extra.insert(TRUST_KEY.to_owned(), content);
    }
    metadata.extra.insert(
        PLUGIN_KEY.to_owned(),
        json!({ "id": entry.instance, "kind": entry.kind.as_str() }),
    );
    // The revisions the call wrote, set by the host after the plugin's own keys were removed. A
    // forged `dev.umbel/changes` is gone with every other key the plugin may not set.
    if success && record.count > 0 {
        metadata.extra.insert(
            CHANGES_KEY.to_owned(),
            json!({ "fromRev": record.from_rev, "toRev": record.to_rev, "count": record.count }),
        );
    }
    // Authority and confirmation are host-owned (phase 3 step 4, amendment 12): from what the host
    // did in this call, never from the plugin, which `supplied_fields` and the retain above remove.
    let authority = match &record.authority {
        crate::plugins::Assigned::One(authority) if success => Value::String(authority.clone()),
        _ => Value::Null,
    };
    let confirmation = record
        .confirmation
        .clone()
        .filter(|_| success)
        .unwrap_or(Value::Null);
    // The erased principal's notice of a `memory-erase` (phase 5 section 8.4), from the erase the
    // host performed, and only then. The record kind `memory-erase-notice` is that notice's alone: a
    // result naming it for a call in which the host erased nothing loses the record, so no plugin
    // can put a look-alike notice in anyone's stream (step 10's review).
    let erasure = record.erasure.clone().filter(|_| success);
    let notice_kind = metadata
        .extra
        .get(RECORD_KEY)
        .and_then(|record| record.get("kind"))
        .and_then(Value::as_str)
        == Some("memory-erase-notice");
    if notice_kind && erasure.is_none() {
        metadata.extra.remove(RECORD_KEY);
    }
    if !authority.is_null() || !confirmation.is_null() || erasure.is_some() {
        let mut host = json!({ "authority": authority, "confirmation": confirmation });
        if let Some(erasure) = erasure {
            host["erasure"] = erasure;
        }
        metadata.extra.insert(AUTHORITY_KEY.to_owned(), host);
    }
    if success && record.memory.count > 0 {
        metadata.extra.insert(
            CHANGES_KEY.to_owned(),
            json!({
                "store": "memory",
                "fromRev": record.memory.from_rev,
                "toRev": record.memory.to_rev,
                "count": record.memory.count,
            }),
        );
    }
    if success && entry.memory_writer && record.memory.count == 0 {
        // A replay, a refused capture, a forget that found nothing, an empty sweep: no event.
        metadata
            .extra
            .insert(NO_CHANGE_KEY.to_owned(), Value::Bool(true));
    }
    if entry.memory_writer
        && let Some(Value::Object(provenance)) = metadata.extra.get_mut(PROVENANCE_KEY)
    {
        for field in MEMORY_SEALED_FIELDS {
            provenance.remove(*field);
        }
    }
    if mounted || record.used {
        // Recorded, not replayable (architecture section 8): the journal keeps the stamp, and
        // replay never calls the handler again. A mounted answer is external content; a
        // store-backed answer depends on a store the journal does not hold.
        metadata
            .extra
            .insert(REPLAY_KEY.to_owned(), Value::String("recorded".to_owned()));
    }
    if mounted {
        metadata
            .extra
            .insert(TRUST_KEY.to_owned(), Value::String("external".to_owned()));
    }
}

/// The host key a sealed result carries in place of what it left out: an opaque random reference
/// to the stash, which the journal takes back (phase 5 section 9.3).
pub(crate) const JOURNAL_REF_KEY: &str = "dev.umbel/journal-ref";

/// A result as a caller whose positions are sealed sees it (phase 5 section 9.3): no
/// `dev.umbel/changes`, no record `version`, and `dev.umbel/index`'s `applied` and `head` each
/// the sealed last document revision the caller can read at or below it (the key is left out
/// when that cannot be read). The changes and the version are kept in the stash under a fresh
/// random reference the result carries, which the journal's last look takes back, so the
/// journal and every event stream record them whole; nothing about them reaches the caller.
fn present_sealed(result: &mut CommandResult<Value>, gate: &GateContext, caller: &Caller) {
    let journaled = result.success || gate.workspace.config().journal.record_failures;
    let Some(metadata) = result.metadata.as_mut() else {
        return;
    };
    let mut raw = Map::new();
    if let Some(changes) = metadata.extra.remove(CHANGES_KEY) {
        raw.insert(CHANGES_KEY.to_owned(), changes);
    }
    if let Some(Value::Object(record)) = metadata.extra.get_mut(RECORD_KEY)
        && let Some(version) = record.remove("version")
    {
        raw.insert("version".to_owned(), version);
    }
    if let Some(index) = metadata.extra.remove(INDEX_KEY)
        && let Some(sealed) = sealed_index(&index, gate, caller)
    {
        metadata.extra.insert(INDEX_KEY.to_owned(), sealed);
    }
    // Only for a result the journal records: a failure is journaled only when the workspace
    // records failures, and nothing else would take the entry back.
    if !raw.is_empty() && journaled {
        let reference = crate::host::new_trace_id();
        gate.stash.put(&reference, raw);
        metadata
            .extra
            .insert(JOURNAL_REF_KEY.to_owned(), Value::String(reference));
    }
}

/// `{ <space>: { applied, head, schema } }` with `applied` and `head` sealed for `caller`;
/// `None` when a store or a filter cannot be read.
fn sealed_index(index: &Value, gate: &GateContext, caller: &Caller) -> Option<Value> {
    let presenter = crate::positions::Presenter::of(&gate.workspace, caller).ok()?;
    let config = gate.workspace.config();
    let mut out = Map::new();
    for (space, state) in index.as_object()? {
        let filter = reader_filter(config, space, caller).ok()?;
        let stores = gate.stores.space(space).ok()?;
        let mut shown = state.as_object()?.clone();
        for field in ["applied", "head"] {
            let rev = shown.get(field)?.as_u64()?;
            let last = stores.documents.last_readable_document(rev, &filter).ok()?;
            shown.insert(field.to_owned(), presenter.revision(space, last));
        }
        out.insert(space.clone(), Value::Object(shown));
    }
    Some(Value::Object(out))
}

/// `{ <space>: { applied, head, schema } }` reduced to the spaces of the call, each with three
/// unsigned integers and nothing else; `None` when nothing is left.
fn index_state(value: &Value, spaces: &[String]) -> Option<Value> {
    let kept: Map<String, Value> = value
        .as_object()?
        .iter()
        .filter(|(space, _)| spaces.contains(space))
        .filter_map(|(space, state)| {
            let state = state.as_object()?;
            let fields = ["applied", "head", "schema"];
            let valid = state.len() == fields.len()
                && fields
                    .iter()
                    .all(|field| state.get(*field).is_some_and(Value::is_u64));
            valid.then(|| (space.clone(), Value::Object(state.clone())))
        })
        .collect();
    (!kept.is_empty()).then_some(Value::Object(kept))
}

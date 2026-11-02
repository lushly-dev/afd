//! The host's middleware: the event stamp and the space check.
//!
//! AFD middleware receives the validated input and the context and calls `next()`, which takes no
//! arguments: it can refuse before the handler or rewrite the result after it, but it cannot
//! change what the handler sees. So the host owns two result keys, `dev.umbel/space` and
//! `dev.umbel/mutation`, and these layers **always overwrite** them: a handler (or a plugin) can
//! neither forge a mutation, nor hide one, nor redirect an event to another space.
//!
//! Outermost first: the event stamp, then the space check, then the plugin gate, then (installed by
//! `seal`) the approval middleware. The event stamp is outermost so that it runs last on the way out and can
//! put the default space on a mutation of a command that has no `space` input.

use crate::access::{effective_principal_of, reader_filter};
use crate::events::CHANGES_KEY;
use crate::plugins::{GateEntry, Ledger, PluginError, PluginKind};
use crate::provenance::{PROVENANCE_KEY, supplied_fields};
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
/// result of a command declared `mutation: true` (other than [`UNPROJECTED_MUTATIONS`]), both
/// removed from every other result. A stamped result of a command with no `space` input also
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
              _context: CommandContext,
              next: MiddlewareNext|
              -> BoxFuture<'static, CommandResult<Value>> {
            let stamped = mutations.contains(&name);
            let has_space = with_space.contains(&name);
            let default_space = default_space.clone();
            Box::pin(async move {
                let mut result = next().await;
                if stamped && result.success {
                    set(&mut result, MUTATION_KEY, Value::Bool(true));
                    set(&mut result, EVENT_VERSION_KEY, Value::from(EVENT_VERSION));
                    if !has_space {
                        set(&mut result, SPACE_KEY, Value::String(default_space));
                    }
                } else {
                    remove(&mut result, MUTATION_KEY);
                    remove(&mut result, EVENT_VERSION_KEY);
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
pub(crate) fn space_check(
    with_space: Arc<HashSet<String>>,
    with_spaces: Arc<HashSet<String>>,
    resolve: ResolveSpace,
    resolve_many: ResolveSpaces,
) -> CommandMiddleware {
    Arc::new(
        move |name: String,
              input: Value,
              context: CommandContext,
              next: MiddlewareNext|
              -> BoxFuture<'static, CommandResult<Value>> {
            let has_space = with_space.contains(&name);
            let has_spaces = with_spaces.contains(&name);
            let many = has_spaces.then(|| resolve_many(&input, &context));
            let resolved = if has_space {
                Some(resolve(&input, &context))
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
                        set(&mut result, SPACE_KEY, Value::String(space));
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

/// What the plugin gate needs beyond the entries: the workspace (the spaces' readers) and the
/// ledger of what calls did to the stores.
pub(crate) struct GateContext {
    pub(crate) workspace: Arc<Workspace>,
    pub(crate) ledger: Arc<Ledger>,
    pub(crate) resolve_many: ResolveSpaces,
    pub(crate) default_space: String,
}

/// The plugin gate (specification section 8.1), between the space check and approvals. For a
/// plugin command it resolves the space or spaces (the default space for a command with no
/// space input) and, before the handler runs, refuses one the instance is not enabled for with
/// `PLUGIN_NOT_ENABLED`, one the caller may not read with `SPACE_NOT_READABLE`, and a
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
                for space in &spaces {
                    if !entry.spaces.contains(space) {
                        return failure(
                            PluginError::not_enabled(&entry.instance, space, &entry.spaces)
                                .to_command_error(),
                        );
                    }
                }
                let principal = effective_principal_of(&context);
                for space in &spaces {
                    if let Err(error) =
                        reader_filter(gate.workspace.config(), space, principal.as_deref())
                    {
                        return failure(error);
                    }
                }
                if entry.require_human && !confirmed_by_a_person(&name, &context) {
                    return failure(require_human_refusal(&name));
                }
                let trace = context.trace_id.clone().unwrap_or_default();
                let mut result = next().await;
                let record = gate.ledger.take(&trace);
                sanitize(&mut result, &entry, &spaces, record);
                result
            })
        },
    )
}

/// Whether a person at a terminal confirmed `command`: the call came through the CLI and the CLI
/// marked it after the prompt was answered. A batch, MCP, an in-process agent and the library
/// never carry the mark.
fn confirmed_by_a_person(command: &str, context: &CommandContext) -> bool {
    context.interface == Some(CommandInterface::Cli)
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

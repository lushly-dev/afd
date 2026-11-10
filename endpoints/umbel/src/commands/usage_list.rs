//! `usage-list`: the usage events the caller may read (phase 5 specification, section 12.1; D122,
//! owner decision 13).
//!
//! **Who reads what.**
//!
//! - **Everyone reads their own**: the records whose principal is the caller's effective
//!   principal, or a legacy principal `[principal.equivalents]` maps to it (4.6). Over HTTP that
//!   is the person or service the token names; over stdio and the library it is the actor's
//!   effective principal (4.7: neither is an operator), whose records exist only if that same
//!   principal also called over HTTP; in mode `none`, every HTTP caller is the one loopback agent,
//!   so it reads the loopback agent's records. An anonymous caller reads nothing.
//! - **`usage.readers` read everyone's**: a principal entry, or a `group:<id>` that holds the
//!   caller by a named member or its own token's claims (a group's `*` never counts).
//! - **The operator** (the CLI, 4.7) reads everyone's, in every mode.
//!
//! **Nobody learns that other people's usage exists.** A caller who reads its own gets exactly
//! the answer it would get if no one else had ever called: the records are its own, a
//! `principal` filter naming anyone else finds nothing (the same empty answer as a filter
//! naming no one), there is no total, the `trace` of each record (an AFD trace id, which carries
//! a per-process call counter) is `null`, the drop count is left out, and `next` is a cursor
//! sealed as section 9.3 seals positions (`u1.`, bound to the caller and to whether it reads its
//! own or everyone's), which opens to nothing for anyone else and says nothing of the store's
//! positions. Reads take no lock and write nothing, so their time and failures do not depend on
//! other callers' writes; only the operator's read purges what passed the retention.
//!
//! **No name a caller may not see.** To a hosted caller other than the operator (section 5.4's
//! one answer), a record shows no space it does not read and no command (nor its tool) whose
//! instance serves no space it reads (9.4), whoever made the record: a usage reader reads
//! everyone's activity, never the names 5.4 and 9.4 hide from it. The operator, and every caller
//! in mode `none`, see records whole.
//!
//! The answer: `{ records, next, reads }`, where `reads` is `own` or `all`, and, for `all` only,
//! `dropped`: the records the host could not write within the retention. Records are
//! `usage-event.v1`, newest first, never older than `usage.retention_days`.

use super::{
    Builtin, blocking, expose_everywhere_but_the_palette, returns_object, validation_error,
};
use crate::access::{Caller, identities_of, reads_everyones_usage};
use crate::auth::scopes::ScopePolicy;
use crate::positions::{Kind, Positions};
use crate::shared::SharedError;
use crate::shared::usage::{DAY_MS, Readable, SqliteUsage, UsageQuery, UsageStore};
use crate::workspace::Workspace;
use afd::{
    Clock, CommandContext, CommandDefinition, CommandError, CommandHandler, CommandResult, failure,
    success,
};
use async_trait::async_trait;
use serde_json::{Value, json};
use std::sync::{Arc, OnceLock, Weak};

/// The default page.
const DEFAULT_LIMIT: u64 = 50;
/// The largest page.
const MAX_LIMIT: u64 = 200;

struct Handler {
    workspace: Arc<Workspace>,
    clock: Arc<dyn Clock>,
    policy: Arc<OnceLock<Weak<ScopePolicy>>>,
}

/// What a caller who gets section 5.4's one answer (a hosted caller other than the operator) may
/// not see in a record, whoever made it: a space it does not read, and a command (with its tool)
/// whose instance serves no space it reads (9.4). Without the rules (never, once sealed), every
/// command is left out.
fn mask(record: &mut Value, reads: &dyn Fn(&str) -> bool, policy: Option<&ScopePolicy>) {
    if record["space"].as_str().is_some_and(|space| !reads(space)) {
        record["space"] = Value::Null;
    }
    let hidden = record["command"]
        .as_str()
        .is_some_and(|command| policy.is_none_or(|policy| policy.hidden(command, reads)));
    if hidden {
        if record["tool"] == record["command"] {
            record["tool"] = Value::Null;
        }
        record["command"] = Value::Null;
    }
}

/// `INVALID_CURSOR`, naming nothing of the store: malformed, altered, another caller's and from
/// the other reading alike.
fn invalid_cursor() -> CommandError {
    CommandError::new(
        crate::events::INVALID_CURSOR,
        "The cursor is not one usage-list gave you",
    )
    .with_suggestion("Call usage-list without a cursor, then pass the `next` it returns.")
    .with_retryable(false)
}

fn store_error(error: &SharedError) -> CommandError {
    match error {
        SharedError::Timeout { store } => crate::shared::read_limit::shared_timeout(store),
        SharedError::Failed { message, .. } => {
            tracing::error!(target: "umbel::usage", %message, "reading usage records failed");
            crate::shared::read_limit::store_failed()
        }
    }
}

/// A time argument, RFC 3339, as epoch milliseconds.
fn time_arg(input: &Value, name: &str) -> Result<Option<i64>, CommandError> {
    match input.get(name) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) => chrono::DateTime::parse_from_rfc3339(text)
            .map(|at| Some(at.timestamp_millis()))
            .map_err(|_| {
                validation_error(
                    format!("{name} must be an RFC 3339 time"),
                    "Pass a time such as 2026-11-03T10:00:00Z.",
                )
            }),
        Some(_) => Err(validation_error(
            format!("{name} must be a string"),
            "Pass a time such as 2026-11-03T10:00:00Z.",
        )),
    }
}

/// What a call asks, validated before anything is read: the same refusals for every caller.
struct Asked {
    limit: usize,
    principal: Option<String>,
    since_ms: Option<i64>,
    until_ms: Option<i64>,
    cursor: Option<String>,
}

fn asked(input: &Value) -> Result<Asked, CommandError> {
    let limit = match input.get("limit") {
        None | Some(Value::Null) => DEFAULT_LIMIT,
        Some(value) => value
            .as_u64()
            .filter(|limit| (1..=MAX_LIMIT).contains(limit))
            .ok_or_else(|| {
                validation_error(
                    format!("limit must be an integer from 1 to {MAX_LIMIT}"),
                    "Pass a smaller limit, and page with `next`.",
                )
            })?,
    };
    let principal = match input.get("principal") {
        None | Some(Value::Null) => None,
        Some(Value::String(text)) if crate::workspace::parse_principal(text).is_ok() => {
            Some(text.clone())
        }
        Some(_) => {
            return Err(validation_error(
                "principal must be a principal string <kind>:<id>".to_owned(),
                "Pass a principal such as human:corp/U019488227, or leave it out.",
            ));
        }
    };
    let cursor = match input.get("cursor") {
        None | Some(Value::Null) => None,
        Some(Value::String(text)) => Some(text.clone()),
        Some(_) => return Err(invalid_cursor()),
    };
    Ok(Asked {
        limit: usize::try_from(limit).unwrap_or(usize::MAX),
        principal,
        since_ms: time_arg(input, "since")?,
        until_ms: time_arg(input, "until")?,
        cursor,
    })
}

#[async_trait]
impl CommandHandler for Handler {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let asked = match asked(&input) {
            Ok(asked) => asked,
            Err(error) => return failure(error),
        };
        let workspace = Arc::clone(&self.workspace);
        let policy = self.policy.get().and_then(Weak::upgrade);
        let now = self.clock.now();
        let answer = blocking(move || {
            let config = workspace.config();
            let caller = Caller::of(config, &context);
            let everyone = caller.is_operator() || reads_everyones_usage(config, &caller);
            let reads = if everyone { "all" } else { "own" };
            let key = workspace
                .cursor_key()
                .map_err(|error| error.to_command_error())?;
            let positions = Positions::new(&key);
            let identity = caller.position_identity();
            let before = match &asked.cursor {
                None => None,
                Some(cursor) => Some(
                    positions
                        .open(Kind::Usage, reads, identity, cursor)
                        .and_then(|position| i64::try_from(position).ok())
                        .ok_or_else(invalid_cursor)?,
                ),
            };
            let days = i64::try_from(config.usage.retention_days).unwrap_or(i64::MAX);
            let keep_from_ms = now.saturating_sub(days.saturating_mul(DAY_MS));
            let store = SqliteUsage::new(
                &workspace.layout().usage_store(),
                config.store.lock_timeout_ms,
            );
            if caller.is_operator()
                && let Err(error) = store.purge(keep_from_ms)
            {
                tracing::warn!(target: "umbel::usage", ?error, "purging usage records past their retention failed");
            }
            let readable = if everyone {
                Readable::All
            } else {
                Readable::Own(identities_of(&caller).to_vec())
            };
            let page = store
                .list(&UsageQuery {
                    readable,
                    principal: asked.principal,
                    since_ms: asked.since_ms,
                    until_ms: asked.until_ms,
                    before,
                    limit: asked.limit,
                    keep_from_ms,
                })
                .map_err(|error| store_error(&error))?;
            let next = page
                .more
                .then(|| page.rows.last())
                .flatten()
                .and_then(|(seq, _)| u64::try_from(*seq).ok())
                .map(|seq| positions.seal(Kind::Usage, reads, identity, seq));
            let readable = |space: &str| {
                config
                    .spaces
                    .iter()
                    .find(|candidate| candidate.id.as_str() == space)
                    .is_some_and(|declared| caller.reads(config, declared))
            };
            let records: Vec<Value> = page
                .rows
                .into_iter()
                .map(|(_, mut record)| {
                    if !everyone {
                        record["trace"] = Value::Null;
                    }
                    if caller.gets_one_answer() {
                        mask(&mut record, &readable, policy.as_deref());
                    }
                    record
                })
                .collect();
            let mut answer = json!({ "records": records, "next": next, "reads": reads });
            if everyone {
                answer["dropped"] = json!(
                    store
                        .dropped(keep_from_ms)
                        .map_err(|error| store_error(&error))?
                );
            }
            Ok(answer)
        })
        .await;
        match answer {
            Ok(answer) => success(answer),
            Err(error) => failure(error),
        }
    }
}

/// `usage-list`.
pub(crate) fn usage_list(
    workspace: Arc<Workspace>,
    clock: Arc<dyn Clock>,
    policy: Arc<OnceLock<Weak<ScopePolicy>>>,
) -> Builtin {
    let definition = CommandDefinition::new(
        "usage-list",
        "List the usage events you may read, newest first: your own, or everyone's if usage.readers names you",
        vec![],
        Handler {
            workspace,
            clock,
            policy,
        },
    )
    .with_category("workspace")
    .with_returns(returns_object(
        "records (usage-event.v1, newest first), next (a cursor, or null), reads (own or all), and for all, dropped",
    ))
    .with_expose(expose_everywhere_but_the_palette());
    Builtin {
        definition,
        schema: json!({
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": MAX_LIMIT,
                    "description": "Records per page, 1 to 200; default 50"
                },
                "cursor": {
                    "type": "string",
                    "maxLength": 128,
                    "description": "The `next` of the previous page"
                },
                "principal": {
                    "type": "string",
                    "maxLength": 160,
                    "description": "Only this principal's records (<kind>:<id>), within what you may read"
                },
                "since": {
                    "type": "string",
                    "maxLength": 64,
                    "description": "Only records at or after this RFC 3339 time"
                },
                "until": {
                    "type": "string",
                    "maxLength": 64,
                    "description": "Only records before this RFC 3339 time"
                }
            },
            "additionalProperties": false
        }),
    }
}

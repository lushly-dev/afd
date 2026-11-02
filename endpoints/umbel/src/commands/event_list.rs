//! `event-list`: read one space's events after a cursor.

use super::{
    Builtin, blocking, caller, consumer_arg, consumer_property, expose_everywhere_but_the_palette,
    returns_object, validation_error,
};
use crate::access::reader_filter;
use crate::events::{Cursor, EventsError, Projector, invalid_cursor, read_after, read_cursor};
use crate::provenance::effective_principal;
use crate::workspace::{SpaceId, Workspace};
use afd::{CommandContext, CommandDefinition, CommandError, CommandHandler, CommandResult};
use afd::{failure, success};
use async_trait::async_trait;
use serde_json::{Value, json};
use std::sync::Arc;

const DEFAULT_LIMIT: u64 = 100;
const MAX_LIMIT: u64 = 1000;

struct Handler {
    workspace: Arc<Workspace>,
    projector: Arc<Projector>,
}

struct Request {
    space: SpaceId,
    consumer: String,
    limit: usize,
    after: Option<String>,
    caller: Option<(afd::Actor, String)>,
}

fn limit_arg(input: &Value) -> Result<usize, CommandError> {
    let limit = match input.get("limit") {
        None | Some(Value::Null) => DEFAULT_LIMIT,
        Some(value) => value
            .as_u64()
            .filter(|limit| (1..=MAX_LIMIT).contains(limit))
            .ok_or_else(|| {
                validation_error(
                    format!("limit must be an integer from 1 to {MAX_LIMIT}"),
                    &format!("Pass a limit from 1 to {MAX_LIMIT}, or omit it for {DEFAULT_LIMIT}."),
                )
            })?,
    };
    Ok(usize::try_from(limit).unwrap_or(usize::MAX))
}

fn stored_cursor_problem(error: EventsError) -> CommandError {
    match error {
        EventsError::Damaged(message) => invalid_cursor(message).with_suggestion(
            "Store a valid cursor with event-ack, for example the head from space-list.",
        ),
        other => other.to_command_error(),
    }
}

fn list(
    workspace: &Workspace,
    projector: &Projector,
    request: Request,
) -> Result<Value, CommandError> {
    {
        let Request {
            space,
            consumer,
            limit,
            after,
            caller,
        } = request;
        let events_error = |error: EventsError| error.to_command_error();
        // Who may read the space, and which of its events (phase 2 specification, section 2.2):
        // `SPACE_NOT_READABLE` before anything is read.
        let reader = reader_filter(
            workspace.config(),
            space.as_str(),
            caller
                .as_ref()
                .and_then(|(actor, _)| effective_principal(actor))
                .as_deref(),
        )?;
        projector.catch_up_if_pending().map_err(events_error)?;
        let head = projector.tail(&space).map_err(events_error)?.seq;

        let acknowledged = match &caller {
            Some((actor, id)) => read_cursor(workspace.layout(), &space, actor, id, &consumer)
                .map_err(stored_cursor_problem)?,
            None => None,
        };
        let acknowledged = acknowledged.unwrap_or_else(|| Cursor::zero(space.clone()));
        if acknowledged.seq() > head {
            return Err(invalid_cursor(format!(
                "The cursor you acknowledged, {acknowledged}, is past the head of space {space}, v0:{space}:{head}"
            ))
            .with_suggestion(
                "Store a valid cursor with event-ack, for example the head from space-list.",
            ));
        }
        let start = match after {
            Some(text) => Cursor::within(&text, &space, head)?,
            None => acknowledged.clone(),
        };

        let path = workspace.layout().events_file(&space);
        let events = read_after(&path, start.seq(), limit, head).map_err(events_error)?;
        let cursor = events.last().map_or_else(
            || start.clone(),
            |event| Cursor::new(space.clone(), event.seq),
        );
        // A version 1 event is returned only when the caller's reader filter holds a token of the
        // envelope's `access`; a version 0 line carries no access set and is returned as before.
        // Skipped events leave gaps in `seq`, a count leak accepted with the others (section 6);
        // the cursor still moves past them.
        let tokens = reader.token_list().unwrap_or_default();
        let events: Vec<Value> = events
            .iter()
            .filter(|event| {
                event.version == 0
                    || event
                        .provenance
                        .access
                        .iter()
                        .any(|token| tokens.contains(token))
            })
            .map(|event| serde_json::to_value(event).unwrap_or(Value::Null))
            .collect();
        Ok(json!({
            "space": space.as_str(),
            "consumer": consumer,
            "events": events,
            "cursor": cursor.to_string(),
            "acknowledged": acknowledged.to_string(),
            "head": Cursor::new(space.clone(), head).to_string(),
            "hasMore": cursor.seq() < head,
        }))
    }
}

/// The read behind the `events` grant (specification section 7.1): `event-list`'s read for
/// `space` under the caller's principal, as the consumer `default`, without acknowledging.
pub(crate) fn read_events(
    workspace: &Workspace,
    projector: &Projector,
    space: SpaceId,
    after: Option<String>,
    limit: usize,
    caller: Option<(afd::Actor, String)>,
) -> Result<Value, CommandError> {
    list(
        workspace,
        projector,
        Request {
            space,
            consumer: "default".to_owned(),
            limit,
            after,
            caller,
        },
    )
}

#[async_trait]
impl CommandHandler for Handler {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let request = (|| {
            Ok::<_, CommandError>(Request {
                space: self.workspace.resolve_space(&input, &context)?,
                consumer: consumer_arg(&input)?,
                limit: limit_arg(&input)?,
                after: input
                    .get("after")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                caller: caller(&context),
            })
        })();
        let request = match request {
            Ok(request) => request,
            Err(error) => return failure(error),
        };
        let workspace = Arc::clone(&self.workspace);
        let projector = Arc::clone(&self.projector);
        match blocking(move || list(&workspace, &projector, request)).await {
            Ok(data) => success(data),
            Err(error) => failure(error),
        }
    }
}

/// `event-list`.
pub(crate) fn event_list(workspace: Arc<Workspace>, projector: Arc<Projector>) -> Builtin {
    let definition = CommandDefinition::new(
        "event-list",
        "Read one space's events after a cursor; without a cursor, after the one you acknowledged",
        vec![],
        Handler {
            workspace,
            projector,
        },
    )
    .with_category("events")
    .with_returns(returns_object(
        "space, consumer, events, cursor, acknowledged, head and hasMore",
    ))
    .with_expose(expose_everywhere_but_the_palette());
    Builtin {
        definition,
        schema: json!({
            "type": "object",
            "properties": {
                "space": {
                    "type": "string",
                    "description": "The space; default: the workspace's default space"
                },
                "after": {
                    "type": "string",
                    "description": "Read events after this cursor, as event-list returned it; default: after your acknowledged cursor"
                },
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": MAX_LIMIT,
                    "description": "Most events to return; default 100"
                },
                "consumer": consumer_property(),
            },
            "additionalProperties": false,
        }),
    }
}

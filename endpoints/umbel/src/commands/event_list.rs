//! `event-list`: read one space's events after a cursor.
//!
//! To a caller whose positions are sealed (phase 5 section 9.3: a hosted caller that is neither
//! the operator nor stdio) every position is one of an event it can read: a page holds `limit`
//! events it can read, `cursor` is the last of them, `head` the last event it can read, and each
//! is a cursor version 1. Its events carry no `seq`, `journalSeq`, `changes` or record `version`,
//! and their `id` and `cursor` are the event's own cursor version 1
//! (`schemas/event-view.v1.json`), so nothing it is shown counts an event it cannot read. Every
//! other caller reads as before.

use super::{
    Builtin, blocking, caller, consumer_arg, consumer_property, expose_everywhere_but_the_palette,
    returns_object, validation_error,
};
use crate::access::{Caller, identities, reader_filter};
use crate::events::{
    Cursor, Event, EventsError, Projector, invalid_cursor, read_after, read_cursor_as,
    scan_readable,
};
use crate::positions::{Kind, Presenter};
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
    /// Who reads (phase 5 section 5.4): the effective principal, its equivalents and claim
    /// groups, and what its token narrows it to.
    reader: Caller,
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

/// The legacy principals whose stored cursors `actor` reads until it stores its own (phase 5
/// section 4.6): those its own principal string stands for, then those the person it reads as
/// (`effective`) stands for.
pub(crate) fn legacy_of(
    workspace: &Workspace,
    actor: &afd::Actor,
    id: &str,
    effective: Option<&str>,
) -> Vec<String> {
    let kind = serde_json::to_value(actor.kind)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_default();
    let mut legacy: Vec<String> = identities(workspace.config(), Some(&format!("{kind}:{id}")))
        .into_iter()
        .skip(1)
        .collect();
    for principal in identities(workspace.config(), effective)
        .into_iter()
        .skip(1)
    {
        if !legacy.contains(&principal) {
            legacy.push(principal);
        }
    }
    legacy
}

/// Who a stored cursor belongs to: the actor, and, for a caller whose positions are sealed, the
/// person it acts for, so people sharing one OAuth client keep cursors of their own.
pub(crate) fn person_of<'a>(actor: &'a afd::Actor, presenter: &Presenter) -> Option<&'a str> {
    actor.on_behalf_of.as_deref().filter(|_| presenter.seals())
}

/// `after` or `cursor` refused for a caller whose positions are sealed: malformed, another
/// caller's, another space's, a version 0 string and a position past the stream alike, with
/// nothing about the stream in the message.
pub(crate) fn sealed_cursor_refused(name: &str) -> CommandError {
    invalid_cursor(format!(
        "{name} is not a cursor event-list gave you for this space"
    ))
    .with_suggestion("Pass a cursor event-list returned to you for this space, or leave it out.")
}

/// Whether the caller's reader filter admits `event`: a version 1 event or later by a token of
/// its envelope's `access`; a version 0 line, which carries no access set, always.
pub(crate) fn admits(tokens: &[String], event: &Event) -> bool {
    event.version == 0
        || event
            .provenance
            .access
            .iter()
            .any(|token| tokens.contains(token))
}

/// An event as a caller whose positions are sealed sees it (`schemas/event-view.v1.json`).
pub(crate) fn view(event: &Event, space: &SpaceId, presenter: &Presenter) -> Value {
    let mut value = serde_json::to_value(event).unwrap_or(Value::Null);
    if let Some(map) = value.as_object_mut() {
        let cursor = presenter.cursor(space, event.seq);
        map.remove("seq");
        map.remove("journalSeq");
        map.remove("changes");
        map.insert("id".to_owned(), Value::String(cursor.clone()));
        map.insert("cursor".to_owned(), Value::String(cursor));
        if let Some(record) = map.get_mut("record").and_then(Value::as_object_mut) {
            record.remove("version");
        }
    }
    value
}

/// `event-list` for a caller whose positions are sealed.
#[allow(clippy::too_many_arguments)]
fn list_sealed(
    workspace: &Workspace,
    presenter: &Presenter,
    space: &SpaceId,
    consumer: &str,
    limit: usize,
    after: Option<String>,
    acknowledged: u64,
    head: u64,
    tokens: &[String],
) -> Result<Value, CommandError> {
    if acknowledged > head {
        return Err(invalid_cursor(
            "The cursor you acknowledged is past the end of this space's events".to_owned(),
        )
        .with_suggestion(
            "Store a valid cursor with event-ack, for example the head from space-list.",
        ));
    }
    let start = match after {
        Some(text) => presenter
            .open(Kind::Cursor, space.as_str(), &text)
            .filter(|seq| *seq <= head)
            .ok_or_else(|| sealed_cursor_refused("after"))?,
        None => acknowledged,
    };
    let path = workspace.layout().events_file(space);
    let scan = scan_readable(&path, start, acknowledged, limit, head, |event| {
        admits(tokens, event)
    })
    .map_err(|error| error.to_sealed_command_error())?;
    let events: Vec<Value> = scan
        .events
        .iter()
        .map(|event| view(event, space, presenter))
        .collect();
    Ok(json!({
        "space": space.as_str(),
        "consumer": consumer,
        "events": events,
        "cursor": presenter.cursor(space, scan.cursor),
        "acknowledged": presenter.cursor(space, scan.marked),
        "head": presenter.cursor(space, scan.head),
        "hasMore": scan.more(),
    }))
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
            reader,
        } = request;
        let events_error = |error: EventsError| error.to_command_error();
        let presenter = Presenter::of(workspace, &reader)?;
        let effective = reader.principal().map(str::to_owned);
        // Who may read the space, and which of its events (phase 2 specification, section 2.2):
        // `SPACE_NOT_READABLE` before anything is read.
        let reader = reader_filter(workspace.config(), space.as_str(), &reader)?;
        projector.catch_up_if_pending().map_err(events_error)?;
        let head = projector.tail(&space).map_err(events_error)?.seq;

        let acknowledged = match &caller {
            Some((actor, id)) => read_cursor_as(
                workspace.layout(),
                &space,
                (actor, id, person_of(actor, &presenter)),
                &consumer,
                &legacy_of(workspace, actor, id, effective.as_deref()),
            )
            .map_err(stored_cursor_problem)?,
            None => None,
        };
        if presenter.seals() {
            let tokens = reader.token_list().unwrap_or_default();
            return list_sealed(
                workspace,
                &presenter,
                &space,
                &consumer,
                limit,
                after,
                acknowledged.map_or(0, |cursor| cursor.seq()),
                head,
                tokens,
            );
        }
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
        // Skipped events leave gaps in `seq`, a count leak accepted in mode `none` and for the
        // operator and stdio (phase 2 section 6; phase 5 section 9.3 closes it for every other
        // hosted caller, above); the cursor still moves past them.
        let tokens = reader.token_list().unwrap_or_default();
        let events: Vec<Value> = events
            .iter()
            .filter(|event| admits(tokens, event))
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
    reader: Caller,
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
            reader,
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
                reader: Caller::of(self.workspace.config(), &context),
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

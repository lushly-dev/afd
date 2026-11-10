//! Usage events (phase 5 specification, section 12.1; D122, owner decision 13): one
//! content-free record per metered MCP HTTP request, kept off the request path (section 12.3)
//! and read back with `usage-list`.
//!
//! **What is metered.** Every request on the HTTP surface whose body the host read and found to
//! be one of the five methods (`tools/call`, `tools/list`, `tasks/get`, `tasks/update`,
//! `tasks/cancel`) as a single JSON-RPC request: answered, refused with an error code, or
//! refused with an HTTP status after its body was read. A request refused before the host read
//! its body (a missing or invalid token, the per-IP limit, a body too large) names no method, so
//! it is not metered; the host never reads a body to meter it that it would not otherwise read
//! (amendments from step 9).
//!
//! **What a record says** is `usage-event.v1` and nothing else, checked against the schema before
//! it is written ([`valid`]):
//!
//! - who: the effective principal, the actor and the namespace the host's verifier or gateway
//!   layer mapped (or the loopback agent in mode `none`), `null` when no caller was mapped;
//! - what: the method; a tool's name only when it is one of AFD's meta-tools or names a command
//!   that ran; a command only when it ran for this request (past the hidden-instance check, so a
//!   command hidden from the caller is never named) or became its task; a space only when the
//!   command ran there or, for a task's creation, when the caller reads it; a task's id;
//! - how it went: `ok`, an error code, or the refused request's HTTP status; the bytes received
//!   and sent, the time to the answer, and the trace id.
//!
//! Never an input, a query, a result, a document id, memory text or a token.
//!
//! The pieces: [`observe`] watches each request on the HTTP surfaces, [`parse`] reads what it
//! asked and was answered, the context hook and [`middleware`] tell it which command ran,
//! [`recorder`] carries records to the store off the request path, and
//! [`crate::shared::usage`] keeps them.

pub(crate) mod observe;
mod parse;
pub(crate) mod recorder;

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock, Weak};

use afd::{BoxFuture, Clock, CommandContext, CommandMiddleware, CommandResult, MiddlewareNext};
use serde_json::Value;

pub(crate) use recorder::{Limits, Stall};

pub(crate) use crate::principal::USAGE_KEY;

/// AFD's meta-tools of the hybrid strategy: a record names them as tools whatever they run.
pub(crate) const META_TOOLS: &[&str] = &[
    "afd-call",
    "afd-batch",
    "afd-pipe",
    "afd-discover",
    "afd-detail",
];

/// How one host records usage: its clock (the system's unless a test sets one), the queue's
/// bounds, and a test's stall.
#[derive(Clone)]
pub(crate) struct Setup {
    pub(crate) clock: Arc<dyn Clock>,
    pub(crate) limits: Limits,
    pub(crate) stall: Option<Stall>,
}

impl Default for Setup {
    fn default() -> Self {
        Self {
            clock: Arc::new(afd::SYSTEM_CLOCK),
            limits: Limits::default(),
            stall: None,
        }
    }
}

impl std::fmt::Debug for Setup {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Setup")
            .field("limits", &self.limits)
            .finish_non_exhaustive()
    }
}

/// `usage-event.v1`, compiled once.
fn schema() -> Option<&'static jsonschema::Validator> {
    static SCHEMA: OnceLock<Option<jsonschema::Validator>> = OnceLock::new();
    SCHEMA
        .get_or_init(|| {
            let schema: Value =
                serde_json::from_str(include_str!("../../schemas/usage-event.v1.json")).ok()?;
            jsonschema::validator_for(&schema).ok()
        })
        .as_ref()
}

/// Whether `record` is a `usage-event.v1` record: nothing else is ever written.
pub(crate) fn valid(record: &Value) -> bool {
    schema().is_some_and(|schema| schema.is_valid(record))
}

/// What ran for one request: its trace id, and each command that ran with the space it ran in.
#[derive(Debug, Default)]
struct Ran {
    trace: Option<String>,
    commands: Vec<(String, Option<String>)>,
}

/// One request's slot: the context hook and [`middleware`] note in it what ran, found by its
/// random id while the request is in flight.
#[derive(Clone)]
pub(crate) struct UsageSlot(Arc<SlotInner>);

struct SlotInner {
    id: String,
    ran: Mutex<Ran>,
}

impl Drop for SlotInner {
    fn drop(&mut self) {
        book()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(&self.id);
    }
}

/// The slots of the requests in flight, by id.
fn book() -> &'static Mutex<HashMap<String, Weak<SlotInner>>> {
    static BOOK: OnceLock<Mutex<HashMap<String, Weak<SlotInner>>>> = OnceLock::new();
    BOOK.get_or_init(|| Mutex::new(HashMap::new()))
}

impl UsageSlot {
    /// A new slot under 128 random bits, in the book until its last clone drops. `None` when the
    /// OS random source fails: the request is then not observed.
    fn new() -> Option<Self> {
        let id = crate::person::service::random_id()?;
        let inner = Arc::new(SlotInner {
            id: id.clone(),
            ran: Mutex::new(Ran::default()),
        });
        book()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(id, Arc::downgrade(&inner));
        Some(Self(inner))
    }

    fn find(id: &str) -> Option<Self> {
        book()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(id)
            .and_then(Weak::upgrade)
            .map(Self)
    }

    fn ran(&self) -> std::sync::MutexGuard<'_, Ran> {
        self.0
            .ran
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// The trace id the hook noted, and the space `command` ran in when it ran (`Some`).
    fn outcome_of(&self, command: Option<&str>) -> (Option<String>, Option<Option<String>>) {
        let ran = self.ran();
        let space = command.and_then(|command| {
            ran.commands
                .iter()
                .find(|(name, _)| name == command)
                .map(|(_, space)| space.clone())
        });
        (ran.trace.clone(), space)
    }
}

/// For the context hook: note the call's trace id in its HTTP request's usage slot, and put the
/// slot's id under [`USAGE_KEY`] (always overwritten: `null` without a slot), so [`middleware`]
/// finds the slot.
pub(crate) fn note_call(parts: Option<&axum::http::request::Parts>, context: &mut CommandContext) {
    let slot = parts.and_then(|parts| parts.extensions.get::<UsageSlot>());
    let id = match slot {
        Some(slot) => {
            let trace = context
                .trace_id
                .clone()
                .filter(|trace| parse::is_trace(trace));
            let mut ran = slot.ran();
            if ran.trace.is_none() {
                ran.trace = trace;
            }
            Value::String(slot.0.id.clone())
        }
        None => Value::Null,
    };
    context.extra.insert(USAGE_KEY.to_owned(), id);
}

/// The space a result says its command ran in (`dev.umbel/space`), unless it refused the space.
fn ran_in(result: &CommandResult<Value>) -> Option<String> {
    let refused = result.error.as_ref().is_some_and(|error| {
        error.code == crate::access::SPACE_NOT_READABLE
            || error.code == crate::host::SPACE_NOT_FOUND
    });
    if refused {
        return None;
    }
    result
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.extra.get(crate::middleware::SPACE_KEY))
        .and_then(Value::as_str)
        .filter(|space| parse::is_space_id(space))
        .map(str::to_owned)
}

/// The middleware just inside the hidden-instance check and outside the space check: notes in
/// the request's slot each command that ran, and the space its result says it ran in. A command
/// hidden from the caller never gets here, so a record never names one.
pub(crate) fn middleware() -> CommandMiddleware {
    Arc::new(
        move |name: String,
              _input: Value,
              context: CommandContext,
              next: MiddlewareNext|
              -> BoxFuture<'static, CommandResult<Value>> {
            let slot = context
                .extra
                .get(USAGE_KEY)
                .and_then(Value::as_str)
                .and_then(UsageSlot::find);
            Box::pin(async move {
                let Some(slot) = slot else {
                    return next().await;
                };
                let index = {
                    let mut ran = slot.ran();
                    ran.commands.push((name, None));
                    ran.commands.len() - 1
                };
                let result = next().await;
                if let Some(entry) = slot.ran().commands.get_mut(index) {
                    entry.1 = ran_in(&result);
                }
                result
            })
        },
    )
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    #[test]
    fn a_slot_is_found_by_its_id_only_while_it_lives() {
        let slot = UsageSlot::new().unwrap();
        let id = slot.0.id.clone();
        assert!(UsageSlot::find(&id).is_some());
        assert!(UsageSlot::find("abcdefghijklmnopqrstuvwxyz").is_none());
        drop(slot);
        assert!(UsageSlot::find(&id).is_none());
    }

    #[test]
    fn a_refused_space_is_not_the_space_a_command_ran_in() {
        let mut result = afd::success(Value::Null);
        result
            .metadata
            .get_or_insert_with(afd::ResultMetadata::default)
            .extra
            .insert(
                crate::middleware::SPACE_KEY.to_owned(),
                Value::from("private"),
            );
        assert_eq!(ran_in(&result).as_deref(), Some("private"));
        for code in [
            crate::access::SPACE_NOT_READABLE,
            crate::host::SPACE_NOT_FOUND,
        ] {
            let mut refused = afd::failure::<Value>(afd::CommandError::new(code, "m"));
            refused.metadata = result.metadata.clone();
            assert_eq!(ran_in(&refused), None, "{code}");
        }
    }

    #[test]
    fn the_hook_always_overwrites_the_key() {
        let mut context = CommandContext::default();
        context
            .extra
            .insert(USAGE_KEY.to_owned(), Value::String("forged".into()));
        note_call(None, &mut context);
        assert_eq!(context.extra.get(USAGE_KEY), Some(&Value::Null));
    }
}

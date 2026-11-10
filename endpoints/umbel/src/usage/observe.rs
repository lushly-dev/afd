//! Watching each request on the HTTP surfaces (phase 5 sections 12.1 and 12.3).
//!
//! Each surface's MCP service asks [`Observer::begin`] for a [`Watch`] before its request goes in
//! and hands the answer to [`Watch::finish`] when it comes out. The watch reads nothing the
//! request path would not read: it keeps the request body's chunks as the layers behind it read
//! them (so a request refused before its body is read yields nothing), and the answer's body
//! only when the service built it whole. When the answer is out of the service, the watch reads
//! the few members a record names from the two bodies already in memory (no input, result or
//! content is kept), builds the record and queues it, none of which waits on a lock, a file or
//! the store; the record is written by the [`Recorder`](super::recorder::Recorder)'s thread. So
//! a request never waits on its record's write and never fails because of it, and whether its
//! record was queued or dropped is settled before its answer leaves.

use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use std::time::Instant;

use afd::{Actor, ActorKind, Clock};
use axum::body::{Body, Bytes};
use axum::extract::Request;
use axum::http::Method as HttpMethod;
use axum::response::Response;
use http_body::{Frame, SizeHint};
use http_body_util::BodyExt;
use serde_json::json;

use super::parse::{self, Method};
use super::recorder::{Entry, Recorder, Writer};
use super::{META_TOOLS, Setup, UsageSlot};
use crate::access::{Caller, Narrowing};
use crate::auth::caller::{CallerSlot, VerifiedCaller};
use crate::workspace::{AuthMode, Config, Workspace};

/// The largest answer whose outcome is read: anything larger is passed on as it comes, metered
/// by its status alone.
const MAX_READ_BYTES: u64 = 64 * 1024 * 1024;

/// One HTTP surface's observer.
pub(crate) struct Observer {
    recorder: Arc<Recorder>,
    config: Arc<Config>,
    clock: Arc<dyn Clock>,
    enabled: bool,
}

impl std::fmt::Debug for Observer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Observer")
            .field("enabled", &self.enabled)
            .finish_non_exhaustive()
    }
}

impl Observer {
    /// The observer of a surface over `workspace`. Its writer starts at once, and purges what
    /// passed the retention even when `usage.enabled` is false; then no request is watched.
    pub(crate) fn start(workspace: &Workspace, setup: &Setup) -> Arc<Self> {
        let config = workspace.config();
        let store = crate::shared::usage::SqliteUsage::new(
            &workspace.layout().usage_store(),
            config.store.lock_timeout_ms,
        );
        let recorder = Recorder::start(
            Writer {
                store: Arc::new(store),
                clock: Arc::clone(&setup.clock),
                retention_days: config.usage.retention_days,
                stall: setup.stall.clone(),
            },
            setup.limits,
        );
        Arc::new(Self {
            recorder,
            config: Arc::new(config.clone()),
            clock: Arc::clone(&setup.clock),
            enabled: config.usage.enabled,
        })
    }

    /// Watch `request`, a request for the MCP endpoint: a `POST`, when usage is enabled. Puts the
    /// request's usage slot in its extensions (replacing any) and taps its body.
    pub(crate) fn begin(self: &Arc<Self>, request: &mut Request) -> Option<Watch> {
        if !self.enabled || request.method() != HttpMethod::POST {
            return None;
        }
        let slot = UsageSlot::new()?;
        request.extensions_mut().insert(slot.clone());
        let tapped = Arc::new(Tapped::default());
        let body = std::mem::take(request.body_mut());
        *request.body_mut() = Body::new(Tap {
            inner: body,
            tapped: Arc::clone(&tapped),
        });
        Some(Watch {
            observer: Arc::clone(self),
            slot,
            tapped,
            started: Instant::now(),
            at_ms: self.clock.now(),
        })
    }
}

/// The request body's chunks as the layers read them.
#[derive(Default)]
struct Tapped {
    chunks: Mutex<Vec<Bytes>>,
    bytes: AtomicU64,
}

impl Tapped {
    fn whole(&self) -> Vec<u8> {
        self.chunks
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .concat()
    }
}

/// A request body that keeps what is read of it.
struct Tap {
    inner: Body,
    tapped: Arc<Tapped>,
}

impl http_body::Body for Tap {
    type Data = Bytes;
    type Error = axum::Error;

    fn poll_frame(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Bytes>, axum::Error>>> {
        let polled = Pin::new(&mut self.inner).poll_frame(cx);
        if let Poll::Ready(Some(Ok(frame))) = &polled
            && let Some(data) = frame.data_ref()
        {
            self.tapped
                .bytes
                .fetch_add(data.len() as u64, Ordering::SeqCst);
            self.tapped
                .chunks
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .push(data.clone());
        }
        polled
    }

    fn is_end_stream(&self) -> bool {
        self.inner.is_end_stream()
    }

    fn size_hint(&self) -> SizeHint {
        self.inner.size_hint()
    }
}

/// An answer passed on as it comes, its bytes counted; `done` runs once, at its end or when it is
/// dropped.
struct Counted {
    inner: Body,
    sent: u64,
    done: Option<Box<dyn FnOnce(u64) + Send>>,
}

impl Counted {
    fn finish(&mut self) {
        if let Some(done) = self.done.take() {
            done(self.sent);
        }
    }
}

impl Drop for Counted {
    fn drop(&mut self) {
        self.finish();
    }
}

impl http_body::Body for Counted {
    type Data = Bytes;
    type Error = axum::Error;

    fn poll_frame(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Bytes>, axum::Error>>> {
        let polled = Pin::new(&mut self.inner).poll_frame(cx);
        match &polled {
            Poll::Ready(Some(Ok(frame))) => {
                if let Some(data) = frame.data_ref() {
                    self.sent += data.len() as u64;
                }
            }
            Poll::Ready(None | Some(Err(_))) => self.finish(),
            Poll::Pending => {}
        }
        polled
    }

    fn is_end_stream(&self) -> bool {
        self.inner.is_end_stream()
    }

    fn size_hint(&self) -> SizeHint {
        self.inner.size_hint()
    }
}

/// Who called, as far as a record says.
#[derive(Default)]
struct Who {
    principal: Option<String>,
    actor: Option<String>,
    namespace: Option<String>,
    caller: Option<Caller>,
}

/// `<kind>:<id>` of an actor, when it is a principal string.
fn actor_text(actor: &Actor) -> Option<String> {
    let kind = match actor.kind {
        ActorKind::Human => "human",
        ActorKind::Agent => "agent",
        ActorKind::Service => "service",
        ActorKind::Script => "script",
        ActorKind::Test => return None,
    };
    let text = format!("{kind}:{}", actor.id.as_deref()?);
    crate::workspace::parse_principal(&text)
        .is_ok()
        .then_some(text)
}

impl Who {
    /// The loopback agent of mode `none`.
    fn loopback(config: &Config) -> Self {
        let actor = Actor::new(ActorKind::Agent).with_id(crate::principal::LOOPBACK_ID);
        let principal = crate::provenance::effective_principal(&actor);
        Self {
            caller: Some(Caller::new(
                config,
                principal.clone(),
                Vec::new(),
                Narrowing::None,
                false,
            )),
            principal,
            actor: actor_text(&actor),
            namespace: None,
        }
    }

    /// A caller the host's verifier or gateway layer mapped for this request.
    fn verified(config: &Config, caller: &VerifiedCaller) -> Self {
        let principal = caller.effective_principal();
        let scopes = caller
            .scopes
            .iter()
            .filter_map(|scope| crate::auth::Scope::parse(&config.auth.scope_prefix, scope))
            .collect();
        Self {
            caller: Some(Caller::new(
                config,
                principal.clone(),
                caller.claim_groups().to_vec(),
                Narrowing::Token(scopes),
                false,
            )),
            principal,
            actor: actor_text(&caller.actor),
            namespace: Some(caller.namespace.clone()),
        }
    }

    /// Whether the caller reads `space`.
    fn reads(&self, config: &Config, space: &str) -> bool {
        self.caller.as_ref().is_some_and(|caller| {
            config
                .spaces
                .iter()
                .find(|candidate| candidate.id.as_str() == space)
                .is_some_and(|space| caller.reads(config, space))
        })
    }
}

/// One watched request.
pub(crate) struct Watch {
    observer: Arc<Observer>,
    slot: UsageSlot,
    tapped: Arc<Tapped>,
    started: Instant,
    at_ms: i64,
}

/// What [`Watch::finish`] knows when the answer is out.
struct Done {
    who: Who,
    status: u16,
    answer: Option<Bytes>,
    sent: u64,
    duration_ms: u64,
}

impl Watch {
    /// Queue the request's record, and hand `response` back: an answer the service built whole as
    /// it is, any other as it streams, its record queued at its end. `caller` is the request's
    /// caller slot in a hosted mode (`None` in mode `none`).
    pub(crate) async fn finish(self, response: Response, caller: Option<&CallerSlot>) -> Response {
        let duration_ms = u64::try_from(self.started.elapsed().as_millis()).unwrap_or(u64::MAX);
        let config = &self.observer.config;
        let who = match config.auth.mode {
            AuthMode::None => Who::loopback(config),
            mode => caller
                .and_then(CallerSlot::caller)
                .filter(|caller| caller.vouched_for(mode))
                .map(|caller| Who::verified(config, caller))
                .unwrap_or_default(),
        };
        let (parts, body) = response.into_parts();
        let status = parts.status.as_u16();
        match http_body::Body::size_hint(&body).exact() {
            // The service built the answer whole: taking it is not waiting on anything.
            Some(length) if length <= MAX_READ_BYTES => {
                let bytes = match body.collect().await {
                    Ok(collected) => collected.to_bytes(),
                    Err(error) => {
                        tracing::debug!(target: "umbel::usage", %error, "an answer's body failed");
                        let mut parts = parts;
                        parts.headers.remove(axum::http::header::CONTENT_LENGTH);
                        return Response::from_parts(parts, Body::empty());
                    }
                };
                self.record(Done {
                    who,
                    status,
                    sent: bytes.len() as u64,
                    answer: Some(bytes.clone()),
                    duration_ms,
                });
                Response::from_parts(parts, Body::from(bytes))
            }
            _ => {
                let body = Body::new(Counted {
                    inner: body,
                    sent: 0,
                    done: Some(Box::new(move |sent| {
                        self.record(Done {
                            who,
                            status,
                            answer: None,
                            sent,
                            duration_ms,
                        });
                    })),
                });
                Response::from_parts(parts, body)
            }
        }
    }

    /// Build the record and queue it. Reads what was asked and answered; keeps no more.
    fn record(self, done: Done) {
        let config = &self.observer.config;
        // In a hosted mode only a caller the verifier or gateway layer mapped for this request is
        // metered: a body some layer read before refusing its caller (AFD reads a form body
        // before the token, M2) meters nothing, so no one unauthenticated grows the store.
        if config.auth.mode.is_hosted() && done.who.caller.is_none() {
            return;
        }
        let asked_bytes = self.tapped.whole();
        let Some(asked) = parse::asked(&asked_bytes) else {
            return;
        };
        drop(asked_bytes);
        let answered = parse::answered(done.status, done.answer.as_deref());
        drop(done.answer);
        let (trace, ran) = self.slot.outcome_of(asked.named.as_deref());
        let (mut tool, mut command, mut space, mut task) = (None, None, None, None);
        match asked.method {
            Method::ToolsCall => {
                if answered.task.is_some() {
                    // A task runs past this request (and may or may not have started by now):
                    // its creation names the command it runs, which AFD made a task only because
                    // it exists for the caller, and the space the task store records (its input's,
                    // else the default) when the caller reads it.
                    command.clone_from(&asked.named);
                    space = asked
                        .space
                        .clone()
                        .or_else(|| Some(config.default_space.as_str().to_owned()))
                        .filter(|space| done.who.reads(config, space));
                } else if let Some(space_ran) = ran {
                    command.clone_from(&asked.named);
                    space = space_ran;
                }
                tool = asked.tool.clone().filter(|tool| {
                    META_TOOLS.contains(&tool.as_str()) || command.as_deref() == Some(tool)
                });
                task.clone_from(&answered.task);
            }
            Method::ToolsList => {}
            // A task's id only when the poll found the caller's own task: a failed poll keeps no
            // text the caller chose, and names no one else's task.
            Method::TasksGet | Method::TasksUpdate | Method::TasksCancel => {
                if answered.outcome == "ok" {
                    task.clone_from(&asked.task);
                }
            }
        }
        let Some(id) = crate::person::service::random_id() else {
            return;
        };
        let record = json!({
            "version": crate::versions::USAGE_VERSION,
            "id": format!("u-{id}"),
            "at": crate::person::iso(self.at_ms),
            "trace": trace,
            "principal": done.who.principal,
            "actor": done.who.actor,
            "namespace": done.who.namespace,
            "transport": "http",
            "method": asked.method.as_str(),
            "tool": tool,
            "command": command,
            "space": space,
            "outcome": answered.outcome,
            "bytesIn": self.tapped.bytes.load(Ordering::SeqCst),
            "bytesOut": done.sent,
            "durationMs": done.duration_ms,
            "task": task,
        });
        let owner = record["principal"]
            .as_str()
            .map(str::to_owned)
            .unwrap_or_default();
        self.observer.recorder.submit(Entry { record, owner });
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    #[test]
    fn actors_are_principal_strings_or_nothing() {
        assert_eq!(
            actor_text(&Actor::new(ActorKind::Agent).with_id("corp/app")).as_deref(),
            Some("agent:corp/app")
        );
        assert_eq!(actor_text(&Actor::new(ActorKind::Test).with_id("x")), None);
        assert_eq!(actor_text(&Actor::new(ActorKind::Agent)), None);
    }
}

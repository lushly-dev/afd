//! The middleware chain around a command's handler, and the handler step at its end.

use std::sync::Arc;

use super::{
    BoxFuture, CallState, CommandContext, CommandDefinition, CommandMiddleware, MiddlewareNext,
};
use crate::errors::{error_codes, CommandError};
use crate::journal::secret_scope::{scoped_step, Scope};
use crate::result::{failure, CommandResult};
use crate::ResultMetadata;

/// Build the middleware chain around `command`'s handler.
///
/// The returned function can be called more than once (a retry middleware calls `next` again).
/// Every layer shares `input`; the handler step makes the one copy the handler owns. The context
/// moves down the chain, so no layer copies it unless it calls `next` more than once. Each step
/// (every layer and the handler) puts `state`, the call's own state from before the chain, back
/// on the context it is given, so a middleware refines only the other public fields. Each step
/// also runs in the call's secret `scope`, whatever task polls it
/// ([`crate::journal::secret_scope`]).
pub(super) fn middleware_chain(
    command: &Arc<CommandDefinition>,
    middleware: &[CommandMiddleware],
    input: Arc<serde_json::Value>,
    state: CallState,
    check_output_budget: bool,
    scope: Option<Scope>,
) -> MiddlewareNext {
    let state = Arc::new(state);
    let handler: MiddlewareNext = {
        let command = Arc::clone(command);
        let input = Arc::clone(&input);
        let state = Arc::clone(&state);
        let scope = scope.clone();
        Arc::new(move |mut context| {
            state.restore(&mut context);
            scoped_step(
                scope.as_ref(),
                run_handler(
                    Arc::clone(&command),
                    (*input).clone(),
                    context,
                    check_output_budget,
                ),
            )
        })
    };

    middleware.iter().rev().fold(handler, |next, layer| {
        let layer = Arc::clone(layer);
        let name = command.name.clone();
        let input = Arc::clone(&input);
        let state = Arc::clone(&state);
        let scope = scope.clone();
        Arc::new(move |mut context| {
            state.restore(&mut context);
            scoped_step(
                scope.as_ref(),
                layer(name.clone(), Arc::clone(&input), context, Arc::clone(&next)),
            )
        })
    })
}

/// The handler step at the end of the chain: the approval admission check, the idempotency step
/// around the handler, the output budget check (unless `check_output_budget` is unset, for a stream) and the actor kind.
pub(super) fn run_handler(
    command: Arc<CommandDefinition>,
    input: serde_json::Value,
    mut context: CommandContext,
    check_output_budget: bool,
) -> BoxFuture<'static, CommandResult<serde_json::Value>> {
    // A declared approval policy holds without the approval middleware (#1886): a command
    // whose policy is neither unset nor `NotRequired` runs only on an admission that names
    // it and this validated input, taken here, so one admission runs one handler. A
    // policy function is not evaluated here; declaring one needs an approval step.
    // A gate declared only in the approval middleware's list is taken here too.
    let admission = context.approval_admission.take();
    let gated = crate::approval::admission::gates(command.approval.as_ref())
        || admission
            .as_ref()
            .is_some_and(|admission| admission.gated());
    let refused = gated
        .then(|| {
            admission.map_or(crate::approval::admission::Taken::Missing, |admission| {
                admission.take(&command.name, &input)
            })
        })
        .filter(|taken| *taken != crate::approval::admission::Taken::Admitted);
    if let Some(taken) = refused {
        return Box::pin(std::future::ready(failure(approval_unavailable(
            &command.name,
            taken,
        ))));
    }
    // Relay evidence and the approval relay serve the call that reached the middleware,
    // never a command the handler runs in process with this context.
    // An in-process call has no server state, and a server call often nothing to clear: only
    // then is the shared state copied.
    let relayed = context.server().relay_evidence.is_some()
        || context.server().up_front_approval.is_some()
        || context.server().approval_relay.is_some();
    if let (true, Some(server)) = (relayed, context.server.as_mut()) {
        let server = Arc::make_mut(server);
        server.relay_evidence = None;
        server.up_front_approval = None;
        if server.approval_relay.is_some() {
            server.approval_relay = Some(Arc::new(
                crate::approval::relay::ApprovalRelayChannel::never_asks(),
            ));
        }
    }
    Box::pin(async move {
        // Only the kind is reported, never the actor's id or label.
        let actor_kind = context.actor.as_ref().map(|actor| actor.kind);
        let output_budget = context.output_budget;
        // The idempotency step (`spec/idempotency.md`, S1): after the approval admission check,
        // it answers a repeat from its store or reserves the key, then makes the cancellation
        // check immediately before the handler (including after an approval wait), as the
        // registry does without it. The handler never sees the step's state.
        let step = context.idempotency.take();
        // The registry has already put a secret command in its scope and off every parent's
        // tape, so its own recording keeps its reads.
        let handler = Arc::clone(&command);
        let mut result =
            crate::idempotency::step::run(step, &command.name, context, |context| async move {
                handler.call_handler(input, context).await
            })
            .await;
        // The output budget check (`spec/output-budgets.md`, B5): right after the
        // handler, before `metadata` is stamped and before any middleware sees it.
        if let Some(limit) = output_budget.filter(|_| check_output_budget) {
            result = crate::output_budget::check_result(&command, limit, result);
        }
        if let Some(actor_kind) = actor_kind {
            let metadata = result.metadata.get_or_insert_with(ResultMetadata::new);
            metadata.actor_kind = Some(actor_kind);
            // A handler that still writes the key into `extra` would serialize it twice.
            metadata.extra.remove("actorKind");
        }
        result
    })
}

/// `APPROVAL_UNAVAILABLE` for a gated dispatch no approval step admitted (#1886):
/// `details.reason` is `no-approval-step` when none ever did, else `admission-mismatch`.
fn approval_unavailable(name: &str, taken: crate::approval::admission::Taken) -> CommandError {
    use crate::approval::admission::Taken;
    let (reason, suggestion) = match taken {
        Taken::Missing => ("no-approval-step", format!("Tell the user that {name} needs their approval and this server has no approval step; do not retry. The operator adds the approval middleware (create_approval_middleware; enable the `approval` feature) or removes the command's approval policy.")),
        Taken::Mismatch | Taken::Admitted => ("admission-mismatch", "Do not retry: this call is not the one approved. The operator moves middleware that retries or changes input before the approval middleware.".to_owned()),
    };
    CommandError::new(
        error_codes::APPROVAL_UNAVAILABLE,
        format!("{name} needs a person's approval, and this server cannot ask for it"),
    )
    .with_suggestion(suggestion)
    .with_retryable(false)
    // The operator fixes the approval setup (`spec/recovery.md`, "Engine errors").
    .with_recovery(crate::errors::Recovery::external())
    .with_details(std::collections::HashMap::from([(
        "reason".to_owned(),
        serde_json::json!(reason),
    )]))
}

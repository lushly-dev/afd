//! Command dispatch ([`CommandRegistry::execute`]), validation and batches, and their helpers.

use super::registry::{call_not_granted, read_lock};
#[allow(clippy::wildcard_imports)]
use super::*;

impl CommandRegistry {
    /// Execute a command by name, enforcing its metadata.
    ///
    /// In order:
    ///
    /// 0. A call with [`CommandInterface::Apps`], an app's call, returns
    ///    `CALL_NOT_GRANTED` unless the command exists for the caller, sets
    ///    [`ExposeOptions::apps`] and [`Self::set_call_grant`]'s check grants it.
    ///    The answer is the same in every case, before lookup or validation, so an
    ///    app learns nothing about commands it may not call.
    /// 1. An unknown name returns `COMMAND_NOT_FOUND`. Its suggestion names up
    ///    to three close matches, as in TypeScript, chosen among the commands
    ///    exposed to `context.interface` (all commands when it is unset) and
    ///    available in the active context, and points to `afd-help` when that
    ///    is one of them (`afd-discover` for the MCP server's calls), with a
    ///    `call` recovery to the same command and none when it names neither
    ///    (`spec/recovery.md`, "Engine errors"). On an
    ///    authorized MCP server, a command its resolver hides from the caller
    ///    is an unknown name here, with the same answer
    ///    (`spec/authorization.md`, M6, "Hidden commands").
    /// 2. When `context.interface` is set, a command not exposed to that
    ///    interface returns `COMMAND_NOT_EXPOSED` (see [`ExposeOptions`]); the
    ///    MCP server's calls get `COMMAND_NOT_FOUND` instead, as for an unknown
    ///    name.
    /// 3. With an active context ([`CommandContext::active_context`]), a
    ///    command outside it returns `COMMAND_NOT_IN_CONTEXT` (see
    ///    [`crate::contexts`]).
    /// 4. A `context.timeout_ms` without the `native` feature returns
    ///    `UNSUPPORTED_OPTION`.
    /// 5. The input is validated against the command's `parameters`, parameter
    ///    defaults are applied, and undeclared keys are dropped, as Zod does in
    ///    TypeScript. Invalid input returns `VALIDATION_ERROR` (`Input
    ///    validation failed`) with the problems in `suggestion` and
    ///    `details.errors`.
    /// 6. The declared context fields ([`Self::set_context_fields`]) are
    ///    validated on `context.extra`, each value replaced by its schema's
    ///    output; `null` counts as no value. An invalid value or a missing
    ///    required one returns `VALIDATION_ERROR` (`Context field '<name>'
    ///    is not valid` or `is required`), with `details.field`,
    ///    `details.meta` and `details.errors`. Commands named `afd-*` do not
    ///    enforce `required`.
    ///    The output budget ask ([`CommandContext::with_output_budget_ask`]) is
    ///    validated next, whether or not the command declares a budget: an
    ///    invalid ask returns `VALIDATION_ERROR` (`details.field` is
    ///    `outputBudget`, `details.meta` is `dev.afd/outputBudget`). The
    ///    effective budget ([`CommandContext::output_budget`]) is then set on
    ///    the context (`spec/output-budgets.md`, B3).
    /// 7. The middleware chain and then the handler run with the validated
    ///    input. With `context.timeout_ms`, a run that outlasts it returns
    ///    `TIMEOUT` (this needs a Tokio runtime with time enabled). A panic in
    ///    a middleware layer or the handler returns `COMMAND_EXECUTION_ERROR`
    ///    with the generic message of [`execution_failure`], as TypeScript
    ///    does for a thrown exception outside `devMode`; the panic payload is
    ///    never included. The failure is what the journal records (with
    ///    `with_record_failures(true)`), and a batch or pipeline treats it as
    ///    any failed command. Only unwinding panics are caught: with
    ///    `panic = "abort"`, and on `wasm32-unknown-unknown` (which cannot
    ///    unwind), a panic aborts the process.
    ///
    /// The innermost link of the chain checks a successful result against the
    /// effective output budget right after the handler, before `metadata` is
    /// stamped (B5, B6): an over-budget read becomes an `OUTPUT_BUDGET_EXCEEDED`
    /// failure, an over-budget [mutation](CommandDefinition::as_mutation) keeps
    /// its result with a warning of that code, and a result within budget
    /// carries `metadata["dev.afd/outputBudget"] = { limitBytes, usedBytes }`.
    /// A handler's own failure passes unchanged.
    ///
    /// The middleware and the handler always see a `clock` and a `random`
    /// source on the context
    /// ([`SYSTEM_CLOCK`](crate::clock::SYSTEM_CLOCK) and
    /// [`SYSTEM_RANDOM`](crate::clock::SYSTEM_RANDOM) unless the caller set
    /// them). When the context has an `actor`, the handler's result carries
    /// its kind as `metadata.actorKind`.
    ///
    /// The handler is not called when any check fails.
    pub async fn execute(
        &self,
        name: &str,
        input: serde_json::Value,
        context: Option<CommandContext>,
    ) -> CommandResult<serde_json::Value> {
        self.execute_with_budget(name, input, context, true).await
    }

    /// [`Self::execute`], with the result's output budget check (`spec/output-budgets.md`, B5 and
    /// B6) only when `check_output_budget` is set: the stream executor runs a command without it,
    /// since a streamed command's chunks are not checked (B7). The ask is still validated and the
    /// effective budget still set (B2 to B4), so the handler sees it either way.
    pub(crate) async fn execute_with_budget(
        &self,
        name: &str,
        input: serde_json::Value,
        context: Option<CommandContext>,
        check_output_budget: bool,
    ) -> CommandResult<serde_json::Value> {
        let context = with_context_defaults(context.unwrap_or_default(), &ContextDefaults::new());
        if context.interface == Some(CommandInterface::Apps)
            && !self.app_call_granted(name, &context)
        {
            return failure(call_not_granted());
        }
        let active_context = context.active_context();
        let visible = |candidate: &CommandDefinition| {
            context
                .interface
                .is_none_or(|interface| candidate.expose.is_exposed_to(interface))
        };
        // A command that does not exist for the caller (one an authorized server's resolver
        // hides from it, `spec/authorization.md`, M6) is a missing one, before any other check.
        let known = |candidate: &CommandDefinition| {
            context
                .server()
                .known
                .as_ref()
                .is_none_or(|known| known.allows(candidate))
        };
        // A remote caller cannot tell an unexposed command from a missing one (D4).
        let command = self
            .get(name)
            .filter(|command| known(command))
            .filter(|command| !context.server().remote || visible(command));
        let Some(command) = command else {
            // Suggest only names the caller could call: an interface caller must
            // not learn the names of commands that are not exposed to it, nor one an
            // authorized server hides from it by scope (`spec/authorization.md`, M6): the
            // listing filter, which the server sets whenever it sets `known`, holds only
            // commands that exist for the caller.
            let listed = context
                .server()
                .tool_surface
                .as_ref()
                .and_then(|surface| surface.visible.as_ref());
            let callable: Vec<String> = read_lock(&self.commands)
                .ordered
                .iter()
                .filter(|candidate| visible(candidate))
                .filter(|candidate| candidate.is_accessible_in_context(active_context.as_deref()))
                .filter(|candidate| listed.is_none_or(|listed| listed.allows(candidate)))
                .map(|candidate| candidate.name.clone())
                .collect();
            return failure(command_not_found(name, &callable, context.server().remote));
        };

        if let Some(interface) = context.interface {
            if !command.expose.is_exposed_to(interface) {
                return failure(
                    CommandError::new(
                        error_codes::COMMAND_NOT_EXPOSED,
                        format!("Command '{name}' is not exposed to {interface}"),
                    )
                    .with_suggestion(format!(
                        "Call it from an interface it is exposed to, or set expose.{interface} to true in its definition"
                    ))
                    .with_retryable(false)
                    .with_recovery(crate::errors::Recovery::external()),
                );
            }
        }

        if let Some(active) = active_context.as_deref() {
            if !command.is_accessible_in_context(Some(active)) {
                // Whether the caller can call a context command, the same test for the
                // suggestion and the recovery: registered, exposed to the interface, in the
                // active context, existing for the caller and in its listing
                // (`spec/recovery.md`, rule 2).
                let listed = context
                    .server()
                    .tool_surface
                    .as_ref()
                    .and_then(|surface| surface.visible.as_ref());
                let can = |name: &str| {
                    self.get(name).is_some_and(|tool| {
                        visible(&tool)
                            && known(&tool)
                            && tool.is_accessible_in_context(Some(active))
                            && listed.is_none_or(|listed| listed.allows(&tool))
                    })
                };
                return failure(crate::contexts::not_in_context_error(&command, active, can));
            }
        }

        let effective_timeout_ms = match context.timeout_ms {
            Some(0) => None,
            Some(ms) => Some(ms),
            None => context
                .default_timeout_override
                .unwrap_or_else(|| self.default_timeout_ms()),
        };
        if effective_timeout_ms.is_some() && !cfg!(feature = "native") {
            return failure(
                CommandError::new(
                    error_codes::UNSUPPORTED_OPTION,
                    "Command timeouts require the native feature",
                )
                .with_suggestion("Enable the native feature or omit timeout_ms from the context")
                .with_retryable(false),
            );
        }

        // A step of an `afd-batch` or `afd-pipe` approved up front runs on the input validated
        // then, so the input that runs is the one the human was shown (#1414). It is still
        // validated as sent here; only the value is kept. Every step takes it, not only one whose
        // command declares a policy: an approval middleware's commands list can gate a command
        // that declares none, and the registry cannot see that list.
        let approved = context
            .server()
            .up_front_approval
            .as_ref()
            .and_then(|up_front| up_front.validated(&command.name, &input));
        let input = match self.validate(&command, input) {
            Ok(input) => approved.unwrap_or(input),
            Err(error) => return failure(*error),
        };

        // This call's own admission record (#1886): fresh for every call, so a batch item, a
        // pipeline step or a nested call never inherits another call's admission.
        let mut context = context;
        context.approval_admission = Some(crate::approval::admission::Admission::begin(
            Arc::clone(&command),
        ));
        let context_fields = Arc::clone(&read_lock(&self.context_fields));
        if let Err(error) = apply_context_fields(
            &context_fields.0,
            &context_fields.1,
            &command.name,
            &mut context,
        ) {
            return failure(*error);
        }
        if let Err(error) = crate::output_budget::apply_output_budget(&command, &mut context) {
            return failure(*error);
        }
        // The execute-time scope decision on the validated input, with defaults applied and any
        // pipeline references resolved (`spec/authorization.md`, M6, "At execution").
        if let (Some(check), Some(credentials)) =
            (&context.server().scope_check, &context.credentials)
        {
            if let Some(error) = (check.0)(&command.name, &input, credentials) {
                return failure(error);
            }
        }

        // Pre-dispatch cancellation check (`spec/execution-controls.md`): before middleware and
        // before starting any timer, an already-cancelled call returns COMMAND_CANCELLED.
        if context.is_cancelled() {
            return failure(command_cancelled_error(&command.name));
        }

        let middleware = Arc::clone(&read_lock(&self.middleware));
        if context
            .server()
            .instance_guard
            .is_some_and(|guard| guard.violated_by(middleware.approval_state))
        {
            return failure(CommandError::internal(
                "ServerInstances::Multiple cannot run per-process approval state; configure a shared confirmation key and nonce_store",
            ));
        }
        // A command declaring `secret` reads off every recording parent's tape, recorded or not
        // (`spec/journal.md`): it runs on the sources under the recording ones, and in a secret
        // scope, where every parent's tape refuses the readings that still reach it (through a
        // host's wrapper around a recording source).
        let secret_scope = command.secret.then(crate::journal::secret_scope::enter);
        if command.secret {
            crate::journal::off_tape(&mut context);
        }
        // Replayed calls, and the calls nested in them, are never recorded, and a secret call
        // only by a recorder with a redactor. The recorder read here decides and records.
        let journal = read_lock(&self.journal).clone().filter(|recorder| {
            !context.journal_state.replaying && recorder.records_call(name, command.secret)
        });
        // A secret call's recorder reads its own timing inside the call's scope too, so a
        // reading through a host's wrapper reaches no other call's tape.
        let recording = journal.as_ref().map(|recorder| {
            crate::journal::secret_scope::within(secret_scope.as_ref(), || {
                recorder.start(
                    &command.name,
                    command.secret,
                    secret_scope
                        .clone()
                        .or_else(crate::journal::secret_scope::current),
                    &input,
                    &mut context,
                    &context_fields.0,
                )
            })
        });

        #[cfg(feature = "native")]
        let deadline_signal = effective_timeout_ms.map(|_| match &context.cancellation {
            Some(parent) => parent.child(),
            None => crate::cancellation::CancellationSignal::new(),
        });
        #[cfg(feature = "native")]
        if let Some(signal) = &deadline_signal {
            context.cancellation = Some(signal.clone());
        }

        // `run_handler` and `chain(context)` run inside the guarded future, so a middleware
        // layer that panics while building its future is caught too. With no middleware the
        // handler takes the validated input itself, without a copy.
        let chain_scope = secret_scope.clone();
        let finish_scope = secret_scope.clone();
        let run = crate::journal::secret_scope::scoped(
            secret_scope,
            run_guarded(async move {
                if middleware.layers.is_empty() {
                    run_handler(command, input, context, check_output_budget).await
                } else {
                    let state = CallState::of(&context);
                    let chain = middleware_chain(
                        &command,
                        &middleware.layers,
                        Arc::new(input),
                        state,
                        check_output_budget,
                        chain_scope,
                    );
                    chain(context).await
                }
            }),
        );

        // The deadline covers the chain only: a slow journal append cannot turn a finished call
        // into a TIMEOUT, and a call that timed out is not recorded.
        let result = match effective_timeout_ms {
            #[cfg(feature = "native")]
            Some(timeout_ms) => {
                match tokio::time::timeout(Duration::from_millis(timeout_ms), run).await {
                    Ok(result) => result,
                    Err(_) => {
                        if let Some(signal) = &deadline_signal {
                            signal.cancel();
                        }
                        return failure(command_timeout_error(name, timeout_ms));
                    }
                }
            }
            _ => run.await,
        };
        match (journal, recording) {
            (Some(recorder), Some(recording)) => {
                crate::journal::secret_scope::scoped(
                    finish_scope,
                    recorder.finish(recording, result),
                )
                .await
            }
            _ => result,
        }
    }

    /// `input` validated against `command`'s schema, defaults applied, exactly as
    /// [`CommandRegistry::execute`] validates it before the middleware: the MCP server's
    /// host-verified gate validates with it before asking anyone, so the person decides on the
    /// input that runs. A host asking a person through a channel of its own (a terminal that
    /// waits for a decision made elsewhere) validates with it too, so that
    /// [`crate::input_digest`] of the result names what will run.
    ///
    /// # Errors
    /// `VALIDATION_ERROR`, as [`CommandRegistry::execute`] answers it.
    pub fn validate(
        &self,
        command: &CommandDefinition,
        input: serde_json::Value,
    ) -> Result<serde_json::Value, Box<CommandError>> {
        let max_issues = self.max_validation_issues();
        let validator = read_lock(&self.commands)
            .validators
            .get(&command.name)
            .cloned();
        match validator {
            Some(validator) => validator.execute_with_limit(input, max_issues),
            None => {
                let schema = crate::schema_validation::parameters_to_schema(&command.parameters)
                    .map_err(|error| {
                        Box::new(CommandError::validation(
                            &error,
                            Some("Fix the command's parameter schema before validating input"),
                        ))
                    })?;
                let compiled = crate::schema_validation::CompiledSchema::compile(&schema).map_err(
                    |error| {
                        Box::new(CommandError::validation(
                            &error,
                            Some("Fix the command's parameter schema before validating input"),
                        ))
                    },
                )?;
                compiled.execute_with_limit(input, max_issues)
            }
        }
    }

    /// Execute multiple commands in a batch with a default context.
    ///
    /// See [`CommandRegistry::execute_batch_with_context`].
    pub async fn execute_batch(
        &self,
        request: BatchRequest<serde_json::Value>,
    ) -> BatchResult<serde_json::Value> {
        self.execute_batch_with_context(request, CommandContext::new())
            .await
    }

    /// Execute multiple commands in a batch.
    ///
    /// Uses partial success semantics, as in TypeScript: every command runs
    /// unless `stopOnError` is set, and [`BatchResult::success`] is `true`
    /// whenever the batch itself ran. It is `false` only for an invalid
    /// request: no commands, a blank command name, a negative or non-finite
    /// `timeout`, or a zero `parallelism` or `maxFailures` return
    /// `INVALID_BATCH_REQUEST` with TypeScript's message, `Invalid batch
    /// request envelope`, before any command runs. A handler that panics
    /// produces a `COMMAND_EXECUTION_ERROR` result for its own command (see
    /// [`CommandRegistry::execute`]); the other results are kept.
    ///
    /// Every command runs through [`CommandRegistry::execute`] with a copy of
    /// `context` (so exposure checks, validation, the timeout and middleware
    /// apply to each) and a per-command trace ID, `<batch trace ID>-<index>`.
    /// The batch trace ID is `context.trace_id`, or `batch-<timestamp>`.
    /// The request's `context` entries are added to each command's
    /// [`CommandContext::extra`], without replacing keys the caller set; they
    /// never change the trace ID, interface or timeout. With
    /// [`CommandInterface::Apps`] they are dropped: an app's batch is the app's,
    /// and only the host's own context may say who called.
    pub async fn execute_batch_with_context(
        &self,
        request: BatchRequest<serde_json::Value>,
        context: CommandContext,
    ) -> BatchResult<serde_json::Value> {
        let start_time = Instant::now();
        let started_at = chrono::Utc::now().to_rfc3339();
        let options = request.options.clone().unwrap_or_default();
        if request.commands.is_empty()
            || request
                .commands
                .iter()
                .any(|command| crate::wire::is_blank(&command.command))
            || options
                .timeout
                .is_some_and(|timeout| !timeout.is_finite() || timeout < 0.0)
            || options.parallelism == Some(0)
            || options.max_failures == Some(0)
        {
            // TypeScript's error. The suggestion also names maxFailures, a Rust extension.
            return create_failed_batch_result(
                CommandError::new(error_codes::INVALID_BATCH_REQUEST, "Invalid batch request envelope")
                    .with_suggestion(
                        "Provide at least one command with a nonempty command name and optional string ID, and valid boolean stopOnError, nonnegative timeout, and positive integer parallelism and maxFailures options",
                    )
                    .with_retryable(false),
                &started_at,
            );
        }
        if let Some(limit_error) = self.check_batch_limits(&request) {
            return create_failed_batch_result(limit_error, &started_at);
        }
        #[cfg(not(feature = "native"))]
        if options.timeout.is_some() {
            return create_failed_batch_result(
                CommandError::new(
                    error_codes::UNSUPPORTED_OPTION,
                    "Batch deadlines require the native feature",
                )
                .with_suggestion("Enable the native feature or omit timeout")
                .with_retryable(false),
                &started_at,
            );
        }
        let parallelism = options.parallelism.unwrap_or(1);

        let batch_trace_id = context
            .trace_id
            .clone()
            .unwrap_or_else(|| format!("batch-{}", chrono::Utc::now().timestamp_millis()));
        let mut base_context = context;
        // An app's batch comes from the app: its own `context` must not reach the grant check,
        // which reads only what the host's trusted code set (`spec/command-metadata.md`,
        // "App-to-app calls").
        if base_context.interface != Some(CommandInterface::Apps) {
            for (key, value) in request.context.into_iter().flatten() {
                base_context.extra.entry(key).or_insert(value);
            }
        }
        let total_commands = request.commands.len();
        let command_metadata: Vec<_> = request
            .commands
            .iter()
            .enumerate()
            .map(|(index, command)| {
                (
                    command.id.clone().unwrap_or_else(|| format!("cmd-{index}")),
                    command.command.clone(),
                )
            })
            .collect();
        let timeout_error = || {
            CommandError::new(
                error_codes::BATCH_TIMEOUT,
                format!(
                    "Batch timeout exceeded ({}ms)",
                    options.timeout.unwrap_or(0.0)
                ),
            )
            .with_suggestion("Increase timeout or reduce the number of batch commands")
            .with_retryable(true)
        };
        let stop_on_error = options.stops_on_error();
        let max_failures = options.max_failures;
        let deadline = options
            .timeout
            .and_then(|timeout| deadline_after(start_time, timeout));
        let caller_cancellation = base_context.cancellation.clone();
        #[cfg(feature = "native")]
        let batch_deadline_signal = deadline.map(|_| match &caller_cancellation {
            Some(parent) => parent.child(),
            None => crate::cancellation::CancellationSignal::new(),
        });
        #[cfg(feature = "native")]
        if let Some(signal) = &batch_deadline_signal {
            base_context.cancellation = Some(signal.clone());
        }
        let caller_cancelled = || {
            caller_cancellation
                .as_ref()
                .is_some_and(crate::cancellation::CancellationSignal::is_cancelled)
        };
        let mut pending = request.commands.into_iter().enumerate();
        let mut active: FuturesUnordered<BatchExecutionFuture<'_>> = FuturesUnordered::new();
        let mut results: Vec<Option<BatchCommandResult<serde_json::Value>>> =
            (0..total_commands).map(|_| None).collect();
        let mut failures = 0usize;
        let mut stopped = false;
        let mut timed_out = false;

        loop {
            while !stopped && !caller_cancelled() && active.len() < parallelism {
                let Some((index, cmd)) = pending.next() else {
                    break;
                };
                let (id, command_name) = command_metadata[index].clone();
                let context = base_context
                    .clone()
                    .with_trace_id(format!("{batch_trace_id}-{index}"));
                let timeout_error = &timeout_error;
                #[cfg(feature = "native")]
                let batch_deadline_signal = batch_deadline_signal.clone();
                active.push(Box::pin(async move {
                    let command_start = Instant::now();
                    let name = command_name.clone();
                    let execution = self.execute(&name, cmd.input, Some(context));
                    let result = match deadline {
                        None => Some(execution.await),
                        Some(deadline) => {
                            let remaining = deadline.saturating_duration_since(Instant::now());
                            if remaining.is_zero() {
                                #[cfg(feature = "native")]
                                if let Some(signal) = &batch_deadline_signal {
                                    signal.cancel();
                                }
                                None
                            } else {
                                #[cfg(feature = "native")]
                                {
                                    match tokio::time::timeout(remaining, execution).await {
                                        Ok(result) => Some(result),
                                        Err(_) => {
                                            if let Some(signal) = &batch_deadline_signal {
                                                signal.cancel();
                                            }
                                            None
                                        }
                                    }
                                }
                                // Unreachable: deadlines are rejected above without `native`.
                                #[cfg(not(feature = "native"))]
                                {
                                    Some(execution.await)
                                }
                            }
                        }
                    };
                    let result = result.unwrap_or_else(|| failure(timeout_error()));
                    (
                        index,
                        BatchCommandResult::new(id, index, command_name, result)
                            .with_duration(elapsed_ms(command_start)),
                    )
                }));
            }

            let Some((index, command_result)) = active.next().await else {
                break;
            };
            if !command_result.result.success {
                failures += 1;
                timed_out |= command_result
                    .result
                    .error
                    .as_ref()
                    .is_some_and(|error| error.code == error_codes::BATCH_TIMEOUT);
                stopped = timed_out
                    || stop_on_error
                    || max_failures.is_some_and(|maximum| failures >= maximum);
            }
            results[index] = Some(command_result);
        }

        let results: Vec<_> = results
            .into_iter()
            .enumerate()
            .map(|(index, result)| {
                result.unwrap_or_else(|| {
                    let (id, command) = command_metadata[index].clone();
                    let error = if timed_out {
                        timeout_error()
                    } else if caller_cancelled() {
                        CommandError::new(
                            error_codes::COMMAND_CANCELLED,
                            "Command cancelled before starting",
                        )
                        .with_suggestion("Start the command again if the result is still needed")
                        .with_retryable(false)
                    } else {
                        CommandError::new(
                            error_codes::COMMAND_SKIPPED,
                            "Command skipped because batch execution stopped after a failure",
                        )
                        .with_suggestion("Disable stopOnError to execute every command")
                    };
                    BatchCommandResult::new(id, index, command, failure(error))
                })
            })
            .collect();

        let total_ms = elapsed_ms(start_time);
        let average_ms = (total_ms / results.len() as f64 * 100.0).round() / 100.0;
        create_batch_result(
            results,
            BatchTiming::new(
                started_at.clone(),
                chrono::Utc::now().to_rfc3339(),
                total_ms,
                average_ms,
            ),
            Some(ResultMetadata::new().with_trace_id(batch_trace_id)),
        )
    }
}

// EXECUTION HELPERS

/// Standard `COMMAND_CANCELLED` error (`spec/execution-controls.md`).
pub(crate) fn command_cancelled_error(name: &str) -> CommandError {
    CommandError::new(
        error_codes::COMMAND_CANCELLED,
        format!(
            "Command '{}' was cancelled before it started",
            truncate_name(name)
        ),
    )
    .with_suggestion("Retry with a fresh signal if the command is still needed.")
    .with_retryable(false)
}

/// Standard `TIMEOUT` error (`spec/execution-controls.md`).
#[cfg(feature = "native")]
fn command_timeout_error(name: &str, timeout_ms: u64) -> CommandError {
    let mut details = HashMap::new();
    details.insert("command".to_string(), serde_json::json!(name));
    details.insert("timeoutMs".to_string(), serde_json::json!(timeout_ms));
    CommandError::new(
        error_codes::TIMEOUT,
        format!("Command '{}' timed out after {}ms", truncate_name(name), timeout_ms),
    )
    .with_suggestion(
        "Retry with a larger timeout. The command was signalled to abort but may have completed, so check its effect before retrying a mutation.",
    )
    .with_retryable(true)
    .with_details(details)
}

/// Longest command name (in UTF-16 code units) echoed back in an error, as in
/// TypeScript.
const MAX_ECHOED_NAME_LENGTH: usize = crate::similarity::MAX_SIMILARITY_INPUT_LENGTH;

/// `name` cut to [`MAX_ECHOED_NAME_LENGTH`] UTF-16 code units, with `…` when
/// cut, as TypeScript's `truncateName` does. A character that would straddle
/// the cut (a surrogate pair) is left out whole.
pub(crate) fn truncate_name(name: &str) -> String {
    let mut length = 0;
    for (end, character) in name.char_indices() {
        length += character.len_utf16();
        if length > MAX_ECHOED_NAME_LENGTH {
            return format!("{}…", &name[..end]);
        }
    }
    name.to_string()
}

/// How many close matches a `COMMAND_NOT_FOUND` suggestion names at most, as in TypeScript.
const MAX_NOT_FOUND_MATCHES: usize = 3;

/// The bootstrap command that lists the commands a caller can call.
const HELP_COMMAND: &str = "afd-help";

/// The `COMMAND_NOT_FOUND` answer for an unknown command name at lookup: a call, `afd-call`, a
/// batch item or a pipeline step. Its suggestion and its recovery (`spec/recovery.md`, "Engine
/// errors") come from the one decision [`list_pointer`] makes, so they name the same command:
/// `afd-discover` for a remote MCP caller, `afd-help` when `callable` holds it, and otherwise
/// none.
pub(crate) fn command_not_found(name: &str, callable: &[String], remote: bool) -> CommandError {
    let error = CommandError::new(
        error_codes::COMMAND_NOT_FOUND,
        format!("Command '{}' not found", truncate_name(name)),
    )
    .with_suggestion(not_found_suggestion(name, callable, remote))
    .with_retryable(false);
    match list_pointer(callable, remote) {
        Some(command) => error.with_recovery(crate::errors::Recovery::engine_call(command, false)),
        None => error,
    }
}

/// The command an unknown name's caller can call to list the commands: `afd-discover`, which
/// the MCP server routes in every tool strategy to every caller it answers, or `afd-help` when
/// the caller can call it, or none.
fn list_pointer(callable: &[String], remote: bool) -> Option<&'static str> {
    if remote {
        Some(DISCOVER_COMMAND)
    } else if callable.iter().any(|candidate| candidate == HELP_COMMAND) {
        Some(HELP_COMMAND)
    } else {
        None
    }
}

/// The meta-tool that lists the commands of an MCP server.
const DISCOVER_COMMAND: &str = "afd-discover";

/// Recovery guidance for an unknown command name, as in TypeScript's
/// `notFoundSuggestion`: at most [`MAX_NOT_FOUND_MATCHES`] close matches
/// (bounded fuzzy matching; none for very long names), never the whole list,
/// and a pointer to `afd-help`.
///
/// TypeScript points to `afd-discover`, which its server always routes. Here
/// the pointer is `afd-help`, and only when `callable` contains it: it exists
/// only after [`register_bootstrap_commands`](crate::bootstrap::register_bootstrap_commands),
/// and is not exposed to every interface.
///
/// `name` is untrusted and never echoed; `callable` holds the names the caller
/// may call, in registration order (ties keep that order, as in TypeScript).
pub(crate) fn not_found_suggestion(name: &str, callable: &[String], remote: bool) -> String {
    let list = match list_pointer(callable, remote) {
        Some(DISCOVER_COMMAND) => "Use afd-discover to list all commands.",
        Some(_) => "Use afd-help to list all commands.",
        None => "Check the command name against the available commands.",
    };
    let mut matches =
        crate::similarity::find_similar_tools(name, callable, Some(MAX_NOT_FOUND_MATCHES))
            .into_iter();
    let Some(best) = matches.next() else {
        return list.to_string();
    };
    let others: Vec<String> = matches.map(|other| format!("'{other}'")).collect();
    let also_close = if others.is_empty() {
        String::new()
    } else {
        format!(" Other close matches: {}.", others.join(", "))
    };
    format!("Did you mean '{best}'?{also_close} {list}")
}

/// Milliseconds since `start`, rounded to two decimals as in TypeScript.
pub(crate) fn elapsed_ms(start: Instant) -> f64 {
    (start.elapsed().as_secs_f64() * 100_000.0).round() / 100.0
}

/// The instant `timeout_ms` after `start`, or `None` when it is too far away
/// to represent (effectively no deadline).
pub(crate) fn deadline_after(start: Instant, timeout_ms: f64) -> Option<Instant> {
    Duration::try_from_secs_f64(timeout_ms / 1000.0)
        .ok()
        .and_then(|timeout| start.checked_add(timeout))
}

/// The result reported in place of one when a command handler panics: the
/// redacted `COMMAND_EXECUTION_ERROR`. The panic payload is not included, as
/// it may contain internal details.
pub(crate) fn handler_panic_failure() -> CommandResult<serde_json::Value> {
    execution_failure("The command handler panicked", false)
}

/// Run a command future, turning a panic into a `COMMAND_EXECUTION_ERROR`
/// failure so one handler cannot abort its caller, a batch or a pipeline.
pub(crate) async fn run_guarded<F>(future: F) -> CommandResult<serde_json::Value>
where
    F: Future<Output = CommandResult<serde_json::Value>>,
{
    AssertUnwindSafe(future)
        .catch_unwind()
        .await
        .unwrap_or_else(|_| handler_panic_failure())
}

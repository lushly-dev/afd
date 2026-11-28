//! The pipeline executor: [`execute_pipeline`] and [`execute_pipeline_with_cancellation`].

#[allow(clippy::wildcard_imports)]
use super::*;
use crate::cancellation::CancellationSignal;

/// Check the request before any step runs. Returns the index of the step to
/// blame and the error.
fn preflight(
    request: &PipelineRequest,
    options: &PipelineOptions,
) -> Option<(usize, CommandError)> {
    if options.parallel == Some(true) {
        return Some((
            0,
            pipeline_error(
                error_codes::UNSUPPORTED_OPTION,
                "Parallel pipeline execution is not supported".to_string(),
                "Remove parallel or set it to false to execute steps sequentially",
                false,
            ),
        ));
    }
    if let Some(index) = request
        .steps
        .iter()
        .position(|step| step.stream == Some(true))
    {
        return Some((
            index,
            pipeline_error(
                error_codes::UNSUPPORTED_OPTION,
                format!(
                    "Streaming pipeline steps are not supported (step {index} sets stream: true)"
                ),
                "Remove stream or set it to false; to stream one command, use the /stream endpoint",
                false,
            ),
        ));
    }
    if let Some(timeout_ms) = options.timeout_ms {
        if !timeout_ms.is_finite() || timeout_ms < 0.0 {
            return Some((
                0,
                pipeline_error(
                    error_codes::VALIDATION_ERROR,
                    "timeoutMs must be a non-negative number".to_string(),
                    "Set timeoutMs to a non-negative number of milliseconds or omit it",
                    false,
                ),
            ));
        }
        if !cfg!(feature = "native") {
            return Some((
                0,
                pipeline_error(
                    error_codes::UNSUPPORTED_OPTION,
                    "Pipeline deadlines require the native feature".to_string(),
                    "Enable the native feature or omit timeoutMs",
                    false,
                ),
            ));
        }
    }
    let too_deep = |field: String, index: usize| {
        let mut details = HashMap::new();
        details.insert("maxDepth".to_string(), serde_json::json!(MAX_INPUT_DEPTH));
        details.insert("field".to_string(), serde_json::json!(field));
        (
            index,
            pipeline_error(
                error_codes::VALIDATION_ERROR,
                format!("{field} is nested deeper than {MAX_INPUT_DEPTH} levels"),
                "Flatten the input; nesting is limited to 64 levels",
                false,
            )
            .with_details(details),
        )
    };
    if request
        .input
        .as_ref()
        .is_some_and(|input| exceeds_depth(input, MAX_INPUT_DEPTH))
    {
        return Some(too_deep("input".to_string(), 0));
    }
    request
        .steps
        .iter()
        .position(|step| {
            step.input
                .as_ref()
                .is_some_and(|input| exceeds_depth(input, MAX_INPUT_DEPTH))
        })
        .map(|index| too_deep(format!("steps[{index}].input"), index))
}

fn empty_metadata(total_steps: usize) -> PipelineMetadata {
    PipelineMetadata {
        confidence: 0.0,
        total_steps,
        ..PipelineMetadata::default()
    }
}

/// Run a step's executor, turning a panic (while creating or polling the
/// future) into a `COMMAND_EXECUTION_ERROR` failure.
async fn run_step(
    execute: &CommandExecutor,
    command: String,
    input: serde_json::Value,
    context: HashMap<String, serde_json::Value>,
) -> CommandResult<serde_json::Value> {
    match std::panic::catch_unwind(AssertUnwindSafe(|| execute(command, input, context))) {
        Ok(execution) => crate::commands::run_guarded(execution).await,
        Err(_) => crate::commands::handler_panic_failure(),
    }
}

/// Execute a pipeline of chained commands with variable resolution.
///
/// `context` is passed to every command invocation (with a per-step
/// `traceId` and `stepIndex`, the step's 0-based index); it is never visible to `$input` references, which read
/// [`PipelineRequest::input`] only.
pub async fn execute_pipeline(
    request: &PipelineRequest,
    execute: &CommandExecutor,
    context: Option<HashMap<String, serde_json::Value>>,
) -> PipelineResult<serde_json::Value> {
    execute_pipeline_with_cancellation(request, execute, context, None).await
}

/// [`execute_pipeline`] with a cancellation signal (`spec/execution-controls.md`):
///
/// - Before each step starts, including the first, a fired `cancellation`
///   skips that step and every later one with `COMMAND_CANCELLED`.
/// - When the pipeline's deadline ([`PipelineOptions::timeout_ms`]) passes,
///   `cancellation` is fired, so a step still running then, and work it
///   spawned, can stop.
///
/// The executor does not receive the signal: the caller gives each step's
/// command `cancellation` (or a child of it) in the context its `execute`
/// builds. Pass a child of the caller's own signal when there is a deadline,
/// so the deadline never fires the caller's; the MCP server's `afd-pipe` does.
pub async fn execute_pipeline_with_cancellation(
    request: &PipelineRequest,
    execute: &CommandExecutor,
    context: Option<HashMap<String, serde_json::Value>>,
    cancellation: Option<crate::cancellation::CancellationSignal>,
) -> PipelineResult<serde_json::Value> {
    let fire = || {
        if let Some(signal) = &cancellation {
            signal.cancel();
        }
    };
    let start_time = Instant::now();
    let pipeline_id = request
        .id
        .clone()
        .unwrap_or_else(|| format!("pipeline-{}", chrono::Utc::now().timestamp_millis()));

    if request.steps.is_empty() {
        return PipelineResult {
            data: None,
            metadata: empty_metadata(0),
            steps: vec![],
        };
    }

    let options = request.options.clone().unwrap_or_default();
    let base_context = context.unwrap_or_default();

    if let Some((failed_index, error)) = preflight(request, &options) {
        let steps = request
            .steps
            .iter()
            .enumerate()
            .map(|(i, step)| {
                let mut result = StepResult::new(
                    i,
                    step.command.clone(),
                    if i == failed_index {
                        StepStatus::Failure
                    } else {
                        StepStatus::Skipped
                    },
                );
                result.alias = step.alias.clone();
                result.error = (i == failed_index).then(|| error.clone());
                result
            })
            .collect();
        return PipelineResult {
            data: None,
            metadata: empty_metadata(request.steps.len()),
            steps,
        };
    }

    let deadline = options
        .timeout_ms
        .and_then(|timeout_ms| deadline_after(start_time, timeout_ms));
    let timeout_error = || {
        pipeline_error(
            error_codes::PIPELINE_TIMEOUT,
            format!(
                "Pipeline timeout exceeded ({}ms)",
                options.timeout_ms.unwrap_or(0.0)
            ),
            "Increase timeoutMs or reduce the number of pipeline steps",
            true,
        )
    };

    let mut pipeline_context = PipelineContext::new(request.input.clone());
    let skip_from = |context: &mut PipelineContext, first: usize, error: Option<CommandError>| {
        for (j, remaining_step) in request.steps.iter().enumerate().skip(first) {
            let mut skipped =
                StepResult::new(j, remaining_step.command.clone(), StepStatus::Skipped);
            skipped.alias = remaining_step.alias.clone();
            skipped.error = error.clone();
            context.push_step(skipped);
        }
    };

    for (i, step) in request.steps.iter().enumerate() {
        if cancellation
            .as_ref()
            .is_some_and(CancellationSignal::is_cancelled)
        {
            let error = crate::commands::command_cancelled_error(&step.command);
            skip_from(&mut pipeline_context, i, Some(error));
            break;
        }
        let step_start = Instant::now();
        let mut step_result = StepResult::new(i, step.command.clone(), StepStatus::Skipped);
        step_result.alias = step.alias.clone();

        if let Some(condition) = &step.when {
            if !evaluate_condition(condition, &pipeline_context) {
                pipeline_context.push_step(step_result);
                continue;
            }
        }

        // As in TypeScript, a step that would start at or past the deadline
        // fails with PIPELINE_TIMEOUT without running (`None` below).
        // A step input over the limits fails the step without running it, as in TypeScript,
        // where this failure comes before the deadline check.
        let resolved_input = step
            .input
            .as_ref()
            .map(|input| try_resolve_variables(input, &pipeline_context))
            .transpose();
        // As in TypeScript, the time left is measured once the input is resolved.
        let remaining = deadline.map(|deadline| deadline.saturating_duration_since(Instant::now()));
        let result = if let Err(error) = resolved_input {
            Some(resolution_limit_failure(error, i))
        } else if remaining.is_some_and(|remaining| remaining.is_zero()) {
            None
        } else {
            let resolved_input = resolved_input
                .ok()
                .flatten()
                .unwrap_or_else(|| serde_json::json!({}));

            let mut step_context = base_context.clone();
            step_context.insert(
                "traceId".to_string(),
                serde_json::json!(format!("{pipeline_id}-step-{i}")),
            );
            // The step's 0-based index, which an executor that runs it through the registry needs
            // for the step's derived idempotency key (`spec/idempotency.md`, K4).
            step_context.insert("stepIndex".to_string(), serde_json::json!(i));

            let execution = run_step(execute, step.command.clone(), resolved_input, step_context);
            match remaining {
                None => Some(execution.await),
                #[cfg(feature = "native")]
                Some(remaining) => tokio::time::timeout(remaining, execution).await.ok(),
                // Unreachable: preflight rejects deadlines without `native`.
                #[cfg(not(feature = "native"))]
                Some(_) => Some(execution.await),
            }
        };
        step_result.execution_time_ms = elapsed_ms(step_start);

        let Some(result) = result else {
            fire();
            let error = timeout_error();
            step_result.status = StepStatus::Failure;
            step_result.error = Some(error.clone());
            pipeline_context.push_step(step_result);
            skip_from(&mut pipeline_context, i + 1, Some(error));
            break;
        };

        if result.success {
            step_result.status = StepStatus::Success;
            step_result.metadata = Some(StepMetadata::from_result(&result));
            step_result.data = result.data;
            pipeline_context.push_step(step_result);
        } else {
            step_result.status = StepStatus::Failure;
            step_result.error = result.error;
            pipeline_context.push_step(step_result);

            if options.continue_on_failure != Some(true) {
                skip_from(&mut pipeline_context, i + 1, None);
                break;
            }
        }

        // As in TypeScript, a step that ends past the deadline skips every
        // later step with PIPELINE_TIMEOUT; after the last step it changes nothing.
        let more = i + 1 < request.steps.len();
        if more && deadline.is_some_and(|deadline| Instant::now() > deadline) {
            fire();
            skip_from(&mut pipeline_context, i + 1, Some(timeout_error()));
            break;
        }
    }

    let step_results = pipeline_context.steps;
    let data = step_results
        .iter()
        .rev()
        .find(|step| step.status == StepStatus::Success)
        .and_then(|step| step.data.clone());

    PipelineResult {
        data,
        metadata: PipelineMetadata {
            confidence: aggregate_pipeline_confidence(&step_results),
            confidence_breakdown: build_confidence_breakdown(&step_results, Some(&request.steps)),
            reasoning: aggregate_pipeline_reasoning(&step_results),
            warnings: aggregate_pipeline_warnings(&step_results),
            sources: aggregate_pipeline_sources(&step_results),
            alternatives: aggregate_pipeline_alternatives(&step_results),
            execution_time_ms: elapsed_ms(start_time),
            completed_steps: step_results
                .iter()
                .filter(|step| step.status == StepStatus::Success)
                .count(),
            total_steps: request.steps.len(),
            ..PipelineMetadata::default()
        },
        steps: step_results,
    }
}

# Agent-Safe Error Recovery

Error handling patterns for AI agent workflows: graceful degradation, fallback chains, compensation patterns, and strategies for when agents encounter errors.

## The Agent Error Problem

AI agents face unique error challenges:

1. **Non-deterministic execution** -- The same prompt can produce different actions, so error paths are unpredictable
2. **Multi-step operations** -- Agents often perform sequences of actions where partial completion leaves inconsistent state
3. **Tool call failures** -- External tools may fail, return unexpected formats, or timeout
4. **Context window limits** -- Agents may lose error context if conversation history is truncated
5. **Error amplification** -- An agent retrying a failing operation can cause cascading failures
6. **Silent failures** -- Agents may proceed with incorrect data rather than recognizing an error occurred

## Error Recovery Strategies

### Strategy 1: Classify and Route

Every error an agent encounters should be classified and routed to the appropriate recovery strategy:

```typescript
type AgentErrorStrategy =
  | { action: 'retry'; maxAttempts: number; backoff: 'exponential' }
  | { action: 'fallback'; alternatives: string[] }
  | { action: 'compensate'; undoSteps: string[] }
  | { action: 'degrade'; reducedCapability: string }
  | { action: 'escalate'; reason: string; context: Record<string, unknown> }
  | { action: 'abort'; cleanup: string[] };

function classifyAgentError(error: AppError): AgentErrorStrategy {
  // Transient infrastructure errors: retry
  if (error.retryable && error.severity !== 'fatal') {
    return { action: 'retry', maxAttempts: 3, backoff: 'exponential' };
  }

  // Tool not available: try alternative tool
  if (error.code === 'TOOL_UNAVAILABLE') {
    return {
      action: 'fallback',
      alternatives: getAlternativeTools(error.context.toolName as string),
    };
  }

  // Rate limited: slow down
  if (error.code === 'RATE_LIMITED') {
    return {
      action: 'degrade',
      reducedCapability: 'Reducing request rate. Results may be slower.',
    };
  }

  // Auth failure: cannot self-resolve
  if (error.code === 'FORBIDDEN' || error.code === 'UNAUTHORIZED') {
    return {
      action: 'escalate',
      reason: `Authentication/authorization failure: ${error.message}`,
      context: error.context,
    };
  }

  // Multi-step operation failed mid-way: compensate
  if (error.context.completedSteps) {
    return {
      action: 'compensate',
      undoSteps: getCompensationSteps(error.context.completedSteps as string[]),
    };
  }

  // Unknown or fatal: abort safely
  return {
    action: 'abort',
    cleanup: ['log_full_context', 'notify_human'],
  };
}
```

### Strategy 2: Retry with Awareness

Agent retries must be smarter than simple exponential backoff:

```typescript
interface AgentRetryContext {
  operationId: string;
  attemptNumber: number;
  maxAttempts: number;
  previousErrors: Array<{ code: string; message: string; timestamp: Date }>;
  isIdempotent: boolean;
}

async function agentRetryWithAwareness<T>(
  operation: (ctx: AgentRetryContext) => Promise<T>,
  config: {
    operationId: string;
    maxAttempts: number;
    isIdempotent: boolean;
    onGiveUp: (errors: AgentRetryContext['previousErrors']) => Promise<void>;
  }
): Promise<T> {
  const ctx: AgentRetryContext = {
    operationId: config.operationId,
    attemptNumber: 0,
    maxAttempts: config.maxAttempts,
    previousErrors: [],
    isIdempotent: config.isIdempotent,
  };

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    ctx.attemptNumber = attempt;

    try {
      return await operation(ctx);
    } catch (error) {
      const appError = error instanceof AppError ? error : toAppError(error);
      ctx.previousErrors.push({
        code: appError.code,
        message: appError.message,
        timestamp: new Date(),
      });

      // If the same error repeats, do not keep retrying the same way
      if (isSameErrorRepeating(ctx.previousErrors)) {
        logger.warn('Agent detected repeating error pattern, escalating', {
          operationId: config.operationId,
          errorPattern: ctx.previousErrors.map(e => e.code),
        });
        break;
      }

      // Non-idempotent operations should not be retried blindly
      if (!config.isIdempotent && attempt > 1) {
        logger.warn('Non-idempotent operation failed, checking state before retry', {
          operationId: config.operationId,
        });
        // Agent should verify the operation's effect before retrying
      }

      if (attempt < config.maxAttempts && appError.retryable) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 15000);
        await new Promise(r => setTimeout(r, delay * (0.5 + Math.random())));
        continue;
      }

      break;
    }
  }

  // All retries exhausted
  await config.onGiveUp(ctx.previousErrors);
  throw new AgentOperationError(
    `Operation ${config.operationId} failed after ${config.maxAttempts} attempts`,
    ctx.previousErrors
  );
}

function isSameErrorRepeating(errors: Array<{ code: string }>): boolean {
  if (errors.length < 3) return false;
  const lastThree = errors.slice(-3);
  return lastThree.every(e => e.code === lastThree[0].code);
}
```

### Strategy 3: Compensation (Saga Pattern)

When a multi-step agent operation fails partway through, undo completed steps:

```typescript
interface SagaStep<T> {
  name: string;
  execute: () => Promise<T>;
  compensate: (result: T) => Promise<void>;
}

class AgentSaga {
  private completedSteps: Array<{ name: string; result: unknown; compensate: (r: unknown) => Promise<void> }> = [];

  async execute(steps: SagaStep<unknown>[]): Promise<unknown[]> {
    const results: unknown[] = [];

    for (const step of steps) {
      try {
        const result = await step.execute();
        this.completedSteps.push({
          name: step.name,
          result,
          compensate: step.compensate as (r: unknown) => Promise<void>,
        });
        results.push(result);
      } catch (error) {
        logger.error('Saga step failed, initiating compensation', {
          failedStep: step.name,
          completedSteps: this.completedSteps.map(s => s.name),
          error: error instanceof AppError ? error.toJSON() : String(error),
        });

        // Compensate in reverse order
        await this.compensate();

        throw new SagaFailedError(
          `Saga failed at step '${step.name}'`,
          {
            failedStep: step.name,
            completedSteps: this.completedSteps.map(s => s.name),
            cause: toError(error),
          }
        );
      }
    }

    return results;
  }

  private async compensate(): Promise<void> {
    const errors: Error[] = [];

    // Compensate in reverse order
    for (const step of [...this.completedSteps].reverse()) {
      try {
        await step.compensate(step.result);
        logger.info('Compensation successful', { step: step.name });
      } catch (compError) {
        // Compensation failure is critical -- requires human intervention
        logger.fatal('Compensation failed', {
          step: step.name,
          error: String(compError),
        });
        errors.push(toError(compError));
      }
    }

    if (errors.length > 0) {
      throw new CompensationFailedError(
        `${errors.length} compensation steps failed -- manual intervention required`,
        errors
      );
    }
  }
}

// Usage
const saga = new AgentSaga();
await saga.execute([
  {
    name: 'create-user',
    execute: () => userService.create(userData),
    compensate: (user) => userService.delete(user.id),
  },
  {
    name: 'provision-resources',
    execute: () => resourceService.provision(userId),
    compensate: (resources) => resourceService.deprovision(resources.id),
  },
  {
    name: 'send-welcome-email',
    execute: () => emailService.sendWelcome(userId),
    compensate: () => Promise.resolve(), // Email cannot be unsent
  },
]);
```

### Strategy 4: Graceful Degradation

When a capability is unavailable, reduce functionality rather than failing completely:

```typescript
interface DegradedResult<T> {
  data: T;
  degraded: boolean;
  degradationReason?: string;
  missingCapabilities?: string[];
}

async function withGracefulDegradation<T>(
  primary: () => Promise<T>,
  fallbacks: Array<{
    name: string;
    fn: () => Promise<T>;
    degradationMessage: string;
  }>,
  defaultValue?: T
): Promise<DegradedResult<T>> {
  // Try primary
  try {
    return { data: await primary(), degraded: false };
  } catch (primaryError) {
    logger.warn('Primary operation failed, trying fallbacks', {
      error: getErrorCode(primaryError),
    });
  }

  // Try fallbacks in order
  for (const fallback of fallbacks) {
    try {
      const data = await fallback.fn();
      return {
        data,
        degraded: true,
        degradationReason: fallback.degradationMessage,
        missingCapabilities: [fallback.name],
      };
    } catch {
      logger.warn(`Fallback '${fallback.name}' failed`);
    }
  }

  // Use default if available
  if (defaultValue !== undefined) {
    return {
      data: defaultValue,
      degraded: true,
      degradationReason: 'All sources unavailable. Using default/cached value.',
      missingCapabilities: fallbacks.map(f => f.name),
    };
  }

  throw new AllFallbacksFailedError('All sources failed and no default available');
}
```

### Strategy 5: Escalation to Human

When an agent cannot resolve an error, it must escalate clearly:

```typescript
interface EscalationReport {
  summary: string;
  operationAttempted: string;
  errorChain: Array<{
    step: string;
    errorCode: string;
    errorMessage: string;
    timestamp: Date;
  }>;
  currentState: {
    completedActions: string[];
    pendingActions: string[];
    rollbackPerformed: boolean;
    dataConsistency: 'consistent' | 'inconsistent' | 'unknown';
  };
  suggestedActions: string[];
  context: Record<string, unknown>;
}

function buildEscalationReport(
  operation: string,
  errors: AppError[],
  completedSteps: string[],
  pendingSteps: string[],
  rolledBack: boolean
): EscalationReport {
  return {
    summary: `Agent failed to complete '${operation}' after ${errors.length} error(s).`,
    operationAttempted: operation,
    errorChain: errors.map((e, i) => ({
      step: `Attempt ${i + 1}`,
      errorCode: e.code,
      errorMessage: e.message,
      timestamp: e.timestamp,
    })),
    currentState: {
      completedActions: completedSteps,
      pendingActions: pendingSteps,
      rollbackPerformed: rolledBack,
      dataConsistency: rolledBack ? 'consistent' : 'unknown',
    },
    suggestedActions: inferSuggestedActions(errors),
    context: errors.reduce((acc, e) => ({ ...acc, ...e.context }), {}),
  };
}

function inferSuggestedActions(errors: AppError[]): string[] {
  const actions: string[] = [];
  const codes = new Set(errors.map(e => e.code));

  if (codes.has('UNAUTHORIZED') || codes.has('FORBIDDEN')) {
    actions.push('Check and update credentials or permissions');
  }
  if (codes.has('RATE_LIMITED')) {
    actions.push('Wait and retry, or request rate limit increase');
  }
  if (codes.has('EXTERNAL_SERVICE_ERROR')) {
    actions.push('Check external service status page');
  }
  if (codes.has('VALIDATION_ERROR')) {
    actions.push('Review input data for correctness');
  }

  actions.push('Review the error chain above for details');
  return actions;
}
```

## Python Agent Error Recovery

```python
from dataclasses import dataclass, field
from typing import Callable, Awaitable, Any


@dataclass
class AgentOperation:
    """Represents a recoverable agent operation."""
    name: str
    execute: Callable[[], Awaitable[Any]]
    compensate: Callable[[Any], Awaitable[None]] | None = None
    is_idempotent: bool = False
    max_retries: int = 3


async def execute_agent_pipeline(
    operations: list[AgentOperation],
    on_escalate: Callable[[EscalationReport], Awaitable[None]] | None = None,
) -> list[Any]:
    """Execute a pipeline of agent operations with recovery."""
    completed: list[tuple[AgentOperation, Any]] = []
    results: list[Any] = []

    for op in operations:
        try:
            result = await with_retry(
                op.execute,
                max_attempts=op.max_retries,
                retryable=lambda e: isinstance(e, AppError) and e.retryable,
            )
            completed.append((op, result))
            results.append(result)

        except Exception as e:
            logger.error(
                "Agent pipeline step failed",
                extra={
                    "failed_step": op.name,
                    "completed_steps": [c[0].name for c in completed],
                    "error": str(e),
                },
            )

            # Compensate completed steps in reverse
            compensation_errors = []
            for prev_op, prev_result in reversed(completed):
                if prev_op.compensate:
                    try:
                        await prev_op.compensate(prev_result)
                    except Exception as comp_err:
                        compensation_errors.append((prev_op.name, comp_err))

            # Escalate if compensation failed
            if compensation_errors and on_escalate:
                report = build_escalation_report(
                    operations, completed, op, e, compensation_errors
                )
                await on_escalate(report)

            raise AgentPipelineError(
                f"Pipeline failed at '{op.name}'",
                context={
                    "failed_step": op.name,
                    "completed_steps": [c[0].name for c in completed],
                    "compensation_errors": [
                        {"step": name, "error": str(err)}
                        for name, err in compensation_errors
                    ],
                },
                cause=e if isinstance(e, Exception) else None,
            )

    return results
```

## Agent Error Handling Checklist

### Before Starting an Operation

- [ ] Verify all required tools/services are available
- [ ] Check current rate limits and error budgets
- [ ] Confirm the operation is idempotent OR have a compensation plan
- [ ] Set a total timeout for the entire operation

### During Execution

- [ ] Log each step with operation ID and step number
- [ ] Track completed steps for potential rollback
- [ ] Monitor for repeating error patterns (same error 3+ times = escalate)
- [ ] Respect backoff and rate limit signals

### On Failure

- [ ] Classify the error (transient, correctable, permanent, fatal)
- [ ] If retryable: retry with backoff, log attempt count
- [ ] If multi-step: compensate completed steps in reverse order
- [ ] If unrecoverable: build escalation report with full context
- [ ] Never leave the system in an inconsistent state silently

### On Escalation to Human

- [ ] Summarize what was attempted and what failed
- [ ] List all errors in the chain with codes and messages
- [ ] Report current system state (what completed, what is pending)
- [ ] State whether rollback was performed and if it succeeded
- [ ] Suggest possible resolution actions
- [ ] Include trace IDs for log correlation

## Anti-Patterns

- **Infinite retry loops** -- Always set maximum retries and total timeout. Agents that retry forever waste resources and may amplify failures.
- **Silent error swallowing** -- An agent that catches an error and proceeds as if nothing happened will produce incorrect results.
- **Retrying non-idempotent operations blindly** -- May create duplicate records, charge twice, send duplicate emails. Always verify state before retrying.
- **Error context loss** -- Dropping error details between retry attempts. Each attempt should know what previous attempts encountered.
- **Escalation without context** -- "Something went wrong" is useless. Always include what was attempted, what failed, and what state the system is in.
- **Assuming tools are reliable** -- Every tool call can fail. Every external API can timeout. Design for failure as the default.
- **Agent self-correction loops** -- An agent that repeatedly tries to "fix" the same error differently can cause more damage. After 2-3 distinct fix attempts, escalate.

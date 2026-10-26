/**
 * @fileoverview The pre-execution approval policy a command declares (#272). The server's
 * `createApprovalMiddleware` enforces it; this module only holds the types and the
 * reporting rule, so it stays free of Node.js builtins.
 */

import type { CommandContext } from './commands.js';

/** Whether one call needs a human's approval before its handler runs. */
export type ApprovalDecision = 'not-required' | 'required';

/**
 * A command's approval policy: a fixed decision, or a function of the validated input and the
 * call context (for example, "agents need approval, humans do not"). Unset means
 * `'not-required'`. Enforced only where `createApprovalMiddleware` is installed.
 */
export type ApprovalPolicy<TInput = unknown> = ApprovalDecision | ApprovalPolicyFunction<TInput>;

/**
 * Declared as a method so its input is checked bivariantly: a definition spread into
 * `defineCommand` with another input schema still type-checks.
 */
type ApprovalPolicyFunction<TInput> = {
	policy(input: TInput, context: CommandContext): ApprovalDecision | Promise<ApprovalDecision>;
}['policy'];

/**
 * How a policy is reported in `_meta.approval` and `afd-detail`: a function cannot be
 * serialized, so it is reported as `'conditional'`. Undefined when no policy is declared.
 */
export function approvalMode(
	policy: ApprovalPolicy<never> | undefined
): ApprovalDecision | 'conditional' | undefined {
	if (typeof policy === 'function') return 'conditional';
	return policy === 'required' || policy === 'not-required' ? policy : undefined;
}

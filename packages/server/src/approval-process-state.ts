/**
 * @fileoverview What an approval middleware keeps or needs per process, marked on the middleware
 * itself under a registered symbol, so a server built from one installed copy of this package
 * reads it from a middleware made by another copy, and `composeMiddleware` carries its parts'.
 */

/**
 * Whether an approval middleware asks over MCP (so the server's `confirmationKey` signs its
 * state), and whether its single-use nonces are kept only in this instance's memory.
 */
export interface ApprovalProcessState {
	relay: boolean;
	perProcessNonces: boolean;
	perProcessRelayNonces?: boolean;
}

const MARK = Symbol.for('dev.afd/approval-process-state');

/** Mark `middleware` with what it keeps per process: non-writable, non-enumerable, permanent. */
export function markApprovalProcessState(middleware: object, state: ApprovalProcessState): void {
	Object.defineProperty(middleware, MARK, { value: state });
}

/** The per-process state marked on `middleware` (its own property), if any. */
export function approvalProcessState(middleware: unknown): ApprovalProcessState | undefined {
	return typeof middleware === 'function' && Object.hasOwn(middleware, MARK)
		? (middleware as unknown as Record<symbol, ApprovalProcessState>)[MARK]
		: undefined;
}

/** Mark `composed` with what any of `parts` keeps per process; nothing when none is marked. */
export function carryApprovalProcessState(composed: object, parts: readonly unknown[]): void {
	const states = parts.map(approvalProcessState);
	const any = (field: keyof ApprovalProcessState) => states.some((state) => state?.[field]);
	if (states.some(Boolean)) {
		markApprovalProcessState(composed, {
			relay: any('relay'),
			perProcessNonces: any('perProcessNonces'),
			perProcessRelayNonces: any('perProcessRelayNonces'),
		});
	}
}

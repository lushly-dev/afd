/**
 * Internal client/server approval exchange. Credentials live in a closure, never in a result
 * or a caller-supplied string context key. This is a trusted application integration seam,
 * not isolation from arbitrary JavaScript running in the host process.
 */
import type { CommandContext } from './commands.js';

export interface DirectApprovalHold {
	approvalToken: string;
	expiresAt: string;
	summary: string;
	reason?: string;
}

export interface DirectApprovalExchange {
	bind(context: CommandContext): CommandContext;
	pending(): Omit<DirectApprovalHold, 'approvalToken'> | undefined;
	approve(): void;
	dispose(): void;
}

// A global CLI and a project module may load distinct copies of core. Versioned keys
// share exchange identity within the host; the WeakMap is not carried in public contexts.
const EXCHANGE = Symbol.for('@lushly-dev/afd-core/direct-approval/v1');
const REGISTRY = Symbol.for('@lushly-dev/afd-core/direct-approval-registry/v1');
type ExchangeState = { hold?: DirectApprovalHold; evidence?: string; active: boolean };
const host = globalThis as typeof globalThis & {
	[REGISTRY]?: WeakMap<DirectApprovalExchange, ExchangeState>;
};
host[REGISTRY] ??= new WeakMap<DirectApprovalExchange, ExchangeState>();
const states = host[REGISTRY];

export function createDirectApprovalExchange(): DirectApprovalExchange {
	const state: ExchangeState = { active: true };
	const exchange: DirectApprovalExchange = {
		bind: (context) => ({ ...context, [EXCHANGE]: exchange }),
		pending() {
			if (!state.hold) return undefined;
			const { approvalToken: _token, ...request } = state.hold;
			return request;
		},
		approve() {
			if (!state.active) return;
			state.evidence = state.hold?.approvalToken;
			state.hold = undefined;
		},
		dispose() {
			state.active = false;
			state.hold = undefined;
			state.evidence = undefined;
		},
	};
	states.set(exchange, state);
	return exchange;
}

export function directApprovalExchange(
	context: CommandContext
): DirectApprovalExchange | undefined {
	const exchange = (context as Record<symbol, DirectApprovalExchange>)[EXCHANGE];
	// Keep disposed markers recognizable: a late attempt must not fall back to public tokens.
	return exchange && states.has(exchange) ? exchange : undefined;
}

/** The middleware deposits a hold without exposing the credential to result observers. */
export function holdDirectApproval(context: CommandContext, hold: DirectApprovalHold): void {
	const exchange = directApprovalExchange(context);
	const state = exchange && states.get(exchange);
	if (state?.active) state.hold = { ...hold };
}

/** One attempt can take the evidence, only after the trusted client approved the hold. */
export function takeDirectApproval(context: CommandContext): string | undefined {
	const exchange = directApprovalExchange(context);
	const state = exchange && states.get(exchange);
	if (!state?.active) return undefined;
	const evidence = state.evidence;
	state.evidence = undefined;
	return evidence;
}

/** Public call contexts carry custom string metadata, but cannot carry approval authority. */
export function publicDirectContext(context: CommandContext): CommandContext {
	const clean = { ...context };
	delete clean.approval;
	delete (clean as Record<symbol, unknown>)[EXCHANGE];
	return clean;
}

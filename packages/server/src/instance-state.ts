/**
 * @fileoverview What a server keeps per process unless the host shares it: the key that signs the
 * `requestState` of confirmation and approval elicitations, and each approval middleware's record
 * of spent single-use tokens. Behind one URL served by several processes, a state signed by one
 * fails on another and a single-use token works once on each, so the `instances` option makes
 * that dependency explicit.
 */

import type { CommandMiddleware } from '@lushly-dev/afd-core';
import { MIN_SECRET_BYTES } from './approval-crypto.js';
import { approvalProcessState } from './approval-process-state.js';

/** How many processes serve the server's URL: see `McpServerOptions.instances`. */
export type ServerInstances = 'single' | 'multiple';

export interface InstanceStateOptions {
	name: string;
	instances?: ServerInstances;
	confirmationKey?: string | Uint8Array;
	confirmations?: string;
	hasHumanRelay?: boolean;
	middleware?: readonly CommandMiddleware[];
	/**
	 * Whether the idempotency step keeps its keys in this process's memory: no `store`, or an
	 * `InMemoryIdempotencyStore` given explicitly. A host's own store (a wrapper included) is taken
	 * as shared.
	 */
	perProcessIdempotency?: boolean;
}

export interface InstanceState {
	/** A copy of the validated `confirmationKey`, so a caller that reuses its buffer cannot change it. */
	confirmationKey?: Uint8Array;
	/**
	 * The one warning to log when the server is served over HTTP with `instances` left out and a
	 * per-process default in use. `undefined` when nothing depends on one process.
	 */
	httpWarning?: string;
}

const encoder = new TextEncoder();

function checkKey(key: unknown): Uint8Array | undefined {
	if (key === undefined) return undefined;
	if (typeof key !== 'string' && !(key instanceof Uint8Array)) {
		throw new TypeError('confirmationKey must be a string or Uint8Array');
	}
	// A copy: `slice()` of a Node Buffer shares its memory, so the caller could change the key.
	const bytes = typeof key === 'string' ? encoder.encode(key) : new Uint8Array(key);
	if (bytes.length < MIN_SECRET_BYTES) {
		throw new TypeError(`confirmationKey must be at least ${MIN_SECRET_BYTES} bytes`);
	}
	return bytes;
}

/**
 * Validate `confirmationKey` and `instances`, and find the per-process defaults the server would
 * depend on. With `instances: 'multiple'`, a default in use throws, naming what to supply.
 *
 * An approval middleware is seen in `middleware` directly or inside `composeMiddleware`, from
 * any installed copy of this package from this version on (older copies do not mark theirs); one
 * wrapped in another middleware is not.
 *
 * @throws TypeError for a `confirmationKey` that is not a string or Uint8Array of at least 32
 * bytes, or an `instances` value other than `'single'` or `'multiple'`
 * @throws Error with `instances: 'multiple'` when the server would sign elicitation state with a
 * per-process key or an approval middleware would record single-use tokens in memory
 */
export function checkInstanceState(options: InstanceStateOptions): InstanceState {
	const { instances } = options;
	if (instances !== undefined && instances !== 'single' && instances !== 'multiple') {
		throw new TypeError("instances must be 'single' or 'multiple'");
	}
	const confirmationKey = checkKey(options.confirmationKey);
	const approvals = (options.middleware ?? []).flatMap((step) => {
		const state = approvalProcessState(step);
		return state ? [state] : [];
	});
	const elicits =
		(options.confirmations ?? 'off') !== 'off' || approvals.some((state) => state.relay);

	const missing: string[] = [];
	if (elicits && !confirmationKey) {
		missing.push(
			'confirmationKey (each process signs elicitation requestState with its own random key, so an answer must reach the process that asked)'
		);
	}
	if (
		approvals.some(
			(state) => state.perProcessNonces || (options.hasHumanRelay && state.perProcessRelayNonces)
		)
	) {
		missing.push(
			"the approval middleware's nonceStore (spent single-use tokens are kept in this process's memory, so a token works once on each process)"
		);
	}
	if (options.perProcessIdempotency) {
		missing.push(
			"the idempotency step's store (keys are kept in this process's memory, so a repeat that reaches another process runs again: spec/idempotency.md, S13)"
		);
	}
	if (missing.length === 0) return { confirmationKey };

	if (instances === 'multiple') {
		throw new Error(
			`[AFD] ${options.name}: instances: 'multiple' needs ${missing.join(' and ')}. ` +
				'Pass the same confirmationKey (at least 32 bytes) to every instance, give createApprovalMiddleware a nonceStore every instance shares, and give idempotency a store every instance shares.'
		);
	}
	return {
		confirmationKey,
		httpWarning:
			instances === 'single'
				? undefined
				: `[${options.name}] warning: one process must serve every request: this server has no ${missing.join(' and ')}. ` +
					"Behind several processes, share them and set instances: 'multiple'; with one process, set instances: 'single' to silence this.",
	};
}

const WARNED = Symbol.for('dev.afd/instances-warning');
let warnedHere = false;

/**
 * Log `message` to stderr unless an `instances` warning was already logged in this process, by
 * any server or handler from any installed copy of this package.
 */
export function warnInstancesOnce(message: string | undefined): void {
	if (!message) return;
	const holder = globalThis as Record<symbol, unknown>;
	if (Object.hasOwn(holder, WARNED) || warnedHere) return;
	try {
		// Configurable, so a test can forget it.
		Object.defineProperty(holder, WARNED, { value: true, configurable: true, enumerable: false });
	} catch {
		// A frozen global: this copy still logs once.
		warnedHere = true;
	}
	console.error(message);
}

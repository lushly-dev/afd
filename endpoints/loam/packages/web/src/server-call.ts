/**
 * @fileoverview The browser's half of the trust-record transport (phase 6 specification, 6.1 and 6.2; step 5):
 * `serverCall`, the kernel's port in a hosted `provider` deployment, which posts one trust-record command to
 * `<base>api/kernel/call` and maps the answer. A chunk of its own, loaded on the first routed call, so first paint holds
 * only the port's few bytes.
 *
 * - `200`: the body's `result`, the server's `CommandResult` unchanged, and its `generation`.
 * - `401`: afd-auth's `UNAUTHORIZED`, after which the session refresh runs at once (phase 3's 4.3), which settles the
 *   person if the session is gone.
 * - `400`, `403`, `404`, `409` (`SESSION_CHANGED`) and `413`: the body's `code`, with its message and suggestion.
 * - A `5xx`, a network failure or an answer that is not the transport's: `SERVER_UNAVAILABLE`, retryable. The kernel
 *   journals it as the call's result, and nothing is written.
 */

import type { CommandResult } from '@lushly-dev/afd-core';
import type { ServerCallAnswerV1, ServerCallRequestV1 } from '@lushly-dev/loam-kernel';

const unavailable = (why: string): ServerCallAnswerV1 => ({
	result: {
		success: false,
		error: {
			code: 'SERVER_UNAVAILABLE',
			message: `The hosted server did not answer: ${why}`,
			suggestion: 'Try again; the hosted server did not answer',
			retryable: true,
		},
	},
});

const text = (value: unknown): value is string => typeof value === 'string' && value !== '';

/** A `CommandResult` as the transport sends it: `success` a boolean, and an `error` with a code on a failure. */
function resultOf(value: unknown): CommandResult | undefined {
	if (typeof value !== 'object' || value === null) return undefined;
	const result = value as { success?: unknown; error?: { code?: unknown } };
	if (typeof result.success !== 'boolean') return undefined;
	if (!result.success && !text(result.error?.code)) return undefined;
	return value as CommandResult;
}

export interface ServerCallOptions {
	/** `<base>api/kernel/call`. */
	url: string;
	/** Phase 3's 4.3 refresh, run at once after a `401`. */
	refreshSession(): void;
	fetch?: typeof globalThis.fetch;
}

/** One trust-record command on the hosted server (6.1), mapped as the file's header says. */
export async function serverCall(
	options: ServerCallOptions,
	request: ServerCallRequestV1
): Promise<ServerCallAnswerV1> {
	const send = options.fetch ?? globalThis.fetch;
	let response: Response;
	// The person the shell made the call as goes beside the body, which is 6.2's `{ command, input, scope }` alone.
	const { person, ...call } = request;
	try {
		response = await send(options.url, {
			method: 'POST',
			credentials: 'same-origin',
			headers: {
				'content-type': 'application/json',
				...(person !== undefined ? { 'loam-person': person } : {}),
			},
			body: JSON.stringify(call),
		});
	} catch (cause) {
		return unavailable((cause as Error)?.message ?? 'the network failed');
	}
	const body = (await response.json().catch(() => undefined)) as
		| {
				result?: unknown;
				generation?: unknown;
				code?: unknown;
				message?: unknown;
				suggestion?: unknown;
		  }
		| undefined;
	if (response.status === 200) {
		const result = resultOf(body?.result);
		if (!result) return unavailable('its answer was not a result');
		return {
			result,
			...(typeof body?.generation === 'string' ? { generation: body.generation } : {}),
		};
	}
	if (response.status === 401) {
		options.refreshSession();
		return {
			result: {
				success: false,
				error: {
					code:
						text(body?.code) && body.code === 'AGENT_CANNOT_SIGN_IN' ? body.code : 'UNAUTHORIZED',
					message: text(body?.message) ? body.message : 'Authentication required',
					suggestion: 'Sign in again',
					retryable: false,
				},
			},
		};
	}
	// Another person's session now: the shell hears it at once, as after a `401` (6.1).
	if (response.status === 409) options.refreshSession();
	if (response.status >= 400 && response.status < 500 && text(body?.code)) {
		return {
			result: {
				success: false,
				error: {
					code: body.code,
					message: text(body.message)
						? body.message
						: `The hosted server refused it (${response.status})`,
					suggestion: text(body.suggestion) ? body.suggestion : 'Reload the shell, then try again',
					retryable: false,
				},
			},
		};
	}
	return unavailable(`it answered ${response.status}`);
}

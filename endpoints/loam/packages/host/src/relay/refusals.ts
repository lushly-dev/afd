/**
 * @fileoverview The relay's own refusals (phase 6 specification, 8.1 and section 16): each code's status and
 * suggestion. Each is answered `{ code, message, suggestion }` with `Loam-Relay-Refusal: 1`, a header the relay never
 * passes from an instance, so an instance cannot pose as the relay; nothing of a refused request reaches the instance.
 */

/** Every code the relay answers itself, with its HTTP status. */
export const RELAY_CODES = Object.freeze({
	REQUEST_NOT_SAME_ORIGIN: 403,
	REQUEST_INVALID: 400,
	REQUEST_TOO_LARGE: 413,
	UNAUTHORIZED: 401,
	AGENT_CANNOT_SIGN_IN: 401,
	INSTANCE_UNKNOWN: 404,
	MOUNT_BATCH_REFUSED: 400,
	MOUNT_METHOD_REFUSED: 400,
	MOUNT_COMMAND_NOT_EXPOSED: 403,
	MOUNT_PROJECT_NOT_LISTED: 403,
	MOUNT_SPACE_PINNED: 403,
	WORKSPACE_NOT_MEMBER: 403,
	PROJECT_NOT_FOUND: 403,
	PROJECT_ARCHIVED: 403,
	MOUNT_SESSION_UNKNOWN: 404,
	MOUNT_LIMIT: 429,
	MOUNT_RESULT_INVALID: 502,
	MOUNT_UNREACHABLE: 502,
	MOUNT_TIMEOUT: 504,
	SERVER_UNAVAILABLE: 503,
} as const);

export type RelayCode = keyof typeof RELAY_CODES;

const SUGGESTIONS: Readonly<Record<RelayCode, string>> = {
	REQUEST_NOT_SAME_ORIGIN: 'Call it from the shell, at its own origin',
	REQUEST_INVALID: 'Send one JSON-RPC message the relay reads, with the fields it names',
	REQUEST_TOO_LARGE: 'Send a smaller message; the server takes at most `request_body_bytes`',
	UNAUTHORIZED: 'Sign in again',
	AGENT_CANNOT_SIGN_IN: 'Sign in again as a person; an agent connects over MCP',
	INSTANCE_UNKNOWN: "Check the deployment's instances",
	MOUNT_BATCH_REFUSED: 'Send one message per request',
	MOUNT_METHOD_REFUSED: 'The shell sends only the methods it needs',
	MOUNT_COMMAND_NOT_EXPOSED: 'Ask the deployer to expose it',
	MOUNT_PROJECT_NOT_LISTED: 'Switch to a project this instance serves',
	MOUNT_SPACE_PINNED: 'Switch project, or leave out `space` and `spaces`',
	WORKSPACE_NOT_MEMBER: 'Ask an owner to invite you',
	PROJECT_NOT_FOUND: 'Run project-list to see the projects you can enter',
	PROJECT_ARCHIVED: 'Restore the project, or work in another one',
	MOUNT_SESSION_UNKNOWN: 'None: the shell starts a new session',
	MOUNT_LIMIT: 'Try again shortly',
	MOUNT_RESULT_INVALID: "Report this to the instance's owner",
	MOUNT_UNREACHABLE: 'Is the instance running? Try again',
	MOUNT_TIMEOUT: 'Try again; the instance was slow',
	SERVER_UNAVAILABLE: 'Try again; the hosted server did not answer',
};

export interface RelayRefusal {
	code: RelayCode;
	status: number;
	message: string;
	suggestion: string;
}

/**
 * Every refusal this module made, so a refusal is told from a decided value by identity, never by its shape: a page's
 * input holding `code` and `status` is still input (the trust review, Astra).
 */
const MADE = new WeakSet<object>();

/** A refusal of the relay's own; `status` replaces the code's own only for the gate's `405`. */
export function refusal(
	code: RelayCode,
	message: string,
	suggestion?: string,
	status: number = RELAY_CODES[code]
): RelayRefusal {
	const made = {
		code,
		status,
		message,
		suggestion: suggestion ?? SUGGESTIONS[code],
	};
	MADE.add(made);
	return made;
}

/** Whether `value` is a refusal `refusal()` made: a copy, or any object shaped like one, is not. */
export const isRefusal = (value: unknown): value is RelayRefusal =>
	typeof value === 'object' && value !== null && MADE.has(value);

/** The response header that marks a refusal as the relay's own. */
export const RELAY_REFUSAL_HEADER = 'loam-relay-refusal';

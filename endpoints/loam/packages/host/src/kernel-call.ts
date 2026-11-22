/**
 * @fileoverview The trust-record transport (phase 6 specification, 6.2; D103; step 5): `POST <base>api/kernel/call`,
 * which runs a browser's trust-record command on the server kernel as the session's person. Loaded with the server kernel
 * in a `provider` deployment only, so a `local` host's graph holds none of it.
 *
 * In 6.2's order, and nothing is read past a refusal: (1) the same-origin JSON rule, `403 REQUEST_NOT_SAME_ORIGIN`; (2)
 * the body, at most `request_body_bytes` (`413 REQUEST_TOO_LARGE`), exactly `{ command, input, scope }` (`400
 * REQUEST_INVALID`); (3) the session, from the provider with the cookie cache off, always the human (`401`, afd-auth's
 * `UNAUTHORIZED` or `AGENT_CANNOT_SIGN_IN`); (4) the command in `SERVER_COMMANDS` (`404 SERVER_COMMAND_NOT_SERVED`) and the
 * deployment's workspace (`400 REQUEST_INVALID`); (5) the call, through phase 3's principal chain, journaled with the
 * human actor; (6) `200 { result, generation }`, a refusal included, with that person's snapshot digest after it. No CORS
 * header is ever sent.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CommandResult } from '@lushly-dev/afd-core';
import { membershipOf, type ServerKernel } from '@lushly-dev/loam-identity';
import { SERVER_COMMANDS } from '@lushly-dev/loam-kernel';
import { INERT_POLICY } from './headers.js';
import type { HostProvider } from './provider.js';

const SERVED: ReadonlySet<string> = new Set(SERVER_COMMANDS);

/** The person the shell made the call as (6.2, step 5's trust review): compared with the session's, never trusted alone. */
export const PERSON_HEADER = 'loam-person';

/** No person's id may start with it (phase 3's 3.2). */
const AGENT_PREFIX = 'agt_';

const SUGGESTIONS: Readonly<Record<string, string>> = {
	REQUEST_NOT_SAME_ORIGIN: 'Call it from the shell, at its own origin',
	REQUEST_TOO_LARGE: 'Send a smaller input; the server takes at most `request_body_bytes`',
	REQUEST_INVALID:
		'Send exactly { command, input, scope: { workspace, project? } } for this workspace',
	UNAUTHORIZED: 'Sign in again',
	AGENT_CANNOT_SIGN_IN: 'Sign in again as a person; an agent connects over MCP',
	SERVER_COMMAND_NOT_SERVED: 'None: the shell sends only SERVER_COMMANDS',
	SESSION_CHANGED: 'Run it again as the person now signed in',
	SERVER_UNAVAILABLE: 'Try again; the hosted server did not answer',
};

/** A refusal the transport writes itself: JSON `{ code, message, suggestion }`, with 3.5's headers and `no-store`. */
function refuse(outgoing: ServerResponse, status: number, code: string, message: string): void {
	answer(outgoing, status, { code, message, suggestion: SUGGESTIONS[code] ?? 'Try again' });
}

function answer(outgoing: ServerResponse, status: number, body: unknown): void {
	if (outgoing.headersSent) return void outgoing.destroy();
	const text = `${JSON.stringify(body)}\n`;
	outgoing.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'content-length': Buffer.byteLength(text),
		'cache-control': 'no-store',
		'content-security-policy': INERT_POLICY,
		'x-content-type-options': 'nosniff',
	});
	outgoing.end(text);
}

/** A header the request sent exactly once, or undefined; twice is never one value. */
function single(incoming: IncomingMessage, name: string): string | undefined | null {
	const all = incoming.headersDistinct?.[name];
	if (all !== undefined) return all.length === 1 ? (all[0] as string) : null;
	const one = incoming.headers[name];
	return Array.isArray(one) ? null : one;
}

/** Row 1, the same-origin JSON rule (phase 3's 9.5 and 10.2 item 4): `POST`, JSON, `Origin` exact, same-site fetch. */
export function sameOriginJson(incoming: IncomingMessage, origin: string): boolean {
	if (incoming.method !== 'POST') return false;
	const type = single(incoming, 'content-type');
	if (typeof type !== 'string' || type.split(';')[0]?.trim().toLowerCase() !== 'application/json')
		return false;
	if (single(incoming, 'origin') !== origin) return false;
	const site = single(incoming, 'sec-fetch-site');
	return site === undefined || site === 'same-origin';
}

/** The body, at most `limit` bytes; `undefined` when it is over, so nothing past it is read. */
async function readBody(incoming: IncomingMessage, limit: number): Promise<Buffer | undefined> {
	const declared = Number(single(incoming, 'content-length'));
	if (Number.isFinite(declared) && declared > limit) return undefined;
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of incoming) {
		size += (chunk as Buffer).length;
		if (size > limit) return undefined;
		chunks.push(chunk as Buffer);
	}
	return Buffer.concat(chunks);
}

/** Row 2's shape: exactly `{ command, input, scope: { workspace, project? } }`, or undefined. */
export function requestOf(
	text: string
): { command: string; input: unknown; scope: { workspace: string; project?: string } } | undefined {
	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
	const { command, input, scope, ...rest } = body as Record<string, unknown>;
	if (Object.keys(rest).length > 0 || !('input' in (body as object))) return undefined;
	if (typeof command !== 'string' || command === '' || command.length > 64) return undefined;
	if (typeof scope !== 'object' || scope === null || Array.isArray(scope)) return undefined;
	const { workspace, project, ...more } = scope as Record<string, unknown>;
	if (Object.keys(more).length > 0 || typeof workspace !== 'string') return undefined;
	if (project !== undefined && (typeof project !== 'string' || project === '')) return undefined;
	return {
		command,
		input,
		scope: project === undefined ? { workspace } : { workspace, project },
	};
}

/**
 * The session the request's cookie names, read from the provider's database with the cookie cache off (6.2 row 3, 8.1
 * step 3): its user, or `none`, `agent` for an agent's id (which never signs in), or `unavailable` when the read failed.
 */
export async function sessionOf(
	provider: HostProvider,
	incoming: IncomingMessage
): Promise<{ user: { id: string; name?: string } } | 'none' | 'agent' | 'unavailable'> {
	const headers = new Headers();
	for (const [name, value] of Object.entries(incoming.headers))
		if (typeof value === 'string') headers.set(name, value);
	const api = provider.auth.api as unknown as {
		getSession(input: {
			headers: Headers;
			query: { disableCookieCache: boolean };
		}): Promise<{ user: { id: string; name?: string } } | null>;
	};
	let found: { user: { id: string; name?: string } } | null;
	try {
		found = await api.getSession({ headers, query: { disableCookieCache: true } });
	} catch {
		return 'unavailable';
	}
	if (!found) return 'none';
	return found.user.id.startsWith(AGENT_PREFIX) ? 'agent' : found;
}

export interface KernelCallOptions {
	/** `origin` of `loam.server.toml`. */
	origin: string;
	/** `[limits] request_body_bytes`. */
	maxBodyBytes: number;
	kernel: ServerKernel;
	provider: HostProvider;
}

/** `POST <base>api/kernel/call` (6.2), over the open server kernel and provider. */
export function createKernelCall(options: KernelCallOptions) {
	const { origin, maxBodyBytes, kernel, provider } = options;
	const { parts } = kernel;
	const workspace = provider.workspace;
	return async (incoming: IncomingMessage, outgoing: ServerResponse): Promise<void> => {
		// 1. The same-origin JSON rule, before anything is read.
		if (!sameOriginJson(incoming, origin))
			return refuse(outgoing, 403, 'REQUEST_NOT_SAME_ORIGIN', 'Only the shell calls this route');
		// 2. The body.
		const body = await readBody(incoming, maxBodyBytes);
		if (body === undefined)
			return refuse(outgoing, 413, 'REQUEST_TOO_LARGE', 'The request is over the body limit');
		const request = requestOf(body.toString('utf8'));
		if (!request) return refuse(outgoing, 400, 'REQUEST_INVALID', 'The request is not a call');
		// 3. The session, read from the database (no cookie cache), and the principal: always the human.
		const read = await sessionOf(provider, incoming);
		if (read === 'unavailable')
			// A read that failed is no answer about the session: retryable, never a sign-in prompt (step 5's review).
			return refuse(outgoing, 503, 'SERVER_UNAVAILABLE', 'The sign-in provider did not answer');
		if (read === 'none') return refuse(outgoing, 401, 'UNAUTHORIZED', 'Authentication required');
		if (read === 'agent')
			return refuse(outgoing, 401, 'AGENT_CANNOT_SIGN_IN', 'An agent never signs in as a person');
		const found = read;
		// The person the shell made the call as, beside the body: a session now another's runs nothing, so a tab never writes
		// as a person another tab signed in before it heard (step 5's trust review). The principal is the session's alone.
		const expected = single(incoming, PERSON_HEADER);
		if (typeof expected !== 'string' || expected === '')
			return refuse(outgoing, 400, 'REQUEST_INVALID', 'The call names no person it was made as');
		if (expected !== found.user.id)
			return refuse(
				outgoing,
				409,
				'SESSION_CHANGED',
				'The person signed in changed before this call ran'
			);
		// 4. The command and the workspace.
		if (!SERVED.has(request.command))
			return refuse(outgoing, 404, 'SERVER_COMMAND_NOT_SERVED', 'This command is not served here');
		if (request.scope.workspace !== workspace)
			return refuse(
				outgoing,
				400,
				'REQUEST_INVALID',
				"The scope names another workspace than this server's"
			);
		const person = found.user.id;
		const adapter = (await provider.auth.$context).adapter as never;
		const membership = await membershipOf(adapter, workspace, person);
		const admit = parts.admitPrincipal;
		const callAs = parts.callAs;
		if (!admit || !callAs) throw new Error('The server kernel has no principal gate');
		const principal = admit({
			actor: {
				kind: 'human',
				id: person,
				...(typeof found.user.name === 'string' && found.user.name !== ''
					? { label: found.user.name }
					: {}),
			},
			person,
			role: membership?.role ?? null,
			digest: membership?.digest ?? '',
		});
		let result: CommandResult;
		let generation = '';
		try {
			// 5. The call, through the principal chain, journaled as the person.
			result = await callAs(principal, request.command, request.input, request.scope);
			// 6. That person's snapshot digest after it. A digest that fails is none: the call's own answer stands, so a
			// committed write is never reported as one to try again.
			const snapshot =
				request.command === 'trust-record-snapshot'
					? result
					: await callAs(principal, 'trust-record-snapshot', {}, { workspace }).catch(
							() => undefined
						);
			generation = snapshot?.success
				? String((snapshot.data as { generation?: unknown }).generation ?? '')
				: '';
		} finally {
			parts.retirePrincipal?.(principal);
		}
		answer(outgoing, 200, { result: withoutSeq(result), generation });
	};
}

/** The kernel's own `dev.loam/seq` is the server journal's, never the browser's: it is dropped from the answer. */
function withoutSeq(result: CommandResult): CommandResult {
	const metadata = result.metadata as Record<string, unknown> | undefined;
	if (!metadata || !('dev.loam/seq' in metadata)) return result;
	const { 'dev.loam/seq': _seq, ...kept } = metadata;
	return { ...result, metadata: kept as CommandResult['metadata'] };
}

/** `agent-member-settle`'s most agents in one input. */
const SETTLE_MAX = 1000;

/**
 * The provider's removal hook on the server kernel (phase 3's A4 and A8): the installed agent members the removed person
 * sponsors, not suspended yet, suspended by one `agent-member-settle` with `PROVIDER_HOOK_FIELDS`, journaled as the
 * removing person when known. None to suspend: nothing is run.
 */
export function createRemovalHook(
	kernel: ServerKernel,
	store: {
		list<T>(table: string): Promise<{ data: T[] }>;
	}
) {
	return async (event: { userId: string; removedBy?: string }): Promise<void> => {
		const rows = (
			await store.list<{ id: string; sponsor: string; status: string; kind?: string }>(
				'agent-member'
			)
		).data;
		const agents = rows
			.filter((row) => row.sponsor === event.userId && row.status !== 'suspended')
			.map((row) => ({ agent: row.id, suspended: 'sponsor-left' as const }));
		if (agents.length === 0) return;
		const run = kernel.parts.runProviderHook;
		if (!run) throw new Error('The server kernel has no provider hook');
		// At most the settle's 1,000 a call, so a sponsor of more is settled whole, one entry per thousand.
		for (let at = 0; at < agents.length; at += SETTLE_MAX) {
			const settled = await run(
				{ agents: agents.slice(at, at + SETTLE_MAX) },
				event.removedBy ? { kind: 'human', id: event.removedBy } : undefined
			);
			if (!settled.success)
				throw new Error(`agent-member-settle refused: ${settled.error?.code ?? 'unknown'}`);
		}
	};
}

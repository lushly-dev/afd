/**
 * @fileoverview The hosted relay (phase 6 specification, section 8; D105; phase 3's 10.2 item 5 with A1 and A3):
 * `<base>mounts/<instance>/mcp`, the boundary between a person's browser and a team's mounted instance. In 8.1's
 * order, with nothing read past a refusal:
 *
 * - **The gate** (steps 1 to 4): `POST` and `DELETE` only, the exact path, the same-origin rule, the session's person
 *   (always the human), and an instance the deployment mounts over `http` and the server's record enables.
 * - **Parse, decide, rebuild** (steps 5 to 14): `message.ts`, `decide.ts` and `rebuild.ts`, against the server's records
 *   read for this request and the catalog the relay discovered itself (8.2), so the meta-tools and AFD's `grouped`
 *   strategy reach nothing the kernel would not.
 * - **The answer** (steps 15 to 17): `answer.ts`'s allow-list, `sessions.ts`'s bindings, cancellation and limits.
 *
 * Every refusal of the relay's own is `{ code, message, suggestion }` with `Loam-Relay-Refusal: 1`; nothing of a refused
 * request reaches the instance. Each forwarded `tools/call`, and every refusal from step 4 on, is journaled as
 * `mount-relay` with no argument, result, header or token (8.4); the refusals before step 3 are only counted.
 */

import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { JournalRecord } from '@lushly-dev/afd-core';
import {
	DISCOVERY_LIMITS,
	type MembershipV1,
	type ProjectV1,
	type ScopeV1,
	type WorkspaceAppV1,
} from '@lushly-dev/loam-kernel/mounted';
import type { ProjectionAppV1 } from '@lushly-dev/loam-manifest';
import type { ServerLimitsV1 } from '@lushly-dev/loam-manifest/server';
import { SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/client';
import { INERT_POLICY } from '../headers.js';
import { type ReadAnswer, readAnswer, StreamCut } from './answer.js';
import type { CatalogInstance, Catalogs } from './catalogs.js';
import { createCatalogs } from './catalogs.js';
import {
	type DecideContext,
	type Decision,
	decideMessage,
	decideWorkspaceLevel,
} from './decide.js';
import { type ParsedMessage, parseMessage } from './message.js';
import { rebuildMessage, requestHeaders } from './rebuild.js';
import {
	isRefusal,
	RELAY_REFUSAL_HEADER,
	type RelayCode,
	type RelayRefusal,
	refusal,
} from './refusals.js';
import { type Binding, createRelayState, type RelayState } from './sessions.js';

/** The relay's route below `<base>`: one instance's name, as the CLI writes `mounts/<instance>/mcp`. */
const ROUTE = /^mounts\/([a-z][a-z0-9]{0,31})\/mcp$/;

/** The answer to a session the session read refused, or the person it is for. */
export type SessionRead =
	| { person: string; label?: string }
	| { refused: 'UNAUTHORIZED' | 'AGENT_CANNOT_SIGN_IN' | 'SERVER_UNAVAILABLE' };

/** One mounted `http` instance of the deployment, with what only the server holds: its URL and bearer (section 13). */
export interface RelayInstance {
	entry: ProjectionAppV1;
	url: string;
	bearer?: string;
	manifest: CatalogInstance['manifest'];
}

export interface RelayOptions {
	/** `origin` of `loam.server.toml`. */
	origin: string;
	/** The deployment's workspace. */
	workspace: string;
	limits: ServerLimitsV1;
	instances: readonly RelayInstance[];
	/** The session's person, from the provider with no cookie cache (8.1 step 3). */
	session(incoming: IncomingMessage): Promise<SessionRead>;
	/** The person's membership, read on every request with no cache (phase 3's 7.6). */
	membership(person: string): Promise<MembershipV1>;
	/** The server's `workspace-app` record for an instance. */
	workspaceApp(instance: string): Promise<WorkspaceAppV1 | null>;
	/** The server's `project` table. */
	projects(): Promise<readonly ProjectV1[]>;
	/** Appends to the server's journal (8.4). */
	journal(record: JournalRecord): Promise<unknown>;
	/** The upstream `fetch`, for a test. */
	fetch?: typeof fetch;
	clock?: () => number;
	/** Off in a unit that drives discovery itself. */
	scheduleDiscovery?: boolean;
}

export interface Relay {
	/** Answers `<base>mounts/…` (`rest` is the raw path below `<base>`, with no query). */
	handle(incoming: IncomingMessage, outgoing: ServerResponse, rest: string): Promise<void>;
	/** The refusals made before a session was read, by code (8.4): counted, never journaled. */
	readonly counts: ReadonlyMap<string, number>;
	readonly catalogs: Catalogs;
	readonly state: RelayState;
	/** Waits for nothing in flight: every upstream request is aborted, and each binding `DELETE`d. */
	close(): Promise<void>;
}

/** The headers every answer of the relay's carries: 3.5's for anything that is not a page. */
const ANSWER_HEADERS = Object.freeze({
	'cache-control': 'no-store',
	'content-security-policy': INERT_POLICY,
	'x-content-type-options': 'nosniff',
});

/** A refusal of the relay's own, marked, with nothing of the instance's. */
function writeRefusal(
	outgoing: ServerResponse,
	refused: RelayRefusal,
	extra: Record<string, string> = {}
): void {
	if (outgoing.headersSent) return void outgoing.destroy();
	const body = `${JSON.stringify({ code: refused.code, message: refused.message, suggestion: refused.suggestion })}\n`;
	outgoing.writeHead(refused.status, {
		...ANSWER_HEADERS,
		'content-type': 'application/json; charset=utf-8',
		'content-length': Buffer.byteLength(body),
		[RELAY_REFUSAL_HEADER]: '1',
		...extra,
	});
	outgoing.end(body);
}

/** An empty answer: a notification's `202`, a session `DELETE`'s, with no body and no `Content-Type`. */
function writeEmpty(
	outgoing: ServerResponse,
	status: number,
	extra: Record<string, string> = {}
): void {
	if (outgoing.headersSent) return void outgoing.destroy();
	outgoing.writeHead(status, { ...ANSWER_HEADERS, ...extra });
	outgoing.end();
}

/** A header the request sent exactly once, or undefined; twice is never one value. */
function single(incoming: IncomingMessage, name: string): string | undefined | null {
	const all = incoming.headersDistinct?.[name];
	if (all !== undefined) return all.length === 1 ? (all[0] as string) : null;
	const one = incoming.headers[name];
	return Array.isArray(one) ? null : one;
}

/** 6.2's first row (8.1 step 2): `Origin` exact and a same-site fetch; for `POST`, the JSON media type (A1). */
function sameOrigin(incoming: IncomingMessage, origin: string): boolean {
	if (single(incoming, 'origin') !== origin) return false;
	const site = single(incoming, 'sec-fetch-site');
	if (site !== undefined && site !== 'same-origin') return false;
	if (incoming.method !== 'POST') return true;
	const type = single(incoming, 'content-type');
	return (
		typeof type === 'string' && type.split(';')[0]?.trim().toLowerCase() === 'application/json'
	);
}

/** Whether a `DELETE` carries a body: any length but none or zero, or a transfer encoding. */
function hasBody(incoming: IncomingMessage): boolean {
	const length = single(incoming, 'content-length');
	if (incoming.headers['transfer-encoding'] !== undefined) return true;
	return length !== undefined && length !== '0';
}

/** The body, at most `limit` bytes; `undefined` when it is over, so nothing past it is read. */
async function readBody(incoming: IncomingMessage, limit: number): Promise<string | undefined> {
	const declared = Number(single(incoming, 'content-length'));
	if (Number.isFinite(declared) && declared > limit) return undefined;
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of incoming) {
		size += (chunk as Buffer).length;
		if (size > limit) return undefined;
		chunks.push(chunk as Buffer);
	}
	return new TextDecoder().decode(Buffer.concat(chunks));
}

const SUPPORTED: ReadonlySet<string> = new Set(SUPPORTED_PROTOCOL_VERSIONS);

/** The most of a page's own tool name a refusal's record keeps (8.4), so a refused name never grows the journal. */
const RECORDED_NAME_MAX = 128;

/**
 * Waits for the page to take more of a stream: its `drain`, its `close`, or the request's own abort (the deadline, the
 * page gone, a cancellation), whichever is first, with every listener removed after it (the trust review, Astra).
 */
export function drained(outgoing: ServerResponse, signal: AbortSignal): Promise<void> {
	if (signal.aborted || outgoing.destroyed) return Promise.resolve();
	return new Promise<void>((done) => {
		const finish = () => {
			outgoing.off('drain', finish);
			outgoing.off('close', finish);
			signal.removeEventListener('abort', finish);
			done();
		};
		outgoing.on('drain', finish);
		outgoing.on('close', finish);
		signal.addEventListener('abort', finish, { once: true });
	});
}

/** One request's record (8.4): never an argument, a result, a header or a token. */
interface Outcome {
	instance: string;
	command: string;
	scope?: ScopeV1;
	status: number;
	code?: RelayCode | string;
	/** A `tools/call`, journaled when forwarded. */
	call?: boolean;
}

export function createRelay(options: RelayOptions): Relay {
	const { origin, workspace, limits } = options;
	const clock = options.clock ?? Date.now;
	const fetcher = options.fetch ?? fetch;
	const byInstance = new Map(
		options.instances.map((instance) => [instance.entry.instance, instance])
	);
	const counts = new Map<string, number>();
	const count = (code: string) => counts.set(code, (counts.get(code) ?? 0) + 1);
	const writes = new Set<Promise<unknown>>();
	/** Set by `close()`: a request already past the host's own check is refused before it forwards anything. */
	let closed = false;
	const controllers = new Set<AbortController>();

	const enabled = async (instance: string): Promise<boolean> => {
		const record = await options.workspaceApp(instance);
		return record !== null && record.listed !== null && record.overrides.enabled !== false;
	};
	const catalogs = createCatalogs({
		instances: options.instances.map((instance) => ({
			entry: instance.entry,
			url: instance.url,
			...(instance.bearer !== undefined ? { bearer: instance.bearer } : {}),
			manifest: instance.manifest,
			enabled: () => enabled(instance.entry.instance),
		})),
		...(options.fetch ? { fetch: options.fetch } : {}),
		...(options.clock ? { clock: options.clock } : {}),
		...(options.scheduleDiscovery === false ? { schedule: false } : {}),
	});

	/** A binding's upstream `DELETE`, with the relay's headers only: the page's own, or one the relay ends itself. */
	function deleteUpstream(
		binding: Binding,
		signal: AbortSignal = AbortSignal.timeout(limits.relay_timeout_ms)
	): Promise<Response> | undefined {
		const instance = byInstance.get(binding.instance);
		if (!instance) return undefined;
		const headers: Record<string, string> = {
			'mcp-session-id': binding.id,
			'accept-encoding': 'identity',
		};
		if (binding.protocolVersion !== undefined)
			headers['mcp-protocol-version'] = binding.protocolVersion;
		if (instance.bearer !== undefined) headers.authorization = `Bearer ${instance.bearer}`;
		return fetcher(instance.url, {
			method: 'DELETE',
			headers,
			redirect: 'manual',
			signal,
		});
	}

	/** An idle or evicted binding, or one open at close, ended upstream (step 16). */
	async function endUpstream(binding: Binding): Promise<void> {
		const response = await deleteUpstream(binding);
		await response?.body?.cancel().catch(() => {});
	}
	const state = createRelayState({
		concurrency: limits.relay_concurrency_per_person,
		idleMs: limits.relay_session_idle_ms,
		end: endUpstream,
		clock,
	});

	function record(person: string, started: number, outcome: Outcome): void {
		const actor = { kind: 'human' as const, id: person };
		const hash = createHash('sha256')
			.update(JSON.stringify({ actor, interface: 'relay' }))
			.digest('hex');
		const result = outcome.code
			? {
					success: false as const,
					error: {
						code: String(outcome.code),
						message: 'The relay refused the request',
						suggestion: 'See the code',
					},
					data: { status: outcome.status },
				}
			: { success: true as const, data: { status: outcome.status } };
		const write = options
			.journal({
				timestamp: new Date(started).toISOString(),
				command: 'mount-relay',
				input: {
					instance: outcome.instance,
					command: outcome.command,
					...(outcome.scope ? { scope: outcome.scope } : {}),
				},
				actor,
				contextDigest: { hash: `sha256:${hash}`, interface: 'relay' },
				result: result as JournalRecord['result'],
				durationMs: Math.max(0, clock() - started),
			})
			.catch(() => {});
		writes.add(write);
		void write.finally(() => writes.delete(write));
	}

	/** Sends the rebuilt message and passes the answer back by allow-list (steps 14 to 16). */
	async function forward(request: {
		incoming: IncomingMessage;
		outgoing: ServerResponse;
		instance: RelayInstance;
		person: string;
		message: ParsedMessage;
		decision: Decision;
		binding: Binding | undefined;
		/** An `initialize`'s reserved place, given up once the answer binds a session or does not. */
		reservation?: () => void;
	}): Promise<{ status: number; code?: RelayCode }> {
		const { incoming, outgoing, instance, person, message, decision, binding } = request;
		/** A refusal of the relay's own while forwarding, written and returned so the record holds its code. */
		const fail = (code: RelayCode, message: string) => {
			const refused = refusal(code, message);
			writeRefusal(outgoing, refused);
			return { status: refused.status, code };
		};
		const rebuilt = rebuildMessage(message, decision);
		const pageVersion = single(incoming, 'mcp-protocol-version');
		const headers = requestHeaders({
			rebuilt,
			...(instance.bearer !== undefined ? { bearer: instance.bearer } : {}),
			...(binding
				? {
						session: {
							id: binding.id,
							...(binding.protocolVersion !== undefined
								? { protocolVersion: binding.protocolVersion }
								: {}),
						},
					}
				: {}),
			...(typeof pageVersion === 'string' && SUPPORTED.has(pageVersion)
				? { statelessVersion: pageVersion }
				: {}),
		});
		const controller = new AbortController();
		controllers.add(controller);
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			controller.abort(new Error('The instance did not answer in time'));
		}, limits.relay_timeout_ms);
		// An aborted page request aborts its upstream request and frees its slot (step 15).
		const pageGone = () => {
			if (!outgoing.writableFinished) controller.abort(new Error('The page went away'));
		};
		outgoing.on('close', pageGone);
		const landed =
			message.id !== undefined
				? state.fly(
						{ person, instance: instance.entry.instance, binding: binding?.id, id: message.id },
						controller
					)
				: () => {};
		try {
			let response: Response;
			try {
				response = await fetcher(instance.url, {
					method: 'POST',
					headers,
					body: rebuilt.body,
					redirect: 'manual',
					signal: controller.signal,
				});
			} catch {
				if (outgoing.destroyed) return { status: 499 };
				return fail(
					timedOut ? 'MOUNT_TIMEOUT' : 'MOUNT_UNREACHABLE',
					'The instance did not answer'
				);
			}
			// Step 16: an upstream `404` on a bound id drops the binding.
			if (response.status === 404 && binding) state.drop(binding.id);
			const issued =
				message.method === 'initialize' ? response.headers.get('mcp-session-id') : null;
			let answer: ReadAnswer;
			try {
				answer = await readAnswer(response, { id: message.id, max: limits.relay_response_bytes });
			} catch {
				if (outgoing.destroyed) return { status: 499 };
				return fail(
					timedOut ? 'MOUNT_TIMEOUT' : 'MOUNT_UNREACHABLE',
					'The instance did not answer'
				);
			}
			if (answer.kind === 'invalid')
				return fail('MOUNT_RESULT_INVALID', 'The instance answered outside the protocol');
			// Step 16: `Mcp-Session-Id` passes back only on a legacy `initialize`'s answer, bound to its person and instance.
			const back: Record<string, string> = {};
			let bound: Binding | undefined;
			if (issued !== null && response.status >= 200 && response.status < 300) {
				const made = state.bind(issued, person, instance.entry.instance);
				request.reservation?.();
				if (made === false) {
					if (answer.kind === 'stream') await answer.events.return();
					// Refused because the relay is closing: the session it opened is ended upstream, so none stays open
					// (the re-check, Opus). Another person's id is theirs, and is left alone.
					if (closed)
						void endUpstream({
							id: issued,
							person,
							instance: instance.entry.instance,
							lastUsed: clock(),
							inFlight: 0,
						}).catch(() => {});
					return closed
						? fail('SERVER_UNAVAILABLE', 'The hosted server is stopping')
						: fail('MOUNT_RESULT_INVALID', 'The instance issued a session another holds');
				}
				bound = made;
				back['mcp-session-id'] = issued;
			}
			const version = (result: unknown) => {
				const named = (result as { protocolVersion?: unknown } | undefined)?.protocolVersion;
				if (bound && typeof named === 'string') bound.protocolVersion = named;
			};
			request.reservation?.();
			if (answer.kind === 'empty') {
				writeEmpty(outgoing, answer.status, back);
				return { status: answer.status };
			}
			if (answer.kind === 'body') {
				if (answer.response) version(answer.response.result);
				if (outgoing.headersSent) {
					outgoing.destroy();
					return { status: 499 };
				}
				if (answer.text === undefined) {
					writeEmpty(outgoing, answer.status, back);
					return { status: answer.status };
				}
				const body = `${answer.text}\n`;
				outgoing.writeHead(answer.status, {
					...ANSWER_HEADERS,
					...back,
					'content-type': 'application/json',
					'content-length': Buffer.byteLength(body),
				});
				outgoing.end(body);
				return { status: answer.status };
			}
			// A stream: the status now, then each event the allow-list keeps, ended after the one response.
			outgoing.writeHead(200, { ...ANSWER_HEADERS, ...back, 'content-type': 'text/event-stream' });
			let answered = false;
			try {
				for await (const event of answer.events) {
					if (event.response) {
						version(event.response.result);
						answered = true;
					}
					if (!outgoing.write(event.text)) await drained(outgoing, controller.signal);
					if (outgoing.destroyed || controller.signal.aborted) throw new StreamCut('size');
				}
				outgoing.end();
			} catch (cause) {
				// Past the size or the deadline after the status, or a response for another request: the stream is cut,
				// and its record says why (the re-check, Opus).
				outgoing.destroy();
				if (timedOut) return { status: 200, code: 'MOUNT_TIMEOUT' };
				if (cause instanceof StreamCut || !answered)
					return { status: 200, code: 'MOUNT_RESULT_INVALID' };
			} finally {
				controller.abort(new Error('The stream ended'));
			}
			// A stream that ended with no response is no answer either.
			return answered ? { status: 200 } : { status: 200, code: 'MOUNT_RESULT_INVALID' };
		} finally {
			request.reservation?.();
			clearTimeout(timer);
			outgoing.off('close', pageGone);
			controllers.delete(controller);
			landed();
		}
	}

	async function handle(
		incoming: IncomingMessage,
		outgoing: ServerResponse,
		rest: string
	): Promise<void> {
		const started = clock();
		const method = incoming.method ?? 'GET';
		const early = (refused: RelayRefusal, extra?: Record<string, string>) => {
			count(refused.code);
			writeRefusal(outgoing, refused, extra);
		};
		// Step 1: the method and the path, exact: no query or fragment, no other spelling.
		if (method !== 'POST' && method !== 'DELETE') {
			return early(
				refusal('MOUNT_METHOD_REFUSED', 'The relay takes POST and DELETE only', undefined, 405),
				{ allow: 'POST, DELETE' }
			);
		}
		const name = ROUTE.exec(rest)?.[1];
		if (name === undefined || /[?#]/.test(incoming.url ?? ''))
			return early(refusal('INSTANCE_UNKNOWN', 'No such instance'));
		// Step 2: the same-origin rule; a `DELETE` carries no body and names its session (A1).
		if (!sameOrigin(incoming, origin))
			return early(refusal('REQUEST_NOT_SAME_ORIGIN', 'Only the shell calls this route'));
		const sessionId = single(incoming, 'mcp-session-id');
		if (sessionId === null) return early(refusal('REQUEST_INVALID', 'One session id at most'));
		if (method === 'DELETE' && (hasBody(incoming) || !sessionId))
			return early(
				refusal('REQUEST_INVALID', 'A session DELETE carries no body and names its session')
			);
		// Step 3: the session and the principal, always the human.
		let read: SessionRead;
		try {
			read = await options.session(incoming);
		} catch {
			read = { refused: 'SERVER_UNAVAILABLE' };
		}
		if ('refused' in read) {
			const messages = {
				UNAUTHORIZED: 'Authentication required',
				AGENT_CANNOT_SIGN_IN: 'An agent never signs in as a person',
				SERVER_UNAVAILABLE: 'The sign-in provider did not answer',
			} as const;
			return early(refusal(read.refused, messages[read.refused]));
		}
		const { person } = read;
		// From here every refusal is journaled with its code (8.4).
		let outcome: Outcome = { instance: name, command: method, status: 0 };
		const refuse = (refused: RelayRefusal, extra?: Record<string, string>) => {
			outcome = { ...outcome, status: refused.status, code: refused.code };
			writeRefusal(outgoing, refused, extra);
		};
		try {
			// Step 4: the instance, in the deployment, mounted over `http`, enabled in the server's record; the same bytes
			// for one that is disabled as for one that does not exist.
			const instance = byInstance.get(name);
			if (instance?.entry.transport !== 'http' || !(await enabled(name)))
				return refuse(refusal('INSTANCE_UNKNOWN', 'No such instance'));
			// The records each decision reads, read for it: after the body arrives, and again after a rediscovery, so a
			// project closed while a request was still arriving is closed to it (the trust review, Astra).
			const contextNow = async (): Promise<DecideContext> => {
				const [membership, projects] = await Promise.all([
					options.membership(person),
					options.projects(),
				]);
				return {
					workspace,
					entry: instance.entry,
					person,
					membership,
					projects,
					catalog: catalogs.get(name),
				};
			};
			if (method === 'DELETE') {
				const context = await contextNow();
				// A session `DELETE` is decided at workspace level, and forwarded only for the person's own bound id; an
				// unknown, evicted or foreign id is answered `204` with the same bytes, and nothing is forwarded.
				const member = decideWorkspaceLevel(context, undefined);
				if (member) return refuse(member);
				const binding = state.binding(sessionId as string, person, name);
				if (!binding) {
					outcome.status = 204;
					return writeEmpty(outgoing, 204);
				}
				const release = state.acquire(person);
				if (!release)
					return refuse(refusal('MOUNT_LIMIT', 'Too many requests in flight'), {
						'retry-after': '1',
					});
				try {
					state.drop(binding.id);
					// The instance's answer by the same allow-list: an empty `2xx` as it is, anything else with no body.
					let answer: ReadAnswer;
					const deadline = AbortSignal.timeout(limits.relay_timeout_ms);
					try {
						const response = (await deleteUpstream(binding, deadline)) as Response;
						answer = await readAnswer(response, {
							id: undefined,
							max: limits.relay_response_bytes,
						});
					} catch {
						// The same deadline as a `POST`'s: no answer in `relay_timeout_ms` is `504`.
						return refuse(
							deadline.aborted
								? refusal('MOUNT_TIMEOUT', 'The instance did not answer in time')
								: refusal('MOUNT_UNREACHABLE', 'The instance did not answer')
						);
					}
					if (answer.kind === 'invalid' || answer.kind === 'stream')
						return refuse(
							refusal('MOUNT_RESULT_INVALID', 'The instance answered outside the protocol')
						);
					outcome.status = answer.status;
					if (answer.kind === 'body' && answer.text !== undefined) {
						// A JSON-RPC error the allow-list kept passes back as a `POST`'s does.
						const text = `${answer.text}\n`;
						outgoing.writeHead(answer.status, {
							...ANSWER_HEADERS,
							'content-type': 'application/json',
							'content-length': Buffer.byteLength(text),
						});
						outgoing.end(text);
					} else writeEmpty(outgoing, answer.status);
				} finally {
					release();
				}
				return;
			}
			// Step 5: one message, within the body limit.
			const body = await readBody(incoming, limits.request_body_bytes);
			if (body === undefined)
				return refuse(refusal('REQUEST_TOO_LARGE', 'The message is over the body limit'));
			const message = parseMessage(body, { depth: DISCOVERY_LIMITS.depth, workspace });
			if (isRefusal(message)) return refuse(message);
			// The page's own name, bounded, until the decision names the catalog's (8.4): a refusal records no more.
			outcome.command =
				message.method === 'tools/call'
					? (message.name as string).slice(0, RECORDED_NAME_MAX)
					: message.method;
			outcome.call = message.method === 'tools/call';
			if (message.scope) outcome.scope = message.scope;
			// Steps 9 to 11; a command the catalog does not hold is discovered again once (8.2).
			if (!(await enabled(name))) return refuse(refusal('INSTANCE_UNKNOWN', 'No such instance'));
			let decision = decideMessage(message, await contextNow());
			if ('missing' in decision && decision.missing) {
				await catalogs.rediscover(name);
				decision = decideMessage(message, await contextNow());
			}
			if (isRefusal(decision)) return refuse(decision);
			if (decision.kind === 'command') {
				outcome.command = decision.command.tool;
				if (decision.scope) outcome.scope = decision.scope;
				else delete outcome.scope;
			}
			// Step 16: the page's session id must be its own binding at this instance; an `initialize` starts a new one.
			let binding: Binding | undefined;
			if (message.method !== 'initialize' && sessionId) {
				binding = state.binding(sessionId, person, name);
				if (!binding)
					return refuse(refusal('MOUNT_SESSION_UNKNOWN', 'The relay does not know this session'));
			}
			// Step 17: cancellation is the relay's own, holds no slot, and is answered `202` whatever it aborted.
			if (decision.kind === 'cancel') {
				state.cancel(person, name, binding?.id, decision.requestId);
				outcome.status = 202;
				return writeEmpty(outgoing, 202);
			}
			// The relay closed while this request's body or records were read: nothing more leaves for the instance.
			if (closed) return refuse(refusal('SERVER_UNAVAILABLE', 'The hosted server is stopping'));
			const release = state.acquire(person);
			if (!release)
				return refuse(refusal('MOUNT_LIMIT', 'Too many requests in flight'), {
					'retry-after': '1',
				});
			// An `initialize` takes its slot first, then a place among the person's four sessions, held until it binds.
			let reservation: (() => void) | undefined;
			if (message.method === 'initialize') {
				reservation = state.reserve(person, name);
				if (!reservation) {
					release();
					return refuse(refusal('MOUNT_LIMIT', 'Every session of this instance is busy'), {
						'retry-after': '1',
					});
				}
			}
			const using = binding ? state.use(binding) : () => {};
			try {
				const forwarded = await forward({
					incoming,
					outgoing,
					instance,
					person,
					message,
					decision,
					binding,
					...(reservation ? { reservation } : {}),
				});
				outcome.status = forwarded.status;
				if (forwarded.code !== undefined) outcome.code = forwarded.code;
			} finally {
				reservation?.();
				using();
				release();
			}
		} catch {
			if (!outgoing.headersSent)
				refuse(refusal('MOUNT_UNREACHABLE', 'The relay could not complete the request'));
			else outgoing.destroy();
		} finally {
			// Each forwarded `tools/call`, and every refusal from step 4 on; a session's own message that passed is not.
			if (outcome.code !== undefined || outcome.call) record(person, started, outcome);
		}
	}

	return {
		handle,
		counts,
		catalogs,
		state,
		async close() {
			closed = true;
			catalogs.close();
			for (const controller of controllers) controller.abort(new Error('The relay closed'));
			await state.close();
			await Promise.allSettled([...writes]);
		},
	};
}

/**
 * The language-neutral vectors in `spec/vectors/idempotency.json`: idempotency keys
 * (`spec/idempotency.md`), every section, against the TypeScript server.
 *
 * - `declaration`: the command's tool `_meta.idempotency` and its `idempotentHint` annotation.
 * - `key.form` and `key.derived`: K2's form and K4's derived keys.
 * - `key.delivery`: a key sent each way K1 names (over MCP in `_meta` and in `afd-call`'s `meta`
 *   argument on an in-memory stdio connection; on the context in process) reaching the handler.
 * - `step`: the engine's step on one server with one store and the harness's clock. Calls are in
 *   process (the router, as an MCP lane runs it after admission) unless the case names an HTTP or
 *   stdio surface. TypeScript keeps a call's chain running after it answers `TIMEOUT`, so the
 *   `continues` case runs and the `waits`, `cancels` and `drops` cases are another engine's.
 * - `step.options`, `retry`, `timeoutRecovery` and `journal`.
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
	type Actor,
	type Clock,
	type CommandContext,
	type CommandMiddleware,
	type CommandResult,
	deriveIdempotencyKey,
	failure,
	isIdempotencyKey,
	type JournalEntry,
	MemoryJournalSink,
	success,
} from '@lushly-dev/afd-core';
import { canonicalJson } from '@lushly-dev/afd-core/internal/canonical-json';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { admitApproval } from './approval-admission.js';
import { canonicalOrUndefined } from './approval-crypto.js';
import { hostState, withHostState } from './host-state.js';
import { createIdempotencyStep, type IdempotencyOptions } from './idempotency-step.js';
import {
	type IdempotencyReservationRequest,
	type IdempotencySettlement,
	type IdempotencyStore,
	InMemoryIdempotencyStore,
} from './idempotency-store.js';
import { createJournalMiddleware } from './journal.js';
import { replayJournal } from './journal-replay.js';
import { serveModernStdio } from './mcp-modern.js';
import { createRetryMiddleware } from './middleware.js';
import { principalBinding } from './principal-binding.js';
import { defineCommand, type ZodCommandDefinition } from './schema.js';
import { createSharedHttpRuntime } from './server.js';
import type { McpHandlerOptions } from './server-types.js';
import { TASKS_EXTENSION_ID } from './tasks.js';
import type { RouteOutcome } from './tool-router.js';

// ═══════════════════════════════════════════════════════════════════════════════
// THE VECTORS
// ═══════════════════════════════════════════════════════════════════════════════

/** A vector's JSON, read loosely: each section's harness reads the members its case uses. */
// biome-ignore lint/suspicious/noExplicitAny: vector JSON is read per section
type Json = any;

const vectors: Json = JSON.parse(
	readFileSync(new URL('../../../spec/vectors/idempotency.json', import.meta.url), 'utf8')
);
const META_KEY: string = vectors.metaKey;

/** A section's cases as `it.each` rows: each case's description, then the case. */
function named(cases: Json[]): [string, Json][] {
	return cases.map((c) => [c.description as string, c]);
}

/** The engine a TypeScript server is (S7): it keeps the call's chain running after `TIMEOUT`. */
const ENGINE = 'continues';

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

interface Deferred<T = void> {
	promise: Promise<T>;
	resolve(value: T): void;
}

function deferred<T = void>(): Deferred<T> {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** The value an in-process route produced. */
function routeValue(outcome: RouteOutcome): Json {
	if (outcome.kind === 'value') return outcome.value;
	if (outcome.kind === 'refused') return failure(outcome.error);
	return outcome.result.structuredContent ?? JSON.parse(outcome.result.content[0]?.text ?? '{}');
}

/** A tool result's command result. */
function toolValue(result: unknown): Json {
	const typed = result as { structuredContent?: unknown; content?: Array<{ text: string }> };
	return typed.structuredContent ?? JSON.parse(typed.content?.[0]?.text ?? '{}');
}

/** A stdio connection to `runtime`, both ends in memory, in the MCP 2026-07-28 era. */
async function stdioClient(runtime: ReturnType<typeof createSharedHttpRuntime>): Promise<Client> {
	const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
	const handle = serveModernStdio(runtime.modernDeps, undefined, serverSide);
	const client = new Client(
		{ name: 'vectors', version: '0' },
		{ versionNegotiation: { mode: 'auto' } }
	);
	await client.connect(clientSide);
	cleanups.push(async () => {
		await client.close();
		await handle.close();
	});
	return client;
}

/** Serve `runtime` over HTTP on a free port; the `/mcp` URL. */
async function listen(runtime: ReturnType<typeof createSharedHttpRuntime>): Promise<string> {
	const server = createServer((req, res) => {
		void runtime.handler(req, res);
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	cleanups.push(async () => {
		runtime.dispose();
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});
	return `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
}

/** One MCP 2026-07-28 JSON-RPC request over HTTP, with `_meta` merged into the request's. */
async function rpc(
	url: string,
	method: string,
	params: Record<string, unknown>,
	options: { tasks?: boolean; meta?: Record<string, unknown> } = {}
): Promise<Json> {
	const meta = {
		'io.modelcontextprotocol/protocolVersion': '2026-07-28',
		'io.modelcontextprotocol/clientCapabilities': options.tasks
			? { extensions: { [TASKS_EXTENSION_ID]: {} } }
			: {},
		'io.modelcontextprotocol/clientInfo': { name: 'vectors', version: '0' },
		...options.meta,
	};
	const name =
		method === 'tools/call' ? String(params.name) : String(params.taskId ?? '') || undefined;
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json, text/event-stream',
			'MCP-Protocol-Version': '2026-07-28',
			'Mcp-Method': method,
			...(name ? { 'Mcp-Name': name } : {}),
		},
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: meta } }),
	});
	return response.json();
}

// ═══════════════════════════════════════════════════════════════════════════════
// DECLARATION (D1, D2)
// ═══════════════════════════════════════════════════════════════════════════════

describe('idempotency.json', () => {
	it('no longer lists TypeScript as a documented gap', () => {
		expect(vectors.gaps.typescript).toBeUndefined();
		expect(META_KEY).toBe('dev.afd/idempotencyKey');
	});

	describe('declaration', () => {
		it.each(named(vectors.declaration.cases))('%s', (_, c: Json) => {
			const command = defineCommand({
				name: 'thing-do',
				description: 'Does a thing',
				expose: { mcp: true },
				input: z.object({}),
				...c.command,
				handler: async () => success({}),
			});
			const runtime = createSharedHttpRuntime({
				name: 'declaration',
				version: '1.0.0',
				toolStrategy: 'individual',
				commands: [command],
			});
			cleanups.push(() => runtime.dispose());
			const tool = runtime
				.getToolsList()
				.find((entry) => (entry as Json).name === 'thing-do') as Json;
			expect(tool._meta?.idempotency ?? null).toBe(c.expect.metaIdempotency);
			expect(tool.annotations?.idempotentHint ?? null).toBe(c.expect.idempotentHint);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// THE KEY (K1 to K6)
	// ═══════════════════════════════════════════════════════════════════════════

	describe('key.form', () => {
		it.each(named(vectors.key.form))('%s', (_, c: Json) => {
			const key = c.repeat !== undefined ? c.repeat.repeat(c.times) : c.key;
			expect(isIdempotencyKey(key)).toBe(c.valid);
		});
	});

	describe('key.derived', () => {
		it.each(
			(vectors.key.derived as Json[]).map((c): [string, Json] => [
				`${c.base} ${c.kind} ${c.index}`,
				c,
			])
		)('%s', (_, c: Json) => {
			expect(deriveIdempotencyKey(c.base, c.kind, c.index)).toBe(c.expected);
		});
	});

	describe('key.delivery', () => {
		/** A server whose `note-read` notes the key its handler reads, and can nest once. */
		function deliveryServer() {
			const seen: Array<string | null> = [];
			const nestedSeen: Array<string | null> = [];
			let route: ReturnType<typeof createSharedHttpRuntime>['routeToolCall'] | undefined;
			const command = defineCommand({
				name: 'note-read',
				description: 'Reads a note',
				expose: { mcp: true },
				input: z.object({ nest: z.boolean().optional(), idempotencyKey: z.string().optional() }),
				handler: async (input, context): Promise<CommandResult> => {
					const key = (context?.idempotencyKey as string | undefined) ?? null;
					if (input.nest === false) {
						nestedSeen.push(key);
						return success({ nested: true });
					}
					seen.push(key);
					// K6: the same command once more through the registry, on this very context.
					if (input.nest === true && route) {
						await route.route(
							'afd-call',
							{ command: 'note-read', input: { nest: false } },
							context
						);
					}
					return success({ key });
				},
			});
			const runtime = createSharedHttpRuntime({
				name: 'delivery',
				version: '1.0.0',
				toolStrategy: 'individual',
				commands: [command],
			});
			route = runtime.routeToolCall;
			cleanups.push(() => runtime.dispose());
			return { runtime, seen, nestedSeen };
		}

		it.each(named(vectors.key.delivery))('%s', async (_, c: Json) => {
			const { runtime, seen, nestedSeen } = deliveryServer();
			const hasKey = c.key !== undefined || c.keyIsNull === true;
			const meta = hasKey ? { [META_KEY]: c.key ?? null } : {};
			const input = c.nested ? { nest: true } : {};
			let value: Json;
			if (c.kind === 'batch' || c.kind === 'pipeline') {
				const client = await stdioClient(runtime);
				const steps = Array.from({ length: c.items }, () => ({ command: 'note-read', input: {} }));
				const result =
					c.kind === 'batch'
						? await client.callTool({
								name: 'afd-batch',
								arguments: { commands: steps },
								_meta: meta,
							})
						: await client.callTool({ name: 'afd-pipe', arguments: { steps }, _meta: meta });
				value = toolValue(result);
			} else if (c.via === 'meta') {
				const client = await stdioClient(runtime);
				value = toolValue(
					await client.callTool({ name: 'note-read', arguments: input, _meta: meta })
				);
			} else if (c.via === 'meta-argument') {
				const client = await stdioClient(runtime);
				value = toolValue(
					await client.callTool({
						name: 'afd-call',
						arguments: { command: 'note-read', input, meta },
					})
				);
			} else if (c.via === 'context') {
				value = routeValue(
					await runtime.routeToolCall.route(
						'afd-call',
						{ command: 'note-read', input },
						{ idempotencyKey: c.key }
					)
				);
			} else {
				// `input`: a member named like the key is input, never the key.
				value = routeValue(
					await runtime.routeToolCall.route(
						'afd-call',
						{ command: 'note-read', input: { idempotencyKey: c.key } },
						{}
					)
				);
			}
			const e = c.expect;
			if (e.success !== undefined) expect(value.success).toBe(e.success);
			if (e.code !== undefined) expect(value.error?.code).toBe(e.code);
			if (e.handlerRuns !== undefined) expect(seen.length).toBe(e.handlerRuns);
			if (e.detailsMeta !== undefined) expect(value.error?.details?.meta).toBe(e.detailsMeta);
			if ('handlerSeesKey' in e) expect(seen).toEqual([e.handlerSeesKey]);
			if (e.handlerSeesKeys !== undefined) expect(seen).toEqual(e.handlerSeesKeys);
			if ('nestedHandlerSeesKey' in e) expect(nestedSeen).toEqual([e.nestedHandlerSeesKey]);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// THE ENGINE'S STEP (S1 to S13)
	// ═══════════════════════════════════════════════════════════════════════════

	describe('step', () => {
		const setup = vectors.step.setup;
		const actors: Record<string, Actor> = setup.actors;

		/** The harness's store: the default one, with hooks to seed it, hold a reservation and see settles. */
		class HarnessStore implements IdempotencyStore {
			readonly inner = new InMemoryIdempotencyStore();
			holdReserve: { entered: Deferred; release: Promise<void> } | undefined;
			/** The watch the next reservation made takes, and each watched reservation's. */
			private watch: Deferred | undefined;
			private readonly watched = new Map<string, Deferred>();
			async reserve(scope: string, request: IdempotencyReservationRequest, now: number) {
				const hold = this.holdReserve;
				if (hold) {
					this.holdReserve = undefined;
					hold.entered.resolve();
					await hold.release;
				}
				const outcome = this.inner.reserve(scope, request, now);
				if (outcome.reserved && this.watch) {
					this.watched.set(outcome.reservation, this.watch);
					this.watch = undefined;
				}
				return outcome;
			}
			complete(scope: string, reservation: string, settlement: IdempotencySettlement) {
				this.inner.complete(scope, reservation, settlement);
				this.settled(reservation);
			}
			release(scope: string, reservation: string) {
				this.inner.release(scope, reservation);
				this.settled(reservation);
			}
			get(scope: string, now: number) {
				return this.inner.get(scope, now);
			}
			/** Settles when the next reservation made, and no other, is completed or released. */
			nextSettle(): Promise<void> {
				this.watch = deferred();
				return this.watch.promise;
			}
			private settled(reservation: string): void {
				this.watched.get(reservation)?.resolve();
				this.watched.delete(reservation);
			}
		}

		interface Harness {
			now: number;
			starts: number;
			store: HarnessStore;
			approved: boolean;
			/** The barrier a held handler waits on, and the signal that it started. */
			hold: { started: Deferred; release: Deferred } | undefined;
			flakyFailed: boolean;
		}

		function makeHarness(): Harness {
			return {
				now: 0,
				starts: 0,
				store: new HarnessStore(),
				approved: false,
				hold: undefined,
				flakyFailed: false,
			};
		}

		const inputSchema = z.looseObject({ sku: z.string(), count: z.number().int().optional() });

		function commandsFor(h: Harness): ZodCommandDefinition[] {
			/** order-place: `{ placed: n }`, n counted when the handler starts. */
			const place = async (): Promise<CommandResult> => {
				h.starts += 1;
				const placed = h.starts;
				const hold = h.hold;
				if (hold) {
					h.hold = undefined;
					hold.started.resolve();
					await hold.release.promise;
				}
				return success({ placed });
			};
			const handlers: Record<string, () => Promise<CommandResult>> = {
				'order-place': place,
				'order-refuse': async () => {
					h.starts += 1;
					return failure({
						code: 'CONFLICT',
						message: 'Refused',
						suggestion: 'Do not',
						retryable: false,
					});
				},
				'order-flaky': async () => {
					if (!h.flakyFailed) {
						h.flakyFailed = true;
						h.starts += 1;
						return failure({
							code: 'TRANSIENT_ERROR',
							message: 'Flaky',
							suggestion: 'Retry',
							retryable: true,
						});
					}
					return place();
				},
				'order-timeout': async () => {
					h.starts += 1;
					return failure({
						code: 'TIMEOUT',
						message: 'Timed out',
						suggestion: 'Retry',
						retryable: true,
					});
				},
				'order-throw': async () => {
					h.starts += 1;
					throw new Error('boom');
				},
				'order-approve': place,
				'order-set': place,
				'order-note': place,
				'order-claims-replay': async () => {
					const result = await place();
					return { ...result, metadata: { idempotentReplay: true, note: 'kept' } } as CommandResult;
				},
				'order-task': place,
			};
			return setup.commands.map((spec: Json) =>
				defineCommand({
					name: spec.name,
					description: spec.handler,
					expose: { mcp: true },
					mutation: spec.mutation,
					...(spec.idempotency && { idempotency: spec.idempotency }),
					...(spec.approval && { approval: spec.approval }),
					...(spec.task && { task: spec.task }),
					input: inputSchema,
					handler: handlers[spec.name] as () => Promise<CommandResult>,
				})
			);
		}

		/** The harness's approval step: admits `order-approve` when the case says it is approved. */
		function approvalStep(h: Harness): CommandMiddleware {
			const step: CommandMiddleware = async (name, input, context, next) => {
				if (name !== 'order-approve') return next();
				if (!h.approved) {
					return failure({
						code: 'APPROVAL_REQUIRED',
						message: 'Needs approval',
						suggestion: 'Ask a person',
						retryable: false,
					});
				}
				admitApproval(context, {
					step,
					commandName: name,
					canonical: canonicalOrUndefined(input),
					input,
					listedGate: false,
					canonicalize: canonicalOrUndefined,
				});
				return next();
			};
			return step;
		}

		function serverOptions(h: Harness, extra: Partial<McpHandlerOptions> = {}): McpHandlerOptions {
			const clock: Clock = { now: () => h.now };
			return {
				name: 'orders',
				version: '1.0.0',
				host: '127.0.0.1',
				toolStrategy: 'individual',
				commands: commandsFor(h),
				clock,
				// A call without `timeoutMs` has no deadline (spec/vectors/README.md).
				defaultTimeoutMs: null,
				contextFields: [{ name: 'project', meta: 'dev.example/project', schema: z.string() }],
				middleware: [approvalStep(h)],
				idempotency: { ...(setup.options as IdempotencyOptions), store: h.store },
				...extra,
			};
		}

		/** Put the case's seeded reservation in the store, as the step would have made it. */
		async function seed(h: Harness, reservation: Json): Promise<void> {
			const step = createIdempotencyStep({ store: new InMemoryIdempotencyStore() });
			const principal = principalBinding(actors[reservation.actor]);
			const scope = step.scope(principal, reservation.command, reservation.key);
			const digest = await step.digest({}, reservation.input);
			const madeAt = reservation.madeAt as number;
			await h.store.reserve(
				scope,
				{
					digest: digest as string,
					reservedAt: madeAt,
					expiresAt: madeAt + setup.options.ttlMs,
					leaseEndsAt: madeAt + setup.options.leaseMs,
				},
				madeAt
			);
		}

		/** Check one call's result against its `expect`. */
		function check(value: Json, e: Json, where: string): void {
			const said = `${where}: ${JSON.stringify(value)}`;
			if (e.internalError) {
				expect(value.error?.code, said).toBe(-32603);
				expect(value.error?.message, said).toBe('Internal error');
				return;
			}
			if (e.items) {
				expect(
					value.results.map((item: Json) => item.result.success),
					said
				).toEqual(e.items.map((item: Json) => item.success));
				expect(
					value.results.map((item: Json) => item.result.metadata?.idempotentReplay === true),
					said
				).toEqual(e.items.map((item: Json) => item.replay));
				return;
			}
			if (e.success !== undefined) expect(value.success, said).toBe(e.success);
			if (e.data !== undefined) expect(value.data, said).toEqual(e.data);
			if (e.code !== undefined) expect(value.error?.code, said).toBe(e.code);
			if (e.retryable !== undefined) expect(value.error?.retryable, said).toBe(e.retryable);
			if (e.recovery !== undefined) expect(value.error?.recovery, said).toEqual(e.recovery);
			if (e.replay !== undefined) {
				expect(value.metadata?.idempotentReplay === true, said).toBe(e.replay);
				if (!e.replay) expect(value.metadata ?? {}, said).not.toHaveProperty('idempotentReplay');
			}
			if (e.metadata !== undefined) expect(value.metadata, said).toMatchObject(e.metadata);
			if (e.detailsMeta !== undefined) expect(value.error?.details?.meta, said).toBe(e.detailsMeta);
			if (e.detailsReason !== undefined) {
				expect(value.error?.details?.reason, said).toBe(e.detailsReason);
			}
		}

		/** Whether a case is for this engine (S7): TypeScript keeps a call's chain running after TIMEOUT. */
		const ours = (c: Json) => c.engine === undefined || c.engine === ENGINE;
		for (const c of vectors.step.cases as Json[]) {
			const title = ours(c)
				? c.description
				: `${c.description} (the ${c.engine} engine's; TypeScript's continues)`;
			it.skipIf(!ours(c))(title, async () => {
				const h = makeHarness();
				if (c.seed?.reservation) await seed(h, c.seed.reservation);

				/** Make one call on the case's surface and return its result. */
				let call: (spec: Json, signal?: AbortSignal) => Promise<Json>;
				if (
					c.surface === 'http-without-credentials' ||
					c.surface === 'http-with-unbindable-credentials'
				) {
					const runtime = createSharedHttpRuntime(
						serverOptions(
							h,
							c.surface === 'http-with-unbindable-credentials'
								? {
										createContext: () => ({
											actor: actors.agent,
											credentials: {
												issuer: 'https://issuer.example',
												subject: 'u1',
												clientId: '',
											},
										}),
										idempotency: {
											...(setup.options as IdempotencyOptions),
											store: h.store,
											callersIdentifiedByHook: true,
										},
									}
								: {}
						)
					);
					const url = await listen(runtime);
					call = async (spec) => {
						const body = await rpc(
							url,
							'tools/call',
							{ name: spec.command, arguments: spec.input },
							{ meta: spec.key !== undefined ? { [META_KEY]: spec.key } : {} }
						);
						return body.error ? body : toolValue(body.result);
					};
				} else if (c.surface === 'two-stdio-connections') {
					const runtime = createSharedHttpRuntime(serverOptions(h));
					cleanups.push(() => runtime.dispose());
					const connections = [await stdioClient(runtime), await stdioClient(runtime)];
					call = async (spec) =>
						toolValue(
							await (connections[spec.connection - 1] as Client).callTool({
								name: spec.command,
								arguments: spec.input,
								_meta: spec.key !== undefined ? { [META_KEY]: spec.key } : {},
							})
						);
				} else if (c.calls.some((spec: Json) => spec.asTask)) {
					// MCP Tasks run over HTTP here, where the host declares its hook identifies callers.
					const runtime = createSharedHttpRuntime(
						serverOptions(h, {
							createContext: () => ({ actor: actors.agent }),
							taskOptions: { callersIdentifiedByHook: true },
						})
					);
					const url = await listen(runtime);
					call = async (spec) => {
						const created = await rpc(
							url,
							'tools/call',
							{ name: spec.command, arguments: spec.input },
							{ tasks: true, meta: { [META_KEY]: spec.key } }
						);
						expect(created.result?.resultType).toBe('task');
						const taskId = created.result.taskId as string;
						for (let tries = 0; tries < 500; tries++) {
							const got = await rpc(url, 'tasks/get', { taskId }, { tasks: true });
							if (got.result?.status !== 'working') return toolValue(got.result.result);
							await new Promise((resolve) => setTimeout(resolve, 10));
						}
						throw new Error('the task did not settle');
					};
				} else {
					const runtime = createSharedHttpRuntime(serverOptions(h));
					cleanups.push(() => runtime.dispose());
					call = async (spec, signal) => {
						const actor = spec.actor === null ? undefined : actors[spec.actor ?? 'agent'];
						const context: CommandContext = {
							...(actor && { actor }),
							...(spec.key !== undefined && { idempotencyKey: spec.key }),
							...(spec.context ?? {}),
							...(spec.timeoutMs !== undefined && { timeout: spec.timeoutMs }),
							...(signal && { signal }),
						};
						if (spec.kind === 'batch') {
							return routeValue(
								await runtime.routeToolCall.route('afd-batch', { commands: spec.commands }, context)
							);
						}
						const input = spec.inputNotCanonical
							? { sku: 'a', count: 1, extra: new Map() }
							: spec.input;
						return routeValue(
							await runtime.routeToolCall.route(
								'afd-call',
								{ command: spec.command, input },
								context
							)
						);
					};
				}

				let held: { promise: Promise<Json>; release: Deferred; settled: Promise<void> } | undefined;
				for (const [index, spec] of (c.calls as Json[]).entries()) {
					const where = `call ${index + 1}`;
					if (spec.at !== undefined) h.now = spec.at;
					h.approved = spec.approved === true;
					if (held && !spec.whileFirstIsHeld) {
						// Every call made while the first was held has returned: let it go and settle.
						held.release.resolve();
						await held.settled;
						await held.promise;
						held = undefined;
					}
					if (spec.heldInHandler) {
						const started = deferred();
						const release = deferred();
						h.hold = { started, release };
						const settled = h.store.nextSettle();
						const promise = call(spec);
						await started.promise;
						if (spec.timeoutMs !== undefined) {
							// The caller is answered at the deadline while the handler stays held.
							check(await promise, spec.expect, where);
							held = { promise: Promise.resolve(undefined), release, settled };
						} else {
							held = {
								promise: promise.then((value) => {
									check(value, spec.expect, where);
									return value;
								}),
								release,
								settled,
							};
						}
						continue;
					}
					if (spec.cancelledDuringReserve) {
						const controller = new AbortController();
						const entered = deferred();
						const release = deferred();
						h.store.holdReserve = { entered, release: release.promise };
						const promise = call(spec, controller.signal);
						await entered.promise;
						controller.abort();
						release.resolve();
						check(await promise, spec.expect, where);
						continue;
					}
					check(await call(spec), spec.expect, where);
				}
				if (held) {
					held.release.resolve();
					await held.settled;
					await held.promise;
				}
				expect(h.starts).toBe(c.handlerRuns);
			});
		}

		describe('options', () => {
			it.each(named(vectors.step.options))('%s', (_, c: Json) => {
				const build = () =>
					createSharedHttpRuntime({
						name: 'options',
						version: '1.0.0',
						commands: [],
						defaultTimeoutMs: c.defaultTimeoutMs,
						idempotency: { ttlMs: c.ttlMs, leaseMs: c.leaseMs },
					}).dispose();
				if (c.valid) expect(build).not.toThrow();
				else expect(build).toThrow(/ttlMs/);
			});
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// RETRYING (R1, R2, S6, S11)
	// ═══════════════════════════════════════════════════════════════════════════

	describe('retry', () => {
		it.each(named(vectors.retry.cases))('%s', async (_, c: Json) => {
			let runs = 0;
			const handler = async (): Promise<CommandResult> => {
				runs += 1;
				if (runs === 1) {
					return failure({
						code: c.handlerFailsWith ?? 'TRANSIENT_ERROR',
						message: 'Failed once',
						suggestion: 'Retry',
						retryable: true,
					});
				}
				return success({ runs });
			};
			// The middleware's defaults decide; only its waits are shortened.
			const retry = createRetryMiddleware({
				retryDelay: 0,
				...(c.retryMutations && { retryMutations: true }),
			});
			const key = c.key ? { idempotencyKey: 'k1' } : {};
			let result: CommandResult;
			if (c.declarationUnreadable) {
				// Outside the engine, the middleware cannot read the declaration.
				result = await retry('thing-do', {}, { ...key }, handler);
			} else {
				const runtime = createSharedHttpRuntime({
					name: 'retry',
					version: '1.0.0',
					defaultTimeoutMs: null,
					middleware: [retry],
					...(c.withStep && { idempotency: {} }),
					commands: [
						defineCommand({
							name: 'thing-do',
							description: 'Does a thing',
							expose: { mcp: true },
							input: z.object({}),
							...c.command,
							handler,
						}),
					],
				});
				cleanups.push(() => runtime.dispose());
				let context: CommandContext = { actor: { kind: 'agent', id: 'advisor' }, ...key };
				// A task run, as the task runtime marks one (S11).
				if (c.asTask) context = withHostState(context, { taskRun: true });
				expect(hostState(context).taskRun === true).toBe(c.asTask === true);
				result = await runtime.engine.executeCommand('thing-do', {}, context);
			}
			expect(result.success).toBe(c.expect.success);
			if (c.expect.code) expect(result.error?.code).toBe(c.expect.code);
			expect(runs).toBe(c.expect.handlerRuns);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// THE TIMEOUT RECOVERY (R3)
	// ═══════════════════════════════════════════════════════════════════════════

	describe('timeoutRecovery', () => {
		it.each(named(vectors.timeoutRecovery.cases))('%s', async (_, c: Json) => {
			const release = deferred();
			const runtime = createSharedHttpRuntime({
				name: 'timeouts',
				version: '1.0.0',
				defaultTimeoutMs: null,
				...(c.withStep !== false && { idempotency: {} }),
				commands: [
					defineCommand({
						name: 'thing-do',
						description: 'Does a thing',
						expose: { mcp: true },
						input: z.object({}),
						...c.command,
						// Outlives the deadline: returns only once the harness lets it go.
						handler: async () => {
							await release.promise;
							return success({});
						},
					}),
				],
			});
			cleanups.push(() => runtime.dispose());
			const result = await runtime.engine.executeCommand(
				'thing-do',
				{},
				{
					actor: { kind: 'agent', id: 'advisor' },
					timeout: 20,
					...(c.key && { idempotencyKey: 'k1' }),
				}
			);
			release.resolve();
			expect(result.error?.code).toBe(c.expect.code);
			expect(result.error?.retryable).toBe(c.expect.retryable);
			expect(result.error?.recovery ?? null).toEqual(c.expect.recovery);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// THE JOURNAL
	// ═══════════════════════════════════════════════════════════════════════════

	describe('journal', () => {
		function journaled() {
			const seen: Array<string | null> = [];
			const sink = new MemoryJournalSink();
			const options: McpHandlerOptions = {
				name: 'journal',
				version: '1.0.0',
				defaultTimeoutMs: null,
				middleware: [createJournalMiddleware(sink)],
				commands: [
					defineCommand({
						name: 'note-add',
						description: 'Adds a note',
						expose: { mcp: true },
						input: z.object({}),
						handler: async (_input, context) => {
							seen.push((context?.idempotencyKey as string | undefined) ?? null);
							return success({ added: true });
						},
					}),
				],
			};
			const runtime = createSharedHttpRuntime(options);
			cleanups.push(() => runtime.dispose());
			return { runtime, sink, seen };
		}

		it.each(named(vectors.journal.cases))('%s', async (_, c: Json) => {
			const { runtime, sink, seen } = journaled();
			const context: CommandContext = c.key !== undefined ? { idempotencyKey: c.key } : {};
			if (c.kind === 'batch') {
				const commands = Array.from({ length: c.items }, () => ({
					command: 'note-add',
					input: {},
				}));
				await runtime.routeToolCall.route('afd-batch', { commands }, context);
			} else {
				await runtime.routeToolCall.route('afd-call', { command: 'note-add', input: {} }, context);
			}
			const entries: JournalEntry[] = await sink.read();
			const e = c.expect;
			if ('entryIdempotencyKey' in e) {
				expect(entries).toHaveLength(1);
				expect(entries[0]?.idempotencyKey ?? null).toBe(e.entryIdempotencyKey);
			}
			if (e.entryIdempotencyKeys) {
				expect(entries.map((entry) => entry.idempotencyKey)).toEqual(e.entryIdempotencyKeys);
			}
			if (e.digestHashHasMember) {
				// spec/journal.md's formula, on a context whose other keys are known: the journal
				// called directly with `redact`, so it records outside an engine.
				const sinkAlone = new MemoryJournalSink();
				const middleware = createJournalMiddleware(sinkAlone, { redact: (record) => record });
				const actor = { kind: 'agent' as const, id: 'advisor' };
				await middleware(
					'note-add',
					{},
					{ actor, interface: 'mcp', traceId: 't1', idempotencyKey: c.key },
					async () => success({})
				);
				const [entry] = await sinkAlone.read();
				const hashed = canonicalJson({
					actor,
					idempotencyKey: c.key,
					interface: 'mcp',
					// The journal sets its recording clock and random source on the context.
					keys: ['clock', 'random'],
					traceId: 't1',
				});
				const bytes = new Uint8Array(
					await crypto.subtle.digest('SHA-256', new TextEncoder().encode(hashed))
				);
				const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
				expect(entry?.idempotencyKey).toBe(c.key);
				expect(entry?.contextDigest.hash).toBe(`sha256:${hex}`);
			}
			if (c.replay) {
				seen.length = 0;
				const target = journaled();
				const report = await replayJournal(
					{ execute: target.runtime.engine.executeCommand },
					entries
				);
				if ('handlerSeesKey' in e) expect(target.seen).toEqual([e.handlerSeesKey]);
				if (e.handlerSeesKeys) expect(target.seen).toEqual(e.handlerSeesKeys);
				if (e.status) expect(report.entries.map((entry) => entry.status)).toEqual([e.status]);
			}
		});
	});
});

/**
 * Idempotency keys (`spec/idempotency.md`) beyond the shared vectors: what the vectors leave to each
 * language (D3's other surfaces, the store's interface, S12) and the proposal's exit criteria on an
 * effect applied once.
 */
import { type CommandContext, type CommandResult, failure, success } from '@lushly-dev/afd-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createDirectRegistry } from './direct-registry.js';
import { createDirectToolSurface } from './direct-tool-surface.js';
import { createIdempotencyStep } from './idempotency-step.js';
import { type IdempotencyStore, InMemoryIdempotencyStore } from './idempotency-store.js';
import { createRetryMiddleware } from './middleware.js';
import { defineCommand } from './schema.js';
import { createSharedHttpRuntime } from './server.js';
import type { McpHandlerOptions } from './server-types.js';

const agent = { kind: 'agent' as const, id: 'advisor' };
const disposers: Array<() => void> = [];
afterEach(() => {
	for (const dispose of disposers.splice(0)) dispose();
});

function runtime(options: Partial<McpHandlerOptions> & Pick<McpHandlerOptions, 'commands'>) {
	const built = createSharedHttpRuntime({ name: 'orders', version: '1.0.0', ...options });
	disposers.push(() => built.dispose());
	return built;
}

describe('what a command declares (D1, D3)', () => {
	const command = defineCommand({
		name: 'order-place',
		description: 'Places an order',
		mutation: true,
		idempotency: 'keyed',
		expose: { mcp: true },
		input: z.object({}),
		handler: async () => success({}),
	});

	it('reports idempotency in afd-detail and afd-help (full), and omits it when unset', async () => {
		const plain = defineCommand({
			name: 'order-list',
			description: 'Lists orders',
			expose: { mcp: true },
			input: z.object({}),
			handler: async () => success([]),
		});
		const server = runtime({ commands: [command, plain], bootstrap: true, toolStrategy: 'lazy' });
		const detail = await server.routeToolCall.route('afd-detail', {
			command: ['order-place', 'order-list'],
		});
		const entries = (detail as { value: { data: Array<Record<string, unknown>> } }).value.data;
		expect(entries[0]?.idempotency).toBe('keyed');
		expect(entries[1]).not.toHaveProperty('idempotency');
		const help = await server.engine.executeCommand('afd-help', { format: 'full' });
		const listed = JSON.stringify(help.data);
		expect(listed).toContain('"idempotency":"keyed"');
	});

	it('refuses a value that is neither natural nor keyed, at definition and registration', () => {
		expect(() =>
			defineCommand({
				name: 'order-bad',
				description: 'Bad',
				idempotency: 'always' as 'natural',
				input: z.object({}),
				handler: async () => success({}),
			})
		).toThrow(/natural' or 'keyed/);
		expect(() =>
			runtime({ commands: [{ ...command, idempotency: 'always' as 'natural' } as typeof command] })
		).toThrow(/natural' or 'keyed/);
	});

	it('refuses idempotencyKey as a declared context field: the name is reserved', () => {
		expect(() =>
			runtime({
				commands: [command],
				contextFields: [{ name: 'idempotencyKey', meta: 'dev.example/key', schema: z.string() }],
			})
		).toThrow(/idempotencyKey/);
	});
});

describe('the key before confirmation (K2, spec/dispatch.md)', () => {
	it('fails a malformed key ahead of CONFIRMATION_REQUIRED, and runs nothing', async () => {
		let runs = 0;
		const server = runtime({
			confirmations: 'enforce',
			commands: [
				defineCommand({
					name: 'order-wipe',
					description: 'Deletes every order',
					mutation: true,
					confirmPrompt: 'Delete every order?',
					expose: { mcp: true },
					input: z.object({}),
					handler: async () => {
						runs += 1;
						return success({});
					},
				}),
			],
		});
		const outcome = await server.routeToolCall.route(
			'afd-call',
			{ command: 'order-wipe', input: {} },
			{ idempotencyKey: 'a b' }
		);
		const result = (outcome as { value: CommandResult }).value;
		expect(result.error?.code).toBe('VALIDATION_ERROR');
		expect(result.error?.details?.meta).toBe('dev.afd/idempotencyKey');
		expect(runs).toBe(0);
	});
});

describe('a direct registry takes a step it is given (S1)', () => {
	function placeCommand(onRun: () => void) {
		return defineCommand({
			name: 'order-place',
			description: 'Places an order',
			mutation: true,
			idempotency: 'keyed',
			input: z.object({ sku: z.string() }),
			handler: async (input) => {
				onRun();
				return success({ sku: input.sku });
			},
		});
	}

	it('answers a keyed repeat from the store', async () => {
		let runs = 0;
		const registry = createDirectRegistry([placeCommand(() => runs++)], {
			idempotency: createIdempotencyStep(),
		});
		const first = await registry.execute('order-place', { sku: 'a' }, { idempotencyKey: 'k1' });
		const second = await registry.execute('order-place', { sku: 'a' }, { idempotencyKey: 'k1' });
		expect(first.metadata?.idempotentReplay).toBeUndefined();
		expect(second.metadata?.idempotentReplay).toBe(true);
		expect(second.data).toEqual({ sku: 'a' });
		expect(runs).toBe(1);
	});

	it('without a step, delivers and validates the key but answers nothing', async () => {
		let runs = 0;
		const registry = createDirectRegistry([placeCommand(() => runs++)]);
		await registry.execute('order-place', { sku: 'a' }, { idempotencyKey: 'k1' });
		await registry.execute('order-place', { sku: 'a' }, { idempotencyKey: 'k1' });
		expect(runs).toBe(2);
		const bad = await registry.execute('order-place', { sku: 'a' }, { idempotencyKey: 'k:1' });
		expect(bad.error?.code).toBe('VALIDATION_ERROR');
		expect(runs).toBe(2);
	});

	it('refuses options where a step belongs', () => {
		expect(() =>
			createDirectRegistry([placeCommand(() => {})], {
				idempotency: { ttlMs: 1000 } as never,
			})
		).toThrow(/createIdempotencyStep/);
	});
});

describe('the store (S12)', () => {
	const request = { digest: 'd', reservedAt: 0, expiresAt: 100, leaseEndsAt: 50 };

	it('reserves once per scope, and settles only the reservation it was made for', () => {
		const store = new InMemoryIdempotencyStore();
		const first = store.reserve('s', request, 0);
		expect(first.reserved).toBe(true);
		const second = store.reserve('s', request, 1);
		expect(second.reserved).toBe(false);
		store.complete('s', 'not-it', { kind: 'result', result: success(1) });
		store.release('s', 'not-it');
		expect(store.get('s', 2)?.state).toBe('reserved');
		if (!first.reserved) throw new Error('unreachable');
		store.complete('s', first.reservation, { kind: 'result', result: success(1) });
		expect(store.get('s', 2)?.state).toBe('stored');
	});

	it('forgets a record once it expires, and sweeps expired ones when full', () => {
		const store = new InMemoryIdempotencyStore({ sweepAt: 2 });
		store.reserve('a', request, 0);
		store.reserve('b', request, 0);
		expect(store.size).toBe(2);
		store.reserve('c', { ...request, reservedAt: 200, expiresAt: 300 }, 200);
		expect(store.size).toBe(1);
		expect(store.get('c', 300)?.state).toBe('reserved');
		expect(store.get('c', 301)).toBeUndefined();
	});

	it('keeps a copy, so a caller changing a replay does not change the store', async () => {
		const store = new InMemoryIdempotencyStore();
		const held = store.reserve('s', request, 0);
		if (!held.reserved) throw new Error('unreachable');
		store.complete('s', held.reservation, { kind: 'result', result: success({ n: 1 }) });
		const read = store.get('s', 1)?.result as CommandResult<{ n: number }>;
		(read.data as { n: number }).n = 2;
		const again = store.get('s', 1)?.result as CommandResult<{ n: number }>;
		expect(again.data).toEqual({ n: 1 });
	});

	it('sweeps when it doubles past what the last sweep left, not on every reservation', () => {
		const store = new InMemoryIdempotencyStore({ sweepAt: 2 });
		store.reserve('a', request, 0);
		store.reserve('b', request, 0);
		// Full of live keys: this sweep removes nothing, and the next waits for four.
		store.reserve('c', request, 0);
		expect(store.size).toBe(3);
		store.reserve('d', { ...request, reservedAt: 200, expiresAt: 300 }, 200);
		expect(store.size).toBe(4);
		store.reserve('e', { ...request, reservedAt: 200, expiresAt: 300 }, 200);
		expect(store.size).toBe(2);
	});

	it('keeps a JSON copy of a result structuredClone cannot copy', () => {
		const store = new InMemoryIdempotencyStore();
		const held = store.reserve('s', request, 0);
		if (!held.reserved) throw new Error('unreachable');
		const data = { n: 1, format: () => 'x' };
		store.complete('s', held.reservation, { kind: 'result', result: success(data) });
		data.n = 2;
		expect(store.get('s', 1)?.result?.data).toEqual({ n: 1 });
	});

	it('leaves the handler’s result standing when the store fails to keep it', async () => {
		const onError = vi.fn();
		const inner = new InMemoryIdempotencyStore();
		const store: IdempotencyStore = {
			reserve: (scope, req, now) => inner.reserve(scope, req, now),
			complete: () => {
				throw new Error('disk full');
			},
			release: (scope, reservation) => inner.release(scope, reservation),
			get: (scope, now) => inner.get(scope, now),
		};
		const server = runtime({
			onError,
			idempotency: { store },
			commands: [
				defineCommand({
					name: 'order-place',
					description: 'Places an order',
					mutation: true,
					idempotency: 'keyed',
					input: z.object({}),
					handler: async () => success({ placed: true }),
				}),
			],
		});
		const result = await server.engine.executeCommand(
			'order-place',
			{},
			{ actor: agent, idempotencyKey: 'k1' }
		);
		expect(result.success).toBe(true);
		expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'disk full' }));
	});
});

describe('a nested call starts without the key (K6), whatever the outer call ran as', () => {
	/** `note-read` notes its key; with `nest` it runs `note-read` again on its own context. */
	function nesting(
		nest: (
			route: ReturnType<typeof runtime>['routeToolCall'],
			context: CommandContext
		) => Promise<unknown>
	) {
		const seen: Array<string | null> = [];
		let route: ReturnType<typeof runtime>['routeToolCall'] | undefined;
		const server = runtime({
			commands: [
				defineCommand({
					name: 'note-read',
					description: 'Reads a note',
					expose: { mcp: true },
					input: z.object({ nest: z.boolean().optional() }),
					handler: async (input, context) => {
						seen.push((context.idempotencyKey as string | undefined) ?? null);
						if (input.nest && route) {
							const nested = (await nest(route, context)) as { value: CommandResult };
							if (nested.value.success === false) return nested.value;
						}
						return success({});
					},
				}),
			],
		});
		route = server.routeToolCall;
		return { server, seen };
	}
	const single = (route: ReturnType<typeof runtime>['routeToolCall'], context: CommandContext) =>
		route.route('afd-call', { command: 'note-read', input: {} }, context);
	const batch = (route: ReturnType<typeof runtime>['routeToolCall'], context: CommandContext) =>
		route.route('afd-batch', { commands: [{ command: 'note-read', input: {} }] }, context);

	it.each([
		['afd-batch', { commands: [{ command: 'note-read', input: { nest: true } }] }, 'k1:0'],
		['afd-pipe', { steps: [{ command: 'note-read', input: { nest: true } }] }, 'k1:step:0'],
	])('from %s', async (tool, args, derived) => {
		const { server, seen } = nesting(single);
		const outcome = await server.routeToolCall.route(tool, args, { idempotencyKey: 'k1' });
		expect(JSON.stringify(outcome)).not.toContain('VALIDATION_ERROR');
		expect(seen).toEqual([derived, null]);
	});

	it('as a nested batch, whose items derive nothing from the inherited key', async () => {
		const { server, seen } = nesting(batch);
		await server.routeToolCall.route(
			'afd-call',
			{ command: 'note-read', input: { nest: true } },
			{ idempotencyKey: 'k1' }
		);
		expect(seen).toEqual(['k1', null]);
	});
});

describe("a nested call's own key in a meta argument (K1, K6)", () => {
	it('applies, while the key the outer handler was given does not', async () => {
		const seen: Array<string | null> = [];
		const registry = createDirectRegistry(
			[
				defineCommand({
					name: 'note-read',
					description: 'Reads a note',
					input: z.object({ nest: z.boolean().optional() }),
					handler: async (input, context) => {
						seen.push((context.idempotencyKey as string | undefined) ?? null);
						if (input.nest) {
							await registry.execute(
								'afd-call',
								{ command: 'note-read', input: {}, meta: { 'dev.afd/idempotencyKey': 'k2' } },
								context
							);
							// And without one, the nested call carries none.
							await registry.execute('afd-call', { command: 'note-read', input: {} }, context);
						}
						return success({});
					},
				}),
			],
			{ tools: createDirectToolSurface() }
		);
		await registry.execute('note-read', { nest: true }, { idempotencyKey: 'k1' });
		expect(seen).toEqual(['k1', 'k2', null]);
		// A null key on the context is the caller's own "no key", and wins over meta, as over MCP.
		seen.length = 0;
		await registry.execute(
			'afd-call',
			{ command: 'note-read', input: {}, meta: { 'dev.afd/idempotencyKey': 'k2' } },
			{ idempotencyKey: null } as unknown as CommandContext
		);
		expect(seen).toEqual([null]);
	});
});

describe("a reservation's lease counts from when the call's deadline starts (S7)", () => {
	it('is still live after slow validation, while the handler runs within its deadline', async () => {
		const clock = { t: 0, now: () => clock.t };
		let slow = true;
		const release: { go?: () => void } = {};
		const held = new Promise<void>((resolve) => {
			release.go = resolve;
		});
		let runs = 0;
		const server = runtime({
			defaultTimeoutMs: null,
			clock,
			idempotency: {},
			commands: [
				defineCommand({
					name: 'order-place',
					description: 'Places an order',
					mutation: true,
					idempotency: 'keyed',
					// The first call's validation takes 70 s of the server's clock, past the lease.
					input: z.object({}).refine(() => {
						if (slow) clock.t += 70_000;
						slow = false;
						return true;
					}),
					handler: async () => {
						runs += 1;
						await held;
						return success({ placed: runs });
					},
				}),
			],
		});
		const context = { actor: agent, idempotencyKey: 'k1', timeout: 10_000 };
		const first = server.engine.executeCommand('order-place', {}, context);
		for (let tries = 0; runs === 0 && tries < 200; tries++) {
			await new Promise((resolve) => setTimeout(resolve, 1));
		}
		expect(runs).toBe(1);
		// The lease ends 70,000 (validation) + 10,000 (deadline) + 60,000 (lease) = 140,000 ms in.
		const repeatAt = async (t: number) => {
			clock.t = t;
			return (await server.engine.executeCommand('order-place', {}, context)).error?.code;
		};
		expect(await repeatAt(70_001)).toBe('IDEMPOTENCY_IN_PROGRESS');
		expect(await repeatAt(139_999)).toBe('IDEMPOTENCY_IN_PROGRESS');
		expect(await repeatAt(140_001)).toBe('OUTCOME_UNKNOWN');
		release.go?.();
		expect((await first).success).toBe(true);
	});
});

describe('the step binds the principal middleware leaves (S3, K5)', () => {
	it('keeps two callers apart that an auth middleware identifies', async () => {
		let runs = 0;
		const server = runtime({
			defaultTimeoutMs: null,
			idempotency: {},
			// Sets the actor from a session the call names, as an auth middleware does.
			middleware: [
				async (_name, _input, context, next) => {
					context.actor = { kind: 'human', id: String(context.session) };
					return next();
				},
			],
			commands: [
				defineCommand({
					name: 'order-place',
					description: 'Places an order',
					mutation: true,
					idempotency: 'keyed',
					input: z.object({}),
					handler: async () => success({ run: ++runs }),
				}),
			],
		});
		const call = (session: string) =>
			server.engine.executeCommand('order-place', {}, { session, idempotencyKey: 'k1' });
		const alice = await call('alice');
		const bob = await call('bob');
		expect(bob.metadata?.idempotentReplay).toBeUndefined();
		expect(bob.data).toEqual({ run: 2 });
		expect((await call('alice')).data).toEqual(alice.data);
	});
});

describe('a platform without WebCrypto (S4)', () => {
	it('refuses a keyed call with a structured failure and runs nothing', async () => {
		let runs = 0;
		const registry = createDirectRegistry(
			[
				defineCommand({
					name: 'order-place',
					description: 'Places an order',
					idempotency: 'keyed',
					input: z.object({}),
					handler: async () => success({ run: ++runs }),
				}),
			],
			{ idempotency: createIdempotencyStep() }
		);
		const subtle = vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementation(() => {
			throw new TypeError('crypto.subtle is undefined');
		});
		try {
			const result = await registry.execute('order-place', {}, { idempotencyKey: 'k1' });
			expect(result.error?.code).toBe('INTERNAL_ERROR');
			expect(result.error?.details?.reason).toBe('no-webcrypto');
			expect(result.error?.suggestion).toContain('HTTPS');
			expect(runs).toBe(0);
		} finally {
			subtle.mockRestore();
		}
	});
});

describe('several processes behind one address (S13)', () => {
	it("refuses an in-memory store with instances: 'multiple', and takes a shared one", () => {
		const commands = [
			defineCommand({
				name: 'order-place',
				description: 'Places an order',
				idempotency: 'keyed',
				input: z.object({}),
				handler: async () => success({}),
			}),
		];
		expect(() => runtime({ commands, instances: 'multiple', idempotency: {} })).toThrow(
			/idempotency step's store/
		);
		expect(() =>
			runtime({
				commands,
				instances: 'multiple',
				idempotency: { store: new InMemoryIdempotencyStore() },
			})
		).toThrow(/idempotency step's store/);
		// A store of the host's own, which every process is taken to share.
		const inner = new InMemoryIdempotencyStore();
		const shared: IdempotencyStore = {
			reserve: (scope, request, now) => inner.reserve(scope, request, now),
			complete: (scope, reservation, settlement) => inner.complete(scope, reservation, settlement),
			release: (scope, reservation) => inner.release(scope, reservation),
			get: (scope, now) => inner.get(scope, now),
		};
		expect(() =>
			runtime({ commands, instances: 'multiple', idempotency: { store: shared } })
		).not.toThrow();
	});
});

describe('exit criteria: an effect applied once (proposal, "Exit criteria")', () => {
	/**
	 * With the retry middleware installed and a handler that applies its effect and then returns
	 * TIMEOUT, a `mutation: true` command that is `keyed` or declares nothing applies it once, with
	 * a key and without; a `natural` one is repeated by design.
	 */
	it.each([
		{ idempotency: 'keyed', key: true, effects: 1 },
		{ idempotency: 'keyed', key: false, effects: 1 },
		{ idempotency: undefined, key: true, effects: 1 },
		{ idempotency: undefined, key: false, effects: 1 },
		{ idempotency: 'natural', key: false, effects: 4 },
	] as const)(
		'$idempotency mutation, key $key: $effects effect(s)',
		async ({ idempotency, key, effects }) => {
			let applied = 0;
			const server = runtime({
				defaultTimeoutMs: null,
				idempotency: {},
				middleware: [createRetryMiddleware({ retryDelay: 0 })],
				commands: [
					defineCommand({
						name: 'order-place',
						description: 'Places an order',
						mutation: true,
						...(idempotency && { idempotency }),
						input: z.object({}),
						handler: async (): Promise<CommandResult> => {
							applied += 1;
							return failure({
								code: 'TIMEOUT',
								message: 'The downstream call timed out after the write',
								suggestion: 'Check the effect',
								retryable: true,
							});
						},
					}),
				],
			});
			await server.engine.executeCommand(
				'order-place',
				{},
				{ actor: agent, ...(key && { idempotencyKey: 'k1' }) }
			);
			expect(applied).toBe(effects);
		}
	);
});

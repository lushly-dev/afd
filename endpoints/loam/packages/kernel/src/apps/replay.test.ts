import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { describe, expect, it, vi } from 'vitest';
import { LoamKernelError } from '../errors.js';
import { createKernel } from '../kernel.js';
import {
	createFixedEnvironment,
	createFixturePorts,
	createSteppingClock,
	createTestKernel,
	PROBE_MANIFEST,
	PROBE_SESSION,
	probeDefinition,
	probeDeployment,
	probeViewManifest,
	recordSession,
	replayKernel,
	type SessionCall,
} from '../testing.js';

const SANDBOX = 'https://sandbox.loam.test';

const probeOptions = () => ({
	deployment: probeDeployment(),
	ports: createFixturePorts({
		'apps/probe/': { manifest: PROBE_MANIFEST, definition: probeDefinition() },
	}),
});

describe('P2-E13: E9 (kernel unit): replay with apps', () => {
	it('replays a scripted session over `probe` with zero differences', async () => {
		const recorded = await recordSession(PROBE_SESSION, probeOptions());
		const replayed = await replayKernel(recorded.entries, probeOptions());
		expect(replayed.report.diverged).toBe(false);
		expect(replayed.report.same).toBe(recorded.entries.length);
		expect(replayed.layout).toEqual(recorded.layout);
	});

	it('answers load-dependent queries and nested calls from the record, and says so', async () => {
		const recorded = await recordSession(PROBE_SESSION, probeOptions());
		const { report } = await replayKernel(recorded.entries, probeOptions());
		const expected = recorded.entries
			.filter(
				(entry) =>
					['app-list', 'app-get'].includes(entry.command) || entry.context?.parent !== undefined
			)
			.map((entry) => entry.seq);
		expect(report.recorded).toEqual(expected);
		const nested = recorded.entries.filter((entry) => entry.context?.parent !== undefined);
		expect(nested.map((entry) => entry.command)).toEqual([
			'probe-list',
			'app-nested-refuse',
			'app-call-refuse',
		]);
	});

	it('replays a view app with no iframe, through the same definition in process', async () => {
		const options = () => ({
			deployment: probeDeployment(
				[{ instance: 'probev', app: 'probev', package: 'apps/probev/' }],
				SANDBOX
			),
			ports: createFixturePorts({
				'apps/probev/': {
					manifest: probeViewManifest(),
					definition: probeDefinition('probev'),
					files: { 'handlers.html': '<!doctype html>' },
				},
			}),
		});
		const calls: SessionCall[] = [
			{ interface: 'palette', name: 'app-open', input: { instance: 'probev' } },
			{ interface: 'palette', name: 'probev-note', input: { text: 'one' } },
			{ interface: 'agent', name: 'probev-note', input: { text: 'two' } },
			{ interface: 'palette', name: 'probev-count' },
			{ interface: 'palette', name: 'probev-sneak' },
		];
		const recorded = await recordSession(calls, options());
		const { report } = await replayKernel(recorded.entries, options());
		expect(report.diverged).toBe(false);
		expect(report.same).toBe(recorded.entries.length);
	});

	it('answers an app that was not ready from the record, since the page decided it', async () => {
		const failing = () => ({
			deployment: probeDeployment(),
			ports: createFixturePorts({
				'apps/probe/': { manifest: PROBE_MANIFEST, importError: new Error('Offline') },
			}),
		});
		const calls: SessionCall[] = [
			{ interface: 'palette', name: 'probe-list' },
			{ interface: 'palette', name: 'probe-list' },
		];
		const recorded = await recordSession(calls, failing());
		// After stage B's own `workspace-deployment-apply`.
		expect(recorded.entries[2]?.result.error?.code).toBe('APP_NOT_READY');
		// Even with a module that loads now: what the page decided then is on the record.
		const { report } = await replayKernel(recorded.entries, probeOptions());
		expect(report.diverged).toBe(false);
		expect(report.recorded).toEqual(recorded.entries.slice(1).map((entry) => entry.seq));
	});

	it('re-runs a failure an app returned itself, even with a code the page could decide', async () => {
		const definition = (fails: boolean) => {
			const base = probeDefinition();
			return {
				...base,
				handlers: {
					...base.handlers,
					// A query: its store cannot write (phase 2 specification, 5).
					'probe-hidden': (async () => {
						return fails
							? { success: false, error: { code: 'CALL_ABORTED', message: 'no', suggestion: 'x' } }
							: { success: true, data: {} };
					}) as never,
				},
			};
		};
		const options = (fails: boolean) => ({
			deployment: probeDeployment(),
			ports: createFixturePorts({
				'apps/probe/': { manifest: PROBE_MANIFEST, definition: definition(fails) },
			}),
		});
		const calls: SessionCall[] = [
			{ interface: 'agent', name: 'probe-hidden' },
			{ interface: 'palette', name: 'probe-list' },
		];
		const recorded = await recordSession(calls, options(true));
		const same = await replayKernel(recorded.entries, options(true));
		expect(same.report.diverged).toBe(false);
		expect(same.report.recorded).toEqual([]);
		// A handler that now succeeds is a difference.
		await expect(replayKernel(recorded.entries, options(false))).rejects.toThrow(LoamKernelError);
	});

	describe('nested calls against the record', () => {
		type NestedClient = {
			call(name: string, input?: unknown): Promise<{ error?: { code: string } }>;
		};
		const nestedDefinition = (run: (client: NestedClient) => Promise<unknown>) => {
			const base = probeDefinition();
			return {
				...base,
				handlers: {
					...base.handlers,
					'probe-count': (async (_input: never, context: { client: NestedClient }) => ({
						success: true,
						data: { seen: await run(context.client) },
					})) as never,
				},
			};
		};
		const optionsFor = (run: (client: NestedClient) => Promise<unknown>) => ({
			deployment: probeDeployment(),
			ports: createFixturePorts({
				'apps/probe/': { manifest: PROBE_MANIFEST, definition: nestedDefinition(run) },
			}),
		});
		const calls: SessionCall[] = [{ interface: 'palette', name: 'probe-count' }];
		const record = (run: (client: NestedClient) => Promise<unknown>) =>
			recordSession(calls, optionsFor(run));

		it('replays a nested call refused before the journal, which left no entry', async () => {
			const run = async (client: NestedClient) => {
				const invalid = await client.call('probe-list', { bad: 1 });
				const hidden = await client.call('probe-hidden');
				const listed = await client.call('probe-list');
				return [invalid.error?.code, hidden.error?.code, listed.error?.code ?? null];
			};
			const recorded = await record(run);
			const outer = recorded.entries.at(-1)?.result.data as { seen: unknown[] };
			expect(outer.seen).toEqual(['VALIDATION_ERROR', 'COMMAND_NOT_EXPOSED', null]);
			const { report } = await replayKernel(recorded.entries, optionsFor(run));
			expect(report.diverged).toBe(false);
		});

		it('diverges when the nested input changed', async () => {
			const recorded = await record((client) => client.call('probe-list', {}));
			// Stage B's own, the outer call and the nested one.
			expect(recorded.entries).toHaveLength(3);
			const changed = optionsFor((client) => client.call('probe-list', { other: 1 }));
			await expect(replayKernel(recorded.entries, changed)).rejects.toThrow(LoamKernelError);
		});

		it('diverges when a recorded nested call no longer happens, though the result is the same', async () => {
			const recorded = await record((client) => client.call('probe-list').then(() => null));
			const replay = replayKernel(
				recorded.entries,
				optionsFor(async () => null)
			);
			await expect(replay).rejects.toMatchObject({
				code: 'REPLAY_DIVERGED',
				details: {
					firstDifference: {
						difference: {
							replayed: "The handler did not call 'probe-list', which the journal records",
						},
					},
				},
			});
		});

		it('diverges when a handler calls another command, whatever it does with the answer', async () => {
			const recorded = await record((client) => client.call('probe-list').then(() => null));
			const changed = optionsFor((client) => client.call('probe-peek').then(() => null));
			await expect(replayKernel(recorded.entries, changed)).rejects.toThrow(LoamKernelError);
		});

		/** `probe` whose `probe-list` takes a `filter`, required or not, and whose `probe-count` runs `run`. */
		const filteredOptions = (
			required: boolean,
			run: (client: NestedClient) => Promise<unknown>
		) => ({
			deployment: probeDeployment(),
			ports: createFixturePorts({
				'apps/probe/': {
					manifest: {
						...PROBE_MANIFEST,
						commands: PROBE_MANIFEST.commands?.map((command) =>
							command.name === 'probe-list'
								? {
										...command,
										input_schema: {
											type: 'object',
											properties: { filter: { type: 'string' } },
											...(required ? { required: ['filter'] } : {}),
											additionalProperties: false,
										},
									}
								: command
						),
					},
					definition: nestedDefinition(run),
				},
			}),
		});

		it('#859: diverges when a nested call leaves out a key the recorded input had', async () => {
			const recorded = await recordSession(
				calls,
				filteredOptions(false, (client) => client.call('probe-list', { filter: 'a' }))
			);
			const nested = recorded.entries.find((entry) => entry.context?.parent !== undefined);
			expect(nested?.input).toEqual({ filter: 'a' });
			// `{}` asks for every report, not the filtered ones: the record's answer is not its answer.
			const unfiltered = filteredOptions(false, (client) => client.call('probe-list', {}));
			await expect(replayKernel(recorded.entries, unfiltered)).rejects.toMatchObject({
				code: 'REPLAY_DIVERGED',
			});
		});

		it('#859: a nested call validation refused live takes no entry, so the call after it gets its own', async () => {
			// `{}` is refused (no `filter`) and journals nothing; it holds every key of the next call's input.
			const run = async (client: NestedClient) => {
				const refused = await client.call('probe-list', {});
				const listed = await client.call('probe-list', { filter: 'a' });
				return [refused.error?.code, listed.error?.code ?? null];
			};
			const recorded = await recordSession(calls, filteredOptions(true, run));
			const outer = recorded.entries.at(-1)?.result.data as { seen: unknown } | undefined;
			expect(outer?.seen).toEqual(['VALIDATION_ERROR', null]);
			const { report } = await replayKernel(recorded.entries, filteredOptions(true, run));
			expect(report.diverged).toBe(false);
		});

		it('#859: diverges when the nested command is no longer exposed to the interface that calls it', async () => {
			const run = async (client: NestedClient) =>
				(await client.call('probe-list')).error?.code ?? null;
			const recorded = await recordSession(calls, optionsFor(run));
			const outer = recorded.entries.at(-1)?.result.data as { seen: unknown };
			expect(outer.seen).toBeNull();
			// The same app with `probe-list` hidden from the palette: live, the call is `COMMAND_NOT_EXPOSED`.
			const hidden = {
				deployment: probeDeployment(),
				ports: createFixturePorts({
					'apps/probe/': {
						manifest: {
							...PROBE_MANIFEST,
							commands: PROBE_MANIFEST.commands?.map((command) =>
								command.name === 'probe-list' ? { ...command, expose: { palette: false } } : command
							),
						},
						definition: nestedDefinition(run),
					},
				}),
			};
			await expect(replayKernel(recorded.entries, hidden)).rejects.toMatchObject({
				code: 'REPLAY_DIVERGED',
			});
		});

		it('passes an unchanged handler that returns a nested result as its own', async () => {
			const base = probeDefinition();
			const passThrough = {
				deployment: probeDeployment(),
				ports: createFixturePorts({
					'apps/probe/': {
						manifest: PROBE_MANIFEST,
						definition: {
							...base,
							handlers: {
								...base.handlers,
								'probe-count': (async (_input: never, context: { client: NestedClient }) =>
									context.client.call('probe-list')) as never,
							},
						},
					},
				}),
			};
			const recorded = await recordSession(calls, passThrough);
			const outer = recorded.entries.at(-1);
			expect(outer?.result.metadata?.['dev.loam/seq']).toBeUndefined();
			const { report } = await replayKernel(recorded.entries, passThrough);
			expect(report.diverged).toBe(false);
		});
	});

	it('replays two apps with an app-owned modal cancelled by the switch', async () => {
		const options = () => ({
			deployment: probeDeployment(
				[
					{ instance: 'probe', app: 'probe', package: 'apps/probe/' },
					{ instance: 'probev', app: 'probev', package: 'apps/probev/' },
				],
				SANDBOX
			),
			ports: createFixturePorts({
				'apps/probe/': { manifest: PROBE_MANIFEST, definition: probeDefinition() },
				'apps/probev/': {
					manifest: probeViewManifest(),
					definition: probeDefinition('probev'),
					files: { 'handlers.html': '<!doctype html>' },
				},
			}),
		});
		const { kernel, journal } = await createTestKernel(options());
		await kernel.call('app-open', { instance: 'probe' });
		const probe = kernel.appPort('probe');
		await probe.call('modal-open', { title: 'T', body: 'B' });
		await probe.call('toast-show', { message: 'Hi' });
		await probe.call('status-item-set', { id: 'count', value: '1' });
		await probe.call('app-selection-set', { instance: 'probe', id: 'a' });
		await probe.call('probev-note', { text: 'refused' });
		await kernel.call('app-open', { instance: 'probev' });
		await kernel.call('overlay-list');
		await probe.call('modal-open', { title: 'T', body: 'B' });
		await kernel.call('app-selection-get', { instance: 'probe' });
		const entries = await journal.read();
		await kernel.dispose();
		const { report } = await replayKernel(entries, options());
		expect(report.diverged).toBe(false);
		expect(report.same).toBe(entries.length);
	});

	it('forgets what a reload forgets, between the sessions of one journal', async () => {
		const store = new MemoryAdapter();
		const first = await createTestKernel({
			...probeOptions(),
			clock: createSteppingClock(1000),
			store,
		});
		await first.kernel.call('toast-show', { message: 'One' });
		await first.kernel.call('modal-open', { title: 'T', body: 'B' });
		const { journal } = first;
		await first.kernel.dispose();
		// The same store, as a reload keeps IndexedDB: stage B applies the deployment once.
		const second = await createKernel({
			store,
			storeKind: 'memory',
			journal,
			auth: new MockAuthAdapter(),
			environment: createFixedEnvironment(),
			host: 'test',
			clock: createSteppingClock(5000),
			...probeOptions(),
		});
		// A reload: a new trace base, no overlay left, and the counter from the start.
		const toast = await second.call<{ overlayId: string }>('toast-show', { message: 'Two' });
		expect(toast.data?.overlayId).toBe('ovl-1');
		expect((await second.call('modal-open', { title: 'T', body: 'B' })).success).toBe(true);
		await second.dispose();
		const { report } = await replayKernel(await journal.read(), probeOptions());
		expect(report.diverged).toBe(false);
	});

	it('#861: a reload made at once boots from the last app-open, so the replay does not diverge', async () => {
		const store = new MemoryAdapter();
		const first = await createTestKernel({
			...probeOptions(),
			clock: createSteppingClock(1000),
			store,
		});
		expect((await first.kernel.call('app-open', { instance: 'probe' })).success).toBe(true);
		const { journal } = first;
		// A reload that does not wait for `pagehide`'s flush, nor the debounce: no `flush()`, no `dispose()`.
		const second = await createKernel({
			store,
			storeKind: 'memory',
			journal,
			auth: new MockAuthAdapter(),
			environment: createFixedEnvironment(),
			host: 'test',
			clock: createSteppingClock(5000),
			...probeOptions(),
		});
		const closed = await second.call<{ closed: string | null }>('app-close');
		expect(closed.success).toBe(true);
		expect(await second.call('layout-get')).toMatchObject({ success: true });
		await second.dispose();
		await first.kernel.dispose();
		const { report } = await replayKernel(await journal.read(), probeOptions());
		expect(report.diverged).toBe(false);
	});

	/** A store whose writes of `loam.apps` a test can hold, or refuse. */
	class GatedStore extends MemoryAdapter {
		hold: Promise<void> | undefined;
		refuse = false;
		private async gate(table: string, id: string | undefined): Promise<void> {
			if (table !== 'settings' || id !== 'loam.apps') return;
			if (this.refuse) throw new Error('HTTP 500: storage refused');
			await this.hold;
		}
		override async update<T>(table: string, id: string, patch: Partial<T>): Promise<T> {
			await this.gate(table, id);
			return super.update(table, id, patch);
		}
		override async create<T>(table: string, data: Partial<T>): Promise<T> {
			await this.gate(table, (data as { id?: string }).id);
			return super.create(table, data);
		}
	}

	it('#861: a call that sees a change still being written is journaled after the call that made it', async () => {
		const store = new GatedStore();
		const { kernel, journal } = await createTestKernel({
			...probeOptions(),
			clock: createSteppingClock(1000),
			store,
		});
		let release!: () => void;
		store.hold = new Promise((resolve) => {
			release = resolve;
		});
		const first = kernel.call('app-open', { instance: 'probe' });
		// The first call has changed `loam.apps` and waits for the store; the second sees the app already open.
		await new Promise((resolve) => setTimeout(resolve, 0));
		const second = kernel.call('app-open', { instance: 'probe' });
		await new Promise((resolve) => setTimeout(resolve, 0));
		release();
		expect((await first).success).toBe(true);
		expect((await second).success).toBe(true);
		const opens = (await journal.read()).filter((entry) => entry.command === 'app-open');
		expect(opens.map((entry) => (entry.result.data as { previous: unknown }).previous)).toEqual([
			null,
			'probe',
		]);
		await kernel.dispose();
		const { report } = await replayKernel(await journal.read(), probeOptions());
		expect(report.diverged).toBe(false);
	});

	it('#861: a change the store did not save is warned of and journaled, and written again until it is', async () => {
		const store = new GatedStore();
		const { kernel, journal } = await createTestKernel({
			...probeOptions(),
			clock: createSteppingClock(1000),
			store,
		});
		store.refuse = true;
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const stored = async () =>
			((await store.get('settings', 'loam.apps')) as { value?: { active?: unknown } } | null)?.value
				?.active;
		// The app is open in memory, so the call succeeded; its warning says a reload would not find it.
		const opened = await kernel.call('app-open', { instance: 'probe' });
		expect(opened.success).toBe(true);
		expect(opened.warnings).toEqual([
			expect.objectContaining({
				code: 'VIEW_STATE_NOT_SAVED',
				details: { records: ['loam.apps'] },
			}),
		]);
		expect((await journal.read()).at(-1)?.result.warnings?.[0]?.code).toBe('VIEW_STATE_NOT_SAVED');
		expect(await stored()).toBeUndefined();
		// A call that changed nothing writes it again, and is not blamed for it.
		const again = await kernel.call('app-open', { instance: 'probe' });
		expect(again.success).toBe(true);
		expect(again.warnings ?? []).toEqual([]);
		expect(await stored()).toBeUndefined();
		// Once the store takes writes, the next call saves it, with no flush of its own.
		store.refuse = false;
		const read = await kernel.call('layout-get');
		expect(read.warnings ?? []).toEqual([]);
		expect(await stored()).toBe('probe');
		warn.mockRestore();
		await kernel.dispose();
	});

	it('answers an entry marked recorded from its record, and registers nothing', async () => {
		const recorded = await recordSession(
			[{ interface: 'palette', name: 'layout-get' }],
			probeOptions()
		);
		const entry = recorded.entries[0] as (typeof recorded.entries)[number];
		const marked = {
			...entry,
			command: 'work-hello-greet',
			context: { replay: 'recorded' },
			result: { success: true, data: { greeting: 'Hello, Ada!' } },
		};
		const { report } = await replayKernel([marked], probeOptions());
		expect(report.diverged).toBe(false);
		expect(report.recorded).toEqual([entry.seq]);
	});

	it('still replays the empty-shell session, reporting nothing recorded', async () => {
		const recorded = await recordSession([{ interface: 'palette', name: 'layout-get' }]);
		const { report } = await replayKernel(recorded.entries);
		expect(report.recorded).toEqual([]);
	});
});

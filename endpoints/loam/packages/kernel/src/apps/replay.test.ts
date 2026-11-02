import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { describe, expect, it } from 'vitest';
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

describe('E9 (kernel unit): replay with apps', () => {
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
		expect(recorded.entries[1]?.result.error?.code).toBe('APP_NOT_READY');
		// Even with a module that loads now: what the page decided then is on the record.
		const { report } = await replayKernel(recorded.entries, probeOptions());
		expect(report.diverged).toBe(false);
		expect(report.recorded).toEqual(recorded.entries.map((entry) => entry.seq));
	});

	it('re-runs a failure an app returned itself, even with a code the page could decide', async () => {
		const definition = (fails: boolean) => {
			const base = probeDefinition();
			return {
				...base,
				handlers: {
					...base.handlers,
					'probe-hidden': (async (
						_input: never,
						context: { store: { put(k: string, v: unknown): Promise<void> } }
					) => {
						await context.store.put('note-1', { text: 'kept' });
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
			expect(recorded.entries).toHaveLength(2);
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
		const first = await createTestKernel({ ...probeOptions(), clock: createSteppingClock(1000) });
		await first.kernel.call('toast-show', { message: 'One' });
		await first.kernel.call('modal-open', { title: 'T', body: 'B' });
		const { journal } = first;
		await first.kernel.dispose();
		const second = await createKernel({
			store: new MemoryAdapter(),
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

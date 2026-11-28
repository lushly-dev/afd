import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import type { JournalEntry } from '@lushly-dev/afd-core';
import { defineCommand, success } from '@lushly-dev/afd-server/define';
import type { IdentityV1 } from '@lushly-dev/loam-manifest';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LoamKernelError } from './errors.js';
import { createDefaultLayout } from './layout.js';
import {
	createFixedEnvironment,
	createReferenceWorkspace,
	createScopedWorkspace,
	createSeededRandom,
	createTestKernel,
	diffJournals,
	recordSession,
	replayKernel,
	SESSION_50,
	scopedDeployment,
	scopedPorts,
} from './testing.js';

describe('P2-E13: E2: a replayed journal reproduces the layout', () => {
	it('replays the scripted 50-call session over MemoryAdapter with zero differences', async () => {
		expect(SESSION_50).toHaveLength(50);
		const recorded = await recordSession(SESSION_50);
		// Every call is journaled, refusals included.
		expect(recorded.entries).toHaveLength(50);
		expect(recorded.entries.map((entry) => entry.seq)).toEqual(
			Array.from({ length: 50 }, (_, i) => i + 1)
		);
		expect(recorded.entries.filter((entry) => !entry.result.success).length).toBeGreaterThan(0);

		const replayed = await replayKernel(recorded.entries);
		expect(replayed.report.same).toBe(50);
		expect(replayed.report.different).toBe(0);
		expect(replayed.report.errors).toBe(0);
		expect(replayed.layout).toEqual(recorded.layout);
		expect(replayed.appearance).toEqual(recorded.appearance);
	});

	it('records the session through both interfaces', async () => {
		const { entries } = await recordSession(SESSION_50);
		const interfaces = new Set(entries.map((entry) => entry.contextDigest.interface));
		expect(interfaces).toEqual(new Set(['palette', 'agent']));
		const agentEntries = entries.filter((entry) => entry.contextDigest.interface === 'agent');
		expect(agentEntries.length).toBe(
			SESSION_50.filter((call) => call.interface === 'agent').length
		);
	});

	it('ends the session in the expected layout', async () => {
		const { layout, appearance } = await recordSession(SESSION_50);
		expect(layout).toEqual({
			version: 0,
			sidebar: { open: true, width: 300 },
			inspector: { open: true, width: 520 },
			panel: { open: false, height: 240, maximized: false },
			compact: { drawer: null, sheet: false },
		});
		expect(appearance).toEqual({ theme: 'system', density: 'comfortable', resolved: 'light' });
	});

	it('ignores the environment: a dark recording replays in a light environment', async () => {
		const recorded = await recordSession(SESSION_50, {
			environment: createFixedEnvironment(['(prefers-color-scheme: dark)']),
		});
		expect(recorded.appearance.resolved).toBe('dark');
		const replayed = await replayKernel(recorded.entries);
		expect(replayed.report.diverged).toBe(false);
		expect(replayed.appearance.resolved).toBe('light');
	});

	it('keeps the replayed kernel when asked, for a chrome to render', async () => {
		const recorded = await recordSession(SESSION_50);
		const { kernel, layout } = await replayKernel(recorded.entries, { keep: true });
		expect(kernel).toBeDefined();
		const live = await kernel?.call('layout-get');
		expect(live?.data).toEqual(layout);
		await kernel?.dispose();
		const { kernel: none } = await replayKernel(recorded.entries);
		expect(none).toBeUndefined();
	});

	it('creates a memory test kernel that journals its calls', async () => {
		const { kernel, journal } = await createTestKernel();
		await kernel.call('layout-set', { panel: { open: true } });
		const info = await kernel.call<{ host: string; store: string }>('shell-info-get');
		expect(info.data).toMatchObject({ host: 'test', store: 'memory' });
		expect((await journal.read()).map((entry) => entry.command)).toEqual([
			'layout-set',
			'shell-info-get',
		]);
		await kernel.dispose();
	});

	it('replays an empty journal to the defaults', async () => {
		const replayed = await replayKernel([]);
		expect(replayed.report.entries).toEqual([]);
		expect(replayed.layout).toEqual(createDefaultLayout());
	});

	it('refuses a journal that does not start at seq 1', async () => {
		const { entries } = await recordSession(SESSION_50);
		const error = await replayKernel(entries.slice(5)).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(LoamKernelError);
		expect((error as LoamKernelError).code).toBe('REPLAY_START_INVALID');
		expect((error as LoamKernelError).details).toEqual({ firstSeq: 6 });
	});

	it('replays an agent sign-in journaled before afd-auth took it off the agent surface', async () => {
		const { entries } = await recordSession(SESSION_50);
		const agent = entries.find(
			(entry) => entry.contextDigest?.interface === 'agent'
		) as JournalEntry;
		const last = entries.at(-1) as JournalEntry;
		// The agent entry's own fields, without its context or trace, which would tie this one to its call.
		const { context: _context, traceId: _traceId, ...fields } = structuredClone(agent);
		const refused: JournalEntry = {
			...fields,
			seq: last.seq + 1,
			command: 'auth-sign-in',
			input: { method: 'credentials', email: 'person@example.com' },
			result: {
				success: false,
				error: {
					code: 'HUMAN_REQUIRED',
					message:
						"'auth-sign-in' changes or lists what only the person may, so an agent cannot run it",
					suggestion: 'A person must do this in the shell',
					retryable: false,
				},
			},
		};
		const replayed = await replayKernel([...entries, refused]);
		expect(replayed.report.different).toBe(0);
		expect(replayed.report.errors).toBe(0);
		expect(replayed.report.same).toBe(entries.length + 1);
	});

	const redirectingMock = (url?: string) =>
		new (class extends MockAuthAdapter {
			override async signIn(options: Parameters<MockAuthAdapter['signIn']>[0]) {
				if (options.method === 'oauth') {
					return url === undefined
						? ({ kind: 'redirect' } as const)
						: ({ kind: 'redirect', url } as const);
				}
				return super.signIn(options);
			}
		})();

	it('replays a redirecting single sign-on auth-sign-in without diverging and leaves the Mock unauthenticated (#2954)', async () => {
		const url =
			'https://idp.example.com/oauth2/authorize?state=st4te-n0nce&code_challenge=ch4llenge';
		const { kernel, journal } = await createTestKernel({ auth: redirectingMock(url) });
		try {
			await kernel.call('layout-set', { sidebar: { width: 310 } });
			const redirected = await kernel.call('auth-sign-in', { method: 'oauth', provider: 'acme' });
			expect(redirected.success).toBe(true);
			expect(redirected.data).toEqual({ status: 'unauthenticated', session: null, user: null });
			expect(redirected.warnings?.some((warning) => warning.code === 'SIGN_IN_REDIRECT')).toBe(
				true
			);
			const after = await kernel.call('auth-session-get');
			expect(after.data).toEqual({ status: 'unauthenticated', session: null, user: null });
			const signedIn = await kernel.call('auth-sign-in', {
				method: 'credentials',
				email: 'bea@example.com',
				password: 'pw',
			});
			expect(signedIn.success).toBe(true);
			expect((await kernel.call('auth-session-get')).data).toMatchObject({
				status: 'authenticated',
				user: { email: 'bea@example.com' },
			});
			const entries = await journal.read();
			const replayed = await replayKernel(entries);
			expect(replayed.report.diverged).toBe(false);
			expect(replayed.report.different).toBe(0);
			expect(replayed.report.errors).toBe(0);
			expect(replayed.report.same).toBe(entries.length);
			// The redirecting `auth-sign-in` re-runs through the full pipeline with the replay Mock driven to the
			// same redirect outcome, leaving the Mock unauthenticated for the follow-up `auth-session-get`.
			expect(replayed.report.recorded).toEqual([]);
			expect(replayed.layout.sidebar.width).toBe(310);

			// Tampering with the recorded session state or sign-in method still diverges.
			const forgedSession: JournalEntry[] = structuredClone(entries);
			(forgedSession[1] as JournalEntry).result.data = {
				status: 'authenticated',
				user: { id: 'forged', email: 'forged@example.com', name: 'forged' },
				session: { id: 's', expiresAt: '2026-12-01T00:00:00.000Z' },
			};
			await expect(replayKernel(forgedSession)).rejects.toMatchObject({
				code: 'REPLAY_DIVERGED',
				details: { firstDifference: { seq: 2, command: 'auth-sign-in' } },
			});

			const forgedMethod: JournalEntry[] = structuredClone(entries);
			(forgedMethod[1] as JournalEntry).input = {
				method: 'credentials',
				email: 'bea@example.com',
			};
			await expect(replayKernel(forgedMethod)).rejects.toMatchObject({
				code: 'REPLAY_DIVERGED',
				details: { firstDifference: { seq: 2, command: 'auth-sign-in' } },
			});
		} finally {
			await kernel.dispose();
		}

		// A bare redirect with no `details.url` replays cleanly too.
		const bare = await createTestKernel({ auth: redirectingMock() });
		try {
			const redirected = await bare.kernel.call('auth-sign-in', {
				method: 'oauth',
				provider: 'acme',
			});
			expect(redirected.success).toBe(true);
			expect(redirected.warnings?.[0]?.details).toBeUndefined();
			const entries = await bare.journal.read();
			const replayed = await replayKernel(entries);
			expect(replayed.report.diverged).toBe(false);
			expect(replayed.report.recorded).toEqual([]);
		} finally {
			await bare.kernel.dispose();
		}
	});

	it('replays provider-mode SSO redirect, reload return, non-redirecting oauth, and enforces identity.methods (#2954)', async () => {
		// Synchronous Mock oauth sign-in (no `SIGN_IN_REDIRECT` warning) still re-runs and signs the replay's Mock in.
		const local = await createTestKernel();
		try {
			expect(
				(await local.kernel.call('auth-sign-in', { method: 'oauth', provider: 'acme' })).data
			).toMatchObject({ status: 'authenticated' });
			expect((await local.kernel.call('auth-session-get')).data).toMatchObject({
				status: 'authenticated',
			});
			const entries = await local.journal.read();
			const replayed = await replayKernel(entries);
			expect(replayed.report.diverged).toBe(false);
			expect(replayed.report.recorded).toEqual([]);
		} finally {
			await local.kernel.dispose();
		}

		// Provider mode: an unoffered provider is refused (`SIGN_IN_METHOD_UNAVAILABLE`), an offered redirecting SSO
		// sign-in keeps protected calls `UNAUTHORIZED`, and a reload back from the provider settles the person.
		const bea = 'mock-user-bea@example.com';
		const identity: IdentityV1 = {
			mode: 'provider',
			organization: 'acme',
			path: 'api/auth',
			methods: ['oidc:acme'],
		};
		const membership = {
			mode: 'provider' as const,
			members: new Map<string, 'owner' | 'admin' | 'member'>([[bea, 'member']]),
			digest: 'd1',
		};
		const store = new MemoryAdapter();
		const page1 = await createScopedWorkspace({
			store,
			auth: redirectingMock('https://idp.example.com/authorize?state=s1'),
			identity,
			membership,
			empty: true,
		});
		let firstEntries: JournalEntry[];
		try {
			const redirected = await page1.kernel.call('auth-sign-in', {
				method: 'oauth',
				provider: 'acme',
			});
			expect(redirected.success).toBe(true);
			expect((await page1.kernel.call('project-list')).error?.code).toBe('UNAUTHORIZED');
			const refused = await page1.kernel.call('auth-sign-in', {
				method: 'oauth',
				provider: 'other',
			});
			expect(refused.error?.code).toBe('SIGN_IN_METHOD_UNAVAILABLE');
			firstEntries = await page1.journal.read();
			await page1.kernel.flush();
		} finally {
			await page1.kernel.dispose();
		}

		const returnedAuth = new MockAuthAdapter();
		returnedAuth._setUser({ id: bea, email: 'bea@example.com', name: 'bea' });
		const page2 = await createScopedWorkspace({
			store,
			auth: returnedAuth,
			identity,
			membership,
			empty: true,
		});
		try {
			expect((await page2.kernel.call('project-list')).success).toBe(true);
			const secondEntries = await page2.journal.read();
			const combined: JournalEntry[] = [
				...firstEntries,
				...secondEntries.map((entry, index) => {
					const traceId = `reload-${index + 1}`;
					return {
						...entry,
						seq: firstEntries.length + index + 1,
						// Distinct trace base so replay treats page 2 as a reload back from the provider.
						traceId,
						result: entry.result.metadata
							? { ...entry.result, metadata: { ...entry.result.metadata, traceId } }
							: entry.result,
					};
				}),
			];
			const redirectEntry = firstEntries.find(
				(entry) => entry.command === 'auth-sign-in' && entry.result.success
			);
			const refusedEntry = firstEntries.find(
				(entry) => entry.command === 'auth-sign-in' && !entry.result.success
			);
			expect(redirectEntry).toBeDefined();
			expect(refusedEntry).toBeDefined();

			const replayed = await replayKernel(combined, {
				deployment: scopedDeployment(),
				ports: scopedPorts(),
				identity,
				membership,
			});
			expect(replayed.report.diverged).toBe(false);
			expect(replayed.report.recorded).not.toContain(redirectEntry?.seq);
			expect(replayed.report.recorded).not.toContain(refusedEntry?.seq);

			// Replaying the same redirecting SSO entry when `identity.methods` no longer allows `oidc:acme` diverges.
			const methodMismatch = await replayKernel(firstEntries, {
				deployment: scopedDeployment(),
				ports: scopedPorts(),
				identity: { ...identity, methods: ['passkey'] },
				membership,
			}).catch((caught: unknown) => caught);
			expect(methodMismatch).toBeInstanceOf(LoamKernelError);
			expect(methodMismatch).toMatchObject({
				code: 'REPLAY_DIVERGED',
				details: { firstDifference: { seq: redirectEntry?.seq, command: 'auth-sign-in' } },
			});
			const mismatchReport = (methodMismatch as LoamKernelError).details?.report as
				| { entries: Array<{ seq: number; replayed?: { error?: { code?: string } } }> }
				| undefined;
			const divergedEntry = mismatchReport?.entries.find(
				(entry) => entry.seq === redirectEntry?.seq
			);
			expect(divergedEntry?.replayed?.error?.code).toBe('SIGN_IN_METHOD_UNAVAILABLE');
		} finally {
			await page2.kernel.dispose();
		}
	});

	it('fails a divergence with the first difference', async () => {
		const { entries } = await recordSession(SESSION_50);
		const tampered: JournalEntry[] = structuredClone(entries);
		const target = tampered.findIndex(
			(entry) => entry.command === 'layout-set' && entry.result.success
		);
		const entry = tampered[target] as JournalEntry;
		(entry.result.data as { sidebar: { width: number } }).sidebar.width = 999;
		const error = await replayKernel(tampered).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(LoamKernelError);
		const refusal = error as LoamKernelError;
		expect(refusal.code).toBe('REPLAY_DIVERGED');
		expect(refusal.message).toContain(`seq ${entry.seq}`);
		expect(refusal.message).toContain('data.sidebar.width');
		expect(refusal.details?.firstDifference).toMatchObject({
			seq: entry.seq,
			command: 'layout-set',
			difference: { path: 'data.sidebar.width', kind: 'changed', recorded: 999 },
		});
	});

	it('replays extra commands given to the recording kernel', async () => {
		const reportsCreate = defineCommand({
			name: 'reports-create',
			description: 'Create a note',
			mutation: true,
			input: z.object({ title: z.string() }),
			async handler(input, context) {
				return success({ title: input.title, id: Math.floor((context.random?.next() ?? 0) * 1e6) });
			},
		});
		const commands = [reportsCreate as never];
		const recorded = await recordSession(
			// The person's: an agent's would ask first (phase 5's 6.1), and this is about the host's command replaying.
			[{ interface: 'palette', name: 'reports-create', input: { title: 'A' } }],
			{ commands }
		);
		expect(recorded.entries).toHaveLength(1);
		expect(recorded.entries[0]?.tape?.random).toHaveLength(1);
		const replayed = await replayKernel(recorded.entries, { commands });
		expect(replayed.report.same).toBe(1);
	});
});

describe('diffJournals (A3)', () => {
	it('finds two recordings of the same session equal, ignoring timestamps and durations', async () => {
		const a = await recordSession(SESSION_50);
		const b = await recordSession(SESSION_50, { start: Date.UTC(2027, 5, 1), seed: 'other' });
		expect(a.entries[0]?.timestamp).not.toBe(b.entries[0]?.timestamp);
		expect(diffJournals(a.entries, b.entries)).toEqual({
			equal: true,
			counts: { a: 50, b: 50, same: 50, different: 0 },
		});
	});

	it('names the first difference by index and field', async () => {
		const { entries } = await recordSession(SESSION_50);
		const commandChanged = structuredClone(entries);
		(commandChanged[3] as JournalEntry).command = 'layout-get';
		expect(diffJournals(entries, commandChanged).firstDifference).toEqual({
			index: 3,
			field: 'command',
		});

		const inputChanged = structuredClone(entries);
		(inputChanged[5] as JournalEntry).input = { sidebar: { width: 321 } };
		expect(diffJournals(entries, inputChanged)).toMatchObject({
			equal: false,
			firstDifference: { index: 5, field: 'input', path: 'sidebar.width' },
			counts: { same: 49, different: 1 },
		});

		const successChanged = structuredClone(entries);
		(successChanged[6] as JournalEntry).result = {
			success: false,
			error: { code: 'X', message: 'x' },
		};
		expect(diffJournals(entries, successChanged).firstDifference).toEqual({
			index: 6,
			field: 'success',
		});

		const resultChanged = structuredClone(entries);
		(resultChanged[1] as JournalEntry).result.data = { ...createDefaultLayout(), version: 1 };
		expect(diffJournals(entries, resultChanged).firstDifference).toEqual({
			index: 1,
			field: 'result',
			path: 'data.version',
		});
	});

	it('counts entries past the shorter journal as different', async () => {
		const { entries } = await recordSession(SESSION_50);
		expect(diffJournals(entries, entries.slice(0, 48))).toEqual({
			equal: false,
			firstDifference: { index: 48, field: 'length' },
			counts: { a: 50, b: 48, same: 48, different: 2 },
		});
	});

	it('takes extra ignored paths', async () => {
		const light = await recordSession(SESSION_50);
		const dark = await recordSession(SESSION_50, {
			environment: createFixedEnvironment(['(prefers-color-scheme: dark)']),
		});
		expect(diffJournals(light.entries, dark.entries).firstDifference).toMatchObject({
			field: 'result',
			path: 'data.resolved',
		});
		expect(diffJournals(light.entries, dark.entries, { ignore: ['data.resolved'] }).equal).toBe(
			true
		);
	});
});

// These build a reference workspace of up to 5,000 commands and record and replay 400 calls; a loaded machine running
// all packages at once (a pre-push over a tooling change) took them past vitest's 5 s default.
describe('createReferenceWorkspace (D37)', { timeout: 30_000 }, () => {
	it('is deterministic for a seed', () => {
		const a = createReferenceWorkspace({ seed: 'phase-0', size: 500 });
		const b = createReferenceWorkspace({ seed: 'phase-0', size: 500 });
		const c = createReferenceWorkspace({ seed: 'other', size: 500 });
		expect(a).toEqual(b);
		expect(a.commands).not.toEqual(c.commands);
	});

	it('generates size unique, valid command names and 200 queries', () => {
		const workspace = createReferenceWorkspace({ seed: 'phase-0', size: 5000 });
		expect(workspace.commands).toHaveLength(5000);
		const names = workspace.commands.map((command) => command.name);
		expect(new Set(names).size).toBe(5000);
		for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)+$/);
		expect(workspace.queries).toHaveLength(200);
		expect(workspace.calls).toHaveLength(5000);
	});

	it('generates calls that are all journaled and replay without differences', async () => {
		const workspace = createReferenceWorkspace({ seed: 'phase-0', size: 400 });
		const recorded = await recordSession(workspace.calls);
		expect(recorded.entries).toHaveLength(400);
		const replayed = await replayKernel(recorded.entries);
		expect(replayed.report.same).toBe(400);
		const again = await recordSession(workspace.calls, { seed: 'second' });
		expect(diffJournals(recorded.entries, again.entries).equal).toBe(true);
	});

	it('gives its documents the type the caller names, and needs one when there are documents', () => {
		const documentType = { type: 'reference', instance: 'reference-a' };
		const workspace = createReferenceWorkspace({ seed: 'x', size: 1, documents: 3, documentType });
		expect(workspace.documents.map(({ type, instance }) => ({ type, instance }))).toEqual(
			Array(3).fill(documentType)
		);
		expect(createReferenceWorkspace({ seed: 'x', size: 1, links: 5 }).documents).toEqual([]);
		expect(() => createReferenceWorkspace({ seed: 'x', size: 1, documents: 3 })).toThrow(
			/documentType/
		);
	});

	it('seeds a random source in [0, 1)', () => {
		const random = createSeededRandom('x');
		const values = Array.from({ length: 1000 }, random);
		expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
		expect(createSeededRandom('x')()).toBe(values[0]);
	});
});

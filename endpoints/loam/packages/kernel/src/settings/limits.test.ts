/**
 * P4-E10's units (phase 4 specification, section 11 and 19; D124): `loam.limits` and its quarter rule, each limit's
 * refusal with its details where section 11 enforces it, `limit-usage-get` and its hand-offs, the owner notice's seam,
 * `store-usage-settle`, and a replay stopping at a truncated entry. The defaults holding when `late-settings` fails are
 * `late-settings-failure.test.ts`'s; the view broker's message bound is `apps/view-broker.test.ts`'s.
 */

import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import type { JournalEntry } from '@lushly-dev/afd-core';
import { MemoryJournalSink } from '@lushly-dev/afd-core';
import type { IdentityV1, ProjectionV3 } from '@lushly-dev/loam-manifest';
import { type AppCallContextV1, defineApp, failure, success } from '@lushly-dev/loam-sdk';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, describe, expect, it } from 'vitest';
import { STORE_USAGE_TABLE, storeUsageId } from '../apps/store.js';
import { createKernelParts } from '../kernel.js';
import { LIMIT_DEFAULTS, LIMIT_KEYS } from '../limits.js';
import type { MembershipV1 } from '../scope/access.js';
import {
	createScopedWorkspace,
	DUAL_DEFINITION,
	DUAL_MANIFEST,
	type ScopedWorkspace,
	type ScopedWorkspaceOptions,
	scopedDeployment,
	scopedPackages,
} from '../scope/fixtures.js';
import {
	createFixedEnvironment,
	createFixturePorts,
	createSteppingClock,
	replayKernel,
} from '../testing.js';
import type { LoamKernel } from '../types.js';
import { LIMIT_KEY_ORDER, QUARTER_ORDER } from './limit-commands.js';
import { LIMITS_SECTION } from './setting-sections.js';

const kernels: LoamKernel[] = [];
/** Headroom for tests that issue >200 sequential journaled port calls under CPU load (#2760). */
const BURST_TEST_TIMEOUT_MS = 30_000;
afterEach(async () => {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.dispose()));
});

/** Dual, whose `dual-put` answers a store's refusal as its own failure, with the code and details it was given. */
const CATCHING = defineApp({
	sdk: 1,
	handlers: {
		...DUAL_DEFINITION.handlers,
		'dual-put': (async (input: { key: string; value: string }, context: AppCallContextV1) => {
			try {
				await context.store?.put(input.key, input.value);
				return success({ key: input.key });
			} catch (cause) {
				const { code, message, suggestion, details } = cause as {
					code: string;
					message: string;
					suggestion: string;
					details?: Record<string, unknown>;
				};
				return failure({ code, message, suggestion, ...(details ? { details } : {}) });
			}
		}) as never,
	},
});

const ports = () =>
	createFixturePorts({
		...scopedPackages(),
		'fixtures/dual/': { manifest: DUAL_MANIFEST, definition: CATCHING },
	});

/** A replay of the scoped workspace's journal, over the same packages. */
const replay = (entries: JournalEntry[]) =>
	replayKernel(entries, { deployment: scopedDeployment(), ports: ports() });

async function workspace(options: ScopedWorkspaceOptions = {}): Promise<ScopedWorkspace> {
	const made = await createScopedWorkspace({ ports: ports(), ...options });
	kernels.push(made.kernel);
	return made;
}

const setLimit = (kernel: LoamKernel, key: string, value: number) =>
	kernel.call('setting-set', { section: 'loam.limits', key, value, level: 'workspace' });

type Usage = {
	instances: Array<{
		instance: string;
		storeBytes: { used: number; limit: number };
		refusals: Record<string, number>;
	}>;
};

const PROVIDER: IdentityV1 = {
	mode: 'provider',
	organization: 'acme',
	path: 'api/auth',
	methods: ['passkey', 'password'],
};
const ACME = (): MembershipV1 => ({
	mode: 'provider',
	members: new Map([
		['mock-user-bea@example.com', 'member'],
		['mock-user-olu@example.com', 'owner'],
	]),
	digest: 'd1',
});
const signIn = (kernel: LoamKernel, email: string) =>
	kernel.call('auth-sign-in', { method: 'credentials', email, password: 'x' });

describe('P4-E10: loam.limits (section 11, 3.7)', () => {
	it('declares the five keys with the defaults the kernel enforces from boot', () => {
		const keys = LIMITS_SECTION.schema.properties as Record<string, { default: number }>;
		expect(Object.keys(keys)).toEqual([...LIMIT_KEYS]);
		expect(LIMIT_KEY_ORDER).toEqual([...LIMIT_KEYS]);
		for (const key of LIMIT_KEYS) expect(keys[key]?.default, key).toBe(LIMIT_DEFAULTS[key]);
		expect(LIMITS_SECTION.levels).toEqual(['workspace']);
	});

	it('reads the defaults, and holds each key to its bounds', async () => {
		const { kernel } = await workspace({ empty: true });
		const read = await kernel.call<{ value: number; from: string }>('setting-get', {
			section: 'loam.limits',
			key: 'callsPerSecond',
		});
		expect(read.data).toEqual({ value: 50, from: 'default' });
		for (const [key, value] of [
			['messageBytes', 65_535],
			['inputBytes', 1_048_577],
			['callsPerSecond', 4],
			['storeBytes', 268_435_457],
			['journalEntryBytes', 262_143],
		] as const) {
			expect((await setLimit(kernel, key, value)).error?.code, key).toBe('VALIDATION_ERROR');
		}
		// Workspace only, as 3.7 says.
		expect(
			(
				await kernel.call('setting-set', {
					section: 'loam.limits',
					key: 'callsPerSecond',
					value: 10,
					level: 'person',
				})
			).error?.code
		).toBe('SETTING_LEVEL_UNAVAILABLE');
	});

	it('keeps the quarter rule, its suggestion naming the order (P4-E10, F3)', async () => {
		const { kernel } = await workspace({ empty: true });
		const halved = await setLimit(kernel, 'journalEntryBytes', 524_288);
		expect(halved.error).toMatchObject({
			code: 'VALIDATION_ERROR',
			suggestion: QUARTER_ORDER,
			details: { field: 'value' },
		});
		expect(halved.error?.message).toContain('a quarter of journalEntryBytes');
		expect((await setLimit(kernel, 'inputBytes', 300_000)).error?.suggestion).toBe(QUARTER_ORDER);
		// Raise journalEntryBytes first, then inputBytes.
		expect((await setLimit(kernel, 'journalEntryBytes', 2_097_152)).success).toBe(true);
		expect((await setLimit(kernel, 'inputBytes', 300_000)).success).toBe(true);
		// A reset is held to it too: the default journalEntryBytes would be under four times 300,000.
		const reset = await kernel.call('setting-reset', {
			section: 'loam.limits',
			key: 'journalEntryBytes',
			level: 'workspace',
		});
		expect(reset.error?.suggestion).toBe(QUARTER_ORDER);
		// Lower inputBytes first, then journalEntryBytes.
		expect((await setLimit(kernel, 'inputBytes', 131_072)).success).toBe(true);
		expect((await setLimit(kernel, 'journalEntryBytes', 524_288)).success).toBe(true);
	});

	it("is an owner's: an agent gets the hand-off, and a member OWNER_REQUIRED", async () => {
		const { kernel } = await workspace({ empty: true });
		const agent = await kernel.agent.call('setting-set', {
			section: 'loam.limits',
			key: 'callsPerSecond',
			value: 10,
			level: 'workspace',
		});
		expect(agent.error).toMatchObject({
			code: 'HUMAN_REQUIRED',
			details: {
				route: '~/settings/loam.limits#callsPerSecond',
				section: 'loam.limits',
				key: 'callsPerSecond',
				level: 'workspace',
			},
		});
		const provider = await workspace({ identity: PROVIDER, membership: ACME(), empty: true });
		await signIn(provider.kernel, 'bea@example.com');
		expect((await setLimit(provider.kernel, 'callsPerSecond', 10)).error?.code).toBe(
			'OWNER_REQUIRED'
		);
	});
});

describe('a hosted provider deployment (section 13)', () => {
	it("refuses an owner's write of loam.limits, writing nothing, and still enforces the defaults", async () => {
		const { kernel } = await workspace({
			identity: PROVIDER,
			membership: ACME(),
			empty: true,
			deployment: {
				...scopedDeployment(),
				deployment_version: 4,
				generation: 'hosted',
				host: { kind: 'hosted', kernel: 'api/kernel' },
			} as unknown as ProjectionV3,
		});
		await signIn(kernel, 'olu@example.com');
		expect((await setLimit(kernel, 'callsPerSecond', 10)).error?.code).toBe(
			'SHARED_RECORD_UNAVAILABLE'
		);
		expect(
			(await kernel.call('setting-get', { section: 'loam.limits', key: 'callsPerSecond' })).data
		).toEqual({ value: 50, from: 'default' });
		const over = await kernel
			.appPort('dual')
			.call('dual-put', { key: 'k', value: 'x'.repeat(262_144) });
		expect(over.error).toMatchObject({ code: 'INPUT_TOO_LARGE', details: { limit: 262_144 } });
	});
});

describe("P4-E10: each limit's refusal (section 11, 16)", () => {
	it('refuses an input over inputBytes at the port, journaled without it', async () => {
		const { kernel, journal } = await workspace({ empty: true });
		const port = kernel.appPort('dual');
		const over = await port.call('dual-put', { key: 'k', value: 'x'.repeat(262_144) });
		expect(over.error).toMatchObject({
			code: 'INPUT_TOO_LARGE',
			retryable: false,
			details: { limit: 262_144 },
		});
		expect(over.error?.suggestion).toContain('loam.limits.inputBytes');
		// The first refusal in an hour also schedules the owners' notice (`limit-notice-push`), which may be journaled
		// before this read (#2016), so find the refusal rather than take the last entry.
		const refusals = (await journal.read()).filter((each) => each.command === 'app-limit-refuse');
		expect(refusals).toHaveLength(1);
		const entry = refusals[0] as JournalEntry;
		expect(entry.input).toEqual({ command: 'dual-put', limit: 'inputBytes', bound: 262_144 });
		expect((await port.call('dual-put', { key: 'k', value: 'small' })).success).toBe(true);
		// An owner lowers it, and the port holds to the new value at once.
		expect((await setLimit(kernel, 'inputBytes', 16_384)).success).toBe(true);
		const lowered = await port.call('dual-put', { key: 'k', value: 'x'.repeat(20_000) });
		expect(lowered.error?.details).toEqual({ limit: 16_384 });
		// A person's own call is not a port's, and is bounded by the journal entry alone.
		expect((await kernel.call('dual-put', { key: 'k', value: 'x'.repeat(20_000) })).success).toBe(
			true
		);
	});

	it(
		'refuses calls over callsPerSecond, after the burst of 200, with when to retry',
		async () => {
			const { kernel } = await workspace({ empty: true });
			expect((await setLimit(kernel, 'callsPerSecond', 5)).success).toBe(true);
			const port = kernel.appPort('dual');
			let refused: Awaited<ReturnType<typeof port.call>> | undefined;
			let made = 0;
			while (!refused && made < 400) {
				const result = await port.call('dual-where', {});
				made += 1;
				if (!result.success) refused = result;
			}
			// The burst, plus what the stepping clock's milliseconds refilled at 5 a second.
			expect(made).toBeGreaterThan(200);
			expect(refused?.error).toMatchObject({
				code: 'RATE_LIMITED',
				retryable: true,
				details: { limit: 5 },
			});
			const { retryAfterMs } = (refused?.error?.details ?? {}) as { retryAfterMs: number };
			expect(retryAfterMs).toBeGreaterThan(0);
			expect(retryAfterMs).toBeLessThanOrEqual(200);
			expect(refused?.error?.suggestion).toContain('loam.limits.callsPerSecond');
			// Another app's rate is its own.
			expect((await kernel.appPort('solo').call('solo-where', {})).success).toBe(true);
		},
		BURST_TEST_TIMEOUT_MS
	);

	it('refuses a store write past storeBytes, with its details, and counts what is kept', async () => {
		const { kernel, store } = await workspace({ empty: true });
		expect((await setLimit(kernel, 'inputBytes', 65_536)).success).toBe(true);
		expect((await setLimit(kernel, 'storeBytes', 1_048_576)).success).toBe(true);
		const port = kernel.appPort('dual');
		const value = 'v'.repeat(60_000);
		let refused: Awaited<ReturnType<typeof port.call>> | undefined;
		let written = 0;
		while (!refused && written < 30) {
			const result = await port.call('dual-put', { key: `k${written}`, value });
			if (result.success) written += 1;
			else refused = result;
		}
		expect(written).toBe(17);
		expect(refused?.error).toMatchObject({
			code: 'QUOTA_EXCEEDED',
			details: { kind: 'store', limit: 1_048_576 },
		});
		const { used } = (refused?.error?.details ?? {}) as { used: number };
		expect(used).toBeGreaterThan(1_048_576 - 60_100);
		expect(refused?.error?.suggestion).toContain('loam.limits.storeBytes');
		const row = await store.get<{ used: number; workspace: string }>(
			STORE_USAGE_TABLE,
			storeUsageId('personal', 'dual')
		);
		expect(row).toMatchObject({ used, workspace: 'personal' });
		// Overwriting with less, and deleting, always lands, and the count follows.
		expect((await port.call('dual-put', { key: 'k0', value: 'small' })).success).toBe(true);
		expect((await port.call('dual-put', { key: 'k17', value })).success).toBe(true);
	});

	it('keeps an entry over journalEntryBytes truncated and unreplayable, and a replay stops there', async () => {
		const { kernel, journal } = await workspace({ empty: true });
		expect((await setLimit(kernel, 'inputBytes', 65_536)).success).toBe(true);
		expect((await setLimit(kernel, 'journalEntryBytes', 262_144)).success).toBe(true);
		expect((await kernel.call('dual-put', { key: 'k', value: 'x'.repeat(300_000) })).success).toBe(
			true
		);
		const entries = await journal.read();
		const kept = entries.at(-1) as JournalEntry & { unreplayable?: boolean; bytes?: number };
		expect(kept).toMatchObject({ command: 'dual-put', unreplayable: true, input: {} });
		expect(kept.bytes).toBeGreaterThan(300_000);
		expect(JSON.stringify(kept).length).toBeLessThan(262_144);
		expect(kernel.appPort('dual')).toBeDefined();
		await expect(replay(entries)).rejects.toMatchObject({
			code: 'REPLAY_ENTRY_TRUNCATED',
			details: { seq: kept.seq, command: 'dual-put' },
			suggestion: `Replay up to seq ${kept.seq - 1} only`,
		});
		// Up to the entry before it, the replay passes.
		await expect(replay(entries.slice(0, -1))).resolves.toBeDefined();
	});
});

describe('P4-E10: limit-usage-get (section 11, F3)', () => {
	it("reports each limit's refusals in the hour, and each app's stored bytes, ordered by instance", async () => {
		const { kernel } = await workspace({ empty: true });
		const port = kernel.appPort('dual');
		expect((await port.call('dual-put', { key: 'a', value: 'x'.repeat(300_000) })).success).toBe(
			false
		);
		expect((await port.call('dual-put', { key: 'a', value: 'kept' })).success).toBe(true);
		expect((await setLimit(kernel, 'journalEntryBytes', 2_097_152)).success).toBe(true);
		expect((await setLimit(kernel, 'journalEntryBytes', 1_048_576)).success).toBe(true);
		// A person's call to the app's command over the journal entry counts against the app.
		await kernel.call('dual-put', { key: 'b', value: 'x'.repeat(1_100_000) });
		const read = await kernel.call<Usage>('limit-usage-get', {});
		expect(read.success).toBe(true);
		expect(read.data?.instances.map((row) => row.instance)).toEqual(['dual', 'solo', 'tasks']);
		const dual = read.data?.instances[0];
		expect(dual?.storeBytes.limit).toBe(26_214_400);
		expect(dual?.storeBytes.used).toBeGreaterThan(1_100_000);
		expect(dual?.refusals).toEqual({
			messageBytes: 0,
			inputBytes: 1,
			callsPerSecond: 0,
			storeBytes: 0,
			journalEntryBytes: 1,
		});
		expect(read.data?.instances[1]?.refusals.inputBytes).toBe(0);
		const one = await kernel.call<Usage>('limit-usage-get', { instance: 'solo' });
		expect(one.data?.instances.map((row) => row.instance)).toEqual(['solo']);
		expect((await kernel.call('limit-usage-get', { instance: 'Nope!' })).error?.code).toBe(
			'VALIDATION_ERROR'
		);
		expect((await kernel.call('limit-usage-get', { extra: 1 })).error?.code).toBe(
			'VALIDATION_ERROR'
		);
	});

	it(
		"counts a refusal of every limit the kernel enforces on one instance (F3); messageBytes is the broker's",
		async () => {
			const { kernel } = await workspace({ empty: true });
			const port = kernel.appPort('dual');
			// inputBytes, at the port.
			expect((await port.call('dual-put', { key: 'a', value: 'x'.repeat(300_000) })).success).toBe(
				false
			);
			// journalEntryBytes, a person's call to the app's command over the journal entry.
			await kernel.call('dual-put', { key: 'b', value: 'x'.repeat(1_100_000) });
			// storeBytes, with the quota at its least.
			expect((await setLimit(kernel, 'inputBytes', 65_536)).success).toBe(true);
			expect((await setLimit(kernel, 'storeBytes', 1_048_576)).success).toBe(true);
			let stored: { success: boolean } = { success: true };
			for (let index = 0; stored.success && index < 40; index += 1)
				stored = await port.call('dual-put', { key: `s${index}`, value: 'v'.repeat(60_000) });
			expect(stored.success).toBe(false);
			// callsPerSecond, past the burst.
			expect((await setLimit(kernel, 'callsPerSecond', 5)).success).toBe(true);
			let paced: { success: boolean } = { success: true };
			for (let index = 0; paced.success && index < 400; index += 1)
				paced = await port.call('dual-where', {});
			expect(paced.success).toBe(false);
			const dual = (await kernel.call<Usage>('limit-usage-get', { instance: 'dual' })).data
				?.instances[0];
			expect(dual?.storeBytes.limit).toBe(1_048_576);
			for (const key of ['inputBytes', 'callsPerSecond', 'storeBytes', 'journalEntryBytes'])
				expect(dual?.refusals[key], key).toBeGreaterThanOrEqual(1);
			// Every one of section 11's limits is reported, the broker's own messageBytes among them (its count is
			// `view-broker.test.ts`'s, for a view; dual is native, so none here).
			expect(Object.keys(dual?.refusals ?? {}).sort()).toEqual([...LIMIT_KEYS].sort());
			expect(dual?.refusals.messageBytes).toBe(0);
		},
		BURST_TEST_TIMEOUT_MS
	);

	it('gives an agent HUMAN_REQUIRED in its handler, a member OWNER_REQUIRED, and a port CALL_NOT_GRANTED', async () => {
		const made = await workspace({ empty: true });
		const agent = await made.kernel.agent.call('limit-usage-get', {});
		expect(agent.error).toMatchObject({
			code: 'HUMAN_REQUIRED',
			details: { route: '~/settings/loam.limits', section: 'loam.limits', level: 'workspace' },
		});
		expect(agent.error?.suggestion).toContain('~/settings/loam.limits');
		expect((await made.kernel.appPort('dual').call('limit-usage-get', {})).error?.code).toBe(
			'CALL_NOT_GRANTED'
		);
		const served = made.mcpOptions()?.commands.map(({ name }) => name) ?? [];
		expect(served).not.toContain('limit-usage-get');
		const provider = await workspace({ identity: PROVIDER, membership: ACME(), empty: true });
		await signIn(provider.kernel, 'bea@example.com');
		expect((await provider.kernel.call('limit-usage-get', {})).error?.code).toBe('OWNER_REQUIRED');
		await provider.kernel.call('auth-sign-out');
		await signIn(provider.kernel, 'olu@example.com');
		expect((await provider.kernel.call('limit-usage-get', {})).success).toBe(true);
	});

	it('tells the seam the first refusal of an instance in an hour, and only the first', async () => {
		const made = await workspace({ empty: true });
		const told: Array<{ instance: string; limit: string }> = [];
		made.limits.notify = (refusal) =>
			told.push({ instance: refusal.instance, limit: refusal.limit });
		const port = made.kernel.appPort('dual');
		await port.call('dual-put', { key: 'a', value: 'x'.repeat(300_000) });
		await port.call('dual-put', { key: 'a', value: 'x'.repeat(300_000) });
		expect(told).toEqual([{ instance: 'dual', limit: 'inputBytes' }]);
		await made.kernel.appPort('solo').call('solo-put', { key: 'a', value: 'x'.repeat(300_000) });
		expect(told).toEqual([
			{ instance: 'dual', limit: 'inputBytes' },
			{ instance: 'solo', limit: 'inputBytes' },
		]);
	});
});

describe('the trust review of step 10', () => {
	it(
		'refuses a nested call over the rate inside a handler that runs, and the session replays (10)',
		async () => {
			// A clock that never moves, so nothing refills: the outer call takes the last place, its nested calls none.
			const { kernel, journal } = await workspace({ empty: true, clock: () => 1_000_000 });
			expect((await setLimit(kernel, 'callsPerSecond', 5)).success).toBe(true);
			const port = kernel.appPort('dual');
			for (let i = 0; i < 199; i++) expect((await port.call('dual-where', {})).success).toBe(true);
			const outer = await port.call<{ here?: unknown; wide?: unknown }>('dual-nested', {});
			expect(outer.success).toBe(true);
			expect(outer.data).toEqual({});
			const entries = await journal.read();
			const parent = entries.find((entry) => entry.command === 'dual-nested')?.traceId;
			const nested = entries.filter((entry) => entry.context?.parent === parent);
			expect(nested.map((entry) => [entry.command, entry.result.error?.code])).toEqual([
				['app-limit-refuse', 'RATE_LIMITED'],
				['app-limit-refuse', 'RATE_LIMITED'],
			]);
			expect(nested[0]?.input).toMatchObject({ command: 'dual-where', limit: 'callsPerSecond' });
			await kernel.call('limit-usage-get', {});
			const result = await replay(await journal.read());
			expect(result.report.diverged).toBe(false);
		},
		BURST_TEST_TIMEOUT_MS
	);

	it('measures and dispatches one JSON copy of the input, and refuses one with no JSON form (R2, 7)', async () => {
		const { kernel, journal } = await workspace({ empty: true });
		const port = kernel.appPort('dual');
		// What runs is the copy that was measured: `toJSON`'s answer, never the object it came from.
		const tricky = { toJSON: () => 'tiny', huge: 'x'.repeat(300_000) };
		expect((await port.call('dual-put', { key: 'k', value: tricky })).success).toBe(true);
		expect((await port.call<{ value: unknown }>('dual-get', { key: 'k' })).data?.value).toBe(
			'tiny'
		);
		const cycle: Record<string, unknown> = { key: 'k' };
		cycle.value = cycle;
		const refused = await port.call('dual-put', cycle);
		expect(refused.error).toMatchObject({
			code: 'VALIDATION_ERROR',
			details: { limit: 262_144 },
			suggestion: expect.stringContaining('JSON'),
		});
		// The refusal's own entry: the owner notice of a first refusal is journaled beside it, after it or not yet.
		const refusals = (await journal.read()).filter((entry) => entry.command === 'app-limit-refuse');
		expect(refusals.at(-1)?.input).toEqual({
			command: 'dual-put',
			limit: 'inputBytes',
			bound: 262_144,
			reason: 'json',
		});
		const usage = await kernel.call<Usage>('limit-usage-get', { instance: 'dual' });
		expect(usage.data?.instances[0]?.refusals.inputBytes).toBe(1);
	});

	it('keeps two workspaces in one store apart: settings rows, limits and usage (R1, 5)', async () => {
		const store = new MemoryAdapter();
		// A row in the shape before R1, keyed without its workspace: never read, never written over.
		await store.create('setting', {
			id: 'loam.limits/workspace',
			workspace: 'personal',
			section: 'loam.limits',
			level: 'workspace',
			values: { callsPerSecond: { value: 7, updatedAt: 1, updatedBy: 'local' } },
			updatedAt: 1,
			updatedBy: 'local',
		});
		const personal = await workspace({ store, empty: true });
		expect(personal.limits.values().callsPerSecond).toBe(50);
		expect((await setLimit(personal.kernel, 'callsPerSecond', 10)).success).toBe(true);
		expect(await store.get('setting', 'personal/loam.limits/workspace')).toMatchObject({
			workspace: 'personal',
		});
		expect(await store.get('setting', 'loam.limits/workspace')).toMatchObject({
			values: { callsPerSecond: { value: 7 } },
		});
		await personal.kernel.appPort('dual').call('dual-put', { key: 'a', value: 'x'.repeat(1_000) });
		await personal.kernel.dispose();
		const beta = await workspace({
			store,
			empty: true,
			deployment: { ...scopedDeployment(), workspace: { id: 'beta', name: 'Beta' } },
		});
		expect(beta.limits.values().callsPerSecond).toBe(50);
		expect(
			(await beta.kernel.call('setting-get', { section: 'loam.limits', key: 'callsPerSecond' }))
				.data
		).toEqual({ value: 50, from: 'default' });
		const usage = await beta.kernel.call<Usage>('limit-usage-get', { instance: 'dual' });
		expect(usage.data?.instances[0]?.storeBytes.used).toBe(0);
		await beta.kernel.appPort('dual').call('dual-put', { key: 'b', value: 'y' });
		expect(
			(await store.get<{ used: number }>(STORE_USAGE_TABLE, storeUsageId('personal', 'dual')))?.used
		).toBe(JSON.stringify({ key: 'a', value: 'x'.repeat(1_000) }).length);
		expect(
			(await store.get<{ used: number }>(STORE_USAGE_TABLE, storeUsageId('beta', 'dual')))?.used
		).toBe(JSON.stringify({ key: 'b', value: 'y' }).length);
	});

	it("never reads a stored row on a hosted provider deployment, a local one's included (R3, 2)", async () => {
		const store = new MemoryAdapter();
		const local = await workspace({ store, empty: true });
		expect((await setLimit(local.kernel, 'inputBytes', 16_384)).success).toBe(true);
		expect(local.limits.values().inputBytes).toBe(16_384);
		await local.kernel.dispose();
		const hosted = await workspace({
			store,
			identity: PROVIDER,
			membership: ACME(),
			empty: true,
			deployment: {
				...scopedDeployment(),
				deployment_version: 4,
				generation: 'hosted',
				host: { kind: 'hosted', kernel: 'api/kernel' },
			} as unknown as ProjectionV3,
		});
		await signIn(hosted.kernel, 'olu@example.com');
		expect(hosted.limits.values()).toEqual({ ...LIMIT_DEFAULTS });
		expect(
			(
				await hosted.kernel
					.appPort('dual')
					.call('dual-put', { key: 'k', value: 'x'.repeat(20_000) })
			).success
		).toBe(true);
	});

	it.each([
		['static', 10],
		['hosted', 50],
	] as const)(
		'reads no stored row before a %s provider boot knows its host, and reads again once it does (R3)',
		async (kind, after) => {
			class Watched extends MemoryAdapter {
				reads = 0;
				override async get<T>(table: string, id: string): Promise<T | null> {
					if (table === 'setting' && id === 'personal/loam.limits/workspace') this.reads += 1;
					return super.get<T>(table, id);
				}
			}
			const store = new Watched();
			await store.create('setting', {
				id: 'personal/loam.limits/workspace',
				workspace: 'personal',
				section: 'loam.limits',
				level: 'workspace',
				values: { callsPerSecond: { value: 10, updatedAt: 1, updatedBy: 'local' } },
				updatedAt: 1,
				updatedBy: 'local',
			});
			let asked = false;
			let answer: (load: unknown) => void = () => {};
			const loaded = new Promise((resolve) => {
				answer = resolve;
			});
			const parts = await createKernelParts({
				store,
				storeKind: 'memory',
				journal: new MemoryJournalSink(),
				auth: new MockAuthAdapter(),
				environment: createFixedEnvironment(),
				host: 'test',
				identity: PROVIDER,
				membership: ACME(),
				boot: {
					generation: 'g',
					workspace: { id: 'personal', name: 'Personal' },
					apps: [
						{
							instance: 'dual',
							app: 'dual',
							title: 'Dual',
							kind: 'native',
							icon: 'system/folder',
							order: 100,
							scopeLevels: ['workspace', 'project'],
							rail: true,
							parts: [],
							layout: {},
							refusal: null,
						},
					],
					identity: PROVIDER,
				} as never,
				appsLoader: () => {
					asked = true;
					return loaded as never;
				},
			});
			kernels.push(parts.kernel);
			const started = parts.kernel.startApps();
			// The late load has read the limits while the host is unknown: the defaults, and no row read.
			// Stage B asks its loader only once the late load, which reads the limits, has ended.
			await expect.poll(() => asked).toBe(true);
			expect(parts.kernel.lateFailure).toBeUndefined();
			expect(store.reads).toBe(0);
			expect(parts.limits.values().callsPerSecond).toBe(50);
			answer({
				deployment: {
					...scopedDeployment(),
					...(kind === 'hosted'
						? { deployment_version: 4, host: { kind: 'hosted', kernel: 'api/kernel' } }
						: {}),
				},
				ports: ports(),
			});
			await started;
			expect(store.reads).toBe(kind === 'hosted' ? 0 : 1);
			expect(parts.limits.values().callsPerSecond).toBe(after);
		}
	);

	it.each([
		['a value over its bound', { callsPerSecond: 100_000 }, { callsPerSecond: 50 }],
		['a value that is not a whole number', { inputBytes: 20_000.5 }, { inputBytes: 262_144 }],
		[
			'a pair breaking the quarter rule',
			{ inputBytes: 131_072, journalEntryBytes: 262_144 },
			{ inputBytes: 65_536, journalEntryBytes: 262_144 },
		],
	])('fails closed on a stored row with %s (12)', async (_name, stored, enforced) => {
		const store = new MemoryAdapter();
		await store.create('setting', {
			id: 'personal/loam.limits/workspace',
			workspace: 'personal',
			section: 'loam.limits',
			level: 'workspace',
			values: Object.fromEntries(
				Object.entries(stored).map(([key, value]) => [
					key,
					{ value, updatedAt: 1, updatedBy: 'local' },
				])
			),
			updatedAt: 1,
			updatedBy: 'local',
		});
		const made = await workspace({ store, empty: true });
		expect(made.limits.values()).toEqual({ ...LIMIT_DEFAULTS, ...enforced });
	});

	it('P4-E10: keeps the defaults when the store cannot read the section (12): fail closed', async () => {
		class Failing extends MemoryAdapter {
			override async get<T>(table: string, id: string): Promise<T | null> {
				if (table === 'setting') throw new Error('The store is gone');
				return super.get<T>(table, id);
			}
		}
		const made = await workspace({ store: new Failing(), empty: true });
		expect(made.limits.values()).toEqual({ ...LIMIT_DEFAULTS });
	});
});

describe("P4-E10: the owners' notice through the inbox (section 11; step 5's shellNotice)", () => {
	type Listed = { notifications: Array<{ source: string; title: string; tone?: string }> };
	const shellNotices = async (kernel: LoamKernel) =>
		(
			(await kernel.call<Listed>('notification-list', { source: 'shell' })).data?.notifications ??
			[]
		).filter((notice) => notice.title.includes('loam.limits'));

	it('tells the local owner once per instance in an hour, journaled, and the session replays the same', async () => {
		const { kernel, journal } = await workspace({ empty: true });
		const port = kernel.appPort('dual');
		await port.call('dual-put', { key: 'a', value: 'x'.repeat(300_000) });
		await expect.poll(async () => (await shellNotices(kernel)).length).toBe(1);
		await port.call('dual-put', { key: 'a', value: 'x'.repeat(300_000) });
		await kernel.appPort('solo').call('solo-put', { key: 'a', value: 'x'.repeat(300_000) });
		await expect.poll(async () => (await shellNotices(kernel)).length).toBe(2);
		const notices = await shellNotices(kernel);
		expect(notices.map((notice) => notice.title).sort()).toEqual([
			"The app 'dual' was refused by loam.limits.inputBytes",
			"The app 'solo' was refused by loam.limits.inputBytes",
		]);
		expect(notices[0]).toMatchObject({ source: 'shell', tone: 'warning' });
		// The entry lands once its call has ended, after the notice it wrote.
		const pushed = async () =>
			(await journal.read()).filter((entry) => entry.command === 'limit-notice-push');
		await expect.poll(async () => (await pushed()).length).toBe(2);
		expect((await pushed()).map((entry) => entry.input)).toEqual([
			{ instance: 'dual', limit: 'inputBytes' },
			{ instance: 'solo', limit: 'inputBytes' },
		]);
		// No caller reaches it.
		expect(
			(await kernel.call('limit-notice-push', { instance: 'dual', limit: 'inputBytes' })).error
				?.code
		).toBe('COMMAND_NOT_FOUND');
		const result = await replay(await journal.read());
		expect(result.report.diverged).toBe(false);
	});

	it('tells no one in provider mode, where the owner roster is not yet a server record', async () => {
		const { kernel, journal } = await workspace({
			identity: PROVIDER,
			membership: ACME(),
			empty: true,
		});
		await signIn(kernel, 'olu@example.com');
		await kernel.appPort('dual').call('dual-put', { key: 'a', value: 'x'.repeat(300_000) });
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(await shellNotices(kernel)).toEqual([]);
		expect((await journal.read()).some((entry) => entry.command === 'limit-notice-push')).toBe(
			false
		);
	});
});

describe('store-usage-settle (section 11)', () => {
	it("P4-E15: counts each app's records at boot where its row differs, journaled, and a replay writes the same", async () => {
		const store = new MemoryAdapter();
		// One clock across the boots, as a page's wall clock is.
		const clock = createSteppingClock();
		const first = await workspace({ store, empty: true, clock });
		await first.kernel.appPort('dual').call('dual-put', { key: 'a', value: 'hi' });
		// Drift, as a record written before the count existed would leave.
		await store.remove(STORE_USAGE_TABLE, storeUsageId('personal', 'dual'));
		await first.kernel.dispose();
		const second = await workspace({ store, empty: true, clock });
		const read = await second.kernel.call<Usage>('limit-usage-get', { instance: 'dual' });
		const used = read.data?.instances[0]?.storeBytes.used as number;
		expect(used).toBe(JSON.stringify({ key: 'a', value: 'hi' }).length);
		const entries = await second.journal.read();
		const settle = entries.find((entry) => entry.command === 'store-usage-settle');
		expect(settle?.input).toEqual({ usage: [{ instance: 'dual', used }] });
		expect(
			(
				await second.store.get<{ used: number }>(
					STORE_USAGE_TABLE,
					storeUsageId('personal', 'dual')
				)
			)?.used
		).toBe(used);
		// P4-E15: the boot that settled replays with no difference, the settle's entry among the same.
		const replayed = await replay(entries);
		expect(replayed.report.diverged).toBe(false);
		expect(
			replayed.report.entries.find((entry) => entry.command === 'store-usage-settle')?.status
		).toBe('same');
		// No caller reaches it.
		expect((await second.kernel.call('store-usage-settle', { usage: [] })).error?.code).toBe(
			'COMMAND_NOT_FOUND'
		);
		// A row counted within the day is not counted again at the next boot (13).
		await second.kernel.dispose();
		const third = await workspace({ store, empty: true, clock });
		expect(
			(await third.journal.read()).some((entry) => entry.command === 'store-usage-settle')
		).toBe(false);
	});

	it('P4-E15: replays a session of the new commands with no difference', async () => {
		const { kernel, journal } = await workspace({ empty: true });
		const port = kernel.appPort('dual');
		await setLimit(kernel, 'journalEntryBytes', 524_288);
		await setLimit(kernel, 'inputBytes', 65_536);
		await port.call('dual-put', { key: 'a', value: 'x'.repeat(70_000) });
		await port.call('dual-put', { key: 'a', value: 'kept' });
		await kernel.call('limit-usage-get', {});
		await kernel.agent.call('limit-usage-get', {});
		const result = await replay(await journal.read());
		expect(result.report.diverged).toBe(false);
	});
});

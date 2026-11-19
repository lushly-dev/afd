/**
 * P4-E10's units (phase 4 specification, section 11 and 19; D124): `loam.limits` and its quarter rule, each limit's
 * refusal with its details where section 11 enforces it, `limit-usage-get` and its hand-offs, the owner notice's seam,
 * `store-usage-settle`, and a replay stopping at a truncated entry. The defaults holding when `late-settings` fails are
 * `late-settings-failure.test.ts`'s; the view broker's message bound is `apps/view-broker.test.ts`'s.
 */

import type { JournalEntry } from '@lushly-dev/afd-core';
import type { IdentityV1, ProjectionV3 } from '@lushly-dev/loam-manifest';
import { type AppCallContextV1, defineApp, failure, success } from '@lushly-dev/loam-sdk';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, describe, expect, it } from 'vitest';
import { STORE_USAGE_TABLE, storeUsageId } from '../apps/store.js';
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
import { createFixturePorts, replayKernel } from '../testing.js';
import type { LoamKernelV5 } from '../types.js';
import { LIMIT_KEY_ORDER, QUARTER_ORDER } from './limit-commands.js';
import { LIMITS_SECTION } from './setting-sections.js';

const kernels: LoamKernelV5[] = [];
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

const setLimit = (kernel: LoamKernelV5, key: string, value: number) =>
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
const signIn = (kernel: LoamKernelV5, email: string) =>
	kernel.call('auth-sign-in', { method: 'credentials', email, password: 'x' });

describe('loam.limits (section 11, 3.7)', () => {
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

describe("each limit's refusal (section 11, 16)", () => {
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
		const entry = (await journal.read()).at(-1) as JournalEntry;
		expect(entry.command).toBe('app-limit-refuse');
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

	it('refuses calls over callsPerSecond, after the burst of 200, with when to retry', async () => {
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
		// A nested call is the app's too: refused from inside its handler.
		const nested = await port.call('dual-nested', {});
		expect(nested.error?.code).toBe('RATE_LIMITED');
		// Another app's rate is its own.
		expect((await kernel.appPort('solo').call('solo-where', {})).success).toBe(true);
	});

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

describe('limit-usage-get (section 11, F3)', () => {
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

describe('store-usage-settle (section 11)', () => {
	it("counts each app's records at boot where its row differs, journaled, and a replay writes the same", async () => {
		const store = new MemoryAdapter();
		const first = await workspace({ store, empty: true });
		await first.kernel.appPort('dual').call('dual-put', { key: 'a', value: 'hi' });
		// Drift, as a record written before the count existed would leave.
		await store.remove(STORE_USAGE_TABLE, storeUsageId('personal', 'dual'));
		await first.kernel.dispose();
		const second = await workspace({ store, empty: true });
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
		// No caller reaches it.
		expect((await second.kernel.call('store-usage-settle', { usage: [] })).error?.code).toBe(
			'COMMAND_NOT_FOUND'
		);
	});

	it('replays a session of the new commands with no difference (P4-E15)', async () => {
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

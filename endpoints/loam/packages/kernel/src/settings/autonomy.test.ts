/**
 * P4-E4's units (phase 4 specification, section 4 and 19; D118, D154, D156): the autonomy commands in the kernel, on
 * the scoped workspace's apps. The jobs `autonomy-per-command`, `know-my-mode` and `owner-ceiling` run in
 * `scenarios.test.ts`; the pure rules are in `autonomy-rules.test.ts`; P4-E2's sweep in `scope/settings-sweep.test.ts`.
 */

import { MemoryJournalSink, success } from '@lushly-dev/afd-core';
import { defineCommand, type ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type {
	IdentityV1,
	ManifestV1,
	ManifestV3,
	ProjectionV3,
	ProjectionV4,
} from '@lushly-dev/loam-manifest';
import { type DataAdapter, MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createKernelParts } from '../kernel.js';
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
import { createFixedEnvironment, createFixturePorts, replayKernel } from '../testing.js';
import type { LoamKernel, McpToolCallResult, MountTransport } from '../types.js';
import { AUTONOMY_TABLE } from './autonomy.js';
import type { AutonomyRowV1 } from './autonomy-rules.js';
import { NOTIFICATION_TABLE } from './notifications.js';

const kernels: LoamKernel[] = [];
afterEach(async () => {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.dispose()));
});

async function workspace(options: ScopedWorkspaceOptions = {}): Promise<ScopedWorkspace> {
	const made = await createScopedWorkspace(options);
	kernels.push(made.kernel);
	return made;
}

type Data = Record<string, unknown>;
interface Listed {
	rows: AutonomyRowV1[];
	ceiling: string | null;
	cap: string | null;
	writable: Record<string, { writable: boolean; reason?: string }>;
}

const PROVIDER: IdentityV1 = {
	mode: 'provider',
	organization: 'acme',
	path: 'api/auth',
	methods: ['passkey', 'password'],
};
const BEA = 'mock-user-bea@example.com';
const CY = 'mock-user-cy@example.com';
const ACME = (): MembershipV1 => ({
	mode: 'provider',
	members: new Map([
		[BEA, 'member'],
		[CY, 'member'],
		['mock-user-olu@example.com', 'owner'],
	]),
	digest: 'd1',
});
const signIn = (kernel: LoamKernel, email: string) =>
	kernel.call('auth-sign-in', { method: 'credentials', email, password: 'x' });

describe('autonomy-set and autonomy-get (4.3, 4.4)', () => {
	it('P4-E4: sets workspace and project rows, resolves through them, and lists them', async () => {
		const { kernel, projects, scopes } = await workspace();
		expect(
			(await kernel.call('autonomy-set', { level: 'workspace', mode: 'ask', ceiling: 'act' }))
				.success
		).toBe(true);
		const set = await kernel.call<Data>('autonomy-set', {
			level: 'project',
			project: projects.atlas.id,
			instance: 'dual',
			mode: 'act',
		});
		expect(set.data).toMatchObject({
			row: { id: `project/${projects.atlas.id}/dual/*`, mode: 'act', updatedBy: 'local' },
			previous: null,
		});
		expect(set).toMatchObject({
			undoCommand: 'autonomy-set',
			undoArgs: { level: 'project', project: projects.atlas.id, instance: 'dual', mode: null },
		});
		const got = await kernel.call<Data>(
			'autonomy-get',
			{ command: 'dual-put', instance: 'dual' },
			{ scope: scopes.atlas }
		);
		expect(got.data).toMatchObject({
			command: 'dual-put',
			instance: 'dual',
			project: projects.atlas.id,
			mode: 'act',
			from: `project/${projects.atlas.id}/dual/*`,
			chain: [
				{ id: `project/${projects.atlas.id}/dual/*`, as: 'mode' },
				{ id: 'workspace/-/*/*', mode: 'act', as: 'ceiling' },
			],
		});
		// The instance is found from the command; the input's project wins over the call's scope.
		const there = await kernel.call<Data>(
			'autonomy-get',
			{ command: 'dual-put', project: projects.beacon.id },
			{ scope: scopes.atlas }
		);
		expect(there.data).toMatchObject({ instance: 'dual', mode: 'ask', from: 'workspace/-/*/*' });
		const listed = await kernel.call<Listed>('autonomy-list');
		// The general rows first, then by id (step 8's blocker 7).
		expect(listed.data?.rows.map(({ id }) => id)).toEqual([
			'workspace/-/*/*',
			`project/${projects.atlas.id}/dual/*`,
		]);
		expect(listed.data).toMatchObject({ ceiling: 'act', cap: null });
		expect(
			(await kernel.call<Listed>('autonomy-list', { level: 'workspace' })).data?.rows
		).toHaveLength(1);
	});

	it("P4-E4: resolves the shell's own commands, and every command's default with no row (D156)", async () => {
		const { kernel } = await workspace();
		const results = await kernel.call<{ results: Data[] }>('autonomy-get', {
			commands: [
				{ command: 'project-list' },
				{ command: 'project-create', instance: 'shell' },
				{ command: 'dual-get' },
				{ command: 'dual-put' },
			],
		});
		expect(results.data?.results.map(({ instance, mode }) => [instance, mode])).toEqual([
			['shell', 'act'],
			['shell', 'ask'],
			['dual', 'act'],
			['dual', 'ask'],
		]);
	});

	it('P4-E4: reads up to 50 commands at once, in order, and names the one it cannot find', async () => {
		const { kernel } = await workspace();
		const fifty = Array.from({ length: 50 }, () => ({ command: 'dual-get' }));
		expect(
			(await kernel.call<{ results: unknown[] }>('autonomy-get', { commands: fifty })).data?.results
		).toHaveLength(50);
		expect(
			(await kernel.call('autonomy-get', { commands: [...fifty, { command: 'dual-get' }] })).error
				?.code
		).toBe('VALIDATION_ERROR');
		expect((await kernel.call('autonomy-get', { commands: [] })).error?.code).toBe(
			'VALIDATION_ERROR'
		);
		const unknown = await kernel.call('autonomy-get', {
			commands: [{ command: 'dual-get' }, { command: 'dual-erase' }],
		});
		expect(unknown.error).toMatchObject({
			code: 'AUTONOMY_COMMAND_UNKNOWN',
			details: { index: 1 },
		});
		expect(unknown.error?.suggestion).toContain('app-command-list');
	});

	it("P4-E4: caps a person's own mode, and only lowers it", async () => {
		const { kernel } = await workspace();
		await kernel.call('autonomy-set', { level: 'workspace', mode: 'act' });
		const capped = await kernel.call<Data>('autonomy-set', { level: 'person', cap: 'suggest' });
		expect(capped.data).toEqual({ cap: 'suggest', previous: null });
		expect(capped).toMatchObject({ undoArgs: { level: 'person', cap: null } });
		const got = await kernel.call<Data>('autonomy-get', { command: 'dual-get' });
		expect(got.data).toMatchObject({
			mode: 'suggest',
			cap: 'suggest',
			chain: [
				{ id: 'workspace/-/*/*', mode: 'act', as: 'mode' },
				{ id: 'cap', mode: 'suggest', as: 'cap' },
			],
		});
		// The agent reads its person's cap; the cap is the person's, not a shared value.
		expect(
			(await kernel.agent.call<Data>('autonomy-get', { command: 'dual-get' })).data?.mode
		).toBe('suggest');
		expect((await kernel.call<Listed>('autonomy-list')).data?.cap).toBe('suggest');
		await kernel.call('autonomy-set', { level: 'person', cap: null });
		expect((await kernel.call<Data>('autonomy-get', { command: 'dual-get' })).data?.mode).toBe(
			'act'
		);
		// The cap is `loam.autonomy.cap`, which setting-* never writes.
		expect(
			(
				await kernel.call('setting-set', {
					section: 'loam.autonomy',
					key: 'cap',
					value: 'act',
					level: 'person',
				})
			).error?.code
		).toBe('SETTING_USE_AUTONOMY');
	});

	it('P4-E4: removes a row with mode null, keeping a ceiling the general row holds alone', async () => {
		const { kernel, store } = await workspace();
		await kernel.call('autonomy-set', { level: 'workspace', mode: 'ask', ceiling: 'act' });
		const cleared = await kernel.call<Data>('autonomy-set', { level: 'workspace', mode: null });
		expect(cleared.data?.row).toMatchObject({ id: 'workspace/-/*/*', ceiling: 'act' });
		expect(cleared.data?.row).not.toHaveProperty('mode');
		const gone = await kernel.call('autonomy-set', { level: 'workspace', ceiling: null });
		expect(gone.data).toMatchObject({ row: null });
		expect((await store.list(AUTONOMY_TABLE)).data).toEqual([]);
	});

	it('returns detached copies: changing a result changes nothing held', async () => {
		const { kernel } = await workspace();
		await kernel.call('autonomy-set', { level: 'workspace', mode: 'ask' });
		const listed = await kernel.call<Listed>('autonomy-list');
		(listed.data?.rows[0] as { mode: string }).mode = 'act';
		const got = await kernel.call<{ chain: Array<{ mode: string }> }>('autonomy-get', {
			command: 'dual-get',
		});
		(got.data?.chain[0] as { mode: string }).mode = 'act';
		expect((await kernel.call<Listed>('autonomy-list')).data?.rows[0]?.mode).toBe('ask');
		expect((await kernel.call<Data>('autonomy-get', { command: 'dual-get' })).data?.mode).toBe(
			'ask'
		);
	});

	it('refuses an input that is not strict, or a row of the wrong shape', async () => {
		const { kernel, projects } = await workspace();
		for (const input of [
			{ level: 'workspace', mode: 'ask', extra: 1 },
			{ level: 'workspace', mode: 'always' },
			{ level: 'workspace' },
			{ level: 'project', mode: 'ask' },
			{ level: 'workspace', project: projects.atlas.id, mode: 'ask' },
			{ level: 'workspace', command: 'dual-put', mode: 'ask' },
			{ level: 'project', project: projects.atlas.id, ceiling: 'act' },
			{ level: 'workspace', instance: 'dual', ceiling: 'act' },
			{ level: 'person', cap: 'act', mode: 'act' },
			{ level: 'person' },
		]) {
			const refused = await kernel.call('autonomy-set', input);
			expect(refused.error?.code, JSON.stringify(input)).toBe('VALIDATION_ERROR');
			expect(refused.error?.suggestion, JSON.stringify(input)).toBeTruthy();
		}
		for (const input of [{ command: 'dual-get', extra: 1 }, {}, { level: 'person' }]) {
			expect((await kernel.call('autonomy-get', input)).error?.code).toBe('VALIDATION_ERROR');
		}
		expect((await kernel.call('autonomy-list', { level: 'person' })).error?.code).toBe(
			'VALIDATION_ERROR'
		);
	});
});

describe('P4-E4: the bounds (4.2, F8): AUTONOMY_ABOVE_CEILING', () => {
	it("bounds a project row by the default with no workspace row, then by the workspace's general mode", async () => {
		const { kernel, projects } = await workspace();
		const project = (mode: string, extra: Data = {}) =>
			kernel.call('autonomy-set', { level: 'project', project: projects.atlas.id, mode, ...extra });
		// No general row: a general project row is bounded by the strictest default, ask.
		const refused = await project('act');
		expect(refused.error).toMatchObject({
			code: 'AUTONOMY_ABOVE_CEILING',
			details: { bound: 'default', mode: 'ask' },
		});
		expect(refused.error?.suggestion).toContain('owner');
		expect((await project('ask')).success).toBe(true);
		// A command row of a read is bounded by its own default, act.
		expect((await project('act', { instance: 'dual', command: 'dual-get' })).success).toBe(true);
		expect((await project('act', { instance: 'dual', command: 'dual-put' })).error?.code).toBe(
			'AUTONOMY_ABOVE_CEILING'
		);
		// With no ceiling, the workspace's general mode bounds.
		await kernel.call('autonomy-set', { level: 'workspace', mode: 'suggest' });
		expect((await project('ask')).error).toMatchObject({
			code: 'AUTONOMY_ABOVE_CEILING',
			details: { bound: 'workspace/-/*/*', mode: 'suggest' },
		});
		// An owner raises the ceiling, and the project may go that far.
		await kernel.call('autonomy-set', { level: 'workspace', ceiling: 'act' });
		expect((await project('act')).success).toBe(true);
	});

	it("bounds an instance or command row by the workspace's rows for it", async () => {
		const { kernel, projects } = await workspace();
		await kernel.call('autonomy-set', { level: 'workspace', mode: 'ask', ceiling: 'act' });
		await kernel.call('autonomy-set', { level: 'workspace', instance: 'dual', mode: 'ask' });
		const at = { level: 'project', project: projects.atlas.id, instance: 'dual' };
		expect((await kernel.call('autonomy-set', { ...at, mode: 'act' })).error?.code).toBe(
			'AUTONOMY_ABOVE_CEILING'
		);
		expect(
			(await kernel.call('autonomy-set', { ...at, command: 'dual-get', mode: 'act' })).error
				?.details
		).toMatchObject({ bound: 'workspace/-/dual/*' });
		// Workspace rows are an owner's, and bounded by nothing.
		expect(
			(
				await kernel.call('autonomy-set', {
					level: 'workspace',
					instance: 'dual',
					command: 'dual-put',
					mode: 'act',
				})
			).success
		).toBe(true);
	});
});

describe('P4-E4: AUTONOMY_COMMAND_UNKNOWN (4.3, step 4)', () => {
	it('refuses a row naming no registered instance or command, and its removal unless that row is held', async () => {
		const { kernel } = await workspace();
		for (const input of [
			{ instance: 'dual', command: 'dual-erase' },
			{ instance: 'solo', command: 'dual-put' },
			{ instance: 'nowhere' },
			{ instance: 'shell', command: 'dual-put' },
			{ instance: 'shell', command: 'autonomy-settle' },
		]) {
			const refused = await kernel.call('autonomy-set', {
				level: 'workspace',
				mode: 'ask',
				...input,
			});
			expect(refused.error?.code, JSON.stringify(input)).toBe('AUTONOMY_COMMAND_UNKNOWN');
		}
		// A removal of a target that is not there removes nothing it did not name (blocker 6).
		expect(
			(
				await kernel.call('autonomy-set', {
					level: 'workspace',
					instance: 'dual',
					command: 'dual-erase',
					mode: null,
				})
			).error?.code
		).toBe('AUTONOMY_COMMAND_UNKNOWN');
		expect((await kernel.call('autonomy-get', { command: 'dual-erase' })).error?.code).toBe(
			'AUTONOMY_COMMAND_UNKNOWN'
		);
	});

	it('refuses an identifier that is not one before building a key: never `*`, a slash or a space', async () => {
		const { kernel, store } = await workspace();
		for (const input of [
			{ instance: '*', mode: 'ask' },
			{ instance: 'dual', command: '*', mode: 'ask' },
			{ instance: 'du/al', mode: null },
			{ instance: 'dual', command: 'dual put', mode: null },
			{ instance: 'Dual', mode: 'ask' },
		]) {
			const refused = await kernel.call('autonomy-set', { level: 'workspace', ...input });
			expect(refused.error?.code, JSON.stringify(input)).toBe('VALIDATION_ERROR');
		}
		expect(
			(await kernel.call('autonomy-set', { level: 'project', project: 'a/b', mode: 'ask' })).error
				?.code
		).toBe('PROJECT_NOT_FOUND');
		expect((await store.list(AUTONOMY_TABLE)).data).toEqual([]);
	});
});

describe('P4-E4: who sets it (4.3; D154)', () => {
	it('P4-E4: P4-E1: HUMAN_REQUIRED for an agent, with the hand-off, at every level; reads succeed', async () => {
		const { kernel, projects } = await workspace();
		for (const [input, key, route] of [
			[{ level: 'workspace', mode: 'act' }, 'workspace/-/*/*', '~/settings/loam.autonomy'],
			[
				{
					level: 'project',
					project: projects.atlas.id,
					instance: 'dual',
					command: 'dual-put',
					mode: 'ask',
				},
				`project/${projects.atlas.id}/dual/dual-put`,
				'~/settings/loam.autonomy',
			],
			[{ level: 'person', cap: 'act' }, 'cap', '~/settings/loam.autonomy#cap'],
		] as const) {
			const refused = await kernel.agent.call('autonomy-set', input);
			expect(refused.error?.code).toBe('HUMAN_REQUIRED');
			expect(refused.error?.details).toEqual({
				route,
				section: 'loam.autonomy',
				key,
				level: input.level,
			});
			expect(refused.error?.suggestion).toContain(route);
		}
		expect((await kernel.agent.call('autonomy-list')).success).toBe(true);
		expect((await kernel.agent.call('autonomy-get', { command: 'dual-put' })).success).toBe(true);
		expect((await kernel.call<Listed>('autonomy-list')).data?.rows).toEqual([]);
	});

	it('CALL_NOT_GRANTED for a port, and none of them is served over MCP (section 13)', async () => {
		const made = await workspace();
		for (const name of ['autonomy-get', 'autonomy-list', 'autonomy-set']) {
			const refused = await made.kernel
				.appPort('dual')
				.call(
					name,
					name === 'autonomy-set' ? { level: 'person', cap: 'act' } : { command: 'dual-get' }
				);
			expect(refused.error?.code, name).toBe('CALL_NOT_GRANTED');
		}
		const served = made.mcpOptions()?.commands.map(({ name }) => name) ?? [];
		expect(served.length).toBeGreaterThan(0);
		for (const name of ['autonomy-get', 'autonomy-list', 'autonomy-set', 'autonomy-settle'])
			expect(served).not.toContain(name);
	});

	it("lets an owner and the project's creator set its row; a non-creator member is OWNER_REQUIRED", async () => {
		const { kernel } = await workspace({ identity: PROVIDER, membership: ACME(), empty: true });
		await signIn(kernel, 'bea@example.com');
		const made = await kernel.call<{ id: string }>('project-create', { name: 'Atlas' });
		const atlas = made.data?.id as string;
		const row = (mode: string) =>
			kernel.call('autonomy-set', { level: 'project', project: atlas, mode });
		expect((await row('suggest')).success).toBe(true);
		// The workspace's rows are an owner's.
		expect(
			(await kernel.call('autonomy-set', { level: 'workspace', mode: 'act' })).error?.code
		).toBe('OWNER_REQUIRED');
		expect((await kernel.call<Listed>('autonomy-list', { project: atlas })).data?.writable).toEqual(
			{
				workspace: { writable: false, reason: 'OWNER_REQUIRED' },
				project: { writable: true },
				cap: { writable: true },
			}
		);
		await kernel.call('auth-sign-out');
		await signIn(kernel, 'cy@example.com');
		const refused = await row('ask');
		expect(refused.error).toMatchObject({
			code: 'OWNER_REQUIRED',
			suggestion: 'Ask an owner of the workspace to do this',
		});
		// Her own cap she sets.
		expect((await kernel.call('autonomy-set', { level: 'person', cap: 'ask' })).success).toBe(true);
		await kernel.call('auth-sign-out');
		await signIn(kernel, 'olu@example.com');
		expect((await row('ask')).success).toBe(true);
		expect((await kernel.call('autonomy-set', { level: 'workspace', mode: 'act' })).success).toBe(
			true
		);
	});

	it('PROJECT_NOT_FOUND for a creator removed from their project, before any owner check', async () => {
		const { kernel } = await workspace({ identity: PROVIDER, membership: ACME(), empty: true });
		await signIn(kernel, 'bea@example.com');
		const made = await kernel.call<{ id: string }>('project-create', {
			name: 'Vault',
			access: { mode: 'restricted', members: [BEA, CY] },
		});
		const vault = made.data?.id as string;
		const row = () =>
			kernel.call('autonomy-set', { level: 'project', project: vault, mode: 'ask' });
		expect((await row()).success).toBe(true);
		expect(
			(
				await kernel.call('project-update', {
					project: vault,
					access: { mode: 'restricted', members: [CY] },
				})
			).success
		).toBe(true);
		const gone = await row();
		const missing = await kernel.call('autonomy-set', {
			level: 'project',
			project: 'prj_nowhere',
			mode: 'ask',
		});
		const phase2 = await kernel.call('project-get', { project: vault });
		expect(gone.error?.code).toBe('PROJECT_NOT_FOUND');
		expect(JSON.stringify(gone.error)).toBe(JSON.stringify(missing.error));
		expect(JSON.stringify(gone.error)).toBe(JSON.stringify(phase2.error));
		// Nor may she read or list it.
		for (const result of [
			await kernel.call('autonomy-get', { command: 'project-get', project: vault }),
			await kernel.call('autonomy-list', { project: vault }),
		]) {
			expect(JSON.stringify(result.error)).toBe(JSON.stringify(phase2.error));
		}
		expect((await kernel.call<Listed>('autonomy-list')).data?.rows).toEqual([]);
		// Cy, who may enter it and is no owner, is refused as a non-creator.
		await kernel.call('auth-sign-out');
		await signIn(kernel, 'cy@example.com');
		expect((await row()).error?.code).toBe('OWNER_REQUIRED');
		expect((await kernel.call<Listed>('autonomy-list')).data?.rows.map(({ id }) => id)).toEqual([
			`project/${vault}/*/*`,
		]);
	});

	it('OWNER_REQUIRED for the creator of a project a team instance lists (D87, D110)', async () => {
		const store = new MemoryAdapter();
		const first = await workspace({ store, identity: PROVIDER, membership: ACME(), empty: true });
		await signIn(first.kernel, 'bea@example.com');
		const made = await first.kernel.call<{ id: string }>('project-create', {
			name: 'Vault',
			slug: 'vault',
		});
		const vault = made.data?.id as string;
		await first.kernel.dispose();
		// A later deployment's team instance lists the slug.
		const deployment = scopedDeployment();
		const listed = {
			...deployment,
			generation: 'listed',
			apps: deployment.apps.map((app) =>
				app.instance === 'tasks' ? { ...app, audience: 'team' as const, projects: ['vault'] } : app
			),
		};
		const second = await workspace({
			store,
			identity: PROVIDER,
			membership: ACME(),
			empty: true,
			deployment: listed as ProjectionV3,
		});
		await signIn(second.kernel, 'bea@example.com');
		const refused = await second.kernel.call('autonomy-set', {
			level: 'project',
			project: vault,
			mode: 'ask',
		});
		expect(refused.error?.code).toBe('OWNER_REQUIRED');
	});

	it('refuses an archived project’s row, as every write under it', async () => {
		const { kernel, projects } = await workspace();
		await kernel.call('project-archive', { project: projects.beacon.id });
		expect(
			(
				await kernel.call('autonomy-set', {
					level: 'project',
					project: projects.beacon.id,
					mode: 'ask',
				})
			).error?.code
		).toBe('PROJECT_ARCHIVED');
	});
});

describe('P4-E4: restricted projects (4.3, 4.4): byte-identical PROJECT_NOT_FOUND, and rows filtered', () => {
	it('answers a project the caller may not enter as a missing one, and lists none of its rows', async () => {
		const { kernel, projects, store } = await workspace();
		// Signed out in `local` mode: Citadel is restricted to someone else.
		const asked = [
			['autonomy-set', { level: 'project', project: projects.citadel.id, mode: 'ask' }],
			['autonomy-get', { command: 'dual-get', project: projects.citadel.id }],
			['autonomy-list', { project: projects.citadel.id }],
		] as const;
		const phase2 = JSON.stringify((await kernel.call('project-get', { project: 'citadel' })).error);
		for (const [name, input] of asked) {
			expect(JSON.stringify((await kernel.call(name, input)).error), name).toBe(phase2);
			expect(
				JSON.stringify((await kernel.call(name, { ...input, project: 'prj_nowhere' })).error),
				name
			).toBe(phase2);
		}
		// The call's scope is checked as the input's is.
		expect(
			JSON.stringify(
				(
					await kernel.call(
						'autonomy-get',
						{ command: 'dual-get' },
						{ scope: { workspace: 'personal', project: projects.citadel.id } }
					)
				).error
			)
		).toBe(phase2);
		// A row of Citadel, written by its member, is in no list a non-member reads, nor in any chain.
		await kernel.call('auth-sign-in', {
			method: 'credentials',
			email: 'someone@example.com',
			password: 'x',
		});
		expect(
			(
				await kernel.call('autonomy-set', {
					level: 'project',
					project: projects.citadel.id,
					mode: 'suggest',
				})
			).success
		).toBe(true);
		await kernel.call('auth-sign-out');
		expect((await store.list(AUTONOMY_TABLE)).data).toHaveLength(1);
		expect((await kernel.call<Listed>('autonomy-list')).data?.rows).toEqual([]);
		expect(JSON.stringify((await kernel.call('autonomy-list')).data)).not.toContain(
			projects.citadel.id
		);
	});
});

describe('P4-E4: a restricted project is missing before any owner check (4.3, 4.4)', () => {
	it('answers a member who is not its creator nor listed with PROJECT_NOT_FOUND, never OWNER_REQUIRED', async () => {
		const { kernel } = await workspace({ identity: PROVIDER, membership: ACME(), empty: true });
		await signIn(kernel, 'bea@example.com');
		const made = await kernel.call<{ id: string }>('project-create', {
			name: 'Vault',
			access: { mode: 'restricted', members: [BEA] },
		});
		const vault = made.data?.id as string;
		await kernel.call('auth-sign-out');
		// Cy is a member of the workspace, not an owner, not Vault's creator and not on its list: the owner check
		// would refuse her too, so only the access decision coming first answers as a missing project.
		await signIn(kernel, 'cy@example.com');
		const missing = JSON.stringify((await kernel.call('project-get', { project: vault })).error);
		expect(JSON.parse(missing)).toMatchObject({ code: 'PROJECT_NOT_FOUND' });
		for (const mode of ['ask', 'act'] as const) {
			const refused = await kernel.call('autonomy-set', { level: 'project', project: vault, mode });
			expect(JSON.stringify(refused.error), mode).toBe(missing);
		}
		// The same project she may enter is OWNER_REQUIRED, so the refusal above is the access decision's.
		await kernel.call('auth-sign-out');
		await signIn(kernel, 'bea@example.com');
		const open = await kernel.call<{ id: string }>('project-create', { name: 'Open' });
		await kernel.call('auth-sign-out');
		await signIn(kernel, 'cy@example.com');
		expect(
			(
				await kernel.call('autonomy-set', {
					level: 'project',
					project: open.data?.id as string,
					mode: 'ask',
				})
			).error?.code
		).toBe('OWNER_REQUIRED');
	});
});

describe('P4-E17: section 13: a hosted provider deployment refuses autonomy-set at every level', () => {
	it('refuses each, journaled, with no table or record changed', async () => {
		const deployment = {
			...scopedDeployment(),
			deployment_version: 4,
			generation: 'hosted',
			host: { kind: 'hosted', kernel: 'api/kernel' },
		} as ProjectionV4;
		const { kernel, store, journal } = await workspace({
			identity: PROVIDER,
			membership: ACME(),
			empty: true,
			deployment: deployment as unknown as ProjectionV3,
		});
		await signIn(kernel, 'olu@example.com');
		const made = await kernel.call<{ id: string }>('project-create', { name: 'Atlas' });
		const before = JSON.stringify((await store.list('settings')).data);
		for (const input of [
			{ level: 'workspace', mode: 'act' },
			{ level: 'project', project: made.data?.id, mode: 'ask' },
			{ level: 'person', cap: 'suggest' },
		]) {
			const refused = await kernel.call('autonomy-set', input);
			expect(refused.error?.code, input.level).toBe('SHARED_RECORD_UNAVAILABLE');
		}
		expect((await store.list(AUTONOMY_TABLE)).data).toEqual([]);
		expect(JSON.stringify((await store.list('settings')).data)).toBe(before);
		const journaled = (await journal.read()).filter(({ command }) => command === 'autonomy-set');
		expect(journaled.map(({ result }) => result?.error?.code)).toEqual([
			'SHARED_RECORD_UNAVAILABLE',
			'SHARED_RECORD_UNAVAILABLE',
			'SHARED_RECORD_UNAVAILABLE',
		]);
		// Reads still answer, and the agent gets its hand-off before the hosted refusal.
		expect((await kernel.call<Listed>('autonomy-list')).data?.writable.cap).toEqual({
			writable: false,
			reason: 'SHARED_RECORD_UNAVAILABLE',
		});
		expect(
			(await kernel.agent.call('autonomy-set', { level: 'person', cap: 'ask' })).error?.code
		).toBe('HUMAN_REQUIRED');
	});
});

describe('P4-E4: orphans (4.2): flagged at the manifest’s apply', () => {
	const DROPPED: ManifestV3 = {
		...DUAL_MANIFEST,
		commands: (DUAL_MANIFEST.commands ?? []).filter(({ name }) => name !== 'dual-put'),
	} as ManifestV3;

	const boot = (store: DataAdapter, dual: ManifestV3, withSolo = true) => {
		const deployment = scopedDeployment();
		return workspace({
			store,
			deployment: {
				...deployment,
				apps: deployment.apps.filter((app) => withSolo || app.instance !== 'solo'),
			},
			ports: createFixturePorts({
				...scopedPackages(),
				'fixtures/dual/': { manifest: dual, definition: DUAL_DEFINITION },
			}),
		});
	};

	it('flags a row whose command or instance is gone, ignores it, and unflags it when it returns', async () => {
		const store = new MemoryAdapter();
		const first = await boot(store, DUAL_MANIFEST);
		await first.kernel.call('autonomy-set', {
			level: 'workspace',
			instance: 'dual',
			command: 'dual-put',
			mode: 'act',
		});
		await first.kernel.call('autonomy-set', {
			level: 'workspace',
			instance: 'solo',
			mode: 'suggest',
		});
		// No change at this apply: nothing is journaled.
		expect((await first.journal.read()).some(({ command }) => command === 'autonomy-settle')).toBe(
			false
		);
		await first.kernel.dispose();
		const second = await boot(store, DROPPED, false);
		const listed = await second.kernel.call<Listed>('autonomy-list');
		expect(listed.data?.rows.map(({ id, orphan }) => [id, orphan ?? false])).toEqual([
			['workspace/-/dual/dual-put', true],
			['workspace/-/solo/*', true],
		]);
		const settled = (await second.journal.read()).filter(
			({ command }) => command === 'autonomy-settle'
		);
		expect(settled).toHaveLength(1);
		// The owner hears of it in their inbox, once, from the shell (4.2, 10.2; step 5's wiring).
		const inbox = await second.kernel.call<{
			notifications: Array<{ source: string; title: string; body?: string; tone: string }>;
		}>('notification-list', { body: true });
		expect(inbox.data?.notifications).toEqual([
			expect.objectContaining({
				source: 'shell',
				tone: 'warning',
				title: '2 autonomy rules no longer match an app or command',
				body: expect.stringContaining('workspace/-/dual/dual-put, workspace/-/solo/*'),
			}),
		]);
		// An orphan decides nothing; and it can always be removed.
		expect(
			(await second.kernel.call<Data>('autonomy-get', { command: 'solo-put' })).error?.code
		).toBe('AUTONOMY_COMMAND_UNKNOWN');
		expect(
			(
				await second.kernel.call('autonomy-set', {
					level: 'workspace',
					instance: 'solo',
					mode: null,
				})
			).success
		).toBe(true);
		await second.kernel.dispose();
		const third = await boot(store, DUAL_MANIFEST);
		const back = await third.kernel.call<Listed>('autonomy-list');
		expect(back.data?.rows).toMatchObject([{ id: 'workspace/-/dual/dual-put', mode: 'act' }]);
		expect(back.data?.rows[0]).not.toHaveProperty('orphan');
		expect(
			(await third.kernel.call<Data>('autonomy-get', { command: 'dual-put' })).data?.mode
		).toBe('act');
	});
});

/** A mounted server whose tools are reads, as `apps/mounted.test.ts`'s fake transport answers discovery. */
function mountedTransport(tools: () => string[] = () => ['files-read']): MountTransport {
	const asResult = (body: unknown): McpToolCallResult => ({ structuredContent: body });
	return {
		connect: async () => ({ protocolVersion: '2025-11-25' }),
		listTools: () => Promise.reject(new Error('Discovery lists no tools')),
		async callTool(tool, args) {
			if (tool === 'afd-help')
				return asResult({
					success: true,
					data: {
						toolStrategy: 'hybrid',
						firstClassTools: [],
						commands: tools().map((name) => ({ name })),
					},
				});
			if (tool === 'afd-detail')
				return asResult({
					success: true,
					data: (args as { command: string[] }).command.map((name) => ({
						name,
						found: true,
						callable: true,
						mutation: false,
						description: `Runs ${name}`,
						inputSchema: { type: 'object', properties: {} },
					})),
				});
			return asResult({ success: true, data: {} });
		},
		async close() {},
	};
}

const UMBEL = {
	manifest_version: 1,
	protocol: 1,
	plugin: {
		id: 'umbel',
		title: 'Umbel',
		version: '0.1.0',
		description: 'A mounted host, for these tests.',
		kind: 'mounted',
		domains: ['umbel'],
	},
	mount: { prefix: 'umbel', transport: 'http' },
} as ManifestV1;

/** A kernel with the mounted instance `work`, its catalog read, over `store`; `route` names its server. */
async function mountedKernel(
	store: DataAdapter,
	tools: () => string[] = () => ['files-read'],
	route = 'mounts/work/mcp',
	instance = 'work',
	generation = 'test'
) {
	const journal = new MemoryJournalSink();
	const parts = await createKernelParts({
		store,
		storeKind: 'memory',
		journal,
		auth: new (await import('@lushly-dev/afd-auth')).MockAuthAdapter(),
		environment: createFixedEnvironment(),
		host: 'test',
		deployment: {
			deployment_version: 2,
			generation,
			workspace: { id: 'personal', name: 'Personal' },
			sandbox_origin: null,
			apps: [
				{
					instance,
					app: 'umbel',
					package: 'apps/work/',
					prefix: instance,
					audience: 'person',
					transport: 'http',
					route,
				},
			],
		} as ProjectionV3,
		ports: {
			...createFixturePorts({ 'apps/work/': { manifest: UMBEL } }),
			mountTransport: async () => mountedTransport(tools),
		},
	});
	kernels.push(parts.kernel);
	await parts.kernel.startInstances();
	return Object.assign(parts, { journal });
}

describe('P4-E4: orphans after a catalog (4.2; step 8 blocker 1, R1, R2)', () => {
	const flags = async (kernel: LoamKernel) =>
		Object.fromEntries(
			((await kernel.call<Listed>('autonomy-list')).data?.rows ?? []).map((row) => [
				row.id,
				row.orphan ?? false,
			])
		);

	it('keeps a restrictive row through a disable, a reload and a re-enable: the tool still only suggests', async () => {
		const store = new MemoryAdapter();
		const first = await mountedKernel(store);
		await first.kernel.call('autonomy-set', { level: 'workspace', mode: 'act' });
		const set = await first.kernel.call('autonomy-set', {
			level: 'workspace',
			instance: 'work',
			command: 'work-files-read',
			mode: 'suggest',
		});
		expect(set.data).toMatchObject({ row: { app: 'mounted:umbel:http:mounts/work/mcp' } });
		expect(
			(await first.kernel.call('workspace-app-set', { instance: 'work', enabled: false })).success
		).toBe(true);
		expect(await flags(first.kernel)).toEqual({
			'workspace/-/*/*': false,
			'workspace/-/work/work-files-read': false,
		});
		await first.kernel.dispose();
		// Reloaded while disabled: its catalog is unknown, never empty, so the flag stays as it is.
		const second = await mountedKernel(store);
		expect(await flags(second.kernel)).toEqual({
			'workspace/-/*/*': false,
			'workspace/-/work/work-files-read': false,
		});
		expect(
			(await second.kernel.call('workspace-app-set', { instance: 'work', enabled: true })).success
		).toBe(true);
		await second.kernel.call('app-instance-refresh', { instance: 'work' });
		expect(
			(await second.kernel.call<Data>('autonomy-get', { command: 'work-files-read' })).data?.mode
		).toBe('suggest');
		expect(await flags(second.kernel)).toEqual({
			'workspace/-/*/*': false,
			'workspace/-/work/work-files-read': false,
		});
	});

	it('flags a command a refresh drops, still bounds by it, and unflags it when the same server has it again', async () => {
		let tools = ['files-read', 'files-write'];
		const { kernel, journal } = await mountedKernel(new MemoryAdapter(), () => tools);
		await kernel.call('autonomy-set', { level: 'workspace', mode: 'act' });
		await kernel.call('autonomy-set', {
			level: 'workspace',
			instance: 'work',
			mode: 'act',
		});
		await kernel.call('autonomy-set', {
			level: 'workspace',
			instance: 'work',
			command: 'work-files-write',
			mode: 'suggest',
		});
		tools = ['files-read'];
		await kernel.call('app-instance-refresh', { instance: 'work' });
		expect((await flags(kernel))['workspace/-/work/work-files-write']).toBe(true);
		expect(
			(await journal.read()).filter(({ command }) => command === 'autonomy-settle')
		).toHaveLength(1);
		tools = ['files-read', 'files-write'];
		await kernel.call('app-instance-refresh', { instance: 'work' });
		expect((await flags(kernel))['workspace/-/work/work-files-write']).toBe(false);
		expect(
			(await kernel.call<Data>('autonomy-get', { command: 'work-files-write' })).data?.mode
		).toBe('suggest');
	});

	it('P4-E15: P4-E4: sends the orphan notice in local mode, and replays the settle that sent it with no difference', async () => {
		let tools = ['files-read', 'files-write'];
		const { kernel, journal } = await mountedKernel(new MemoryAdapter(), () => tools);
		await kernel.call('autonomy-set', {
			level: 'workspace',
			instance: 'work',
			command: 'work-files-write',
			mode: 'suggest',
		});
		tools = ['files-read'];
		await kernel.call('app-instance-refresh', { instance: 'work' });
		const listed = await kernel.call<{ notifications: Array<{ source: string; title: string }> }>(
			'notification-list'
		);
		expect(listed.data?.notifications).toEqual([
			expect.objectContaining({
				source: 'shell',
				title: 'An autonomy rule no longer matches an app or command',
			}),
		]);
		// `notification-list` is not journaled (as `persona-list`): a journaled read of the notice, whose answer the
		// replay must reproduce, so it holds only if the replayed settle wrote the same notice.
		expect((await kernel.call('notification-read', { all: true })).data).toEqual({ read: 1 });
		const live = (await kernel.call('notification-list', { body: true })).data;
		// Not an empty inbox, so the comparison below says something.
		expect((live as { notifications: unknown[] }).notifications.length).toBeGreaterThan(0);
		const { report, kernel: replayed } = await replayKernel(await journal.read(), {
			keep: true,
			deployment: {
				deployment_version: 2,
				generation: 'test',
				workspace: { id: 'personal', name: 'Personal' },
				sandbox_origin: null,
				apps: [
					{
						instance: 'work',
						app: 'umbel',
						package: 'apps/work/',
						prefix: 'work',
						audience: 'person',
						transport: 'http',
						route: 'mounts/work/mcp',
					},
				],
			} as unknown as ProjectionV4,
			ports: {
				...createFixturePorts({ 'apps/work/': { manifest: UMBEL } }),
				mountTransport: async () => mountedTransport(() => ['files-read']),
			},
		});
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
		expect(report.entries.some(({ command }) => command === 'autonomy-settle')).toBe(true);
		expect(report.entries.some(({ command }) => command === 'notification-read')).toBe(true);
		expect(report.entries.some(({ command }) => command === 'notification-list')).toBe(false);
		// The notice itself, not only its count: the replayed kernel's inbox equals the live one's, body and all.
		if (!replayed) throw new Error('replayKernel kept no kernel');
		try {
			expect((await replayed.call('notification-list', { body: true })).data).toEqual(live);
		} finally {
			await replayed.dispose();
		}
	});

	it('orphans a row whose instance now names another server, and the command name alone never backs it (R2)', async () => {
		const store = new MemoryAdapter();
		const first = await mountedKernel(store);
		await first.kernel.call('autonomy-set', { level: 'workspace', mode: 'act' });
		await first.kernel.call('autonomy-set', {
			level: 'workspace',
			instance: 'work',
			command: 'work-files-read',
			mode: 'suggest',
		});
		await first.kernel.dispose();
		// A later deployment names another server for the same instance.
		const second = await mountedKernel(store, undefined, 'mounts/other/mcp', 'work', 'moved');
		expect((await flags(second.kernel))['workspace/-/work/work-files-read']).toBe(true);
		await second.kernel.call('app-instance-refresh', { instance: 'work' });
		expect((await flags(second.kernel))['workspace/-/work/work-files-read']).toBe(true);
		// R1: still a bound, so the new server's tool of the same name only suggests until a person decides again.
		expect(
			(await second.kernel.call<Data>('autonomy-get', { command: 'work-files-read' })).data
		).toMatchObject({
			mode: 'suggest',
			from: 'workspace/-/*/*',
			ceilings: [{ id: 'workspace/-/work/work-files-read', mode: 'suggest' }],
		});
	});
});

describe('P4-E4: mounted tools (4.2, D156)', () => {
	it('resolve ask by default, even a read', async () => {
		const manifest = {
			manifest_version: 1,
			protocol: 1,
			plugin: {
				id: 'umbel',
				title: 'Umbel',
				version: '0.1.0',
				description: 'A mounted host, for these tests.',
				kind: 'mounted',
				domains: ['umbel'],
			},
			mount: { prefix: 'umbel', transport: 'http' },
		} as ManifestV1;
		const parts = await createKernelParts({
			store: new MemoryAdapter(),
			storeKind: 'memory',
			journal: new MemoryJournalSink(),
			auth: new (await import('@lushly-dev/afd-auth')).MockAuthAdapter(),
			environment: createFixedEnvironment(),
			host: 'test',
			deployment: {
				deployment_version: 2,
				generation: 'test',
				workspace: { id: 'personal', name: 'Personal' },
				sandbox_origin: null,
				apps: [
					{
						instance: 'work',
						app: 'umbel',
						package: 'apps/work/',
						prefix: 'work',
						audience: 'person',
						transport: 'http',
						route: 'mounts/work/mcp',
					},
				],
			} as ProjectionV3,
			ports: {
				...createFixturePorts({ 'apps/work/': { manifest } }),
				mountTransport: async () => mountedTransport(),
			},
		});
		kernels.push(parts.kernel);
		await parts.kernel.startInstances();
		const got = await parts.kernel.call<Data>('autonomy-get', { command: 'work-files-read' });
		expect(got.data).toMatchObject({ instance: 'work', mode: 'ask', from: 'default' });
		// A shell read and an app's read act.
		expect(
			(await parts.kernel.call<Data>('autonomy-get', { command: 'project-list' })).data?.mode
		).toBe('act');
	});
});

describe('P4-E15: autonomy replays', () => {
	it('replays a session of autonomy writes and reads with no difference', async () => {
		const { kernel, journal, projects, scopes } = await workspace();
		await kernel.call('autonomy-set', { level: 'workspace', mode: 'ask', ceiling: 'act' });
		await kernel.call('autonomy-set', {
			level: 'project',
			project: projects.atlas.id,
			instance: 'dual',
			command: 'dual-put',
			mode: 'act',
		});
		await kernel.call('autonomy-set', { level: 'person', cap: 'ask' });
		await kernel.call('autonomy-set', {
			level: 'project',
			project: projects.atlas.id,
			mode: 'act',
		});
		await kernel.call('autonomy-get', { command: 'dual-put' }, { scope: scopes.atlas });
		await kernel.call('autonomy-list');
		await kernel.agent.call('autonomy-set', { level: 'workspace', mode: 'act' });
		const { report } = await replayKernel(await journal.read(), {
			deployment: scopedDeployment(),
			ports: createFixturePorts(scopedPackages()),
		});
		expect(report.entries.filter(({ status }) => status !== 'same')).toEqual([]);
	});
});

describe("the orphan notice in provider mode (step 5's wiring; the coordinator's ruling)", () => {
	it('flags the rows and sends no notice until the owner roster is a server record', async () => {
		const store = new MemoryAdapter();
		const ports = (dual: ManifestV3) =>
			createFixturePorts({
				...scopedPackages(),
				'fixtures/dual/': { manifest: dual, definition: DUAL_DEFINITION },
			});
		const first = await workspace({
			store,
			identity: PROVIDER,
			membership: ACME(),
			empty: true,
			ports: ports(DUAL_MANIFEST),
		});
		await signIn(first.kernel, 'olu@example.com');
		expect(
			(
				await first.kernel.call('autonomy-set', {
					level: 'workspace',
					instance: 'dual',
					command: 'dual-put',
					mode: 'act',
				})
			).success
		).toBe(true);
		await first.kernel.dispose();
		const dropped = {
			...DUAL_MANIFEST,
			commands: (DUAL_MANIFEST.commands ?? []).filter(({ name }) => name !== 'dual-put'),
		} as ManifestV3;
		const second = await workspace({
			store,
			identity: PROVIDER,
			membership: ACME(),
			empty: true,
			ports: ports(dropped),
		});
		expect((await second.journal.read()).some(({ command }) => command === 'autonomy-settle')).toBe(
			true
		);
		const rows = (await store.list<AutonomyRowV1>(AUTONOMY_TABLE)).data;
		expect(rows.find((row) => row.command === 'dual-put')?.orphan).toBe(true);
		expect((await store.list(NOTIFICATION_TABLE)).data).toEqual([]);
	});
});

describe('the store (step 8 blocker 2): one browser, two workspaces', () => {
	const other = () => ({
		...scopedDeployment(),
		generation: 'other',
		workspace: { id: 'other', name: 'Other' },
	});

	it("never merges one workspace's row into another's, nor reads a row stored without its workspace's key", async () => {
		const store = new MemoryAdapter();
		// A row in the old shape, keyed by its id alone: not this workspace's, so never read and never merged into.
		await store.create<Record<string, unknown>>(AUTONOMY_TABLE, {
			id: 'workspace/-/*/*',
			workspace: 'personal',
			level: 'workspace',
			mode: 'act',
			ceiling: 'act',
			updatedAt: 1,
			updatedBy: 'local',
		});
		const first = await workspace({ store, empty: true });
		expect((await first.kernel.call<Listed>('autonomy-list')).data).toMatchObject({
			rows: [],
			ceiling: null,
		});
		await first.kernel.call('autonomy-set', { level: 'workspace', mode: 'ask', ceiling: 'act' });
		await first.kernel.dispose();
		const second = await workspace({ store, empty: true, deployment: other() as ProjectionV3 });
		expect((await second.kernel.call<Listed>('autonomy-list')).data).toMatchObject({
			rows: [],
			ceiling: null,
		});
		const written = await second.kernel.call<Data>('autonomy-set', {
			level: 'workspace',
			mode: 'suggest',
		});
		expect(written.data).toMatchObject({ row: { mode: 'suggest' }, previous: null });
		expect((written.data?.row as Data) ?? {}).not.toHaveProperty('ceiling');
		await second.kernel.dispose();
		const again = await workspace({ store, empty: true });
		expect((await again.kernel.call<Listed>('autonomy-list')).data).toMatchObject({
			rows: [{ id: 'workspace/-/*/*', mode: 'ask', ceiling: 'act' }],
			ceiling: 'act',
		});
	});
});

describe("P4-E4: D154's team-listed rule (step 8 blocker 3): only a `team` instance makes a project an owner's", () => {
	const listing = (audience: 'team' | 'person') => {
		const deployment = scopedDeployment();
		return {
			...deployment,
			apps: deployment.apps.map((app) =>
				app.instance === 'tasks' ? { ...app, audience, projects: ['vault'] } : app
			),
		} as ProjectionV3;
	};

	it("a person's own instance listing the project leaves its creator its rows and its members", async () => {
		const { kernel } = await workspace({
			identity: PROVIDER,
			membership: ACME(),
			empty: true,
			deployment: listing('person'),
		});
		await signIn(kernel, 'bea@example.com');
		const made = await kernel.call<{ id: string }>('project-create', {
			name: 'Vault',
			slug: 'vault',
		});
		expect(made.success, JSON.stringify(made.error)).toBe(true);
		const vault = made.data?.id as string;
		expect(
			(await kernel.call('autonomy-set', { level: 'project', project: vault, mode: 'ask' })).success
		).toBe(true);
		expect(
			(
				await kernel.call('project-update', {
					project: vault,
					access: { mode: 'restricted', members: [BEA, CY] },
				})
			).success
		).toBe(true);
	});

	it('a team instance listing it makes both an owner’s', async () => {
		const { kernel } = await workspace({
			identity: PROVIDER,
			membership: ACME(),
			empty: true,
			deployment: listing('team'),
		});
		await signIn(kernel, 'bea@example.com');
		expect(
			(await kernel.call('project-create', { name: 'Vault', slug: 'vault' })).error?.code
		).toBe('OWNER_REQUIRED');
	});
});

describe('autonomy-list in pages (step 8 blocker 7) and its writable (improvement 9)', () => {
	it('pages any number of rows within the budget, the general rows always first', async () => {
		const { kernel, store } = await workspace();
		await kernel.call('autonomy-set', { level: 'workspace', mode: 'ask', ceiling: 'act' });
		// 600 rows, more than one answer could hold: written as the store keeps them, under this workspace's key.
		await store.batch(
			Array.from({ length: 600 }, (_, index) => {
				const id = `workspace/-/dual/dual-x${String(index).padStart(3, '0')}`;
				return {
					method: 'PUT' as const,
					path: `/${AUTONOMY_TABLE}/${encodeURIComponent(`personal/${id}`)}`,
					body: {
						id: `personal/${id}`,
						rowId: id,
						workspace: 'personal',
						level: 'workspace',
						instance: 'dual',
						command: `dual-x${String(index).padStart(3, '0')}`,
						app: 'plugin:dual',
						mode: 'suggest',
						updatedAt: 1,
						updatedBy: 'local',
					},
				};
			})
		);
		const seen: string[] = [];
		let cursor: string | null | undefined;
		let pages = 0;
		do {
			const page = await kernel.call<Listed & { cursor: string | null }>('autonomy-list', {
				...(cursor ? { cursor } : {}),
			});
			expect(page.success, JSON.stringify(page.error)).toBe(true);
			if (pages === 0) expect(page.data?.rows[0]?.id).toBe('workspace/-/*/*');
			expect(page.data?.ceiling).toBe('act');
			seen.push(...(page.data?.rows ?? []).map(({ id }) => id));
			cursor = page.data?.cursor;
			pages++;
		} while (cursor);
		expect(pages).toBe(7);
		expect(new Set(seen).size).toBe(601);
		expect((await kernel.call('autonomy-list', { limit: 201 })).error?.code).toBe(
			'VALIDATION_ERROR'
		);
		expect(
			(await kernel.call<Listed>('autonomy-list', { limit: 2 })).data?.rows.map(({ id }) => id)
		).toEqual(['workspace/-/*/*', 'workspace/-/dual/dual-x000']);
	});

	it('ends a page before the output budget with long identities, and still shows the general row and the cap', async () => {
		const { kernel, store } = await workspace();
		await kernel.call('autonomy-set', { level: 'workspace', mode: 'ask', ceiling: 'act' });
		await kernel.call('autonomy-set', { level: 'person', cap: 'ask' });
		// 150 rows, each with a 128-character command and a deployer's route thousands of characters long.
		const route = `mounts/${'r'.repeat(6_000)}/mcp`;
		await store.batch(
			Array.from({ length: 150 }, (_, index) => {
				const command = `dual-${String(index).padStart(3, '0')}${'-x'.repeat(60)}`.slice(0, 128);
				const id = `workspace/-/dual/${command}`;
				return {
					method: 'PUT' as const,
					path: `/${AUTONOMY_TABLE}/${encodeURIComponent(`personal/${id}`)}`,
					body: {
						id: `personal/${id}`,
						rowId: id,
						workspace: 'personal',
						level: 'workspace',
						instance: 'dual',
						command,
						app: `mounted:umbel:http:${route}`,
						mode: 'suggest',
						updatedAt: 1,
						updatedBy: 'local',
					},
				};
			})
		);
		const seen = new Set<string>();
		let cursor: string | null | undefined;
		let pages = 0;
		do {
			const page = await kernel.call<Listed & { cursor: string | null }>('autonomy-list', {
				...(cursor ? { cursor } : {}),
			});
			expect(page.success, JSON.stringify(page.error)).toBe(true);
			expect(new TextEncoder().encode(JSON.stringify(page.data)).length).toBeLessThanOrEqual(
				65_536 - 4_096
			);
			expect(page.data).toMatchObject({ ceiling: 'act', cap: 'ask' });
			if (pages === 0) {
				expect(page.data?.rows[0]?.id).toBe('workspace/-/*/*');
				// Cut by bytes before the default 100 rows.
				expect(page.data?.rows.length).toBeLessThan(100);
			}
			for (const row of page.data?.rows ?? []) {
				expect((row.app ?? '').length).toBeLessThanOrEqual(257);
				seen.add(row.id);
			}
			cursor = page.data?.cursor;
			pages++;
		} while (cursor && pages < 20);
		expect(seen.size).toBe(151);
	});

	it("reports an archived project's rows not writable, as the write refuses them", async () => {
		const { kernel, projects } = await workspace();
		await kernel.call('project-archive', { project: projects.beacon.id });
		expect(
			(await kernel.call<Listed>('autonomy-list', { project: projects.beacon.id })).data?.writable
				.project
		).toEqual({ writable: false, reason: 'PROJECT_ARCHIVED' });
	});
});

describe("the instance id `shell` (step 8's R4, beside step 3's reservation)", () => {
	it("knows a host's own command as the shell's, from the live registry", async () => {
		const echo = defineCommand({
			name: 'host-echo',
			description: 'The host’s own command',
			input: z.object({}),
			async handler() {
				return success({ ok: true });
			},
		}) as unknown as ZodCommandDefinition;
		const parts = await createKernelParts({
			store: new MemoryAdapter(),
			storeKind: 'memory',
			journal: new MemoryJournalSink(),
			auth: new (await import('@lushly-dev/afd-auth')).MockAuthAdapter(),
			environment: createFixedEnvironment(),
			host: 'test',
			commands: [echo],
		});
		kernels.push(parts.kernel);
		expect(
			(await parts.kernel.call<Data>('autonomy-get', { command: 'host-echo' })).data
		).toMatchObject({ instance: 'shell', mode: 'act' });
		const set = await parts.kernel.call<Data>('autonomy-set', {
			level: 'workspace',
			instance: 'shell',
			command: 'host-echo',
			mode: 'ask',
		});
		expect(set.data).toMatchObject({ row: { app: 'loam' } });
		// An internal command is not a shell command a row may name.
		expect(
			(
				await parts.kernel.call('autonomy-set', {
					level: 'workspace',
					instance: 'shell',
					command: 'app-call-refuse',
					mode: 'ask',
				})
			).error?.code
		).toBe('AUTONOMY_COMMAND_UNKNOWN');
	});

	it('never takes an app deployed as `shell` for the shell: its rows are orphaned and it is refused', async () => {
		const store = new MemoryAdapter();
		const first = await mountedKernel(store);
		await first.kernel.call('autonomy-set', {
			level: 'workspace',
			instance: 'shell',
			command: 'project-create',
			mode: 'suggest',
		});
		await first.kernel.dispose();
		// The deployment reader refuses the id since step 3 (`DEPLOYMENT_INSTANCE_RESERVED`); a projection a host builds
		// itself does not pass through it, so the kernel can still be handed a mounted instance named `shell`.
		const second = await mountedKernel(store, undefined, 'mounts/shell/mcp', 'shell', 'taken');
		expect((await second.kernel.call<Listed>('autonomy-list')).data?.rows).toMatchObject([
			{ id: 'workspace/-/shell/project-create', app: 'loam', orphan: true },
		]);
		for (const input of [
			{ instance: 'shell', command: 'project-create', mode: 'ask' },
			{ instance: 'shell', command: 'shell-files-read', mode: 'ask' },
		]) {
			expect(
				(await second.kernel.call('autonomy-set', { level: 'workspace', ...input })).error?.code,
				JSON.stringify(input)
			).toBe('AUTONOMY_COMMAND_UNKNOWN');
		}
		expect(
			(await second.kernel.call('autonomy-get', { command: 'project-create' })).error?.code
		).toBe('AUTONOMY_COMMAND_UNKNOWN');
		// Still a bound (R1), so no tool of that name loosens past it.
		expect((await second.kernel.call<Listed>('autonomy-list')).data?.rows[0]?.mode).toBe('suggest');
	});
});

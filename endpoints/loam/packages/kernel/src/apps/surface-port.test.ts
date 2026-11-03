/**
 * The surface port's trust boundary (phase 2 specification, 3.6; D83): one test, or more, per check
 * `createAppPort`'s `checkedCall` makes, and per line of the scope middleware a call from a surface
 * reaches. A view's broker is a surface's, so each check is a boundary for a view (D54).
 */

import type { CommandResult, JournalEntry } from '@lushly-dev/afd-core';
import type { ManifestV2 } from '@lushly-dev/loam-manifest';
import { type AppCallContextV1, defineApp, success } from '@lushly-dev/loam-sdk';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, describe, expect, it } from 'vitest';
import {
	createScopedWorkspace,
	createTestKernel,
	PROBE_MANIFEST,
	probeDefinition,
	probeDeployment,
	probeViewManifest,
	type ScopedWorkspace,
	seedProjects,
} from '../testing.js';
import { createFixturePorts } from '../testing-probe.js';
import type { LoamKernelV2, ScopeV1, ViewBrokerV1 } from '../types.js';

const kernels: LoamKernelV2[] = [];
afterEach(async () => {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.dispose()));
});

const WORKSPACE: ScopeV1 = { workspace: 'personal' };
/** Each project's scope, set by the test's workspace: its ids come off the journal's tape. */
let ATLAS: ScopeV1;
let BEACON: ScopeV1;
let CITADEL: ScopeV1;

async function scoped(): Promise<ScopedWorkspace> {
	const workspace = await createScopedWorkspace();
	kernels.push(workspace.kernel);
	({ atlas: ATLAS, beacon: BEACON, citadel: CITADEL } = workspace.scopes);
	return workspace;
}

const last = async (workspace: { journal: { read(): Promise<JournalEntry[]> } }) =>
	(await workspace.journal.read()).at(-1) as JournalEntry;

const codeOf = (result: CommandResult<unknown>) => result.error?.code;

describe('P2-E7: the checks of a surface port, in the order `checkedCall` makes them', () => {
	it('1. refuses a scope the app names, journaled, whatever the scope', async () => {
		const workspace = await scoped();
		const surface = workspace.kernel.appPort('dual').surface({ scope: ATLAS });
		for (const options of [{ scope: BEACON }, { scope: ATLAS }, { scope: 'workspace' }]) {
			const result = await surface.call('dual-where', {}, options as never);
			expect(codeOf(result)).toBe('SCOPE_NOT_GRANTED');
			const entry = await last(workspace);
			expect(entry.command).toBe('app-scope-refuse');
			expect(entry.context).toMatchObject({ caller: 'dual', scope: ATLAS });
		}
		// A level other than `workspace` is a scope too.
		expect(codeOf(await surface.call('dual-where', {}, { level: 'project' } as never))).toBe(
			'SCOPE_NOT_GRANTED'
		);
		// The chrome's port refuses the same, and a handler's nested client too.
		const port = workspace.kernel.appPort('dual');
		expect(codeOf(await port.call('dual-where', {}, { scope: BEACON } as never))).toBe(
			'SCOPE_NOT_GRANTED'
		);
	});

	it("1. widens to the workspace with `level: 'workspace'`, and nothing wider", async () => {
		const workspace = await scoped();
		const surface = workspace.kernel.appPort('dual').surface({ scope: ATLAS });
		const here = await surface.call<{ scope: ScopeV1 }>('dual-where');
		const wide = await surface.call<{ scope: ScopeV1 }>('dual-where', {}, { level: 'workspace' });
		expect(here.data?.scope).toEqual(ATLAS);
		expect(wide.data?.scope).toEqual(WORKSPACE);
		// A handler's own client holds its call's scope, and widens only to the workspace.
		const nested = await surface.call<{ here: ScopeV1; wide: ScopeV1 }>('dual-nested');
		expect(nested.data).toEqual({ here: ATLAS, wide: WORKSPACE });
	});

	it('2. answers a boot-only command as one that does not exist, through a port too (E10)', async () => {
		const workspace = await scoped();
		const surface = workspace.kernel.appPort('dual').surface({ scope: ATLAS });
		const input = { generation: 'forged', workspace: { id: 'personal', name: 'P' }, entries: [] };
		for (const result of [
			await surface.call('workspace-deployment-apply', input),
			await workspace.kernel.appPort('dual').call('workspace-deployment-apply', input),
			await workspace.kernel.call('workspace-deployment-apply', input),
			await workspace.kernel.agent.call('workspace-deployment-apply', input),
		]) {
			expect(codeOf(result)).toBe('COMMAND_NOT_FOUND');
		}
		expect(codeOf(await workspace.kernel.call('document-trash-expire', {}))).toBe(
			'COMMAND_NOT_FOUND'
		);
		expect((await workspace.kernel.call('workspace-get')).data).toMatchObject({
			generation: 'scoped',
		});
	});

	it('3. refuses what is neither its own nor callable with its grants', async () => {
		const workspace = await scoped();
		const surface = workspace.kernel.appPort('dual').surface({ scope: ATLAS });
		for (const name of [
			'layout-set',
			'scope-set',
			'project-create',
			'workspace-app-set',
			'solo-put',
		]) {
			expect(codeOf(await surface.call(name, {})), name).toBe('CALL_NOT_GRANTED');
		}
		// `scope-get` always; `project-list` and `project-get` with `projects`, which `dual` declares.
		expect((await surface.call('scope-get')).success).toBe(true);
		expect((await surface.call('project-list')).success).toBe(true);
		expect((await surface.call('project-get', { project: 'atlas' })).success).toBe(true);
	});

	it('3. refuses `project-list` and `project-get` without the `projects` grant', async () => {
		const kernel = await probeKernel();
		const port = kernel.appPort('probe');
		expect(codeOf(await port.call('project-list'))).toBe('CALL_NOT_GRANTED');
		expect(codeOf(await port.call('project-get', { project: 'atlas' }))).toBe('CALL_NOT_GRANTED');
		expect((await port.call('scope-get')).data).toEqual({ scope: WORKSPACE });
	});

	it('4. refuses a command that names another instance', async () => {
		const workspace = await scoped();
		const surface = workspace.kernel.appPort('dual').surface({ scope: WORKSPACE });
		expect(codeOf(await surface.call('app-selection-get', { instance: 'solo' }))).toBe(
			'CALL_NOT_GRANTED'
		);
		expect(codeOf(await surface.call('app-route-set', { instance: 'solo', path: 'x' }))).toBe(
			'CALL_NOT_GRANTED'
		);
		await workspace.kernel.call('app-open', { instance: 'dual' });
		expect(
			(await surface.call('app-route-set', { instance: 'dual', path: 'items/1' })).success
		).toBe(true);
	});

	it("5. refuses a handler's nested mutation from a surface's call, as phase 1 does (D68)", async () => {
		const kernel = await probeKernel();
		const surface = kernel.appPort('probe').surface({ scope: WORKSPACE });
		const sneaked = await surface.call<{ refused: string }>('probe-sneak');
		expect(sneaked.data?.refused).toBe('NESTED_MUTATION_REFUSED');
	});

	it("6. refuses an embed's mutation, journaled, and runs its queries", async () => {
		const workspace = await scoped();
		const embed = workspace.kernel.appPort('dual').surface({ scope: ATLAS, readOnly: true });
		expect(embed.readOnly).toBe(true);
		const refused = await embed.call('dual-put', { key: 'k', value: 'v' });
		expect(codeOf(refused)).toBe('EMBED_READ_ONLY');
		expect((await last(workspace)).command).toBe('app-embed-refuse');
		expect((await embed.call<{ value: unknown }>('dual-get', { key: 'k' })).data?.value).toBeNull();
		// A query of an embed cannot write either (5).
		expect((await embed.call<{ refused: string }>('dual-sneak', { key: 'k' })).data?.refused).toBe(
			'STORE_WRITE_IN_QUERY'
		);
	});

	it('runs bound to the scope it was created in, whatever is active when the call arrives', async () => {
		const workspace = await scoped();
		const { kernel } = workspace;
		await kernel.call('scope-set', { project: 'atlas' });
		const surface = kernel.appPort('dual').surface({ scope: ATLAS });
		// A press in flight during a switch stays in the project it was pressed in.
		const pressed = surface.call('dual-put', { key: 'k', value: 'atlas' });
		await kernel.call('scope-set', { project: 'beacon' });
		await pressed;
		await surface.call('dual-put', { key: 'later', value: 'atlas' });
		expect(await workspace.store.get('app-dual', `p~${ATLAS.project}~k`)).toBeTruthy();
		expect(await workspace.store.get('app-dual', `p~${ATLAS.project}~later`)).toBeTruthy();
		expect(await workspace.store.get('app-dual', `p~${BEACON.project}~k`)).toBeNull();
		// The chrome's port follows the active scope instead.
		await kernel.appPort('dual').call('dual-put', { key: 'k', value: 'beacon' });
		expect(await workspace.store.get('app-dual', `p~${BEACON.project}~k`)).toBeTruthy();
	});

	it('keeps its scope though the caller changes the object it was given', async () => {
		const workspace = await scoped();
		const given = { ...ATLAS };
		const surface = workspace.kernel.appPort('dual').surface({ scope: given });
		given.project = BEACON.project as string;
		expect((await surface.call<{ scope: ScopeV1 }>('dual-where')).data?.scope).toEqual(ATLAS);
		expect(() => {
			(surface as { scope: ScopeV1 }).scope = BEACON;
		}).toThrow();
	});
});

describe("P2-E7: the scope middleware's lines, reached from a surface", () => {
	it('2. refuses a project the actor may not enter with the same bytes as one that does not exist', async () => {
		const workspace = await scoped();
		const port = workspace.kernel.appPort('dual');
		const restricted = await port.surface({ scope: CITADEL }).call('dual-where');
		const missing = await port
			.surface({ scope: { workspace: 'personal', project: 'prj_nowhere' } })
			.call('dual-where');
		expect(codeOf(restricted)).toBe('PROJECT_NOT_FOUND');
		expect(JSON.stringify(restricted.error)).toBe(JSON.stringify(missing.error));
		expect(restricted.error?.message).toBe('No project with that name is available to you');
		expect((await last(workspace)).result.error?.code).toBe('PROJECT_NOT_FOUND');
	});

	it('1. refuses a workspace this kernel does not serve', async () => {
		const workspace = await scoped();
		const surface = workspace.kernel.appPort('dual').surface({ scope: { workspace: 'acme' } });
		expect(codeOf(await surface.call('dual-where'))).toBe('SCOPE_WORKSPACE_UNKNOWN');
	});

	it('3. refuses a project-only app with no project, naming scope-set', async () => {
		const workspace = await scoped();
		const result = await workspace.kernel
			.appPort('tasks')
			.surface({ scope: WORKSPACE })
			.call('tasks-list');
		expect(result.error).toMatchObject({
			code: 'SCOPE_PROJECT_REQUIRED',
			message: 'Open a project first',
		});
		expect(result.error?.suggestion).toContain('scope-set');
		expect((await last(workspace)).result.error?.code).toBe('SCOPE_PROJECT_REQUIRED');
	});

	it('4. narrows a workspace-only app to the workspace with a project active, and never refuses', async () => {
		const workspace = await scoped();
		await workspace.kernel.call('scope-set', { project: 'atlas' });
		const surface = workspace.kernel.appPort('solo').surface({ scope: ATLAS });
		const result = await surface.call<{ scope: ScopeV1; project: unknown }>('solo-where');
		expect(result.data).toEqual({ scope: WORKSPACE, project: null });
		expect((await last(workspace)).context?.scope).toEqual(WORKSPACE);
		await surface.call('solo-put', { key: 'k', value: 'v' });
		expect(await workspace.store.get('app-solo', 'k')).toMatchObject({ scope: WORKSPACE });
	});

	it('5. refuses a key of another project the actor may enter, naming it; an app learns no name', async () => {
		const workspace = await scoped();
		const { kernel } = workspace;
		await kernel.call('scope-set', { project: 'beacon' });
		await kernel.call('tasks-add', { task: 't-1', title: 'Beacon' });
		await kernel.call('scope-set', { project: 'atlas' });
		const person = await kernel.call('tasks-complete', { task: 't-1' });
		expect(person.error).toMatchObject({
			code: 'SCOPE_MISMATCH',
			message: '`t-1` is in the project Beacon, not Atlas',
			suggestion: 'Switch with scope-set { project: "beacon" } and run this again.',
			details: { project: { id: BEACON.project, slug: 'beacon', name: 'Beacon' } },
		});
		const app = await kernel.appPort('tasks').surface({ scope: ATLAS }).call('tasks-complete', {
			task: 't-1',
		});
		expect(app.error?.code).toBe('SCOPE_MISMATCH');
		expect(app.error?.message).toBe('`t-1` is in another scope');
		expect(JSON.stringify(app.error)).not.toMatch(/beacon/i);
		// Nothing of Beacon changed.
		expect(await workspace.store.get('app-tasks', `p~${BEACON.project}~t-1`)).toMatchObject({
			value: { done: false },
		});
	});

	it('5. lets a key that is only where the actor may not go reach the handler as missing', async () => {
		const workspace = await scoped();
		await workspace.store.batch([
			{
				method: 'PUT',
				path: `/app-tasks/p~${CITADEL.project}~t-9`,
				body: { id: `p~${CITADEL.project}~t-9`, key: 't-9', value: { title: 'Secret' } },
			},
		]);
		await workspace.kernel.call('scope-set', { project: 'atlas' });
		const result = await workspace.kernel.call('tasks-complete', { task: 't-9' });
		expect(result.error?.code).toBe('TASK_NOT_FOUND');
		expect(JSON.stringify(result)).not.toMatch(/citadel|secret/i);
	});

	it('6. refuses a mutation in an archived project, naming project-restore, and still reads', async () => {
		const workspace = await scoped();
		const { kernel } = workspace;
		await kernel.call('scope-set', { project: 'atlas' });
		await kernel.call('tasks-add', { task: 't-1', title: 'One' });
		await kernel.call('project-archive', { project: 'atlas' });
		const surface = kernel.appPort('tasks').surface({ scope: ATLAS });
		const refused = await surface.call('tasks-add', { task: 't-2', title: 'Two' });
		expect(refused.error?.code).toBe('PROJECT_ARCHIVED');
		expect(refused.error?.suggestion).toContain('project-restore');
		expect((await surface.call<{ items: unknown[] }>('tasks-list')).data?.items).toHaveLength(1);
		await kernel.call('project-restore', { project: 'atlas' });
		expect((await surface.call('tasks-add', { task: 't-2', title: 'Two' })).success).toBe(true);
	});

	it('refuses every call into a disabled instance, at once, and app-open too', async () => {
		const workspace = await scoped();
		const { kernel } = workspace;
		expect(
			(await kernel.call('workspace-app-set', { instance: 'solo', enabled: false })).success
		).toBe(true);
		const surface = kernel.appPort('solo').surface({ scope: WORKSPACE });
		expect(codeOf(await surface.call('solo-where'))).toBe('APP_DISABLED');
		expect(codeOf(await kernel.call('app-open', { instance: 'solo' }))).toBe('APP_DISABLED');
		const list = await kernel.call<{ apps: Array<{ instance: string; state: string }> }>(
			'app-list'
		);
		expect(list.data?.apps.find((app) => app.instance === 'solo')?.state).toBe('disabled');
		expect(kernel.listCommands().some((command) => command.instance === 'solo')).toBe(false);
		await kernel.call('workspace-app-set', { instance: 'solo', enabled: true });
		expect((await surface.call('solo-where')).success).toBe(true);
	});
});

describe('P2-E7: what an app reads through a port', () => {
	it("answers `scope-get` with the call's effective scope alone", async () => {
		const workspace = await scoped();
		await workspace.kernel.call('scope-set', { project: 'atlas' });
		const dual = await workspace.kernel.appPort('dual').surface({ scope: ATLAS }).call('scope-get');
		expect(dual.data).toEqual({ scope: ATLAS });
		// A workspace-only app narrowed under Atlas learns no project.
		const solo = await workspace.kernel.appPort('solo').surface({ scope: ATLAS }).call('scope-get');
		expect(solo.data).toEqual({ scope: ATLAS });
		const person = await workspace.kernel.call<{ project: { slug: string } }>('scope-get');
		expect(person.data?.project.slug).toBe('atlas');
	});

	it('lists projects with no members and no writer, and none the actor may not enter', async () => {
		const workspace = await scoped();
		const surface = workspace.kernel.appPort('dual').surface({ scope: WORKSPACE });
		const list = await surface.call<{ projects: Array<Record<string, unknown>> }>('project-list');
		expect(list.data?.projects.map((project) => project.slug)).toEqual(['atlas', 'beacon']);
		for (const project of list.data?.projects ?? []) {
			expect(Object.keys(project).sort()).toEqual(
				['createdAt', 'icon', 'id', 'name', 'slug', 'status', 'updatedAt', 'workspace'].sort()
			);
		}
		expect(codeOf(await surface.call('project-get', { project: 'citadel' }))).toBe(
			'PROJECT_NOT_FOUND'
		);
		// `context.projects.active()` answers the call's effective project.
		const where = await surface.call<{ project: { slug: string } | null }>('dual-where');
		expect(where.data?.project).toBeNull();
		const inAtlas = await workspace.kernel
			.appPort('dual')
			.surface({ scope: ATLAS })
			.call<{ project: { slug: string; access?: unknown } }>('dual-where');
		expect(inAtlas.data?.project.slug).toBe('atlas');
		expect(inAtlas.data?.project.access).toBeUndefined();
	});
});

describe("P2-E7: a view's broker is its surface's", () => {
	const SANDBOX = 'https://sandbox.loam.test';
	const viewManifest = {
		...probeViewManifest('probev'),
		manifest_version: 2,
		app: { scope_levels: ['workspace', 'project'] },
	} as ManifestV2;
	const viewDefinition = defineApp({
		sdk: 1,
		handlers: {
			'probev-note': (async (input: { text: string }, context: AppCallContextV1) => {
				await context.store?.put('note', input.text);
				return success({ scope: context.scope });
			}) as never,
			'probev-list': (async (_input: unknown, context: AppCallContextV1) => {
				try {
					await context.store?.put('note', 'from a query');
					return success({ items: [], refused: null });
				} catch (cause) {
					const error = cause as { code?: string; details?: { rpcCode?: number } };
					return success({ items: [], refused: error.code, rpc: error.details?.rpcCode });
				}
			}) as never,
			'probev-count': (async () => success({ count: 0 })) as never,
			'probev-sneak': (async () => success({})) as never,
			'probev-peek': (async () => success({})) as never,
			'probev-hidden': (async () => success({})) as never,
		},
	});

	async function viewKernel() {
		const store = new MemoryAdapter();
		await seedProjects(store);
		ATLAS = { workspace: 'personal', project: 'prj_atlas' };
		BEACON = { workspace: 'personal', project: 'prj_beacon' };
		const { kernel, journal } = await createTestKernel({
			store,
			deployment: probeDeployment(
				[{ instance: 'probev', app: 'probev', package: 'apps/probev/' }],
				SANDBOX
			),
			ports: createFixturePorts({
				'apps/probev/': {
					manifest: viewManifest,
					definition: viewDefinition,
					files: { 'handlers.html': '<!doctype html>', 'main.html': '<!doctype html>' },
				},
			}),
		});
		kernels.push(kernel);
		return { kernel, journal, store };
	}

	it("runs a view's tools/call at its surface's scope, and ignores a scope in its `_meta`", async () => {
		const { kernel, store } = await viewKernel();
		const view = kernel.appPort('probev').surface({ scope: ATLAS }).view as ViewBrokerV1;
		const answer = await view.toolsCall({
			name: 'probev-note',
			arguments: { text: 'atlas' },
			_meta: { 'dev.loam/scope': BEACON },
		});
		expect((answer.structuredContent as { data: unknown }).data).toEqual({ scope: ATLAS });
		expect(await store.get('app-probev', `p~${ATLAS.project}~note`)).toMatchObject({
			value: 'atlas',
		});
		expect(await store.get('app-probev', `p~${BEACON.project}~note`)).toBeNull();
		const wide = await view.toolsCall({
			name: 'probev-note',
			arguments: { text: 'workspace' },
			_meta: { 'dev.loam/level': 'workspace' },
		});
		expect((wide.structuredContent as { data: unknown }).data).toEqual({ scope: WORKSPACE });
		const refused = await view.toolsCall({
			name: 'probev-note',
			arguments: { text: 'x' },
			_meta: { 'dev.loam/level': 'project' },
		});
		expect((refused.structuredContent as CommandResult).error?.code).toBe('SCOPE_NOT_GRANTED');
	});

	it("7. refuses a view's modal within the cooldown, journaled", async () => {
		const { kernel, journal } = await viewKernel();
		await kernel.call('app-open', { instance: 'probev' });
		const view = kernel.appPort('probev').surface({ scope: WORKSPACE }).view as ViewBrokerV1;
		const modal = { name: 'modal-open', arguments: { title: 'Sure?', body: 'Say so.' } };
		const opened = (await view.toolsCall(modal)).structuredContent as CommandResult<{
			overlayId: string;
		}>;
		expect(opened.success).toBe(true);
		// A person closes it, so the view gets time before the next (phase 1 specification, 9.7).
		await kernel.call('overlay-dismiss', {
			overlayId: opened.data?.overlayId,
			result: 'cancel',
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		const again = (await view.toolsCall(modal)).structuredContent as CommandResult;
		expect(again.error?.code).toBe('OVERLAY_COOLDOWN');
		expect((await journal.read()).at(-1)?.command).toBe('app-modal-refuse');
	});

	it("refuses a frame's store write under a query as STORE_WRITE_IN_QUERY, -32601", async () => {
		const { kernel, store } = await viewKernel();
		const listed = await kernel.call<{ refused: string; rpc: number }>('probev-list');
		expect(listed.data).toMatchObject({ refused: 'STORE_WRITE_IN_QUERY', rpc: -32601 });
		expect(await store.get('app-probev', 'note')).toBeNull();
	});
});

/** The probe app without its optional `projects` grant. */
async function probeKernel(): Promise<LoamKernelV2> {
	const manifest = {
		...PROBE_MANIFEST,
		grants: PROBE_MANIFEST.grants?.filter((grant) => grant.name !== 'projects'),
	};
	const { kernel } = await createTestKernel({
		deployment: probeDeployment(),
		ports: createFixturePorts({ 'apps/probe/': { manifest, definition: probeDefinition() } }),
	});
	kernels.push(kernel);
	return kernel;
}

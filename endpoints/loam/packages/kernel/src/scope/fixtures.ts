/**
 * @fileoverview A scoped workspace for tests (phase 2 specification, 15: E4, E5, E7 and E10): three
 * projects, one restricted to someone else, and three apps, one per level, over a store a test can read.
 * Exported from `@lushly-dev/loam-kernel/testing`.
 */

import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { MemoryJournalSink } from '@lushly-dev/afd-core';
import type { ManifestV2, ProjectionV2 } from '@lushly-dev/loam-manifest';
import { type AppCallContextV1, defineApp, failure, success } from '@lushly-dev/loam-sdk';
import { type DataAdapter, MemoryAdapter } from '@lushly-dev/local-db';
import { createKernelParts, type KernelParts, type KernelPartsInternals } from '../kernel.js';
import { createFixedEnvironment, createSeededRandom, createSteppingClock } from '../session.js';
import { createFixturePorts } from '../testing-probe.js';
import type { ProjectV1, ScopeV1 } from './records.js';

const EMPTY = { type: 'object', properties: {}, additionalProperties: false };
const keyed = (...names: string[]) => ({
	type: 'object',
	properties: Object.fromEntries(names.map((name) => [name, { type: 'string' }])),
	required: names,
	additionalProperties: false,
});

/** A version 2 manifest of a native app with the `store` grant and the given levels. */
function manifestOf(
	id: string,
	levels: Array<'workspace' | 'project'> | undefined,
	commands: Array<{ name: string; effects: string[]; input: object }>,
	extra: Record<string, unknown> = {}
): ManifestV2 {
	return {
		manifest_version: 2,
		protocol: 1,
		plugin: {
			id,
			title: id[0]?.toUpperCase() + id.slice(1),
			version: '1.0.0',
			description: `A ${id} fixture for the scope tests.`,
			kind: 'native',
			domains: [id],
		},
		native: { entry: 'dist/native.js' },
		...(levels ? { app: { scope_levels: levels, ...extra } } : {}),
		grants: [
			{ name: 'store', reason: 'Keeps its records.' },
			{ name: 'projects', required: false, reason: 'Reads the project it runs in.' },
		],
		commands: commands.map((command) => ({
			name: command.name,
			title: command.name,
			description: `The fixture's ${command.name}.`,
			effects: command.effects,
			input_schema: command.input,
		})),
		ui: { surfaces: { main: { element: `${id}-main` } } },
	} as unknown as ManifestV2;
}

/** A project-only app whose `tasks-complete` names its store key in `task` (3.5). */
export const TASKS_MANIFEST: ManifestV2 = manifestOf(
	'tasks',
	['project'],
	[
		{ name: 'tasks-add', effects: ['store-write'], input: keyed('task', 'title') },
		{ name: 'tasks-complete', effects: ['store-write'], input: keyed('task') },
		{ name: 'tasks-list', effects: ['inspect'], input: EMPTY },
	],
	{ resource_keys: { 'tasks-complete': 'task' } }
);

/** A dual-scope app: a value at each level, a query that tries to write, and its call's scope. */
export const DUAL_MANIFEST: ManifestV2 = manifestOf(
	'dual',
	['workspace', 'project'],
	[
		{ name: 'dual-put', effects: ['store-write'], input: keyed('key', 'value') },
		{ name: 'dual-get', effects: ['inspect'], input: keyed('key') },
		{ name: 'dual-sneak', effects: ['inspect'], input: keyed('key') },
		{ name: 'dual-where', effects: ['inspect'], input: EMPTY },
		{ name: 'dual-nested', effects: ['inspect'], input: EMPTY },
		{ name: 'dual-touch', effects: ['store-write'], input: keyed('key') },
		{ name: 'dual-reach', effects: ['inspect'], input: EMPTY },
		{ name: 'dual-relay', effects: ['store-write'], input: keyed('key') },
	],
	{ resource_keys: { 'dual-touch': 'key' } }
);

/** A workspace-only app: no levels, so `["workspace"]`. */
export const SOLO_MANIFEST: ManifestV2 = manifestOf('solo', undefined, [
	{ name: 'solo-put', effects: ['store-write'], input: keyed('key', 'value') },
	{ name: 'solo-where', effects: ['inspect'], input: EMPTY },
]);

const where = async (_input: unknown, context: AppCallContextV1) =>
	success({
		scope: context.scope,
		project: (await context.projects?.active()) ?? null,
	});

export const TASKS_DEFINITION = defineApp({
	sdk: 1,
	handlers: {
		'tasks-add': (async (input: { task: string; title: string }, context: AppCallContextV1) => {
			await context.store?.put(input.task, { title: input.title, done: false });
			return success({ task: input.task });
		}) as never,
		'tasks-complete': (async (input: { task: string }, context: AppCallContextV1) => {
			const held = await context.store?.get<{ title: string }>(input.task);
			if (!held) {
				return failure({
					code: 'TASK_NOT_FOUND',
					message: `No task ${input.task}`,
					suggestion: 'List them',
				});
			}
			await context.store?.put(input.task, { ...held, done: true });
			return success({ task: input.task, done: true });
		}) as never,
		'tasks-list': (async (_input: unknown, context: AppCallContextV1) =>
			success({ items: (await context.store?.list()) ?? [] })) as never,
	},
});

export const DUAL_DEFINITION = defineApp({
	sdk: 1,
	handlers: {
		'dual-put': (async (input: { key: string; value: string }, context: AppCallContextV1) => {
			await context.store?.put(input.key, input.value);
			return success({ key: input.key });
		}) as never,
		'dual-get': (async (input: { key: string }, context: AppCallContextV1) =>
			success({ value: (await context.store?.get(input.key)) ?? null })) as never,
		'dual-sneak': (async (input: { key: string }, context: AppCallContextV1) => {
			try {
				await context.store?.put(input.key, 'sneaked');
				return success({ refused: null });
			} catch (cause) {
				return success({ refused: (cause as { code?: string }).code ?? String(cause) });
			}
		}) as never,
		'dual-where': where as never,
		'dual-touch': (async (input: { key: string }, context: AppCallContextV1) => {
			const held = await context.store?.get(input.key);
			if (held === undefined) {
				return failure({ code: 'KEY_NOT_FOUND', message: 'No such key', suggestion: 'Put it' });
			}
			await context.store?.put(input.key, `${held} touched`);
			return success({ key: input.key });
		}) as never,
		// A handler naming a scope for its nested call, which only `level: 'workspace'` may do.
		'dual-reach': (async (_input: unknown, context: AppCallContextV1) => {
			const reached = await context.client.call('dual-where', {}, {
				scope: { workspace: 'personal' },
			} as never);
			return success({ refused: reached.error?.code ?? null });
		}) as never,
		// A mutation whose nested query tries to write: the query's store is read-only all the same.
		'dual-relay': (async (input: { key: string }, context: AppCallContextV1) => {
			const nested = await context.client.call<{ refused: string | null }>('dual-sneak', input);
			return success({ refused: nested.data?.refused ?? nested.error?.code ?? null });
		}) as never,
		'dual-nested': (async (_input: unknown, context: AppCallContextV1) => {
			const here = await context.client.call<{ scope: unknown }>('dual-where');
			const wide = await context.client.call<{ scope: unknown }>(
				'dual-where',
				{},
				{ level: 'workspace' }
			);
			return success({ here: here.data?.scope, wide: wide.data?.scope });
		}) as never,
	},
});

export const SOLO_DEFINITION = defineApp({
	sdk: 1,
	handlers: {
		'solo-put': (async (input: { key: string; value: string }, context: AppCallContextV1) => {
			await context.store?.put(input.key, input.value);
			return success({ key: input.key });
		}) as never,
		'solo-where': where as never,
	},
});

/** The member a restricted project lists that the Mock never is. */
export const SOMEONE_ELSE = 'mock-user-someone@example.com';

const project = (id: string, slug: string, extra: Partial<ProjectV1> = {}): ProjectV1 => ({
	id,
	workspace: 'personal',
	slug,
	name: slug[0]?.toUpperCase() + slug.slice(1),
	icon: 'system/folder',
	status: 'active',
	access: { mode: 'workspace' },
	memberEpoch: 0,
	createdAt: 1,
	updatedAt: 1,
	createdBy: 'local',
	updatedBy: 'local',
	...extra,
});

/** Atlas and Beacon, open to the workspace, and Citadel, restricted to {@link SOMEONE_ELSE}. */
export const SCOPED_PROJECTS: readonly ProjectV1[] = [
	project('prj_atlas', 'atlas', { createdAt: 1 }),
	project('prj_beacon', 'beacon', { createdAt: 2 }),
	project('prj_citadel', 'citadel', {
		createdAt: 3,
		access: { mode: 'restricted', members: [SOMEONE_ELSE] },
	}),
];

export const scopedDeployment = (): ProjectionV2 => ({
	deployment_version: 2,
	generation: 'scoped',
	workspace: { id: 'personal', name: 'Personal' },
	sandbox_origin: null,
	apps: ['tasks', 'dual', 'solo'].map((id) => ({ instance: id, app: id, package: `apps/${id}/` })),
});

export const scopedPorts = () =>
	createFixturePorts({
		'apps/tasks/': { manifest: TASKS_MANIFEST, definition: TASKS_DEFINITION },
		'apps/dual/': { manifest: DUAL_MANIFEST, definition: DUAL_DEFINITION },
		'apps/solo/': { manifest: SOLO_MANIFEST, definition: SOLO_DEFINITION },
	});

/** Write the projects into `store`, as a session before this one did. */
export async function seedProjects(
	store: DataAdapter,
	projects: readonly ProjectV1[] = SCOPED_PROJECTS
): Promise<void> {
	await store.batch(
		projects.map((record) => ({
			method: 'PUT' as const,
			path: `/project/${record.id}`,
			body: record,
		}))
	);
}

export interface ScopedWorkspace extends KernelParts {
	journal: MemoryJournalSink;
	store: DataAdapter;
	auth: MockAuthAdapter;
	/** The projects the session created, by slug: none when `empty`. */
	projects: Record<'atlas' | 'beacon' | 'citadel', ProjectV1>;
	/** Each project's scope, by slug. */
	scopes: Record<'atlas' | 'beacon' | 'citadel', ScopeV1>;
}

export interface ScopedWorkspaceOptions {
	store?: DataAdapter;
	auth?: MockAuthAdapter;
	journal?: MemoryJournalSink;
	/** Create no project. */
	empty?: boolean;
	internals?: KernelPartsInternals;
	deployment?: ProjectionV2;
	/** Default: a stepping clock from 2026-01-01. A reload's starts later, so its trace IDs differ. */
	clock?: () => number;
}

/**
 * A kernel over the scoped workspace, its parts exposed for `mcpOptions` and the registries. Unless
 * `empty`, or given a store that has them, the session creates Atlas and Beacon, and Citadel restricted
 * to {@link SOMEONE_ELSE} while signed in as them, all journaled, so a replay of the journal holds them.
 */
export async function createScopedWorkspace(
	options: ScopedWorkspaceOptions = {}
): Promise<ScopedWorkspace> {
	const store = options.store ?? new MemoryAdapter();
	const journal = options.journal ?? new MemoryJournalSink();
	const auth = options.auth ?? new MockAuthAdapter();
	const parts = await createKernelParts(
		{
			store,
			storeKind: 'memory',
			journal,
			auth,
			environment: createFixedEnvironment(),
			host: 'test',
			clock: options.clock ?? createSteppingClock(),
			random: createSeededRandom('scoped'),
			deployment: options.deployment ?? scopedDeployment(),
			ports: scopedPorts(),
		},
		options.internals
	);
	const { kernel } = parts;
	const found = async (slug: string, create: () => Promise<unknown>): Promise<ProjectV1> => {
		const held = await kernel.call<ProjectV1>('project-get', { project: slug });
		if (held.success) return held.data as ProjectV1;
		await create();
		return (await kernel.call<ProjectV1>('project-get', { project: slug })).data as ProjectV1;
	};
	const projects = {} as ScopedWorkspace['projects'];
	if (!options.empty) {
		projects.atlas = await found('atlas', () => kernel.call('project-create', { name: 'Atlas' }));
		projects.beacon = await found('beacon', () =>
			kernel.call('project-create', { name: 'Beacon' })
		);
		const citadel = (await store.list<ProjectV1>('project')).data.find(
			(project) => project.slug === 'citadel'
		);
		projects.citadel =
			citadel ??
			(await (async () => {
				await kernel.call('auth-sign-in', {
					method: 'credentials',
					email: 'someone@example.com',
					password: 'x',
				});
				const created = await kernel.call<ProjectV1>('project-create', {
					name: 'Citadel',
					access: { mode: 'restricted', members: [SOMEONE_ELSE] },
				});
				await kernel.call('auth-sign-out');
				return created.data as ProjectV1;
			})());
	}
	const scopes = Object.fromEntries(
		Object.entries(projects).map(([slug, project]) => [
			slug,
			{ workspace: 'personal', project: project.id },
		])
	) as ScopedWorkspace['scopes'];
	// Assigned, not spread: `registries` is a getter, and stage B replaces them.
	return Object.assign(parts, { journal, store, auth, projects, scopes });
}

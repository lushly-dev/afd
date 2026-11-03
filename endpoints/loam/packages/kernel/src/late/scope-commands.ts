/**
 * @fileoverview The scope's late commands (phase 2 specification, 4.1 and 4.3): `project-*` but
 * `project-summary-get` (step 7), `scope-set`, `section-open`, `app-route-set`, `workspace-*`, and the
 * boot-only `workspace-deployment-apply`. A named project is checked by `decideAccess` first, and missing
 * and refused answer the same `PROJECT_NOT_FOUND` (3.4). Range checks run in the handlers, so a refusal
 * reaches the journal.
 */

import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import {
	defineCommandWithSchema,
	failure,
	type JsonSchema,
	success,
	type ZodCommandDefinition,
} from '@lushly-dev/afd-server/define';
import type { ViewStateRegistry } from '@lushly-dev/afd-view-state';
import { ICONS_V1 } from '@lushly-dev/loam-manifest';
import * as z from 'zod/mini';
import type { AppsRuntime } from '../apps-runtime.js';
import { EMPTY_INPUT_JSON, emptyInput } from '../boot-commands.js';
import type { KernelFieldContext } from '../context-fields.js';
import { kernelFailure } from '../errors.js';
import { actorKey } from '../scope/access.js';
import { type LateScope, projectNotFound } from '../scope/middleware.js';
import type {
	ProjectAccessV1,
	ProjectV1,
	ScopeV1,
	WorkspaceAppV1,
	WorkspaceV1,
} from '../scope/records.js';
import type { ScopeRuntime } from '../scope/runtime.js';
import type { ShellState } from '../shell-state.js';
import { canOpen, setMain } from './main-state.js';
import type { ShellStores } from './stores.js';

export interface ScopeCommandDeps {
	scope: ScopeRuntime;
	viewState: ViewStateRegistry;
	state: ShellState;
	stores: ShellStores;
	lateScope: LateScope;
	apps(): AppsRuntime;
	/** The projection's generation this page booted with. */
	generation(): string;
	/** Whether stage B left the store holding that generation's entries (4.1). */
	applied(): boolean;
}

/**
 * The generation of a workspace row written before any deployment was applied: off the projection's
 * pattern, so the next stage B that reads a projection applies it (4.1).
 */
export const UNAPPLIED = 'unapplied';

/** A project's slug: the URL and what a deployment names (4.3). */
export const PROJECT_SLUG = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** A project as an app sees it: no members, and no one who wrote it (5). */
export function forApp(project: ProjectV1) {
	const { access: _a, memberEpoch: _m, createdBy: _c, updatedBy: _u, ...shown } = project;
	return shown;
}

const now = (context: CommandContext): number => context.clock?.now() ?? Date.now();

/** `prj_` and ten base-36 characters from the command's random, so a replay reproduces it (4). */
const projectId = (context: CommandContext): string =>
	`prj_${`${(context.random?.next() ?? Math.random()).toString(36).slice(2)}0000000000`.slice(0, 10)}`;

/** A slug from a name: lower-cased, runs of anything else as `-`, trimmed (4.3). */
export const slugOf = (name: string): string =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

const ref = z.string().check(z.minLength(1), z.maxLength(128));
const REF_JSON: JsonSchema = { type: 'string', minLength: 1, maxLength: 128 };
const projectInput = z.strictObject({ project: ref });
const PROJECT_INPUT_JSON: JsonSchema = {
	type: 'object',
	properties: { project: REF_JSON },
	required: ['project'],
	additionalProperties: false,
};
const access = z.union([
	z.strictObject({ mode: z.literal('workspace') }),
	z.strictObject({ mode: z.literal('restricted'), members: z.array(z.string()) }),
]);
const ACCESS_JSON = {
	anyOf: [
		{
			type: 'object',
			properties: { mode: { type: 'string', const: 'workspace' } },
			required: ['mode'],
			additionalProperties: false,
		},
		{
			type: 'object',
			properties: {
				mode: { type: 'string', const: 'restricted' },
				members: { type: 'array', items: { type: 'string' } },
			},
			required: ['mode', 'members'],
			additionalProperties: false,
		},
	],
} as unknown as JsonSchema;
const createInput = z.strictObject({
	name: z.string(),
	slug: z.optional(z.string()),
	icon: z.optional(z.string()),
	access: z.optional(access),
});
const updateInput = z.strictObject({
	project: ref,
	name: z.optional(z.string()),
	icon: z.optional(z.string()),
	access: z.optional(access),
});
const listInput = z.strictObject({
	status: z.optional(z.enum(['active', 'archived', 'all'])),
	limit: z.optional(z.number().check(z.int(), z.minimum(1), z.maximum(200))),
	offset: z.optional(z.number().check(z.int(), z.minimum(0))),
});
const scopeSetInput = z.strictObject({ project: z.nullable(ref), app: z.optional(ref) });
const sectionInput = z.strictObject({
	section: z.enum(['projects', 'documents']),
	path: z.optional(z.string()),
});
const routeInput = z.strictObject({ instance: ref, path: z.string() });

/**
 * A route the URL can hold (4.3, 6.1): at most 1,024 characters, and no `.`, `..` or empty segment, since
 * `new URL` would walk a dot segment into another project or app, and the URL holds no empty one. So an app's
 * route and a section's path always format a URL `parseRoute` reads back.
 */
function routeRefusal(path: string): CommandResult<never> | undefined {
	if (path === '') return undefined;
	if (path.length <= 1024 && !path.split('/').some((part) => part === '' || /^\.\.?$/.test(part))) {
		return undefined;
	}
	return kernelFailure(
		'APP_ROUTE_INVALID',
		'A route has no `.`, `..` or empty segment, and is at most 1,024 characters',
		"Use a path under the app's own base, with no leading, trailing or doubled `/`"
	);
}
/** Each override, or `null` to clear it, so an undo can restore one that was never set (4.1). */
const appSetInput = z.strictObject({
	instance: ref,
	enabled: z.optional(z.nullable(z.boolean())),
	order: z.optional(z.nullable(z.number())),
	title: z.optional(z.nullable(z.string())),
});
const OR_NULL = (type: string): JsonSchema => ({ type: [type, 'null'] }) as unknown as JsonSchema;

const text = z.optional(z.string());
const entry = z.strictObject({
	instance: z.string(),
	app: z.string(),
	package: z.string(),
	order: z.optional(z.number()),
	title: text,
	config: z.optional(z.record(z.string(), z.unknown())),
	prefix: text,
	audience: z.optional(z.enum(['team', 'person'])),
	transport: z.optional(z.enum(['http', 'stdio'])),
	route: text,
	projects: z.optional(z.array(z.string())),
	space: z.optional(z.record(z.string(), z.string())),
	expose: z.optional(z.record(z.string(), z.boolean())),
	commands: z.optional(z.record(z.string(), z.unknown())),
});
const applyInput = z.strictObject({
	generation: z.string(),
	workspace: z.strictObject({ id: z.string(), name: z.string() }),
	entries: z.array(entry),
});
const STRING: JsonSchema = { type: 'string' };
const RECORD_JSON = (values: object): JsonSchema =>
	({
		type: 'object',
		propertyNames: STRING,
		additionalProperties: values,
	}) as unknown as JsonSchema;
const ENTRY_JSON: JsonSchema = {
	type: 'object',
	properties: {
		instance: STRING,
		app: STRING,
		package: STRING,
		order: { type: 'number' },
		title: STRING,
		config: RECORD_JSON({}),
		prefix: STRING,
		audience: { type: 'string', enum: ['team', 'person'] },
		transport: { type: 'string', enum: ['http', 'stdio'] },
		route: STRING,
		projects: { type: 'array', items: STRING },
		space: RECORD_JSON(STRING),
		expose: RECORD_JSON({ type: 'boolean' }),
		commands: RECORD_JSON({}),
	},
	required: ['instance', 'app', 'package'],
	additionalProperties: false,
};

/** Keys of a projection entry `workspace-app` keeps; never a location, a credential or a command (D63). */
const KEPT = [
	'app',
	'package',
	'config',
	'prefix',
	'audience',
	'transport',
	'route',
	'projects',
	'space',
	'expose',
	'commands',
	'order',
	'title',
] as const;

export function createScopeCommands(deps: ScopeCommandDeps): ZodCommandDefinition[] {
	const { scope, state, stores, lateScope } = deps;
	const workspaceId = scope.workspace.id;

	/** The project `ref` names, if the call's actor may enter it; else undefined, missing or refused alike. */
	const named = (ref: string, context: CommandContext): ProjectV1 | undefined => {
		const project = scope.project(ref);
		return project &&
			scope.allows(actorKey(context), { workspace: workspaceId, project: project.id })
			? project
			: undefined;
	};
	const shown = (project: ProjectV1, context: CommandContext) =>
		(context as KernelFieldContext).caller === undefined ? project : forApp(project);

	/**
	 * The workspace row, created from the projection's values when no deployment wrote it yet (4.1). Its
	 * generation is the projection's only when stage B applied it, or it was empty: otherwise a row that
	 * claimed it would keep every later stage B from applying it.
	 */
	async function ensureWorkspace(context: CommandContext): Promise<void> {
		if (await stores.workspace()) return;
		const at = now(context);
		await stores.putWorkspace({
			id: workspaceId,
			name: scope.workspace.name,
			generation: deps.applied() ? deps.generation() : UNAPPLIED,
			trashDays: 30,
			organization: null,
			tenant: null,
			createdAt: at,
			updatedAt: at,
			updatedBy: actorKey(context),
		});
	}

	/** Name, icon and access, each checked; a refusal, or undefined. */
	function checkFields(
		fields: { name?: string; icon?: string; access?: ProjectAccessV1 },
		context: CommandContext
	): CommandResult<never> | undefined {
		const { name, icon, access: asked } = fields;
		if (name !== undefined && (name.trim() === '' || name.length > 80)) {
			return kernelFailure(
				'PROJECT_NAME_INVALID',
				'A project name is 1 to 80 characters',
				'Give the project a shorter, nonempty name'
			);
		}
		if (icon !== undefined && !ICONS_V1.includes(icon)) {
			return kernelFailure(
				'VALIDATION_ERROR',
				`'${icon.slice(0, 64)}' is not an icon the shell has`,
				'Use one of ICONS_V1, such as system/folder'
			);
		}
		if (asked?.mode === 'restricted' && !asked.members.includes(actorKey(context))) {
			return kernelFailure(
				'PROJECT_MEMBER_SELF_REQUIRED',
				'A restricted project must list you among its members',
				'Add yourself to members, or keep the workspace access: nobody could change it afterwards'
			);
		}
		return undefined;
	}

	const setStatus = async (
		project: ProjectV1,
		status: ProjectV1['status'],
		context: CommandContext
	): Promise<ProjectV1> => {
		const next: ProjectV1 = {
			...project,
			status,
			updatedAt: now(context),
			updatedBy: actorKey(context),
		};
		await stores.putProject(next);
		return next;
	};

	const projectCreate = defineCommandWithSchema<typeof createInput, ProjectV1>({
		name: 'project-create',
		title: 'Create a project',
		description: 'Create a project in the workspace, with a slug for its URL',
		category: 'project',
		mutation: true,
		undoable: true,
		executionTime: 'instant',
		input: createInput,
		jsonSchema: {
			type: 'object',
			properties: { name: STRING, slug: STRING, icon: STRING, access: ACCESS_JSON },
			required: ['name'],
			additionalProperties: false,
		},
		async handler(input, context) {
			const refused = checkFields(input, context);
			if (refused) return refused;
			const slug = input.slug ?? slugOf(input.name);
			if (!PROJECT_SLUG.test(slug) || slug === 'all') {
				return kernelFailure(
					'PROJECT_SLUG_INVALID',
					`'${slug.slice(0, 64)}' is not a project slug`,
					'Use 1 to 63 lower-case letters, digits and inner hyphens, other than all'
				);
			}
			if (scope.projects.all().some((project) => project.slug === slug)) {
				return kernelFailure(
					'PROJECT_SLUG_TAKEN',
					`A project already has the slug '${slug}'`,
					'Choose another slug; a slug cannot change once created'
				);
			}
			await ensureWorkspace(context);
			const at = now(context);
			const actor = actorKey(context);
			const project: ProjectV1 = {
				id: projectId(context),
				workspace: workspaceId,
				slug,
				name: input.name,
				icon: input.icon ?? 'system/folder',
				status: 'active',
				access: input.access ?? { mode: 'workspace' },
				memberEpoch: 0,
				createdAt: at,
				updatedAt: at,
				createdBy: actor,
				updatedBy: actor,
			};
			await stores.putProject(project);
			return success(project, {
				undoCommand: 'project-archive',
				undoArgs: { project: project.id },
			});
		},
	});

	const projectList = defineCommandWithSchema<
		typeof listInput,
		{ projects: unknown[]; total: number }
	>({
		name: 'project-list',
		description: 'List the projects you can open, active by default',
		category: 'project',
		mutation: false,
		executionTime: 'instant',
		input: listInput,
		jsonSchema: {
			type: 'object',
			properties: {
				status: { type: 'string', enum: ['active', 'archived', 'all'] },
				limit: { type: 'integer', minimum: 1, maximum: 200 },
				offset: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
			},
			additionalProperties: false,
		},
		async handler(input, context) {
			const status = input.status ?? 'active';
			const rows = scope.projects
				.all()
				.filter(
					(project) => (status === 'all' || project.status === status) && named(project.id, context)
				)
				.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
			const offset = input.offset ?? 0;
			return success({
				projects: rows
					.slice(offset, offset + (input.limit ?? rows.length))
					.map((project) => shown(project, context)),
				total: rows.length,
			});
		},
	});

	const projectGet = defineCommandWithSchema<typeof projectInput, unknown>({
		name: 'project-get',
		description: 'Get one project by its id or slug',
		category: 'project',
		mutation: false,
		executionTime: 'instant',
		input: projectInput,
		jsonSchema: PROJECT_INPUT_JSON,
		async handler(input, context) {
			const project = named(input.project, context);
			return project ? success(shown(project, context)) : projectNotFound();
		},
	});

	const projectUpdate = defineCommandWithSchema<typeof updateInput, ProjectV1>({
		name: 'project-update',
		title: 'Rename a project',
		description: "Change a project's name, icon or access; its slug, and so its URL, stay",
		category: 'project',
		mutation: true,
		undoable: true,
		executionTime: 'instant',
		input: updateInput,
		jsonSchema: {
			type: 'object',
			properties: { project: REF_JSON, name: STRING, icon: STRING, access: ACCESS_JSON },
			required: ['project'],
			additionalProperties: false,
		},
		async handler(input, context) {
			const project = named(input.project, context);
			if (!project) return projectNotFound();
			const refused = checkFields(input, context);
			if (refused) return refused;
			const { project: _ref, ...changes } = input;
			const next: ProjectV1 = {
				...project,
				...changes,
				...(changes.access !== undefined ? { memberEpoch: project.memberEpoch + 1 } : {}),
				updatedAt: now(context),
				updatedBy: actorKey(context),
			};
			await stores.putProject(next);
			const undoArgs: Record<string, unknown> = { project: project.id };
			for (const key of Object.keys(changes) as Array<keyof typeof changes>) {
				undoArgs[key] = project[key];
			}
			return success(next, { undoCommand: 'project-update', undoArgs });
		},
	});

	const projectArchive = defineCommandWithSchema<
		typeof projectInput,
		{ project: ProjectV1; scope: ScopeV1 }
	>({
		name: 'project-archive',
		title: 'Archive a project',
		description: 'Archive a project: it leaves the switcher and refuses changes; reads stay',
		category: 'project',
		mutation: true,
		undoable: true,
		executionTime: 'instant',
		input: projectInput,
		jsonSchema: PROJECT_INPUT_JSON,
		async handler(input, context) {
			const project = named(input.project, context);
			if (!project) return projectNotFound();
			if (scope.active().project === project.id) {
				// Archiving the active project moves the active scope to the workspace, in this command.
				const refused = lateScope.applyScopeChange(
					{ workspace: workspaceId },
					'project-archive',
					context
				);
				if (refused) return refused;
			}
			return success(
				{ project: await setStatus(project, 'archived', context), scope: scope.active() },
				{ undoCommand: 'project-restore', undoArgs: { project: project.id } }
			);
		},
	});

	const projectRestore = defineCommandWithSchema<typeof projectInput, { project: ProjectV1 }>({
		name: 'project-restore',
		title: 'Restore a project',
		description: 'Restore an archived project, so it can change again',
		category: 'project',
		mutation: true,
		undoable: true,
		executionTime: 'instant',
		input: projectInput,
		jsonSchema: PROJECT_INPUT_JSON,
		async handler(input, context) {
			const project = named(input.project, context);
			if (!project) return projectNotFound();
			return success(
				{ project: await setStatus(project, 'active', context) },
				{ undoCommand: 'project-archive', undoArgs: { project: project.id } }
			);
		},
	});

	const scopeSet = defineCommandWithSchema<
		typeof scopeSetInput,
		{ scope: ScopeV1; previous: string | null; active: string | null; app: 'kept' | 'left' }
	>({
		name: 'scope-set',
		title: 'Switch project',
		description: 'Change the active project, or leave projects with null',
		category: 'scope',
		mutation: true,
		undoable: true,
		executionTime: 'instant',
		input: scopeSetInput,
		jsonSchema: {
			type: 'object',
			properties: {
				project: { anyOf: [REF_JSON, { type: 'null' }] } as JsonSchema,
				app: REF_JSON,
			},
			required: ['project'],
			additionalProperties: false,
		},
		async handler(input, context) {
			let to: ScopeV1 = { workspace: workspaceId };
			if (input.project !== null) {
				const project = named(input.project, context);
				if (!project) return projectNotFound();
				to = { workspace: workspaceId, project: project.id };
			}
			// The persisted record's, not memory's: stage A may already hold the URL's project (6.3).
			const previous = state.scopeProject();
			const before = state.activeApp();
			// Asked first, so a refusal leaves the scope where it was: the switch and the open are one (N3).
			const cannot =
				input.app === undefined ? undefined : canOpen(deps.apps(), scope, input.app, to.project);
			if (cannot) return cannot;
			const refused = lateScope.applyScopeChange(to, 'scope-set', context);
			if (refused) return refused;
			if (input.app !== undefined) {
				const opened = deps.apps().open(input.app);
				if (!opened.success) return opened as CommandResult<never>;
				// As `app-open`: main shows the app, with no section and no path (4.3).
				if (opened.data?.active !== opened.data?.previous) {
					setMain(deps.viewState, { section: null, path: '' });
				}
				scope.note(context.traceId, { mainChanged: 'push' });
			}
			const active = state.activeApp();
			const left = before !== null && active !== before;
			return success(
				{ scope: scope.active(), previous, active, app: left ? 'left' : 'kept' },
				{
					undoCommand: 'scope-set',
					undoArgs: { project: previous, ...(left ? { app: before } : {}) },
				}
			);
		},
	});

	const sectionOpen = defineCommandWithSchema<
		typeof sectionInput,
		{ section: string; previous: string | null }
	>({
		name: 'section-open',
		title: 'Open a section',
		description: 'Show the projects or documents section in main; the active app closes',
		category: 'section',
		mutation: true,
		executionTime: 'instant',
		input: sectionInput,
		jsonSchema: {
			type: 'object',
			properties: {
				section: { type: 'string', enum: ['projects', 'documents'] },
				path: STRING,
			},
			required: ['section'],
			additionalProperties: false,
		},
		async handler(input, context) {
			const refused = routeRefusal(input.path ?? '');
			if (refused) return refused;
			const previous = state.main().section;
			const closed = deps.apps().close();
			if (!closed.success) return closed as CommandResult<never>;
			setMain(deps.viewState, { active: null, section: input.section, path: input.path ?? '' });
			scope.note(context.traceId, { mainChanged: 'push' });
			return success({ section: input.section, previous });
		},
	});

	const appRouteSet = defineCommandWithSchema<typeof routeInput, { path: string }>({
		name: 'app-route-set',
		title: "Set an app's route",
		description: "Set the active app's route, the rest of its URL",
		category: 'app',
		mutation: true,
		undoable: true,
		executionTime: 'instant',
		input: routeInput,
		jsonSchema: {
			type: 'object',
			properties: { instance: REF_JSON, path: STRING },
			required: ['instance', 'path'],
			additionalProperties: false,
		},
		async handler(input, context) {
			const { path } = input;
			const refused = routeRefusal(path);
			if (refused) return refused;
			if (state.activeApp() !== input.instance) {
				return kernelFailure(
					'APP_ROUTE_INVALID',
					`'${input.instance}' is not the active app, so it has no route to set`,
					'Open the app with app-open first'
				);
			}
			const previous = state.main().path;
			setMain(deps.viewState, { path });
			// An app's own call replaces the history entry, so a view calling this in a loop cannot flood
			// history; a person's pushes one (6.3).
			const caller = (context as KernelFieldContext).caller;
			scope.note(context.traceId, { mainChanged: caller === undefined ? 'push' : 'replace' });
			return success(
				{ path },
				{ undoCommand: 'app-route-set', undoArgs: { instance: input.instance, path: previous } }
			);
		},
	});

	const workspaceGet = defineCommandWithSchema<typeof emptyInput, WorkspaceV1>({
		name: 'workspace-get',
		description: "Get the workspace: its id, its name and the deployment's generation",
		category: 'workspace',
		mutation: false,
		executionTime: 'instant',
		input: emptyInput,
		jsonSchema: EMPTY_INPUT_JSON,
		async handler() {
			return success(
				(await stores.workspace()) ?? {
					id: workspaceId,
					name: scope.workspace.name,
					generation: deps.generation(),
					trashDays: 30,
					organization: null,
					tenant: null,
					createdAt: 0,
					updatedAt: 0,
					updatedBy: 'local',
				}
			);
		},
	});

	const workspaceAppList = defineCommandWithSchema<typeof emptyInput, { apps: WorkspaceAppV1[] }>({
		name: 'workspace-app-list',
		description: "List the workspace's app records: the deployer's keys, and what a person changed",
		category: 'workspace',
		mutation: false,
		executionTime: 'instant',
		input: emptyInput,
		jsonSchema: EMPTY_INPUT_JSON,
		async handler() {
			return success({
				apps: scope.workspaceApps.all().sort((a, b) => (a.id < b.id ? -1 : 1)),
			});
		},
	});

	const workspaceAppSet = defineCommandWithSchema<typeof appSetInput, WorkspaceAppV1>({
		name: 'workspace-app-set',
		title: 'Change an app in the workspace',
		description: 'Enable or disable an app, or change its order or title; it takes effect at once',
		category: 'workspace',
		mutation: true,
		undoable: true,
		executionTime: 'instant',
		input: appSetInput,
		jsonSchema: {
			type: 'object',
			properties: {
				instance: REF_JSON,
				enabled: OR_NULL('boolean'),
				order: OR_NULL('number'),
				title: OR_NULL('string'),
			},
			required: ['instance'],
			additionalProperties: false,
		},
		async handler(input, context) {
			const record = scope.workspaceApps.get(input.instance);
			if (!record) {
				return kernelFailure(
					'APP_NOT_FOUND',
					`No app instance '${input.instance}' is in the workspace`,
					'List the instances with workspace-app-list'
				);
			}
			const { instance: _instance, ...changes } = input;
			const overrides: Record<string, unknown> = { ...record.overrides };
			// Each changed key's previous value, or `null`, which clears it again.
			const undoArgs: Record<string, unknown> = { instance: input.instance };
			for (const [key, value] of Object.entries(changes)) {
				undoArgs[key] = overrides[key] ?? null;
				if (value === null) delete overrides[key];
				else overrides[key] = value;
			}
			const next: WorkspaceAppV1 = {
				...record,
				overrides,
				updatedAt: now(context),
				updatedBy: actorKey(context),
			};
			await stores.putWorkspaceApp(next);
			return success(next, { undoCommand: 'workspace-app-set', undoArgs });
		},
	});

	const deploymentApply = defineCommandWithSchema<
		typeof applyInput,
		{ added: number; changed: number; unlisted: number }
	>({
		name: 'workspace-deployment-apply',
		description: "Boot's own: keep a new deployment's entries in the workspace store",
		category: 'workspace',
		mutation: true,
		executionTime: 'instant',
		input: applyInput,
		jsonSchema: {
			type: 'object',
			properties: {
				generation: STRING,
				workspace: {
					type: 'object',
					properties: { id: STRING, name: STRING },
					required: ['id', 'name'],
					additionalProperties: false,
				},
				entries: { type: 'array', items: ENTRY_JSON },
			},
			required: ['generation', 'workspace', 'entries'],
			additionalProperties: false,
		},
		async handler(input, context) {
			if (input.workspace.id !== workspaceId) {
				return failure({
					code: 'SCOPE_WORKSPACE_UNKNOWN',
					message: `This shell serves the workspace '${workspaceId}' alone`,
					suggestion: 'Apply the deployment this page booted with',
				});
			}
			const at = now(context);
			const actor = actorKey(context);
			const counts = { added: 0, changed: 0, unlisted: 0 };
			const listed = new Set<string>();
			for (const item of input.entries) {
				listed.add(item.instance);
				const held = scope.workspaceApps.get(item.instance);
				const kept = Object.fromEntries(
					KEPT.flatMap((key) => (item[key] === undefined ? [] : [[key, item[key]]]))
				);
				const record = {
					...kept,
					id: item.instance,
					workspace: workspaceId,
					overrides: held?.overrides ?? {},
					listed: input.generation,
					updatedAt: at,
					updatedBy: actor,
				} as WorkspaceAppV1;
				// Changed when a deployer's key did, compared as JSON, so reordered keys count; and when a
				// record the projection had stopped listing is listed again.
				if (!held) counts.added++;
				else if (
					held.listed === null ||
					JSON.stringify(kept) !==
						JSON.stringify(
							Object.fromEntries(
								KEPT.flatMap((key) => (held[key] === undefined ? [] : [[key, held[key]]]))
							)
						)
				) {
					counts.changed++;
				}
				await stores.putWorkspaceApp(record);
			}
			for (const held of scope.workspaceApps.all()) {
				// Kept, so its table and its documents survive a deployment that drops and restores it (4.1).
				if (listed.has(held.id) || held.listed === null) continue;
				counts.unlisted++;
				await stores.putWorkspaceApp({ ...held, listed: null, updatedAt: at, updatedBy: actor });
			}
			const row = await stores.workspace();
			await stores.putWorkspace({
				id: workspaceId,
				name: input.workspace.name,
				generation: input.generation,
				trashDays: row?.trashDays ?? 30,
				organization: null,
				tenant: null,
				createdAt: row?.createdAt ?? at,
				updatedAt: at,
				updatedBy: actor,
			});
			return success(counts);
		},
	});

	return [
		scopeSet,
		sectionOpen,
		appRouteSet,
		projectCreate,
		projectList,
		projectGet,
		projectUpdate,
		projectArchive,
		projectRestore,
		workspaceGet,
		workspaceAppList,
		workspaceAppSet,
		deploymentApply,
	] as unknown as ZodCommandDefinition[];
}

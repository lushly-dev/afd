/**
 * @fileoverview The autonomy section (phase 4 specification, section 4; D118, D154, D156): the workspace store's
 * `autonomy` table of workspace and project rows, the person's own cap `loam.autonomy.cap` in their `loam.settings`,
 * and the commands `autonomy-get`, `autonomy-list` and `autonomy-set`, with boot's own `autonomy-settle`, which flags
 * the rows a manifest's apply orphaned. In the `late-settings` chunk, beside the settings. Phase 4 stores, resolves and
 * shows; nothing here is an input to any access decision, and phase 5 enforces (D41, P4-E2).
 */

import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import type { JsonSchema, ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type { BatchOperation, DataAdapter } from '@lushly-dev/local-db';
import type { AppsRuntime } from '../apps-runtime.js';
import type { KernelFieldContext } from '../context-fields.js';
import type { LoamKernelErrorCode } from '../errors.js';
import type { AccessActorV1 } from '../scope/access.js';
import type { DocumentKit } from '../scope/command-kit.js';
import type { ProjectV1 } from '../scope/records.js';
import type { ScopeRuntime } from '../scope/runtime.js';
import {
	AUTONOMY_MODES,
	type AutonomyCommandV1,
	type AutonomyModeV1,
	type AutonomyResolutionV1,
	type AutonomyRowV1,
	above,
	autonomyRowId,
	COMMAND_NAME,
	INSTANCE_ID,
	type InstanceStateV1,
	orphanChanges,
	resolveAutonomy,
	SHELL_IDENTITY,
	writeBound,
} from './autonomy-rules.js';
import {
	isHumanGesture,
	type StoredSettingV1,
	settingRoute,
	sharedRecordUnavailable,
} from './setting-rules.js';

/** The workspace store's table of autonomy rows (4.1). */
export const AUTONOMY_TABLE = 'autonomy';

/** The section the cap is kept in, in the person's `loam.settings` (4.1), and its key. */
export const AUTONOMY_SECTION = 'loam.autonomy';
export const CAP_KEY = 'cap';

/** Most commands one bulk `autonomy-get` reads (4.4). */
export const AUTONOMY_BULK_MAX = 50;

/** `autonomy-list`'s page (4.4, amended by step 8): rows per page by default, and at most. */
export const AUTONOMY_PAGE = { default: 100, max: 200 } as const;

/**
 * Each command's output budget, in UTF-8 bytes (D115), as `SETTING_OUTPUT_BUDGETS` declares the settings': TypeScript's
 * AFD does not read the declaration yet, so the kernel checks the two that can grow, `autonomy-list` and a bulk
 * `autonomy-get`, and tells a caller past it how to ask for less.
 */
export const AUTONOMY_OUTPUT_BUDGETS: Readonly<
	Record<string, { defaultBytes: number; maxBytes: number }>
> = Object.freeze({
	'autonomy-get': { defaultBytes: 65_536, maxBytes: 65_536 },
	'autonomy-list': { defaultBytes: 65_536, maxBytes: 65_536 },
	'autonomy-set': { defaultBytes: 4_096, maxBytes: 4_096 },
});

const bytesOf = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;

/** What this module reads of first paint's modules, given by `late/` (phase 3 specification, 13). */
export type AutonomyKit = Pick<
	DocumentKit,
	| 'define'
	| 'success'
	| 'kernelFailure'
	| 'z'
	| 'callNow'
	| 'archivedRefusal'
	| 'projectNotFound'
	| 'personOf'
> & { personKey(actor: AccessActorV1): string | undefined };

export interface AutonomyDeps {
	store: DataAdapter;
	scope: ScopeRuntime;
	apps(): AppsRuntime;
	/**
	 * Every registered command's name, the live registry's (R4): those no app owns and the kernel keeps internal are the
	 * shell's, the host's own `KernelOptions.commands` among them.
	 */
	commandNames(): readonly string[];
	agentCommandNames?(): ReadonlySet<string>;
	/** The commands no caller reaches (`INTERNAL_COMMANDS`, boot's own among them). */
	internal(name: string): boolean;
	isMutation(name: string): boolean;
	/** Section 13's hosted `provider` deployment, which refuses every `autonomy-set`. */
	hosted(): boolean;
	/** Whether `person` is an owner, on the membership the kernel holds (phase 3 specification, 7.1; D96). */
	isOwner(person: string | undefined): boolean;
	/** Whether an instance whose audience is `team` lists the project's slug: then only owners set it (D87, D110, D154). */
	teamListed(project: ProjectV1): boolean;
	/** The person's own value of a key in their `loam.settings`, and its write, serialized with the settings' writes. */
	ownValue(
		section: string,
		key: string,
		context: CommandContext
	): Promise<StoredSettingV1 | undefined>;
	writeOwn(
		section: string,
		key: string,
		entry: StoredSettingV1 | undefined,
		context: CommandContext
	): Promise<StoredSettingV1 | undefined>;
	/**
	 * The notice to the owners who may enter an orphaned row's project, all owners for a workspace row (4.2, 10.2),
	 * pushed by step 5's inbox: in `local` mode the one person; in `provider` mode none until the owner roster is a
	 * server record (phase 5). Called after `autonomy-settle` stored the flags, in a replay too: the notice is a store
	 * write of the settle's own, on its clock and random, so a replay writes the same and its later reads agree.
	 */
	orphaned?(rows: readonly AutonomyRowV1[], context: CommandContext): void | Promise<void>;
	replaying(): boolean;
	kit: AutonomyKit;
}

export interface Autonomy {
	commands: ZodCommandDefinition[];
	/** Boot's own `autonomy-settle`, run at the manifest's apply: in `BOOT_ONLY`, so no caller reaches it. */
	settleCommand: ZodCommandDefinition;
	/**
	 * What a settle would change now: the rows the apps no longer back, and those they back again. Run after each stage
	 * B's apply and after each catalog install or change of an instance (`app-instance-refresh`, `workspace-app-set`).
	 */
	orphanChanges(): Promise<{ orphaned: string[]; restored: string[] }>;
	/**
	 * Phase 5's enforcement (its 6.1): 4.2's resolution for one call, in the call's scope, with the person's cap; undefined
	 * for a command neither the shell nor an enabled instance registers, which the gate then treats by its default.
	 */
	resolveFor(
		name: string,
		context: CommandContext
	): Promise<(AutonomyResolutionV1 & { command: AutonomyCommandV1 }) | undefined>;
}

/** A row as the kernel holds it, with the workspace it belongs to. */
type StoredRow = AutonomyRowV1 & { workspace: string };

/**
 * A row as the store keeps it (blocker 2 of the trust review): its key holds the workspace, `<workspace>/<row id>`, so
 * rows of two workspaces sharing one browser's store never meet, and `rowId` is the row's own id.
 */
type PhysicalRow = Omit<StoredRow, 'id'> & { id: string; rowId: string };

/** Most characters of a row's `app` a result shows: a deployer's route is of unchecked length, and is shown, not decided by. */
const SHOWN_APP_MAX = 256;

/** The fields of a row a result shows: never the store's `workspace`, and its `app` cut to {@link SHOWN_APP_MAX}. */
const shownRow = ({ workspace: _w, ...row }: StoredRow): AutonomyRowV1 => {
	const shown = structuredClone(row);
	if (shown.app !== undefined && shown.app.length > SHOWN_APP_MAX)
		shown.app = `${shown.app.slice(0, SHOWN_APP_MAX)}…`;
	return shown;
};

/** What a page of `autonomy-list` leaves of its budget for the envelope around `data` and the cursor. */
const LIST_MARGIN = 4_096;

/** A listed row's order: the general rows first, so the first page always holds them, then by id. */
const sortKey = (row: AutonomyRowV1): string => `${row.instance === undefined ? 0 : 1}${row.id}`;

const isMode = (value: unknown): value is AutonomyModeV1 =>
	typeof value === 'string' && (AUTONOMY_MODES as readonly string[]).includes(value);

export function createAutonomy(deps: AutonomyDeps): Autonomy {
	const { store, scope, kit } = deps;
	const { z } = kit;

	const fail = (
		code: LoamKernelErrorCode,
		message: string,
		suggestion: string,
		details?: Record<string, unknown>
	) => kit.kernelFailure(code, message, suggestion, details ? { details } : {});

	/** Every row of this workspace, read from the store at each call: nothing is cached, so nothing is written back whole. */
	async function readRows(): Promise<StoredRow[]> {
		const listed = await store.list<PhysicalRow>(AUTONOMY_TABLE);
		const workspace = scope.workspace.id;
		// A row with no `rowId`, or keyed for another workspace, is not this workspace's: never read, never merged.
		return listed.data
			.filter(
				(row) =>
					row.workspace === workspace &&
					typeof row.rowId === 'string' &&
					row.id === keyOf(row.rowId)
			)
			.map(({ rowId, ...row }) => ({ ...row, id: rowId }))
			.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	}

	const keyOf = (id: string) => `${scope.workspace.id}/${id}`;
	const path = (id: string) => `/${AUTONOMY_TABLE}/${encodeURIComponent(keyOf(id))}`;
	const physical = (row: StoredRow): PhysicalRow => ({ ...row, id: keyOf(row.id), rowId: row.id });

	/**
	 * A row written whole, in place of what was held: a store's `PUT` merges fields into a row it has, so a field the
	 * row no longer holds (a mode removed, an orphan flag ended) would survive it. Deleted, then put, in one batch.
	 */
	const replace = (id: string, held: boolean, body: StoredRow | undefined): BatchOperation[] => [
		...(held ? [{ method: 'DELETE' as const, path: path(id) }] : []),
		...(body ? [{ method: 'PUT' as const, path: path(id), body: physical(body) }] : []),
	];

	/** One write at a time: a write's bounds are read from the rows, so two overlapping writes would both pass. */
	let writing: Promise<unknown> = Promise.resolve();
	const serial = <T>(work: () => Promise<T>): Promise<T> => {
		const run = writing.then(work, work);
		writing = run.catch(() => undefined);
		return run;
	};

	/** Whether the actor may enter `project`, a project id: `PROJECT_NOT_FOUND` alike for missing and refused (4.3). */
	function enterable(project: string, context: CommandContext): ProjectV1 | undefined {
		const found = scope.projects.get(project);
		return found &&
			scope.allows(context.actor as AccessActorV1, { workspace: scope.workspace.id, project })
			? found
			: undefined;
	}

	/** The rows the caller may see: the workspace's, and those of projects they may enter (4.2, 4.4). */
	const visible = (rows: readonly StoredRow[], context: CommandContext) =>
		rows.filter(
			(row) =>
				row.level === 'workspace' ||
				(row.project !== undefined && enterable(row.project, context) !== undefined)
		);

	/** The shell's commands, from the live registry: no app owns them and no caller is kept from them (R4). */
	function shellCommands(): Set<string> {
		const owners = deps.apps().owners;
		return new Set(deps.commandNames().filter((name) => !owners.has(name) && !deps.internal(name)));
	}

	function listedShellCommands(): string[] {
		const callable = deps.agentCommandNames?.();
		return [...shellCommands()].filter((name) => !callable || callable.has(name)).sort();
	}

	/**
	 * Whether an app instance is named `shell`, which makes the instance id `shell` mean two things (R4). Phase 4's step
	 * 3's deployment reader refuses `shell` and `loam` as instance ids (`DEPLOYMENT_INSTANCE_RESERVED`), but the kernel
	 * loads whatever projection its host gives it, and that reader is not on that path; so autonomy still refuses a row
	 * or a read naming `shell` while an app holds that id, and a shell row never matches the app, whose identity is never
	 * {@link SHELL_IDENTITY}.
	 */
	const shellTaken = (): boolean =>
		deps
			.apps()
			.summaries()
			.some((app) => app.instance === 'shell');

	/** The instance registering each command, from the apps, and the shell's own. */
	function commandOf(name: string, instance?: string): AutonomyCommandV1 | undefined {
		const owner = deps.apps().owners.get(name);
		const shell = !owner && shellCommands().has(name);
		const at = instance ?? owner?.instance ?? (shell ? 'shell' : undefined);
		if (at === undefined) return undefined;
		if (at === 'shell' ? !shell || shellTaken() : owner?.instance !== at || !instanceKnown(at))
			return undefined;
		return {
			name,
			instance: at,
			mutation: deps.isMutation(name),
			mounted: at !== 'shell' && owner?.recorded === true,
			...(owner?.recorded === true && owner.labels === 'per-part' ? { vouched: true } : {}),
		};
	}

	/** An instance a row may name: `shell`, or one the deployment has that the workspace has not disabled (4.1). */
	function instanceKnown(instance: string): boolean {
		if (instance === 'shell') return !shellTaken();
		if (scope.workspaceApps.get(instance)?.overrides.enabled === false) return false;
		return deps
			.apps()
			.summaries()
			.some((app) => app.instance === instance);
	}

	/**
	 * What the kernel knows of an instance now (R2; blocker 1): the identity of its app, and its catalog only while it
	 * is known. A mounted instance's identity is its deployment entry's app, transport and route, the server it names;
	 * its catalog is known once a discovery installed one and while it is enabled. A native or view app's identity is
	 * its manifest's plugin id, and its catalog is known while it is ready and enabled. Anything else is unknown.
	 */
	function stateOf(instance: string): InstanceStateV1 | undefined {
		const apps = deps.apps();
		if (instance === 'shell' && !shellTaken())
			return { identity: SHELL_IDENTITY, commands: shellCommands() };
		const summary = apps.summaries().find((app) => app.instance === instance);
		if (!summary) return undefined;
		const enabled = scope.workspaceApps.get(instance)?.overrides.enabled !== false;
		const owned = () =>
			new Set(
				[...apps.owners].flatMap(([name, owner]) => (owner.instance === instance ? [name] : []))
			);
		const mounted = apps.instances().find((row) => row.instance === instance);
		if (mounted) {
			const entry = scope.workspaceApps.get(instance);
			const identity = entry
				? `mounted:${entry.app}:${entry.transport ?? 'http'}:${entry.route ?? ''}`
				: undefined;
			const known =
				enabled && mounted.state === 'ready' && mounted.discoveredAt !== undefined
					? owned()
					: undefined;
			return { identity, commands: known };
		}
		let plugin: string | undefined;
		try {
			plugin = apps.port(instance).manifest.plugin.id;
		} catch {
			plugin = undefined;
		}
		return {
			// An app holding the id `shell` whose identity cannot be read is still not the shell: its shell rows go (R4).
			identity:
				plugin === undefined
					? instance === 'shell'
						? 'unreadable:shell'
						: undefined
					: `plugin:${plugin}`,
			commands: enabled && summary.state === 'ready' && plugin !== undefined ? owned() : undefined,
		};
	}

	const unknownCommand = (what: string) =>
		fail(
			'AUTONOMY_COMMAND_UNKNOWN',
			`There is no ${what} here`,
			'List the commands with app-command-list'
		);

	/** The person's cap, or undefined for none: read from their own record, skipped when it no longer validates. */
	async function capOf(context: CommandContext): Promise<StoredSettingV1 | undefined> {
		const held = await deps.ownValue(AUTONOMY_SECTION, CAP_KEY, context);
		return held && isMode(held.value) ? held : undefined;
	}

	/** The project a read is for: the input's when given, else the call's scope, or its refusal (4.4). */
	function readProject(
		asked: string | undefined,
		context: CommandContext
	): { project?: string } | CommandResult<never> {
		const project = asked ?? (context as KernelFieldContext).scope?.project;
		if (project === undefined) return {};
		return enterable(project, context) ? { project } : kit.projectNotFound();
	}

	// ─── Commands ──────────────────────────────────────────────────────────────

	const MODE = z.enum(AUTONOMY_MODES);
	const MODE_JSON: JsonSchema = { type: 'string', enum: [...AUTONOMY_MODES] };
	const NAME = z.string().check(z.minLength(1), z.maxLength(128));
	const NAME_JSON: JsonSchema = { type: 'string', minLength: 1, maxLength: 128 };

	const one = z.strictObject({
		command: NAME,
		instance: z.optional(NAME),
		project: z.optional(NAME),
	});
	const bulk = z.strictObject({
		commands: z
			.array(z.strictObject({ command: NAME, instance: z.optional(NAME) }))
			.check(z.minLength(1), z.maxLength(AUTONOMY_BULK_MAX)),
		project: z.optional(NAME),
	});
	const getInput = z.xor([one, bulk]);
	type Resolved = AutonomyResolutionV1 & {
		command: string;
		instance: string;
		project: string | null;
	};
	const autonomyGet = kit.define<typeof getInput, Resolved | { results: Resolved[] }>({
		name: 'autonomy-get',
		title: 'Read the autonomy mode',
		description:
			'Read whether an agent acts, asks or only suggests before a command here, and why. Up to 50 at once with commands',
		category: 'setting',
		mutation: false,
		executionTime: 'instant',
		input: getInput,
		jsonSchema: {
			type: 'object',
			oneOf: [
				{
					type: 'object',
					properties: { command: NAME_JSON, instance: NAME_JSON, project: NAME_JSON },
					required: ['command'],
					additionalProperties: false,
				},
				{
					type: 'object',
					properties: {
						commands: {
							type: 'array',
							minItems: 1,
							maxItems: AUTONOMY_BULK_MAX,
							items: {
								type: 'object',
								properties: { command: NAME_JSON, instance: NAME_JSON },
								required: ['command'],
								additionalProperties: false,
							},
						},
						project: NAME_JSON,
					},
					required: ['commands'],
					additionalProperties: false,
				},
			],
		} as unknown as JsonSchema,
		async handler(input, context) {
			const where = readProject(input.project, context);
			if ('success' in where) return where;
			const asked = 'commands' in input ? input.commands : [input];
			const commands: AutonomyCommandV1[] = [];
			for (const [index, item] of asked.entries()) {
				const found = commandOf(item.command, item.instance);
				if (!found) {
					const refused = unknownCommand(
						item.instance === undefined
							? `command '${item.command}'`
							: `command '${item.command}' of '${item.instance}'`
					);
					return 'commands' in input && refused.error
						? { ...refused, error: { ...refused.error, details: { index } } }
						: refused;
				}
				commands.push(found);
			}
			const rows = await readRows();
			const cap = (await capOf(context))?.value as AutonomyModeV1 | undefined;
			const results = commands.map((command) => ({
				command: command.name,
				instance: command.instance,
				project: where.project ?? null,
				// Only the workspace's rows and the project's, which the caller may enter (4.2).
				...resolveAutonomy({ rows, command, project: where.project, cap }),
			}));
			const data = 'commands' in input ? { results } : (results[0] as Resolved);
			const budget = AUTONOMY_OUTPUT_BUDGETS['autonomy-get']?.maxBytes ?? 0;
			if (bytesOf(data) > budget) {
				return fail(
					'OUTPUT_BUDGET_EXCEEDED',
					`The modes are over this command's budget of ${budget} bytes`,
					'Name fewer commands',
					{ maxBytes: budget }
				);
			}
			return kit.success(structuredClone(data));
		},
	});

	/** Why the caller may not write at `level` here, or nothing (4.3), for `autonomy-list`'s `writable`. */
	function writeRefusal(
		level: 'workspace' | 'project' | 'person',
		project: ProjectV1 | undefined,
		context: CommandContext
	): CommandResult<never> | undefined {
		if ((context as KernelFieldContext).caller !== undefined)
			return fail('CALL_NOT_GRANTED', 'No app sets autonomy', 'Let the person set it in the shell');
		const key = level === 'person' ? CAP_KEY : undefined;
		// Only a human gesture writes (3.2, 6.5): an agent, the copilot among them, gets the hand-off.
		if (!isHumanGesture(context)) return handOff(level, key ?? '', context);
		if (sharedRecordUnavailable(deps.hosted(), 'autonomy-set', { level })) return hostedRefusal();
		if (level === 'person') return undefined;
		const person = kit.personKey(context.actor as AccessActorV1);
		if (deps.isOwner(person)) return undefined;
		if (
			level === 'project' &&
			project !== undefined &&
			project.createdBy === kit.personOf(context) &&
			!deps.teamListed(project)
		)
			return undefined;
		return ownerRequired(level);
	}

	/** The hand-off (3.2, F2): `HUMAN_REQUIRED` with the place the person sets it, and what the call would write. */
	const handOff = (level: string, key: string, _context: CommandContext) => {
		// The section's route: a row's id holds slashes, which no route's fragment may (phase 2 specification, 6.1).
		const route =
			key === CAP_KEY ? settingRoute(AUTONOMY_SECTION, CAP_KEY) : `~/settings/${AUTONOMY_SECTION}`;
		return fail(
			'HUMAN_REQUIRED',
			key === CAP_KEY
				? 'Only your person sets their own autonomy cap'
				: 'Only a person sets how far agents act on their own',
			`Ask your person to set it at ${route}`,
			{ route, section: AUTONOMY_SECTION, key, level }
		);
	};

	const hostedRefusal = () =>
		fail(
			'SHARED_RECORD_UNAVAILABLE',
			'Autonomy has no record on this hosted deployment yet, so nothing was written',
			'Set it in a local deployment, or wait for the release that serves it'
		);

	const ownerRequired = (level: string) =>
		fail(
			'OWNER_REQUIRED',
			level === 'workspace'
				? "Only an owner of the workspace can set the workspace's autonomy"
				: "Only an owner, or the project's creator in a project no team instance lists, can set its autonomy",
			'Ask an owner of the workspace to do this'
		);

	const listInput = z.strictObject({
		includeShellCommands: z.optional(z.boolean()),
		level: z.optional(z.enum(['workspace', 'project'])),
		project: z.optional(NAME),
		cursor: z.optional(z.string().check(z.minLength(1), z.maxLength(600))),
		limit: z.optional(z.int().check(z.minimum(1), z.maximum(AUTONOMY_PAGE.max))),
	});
	type Writable = { writable: boolean; reason?: string };
	const autonomyList = kit.define<
		typeof listInput,
		{
			rows: AutonomyRowV1[];
			shellCommands?: string[];
			ceiling: AutonomyModeV1 | null;
			cap: AutonomyModeV1 | null;
			writable: { workspace: Writable; project?: Writable; cap: Writable };
			cursor: string | null;
		}
	>({
		name: 'autonomy-list',
		title: 'List the autonomy rows',
		description:
			'List the autonomy rows of the workspace and the projects you may enter, a page at a time, with the ceiling and your cap',
		category: 'setting',
		mutation: false,
		executionTime: 'instant',
		input: listInput,
		jsonSchema: {
			type: 'object',
			properties: {
				includeShellCommands: { type: 'boolean' },
				level: { type: 'string', enum: ['workspace', 'project'] },
				project: NAME_JSON,
				cursor: { type: 'string', minLength: 1, maxLength: 600 },
				limit: { type: 'integer', minimum: 1, maximum: AUTONOMY_PAGE.max },
			},
			additionalProperties: false,
		},
		async handler(input, context) {
			let project: ProjectV1 | undefined;
			if (input.project !== undefined) {
				project = enterable(input.project, context);
				if (!project) return kit.projectNotFound();
			}
			const all = await readRows();
			const general = all.find((row) => row.id === autonomyRowId({ level: 'workspace' }));
			const matching = visible(all, context)
				.filter((row) => input.level === undefined || row.level === input.level)
				.filter(
					(row) => project === undefined || row.level === 'workspace' || row.project === project.id
				)
				.sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1));
			// A page from after the cursor, the general rows always on the first (blocker 7).
			const after =
				input.cursor === undefined
					? matching
					: matching.filter((row) => sortKey(row) > (input.cursor as string));
			const limit = input.limit ?? AUTONOMY_PAGE.default;
			const shown = (refused: CommandResult<never> | undefined): Writable =>
				refused ? { writable: false, reason: refused.error?.code as string } : { writable: true };
			// As the write decides it: an archived project after the owner check (improvement 9).
			const projectWritable = (held: ProjectV1): Writable =>
				shown(
					writeRefusal('project', held, context) ??
						(held.status === 'archived' ? kit.archivedRefusal(held) : undefined)
				);
			const inScope =
				project ??
				(() => {
					const id = (context as KernelFieldContext).scope?.project;
					return id === undefined ? undefined : enterable(id, context);
				})();
			const head = {
				...(input.includeShellCommands && !shellTaken()
					? { shellCommands: listedShellCommands() }
					: {}),
				ceiling: general?.ceiling ?? null,
				cap: ((await capOf(context))?.value as AutonomyModeV1 | undefined) ?? null,
				// Computed for the caller, as `setting-list`'s `writable` is (3.9), so the section shows only what they may set.
				writable: {
					workspace: shown(writeRefusal('workspace', undefined, context)),
					...(inScope ? { project: projectWritable(inScope) } : {}),
					cap: shown(writeRefusal('person', undefined, context)),
				},
			};
			// A page ends at `limit` rows or before the output budget, in UTF-8 bytes, whichever comes first, with room left
			// for the envelope and the cursor (the re-check's improvement 1): a page always fits, and always holds a row.
			const budget = AUTONOMY_OUTPUT_BUDGETS['autonomy-list']?.maxBytes ?? 0;
			const room = budget - LIST_MARGIN - bytesOf({ ...head, rows: [], cursor: null });
			const rows: AutonomyRowV1[] = [];
			let used = 0;
			for (const row of after) {
				if (rows.length === limit) break;
				const shownOne = shownRow(row);
				const size = bytesOf(shownOne) + 1;
				if (rows.length > 0 && used + size > room) break;
				rows.push(shownOne);
				used += size;
			}
			const last = after[rows.length - 1];
			const cursor = rows.length < after.length && last ? sortKey(last) : null;
			const data = { rows, ...head, cursor };
			if (bytesOf(data) > budget) {
				return fail(
					'OUTPUT_BUDGET_EXCEEDED',
					`The rows are over this command's budget of ${budget} bytes`,
					'Ask for fewer rows: autonomy-list { limit }, then { cursor }',
					{ maxBytes: budget }
				);
			}
			return kit.success(structuredClone(data));
		},
	});

	const NULLABLE_MODE = z.nullable(MODE);
	const rowInput = z.strictObject({
		level: z.enum(['workspace', 'project']),
		project: z.optional(NAME),
		instance: z.optional(NAME),
		command: z.optional(NAME),
		mode: z.optional(NULLABLE_MODE),
		ceiling: z.optional(NULLABLE_MODE),
	});
	const capInput = z.strictObject({ level: z.enum(['person']), cap: NULLABLE_MODE });
	const setInput = z.xor([rowInput, capInput]);
	const NULLABLE_MODE_JSON = { anyOf: [MODE_JSON, { type: 'null' }] };
	type SetResult = { row?: AutonomyRowV1 | null; cap?: AutonomyModeV1 | null; previous: unknown };
	const autonomySet = kit.define<typeof setInput, SetResult>({
		name: 'autonomy-set',
		title: 'Set autonomy',
		description:
			"Set how far agents act on their own: a workspace or project row, or your own cap with level person. A person's command",
		category: 'setting',
		mutation: true,
		undoable: true,
		executionTime: 'instant',
		input: setInput,
		jsonSchema: {
			type: 'object',
			oneOf: [
				{
					type: 'object',
					properties: {
						level: { type: 'string', enum: ['workspace', 'project'] },
						project: NAME_JSON,
						instance: NAME_JSON,
						command: NAME_JSON,
						mode: NULLABLE_MODE_JSON,
						ceiling: NULLABLE_MODE_JSON,
					},
					required: ['level'],
					additionalProperties: false,
				},
				{
					type: 'object',
					properties: { level: { type: 'string', enum: ['person'] }, cap: NULLABLE_MODE_JSON },
					required: ['level', 'cap'],
					additionalProperties: false,
				},
			],
		} as unknown as JsonSchema,
		handler: (input, context) =>
			serial(
				(): Promise<CommandResult<SetResult>> =>
					input.level === 'person' ? setCap(input.cap, context) : setRow(input, context)
			),
	});

	async function setCap(cap: AutonomyModeV1 | null, context: CommandContext) {
		const refused = writeRefusal('person', undefined, context);
		if (refused) return refused;
		const previous = (await capOf(context))?.value ?? null;
		const at = kit.callNow(context);
		await deps.writeOwn(
			AUTONOMY_SECTION,
			CAP_KEY,
			cap === null ? undefined : { value: cap, updatedAt: at, updatedBy: kit.personOf(context) },
			context
		);
		scope.note(context.traceId, { settings: [AUTONOMY_SECTION] });
		return kit.success(
			{ cap, previous },
			{ undoCommand: 'autonomy-set', undoArgs: { level: 'person', cap: previous } }
		);
	}

	/** 4.3's check order (N9) after line 0, which the scope middleware ran: access, owner, existence, bounds. */
	async function setRow(
		input: {
			level: 'workspace' | 'project';
			project?: string | undefined;
			instance?: string | undefined;
			command?: string | undefined;
			mode?: AutonomyModeV1 | null | undefined;
			ceiling?: AutonomyModeV1 | null | undefined;
		},
		context: CommandContext
	) {
		const invalid = (message: string, suggestion: string) =>
			fail('VALIDATION_ERROR', message, suggestion);
		if (input.level === 'project' && input.project === undefined)
			return invalid('A project row names its project', 'Give project, the project’s id');
		if (input.level === 'workspace' && input.project !== undefined)
			return invalid(
				'A workspace row names no project',
				'Leave project out, or set level: project'
			);
		if (input.command !== undefined && input.instance === undefined)
			return invalid(
				'A command row names its instance',
				"Give instance: the app's instance, or shell for the shell's own"
			);
		if (
			input.ceiling !== undefined &&
			(input.level !== 'workspace' || input.instance !== undefined)
		)
			return invalid(
				"Only the workspace's general row has a ceiling",
				'Leave ceiling out, or set it with level: workspace and no instance'
			);
		if (input.mode === undefined && input.ceiling === undefined)
			return invalid('Nothing to set', 'Give mode, or ceiling on the workspace’s general row');
		// Identifiers by their syntax before any key is built from them: never `*`, `/` or anything else (blocker 6).
		if (input.instance !== undefined && !INSTANCE_ID.test(input.instance))
			return invalid(
				'That is not an instance id',
				"Give the app's instance, such as files, or shell"
			);
		if (
			input.command !== undefined &&
			(input.command.length > 128 || !COMMAND_NAME.test(input.command))
		)
			return invalid(
				'That is not a command name',
				'Give the command by its name, such as files-read'
			);
		if (input.project !== undefined && input.project.includes('/')) return kit.projectNotFound();
		// 2. The project's access, so one the caller may not enter is byte-identical to phase 2's refusal.
		const project = input.project === undefined ? undefined : enterable(input.project, context);
		if (input.project !== undefined && !project) return kit.projectNotFound();
		const id = autonomyRowId(input);
		// The human check with its hand-off (3.2), then section 13's refusal, then 3: the owner check (D154).
		if ((context as KernelFieldContext).caller !== undefined)
			return fail('CALL_NOT_GRANTED', 'No app sets autonomy', 'Let the person set it in the shell');
		if (!isHumanGesture(context)) return handOff(input.level, id, context);
		const refused = writeRefusal(input.level, project, context);
		if (refused) return refused;
		if (project?.status === 'archived') return kit.archivedRefusal(project);
		const rows = await readRows();
		const held = rows.find((row) => row.id === id);
		// 4. The instance and command must exist. A removal of a row whose target has gone is allowed only for the row held,
		// named field for field, so an orphan can always be removed and nothing else (blocker 6).
		const removing = !input.mode && !input.ceiling;
		let command: AutonomyCommandV1 | undefined;
		let identity: string | undefined;
		if (input.instance !== undefined) {
			const what =
				input.command === undefined
					? `instance '${input.instance}'`
					: `command '${input.command}' of '${input.instance}'`;
			if (input.command !== undefined) command = commandOf(input.command, input.instance);
			const known =
				input.command !== undefined ? command !== undefined : instanceKnown(input.instance);
			identity = known ? stateOf(input.instance)?.identity : undefined;
			const exact =
				held !== undefined &&
				held.level === input.level &&
				held.project === input.project &&
				held.instance === input.instance &&
				held.command === input.command;
			if ((!known || identity === undefined) && !(removing && exact)) return unknownCommand(what);
		}
		// 5. The bounds a project row meets (4.2's F8): an owner sets them, and the refusal says so.
		const mode = input.mode === undefined ? held?.mode : (input.mode ?? undefined);
		if (input.mode && input.level === 'project') {
			const bound = writeBound(rows, { level: 'project', instance: input.instance, command });
			if (bound && above(input.mode, bound.mode)) {
				return fail(
					'AUTONOMY_ABOVE_CEILING',
					`'${input.mode}' is above the workspace's bound '${bound.mode}' (${bound.id === 'default' ? 'the default' : bound.id})`,
					`Choose ${bound.mode} or stricter, or ask an owner to raise the bound`,
					{ bound: bound.id, mode: bound.mode }
				);
			}
		}
		const ceiling = input.ceiling === undefined ? held?.ceiling : (input.ceiling ?? undefined);
		const at = kit.callNow(context);
		const next: StoredRow | undefined =
			mode === undefined && ceiling === undefined
				? undefined
				: {
						id,
						workspace: scope.workspace.id,
						level: input.level,
						...(input.project !== undefined ? { project: input.project } : {}),
						...(input.instance !== undefined ? { instance: input.instance } : {}),
						...(input.command !== undefined ? { command: input.command } : {}),
						...(identity !== undefined ? { app: identity } : {}),
						...(mode !== undefined ? { mode } : {}),
						...(ceiling !== undefined ? { ceiling } : {}),
						updatedAt: at,
						updatedBy: kit.personOf(context),
					};
		if (next || held) {
			const { summary } = await store.batch(replace(id, held !== undefined, next));
			if (summary.failed > 0) throw new Error(`The store could not write autonomy row '${id}'`);
		}
		scope.note(context.traceId, { settings: [AUTONOMY_SECTION] });
		const previous = held ? shownRow(held) : null;
		const where = {
			level: input.level,
			...(input.project !== undefined ? { project: input.project } : {}),
			...(input.instance !== undefined ? { instance: input.instance } : {}),
			...(input.command !== undefined ? { command: input.command } : {}),
		};
		return kit.success(
			{ row: next ? shownRow(next) : null, previous },
			{
				undoCommand: 'autonomy-set',
				undoArgs: {
					...where,
					mode: held?.mode ?? null,
					...(input.level === 'workspace' && input.instance === undefined
						? { ceiling: held?.ceiling ?? null }
						: {}),
				},
			}
		);
	}

	// ─── The manifest's apply (4.2): orphans ───────────────────────────────────

	async function changes(): Promise<{ orphaned: string[]; restored: string[] }> {
		return orphanChanges(await readRows(), stateOf);
	}

	const IDS = z
		.array(z.string().check(z.minLength(1), z.maxLength(512)))
		.check(z.maxLength(10_000));
	const settleInput = z.strictObject({ orphaned: IDS, restored: IDS });
	const settle = kit.define<typeof settleInput, { orphaned: number; restored: number }>({
		name: 'autonomy-settle',
		description:
			"Boot's own: flag the autonomy rows the apps no longer back, and unflag those backed again",
		category: 'setting',
		mutation: true,
		executionTime: 'instant',
		input: settleInput,
		jsonSchema: {
			type: 'object',
			properties: {
				orphaned: { type: 'array', maxItems: 10_000, items: { type: 'string', maxLength: 512 } },
				restored: { type: 'array', maxItems: 10_000, items: { type: 'string', maxLength: 512 } },
			},
			required: ['orphaned', 'restored'],
			additionalProperties: false,
		},
		handler: (input, context) =>
			serial(async () => {
				// From the journaled ids, so a replay flags the same rows whatever its apps register.
				const rows = await readRows();
				const orphaned = new Set(input.orphaned);
				const restored = new Set(input.restored);
				const flagged: StoredRow[] = [];
				const operations: BatchOperation[] = [];
				let restoredCount = 0;
				for (const row of rows) {
					if (orphaned.has(row.id) && !row.orphan) {
						const next = { ...row, orphan: true as const };
						flagged.push(next);
						operations.push(...replace(row.id, true, next));
					} else if (restored.has(row.id) && row.orphan) {
						const { orphan: _o, ...next } = row;
						operations.push(...replace(row.id, true, next));
						restoredCount++;
					}
				}
				if (operations.length > 0) {
					const { summary } = await store.batch(operations);
					if (summary.failed > 0) throw new Error('The store could not flag the autonomy rows');
					scope.note(context.traceId, { settings: [AUTONOMY_SECTION] });
				}
				if (flagged.length > 0) await deps.orphaned?.(flagged.map(shownRow), context);
				return kit.success({
					orphaned: flagged.length,
					restored: restoredCount,
				});
			}),
	});

	return {
		commands: [autonomyGet, autonomyList, autonomySet] as unknown as ZodCommandDefinition[],
		settleCommand: settle as unknown as ZodCommandDefinition,
		orphanChanges: changes,
		async resolveFor(name, context) {
			const command = commandOf(name);
			if (!command) return undefined;
			const project = (context as KernelFieldContext).scope?.project;
			const rows = await readRows();
			const cap = (await capOf(context))?.value as AutonomyModeV1 | undefined;
			return { command, ...resolveAutonomy({ rows, command, project, cap }) };
		},
	};
}

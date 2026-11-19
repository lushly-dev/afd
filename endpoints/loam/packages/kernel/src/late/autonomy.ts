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
	orphanChanges,
	resolveAutonomy,
	writeBound,
} from './autonomy-rules.js';
import type { DocumentKit } from './document-kit.js';
import { type StoredSettingV1, settingRoute, sharedRecordUnavailable } from './setting-rules.js';

/** The workspace store's table of autonomy rows (4.1). */
export const AUTONOMY_TABLE = 'autonomy';

/** The section the cap is kept in, in the person's `loam.settings` (4.1), and its key. */
export const AUTONOMY_SECTION = 'loam.autonomy';
export const CAP_KEY = 'cap';

/** Most commands one bulk `autonomy-get` reads (4.4). */
export const AUTONOMY_BULK_MAX = 50;

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
	/** The shell's command names: the commands a row for the instance `shell` may name. */
	shellCommands(): readonly string[];
	isMutation(name: string): boolean;
	/** Section 13's hosted `provider` deployment, which refuses every `autonomy-set`. */
	hosted(): boolean;
	/** Whether `person` is an owner, on the membership the kernel holds (phase 3 specification, 7.1; D96). */
	isOwner(person: string | undefined): boolean;
	/** Whether a team instance lists the project's slug, whose autonomy only owners set (D87, D110, D154). */
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
	 * The seam for the notice to the owners who may enter an orphaned row's project, all owners for a workspace row
	 * (4.2, 10.2): the inbox is step 5's, which pushes it from here. Called after `autonomy-settle` stored the flags,
	 * never in a replay, whose entries are what ran.
	 */
	orphaned?(rows: readonly AutonomyRowV1[], context: CommandContext): void | Promise<void>;
	replaying(): boolean;
	kit: AutonomyKit;
}

export interface Autonomy {
	commands: ZodCommandDefinition[];
	/** Boot's own `autonomy-settle`, run at the manifest's apply: in `BOOT_ONLY`, so no caller reaches it. */
	settleCommand: ZodCommandDefinition;
	/** What the apply's settle would change now: the rows the apps no longer back, and those they back again. */
	orphanChanges(): Promise<{ orphaned: string[]; restored: string[] }>;
}

/** A stored row, with the workspace it belongs to. */
type StoredRow = AutonomyRowV1 & { workspace: string };

/** The fields of a row a result shows: never the store's `workspace`. */
const shownRow = ({ workspace: _w, ...row }: StoredRow): AutonomyRowV1 => structuredClone(row);

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
		const listed = await store.list<StoredRow>(AUTONOMY_TABLE);
		return listed.data
			.filter((row) => row.workspace === scope.workspace.id && typeof row.id === 'string')
			.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	}

	const path = (id: string) => `/${AUTONOMY_TABLE}/${encodeURIComponent(id)}`;

	/**
	 * A row written whole, in place of what was held: a store's `PUT` merges fields into a row it has, so a field the
	 * row no longer holds (a mode removed, an orphan flag ended) would survive it. Deleted, then put, in one batch.
	 */
	const replace = (id: string, held: boolean, body: StoredRow | undefined): BatchOperation[] => [
		...(held ? [{ method: 'DELETE' as const, path: path(id) }] : []),
		...(body ? [{ method: 'PUT' as const, path: path(id), body }] : []),
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

	/** The instance registering each command, from the apps, and the shell's own. */
	function commandOf(name: string, instance?: string): AutonomyCommandV1 | undefined {
		const owner = deps.apps().owners.get(name);
		const shell = deps.shellCommands().includes(name);
		const at = instance ?? owner?.instance ?? (shell ? 'shell' : undefined);
		if (at === undefined) return undefined;
		if (at === 'shell' ? !shell : owner?.instance !== at || !instanceKnown(at)) return undefined;
		return {
			name,
			instance: at,
			mutation: deps.isMutation(name),
			mounted: at !== 'shell' && owner?.recorded === true,
		};
	}

	/** An instance a row may name: `shell`, or one the deployment has that the workspace has not disabled (4.1). */
	function instanceKnown(instance: string): boolean {
		if (instance === 'shell') return true;
		if (scope.workspaceApps.get(instance)?.overrides.enabled === false) return false;
		return deps
			.apps()
			.summaries()
			.some((app) => app.instance === instance);
	}

	const unknownCommand = (what: string) =>
		fail(
			'AUTONOMY_COMMAND_UNKNOWN',
			`There is no ${what} here`,
			"List the app's commands with app-command-list, and name its instance, or shell for the shell's own"
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
			"Read whether an agent may act, should ask, or only suggest before a command, for your person here, and why: the mode, the row it came from, each bound and the person's cap. Name up to 50 commands at once with commands",
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
		if ((context.actor as AccessActorV1)?.kind === 'agent')
			return handOff(level, key ?? '', context);
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
			`Ask your person to set it in the shell's settings, at ${route}, or leave them a notice that links there`,
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
		level: z.optional(z.enum(['workspace', 'project'])),
		project: z.optional(NAME),
	});
	type Writable = { writable: boolean; reason?: string };
	const autonomyList = kit.define<
		typeof listInput,
		{
			rows: AutonomyRowV1[];
			ceiling: AutonomyModeV1 | null;
			cap: AutonomyModeV1 | null;
			writable: { workspace: Writable; project?: Writable; cap: Writable };
		}
	>({
		name: 'autonomy-list',
		title: 'List the autonomy rows',
		description:
			"List the workspace's autonomy rows and those of the projects you may enter, with the workspace's ceiling and your own cap; orphaned rows are flagged. Name a project or a level to narrow it",
		category: 'setting',
		mutation: false,
		executionTime: 'instant',
		input: listInput,
		jsonSchema: {
			type: 'object',
			properties: {
				level: { type: 'string', enum: ['workspace', 'project'] },
				project: NAME_JSON,
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
			const rows = visible(all, context)
				.filter((row) => input.level === undefined || row.level === input.level)
				.filter(
					(row) => project === undefined || row.level === 'workspace' || row.project === project.id
				)
				.map(shownRow);
			const shown = (refused: CommandResult<never> | undefined): Writable =>
				refused ? { writable: false, reason: refused.error?.code as string } : { writable: true };
			const inScope =
				project ??
				(() => {
					const id = (context as KernelFieldContext).scope?.project;
					return id === undefined ? undefined : enterable(id, context);
				})();
			const data = {
				rows,
				ceiling: general?.ceiling ?? null,
				cap: ((await capOf(context))?.value as AutonomyModeV1 | undefined) ?? null,
				// Computed for the caller, as `setting-list`'s `writable` is (3.9), so the section shows only what they may set.
				writable: {
					workspace: shown(writeRefusal('workspace', undefined, context)),
					...(inScope ? { project: shown(writeRefusal('project', inScope, context)) } : {}),
					cap: shown(writeRefusal('person', undefined, context)),
				},
			};
			const budget = AUTONOMY_OUTPUT_BUDGETS['autonomy-list']?.maxBytes ?? 0;
			if (bytesOf(data) > budget) {
				return fail(
					'OUTPUT_BUDGET_EXCEEDED',
					`The rows are over this command's budget of ${budget} bytes`,
					'Name a project or a level: autonomy-list { project } or { level }',
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
			"Set how far agents act on their own: a workspace or project row, for an app or one command, or your own cap with level person. A person's command: an agent is handed the place to send its person",
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
		// 2. The project's access, so one the caller may not enter is byte-identical to phase 2's refusal.
		const project = input.project === undefined ? undefined : enterable(input.project, context);
		if (input.project !== undefined && !project) return kit.projectNotFound();
		const id = autonomyRowId(input);
		// The human check with its hand-off (3.2), then section 13's refusal, then 3: the owner check (D154).
		if ((context as KernelFieldContext).caller !== undefined)
			return fail('CALL_NOT_GRANTED', 'No app sets autonomy', 'Let the person set it in the shell');
		if ((context.actor as AccessActorV1)?.kind === 'agent')
			return handOff(input.level, id, context);
		const refused = writeRefusal(input.level, project, context);
		if (refused) return refused;
		if (project?.status === 'archived') return kit.archivedRefusal(project);
		const rows = await readRows();
		const held = rows.find((row) => row.id === id);
		// 4. The instance and command must exist; a removal need not, so an orphaned row can always be removed.
		const removing = !input.mode && !input.ceiling;
		let command: AutonomyCommandV1 | undefined;
		if (!removing && input.instance !== undefined) {
			if (input.command !== undefined) {
				command = commandOf(input.command, input.instance);
				if (!command) return unknownCommand(`command '${input.command}' of '${input.instance}'`);
			} else if (!instanceKnown(input.instance)) {
				return unknownCommand(`instance '${input.instance}'`);
			}
		}
		// 5. The bounds a project row meets (4.2's F8): an owner sets them, and the refusal says so.
		const mode = input.mode === undefined ? held?.mode : (input.mode ?? undefined);
		if (input.mode && input.level === 'project') {
			const bound = writeBound(rows, { level: 'project', instance: input.instance, command });
			if (bound && above(input.mode, bound.mode)) {
				return fail(
					'AUTONOMY_ABOVE_CEILING',
					`'${input.mode}' is above the workspace's bound '${bound.mode}' (${bound.id === 'default' ? 'the default' : bound.id})`,
					`Choose ${bound.mode} or stricter, or ask an owner of the workspace to raise the bound: an owner sets the workspace's mode, ceiling and rows`,
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

	/** Each instance's commands, as the apps register them; undefined for a mounted one whose catalog is not read yet. */
	function commandsByInstance(): (instance: string) => ReadonlySet<string> | undefined {
		const apps = deps.apps();
		const held = new Map<string, Set<string>>([['shell', new Set(deps.shellCommands())]]);
		for (const [name, owner] of apps.owners) {
			const set = held.get(owner.instance) ?? new Set<string>();
			set.add(name);
			held.set(owner.instance, set);
		}
		const mounted = new Set(apps.mountedInstances());
		return (instance) =>
			held.get(instance) ?? (mounted.has(instance) ? undefined : new Set<string>());
	}

	async function changes(): Promise<{ orphaned: string[]; restored: string[] }> {
		const instances = new Set([
			'shell',
			...deps
				.apps()
				.summaries()
				.map((app) => app.instance),
		]);
		return orphanChanges(await readRows(), instances, commandsByInstance());
	}

	const IDS = z
		.array(z.string().check(z.minLength(1), z.maxLength(512)))
		.check(z.maxLength(10_000));
	const settleInput = z.strictObject({ orphaned: IDS, restored: IDS });
	const settle = kit.define<typeof settleInput, { orphaned: number; restored: number }>({
		name: 'autonomy-settle',
		description:
			"Boot's own: flag the autonomy rows a manifest's apply left naming no instance or command, and unflag those named again",
		category: 'setting',
		mutation: true,
		executionTime: 'instant',
		input: settleInput,
		jsonSchema: {
			type: 'object',
			properties: {
				orphaned: { type: 'array', items: { type: 'string' } },
				restored: { type: 'array', items: { type: 'string' } },
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
				if (flagged.length > 0 && !deps.replaying())
					await deps.orphaned?.(flagged.map(shownRow), context);
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
	};
}

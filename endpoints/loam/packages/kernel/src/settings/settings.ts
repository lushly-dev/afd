/**
 * @fileoverview Settings (phase 4 spec section 3; D116, D117) in `late-settings`: `setting-*` commands (3.9),
 * person/shared storage (3.4), resolution (3.3), appearance takeover (3.6), `trashDays` write-through, hosted refusal (13).
 */

import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import type { JsonSchema, ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import {
	checkSettingValue,
	type ManifestV3,
	SETTING_SECTION_MAX_BYTES,
	type SettingKeyV1,
	type SettingLevelV1,
	type SettingSectionV1,
} from '@lushly-dev/loam-manifest';
import type { BatchOperation } from '@lushly-dev/local-db';
import type { AppearanceStateV0 } from '../appearance.js';
import type { KernelFieldContext } from '../context-fields.js';
import type { LoamKernelErrorCode } from '../errors.js';
import type { LimitKeyV1 } from '../limits.js';
import type { PaletteIndex, PaletteItem, SettingRows } from '../palette-index.js';
import type { AccessActorV1 } from '../scope/access.js';
import type { ProjectV1 } from '../scope/records.js';
import { enforcedLimits, LIMIT_KEY_ORDER, LIMITS_SECTION_ID } from './limit-commands.js';
import { createOverridesReader } from './setting-overrides.js';
import {
	AGENT_REFUSED,
	checkKnownValue,
	isHumanGesture,
	isHumanKey,
	type KnownSectionV1,
	type ResolvedSettingV1,
	resolveSetting,
	type SettingFromV1,
	type StoredSettingV1,
	settingRoute,
	settingWriteRule,
	sharedRecordUnavailable,
	writerOf,
} from './setting-rules.js';
import { OWN_COMMAND_SECTIONS, SHELL_SECTIONS } from './setting-sections.js';
import type {
	NotificationPrefsV1,
	PersonSettingsV1,
	SettingRowV1,
	Settings,
	SettingsDeps,
	SettingsKit,
} from './types.js';

export { createAutonomy } from './autonomy.js';
export { resolveAutonomy } from './autonomy-rules.js';
export { bucketOf, createConfirmations, KERNEL_ONLY_FIELDS, stateNow } from './confirmations.js';
export { createExperiments } from './experiments.js';
export { createKeybindingCommands } from './keybinding-commands.js';
export { KEYBINDING_RESOLVER } from './keybinding-resolve.js';
export { createLimitCommands, limitNotice } from './limit-commands.js';
export { createNotifications, orphanNotice, orphanRecipients } from './notifications.js';
export {
	HUMAN_SETTING_KEYS,
	isHumanGesture,
	isHumanKey,
	resolveSetting,
	settingRoute,
	settingWriteRule,
	sharedRecordUnavailable,
} from './setting-rules.js';
export type {
	NotificationPrefsV1,
	PersonSettingsV1,
	SettingRowV1,
	Settings,
	SettingsDeps,
	SettingsKit,
};

/** The workspace store's table of shared values (3.4): one row per section and level. */
export const SETTING_TABLE = 'setting';

/** The view-state store's backing table, where the person's record is (3.4). */
const SETTINGS = 'settings';

/** The person's record's id, before `provider` mode's suffix (3.4); not a view-state id. */
export const PERSON_SETTINGS_ID = 'loam.settings';

/** The person's keybindings section (3.7, 8.3). */
const KEYBINDINGS_ID = 'loam.keybindings';

/** The profile's last appearance in `provider` mode (3.6, R4); not a view-state id either. */
export const APPEARANCE_LAST_ID = 'loam.appearance.last';

/**
 * Each command's output budget, in bytes, as AFD's `outputBudget` declares one (3.9). TypeScript's AFD does not read
 * the declaration yet, so the kernel checks `setting-schema-get`'s and `setting-list`'s itself, in UTF-8 bytes, with or
 * without a section named, and tells a caller past it to name a section, or within one a key; the others answer one
 * key, which a section's 16 KiB bounds.
 */
export const SETTING_OUTPUT_BUDGETS: Readonly<
	Record<string, { defaultBytes: number; maxBytes: number }>
> = Object.freeze({
	'setting-schema-get': { defaultBytes: 16_384, maxBytes: 16_384 },
	'setting-list': { defaultBytes: 65_536, maxBytes: 65_536 },
	'setting-get': { defaultBytes: 16_384, maxBytes: 16_384 },
	'setting-set': { defaultBytes: 32_768, maxBytes: 32_768 },
	'setting-reset': { defaultBytes: 16_384, maxBytes: 16_384 },
});

/** The UTF-8 bytes of a value's JSON, as an output budget counts them. */
const bytesOf = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;

const LEVELS = ['person', 'workspace', 'project'] as const;

/** The levels a key may be set at: its own, else its section's (3.1). */
const levelsOf = (known: KnownSectionV1, key: string): readonly SettingLevelV1[] =>
	(known.section.schema.properties[key] as SettingKeyV1).levels ?? known.section.levels;

/** The value a stored entry holds, read back from the store, or undefined for anything malformed. */
function storedOf(entry: unknown): StoredSettingV1 | undefined {
	if (typeof entry !== 'object' || entry === null || !('value' in entry)) return undefined;
	const { value, updatedAt, updatedBy } = entry as Record<string, unknown>;
	return typeof updatedAt === 'number' && typeof updatedBy === 'string'
		? { value, updatedAt, updatedBy }
		: undefined;
}

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function createSettings(deps: SettingsDeps): Settings {
	const { store, scope, kit } = deps;
	const { z } = kit;

	/** The record the shell's appearance follows now. */
	let following: string | undefined;
	/** Each paint's number: one a later paint or a change of person overtook paints nothing (the second review's E). */
	let painting = 0;

	/**
	 * The person's record, read from the store at every call: another tab may have written it since, so nothing is kept
	 * but what the shell paints. A read that fails rejects, and the call fails with it, rather than writing a record it
	 * never read (the review's B3).
	 */
	async function readRecord(id: string): Promise<PersonSettingsV1> {
		const row = await store.get<{ value?: unknown }>(SETTINGS, id);
		const value = row?.value;
		const record: PersonSettingsV1 = {};
		if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
			for (const [section, keys] of Object.entries(value)) {
				if (typeof keys !== 'object' || keys === null) continue;
				const kept: Record<string, StoredSettingV1> = {};
				for (const [key, entry] of Object.entries(keys)) {
					const stored = storedOf(entry);
					if (stored) kept[key] = stored;
				}
				record[section] = kept;
			}
		}
		return record;
	}

	async function writeRecord(id: string, record: PersonSettingsV1, at: number): Promise<void> {
		const row = { category: 'settings', value: record, updatedAt: new Date(at).toISOString() };
		if (await store.get(SETTINGS, id)) await store.update(SETTINGS, id, row);
		else await store.create(SETTINGS, { id, ...row });
	}

	/**
	 * Where a person's values of `known` sit in their record: `<workspace>/<section>` for a workspace-keyed section,
	 * `loam.keybindings` (step 7's R5), so another workspace in this browser never reads them; else the section's id.
	 */
	const slotOf = (known: KnownSectionV1): string =>
		known.workspaceKeyed ? `${scope.workspace.id}/${known.fullId}` : known.fullId;

	const rowId = (fullId: string, level: 'workspace' | 'project', project?: string) =>
		level === 'workspace'
			? `${scope.workspace.id}/${fullId}/workspace`
			: `${scope.workspace.id}/${fullId}/project/${project}`;

	async function readRow(id: string): Promise<SettingRowV1 | undefined> {
		const row = await store.get<SettingRowV1>(SETTING_TABLE, id).catch(() => null);
		return row && row.workspace === scope.workspace.id ? row : undefined;
	}

	/** Every section the kernel knows: the shell's first, then each app's, an app's `loam.` id never (3.5). */
	function sections(): KnownSectionV1[] {
		const known: KnownSectionV1[] = [...SHELL_SECTIONS];
		const ids = new Set(known.map((entry) => entry.fullId));
		const apps = deps.apps();
		for (const app of apps.summaries()) {
			if (scope.workspaceApps.get(app.instance)?.overrides.enabled === false) continue;
			let manifest: ManifestV3 | undefined;
			try {
				manifest = apps.port(app.instance).manifest;
			} catch {
				continue;
			}
			for (const section of (manifest.ui?.settings ?? []) as unknown as SettingSectionV1[]) {
				const fullId = `${manifest.plugin.id}.${section.id}`;
				// A gated section is absent while its experiment is off for the person (5.3).
				if (
					section.requires_experiment !== undefined &&
					deps.experimentOpen?.(section.requires_experiment) !== true
				)
					continue;
				// The shell's own namespace is never an app's, and a second instance of an app shares its sections.
				// A second ready instance of one native or view app cannot exist (`APP_DOMAIN_CONFLICT`), and a mounted app
				// declares no section, so the first is the one that opens wherever the section can.
				if (fullId.startsWith('loam.') || ids.has(fullId)) continue;
				ids.add(fullId);
				known.push({ fullId, section, owner: app.instance, plugin: manifest.plugin.id });
			}
		}
		return known;
	}

	/** The app a port's call is made by, whose own sections are the only ones it may read (3.8). */
	function callerApp(context: CommandContext): string | undefined {
		const caller = (context as KernelFieldContext).caller;
		if (caller === undefined) return undefined;
		try {
			return deps.apps().port(caller).manifest.plugin.id;
		} catch {
			return `\u0000${caller}`;
		}
	}

	/**
	 * Whether a port's app owns a section (3.8): a person's or an agent's call reads every section; an app only those its
	 * own plugin declared, decided by the section's declaring app, never by a prefix of its id, so no app reads the
	 * shell's.
	 */
	const owns = (app: string | undefined, known: KnownSectionV1) =>
		app === undefined || (known.owner !== 'shell' && known.plugin === app);

	const fail = (
		code: LoamKernelErrorCode,
		message: string,
		suggestion: string,
		details?: Record<string, unknown>,
		retryable = false
	) =>
		kit.kernelFailure(code, message, suggestion, {
			...(details ? { details } : {}),
			...(retryable ? { retryable } : {}),
		});

	/**
	 * One write at a time (the second review's B): a write's `expected` check, its size check and its store write span
	 * awaits, so two overlapping calls would both pass the check. Each `setting-*` write, and appearance's, runs after the
	 * one before it has ended, reading the current row.
	 */
	let writing: Promise<unknown> = Promise.resolve();
	const serial = <T>(work: () => Promise<T>): Promise<T> => {
		const run = writing.then(work, work);
		writing = run.catch(() => undefined);
		return run;
	};

	const notFound = (what: string) =>
		fail(
			'SETTING_NOT_FOUND',
			`There is no setting ${what}`,
			'List the sections and their keys with setting-schema-get'
		);

	/** The section and key a call names, or its refusal: `SETTING_USE_AUTONOMY`, `SETTING_NOT_FOUND`, `SETTING_NOT_OWNED`. */
	function lookup(
		context: CommandContext,
		fullId: string,
		key?: string
	): { known: KnownSectionV1; declared?: SettingKeyV1 } | CommandResult<never> {
		const own = OWN_COMMAND_SECTIONS[fullId];
		if (own) {
			return fail(
				'SETTING_USE_AUTONOMY',
				`'${fullId}' is written only by its own commands`,
				`Use ${own === 'autonomy-set' ? 'autonomy-set' : 'experiment-enable or experiment-disable'}`
			);
		}
		const known = sections().find((entry) => entry.fullId === fullId);
		if (!known) return notFound(`section '${fullId}'`);
		if (!owns(callerApp(context), known)) {
			return fail(
				'SETTING_NOT_OWNED',
				`'${fullId}' is another app's section`,
				"Read only this app's own sections"
			);
		}
		if (key === undefined) return { known };
		const declared = known.section.schema.properties[key] as SettingKeyV1 | undefined;
		if (!declared || !Object.hasOwn(known.section.schema.properties, key))
			return notFound(`'${key}' in '${fullId}'`);
		return { known, declared };
	}

	/** Everything stored for one key, at each level, for the call's person and scope. */
	async function storedFor(
		known: KnownSectionV1,
		key: string,
		context: CommandContext
	): Promise<Partial<Record<SettingLevelV1, StoredSettingV1>>> {
		const project = (context as KernelFieldContext).scope?.project;
		const person = await readRecord(deps.recordId(personKeyOf(context)));
		const workspace = await readRow(rowId(known.fullId, 'workspace'));
		const atProject =
			project === undefined ? undefined : await readRow(rowId(known.fullId, 'project', project));
		const out: Partial<Record<SettingLevelV1, StoredSettingV1>> = {};
		const own = storedOf(person[slotOf(known)]?.[key]);
		if (own) out.person = own;
		const shared = storedOf(workspace?.values[key]);
		if (shared) out.workspace = shared;
		const local = storedOf(atProject?.values[key]);
		if (local) out.project = local;
		return out;
	}

	const personKeyOf = (context: CommandContext): string | undefined =>
		kit.personKey(context.actor as AccessActorV1) ?? (deps.provider ? undefined : 'local');

	const warn = (message: string) =>
		(globalThis as { console?: { warn(text: string): void } }).console?.warn(`[loam] ${message}`);

	/** Resolve from `from` down (3.3): the person's full resolution, or what a level shows with no one's own value. */
	function resolveFrom(
		known: KnownSectionV1,
		key: string,
		stored: Partial<Record<SettingLevelV1, StoredSettingV1>>,
		inProject: boolean,
		from: SettingLevelV1 = 'person'
	): ResolvedSettingV1 {
		const kept =
			from === 'person'
				? stored
				: from === 'project'
					? {
							...(stored.project ? { project: stored.project } : {}),
							...(stored.workspace ? { workspace: stored.workspace } : {}),
						}
					: stored.workspace
						? { workspace: stored.workspace }
						: {};
		return resolveSetting(known, key, kept, inProject, checkSettingValue, warn);
	}

	const resolvedData = (resolved: ResolvedSettingV1) => ({
		value: resolved.value,
		from: resolved.from,
		...(resolved.updatedAt !== undefined ? { updatedAt: resolved.updatedAt } : {}),
		...(resolved.updatedBy !== undefined ? { updatedBy: resolved.updatedBy } : {}),
	});

	/**
	 * Why the call's actor may not write `key` at `level`, or undefined (3.2): the level the key allows, section 13's
	 * hosted refusal, the human check with its hand-off, the project, and the owner check.
	 */
	function writeRefusal(
		command: string,
		known: KnownSectionV1,
		key: string,
		level: SettingLevelV1,
		context: CommandContext
	): CommandResult<never> | undefined {
		const rule = settingWriteRule(known, key, level);
		if (rule.rule === 'unavailable') {
			return fail(
				'SETTING_LEVEL_UNAVAILABLE',
				`'${known.fullId}.${key}' cannot be set at ${level} level`,
				`Set it at ${rule.levels.join(' or ')} level`,
				{ levels: rule.levels }
			);
		}
		const project = (context as KernelFieldContext).scope?.project;
		if (level === 'project' && project === undefined) {
			return fail(
				'SETTING_PROJECT_REQUIRED',
				'A project-level value needs a project in the call’s scope',
				"Make the call in the project's scope: `_meta` `dev.loam/scope` over MCP, or the call's `scope` option in process"
			);
		}
		// A port's call never reaches here (`CALL_NOT_GRANTED` at the port); refused all the same.
		if ((context as KernelFieldContext).caller !== undefined) {
			return fail(
				'CALL_NOT_GRANTED',
				'No app writes a setting',
				"Read this app's own sections with setting-get"
			);
		}
		const agent = (context.actor as AccessActorV1)?.kind === 'agent';
		if (agent && (rule.rule !== 'person' || rule.human)) {
			const route = settingRoute(known.fullId, key);
			return fail(
				'HUMAN_REQUIRED',
				rule.rule === 'person'
					? `'${known.fullId}.${key}' is one only your person sets`
					: `A ${level} value is read by every member, so only a person sets it`,
				`Ask your person to set it in the shell's settings, at ${route}, or leave them a notice that links there`,
				{ route, section: known.fullId, key, level }
			);
		}
		// After the agent's hand-off, as section 13's third obligation has the agent interface refused before any request.
		if (sharedRecordUnavailable(deps.hosted(), command, { level })) {
			return fail(
				'SHARED_RECORD_UNAVAILABLE',
				`A ${level} value has no record on this hosted deployment yet, so nothing was written`,
				'Set it in a local deployment, or wait for the release that serves it'
			);
		}
		if (rule.rule === 'owner' && !deps.isOwner(personKeyOf(context))) {
			return fail(
				'OWNER_REQUIRED',
				'Only an owner of the workspace can set a workspace value',
				'Ask an owner of the workspace to do this'
			);
		}
		return undefined;
	}

	/** A project write's project: archived refuses, as every write under it (phase 2 specification, 3.4's line 6). */
	function projectRefusal(
		known: KnownSectionV1,
		level: SettingLevelV1,
		context: CommandContext
	): CommandResult<never> | undefined {
		if (level !== 'project') return undefined;
		const id = (context as KernelFieldContext).scope?.project as string;
		const project = scope.projects.get(id) as ProjectV1 | undefined;
		if (project?.status === 'archived') return kit.archivedRefusal(project);
		// An app's key is a member's to set only where the app is enabled for the project (3.2).
		return opensIn(known, id);
	}

	/** Why the app declaring `known` cannot open in `project`, or undefined when it can, or for the shell's (3.2). */
	const opensIn = (known: KnownSectionV1, project: string): CommandResult<never> | undefined =>
		known.owner === 'shell' ? undefined : deps.canOpen(known.owner, project);

	/** The section's resolved object, with `key` at `next`, against its 16 KiB (3.1). */
	async function tooLarge(
		known: KnownSectionV1,
		key: string,
		next: unknown,
		context: CommandContext
	): Promise<boolean> {
		const inProject = (context as KernelFieldContext).scope?.project !== undefined;
		const object: Record<string, unknown> = {};
		for (const name of Object.keys(known.section.schema.properties)) {
			object[name] =
				name === key
					? next
					: resolveFrom(known, name, await storedFor(known, name, context), inProject).value;
		}
		return bytesOf(object) > SETTING_SECTION_MAX_BYTES;
	}

	/** Store `entry` for `key` at `level`, or remove it with undefined; returns what was stored before. */
	async function store1(
		known: KnownSectionV1,
		key: string,
		level: SettingLevelV1,
		entry: StoredSettingV1 | undefined,
		context: CommandContext
	): Promise<StoredSettingV1 | undefined> {
		const at = kit.callNow(context);
		const commit = async (operations: BatchOperation[]) => {
			// `loam.documents.trashDays` and the workspace row's, in one batch (A-P2-2; the second review's C).
			if (known.fullId === 'loam.documents' && key === 'trashDays') {
				const declared = known.section.schema.properties[key] as SettingKeyV1;
				await deps.trashDays((entry?.value ?? declared.default) as number, context, operations);
				return;
			}
			if (operations.length === 0) return;
			const { summary } = await store.batch(operations);
			if (summary.failed > 0) throw new Error(`The store could not write '${known.fullId}'`);
		};
		const path = (id: string) => `/${SETTING_TABLE}/${encodeURIComponent(id)}`;
		if (level === 'person') {
			const id = deps.recordId(personKeyOf(context));
			const record = await readRecord(id);
			const slot = slotOf(known);
			const section = record[slot] ?? {};
			const previous = storedOf(section[key]);
			if (entry) section[key] = entry;
			else delete section[key];
			if (Object.keys(section).length === 0) delete record[slot];
			else record[slot] = section;
			await writeRecord(id, record, at);
			return previous;
		}
		const project =
			level === 'project' ? (context as KernelFieldContext).scope?.project : undefined;
		const id = rowId(known.fullId, level, project);
		const row = await readRow(id);
		const previous = storedOf(row?.values[key]);
		const values = { ...(row?.values ?? {}) };
		if (entry) values[key] = entry;
		else delete values[key];
		if (Object.keys(values).length === 0) {
			await commit(row ? [{ method: 'DELETE', path: path(id) }] : []);
			return previous;
		}
		const next: SettingRowV1 = {
			id,
			workspace: scope.workspace.id,
			section: known.fullId,
			level,
			...(project !== undefined ? { project } : {}),
			values,
			updatedAt: at,
			updatedBy: writerOf(context.actor, personKeyOf(context) ?? 'local'),
		};
		await commit([{ method: 'PUT', path: path(id), body: next }]);
		return previous;
	}

	/**
	 * Why the section's values as a write would leave them at `level` break a rule between its keys (section 11's quarter
	 * rule), or undefined: `VALIDATION_ERROR`, whose suggestion names the order to write them in.
	 */
	async function relationRefusal(
		known: KnownSectionV1,
		key: string,
		next: unknown,
		level: SettingLevelV1,
		context: CommandContext
	): Promise<CommandResult<never> | undefined> {
		if (!known.relate) return undefined;
		const inProject = (context as KernelFieldContext).scope?.project !== undefined;
		const values: Record<string, unknown> = {};
		for (const name of Object.keys(known.section.schema.properties)) {
			values[name] =
				name === key
					? next
					: resolveFrom(known, name, await storedFor(known, name, context), inProject, level).value;
		}
		const wrong = known.relate(values);
		return wrong
			? fail(
					'VALIDATION_ERROR',
					`The value of '${known.fullId}.${key}' ${wrong.problem}`,
					wrong.suggestion,
					{ field: 'value' }
				)
			: undefined;
	}

	/** The person's overrides, read into the kernel's keybindings (8.3; `setting-overrides.ts`). */
	const overrides = createOverridesReader({
		keybindings: deps.keybindings,
		person: () => deps.person(),
		provider: deps.provider,
		replaying: () => deps.replaying(),
		async stored(person) {
			const known = SHELL_SECTIONS.find(
				(entry) => entry.fullId === KEYBINDINGS_ID
			) as KnownSectionV1;
			const record = await readRecord(deps.recordId(person ?? 'local'));
			return storedOf(record[slotOf(known)]?.overrides)?.value;
		},
	});
	const readOverrides = () => overrides.read();
	/** The kernel is disposed: a read in flight sets nothing after (the seventh round's 2). */
	let stopped = false;
	let limitsReading = 0;
	let lastLimits: string | undefined;

	/** The workspace's `loam.limits`, resolved and read into the kernel's limits (section 11, #2108). */
	async function readLimits(): Promise<boolean> {
		if (!deps.limits || stopped) return false;
		const generation = ++limitsReading;
		const known = SHELL_SECTIONS.find(
			(entry) => entry.fullId === LIMITS_SECTION_ID
		) as KnownSectionV1;
		// Hosted `provider` keeps defaults alone (R3); a failed read leaves defaults.
		const row = deps.hosted() ? undefined : await readRow(rowId(LIMITS_SECTION_ID, 'workspace'));
		if (stopped || generation !== limitsReading) return false;
		const resolved = {} as Record<LimitKeyV1, number>;
		for (const key of LIMIT_KEY_ORDER) {
			const stored = storedOf(row?.values[key]);
			resolved[key] = resolveFrom(
				known,
				key,
				stored ? { workspace: stored } : {},
				false,
				'workspace'
			).value as number;
		}
		const next = enforcedLimits(resolved);
		const serialized = JSON.stringify(next);
		const changed = lastLimits !== undefined && lastLimits !== serialized;
		lastLimits = serialized;
		deps.limits.set(next);
		return changed;
	}

	/** What follows a write: appearance applied, limits/overrides re-read, cross-tab sync and event sections (3.6, 3.8, 11, #2108). */
	async function afterWrite(known: KnownSectionV1, _key: string, context: CommandContext) {
		if (known.fullId === 'loam.appearance') await applyAppearance();
		if (known.fullId === LIMITS_SECTION_ID) {
			await readLimits();
			deps.onTabWrite?.('limits');
		}
		if (known.fullId === KEYBINDINGS_ID) {
			await readOverrides();
			deps.onTabWrite?.('keybindings', deps.provider ? personKeyOf(context) : undefined);
		}
		scope.note(context.traceId, { settings: [known.fullId] });
	}

	/** The person's own appearance keys, from their record, for the shell to paint with (3.6). */
	const appearanceOf = (record: PersonSettingsV1): Partial<AppearanceStateV0> =>
		Object.fromEntries(
			['theme', 'density'].flatMap((key) => {
				const known = SHELL_SECTIONS[0] as KnownSectionV1;
				const stored = storedOf(record['loam.appearance']?.[key]);
				const declared = known.section.schema.properties[key] as SettingKeyV1;
				return stored && !checkSettingValue(declared, stored.value) ? [[key, stored.value]] : [];
			})
		) as Partial<AppearanceStateV0>;

	/** The signed-in person's appearance applied: the shell paints it, and `provider` mode keeps it as `.last` (3.6, R4). */
	async function applyAppearance(): Promise<void> {
		const person = deps.person();
		if (deps.provider && person === undefined) return;
		const id = deps.recordId(person ?? 'local');
		const generation = ++painting;
		following = id;
		// Painting only: a read that fails keeps what the shell paints now.
		const record = await readRecord(id).catch(() => undefined);
		// Overtaken by a later paint, or the person changed while it read: what it read is no longer the shell's.
		if (generation !== painting || deps.person() !== person) return;
		if (record) deps.state.setOwnAppearance(appearanceOf(record));
		if (!deps.provider) return;
		// `.last` in memory and in the store, in a replay too, whose own store starts empty, so a signed-out
		// `appearance-get` after it reads the same.
		const { theme, density } = deps.state.appearance();
		const last = { theme, density };
		deps.state.setLastAppearance(last);
		const held = await store
			.get<{ value?: unknown }>(SETTINGS, APPEARANCE_LAST_ID)
			.catch(() => null);
		if (sameValue(held?.value, last)) return;
		// The profile's record, never journaled, so it reads no call's clock: a replay's clock reads stay the original's.
		const row = { category: 'settings', value: last };
		if (held) await store.update(SETTINGS, APPEARANCE_LAST_ID, row);
		else await store.create(SETTINGS, { id: APPEARANCE_LAST_ID, ...row });
	}

	// ─── Commands ──────────────────────────────────────────────────────────────

	const LEVEL = z.enum(LEVELS);
	const LEVEL_JSON: JsonSchema = { type: 'string', enum: [...LEVELS] };
	const NAME = z.string().check(z.minLength(1), z.maxLength(128));
	const NAME_JSON: JsonSchema = { type: 'string', minLength: 1, maxLength: 128 };

	const schemaInput = z.strictObject({
		section: z.optional(NAME),
		key: z.optional(NAME),
		outline: z.optional(z.boolean()),
	});
	const schemaGet = kit.define<
		typeof schemaInput,
		{
			sections: Array<{
				section: string;
				title: string;
				description?: string;
				levels: SettingLevelV1[];
				app?: string;
				instance?: string;
				schema?: SettingSectionV1['schema'];
				keys?: Array<{ key: string; title: string; levels: SettingLevelV1[] }>;
			}>;
		}
	>({
		name: 'setting-schema-get',
		title: 'Settings schemas',
		description:
			'List the settings sections and their keys: levels, types and defaults. Name a section, and a key, to read one; outline lists each section and its keys by title, with no schema',
		category: 'setting',
		mutation: false,
		executionTime: 'instant',
		input: schemaInput,
		jsonSchema: {
			type: 'object',
			properties: { section: NAME_JSON, key: NAME_JSON, outline: { type: 'boolean' } },
			additionalProperties: false,
		},
		async handler(input, context) {
			if (input.outline === true && input.key !== undefined) {
				return fail(
					'VALIDATION_ERROR',
					'An outline lists keys, so it names no key',
					'Leave key out, or outline out'
				);
			}
			if (input.key !== undefined && input.section === undefined) {
				return fail('VALIDATION_ERROR', 'A key is read within its section', 'Name the section too');
			}
			let listed: KnownSectionV1[];
			if (input.section !== undefined) {
				const found = lookup(context, input.section, input.key);
				if ('success' in found) return found;
				listed = [found.known];
			} else {
				const app = callerApp(context);
				listed = sections().filter((known) => owns(app, known));
			}
			const titles = new Map(
				deps
					.apps()
					.summaries()
					.map((app) => [app.instance, app.title])
			);
			const data = {
				sections: listed.map(({ fullId, section, owner }) => ({
					section: fullId,
					title: section.title,
					...(section.description !== undefined ? { description: section.description } : {}),
					levels: [...section.levels],
					// The owning app's title to show, and its instance, which says whose it is: two apps may share a title.
					...(owner !== 'shell' ? { app: titles.get(owner) ?? owner, instance: owner } : {}),
					...(input.outline === true
						? {
								keys: Object.entries(section.schema.properties).map(([key, declared]) => ({
									key,
									title: declared.title,
									levels: [...(declared.levels ?? section.levels)],
								})),
							}
						: {
								schema:
									input.key === undefined
										? section.schema
										: {
												...section.schema,
												properties: {
													[input.key]: section.schema.properties[input.key] as SettingKeyV1,
												},
											},
							}),
				})),
			};
			const budget = SETTING_OUTPUT_BUDGETS['setting-schema-get']?.maxBytes ?? 0;
			if (bytesOf(data) > budget) {
				return fail(
					'OUTPUT_BUDGET_EXCEEDED',
					`The schemas are over this command's budget of ${budget} bytes`,
					input.section === undefined
						? 'Name a section: setting-schema-get { section }'
						: 'Name a key: setting-schema-get { section, key }',
					{ maxBytes: budget }
				);
			}
			// Detached: no caller holds the kernel's schemas or stored values (the second review's A).
			return kit.success(structuredClone(data));
		},
	});

	/** Whether the caller may write `key` at `level` in this call, and if not, the code (3.9: `writable`, `reason`). */
	function writableFor(
		known: KnownSectionV1,
		key: string,
		level: SettingLevelV1,
		context: CommandContext
	): { writable: boolean; reason?: string } {
		const refused =
			writeRefusal('setting-set', known, key, level, context) ??
			projectRefusal(known, level, context);
		return refused
			? { writable: false, reason: refused.error?.code as string }
			: { writable: true };
	}

	/** The level a row's `writable` describes with no `level` asked: the narrowest the key allows here (3.9). */
	function naturalLevel(known: KnownSectionV1, key: string, inProject: boolean): SettingLevelV1 {
		const declared = known.section.schema.properties[key] as SettingKeyV1;
		const levels = declared.levels ?? known.section.levels;
		if (levels.includes('person')) return 'person';
		if (inProject && levels.includes('project')) return 'project';
		return levels.includes('workspace') ? 'workspace' : 'project';
	}

	const listInput = z.strictObject({ section: z.optional(NAME), level: z.optional(LEVEL) });
	const settingList = kit.define<
		typeof listInput,
		{
			values: Array<{
				section: string;
				key: string;
				value: unknown;
				from: SettingFromV1;
				updatedAt?: number;
				updatedBy?: string;
				writable: boolean;
				reason?: string;
			}>;
		}
	>({
		name: 'setting-list',
		title: 'List settings',
		description:
			"List the settings' values as they resolve for you here, with where each comes from and whether you may change it",
		category: 'setting',
		mutation: false,
		executionTime: 'instant',
		input: listInput,
		jsonSchema: {
			type: 'object',
			properties: { section: NAME_JSON, level: LEVEL_JSON },
			additionalProperties: false,
		},
		async handler(input, context) {
			let listed: KnownSectionV1[];
			if (input.section !== undefined) {
				const found = lookup(context, input.section);
				if ('success' in found) return found;
				listed = [found.known];
			} else {
				const app = callerApp(context);
				listed = sections().filter((known) => owns(app, known));
			}
			const inProject = (context as KernelFieldContext).scope?.project !== undefined;
			if (input.level === 'project' && !inProject) {
				return fail(
					'SETTING_PROJECT_REQUIRED',
					'Project-level values need a project in the call’s scope',
					"Make the call in the project's scope: `_meta` `dev.loam/scope` over MCP, or the call's `scope` option in process"
				);
			}
			const values = [];
			for (const known of listed) {
				for (const [key, declared] of Object.entries(known.section.schema.properties)) {
					const levels = declared.levels ?? known.section.levels;
					if (input.level !== undefined && !levels.includes(input.level)) continue;
					const stored = await storedFor(known, key, context);
					const resolved = resolveFrom(known, key, stored, inProject, input.level ?? 'person');
					values.push({
						section: known.fullId,
						key,
						...resolvedData(resolved),
						...writableFor(known, key, input.level ?? naturalLevel(known, key, inProject), context),
					});
				}
			}
			const budget = SETTING_OUTPUT_BUDGETS['setting-list']?.maxBytes ?? 0;
			if (bytesOf({ values }) > budget) {
				return fail(
					'OUTPUT_BUDGET_EXCEEDED',
					`The values are over this command's budget of ${budget} bytes`,
					input.section === undefined
						? 'Name a section: setting-list { section }'
						: 'Read one key: setting-get { section, key }',
					{ maxBytes: budget }
				);
			}
			return kit.success(structuredClone({ values }));
		},
	});

	const getInput = z.strictObject({ section: NAME, key: NAME });
	const settingGet = kit.define<
		typeof getInput,
		{ value: unknown; from: SettingFromV1; updatedAt?: number; updatedBy?: string }
	>({
		name: 'setting-get',
		title: 'Read a setting',
		description: "Read one setting's value as it resolves for you here, and where it comes from",
		category: 'setting',
		mutation: false,
		executionTime: 'instant',
		input: getInput,
		jsonSchema: {
			type: 'object',
			properties: { section: NAME_JSON, key: NAME_JSON },
			required: ['section', 'key'],
			additionalProperties: false,
		},
		async handler(input, context) {
			const found = lookup(context, input.section, input.key);
			if ('success' in found) return found;
			const inProject = (context as KernelFieldContext).scope?.project !== undefined;
			const stored = await storedFor(found.known, input.key, context);
			return kit.success(
				structuredClone(resolvedData(resolveFrom(found.known, input.key, stored, inProject)))
			);
		},
	});

	/** `expected` against what the key shows at `level`, before the write (3.2). */
	const conflict = (shown: unknown, expected: unknown) =>
		fail(
			'SETTING_CONFLICT',
			'The value changed since it was read, so nothing was written',
			'Read the value again with setting-get, then decide',
			{ current: shown, expected },
			true
		);

	const setInput = z.strictObject({
		section: NAME,
		key: NAME,
		value: z.unknown(),
		level: LEVEL,
		expected: z.optional(z.unknown()),
		migrated: z.optional(z.boolean()),
	});
	const settingSet = kit.define<
		typeof setInput,
		{ value: unknown; from: SettingFromV1; previous: unknown }
	>({
		name: 'setting-set',
		title: 'Change a setting',
		description:
			'Set a setting at a level: your own (person), a project, or the workspace. Name the level; pass expected, the value you read, to write only if it has not changed',
		category: 'setting',
		mutation: true,
		undoable: true,
		executionTime: 'instant',
		input: setInput,
		jsonSchema: {
			type: 'object',
			properties: {
				section: NAME_JSON,
				key: NAME_JSON,
				value: {},
				level: LEVEL_JSON,
				expected: {},
				migrated: { type: 'boolean' },
			},
			required: ['section', 'key', 'value', 'level'],
			additionalProperties: false,
		} as unknown as JsonSchema,
		handler: (input, context) => serial(() => setHandler(input, context)),
	});

	async function setHandler(
		input: {
			section: string;
			key: string;
			value: unknown;
			level: SettingLevelV1;
			expected?: unknown;
			migrated?: boolean;
		},
		context: CommandContext
	) {
		{
			const found = lookup(context, input.section, input.key);
			if ('success' in found) return found;
			const { known } = found as { known: KnownSectionV1 };
			const refused =
				writeRefusal('setting-set', known, input.key, input.level, context) ??
				projectRefusal(known, input.level, context);
			if (refused) return refused;
			// `migrated` marks stage B's move of an old appearance record (3.6): only the kernel's own call carries its
			// `migration` field, which the journal keeps, so a replay of that entry carries it and a replay of a person's
			// forged call does not; any other caller's `migrated` is `VALIDATION_ERROR` (the second review's D).
			const internal = (context as KernelFieldContext).migration === true;
			if (
				input.migrated !== undefined &&
				!(
					input.migrated &&
					internal &&
					known.fullId === 'loam.appearance' &&
					input.level === 'person' &&
					isHumanGesture(context)
				)
			) {
				return fail(
					'VALIDATION_ERROR',
					'`migrated` is the shell’s own mark of a moved appearance',
					'Leave `migrated` out'
				);
			}
			const wrong =
				input.value === undefined
					? { problem: 'is required' }
					: checkKnownValue(known, input.key, input.value, checkSettingValue);
			if (wrong) {
				return fail(
					wrong.code ?? 'VALIDATION_ERROR',
					`The value of '${known.fullId}.${input.key}' ${wrong.problem}`,
					wrong.suggestion ??
						(wrong.code === 'SETTING_MUTE_SHELL'
							? 'Mute an app instead'
							: wrong.code === 'KEYBINDING_RESERVED'
								? 'Bind another key'
								: 'Read the key with setting-schema-get { section, key }, and give a value inside it'),
					{ field: 'value' }
				);
			}
			const related = await relationRefusal(known, input.key, input.value, input.level, context);
			if (related) return related;
			const inProject = (context as KernelFieldContext).scope?.project !== undefined;
			const before = await storedFor(known, input.key, context);
			if (input.expected !== undefined) {
				const shown = resolveFrom(known, input.key, before, inProject, input.level).value;
				if (!sameValue(shown, input.expected)) return conflict(shown, input.expected);
			}
			if (await tooLarge(known, input.key, input.value, context)) {
				return fail(
					'SETTING_TOO_LARGE',
					`'${known.fullId}' would be over ${SETTING_SECTION_MAX_BYTES} bytes`,
					'Shorten the longest values'
				);
			}
			const person = personKeyOf(context) ?? 'local';
			const previous = await store1(
				known,
				input.key,
				input.level,
				{
					value: input.value,
					updatedAt: kit.callNow(context),
					updatedBy: writerOf(context.actor, person),
				},
				context
			);
			await afterWrite(known, input.key, context);
			const after = await storedFor(known, input.key, context);
			const resolved = resolveFrom(known, input.key, after, inProject);
			const at = { section: known.fullId, key: input.key, level: input.level };
			return kit.success(
				structuredClone({
					value: resolved.value,
					from: resolved.from,
					previous: previous?.value ?? null,
				}),
				previous
					? {
							undoCommand: 'setting-set',
							undoArgs: { ...at, value: previous.value, expected: input.value },
						}
					: { undoCommand: 'setting-reset', undoArgs: { ...at, expected: input.value } }
			);
		}
	}

	const resetInput = z.strictObject({
		section: NAME,
		key: NAME,
		level: LEVEL,
		expected: z.optional(z.unknown()),
	});
	const settingReset = kit.define<typeof resetInput, { value: unknown; from: SettingFromV1 }>({
		name: 'setting-reset',
		title: 'Reset a setting',
		description:
			"Clear a setting's value at a level, so it reads the next level's, or its default. Name the level",
		category: 'setting',
		mutation: true,
		undoable: true,
		executionTime: 'instant',
		input: resetInput,
		jsonSchema: {
			type: 'object',
			properties: { section: NAME_JSON, key: NAME_JSON, level: LEVEL_JSON, expected: {} },
			required: ['section', 'key', 'level'],
			additionalProperties: false,
		} as unknown as JsonSchema,
		handler: (input, context) =>
			serial(async () => {
				const found = lookup(context, input.section, input.key);
				if ('success' in found) return found;
				const { known } = found;
				const refused =
					writeRefusal('setting-reset', known, input.key, input.level, context) ??
					projectRefusal(known, input.level, context);
				if (refused) return refused;
				const inProject = (context as KernelFieldContext).scope?.project !== undefined;
				const before = await storedFor(known, input.key, context);
				if (input.expected !== undefined) {
					const shown = resolveFrom(known, input.key, before, inProject, input.level).value;
					if (!sameValue(shown, input.expected)) return conflict(shown, input.expected);
				}
				// What the level shows once its own value is gone, against the rules between the keys (section 11).
				const { [input.level]: _cleared, ...rest } = before;
				const related = await relationRefusal(
					known,
					input.key,
					resolveFrom(known, input.key, rest, inProject, input.level).value,
					input.level,
					context
				);
				if (related) return related;
				const previous = await store1(known, input.key, input.level, undefined, context);
				if (previous) await afterWrite(known, input.key, context);
				const after = await storedFor(known, input.key, context);
				const resolved = resolveFrom(known, input.key, after, inProject);
				const shown = resolveFrom(known, input.key, after, inProject, input.level).value;
				return kit.success(
					structuredClone({ value: resolved.value, from: resolved.from }),
					previous
						? {
								undoCommand: 'setting-set',
								undoArgs: {
									section: known.fullId,
									key: input.key,
									level: input.level,
									value: previous.value,
									expected: shown,
								},
							}
						: {}
				);
			}),
	});

	/** `appearance-set`'s and the alias's write, serialized with the `setting-*` writes. */
	async function writeAppearance(
		patch: Partial<AppearanceStateV0>,
		context: CommandContext
	): Promise<void> {
		const person = personKeyOf(context);
		// Signed out in `provider` mode: the profile's `.last` alone, never the `~signed-out` record (3.6).
		if (deps.provider && person === undefined) {
			const last = { ...deps.state.appearance(), ...patch };
			const value = { theme: last.theme, density: last.density };
			deps.state.setLastAppearance(value);
			const held = await store.get(SETTINGS, APPEARANCE_LAST_ID).catch(() => null);
			const row = { category: 'settings', value };
			if (held) await store.update(SETTINGS, APPEARANCE_LAST_ID, row);
			else await store.create(SETTINGS, { id: APPEARANCE_LAST_ID, ...row });
			return;
		}
		const known = SHELL_SECTIONS[0] as KnownSectionV1;
		const writer = writerOf(context.actor, person ?? 'local');
		const id = deps.recordId(person);
		const record = await readRecord(id);
		const section = record[known.fullId] ?? {};
		for (const [key, value] of Object.entries(patch)) {
			if (value === undefined) continue;
			section[key] = { value, updatedAt: kit.callNow(context), updatedBy: writer };
		}
		record[known.fullId] = section;
		await writeRecord(id, record, kit.callNow(context));
		await afterWrite(known, 'theme', context);
	}

	// ─── The palette's rows (3.10) ─────────────────────────────────────────────

	/** The index over every known key, and the sections it was built from: built again when they change. */
	let indexed: { built: string; index: PaletteIndex; rows: Map<string, PaletteItem> } | undefined;

	/** Each key of each known section, as a row: `name` is `<section>.<key>`, `app` the owning app's title (3.10). */
	function indexRows(known: readonly KnownSectionV1[]): Map<string, PaletteItem> {
		const titles = new Map(
			deps
				.apps()
				.summaries()
				.map((app) => [app.instance, app.title])
		);
		const rows = new Map<string, PaletteItem>();
		for (const entry of known) {
			for (const [key, declared] of Object.entries(entry.section.schema.properties)) {
				const name = `${entry.fullId}.${key}`;
				rows.set(name, {
					name,
					title: declared.title,
					description: declared.description ?? entry.section.title,
					score: 0,
					field: 'name',
					matches: [],
					kind: 'setting',
					section: entry.fullId,
					key,
					...(entry.owner !== 'shell' ? { app: titles.get(entry.owner) ?? entry.owner } : {}),
				});
			}
		}
		return rows;
	}

	const rows: SettingRows = {
		async search(query, context, limit) {
			if (query.trim() === '') return [];
			const known = sections();
			// Built again when a section, its owner, its title or one of its keys changes.
			const built = JSON.stringify(
				known.map((entry) => [
					entry.fullId,
					entry.owner,
					entry.section.title,
					Object.entries(entry.section.schema.properties).map(([key, declared]) => [
						key,
						declared.title,
						declared.description,
						declared.levels,
					]),
				])
			);
			if (indexed?.built !== built) {
				const held = indexRows(known);
				// By name and title: a key's description is a sentence, whose letters a short query finds by accident.
				indexed = {
					built,
					rows: held,
					index: deps.paletteIndex([...held.values()], ['name', 'title']),
				};
			}
			const { index, rows: held } = indexed;
			const byId = new Map(known.map((entry) => [entry.fullId, entry]));
			// Filtered for the call at query time. A project-only key shows only in a project the caller may enter, and an
			// app's only where one of its instances opens there (3.2, 3.10): `palette-search` is not decided at the call's
			// scope, so a project the actor may not enter is treated as no project, revealing nothing of it. The `owns`
			// filter is defence in depth: a port is refused `palette-search` itself (`CALL_NOT_GRANTED`).
			const app = callerApp(context);
			const asked = (context as KernelFieldContext).scope?.project;
			const project =
				asked !== undefined &&
				scope.allows(context.actor as AccessActorV1, {
					workspace: scope.workspace.id,
					project: asked,
				})
					? asked
					: undefined;
			const out: PaletteItem[] = [];
			for (const found of index.search(query, index.size)) {
				const row = held.get(found.name) as PaletteItem;
				const entry = byId.get(row.section as string) as KnownSectionV1;
				if (!entry || !Object.hasOwn(entry.section.schema.properties, row.key as string)) continue;
				if (!owns(app, entry)) continue;
				const levels = levelsOf(entry, row.key as string);
				const projectOnly = !levels.includes('person') && !levels.includes('workspace');
				if (projectOnly && (project === undefined || opensIn(entry, project) !== undefined))
					continue;
				out.push({ ...row, score: found.score, field: found.field, matches: found.matches });
				if (out.length === limit) break;
			}
			return structuredClone(out);
		},
		ownerOf(section) {
			const owner = sections().find((entry) => entry.fullId === section)?.owner;
			return owner === undefined || owner === 'shell' ? undefined : owner;
		},
	};

	function target(to: string, context: CommandContext): { path: string } | CommandResult<never> {
		// The autonomy section (4.5), whose own commands write it: its route, and the cap's key (3.2's hand-off).
		if (to === 'loam.autonomy' || to === 'loam.autonomy.cap')
			return { path: to === 'loam.autonomy' ? to : 'loam.autonomy/cap' };
		// The experiments list (5.4), whose own commands write it: its route, as the hand-off names it.
		if (to === 'loam.experiments') return { path: to };
		const known = sections().find(
			(entry) => to === entry.fullId || to.startsWith(`${entry.fullId}.`)
		);
		const fullId = known?.fullId ?? to;
		const key = known && to !== known.fullId ? to.slice(known.fullId.length + 1) : undefined;
		const found = lookup(context, fullId, key);
		if ('success' in found) return found;
		return { path: key === undefined ? fullId : `${fullId}/${key}` };
	}

	return {
		commands: [
			schemaGet,
			settingList,
			settingGet,
			settingSet,
			settingReset,
		] as unknown as ZodCommandDefinition[],
		sections,
		rows,
		target,
		async railOrder(context) {
			const known = SHELL_SECTIONS.find((entry) => entry.fullId === 'loam.rail') as KnownSectionV1;
			const inProject = (context as KernelFieldContext).scope?.project !== undefined;
			const { value } = resolveFrom(
				known,
				'order',
				await storedFor(known, 'order', context),
				inProject
			);
			return Array.isArray(value) ? (value as string[]) : [];
		},
		async notificationPrefs(context) {
			const known = SHELL_SECTIONS.find(
				(entry) => entry.fullId === 'loam.notifications'
			) as KnownSectionV1;
			const read = async (key: string) =>
				resolveFrom(known, key, await storedFor(known, key, context), false).value;
			const sticky = await read('toastSticky');
			const muted = await read('muted');
			return {
				toastSticky: sticky === 'never' || sticky === 'always' ? sticky : 'danger',
				muted: Array.isArray(muted) ? muted.filter((id) => typeof id === 'string') : [],
			};
		},
		writeAppearance: (patch, context) => serial(() => writeAppearance(patch, context)),
		readLimits,
		refusesAgent(name, input) {
			if (AGENT_REFUSED.includes(name)) return true;
			if (name !== 'setting-set' && name !== 'setting-reset') return false;
			const asked =
				typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
			if (asked.level === 'workspace' || asked.level === 'project') return true;
			// `migrated` is the shell's own move alone, which the handler refuses from anyone else (3.6).
			if (asked.migrated !== undefined) return true;
			return (
				asked.level === 'person' &&
				typeof asked.section === 'string' &&
				typeof asked.key === 'string' &&
				isHumanKey(asked.section, asked.key)
			);
		},
		// `readRecord` keeps only the entries `storedOf` reads, so each is a whole stored value.
		ownSection: async (person, section) => (await readRecord(deps.recordId(person)))[section] ?? {},
		async ownValue(section, key, context) {
			return storedOf((await readRecord(deps.recordId(personKeyOf(context))))[section]?.[key]);
		},
		writeOwn: (section, key, entry, context) =>
			serial(async () => {
				const id = deps.recordId(personKeyOf(context));
				const record = await readRecord(id);
				const held = record[section] ?? {};
				const previous = storedOf(held[key]);
				if (entry) held[key] = entry;
				else delete held[key];
				if (Object.keys(held).length === 0) delete record[section];
				else record[section] = held;
				await writeRecord(id, record, kit.callNow(context));
				return previous;
			}),
		readOverrides,
		stop: () => {
			stopped = true;
			overrides.stop();
		},
		async follow() {
			const person = deps.person();
			const id = deps.provider && person === undefined ? undefined : deps.recordId(person);
			// The new person's own keybindings (8.3), whatever their appearance does: in `local` mode a sign-in keeps the
			// record's id and changes the person the registry holds them for.
			await overrides.follow();
			if (id === following) return;
			if (id === undefined) {
				// Signed out in `provider` mode: no one's own appearance; the page paints `.last` (3.6).
				following = undefined;
				painting++;
				deps.state.setOwnAppearance({});
				return;
			}
			await applyAppearance();
		},
		async migrate(run) {
			if (deps.replaying()) return;
			const legacy = deps.state.legacyAppearance();
			if (!legacy) return;
			const person = deps.person();
			// Never while signed out in `provider` mode: the old record moves into the first signed-in person's (3.6).
			if (deps.provider && person === undefined) return;
			const id = deps.recordId(person);
			const own = (await readRecord(id))['loam.appearance'] ?? {};
			for (const key of ['theme', 'density'] as const) {
				const value = legacy[key];
				if (value === undefined || own[key]) continue;
				const moved = await run('setting-set', {
					section: 'loam.appearance',
					key,
					value,
					level: 'person',
					migrated: true,
				});
				// A refused move keeps the old record, which the next stage B moves again (the review's I2).
				if (!moved.success) return;
			}
			// The old record goes only once every key it held is stored for the same person (the second review's D).
			if (deps.person() !== person) return;
			const stored = (await readRecord(id))['loam.appearance'] ?? {};
			if ((['theme', 'density'] as const).some((key) => legacy[key] !== undefined && !stored[key]))
				return;
			deps.state.dropLegacyAppearance();
			await store.remove(SETTINGS, 'loam.appearance').catch(() => undefined);
		},
	};
}

/**
 * @fileoverview Persona (phase 3 specification, 6; D89), in the `late-identity` chunk: the `persona-*` commands,
 * the active persona of each person, its landing and project at sign-in, and its emphasis in the palette. A
 * persona is a lens and never a grant: nothing here is read by `decideAccess`, the grants, the auth gate, line 0
 * or the owner and human checks, and the kernel sets its id only as the journaled `persona` context field.
 * Everything a first-paint or `late` module holds reaches this chunk through its deps, so first paint's shared
 * modules are not parted into a chunk of their own (13).
 */

import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import type { JsonSchema, ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type { DataAdapter } from '@lushly-dev/local-db';
import type { AppsRuntime } from '../apps-runtime.js';
import type { LoamKernelErrorCode } from '../errors.js';
import type { PaletteItem } from '../palette-index.js';
import type { PersonaV1, ScopeV1 } from '../scope/records.js';
import type { ScopeRuntime } from '../scope/runtime.js';
import type { CommandSummaryV1 } from '../types.js';
import type { DocumentKit } from './document-kit.js';
import { PERSONA_TABLE } from './tables.js';

/** The implicit persona: no record, no presentation, defaults or emphasis, never removed (6.1). */
export const DEFAULT_PERSONA = 'default';

/** Most personas a person keeps (6.1). */
export const PERSONA_LIMIT = 8;

/** Most apps a persona emphasizes (6.1). */
export const EMPHASIS_APPS_MAX = 12;

/** The sections a persona may emphasize (6.1). */
export const PERSONA_SECTIONS = ['projects', 'documents', 'account'] as const;

/**
 * The palette's sections, by command category: a command of an emphasized section ranks first (6.2). A
 * document's row is the documents section's.
 */
const SECTION_OF: Readonly<Record<string, string>> = {
	project: 'projects',
	document: 'documents',
	account: 'account',
};

/** The view-state table and category, where `loam.persona~<person>` is kept as a record of its own (6.1). */
const SETTINGS = 'settings';

/** What another member sees of a person's persona: the active one's presentation, and nothing else (6.1). */
export type PersonaPresentationV1 = PersonaV1['presentation'];

export interface PersonaDeps {
	/** The workspace store: the `persona` table and each person's `loam.persona~<person>`. */
	store: DataAdapter;
	scope: ScopeRuntime;
	apps(): AppsRuntime;
	/** The kernel's map of each person's active persona when it is not `default`: the context field's source. */
	personas: Map<string, string>;
	/** `ICONS_V1`, an avatar's ids. */
	icons: readonly string[];
	themes: readonly string[];
	densities: readonly string[];
	/** `canOpen`: why an app cannot open with `project`, or undefined. */
	canOpen(instance: string, project: string | undefined): CommandResult<never> | undefined;
	/** `setMain`. */
	setMain(main: { active?: string | null; section?: string | null; path?: string }): void;
	/** `appearance-set`'s handler, which `persona-set` applies a persona's density and theme through (6.2). */
	appearance(patch: Record<string, string>, context: CommandContext): Promise<CommandResult>;
	kit: Pick<DocumentKit, 'define' | 'success' | 'z' | 'kernelFailure' | 'personOf' | 'callNow'>;
}

/** The fields a persona's create and update take. */
interface PersonaFields {
	title: string;
	presentation?: PersonaV1['presentation'] | undefined;
	defaults?: PersonaV1['defaults'] | undefined;
	emphasis?: PersonaV1['emphasis'] | undefined;
}

const SUGGESTIONS = {
	PERSONA_NOT_FOUND: 'List your personas with persona-list and name one of them',
	PERSONA_LIMIT: `Remove one with persona-remove first: each person keeps up to ${PERSONA_LIMIT}`,
} as const;

export function createPersona(deps: PersonaDeps) {
	const { store, kit, personas } = deps;
	const { z } = kit;
	/** The persons whose `loam.persona~<person>` has been read into {@link PersonaDeps.personas}. */
	const read = new Map<string, Promise<void>>();
	const recordId = (person: string) => `loam.persona~${person}`;

	const fail = (
		code: LoamKernelErrorCode,
		message: string,
		suggestion: string
	): CommandResult<never> => kit.kernelFailure(code, message, suggestion);
	const notFound = () =>
		fail('PERSONA_NOT_FOUND', 'You have no persona with this id', SUGGESTIONS.PERSONA_NOT_FOUND);
	const invalid = (message: string, suggestion: string) =>
		fail('PERSONA_INVALID', message, suggestion);

	/** A person's personas, oldest first: only theirs, so another person's never answers (6.1). */
	async function personasOf(person: string): Promise<PersonaV1[]> {
		const listed = await store.list<PersonaV1>(PERSONA_TABLE, { person } as never);
		return listed.data
			.filter((row) => row.person === person)
			.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
	}

	/** One of the person's personas, or undefined: another person's reads as missing (6.1). */
	async function own(person: string, id: string): Promise<PersonaV1 | undefined> {
		const row = await store.get<PersonaV1>(PERSONA_TABLE, id);
		return row?.person === person ? row : undefined;
	}

	/**
	 * Read `loam.persona~<person>` into the kernel's map, once per person until `fresh` asks again; a record naming no
	 * persona of theirs is `default`. A change of person reads it fresh, so another tab's switch is not missed (the
	 * step 5 review's I1).
	 */
	function hear(person: string, fresh = false): Promise<void> {
		if (fresh) read.delete(person);
		let reading = read.get(person);
		if (!reading) {
			reading = (async () => {
				const row = await store
					.get<{ value?: { active?: unknown } }>(SETTINGS, recordId(person))
					.catch(() => null);
				const active = row?.value?.active;
				if (typeof active === 'string' && active !== DEFAULT_PERSONA && (await own(person, active)))
					personas.set(person, active);
				else personas.delete(person);
			})();
			read.set(person, reading);
		}
		return reading;
	}

	/** The person's active persona id, `default` with none. */
	async function activeOf(person: string): Promise<string> {
		await hear(person);
		return personas.get(person) ?? DEFAULT_PERSONA;
	}

	/** Write the person's active persona, in the kernel's map at once and in their record. */
	async function activate(person: string, id: string, now: number): Promise<void> {
		if (id === DEFAULT_PERSONA) personas.delete(person);
		else personas.set(person, id);
		const row = {
			category: 'view-state',
			value: { active: id },
			updatedAt: new Date(now).toISOString(),
		};
		if (await store.get(SETTINGS, recordId(person))) {
			await store.update(SETTINGS, recordId(person), row);
		} else {
			await store.create(SETTINGS, { id: recordId(person), ...row });
		}
	}

	/** The implicit `default`, as `persona-list` shows it first (6.3). */
	const implicit = (person: string): PersonaV1 => ({
		id: DEFAULT_PERSONA,
		workspace: deps.scope.workspace.id,
		person,
		title: 'Default',
		presentation: {},
		defaults: {},
		emphasis: {},
		createdAt: 0,
		updatedAt: 0,
		updatedBy: person,
	});

	/** What a persona's fields must hold beyond their shape (6.1, 6.3), or the refusal. */
	function check(fields: Partial<PersonaFields>): CommandResult<never> | undefined {
		const avatar = fields.presentation?.avatar;
		if (avatar !== undefined && !deps.icons.includes(avatar)) {
			return invalid(
				`'${avatar}' is not an icon`,
				"Name an icon of ICONS_V1, as an app's icon is named, or leave the avatar out"
			);
		}
		const landing = fields.defaults?.landing as { section?: string; app?: string } | undefined;
		if (landing && (landing.section === undefined) === (landing.app === undefined)) {
			return invalid(
				'A landing names a section or an app, never both and never neither',
				'Pass { "section": "projects" } or { "app": "<instance>" }'
			);
		}
		const apps = fields.emphasis?.apps ?? [];
		const sections = fields.emphasis?.sections ?? [];
		const instances = new Set(
			deps
				.apps()
				.summaries()
				.map((app) => app.instance)
		);
		const unknown = apps.find((instance) => !instances.has(instance));
		if (unknown !== undefined) {
			return invalid(
				`'${unknown}' is not an app instance in this workspace`,
				'Name instances app-list lists'
			);
		}
		if (new Set(apps).size !== apps.length || new Set(sections).size !== sections.length) {
			return invalid('An emphasis names each app and section once', 'Remove the repeated names');
		}
		return undefined;
	}

	// ─── Schemas ─────────────────────────────────────────────────────────────────

	const text = (max: number) => z.string().check(z.minLength(1), z.maxLength(max));
	const textJson = (max: number): JsonSchema => ({ type: 'string', minLength: 1, maxLength: max });
	const presentation = z.strictObject({
		name: z.optional(text(80)),
		pronouns: z.optional(text(40)),
		avatar: z.optional(text(128)),
	});
	const defaults = z.strictObject({
		landing: z.optional(
			z.strictObject({
				section: z.optional(z.enum(['projects', 'documents'])),
				app: z.optional(text(128)),
			})
		),
		project: z.optional(z.nullable(text(128))),
		density: z.optional(z.enum(deps.densities as [string, ...string[]])),
		theme: z.optional(z.enum(deps.themes as [string, ...string[]])),
	});
	const emphasis = z.strictObject({
		apps: z.optional(z.array(text(128)).check(z.maxLength(EMPHASIS_APPS_MAX))),
		sections: z.optional(
			z.array(z.enum(PERSONA_SECTIONS)).check(z.maxLength(PERSONA_SECTIONS.length))
		),
	});
	const FIELDS_JSON: Record<string, JsonSchema> = {
		title: textJson(40),
		presentation: {
			type: 'object',
			properties: { name: textJson(80), pronouns: textJson(40), avatar: textJson(128) },
			additionalProperties: false,
		},
		defaults: {
			type: 'object',
			properties: {
				landing: {
					type: 'object',
					properties: {
						section: { type: 'string', enum: ['projects', 'documents'] },
						app: textJson(128),
					},
					additionalProperties: false,
				},
				project: { anyOf: [textJson(128), { type: 'null' }] } as JsonSchema,
				density: { type: 'string', enum: [...deps.densities] },
				theme: { type: 'string', enum: [...deps.themes] },
			},
			additionalProperties: false,
		},
		emphasis: {
			type: 'object',
			properties: {
				apps: { type: 'array', items: textJson(128), maxItems: EMPHASIS_APPS_MAX },
				sections: {
					type: 'array',
					items: { type: 'string', enum: [...PERSONA_SECTIONS] },
					maxItems: PERSONA_SECTIONS.length,
				},
			},
			additionalProperties: false,
		},
	};
	const ref = text(64);
	const REF_JSON = textJson(64);

	// ─── Commands ────────────────────────────────────────────────────────────────

	const empty = z.strictObject({});
	const personaList = kit.define<typeof empty, { personas: PersonaV1[]; active: string }>({
		name: 'persona-list',
		description: 'List your personas, default first, and which is active; never anyone else’s',
		category: 'persona',
		mutation: false,
		executionTime: 'fast',
		input: empty,
		jsonSchema: { type: 'object', properties: {}, additionalProperties: false },
		async handler(_input, context) {
			const person = kit.personOf(context);
			return kit.success({
				personas: [implicit(person), ...(await personasOf(person))],
				active: await activeOf(person),
			});
		},
	});

	const createInput = z.strictObject({
		title: text(40),
		presentation: z.optional(presentation),
		defaults: z.optional(defaults),
		emphasis: z.optional(emphasis),
		// `persona-remove`'s undo, which brings the same persona back (6.3).
		id: z.optional(ref),
	});
	const personaCreate = kit.define<typeof createInput, PersonaV1>({
		name: 'persona-create',
		title: 'Create a persona',
		description:
			'Create a persona: how you present to others, your defaults and what the shell emphasizes for you; never what you may do',
		category: 'persona',
		mutation: true,
		undoable: true,
		executionTime: 'fast',
		input: createInput,
		jsonSchema: {
			type: 'object',
			properties: { ...FIELDS_JSON, id: REF_JSON },
			required: ['title'],
			additionalProperties: false,
		},
		async handler(input, context) {
			const person = kit.personOf(context);
			const refused = check(input as PersonaFields);
			if (refused) return refused;
			if ((await personasOf(person)).length >= PERSONA_LIMIT) {
				return fail(
					'PERSONA_LIMIT',
					`You already keep ${PERSONA_LIMIT} personas`,
					SUGGESTIONS.PERSONA_LIMIT
				);
			}
			const id = input.id ?? newId(context);
			// The caller's own persona may say so; anyone else's answers as a malformed id does, so no one learns
			// that an id is held (6.1; the step 5 review's N1).
			if (await own(person, id)) {
				return invalid(
					'You already have a persona with this id',
					'Leave the id out to make a new one, or change it with persona-update'
				);
			}
			if (!/^per_[a-z0-9]{16}$/.test(id) || (await store.get(PERSONA_TABLE, id))) {
				return invalid(
					`'${id}' cannot be a new persona's id`,
					'Leave the id out: the shell chooses one'
				);
			}
			const now = kit.callNow(context);
			const row: PersonaV1 = {
				id,
				workspace: deps.scope.workspace.id,
				person,
				title: input.title,
				presentation: input.presentation ?? {},
				defaults: (input.defaults ?? {}) as PersonaV1['defaults'],
				emphasis: input.emphasis ?? {},
				createdAt: now,
				updatedAt: now,
				updatedBy: person,
			};
			await store.create(PERSONA_TABLE, row);
			return kit.success(row, {
				undoCommand: 'persona-remove',
				undoArgs: { persona: id },
			});
		},
	});

	const updateInput = z.strictObject({
		persona: ref,
		title: z.optional(text(40)),
		presentation: z.optional(presentation),
		defaults: z.optional(defaults),
		emphasis: z.optional(emphasis),
	});
	const personaUpdate = kit.define<typeof updateInput, PersonaV1>({
		name: 'persona-update',
		title: 'Change a persona',
		description: 'Change one of your personas; each field given replaces the one held',
		category: 'persona',
		mutation: true,
		undoable: true,
		executionTime: 'fast',
		input: updateInput,
		jsonSchema: {
			type: 'object',
			properties: { persona: REF_JSON, ...FIELDS_JSON },
			required: ['persona'],
			additionalProperties: false,
		},
		async handler(input, context) {
			const person = kit.personOf(context);
			if (input.persona === DEFAULT_PERSONA) {
				return invalid(
					'The default persona has nothing to change',
					'Create a persona with persona-create'
				);
			}
			const held = await own(person, input.persona);
			if (!held) return notFound();
			const { persona: _id, ...fields } = input;
			const refused = check(fields as Partial<PersonaFields>);
			if (refused) return refused;
			const now = kit.callNow(context);
			const next: PersonaV1 = {
				...held,
				...(Object.fromEntries(
					Object.entries(fields).filter(([, value]) => value !== undefined)
				) as Partial<PersonaV1>),
				updatedAt: now,
				updatedBy: person,
			};
			await store.update(PERSONA_TABLE, held.id, next);
			// The active persona's title and emphasis are shown: the shell reads them again.
			if ((await activeOf(person)) === held.id) {
				deps.scope.note(context.traceId, { personaChanged: true });
			}
			return kit.success(next, {
				undoCommand: 'persona-update',
				undoArgs: {
					persona: held.id,
					title: held.title,
					presentation: held.presentation,
					defaults: held.defaults,
					emphasis: held.emphasis,
				},
			});
		},
	});

	const refInput = z.strictObject({ persona: ref });
	const REF_INPUT_JSON: JsonSchema = {
		type: 'object',
		properties: { persona: REF_JSON },
		required: ['persona'],
		additionalProperties: false,
	};
	const personaRemove = kit.define<typeof refInput, { removed: true }>({
		name: 'persona-remove',
		title: 'Remove a persona',
		description: 'Remove one of your personas; the active one becomes default',
		category: 'persona',
		mutation: true,
		undoable: true,
		executionTime: 'fast',
		input: refInput,
		jsonSchema: REF_INPUT_JSON,
		async handler(input, context) {
			const person = kit.personOf(context);
			if (input.persona === DEFAULT_PERSONA) {
				return invalid(
					'The default persona is never removed',
					'Name a persona you created; persona-list lists them'
				);
			}
			const held = await own(person, input.persona);
			if (!held) return notFound();
			if ((await activeOf(person)) === held.id) {
				await activate(person, DEFAULT_PERSONA, kit.callNow(context));
				deps.scope.note(context.traceId, { personaChanged: true });
			}
			await store.remove(PERSONA_TABLE, held.id);
			return kit.success(
				{ removed: true as const },
				{
					undoCommand: 'persona-create',
					undoArgs: {
						id: held.id,
						title: held.title,
						presentation: held.presentation,
						defaults: held.defaults,
						emphasis: held.emphasis,
					},
				}
			);
		},
	});

	const setInput = z.strictObject({
		persona: ref,
		// What a switch's undo restores: the density and theme the switch replaced (6.3, amended in step 5).
		appearance: z.optional(
			z.strictObject({
				density: z.optional(z.enum(deps.densities as [string, ...string[]])),
				theme: z.optional(z.enum(deps.themes as [string, ...string[]])),
			})
		),
	});
	const personaSet = kit.define<typeof setInput, { persona: string; previous: string }>({
		name: 'persona-set',
		title: 'Switch persona',
		description:
			'Make one of your personas active, or default: its density and theme apply now, and what it emphasizes moves first; nothing moves you or changes what you may do',
		category: 'persona',
		mutation: true,
		undoable: true,
		executionTime: 'fast',
		input: setInput,
		jsonSchema: {
			type: 'object',
			properties: {
				persona: REF_JSON,
				appearance: {
					type: 'object',
					properties: {
						density: { type: 'string', enum: [...deps.densities] },
						theme: { type: 'string', enum: [...deps.themes] },
					},
					additionalProperties: false,
				},
			},
			required: ['persona'],
			additionalProperties: false,
		},
		async handler(input, context) {
			const person = kit.personOf(context);
			const held = input.persona === DEFAULT_PERSONA ? undefined : await own(person, input.persona);
			if (input.persona !== DEFAULT_PERSONA && !held) return notFound();
			const previous = await activeOf(person);
			// Choosing the active persona again changes nothing, its appearance included (the step 5 review's I4).
			if (previous === input.persona) return kit.success({ persona: input.persona, previous });
			// A persona's density and theme, through `appearance-set`'s own code, in this call (6.2); `appearance`, which
			// an undo passes, is what the switch it undoes replaced, and wins.
			const { density, theme } = held?.defaults ?? {};
			const patch = {
				...(density !== undefined ? { density } : {}),
				...(theme !== undefined ? { theme } : {}),
				...input.appearance,
			};
			let replaced: Record<string, unknown> | undefined;
			if (Object.keys(patch).length > 0) {
				const applied = await deps.appearance(patch, context);
				if (!applied.success) return applied as CommandResult<never>;
				replaced = applied.undoArgs;
			}
			await activate(person, input.persona, kit.callNow(context));
			deps.scope.note(context.traceId, { personaChanged: true });
			// The undo switches back and restores the appearance this switch replaced (6.3, amended in step 5).
			return kit.success(
				{ persona: input.persona, previous },
				{
					undoCommand: 'persona-set',
					undoArgs: { persona: previous, ...(replaced ? { appearance: replaced } : {}) },
				}
			);
		},
	});

	/** `per_` and 16 of `[a-z0-9]` from the command's random, so a replay reproduces it (6.1). */
	const newId = (context: CommandContext): string => {
		const draw = () => (context.random?.next() ?? Math.random()).toString(36).slice(2);
		return `per_${`${draw()}${draw()}0000000000000000`.slice(0, 16)}`;
	};

	/** The active persona's record, or undefined for `default`. */
	async function recordOf(person: string): Promise<PersonaV1 | undefined> {
		const id = await activeOf(person);
		return id === DEFAULT_PERSONA ? undefined : own(person, id);
	}

	return {
		commands: [
			personaList,
			personaCreate,
			personaUpdate,
			personaRemove,
			personaSet,
		] as unknown as ZodCommandDefinition[],
		/** A person's active persona read, so their calls carry its id (a change of person, 4.4). */
		hear,
		recordOf,
		/**
		 * What other members see of `person` (6.1): their active persona's presentation alone, `{}` for `default`.
		 * Never the title, defaults, emphasis, or that other personas exist. `member-list` reads it.
		 */
		async presentationOf(person: string): Promise<PersonaPresentationV1> {
			return { ...((await recordOf(person))?.presentation ?? {}) };
		},
		/**
		 * At sign-in (6.2), by `session-settle`: the arriving person's persona's project, through `decideAccess`
		 * (`allowed`), where they land; with none, or one they may not enter, `at` stands. Refused silently.
		 */
		projectAt(
			persona: PersonaV1 | undefined,
			at: ScopeV1,
			allowed: (scope: ScopeV1) => boolean
		): ScopeV1 {
			const wanted = persona?.defaults.project;
			if (wanted === undefined) return at;
			if (wanted === null) return { workspace: at.workspace };
			const project = deps.scope.project(wanted);
			const there = project && { workspace: at.workspace, project: project.id };
			return there && project.slug === wanted && allowed(there) ? there : at;
		},
		/**
		 * At sign-in (6.2), after the scope: the persona's landing, a section, or an app through `canOpen`; refused
		 * silently. True when main moved.
		 */
		land(persona: PersonaV1 | undefined, at: ScopeV1): boolean {
			const landing = persona?.defaults.landing as
				| { section?: 'projects' | 'documents'; app?: string }
				| undefined;
			if (landing?.section !== undefined) {
				if (!deps.apps().close().success) return false;
				deps.setMain({ active: null, section: landing.section, path: '' });
				return true;
			}
			const app = landing?.app;
			if (app === undefined || deps.canOpen(app, at.project)) return false;
			if (!deps.apps().open(app).success) return false;
			deps.setMain({ section: null, path: '' });
			return true;
		},
		/**
		 * `palette-search` with the active persona's emphasis (6.2): the emphasized apps' commands and the
		 * emphasized sections' first, each group in its own order. The same items, only ordered, so nothing is
		 * hidden and the set a search answers is a persona's or not alike.
		 */
		paletteSearch(
			command: ZodCommandDefinition,
			rows: () => readonly CommandSummaryV1[],
			categoryOf: (name: string) => string | undefined
		): ZodCommandDefinition {
			return {
				...command,
				async handler(input: unknown, context: CommandContext) {
					const result = (await command.handler(input, context)) as CommandResult<{
						items: PaletteItem[];
					}>;
					const items = result.data?.items;
					if (!result.success || !items) return result;
					const persona = await recordOf(kit.personOf(context));
					const apps = new Set(persona?.emphasis.apps ?? []);
					const sections = new Set<string>(persona?.emphasis.sections ?? []);
					if (apps.size === 0 && sections.size === 0) return result;
					const instances = new Map(rows().map((row) => [row.name, row.instance]));
					const first = (item: PaletteItem): boolean =>
						item.kind === 'document'
							? sections.has('documents')
							: apps.has(instances.get(item.name) as string) ||
								sections.has(SECTION_OF[categoryOf(item.name) as string] as string);
					return {
						...result,
						data: {
							...result.data,
							items: [...items.filter(first), ...items.filter((item) => !first(item))],
						},
					};
				},
			} as ZodCommandDefinition;
		},
		/** Forget what was read, for a replay's reload: each page reads its records again (10). */
		reload(): void {
			read.clear();
		},
	};
}

export type Persona = ReturnType<typeof createPersona>;

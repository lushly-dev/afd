/**
 * @fileoverview The shell's phase 0 commands (phase 0 specification, 6.3), as phase 1 keys their
 * layout by the active app (phase 1 specification, 4.5), but for the boot commands in
 * `boot-commands.ts`. The app and overlay commands are in `app-commands.ts` and `overlay-commands.ts`.
 *
 * Range checks run in the handlers through the shared validators, never in the input schemas,
 * so a refusal reaches the journal; input-schema failures return before middleware and change
 * nothing. Each schema's JSON Schema is written beside it, so nothing converts one at run time, and
 * `literals.test.ts` holds the two equal.
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
import { createViewStateCommands } from '@lushly-dev/afd-view-state/commands';
import type { IdentityV1 } from '@lushly-dev/loam-manifest';
import * as z from 'zod/mini';
import {
	APPEARANCE_DENSITIES,
	APPEARANCE_THEMES,
	APPEARANCE_VIEW_STATE_ID,
	type AppearanceStateV0,
	type AppearanceV0,
	validateAppearancePatch,
} from '../appearance.js';
import type { AppsRuntime } from '../apps-runtime.js';
import {
	callScope,
	EMPTY_INPUT_JSON,
	emptyInput,
	takesProject,
	withResolved,
} from '../boot-commands.js';
import { PALETTE_SEARCH_LIMIT } from '../commands.js';
import { NEW_RECENT_ID, newRecentId } from '../documents/new-list.js';
import type { DocumentRows } from '../documents/palette-documents.js';
import { kernelFailure } from '../errors.js';
import {
	isLayoutId,
	LAYOUT_VIEW_STATE_ID,
	type LayoutPart,
	type LayoutPatchV0,
	type LayoutStateV0,
	layoutAsPatch,
	layoutUndoPatch,
	undeclaredOpening,
	validateLayoutPatch,
	validateLayoutState,
} from '../layout.js';
import type { OverlayStore } from '../overlays/store.js';
import type { SettingRows } from '../palette-index.js';
import { createPaletteIndex, type PaletteIndex, type PaletteItem } from '../palette-index.js';
import { personOf } from '../scope/access.js';
import type { ScopeRuntime } from '../scope/runtime.js';
import { APPS_VIEW_STATE_ID, SCOPE_VIEW_STATE_ID, type ShellState } from '../shell-state.js';
import type { CommandSummary, KernelEnvironment, KernelOptions, ShellInfo } from '../types.js';

export type { SettingRows };

/**
 * Each result's rank group (phase 4 specification, 7.1; A-P0-1): 0 for the active app's commands, 1 for the active tab
 * owner's, 2 for the rest. Kept beside the item, never on it, so the persona's order (phase 3's 6.2) ranks after it.
 */
const GROUPS = new WeakMap<object, number>();
export const paletteGroupOf = (item: object): number => GROUPS.get(item) ?? 2;

/** Runnable from the palette's interface, never offered in its picker (phase 5 specification, 9.2 and 9.3). */
const PICKER_HIDDEN: ReadonlySet<string> = new Set(['event-list', 'shell-open']);

/** The kinds `palette-search { kind }` filters by (3.10). */
const PALETTE_KINDS = ['command', 'document', 'setting'] as const;
/** On a tie of score: a command, then a document, then a setting (documents specification, 8.2), then by name. */
const KIND_RANK: Readonly<Record<string, number>> = { command: 0, document: 1, setting: 2 };

export interface ShellCommandDeps {
	viewState: ViewStateRegistry;
	state: ShellState;
	environment: KernelEnvironment;
	host: KernelOptions['host'];
	storeKind: KernelOptions['storeKind'];
	/** The deployment's identity, which `shell-info-get` reports (phase 3 specification, 12). */
	identity?: IdentityV1;
	/** Whether stage B applied a desktop projection: `shell-info-get`'s host (phase 6 specification, 10.1). */
	desktop?(): boolean;
	overlays: OverlayStore;
	/** The palette registry's commands, and a number that changes when they do. */
	paletteRows(): CommandSummary[];
	/**
	 * The only commands the palette may list now, or undefined for all: a signed-out `provider` page's (phase 3
	 * specification, 2.1). Applied before the search ranks, so every one of them can be found (step 6's review, I4).
	 */
	paletteOnly?(): ReadonlySet<string> | undefined;
	commandSet(): number;
	scope: ScopeRuntime;
	apps(): AppsRuntime;
	/** The editor owner, whose commands the palette shows as an active app's (documents specification, 5.4). */
	editorOwner?(): Promise<string | null>;
	/** The instance commands of the types `instance` declares, which the palette lists first for it (5.4). */
	instanceCommands?(instance: string): ReadonlySet<string>;
	/** The palette's document rows, filtered for the actor at query time (8.2). */
	documentRows?: DocumentRows;
	/** The palette's setting rows, from `late-settings`, filtered for the call at query time (phase 4 specification, 3.10). */
	settingRows?(): SettingRows | undefined;
	/** An app's title as its owner line shows it (phase 4's 6.6), which a command row names (A-P0-1). */
	appTitle?(instance: string): string;
	/**
	 * The appearance's write from phase 4's step 1 (phase 4 specification, 3.6): the person's own `loam.appearance`
	 * settings, or `.last` signed out in `provider` mode. `appearance-set` and the `loam.appearance` alias write here.
	 */
	writeAppearance?(patch: Partial<AppearanceStateV0>, context: CommandContext): Promise<void>;
}

/** The project a view-state id holds after `@`, as `loam.layout.hello@prj_atlas` does (3.4). */
const projectOfId = (id: string): string | undefined => {
	const at = id.lastIndexOf('@');
	return at < 0 ? undefined : id.slice(at + 1);
};

/**
 * Whether the call's actor may read the record `id`: one holding `@<project>` is that project's, and the
 * alias `loam.layout` is the call's scope's record, so it is that scope's (3.4). Decided before the alias
 * is resolved, which would register the record.
 */
const mayRead = (id: string, context: CommandContext, deps: ShellCommandDeps): boolean => {
	// A person's recents are theirs alone (documents specification, 7), as `newRecentId` names them.
	if (id.startsWith(`${NEW_RECENT_ID}~`)) return id === newRecentId(personOf(context));
	const project = id === LAYOUT_VIEW_STATE_ID ? callScope(context).project : projectOfId(id);
	return (
		project === undefined ||
		deps.scope.allows(context.actor, { workspace: deps.scope.workspace.id, project })
	);
};

/** The answer for an id that was never registered, which a refused one gives too (3.4). */
const unregistered = (id: string) =>
	failure({
		code: 'VIEW_STATE_NOT_FOUND',
		message: `View state "${id}" is not registered`,
		suggestion: 'Use view-state-list to see all registered view states',
	});

const PIXELS = 'In CSS pixels; the handler checks the range';
const pixels = () => z.optional(z.number()).check(z.describe(PIXELS));

const widthPart = () =>
	z.optional(z.strictObject({ open: z.optional(z.boolean()), width: pixels() }));

const layoutPatchInput = z.strictObject({
	sidebar: widthPart(),
	inspector: widthPart(),
	panel: z.optional(
		z.strictObject({
			open: z.optional(z.boolean()),
			height: pixels(),
			maximized: z.optional(z.boolean()),
		})
	),
	compact: z.optional(
		z.strictObject({
			drawer: z.optional(z.nullable(z.enum(['sidebar', 'inspector']))),
			sheet: z.optional(z.boolean()),
		})
	),
});

const PIXELS_JSON: JsonSchema = { description: PIXELS, type: 'number' };
const WIDTH_PART_JSON: JsonSchema = {
	type: 'object',
	properties: { open: { type: 'boolean' }, width: PIXELS_JSON },
	additionalProperties: false,
};
const LAYOUT_PATCH_JSON: JsonSchema = {
	type: 'object',
	properties: {
		sidebar: WIDTH_PART_JSON,
		inspector: WIDTH_PART_JSON,
		panel: {
			type: 'object',
			properties: {
				open: { type: 'boolean' },
				height: PIXELS_JSON,
				maximized: { type: 'boolean' },
			},
			additionalProperties: false,
		},
		compact: {
			type: 'object',
			properties: {
				drawer: {
					anyOf: [{ type: 'string', enum: ['sidebar', 'inspector'] }, { type: 'null' }],
				} as JsonSchema,
				sheet: { type: 'boolean' },
			},
			additionalProperties: false,
		},
	},
	additionalProperties: false,
};

const appearanceInput = z.strictObject({
	theme: z.optional(z.enum(APPEARANCE_THEMES)),
	density: z.optional(z.enum(APPEARANCE_DENSITIES)),
});

/** The refusal for a layout write that would open a part the app did not declare (4.5). */
function partUndeclared(part: LayoutPart) {
	return kernelFailure(
		'LAYOUT_PART_UNDECLARED',
		`The active app does not declare the ${part}, so it cannot open`,
		`Declare \`ui.surfaces.${part}\` in the app's manifest, or leave the part closed; its size may still be set`,
		{ details: { part, key: `ui.surfaces.${part}` } }
	);
}

/**
 * `loam.layout` means the active owner's record at the call's scope; a real id means itself (4.5; phase
 * 2 specification, 3.4).
 */
async function layoutRecordId(
	id: string,
	context: CommandContext,
	deps: ShellCommandDeps
): Promise<string> {
	return id === LAYOUT_VIEW_STATE_ID ? scopedLayout(context, deps) : id;
}

/** The record `layout-*` reads and writes: `context.scope`'s, not the active scope's (3.4). */
const scopedLayout = (context: CommandContext, deps: ShellCommandDeps): Promise<string> =>
	deps.state.scopedLayoutId(callScope(context).project, takesProject(deps.apps));

/**
 * `view-state-get` reading `loam.layout` from the active owner's record, and answering under the id
 * it was asked for, so it still equals `layout-get`.
 */
function routeViewStateGet(
	command: ZodCommandDefinition,
	deps: ShellCommandDeps
): ZodCommandDefinition {
	const original = command.handler;
	return {
		...command,
		async handler(input, context) {
			const { id } = input as { id: string };
			if (!mayRead(id, context, deps)) return unregistered(id);
			const result = await original({ id: await layoutRecordId(id, context, deps) }, context);
			return result.success ? { ...result, data: { ...(result.data as object), id } } : result;
		},
	};
}

/**
 * `view-state-set` checking layout records and `loam.appearance` through the shared validators
 * before it runs, so a refusal is a `VALIDATION_ERROR` result (journaled) rather than a throw from
 * the handler, and writing `loam.layout` to the active owner's record, since the registry persists
 * under the id it is given. The handlers check again, for callers of the registry itself.
 */
function guardViewStateSet(
	command: ZodCommandDefinition,
	deps: ShellCommandDeps
): ZodCommandDefinition {
	const original = command.handler;
	return {
		...command,
		async handler(input, context) {
			const { id, state, replace } = input as {
				id: string;
				state: Record<string, unknown>;
				replace?: boolean;
			};
			// `loam.editor` and `loam.editor@<project>`, whose state is the `late-editor` chunk's, by their name here so
			// `late` imports nothing of that chunk.
			if (
				id === APPS_VIEW_STATE_ID ||
				id === SCOPE_VIEW_STATE_ID ||
				id.startsWith(`${NEW_RECENT_ID}~`) ||
				/^loam\.editor(@|$)/.test(id)
			) {
				return kernelFailure(
					'VIEW_STATE_READ_ONLY',
					`'${id}' cannot be written through view-state-set`,
					id === SCOPE_VIEW_STATE_ID
						? 'Use scope-set, which also applies the switch rules'
						: id === APPS_VIEW_STATE_ID
							? 'Use app-open or app-close, which also apply the overlay and surface rules'
							: id.startsWith(NEW_RECENT_ID)
								? 'Use document-create with recent: true'
								: 'Use document-open and the editor-* commands, which keep its rules'
				);
			}
			if (!mayRead(id, context, deps)) return unregistered(id);
			const recordId = await layoutRecordId(id, context, deps);
			if (isLayoutId(recordId)) {
				// A project's record read on first use is read before this writes it, as `layout-*` waits (7.6).
				await deps.state.whenRead(recordId);
				const current = deps.state.layoutOf(recordId);
				if (current) {
					const checked = replace
						? validateLayoutState(state)
						: validateLayoutPatch(current, state);
					if (!checked.valid) return failure(checked.error);
					const undeclared = undeclaredOpening(state, deps.state.declaredParts(recordId));
					if (undeclared) return partUndeclared(undeclared);
				}
			} else if (id === APPEARANCE_VIEW_STATE_ID) {
				const previous = deps.state.appearance();
				const checked = validateAppearancePatch(previous, state, replace === true);
				if (!checked.valid) return failure(checked.error);
				// An alias of the person's two appearance keys (phase 4 specification, 3.6): written as `appearance-set`
				// writes them, never to the old record, and answered as the registry answers.
				if (deps.writeAppearance) {
					// A merge writes the keys it names; a replacement both.
					const written = replace
						? checked.state
						: (Object.fromEntries(
								Object.keys(state)
									.filter((key) => state[key] !== undefined)
									.map((key) => [key, checked.state[key as keyof AppearanceStateV0]])
							) as Partial<AppearanceStateV0>);
					await deps.writeAppearance(written, context);
					return success(
						{ id, state: { ...deps.state.appearance() }, previous: { ...previous } },
						{
							reasoning: `Updated view state for "${id}"`,
							confidence: 1.0,
							undoCommand: 'view-state-set',
							undoArgs: { id, state: { ...previous }, replace: true },
						}
					);
				}
			}
			const result = await original({ ...(input as object), id: recordId }, context);
			return result.success ? { ...result, data: { ...(result.data as object), id } } : result;
		},
	};
}

/** The shell's commands, before exposure is set and names are checked. */
export function createShellCommands(deps: ShellCommandDeps): ZodCommandDefinition[] {
	const { viewState, state, environment } = deps;
	const [viewStateGet, viewStateSet, viewStateList] = createViewStateCommands(viewState);

	let index:
		| {
				commandSet: number;
				only: ReadonlySet<string> | undefined;
				/** The listed commands' names, as the index was built from them. */
				listed: string;
				index: PaletteIndex;
				/** Each listed command's instance, none for the shell's own. */
				instances: ReadonlyMap<string, string | undefined>;
		  }
		| undefined;
	const search = async (
		query: string,
		limit: number,
		context: CommandContext,
		kind?: (typeof PALETTE_KINDS)[number]
	): Promise<PaletteItem[]> => {
		const only = deps.paletteOnly?.();
		// Rows of each kind the filter keeps (phase 4 specification, 3.10). A signed-out `provider` page lists only its
		// commands (phase 3 specification, 2.1).
		const settingRows =
			only === undefined && (kind === undefined || kind === 'setting')
				? ((await deps.settingRows?.()?.search(query, context, limit)) ?? [])
				: [];
		if (kind === 'setting') return settingRows;
		const documentRows =
			only === undefined && (kind === undefined || kind === 'document')
				? ((await deps.documentRows?.search(query, context.actor, limit)) ?? [])
				: [];
		if (kind === 'document') return documentRows;
		// Every app's commands that can open in this scope and are loaded (`paletteRows` leaves out the rest), ranked by the
		// active app, then the active tab's owner, then the rest (phase 4 specification, 7.1; A-P0-1); each names its app.
		const app = state.activeApp();
		const owner = app === null ? ((await deps.editorOwner?.()) ?? null) : null;
		const commandSet = deps.commandSet();
		// Built again when the rows themselves change, not only the commands: a change of scope or of an app's
		// availability hides or shows an app's commands (the trust review's blocker 10).
		const shown = deps
			.paletteRows()
			.filter(
				(command) =>
					(only === undefined || only.has(command.name)) && !PICKER_HIDDEN.has(command.name)
			);
		const listed = shown.map((command) => command.name).join(' ');
		if (index?.commandSet !== commandSet || index.only !== only || index.listed !== listed) {
			index = {
				commandSet,
				only,
				listed,
				index: createPaletteIndex(shown),
				instances: new Map(shown.map((command) => [command.name, command.instance])),
			};
		}
		const { instances } = index;
		// Every match, so the rank groups apply before the limit does.
		const commands = index.index.search(query, Math.max(limit, index.index.size)).map((item) => {
			const instance = instances.get(item.name);
			const row =
				instance === undefined ? item : { ...item, app: deps.appTitle?.(instance) ?? instance };
			GROUPS.set(
				row,
				instance === undefined ? 2 : instance === app ? 0 : instance === owner ? 1 : 2
			);
			return row;
		});
		// An app's setting ranks with its app's commands (A-P0-1): the active app's own setting is the active app's.
		for (const row of settingRows) {
			const instance = deps.settingRows?.()?.ownerOf?.(row.section as string);
			if (instance !== undefined)
				GROUPS.set(row, instance === app ? 0 : instance === owner ? 1 : 2);
		}
		// By rank group, then score, then a command, a document and a setting on a tie (8.2), then by name, so a result is
		// deterministic (phase 4 specification, 3.10); the editor owner's document's instance commands first of all (5.4).
		const first = owner !== null ? deps.instanceCommands?.(owner) : undefined;
		const items = [...commands, ...documentRows, ...settingRows]
			.sort(
				(a, b) =>
					Number(first?.has(b.name)) - Number(first?.has(a.name)) ||
					paletteGroupOf(a) - paletteGroupOf(b) ||
					b.score - a.score ||
					(KIND_RANK[a.kind ?? 'command'] as number) - (KIND_RANK[b.kind ?? 'command'] as number) ||
					(a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
			)
			.slice(0, limit);
		return items;
	};

	const layoutSet = defineCommandWithSchema<typeof layoutPatchInput, LayoutStateV0>({
		name: 'layout-set',
		title: 'Set layout',
		description: 'Open, close or resize shell parts; sizes are checked against the layout bounds',
		category: 'layout',
		mutation: true,
		undoable: true,
		executionTime: 'instant',
		input: layoutPatchInput,
		jsonSchema: LAYOUT_PATCH_JSON,
		async handler(input, context) {
			const id = await scopedLayout(context, deps);
			const previous = state.layoutOf(id) as LayoutStateV0;
			const patch = input as LayoutPatchV0;
			const checked = validateLayoutPatch(previous, patch);
			if (!checked.valid) return failure(checked.error);
			const undeclared = undeclaredOpening(patch, state.declaredParts(id));
			if (undeclared) return partUndeclared(undeclared);
			viewState.set(id, patch as Record<string, unknown>);
			return success(state.layoutOf(id) as LayoutStateV0, {
				undoCommand: 'layout-set',
				undoArgs: layoutUndoPatch(previous, patch) as Record<string, unknown>,
			});
		},
	});

	const layoutReset = defineCommandWithSchema<typeof emptyInput, LayoutStateV0>({
		name: 'layout-reset',
		title: 'Reset layout',
		description: "Restore the active app's first layout, or the default with no app active",
		category: 'layout',
		mutation: true,
		undoable: true,
		executionTime: 'instant',
		input: emptyInput,
		jsonSchema: EMPTY_INPUT_JSON,
		async handler(_input, context) {
			const id = await scopedLayout(context, deps);
			const previous = state.layoutOf(id) as LayoutStateV0;
			viewState.replace(id, state.layoutInitial() as unknown as Record<string, unknown>);
			return success(state.layoutOf(id) as LayoutStateV0, {
				undoCommand: 'layout-set',
				undoArgs: layoutAsPatch(previous) as Record<string, unknown>,
			});
		},
	});

	const appearanceSet = defineCommandWithSchema<typeof appearanceInput, AppearanceV0>({
		name: 'appearance-set',
		title: 'Set appearance',
		description: 'Set the theme (system, light, dark or high contrast) and the density',
		category: 'appearance',
		mutation: true,
		undoable: true,
		executionTime: 'instant',
		input: appearanceInput,
		jsonSchema: {
			type: 'object',
			properties: {
				theme: { type: 'string', enum: [...APPEARANCE_THEMES] },
				density: { type: 'string', enum: [...APPEARANCE_DENSITIES] },
			},
			additionalProperties: false,
		},
		async handler(input, context) {
			const previous = state.appearance();
			const checked = validateAppearancePatch(previous, input);
			if (!checked.valid) return failure(checked.error);
			// The person's own `loam.appearance` keys from phase 4's step 1 (phase 4 specification, 3.6).
			if (deps.writeAppearance) {
				await deps.writeAppearance(
					Object.fromEntries(
						Object.entries(input).filter(([, value]) => value !== undefined)
					) as Partial<AppearanceStateV0>,
					context
				);
			} else viewState.set(APPEARANCE_VIEW_STATE_ID, input as Record<string, unknown>);
			const undoArgs = Object.fromEntries(
				Object.keys(input).map((key) => [key, previous[key as keyof AppearanceStateV0]])
			);
			return success(withResolved(state.appearance(), environment), {
				undoCommand: 'appearance-set',
				undoArgs,
			});
		},
	});

	const paletteOpenInput = z.strictObject({ query: z.optional(z.string()) });
	const paletteOpen = defineCommandWithSchema<typeof paletteOpenInput, { open: true }>({
		name: 'palette-open',
		title: 'Open the command palette',
		description: 'Open the command palette, optionally with a query',
		category: 'palette',
		mutation: false,
		executionTime: 'instant',
		input: paletteOpenInput,
		jsonSchema: {
			type: 'object',
			properties: { query: { type: 'string' } },
			additionalProperties: false,
		},
		async handler() {
			if (deps.overlays.modalOpen()) {
				return kernelFailure(
					'OVERLAY_MODAL_BUSY',
					'A modal or a prompt is open, so the palette cannot open',
					'Close the modal first',
					{ retryable: true }
				);
			}
			return success({ open: true as const });
		},
	});

	const paletteClose = defineCommandWithSchema<typeof emptyInput, { open: false }>({
		name: 'palette-close',
		title: 'Close the command palette',
		description: 'Close the command palette',
		category: 'palette',
		mutation: false,
		executionTime: 'instant',
		input: emptyInput,
		jsonSchema: EMPTY_INPUT_JSON,
		async handler() {
			return success({ open: false as const });
		},
	});

	const paletteSearchInput = z.strictObject({
		query: z.string(),
		limit: z.optional(z.number().check(z.int(), z.minimum(1), z.maximum(PALETTE_SEARCH_LIMIT.max))),
		kind: z.optional(z.enum(PALETTE_KINDS)),
	});
	const paletteSearch = defineCommandWithSchema<
		typeof paletteSearchInput,
		{ items: PaletteItem[] }
	>({
		name: 'palette-search',
		description:
			'Search what the palette can run or open: commands, documents and settings, by name, title and description. Name a kind to search one',
		category: 'palette',
		mutation: false,
		executionTime: 'instant',
		input: paletteSearchInput,
		jsonSchema: {
			type: 'object',
			properties: {
				query: { type: 'string' },
				limit: { type: 'integer', minimum: 1, maximum: PALETTE_SEARCH_LIMIT.max },
				kind: { type: 'string', enum: [...PALETTE_KINDS] },
			},
			required: ['query'],
			additionalProperties: false,
		},
		async handler(input, context) {
			return success({
				items: await search(
					input.query,
					input.limit ?? PALETTE_SEARCH_LIMIT.default,
					context,
					input.kind
				),
			});
		},
	});

	const shellInfoGet = defineCommandWithSchema<typeof emptyInput, ShellInfo>({
		name: 'shell-info-get',
		description: 'Get the shell interface versions, the host and the store backend',
		category: 'shell',
		mutation: false,
		executionTime: 'instant',
		input: emptyInput,
		jsonSchema: EMPTY_INPUT_JSON,
		async handler() {
			return success({
				kernelInterface: 6 as const,
				layoutState: 0 as const,
				storeInterface: 1 as const,
				tokenContract: 1 as const,
				manifestVersion: 3 as const,
				appProtocol: 1 as const,
				surfaceCatalog: 1 as const,
				compositionLibrary: 1 as const,
				sdk: 1 as const,
				host: deps.desktop?.() ? 'desktop' : deps.host,
				store: deps.storeKind,
				identity: {
					mode: deps.identity?.mode ?? 'local',
					organization: deps.identity?.organization ?? null,
				},
			});
		},
	});

	const list = viewStateList as unknown as ZodCommandDefinition;
	return [
		routeViewStateGet(viewStateGet as unknown as ZodCommandDefinition, deps),
		guardViewStateSet(viewStateSet as unknown as ZodCommandDefinition, deps),
		{
			...list,
			// A record of a project the actor may not enter is left out (3.4).
			async handler(input: unknown, context: CommandContext) {
				const result = (await list.handler(input, context)) as CommandResult<{
					states: Array<{ id: string }>;
				}>;
				if (!result.success || !result.data) return result;
				const states = result.data.states.filter(({ id }) => mayRead(id, context, deps));
				return { ...result, data: { states, total: states.length } };
			},
		},
		layoutSet,
		layoutReset,
		appearanceSet,
		paletteOpen,
		paletteClose,
		paletteSearch,
		shellInfoGet,
	] as unknown as ZodCommandDefinition[];
}

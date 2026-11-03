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

import {
	defineCommandWithSchema,
	failure,
	type JsonSchema,
	success,
	type ZodCommandDefinition,
} from '@lushly-dev/afd-server/define';
import type { ViewStateRegistry } from '@lushly-dev/afd-view-state';
import { createViewStateCommands } from '@lushly-dev/afd-view-state/commands';
import * as z from 'zod/mini';
import {
	APPEARANCE_DENSITIES,
	APPEARANCE_THEMES,
	APPEARANCE_VIEW_STATE_ID,
	type AppearanceStateV0,
	type AppearanceV0,
	validateAppearancePatch,
} from '../appearance.js';
import { EMPTY_INPUT_JSON, emptyInput, withResolved } from '../boot-commands.js';
import { PALETTE_SEARCH_LIMIT } from '../commands.js';
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
import type { OverlayStore } from '../overlays.js';
import { createPaletteIndex, type PaletteIndex, type PaletteItem } from '../palette-index.js';
import { APPS_VIEW_STATE_ID, type ShellState } from '../shell-state.js';
import type {
	CommandSummaryV1,
	KernelEnvironmentV0,
	KernelOptionsV0,
	ShellInfoV2,
} from '../types.js';

export interface ShellCommandDeps {
	viewState: ViewStateRegistry;
	state: ShellState;
	environment: KernelEnvironmentV0;
	host: KernelOptionsV0['host'];
	storeKind: KernelOptionsV0['storeKind'];
	overlays: OverlayStore;
	/** The palette registry's commands, and a number that changes when they do. */
	paletteRows(): CommandSummaryV1[];
	commandSet(): number;
}

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

/** `loam.layout` means the active owner's record; a real id means itself (4.5). */
function layoutRecordId(id: string, deps: ShellCommandDeps): string {
	return id === LAYOUT_VIEW_STATE_ID ? deps.state.layoutId() : id;
}

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
			const result = await original({ id: layoutRecordId(id, deps) }, context);
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
			if (id === APPS_VIEW_STATE_ID) {
				return kernelFailure(
					'VIEW_STATE_READ_ONLY',
					`'${APPS_VIEW_STATE_ID}' cannot be written through view-state-set`,
					'Use app-open or app-close, which also apply the overlay and surface rules'
				);
			}
			const recordId = layoutRecordId(id, deps);
			if (isLayoutId(recordId)) {
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
				const checked = validateAppearancePatch(deps.state.appearance(), state, replace === true);
				if (!checked.valid) return failure(checked.error);
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

	let index: { active: string | null; commandSet: number; index: PaletteIndex } | undefined;
	const search = (query: string, limit: number): PaletteItem[] => {
		// Shell commands and the active app's: an inactive app's stay callable by name (9.1).
		const active = state.activeApp();
		const commandSet = deps.commandSet();
		if (index?.active !== active || index.commandSet !== commandSet) {
			const shown = deps
				.paletteRows()
				.filter((command) => command.instance === undefined || command.instance === active);
			index = { active, commandSet, index: createPaletteIndex(shown) };
		}
		return index.index.search(query, limit);
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
		async handler(input) {
			const previous = state.layout();
			const patch = input as LayoutPatchV0;
			const checked = validateLayoutPatch(previous, patch);
			if (!checked.valid) return failure(checked.error);
			const id = state.layoutId();
			const undeclared = undeclaredOpening(patch, state.declaredParts(id));
			if (undeclared) return partUndeclared(undeclared);
			viewState.set(id, patch as Record<string, unknown>);
			return success(state.layout(), {
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
		async handler() {
			const previous = state.layout();
			viewState.replace(
				state.layoutId(),
				state.layoutInitial() as unknown as Record<string, unknown>
			);
			return success(state.layout(), {
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
		async handler(input) {
			const previous = state.appearance();
			const checked = validateAppearancePatch(previous, input);
			if (!checked.valid) return failure(checked.error);
			viewState.set(APPEARANCE_VIEW_STATE_ID, input as Record<string, unknown>);
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
					'A modal is open, so the palette cannot open',
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
	});
	const paletteSearch = defineCommandWithSchema<
		typeof paletteSearchInput,
		{ items: PaletteItem[] }
	>({
		name: 'palette-search',
		description: 'Search the commands the palette can run, by name, title and description',
		category: 'palette',
		mutation: false,
		executionTime: 'instant',
		input: paletteSearchInput,
		jsonSchema: {
			type: 'object',
			properties: {
				query: { type: 'string' },
				limit: { type: 'integer', minimum: 1, maximum: PALETTE_SEARCH_LIMIT.max },
			},
			required: ['query'],
			additionalProperties: false,
		},
		async handler(input) {
			return success({
				items: search(input.query, input.limit ?? PALETTE_SEARCH_LIMIT.default),
			});
		},
	});

	const shellInfoGet = defineCommandWithSchema<typeof emptyInput, ShellInfoV2>({
		name: 'shell-info-get',
		description: 'Get the shell interface versions, the host and the store backend',
		category: 'shell',
		mutation: false,
		executionTime: 'instant',
		input: emptyInput,
		jsonSchema: EMPTY_INPUT_JSON,
		async handler() {
			return success({
				kernelInterface: 2 as const,
				layoutState: 0 as const,
				storeInterface: 0 as const,
				tokenContract: 1 as const,
				manifestVersion: 2 as const,
				appProtocol: 1 as const,
				surfaceCatalog: 1 as const,
				compositionLibrary: 1 as const,
				sdk: 1 as const,
				host: deps.host,
				store: deps.storeKind,
			});
		},
	});

	return [
		routeViewStateGet(viewStateGet as unknown as ZodCommandDefinition, deps),
		guardViewStateSet(viewStateSet as unknown as ZodCommandDefinition, deps),
		viewStateList as unknown as ZodCommandDefinition,
		layoutSet,
		layoutReset,
		appearanceSet,
		paletteOpen,
		paletteClose,
		paletteSearch,
		shellInfoGet,
	] as unknown as ZodCommandDefinition[];
}

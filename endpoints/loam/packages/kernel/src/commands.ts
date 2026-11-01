/**
 * @fileoverview The shell's phase 0 commands (phase 0 specification, 6.3).
 *
 * Range checks run in the handlers through the shared validators, never in the input schemas,
 * so a refusal reaches the journal; input-schema failures return before middleware and change
 * nothing.
 */

import type { AuthAdapter } from '@lushly-dev/afd-auth';
import { createAuthCommands } from '@lushly-dev/afd-auth/commands';
import {
	defineCommand,
	type ExposeOptions,
	failure,
	success,
	type ZodCommandDefinition,
} from '@lushly-dev/afd-server/define';
import type { ViewStateRegistry } from '@lushly-dev/afd-view-state';
import { createViewStateCommands } from '@lushly-dev/afd-view-state/commands';
import { z } from 'zod';
import {
	APPEARANCE_DENSITIES,
	APPEARANCE_THEMES,
	APPEARANCE_VIEW_STATE_ID,
	type AppearanceStateV0,
	type AppearanceV0,
	resolveTheme,
	validateAppearancePatch,
} from './appearance.js';
import {
	createDefaultLayout,
	LAYOUT_VIEW_STATE_ID,
	type LayoutPatchV0,
	type LayoutStateV0,
	layoutAsPatch,
	layoutUndoPatch,
	validateLayoutPatch,
	validateLayoutState,
} from './layout.js';
import type { PaletteItem } from './palette-index.js';
import type { ShellState } from './shell-state.js';
import type { KernelEnvironmentV0, KernelOptionsV0, ShellInfoV0 } from './types.js';

/** Every shell command's exposure in phase 0: no CLI or MCP surface until phase 6. */
export const SHELL_EXPOSE: Readonly<Required<ExposeOptions>> = Object.freeze({
	palette: true,
	agent: true,
	mcp: false,
	cli: false,
});

/** The shell's phase 0 command names, in registration order. */
export const SHELL_COMMAND_NAMES = [
	'view-state-get',
	'view-state-set',
	'view-state-list',
	'layout-get',
	'layout-set',
	'layout-reset',
	'appearance-get',
	'appearance-set',
	'palette-open',
	'palette-close',
	'palette-search',
	'auth-sign-in',
	'auth-sign-out',
	'auth-session-get',
	'shell-info-get',
] as const;

/** Most results `palette-search` returns, and its default. */
export const PALETTE_SEARCH_LIMIT = { max: 50, default: 20 } as const;

export interface ShellCommandDeps {
	viewState: ViewStateRegistry;
	state: ShellState;
	environment: KernelEnvironmentV0;
	auth: AuthAdapter;
	host: KernelOptionsV0['host'];
	storeKind: KernelOptionsV0['storeKind'];
	/** Searches the palette registry's commands; built once the registries exist. */
	search(query: string, limit: number): PaletteItem[];
}

const empty = z.strictObject({});

const sizePart = (size: 'width' | 'height') =>
	z.strictObject({
		open: z.boolean().optional(),
		[size]: z.number().optional().describe(`In CSS pixels; the handler checks the range`),
	});

const layoutPatchInput = z.strictObject({
	sidebar: sizePart('width').optional(),
	inspector: sizePart('width').optional(),
	panel: z
		.strictObject({
			open: z.boolean().optional(),
			height: z.number().optional().describe('In CSS pixels; the handler checks the range'),
			maximized: z.boolean().optional(),
		})
		.optional(),
	compact: z
		.strictObject({
			drawer: z.enum(['sidebar', 'inspector']).nullable().optional(),
			sheet: z.boolean().optional(),
		})
		.optional(),
});

const appearanceInput = z.strictObject({
	theme: z.enum(APPEARANCE_THEMES).optional(),
	density: z.enum(APPEARANCE_DENSITIES).optional(),
});

function withResolved(state: AppearanceStateV0, environment: KernelEnvironmentV0): AppearanceV0 {
	return { ...state, resolved: resolveTheme(state.theme, environment) };
}

/**
 * `view-state-set` checking `loam.layout` and `loam.appearance` through the shared validators
 * before it runs, so a refusal is a `VALIDATION_ERROR` result (journaled) rather than a throw from
 * the handler. The handlers check again, for callers of the registry itself.
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
			if (id === LAYOUT_VIEW_STATE_ID) {
				const checked = replace
					? validateLayoutState(state)
					: validateLayoutPatch(deps.state.layout(), state);
				if (!checked.valid) return failure(checked.error);
			} else if (id === APPEARANCE_VIEW_STATE_ID) {
				const checked = validateAppearancePatch(deps.state.appearance(), state, replace === true);
				if (!checked.valid) return failure(checked.error);
			}
			return original(input, context);
		},
	};
}

/** The shell's commands, before exposure is set and names are checked. */
export function createShellCommands(deps: ShellCommandDeps): ZodCommandDefinition[] {
	const { viewState, state, environment } = deps;
	const [viewStateGet, viewStateSet, viewStateList] = createViewStateCommands(viewState);

	const layoutGet = defineCommand<typeof empty, LayoutStateV0>({
		name: 'layout-get',
		description: 'Get the shell layout: which parts are open and their sizes',
		category: 'layout',
		mutation: false,
		executionTime: 'instant',
		input: empty,
		async handler() {
			return success(state.layout());
		},
	});

	const layoutSet = defineCommand<typeof layoutPatchInput, LayoutStateV0>({
		name: 'layout-set',
		title: 'Set layout',
		description: 'Open, close or resize shell parts; sizes are checked against the layout bounds',
		category: 'layout',
		mutation: true,
		undoable: true,
		executionTime: 'instant',
		input: layoutPatchInput,
		async handler(input) {
			const previous = state.layout();
			const patch = input as LayoutPatchV0;
			const checked = validateLayoutPatch(previous, patch);
			if (!checked.valid) return failure(checked.error);
			viewState.set(LAYOUT_VIEW_STATE_ID, patch as Record<string, unknown>);
			return success(state.layout(), {
				undoCommand: 'layout-set',
				undoArgs: layoutUndoPatch(previous, patch) as Record<string, unknown>,
			});
		},
	});

	const layoutReset = defineCommand<typeof empty, LayoutStateV0>({
		name: 'layout-reset',
		title: 'Reset layout',
		description: 'Restore the default layout: sidebar open, inspector and panel closed',
		category: 'layout',
		mutation: true,
		undoable: true,
		executionTime: 'instant',
		input: empty,
		async handler() {
			const previous = state.layout();
			viewState.replace(
				LAYOUT_VIEW_STATE_ID,
				createDefaultLayout() as unknown as Record<string, unknown>
			);
			return success(state.layout(), {
				undoCommand: 'layout-set',
				undoArgs: layoutAsPatch(previous) as Record<string, unknown>,
			});
		},
	});

	const appearanceGet = defineCommand<typeof empty, AppearanceV0>({
		name: 'appearance-get',
		description: 'Get the theme and density, and the theme the system setting resolves to',
		category: 'appearance',
		mutation: false,
		executionTime: 'instant',
		input: empty,
		async handler() {
			return success(withResolved(state.appearance(), environment));
		},
	});

	const appearanceSet = defineCommand<typeof appearanceInput, AppearanceV0>({
		name: 'appearance-set',
		title: 'Set appearance',
		description: 'Set the theme (system, light, dark or high contrast) and the density',
		category: 'appearance',
		mutation: true,
		undoable: true,
		executionTime: 'instant',
		input: appearanceInput,
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

	const paletteOpenInput = z.strictObject({ query: z.string().optional() });
	const paletteOpen = defineCommand<typeof paletteOpenInput, { open: true }>({
		name: 'palette-open',
		title: 'Open the command palette',
		description: 'Open the command palette, optionally with a query',
		category: 'palette',
		mutation: false,
		executionTime: 'instant',
		input: paletteOpenInput,
		async handler() {
			return success({ open: true as const });
		},
	});

	const paletteClose = defineCommand<typeof empty, { open: false }>({
		name: 'palette-close',
		title: 'Close the command palette',
		description: 'Close the command palette',
		category: 'palette',
		mutation: false,
		executionTime: 'instant',
		input: empty,
		async handler() {
			return success({ open: false as const });
		},
	});

	const paletteSearchInput = z.strictObject({
		query: z.string(),
		limit: z.number().int().min(1).max(PALETTE_SEARCH_LIMIT.max).optional(),
	});
	const paletteSearch = defineCommand<typeof paletteSearchInput, { items: PaletteItem[] }>({
		name: 'palette-search',
		description: 'Search the commands the palette can run, by name, title and description',
		category: 'palette',
		mutation: false,
		executionTime: 'instant',
		input: paletteSearchInput,
		async handler(input) {
			return success({
				items: deps.search(input.query, input.limit ?? PALETTE_SEARCH_LIMIT.default),
			});
		},
	});

	const shellInfoGet = defineCommand<typeof empty, ShellInfoV0>({
		name: 'shell-info-get',
		description: 'Get the shell interface versions, the host and the store backend',
		category: 'shell',
		mutation: false,
		executionTime: 'instant',
		input: empty,
		async handler() {
			return success({
				kernelInterface: 0 as const,
				layoutState: 0 as const,
				storeInterface: 0 as const,
				tokenContract: 1 as const,
				host: deps.host,
				store: deps.storeKind,
			});
		},
	});

	return [
		viewStateGet as unknown as ZodCommandDefinition,
		guardViewStateSet(viewStateSet as unknown as ZodCommandDefinition, deps),
		viewStateList as unknown as ZodCommandDefinition,
		layoutGet,
		layoutSet,
		layoutReset,
		appearanceGet,
		appearanceSet,
		paletteOpen,
		paletteClose,
		paletteSearch,
		...createAuthCommands(deps.auth),
		shellInfoGet,
	] as unknown as ZodCommandDefinition[];
}

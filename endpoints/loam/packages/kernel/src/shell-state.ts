/**
 * @fileoverview The view-state handlers on one `ViewStateRegistry` that both registries' commands
 * close over (phase 0 specification, 6.1): `loam.layout`, one `loam.layout.<instance>` per app
 * instance, `loam.appearance` and `loam.apps` (phase 1 specification, 4.5).
 *
 * Each handler's `set` and `replace` go through the shared validator, so a caller of the registry
 * or of `view-state-set` can bypass nothing. A refusal throws a {@link LoamKernelError}; the
 * guarded `view-state-set` checks first, so it returns the refusal as a result instead.
 */

import type { ViewStateHandler, ViewStateRegistry } from '@lushly-dev/afd-view-state';
import {
	APPEARANCE_VIEW_STATE_ID,
	type AppearanceStateV0,
	createDefaultAppearance,
	validateAppearancePatch,
} from './appearance.js';
import { LoamKernelError } from './errors.js';
import {
	appLayoutId,
	cloneLayout,
	createDefaultLayout,
	LAYOUT_VIEW_STATE_ID,
	type LayoutPart,
	type LayoutStateV0,
	validateLayoutPatch,
	validateLayoutState,
} from './layout.js';

/** The view-state id of the active app, which only `app-open` and `app-close` write. */
export const APPS_VIEW_STATE_ID = 'loam.apps';

export interface ShellState {
	/** The layout of the active owner: the active app's record, or the no-app record. */
	layout(): LayoutStateV0;
	/** The id of the active owner's layout record. */
	layoutId(): string;
	/** The layout record `id` holds, if it is one. */
	layoutOf(id: string): LayoutStateV0 | undefined;
	/** What `layout-reset` restores for the active owner. */
	layoutInitial(): LayoutStateV0;
	/** The parts the record `id` may open: all of them with no app. */
	declaredParts(id: string): ReadonlySet<LayoutPart>;
	/** Register an instance's record, before `hydrate`. */
	registerAppLayout(instance: string, initial: LayoutStateV0, declared: Set<LayoutPart>): void;
	activeApp(): string | null;
	setActiveApp(instance: string | null): void;
	appearance(): AppearanceStateV0;
	/** Load the persisted records. An invalid record is ignored and its defaults kept. */
	hydrate(): Promise<void>;
}

const ALL_PARTS: ReadonlySet<LayoutPart> = new Set<LayoutPart>(['sidebar', 'inspector', 'panel']);

interface LayoutRecord {
	state: LayoutStateV0;
	initial: LayoutStateV0;
	declared: ReadonlySet<LayoutPart>;
}

export function registerShellState(viewState: ViewStateRegistry): ShellState {
	const layouts = new Map<string, LayoutRecord>();
	let appearance = createDefaultAppearance();
	let active: string | null = null;
	let hydrating = false;

	const registerLayout = (id: string, record: LayoutRecord): void => {
		layouts.set(id, record);
		const handler: ViewStateHandler<LayoutStateV0 & Record<string, unknown>> = {
			get: () => cloneLayout(record.state) as LayoutStateV0 & Record<string, unknown>,
			set(partial) {
				const checked = validateLayoutPatch(record.state, partial);
				if (checked.valid) record.state = checked.state;
				else if (!hydrating) throw LoamKernelError.fromCommandError(checked.error);
			},
			replace(state) {
				const checked = validateLayoutState(state);
				if (!checked.valid) throw LoamKernelError.fromCommandError(checked.error);
				record.state = checked.state;
			},
		};
		viewState.register(id, handler as unknown as ViewStateHandler);
	};

	registerLayout(LAYOUT_VIEW_STATE_ID, {
		state: createDefaultLayout(),
		initial: createDefaultLayout(),
		declared: ALL_PARTS,
	});

	const appearanceHandler: ViewStateHandler<AppearanceStateV0 & Record<string, unknown>> = {
		get: () => ({ ...appearance }) as AppearanceStateV0 & Record<string, unknown>,
		set(partial) {
			const checked = validateAppearancePatch(appearance, partial);
			if (checked.valid) appearance = checked.state;
			else if (!hydrating) throw LoamKernelError.fromCommandError(checked.error);
		},
		replace(state) {
			const checked = validateAppearancePatch(appearance, state, true);
			if (!checked.valid) throw LoamKernelError.fromCommandError(checked.error);
			appearance = checked.state;
		},
	};

	const appsHandler: ViewStateHandler<{ active: string | null } & Record<string, unknown>> = {
		get: () => ({ active }),
		set(partial) {
			const next = (partial as { active?: unknown }).active;
			if (next === null || typeof next === 'string') active = next;
		},
	};

	viewState.register(APPEARANCE_VIEW_STATE_ID, appearanceHandler as unknown as ViewStateHandler);
	viewState.register(APPS_VIEW_STATE_ID, appsHandler as unknown as ViewStateHandler);

	const activeId = (): string =>
		active !== null && layouts.has(appLayoutId(active))
			? appLayoutId(active)
			: LAYOUT_VIEW_STATE_ID;
	const record = (id: string): LayoutRecord => layouts.get(id) as LayoutRecord;

	return {
		layout: () => cloneLayout(record(activeId()).state),
		layoutId: activeId,
		layoutOf(id) {
			const held = layouts.get(id);
			return held ? cloneLayout(held.state) : undefined;
		},
		layoutInitial: () => cloneLayout(record(activeId()).initial),
		declaredParts: (id) => layouts.get(id)?.declared ?? ALL_PARTS,
		registerAppLayout(instance, initial, declared) {
			registerLayout(appLayoutId(instance), {
				state: cloneLayout(initial),
				initial: cloneLayout(initial),
				declared,
			});
		},
		activeApp: () => active,
		setActiveApp(instance) {
			viewState.set(APPS_VIEW_STATE_ID, { active: instance });
		},
		appearance: () => ({ ...appearance }),
		async hydrate() {
			hydrating = true;
			try {
				await viewState.hydrate();
				// A persisted active app the deployment no longer lists is no active app.
				if (active !== null && !layouts.has(appLayoutId(active))) active = null;
			} finally {
				hydrating = false;
			}
		},
	};
}

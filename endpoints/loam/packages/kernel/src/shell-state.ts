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

/** The persisted active project, by id, which only `scope-set` writes (phase 2 specification, 6.3). */
export const SCOPE_VIEW_STATE_ID = 'loam.scope';

/**
 * The projects section's layout record, registered in stage A, declaring main alone (phase 2 specification,
 * 7.6 and 7.7). One loop over both sections, with a lookup by section, was measured at 30 to 50 bytes more
 * of first paint than step 7's allowance held (2.4).
 */
export const PROJECTS_LAYOUT_ID = 'loam.layout.~projects';

/**
 * The documents section's, registered beside it in stage A, declaring the sidebar, which holds its tree
 * (documents specification, 5.1 and 8.1). The inspector joins its declared parts with the first type that
 * has one, step 12's.
 */
export const DOCUMENTS_LAYOUT_ID = 'loam.layout.~documents';

/** What main shows: the active app, or a section, and its route (phase 2 specification, 4.3). */
export interface MainStateV2 {
	active: string | null;
	section: string | null;
	path: string;
}

export interface ShellState {
	/** The layout of the active owner: the active app's record, or the no-app record. */
	layout(): LayoutStateV0;
	/** The id of the active owner's layout record. */
	layoutId(): string;
	/** The layout record `id` holds, if it is one. */
	layoutOf(id: string): LayoutStateV0 | undefined;
	/**
	 * What `layout-reset` restores for the active owner, or for the record `id`: its first shape, which a change
	 * of person resets a record to before reading the next person's (phase 3 specification, 4.4).
	 */
	layoutInitial(id?: string): LayoutStateV0;
	/** The parts the record `id` may open: all of them with no app. */
	declaredParts(id: string): ReadonlySet<LayoutPart>;
	/**
	 * Register an instance's record. A second registration, as stage B's manifest after stage A's boot
	 * record, replaces its `initial` and `declared` and keeps what `hydrate` loaded (phase 2
	 * specification, 2.2). One registered after `hydrate` is read by {@link ShellState.hydrateLate}.
	 */
	registerAppLayout(instance: string, initial: LayoutStateV0, declared: Set<LayoutPart>): void;
	activeApp(): string | null;
	setActiveApp(instance: string | null): void;
	/** `loam.apps` whole: the active app, the section and the route. */
	main(): MainStateV2;
	/** The persisted active project's id (`loam.scope`). */
	scopeProject(): string | null;
	/**
	 * The layout record a call's scope reads (phase 2 specification, 3.4 and 7.6): the active app's, at
	 * `loam.layout.<instance>@<project>` when the app takes a project and the call has one, registered from
	 * the app's preset on first use and read from the store before anything writes it.
	 */
	scopedLayoutId(
		project: string | undefined,
		takesProject: (instance: string) => boolean
	): Promise<string>;
	appearance(): AppearanceStateV0;
	/** Resolves once a record registered on first use has been read, so no write lands before it (0b). */
	whenRead(id: string): Promise<void>;
	/** Load the persisted records. An invalid record is ignored and its defaults kept. */
	hydrate(): Promise<void>;
	/** Load each record registered since `hydrate`, one by one, as stage B's new instances. */
	hydrateLate(): Promise<void>;
	/** In memory, as `hydrate` does: an active app that stage B does not list is no active app. */
	forgetUnlisted(listed: ReadonlySet<string>): void;
}

const ALL_PARTS: ReadonlySet<LayoutPart> = new Set<LayoutPart>(['sidebar', 'inspector', 'panel']);

interface LayoutRecord {
	state: LayoutStateV0;
	initial: LayoutStateV0;
	declared: ReadonlySet<LayoutPart>;
	/** Written by `hydrate` or a command, so a later registration keeps it. */
	written?: boolean;
}

export function registerShellState(viewState: ViewStateRegistry): ShellState {
	const layouts = new Map<string, LayoutRecord>();
	let appearance = createDefaultAppearance();
	let active: string | null = null;
	/** Reads in progress, which may overlap: while any is, an invalid record is ignored. */
	let hydrating = 0;
	let hydrated = false;
	/** Records registered after `hydrate`, for `hydrateLate`. */
	const unread = new Set<string>();

	const registerLayout = (id: string, record: LayoutRecord): void => {
		layouts.set(id, record);
		const handler: ViewStateHandler<LayoutStateV0 & Record<string, unknown>> = {
			get: () => cloneLayout(record.state) as LayoutStateV0 & Record<string, unknown>,
			set(partial) {
				const checked = validateLayoutPatch(record.state, partial);
				if (checked.valid) {
					record.state = checked.state;
					record.written = true;
				} else if (!hydrating) throw LoamKernelError.fromCommandError(checked.error);
			},
			replace(state) {
				const checked = validateLayoutState(state);
				if (!checked.valid) throw LoamKernelError.fromCommandError(checked.error);
				record.state = checked.state;
				record.written = true;
			},
		};
		viewState.register(id, handler as unknown as ViewStateHandler);
	};

	registerLayout(LAYOUT_VIEW_STATE_ID, {
		state: createDefaultLayout(),
		initial: createDefaultLayout(),
		declared: ALL_PARTS,
	});
	// The projects section declares main alone, so its record has every other part closed (7.7). One object
	// for both: a write replaces `state`, and `initial` is read as a copy.
	const closed = createDefaultLayout();
	closed.sidebar.open = false;
	registerLayout(PROJECTS_LAYOUT_ID, { state: closed, initial: closed, declared: new Set() });
	const sidebar = createDefaultLayout();
	registerLayout(DOCUMENTS_LAYOUT_ID, {
		state: sidebar,
		initial: sidebar,
		declared: new Set(['sidebar']),
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

	let section: string | null = null;
	let path = '';
	const main = (): MainStateV2 => ({ active, section, path });
	// A persisted record with fewer keys reads their defaults.
	const appsHandler: ViewStateHandler<MainStateV2 & Record<string, unknown>> = {
		get: () => main() as MainStateV2 & Record<string, unknown>,
		set(partial) {
			const next = partial as Partial<Record<keyof MainStateV2, unknown>>;
			if (next.active === null || typeof next.active === 'string') active = next.active;
			if (next.section === null || typeof next.section === 'string') section = next.section;
			if (typeof next.path === 'string') path = next.path;
		},
	};
	let scopeProject: string | null = null;
	const scopeHandler: ViewStateHandler<{ project: string | null } & Record<string, unknown>> = {
		get: () => ({ project: scopeProject }),
		set(partial) {
			const next = (partial as { project?: unknown }).project;
			if (next === null || typeof next === 'string') scopeProject = next;
		},
	};
	/** Reads of records registered on first use, so no write lands before the read (step 0b's note). */
	const reading = new Map<string, Promise<void>>();
	/** One record from the store, an invalid one ignored as `hydrate` ignores it. */
	const readOne = async (id: string): Promise<void> => {
		hydrating++;
		try {
			await viewState.hydrateOne(id);
		} finally {
			hydrating--;
		}
	};

	viewState.register(APPEARANCE_VIEW_STATE_ID, appearanceHandler as unknown as ViewStateHandler);
	viewState.register(APPS_VIEW_STATE_ID, appsHandler as unknown as ViewStateHandler);
	viewState.register(SCOPE_VIEW_STATE_ID, scopeHandler as unknown as ViewStateHandler);

	const activeId = (): string =>
		active !== null && layouts.has(appLayoutId(active))
			? appLayoutId(active)
			: section === 'projects'
				? PROJECTS_LAYOUT_ID
				: section === 'documents'
					? DOCUMENTS_LAYOUT_ID
					: LAYOUT_VIEW_STATE_ID;
	const record = (id: string): LayoutRecord => layouts.get(id) as LayoutRecord;

	return {
		layout: () => cloneLayout(record(activeId()).state),
		layoutId: activeId,
		layoutOf(id) {
			const held = layouts.get(id);
			return held ? cloneLayout(held.state) : undefined;
		},
		layoutInitial: (id = activeId()) => cloneLayout(record(id).initial),
		declaredParts: (id) => layouts.get(id)?.declared ?? ALL_PARTS,
		registerAppLayout(instance, initial, declared) {
			const id = appLayoutId(instance);
			const held = layouts.get(id);
			if (held) {
				// The handler closes over this record, so it is replaced in place. What `hydrate` loaded, or a
				// command wrote, stays, and `reconcileLayouts` closes a part the new manifest dropped. A record
				// nothing wrote takes the new first shape. A project's record is `<instance>@<project>`, which
				// `apps/` corrects this way too (phase 2 specification, 2.2).
				held.initial = cloneLayout(initial);
				held.declared = declared;
				if (!held.written) held.state = cloneLayout(initial);
				return;
			}
			registerLayout(id, {
				state: cloneLayout(initial),
				initial: cloneLayout(initial),
				declared,
			});
			if (hydrated) unread.add(id);
		},
		activeApp: () => active,
		setActiveApp(instance) {
			viewState.set(APPS_VIEW_STATE_ID, { active: instance });
		},
		main,
		scopeProject: () => scopeProject,
		async scopedLayoutId(project, takesProject) {
			const base = activeId();
			if (project === undefined || active === null || !takesProject(active)) return base;
			const id = `${base}@${project}`;
			if (!layouts.has(id)) {
				const { initial, declared } = record(base);
				registerLayout(id, { state: cloneLayout(initial), initial, declared });
				// Silent on an invalid record, as `hydrate` is: its defaults are kept.
				reading.set(id, readOne(id));
			}
			await reading.get(id);
			return id;
		},
		appearance: () => ({ ...appearance }),
		whenRead: async (id) => reading.get(id),
		async hydrate() {
			hydrating++;
			try {
				await viewState.hydrate();
				// A persisted active app the deployment no longer lists is no active app.
				if (active !== null && !layouts.has(appLayoutId(active))) active = null;
			} finally {
				hydrating--;
				hydrated = true;
			}
		},
		async hydrateLate() {
			const ids = [...unread];
			unread.clear();
			for (const id of ids) await readOne(id);
		},
		forgetUnlisted(listed) {
			if (active !== null && !listed.has(active)) active = null;
		},
	};
}

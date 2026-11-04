/**
 * @fileoverview `@lushly-dev/loam-sdk`: the whole contract an app codes against (phase 1
 * specification, 5.2; D21, D68). Transports and the kernel do not appear in it. Sandboxed code uses
 * `/view`.
 */

import type { Actor, CommandResult } from '@lushly-dev/afd-core';

export type { Actor, CommandError, CommandResult } from '@lushly-dev/afd-core';
export { failure, success } from '@lushly-dev/afd-core/result';
export type { ManifestV1, ManifestV2 } from '@lushly-dev/loam-manifest';

export const SDK_VERSION = 1;

export function defineApp(definition: AppDefinitionV1): AppDefinitionV1 {
	return definition;
}

export interface AppDefinitionV1 {
	readonly sdk: 1;
	/** One per command in the manifest, by its full name. `never` so a handler may type its input. */
	handlers: Record<string, AppCommandHandlerV1<never>>;
	/** Runs once, before the first surface renders. Not for commands, which run without it. */
	activate?(context: AppContextV1): void | Promise<void>;
	deactivate?(): void | Promise<void>;
}

export type AppCommandHandlerV1<I = unknown, T = unknown> = (
	input: I,
	context: AppCallContextV1
) => Promise<CommandResult<T>>;

export interface AppCallContextV1 {
	readonly traceId: string;
	readonly actor?: Actor;
	/** Present with the `clock` grant; the same reading for the whole call in a view. */
	now?(): number;
	/** Present with the `random` grant. */
	random?(): number;
	/** Present with the `store` grant. */
	readonly store?: AppStoreV1;
	readonly config: Readonly<Record<string, unknown>>;
	/**
	 * Aborted when the caller gives up on the call, as a project summary's deadline does (phase 2
	 * specification, 7.7). Optional to an app: a handler that ignores it runs on, and its result is unused.
	 */
	readonly signal?: AbortSignal;
	/** For queries only: a nested mutation answers NESTED_MUTATION_REFUSED (5.3). */
	readonly client: LoamClientV1;
	/** The call's effective scope (phase 2 specification, 3.2). */
	readonly scope: ScopeV1;
	/** Present with the `projects` grant (phase 2 specification, 5). */
	readonly projects?: ProjectsV1;
}

/** Where a call runs: a workspace, and a project in it (phase 2 specification, 3.1). Ids, never names. */
export interface ScopeV1 {
	/** The workspace's id. */
	readonly workspace: string;
	/** A project's `id`, when the call runs in one. */
	readonly project?: string;
}

/**
 * {@link ProjectsV1} over a client that may call `project-list` and `project-get`, as the `projects`
 * grant lets it: what a view's handler frame gives a handler.
 */
export function projectsOver(client: LoamClientV1, active: string | undefined): ProjectsV1 {
	const get = async (ref: string): Promise<AppProjectV1 | null> => {
		const result = await client.call<AppProjectV1>('project-get', { project: ref });
		return result.success && result.data ? result.data : null;
	};
	return {
		active: () => (active === undefined ? Promise.resolve(null) : get(active)),
		async list() {
			const result = await client.call<{ projects: AppProjectV1[] }>('project-list', {});
			return result.success && result.data ? result.data.projects : [];
		},
		get,
	};
}

/**
 * A link to a resource (documents specification, 9.1): navigation, never execution, so it names no command.
 * An app gives one as data, as in a project summary, and it does nothing until a person follows it.
 */
export type ResourceLinkV1 =
	| { kind: 'document'; document: string; scope: ScopeV1; anchor?: unknown }
	| { kind: 'app'; instance: string; route?: string; scope: ScopeV1 };

/**
 * What an app's `ui.project_summary` command returns, for a project's home (phase 2 specification, 7.7).
 * Text, rendered as text. The shell drops what is over a bound.
 */
export interface ProjectSummaryV1 {
	/** At most 8; a label of 1 to 40 characters. */
	counts?: Array<{ label: string; value: number }>;
	/** At most 10; a title of 1 to 120 characters. */
	recent?: Array<{ title: string; updatedAt?: number; link?: ResourceLinkV1 }>;
	/** At most 6. */
	links?: Array<{ label: string; link: ResourceLinkV1 }>;
}

/** A project as an app sees it: no members, and no one who wrote it (phase 2 specification, 4.3). */
export interface AppProjectV1 {
	id: string;
	workspace: string;
	slug: string;
	name: string;
	icon: string;
	status: 'active' | 'archived';
	createdAt: number;
	updatedAt: number;
}

/** What the `projects` grant gives a handler: reads only, never a member (phase 2 specification, 5). */
export interface ProjectsV1 {
	/** The call's effective project, so `null` for a workspace-only app. */
	active(): Promise<AppProjectV1 | null>;
	list(): Promise<AppProjectV1[]>;
	/** By `id` or slug. */
	get(ref: string): Promise<AppProjectV1 | null>;
}

export interface AppContextV1 {
	readonly instance: string;
	readonly app: string;
	readonly version: string;
	readonly config: Readonly<Record<string, unknown>>;
	readonly client: LoamClientV1;
	/** The app's scoped registry: define the app's own elements here. Native only. */
	readonly registry: CustomElementRegistry;
	readonly kit: KitV1;
	readonly overlays: OverlaysV1;
	/**
	 * Moves this app's route, by `app-route-set`, so the URL follows (phase 2 specification, 11.3). Native
	 * only: a view calls `app-route-set` through its client.
	 */
	navigate?(route: string): Promise<void>;
}

export interface LoamClientV1 {
	call<T = unknown>(
		name: string,
		input?: unknown,
		options?: {
			signal?: AbortSignal;
			/** `workspace` runs the call at workspace level, the only widening (phase 2 specification, 3.2). */
			level?: 'workspace';
		}
	): Promise<CommandResult<T>>;
}

export interface AppStoreV1 {
	get<T = unknown>(key: string): Promise<T | undefined>;
	put(key: string, value: unknown): Promise<void>;
	delete(key: string): Promise<void>;
	list(prefix?: string): Promise<Array<{ key: string; value: unknown }>>;
}

/** The elements `kit.define` can load. More join by a new SDK minor, as apps need them. */
export const KIT_ELEMENT_NAMES_V1 = [
	'violet-badge',
	'violet-button',
	'violet-checkbox',
	'violet-divider',
	'violet-empty-state',
	'violet-icon',
	'violet-option',
	'violet-select',
	'violet-switch',
	'violet-text-area',
	'violet-text-field',
	'loam-list',
	'loam-status-item',
] as const;

export type KitElementNameV1 = (typeof KIT_ELEMENT_NAMES_V1)[number];

export interface KitV1 {
	/** Defines the named kit elements in this app's scoped registry. */
	define(names: readonly KitElementNameV1[]): Promise<void>;
}

export interface OverlaysV1 {
	toast(input: ToastInputV1): Promise<CommandResult<OverlayRefV1>>;
	/** Resolves when the modal closes, for whatever reason. */
	modal(input: ModalInputV1): Promise<OverlayResultV1>;
}

/** What a surface's element receives. Assigned before it connects. */
export interface LoamSurfaceElementV1 extends HTMLElement {
	context?: AppContextV1;
	/** The selection, for `main` and `inspector` under `list-detail`. */
	selection?: string | null;
	/** The scope the surface was created in, fixed for its life (phase 2 specification, 7.6). */
	scope?: ScopeV1;
	/** The app's route, the URL's rest. */
	route?: string;
	/** The level the selection was made at, in a dual-scope app's sidebar. */
	selectionLevel?: 'workspace' | 'project';
}

export type OverlayKindV1 = 'toast' | 'modal';

export interface OverlayRefV1 {
	overlayId: string;
	owner: string;
	kind: OverlayKindV1;
	lifetime: 'transient' | 'session';
}

export interface ToastInputV1 {
	message: string;
	tone?: 'info' | 'success' | 'warning' | 'danger';
	durationMs?: number;
}

export interface ModalInputV1 {
	title: string;
	body: string;
	confirmLabel?: string;
	cancelLabel?: string;
	danger?: boolean;
}

export interface OverlayV1 extends OverlayRefV1 {
	input: ToastInputV1 | ModalInputV1;
}

export interface OverlayResultV1 {
	overlayId: string;
	result: 'confirm' | 'cancel' | 'dismissed';
	reason: 'user' | 'timeout' | 'app-switch' | 'cap';
}

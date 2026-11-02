/**
 * @fileoverview `@lushly-dev/loam-sdk`: the whole contract an app codes against (phase 1
 * specification, 5.2; D21, D68). Transports and the kernel do not appear in it. Sandboxed code uses
 * `/view`.
 */

import type { Actor, CommandResult } from '@lushly-dev/afd-core';

export type { Actor, CommandError, CommandResult } from '@lushly-dev/afd-core';
export { failure, success } from '@lushly-dev/afd-core/result';
export type { ManifestV1 } from '@lushly-dev/loam-manifest';

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
	/** For queries only: a nested mutation answers NESTED_MUTATION_REFUSED (5.3). */
	readonly client: LoamClientV1;
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
}

export interface LoamClientV1 {
	call<T = unknown>(
		name: string,
		input?: unknown,
		options?: { signal?: AbortSignal }
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

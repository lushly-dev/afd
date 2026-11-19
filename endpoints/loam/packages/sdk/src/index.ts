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
	/** Present with the `settings` grant: this app's own sections (phase 4 specification, 3.8). */
	readonly settings?: SettingsV1;
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
 * What the `settings` grant gives an app (phase 4 specification, 3.8): its own sections' resolved values, for the
 * call's person and scope, read through `setting-get` and `setting-list`. Another app's section is
 * `SETTING_NOT_OWNED`; no app writes a setting.
 */
export interface SettingsV1 {
	/** A key's resolved value. Rejects with the refusal's code, `SETTING_NOT_FOUND` or `SETTING_NOT_OWNED` among them. */
	get<T = unknown>(section: string, key: string): Promise<T>;
	/** A section's resolved values, by key. */
	section(section: string): Promise<Record<string, unknown>>;
}

/** {@link SettingsV1} over a client that may call `setting-get` and `setting-list`, as the `settings` grant lets it. */
export function settingsOver(client: LoamClientV1): SettingsV1 {
	const refused = (error: { code?: string; message?: string; suggestion?: string } | undefined) =>
		Object.assign(new Error(error?.message ?? 'The setting could not be read'), {
			code: error?.code,
			suggestion: error?.suggestion,
		});
	return {
		async get<T>(section: string, key: string): Promise<T> {
			const result = await client.call<{ value: T }>('setting-get', { section, key });
			if (!result.success || !result.data) throw refused(result.error);
			return result.data.value;
		},
		async section(section: string) {
			const result = await client.call<{ values: Array<{ key: string; value: unknown }> }>(
				'setting-list',
				{ section }
			);
			if (!result.success || !result.data) throw refused(result.error);
			return Object.fromEntries(result.data.values.map((row) => [row.key, row.value]));
		},
	};
}

/**
 * A notice in the person's inbox (phase 4 specification, 10.1). `source` is derived from the path that pushed it,
 * never given: the pushing app's instance, `agent:<id>`, or `shell`. A confirmation (`kind: 'confirmation'`) is raised
 * by the kernel alone.
 */
export interface NotificationV1 {
	/** `ntf_` and 16 of `[a-z0-9]`. */
	id: string;
	workspace: string;
	person: string;
	source: string;
	kind: 'notice' | 'confirmation';
	/** 1 to 120 characters, plain text. */
	title: string;
	/** 1 to 1,000 characters, plain text; `notification-list` gives it only with `body: true`. */
	body?: string;
	tone: 'info' | 'success' | 'warning' | 'danger';
	/** Where the notice leads: navigation, never execution (10.1), in this workspace. */
	link?: ResourceLinkV1;
	/** One of the source app's own palette commands, which the person runs with `notification-act`. */
	action?: NotificationActionV1;
	/**
	 * A notice whose action ran (`done`), or is running or ran with no outcome recorded (`acting`): claimed before it
	 * runs, so it never runs twice.
	 */
	state?: 'acting' | 'done';
	/** Phase 4's step 6 fills it, the kernel alone. */
	confirmation?: Record<string, unknown>;
	scope: ScopeV1;
	createdAt: number;
	readAt?: number;
	archivedAt?: number;
	/** Whose it is, as the shell shows it (6.6), set by the kernel when it lists the notice; never stored. */
	from?: OverlayFromV1;
}

/** A notice's action (10.1): one of the pushing app's own palette commands, never a human or owner command. */
export interface NotificationActionV1 {
	command: string;
	label: string;
	input?: Record<string, unknown>;
}

/** What `notification-push` takes (10.2). An agent's notice carries no `action`, but may carry a `link`. */
export interface NotificationInputV1 {
	title: string;
	body?: string;
	tone?: NotificationV1['tone'];
	link?: ResourceLinkV1;
	action?: NotificationActionV1;
}

/**
 * The inbox, as an app reaches it (phase 4 specification, 12): it pushes notices to the person, at its own rate of 10
 * a minute, and never reads them, which are the person's and their agents'.
 */
export interface NotificationsV1 {
	/** Rejects with the refusal's code: `RATE_LIMITED`, `QUOTA_EXCEEDED`, `NOTIFICATION_ACTION_FOREIGN` among them. */
	push(input: NotificationInputV1): Promise<NotificationV1>;
}

/** {@link NotificationsV1} over a caller that may call `notification-push`, as every app may (12). */
export function notificationsOver(client: LoamClientV1): NotificationsV1 {
	return {
		async push(input) {
			const result = await client.call<{ notification: NotificationV1 }>(
				'notification-push',
				input
			);
			if (!result.success || !result.data) {
				const error = result.error;
				throw Object.assign(new Error(error?.message ?? 'The notice was not pushed'), {
					code: error?.code,
					suggestion: error?.suggestion,
				});
			}
			return result.data.notification;
		},
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

/**
 * How a document type binds to collaboration (documents specification, 3.1; D46): required on every type
 * and copied to each record. `crdt` is refused until the collaboration specification chooses a library.
 */
export interface BindingV1 {
	model: 'command';
	selection: 'none' | 'text-range' | 'item';
	locator: 'none' | 'text-range' | 'item';
	/** Per-property last-writer-wins is D46's default, and the only value until that specification. */
	conflict: 'last-writer-wins';
}

/**
 * A document's record, the shell's (documents specification, 3; D79). Its content is the type's, in the
 * owning plugin's `store` under the document's scope, at {@link documentContentKey}.
 */
export interface DocumentRecordV1 {
	/** `doc_` and 12 characters, from the command's random. */
	id: string;
	workspace: string;
	type: string;
	/** The owning plugin when created. */
	instance: string;
	/** 1 to 200 characters. */
	title: string;
	/** Exactly one scope. */
	scope: ScopeV1;
	/** `w` or `p:<project>`. */
	scopeKey: string;
	/** The actor's id, or `local`. */
	owner: string;
	/** At most 20, each 1 to 40 characters. */
	tags: string[];
	status: 'active' | 'archived' | 'trashed';
	trashedAt: number | null;
	/** The status it had when trashed, which a restore brings back; null when it is not in the trash. */
	trashedFrom: 'active' | 'archived' | null;
	/** The type's, when written last. */
	contentVersion: number;
	/** Copied from the type when created (D46). */
	binding: BindingV1;
	/** 0, raised when it moves between projects; the collaboration service reads it. */
	epoch: number;
	createdAt: number;
	updatedAt: number;
	createdBy: string;
	updatedBy: string;
}

/** One registered document type, as `document-type-list` answers it: no content (documents specification, 2.2). */
export interface DocumentTypeV1 {
	id: string;
	title: string;
	icon: string;
	instance: string;
	app: string;
	scopeLevels: Array<'workspace' | 'project'>;
	contentVersion: number;
	templates: Array<{ id: string; title: string }>;
	surfaces: Array<'editor' | 'embed' | 'inspector'>;
	binding: BindingV1;
	instanceCommands: string[];
	editorKind: 'native' | 'view';
}

/**
 * One row of `new-list` (documents specification, 7): a type's template, created by `document-create`, or an
 * app's `ui.new` creator, whose command needs no input.
 */
export type NewItemV1 =
	| {
			kind: 'document';
			type: string;
			template: string;
			title: string;
			icon: string;
			recent: boolean;
	  }
	| { kind: 'creator'; instance: string; command: string; title: string; icon: string };

/**
 * One reference between two documents of a workspace (documents specification, 9.3; D81): from a document,
 * to one, by a kind, with an anchor in the from document's locator. Links cross projects freely, and a reader
 * sees only those whose other end it may read.
 */
export interface DocumentLinkV1 {
	/** `lnk_` and 12 characters, from the command's random. */
	id: string;
	workspace: string;
	/** A document's id. */
	from: string;
	/** A document's id. */
	to: string;
	/** JSON, at most 1 KiB: the from document's locator, under its binding. */
	anchor: unknown;
	/** `reference` by default, or `embed`; `^[a-z][a-z-]{0,31}$`. */
	kind: string;
	createdAt: number;
	createdBy: string;
}

/** One row of `document-link-list`: the link, and the other document as the reader may see it (9.3). */
export interface LinkRowV1 {
	link: DocumentLinkV1;
	document: {
		id: string;
		title: string;
		type: string;
		status: DocumentRecordV1['status'];
		scope: ScopeV1;
	};
}

/**
 * What the `documents` grant gives a surface (documents specification, 11): metadata, references and
 * backlinks of the documents the caller may read, within its scope, and opening one. Content is read only
 * through the type's editor and commands, under `store`.
 */
export interface DocumentsV1 {
	get(document: string): Promise<DocumentRecordV1 | null>;
	list(options?: {
		type?: string;
		tag?: string;
		query?: string;
		limit?: number;
	}): Promise<DocumentRecordV1[]>;
	links(document: string): Promise<{ out: LinkRowV1[]; in: LinkRowV1[] }>;
	/** Refused unless this app is the active app or the editor owner, `DOCUMENT_OPEN_NOT_ACTIVE`. */
	open(document: string, options?: { group?: 'active' | 'beside' }): Promise<void>;
}

/** The store key of a document's content, in its type's `store` (documents specification, 3). */
export function documentContentKey(document: string): string {
	return `doc/${document}`;
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
	/** A surface's, with the `documents` grant (documents specification, 11). */
	readonly documents?: DocumentsV1;
	/** With the `settings` grant: this app's own sections (phase 4 specification, 3.8). */
	readonly settings?: SettingsV1;
	/** The person's inbox, to push a notice to (phase 4 specification, 10.2). */
	readonly notifications?: NotificationsV1;
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
	'loam-embed',
] as const;

export type KitElementNameV1 = (typeof KIT_ELEMENT_NAMES_V1)[number];

export interface KitV1 {
	/** Defines the named kit elements in this app's scoped registry. */
	define(names: readonly KitElementNameV1[]): Promise<void>;
}

export interface OverlaysV1 {
	toast(input: ToastInputV1): Promise<CommandResult<OverlayRefV1>>;
	/**
	 * A popover anchored on an element of this app's own surface that carries `data-loam-anchor` (phase 4
	 * specification, 6.3, 6.4): light dismiss, one per invoker, closed on an app switch. Only while the app is active.
	 */
	popover?(input: PopoverInputV1): Promise<CommandResult<OverlayRefV1>>;
	/** Resolves when the modal closes, for whatever reason. */
	modal(input: ModalInputV1): Promise<OverlayResultV1>;
	/**
	 * A non-modal dialog (phase 4 specification, 6.1, 6.4): parked while another app is active and restored when this
	 * one is again, or cancelled on leaving with `cancelOnLeave`; at most three per instance. Resolves when it closes.
	 */
	dialog?(input: DialogInputV1): Promise<OverlayResultV1>;
	/** A prompt in the overlay slot (6.1, 6.4): resolves when it is answered, a confirm with the person's `value`. */
	prompt?(input: PromptInputV1): Promise<OverlayResultV1>;
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
	/**
	 * With the `settings` grant: called when this app's own sections changed, by full id (phase 4 specification, 3.8).
	 * Read them again with `context.settings`.
	 */
	settingsChanged?(sections: string[]): void;
}

/**
 * The document an editor renders (documents specification, 5.6). Assigned before the element connects; a
 * new title is a new object.
 */
export interface DocumentRefV1 {
	readonly id: string;
	readonly type: string;
	readonly title: string;
	readonly scope: ScopeV1;
	readonly contentVersion: number;
	readonly binding: BindingV1;
	/** True in an embed. */
	readonly readOnly: boolean;
}

/** Another call changed a document: an instance command that is a mutation succeeded (5.7). */
export interface DocumentChangeV1 {
	readonly document: string;
	readonly command: string;
	readonly seq?: number;
}

/**
 * A document type's native editor (documents specification, 5.6). Every hook is optional, and all are called
 * by the shell. Its `context.client` is a surface port created with the document's scope.
 */
export interface LoamEditorElementV1 extends LoamSurfaceElementV1 {
	document?: DocumentRefV1;
	/** Write through the type's own commands. Rejecting keeps the tab dirty. */
	save?(): Promise<void>;
	/** Called before the element is dropped. Not given a time limit. */
	dispose?(): void | Promise<void>;
	/**
	 * Another call changed this document: re-read it. Called on every open editor of it, this one's own calls
	 * included (5.7).
	 */
	documentChanged?(change: DocumentChangeV1): void;
}

/**
 * What an editor dispatches, bubbling and composed, from its element, on each edit, not only when its state
 * changes: `detail` is `{ dirty: boolean }`. The shell's autosave timer restarts on each, and a leaving editor
 * counts them to know of an edit made after its save began (documents specification, 5.5).
 */
export const EDITOR_DIRTY_EVENT = 'loam-editor-dirty';

/** What an editor dispatches, bubbling and composed, from its element: `detail` is the selection, or null. */
export const EDITOR_SELECTION_EVENT = 'loam-editor-selection';

export type OverlayKindV1 = 'toast' | 'modal' | 'popover' | 'dialog' | 'prompt' | 'global';

export interface OverlayRefV1 {
	overlayId: string;
	owner: string;
	kind: OverlayKindV1;
	lifetime: 'transient' | 'session';
	/**
	 * A toast that also landed in the inbox, as a sticky one does (phase 4 specification, 6.1): the notice's id, so a
	 * sticky toast's "Open inbox" opens the inbox at it (6.7).
	 */
	notification?: string;
}

export interface ToastInputV1 {
	message: string;
	tone?: 'info' | 'success' | 'warning' | 'danger';
	durationMs?: number;
	/** Never times out: it stays until it is dismissed (phase 4 specification, 6.1). */
	sticky?: boolean;
	/**
	 * Where the toast leads, navigation and never execution (documents specification, 9.1): a document, or an app with
	 * no `route`, which is what `toast-show` takes.
	 */
	link?: ToastLinkV1;
}

export interface ModalInputV1 {
	title: string;
	body: string;
	confirmLabel?: string;
	cancelLabel?: string;
	danger?: boolean;
	/** Up to three answers in place of confirm (phase 4 specification, 6.4); cancel stays. */
	actions?: OverlayActionV1[];
	/** A native app's own element, defined in its registry, shown under the body; never a view's (6.4). */
	element?: string;
}

/**
 * An answer an overlay offers (6.4): its `id` is the result it closes with. One may be the `default`, focused first;
 * `danger` marks a destructive one. An `id` of `cancel` is a cancel.
 */
export interface OverlayActionV1 {
	id: string;
	label: string;
	tone?: 'primary' | 'danger';
	default?: boolean;
}

/** A non-modal dialog (6.4). */
export interface DialogInputV1 {
	title: string;
	body?: string;
	actions?: OverlayActionV1[];
	/** As a modal's: a native app's own element. */
	element?: string;
	/** Cancelled, not parked, when its app stops being active (6.1). */
	cancelOnLeave?: boolean;
}

/**
 * A field of a prompt's value (6.4): text, a number, a choice or a switch. No pattern: an app gives the shell no regular
 * expression (section 17).
 */
export interface PromptFieldV1 {
	type: 'string' | 'number' | 'integer' | 'boolean';
	title?: string;
	description?: string;
	enum?: Array<string | number>;
	minLength?: number;
	maxLength?: number;
	minimum?: number;
	maximum?: number;
}

/** What a prompt asks for: one field, or an object of named fields with the ones it requires. */
export type PromptSchemaV1 =
	| PromptFieldV1
	| {
			type: 'object';
			properties: Record<string, PromptFieldV1>;
			required?: string[];
	  };

/**
 * A prompt in the slot (6.4). With no `schema`, it asks for one line of text. The input has no `for`: the kernel alone
 * sets that on its own prompts.
 */
export interface PromptInputV1 {
	title: string;
	body?: string;
	schema?: PromptSchemaV1;
	/** The value it starts with. */
	value?: unknown;
	confirmLabel?: string;
	cancelLabel?: string;
	danger?: boolean;
}

/** The shell's strip under the title bar (6.1), set by the kernel alone, one per id. */
export interface GlobalInputV1 {
	id: string;
	message: string;
	tone?: 'info' | 'warning' | 'danger';
}

/** A toast's link (6.4): a resource link with no document `anchor` and no app `route`. */
export type ToastLinkV1 =
	| { kind: 'document'; document: string; scope: ScopeV1 }
	| { kind: 'app'; instance: string; scope: ScopeV1 };

/** Where a popover is anchored: a `data-loam-anchor` value inside one of the owner's surfaces (6.3). */
export interface OverlayAnchorV1 {
	/** The surface, as the manifest names it: `main`, `sidebar`, `inspector` or `panel`; the shell's own is `shell`. */
	surface: string;
	anchor: string;
}

/** A menu popover's item: one of the owner's own palette commands, run as the person when they pick it (6.4). */
export interface PopoverItemV1 {
	command: string;
	label: string;
	input?: Record<string, unknown>;
}

/** A popover (6.4): an info popover's text, or a menu of the owner's own commands. */
export type PopoverInputV1 =
	| { anchor: OverlayAnchorV1; kind: 'info'; title?: string; body: string }
	| { anchor: OverlayAnchorV1; kind: 'menu'; label?: string; items: PopoverItemV1[] };

/**
 * Whose an overlay is, as the shell shows it, set by the kernel alone (6.6): an app's "From <app>", an agent's toast
 * "From <agent>, for <person>" (`person` null for a page no one is signed in to). The shell's own carries none.
 */
export type OverlayFromV1 =
	| { kind: 'app'; title: string }
	| { kind: 'agent'; agent: string; person: string | null };

export interface OverlayV1 extends OverlayRefV1 {
	input:
		| ToastInputV1
		| ModalInputV1
		| PopoverInputV1
		| DialogInputV1
		| PromptInputV1
		| GlobalInputV1;
	/** Absent on the shell's own (6.6). */
	from?: OverlayFromV1;
	/**
	 * A muted app's toast (phase 4 specification, 3.7): the shell runs its timer and never shows it. Only the shell's
	 * own list says so; the app's never does.
	 */
	hidden?: true;
	/** `parked` for a dialog whose app is not active (6.2); absent while open. */
	state?: 'parked';
	/** On the kernel's own prompts only (6.1): the command it asks for, and the caller that raised it. */
	for?: { command: string; caller?: string };
	/** On an app's dialog, modal or prompt: the scope it was opened in, which its element's mount keeps (D83). */
	scope?: ScopeV1;
}

/**
 * Why an overlay moved (6.2). Toasts and popovers move by `user`, `timeout`, `app-switch`, `cap`, `person`, `replaced`
 * and `anchor` (a popover whose anchor left the page, phase 4's step 3); the rest are the dialogs', prompts' and
 * confirmations' (steps 4 to 6).
 */
export type OverlayReasonV1 =
	| 'user'
	| 'timeout'
	| 'app-switch'
	| 'cap'
	| 'park'
	| 'restore'
	| 'person'
	| 'replaced'
	| 'inbox'
	| 'withdrawn'
	| 'anchor';

export interface OverlayResultV1 {
	overlayId: string;
	/** `confirm`, `cancel`, `dismissed`, or the `id` of the action the person chose (6.4). */
	result: 'confirm' | 'cancel' | 'dismissed' | (string & {});
	reason: OverlayReasonV1;
	/** A menu popover's picked item, by index, or a prompt's value (6.4). */
	value?: unknown;
}

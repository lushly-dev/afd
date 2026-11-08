/**
 * @fileoverview `AppSurfaces`: the shell's controller for its apps (phase 1 specification, 4.6, 5.4, 5.5,
 * section 8 and 9.3), in a chunk of its own, so the empty shell loads none of it. It owns the mounts and
 * parked elements, renders the nav's entries, the surfaces, status items and overlays from what the
 * kernel says, and re-reads after the events that change them. `loam-shell` stays the only element
 * holding the kernel: it gives this controller the kernel and its parts. From phase 2 the rail's entries
 * are `RailBands`', in first paint, and `app-list` is read through it, once for both (7.2). A change of
 * scope drops and recreates every surface of an app kept across it, parked or not, each with a new
 * surface port, so nothing of one project stays under another (7.6).
 */

import { css, type FASTElement, Updates } from '@lushly-dev/fast-element';
import { ensureScopedRegistrySupport } from '@lushly-dev/fast-element/scoped.js';
import type {
	AppDetailV1,
	AppPortV2,
	AppSummaryV2,
	KernelEventV1,
	KernelEventV2,
	LoamKernelV2,
	SelectionV2,
} from '@lushly-dev/loam-kernel';
import type { AppContextV1 } from '@lushly-dev/loam-sdk';
import type { SurfaceHostV1 } from '../editor/editor-frame.js';
import { APP_OPEN_EVENT } from '../elements/app-entry.js';
import { deepActiveElement } from '../elements/events.js';
import { LIST_SELECT_EVENT, type LoamList } from '../elements/list.js';
import type { LoamMount } from '../elements/mount.js';
import type { LoamNotice } from '../elements/notice.js';
import { type LoamPartHeader, PART_ACTION_EVENT } from '../elements/part-header.js';
import type { LoamShell, ShellApps } from '../elements/shell.js';
import { STATUS_ACTION_EVENT } from '../elements/status-action.js';
import type { AppListV2 } from '../rail/rail-bands.js';
import type { MainStateV1 } from '../url-sync.js';
import type { LoamViewFrame } from '../view/view-frame.js';
import { crumbsOf } from './crumbs.js';
import { defineAppElements } from './define-elements.js';
import { focusFallback, focusMainHeading } from './focus-fallback.js';
import { createKit } from './kit-loader.js';
import { OverlaySurfaces } from './overlay-surfaces.js';
import { type Parked, park, restore } from './parking.js';
import { readSidebarList, selectInLists, sidebarLists } from './sidebar.js';
import { StatusItems } from './status-items.js';
import { surfaceCalls } from './surface-calls.js';

type Part = 'sidebar' | 'inspector' | 'panel';

const PARTS: readonly Part[] = ['sidebar', 'inspector', 'panel'];
const PART_HEADINGS = { sidebar: 'Sidebar', inspector: 'Inspector' } as const;

/** As `@lushly-dev/loam-console` defines it. Named here so this chunk does not import that one. */
const CONSOLE_ELEMENT = 'loam-console';

/** How long an app may take to open before main says it is opening. */
const OPENING_NOTICE_MS = 400;

type AppList = AppListV2;
/** `scope-get`'s scope, as a surface port takes it. */
type ScopeOf = { workspace: string; project?: string };

/** One app the chrome has given a port, once `activate` has run or failed. */
interface HeldApp {
	instance: string;
	port: AppPortV2;
	registry?: CustomElementRegistry;
	context?: AppContextV1;
	activation?: Promise<string | undefined>;
	/** What the import or `activate` threw: main shows it, and the kernel's record does not hold it (9.5). */
	failure?: string;
	deactivate?: () => void | Promise<void>;
	sidebar?: Parked;
	panel?: Parked;
	/** A `list` or `tree` sidebar's lists: two, at each level, for a dual-scope app in a project (7.4). */
	lists?: LoamList[];
}

/** Added to `loam-main` from this chunk, so the empty shell's styles do not grow. */
const mainWithApp = css`
	:host([data-app]) {
		display: flex;
		flex-direction: column;
		padding: 0;
		overflow: hidden;
	}
	:host([data-app]) .landing {
		display: none;
	}
	/* A URL that names nothing here, Back to one among them: "Nothing here" shows, and the app it left does
	   not (phase 2 specification, 6.3). */
	:host([data-app][route='not-found']) .landing {
		display: grid;
	}
	:host([route='not-found']) ::slotted(*) {
		display: none;
	}
	::slotted(loam-mount),
	::slotted(loam-notice),
	::slotted(loam-view-frame) {
		flex: 1 1 auto;
		min-block-size: 0;
	}
	::slotted(loam-notice) {
		overflow: auto;
	}
`;

export class AppSurfaces implements ShellApps {
	readonly #shell: LoamShell;
	readonly #kernel: LoamKernelV2;
	readonly #cleanup: Array<() => void> = [];
	readonly #held = new Map<string, HeldApp>();
	#queue: Promise<void> = Promise.resolve();
	#showing: string | null = null;
	#token = 0;
	#declared: ReadonlySet<string> | null = null;
	#summaries: AppSummaryV2[] = [];
	#started: Promise<void> | null = null;
	#prepared: AppList | null = null;
	#rendered = false;
	#missedSwitch = false;
	/** A selection set before an app's surfaces exist reaches them when they do. */
	#selectionWritten = false;
	/** The scope and route the surfaces now rendering are created in: read at each render. */
	#state: MainStateV1 | null = null;
	/** A change of scope since the last render: what was parked belongs to the scope it left (7.6). */
	#rescoped = false;
	/** The scope the surfaces now rendering are made in: the workspace's for a workspace-only app (4.3). */
	#surfaceScope: ScopeOf = { workspace: '' };
	#openingNotice: ReturnType<typeof setTimeout> | undefined;
	#mainElements: HTMLElement[] = [];
	#inspectorElements: HTMLElement[] = [];
	readonly #status = new StatusItems();
	readonly #overlays: OverlaySurfaces;

	constructor(shell: LoamShell, kernel: LoamKernelV2) {
		this.#shell = shell;
		this.#kernel = kernel;
		this.#overlays = new OverlaySurfaces(shell, kernel);
		this.#cleanup.push(kernel.subscribe((event) => this.#onEvent(event)));
		this.#listen(APP_OPEN_EVENT, ({ instance }) => {
			void kernel.call('app-open', { instance });
		});
		this.#listen(LIST_SELECT_EVENT, ({ id, level }, event) => {
			// A list made before a change of scope is stale: what it selects belongs to the scope left (7.6).
			if ((event.composedPath()[0] as LoamList).stale) return;
			if (this.#showing !== null) {
				// The level of the list it was made in, in a dual-scope app's sidebar (7.4).
				void kernel.call('app-selection-set', {
					instance: this.#showing,
					id,
					...(level ? { level } : {}),
				});
			}
		});
		this.#listen(PART_ACTION_EVENT, ({ command }) => this.run(String(command)));
		this.#listen(STATUS_ACTION_EVENT, ({ command }) => this.run(String(command)));
	}

	#listen(type: string, listener: (detail: Record<string, unknown>, event: Event) => void): void {
		const handler = (event: Event) =>
			listener((event as CustomEvent<Record<string, unknown>>).detail, event);
		this.#shell.addEventListener(type, handler);
		this.#cleanup.push(() => this.#shell.removeEventListener(type, handler));
	}

	#part<T extends Element>(name: string): T {
		return this.#shell.shadowRoot?.querySelector(`loam-${name}`) as T;
	}

	#create<T extends HTMLElement>(tag: string): T {
		return this.#shell.ownerDocument.createElement(tag) as T;
	}

	// ─── What `loam-shell` asks ────────────────────────────────────────────────────

	get modalOpen(): boolean {
		return this.#overlays.modalOpen;
	}

	/** A toggle or chord for a part the active app did not declare does nothing (4.5). */
	undeclared(part: Part): boolean {
		return this.#declared !== null && !this.#declared.has(part);
	}

	/**
	 * The editor frame's way in (scope and projects specification, 2.2; documents specification, 5.6): an
	 * app's `activate`, run once with no rail entry too, and a mount of one of its elements with a surface
	 * port fixed to the document's scope.
	 */
	host(): SurfaceHostV1 {
		return {
			ensureActivated: async (instance) => {
				const failure = await this.#activate(this.#hold(instance));
				if (failure !== undefined) throw new Error(failure);
			},
			createMount: (instance, element, { scope, document }) => {
				const held = this.#hold(instance);
				const mount = this.#create<LoamMount>('loam-mount');
				const surface = held.port.surface({ scope });
				mount.configure({
					registry: held.registry as CustomElementRegistry,
					element,
					context: { ...(held.context as AppContextV1), ...surfaceCalls(held.port, surface.call) },
					selection: null,
					scope,
					document,
				});
				return mount;
			},
		};
	}

	/** Run a command for a person, with no input; what it answers shows as a toast when it fails. */
	run(command: string): void {
		void this.#kernel.call(command, {}).then((result) => {
			if (result.success) return;
			const message = result.error?.message ?? `${command} failed`;
			// As long as a toast may last: this is the only report of a failure the person asked for.
			void this.#kernel.call('toast-show', {
				message: message.slice(0, 200),
				tone: 'danger',
				durationMs: 30_000,
			});
		});
	}

	/**
	 * What first paint needs, read before the parts render, so the frame that shows them shows the right
	 * landing, or main busy with a persisted active app's parts ready for it.
	 */
	async prepare(): Promise<void> {
		this.#prepared = (await this.#shell.rail.fresh()) ?? { active: null, apps: [] };
		const { active, apps } = this.#prepared;
		// With the late commands missing, the shell's "Could not load" is main's heading (2.2).
		if (apps.length > 0 && !this.#kernel.lateFailure) this.#shell.landing = 'Choose an app';
		if (active !== null) this.#declared = await this.#readDeclared(active);
	}

	/** Once the parts have rendered. A persisted active app's surfaces wait for first paint (5.5). */
	start(): Promise<void> {
		this.#started ??= this.#start();
		return this.#started;
	}

	async #start(): Promise<void> {
		const shell = this.#shell;
		this.#part<FASTElement>('main').$fastController.addStyles(mainWithApp);
		this.#overlays.attach();
		const lateStart = !this.#prepared;
		if (lateStart) await this.prepare();
		const view = shell.ownerDocument.defaultView ?? window;
		const nextFrame = () => new Promise((resolve) => view.requestAnimationFrame(resolve));
		this.#rendered = true;
		// Nothing is parked yet: a change of scope before this has nothing to drop.
		this.#rescoped = false;
		const { active, apps } = this.#prepared as AppList;
		this.#summaries = apps;
		if (active !== null) {
			const main = this.#part<HTMLElement>('main');
			main.dataset.app = active;
			main.setAttribute('aria-busy', 'true');
			this.#showing = active;
			this.#applyToggles();
			this.#setEmptyStates(false);
			const token = this.#token;
			void nextFrame()
				.then(nextFrame)
				.then(() => {
					if (token === this.#token && this.#showing === active) void this.#enter(active, token);
				});
		}
		// A live region that has just appeared may not be heard: let it settle before its first toast.
		if (lateStart) await nextFrame().then(nextFrame);
		// What the kernel said before the parts could show it.
		if (this.#missedSwitch) this.#enqueue(() => this.#sync());
		await this.#overlays.read();
		// In the background after first paint: a slow or failed instance holds up nothing (7.3).
		void nextFrame()
			.then(nextFrame)
			.then(() => this.#kernel.startInstances())
			.catch(reportError);
	}

	/**
	 * The chrome's teardown: what the shell put in its parts goes, so a reconnected shell starts clean,
	 * and each app that activated gets its `deactivate` (5.5, 9.6).
	 */
	dispose(): void {
		for (const cleanup of this.#cleanup.splice(0)) cleanup();
		if (this.#rendered) this.#leave();
		this.#overlays.dispose();
		for (const held of this.#held.values()) {
			const { deactivate } = held;
			if (deactivate) void Promise.resolve().then(deactivate).catch(reportError);
		}
		this.#held.clear();
		this.#showing = null;
	}

	// ─── Kernel events ─────────────────────────────────────────────────────────────

	#onEvent(event: KernelEventV1): void {
		const { command } = event;
		// What changes the active app: an app opened or closed, a section opened in its place, or a change of
		// scope that left it (phase 2 specification, 4.3), as a route's commands do (6.3).
		const switched =
			command === 'app-open' ||
			command === 'app-close' ||
			command === 'section-open' ||
			(event as KernelEventV2).scopeChanged?.left !== undefined;
		// A change of actor moves the scope before a call that may then fail (3.4), so a failed call's
		// `scopeChanged` recreates and drops as a successful one's does (7.6).
		const rescoped = (event as KernelEventV2).scopeChanged !== undefined;
		if (rescoped) {
			this.#rescoped = true;
			// At once, so a press in a list made in the scope left selects nothing (7.6).
			for (const held of this.#held.values())
				for (const list of held.lists ?? []) list.stale = true;
		}
		if (!this.#rendered) {
			// Anything that moved main or the scope before these surfaces rendered, the URL's own
			// `scope-set { project, app }` among them (N4), is read again once they have.
			if (switched || rescoped || (event as KernelEventV2).mainChanged) this.#missedSwitch = true;
			return;
		}
		// From anyone: an agent's, or the automatic one. The console says what it found (7.3).
		if (command === 'app-instance-refresh') {
			this.#enqueue(() => this.#sync());
			if (event.instance === this.#showing) this.#enqueue(() => this.#reloadConsole());
			// The automatic one, after an expired session, moves the scope and cancels a shell modal (F1).
			if (rescoped) this.#enqueue(() => this.#overlays.read());
			return;
		}
		if (!event.success && !rescoped) {
			// A first call that failed to import marks its app failed.
			if (event.instance !== undefined) this.#enqueue(() => this.#sync());
			return;
		}
		if (switched) this.#enqueue(() => this.#sync());
		// A kept app: every surface is recreated in the new scope (7.6). A route is a property (below).
		else if (rescoped) this.#enqueue(() => this.#sync(true));
		else if ((event as KernelEventV2).mainChanged && event.success) {
			this.#enqueue(() => this.#readRoute());
		}
		if (
			switched ||
			// A change of scope cancels a shell modal or closes a left app's overlays, even under a call
			// that then failed (3.4).
			rescoped ||
			(event.mutation && /^(toast|modal|overlay)-/.test(command)) ||
			// A modal of the palette's or a drawer's closing lets a toast go on, or its timer restart.
			(this.#overlays.waiting && /^(palette-(open|close)|layout-)/.test(command))
		) {
			this.#enqueue(() => this.#overlays.read());
		}
		if (!event.success) return;
		if (command === 'app-selection-set') this.#selectionWritten = true;
		const showing = this.#showing;
		if (showing === null) return;
		if (command === 'app-selection-set') this.#enqueue(() => this.#readSelection(showing));
		else if (command === 'status-item-set' && event.caller === showing) {
			this.#enqueue(() => this.#readStatus(showing));
		} else if (event.mutation && event.instance === showing) {
			const held = this.#held.get(showing);
			for (const list of held?.lists ?? []) {
				this.#enqueue(() =>
					readSidebarList(this.#kernel, held?.port.manifest.ui?.surfaces?.sidebar, list)
				);
			}
		}
	}

	/** One read at a time, so a later answer never renders under an earlier one. */
	#enqueue(task: () => Promise<void>): void {
		this.#queue = this.#queue.then(task).catch((cause) => reportError(cause));
	}

	/** Resolves once what the kernel's events asked for has rendered. */
	get idle(): Promise<void> {
		return this.#queue;
	}

	// ─── Switching ─────────────────────────────────────────────────────────────────

	/**
	 * Follow the active app; `recreate`, its scope changed under it, so its surfaces are made again. `read`,
	 * what changed was no command, as an `activate` that threw, so the list is read again.
	 */
	async #sync(recreate = false, read = false): Promise<void> {
		const list = await (read ? this.#shell.rail.refresh() : this.#shell.rail.fresh());
		if (!list) {
			// The scope moved and the list could not be read: what was made in the scope left goes all the
			// same, and the next read enters the app again.
			if (recreate || this.#rescoped) {
				this.#leave();
				this.#showing = null;
			}
			return;
		}
		const { active, apps } = list;
		const wasFailed = (instance: string) =>
			this.#summaries.find((app) => app.instance === instance)?.state === 'failed';
		const now = apps.find((app) => app.instance === active);
		const nowFailed = now?.state === 'failed';
		const changed = active !== this.#showing;
		// A mounted instance's console stays, and says what changed.
		const newlyFailed =
			!changed && active !== null && nowFailed && now?.kind !== 'mounted' && !wasFailed(active);
		this.#summaries = apps;
		// Whatever event queued this read, a change of scope since the last render makes the kept app again:
		// an `app-open` or `app-instance-refresh` refused after the middleware moved the scope, or an
		// `app-open` of the app already showing (7.6).
		const recreating = (recreate || this.#rescoped) && active !== null;
		if (!changed && !newlyFailed && !recreating) {
			if (this.#rescoped) this.#leave();
			return;
		}
		// The status bar's project item left the app: main's heading, as the switcher's All projects (7.8).
		const fromHome =
			deepActiveElement(this.#shell.ownerDocument)?.classList.contains('project-home') === true;
		const focusLeaves = this.#leave();
		this.#showing = active;
		if (changed) this.#selectionWritten = false;
		await this.#shell.readLayout();
		await Updates.next();
		if (fromHome && active === null) focusMainHeading(this.#shell);
		else if (focusLeaves) focusFallback(this.#shell);
		if (active === null) {
			this.#overlays.announce('No app is open');
			return;
		}
		// Not awaited: an app whose `activate` never settles must not stop the shell or another app (D66).
		void this.#enter(active, this.#token);
	}

	/**
	 * What the catalog does on a switch (4.2): park the sidebar and panel, drop the rest. After a change of
	 * scope nothing is parked, and what each app had parked is dropped: it was made in the scope left (7.6).
	 */
	#leave(): boolean {
		this.#token++;
		const rescoped = this.#rescoped;
		this.#rescoped = false;
		clearTimeout(this.#openingNotice);
		const shell = this.#shell;
		const held = this.#showing === null ? undefined : this.#held.get(this.#showing);
		const focus = deepActiveElement(shell.ownerDocument);
		const leavingFocus = focus !== null && this.#insideAppSurface(focus);
		if (held) {
			held.sidebar = park(this.#part('sidebar'), held.sidebar);
			held.panel = park(this.#part('panel'), held.panel);
		}
		if (rescoped) {
			for (const each of this.#held.values()) {
				each.sidebar = undefined;
				each.panel = undefined;
				each.lists = undefined;
			}
		}
		for (const element of [
			...this.#mainElements,
			...this.#inspectorElements,
			...this.#status.elements,
		]) {
			// A view is told first, and goes when it has answered (6.2).
			if (element.localName === 'loam-view-frame') (element as LoamViewFrame).leave();
			else element.remove();
		}
		this.#mainElements = [];
		this.#inspectorElements = [];
		this.#status.clear();
		const main = this.#part<HTMLElement>('main');
		delete main.dataset.app;
		main.removeAttribute('aria-busy');
		for (const part of ['sidebar', 'inspector'] as const) {
			this.#part<HTMLElement>(part).setAttribute('heading', PART_HEADINGS[part]);
		}
		this.#declared = null;
		this.#applyToggles();
		this.#setEmptyStates(true);
		return leavingFocus;
	}

	#insideAppSurface(node: Node): boolean {
		const surfaces = PARTS.map((part) => this.#part<Element>(part));
		surfaces.push(this.#part<Element>('main'), this.#part<Element>('statusbar'));
		let current: Node | null = node;
		while (current) {
			if (current instanceof Element && surfaces.includes(current)) return true;
			const root = current.getRootNode();
			current = current.parentNode ?? (root instanceof ShadowRoot ? root.host : null);
		}
		return false;
	}

	#setEmptyStates(shown: boolean): void {
		for (const part of PARTS) {
			const state = this.#part<HTMLElement>(part).querySelector('loam-empty-state');
			if (state instanceof HTMLElement) state.hidden = !shown;
		}
	}

	async #readDeclared(instance: string): Promise<ReadonlySet<string> | null> {
		const detail = await this.#kernel.call<AppDetailV1>('app-get', { instance });
		return new Set(detail.data?.surfaces ?? []);
	}

	#applyToggles(): void {
		// With no app, the projects section's chunk marks the toggles itself, as it declares main alone (7.7).
		if (this.#declared === null && this.#part<HTMLElement>('main').dataset.section) return;
		const titlebar = this.#part<HTMLElement>('titlebar');
		for (const part of PARTS) {
			const toggle = titlebar.shadowRoot?.querySelector(`[data-toggle="${part}"]`);
			if (!toggle) continue;
			if (this.undeclared(part)) {
				toggle.setAttribute('aria-disabled', 'true');
				toggle.setAttribute('title', `This app has no ${part}`);
			} else {
				toggle.removeAttribute('aria-disabled');
				toggle.removeAttribute('title');
			}
		}
	}

	// ─── Entering an app ───────────────────────────────────────────────────────────

	async #enter(instance: string, token: number): Promise<void> {
		const main = this.#part<HTMLElement>('main');
		const stale = () => token !== this.#token;
		main.dataset.app = instance;
		main.setAttribute('aria-busy', 'true');
		const detail = (await this.#kernel.call<AppDetailV1>('app-get', { instance })).data;
		if (stale()) return;
		if (!detail) {
			main.removeAttribute('aria-busy');
			return;
		}
		this.#declared = new Set(detail.surfaces);
		this.#applyToggles();
		this.#setEmptyStates(false);
		if (detail.kind === 'mounted' && detail.state !== 'refused') {
			// Its console says why it failed, and has the Refresh button (7.7). A mounted app has no port.
			await this.#renderConsole(detail, stale);
			if (!stale()) {
				this.#overlays.announce(
					detail.state === 'failed' ? `${detail.title} is unavailable` : `${detail.title} opened`
				);
			}
			return;
		}
		if (detail.state === 'failed' || detail.state === 'refused') {
			this.#setEmptyStates(true);
			this.#explain(
				detail.title,
				this.#held.get(instance)?.failure ?? detail.error?.message,
				detail.error?.code,
				detail.error?.suggestion
			);
			this.#overlays.announce(`${detail.title} is unavailable`);
			return;
		}
		const held = this.#hold(instance);
		// A slow app says so; a fast one never shows this.
		this.#openingNotice = setTimeout(() => {
			if (!stale()) this.#explain(detail.title, `Opening ${detail.title}…`);
			main.setAttribute('aria-busy', 'true');
		}, OPENING_NOTICE_MS);
		const failure = await this.#activate(held);
		clearTimeout(this.#openingNotice);
		if (stale()) return;
		this.#dropMainElements();
		if (failure !== undefined) {
			held.failure = failure;
			const after = (await this.#kernel.call<AppDetailV1>('app-get', { instance })).data;
			if (stale()) return;
			this.#setEmptyStates(true);
			this.#explain(detail.title, failure, after?.error?.code, after?.error?.suggestion);
			this.#overlays.announce(`${detail.title} is unavailable`);
			if (after) {
				// The nav follows; these surfaces already say why.
				this.#summaries = this.#summaries.map((app) =>
					app.instance === instance ? { ...app, state: after.state } : app
				);
				this.#enqueue(() => this.#sync(false, true));
			}
			return;
		}
		await this.#renderSurfaces(held, detail, stale);
		if (!stale()) this.#overlays.announce(`${detail.title} opened`);
	}

	#dropMainElements(): void {
		for (const element of this.#mainElements) element.remove();
		this.#mainElements = [];
	}

	#hold(instance: string): HeldApp {
		let held = this.#held.get(instance);
		if (!held) {
			held = { instance, port: this.#kernel.appPort(instance) };
			this.#held.set(instance, held);
		}
		return held;
	}

	/** Runs `activate` once. What it answers is the text a failure shows, in main alone (9.5). */
	#activate(held: HeldApp): Promise<string | undefined> {
		held.activation ??= (async () => {
			const { port } = held;
			// A view or mounted app has no module in the page, and nothing to activate.
			if (port.manifest.plugin.kind !== 'native') return undefined;
			let imported = false;
			try {
				const definition = await port.load();
				imported = true;
				await ensureScopedRegistrySupport();
				const registry = new CustomElementRegistry();
				const context = this.#contextOf(port, registry);
				held.registry = registry;
				held.context = context;
				await definition.activate?.(context);
				if (definition.deactivate) held.deactivate = () => definition.deactivate?.();
				return undefined;
			} catch (cause) {
				const message = cause instanceof Error ? cause.message : String(cause);
				if (imported) {
					// The page's console has the thrown text; the kernel's record, which reaches the journal, does not.
					reportError(cause);
					port.reportActivationFailed(
						"The app's `activate` threw; read the page's console for its message"
					);
				}
				return message;
			}
		})();
		return held.activation;
	}

	#contextOf(port: AppPortV2, registry: CustomElementRegistry): AppContextV1 {
		const { manifest, instance, config } = port;
		return {
			instance,
			app: manifest.plugin.id,
			version: manifest.plugin.version,
			config,
			registry,
			kit: createKit(registry),
			...surfaceCalls(port, port.call),
		};
	}

	/** Main explains a refused or failed app, or a surface this step does not serve. */
	#explain(title: string, message: string | undefined, code?: string, suggestion?: string): void {
		const main = this.#part<HTMLElement>('main');
		main.removeAttribute('aria-busy');
		const notice = this.#create<LoamNotice>('loam-notice');
		notice.toggleAttribute('embedded', true);
		notice.heading = title;
		notice.message = `${message ?? 'This app is unavailable.'}${code ? ` (${code})` : ''}`;
		notice.suggestion = suggestion ?? '';
		main.append(notice);
		this.#mainElements.push(notice);
	}

	async #renderSurfaces(held: HeldApp, detail: AppDetailV1, stale: () => boolean): Promise<void> {
		const { port } = held;
		// Every surface below gets a port of its own, fixed to this scope for its life (phase 2
		// specification, 3.6), and is made again when the scope changes (7.6). A workspace-only app's is the
		// workspace's, as its calls are narrowed: it learns no project (4.3).
		const state = await this.#shell.readState();
		this.#state = state;
		if (stale()) return;
		const { manifest } = port;
		const { workspace, project } = state.scope as ScopeOf;
		this.#surfaceScope =
			project !== undefined && manifest.app?.scope_levels?.includes('project')
				? { workspace, project }
				: { workspace };
		const surfaces = manifest.ui?.surfaces ?? {};
		const main = this.#part<HTMLElement>('main');
		const needsInput = this.#needsInput();
		if (surfaces.header) {
			const header = this.#create<LoamPartHeader>('loam-part-header');
			header.heading = surfaces.header.title ?? detail.title;
			header.crumbs = crumbsOf(this.#state, port.instance, detail.title, this.#shell.base);
			header.actions = (surfaces.header.actions ?? []).map(({ command, label }) => ({
				command,
				label,
				disabled: needsInput.get(command) === true,
			}));
			main.append(header);
			this.#mainElements.push(header);
		}
		const mainElement = surfaces.main?.element;
		if (manifest.plugin.kind === 'native' && mainElement !== undefined) {
			const mount = this.#mount(held, mainElement);
			main.append(mount);
			this.#mainElements.push(mount);
			main.removeAttribute('aria-busy');
		} else if (manifest.plugin.kind === 'view' && surfaces.main?.resource !== undefined) {
			await this.#openView(
				port,
				detail.title,
				surfaces.main.resource,
				surfaces.main.command,
				stale
			);
			if (stale()) return;
		} else if (!surfaces.main) {
			await this.#renderConsole(detail, stale);
			if (stale()) return;
		} else {
			this.#explain(
				detail.title,
				"This app's main surface has nothing its kind can show.",
				undefined,
				'Correct `ui.surfaces.main` in its manifest.'
			);
		}
		const { sidebar, inspector } = surfaces;
		if (sidebar) {
			this.#part<HTMLElement>('sidebar').setAttribute(
				'heading',
				sidebar.title ?? PART_HEADINGS.sidebar
			);
			if (held.sidebar) {
				await restore(this.#part('sidebar'), held.sidebar, Updates.next, stale);
				if (stale()) return;
			} else if (sidebar.shape === 'list' || sidebar.shape === 'tree') {
				held.lists = sidebarLists(
					() => this.#create<LoamList>('loam-list'),
					sidebar,
					detail.title,
					manifest.app?.scope_levels ?? [],
					{ ...state, scope: this.#surfaceScope }
				);
				this.#part<HTMLElement>('sidebar').prepend(...held.lists);
			} else if (sidebar.element !== undefined) {
				this.#part<HTMLElement>('sidebar').prepend(this.#mount(held, sidebar.element));
			}
			for (const list of held.lists ?? []) {
				list.selected = null;
				await readSidebarList(this.#kernel, sidebar, list);
				if (stale()) return;
			}
		}
		if (inspector) {
			const part = this.#part<HTMLElement>('inspector');
			part.setAttribute('heading', inspector.title ?? PART_HEADINGS.inspector);
			const mount = this.#mount(held, inspector.element);
			part.prepend(mount);
			this.#inspectorElements.push(mount);
		}
		if (surfaces.panel) {
			if (held.panel) {
				await restore(this.#part('panel'), held.panel, Updates.next, stale);
				if (stale()) return;
			} else {
				this.#part<HTMLElement>('panel').prepend(
					...surfaces.panel.views.map((view) => {
						const mount = this.#mount(held, view.element, view.title);
						mount.setAttribute('role', 'region');
						mount.setAttribute('aria-label', view.title);
						mount.dataset.view = view.id;
						return mount;
					})
				);
			}
		}
		if (stale()) return;
		// One read at a time: a surface that connected above is setting its status item already.
		this.#enqueue(async () => {
			if (stale()) return;
			await this.#readStatus(port.instance);
			if (!stale() && this.#selectionWritten) await this.#readSelection(port.instance);
		});
	}

	/** The view host is its own chunk, so a shell with no view app loads none of it (9.2). */
	async #openView(
		port: AppPortV2,
		title: string,
		resource: string,
		command: string | undefined,
		stale: () => boolean
	): Promise<void> {
		const main = this.#part<HTMLElement>('main');
		let view: typeof import('../view/view.js');
		try {
			view = await import('../view/view.js');
			await view.defineViewFrame();
		} catch (cause) {
			reportError(cause);
			if (!stale()) {
				this.#explain(
					title,
					'The view host could not load.',
					'APP_RUNTIME_UNAVAILABLE',
					'Reload; check that the deployment serves its assets.'
				);
			}
			return;
		}
		if (stale()) return;
		const frame = this.#create<LoamViewFrame>('loam-view-frame');
		frame.configure({
			port,
			// The view's broker is its surface's, so its calls run in the scope it opened in: a boundary (3.6).
			view: port.surface({ scope: this.#surfaceScope }).view,
			scope: this.#surfaceScope,
			route: this.#state?.path ?? '',
			source: view.packageViewSource(port),
			heading: title,
			hostVersion: String(this.#kernel.version),
			resource,
			...(command !== undefined ? { command } : {}),
			theme: () => (this.#shell.appearance.resolved === 'dark' ? 'dark' : 'light'),
			onSettled: (failed) => {
				if (stale()) return;
				main.removeAttribute('aria-busy');
				if (failed) this.#overlays.announce(`${title} is unavailable`);
			},
		});
		main.append(frame);
		this.#mainElements.push(frame);
	}

	/**
	 * The console in main's mount, every new app's first UI (7.7, D48). It is the chrome's and trusted, so
	 * it has a registry of its own, and its client makes a person's calls, with no `caller`. Its chunk loads
	 * only here, and if that fails the shell does not (D66).
	 */
	async #renderConsole(detail: AppDetailV1, stale: () => boolean): Promise<void> {
		const main = this.#part<HTMLElement>('main');
		let registry: CustomElementRegistry;
		try {
			// Here, as `activate` does, so the console's chunk does not share the module with first paint's.
			await ensureScopedRegistrySupport();
			const { consoleRegistry } = await import('./console.js');
			registry = await consoleRegistry();
		} catch (cause) {
			reportError(cause);
			if (stale()) return;
			this.#explain(
				detail.title,
				'The console could not load. Reload to try again.',
				'APP_RUNTIME_UNAVAILABLE',
				'Reload; check that the deployment serves its assets.'
			);
			return;
		}
		if (stale()) return;
		const kernel = this.#kernel;
		const mount = this.#create<LoamMount>('loam-mount');
		mount.configure({
			registry,
			element: CONSOLE_ELEMENT,
			// All the console reads of a surface's context, and a client with no `caller`.
			context: {
				instance: detail.instance,
				client: { call: (name, input, options) => kernel.call(name, input, options) },
			} as AppContextV1,
			selection: null,
		});
		main.append(mount);
		this.#mainElements.push(mount);
		main.removeAttribute('aria-busy');
	}

	/** The console in main re-reads, after a discovery it may not have asked for. */
	async #reloadConsole(): Promise<void> {
		for (const element of this.#mainElements) {
			const surface = element.localName === 'loam-mount' ? (element as LoamMount).surface : null;
			if (surface?.localName === CONSOLE_ELEMENT) {
				await (surface as unknown as { reload(): Promise<void> }).reload();
			}
		}
	}

	#needsInput(): Map<string, boolean | undefined> {
		return new Map(this.#kernel.listCommands().map(({ name, needsInput }) => [name, needsInput]));
	}

	#mount(held: HeldApp, element: string, label?: string): LoamMount {
		const mount = this.#create<LoamMount>('loam-mount');
		// A native surface's client is its own port's: a contract, as all of a native app is (D54).
		const scope = this.#surfaceScope;
		const surface = held.port.surface({ scope });
		mount.configure({
			registry: held.registry as CustomElementRegistry,
			element,
			context: { ...(held.context as AppContextV1), ...surfaceCalls(held.port, surface.call) },
			selection: null,
			scope,
			route: this.#state?.path ?? '',
			...(label !== undefined ? { label } : {}),
		});
		return mount;
	}

	// ─── Reads ─────────────────────────────────────────────────────────────────────

	async #readSelection(instance: string): Promise<void> {
		const result = await this.#kernel.call<SelectionV2>('app-selection-get', { instance });
		if (this.#showing !== instance || !result.success) return;
		const id = result.data?.id ?? null;
		const level = result.data?.level ?? 'workspace';
		selectInLists(this.#held.get(instance)?.lists ?? [], id, level);
		for (const element of [...this.#mainElements, ...this.#inspectorElements]) {
			if (element.localName !== 'loam-mount' && element.localName !== 'loam-view-frame') continue;
			const surface = element as LoamMount | LoamViewFrame;
			surface.selectionLevel = level;
			surface.selection = id;
		}
	}

	/** The app's route moved: a property of its surfaces and the header's crumbs, recreating nothing (7.6). */
	async #readRoute(): Promise<void> {
		const showing = this.#showing;
		const state = await this.#shell.readState();
		// A call that moved main to another app with no change of scope, as `scope-set` to the project already
		// active with an `app`, or its undo's `app: null`: the surfaces follow, as for `app-open` (M1).
		if (state.active !== showing) {
			this.#enqueue(() => this.#sync());
			return;
		}
		if (showing === null || this.#state === null) return;
		if (state.path === this.#state.path) return;
		this.#state = state;
		const title = this.#summaries.find((app) => app.instance === showing)?.title ?? showing;
		const parts = ['sidebar', 'panel'].flatMap((name) => [
			...this.#part<HTMLElement>(name).children,
		]);
		for (const element of [...this.#mainElements, ...this.#inspectorElements, ...parts]) {
			if (element.localName === 'loam-mount' || element.localName === 'loam-view-frame') {
				(element as LoamMount | LoamViewFrame).route = state.path;
			} else if (element.localName === 'loam-part-header') {
				(element as LoamPartHeader).crumbs = crumbsOf(state, showing, title, this.#shell.base);
			}
		}
	}

	/** Each item by its id, updated in place, so a status button keeps focus when its value changes. */
	#readStatus(instance: string): Promise<void> {
		return this.#status.read(
			this.#kernel,
			this.#part('statusbar'),
			instance,
			this.#held.get(instance)?.port.manifest.ui?.surfaces?.status?.items ?? [],
			() => this.#showing === instance
		);
	}
}

/** Create the controller, once the chunk's elements are defined. */
export async function attachSurfaces(shell: LoamShell, kernel: LoamKernelV2): Promise<ShellApps> {
	await defineAppElements();
	// `ICONS_V1` is registered now: the rail's entries show their icons (2.4).
	shell.rail.showIcons();
	const surfaces = new AppSurfaces(shell, kernel);
	// The chunk may load beside stage B; what it renders is what stage B read, never stage A's list.
	await kernel.appsReady;
	if (shell.appCount > 0) await surfaces.prepare();
	return surfaces;
}

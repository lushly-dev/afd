/**
 * @fileoverview `loam-shell`: the grid that hosts the parts, and the controller that binds them
 * to the kernel (phase 0 specification, sections 5 and 7). It holds no layout state of its own:
 * it re-reads `layout-get`, `appearance-get` and `auth-session-get` after the events that change
 * them, sets the three state properties through CSSOM, and turns every person's action into a
 * command.
 */

import { FASTElement, html, observable, ref, Updates, when } from '@lushly-dev/fast-element';
import {
	APPEARANCE_QUERIES,
	type AppearanceV0,
	type AppSummaryV2,
	createDefaultAppearance,
	createDefaultLayout,
	KERNEL_INTERFACE_VERSION,
	type KernelEventV3,
	LAYOUT_DEFAULTS_V0,
	type LayoutPatchV0,
	type LayoutStateV0,
	type LoamKernelV3,
} from '@lushly-dev/loam-kernel';
import type { SurfaceHostV1 } from '../editor/editor-frame.js';
import { afterFirstFrame } from '../first-frame.js';
import {
	isMacPlatform,
	matchKeybinding,
	nextPart,
	type PartName,
	toggleInput,
} from '../keyboard.js';
import {
	LAYOUT_CLASS_QUERIES,
	type LayoutClass,
	layoutClassFor,
	type PresentationV0,
	presentLayout,
} from '../layout-class.js';
import { RailBands } from '../rail/rail-bands.js';
import type { ResizeDetail } from '../resize.js';
import { createRouter, type RouterV1, type RouteV1 } from '../router.js';
import type { StateProperty } from '../state-properties.js';
import { applyAppearance } from '../theme.js';
import type { MainStateV1, UrlSyncV1 } from '../url-sync.js';
import { APP_OPEN_EVENT, SECTION_OPEN_EVENT } from './app-entry.js';
import { ACTION_EVENT, type ChromeAction, deepActiveElement } from './events.js';
import { focusPart } from './focus.js';
import { defineNotice } from './notice-loader.js';
import type { LoamPalette } from './palette.js';
import type { ShellPalette } from './palette-host.js';
import { definePalette, whenIdle } from './palette-loader.js';
import { type LoamProjectSwitcher, SWITCHER_OPEN_EVENT } from './project-switcher.js';
import type { LoamResizeHandle } from './resize-handle.js';
import { styles } from './shell-styles.js';
import type { LoamTitlebar } from './titlebar.js';

/** What the shell reads the last sequence number from at boot. */
export interface JournalReader {
	read(): Promise<readonly { seq: number }[]>;
}

/** The address the title bar's "Sign in" uses with the Mock adapter (6.5). */
export const MOCK_SIGN_IN_EMAIL = 'person@example.com';

/** What the shell asks of the app surfaces' chunk, once a deployment or an overlay needs it. */
export interface ShellApps {
	readonly modalOpen: boolean;
	undeclared(part: 'sidebar' | 'inspector' | 'panel'): boolean;
	run(command: string): void;
	start(): Promise<void>;
	dispose(): void;
	/** The editor frame's way in (documents specification, 5.6). */
	host(): SurfaceHostV1;
}

interface SessionState {
	status: string;
	user?: { name?: string; email?: string };
}

/** A `provider` deployment, as its host tells the chrome (phase 3 specification, 2.1, 4.2). */
export interface ShellIdentity {
	/** The bound organization's slug, for display. */
	organization: string;
	/** The ways in the deployment allows (D99). */
	methods: readonly string[];
	/** What the host last read of the person's membership and the binding (2.3). */
	standing(): { member: boolean; warning?: string };
}

interface ShellFailure {
	heading: string;
	message: string;
}

/** How long main stays busy for a persisted owner before saying it could not load (2.2). */
const MAIN_BUSY_MS = 15_000;
const COULD_NOT_LOAD = 'Could not load. Reload to try again.';

const sideEmpty = {
	sidebar: "The active app's navigation will appear here.",
	inspector: 'Properties of the selection will appear here.',
	panel: 'Output and logs will appear here.',
};

const template = html<LoamShell>`
	${when(
		(x) => x.failure !== null,
		html<LoamShell>`<loam-notice
			heading="${(x) => x.failure?.heading}"
			message="${(x) => x.failure?.message}"
		></loam-notice>`
	)}
	${when(
		(x) => x.failure === null && x.booted,
		html<LoamShell>`
			<loam-titlebar
				data-part="titlebar"
				account="${(x) => x.account}"
				persona="${(x) => x.persona}"
				?provider="${(x) => x.identity !== null}"
				shortcut="${(x) => x.shortcut}"
				key-shortcut="${(x) => (x.mac ? 'Meta+K' : 'Control+K')}"
				shown-parts="${(x) => x.shownParts}"
			></loam-titlebar>
			<loam-rail
				data-part="rail"
				?hidden="${(x) => x.presentation.layoutClass === 'compact'}"
			></loam-rail>
			<loam-sidebar
				data-part="sidebar"
				heading="Sidebar"
				mode="${(x) => x.presentation.sidebar}"
				?hidden="${(x) => x.presentation.sidebar === 'closed'}"
			>
				<loam-empty-state message="${() => sideEmpty.sidebar}"></loam-empty-state>
				<loam-resize-handle
					slot="handle"
					class="sidebar-handle"
					${ref('sidebarHandle')}
					growth="end"
					label="Resize sidebar"
					data-resizes="sidebar"
					value="${(x) => x.layout.sidebar.width}"
					min="${() => LAYOUT_DEFAULTS_V0.sidebar.min}"
					max="${() => LAYOUT_DEFAULTS_V0.sidebar.max}"
					preset="${() => LAYOUT_DEFAULTS_V0.sidebar.default}"
					?hidden="${(x) => x.presentation.sidebar !== 'inline'}"
				></loam-resize-handle>
			</loam-sidebar>
			<loam-main
				data-part="main"
				landing="${(x) => x.landing}"
				gate="${(x) => x.gate}"
				organization="${(x) => x.identity?.organization ?? ''}"
				notice="${(x) => x.notice}"
				?busy="${(x) => x.mainBusy}"
				route="${(x) => x.route}"
				shortcut="${(x) => x.shortcut}"
				home="${(x) => x.home}"
				?inert="${(x) => x.presentation.panel === 'maximized'}"
				>${when((x) => x.mainBusy, html`<h1 class=announce>Opening</h1>`)}</loam-main
			>
			<loam-inspector
				data-part="inspector"
				heading="Inspector"
				mode="${(x) => x.presentation.inspector}"
				?hidden="${(x) => x.presentation.inspector === 'closed'}"
			>
				<loam-empty-state message="${() => sideEmpty.inspector}"></loam-empty-state>
				<loam-resize-handle
					slot="handle"
					class="inspector-handle"
					${ref('inspectorHandle')}
					growth="start"
					label="Resize inspector"
					data-resizes="inspector"
					value="${(x) => x.layout.inspector.width}"
					min="${() => LAYOUT_DEFAULTS_V0.inspector.min}"
					max="${() => LAYOUT_DEFAULTS_V0.inspector.max}"
					preset="${() => LAYOUT_DEFAULTS_V0.inspector.default}"
					?hidden="${(x) => x.presentation.inspector !== 'inline'}"
				></loam-resize-handle>
			</loam-inspector>
			<loam-panel
				data-part="panel"
				mode="${(x) => x.presentation.panel}"
				?hidden="${(x) => x.presentation.panel === 'closed'}"
			>
				<loam-empty-state message="${() => sideEmpty.panel}"></loam-empty-state>
				<loam-resize-handle
					slot="handle"
					class="panel-handle"
					${ref('panelHandle')}
					growth="up"
					label="Resize panel"
					data-resizes="panel"
					value="${(x) => x.layout.panel.height}"
					min="${() => LAYOUT_DEFAULTS_V0.panel.min}"
					max="${(x) => x.panelMax}"
					preset="${() => LAYOUT_DEFAULTS_V0.panel.default}"
					?hidden="${(x) => x.presentation.panel !== 'inline'}"
				></loam-resize-handle>
			</loam-panel>
			<loam-statusbar
				data-part="statusbar"
				?hidden="${(x) => x.presentation.layoutClass === 'compact'}"
			>
				<loam-status-item slot="start" class="workspace-status" label="Workspace"
					>${(x) => x.workspaceName}</loam-status-item
				>
				<loam-status-item
					slot="start"
					class="project-status"
					label="Project"
					?hidden="${(x) => !x.projectName}"
					><button
						class="project-home"
						type="button"
						aria-label="${(x) => `Project: ${x.projectName}, home`}"
						@click="${(x) => x.kernel?.call('section-open', { section: 'projects' })}"
					>
						${(x) => x.projectName}
					</button></loam-status-item
				>
				<loam-status-item slot="start" class="actor-status"
					>${(x) => (x.account ? `Signed in as ${x.account}` : 'Signed out')}</loam-status-item
				>
				<loam-status-item slot="end" class="journal-status" label="Journal"
					>${(x) => String(x.lastSeq)}</loam-status-item
				>
			</loam-statusbar>
			<loam-tabbar
				data-part="tabbar"
				?hidden="${(x) => x.presentation.layoutClass !== 'compact'}"
			></loam-tabbar>
			<loam-palette ${ref('palette')}></loam-palette>
			<span class="announce" role="status">${(x) => x.announcement}</span>
		`
	)}
`;

export class LoamShell extends FASTElement {
	declare layout: LayoutStateV0;
	declare appearance: AppearanceV0;
	declare presentation: PresentationV0;
	declare account: string;
	declare lastSeq: number;
	/** Main's "Nothing here" when the URL names nothing this person can open (6.1). */
	declare route: 'home' | 'not-found';
	declare panelMax: number;
	declare failure: ShellFailure | null;
	/** True once the first appearance, layout and session reads are in, so parts render themed. */
	declare booted: boolean;
	declare palette: LoamPalette;
	declare sidebarHandle: LoamResizeHandle;
	declare inspectorHandle: LoamResizeHandle;
	declare panelHandle: LoamResizeHandle;

	/** Main's landing heading: the empty shell's until the app surfaces say otherwise. */
	declare landing: string;
	/**
	 * Main hides its landing while a persisted owner, an app or the documents section, is on its way (2.2;
	 * documents specification, 6); a visually hidden `h1`, "Opening", heads the page meanwhile.
	 */
	declare mainBusy: boolean;
	/** The status bar's left items: the workspace's name, and the active project's, or empty (7.4). */
	declare workspaceName: string;
	declare projectName: string;
	/** The live region's text: a change of scope, and what it left (phase 2 specification, 7.8). */
	declare announcement: string;
	/** The active persona's title beside the name, empty for `default` (phase 3 specification, 6.3). */
	declare persona: string;
	/** The rail's and the tab bar's entries, in first paint (7.2). */
	readonly rail = new RailBands(this);

	/** The kernel the chrome binds to; set it before or after connecting. */
	kernel: LoamKernelV3 | null = null;
	/** A `provider` deployment's identity; null in `local` mode, as phases 0 to 2 have it. */
	identity: ShellIdentity | null = null;
	/** What main shows in place of the landing in a `provider` deployment (2.1, 2.3). */
	declare gate: '' | 'sign-in' | 'not-member' | 'binding';
	/** An owner's binding notice under the landing (2.3). */
	declare notice: string;
	/**
	 * Whether the boot records list an app, so the first frame reads `app-list` (phase 2 specification,
	 * 2.2). `mountShell`'s `listsApps` sets it.
	 */
	listsApps = false;
	/** How many apps `app-list` last listed: the app surfaces load after the first frame when any are. */
	appCount = 0;
	/** The app surfaces, once their chunk has loaded. */
	apps: ShellApps | null = null;
	/** Where the shell reads the journal's last sequence number at boot. */
	journal: JournalReader | null = null;
	readonly mac: boolean;
	/** The deployment's root, absolute: the router's base, which `mountShell`'s `base` sets (6.2). */
	base: string;
	/** Where main's "Nothing here" links home: the base's path unless set. */
	home: string;

	#layoutClass: LayoutClass = 'expanded';
	#width = 0;
	/** The palette's host, loaded with the palette: its search and its runs. */
	#paletteHost: Promise<ShellPalette> | null = null;
	#pendingQuery = '';
	#cleanup: (() => void)[] = [];
	#started: Promise<void> | null = null;
	#reads = { layout: 0, appearance: 0, session: 0, persona: 0 };
	/** The router, once the shell has started (phase 2 specification, 6.3). */
	router: RouterV1 | null = null;
	/** Set once stage B's own boot of the URL chunk has been tried, whether or not the chunk loaded. */
	declare urlBooted?: boolean;
	/** The rows `app-list` last gave, for an app route's checks. */
	appList: readonly AppSummaryV2[] = [];
	/** The URL and the state, both ways, in a chunk loaded when stage B ends (6.3). */
	#urlSync: Promise<UrlSyncV1> | null = null;
	#appsLoad: Promise<void> | null = null;

	constructor() {
		super();
		this.layout = createDefaultLayout();
		const appearance = createDefaultAppearance();
		this.appearance = { ...appearance, resolved: 'light' };
		this.presentation = presentLayout(this.layout, 'expanded', { width: 1280, rail: 48 });
		this.account = '';
		this.gate = '';
		this.notice = '';
		this.lastSeq = 0;
		this.route = 'home';
		this.panelMax = LAYOUT_DEFAULTS_V0.panel.default;
		this.failure = null;
		this.booted = false;
		this.landing = 'No apps yet';
		this.mainBusy = false;
		this.workspaceName = '';
		this.projectName = '';
		this.announcement = '';
		this.persona = '';
		this.mac = isMacPlatform(globalThis.navigator);
		this.base = new URL('./', globalThis.location?.href ?? 'http://localhost/').href;
		this.home = new URL(this.base).pathname;
	}

	get shortcut(): string {
		return this.mac ? '⌘K' : 'Ctrl+K';
	}

	/** The parts shown now, for the title bar's toggles. */
	get shownParts(): string {
		const p = this.presentation;
		return [
			p.sidebar !== 'closed' ? 'sidebar' : '',
			p.inspector !== 'closed' ? 'inspector' : '',
			p.panel !== 'closed' ? 'panel' : '',
		]
			.filter(Boolean)
			.join(' ');
	}

	/** Resolves once the shell has read the kernel's state and bound its listeners. */
	get ready(): Promise<void> {
		return this.#started ?? Promise.resolve();
	}

	override connectedCallback(): void {
		super.connectedCallback();
		if (this.kernel) this.start(this.kernel);
	}

	override disconnectedCallback(): void {
		for (const cleanup of this.#cleanup.splice(0)) cleanup();
		this.router?.dispose();
		this.router = null;
		this.#urlSync = null;
		clearTimeout(this.#busyTimer);
		this.appCount = 0;
		this.#started = null;
		this.apps = null;
		this.#appsLoad = null;
		super.disconnectedCallback();
	}

	/** Bind to a kernel and read its state. */
	start(kernel: LoamKernelV3): Promise<void> {
		this.kernel = kernel;
		if (!this.$fastController.isConnected) return Promise.resolve();
		this.#started ??= this.#start(kernel);
		return this.#started;
	}

	async #start(kernel: LoamKernelV3): Promise<void> {
		if (kernel.version !== KERNEL_INTERFACE_VERSION) {
			await defineNotice();
			this.failure = {
				heading: 'Loam cannot start',
				message: `The chrome needs kernel interface ${KERNEL_INTERFACE_VERSION}, and this kernel has interface ${String(kernel.version)}.`,
			};
			return;
		}
		const view = this.ownerDocument.defaultView ?? window;
		// Before a call that waited on stage B goes on, so a palette result finds its row.
		void kernel.appsReady.then(() => this.#stageBEnded(kernel)).catch(reportError);

		this.#cleanup.push(kernel.subscribe((event) => this.#onEvent(event)));
		this.#listen(view, 'keydown', (event) => this.#onKeydown(event as KeyboardEvent));
		this.#listen(view, 'pagehide', () => void kernel.flush());
		this.#listen(this.ownerDocument, 'visibilitychange', () => {
			if (this.ownerDocument.visibilityState === 'hidden') void kernel.flush();
		});
		this.#listen(this, ACTION_EVENT, (event) =>
			this.#onAction((event as CustomEvent<ChromeAction>).detail)
		);
		// A press of a first-frame entry before the app surfaces attach: `app-open` queues behind stage B. On
		// the shadow root, so it is heard before the surfaces' listener on the host, which takes over.
		this.#listen(this.shadowRoot as ShadowRoot, APP_OPEN_EVENT, (event) => {
			if (this.apps) return;
			event.stopPropagation();
			void kernel.call('app-open', (event as CustomEvent<{ instance: string }>).detail);
		});
		// The rail's sections, and its switcher, whose list is the `switcher` chunk's (7.2).
		this.#listen(this, SECTION_OPEN_EVENT, (event) => {
			void kernel.call('section-open', (event as CustomEvent<{ section: string }>).detail);
		});
		this.#listen(this, SWITCHER_OPEN_EVENT, (event) => {
			const switcher = event.composedPath()[0] as LoamProjectSwitcher;
			void import('../rail/switcher.js')
				.then(({ openSwitcher }) => openSwitcher(this, switcher))
				.catch(reportError);
		});
		this.#listen(this, 'resize-preview', (event) => this.#onResize(event, false));
		this.#listen(this, 'resize-commit', (event) => this.#onResize(event, true));

		for (const query of [LAYOUT_CLASS_QUERIES.compact, LAYOUT_CLASS_QUERIES.expanded]) {
			const list = view.matchMedia(query);
			const listener = () => this.#classChanged();
			list.addEventListener('change', listener);
			this.#cleanup.push(() => list.removeEventListener('change', listener));
		}
		for (const query of Object.values(APPEARANCE_QUERIES)) {
			const list = view.matchMedia(query);
			const listener = () => void this.#readAppearance();
			list.addEventListener('change', listener);
			this.#cleanup.push(() => list.removeEventListener('change', listener));
		}
		const observer = new ResizeObserver((entries) => {
			const box = entries.at(-1)?.contentRect;
			if (!box) return;
			this.#width = box.width;
			this.#present();
		});
		observer.observe(this);
		this.#cleanup.push(() => observer.disconnect());

		this.#layoutClass = layoutClassFor((query) => view.matchMedia(query).matches);
		this.#width = this.getBoundingClientRect().width || view.innerWidth;
		// A person's navigation runs commands, after the boot's own route (6.3).
		const router = createRouter(view, this.base, (route) =>
			this.#url((url) => url.navigated(route))
		);
		this.router = router;

		const entries = (await this.journal?.read()) ?? [];
		this.lastSeq = Math.max(this.lastSeq, entries.at(-1)?.seq ?? 0);
		// Appearance first, so the parts render in their theme with no transition from light.
		await this.#readAppearance();
		const [, , [list, state]] = await Promise.all([
			this.readLayout(),
			this.#readSession(),
			this.rail.read(),
		]);
		// Stage A: the URL's project is active only if the kernel let the actor in, so a missing and a refused
		// one paint the same "Nothing here" (6.3).
		const { route } = router;
		const found = this.#fits(route, state);
		this.route = found ? 'home' : 'not-found';
		// A persisted or URL-named active app: main is busy in the first frame, with no landing, until its
		// surface is in.
		const owner =
			route.kind === 'app'
				? list && route.instance
				: route.kind === 'root' || route.kind === 'workspace'
					? list?.active
					: null;
		// A persisted documents section too: its editors restore in stage B (documents specification, 6).
		if (found && (owner ?? state.section === 'documents')) this.#holdMain();
		else if (this.appCount > 0) this.landing = 'Choose an app';
		this.booted = true;
		this.#present();
		await Updates.next();
		this.rail.render(list, state);
		void afterFirstFrame(view).then(() => {
			// What E1 reads: everything requested before this mark is the first paint (2.2).
			view.performance?.mark?.('loam-stage-b');
			void kernel.startApps();
			// Its chunk loads beside stage B; it starts once stage B ends.
			if (this.appCount > 0) void this.#loadApps();
			whenIdle(view, () => void this.preparePalette());
		});
	}

	#busyTimer: ReturnType<typeof setTimeout> | undefined;

	/** Main stays busy until the surface is in, a chunk fails or 15 seconds pass (2.2). */
	#holdMain(): void {
		this.mainBusy = true;
		clearTimeout(this.#busyTimer);
		this.#busyTimer = setTimeout(() => this.releaseMain(true), MAIN_BUSY_MS);
	}

	/** Main shows what it shows; with `failed`, its heading says the owner could not load. */
	releaseMain(failed = false): void {
		clearTimeout(this.#busyTimer);
		const held = this.mainBusy;
		this.mainBusy = false;
		if (failed && held) this.landing = COULD_NOT_LOAD;
	}

	/**
	 * The commands stage B added, for the palette's rows, and the apps it read, whose surfaces start now.
	 * A chunk that failed says so in main.
	 */
	async #stageBEnded(kernel: LoamKernelV3): Promise<void> {
		if (kernel.lateFailure) {
			this.landing = COULD_NOT_LOAD;
			this.releaseMain(true);
			// Stage B lists each app `failed`, so the first frame's entries say "(unavailable)" from it.
			await this.rail.refresh();
			return;
		}
		const listed = this.listsApps || this.appCount > 0;
		// Stage B's list corrects what the boot records said (2.2), placed by the active persona's emphasis (6.2).
		await this.#readPersona();
		await this.rail.refresh();
		// Before the surfaces start, so they open what the URL names rather than the persisted app.
		await this.#url((url) => url.boot());
		// From here, a URL chunk loaded again after a failure starts late, with no boot of its own (6.3).
		this.urlBooted = true;
		// An app the route named that stage B does not hold shows "Nothing here" once main is released below,
		// when the surfaces start; with no apps listed, main was never held.
		if (!listed) return;
		if (this.appCount === 0) {
			this.releaseMain();
			return;
		}
		await this.#loadApps();
		try {
			if (!this.apps) throw new Error('The app surfaces did not load');
			await this.apps.start();
		} catch (cause) {
			reportError(cause);
			this.releaseMain(true);
			return;
		}
		// The owner's surface is in, so a heading the 15-second timer set no longer holds.
		if (this.landing === COULD_NOT_LOAD) this.landing = 'Choose an app';
		this.releaseMain();
	}

	// ─── The URL (phase 2 specification, 6.3) ──────────────────────────────────────

	/**
	 * Run `task` with the URL's chunk, loaded once. A chunk that fails is reported and forgotten, so the next
	 * call tries again, and nothing else of stage B waits on it: the app surfaces still start.
	 */
	#url(task: (url: UrlSyncV1) => unknown): Promise<unknown> {
		this.#urlSync ??= import('../url-sync.js').then(({ createUrlSync }) => createUrlSync(this));
		return this.#urlSync.then(task).catch((cause: unknown) => {
			this.#urlSync = null;
			reportError(cause);
		});
	}

	/** What the URL shows, from `scope-get` and `section-get`, both unjournaled. */
	async readState(): Promise<MainStateV1> {
		const kernel = this.kernel as LoamKernelV3;
		const [scope, main] = await Promise.all([
			kernel.call<object>('scope-get'),
			kernel.call<object>('section-get'),
		]);
		return { ...scope.data, ...main.data } as MainStateV1;
	}

	/**
	 * Stage A's reading of the first route: this workspace, and the project stage A entered. The URL's
	 * project is active only if the kernel let the actor in, so a missing and a refused one fail alike. An
	 * app the route names is checked in stage B, with the manifests' levels (6.3).
	 */
	#fits(route: RouteV1, state: MainStateV1): boolean {
		if (route.kind === 'root') return true;
		// `not-found` has no workspace, so it fits nothing.
		const { workspace, project } = route as Partial<Record<string, string>>;
		return (
			workspace === state.workspace.id && (project === undefined || project === state.project?.slug)
		);
	}

	#listen(target: EventTarget, type: string, listener: (event: Event) => void): void {
		target.addEventListener(type, listener);
		this.#cleanup.push(() => target.removeEventListener(type, listener));
	}

	// ─── Reading kernel state ──────────────────────────────────────────────────────

	/** The latest `layout-get` the shell started; a queued change waits for it. */
	#layoutRead: Promise<void> = Promise.resolve();
	/** Layout changes run one at a time, each computed from the state the previous one left. */
	#layoutQueue: Promise<void> = Promise.resolve();

	/** Load the app surfaces once; a chunk that fails leaves the shell running and says so. */
	#loadApps(): Promise<void> {
		this.#appsLoad ??= import('../apps/surfaces.js')
			.then(async ({ attachSurfaces }) => {
				const apps = await attachSurfaces(this, this.kernel as LoamKernelV3);
				this.apps = apps;
				this.#cleanup.push(() => apps.dispose());
			})
			.catch((cause: unknown) => {
				reportError(cause);
				this.landing = 'Apps could not load. Reload to try again.';
			});
		return this.#appsLoad;
	}

	readLayout(): Promise<void> {
		this.#layoutRead = this.#fetchLayout();
		return this.#layoutRead;
	}

	async #fetchLayout(): Promise<void> {
		const generation = ++this.#reads.layout;
		const result = await this.kernel?.call<LayoutStateV0>('layout-get');
		if (!result?.success || generation !== this.#reads.layout) return;
		this.layout = result.data as LayoutStateV0;
		this.#present();
	}

	async #readAppearance(): Promise<void> {
		const generation = ++this.#reads.appearance;
		const result = await this.kernel?.call<AppearanceV0>('appearance-get');
		if (!result?.success || generation !== this.#reads.appearance) return;
		this.appearance = result.data as AppearanceV0;
		const view = this.ownerDocument.defaultView ?? window;
		applyAppearance(
			this.ownerDocument,
			this.appearance,
			view.matchMedia(APPEARANCE_QUERIES.forcedColors).matches
		);
		// Density changes the rail's width, which the expanded class's overlay rule reads.
		if (this.booted) this.#present();
	}

	/**
	 * The active persona (phase 3 specification, 6.2, 6.3): its title for the title bar and its emphasized apps for
	 * the rail. With `announce`, a switch: the live region says so and the rail is placed again. A read that fails,
	 * as one signed out, is `default`.
	 */
	async #readPersona(announce = false): Promise<void> {
		const generation = ++this.#reads.persona;
		const result = await this.kernel?.call<{
			personas: { id: string; title: string; emphasis: { apps?: string[] } }[];
			active: string;
		}>('persona-list');
		if (generation !== this.#reads.persona) return;
		const listed = result?.success ? result.data : undefined;
		const active = listed?.personas.find((persona) => persona.id === listed.active);
		this.persona = active && active.id !== 'default' ? active.title : '';
		this.rail.emphasis = active?.emphasis.apps ?? [];
		if (!announce) return;
		this.announcement = `Persona: ${active?.title ?? 'Default'}`;
		await this.rail.refresh();
	}

	async #readSession(): Promise<void> {
		const generation = ++this.#reads.session;
		const result = await this.kernel?.call<SessionState>('auth-session-get');
		if (!result?.success || generation !== this.#reads.session) return;
		const session = result.data as SessionState;
		const was = this.account;
		this.account =
			session.status === 'authenticated' ? (session.user?.name ?? session.user?.email ?? '') : '';
		const identity = this.identity;
		if (!identity) return;
		// What main shows instead of its landing (2.1, 2.3): signed out, no organization bound, or no membership.
		const { member, warning } = identity.standing();
		this.gate = !this.account
			? 'sign-in'
			: warning === 'IDENTITY_ORGANIZATION_UNKNOWN'
				? 'binding'
				: member
					? ''
					: 'not-member';
		this.notice =
			warning === 'IDENTITY_BINDING_MISMATCH'
				? `${identity.organization} no longer names the bound organization (IDENTITY_BINDING_MISMATCH); fix the binding on the server.`
				: '';
		// Signed out: the address no longer names what the last person had open, on a shared profile (16).
		if (was && !this.account)
			this.ownerDocument.defaultView?.history.replaceState(null, '', this.base);
	}

	#onEvent(event: KernelEventV3): void {
		if (event.seq !== undefined) this.lastSeq = Math.max(this.lastSeq, event.seq);
		if (!this.booted) return;
		this.rail.heard(event);
		// From anyone, whatever the command: a command moves the URL (6.3). Each is a late command's.
		if (event.scopeChanged || event.mainChanged) void this.#url((url) => url.changed(event));
		if (event.command === 'palette-open' && event.success) {
			void this.#showPalette();
			return;
		}
		if (event.command === 'palette-close' && event.success) {
			if (customElements.get('loam-palette')) this.palette?.close();
			return;
		}
		if (!event.success || !event.mutation) return;
		if (/^(toast|modal)-/.test(event.command)) {
			void this.#loadApps().then(() => this.apps?.start());
		} else if (event.command.startsWith('layout-')) void this.readLayout();
		else if (event.command.startsWith('appearance-')) void this.#readAppearance();
		else if (event.personaChanged) {
			// A switch applies the persona's density and theme, and announces it; a removal or a change re-reads it.
			void this.#readAppearance();
			void this.#readPersona(event.command === 'persona-set');
		}
		// After a sign-in or sign-out, or a change of person no command made (phase 3 specification, 4.4).
		else if (event.actorChanged || event.command.startsWith('auth-')) {
			void this.#readSession();
			// Another person's persona: their title, and their emphasis, read before the rail's re-read (4.4, 6.1).
			void this.#readPersona().then(() => this.rail.refresh());
		} else if (event.command === 'view-state-set') {
			void this.readLayout();
			void this.#readAppearance();
		}
	}

	// ─── Presentation ──────────────────────────────────────────────────────────────

	#present(): void {
		const layout = this.layout;
		this.#setState('--_sidebar-width', layout.sidebar.width);
		this.#setState('--_inspector-width', layout.inspector.width);
		this.#setState('--_panel-height', layout.panel.height);
		const rail =
			Number.parseFloat(getComputedStyle(this).getPropertyValue('--shell-size-rail')) || 48;
		const presentation = presentLayout(layout, this.#layoutClass, { width: this.#width, rail });
		this.presentation = presentation;
		this.dataset.layoutClass = presentation.layoutClass;
		this.dataset.sidebar = presentation.sidebar;
		this.dataset.inspector = presentation.inspector;
		this.dataset.panel = presentation.panel;
		this.#measurePanelMax();
	}

	/** The panel's rendered height is capped at main's area less `panel.min`. */
	#measurePanelMax(): void {
		const main = this.shadowRoot?.querySelector('loam-main') as HTMLElement | null;
		const panel = this.shadowRoot?.querySelector('loam-panel') as HTMLElement | null;
		if (!main || !panel || this.presentation.panel !== 'inline') return;
		requestAnimationFrame(() => {
			const area = main.getBoundingClientRect().height + panel.getBoundingClientRect().height;
			this.panelMax = Math.max(
				LAYOUT_DEFAULTS_V0.panel.min,
				Math.floor(area - LAYOUT_DEFAULTS_V0.panel.min)
			);
		});
	}

	/** The only place pixel values from state enter CSS (section 7). */
	#setState(property: StateProperty, value: number): void {
		this.style.setProperty(property, `${value}px`);
	}

	#classChanged(): void {
		const view = this.ownerDocument.defaultView ?? window;
		const previous = this.#layoutClass;
		this.#layoutClass = layoutClassFor((query) => view.matchMedia(query).matches);
		this.#present();
		const { compact } = this.layout;
		if (
			previous === 'compact' &&
			this.#layoutClass !== 'compact' &&
			(compact.drawer !== null || compact.sheet)
		) {
			void this.#change(() => ({ compact: { drawer: null, sheet: false } }));
		}
	}

	// ─── Actions ───────────────────────────────────────────────────────────────────

	#set(patch: LayoutPatchV0) {
		return this.kernel?.call<LayoutStateV0>('layout-set', patch);
	}

	/**
	 * Queue a layout change. `compute` runs once the previous change and its re-read are in, so a
	 * toggle pressed twice quickly toggles twice; it returns no patch when there is nothing to do.
	 */
	#change(compute: () => LayoutPatchV0 | null): Promise<void> {
		const run = this.#layoutQueue.then(async () => {
			const patch = compute();
			if (!patch) return;
			const result = await this.#set(patch);
			if (result?.success) await this.#layoutRead;
		});
		this.#layoutQueue = run.catch(() => {});
		return run;
	}

	/** Close a compact drawer, if one is open: at most one modal (5.3). */
	#closeDrawer(): Promise<void> {
		return this.#change(() =>
			this.layout.compact.drawer !== null && this.#layoutClass === 'compact'
				? { compact: { drawer: null } }
				: null
		);
	}

	async openPalette(query = ''): Promise<void> {
		if (!this.kernel || !this.booted) return;
		await this.#closeDrawer();
		this.#pendingQuery = query;
		await this.kernel.call('palette-open', query ? { query } : {});
	}

	/** Load and define the palette once, and give it its host. */
	preparePalette(): Promise<LoamPalette | null> {
		// A failed load is tried again at the next call.
		this.#paletteHost ??= import('./palette-host.js')
			.then(({ ShellPalette }) => new ShellPalette(this, definePalette))
			.catch((cause: unknown) => {
				this.#paletteHost = null;
				throw cause;
			});
		return this.#paletteHost.then((host) => host.prepare());
	}

	async #showPalette(): Promise<void> {
		// An agent's palette-open closes a drawer here; the chrome's own already did.
		await this.#closeDrawer();
		const query = this.#pendingQuery;
		this.#pendingQuery = '';
		await this.preparePalette();
		await (await this.#paletteHost)?.show(query);
	}

	async toggle(part: 'sidebar' | 'inspector' | 'panel'): Promise<void> {
		if (this.apps?.undeclared(part)) return;
		await this.#change(() => toggleInput(part, this.layout, this.#layoutClass));
	}

	/**
	 * Close a part. When it held focus and was not a modal drawer (which returns focus itself),
	 * focus moves to the part's toggle in the title bar rather than to the page.
	 */
	async #closePart(part: 'sidebar' | 'inspector' | 'panel'): Promise<void> {
		const mode = this.presentation[part];
		const element = this.shadowRoot?.querySelector(`loam-${part}`) ?? null;
		const active = deepActiveElement(this.ownerDocument);
		const hadFocus = element !== null && active !== null && this.#contains(element, active);
		await this.#change(() =>
			this.#layoutClass === 'compact'
				? part === 'panel'
					? { compact: { sheet: false } }
					: { compact: { drawer: null } }
				: { [part]: { open: false } }
		);
		if (hadFocus && mode !== 'drawer') {
			(this.shadowRoot?.querySelector('loam-titlebar') as LoamTitlebar | null)?.focusToggle(part);
		}
	}

	/** Whether `node` is `element` or inside it, through shadow roots. */
	#contains(element: Element, node: Node): boolean {
		let current: Node | null = node;
		while (current) {
			if (current === element) return true;
			const root = current.getRootNode();
			current = current.parentNode ?? (root instanceof ShadowRoot ? root.host : null);
		}
		return false;
	}

	#onAction(detail: ChromeAction): void {
		if (!this.booted) return;
		switch (detail.action) {
			case 'palette-open':
				void this.openPalette();
				break;
			case 'new':
				// The menu is a chunk of its own, loaded on the first press (documents specification, 7).
				void import('../new/new-menu.js').then(({ openNew }) => openNew(this, detail.key));
				break;
			case 'toggle':
				void this.toggle(detail.part);
				break;
			case 'close':
				void this.#closePart(detail.part);
				break;
			case 'maximize':
				void this.#change(() => ({ panel: { maximized: detail.maximized } }));
				break;
			case 'sign-in':
				// A `provider` deployment's dialog, in a chunk of its own (phase 3 specification, 5.2); the Mock's
				// address in `local` mode, as phases 0 to 2 have it.
				if (this.identity) {
					void import('../identity/sign-in.js')
						.then(({ openSignIn }) => openSignIn(this))
						.catch(reportError);
				} else {
					void this.kernel?.call('auth-sign-in', {
						method: 'credentials',
						email: MOCK_SIGN_IN_EMAIL,
					});
				}
				break;
			case 'account-menu':
				void import('../identity/account-menu.js')
					.then(({ openAccountMenu }) => openAccountMenu(this))
					.catch(reportError);
				break;
			case 'sign-out':
				void this.kernel?.call('auth-sign-out');
				break;
		}
	}

	#onResize(event: Event, commit: boolean): void {
		// The listener is on the host, so the target is retargeted to it; the handle is first on the path.
		const handle = event.composedPath()[0] as LoamResizeHandle;
		const part = handle.dataset.resizes as 'sidebar' | 'inspector' | 'panel' | undefined;
		const { value } = (event as CustomEvent<ResizeDetail>).detail;
		if (!part) return;
		if (!commit) {
			const property: StateProperty =
				part === 'panel'
					? '--_panel-height'
					: part === 'sidebar'
						? '--_sidebar-width'
						: '--_inspector-width';
			this.#setState(property, value);
			return;
		}
		void this.#change(() =>
			part === 'panel' ? { panel: { height: value } } : { [part]: { width: value } }
		);
	}

	#onKeydown(event: KeyboardEvent): void {
		if (event.defaultPrevented || !this.kernel || !this.booted) return;
		const binding = matchKeybinding(event, this.mac, this.kernel.listKeybindings());
		// A modal of an app's, like the palette, keeps the keyboard to itself (section 8).
		const paletteOpen =
			(customElements.get('loam-palette') !== undefined && this.palette?.isOpen === true) ||
			this.apps?.modalOpen === true;
		// Mod+S is the editor area's, which answers it first while an editor is the active owner (5.5).
		if (binding && !binding.save) {
			event.preventDefault();
			if (binding.focus) {
				// A modal keeps focus; F6 would otherwise leave it for the browser's toolbar.
				if (!paletteOpen && !this.#drawerOpen()) this.#moveFocus(binding.focus);
				return;
			}
			if (paletteOpen || event.repeat) return;
			if (binding.command === 'palette-open') void this.openPalette();
			else if (binding.toggle) void this.toggle(binding.toggle);
			else if (binding.command) this.apps?.run(binding.command);
			return;
		}
		if (event.key === 'Escape' && !paletteOpen && !this.#drawerOpen()) {
			const p = this.presentation;
			if (p.inspector === 'overlay') void this.#closePart('inspector');
			else if (p.panel === 'sheet') void this.#closePart('panel');
			else if (p.sidebar === 'overlay') void this.#closePart('sidebar');
		}
	}

	#drawerOpen(): boolean {
		return this.presentation.sidebar === 'drawer' || this.presentation.inspector === 'drawer';
	}

	/** The parts present now, in F6's order. */
	presentParts(): PartName[] {
		const parts = [...(this.shadowRoot?.querySelectorAll<HTMLElement>('[data-part]') ?? [])];
		return (
			parts
				// A maximized panel makes main inert, and focus() on an inert part does nothing.
				.filter((part) => !part.hidden && !part.inert && part.dataset.part !== undefined)
				.map((part) => part.dataset.part as PartName)
		);
	}

	#moveFocus(direction: 'next' | 'previous'): void {
		let node: Node | null = deepActiveElement(this.ownerDocument);
		let current: PartName | undefined;
		while (node) {
			if (
				node instanceof HTMLElement &&
				node.dataset.part &&
				node.getRootNode() === this.shadowRoot
			) {
				current = node.dataset.part as PartName;
				break;
			}
			const root = node.getRootNode();
			node = node.parentNode ?? (root instanceof ShadowRoot ? root.host : null);
			if (node === root && root instanceof ShadowRoot) node = root.host;
		}
		const target = nextPart(this.presentParts(), current, direction);
		const element = target
			? this.shadowRoot?.querySelector<HTMLElement>(`[data-part="${target}"]`)
			: null;
		if (element) focusPart(element);
	}
}
observable(LoamShell.prototype, 'layout');
observable(LoamShell.prototype, 'appearance');
observable(LoamShell.prototype, 'presentation');
observable(LoamShell.prototype, 'account');
observable(LoamShell.prototype, 'gate');
observable(LoamShell.prototype, 'notice');
observable(LoamShell.prototype, 'lastSeq');
observable(LoamShell.prototype, 'route');
observable(LoamShell.prototype, 'panelMax');
observable(LoamShell.prototype, 'failure');
observable(LoamShell.prototype, 'booted');
observable(LoamShell.prototype, 'landing');
// Bound to main's `busy`, so a release clears `aria-busy` (documents specification, 6).
observable(LoamShell.prototype, 'mainBusy');
observable(LoamShell.prototype, 'workspaceName');
observable(LoamShell.prototype, 'projectName');
observable(LoamShell.prototype, 'announcement');
observable(LoamShell.prototype, 'persona');

export const shellDefinition = { name: 'loam-shell', template, styles } as const;

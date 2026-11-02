/**
 * @fileoverview `loam-shell`: the grid that hosts the parts, and the controller that binds them
 * to the kernel (phase 0 specification, sections 5 and 7). It holds no layout state of its own:
 * it re-reads `layout-get`, `appearance-get` and `auth-session-get` after the events that change
 * them, sets the three state properties through CSSOM, and turns every person's action into a
 * command.
 */

import { css, FASTElement, html, observable, ref, Updates, when } from '@lushly-dev/fast-element';
import {
	APPEARANCE_QUERIES,
	type AppearanceV0,
	type CommandSummaryV0,
	createDefaultAppearance,
	createDefaultLayout,
	KERNEL_INTERFACE_VERSION,
	type KernelEventV0,
	LAYOUT_DEFAULTS_V0,
	type LayoutPatchV0,
	type LayoutStateV0,
	type LoamKernelV0,
	type PaletteItem,
} from '@lushly-dev/loam-kernel';
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
import type { ResizeDetail } from '../resize.js';
import { createRouter, type RouterV0, type RouteV0 } from '../router.js';
import type { StateProperty } from '../state-properties.js';
import { applyAppearance } from '../theme.js';
import { ACTION_EVENT, type ChromeAction, deepActiveElement } from './events.js';
import type { LoamPalette, PaletteFailure, PaletteResult } from './palette.js';
import { definePalette, whenIdle } from './palette-loader.js';
import type { LoamResizeHandle } from './resize-handle.js';
import type { LoamTitlebar } from './titlebar.js';

/** What the shell reads the last sequence number from at boot. */
export interface JournalReader {
	read(): Promise<readonly { seq: number }[]>;
}

/** The address the title bar's "Sign in" uses with the Mock adapter (6.5). */
export const MOCK_SIGN_IN_EMAIL = 'person@example.com';

interface SessionState {
	status: string;
	user?: { name?: string; email?: string };
}

interface ShellFailure {
	heading: string;
	message: string;
}

/**
 * Focus a part's host for F6. A shadow host with a negative `tabindex` takes its whole shadow
 * tree out of the Tab order, so the part has one only while it holds focus itself: Tab, or focus
 * moving anywhere, removes it, and Tab then continues into the part.
 */
export function focusPart(element: HTMLElement): void {
	element.setAttribute('tabindex', '-1');
	const clear = (event: Event) => {
		if (event instanceof KeyboardEvent && event.key !== 'Tab') return;
		element.removeAttribute('tabindex');
		element.removeEventListener('keydown', clear);
		element.removeEventListener('blur', clear);
	};
	element.addEventListener('keydown', clear);
	element.addEventListener('blur', clear);
	element.focus();
}

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
				route="${(x) => x.route}"
				shortcut="${(x) => x.shortcut}"
				home="${(x) => x.home}"
				?inert="${(x) => x.presentation.panel === 'maximized'}"
			></loam-main>
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
		`
	)}
`;

const styles = css`
	:host {
		display: grid;
		box-sizing: border-box;
		inline-size: 100%;
		block-size: 100dvh;
		overflow: hidden;
		background: var(--color-surface-page);
		color: var(--color-text-primary);
		font-family: 'Montserrat', 'Segoe UI', sans-serif;
		font-size: var(--type-body-md-size);
		line-height: var(--type-body-md-line);
		font-weight: var(--type-body-md-weight);
		grid-template-columns: auto auto minmax(0, 1fr) auto;
		grid-template-rows: auto minmax(0, 1fr) auto auto auto;
	}
	:host([data-panel='inline']) {
		grid-template-rows:
			auto minmax(var(--shell-size-panel-min), 1fr) minmax(0, var(--_panel-height))
			auto auto;
	}
	:host([data-panel='maximized']) {
		grid-template-rows: auto 0 minmax(0, 1fr) auto auto;
	}
	loam-titlebar {
		grid-column: 1 / -1;
		grid-row: 1;
	}
	loam-rail {
		grid-column: 1;
		grid-row: 2 / 4;
	}
	loam-sidebar {
		grid-column: 2;
		grid-row: 2 / 4;
		inline-size: var(--_sidebar-width);
	}
	loam-main {
		grid-column: 3;
		grid-row: 2;
	}
	:host([data-panel='maximized']) loam-main {
		overflow: hidden;
		padding-block: 0;
	}
	loam-panel {
		grid-column: 3;
		grid-row: 3;
	}
	loam-inspector {
		grid-column: 4;
		grid-row: 2 / 4;
		inline-size: var(--_inspector-width);
	}
	loam-statusbar {
		grid-column: 1 / -1;
		grid-row: 4;
	}
	loam-tabbar {
		grid-column: 1 / -1;
		grid-row: 5;
	}
	:host([data-sidebar='overlay']) loam-sidebar {
		grid-column: 3;
		justify-self: start;
		inline-size: min(var(--_sidebar-width), 85vw);
	}
	:host([data-inspector='overlay']) loam-inspector {
		grid-column: 3;
		justify-self: end;
		inline-size: min(var(--_inspector-width), 85vw);
	}
	:host([data-panel='sheet']) loam-panel {
		grid-column: 1 / -1;
		grid-row: 2;
		align-self: end;
		block-size: clamp(40dvh, var(--_panel-height), 80dvh);
	}
	@media (forced-colors: active) {
		:host {
			background: Canvas;
			color: CanvasText;
		}
	}
`;

export class LoamShell extends FASTElement {
	declare layout: LayoutStateV0;
	declare appearance: AppearanceV0;
	declare presentation: PresentationV0;
	declare account: string;
	declare lastSeq: number;
	declare route: RouteV0;
	declare panelMax: number;
	declare failure: ShellFailure | null;
	/** True once the first appearance, layout and session reads are in, so parts render themed. */
	declare booted: boolean;
	declare palette: LoamPalette;
	declare sidebarHandle: LoamResizeHandle;
	declare inspectorHandle: LoamResizeHandle;
	declare panelHandle: LoamResizeHandle;

	/** The kernel the chrome binds to; set it before or after connecting. */
	kernel: LoamKernelV0 | null = null;
	/** Where the shell reads the journal's last sequence number at boot. */
	journal: JournalReader | null = null;
	readonly mac: boolean;
	/** Where main's "Nothing here" links home: the document's base path unless set. */
	home: string;

	#layoutClass: LayoutClass = 'expanded';
	#width = 0;
	#commands = new Map<string, CommandSummaryV0>();
	#cleanup: (() => void)[] = [];
	#started: Promise<void> | null = null;
	#reads = { layout: 0, appearance: 0, session: 0 };
	#pendingQuery = '';
	#router: RouterV0 | null = null;

	constructor() {
		super();
		this.layout = createDefaultLayout();
		const appearance = createDefaultAppearance();
		this.appearance = { ...appearance, resolved: 'light' };
		this.presentation = presentLayout(this.layout, 'expanded', { width: 1280, rail: 48 });
		this.account = '';
		this.lastSeq = 0;
		this.route = 'home';
		this.panelMax = LAYOUT_DEFAULTS_V0.panel.default;
		this.failure = null;
		this.booted = false;
		this.mac = isMacPlatform(globalThis.navigator);
		this.home = new URL('./', globalThis.document?.baseURI ?? 'http://localhost/').pathname;
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
		this.#router?.dispose();
		this.#router = null;
		this.#started = null;
		super.disconnectedCallback();
	}

	/** Bind to a kernel and read its state. */
	start(kernel: LoamKernelV0): Promise<void> {
		this.kernel = kernel;
		if (!this.$fastController.isConnected) return Promise.resolve();
		this.#started ??= this.#start(kernel);
		return this.#started;
	}

	async #start(kernel: LoamKernelV0): Promise<void> {
		if (kernel.version !== KERNEL_INTERFACE_VERSION) {
			this.failure = {
				heading: 'Loam cannot start',
				message: `The chrome needs kernel interface ${KERNEL_INTERFACE_VERSION}, and this kernel has interface ${String(kernel.version)}.`,
			};
			return;
		}
		const view = this.ownerDocument.defaultView ?? window;
		for (const command of kernel.listCommands()) this.#commands.set(command.name, command);

		this.#cleanup.push(kernel.subscribe((event) => this.#onEvent(event)));
		this.#listen(view, 'keydown', (event) => this.#onKeydown(event as KeyboardEvent));
		this.#listen(view, 'pagehide', () => void kernel.flush());
		this.#listen(this.ownerDocument, 'visibilitychange', () => {
			if (this.ownerDocument.visibilityState === 'hidden') void kernel.flush();
		});
		this.#listen(this, ACTION_EVENT, (event) =>
			this.#onAction((event as CustomEvent<ChromeAction>).detail)
		);
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
		this.#router = createRouter(view, (route) => {
			this.route = route;
		});

		const entries = (await this.journal?.read()) ?? [];
		this.lastSeq = Math.max(this.lastSeq, entries.at(-1)?.seq ?? 0);
		// Appearance first, so the parts render in their theme with no transition from light.
		await this.#readAppearance();
		await Promise.all([this.#readLayout(), this.#readSession()]);
		this.booted = true;
		this.#present();
		whenIdle(view, () => void this.preparePalette());
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

	#readLayout(): Promise<void> {
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

	async #readSession(): Promise<void> {
		const generation = ++this.#reads.session;
		const result = await this.kernel?.call<SessionState>('auth-session-get');
		if (!result?.success || generation !== this.#reads.session) return;
		const session = result.data as SessionState;
		this.account =
			session.status === 'authenticated' ? (session.user?.name ?? session.user?.email ?? '') : '';
	}

	#onEvent(event: KernelEventV0): void {
		if (event.seq !== undefined) this.lastSeq = Math.max(this.lastSeq, event.seq);
		if (!this.booted) return;
		if (event.command === 'palette-open' && event.success) {
			void this.#showPalette();
			return;
		}
		if (event.command === 'palette-close' && event.success) {
			if (customElements.get('loam-palette')) this.palette?.close();
			return;
		}
		if (!event.success || !event.mutation) return;
		if (event.command.startsWith('layout-')) void this.#readLayout();
		else if (event.command.startsWith('appearance-')) void this.#readAppearance();
		else if (event.command.startsWith('auth-')) void this.#readSession();
		else if (event.command === 'view-state-set') {
			void this.#readLayout();
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

	#palette: Promise<LoamPalette | null> | null = null;

	/** Load and define the palette once, and give it its host. */
	preparePalette(): Promise<LoamPalette | null> {
		this.#palette ??= definePalette().then(() => {
			const palette = this.palette;
			const kernel = this.kernel;
			if (!palette || !kernel) {
				// Not rendered yet: try again on the next call rather than keep the miss.
				this.#palette = null;
				return null;
			}
			palette.host = {
				search: (query) => this.#search(query),
				run: (name) => this.#runFromPalette(name),
				close: () => void kernel.call('palette-close'),
			};
			return palette;
		});
		return this.#palette;
	}

	async #showPalette(): Promise<void> {
		// An agent's palette-open closes a drawer here; the chrome's own already did.
		await this.#closeDrawer();
		const query = this.#pendingQuery;
		this.#pendingQuery = '';
		let palette = await this.preparePalette();
		// The shell may not have rendered its palette yet; preparePalette forgets a miss, so retry.
		for (let attempt = 0; attempt < 60 && !palette; attempt++) {
			await Updates.next();
			palette = await this.preparePalette();
		}
		await palette?.open(query);
	}

	async toggle(part: 'sidebar' | 'inspector' | 'panel'): Promise<void> {
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
				void this.kernel?.call('auth-sign-in', {
					method: 'credentials',
					email: MOCK_SIGN_IN_EMAIL,
				});
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
		const binding = matchKeybinding(event, this.mac);
		const paletteOpen =
			customElements.get('loam-palette') !== undefined && this.palette?.isOpen === true;
		if (binding) {
			event.preventDefault();
			if (binding.focus) {
				// A modal keeps focus; F6 would otherwise leave it for the browser's toolbar.
				if (!paletteOpen && !this.#drawerOpen()) this.#moveFocus(binding.focus);
				return;
			}
			if (paletteOpen || event.repeat) return;
			if (binding.command === 'palette-open') void this.openPalette();
			else if (binding.toggle) void this.toggle(binding.toggle);
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

	// ─── The palette ───────────────────────────────────────────────────────────────

	async #search(query: string): Promise<PaletteResult[]> {
		const result = await this.kernel?.call<{ items: PaletteItem[] }>('palette-search', {
			query,
			limit: 20,
		});
		if (!result?.success) return [];
		return (result.data as { items: PaletteItem[] }).items.map((item) => {
			const summary = this.#commands.get(item.name);
			return {
				name: item.name,
				...(item.title !== undefined ? { title: item.title } : {}),
				description: item.description,
				disabled: summary?.needsInput === true,
				...(summary?.keybinding !== undefined ? { keybinding: summary.keybinding } : {}),
			};
		});
	}

	async #runFromPalette(name: string): Promise<PaletteFailure | null> {
		const kernel = this.kernel;
		if (!kernel) return null;
		const result = await kernel.call(name, {});
		if (!result.success) {
			return {
				message: result.error?.message ?? `${name} failed`,
				...(result.error?.suggestion !== undefined ? { suggestion: result.error.suggestion } : {}),
			};
		}
		if (name !== 'palette-close' && name !== 'palette-open') await kernel.call('palette-close');
		return null;
	}
}
observable(LoamShell.prototype, 'layout');
observable(LoamShell.prototype, 'appearance');
observable(LoamShell.prototype, 'presentation');
observable(LoamShell.prototype, 'account');
observable(LoamShell.prototype, 'lastSeq');
observable(LoamShell.prototype, 'route');
observable(LoamShell.prototype, 'panelMax');
observable(LoamShell.prototype, 'failure');
observable(LoamShell.prototype, 'booted');

export const shellDefinition = { name: 'loam-shell', template, styles } as const;

/**
 * @fileoverview `RailBands`, in first paint (phase 2 specification, 7.2): the controller that owns the
 * rail's and the tab bar's entries. It reads `app-list`, only when the deployment lists an app so an empty
 * shell's journal gains nothing, and `scope-get` and `section-get`, which are unjournaled, and places each
 * entry by `bandFor`. It re-reads on an event with `scopeChanged` or `mainChanged`, after `project-*` and
 * `workspace-app-set`, and when stage B ends. One element per app and variant moves between the bands:
 * with `moveBefore` where the browser has it, which keeps its focus, and otherwise re-inserted, with focus
 * given back if it held it (7.1).
 *
 * From the same reads it sets what names the scope: the status bar's left items, `document.title` (7.4),
 * and the live region's announcement of a change of scope (7.8). The app surfaces take their `app-list`
 * from {@link RailBands.fresh}, so one read serves both.
 */

import type { AppSummaryV2, KernelEventV2, ScopeChangeV2 } from '@lushly-dev/loam-kernel';
import type { LoamAppEntry } from '../elements/app-entry.js';
import type { LoamAppNav } from '../elements/app-nav.js';
import type { LoamProjectSwitcher } from '../elements/project-switcher.js';
import type { LoamShell } from '../elements/shell.js';
import type { MainStateV1 } from '../url-sync.js';
import { bandFor, dimmedTip, railOrder } from './bands.js';

export interface AppListV2 {
	active: string | null;
	apps: AppSummaryV2[];
}

const SECTIONS: Record<string, string> = { projects: 'Projects', documents: 'Documents' };
const VARIANTS = ['rail', 'tabbar'] as const;

/** Move `entry` before `before` in `list`, keeping its focus (7.1). */
function place(list: Element, entry: HTMLElement, before: Element | null): void {
	const move = (list as Element & { moveBefore?: Element['insertBefore'] }).moveBefore;
	if (move && entry.isConnected) {
		move.call(list, entry, before);
		return;
	}
	const focused = entry.matches(':focus-within');
	list.insertBefore(entry, before);
	if (focused) entry.shadowRoot?.querySelector('button')?.focus();
}

export class RailBands {
	readonly #shell: LoamShell;
	readonly #entries = new Map<string, LoamAppEntry[]>();
	/** Mutations and failures seen: a read made since the last one is fresh. */
	#changes = 0;
	#read: { at: number; done: Promise<AppListV2 | undefined> } | null = null;
	#started = 0;
	#list: AppListV2 | undefined;
	#state: MainStateV1 | undefined;
	#icons = false;

	constructor(shell: LoamShell) {
		this.#shell = shell;
	}

	/** Each kernel event, from the shell's one subscription. */
	heard(event: KernelEventV2): void {
		if (event.mutation || !event.success) this.#changes++;
		if (
			event.scopeChanged ||
			event.mainChanged ||
			(event.success && event.mutation && /^(project-|workspace-app-set$)/.test(event.command))
		) {
			void this.refresh(event.scopeChanged);
		}
	}

	/** `app-list` as it is since the last change: the read in flight, or a new one. */
	fresh(): Promise<AppListV2 | undefined> {
		return this.#read?.at === this.#changes ? this.#read.done : this.refresh();
	}

	/** Read again and render; `change` is announced once read. */
	refresh(change?: ScopeChangeV2): Promise<AppListV2 | undefined> {
		const done = this.#refresh(change, ++this.#started);
		this.#read = { at: this.#changes, done };
		return done;
	}

	/**
	 * `app-list`, only when the deployment lists an app, and the scope and main: what the rail shows. The
	 * shell's first frame reads it too. A read that failed, or was not made, keeps the last list.
	 */
	async read(): Promise<[AppListV2 | undefined, MainStateV1]> {
		const shell = this.#shell;
		const lists = shell.listsApps || shell.appCount > 0;
		const [listed, state] = await Promise.all([
			lists ? shell.kernel?.call<AppListV2>('app-list') : undefined,
			shell.readState(),
		]);
		const list = listed?.success ? listed.data : undefined;
		if (list) {
			shell.appList = list.apps;
			shell.appCount = list.apps.length;
		}
		return [list, state];
	}

	async #refresh(change: ScopeChangeV2 | undefined, started: number) {
		const [list, state] = await this.read();
		// A later read renders over this one, never the reverse.
		if (started !== this.#started) return list;
		this.render(list ?? this.#list, state);
		if (change) {
			const left = this.#list?.apps.find((app) => app.instance === change.left)?.title;
			this.#shell.announcement = `${state.project ? `Project: ${state.project.name}` : 'No project'}${left ? `. ${left} closed` : ''}`;
		}
		return list;
	}

	/** `ICONS_V1` has registered, with the app surfaces: entries show their icons now (2.4). */
	showIcons(): void {
		this.#icons = true;
		if (this.#state) this.render(this.#list, this.#state);
	}

	/** Place every entry for `list` and the scope `state` names. */
	render(list: AppListV2 | undefined, state: MainStateV1): void {
		this.#list = list;
		this.#state = state;
		const shell = this.#shell;
		const { project } = state;
		const active = list?.active ?? null;
		const navs = VARIANTS.map(
			(variant) => shell.shadowRoot?.querySelector(`loam-${variant}`) as LoamAppNav | null
		);
		for (const nav of navs) {
			if (!nav?.shadowRoot) continue;
			for (const entry of nav.shadowRoot.querySelectorAll<LoamAppEntry & { section: string }>(
				'.top loam-section-entry'
			)) {
				entry.current = active === null && entry.section === state.section;
				entry.tip = nav.variant === 'rail' ? entry.label : '';
			}
			const switcher = nav.shadowRoot.querySelector<LoamProjectSwitcher>('loam-project-switcher');
			if (switcher) {
				switcher.project = project?.name ?? '';
				switcher.icon = (this.#icons && project?.icon) || 'system/folder';
			}
		}
		const kept = new Set<string>();
		const bands = { top: [[], []], bottom: [[], []] } as Record<'top' | 'bottom', LoamAppEntry[][]>;
		for (const app of [...(list?.apps ?? [])].sort(railOrder)) {
			const placement = bandFor(app, state.scope.project);
			if (!placement) continue;
			kept.add(app.instance);
			let entries = this.#entries.get(app.instance);
			if (!entries) {
				entries = VARIANTS.map((variant) => {
					const entry = shell.ownerDocument.createElement('loam-app-entry') as LoamAppEntry;
					entry.variant = variant;
					entry.instance = app.instance;
					return entry;
				});
				this.#entries.set(app.instance, entries);
			}
			for (const [index, entry] of entries.entries()) {
				entry.label = app.title;
				// Blank until the app surfaces register `ICONS_V1` (phase 2 specification, 2.4).
				entry.icon = this.#icons ? app.icon : '';
				entry.state = app.state;
				entry.current = app.instance === active;
				entry.dimmed = placement.dimmed;
				entry.tip = placement.dimmed
					? dimmedTip(app.title, project?.name)
					: entry.variant === 'rail'
						? entry.accessibleLabel
						: '';
				bands[placement.band][index]?.push(entry);
			}
		}
		for (const [instance, entries] of this.#entries) {
			if (kept.has(instance)) continue;
			for (const entry of entries) entry.remove();
			this.#entries.delete(instance);
		}
		for (const [index, nav] of navs.entries()) {
			if (!nav?.shadowRoot) continue;
			for (const band of ['top', 'bottom'] as const) {
				const ul = nav.band(band);
				// The top band opens with Projects, the switcher and Documents.
				const fixed = band === 'top' ? 3 : 0;
				for (const [at, entry] of (bands[band][index] ?? []).entries()) {
					const there = ul.children[fixed + at] ?? null;
					if (there !== entry) place(ul, entry, there);
				}
			}
		}
		const main =
			list?.apps.find((app) => app.instance === state.active)?.title ??
			SECTIONS[state.section ?? ''];
		shell.workspaceName = state.workspace.name ?? state.workspace.id;
		shell.projectName = project?.name ?? '';
		shell.ownerDocument.title = [main, project?.name, state.workspace.name]
			.filter(Boolean)
			.join(' · ');
	}
}

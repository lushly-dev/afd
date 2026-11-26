/**
 * @fileoverview The `settings` chunk (phase 4 specification, 3.5, 3.7 and 15), loaded when main first shows the
 * settings section, at `/<workspace>[/p/<project>]/~/settings[/<section>[#<key>]]`:
 *
 * - `loam-settings-section`: a tree of the sections the kernel lists (the shell's first, then each enabled app's;
 *   a section gated by an experiment is absent because the kernel leaves it out, step 9's seam), a level switcher (a
 *   tab list: "You, everywhere", "Workspace" and, while a project is active, "Project <name>"), and each key's field
 *   with where its value comes from, who set it and when, and Reset;
 * - the console's schema form for a key (`../forms/setting-field.ts`), and the three custom editors of 3.7
 *   (`editors.ts`) for the shell's keys the form cannot show.
 *
 * Every read and write is a command: `setting-schema-get`, `setting-list`, `setting-set` with `expected`, and
 * `setting-reset`; the Limits section's usage beside each key is `limit-usage-get` (section 11). No app code runs here:
 * an app's section is its manifest's schema, rendered by the shell.
 */

import type { AppSummary, LoamKernel } from '@lushly-dev/loam-kernel';
import type { LoamShell } from '../elements/shell.js';
import { type SettingKeySchema, settingField } from '../forms/setting-field.js';
import {
	AUTONOMY_SECTION_ELEMENT,
	defineAutonomySection,
	type LoamAutonomySection,
} from './autonomy.js';
import type { ListedBindingV1 } from './editor-rules.js';
import {
	CUSTOM_EDITORS,
	defineEditors,
	type LoamInstancePicker,
	type LoamKeybindingEditor,
	type LoamRailOrderEditor,
} from './editors.js';
import {
	defineExperimentsSection,
	EXPERIMENTS_SECTION_ELEMENT,
	type LoamExperimentsSection,
} from './experiments.js';
import { type SettingsSectionState, settingsHashTarget } from './hash-route.js';
import {
	LIMIT_KEYS,
	type LimitKey,
	type LimitUsageRow,
	usageLine,
	usageUnavailable,
} from './limits-words.js';
import { button, dateText, el, SettingsElement } from './parts.js';

type Level = 'person' | 'workspace' | 'project';

interface Answer<T = unknown> {
	success: boolean;
	data?: T;
	error?: { code?: string; message?: string; suggestion?: string };
}

/** A section as `setting-schema-get { outline: true }` lists it (3.9): its keys by title, no schema. */
export interface SectionOutline {
	section: string;
	title: string;
	description?: string;
	levels: Level[];
	/** The owning app's title, and its instance, whose group the section is in; none for the shell's. */
	app?: string;
	instance?: string;
	keys: Array<{ key: string; title: string; levels: Level[] }>;
}

/** A section with its keys' schemas, read for the one shown. */
export interface SectionSchema extends SectionOutline {
	schema: { properties: Record<string, SettingKeySchema & { levels?: Level[] }> };
}

/** The scope a panel shows, which every one of its reads and writes is made in (3.5). */
type PanelScope = { workspace: string; project?: string };

/** One key's value as `setting-list` answers it for a level (3.9). */
interface ValueRow {
	section: string;
	key: string;
	value: unknown;
	from: Level | 'default';
	updatedAt?: number;
	updatedBy?: string;
	writable: boolean;
	reason?: string;
}

const LEVEL_ORDER: readonly Level[] = ['person', 'workspace', 'project'];

/**
 * The autonomy section (4.5), the shell's, after Keybindings as 3.5 orders the tree: its own commands write it, so it
 * is no section `setting-schema-get` lists, and its panel is `loam-autonomy-section`, not fields.
 */
const AUTONOMY: SectionOutline = {
	section: 'loam.autonomy',
	title: 'Autonomy',
	description: 'How far agents act on their own for you: act, ask first, or only suggest.',
	levels: [],
	keys: [],
};

/**
 * The experiments list (5.4), the shell's, after Autonomy as 3.5 orders the tree: only `experiment-*` writes it, so it
 * is no section `setting-schema-get` lists, and its panel is `loam-experiments-section`, not fields.
 */
const EXPERIMENTS: SectionOutline = {
	section: 'loam.experiments',
	title: 'Experiments',
	description: 'New things the apps offer to try, with what each may change and when it ends.',
	levels: [],
	keys: [],
};

/** The sections whose panel is their own element, with no fields and no level switcher. */
const OWN_PANELS: readonly SectionOutline[] = [AUTONOMY, EXPERIMENTS];

/** The Limits section (3.7, section 11), whose fields show what each app uses of them. */
const LIMITS = 'loam.limits';

/** What the panel's fields are given besides their rows: the keybinding editor's commands, the Limits' usage. */
interface PanelExtra {
	commands: Array<{ name: string; title?: string }>;
	/** The keybinding editor's: every binding, for its warnings (8.3). */
	bindings?: ListedBindingV1[];
	usage?: Partial<Record<string, string>>;
	storage?: string;
}

/** Where a value comes from, in words (3.5). */
const FROM_WORDS: Record<ValueRow['from'], string> = {
	person: 'Your own value',
	project: 'Set for this project',
	workspace: 'Set for the workspace',
	default: 'The default',
};

/** Why a key is not the caller's to change here, in words; the kernel's code otherwise. */
const REASON_WORDS: Record<string, string> = {
	OWNER_REQUIRED: 'Only an owner of the workspace can change this.',
	HUMAN_REQUIRED: 'Only a person can change this, here in the shell.',
	PROJECT_ARCHIVED: 'This project is archived, so its settings cannot change.',
	SHARED_RECORD_UNAVAILABLE: 'This deployment cannot keep shared values yet.',
	APP_DISABLED: 'This app is not enabled for this project.',
};

/** Who set a value: an agent says so, and `local` is the one person of a local workspace. */
const whoSet = (by: string): string =>
	by.startsWith('agent:') ? `an agent (${by.slice('agent:'.length)})` : by === 'local' ? 'you' : by;

/** A failure in words: its message and what to do, never a code alone. */
const failed = (answer: Answer): string => {
	const { message, suggestion } = answer.error ?? {};
	return [message ?? 'That did not work', suggestion].filter(Boolean).join('. ');
};

/** `loam-settings-section` (3.5): the tree, the level switcher and the fields. */
export class LoamSettingsSection extends SettingsElement {
	kernel: LoamKernel | null = null;
	/** The project the call's scope names, and its name for the switcher, or none at workspace level. */
	project: { id: string; name: string } | null = null;
	workspace = '';
	/** The rows `app-list` gave, for the editors' apps. */
	apps: readonly AppSummary[] = [];
	/** The level the switcher shows; kept across sections while it applies. */
	level: Level | null = null;
	#sections: SectionOutline[] = [];
	#selected: SectionSchema | undefined;
	#target: string | undefined;
	#collapsed = new Set<string>();
	/** Separate counters for `show()` and `#readPanel()` so a panel re-read never aborts a scope change (#2097). */
	#shows = 0;
	#panelReads = 0;
	/** True while `show()` is fetching the new scope/section schema so `#readPanel()` cannot paint under stale chrome. */
	#showing = false;
	/** Whether `#renderTree()` and `#renderHeader()` should paint atomically with the next panel commit. */
	#needsChrome = false;
	#status: HTMLElement | undefined;
	#tree: HTMLElement | undefined;
	#header: HTMLElement | undefined;
	#panel: HTMLElement | undefined;
	#unsubscribe: (() => void) | null = null;
	/**
	 * Each shown key's row, the level and the scope it was read at: what a write's `expected`, level and scope are, so a
	 * control left from before a change of scope writes where it shows, never in the new scope.
	 */
	#current = new Map<string, { row: ValueRow; level: Level; scope: PanelScope }>();
	/** The path last shown, read again when an experiment's change adds or takes away a section (5.3). */
	#shown: string | undefined;
	/** Whether the route's key is still to be given to the autonomy section, once per navigation (`#cap`). */
	#targetPending = false;
	/** A link within the section, `#<key>`, by Back or a person's link with no route change (3.5, #2098). */
	#hashHeard = async () => {
		const target = await settingsHashTarget(
			location,
			this.#selected?.section,
			() =>
				(this.kernel?.call<SettingsSectionState>('section-get') ??
					Promise.resolve(undefined)) as Promise<
					{ success: boolean; data?: SettingsSectionState } | undefined
				>
		);
		if (!target || !this.isConnected) return;
		void this.kernel?.call('section-open', { section: 'settings', target });
	};

	/** The scope this panel shows. */
	get scope(): PanelScope {
		return this.project === null
			? { workspace: this.workspace }
			: { workspace: this.workspace, project: this.project.id };
	}

	/** Forget what was read in another scope: no control of it writes until the panel is read again (2). */
	forgetScope(): void {
		this.#panelReads++;
		this.#current.clear();
		this.#panel?.replaceChildren();
	}

	/** A call in the scope the panel shows. */
	#call<T>(name: string, input: unknown): Promise<Answer<T>> {
		return (this.kernel?.call(name, input, { scope: this.scope }) ??
			Promise.resolve({ success: false })) as Promise<Answer<T>>;
	}

	connectedCallback(): void {
		const root = this.shadowRoot as ShadowRoot;
		if (!root.querySelector('.section')) {
			this.#status = el('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
			this.#tree = el('ul', { role: 'tree', 'aria-label': 'Settings sections' });
			this.#header = el('div', { class: 'section' });
			this.#panel = el('div', { role: 'tabpanel', id: 'settings-panel', class: 'fields' });
			this.#tree.addEventListener('keydown', (event) => this.#treeKey(event));
			root.append(
				el(
					'section',
					{ class: 'section', 'aria-labelledby': 'settings-heading' },
					el('h1', { id: 'settings-heading', tabindex: '-1' }, 'Settings'),
					this.#status,
					el(
						'div',
						{ class: 'columns' },
						el('nav', { 'aria-label': 'Settings sections' }, this.#tree),
						el('div', { class: 'section' }, this.#header, this.#panel)
					)
				)
			);
		}
		globalThis.addEventListener?.('hashchange', this.#hashHeard);
		// A change from elsewhere, another tab's or an agent's, reads the shown section again.
		this.#unsubscribe ??=
			this.kernel?.subscribe((event) => {
				const { settings: changed, experiments } = event as {
					settings?: string[];
					experiments?: true;
				};
				// An experiment's change adds or takes away a gated section (5.3): the tree is read again, at the same place.
				if (experiments && this.#shown !== undefined) void this.show(this.#shown);
				else if (this.#selected && changed?.includes(this.#selected.section))
					void this.#readPanel();
			}) ?? null;
	}

	disconnectedCallback(): void {
		globalThis.removeEventListener?.('hashchange', this.#hashHeard);
		this.#unsubscribe?.();
		this.#unsubscribe = null;
	}

	focusHeading(): void {
		this.shadowRoot?.querySelector<HTMLElement>('h1')?.focus();
	}

	#say(text: string): void {
		if (this.#status) this.#status.textContent = text;
	}

	/** Show the section and key `path` names, `<section>[/<key>]`, reading the sections again. */
	async show(path: string): Promise<void> {
		const kernel = this.kernel;
		if (!kernel) return;
		this.#shown = path;
		const shown = ++this.#shows;
		this.#panelReads++;
		this.#showing = true;
		// The tree from an outline, which fits the budget however large one section is; the shown section on its own.
		const read = await this.#call<{ sections: SectionOutline[] }>('setting-schema-get', {
			outline: true,
		});
		if (shown !== this.#shows) return;
		const failedRead = (answer: Answer) => {
			this.#showing = false;
			this.#needsChrome = false;
			this.#panelReads++;
			this.#current.clear();
			this.#sections = [];
			this.#selected = undefined;
			this.#tree?.replaceChildren();
			this.#header?.replaceChildren();
			this.#panel?.replaceChildren(el('p', {}, failed(answer)));
		};
		if (!read.success || !read.data) return failedRead(read);
		this.#sections = [...read.data.sections];
		const keybindings = this.#sections.findIndex(
			(section) => section.section === 'loam.keybindings'
		);
		this.#sections.splice(keybindings + 1, 0, AUTONOMY, EXPERIMENTS);
		const [id = '', key] = path.split('/');
		const outline = this.#sections.find((section) => section.section === id) ?? this.#sections[0];
		const target = outline?.section === id ? key : undefined;
		if (id !== '' && outline?.section !== id) {
			this.#say(`There is no section ${id} here. Showing ${outline?.title ?? 'none'}.`);
		}
		const selected =
			outline && OWN_PANELS.includes(outline)
				? { ...outline, schema: { properties: {} } }
				: outline
					? await this.#schemaOf(outline)
					: undefined;
		if (shown !== this.#shows) return;
		if (selected && 'success' in selected) return failedRead(selected);
		this.#selected = selected;
		this.#target = target;
		this.#targetPending = target !== undefined;
		// A key named by the link chooses the level: the narrowest its own levels allow here (3.5).
		const levels = outline?.keys.find((each) => each.key === target)?.levels;
		if (levels) this.level = this.#narrowest(levels) ?? null;
		this.#showing = false;
		this.#needsChrome = true;
		await this.#readPanel();
		if (shown !== this.#shows) return;
		if (this.#target) {
			this.shadowRoot
				?.querySelector<HTMLElement>(`#key-${CSS.escape(this.#target)}`)
				?.scrollIntoView({ block: 'nearest' });
		}
	}

	/**
	 * The shown section with its keys' schemas: the whole section, or key by key when the section alone is over the
	 * command's budget, so a large section still shows every field. A refusal of the read otherwise.
	 */
	async #schemaOf(outline: SectionOutline): Promise<SectionSchema | Answer> {
		type Read = { sections: Array<{ schema: SectionSchema['schema'] }> };
		const whole = await this.#call<Read>('setting-schema-get', { section: outline.section });
		if (whole.success && whole.data?.sections[0])
			return { ...outline, schema: whole.data.sections[0].schema };
		if (whole.error?.code !== 'OUTPUT_BUDGET_EXCEEDED') return whole;
		const properties: SectionSchema['schema']['properties'] = {};
		for (const { key } of outline.keys) {
			const one = await this.#call<Read>('setting-schema-get', { section: outline.section, key });
			const declared = one.data?.sections[0]?.schema.properties[key];
			if (!one.success || !declared) return one;
			properties[key] = declared;
		}
		return { ...outline, schema: { properties } };
	}

	/** The levels the selected section may be set at here: no project level outside a project. */
	get levels(): Level[] {
		const allowed = this.#selected?.levels ?? [];
		return LEVEL_ORDER.filter(
			(level) => allowed.includes(level) && (level !== 'project' || this.project !== null)
		);
	}

	/** Of `allowed`, the narrowest here: the person's, else the project's in a project, else the workspace's. */
	#narrowest(allowed: readonly Level[]): Level | undefined {
		const here = this.levels.filter((level) => allowed.includes(level));
		return here.includes('person') ? 'person' : here.includes('project') ? 'project' : here[0];
	}

	/** The level shown: the one chosen, while it applies; else the narrowest here, as `setting-list` reads one. */
	get shownLevel(): Level | undefined {
		const levels = this.levels;
		if (this.level && levels.includes(this.level)) return this.level;
		return this.#narrowest(levels);
	}

	// ─── The tree (15: a `tree`) ───────────────────────────────────────────────

	#renderTree(): void {
		const tree = this.#tree;
		if (!tree) return;
		const focused = this.shadowRoot?.activeElement?.getAttribute('role') === 'treeitem';
		// By whose the section is, the shell's or an instance's, and its title only as the label: an app titled "Shell"
		// is not the shell's, and two apps of one title are told apart by their instances.
		const groups = new Map<string, SectionOutline[]>();
		for (const section of this.#sections) {
			const group = section.instance === undefined ? 'shell' : `app:${section.instance}`;
			groups.set(group, [...(groups.get(group) ?? []), section]);
		}
		const titleOf = (section: SectionOutline) => section.app ?? 'Shell';
		const titles = [...groups.values()].map((sections) => titleOf(sections[0] as SectionOutline));
		tree.replaceChildren(
			...[...groups].map(([group, sections]) => {
				const first = sections[0] as SectionOutline;
				const title = titleOf(first);
				const label =
					titles.filter((each) => each === title).length > 1 && first.instance !== undefined
						? `${title} (${first.instance})`
						: title;
				const expanded = !this.#collapsed.has(group);
				const item = el(
					'li',
					{
						role: 'treeitem',
						'aria-expanded': String(expanded),
						'data-group': group,
						tabindex: '-1',
					},
					el('span', { class: 'label' }, label)
				);
				item.addEventListener('click', (event) => {
					if (event.target !== item && (event.target as HTMLElement).parentElement !== item) return;
					this.#toggle(group);
				});
				if (expanded) {
					item.append(
						el(
							'ul',
							{ role: 'group' },
							...sections.map((section) => {
								const selected = section.section === this.#selected?.section;
								const leaf = el(
									'li',
									{
										role: 'treeitem',
										'aria-selected': String(selected),
										'data-section': section.section,
										tabindex: selected ? '0' : '-1',
									},
									el('span', { class: 'label' }, section.title)
								);
								leaf.addEventListener('click', (event) => {
									event.stopPropagation();
									this.#open(section);
								});
								return leaf;
							})
						)
					);
				}
				return item;
			})
		);
		// With the selected section collapsed away, its group holds the Tab stop.
		if (!tree.querySelector('[tabindex="0"]'))
			tree.querySelector('[role="treeitem"]')?.setAttribute('tabindex', '0');
		if (focused) tree.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
	}

	#toggle(group: string): void {
		if (this.#collapsed.has(group)) this.#collapsed.delete(group);
		else this.#collapsed.add(group);
		this.#renderTree();
		this.#tree?.querySelector<HTMLElement>(`[data-group="${CSS.escape(group)}"]`)?.focus();
	}

	/** Choosing a section is a command, so the URL follows and an agent can do the same (3.5). */
	#open(section: SectionOutline): void {
		void this.kernel?.call('section-open', { section: 'settings', target: section.section });
	}

	/** APG's tree keys: Up and Down through what shows, Home and End, Left and Right to close and open, Enter. */
	#treeKey(event: KeyboardEvent): void {
		const tree = this.#tree as HTMLElement;
		const items = [...tree.querySelectorAll<HTMLElement>('[role="treeitem"]')];
		const at = items.indexOf(event.target as HTMLElement);
		if (at < 0) return;
		const item = items[at] as HTMLElement;
		const group = item.dataset.group;
		const move = (to: HTMLElement | undefined) => {
			if (!to) return;
			for (const each of items) each.setAttribute('tabindex', each === to ? '0' : '-1');
			to.focus();
		};
		switch (event.key) {
			case 'ArrowDown':
				move(items[at + 1]);
				break;
			case 'ArrowUp':
				move(items[at - 1]);
				break;
			case 'Home':
				move(items[0]);
				break;
			case 'End':
				move(items[items.length - 1]);
				break;
			case 'ArrowRight':
				if (group === undefined) return;
				if (this.#collapsed.has(group)) this.#toggle(group);
				else move(items[at + 1]);
				break;
			case 'ArrowLeft':
				if (group !== undefined) {
					if (!this.#collapsed.has(group)) this.#toggle(group);
				} else move(item.parentElement?.closest<HTMLElement>('[role="treeitem"]') ?? undefined);
				break;
			case 'Enter':
			case ' ': {
				if (group !== undefined) this.#toggle(group);
				else {
					const section = this.#sections.find((each) => each.section === item.dataset.section);
					if (section) this.#open(section);
				}
				break;
			}
			default:
				return;
		}
		event.preventDefault();
	}

	// ─── The section's heading and the level switcher (15: a tab list) ─────────

	#renderHeader(): void {
		const header = this.#header;
		const section = this.#selected;
		if (!header) return;
		if (!section) {
			header.replaceChildren(el('p', { class: 'note' }, 'No settings to show.'));
			return;
		}
		if (OWN_PANELS.some((own) => own.section === section.section)) {
			// Its levels are its own panel's parts, so no switcher.
			header.replaceChildren(
				el('h2', { id: 'settings-section-title' }, section.title),
				el('p', { class: 'note' }, section.description as string)
			);
			this.#panel?.setAttribute('aria-labelledby', 'settings-section-title');
			return;
		}
		const levels = this.levels;
		const shown = this.shownLevel;
		const names: Record<Level, string> = {
			person: 'You, everywhere',
			workspace: 'Workspace',
			project: `Project ${this.project?.name ?? ''}`.trim(),
		};
		const onTab = this.shadowRoot?.activeElement?.getAttribute('role') === 'tab';
		const tabs = levels.map((level) => {
			const tab = el(
				'button',
				{
					type: 'button',
					role: 'tab',
					id: `level-${level}`,
					'aria-selected': String(level === shown),
					'aria-controls': 'settings-panel',
					tabindex: level === shown ? '0' : '-1',
				},
				names[level]
			);
			tab.addEventListener('click', () => this.#choose(level));
			tab.addEventListener('keydown', (event) => {
				const at = levels.indexOf(level);
				const to =
					event.key === 'ArrowRight'
						? levels[(at + 1) % levels.length]
						: event.key === 'ArrowLeft'
							? levels[(at + levels.length - 1) % levels.length]
							: event.key === 'Home'
								? levels[0]
								: event.key === 'End'
									? levels[levels.length - 1]
									: undefined;
				if (!to) return;
				event.preventDefault();
				this.#choose(to);
			});
			return tab;
		});
		header.replaceChildren(
			el('h2', { id: 'settings-section-title' }, section.title),
			...(section.description ? [el('p', { class: 'note' }, section.description)] : []),
			...(levels.length > 0
				? [el('div', { role: 'tablist', 'aria-label': `Where ${section.title} applies` }, ...tabs)]
				: [
						el(
							'p',
							{ class: 'note' },
							'These settings are a project’s: open a project to set them.'
						),
					])
		);
		this.#panel?.setAttribute(
			'aria-labelledby',
			shown ? `level-${shown}` : 'settings-section-title'
		);
		if (onTab && shown) this.shadowRoot?.querySelector<HTMLElement>(`#level-${shown}`)?.focus();
	}

	#choose(level: Level): void {
		this.level = level;
		this.#renderHeader();
		void this.#readPanel();
	}

	// ─── The fields ────────────────────────────────────────────────────────────

	/**
	 * Read the shown section's values at the shown level and render a field for each key set there. A custom editor
	 * already showing for the same key is kept and given the new value, so focus inside it stays; every other field is
	 * rebuilt, and focus returns to the element it was on, by its id.
	 */
	async #readPanel(): Promise<void> {
		const kernel = this.kernel;
		const panel = this.#panel;
		const section = this.#selected;
		const level = this.shownLevel;
		if (!kernel || !panel || this.#showing) return;
		const read = ++this.#panelReads;
		const shown = this.#shows;
		const paintChrome = () => {
			if (!this.#needsChrome) return;
			this.#needsChrome = false;
			this.#renderTree();
			this.#renderHeader();
		};
		if (section?.section === EXPERIMENTS.section) {
			paintChrome();
			defineExperimentsSection();
			const held = panel.querySelector<LoamExperimentsSection>(EXPERIMENTS_SECTION_ELEMENT);
			const shown =
				held ?? (document.createElement(EXPERIMENTS_SECTION_ELEMENT) as LoamExperimentsSection);
			shown.kernel = kernel;
			shown.scope = this.scope;
			shown.apps = this.apps.map(({ instance, title }) => ({ instance, title }));
			if (!held) panel.replaceChildren(shown);
			this.#current.clear();
			await shown.read();
			return;
		}
		if (section?.section === AUTONOMY.section) {
			paintChrome();
			defineAutonomySection();
			const held = panel.querySelector<LoamAutonomySection>(AUTONOMY_SECTION_ELEMENT);
			const shown =
				held ?? (document.createElement(AUTONOMY_SECTION_ELEMENT) as LoamAutonomySection);
			shown.kernel = kernel;
			shown.scope = this.scope;
			shown.project = this.project;
			shown.apps = this.apps.map(({ instance, title }) => ({ instance, title }));
			if (this.#targetPending) {
				this.#targetPending = false;
				shown.target = this.#target;
			}
			if (!held) panel.replaceChildren(shown);
			this.#current.clear();
			await shown.read();
			return;
		}
		if (!section || !level) {
			paintChrome();
			panel.replaceChildren();
			return;
		}
		const scope = this.scope;
		const listed = await this.#call<{ values: ValueRow[] }>('setting-list', {
			section: section.section,
			level,
		});
		if (read !== this.#panelReads || shown !== this.#shows || this.#showing) return;
		if (!listed.success || !listed.data) {
			paintChrome();
			panel.replaceChildren(el('p', {}, failed(listed)));
			return;
		}
		const extra = await this.#editorData(section);
		if (read !== this.#panelReads || shown !== this.#shows || this.#showing) return;
		paintChrome();
		const active = this.shadowRoot?.activeElement;
		const focusedId = active?.id;
		this.#current = new Map(listed.data.values.map((row) => [row.key, { row, level, scope }]));
		const boxes = listed.data.values.map<HTMLElement>((row) => {
			const box = this.#field(section, level, row, extra);
			const old = panel.querySelector<HTMLElement>(
				`.field[data-section="${CSS.escape(section.section)}"][data-key="${CSS.escape(row.key)}"]`
			);
			const editor = old?.firstElementChild as (HTMLElement & Record<string, unknown>) | null;
			const made = box.firstElementChild as (HTMLElement & Record<string, unknown>) | null;
			if (
				!old ||
				!editor ||
				!made ||
				!editor.hasAttribute('data-editor') ||
				editor.localName !== made.localName
			)
				return box;
			for (const name of ['label', 'disabled', 'apps', 'commands', 'value'])
				editor[name] = made[name];
			while (editor.nextSibling) editor.nextSibling.remove();
			editor.after(...[...box.childNodes].slice(1));
			return old;
		});
		if (extra.storage) boxes.unshift(el('p', { class: 'note' }, extra.storage));
		if (boxes.length === 0) {
			panel.replaceChildren(
				el('p', { class: 'note' }, 'Nothing in this section is set at this level.')
			);
			return;
		}
		// Kept boxes stay in place, never detached, so focus inside them stays too.
		for (const child of [...panel.children]) {
			if (!boxes.includes(child as HTMLElement)) child.remove();
		}
		let before: ChildNode | null = panel.firstChild;
		for (const box of boxes) {
			if (box.parentNode === panel) before = box.nextSibling;
			else panel.insertBefore(box, before);
		}
		if (focusedId && active && !active.isConnected) {
			this.shadowRoot?.querySelector<HTMLElement>(`#${CSS.escape(focusedId)}`)?.focus();
		}
	}

	/**
	 * What the fields are given besides their rows: for the keybinding editor the commands; for the Limits section the
	 * words beside each key from `limit-usage-get`, or, when it is refused, why no usage is shown (section 11).
	 */
	async #editorData(section: SectionSchema): Promise<PanelExtra> {
		if (section.section === LIMITS && this.kernel) {
			const read = await this.#call<{ instances: LimitUsageRow[] }>('limit-usage-get', {});
			const titles = new Map(this.apps.map((app) => [app.instance, app.title]));
			const titleOf = (instance: string) => titles.get(instance) ?? instance;
			const rows = read.data?.instances;
			const usage: Partial<Record<string, string>> = {};
			for (const key of LIMIT_KEYS) {
				usage[key] = rows
					? usageLine(key as LimitKey, rows, titleOf)
					: usageUnavailable(read.error?.code);
			}
			const status = this.kernel
				.listCommands()
				.some(({ name }) => name === 'storage-persistence-get')
				? (await this.#call<{ status: string }>('storage-persistence-get', {})).data?.status
				: undefined;
			const storage =
				status &&
				{
					persistent: 'Persistent storage is enabled for this local workspace.',
					'best-effort': 'The browser may clear local workspace data when storage runs low.',
					unavailable: 'The host could not request persistent storage for this local workspace.',
				}[status];
			return { commands: [], usage, ...(storage ? { storage } : {}) };
		}
		if (section.section !== 'loam.keybindings' || !this.kernel) return { commands: [] };
		const [found, listed] = await Promise.all([
			this.#call<{ items: Array<{ name: string; title?: string }> }>('palette-search', {
				query: '',
				kind: 'command',
				limit: 50,
			}),
			this.#call<{ bindings: ListedBindingV1[] }>('keybinding-list', { all: true }),
		]);
		return { commands: found.data?.items ?? [], bindings: listed.data?.bindings ?? [] };
	}

	/** Write a key's new value at the level shown now, `expected` the value it showed (3.2), and say how it went. */
	async #write(section: SectionSchema, key: string, value: unknown, title: string): Promise<void> {
		const current = this.#current.get(key);
		if (!current) return;
		const done = (await this.kernel?.call(
			'setting-set',
			{ section: section.section, key, value, level: current.level, expected: current.row.value },
			{ scope: current.scope }
		)) as Answer | undefined;
		if (!done) return;
		const error = this.shadowRoot?.querySelector(`#error-${CSS.escape(key)}`);
		if (error) error.textContent = done.success ? '' : failed(done);
		// One live region says how it went; the field's own line keeps the words, not announced again (15).
		this.#say(done.success ? `${title} is saved.` : `${title} was not saved. ${failed(done)}`);
		// Read again either way: an editor shows the stored value, and a retry after a conflict reads a fresh `expected`.
		await this.#readPanel();
	}

	/** Reset a key at the level shown now, `expected` the value it showed. */
	async #reset(section: SectionSchema, key: string, title: string): Promise<void> {
		const current = this.#current.get(key);
		if (!current) return;
		const done = (await this.kernel?.call(
			'setting-reset',
			{ section: section.section, key, level: current.level, expected: current.row.value },
			{ scope: current.scope }
		)) as Answer | undefined;
		if (!done) return;
		this.#say(done.success ? `${title} is reset.` : `${title} was not reset. ${failed(done)}`);
		await this.#readPanel();
	}

	#field(section: SectionSchema, level: Level, row: ValueRow, extra: PanelExtra): HTMLElement {
		const schema = section.schema.properties[row.key] as SettingKeySchema;
		const title = schema.title;
		const box = el('div', {
			class: 'field',
			id: `key-${row.key}`,
			'data-section': section.section,
			'data-key': row.key,
			...(row.key === this.#target ? { 'data-target': '' } : {}),
		});
		const editor = CUSTOM_EDITORS[`${section.section}.${row.key}`];
		let control: HTMLElement;
		if (editor) {
			defineEditors();
			const made = document.createElement(editor) as (
				| LoamRailOrderEditor
				| LoamInstancePicker
				| LoamKeybindingEditor
			) & { label: string; disabled: boolean };
			made.id = `field-${row.key}`;
			made.setAttribute('data-editor', '');
			made.label = title;
			made.disabled = !row.writable;
			if (editor === 'loam-keybinding-editor') {
				(made as LoamKeybindingEditor).commands = extra.commands;
				(made as LoamKeybindingEditor).bindings = extra.bindings ?? [];
			} else {
				(made as LoamRailOrderEditor).apps = this.apps
					.filter((app) => editor !== 'loam-rail-order-editor' || app.rail)
					.map(({ instance, title: name }) => ({ instance, title: name }));
			}
			(made as { value: unknown }).value = structuredClone(row.value);
			// The level and `expected` are read when the change comes, since a kept editor outlives this row.
			made.addEventListener(
				'change',
				(event) => void this.#write(section, row.key, (event as CustomEvent).detail.value, title)
			);
			control = made;
		} else {
			const field = settingField(row.key, schema, row.value);
			field.disabled = !row.writable;
			// The usage beside a limit is part of its description (3.7).
			if (extra.usage?.[row.key]) {
				const described = field.control.getAttribute('aria-describedby') ?? '';
				field.control.setAttribute('aria-describedby', `${described} usage-${row.key}`.trim());
			}
			field.control.addEventListener('change', () => {
				const read = field.read();
				if (!read.ok) {
					field.showError(read.error);
					return;
				}
				field.showError(null);
				void this.#write(section, row.key, read.value, title);
			});
			control = field.element;
		}
		const from = [
			FROM_WORDS[row.from],
			row.updatedBy ? `by ${whoSet(row.updatedBy)}` : '',
			row.updatedAt !== undefined ? `on ${dateText(row.updatedAt)}` : '',
		]
			.filter(Boolean)
			.join(', ');
		const reset = button('Reset', () => this.#reset(section, row.key, title), {
			id: `reset-${row.key}`,
			'aria-label': `Reset ${title}`,
			'aria-describedby': `from-${row.key}`,
			// Only a value set at this level can be reset here.
			...(row.from !== level || !row.writable ? { 'aria-disabled': 'true' } : {}),
		});
		const usage = extra.usage?.[row.key];
		box.append(
			control,
			// What each app uses of a limit, beside its key (3.7).
			...(usage ? [el('p', { class: 'note usage', id: `usage-${row.key}` }, usage)] : []),
			el(
				'div',
				{ class: 'row' },
				el('p', { class: 'from grow', id: `from-${row.key}` }, `${from}.`),
				reset
			),
			...(row.writable
				? []
				: [
						el(
							'p',
							{ class: 'note' },
							REASON_WORDS[row.reason ?? ''] ?? 'You cannot change this here.'
						),
					]),
			el('p', { class: 'error', id: `error-${row.key}` })
		);
		return box;
	}
}

const SECTION = 'loam-settings-section';

/**
 * Adopted by `loam-main` from this chunk, as the projects section's chunk adds its own, so first paint does not grow: a
 * constructable sheet, since FAST's `css` imported here would part FAST's core from first paint (the account chunk's
 * note).
 */
const MAIN_WITH_SETTINGS = `
	:host([data-section]) .landing {
		display: none;
	}
	:host([data-section][route='not-found']) .landing {
		display: grid;
	}
	:host([route='not-found']) ::slotted(loam-settings-section) {
		display: none;
	}
`;

/** Follow the state: show, update or remove the settings section in main (3.5). */
export async function syncSettings(shell: LoamShell): Promise<void> {
	const kernel = shell.kernel as LoamKernel;
	const main = shell.shadowRoot?.querySelector<HTMLElement>('loam-main');
	if (!kernel || !main) return;
	const state = await shell.readState();
	const held = main.querySelector<LoamSettingsSection>(SECTION);
	if (state.section !== 'settings' || state.active !== null) {
		if (!held) return;
		held.remove();
		if (main.dataset.section === 'settings') delete main.dataset.section;
		return;
	}
	if (!customElements.get(SECTION)) customElements.define(SECTION, LoamSettingsSection);
	let section = held;
	const entering = !section;
	if (!section) {
		section = shell.ownerDocument.createElement(SECTION) as LoamSettingsSection;
		section.kernel = kernel;
		if (main.dataset.settingsReady === undefined && main.shadowRoot) {
			main.dataset.settingsReady = '';
			const sheet = new CSSStyleSheet();
			sheet.replaceSync(MAIN_WITH_SETTINGS);
			main.shadowRoot.adoptedStyleSheets = [...main.shadowRoot.adoptedStyleSheets, sheet];
		}
		main.dataset.section = 'settings';
		main.append(section);
	}
	const project =
		state.scope.project === undefined
			? null
			: { id: state.scope.project, name: state.project?.name ?? state.project?.slug ?? '' };
	// A change of scope: nothing read in the old one writes from here on (the review's 2).
	if (section.project?.id !== project?.id || section.workspace !== state.workspace.id)
		section.forgetScope();
	section.project = project;
	section.workspace = state.workspace.id;
	section.apps = shell.appList;
	await section.show(state.path);
	// Focus goes to the heading as the section opens, never as a section or a level changes (15).
	if (entering) section.focusHeading();
}

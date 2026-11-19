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
 * `setting-reset`. No app code runs here: an app's section is its manifest's schema, rendered by the shell.
 */

import type { AppSummaryV2, LoamKernelV5 } from '@lushly-dev/loam-kernel';
import type { LoamShell } from '../elements/shell.js';
import { type SettingKeySchema, settingField } from '../forms/setting-field.js';
import {
	CUSTOM_EDITORS,
	defineEditors,
	type LoamInstancePicker,
	type LoamKeybindingEditor,
	type LoamRailOrderEditor,
} from './editors.js';
import { button, dateText, el, SettingsElement } from './parts.js';

type Level = 'person' | 'workspace' | 'project';

interface Answer<T = unknown> {
	success: boolean;
	data?: T;
	error?: { code?: string; message?: string; suggestion?: string };
}

/** A section as `setting-schema-get` lists it (3.9). */
export interface SectionSchema {
	section: string;
	title: string;
	description?: string;
	levels: Level[];
	app?: string;
	schema: { properties: Record<string, SettingKeySchema & { levels?: Level[] }> };
}

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
	kernel: LoamKernelV5 | null = null;
	/** The project the call's scope names, and its name for the switcher, or none at workspace level. */
	project: { id: string; name: string } | null = null;
	/** The rows `app-list` gave, for the editors' apps. */
	apps: readonly AppSummaryV2[] = [];
	/** The level the switcher shows; kept across sections while it applies. */
	level: Level | null = null;
	#sections: SectionSchema[] = [];
	#selected: SectionSchema | undefined;
	#target: string | undefined;
	#collapsed = new Set<string>();
	#reads = 0;
	#status: HTMLElement | undefined;
	#tree: HTMLElement | undefined;
	#header: HTMLElement | undefined;
	#panel: HTMLElement | undefined;
	#unsubscribe: (() => void) | null = null;
	/** Each shown key's row and the level it was read at: what a write's `expected` and level are. */
	#current = new Map<string, { row: ValueRow; level: Level }>();

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
		// A change from elsewhere, another tab's or an agent's, reads the shown section again.
		this.#unsubscribe ??=
			this.kernel?.subscribe((event) => {
				const changed = (event as { settings?: string[] }).settings;
				if (this.#selected && changed?.includes(this.#selected.section)) void this.#readPanel();
			}) ?? null;
	}

	disconnectedCallback(): void {
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
		const generation = ++this.#reads;
		const read = (await kernel.call('setting-schema-get', {})) as Answer<{
			sections: SectionSchema[];
		}>;
		if (generation !== this.#reads) return;
		if (!read.success || !read.data) {
			this.#sections = [];
			this.#selected = undefined;
			this.#tree?.replaceChildren();
			this.#header?.replaceChildren();
			this.#panel?.replaceChildren(el('p', {}, failed(read)));
			return;
		}
		this.#sections = read.data.sections;
		const [id = '', key] = path.split('/');
		this.#selected = this.#sections.find((section) => section.section === id) ?? this.#sections[0];
		this.#target = this.#selected?.section === id ? key : undefined;
		if (id !== '' && this.#selected?.section !== id) {
			this.#say(`There is no section ${id} here. Showing ${this.#selected?.title ?? 'none'}.`);
		}
		this.#renderTree();
		this.#renderHeader();
		await this.#readPanel();
		if (this.#target) {
			this.shadowRoot
				?.querySelector<HTMLElement>(`#key-${CSS.escape(this.#target)}`)
				?.scrollIntoView({ block: 'nearest' });
		}
	}

	/** The levels the selected section may be set at here: no project level outside a project. */
	get levels(): Level[] {
		const allowed = this.#selected?.levels ?? [];
		return LEVEL_ORDER.filter(
			(level) => allowed.includes(level) && (level !== 'project' || this.project !== null)
		);
	}

	/** The level shown: the one chosen, while it applies; else the narrowest here, as `setting-list` reads one. */
	get shownLevel(): Level | undefined {
		const levels = this.levels;
		if (this.level && levels.includes(this.level)) return this.level;
		return levels.includes('person')
			? 'person'
			: levels.includes('project')
				? 'project'
				: levels[0];
	}

	// ─── The tree (15: a `tree`) ───────────────────────────────────────────────

	#renderTree(): void {
		const tree = this.#tree;
		if (!tree) return;
		const focused = this.shadowRoot?.activeElement?.getAttribute('role') === 'treeitem';
		const groups = new Map<string, SectionSchema[]>();
		for (const section of this.#sections) {
			const group = section.app ?? 'Shell';
			groups.set(group, [...(groups.get(group) ?? []), section]);
		}
		tree.replaceChildren(
			...[...groups].map(([group, sections]) => {
				const expanded = !this.#collapsed.has(group);
				const item = el(
					'li',
					{
						role: 'treeitem',
						'aria-expanded': String(expanded),
						'data-group': group,
						tabindex: '-1',
					},
					el('span', { class: 'label' }, group)
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
								const selected = section === this.#selected;
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
	#open(section: SectionSchema): void {
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
		if (!kernel || !panel) return;
		if (!section || !level) {
			panel.replaceChildren();
			return;
		}
		const generation = ++this.#reads;
		const listed = (await kernel.call('setting-list', {
			section: section.section,
			level,
		})) as Answer<{ values: ValueRow[] }>;
		if (generation !== this.#reads) return;
		if (!listed.success || !listed.data) {
			panel.replaceChildren(el('p', {}, failed(listed)));
			return;
		}
		const extra = await this.#editorData(section);
		if (generation !== this.#reads) return;
		const active = this.shadowRoot?.activeElement;
		const focusedId = active?.id;
		this.#current = new Map(listed.data.values.map((row) => [row.key, { row, level }]));
		const boxes = listed.data.values.map((row) => {
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

	/** What the custom editors list: the apps, and for the keybinding editor the commands. */
	async #editorData(
		section: SectionSchema
	): Promise<{ commands: Array<{ name: string; title?: string }> }> {
		if (section.section !== 'loam.keybindings' || !this.kernel) return { commands: [] };
		const found = (await this.kernel.call('palette-search', {
			query: '',
			kind: 'command',
			limit: 50,
		})) as Answer<{ items: Array<{ name: string; title?: string }> }>;
		return { commands: found.data?.items ?? [] };
	}

	/** Write a key's new value at the level shown now, `expected` the value it showed (3.2), and say how it went. */
	async #write(section: SectionSchema, key: string, value: unknown, title: string): Promise<void> {
		const current = this.#current.get(key);
		if (!current) return;
		const done = (await this.kernel?.call('setting-set', {
			section: section.section,
			key,
			value,
			level: current.level,
			expected: current.row.value,
		})) as Answer | undefined;
		if (!done) return;
		const error = this.shadowRoot?.querySelector(`#error-${CSS.escape(key)}`);
		if (done.success) {
			if (error) error.textContent = '';
			this.#say(`${title} is saved.`);
			await this.#readPanel();
		} else {
			if (error) error.textContent = failed(done);
			this.#say(`${title} was not saved. ${failed(done)}`);
		}
	}

	/** Reset a key at the level shown now, `expected` the value it showed. */
	async #reset(section: SectionSchema, key: string, title: string): Promise<void> {
		const current = this.#current.get(key);
		if (!current) return;
		const done = (await this.kernel?.call('setting-reset', {
			section: section.section,
			key,
			level: current.level,
			expected: current.row.value,
		})) as Answer | undefined;
		if (!done) return;
		this.#say(done.success ? `${title} is reset.` : `${title} was not reset. ${failed(done)}`);
		if (done.success) await this.#readPanel();
	}

	#field(
		section: SectionSchema,
		level: Level,
		row: ValueRow,
		extra: { commands: Array<{ name: string; title?: string }> }
	): HTMLElement {
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
		box.append(
			control,
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
			el('p', { class: 'error', id: `error-${row.key}`, role: 'status' })
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
	const kernel = shell.kernel as LoamKernelV5;
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
	section.project =
		state.scope.project === undefined
			? null
			: { id: state.scope.project, name: state.project?.name ?? state.project?.slug ?? '' };
	section.apps = shell.appList;
	await section.show(state.path);
	// Focus goes to the heading as the section opens, never as a section or a level changes (15).
	if (entering) section.focusHeading();
}

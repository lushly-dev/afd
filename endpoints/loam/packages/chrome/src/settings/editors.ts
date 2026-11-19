/**
 * @fileoverview The settings section's three custom editors (phase 4 specification, 3.7), for the shell's keys whose
 * shapes the schema form cannot show: `loam-rail-order-editor` (`loam.rail.order`), `loam-instance-picker`
 * (`loam.notifications.muted`) and `loam-keybinding-editor` (`loam.keybindings.overrides`). Each shows `value` and
 * dispatches `change` with `detail.value`, the whole new value; the section writes it with `setting-set`, and the kernel
 * checks it. Plain elements with text as text, as the rest of this chunk.
 */

import { chordOf, NEVER_BOUND, type OverrideV1, overrideWarning } from './editor-rules.js';
import { button, el, SettingsElement } from './parts.js';

export { CUSTOM_EDITORS, type OverrideV1 } from './editor-rules.js';

/** An app as an editor lists it: its instance and its title. */
export interface EditorApp {
	instance: string;
	title: string;
}

/** Tell the section the editor's whole new value. */
const changed = (editor: HTMLElement, value: unknown): void => {
	editor.dispatchEvent(new CustomEvent('change', { detail: { value }, bubbles: false }));
};

/** An editor's label and its state, set by the section. */
abstract class Editor<T> extends SettingsElement {
	label = '';
	disabled = false;
	#value: T;
	constructor(initial: T) {
		super();
		this.#value = initial;
	}
	get value(): T {
		return this.#value;
	}
	set value(next: T) {
		this.#value = next;
		this.render();
	}
	connectedCallback(): void {
		this.render();
	}
	abstract render(): void;
}

/**
 * `loam-rail-order-editor` (R8, D75): the rail's apps in the person's order, each moved up or down by a button, so
 * the order needs no drag. A move writes the whole list, every app named, so the rail shows exactly this.
 */
export class LoamRailOrderEditor extends Editor<string[]> {
	/** The rail's apps, in the order the workspace gives them. */
	apps: EditorApp[] = [];
	constructor() {
		super([]);
	}

	/** Every app, the person's listed ones first in their order, the rest in the workspace's. */
	get shown(): EditorApp[] {
		const listed = this.value.flatMap((id) => this.apps.filter((app) => app.instance === id));
		return [...listed, ...this.apps.filter((app) => !this.value.includes(app.instance))];
	}

	render(): void {
		const root = this.shadowRoot as ShadowRoot;
		const shown = this.shown;
		const focused = root.activeElement?.getAttribute('data-move');
		root.replaceChildren(
			el(
				'ol',
				{ 'aria-label': this.label || 'App order', class: 'list' },
				...shown.map((app, index) =>
					el(
						'li',
						{ class: 'row' },
						el('span', { class: 'grow' }, app.title),
						this.#move(app, index, -1, shown),
						this.#move(app, index, 1, shown)
					)
				)
			)
		);
		if (shown.length === 0)
			root.append(el('p', { class: 'note' }, 'No app has a place in the rail.'));
		if (focused) root.querySelector<HTMLElement>(`[data-move="${focused}"]`)?.focus();
	}

	#move(app: EditorApp, index: number, by: -1 | 1, shown: EditorApp[]): HTMLElement {
		const to = index + by;
		const word = by < 0 ? 'up' : 'down';
		const made = button(
			by < 0 ? 'Move up' : 'Move down',
			() => {
				if (to < 0 || to >= shown.length || this.disabled) return;
				const order = shown.map(({ instance }) => instance);
				[order[index], order[to]] = [order[to] as string, order[index] as string];
				// Focus follows the app it moved, on the same button.
				this.value = order;
				(this.shadowRoot as ShadowRoot)
					.querySelector<HTMLElement>(`[data-move="${app.instance}-${word}"]`)
					?.focus();
				changed(this, order);
			},
			{
				'aria-label': `Move ${app.title} ${word}`,
				'data-move': `${app.instance}-${word}`,
			}
		);
		if (to < 0 || to >= shown.length || this.disabled) made.setAttribute('aria-disabled', 'true');
		return made;
	}
}

/** `loam-instance-picker` (3.7): one checkbox per app; the shell and agents are never offered (`SETTING_MUTE_SHELL`). */
export class LoamInstancePicker extends Editor<string[]> {
	apps: EditorApp[] = [];
	constructor() {
		super([]);
	}

	render(): void {
		const root = this.shadowRoot as ShadowRoot;
		const boxes = this.apps.map((app) => {
			const box = el('input', {
				type: 'checkbox',
				id: `pick-${app.instance}`,
				value: app.instance,
			}) as HTMLInputElement;
			box.checked = this.value.includes(app.instance);
			box.disabled = this.disabled;
			box.addEventListener('change', () => {
				const next = this.apps
					.map(({ instance }) => instance)
					.filter((instance) =>
						instance === app.instance ? box.checked : this.value.includes(instance)
					);
				this.value = next;
				root.querySelector<HTMLElement>(`#pick-${app.instance}`)?.focus();
				changed(this, next);
			});
			return el('label', { class: 'check', for: `pick-${app.instance}` }, box, app.title);
		});
		root.replaceChildren(
			el(
				'fieldset',
				{},
				el('legend', {}, this.label || 'Apps'),
				...(boxes.length > 0 ? boxes : [el('p', { class: 'note' }, 'No app to choose.')])
			)
		);
	}
}

/**
 * `loam-keybinding-editor` (8.3): the person's overrides, each removed by a button, and one added at a time by naming
 * a command and pressing its chord, or choosing to unbind it. It announces the recorded chord and any shadowing, and
 * never records F6, Shift+F6 or Escape: Escape stops recording, and focus can always leave.
 */
export class LoamKeybindingEditor extends Editor<OverrideV1[]> {
	/** The commands an override may name, for the command field's suggestions. */
	commands: Array<{ name: string; title?: string }> = [];
	/** Whether `Mod` is Command. */
	mac = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '');
	#recorded: string | null = null;
	#recording = false;
	#unbind = false;
	#command = '';
	#said = '';

	constructor() {
		super([]);
	}

	render(): void {
		const root = this.shadowRoot as ShadowRoot;
		const focused = root.activeElement?.id;
		const rows = this.value.map((override, index) =>
			el(
				'li',
				{ class: 'row' },
				el(
					'span',
					{ class: 'grow' },
					`${override.command}${override.target ? ` (${override.target})` : ''}: ${override.keys ?? 'unbound'}`
				),
				button(
					'Remove',
					() => {
						if (this.disabled) return;
						const next = this.value.filter((_, at) => at !== index);
						this.#said = `Removed the override of ${override.command}.`;
						this.value = next;
						changed(this, next);
					},
					{ 'aria-label': `Remove the override of ${override.command}` }
				)
			)
		);
		const command = el('input', {
			id: 'override-command',
			list: 'override-commands',
			autocomplete: 'off',
			maxlength: '128',
		}) as HTMLInputElement;
		command.value = this.#command;
		command.disabled = this.disabled;
		command.addEventListener('input', () => {
			this.#command = command.value.trim();
			this.#update();
		});
		const record = button(
			this.#recording ? 'Press the keys…' : 'Record keys',
			() => {
				if (this.disabled) return;
				this.#recording = !this.#recording;
				this.#said = this.#recording ? 'Press the keys to bind. Escape stops.' : '';
				this.render();
				root.querySelector<HTMLElement>('#override-record')?.focus();
			},
			{
				id: 'override-record',
				'aria-pressed': String(this.#recording),
				'aria-describedby': 'override-said',
			}
		);
		record.addEventListener('keydown', (event) => this.#heard(event));
		const unbind = el('input', { type: 'checkbox', id: 'override-unbind' }) as HTMLInputElement;
		unbind.checked = this.#unbind;
		unbind.disabled = this.disabled;
		unbind.addEventListener('change', () => {
			this.#unbind = unbind.checked;
			this.#update();
		});
		const add = el(
			'button',
			{ type: 'submit', class: 'action primary', id: 'override-add' },
			'Add'
		);
		const form = el(
			'form',
			{ 'aria-label': 'Add an override' },
			el('label', { for: 'override-command' }, 'Command', command),
			record,
			el('label', { class: 'check', for: 'override-unbind' }, unbind, 'Unbind it'),
			add
		);
		form.addEventListener('submit', (event) => {
			event.preventDefault();
			this.#add();
		});
		root.replaceChildren(
			el('h3', {}, this.label || 'Overrides'),
			rows.length > 0
				? el('ul', { class: 'list', 'aria-label': 'Your overrides' }, ...rows)
				: el(
						'p',
						{ class: 'note' },
						'No overrides: every binding is as its app or the shell sets it.'
					),
			form,
			el(
				'datalist',
				{ id: 'override-commands' },
				...this.commands.map(({ name, title }) => el('option', { value: name }, title ?? name))
			),
			el('p', { id: 'override-said', role: 'status', 'aria-live': 'polite' }, this.#said)
		);
		this.#update();
		if (focused) root.querySelector<HTMLElement>(`#${focused}`)?.focus();
	}

	/** A key pressed while recording: Escape stops; a modifier alone waits; anything else is the chord. */
	#heard(event: KeyboardEvent): void {
		if (!this.#recording) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			this.#recording = false;
			this.#say('Stopped recording.');
			this.render();
			return;
		}
		// Tab leaves, and Shift+Tab: the person is never trapped.
		if (event.key === 'Tab') return;
		const chord = chordOf(event, this.mac);
		if (!chord) return;
		event.preventDefault();
		this.#recording = false;
		this.#recorded = chord;
		this.#unbind = false;
		const warning = this.#warning();
		this.#said = `Recorded ${chord}.${warning ? ` ${warning}` : ''}`;
		this.render();
		(this.shadowRoot as ShadowRoot).querySelector<HTMLElement>('#override-record')?.focus();
	}

	#pending(): OverrideV1 | undefined {
		if (!this.#command) return undefined;
		if (this.#unbind) return { command: this.#command, keys: null };
		return this.#recorded ? { command: this.#command, keys: this.#recorded } : undefined;
	}

	#warning(): string | undefined {
		const pending = this.#pending();
		if (this.#recorded && NEVER_BOUND.includes(this.#recorded))
			return `${this.#recorded} cannot be bound: bind another key.`;
		return pending ? overrideWarning(pending) : undefined;
	}

	/** The Add button follows what is entered; the warning shows before it is pressed. */
	#update(): void {
		const root = this.shadowRoot as ShadowRoot;
		const add = root.querySelector<HTMLElement>('#override-add');
		const ready = this.#pending() !== undefined && !this.disabled;
		add?.setAttribute('aria-disabled', String(!ready));
		const record = root.querySelector('#override-record');
		if (record && !this.#recording)
			record.textContent = this.#recorded ? `Keys: ${this.#recorded}` : 'Record keys';
	}

	#say(text: string): void {
		this.#said = text;
		const status = (this.shadowRoot as ShadowRoot).querySelector('#override-said');
		if (status) status.textContent = text;
	}

	#add(): void {
		const pending = this.#pending();
		if (!pending || this.disabled) {
			this.#say(
				this.#command ? 'Record the keys, or choose to unbind it.' : 'Name a command first.'
			);
			return;
		}
		const warning = this.#warning();
		const next = [...this.value.filter((each) => each.command !== pending.command), pending];
		this.#command = '';
		this.#recorded = null;
		this.#unbind = false;
		this.#said = `Added ${pending.command}: ${pending.keys ?? 'unbound'}.${warning ? ` ${warning}` : ''}`;
		this.value = next;
		(this.shadowRoot as ShadowRoot).querySelector<HTMLElement>('#override-command')?.focus();
		changed(this, next);
	}
}

/** Define the three editors, once. */
export function defineEditors(): void {
	for (const [name, element] of [
		['loam-rail-order-editor', LoamRailOrderEditor],
		['loam-instance-picker', LoamInstancePicker],
		['loam-keybinding-editor', LoamKeybindingEditor],
	] as const) {
		if (!customElements.get(name)) customElements.define(name, element);
	}
}

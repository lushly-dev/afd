/**
 * @fileoverview The settings section's three custom editors (phase 4 specification, 3.7), for the shell's keys whose
 * shapes the schema form cannot show: `loam-rail-order-editor` (`loam.rail.order`), `loam-instance-picker`
 * (`loam.notifications.muted`) and `loam-keybinding-editor` (`loam.keybindings.overrides`). Each shows `value` and
 * dispatches `change` with `detail.value`, the whole new value; the section writes it with `setting-set`, and the kernel
 * checks it. An editor shows a new value only once the section gives it back, read after the write, so a refused write
 * leaves what is stored. A list keeps every stored item the editor does not show. Plain elements with text as text.
 */

import {
	chordOf,
	keysRefused,
	type ListedBindingV1,
	type OverrideV1,
	overrideRefused,
	overrideWarning,
	reorder,
	SEQUENCE_WAIT,
	toggled,
	withOverride,
} from './editor-rules.js';
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
				// Shown once written: focus stays on this button, which the next render finds by its `data-move`.
				changed(this, reorder(this.value, order));
			},
			{
				'aria-label': `Move ${word}: ${app.title}`,
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
		const focused = root.activeElement?.id;
		const boxes = this.apps.map((app) => {
			const box = el('input', {
				type: 'checkbox',
				id: `pick-${app.instance}`,
				value: app.instance,
			}) as HTMLInputElement;
			box.checked = this.value.includes(app.instance);
			box.disabled = this.disabled;
			box.addEventListener('change', () => {
				const next = toggled(this.value, app.instance, box.checked);
				// Shown once written: the box goes back to what is stored if the write is refused.
				box.checked = this.value.includes(app.instance);
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
		if (focused) root.querySelector<HTMLElement>(`#${CSS.escape(focused)}`)?.focus();
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
	/** Every binding, `keybinding-list { all: true }`'s, for the warning before a binding shadows another (8.3, 15). */
	bindings: ListedBindingV1[] = [];
	/** Whether `Mod` is Command. */
	mac = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '');
	#recorded: string | null = null;
	#recording = false;
	#unbind = false;
	#command = '';
	#target = '';
	/** A Mod chord just recorded, which a second key pressed before `until` makes a sequence (8.1). */
	#first: { chord: string; until: number } | null = null;
	#said = '';
	/** The override Add sent, until the stored value holds it, when the form clears. */
	#submitted: OverrideV1 | null = null;
	/** The warning last said, so a change of what is pending says a new one once. */
	#warned: string | undefined;

	constructor() {
		super([]);
	}

	render(): void {
		const root = this.shadowRoot as ShadowRoot;
		const focused = root.activeElement?.id;
		const submitted = this.#submitted;
		if (
			submitted &&
			this.value.some(
				(each) =>
					each.command === submitted.command &&
					(each.target ?? null) === (submitted.target ?? null) &&
					each.keys === submitted.keys
			)
		) {
			// Stored: the form clears, and says what was added.
			this.#said = `Added ${submitted.command}: ${submitted.keys ?? 'unbound'}.`;
			this.#submitted = null;
			this.#command = '';
			this.#target = '';
			this.#first = null;
			this.#recorded = null;
			this.#unbind = false;
			this.#warned = undefined;
		}
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
						changed(
							this,
							this.value.filter((_, at) => at !== index)
						);
					},
					{ 'aria-label': `Remove the override of ${override.command}` }
				)
			)
		);
		const target = el('input', {
			id: 'override-target',
			autocomplete: 'off',
			maxlength: '128',
		}) as HTMLInputElement;
		target.value = this.#target;
		target.disabled = this.disabled;
		target.addEventListener('input', () => {
			this.#target = target.value.trim();
			this.#update();
		});
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
		// Its name stays "Record keys"; `aria-pressed` says it is recording, as APG's toggle button does.
		const record = button(
			'Record keys',
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
				'aria-describedby': 'override-said override-hint',
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
			el('label', { for: 'override-target' }, 'Target, if any (a section or a part)', target),
			record,
			el(
				'span',
				{ id: 'override-hint', class: 'note' },
				'After a Mod chord, a second key pressed at once makes a sequence.'
			),
			el(
				'span',
				{ id: 'override-keys', class: 'note' },
				this.#recorded ? `Keys: ${this.#recorded}` : 'No keys recorded'
			),
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
				...suggestions(this.commands, this.bindings).map(({ name, title }) =>
					el('option', { value: name }, title ?? name)
				)
			),
			el('p', { id: 'override-said', role: 'status', 'aria-live': 'polite' }, this.#said)
		);
		this.#update();
		if (focused) root.querySelector<HTMLElement>(`#${focused}`)?.focus();
	}

	/**
	 * A key pressed while recording: Escape stops; a modifier alone waits; anything else is the chord. After a Mod chord,
	 * a second key pressed within 1,500 ms makes a sequence (8.1); Escape then keeps the first alone.
	 */
	#heard(event: KeyboardEvent): void {
		const first = this.#first;
		if (first && !this.#recording) {
			if (Date.now() > first.until || event.key === 'Tab') {
				this.#first = null;
				return;
			}
			if (event.key === 'Escape') {
				event.preventDefault();
				this.#first = null;
				return;
			}
			const second = chordOf(event, this.mac);
			if (!second) return;
			event.preventDefault();
			this.#first = null;
			this.#heardKeys(`${first.chord} ${second}`);
			return;
		}
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
		this.#first = chord.split('+').includes('Mod')
			? { chord, until: Date.now() + SEQUENCE_WAIT }
			: null;
		this.#heardKeys(chord);
	}

	/** Keys recorded: shown, said with any warning, and the Record button keeps focus for a sequence's second key. */
	#heardKeys(chord: string): void {
		this.#recorded = chord;
		this.#unbind = false;
		const warning = this.#warning();
		this.#said = `Recorded ${chord}.${warning ? ` ${warning}` : ''}`;
		this.#warned = warning;
		this.render();
		(this.shadowRoot as ShadowRoot).querySelector<HTMLElement>('#override-record')?.focus();
	}

	#pending(): OverrideV1 | undefined {
		if (!this.#command) return undefined;
		const target = this.#target ? { target: this.#target } : {};
		if (this.#unbind) return { command: this.#command, ...target, keys: null };
		return this.#recorded ? { command: this.#command, ...target, keys: this.#recorded } : undefined;
	}

	/** Why Add cannot send what is pending: F6's own binding, a key never bound, a sequence's first chord (8.1, 8.3). */
	#refused(): string | undefined {
		const pending = this.#pending();
		if (pending) return overrideRefused(pending);
		return this.#unbind ? undefined : keysRefused(this.#recorded);
	}

	#warning(): string | undefined {
		const pending = this.#pending();
		return this.#refused() ?? (pending ? overrideWarning(pending, this.bindings) : undefined);
	}

	/** Whether Add may send: something pending, and keys that may be bound (8.1, 8.3). */
	#ready(): boolean {
		return this.#pending() !== undefined && this.#refused() === undefined && !this.disabled;
	}

	/**
	 * The Add button follows what is pending, and a warning is said as soon as what is pending changes, before Add:
	 * naming the command or choosing to unbind may shadow a shell chord or leave Mod+K unbound (8.3; the review's 5).
	 */
	#update(): void {
		const root = this.shadowRoot as ShadowRoot;
		root.querySelector('#override-add')?.setAttribute('aria-disabled', String(!this.#ready()));
		const warning = this.#warning();
		if (warning !== this.#warned) {
			this.#warned = warning;
			if (warning) this.#say(warning);
		}
	}

	#say(text: string): void {
		this.#said = text;
		const status = (this.shadowRoot as ShadowRoot).querySelector('#override-said');
		if (status) status.textContent = text;
	}

	#add(): void {
		const pending = this.#pending();
		if (!pending || !this.#ready()) {
			this.#say(
				!this.#command
					? 'Name a command first.'
					: (this.#warning() ?? 'Record the keys, or choose to unbind it.')
			);
			return;
		}
		// Sent, and shown once stored: the form clears when the value given back holds it.
		this.#first = null;
		this.#submitted = pending;
		changed(this, withOverride(this.value, pending));
	}
}

/** The command field's suggestions: the palette's commands, then each other command a binding names (R1's among them). */
function suggestions(
	commands: ReadonlyArray<{ name: string; title?: string }>,
	bindings: readonly ListedBindingV1[]
): Array<{ name: string; title?: string }> {
	const named = new Set(commands.map(({ name }) => name));
	const more = [...new Set(bindings.map(({ command }) => command))].filter(
		(name) => !named.has(name)
	);
	return [...commands, ...more.map((name) => ({ name }))];
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

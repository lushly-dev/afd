/**
 * @fileoverview `loam-experiments-section` (phase 4 specification, 5.2, 5.4 and 3.5), the settings tree's Experiments
 * entry: each app's experiment with what it may change and when it ends, whether it is on for the person and why, and
 * two switches: on for me, and, an owner's, on for the workspace. Turning one off for yourself while the workspace has
 * it on is an opt-out (D155). Every read and write is a command (`experiment-list`, `experiment-enable`,
 * `experiment-disable`); a refusal, such as an owner's switch for a member or R14's unsaved tab, is said in words beside
 * the switches, and the list is read again either way. Native controls, as the settings section's.
 */

import type { LoamKernelV5 } from '@lushly-dev/loam-kernel';
import { type ExperimentRow, endWords, stateWords } from './experiments-words.js';
import { el, SettingsElement } from './parts.js';

interface Answer<T = unknown> {
	success: boolean;
	data?: T;
	error?: { code?: string; message?: string; suggestion?: string };
}

export const EXPERIMENTS_SECTION_ELEMENT = 'loam-experiments-section';

const failed = (answer: Answer): string =>
	[answer.error?.message ?? 'That did not work', answer.error?.suggestion]
		.filter(Boolean)
		.join('. ');

export class LoamExperimentsSection extends SettingsElement {
	kernel: LoamKernelV5 | null = null;
	scope: { workspace: string; project?: string } = { workspace: '' };
	apps: ReadonlyArray<{ instance: string; title: string }> = [];
	#reads = 0;
	#status = el('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
	#body = el('div', { class: 'fields' });

	connectedCallback(): void {
		const root = this.shadowRoot as ShadowRoot;
		if (root.childElementCount > 0) return;
		root.append(el('div', { class: 'section' }, this.#status, this.#body));
	}

	#call<T>(name: string, input: unknown): Promise<Answer<T>> {
		return (this.kernel?.call(name, input, { scope: this.scope }) ??
			Promise.resolve({ success: false })) as Promise<Answer<T>>;
	}

	/** Read the list again and draw it; a read overtaken by a later one draws nothing. */
	async read(): Promise<void> {
		const generation = ++this.#reads;
		const listed = await this.#call<{ experiments: ExperimentRow[] }>('experiment-list', {});
		if (generation !== this.#reads) return;
		if (!listed.success || !listed.data) {
			this.#body.replaceChildren(
				el('p', { class: 'error' }, `The experiments could not be read. ${failed(listed)}`)
			);
			return;
		}
		const rows = listed.data.experiments;
		this.#body.replaceChildren(
			...(rows.length === 0
				? [el('p', { class: 'note' }, 'No app offers an experiment here.')]
				: rows.map((row) => this.#row(row)))
		);
	}

	#title = (instance: string): string =>
		this.apps.find((app) => app.instance === instance)?.title ?? instance;

	/** One experiment: its title and app, what may change, when it ends, its state, and the two switches. */
	#row(row: ExperimentRow): HTMLElement {
		const id = row.fullId.replace(/[^a-z0-9-]/g, '-');
		const fixed = row.stage === 'graduated';
		const mine = this.#switch(`${id}-person`, 'On for me', row.on, fixed, (on) =>
			this.#set(row, 'person', on)
		);
		const theirs = this.#switch(
			`${id}-workspace`,
			'On for the workspace',
			row.workspace,
			fixed,
			(on) => this.#set(row, 'workspace', on)
		);
		return el(
			'section',
			{ class: 'section', id: `experiment-${id}`, 'aria-labelledby': `${id}-title` },
			el('h3', { id: `${id}-title` }, `${row.title}, ${this.#title(row.owner)}`),
			el('p', {}, row.changes),
			el('p', { class: 'note' }, endWords(row)),
			el('p', { class: 'note', id: `${id}-state` }, stateWords(row)),
			...(row.changed
				? [
						el(
							'p',
							{ class: 'note' },
							'What it may change is new since it was turned on, so it is off until it is turned on again.'
						),
					]
				: []),
			mine,
			theirs,
			el(
				'p',
				{ class: 'note' },
				'Turning it off for yourself keeps it off for you even while the workspace has it on.'
			)
		);
	}

	#switch(
		id: string,
		label: string,
		checked: boolean,
		disabled: boolean,
		change: (on: boolean) => Promise<void>
	): HTMLElement {
		const box = el('input', { type: 'checkbox', id }) as HTMLInputElement;
		box.checked = checked;
		box.disabled = disabled;
		box.addEventListener('change', () => {
			void change(box.checked);
		});
		return el('label', { for: id, class: 'check' }, box, label);
	}

	/** Write, say how it went in words, and read again either way. */
	async #set(row: ExperimentRow, audience: 'person' | 'workspace', on: boolean): Promise<void> {
		const done = await this.#call<{ on: boolean }>(
			on ? 'experiment-enable' : 'experiment-disable',
			{ experiment: row.fullId, audience }
		);
		const whose = audience === 'person' ? 'for you' : 'for the workspace';
		this.#status.textContent = done.success
			? `${row.title} is ${on ? 'on' : 'off'} ${whose}.`
			: `${row.title} was not changed ${whose}. ${failed(done)}`;
		await this.read();
	}
}

export function defineExperimentsSection(): void {
	if (!customElements.get(EXPERIMENTS_SECTION_ELEMENT))
		customElements.define(EXPERIMENTS_SECTION_ELEMENT, LoamExperimentsSection);
}

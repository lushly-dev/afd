/**
 * @fileoverview `loam-console` (phase 1 specification, 7.7; D48): the mounted kind's renderer and every
 * new app's first UI. It binds to the SDK's client alone, so it has no kernel dependency. Whatever a
 * server or a package said is set as text, by property; the one `innerHTML` is the adapters' output,
 * which escapes every value (`result.ts`).
 */

import {
	FASTElement,
	FASTElementDefinition,
	html,
	Observable,
	observable,
	repeat,
	Updates,
	when,
} from '@lushly-dev/fast-element';
import '@lushly-dev/violet-elements/dist/button/violet-button.js';
import '@lushly-dev/violet-elements/dist/listbox/violet-listbox.js';
import '@lushly-dev/violet-elements/dist/option/violet-option.js';
import '@lushly-dev/violet-elements/dist/spinner/violet-spinner.js';
import '@lushly-dev/violet-elements/dist/text-field/violet-text-field.js';
import type { CommandResult } from '@lushly-dev/afd-core';
import type { LoamClientV1 } from '@lushly-dev/loam-sdk';
import type { VioletButton } from '@lushly-dev/violet-elements/dist/button/violet-button.js';
import type { VioletListbox } from '@lushly-dev/violet-elements/dist/listbox/violet-listbox.js';
import type { VioletTextField } from '@lushly-dev/violet-elements/dist/text-field/violet-text-field.js';
import {
	type ConsoleCommand,
	filterCommands,
	filterStatus,
	readCommands,
	rowFlag,
	rowTitle,
} from './commands.js';
import { errorOf, type FormModel, readForm, renderForm } from './form.js';
import { type FieldView, fieldView } from './form-view.js';
import { resultHtml, resultLabels } from './result.js';
import { consoleStyles } from './styles.js';

/** Of `AppContextV1`, what the console reads. The chrome gives it a person's client (7.7). */
export interface ConsoleContext {
	readonly instance: string;
	readonly client: LoamClientV1;
}

/** The fields of the kernel's `AppDetailV1` the console shows, so it needs no kernel dependency. */
interface AppReading {
	title: string;
	kind: string;
	trustLine: string;
	state: string;
	notices: Array<{ code: string; message: string }>;
	error?: Failure;
}

interface Failure {
	code: string;
	message: string;
	suggestion?: string;
}

interface InstanceReading {
	instance: string;
	transport: string;
	state: string;
	commands: number;
	hidden: number;
	error?: Failure;
	warnings?: Array<{ code: string; message: string }>;
}

const failureText = (failure: Failure): string => `Failed: ${failure.message} (${failure.code})`;

/** What a live region says of a result: the failure's message and way out too, since focus does not move. */
function outcomeText(name: string, result: CommandResult): string {
	if (result.success === true) return `${name} succeeded`;
	const { code, message, suggestion } = result.error ?? {};
	// Only text: a frame's or a server's other shapes may not even have a `toString`.
	const parts = [typeof code === 'string' ? code : 'no error given'];
	if (typeof message === 'string') parts.push(message);
	if (typeof suggestion === 'string') parts.push(suggestion);
	return `${name} failed: ${parts.join('. ')}`;
}

const rowTemplate = html<ConsoleCommand>`
	<violet-option value="${(x) => x.name}">
		<span class="row-title">${(x) => rowTitle(x)}</span>
		${when(
			(x) => rowFlag(x) !== '',
			html<ConsoleCommand>`<span class="row-flag" slot="description">${(x) => rowFlag(x)}</span>`
		)}
	</violet-option>
`;

const noticeTemplate = html<{ message: string }>`<p class="notice">${(x) => x.message}</p>`;
const labelTemplate = html<string>`<li>${(x) => x}</li>`;

const template = html<LoamConsole>`
	<div class="stack" aria-busy="${(x) => (x.loading ? 'true' : null)}">
		<div class="group">
			<h1>${(x) => x.app?.title ?? x.context?.instance ?? ''}</h1>
			<p class="secondary" ?hidden="${(x) => !x.app}">${(x) => x.app?.trustLine ?? ''}</p>
			<div class="actions" ?hidden="${(x) => !x.loading}">
				<violet-spinner decorative size="sm"></violet-spinner>
				<p class="secondary">Loading…</p>
			</div>
		</div>
		${when(
			(x) => x.loadFailure !== null,
			html<LoamConsole>`
				<div class="notice failure" role="alert">
					<p>${(x) => (x.loadFailure ? failureText(x.loadFailure) : '')}</p>
					<p>${(x) => x.loadFailure?.suggestion ?? ''}</p>
				</div>
			`
		)}
		${when(
			(x) => x.app !== null && x.app.notices.length > 0,
			html<LoamConsole>`
				<div class="group">${repeat((x) => x.app?.notices ?? [], noticeTemplate)}</div>
			`
		)}
		${when(
			(x) => x.app?.kind === 'mounted',
			html<LoamConsole>`
				<div class="group">
					${when(
						(x) => x.instanceError !== null,
						html<LoamConsole>`
							<div class="notice failure" role="alert">
								<p>${(x) => (x.instanceError ? failureText(x.instanceError) : '')}</p>
								<p>${(x) => x.instanceError?.suggestion ?? ''}</p>
							</div>
						`
					)}
					<div class="actions">
						<violet-button
							class="refresh"
							?disabled="${(x) => x.refreshing}"
							@click="${(x) => x.refresh()}"
							>Refresh</violet-button
						>
						<violet-spinner decorative size="sm" ?hidden="${(x) => !x.refreshing}"></violet-spinner>
						<p class="refresh-status" role="status">${(x) => x.refreshStatus}</p>
					</div>
					<dl class="instance">
						<div>
							<dt>Transport</dt>
							<dd>${(x) => x.mounted?.transport ?? ''}</dd>
						</div>
						<div>
							<dt>State</dt>
							<dd>${(x) => x.mounted?.state ?? ''}</dd>
						</div>
						<div>
							<dt>Commands</dt>
							<dd>${(x) => String(x.mounted?.commands ?? 0)}</dd>
						</div>
					</dl>
					<p class="secondary" ?hidden="${(x) => (x.mounted?.hidden ?? 0) === 0}">
						${(x) => `${x.mounted?.hidden ?? 0} hidden: the deployer exposes these`}
					</p>
					${repeat((x) => x.mounted?.warnings ?? [], noticeTemplate)}
				</div>
			`
		)}
		<div class="columns" ?hidden="${(x) => !x.app}">
			<section class="group" aria-labelledby="console-commands">
				<h2 id="console-commands">Commands</h2>
				<violet-text-field
					class="filter"
					type="search"
					label="Filter commands"
					autocomplete="off"
					@input="${(x, c) => x.handleFilter(c.event)}"
				></violet-text-field>
				<violet-listbox
					label="Commands"
					value="${(x) => x.selected?.name ?? ''}"
					?hidden="${(x) => x.visible.length === 0}"
					@change="${(x, c) => x.handleSelect(c.event as CustomEvent<{ value: string }>)}"
					@mousedown="${(x, c) => x.handleListPress(c.event)}"
				>
					${repeat((x) => x.visible, rowTemplate, { recycle: false })}
				</violet-listbox>
				<p class="secondary filter-status" role="status">${(x) => x.filterStatus}</p>
			</section>
			<section class="group" aria-labelledby="console-command" ?hidden="${(x) => !x.selected}">
				<h2 id="console-command">${(x) => (x.selected ? rowTitle(x.selected) : '')}</h2>
				<p class="name" ?hidden="${(x) => !x.selected?.title}">${(x) => x.selected?.name ?? ''}</p>
				<p class="command-description">${(x) => x.selected?.description ?? ''}</p>
				<p class="command-flag" ?hidden="${(x) => !x.selected || rowFlag(x.selected) === ''}">
					${(x) => (x.selected ? rowFlag(x.selected) : '')}
				</p>
				<form
					class="group"
					novalidate
					aria-labelledby="console-command"
					@submit="${() => false}"
					@keydown="${(x, c) => x.handleKey(c.event as KeyboardEvent)}"
					@input="${(x) => x.handleEdit()}"
					@change="${(x) => x.handleEdit()}"
				>
					<div class="fields"></div>
					<p class="secondary no-input" ?hidden="${(x) => !x.noInput}">No input</p>
					<div class="actions">
						<violet-button
							class="run"
							appearance="${(x) => (x.selected?.destructive ? 'danger' : 'primary')}"
							?disabled="${(x) => x.running}"
							@click="${(x) => x.run()}"
							>Run</violet-button
						>
						<violet-spinner decorative size="sm" ?hidden="${(x) => !x.running}"></violet-spinner>
					</div>
				</form>
				<section class="result" role="region" aria-label="Result">
					<p class="result-status" role="status">${(x) => x.status}</p>
					<ul class="labels" ?hidden="${(x) => x.labels.length === 0}">
						${repeat((x) => x.labels, labelTemplate)}
					</ul>
					<div class="output"></div>
				</section>
			</section>
		</div>
	</div>
`;

const hasError = (element: HTMLElement): boolean =>
	(element as HTMLElement & { invalid?: boolean }).invalid === true;

/** Focus an element only if focus has fallen to nothing, as it does when a focused button is disabled. */
function focusIfLost(element: HTMLElement | null): void {
	const { activeElement, body } = document;
	if (activeElement === null || activeElement === body) element?.focus();
}

const asFailure = (error: Failure | undefined): Failure | null =>
	error
		? {
				code: String(error.code),
				message: String(error.message),
				...(error.suggestion !== undefined ? { suggestion: String(error.suggestion) } : {}),
			}
		: null;

export class LoamConsole extends FASTElement {
	/** Assigned by `loam-mount` before it connects (the surface contract). */
	declare context: ConsoleContext | undefined;
	declare selection: string | null | undefined;
	declare app: AppReading | null;
	declare mounted: InstanceReading | null;
	declare instanceError: Failure | null;
	declare loadFailure: Failure | null;
	declare loading: boolean;
	declare commands: ConsoleCommand[];
	declare visible: ConsoleCommand[];
	declare filter: string;
	declare filterStatus: string;
	declare selected: ConsoleCommand | null;
	declare noInput: boolean;
	declare running: boolean;
	declare refreshing: boolean;
	declare refreshStatus: string;
	declare status: string;
	declare labels: string[];
	#model: FormModel = { fields: [] };
	#views: FieldView[] = [];
	#loads = 0;
	#validationFailed = false;
	#activeWatch = { handleChange: () => this.#syncActive() };

	constructor() {
		super();
		this.app = null;
		this.mounted = null;
		this.instanceError = null;
		this.loadFailure = null;
		this.loading = false;
		this.commands = [];
		this.visible = [];
		this.filter = '';
		this.filterStatus = '';
		this.selected = null;
		this.noInput = false;
		this.running = false;
		this.refreshing = false;
		this.refreshStatus = '';
		this.status = '';
		this.labels = [];
	}

	/** By selector rather than FAST's `ref`, which would split a chunk out of first paint's (9.8). */
	#find<T extends Element>(selector: string): T | null {
		return this.shadowRoot?.querySelector<T>(selector) ?? null;
	}

	get #listbox(): VioletListbox | null {
		return this.#find<VioletListbox>('violet-listbox');
	}

	override connectedCallback(): void {
		super.connectedCallback();
		Observable.getNotifier(this.#listbox).subscribe(this.#activeWatch, 'activeValue');
		void this.load();
	}

	override disconnectedCallback(): void {
		Observable.getNotifier(this.#listbox).unsubscribe(this.#activeWatch, 'activeValue');
		this.#loads++;
		super.disconnectedCallback();
	}

	/** Read the app, its instance and its commands, keeping what a person has typed for the same command. */
	async load(): Promise<void> {
		const context = this.context;
		if (!context) return;
		const load = ++this.#loads;
		this.loading = true;
		const { client, instance } = context;
		const detail = await client.call<AppReading>('app-get', { instance });
		if (load !== this.#loads) return;
		if (!detail.success || !detail.data) {
			this.loading = false;
			this.loadFailure = asFailure(detail.error as Failure | undefined);
			return;
		}
		const list = await client.call<{ commands: unknown; hidden: number }>('app-command-list', {
			instance,
		});
		if (load !== this.#loads) return;
		let mounted: InstanceReading | null = null;
		if (detail.data.kind === 'mounted') {
			const instances = await client.call<{ instances: InstanceReading[] }>('app-instance-list');
			if (load !== this.#loads) return;
			mounted = instances.data?.instances.find((row) => row.instance === instance) ?? null;
		}
		this.loading = false;
		this.loadFailure = asFailure(list.error as Failure | undefined);
		this.app = detail.data;
		this.mounted = mounted;
		this.instanceError = asFailure(mounted?.error ?? (mounted ? detail.data.error : undefined));
		this.commands = readCommands(list.data?.commands);
		this.#applyFilter();
		const kept = this.commands.find(({ name }) => name === this.selected?.name);
		this.#select(kept ?? this.commands[0] ?? null);
	}

	/** A discovery from elsewhere, an agent's or the automatic one. Its own Refresh re-reads when it ends. */
	async reload(): Promise<void> {
		if (!this.refreshing) await this.load();
	}

	// ─── The list ──────────────────────────────────────────────────────────────────

	handleFilter(event: Event): boolean {
		this.filter = (event.target as VioletTextField).value;
		this.#applyFilter();
		return true;
	}

	#applyFilter(): void {
		this.visible = filterCommands(this.commands, this.filter);
		this.filterStatus = filterStatus(this.commands.length, this.visible.length, this.filter);
		void Updates.next().then(() => this.#syncActive());
	}

	/** Mark the row the keyboard is on, since the option does not say (as `loam-list`). */
	#syncActive(): void {
		const listbox = this.#listbox;
		for (const option of listbox?.options ?? []) {
			option.toggleAttribute('data-active', option.value === listbox?.activeValue);
		}
	}

	/**
	 * A press focuses the list, which scrolls its active row into view, so with that row scrolled away the
	 * row under the pointer moves before the click lands. So the pressed row becomes the active one first.
	 */
	handleListPress(event: Event): boolean {
		const row = event
			.composedPath()
			.find((node) => (node as Element).localName === 'violet-option');
		const listbox = this.#listbox;
		if (row && listbox) listbox.activeValue = (row as HTMLElement & { value: string }).value;
		return true;
	}

	handleSelect(event: CustomEvent<{ value: string }>): void {
		event.stopPropagation();
		const name = event.detail?.value;
		if (typeof name !== 'string' || name === this.selected?.name) return;
		this.#select(this.commands.find((command) => command.name === name) ?? null);
	}

	#select(command: ConsoleCommand | null): void {
		const previous = this.selected;
		this.selected = command;
		// A refresh of the same schema keeps what the person typed.
		if (
			previous &&
			command?.name === previous.name &&
			JSON.stringify(command.inputSchema) === JSON.stringify(previous.inputSchema)
		) {
			return;
		}
		if (command?.name !== previous?.name) this.#clearResult();
		this.#model = renderForm(command?.inputSchema);
		this.#views = this.#model.fields.map(fieldView);
		const fields = this.#find<HTMLElement>('.fields');
		fields?.replaceChildren(...this.#views.map(({ element }) => element));
		if (fields) fields.hidden = this.#views.length === 0;
		this.noInput = command !== null && this.#views.length === 0;
		void Updates.next().then(() => {
			for (const view of this.#views) view.connected?.();
		});
	}

	#clearResult(): void {
		this.status = '';
		this.#validationFailed = false;
		this.labels = [];
		this.#find('.output')?.replaceChildren();
	}

	// ─── Running ───────────────────────────────────────────────────────────────────

	/**
	 * Enter in a single-line field runs (7.7). Not an IME's, which is choosing a character, nor a held key's,
	 * which would run it again and again. A destructive command waits for Run, since there is no prompt yet.
	 */
	handleKey(event: KeyboardEvent): boolean {
		const target = event.target as Element | null;
		if (event.key !== 'Enter' || event.isComposing || target?.localName !== 'violet-text-field') {
			return true;
		}
		event.preventDefault();
		if (event.repeat) return true;
		if (this.selected?.destructive)
			this.status = 'This command is destructive: press Run to run it.';
		else void this.run();
		return true;
	}

	/** A "did not run" goes once nothing is in error, and an error goes with its own field's change. */
	handleEdit(): boolean {
		if (this.#validationFailed && !this.#views.some(({ element }) => hasError(element))) {
			this.#validationFailed = false;
			this.status = '';
		}
		return true;
	}

	#refused(text: string): void {
		this.#validationFailed = true;
		// Cleared first, so saying the same thing twice is heard twice.
		this.status = '';
		void Updates.next().then(() => {
			if (this.#validationFailed) this.status = text;
		});
	}

	async run(): Promise<void> {
		const context = this.context;
		const command = this.selected;
		if (!context || !command || this.running) return;
		const reading = readForm(
			this.#model,
			Object.fromEntries(this.#views.map(({ field, read }) => [field.name, read()]))
		);
		for (const view of this.#views) {
			view.showError(reading.ok ? null : errorOf(reading.errors, view.field.name));
		}
		if (!reading.ok) {
			const count = Object.keys(reading.errors).length;
			this.#refused(
				`${command.name} did not run: ${count} ${count === 1 ? 'field needs' : 'fields need'} attention.`
			);
			this.#views.find(({ field }) => errorOf(reading.errors, field.name))?.element.focus();
			return;
		}
		const runButton = this.#find<VioletButton>('.run');
		const hadFocus = this.shadowRoot?.activeElement === runButton;
		this.#validationFailed = false;
		this.running = true;
		this.status = `Running ${command.name}…`;
		let result: CommandResult;
		try {
			result = await context.client.call(command.name, reading.input);
		} catch (cause) {
			result = {
				success: false,
				error: {
					code: 'CALL_REJECTED',
					message: String((cause as Error)?.message ?? cause),
					suggestion: 'Run it again, or read the journal for what happened',
				},
			};
		}
		if (!this.isConnected) return;
		this.running = false;
		this.#show(command.name, result);
		// A disabled button loses focus. Taken back only if it went nowhere: the person may have moved on.
		if (hadFocus) void Updates.next().then(() => focusIfLost(runButton));
	}

	#show(name: string, result: CommandResult): void {
		this.status = outcomeText(name, result);
		// A person who has moved to another command hears how this one ended, and sees that one's form alone.
		if (name !== this.selected?.name) return;
		const output = this.#find<HTMLElement>('.output');
		if (!output) return;
		try {
			this.labels = resultLabels(result.metadata);
			// `WebAdapter` escapes every value it writes, so this is only its own <pre>, <span> and <br>.
			output.innerHTML = resultHtml(result);
		} catch {
			this.labels = [];
			output.textContent = 'This result is not a CommandResult, so it cannot be shown.';
		}
	}

	// ─── A mounted instance ────────────────────────────────────────────────────────

	async refresh(): Promise<void> {
		const context = this.context;
		if (!context || this.refreshing) return;
		const hadFocus = this.shadowRoot?.activeElement === this.#find('.refresh');
		this.refreshing = true;
		this.refreshStatus = '';
		const result = await context.client.call('app-instance-refresh', {
			instance: context.instance,
		});
		if (!this.isConnected) return;
		await this.load();
		this.refreshing = false;
		this.refreshStatus = result.success
			? 'Refreshed.'
			: `Refresh failed: ${String(result.error?.code ?? 'no error given')}`;
		if (hadFocus) void Updates.next().then(() => focusIfLost(this.#find('.refresh')));
	}
}

for (const name of [
	'app',
	'mounted',
	'instanceError',
	'loadFailure',
	'loading',
	'commands',
	'visible',
	'filter',
	'filterStatus',
	'selected',
	'noInput',
	'running',
	'refreshing',
	'refreshStatus',
	'status',
	'labels',
]) {
	observable(LoamConsole.prototype, name);
}
observable(LoamConsole.prototype, 'context');

export const consoleDefinition = {
	name: 'loam-console',
	template,
	styles: consoleStyles,
} as const;

/** What the console's shadow roots use, each defined globally by its module (5.4). */
const INNER_ELEMENTS = [
	'violet-button',
	'violet-checkbox',
	'violet-listbox',
	'violet-option',
	'violet-select',
	'violet-spinner',
	'violet-text-area',
	'violet-text-field',
] as const;

/**
 * Define `loam-console` globally, and with its elements in `registry` when given: the mount's, whose
 * lookup does not fall through to the global one. Idempotent, per registry.
 */
export async function defineConsole(registry?: CustomElementRegistry): Promise<void> {
	if (!customElements.get(consoleDefinition.name)) {
		await LoamConsole.define(consoleDefinition);
	}
	if (!registry) return;
	for (const name of [consoleDefinition.name, ...INNER_ELEMENTS]) {
		const type = customElements.get(name);
		const definition = type && FASTElementDefinition.getByType(type);
		if (!definition) throw new TypeError(`The console's element '${name}' has no definition`);
		definition.define(registry);
	}
}

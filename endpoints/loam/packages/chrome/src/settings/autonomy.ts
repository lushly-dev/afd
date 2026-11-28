/**
 * @fileoverview `loam-autonomy-section` (phase 4 specification, 4.5, 3.5 and 13), the settings tree's Autonomy entry:
 * the advisory notice above the rows, the workspace's rows with its mode and ceiling, the active project's rows, the
 * person's own cap, and why a command gets its mode, the chain `autonomy-get` gives. It reads the scope it shows alone,
 * `{ project }` in a project and `{ level: 'workspace' }` otherwise, a page at a time, so the general controls and the
 * cap always show however many rules a workspace holds; "Show more rules" reads the next page. Every read and write is a command
 * (`autonomy-list`, `autonomy-get`, `autonomy-set`), made in the scope the panel shows, so a write never lands in
 * another project. Each control the caller may not use is disabled with the reason `autonomy-list` gives; on a hosted
 * `provider` deployment the cap's field is section 13's message instead. Native controls, as the settings section's.
 */

import type { LoamKernel } from '@lushly-dev/loam-kernel';
import {
	ADVISORY,
	type AutonomyRow,
	chainWords,
	HOSTED_CAP,
	MODE_WORDS,
	MODES,
	type Mode,
	rowWords,
} from './autonomy-words.js';
import { button, el, SettingsElement } from './parts.js';

interface Answer<T = unknown> {
	success: boolean;
	data?: T;
	error?: { code?: string; message?: string; suggestion?: string };
}
type Writable = { writable: boolean; reason?: string };
/** The scope the panel shows, which each of its reads and writes is made in. */
type PanelScope = { workspace: string; project?: string };
interface Listed {
	rows: AutonomyRow[];
	shellCommands?: string[];
	ceiling: Mode | null;
	cap: Mode | null;
	writable: { workspace: Writable; project?: Writable; cap: Writable };
	cursor: string | null;
}

/** `approval-health-get`'s answer, as the section reads it (phase 5 specification, 6.3). */
interface HealthRead {
	rows: Array<{
		instance: string;
		command: string;
		reason: string;
		acted: number;
		asked: number;
		confirmed: number;
		declined: number;
		expired: number;
		suggested: number;
	}>;
	flags: Array<{ instance: string; command: string; message: string }>;
}

/** Why a part is not the caller's to change, in words. */
const REASONS: Record<string, string> = {
	OWNER_REQUIRED:
		'Only an owner of the workspace, or a project’s creator for its own rules, can change this.',
	HUMAN_REQUIRED: 'Only a person can change this, here in the shell.',
	SHARED_RECORD_UNAVAILABLE: 'This deployment cannot keep autonomy yet.',
	UNREAD: 'The rules could not be read, so nothing here can change yet.',
};

const failed = (answer: Answer): string =>
	[answer.error?.message ?? 'That did not work', answer.error?.suggestion]
		.filter(Boolean)
		.join('. ');

/** A select of the modes, with a first option for none. */
function modeSelect(
	label: string,
	id: string,
	value: Mode | null | undefined,
	none: string,
	disabled: boolean
): { box: HTMLElement; select: HTMLSelectElement } {
	const select = el('select', { id }) as HTMLSelectElement;
	select.append(
		el('option', { value: '' }, none),
		...MODES.map((mode) => el('option', { value: mode }, MODE_WORDS[mode]))
	);
	select.value = value ?? '';
	select.disabled = disabled;
	return { box: el('label', { for: id }, label, select), select };
}

/** The add-rule form's choices not yet sent: its app, its command (empty for every command) and its mode. */
interface AddDraft {
	app?: string;
	command?: string | undefined;
	mode?: string;
}

export class LoamAutonomySection extends SettingsElement {
	kernel: LoamKernel | null = null;
	scope: PanelScope = { workspace: '' };
	project: { id: string; name: string } | null = null;
	apps: ReadonlyArray<{ instance: string; title: string }> = [];
	/** Rows per page of `autonomy-list` (its default). */
	pageSize = 100;
	/** A key the route names, `cap`: revealed and focused once the section shows it (3.2's hand-off). */
	target: string | undefined;
	#reads = 0;
	#listed: Listed | undefined;
	/** The scope `#listed` was read in. */
	#listedFor: string | undefined;
	#status = el('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
	#body = el('div', { class: 'fields' });
	#explained = el('div', { class: 'section', id: 'autonomy-explained' });
	/** By scope and level, the add-rule form's choices not yet sent (#2843). */
	#drafts = new Map<string, AddDraft>();
	/** Approval health for the scope shown (phase 5 specification, 6.3), read beside the rules. */
	#health = el('div', { class: 'section', id: 'autonomy-health' });

	connectedCallback(): void {
		const root = this.shadowRoot as ShadowRoot;
		if (root.childElementCount > 0) return;
		root.append(
			el(
				'div',
				{ class: 'section' },
				el('p', { class: 'note', id: 'autonomy-advisory', role: 'note' }, ADVISORY),
				this.#status,
				this.#body
			)
		);
	}

	#title = (instance: string): string =>
		this.apps.find((app) => app.instance === instance)?.title ??
		(instance === 'shell' ? 'Shell' : instance);

	#call<T>(name: string, input: unknown, scope = this.scope): Promise<Answer<T>> {
		return (this.kernel?.call(name, input, { scope }) ??
			Promise.resolve({ success: false })) as Promise<Answer<T>>;
	}

	/** The scope shown, as `autonomy-list` reads it: the project's rows in a project, the workspace's otherwise. */
	#asked(): Record<string, unknown> {
		return {
			...(this.project ? { project: this.project.id } : { level: 'workspace' }),
			limit: this.pageSize,
			includeShellCommands: true,
		};
	}

	/** Read the first page again and draw it; a read overtaken by a later one draws nothing. */
	async read(): Promise<void> {
		const generation = ++this.#reads;
		const listed = await this.#call<Listed>('autonomy-list', this.#asked(), this.scope);
		if (generation !== this.#reads) return;
		const key = JSON.stringify([this.scope, this.project?.id ?? null]);
		if (!listed.success || !listed.data) {
			// The cap and the general controls stay: what was read for this scope, else nothing to change, with the
			// failure beside them rather than in their place (the re-check's improvement 1).
			if (this.#listedFor !== key) {
				const none = { writable: false, reason: 'UNREAD' };
				this.#listed = {
					rows: [],
					ceiling: null,
					cap: null,
					writable: { workspace: none, project: none, cap: none },
					cursor: null,
				};
				this.#listedFor = key;
			}
			this.#draw(`The rules could not be read. ${failed(listed)}`);
			return;
		}
		this.#listed = listed.data;
		this.#listedFor = key;
		this.#draw();
	}

	/** The next page, its rows after those shown. */
	async #more(): Promise<void> {
		const held = this.#listed;
		if (!held?.cursor) return;
		const generation = ++this.#reads;
		const next = await this.#call<Listed>(
			'autonomy-list',
			{ ...this.#asked(), cursor: held.cursor },
			this.scope
		);
		if (generation !== this.#reads) return;
		if (!next.success || !next.data) {
			this.#status.textContent = `More rules could not be read. ${failed(next)}`;
			return;
		}
		this.#listed = { ...next.data, rows: [...held.rows, ...next.data.rows] };
		this.#draw();
		this.#status.textContent = `${next.data.rows.length} more rules are shown.`;
	}

	#draw(problem?: string): void {
		const scope = this.scope;
		const project = this.project;
		const { rows, ceiling, cap, writable, cursor } = this.#listed as Listed;
		const general = rows.find((row) => row.id === 'workspace/-/*/*');
		const parts: HTMLElement[] = [
			this.#level(
				'Workspace',
				'workspace',
				undefined,
				rows.filter((row) => row.level === 'workspace' && row.instance !== undefined),
				general,
				ceiling,
				writable.workspace,
				scope
			),
		];
		if (project) {
			parts.push(
				this.#level(
					`Project ${project.name}`,
					'project',
					project.id,
					rows.filter(
						(row) =>
							row.level === 'project' && row.project === project.id && row.instance !== undefined
					),
					rows.find((row) => row.id === `project/${project.id}/*/*`),
					null,
					writable.project ?? { writable: false },
					scope
				)
			);
		}
		if (cursor) parts.push(button('Show more rules', () => this.#more(), { id: 'autonomy-more' }));
		parts.push(this.#cap(cap, writable.cap, scope), this.#explain(scope), this.#health);
		void this.#readHealth();
		this.#body.replaceChildren(
			...(problem ? [el('p', { class: 'error', id: 'autonomy-read-error' }, problem)] : []),
			...parts
		);
		// The cap's link (`#cap`): its control, or section 13's message in its place, shown and focused once.
		if (this.target === 'cap') {
			this.target = undefined;
			const shown =
				this.shadowRoot?.querySelector<HTMLElement>('#autonomy-cap') ??
				this.shadowRoot?.querySelector<HTMLElement>('#cap');
			shown?.scrollIntoView({ block: 'nearest' });
			shown?.focus();
		}
	}

	/**
	 * How often agents asked, per command, for the scope shown (6.3): each row's counts in words, and the flag where the
	 * person approves nearly everything. Its own read, so a failure leaves the rules as they are.
	 */
	async #readHealth(): Promise<void> {
		const generation = this.#reads;
		const read = await this.#call<HealthRead>(
			'approval-health-get',
			this.project ? { project: this.project.id } : {},
			this.scope
		);
		if (generation !== this.#reads) return;
		const heading = el('h3', {}, 'How often agents asked');
		if (!read.success || !read.data) {
			this.#health.replaceChildren(heading, el('p', { class: 'note' }, 'It could not be read.'));
			return;
		}
		const { rows, flags } = read.data;
		const lines = rows.map((row) => {
			const flag = flags.find(
				(each) => each.instance === row.instance && each.command === row.command
			);
			return el(
				'li',
				{},
				`${rowWords({ instance: row.instance, command: row.command }, this.#title)}${
					row.reason === 'policy' ? '' : ` (asked for ${row.reason})`
				}: ran without asking ${row.acted}, asked ${row.asked}, approved ${row.confirmed}, declined ${row.declined}, expired ${row.expired}, suggested ${row.suggested}`,
				...(flag ? [el('p', { class: 'note', role: 'note' }, flag.message)] : [])
			);
		});
		this.#health.replaceChildren(
			heading,
			lines.length === 0
				? el('p', { class: 'note' }, 'No agent has called a command in the last 90 days.')
				: el('ul', { class: 'health' }, ...lines)
		);
	}

	/** Write, say how it went in words, and read again either way. */
	async #set(
		input: Record<string, unknown>,
		scope: PanelScope,
		what: string,
		saved?: () => void
	): Promise<void> {
		const done = await this.#call('autonomy-set', input, scope);
		if (done.success) saved?.();
		this.#status.textContent = done.success
			? `${what} is saved.`
			: `${what} was not saved. ${failed(done)}`;
		await this.read();
	}

	#note(writable: Writable): HTMLElement[] {
		return writable.writable
			? []
			: [
					el(
						'p',
						{ class: 'note' },
						REASONS[writable.reason ?? ''] ?? 'You cannot change this here.'
					),
				];
	}

	/** One level's rows: its general mode (and the workspace's ceiling), each app or command rule, and a new rule. */
	#level(
		title: string,
		level: 'workspace' | 'project',
		project: string | undefined,
		rows: AutonomyRow[],
		general: AutonomyRow | undefined,
		ceiling: Mode | null,
		writable: Writable,
		scope: PanelScope
	): HTMLElement {
		const at = { level, ...(project ? { project } : {}) };
		const off = !writable.writable;
		const key = `${level}-mode`;
		const mode = modeSelect(
			level === 'workspace' ? 'Agents in this workspace' : 'Agents in this project',
			key,
			general?.mode,
			level === 'workspace' ? 'The default' : 'The workspace’s',
			off
		);
		mode.select.addEventListener('change', () =>
			this.#set({ ...at, mode: mode.select.value || null }, scope, `${title}'s mode`)
		);
		const fields: HTMLElement[] = [mode.box];
		if (level === 'workspace') {
			const bound = modeSelect(
				'Projects may go as far as',
				'workspace-ceiling',
				ceiling,
				'The workspace’s mode',
				off
			);
			bound.select.addEventListener('change', () =>
				this.#set({ ...at, ceiling: bound.select.value || null }, scope, 'The ceiling')
			);
			fields.push(bound.box);
		}
		const list = el(
			'ul',
			{ class: 'list', 'aria-label': `${title}'s rules for apps and commands` },
			...rows.map((row) => {
				const what = rowWords(row, this.#title);
				const id = `rule-${row.id.replaceAll(/[^a-zA-Z0-9-]/g, '_')}`;
				const select = modeSelect(what, id, row.mode, 'Remove', off);
				select.select.addEventListener('change', () =>
					this.#set(
						{
							...at,
							instance: row.instance,
							command: row.command,
							mode: select.select.value || null,
						},
						scope,
						what
					)
				);
				return el(
					'li',
					{ class: 'row', 'data-row': row.id },
					select.box,
					...(row.orphan
						? [
								el(
									'p',
									{ class: 'note' },
									'Its app or command no longer exists, so it applies to nothing.'
								),
							]
						: [])
				);
			})
		);
		return el(
			'section',
			{ class: 'section', 'aria-label': title },
			el('h3', {}, title),
			el('div', { class: 'row' }, ...fields),
			list,
			this.#add(at, off, scope),
			...this.#note(writable)
		);
	}

	/**
	 * A new rule for an app, or one of its commands, at a level. Its choices are kept as a draft for this scope and
	 * level, so a read again, as every change's event asks, draws the form with them, a person's half-made rule not
	 * lost to another write, nor carried into another scope (#2843).
	 */
	#add(at: { level: string; project?: string }, off: boolean, scope: PanelScope): HTMLElement {
		const prefix = `add-${at.level}`;
		const key = JSON.stringify([this.scope, this.project?.id ?? null, at.level]);
		const draft = this.#drafts.get(key) ?? {};
		const keep = (change: AddDraft) =>
			this.#drafts.set(key, { ...this.#drafts.get(key), ...change });
		const app = el('select', { id: `${prefix}-app` }) as HTMLSelectElement;
		app.append(...this.apps.map(({ instance, title }) => el('option', { value: instance }, title)));
		if (this.#listed?.shellCommands) app.append(el('option', { value: 'shell' }, 'Shell'));
		if (draft.app && [...app.options].some((option) => option.value === draft.app))
			app.value = draft.app;
		const command = el('select', { id: `${prefix}-command` }) as HTMLSelectElement;
		const mode = modeSelect(
			'Mode',
			`${prefix}-mode`,
			draft.mode === undefined ? 'ask' : ((draft.mode || null) as Mode | null),
			'Choose',
			off
		);
		const fill = async () => {
			const instance = app.value;
			command.replaceChildren();
			const choices =
				instance === 'shell' && this.#listed?.shellCommands
					? this.#listed.shellCommands.map((name) => ({ name, title: name }))
					: ((
							await this.#call<{ commands: Array<{ name: string; title?: string }> }>(
								'app-command-list',
								{ instance },
								scope
							)
						).data?.commands ?? []);
			if (app.value !== instance) return;
			command.replaceChildren(
				el('option', { value: '' }, 'Every command'),
				...choices.map(({ name, title }) => el('option', { value: name }, title ?? name))
			);
			// The draft's command, once its app's commands are listed; until then the select is empty and Add rule
			// sends nothing, so a pending list never widens the rule to every command.
			const wanted = this.#drafts.get(key);
			if (wanted?.app === instance && choices.some(({ name }) => name === wanted.command))
				command.value = wanted.command as string;
		};
		app.addEventListener('change', () => {
			keep({ app: app.value, command: undefined });
			void fill();
		});
		command.addEventListener('change', () => keep({ app: app.value, command: command.value }));
		mode.select.addEventListener('change', () => keep({ mode: mode.select.value }));
		if (app.value) void fill();
		for (const control of [app, command]) control.disabled = off;
		const form = el(
			'form',
			{ 'aria-label': `A new rule, ${at.level}` },
			el('label', { for: app.id }, 'App', app),
			el('label', { for: command.id }, 'Command', command),
			mode.box,
			button(
				'Add rule',
				() => {
					// Never sent when the caller may not set this level, whatever the button's state says.
					if (off || !mode.select.value || command.selectedIndex < 0) return;
					// Saved: the next form starts afresh; refused, it keeps the choices to change.
					return this.#set(
						{
							...at,
							instance: app.value,
							...(command.value ? { command: command.value } : {}),
							mode: mode.select.value,
						},
						scope,
						'The new rule',
						() => this.#drafts.delete(key)
					);
				},
				off ? { 'aria-disabled': 'true' } : {}
			)
		);
		form.addEventListener('submit', (event) => event.preventDefault());
		return form;
	}

	/** The person's own cap (4.1), or section 13's message in its place on a hosted deployment. */
	#cap(cap: Mode | null, writable: Writable, scope: PanelScope): HTMLElement {
		const title = el('h3', {}, 'Your cap');
		const hint = el(
			'p',
			{ class: 'note' },
			'However far a rule lets agents go for you, never further than this.'
		);
		if (writable.reason === 'SHARED_RECORD_UNAVAILABLE')
			return el(
				'section',
				{ class: 'section', 'aria-label': 'Your cap', id: 'cap', tabindex: '-1' },
				title,
				el('p', { class: 'note' }, HOSTED_CAP)
			);
		const field = modeSelect('Your cap', 'autonomy-cap', cap, 'No cap', !writable.writable);
		field.select.addEventListener('change', () =>
			this.#set({ level: 'person', cap: field.select.value || null }, scope, 'Your cap')
		);
		return el(
			'section',
			{ class: 'section', 'aria-label': 'Your cap', id: 'cap', tabindex: '-1' },
			title,
			hint,
			field.box,
			...this.#note(writable)
		);
	}

	/** Why a command gets its mode here: `autonomy-get`'s chain, in words (4.2). */
	#explain(scope: PanelScope): HTMLElement {
		const command = el('input', {
			id: 'explain-command',
			type: 'text',
			autocomplete: 'off',
		}) as HTMLInputElement;
		const show = async () => {
			const name = command.value.trim();
			if (!name) return;
			const got = await this.#call<{
				mode: Mode;
				chain: Array<{ id: string; mode: Mode; as: 'mode' | 'ceiling' | 'cap' }>;
			}>('autonomy-get', { command: name }, scope);
			if (!got.success || !got.data) {
				this.#explained.replaceChildren(el('p', { class: 'error' }, failed(got)));
				return;
			}
			this.#explained.replaceChildren(
				el('p', {}, `${name}: ${MODE_WORDS[got.data.mode]}`),
				el(
					'ol',
					{ class: 'list' },
					...got.data.chain.map((step) =>
						el('li', {}, chainWords(step, this.#title, this.project?.name))
					)
				)
			);
		};
		const form = el(
			'form',
			{ 'aria-label': 'Why a command gets its mode' },
			el('label', { for: command.id }, 'Command', command),
			button('Explain', show)
		);
		form.addEventListener('submit', (event) => {
			event.preventDefault();
			void show();
		});
		this.#explained.replaceChildren();
		return el(
			'section',
			{ class: 'section', 'aria-label': 'Why a command gets its mode' },
			el('h3', {}, 'Why a command gets its mode'),
			form,
			this.#explained
		);
	}
}

export const AUTONOMY_SECTION_ELEMENT = 'loam-autonomy-section';

export function defineAutonomySection(): void {
	if (!customElements.get(AUTONOMY_SECTION_ELEMENT))
		customElements.define(AUTONOMY_SECTION_ELEMENT, LoamAutonomySection);
}

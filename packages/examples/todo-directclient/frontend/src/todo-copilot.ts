/**
 * `<todo-copilot>`: the copilot panel beside the to-do page. The person asks in words; the
 * server's model calls the to-do commands through DirectClient, and the panel shows each call as
 * it runs, asks the person to approve a held clear, and runs view-state calls in this page, so
 * the list beside it changes (job 6). The mode switch sets what the server's `allow` permits
 * (job 10). Light DOM, like `<todo-app>`, so its landmark and heading are part of the document.
 */

import type { TodoSession } from '@afd/example-todo-ui/session';
import { FASTElement, html, observable, repeat, when } from '@lushly-dev/fast-element';
import { answer, type CopilotMode, runTurn, type TurnEvent } from './turn-client';

/** A command the model ran in this turn, as its card shows it. */
interface CallView {
	index: number;
	name: string;
	args: Record<string, unknown>;
	state: 'executing' | 'output-available' | 'output-error';
	summary: string;
	output: string;
}

/** A held call waiting for the person, and what became of it. */
interface ApprovalView {
	turn: string;
	ask: number;
	command: string;
	summary: string;
	state: 'pending' | 'approved' | 'denied';
	note: string;
}

/** One message in the panel: the person's, or the copilot's answer with what it ran. */
interface Entry {
	id: number;
	role: 'user' | 'assistant' | 'system';
	text: string;
	calls: CallView[];
	approvals: ApprovalView[];
	busy: boolean;
}

const json = (value: unknown) => JSON.stringify(value, null, 2);

/** The one-line summary of a finished call: its outcome and time, or its error code. */
function resultSummary(event: Extract<TurnEvent, { type: 'result' }>): string {
	const ms = `${Math.round(event.latencyMs * 1000) / 1000} ms`;
	if (event.success) return `Succeeded in ${ms}`;
	const code = (event.result as { code?: string } | undefined)?.code ?? 'failed';
	return `Failed: ${code}`;
}

const callTemplate = html<CallView>`
	<violet-tool-call-card class="copilot-call" tool-name="${(x) => x.name}" state="${(x) => x.state}">
		<span slot="summary">${(x) => x.summary}</span>
		<pre slot="input">${(x) => json(x.args)}</pre>
		<pre slot="output">${(x) => x.output}</pre>
	</violet-tool-call-card>
`;

const approvalTemplate = html<ApprovalView>`
	<violet-approval-card
		class="copilot-approval"
		state="${(x) => x.state}"
		data-turn="${(x) => x.turn}"
		data-ask="${(x) => x.ask}"
	>
		<p slot="summary" class="approval-message">${(x) => x.summary}</p>
		<span slot="detail">${(x) => x.note}</span>
	</violet-approval-card>
`;

const entryTemplate = html<Entry>`
	<li class="copilot-entry">
		<violet-message message-role="${(x) => x.role}" ?streaming="${(x) => x.busy}">
			${repeat((x) => x.calls, callTemplate)}
			${repeat((x) => x.approvals, approvalTemplate)}
			<violet-message-text>${(x) => (x.busy && !x.text ? 'Working…' : x.text)}</violet-message-text>
		</violet-message>
	</li>
`;

const template = html<TodoCopilot>`
	<aside class="copilot" aria-labelledby="copilot-heading">
		<h2 id="copilot-heading">Copilot</h2>
		<p class="copilot-about">
			A model on the server runs the same commands, in its own process, through DirectClient. It
			acts as an agent: clearing completed todos waits for you here.
		</p>
		<violet-segmented-control
			class="copilot-mode"
			label="The copilot may"
			:value="${(x) => x.mode}"
			@change="${(x, c) => x.setMode((c.event.target as HTMLInputElement).value)}"
		>
			<violet-segment value="change">Change todos</violet-segment>
			<violet-segment value="look">Only look</violet-segment>
		</violet-segmented-control>
		<ol
			class="copilot-messages"
			aria-live="polite"
			aria-label="Conversation"
			@approve="${(x, c) => x.decideFrom(c.event, true)}"
			@deny="${(x, c) => x.decideFrom(c.event, false)}"
		>
			${repeat((x) => x.entries, entryTemplate, { recycle: false })}
		</ol>
		${when(
			(x) => x.entries.length === 0,
			html`<p class="copilot-empty">
				Try “Add three todos for the weekend”, “Show only my urgent open todos” or “Clear the done
				ones”.
			</p>`
		)}
		<div class="copilot-ask">
			<violet-text-field
				class="copilot-input"
				label="Ask the copilot"
				:value="${(x) => x.draft}"
				?disabled="${(x) => x.busy}"
				@input="${(x, c) => {
					x.draft = (c.event.target as HTMLInputElement).value;
				}}"
				@keydown="${(x, c) => x.sendOnEnter(c.event as KeyboardEvent)}"
			></violet-text-field>
			<violet-button
				class="copilot-send"
				?disabled="${(x) => x.busy}"
				@click="${(x) => x.send()}"
				>Send</violet-button
			>
		</div>
	</aside>
`;

export class TodoCopilot extends FASTElement {
	declare entries: Entry[];
	declare mode: CopilotMode;
	declare draft: string;
	declare busy: boolean;
	session: TodoSession | undefined;
	/** The server: this page's origin unless the page was opened with `?backend=`. */
	baseUrl = '';
	private nextId = 1;
	private leaving: AbortController | undefined;

	constructor() {
		super();
		this.entries = [];
		this.mode = 'change';
		this.draft = '';
		this.busy = false;
	}

	/** Work with this session: its view runs the view calls, and it refreshes after changes. */
	attach(session: TodoSession, baseUrl: string): void {
		this.session = session;
		this.baseUrl = baseUrl;
	}

	setMode(value: string): void {
		if (value === 'change' || value === 'look') this.mode = value;
	}

	/** Enter sends: violet buttons do not submit a form. */
	sendOnEnter(event: KeyboardEvent): boolean {
		if (event.key !== 'Enter' || event.isComposing) return true;
		void this.send();
		return false;
	}

	/** Replace one entry, so the panel renders the change. */
	private update(id: number, change: (entry: Entry) => Entry): void {
		this.entries = this.entries.map((entry) => (entry.id === id ? change(entry) : entry));
	}

	/** Send the draft as one turn and show it as it runs. */
	async send(): Promise<void> {
		const message = this.draft.trim();
		if (!message || this.busy) return;
		this.draft = '';
		this.busy = true;
		const reply: Entry = {
			id: this.nextId++,
			role: 'assistant',
			text: '',
			calls: [],
			approvals: [],
			busy: true,
		};
		this.entries = [
			...this.entries,
			{ id: this.nextId++, role: 'user', text: message, calls: [], approvals: [], busy: false },
			reply,
		];
		this.leaving = new AbortController();
		let turn = '';
		try {
			const end = await runTurn({
				baseUrl: this.baseUrl,
				message,
				mode: this.mode,
				signal: this.leaving.signal,
				runView: async (command, input) => {
					const view = this.session?.view.commands;
					if (!view) throw new Error('No view');
					return view.execute(command, input);
				},
				onEvent: (event) => {
					if (event.type === 'turn') turn = event.turn;
					this.show(reply.id, turn, event);
				},
			});
			this.update(reply.id, (entry) => ({
				...entry,
				role: end.type === 'error' ? 'system' : 'assistant',
				text: end.type === 'error' ? `The copilot could not answer: ${end.error}` : end.message,
				busy: false,
			}));
		} catch {
			// The page is going away
		} finally {
			this.busy = false;
			this.leaving = undefined;
			// Whatever the copilot changed, the list shows it now
			void this.session?.refresh();
		}
	}

	/** Show one event of the turn in its reply. */
	private show(id: number, turn: string, event: TurnEvent): void {
		if (event.type === 'call') {
			this.update(id, (entry) => ({
				...entry,
				calls: [
					...entry.calls,
					{
						index: event.index,
						name: event.name,
						args: event.args,
						state: 'executing',
						summary: 'Running…',
						output: '',
					},
				],
			}));
		} else if (event.type === 'result') {
			this.update(id, (entry) => ({
				...entry,
				calls: entry.calls.map((call) =>
					call.index === event.index
						? {
								...call,
								state: event.success ? 'output-available' : 'output-error',
								summary: resultSummary(event),
								output: json(event.result),
							}
						: call
				),
			}));
			// A change to the todos shows in the list at once; a view change already has
			if (event.success && !event.name.startsWith('view-state-')) void this.session?.refresh();
		} else if (event.type === 'approval') {
			this.update(id, (entry) => ({
				...entry,
				approvals: [
					...entry.approvals,
					{
						turn,
						ask: event.ask,
						command: event.command,
						summary: event.summary || `Run ${event.command}?`,
						state: 'pending',
						note: 'The copilot asked for this. Nothing is removed if you deny it.',
					},
				],
			}));
		} else if (event.type === 'withdrawn') {
			this.update(id, (entry) => ({
				...entry,
				approvals: entry.approvals.map((approval) =>
					approval.ask === event.ask && approval.state === 'pending'
						? { ...approval, state: 'denied', note: 'No answer in time, so it did not run.' }
						: approval
				),
			}));
		}
	}

	/** An approval card's approve or deny, which bubbles up to the conversation. */
	decideFrom(event: Event, approved: boolean): void {
		const card = event.target as HTMLElement;
		const turn = card.dataset.turn;
		const ask = Number(card.dataset.ask);
		const approval = this.entries
			.flatMap((entry) => entry.approvals)
			.find((item) => item.turn === turn && item.ask === ask);
		if (approval) void this.decide(approval, approved);
	}

	/** The person's answer to a held call. */
	async decide(approval: ApprovalView, approved: boolean): Promise<void> {
		if (approval.state !== 'pending') return;
		const settle = (state: ApprovalView['state'], note: string) => {
			this.entries = this.entries.map((entry) => ({
				...entry,
				approvals: entry.approvals.map((item) =>
					item.turn === approval.turn && item.ask === approval.ask ? { ...item, state, note } : item
				),
			}));
		};
		settle(
			approved ? 'approved' : 'denied',
			approved ? 'You approved it.' : 'You denied it, so it did not run.'
		);
		const accepted = await answer(this.baseUrl, {
			turn: approval.turn,
			ask: approval.ask,
			approved,
		}).catch(() => false);
		if (!accepted) settle('denied', 'The question had already ended, so it did not run.');
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();
		this.leaving?.abort();
	}
}

for (const name of ['entries', 'mode', 'draft', 'busy']) observable(TodoCopilot.prototype, name);

export async function defineTodoCopilot(): Promise<void> {
	if (customElements.get('todo-copilot')) return;
	await FASTElement.define(TodoCopilot, {
		name: 'todo-copilot',
		template,
		shadowOptions: null,
	});
}

/**
 * `<todo-copilot>`: the copilot panel beside the to-do page. The person asks in words; the
 * server's model calls the to-do commands through DirectClient, and the panel shows each call as
 * it runs, asks the person to approve a held clear, and runs view-state calls in this page, so
 * the list beside it changes (job 6). The mode switch sets what the server's `allow` permits
 * (job 10). Light DOM, like `<todo-app>`, so its landmark and heading are part of the document.
 *
 * The conversation is a list of observable objects changed in place, so an event re-renders only
 * what it changed: the cards a person is reading or tabbing through stay where they are. One
 * polite status line announces what screen readers need (working, an approval asked, the answer)
 * rather than the whole conversation.
 */

import type { TodoSession } from '@afd/example-todo-ui/session';
import { FASTElement, html, observable, repeat, when } from '@lushly-dev/fast-element';
import { answer, type CopilotMode, runTurn, type TurnEvent } from './turn-client';

/** A command the model ran in this turn, as its card shows it. */
class CallView {
	declare state: 'executing' | 'output-available' | 'output-error';
	declare summary: string;
	declare output: string;

	constructor(
		readonly index: number,
		readonly name: string,
		readonly args: Record<string, unknown>
	) {
		this.state = 'executing';
		this.summary = 'Running…';
		this.output = '';
	}
}
for (const name of ['state', 'summary', 'output']) observable(CallView.prototype, name);

/** A held call waiting for the person, and what became of it. */
class ApprovalView {
	declare state: 'pending' | 'approved' | 'denied';
	declare note: string;

	constructor(
		readonly turn: string,
		readonly ask: number,
		readonly command: string,
		readonly summary: string
	) {
		this.state = 'pending';
		this.note = 'The copilot asked for this. Nothing is removed if you deny it.';
	}

	/** Settle it, once: a later answer does not change what the person was shown. */
	settle(state: 'approved' | 'denied', note: string): boolean {
		if (this.state !== 'pending') return false;
		this.state = state;
		this.note = note;
		return true;
	}
}
for (const name of ['state', 'note']) observable(ApprovalView.prototype, name);

/** One message in the panel: the person's, or the copilot's answer with what it ran. */
class Entry {
	declare role: 'user' | 'assistant' | 'system';
	declare text: string;
	declare busy: boolean;
	/** Grown in place, so a new card does not re-render the ones before it. */
	readonly calls: CallView[] = [];
	readonly approvals: ApprovalView[] = [];

	constructor(role: Entry['role'], text: string, busy: boolean) {
		this.role = role;
		this.text = text;
		this.busy = busy;
	}
}
for (const name of ['role', 'text', 'busy']) observable(Entry.prototype, name);

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
			aria-label="Conversation"
			@approve="${(x, c) => x.decideFrom(c.event, true)}"
			@deny="${(x, c) => x.decideFrom(c.event, false)}"
		>
			${repeat((x) => x.entries, entryTemplate)}
		</ol>
		<p class="visually-hidden copilot-status" role="status">${(x) => x.status}</p>
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
	/** What the status line announces. */
	declare status: string;
	session: TodoSession | undefined;
	/** The server: this page's origin unless the page was opened with `?backend=`. */
	baseUrl = '';
	private leaving: AbortController | undefined;

	constructor() {
		super();
		this.entries = [];
		this.mode = 'change';
		this.draft = '';
		this.busy = false;
		this.status = '';
	}

	/** Work with this session: its view runs the view calls, and it refreshes after changes. */
	attach(session: TodoSession, baseUrl: string): void {
		this.session = session;
		this.baseUrl = baseUrl;
	}

	setMode(value: string): void {
		if (value === 'change' || value === 'look') this.mode = value;
	}

	/**
	 * Enter sends: violet buttons do not submit a form. The field stays enabled while a turn runs,
	 * so focus can stay in it; only sending waits.
	 */
	sendOnEnter(event: KeyboardEvent): boolean {
		if (event.key !== 'Enter' || event.isComposing) return true;
		void this.send();
		return false;
	}

	/** Put the person back in the field, where the next question goes. */
	private focusInput(): void {
		this.querySelector<HTMLElement>('.copilot-input')?.focus();
	}

	/** Send the draft as one turn and show it as it runs. */
	async send(): Promise<void> {
		const message = this.draft.trim();
		if (!message || this.busy) return;
		this.draft = '';
		this.busy = true;
		this.status = 'The copilot is working.';
		const reply = new Entry('assistant', '', true);
		this.entries.push(new Entry('user', message, false), reply);
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
					this.show(reply, turn, event);
				},
			});
			reply.role = end.type === 'error' ? 'system' : 'assistant';
			reply.text =
				end.type === 'error' ? `The copilot could not answer: ${end.error}` : end.message;
			this.status = reply.text;
		} catch {
			// The page is going away
		} finally {
			// A question still open when the turn ends can no longer be answered
			for (const approval of reply.approvals) {
				approval.settle('denied', 'The answer ended before you decided, so it did not run.');
			}
			reply.busy = false;
			this.busy = false;
			this.leaving = undefined;
			// Whatever the copilot changed, the list shows it now
			void this.session?.refresh();
			this.focusInput();
		}
	}

	/** Show one event of the turn in its reply. */
	private show(reply: Entry, turn: string, event: TurnEvent): void {
		if (event.type === 'call') {
			reply.calls.push(new CallView(event.index, event.name, event.args));
		} else if (event.type === 'result') {
			const call = reply.calls.find((item) => item.index === event.index);
			if (call) {
				call.state = event.success ? 'output-available' : 'output-error';
				call.summary = resultSummary(event);
				call.output = json(event.result);
			}
			// A change to the todos shows in the list at once; a view change already has
			if (event.success && !event.name.startsWith('view-state-')) void this.session?.refresh();
		} else if (event.type === 'approval') {
			const summary = event.summary || `Run ${event.command}?`;
			reply.approvals.push(new ApprovalView(turn, event.ask, event.command, summary));
			this.status = `Approval needed: ${summary}`;
		} else if (event.type === 'withdrawn') {
			reply.approvals
				.find((approval) => approval.ask === event.ask)
				?.settle('denied', 'No answer in time, so it did not run.');
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
		const settled = approval.settle(
			approved ? 'approved' : 'denied',
			approved ? 'You approved it.' : 'You denied it, so it did not run.'
		);
		if (!settled) return;
		// The card's buttons go with the decision: keep focus in the panel, on the next question
		this.focusInput();
		const accepted = await answer(this.baseUrl, {
			turn: approval.turn,
			ask: approval.ask,
			approved,
		}).catch(() => false);
		if (!accepted) {
			approval.state = 'denied';
			approval.note = 'The question had already ended, so it did not run.';
		}
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();
		this.leaving?.abort();
	}
}

for (const name of ['entries', 'mode', 'draft', 'busy', 'status'])
	observable(TodoCopilot.prototype, name);

export async function defineTodoCopilot(): Promise<void> {
	if (customElements.get('todo-copilot')) return;
	await FASTElement.define(TodoCopilot, {
		name: 'todo-copilot',
		template,
		shadowOptions: null,
	});
}

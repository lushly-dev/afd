/**
 * @fileoverview The panel's approval and suggestion cards (phase 5 specification, 3.2, 6.1, 6.2; P5-A8), drawn from the
 * kernel's records alone: `copilot-session-get` gives the confirmations and suggestions the agent port's half recorded
 * for the session, by id, and nothing of the runtime's events. A confirmation's Confirm and Decline call
 * `notification-act`, and a suggestion's "Run it" opens `palette-run`'s prompt from its record, each only on a person's
 * own press (a script's `click()` answers nothing) and on the palette interface, the person's. Every value is set as
 * text, never as markup.
 */

import type {
	CopilotConfirmationCardV1,
	CopilotSuggestionCardV1,
} from '@lushly-dev/loam-kernel/copilot';
import { chainWords } from '../settings/autonomy-words.js';
import type { CopilotPanelKernelV1 } from './conversation.js';

/** What `copilot-session-get` answers, as the cards read it. */
export interface SessionRecordsV1 {
	session: { id: string; taint: Array<{ source: string }> };
	turns: Array<{ seq: number; state: string }>;
	confirmations: CopilotConfirmationCardV1[];
	suggestions: CopilotSuggestionCardV1[];
}

/** An input as text, one line per field (phase 4's 7.2, as the inbox shows it). */
export const inputWords = (input: unknown): string => {
	if (input === null || typeof input !== 'object' || Array.isArray(input))
		return JSON.stringify(input) ?? '';
	const entries = Object.entries(input as Record<string, unknown>);
	return entries.length === 0
		? 'No input'
		: entries.map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n');
};

/** Why the copilot asked, in words (6.2): the chain of rows, and taint's line when it lowered the mode. */
export function askedWords(card: Pick<CopilotConfirmationCardV1, 'asked'>): string[] {
	const asked = card.asked;
	if (!asked) return [];
	const lines = asked.chain.map((step) =>
		step.id === 'destructive'
			? 'Asked because it cannot be undone'
			: step.id === 'approval'
				? 'Asked because it needs a person’s approval'
				: chainWords(step, (instance) => instance, undefined)
	);
	if (asked.reason === 'taint' && asked.sources.length > 0)
		lines.push(`Asked because the conversation includes content from ${asked.sources.join(', ')}`);
	return lines;
}

/** How a confirmation ended, in words. */
export const endedWords = (state: CopilotConfirmationCardV1['state']): string =>
	state === 'confirmed'
		? 'Confirmed'
		: state === 'declined'
			? 'Declined'
			: state === 'expired'
				? 'Expired: no one answered within 10 minutes'
				: state === 'withdrawn'
					? 'Withdrawn'
					: 'Waiting for you';

/** The taint mark a reply carries (3.4). */
export const taintWords = (sources: readonly string[]): string =>
	sources.length === 0 ? '' : `This answer may repeat text from ${sources.join(', ')}`;

/**
 * A refused press's reason, by the card's id, kept across the panel's reads while that card is still offered (re-check
 * 4): a read every 2 s would otherwise wipe it before the person reads it. A new press, or the card's end, clears it.
 */
const refused = new WeakMap<HTMLElement, Map<string, string>>();

/** Builds the cards into `region`, by the DOM API, from the kernel's records. */
export function renderCards(
	region: HTMLElement,
	records: SessionRecordsV1 | null,
	kernel: CopilotPanelKernelV1,
	answered: () => void
): void {
	const doc = region.ownerDocument;
	const reasons = refused.get(region) ?? new Map<string, string>();
	refused.set(region, reasons);
	const offered = new Set([
		...(records?.confirmations ?? [])
			.filter((card) => card.state === 'pending')
			.map((card) => card.id),
		...(records?.suggestions ?? []).filter((card) => !card.ran).map((card) => card.id),
	]);
	for (const id of [...reasons.keys()]) if (!offered.has(id)) reasons.delete(id);
	const reasonOf = (id: string, slot?: string) => {
		const words = reasons.get(id);
		if (!words) return [];
		const why = text('p', words, 'card-error');
		why.setAttribute('role', 'status');
		if (slot) why.setAttribute('slot', slot);
		return [why];
	};
	const text = (tag: string, words: string, className?: string) => {
		const made = doc.createElement(tag);
		made.textContent = words;
		if (className) made.className = className;
		return made;
	};
	const button = (
		id: string,
		label: string,
		run: () => Promise<{ success: boolean; error?: { message: string; suggestion?: string } }>,
		primary = false
	) => {
		const made = doc.createElement('violet-button');
		made.setAttribute('appearance', primary ? 'primary' : 'secondary');
		made.textContent = label;
		// A person's own press alone (phase 4's step 6, blocker 1): a dispatched event answers nothing.
		made.addEventListener('click', (event) => {
			if (!event.isTrusted || made.hasAttribute('disabled')) return;
			made.setAttribute('disabled', '');
			reasons.delete(id);
			void run().then(
				(result) => {
					// A refusal says why beside the button, in the kernel's words (the re-check's improvement).
					if (result.success || !result.error) return answered();
					const why = text(
						'p',
						`${result.error.message}. ${result.error.suggestion ?? ''}`.trim(),
						'card-error'
					);
					why.setAttribute('role', 'status');
					reasons.set(id, why.textContent ?? '');
					made.removeAttribute('disabled');
					// One reason at a time: a second press replaces the first. In an approval card it goes in the detail slot,
					// which the card draws; an unslotted child it does not (re-check 3).
					const holder = made.parentElement;
					holder?.querySelector(':scope > .card-error')?.remove();
					if (made.getAttribute('slot') === 'actions') why.setAttribute('slot', 'detail');
					// A read may have redrawn the card meanwhile (re-check 5): the reason goes on the card as it is now.
					if (made.isConnected) made.after(why);
					else {
						const now = region.querySelector(
							`[data-notification="${id}"], [data-suggestion="${id}"]`
						);
						// Only while that card still offers the action (re-check 6): an ended one keeps no stale reason.
						if (now?.querySelector('violet-button:not([disabled])')) {
							now.querySelector(':scope > .card-error')?.remove();
							now.append(why);
						} else reasons.delete(id);
					}
				},
				() => answered()
			);
		});
		return made;
	};
	const cards: HTMLElement[] = [];
	for (const card of records?.confirmations ?? []) {
		const item = doc.createElement('violet-approval-card');
		item.className = 'card';
		item.dataset.notification = card.id;
		item.setAttribute(
			'state',
			card.state === 'pending' ? 'pending' : card.state === 'confirmed' ? 'approved' : 'denied'
		);
		const summary = doc.createElement('div');
		summary.setAttribute('slot', 'summary');
		summary.append(text('p', card.header, 'card-header'), text('p', card.title, 'card-title'));
		const detail = doc.createElement('div');
		detail.setAttribute('slot', 'detail');
		detail.append(text('p', card.prompt), text('p', inputWords(card.input), 'card-input'));
		for (const line of askedWords(card)) detail.append(text('p', line, 'card-why'));
		if (card.state !== 'pending') detail.append(text('p', endedWords(card.state), 'card-ended'));
		item.append(summary, detail);
		if (card.state === 'pending') {
			const confirm = button(
				card.id,
				`Confirm ${card.title}`,
				() => kernel.call('notification-act', { notification: card.id, answer: 'confirm' }),
				true
			);
			const decline = button(card.id, 'Decline', () =>
				kernel.call('notification-act', { notification: card.id, answer: 'decline' })
			);
			confirm.setAttribute('slot', 'actions');
			decline.setAttribute('slot', 'actions');
			item.append(confirm, decline, ...reasonOf(card.id, 'detail'));
		}
		cards.push(item);
	}
	for (const card of records?.suggestions ?? []) {
		const item = doc.createElement('div');
		item.className = 'card suggestion';
		item.dataset.suggestion = card.id;
		item.append(
			text('p', `Suggested: ${card.command}`, 'card-title'),
			text('p', 'Your setting lets the copilot only suggest this, so it ran nothing.'),
			text('p', inputWords(card.input), 'card-input')
		);
		if (card.sources.length > 0) item.append(text('p', taintWords(card.sources), 'card-why'));
		if (card.ran) item.append(text('p', 'Ran, or no longer offered', 'card-ended'));
		else
			item.append(
				button(
					card.id,
					'Run it',
					() => kernel.call('palette-run', { command: card.command, suggestion: card.id }),
					true
				),
				...reasonOf(card.id)
			);
		cards.push(item);
	}
	const taint = taintWords(records?.session.taint.map((entry) => entry.source) ?? []);
	if (taint) cards.push(text('p', taint, 'taint'));
	region.replaceChildren(...cards);
	region.hidden = cards.length === 0;
}

// CommandResult explorer: pick a field, read what the agent learns from it.

import { initTabs } from './util.js';

const FIELDS = {
	success: {
		label: 'success: true',
		thought: '“It worked. I can move on.”',
		note: 'Every result is exactly one of success or failure. Agents branch on one boolean instead of parsing status codes.',
	},
	data: {
		label: 'data',
		thought: '“Here’s the user I asked for.”',
		note: 'The payload, typed by the command’s output schema. This is all most APIs send. The fields below are what AFD adds.',
	},
	confidence: {
		label: 'confidence: 0.85',
		thought: '“This match isn’t certain. I should verify before I act on it.”',
		note: 'A calibrated score from 0 to 1. Agents can gate risky actions on it, and UIs can show it as a trust badge.',
	},
	reasoning: {
		label: 'reasoning',
		thought: '“It matched on email, not ID, and there are look-alike accounts.”',
		note: 'What happened and why, in plain language. The agent can repeat it to the user instead of guessing.',
	},
	warnings: {
		label: 'warnings',
		thought: '“This is an admin. I’ll ask before changing anything.”',
		note: 'Side effects and risks the caller should know about, separate from the data so they are never missed.',
	},
	suggestions: {
		label: 'suggestions',
		thought: '“The system is pointing me at the logical next step.”',
		note: 'Next actions, often another command by name. Agents chain work without inventing a plan from scratch.',
	},
	sources: {
		label: 'sources',
		thought: '“I know where this came from, so I can cite it.”',
		note: 'Provenance for the data. Pair it with plan (steps taken or proposed) and alternatives (other options) when they apply.',
	},
	'fail-success': {
		label: 'success: false',
		thought: '“That didn’t work, but let’s see why.”',
		note: 'A failure is still a structured result. The error object below is a diagnosis, not a dead end.',
	},
	code: {
		label: 'error.code',
		thought: '“NOT_FOUND. The user doesn’t exist. It isn’t a network blip.”',
		note: 'A stable, machine-readable code. Agents branch on it; humans search for it.',
	},
	message: {
		label: 'error.message',
		thought: '“No user with that exact email.”',
		note: 'Specific and safe to show. It names what was missing without leaking internals.',
	},
	suggestion: {
		label: 'error.suggestion',
		thought: '“Try user-search with a partial match. On it.”',
		note: 'Every AFD error carries a recovery path. This is the difference between an agent that stalls and one that recovers.',
	},
	retryable: {
		label: 'error.retryable: false',
		thought: '“Retrying won’t help. I need a different approach.”',
		note: 'Tells the agent whether to try again or change course, so it never burns calls on a hopeless retry.',
	},
};

export function initExplorer() {
	const root = document.querySelector('[data-explorer]');
	if (!root) return;

	const panel = root.querySelector('.explorer__panel');
	const fieldEl = panel.querySelector('.explorer__field');
	const thoughtEl = panel.querySelector('.explorer__thought');
	const noteEl = panel.querySelector('.explorer__note');
	const wall = panel.querySelector('.blank-wall');
	const buttons = [...root.querySelectorAll('[data-field]')];

	const pick = (name) => {
		const info = FIELDS[name];
		if (!info) return;
		for (const button of buttons) {
			button.setAttribute('aria-pressed', String(button.dataset.field === name));
		}
		fieldEl.textContent = info.label;
		thoughtEl.textContent = info.thought;
		noteEl.textContent = info.note;
		panel.classList.remove('is-changing');
		void panel.offsetWidth;
		panel.classList.add('is-changing');
	};

	root.addEventListener('click', (event) => {
		const button = event.target.closest('[data-field]');
		if (button) pick(button.dataset.field);
	});

	initTabs(root.querySelector('[role="tablist"]'), (tab) => {
		const failure = tab.dataset.modeTab === 'failure';
		wall.hidden = !failure;
		pick(failure ? 'suggestion' : 'confidence');
	});
}

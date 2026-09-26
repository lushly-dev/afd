// Agent view: swap the page for what an agent reads (llms.txt), framed as an
// `afd call` so the site practices what it describes. ?view=agent opens it.

import { call, provide } from './runtime.js';

const escape = (text) =>
	text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

let cache = null;

async function render(code) {
	const command = '<span class="tok-prompt">afd call page-read \'{"url":"https://afd.dev"}\'</span>\n';
	try {
		cache ??= await fetch('llms.txt').then((response) => {
			if (!response.ok) throw new Error(String(response.status));
			return response.text();
		});
		code.innerHTML =
			`${command}<span class="tok-ok">✓ Success</span>\n\n` +
			`<span class="tok-label">Data:</span>\n${escape(cache.trim())}\n\n` +
			'<span class="tok-label">Confidence:</span> ██████████ 100%\n' +
			'<span class="tok-label">Reasoning:</span> Served the canonical agent-readable summary of this page.\n' +
			'<span class="tok-label">Suggestions:</span> npm install @lushly-dev/afd-core @lushly-dev/afd-server';
	} catch {
		code.innerHTML =
			`${command}<span class="tok-err">✗ Failed</span>\n\n` +
			'<span class="tok-label">Error:</span> [FETCH_FAILED] Could not load llms.txt\n\n' +
			'<span class="tok-label">Suggestion:</span> Open /llms.txt directly, or serve the site over HTTP.';
	}
}

export function initAgentView() {
	const toggle = document.querySelector('.agent-toggle');
	const view = document.getElementById('agent-view');
	if (!toggle || !view) return;
	const code = view.querySelector('code');

	const apply = async (on) => {
		toggle.setAttribute('aria-pressed', String(on));
		toggle.textContent = on ? 'Human view' : 'Agent view';
		view.hidden = !on;
		if (on) document.body.dataset.view = 'agent';
		else delete document.body.dataset.view;

		const url = new URL(window.location.href);
		if (on) url.searchParams.set('view', 'agent');
		else url.searchParams.delete('view');
		history.replaceState(null, '', url);

		window.scrollTo({ top: 0 });
		if (on) await render(code);
	};

	// Switch with a wipe where the browser supports view transitions.
	const set = (on) => {
		if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
			return apply(on);
		}
		document.documentElement.dataset.viewTo = on ? 'agent' : 'human';
		return document.startViewTransition(() => apply(on)).finished;
	};

	// The view is switched by the view-set command, whoever calls it.
	provide('setView', (name) => set(name === 'agent'));

	toggle.addEventListener('click', () => {
		const next = toggle.getAttribute('aria-pressed') === 'true' ? 'human' : 'agent';
		call('view-set', { view: next }, { surface: 'ui' });
	});
	view.querySelector('[data-agent-exit]').addEventListener('click', async () => {
		await call('view-set', { view: 'human' }, { surface: 'ui' });
		toggle.focus();
	});

	if (new URLSearchParams(window.location.search).get('view') === 'agent') set(true);
}

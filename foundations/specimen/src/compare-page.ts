/**
 * Self-contained HTML viewer for `compare.html?set=<setId>`.
 *
 * Displays side-by-side variant screenshots, axe status and violations, and structured
 * channel differences from `.specimen/sets/<setId>/compare.json`. Never loads or exposes
 * raw `Observation` files.
 */
export function renderComparePageHtml(): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Variant comparison — Specimens</title>
<style>
:root {
	--specimen-font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
	--specimen-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
	--specimen-surface: light-dark(#fff, #16181d);
	--specimen-raised: light-dark(#f5f6f8, #1f2229);
	--specimen-text: light-dark(#1b1d22, #e7e9ee);
	--specimen-muted: light-dark(#525866, #b0b6c4);
	--specimen-border: light-dark(#d5d9e0, #363a46);
	--specimen-accent: light-dark(#2150c4, #93b3ff);
	--specimen-accent-soft: light-dark(#e7edfb, #1e2a45);
	--specimen-pass: light-dark(#156534, #86efac);
	--specimen-pass-soft: light-dark(#e8f7ee, #132e1e);
	--specimen-warn: light-dark(#7d4e00, #fcd34d);
	--specimen-warn-soft: light-dark(#fdf6e1, #2b2516);
	--specimen-error: light-dark(#a8231b, #ffb4ab);
	--specimen-error-soft: light-dark(#fcebe9, #3a1614);
	--specimen-radius: 6px;
	--specimen-gap: 1rem;
}
:root,
:root[data-specimen-page-theme="light"],
:root[data-specimen-page-theme="high-contrast"] {
	color-scheme: light;
}
:root[data-specimen-page-theme="dark"] {
	color-scheme: dark;
}
:root[data-specimen-page-theme="high-contrast"] {
	--specimen-text: #000;
	--specimen-muted: #1b1d22;
	--specimen-border: #000;
	--specimen-accent: #0031a0;
	--specimen-pass: #0a4d24;
	--specimen-error: #8c0000;
}
* { box-sizing: border-box; }
body {
	margin: 0;
	background: var(--specimen-surface);
	color: var(--specimen-text);
	font: 15px / 1.5 var(--specimen-font);
}
main {
	max-width: 1440px;
	margin: 0 auto;
	padding: 1.5rem;
}
h1 { margin: 0 0 0.5rem; font-size: 1.5rem; line-height: 1.25; }
h2 { margin: 1.5rem 0 0.75rem; font-size: 1.2rem; line-height: 1.3; }
h3 { margin: 0 0 0.5rem; font-size: 1rem; line-height: 1.3; }
code { font: 0.85em var(--specimen-mono); }
.compare-meta {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.5rem 0.75rem;
	margin: 0 0 1rem;
	color: var(--specimen-muted);
}
.compare-badge {
	display: inline-block;
	padding: 0.1rem 0.5rem;
	border-radius: 999px;
	font-size: 0.8rem;
	font-weight: 600;
	background: var(--specimen-accent-soft);
	color: var(--specimen-accent);
}
.compare-badge[data-tone="pass"] {
	background: var(--specimen-pass-soft);
	color: var(--specimen-pass);
}
.compare-badge[data-tone="warn"] {
	background: var(--specimen-warn-soft);
	color: var(--specimen-warn);
}
.compare-badge[data-tone="fail"] {
	background: var(--specimen-error-soft);
	color: var(--specimen-error);
}
.compare-alert {
	margin: 1rem 0;
	padding: 0.75rem 1rem;
	border-left: 4px solid var(--specimen-error);
	border-radius: var(--specimen-radius);
	background: var(--specimen-error-soft);
	color: var(--specimen-error);
}
.compare-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
	gap: var(--specimen-gap);
	align-items: start;
}
.compare-card {
	border: 1px solid var(--specimen-border);
	border-radius: var(--specimen-radius);
	background: var(--specimen-raised);
	padding: 0.875rem;
	display: grid;
	gap: 0.625rem;
}
.compare-card-head {
	display: flex;
	flex-wrap: wrap;
	justify-content: space-between;
	align-items: baseline;
	gap: 0.5rem;
}
.compare-card-head h2 {
	margin: 0;
	font-size: 1rem;
	word-break: break-word;
}
.compare-card-subtitle {
	margin: 0;
	font-size: 0.85rem;
	color: var(--specimen-muted);
}
.compare-checks {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.4rem;
}
.compare-violations,
.compare-incomplete {
	margin: 0;
	padding-left: 1.25rem;
	font-size: 0.85rem;
}
.compare-violations { color: var(--specimen-error); }
.compare-incomplete { color: var(--specimen-warn); }
.compare-figure {
	margin: 0;
	border: 1px solid var(--specimen-border);
	border-radius: var(--specimen-radius);
	background: var(--specimen-surface);
	overflow: hidden;
}
.compare-figure img {
	display: block;
	width: 100%;
	height: auto;
}
.compare-empty {
	margin: 0;
	padding: 1rem;
	color: var(--specimen-muted);
	font-size: 0.9rem;
}
.compare-diffs {
	display: grid;
	gap: var(--specimen-gap);
}
.compare-diff {
	border: 1px solid var(--specimen-border);
	border-radius: var(--specimen-radius);
	background: var(--specimen-raised);
	padding: 0.875rem;
	display: grid;
	gap: 0.625rem;
}
.compare-diff-head {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.5rem;
}
.compare-diff-head h3 { margin: 0; }
.compare-table-wrap {
	overflow-x: auto;
}
table {
	width: 100%;
	border-collapse: collapse;
	font-size: 0.85rem;
	background: var(--specimen-surface);
}
th, td {
	text-align: left;
	vertical-align: top;
	padding: 0.4rem 0.5rem;
	border: 1px solid var(--specimen-border);
	word-break: break-word;
}
th {
	background: var(--specimen-raised);
	font-weight: 600;
}
details { font-size: 0.85rem; color: var(--specimen-muted); }
summary { cursor: pointer; font-weight: 600; }
</style>
</head>
<body>
<main id="specimen-compare-root">
	<h1>Variant comparison</h1>
	<p class="compare-meta" role="status">Loading comparison set…</p>
</main>
<script>
(async function () {
	var SET_ID_RE = /^set-[0-9a-f]{12}$/;
	var SHOT_RE = /^screenshots\\/[a-zA-Z0-9._-]+\\.png$/;
	var VALID_THEMES = { light: true, dark: true, 'high-contrast': true };
	var hasOwn = Object.prototype.hasOwnProperty;
	var root = document.getElementById('specimen-compare-root');

	function h(tag, attrs) {
		var el = document.createElement(tag);
		if (attrs) {
			for (var key in attrs) {
				if (!Object.prototype.hasOwnProperty.call(attrs, key)) continue;
				var val = attrs[key];
				if (val === undefined || val === null) continue;
				if (key === 'className') el.className = val;
				else if (key === 'textContent') el.textContent = val;
				else el.setAttribute(key, String(val));
			}
		}
		for (var i = 2; i < arguments.length; i++) {
			var child = arguments[i];
			if (child === undefined || child === null || child === false) continue;
			el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
		}
		return el;
	}

	function showError(message) {
		document.documentElement.dataset.specimenCompare = 'error';
		root.replaceChildren(
			h('h1', null, 'Variant comparison'),
			h('p', { className: 'compare-alert', role: 'alert' }, message)
		);
	}

	function formatValue(value) {
		if (value === undefined) return '—';
		if (typeof value === 'string') {
			return value.length > 220 ? value.slice(0, 217) + '...' : value;
		}
		try {
			var json = JSON.stringify(value);
			if (!json) return String(value);
			return json.length > 220 ? json.slice(0, 217) + '...' : json;
		} catch (e) {
			return String(value);
		}
	}

	function axeTone(status) {
		if (status === 'passed') return 'pass';
		if (status === 'failed') return 'fail';
		if (status === 'warning') return 'warn';
		return undefined;
	}

	function diffTone(status) {
		if (status === 'no-change-observed') return 'pass';
		if (status === 'insufficient-evidence') return 'warn';
		return undefined;
	}

	var params = new URLSearchParams(location.search);
	var setId = params.get('set') || '';
	if (!setId) {
		showError('No comparison set specified. Run specimen compare <id1> <id2> and open compare.html?set=<set-id>.');
		return;
	}
	if (!SET_ID_RE.test(setId)) {
		showError('Invalid comparison set id: ' + setId);
		return;
	}

	var baseDir = './sets/' + setId + '/';
	var response = null;
	try {
		response = await fetch(baseDir + 'compare.json');
	} catch (e) {
		response = null;
	}
	if (!response || !response.ok) {
		baseDir = './.specimen/sets/' + setId + '/';
		try {
			response = await fetch(baseDir + 'compare.json');
		} catch (e) {
			showError(
				'Could not load comparison set ' +
					setId +
					'. Serve the .specimen or build directory over HTTP to view compare.html.'
			);
			return;
		}
	}
	if (!response.ok) {
		showError('Comparison set not found: ' + setId);
		return;
	}

	var data;
	try {
		data = await response.json();
	} catch (e) {
		showError('Could not parse comparison set data for ' + setId + '.');
		return;
	}

	var requestedTheme = params.get('theme');
	var contextTheme = data.context && typeof data.context.theme === 'string' ? data.context.theme : '';
	var pageTheme =
		requestedTheme && hasOwn.call(VALID_THEMES, requestedTheme)
			? requestedTheme
			: contextTheme && hasOwn.call(VALID_THEMES, contextTheme)
				? contextTheme
				: 'light';
	document.documentElement.dataset.specimenPageTheme = pageTheme;
	document.documentElement.style.colorScheme = pageTheme === 'dark' ? 'dark' : 'light';
	document.title = 'Compare ' + data.set + ' — Specimens';

	var meta = h(
		'div',
		{ className: 'compare-meta' },
		h('code', null, data.set),
		data.context && data.context.theme
			? h('span', { className: 'compare-badge' }, 'theme: ' + data.context.theme)
			: null,
		data.context && data.context.viewport
			? h(
					'span',
					{ className: 'compare-badge' },
					'viewport: ' + data.context.viewport.width + '×' + data.context.viewport.height
				)
			: null,
		data.checkpoint
			? h('span', { className: 'compare-badge' }, 'checkpoint: ' + data.checkpoint)
			: null,
		data.revision
			? h('span', { className: 'compare-badge' }, 'rev: ' + String(data.revision).slice(0, 12))
			: null,
		data.dirty ? h('span', { className: 'compare-badge', 'data-tone': 'warn' }, 'dirty tree') : null
	);

	var grid = h('div', { className: 'compare-grid' });
	var captures = Array.isArray(data.captures) ? data.captures : [];
	for (var i = 0; i < captures.length; i++) {
		var cap = captures[i];
		var card = h(
			'article',
			{ className: 'compare-card', 'data-variant-id': cap.id },
			h(
				'div',
				{ className: 'compare-card-head' },
				h('h2', null, cap.id),
				h('span', { className: 'compare-badge' }, i === 0 ? 'Baseline' : 'Variant ' + i)
			)
		);
		if (cap.title && cap.title !== cap.id) {
			card.appendChild(h('p', { className: 'compare-card-subtitle' }, cap.title));
		}
		var checks = h(
			'div',
			{ className: 'compare-checks' },
			h('span', { className: 'compare-badge', 'data-tone': axeTone(cap.axe) }, 'axe: ' + cap.axe),
			cap.status !== 'captured'
				? h('span', { className: 'compare-badge', 'data-tone': 'fail' }, cap.status)
				: null
		);
		card.appendChild(checks);
		if (Array.isArray(cap.violations) && cap.violations.length > 0) {
			var vList = h('ul', { className: 'compare-violations', 'aria-label': 'Accessibility violations' });
			for (var v = 0; v < cap.violations.length; v++) {
				vList.appendChild(h('li', null, h('code', null, cap.violations[v])));
			}
			card.appendChild(vList);
		}
		if (Array.isArray(cap.incompleteChecks) && cap.incompleteChecks.length > 0) {
			var incList = h('ul', { className: 'compare-incomplete', 'aria-label': 'Incomplete accessibility checks' });
			for (var ic = 0; ic < cap.incompleteChecks.length; ic++) {
				var chk = cap.incompleteChecks[ic];
				incList.appendChild(
					h('li', null, h('code', null, chk.id), chk.help ? ' — ' + chk.help : '')
				);
			}
			card.appendChild(incList);
		}
		var figure = h('figure', { className: 'compare-figure' });
		if (typeof cap.screenshot === 'string' && SHOT_RE.test(cap.screenshot)) {
			figure.appendChild(
				h('img', {
					src: baseDir + cap.screenshot,
					alt: 'Screenshot of ' + cap.id,
					loading: 'lazy',
				})
			);
		} else {
			figure.appendChild(
				h('p', { className: 'compare-empty' }, cap.reason || 'No screenshot captured.')
			);
		}
		card.appendChild(figure);
		grid.appendChild(card);
	}

	var diffSection = h('section', { 'aria-label': 'Structured differences' });
	diffSection.appendChild(h('h2', null, 'Structured differences'));
	var diffList = h('div', { className: 'compare-diffs' });
	var differences = Array.isArray(data.differences) ? data.differences : [];
	for (var d = 0; d < differences.length; d++) {
		var diff = differences[d];
		var head = h(
			'div',
			{ className: 'compare-diff-head' },
			h('h3', null, diff.id + ' vs ' + diff.against),
			h('span', { className: 'compare-badge', 'data-tone': diffTone(diff.status) }, diff.status)
		);
		if (Array.isArray(diff.channels)) {
			for (var c = 0; c < diff.channels.length; c++) {
				head.appendChild(h('span', { className: 'compare-badge' }, diff.channels[c]));
			}
		}
		var panel = h(
			'article',
			{ className: 'compare-diff', 'data-variant-id': diff.id, 'data-against': diff.against },
			head
		);
		if (Array.isArray(diff.items) && diff.items.length > 0) {
			var tbody = h('tbody');
			for (var k = 0; k < diff.items.length; k++) {
				var item = diff.items[k];
				tbody.appendChild(
					h(
						'tr',
						null,
						h('td', null, h('code', null, item.channel)),
						h('td', null, item.target ? h('code', null, item.target) : '—'),
						h('td', null, item.property ? h('code', null, item.property) : '—'),
						h('td', null, h('code', null, formatValue(item.left))),
						h('td', null, h('code', null, formatValue(item.right)))
					)
				);
			}
			var table = h(
				'table',
				null,
				h(
					'thead',
					null,
					h(
						'tr',
						null,
						h('th', { scope: 'col' }, 'Channel'),
						h('th', { scope: 'col' }, 'Target'),
						h('th', { scope: 'col' }, 'Property'),
						h('th', { scope: 'col' }, 'Baseline'),
						h('th', { scope: 'col' }, 'Variant')
					)
				),
				tbody
			);
			panel.appendChild(h('div', { className: 'compare-table-wrap' }, table));
		} else if (diff.status === 'insufficient-evidence') {
			panel.appendChild(
				h(
					'p',
					{ className: 'compare-empty' },
					'Comparison incomplete (insufficient evidence); see limitations below.'
				)
			);
		} else {
			panel.appendChild(h('p', { className: 'compare-empty' }, 'No structured differences observed.'));
		}
		if (Array.isArray(diff.limitations) && diff.limitations.length > 0) {
			var limList = h('ul');
			for (var l = 0; l < diff.limitations.length; l++) {
				limList.appendChild(h('li', null, diff.limitations[l]));
			}
			var detailsAttrs = diff.status === 'insufficient-evidence' ? { open: '' } : null;
			panel.appendChild(
				h('details', detailsAttrs, h('summary', null, 'Limitations (' + diff.limitations.length + ')'), limList)
			);
		}
		diffList.appendChild(panel);
	}
	diffSection.appendChild(diffList);

	root.replaceChildren(
		h('h1', null, 'Variant comparison'),
		meta,
		h('section', { 'aria-label': 'Variants' }, grid),
		diffSection
	);
	document.documentElement.dataset.specimenCompare = 'ready';
})();
</script>
</body>
</html>
`;
}

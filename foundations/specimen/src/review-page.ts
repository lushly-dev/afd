/**
 * Self-contained HTML viewer for `review.html?before=<set>&after=<set>`.
 *
 * Displays open review items, blocking failures and rejections, settled counts, and a visible
 * `script` badge on answers recorded with `decidedBy: { kind: 'script' }`. Loads structured
 * summaries from `/api/review.json?before=&after=` and screenshots from `/sets/<setId>/screenshots/`
 * without ever exposing raw `Observation` files.
 */
export function renderReviewPageHtml(): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Design review — Specimens</title>
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
.review-meta {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.5rem 0.75rem;
	margin: 0 0 1rem;
	color: var(--specimen-muted);
}
.review-badge {
	display: inline-block;
	padding: 0.1rem 0.5rem;
	border-radius: 999px;
	font-size: 0.8rem;
	font-weight: 600;
	background: var(--specimen-accent-soft);
	color: var(--specimen-accent);
}
.review-badge[data-tone="pass"] {
	background: var(--specimen-pass-soft);
	color: var(--specimen-pass);
}
.review-badge[data-tone="warn"] {
	background: var(--specimen-warn-soft);
	color: var(--specimen-warn);
}
.review-badge[data-tone="fail"] {
	background: var(--specimen-error-soft);
	color: var(--specimen-error);
}
.review-alert {
	margin: 1rem 0;
	padding: 0.75rem 1rem;
	border-left: 4px solid var(--specimen-error);
	border-radius: var(--specimen-radius);
	background: var(--specimen-error-soft);
	color: var(--specimen-error);
}
.review-quiet {
	margin: 1rem 0;
	padding: 0.875rem 1rem;
	border-left: 4px solid var(--specimen-pass);
	border-radius: var(--specimen-radius);
	background: var(--specimen-pass-soft);
	color: var(--specimen-pass);
	font-weight: 600;
}
.review-list {
	display: grid;
	gap: var(--specimen-gap);
}
.review-card {
	border: 1px solid var(--specimen-border);
	border-radius: var(--specimen-radius);
	background: var(--specimen-raised);
	padding: 1rem;
	display: grid;
	gap: 0.625rem;
}
.review-card[data-kind="rejected"],
.review-card[data-kind="axe-failed"],
.review-card[data-kind="unavailable"] {
	border-left: 4px solid var(--specimen-error);
}
.review-card-head {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.5rem;
}
.review-card-head h3 {
	margin: 0;
	word-break: break-word;
}
.review-question {
	margin: 0;
	font-weight: 600;
}
.review-note {
	margin: 0;
	font-size: 0.85rem;
	color: var(--specimen-muted);
}
.review-reason {
	margin: 0;
	padding: 0.5rem 0.75rem;
	border-radius: var(--specimen-radius);
	background: var(--specimen-surface);
	border: 1px solid var(--specimen-border);
}
.review-decisions {
	margin: 0;
	padding-left: 1.25rem;
	font-size: 0.9rem;
}
.review-shots {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
	gap: 0.75rem;
}
.review-shot-pair {
	border: 1px solid var(--specimen-border);
	border-radius: var(--specimen-radius);
	background: var(--specimen-surface);
	padding: 0.5rem;
	display: grid;
	gap: 0.5rem;
}
.review-shot-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
	gap: 0.5rem;
}
.review-shot-grid figure {
	margin: 0;
	display: grid;
	gap: 0.25rem;
}
.review-shot-grid figcaption {
	font-size: 0.8rem;
	color: var(--specimen-muted);
}
.review-shot-grid img {
	display: block;
	width: 100%;
	height: auto;
	border: 1px solid var(--specimen-border);
	border-radius: 4px;
}
.review-table-wrap {
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
</style>
</head>
<body>
<main id="specimen-review-root">
	<h1>Design review</h1>
	<p class="review-meta" role="status">Loading review…</p>
</main>
<script>
(async function () {
	var SAFE_REF_RE = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/;
	var SHOT_RE = /^sets\\/set-[0-9a-f]{12}\\/screenshots\\/[a-zA-Z0-9._-]+\\.png$/;
	var VALID_THEMES = { light: true, dark: true, 'high-contrast': true };
	var hasOwn = Object.prototype.hasOwnProperty;
	var root = document.getElementById('specimen-review-root');

	function h(tag, attrs) {
		var el = document.createElement(tag);
		if (attrs) {
			for (var key in attrs) {
				if (!hasOwn.call(attrs, key)) continue;
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
		document.documentElement.dataset.specimenReview = 'error';
		root.replaceChildren(
			h('h1', null, 'Design review'),
			h('p', { className: 'review-alert', role: 'alert' }, message)
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

	var params = new URLSearchParams(location.search);
	var before = params.get('before') || '';
	var after = params.get('after') || '';
	var idsParam = params.get('ids') || '';
	if (!before || !after) {
		showError('Both before and after capture sets are required. Open review.html?before=<set>&after=<set>.');
		return;
	}
	if (!SAFE_REF_RE.test(before) || !SAFE_REF_RE.test(after)) {
		showError('Invalid before or after capture set reference.');
		return;
	}

	var apiQuery = new URLSearchParams({ before: before, after: after });
	if (idsParam) apiQuery.set('ids', idsParam);
	var response = null;
	try {
		response = await fetch('./api/review.json?' + apiQuery.toString());
	} catch (e) {
		showError('Could not load review data. Serve Specimen over HTTP to view review.html.');
		return;
	}
	var payload;
	try {
		payload = await response.json();
	} catch (e) {
		showError('Could not parse review response.');
		return;
	}
	if (!response.ok || (payload && payload.error)) {
		showError((payload && payload.error && payload.error.message) || 'Review could not be loaded.');
		return;
	}

	var requestedTheme = params.get('theme');
	var contextTheme = typeof payload.theme === 'string' ? payload.theme : '';
	var pageTheme =
		requestedTheme && hasOwn.call(VALID_THEMES, requestedTheme)
			? requestedTheme
			: contextTheme && hasOwn.call(VALID_THEMES, contextTheme)
				? contextTheme
				: 'light';
	document.documentElement.dataset.specimenPageTheme = pageTheme;
	document.documentElement.style.colorScheme = pageTheme === 'dark' ? 'dark' : 'light';
	document.title = 'Review ' + payload.before.set + '..' + payload.after.set + ' — Specimens';

	var settled = payload.settled || { unchanged: 0, kept: 0, answered: 0 };
	var openItems = Array.isArray(payload.open) ? payload.open : [];
	var blockingItems = Array.isArray(payload.blocking) ? payload.blocking : [];
	var matchedAnswers = Array.isArray(payload.matchedAnswers) ? payload.matchedAnswers : [];
	var answerByItem = {};
	for (var m = 0; m < matchedAnswers.length; m++) {
		answerByItem[matchedAnswers[m].item] = matchedAnswers[m];
	}

	function formatSetBadge(prefix, side) {
		var text = prefix + ': ' + (side.label ? side.label + ' (' + side.set + ')' : side.set);
		if (side.revision) text += ' @ ' + String(side.revision).slice(0, 12);
		return text;
	}

	var meta = h(
		'div',
		{ className: 'review-meta' },
		h('span', { className: 'review-badge' }, formatSetBadge('before', payload.before)),
		payload.before.dirty
			? h('span', { className: 'review-badge', 'data-tone': 'warn' }, 'before dirty')
			: null,
		h('span', { className: 'review-badge' }, formatSetBadge('after', payload.after)),
		payload.after.dirty
			? h('span', { className: 'review-badge', 'data-tone': 'warn' }, 'after dirty')
			: null,
		h('span', { className: 'review-badge', 'data-tone': openItems.length > 0 ? 'warn' : 'pass' }, 'open: ' + openItems.length),
		h('span', { className: 'review-badge', 'data-tone': blockingItems.length > 0 ? 'fail' : 'pass' }, 'blocking: ' + blockingItems.length),
		h('span', { className: 'review-badge', 'data-tone': 'pass' }, 'settled: ' + settled.unchanged + ' unchanged, ' + settled.kept + ' kept, ' + settled.answered + ' answered')
	);

	var sections = [h('h1', null, 'Design review'), meta];

	if (openItems.length === 0 && blockingItems.length === 0) {
		sections.push(
			h(
				'p',
				{ className: 'review-quiet', role: 'status' },
				'All settled: ' + settled.unchanged + ' unchanged, ' + settled.kept + ' kept, ' + settled.answered + ' answered.'
			)
		);
	}

	if (blockingItems.length > 0) {
		var blockSection = h('section', { 'aria-label': 'Blocking items', 'data-section': 'blocking' });
		blockSection.appendChild(h('h2', null, 'Blocking (' + blockingItems.length + ')'));
		var blockList = h('div', { className: 'review-list' });
		for (var b = 0; b < blockingItems.length; b++) {
			var block = blockingItems[b];
			var ans = block.item && hasOwn.call(answerByItem, block.item) ? answerByItem[block.item] : null;
			var head = h(
				'div',
				{ className: 'review-card-head' },
				h('span', { className: 'review-badge', 'data-tone': 'fail' }, block.kind),
				h('h3', null, (block.ids || []).join(', '))
			);
			if (ans && ans.decidedBy && ans.decidedBy.kind === 'script') {
				head.appendChild(
					h('span', { className: 'review-badge', 'data-tone': 'warn', 'data-actor-badge': 'script' }, 'script')
				);
			}
			var card = h(
				'article',
				{ className: 'review-card', 'data-kind': block.kind, 'data-item-id': block.item || '' },
				head
			);
			if (block.item) {
				card.appendChild(h('p', { className: 'review-note' }, 'Item: ', h('code', null, block.item)));
			}
			if (block.reason) {
				card.appendChild(h('p', { className: 'review-reason' }, block.reason));
			}
			if (Array.isArray(block.violations) && block.violations.length > 0) {
				var vList = h('ul', { className: 'review-decisions' });
				for (var v = 0; v < block.violations.length; v++) {
					vList.appendChild(h('li', null, h('code', null, block.violations[v])));
				}
				card.appendChild(vList);
			}
			blockList.appendChild(card);
		}
		blockSection.appendChild(blockList);
		sections.push(blockSection);
	}

	if (openItems.length > 0) {
		var openSection = h('section', { 'aria-label': 'Open review items', 'data-section': 'open' });
		openSection.appendChild(h('h2', null, 'Open items (' + openItems.length + ')'));
		var openList = h('div', { className: 'review-list' });
		var previewsMap = payload.previews || {};
		for (var i = 0; i < openItems.length; i++) {
			var item = openItems[i];
			var openHead = h(
				'div',
				{ className: 'review-card-head' },
				h('span', { className: 'review-badge', 'data-tone': 'warn' }, item.kind),
				h('h3', null, (item.ids || []).join(', ')),
				item.check ? h('code', null, item.check) : null
			);
			var openCard = h(
				'article',
				{ className: 'review-card', 'data-kind': item.kind, 'data-item-id': item.item },
				openHead,
				h('p', { className: 'review-question' }, item.question),
				h('p', { className: 'review-note' }, 'Item: ', h('code', null, item.item))
			);
			if (item.cause) {
				var causeTable = h(
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
							h('th', { scope: 'col' }, 'Before'),
							h('th', { scope: 'col' }, 'After')
						)
					),
					h(
						'tbody',
						null,
						h(
							'tr',
							null,
							h('td', null, h('code', null, item.cause.channel)),
							h('td', null, item.cause.target ? h('code', null, item.cause.target) : '—'),
							h('td', null, item.cause.property ? h('code', null, item.cause.property) : '—'),
							h('td', null, h('code', null, formatValue(item.cause.left))),
							h('td', null, h('code', null, formatValue(item.cause.right)))
						)
					)
				);
				openCard.appendChild(h('div', { className: 'review-table-wrap' }, causeTable));
			}
			if (item.limitation) {
				openCard.appendChild(h('p', { className: 'review-reason' }, item.limitation));
			}
			if (Array.isArray(item.decisions) && item.decisions.length > 0) {
				var dList = h('ul', { className: 'review-decisions', 'aria-label': 'Affected decisions' });
				for (var d = 0; d < item.decisions.length; d++) {
					var dec = item.decisions[d];
					dList.appendChild(h('li', null, h('code', null, dec.decision), ': ', dec.reason));
				}
				openCard.appendChild(dList);
			}
			var itemPreviews = hasOwn.call(previewsMap, item.item) ? previewsMap[item.item] : [];
			if (Array.isArray(itemPreviews) && itemPreviews.length > 0) {
				var shotsWrap = h('div', { className: 'review-shots' });
				var hasAnyShot = false;
				for (var p = 0; p < itemPreviews.length; p++) {
					var prev = itemPreviews[p];
					var hasBefore = typeof prev.beforeScreenshot === 'string' && SHOT_RE.test(prev.beforeScreenshot);
					var hasAfter = typeof prev.afterScreenshot === 'string' && SHOT_RE.test(prev.afterScreenshot);
					if (!hasBefore && !hasAfter) continue;
					hasAnyShot = true;
					var pairGrid = h('div', { className: 'review-shot-grid' });
					if (hasBefore) {
						pairGrid.appendChild(
							h(
								'figure',
								null,
								h('figcaption', null, 'Before'),
								h('img', { src: './' + prev.beforeScreenshot, alt: 'Before screenshot of ' + prev.key, loading: 'lazy' })
							)
						);
					}
					if (hasAfter) {
						pairGrid.appendChild(
							h(
								'figure',
								null,
								h('figcaption', null, 'After'),
								h('img', { src: './' + prev.afterScreenshot, alt: 'After screenshot of ' + prev.key, loading: 'lazy' })
							)
						);
					}
					shotsWrap.appendChild(
						h('div', { className: 'review-shot-pair' }, h('code', null, prev.key), pairGrid)
					);
				}
				if (hasAnyShot) openCard.appendChild(shotsWrap);
			}
			openList.appendChild(openCard);
		}
		openSection.appendChild(openList);
		sections.push(openSection);
	}

	var settledAnswers = [];
	for (var sa = 0; sa < matchedAnswers.length; sa++) {
		if (matchedAnswers[sa].status === 'answered') settledAnswers.push(matchedAnswers[sa]);
	}
	if (settledAnswers.length > 0) {
		var ansSection = h('section', { 'aria-label': 'Answered items', 'data-section': 'answered' });
		ansSection.appendChild(h('h2', null, 'Settled answers (' + settledAnswers.length + ')'));
		var ansList = h('div', { className: 'review-list' });
		for (var k = 0; k < settledAnswers.length; k++) {
			var answered = settledAnswers[k];
			var ansHead = h(
				'div',
				{ className: 'review-card-head' },
				h('span', { className: 'review-badge', 'data-tone': 'pass' }, answered.chosen),
				h('code', null, answered.decision),
				h('h3', null, (answered.ids || []).join(', '))
			);
			if (answered.decidedBy && answered.decidedBy.kind === 'script') {
				ansHead.appendChild(
					h('span', { className: 'review-badge', 'data-tone': 'warn', 'data-actor-badge': 'script' }, 'script')
				);
			}
			ansList.appendChild(
				h(
					'article',
					{ className: 'review-card', 'data-kind': 'answered', 'data-decision-id': answered.decision },
					ansHead,
					h('p', { className: 'review-reason' }, answered.reason)
				)
			);
		}
		ansSection.appendChild(ansList);
		sections.push(ansSection);
	}

	root.replaceChildren.apply(root, sections);
	document.documentElement.dataset.specimenReview = 'ready';
})();
</script>
</body>
</html>
`;
}

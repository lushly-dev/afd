// Specimen, on the design side. The pictures on this page are captures the
// real host took of a small component (site/specimen/bench/). Every number,
// label and status beside them is read from those captures or from the result
// of the real specimen-diff command, which runs here when you pick a change.

import { BASES, basisCounts, facts, loadBrief, renderBrief } from './specimen-brief.js';
import { SCENARIOS, diff, observation, reading, start, themeShot, themes } from './specimen-runtime.js';
import { createFrame, el, renderDifferences, renderTally, stateName, touched } from './specimen-view.js';
import { initStatements } from './statements.js';
import './widows.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const STATUS = {
	changed: 'Changed',
	'no-change-observed': 'No change observed',
	'insufficient-evidence': 'Not enough evidence',
};

const entries = await start();
const titleOf = (id) => stateName(entries.find((entry) => entry.id === id)?.title ?? 'Change bar/Ready');
// The second capture of the same state is not a project entry of its own.
const nameOfState = (id) => (id === 'bar-again' ? `${titleOf('bar')}, again` : titleOf(id));

/** The snapshot's buttons: the lines a reader needs, without the page around them. */
const buttonLines = (snapshot) =>
	snapshot
		.split('\n')
		.filter((line) => line.includes('button'))
		.map((line) => line.trim());

/** Mark `[disabled]` in a snapshot, so the eye lands on it. */
function snapshotNodes(lines) {
	return lines.flatMap((line) => {
		const parts = line.split(/(\[disabled\])/);
		return [...parts.map((part) => (part === '[disabled]' ? el('mark', {}, part) : part)), '\n'];
	});
}

// ── Hero: one capture, read two ways ────────────────────────────────────

async function renderHero() {
	const disabled = await observation('bar-disabled');
	const lines = buttonLines(disabled.channels.a11y.snapshot);
	$('[data-hero-snapshot]').replaceChildren(...snapshotNodes(lines));
	const inDom = disabled.channels.elements.filter((item) => item.state.disabled === true).length;
	const announced = lines.filter((line) => line.includes('[disabled]')).length;
	$('[data-hero-answer]').textContent =
		`${inDom} button${inDom === 1 ? ' is' : 's are'} disabled. ${announced} ${announced === 1 ? 'is' : 'are'} announced as disabled.`;
}

// ── Fig. 01: a value for each reading, from the Save button ─────────────

async function renderReadings() {
	const ready = await observation('bar');
	const save = ready.channels.elements.find((item) => item.attributes.class === 'keep');
	const round = (value) => String(Math.round(value * 100) / 100);
	const samples = {
		// Cut from the markup the capture recorded, not rebuilt.
		dom: /<button class="keep"[^>]*>[^<]*<\/button>/.exec(ready.channels.dom.raw)[0],
		layout: `${round(save.box.width)} × ${round(save.box.height)} at ${round(save.box.x)}, ${round(save.box.y)}`,
		styles: `padding ${save.styles['padding-top']} ${save.styles['padding-left']} · ${save.styles['background-color']}`,
		state: `disabled ${save.state.disabled} · focused ${save.state.focused}`,
		a11y: `${save.accessibility.role} "${save.accessibility.name}"`,
	};
	for (const [key, text] of Object.entries(samples)) $(`[data-sample="${key}"]`).textContent = text;
	$('[data-style-count]').textContent = String(Object.keys(save.styles).length);
}

// ── Fig. 02: pick a change, compare the two captures ────────────────────

const frames = { left: createFrame('left'), right: createFrame('right') };
$('[data-frames]').append(frames.left.node, frames.right.node);

function point(ref) {
	frames.left.point(ref);
	frames.right.point(ref);
}

async function compare(scenario) {
	for (const button of $$('[data-scenarios] button'))
		button.setAttribute('aria-pressed', String(button.dataset.scenario === scenario.id));
	$('[data-cause]').textContent = scenario.cause;
	const { result, left, right, ms } = await diff(scenario.left, scenario.right);
	if (!result.success) {
		$('[data-status]').textContent = 'The comparison failed';
		$('[data-reading]').textContent = `${result.error.message} ${result.error.suggestion ?? ''}`;
		return;
	}
	const { data } = result;
	const refs = touched(data);
	frames.left.show(scenario.left, left, nameOfState(scenario.left), refs);
	frames.right.show(scenario.right, right, nameOfState(scenario.right), refs);
	const status = $('[data-status]');
	status.textContent = STATUS[data.status];
	status.dataset.status = data.status;
	renderTally($('[data-tally]'), data);
	$('[data-reading]').textContent = reading(data);
	renderDifferences($('[data-differences]'), data, left, right, point);
	$('[data-differences]').hidden = data.differences.length === 0;
	$('[data-ran]').textContent =
		`specimen-diff compared ${scenario.left}.json with ${scenario.right}.json on this page, in ${ms < 1 ? 'under 1' : Math.round(ms)} ms.`;
}

$('[data-scenarios]').append(
	...SCENARIOS.map((scenario) => {
		const button = el('button', { type: 'button', 'data-scenario': scenario.id, 'aria-pressed': 'false' }, scenario.label);
		button.addEventListener('click', () => compare(scenario));
		return button;
	})
);

// ── Fig. 05: the brief an agent gets, and where each fact came from ─────

async function renderBriefFigure() {
	const brief = await loadBrief('change-bar');
	const doc = $('[data-brief]');
	renderBrief(doc, brief);
	const counts = basisCounts(brief);
	$('[data-brief-count]').textContent = `${facts(brief).length} facts about one component.`;
	const buttons = BASES.map(([basis, label, meaning]) => {
		const button = el(
			'button',
			{ type: 'button', 'data-basis': basis, 'aria-pressed': 'false' },
			el('b', {}, String(counts[basis])),
			el('span', {}, label),
			el('small', {}, meaning)
		);
		button.addEventListener('click', () => {
			// A second press shows everything again.
			const show = doc.dataset.show === basis ? null : basis;
			if (show) doc.dataset.show = show;
			else delete doc.dataset.show;
			for (const other of buttons) other.setAttribute('aria-pressed', String(other.dataset.basis === show));
		});
		return button;
	});
	$('[data-brief-bases]').replaceChildren(...buttons);
	$('[data-brief-built]').textContent = `Built by specimen pack from ${entries.length} cases, each run twice.`;
}

// ── Fig. 06: the theme audit ─────────────────────────────────────────────

const THEME_NAMES = { light: 'Light', dark: 'Dark', 'high-contrast': 'High contrast' };
/** One state of the bar stands for the others, which the summary counts. */
const THEME_ROWS = ['bar', 'receipt', 'empty-state'];
const percent = (share) => `${Math.round(share * 100)}%`;
/** The frame the audit ran at (THEME_VIEWPORT in scripts/build-site-specimen.mjs). */
const THEME_FRAME = { width: 360, height: 110 };
/** Which mark each status wears (area-kit.css). The one that needs a decision is the red one. */
const THEME_MARK = { follows: 'outline', declared: 'solid', pinned: 'outline', undeclared: 'alert', contradicted: 'alert', unavailable: 'dashed' };
/** What each status means for the screen in that row. The status itself is Specimen's. */
const THEME_MEANING = {
	follows: ['Passes', 'It changes with the theme, as a screen should.'],
	declared: ['Passes', 'It stays the same on purpose, and the project says why:'],
	undeclared: ['Fails', 'It stays the same and nothing says it should. Someone has to decide: declare it, or fix it.'],
};

async function renderThemes() {
	const { data } = await themes();
	const table = $('[data-themes]');
	const { counts } = data;
	$('[data-themes-summary]').textContent =
		`specimen themes checked ${counts.total} states: ${counts.follows} follow, ${counts.declared} declared, ${counts.undeclared} undeclared. valid: ${data.valid}.`;
	const verdict = $('[data-themes-verdict]');
	verdict.dataset.valid = String(data.valid);
	verdict.replaceChildren(
		el('b', {}, data.valid ? 'The audit passes.' : 'The audit fails.'),
		' ',
		data.valid
			? `All ${counts.total} states follow the theme or say why they do not.`
			: `${counts.undeclared} of ${counts.total} states ${counts.undeclared === 1 ? 'ignores' : 'ignore'} the theme with no reason given, so a build that runs this check stops here.`
	);
	table.append(
		el(
			'thead',
			{},
			el('tr', {}, el('th', { scope: 'col' }, 'Screen'), ...data.themes.map((theme) => el('th', { scope: 'col' }, THEME_NAMES[theme])))
		),
		el(
			'tbody',
			{},
			...THEME_ROWS.map((id) => {
				const report = data.reports.find((item) => item.id === id);
				const [outcome, meaning] = THEME_MEANING[report.status] ?? ['', ''];
				return el(
					'tr',
					{ 'data-status': report.status },
					el(
						'th',
						{ scope: 'row' },
						el('b', {}, report.title.split('/')[0]),
						el(
							'span',
							{ class: 'themes-tags' },
							el('span', { class: 'mark themes-status', 'data-mark': THEME_MARK[report.status], 'data-status': report.status }, report.status),
							el('span', { class: 'mark themes-outcome', 'data-mark': 'plain' }, outcome)
						),
						el('span', { class: 'themes-meaning' }, meaning),
						report.declared?.reason ? el('span', { class: 'themes-reason' }, `“${report.declared.reason}”`) : null
					),
					...report.frames.map((frame, index) => {
						// Two frames count as the same picture at or under the audit's own threshold.
						const same = frame.changed <= data.threshold;
						return el(
							'td',
							{ 'data-theme': frame.theme, 'data-same': index > 0 && same ? 'true' : undefined },
							// The column heading is hidden where the pictures stack, so each one names its theme.
							el('span', { class: 'themes-theme' }, THEME_NAMES[frame.theme]),
							el(
								'span',
								{ class: 'themes-mat' },
								el('img', {
									src: themeShot(id, frame.theme),
									width: String(THEME_FRAME.width),
									height: String(THEME_FRAME.height),
									alt: `${report.title.replace('/', ': ')}, in the ${THEME_NAMES[frame.theme].toLowerCase()} theme.`,
								})
							),
							el(
								'span',
								{ class: 'themes-note' },
								index === 0
									? 'The picture the others are compared with'
									: same
										? 'The same picture as light'
										: `${percent(frame.changed)} of it differs from light`
							)
						);
					})
				);
			})
		)
	);
}

// ── Fig. 04: the bug in our own bar, before and after ───────────────────

async function renderFound() {
	for (const figure of $$('[data-found]')) {
		const observed = await observation(figure.dataset.found);
		// The opening tag, as the capture recorded it.
		$('[data-found-tag]', figure).textContent = /^<[^>]+>/.exec(observed.channels.dom.raw)[0];
		$('[data-found-snapshot]', figure).replaceChildren(...snapshotNodes(buttonLines(observed.channels.a11y.snapshot)));
	}
}

// ── Fig. 09: copy the install line ───────────────────────────────────────

$('[data-copy-install]').addEventListener('click', async () => {
	const status = $('[data-copy-status]');
	try {
		await navigator.clipboard.writeText($('[data-install]').textContent);
		status.textContent = 'Copied to clipboard.';
	} catch {
		status.textContent = 'Clipboard unavailable. Select the command to copy it.';
	}
});

initStatements();
await Promise.all([renderHero(), renderReadings(), compare(SCENARIOS[0]), renderThemes(), renderFound(), renderBriefFigure()]);
document.documentElement.dataset.specimen = 'ready';

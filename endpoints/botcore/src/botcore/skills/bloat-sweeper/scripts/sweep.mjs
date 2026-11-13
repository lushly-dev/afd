#!/usr/bin/env node
/**
 * The bloat sweep's measurements, for the bloat-sweeper skill. Run from inside the
 * repository; it needs Node and git, and `gh` for open pull requests and the trend.
 *
 *   area                      this week's area in the rotation
 *   bloat [--area <a>] [--top <n>] [--record]
 *                             rank oversized files and copied code, name the area to work on;
 *                             --record comments the measurement on the trend issue first
 *   trend                     the recorded measurements, and whether deferral is keeping up
 *
 * Settings come from botcore.toml (or pyproject.toml's [tool.botcore]): `file_size_warn`
 * is the threshold, and `[sweep]` holds `trend_issue`, `cohesive`, `exclude`,
 * `churn_days`, `extensions` and `measures`. Judgment stays in the skill: whether a long
 * file has a seam, what to extract, and what to do when the trend worsens.
 *
 * Exit: 0 done, 1 usage, configuration or unexpected error (the reason on stderr).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

/** Normalized lines in one clone window. Shorter windows match boilerplate, not copies. */
export const CLONE_WINDOW = 10;
/** A copy in this many files is a pattern other code is copying; it ranks first. */
export const SPREADING_FILES = 3;
/** Passes in a row a measure must rise before `trend` says deferral is not keeping up. */
const WORSENING_PASSES = 3;
/** A file judged cohesive is ranked again once it is this many times its size then. */
const COHESIVE_REGROWTH = 1.2;
const METRICS_MARK = 'bloat-metrics';
const DEFAULT_EXTENSIONS = [
	'.ts',
	'.tsx',
	'.mts',
	'.cts',
	'.js',
	'.jsx',
	'.mjs',
	'.cjs',
	'.py',
	'.rs',
];
/** Directories holding output, dependencies or tests: never measured. */
const SKIPPED_SEGMENTS = new Set([
	'node_modules',
	'dist',
	'build',
	'coverage',
	'vendor',
	'generated',
	'_generated',
	'__snapshots__',
	'test',
	'tests',
	'__tests__',
]);
const SKIPPED_NAME =
	/\.(?:test|spec|stories)\.[^.]+$|\.d\.[cm]?ts$|(?:^|\/)test_[^/]*\.py$|_test\.(?:py|rs)$/u;
const MANIFESTS = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod'];
const USAGE = 'Usage: sweep.mjs area | bloat [--area <name>] [--top <n>] [--record] | trend';

// ── Settings ─────────────────────────────────────────────────────────────────

/** A TOML value of the kinds these settings use: an integer, a string, or a list of strings. */
function tomlValue(raw) {
	const text = raw.trim();
	if (/^-?\d+$/u.test(text)) return Number(text);
	if (text.startsWith('['))
		return [...text.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/gu)].map((m) => m[1] ?? m[2]);
	const quoted = /^"((?:[^"\\]|\\.)*)"|^'([^']*)'/u.exec(text);
	if (quoted) return quoted[1] ?? quoted[2];
	return text;
}

/**
 * The flat keys and the `[sweep]` table of a botcore.toml, or of pyproject.toml's
 * `[tool.botcore]` and `[tool.botcore.sweep]`. Enough TOML for these settings, not a
 * general parser; Botcore's own loader validates the file.
 */
export function readSettings(text, { pyproject = false } = {}) {
	const top = pyproject ? 'tool.botcore' : '';
	const sweepTable = pyproject ? 'tool.botcore.sweep' : 'sweep';
	const flat = {};
	const sweep = {};
	let table = '';
	let pending;
	for (const raw of text.split(/\r?\n/u)) {
		const line = raw.replace(/\s+#.*$/u, '');
		if (pending) {
			pending.value += ` ${line.trim()}`;
			if (!line.includes(']')) continue;
			pending.target[pending.key] = tomlValue(pending.value);
			pending = undefined;
			continue;
		}
		const header = /^\s*\[([^\]]+)\]\s*$/u.exec(line);
		if (header) {
			table = header[1].trim();
			continue;
		}
		const pair = /^\s*([A-Za-z0-9_-]+)\s*=\s*(.*)$/u.exec(line);
		if (!pair) continue;
		const target = table === top ? flat : table === sweepTable ? sweep : undefined;
		if (!target) continue;
		const [, key, value] = pair;
		if (value.trim().startsWith('[') && !value.includes(']')) pending = { target, key, value };
		else target[key] = tomlValue(value);
	}
	return {
		threshold: typeof flat.file_size_warn === 'number' ? flat.file_size_warn : 500,
		trendIssue: typeof sweep.trend_issue === 'number' ? sweep.trend_issue : undefined,
		cohesive: typeof sweep.cohesive === 'string' ? sweep.cohesive : 'sweep-cohesive.json',
		exclude: Array.isArray(sweep.exclude) ? sweep.exclude : [],
		churnDays: typeof sweep.churn_days === 'number' ? sweep.churn_days : 90,
		extensions: Array.isArray(sweep.extensions) ? sweep.extensions : DEFAULT_EXTENSIONS,
		measures: typeof sweep.measures === 'string' ? sweep.measures : undefined,
	};
}

// ── What is measured ─────────────────────────────────────────────────────────

/** Whether a tracked path is source the sweep measures. */
export function isMeasured(path, settings) {
	if (!settings.extensions.some((extension) => path.endsWith(extension))) return false;
	if (SKIPPED_NAME.test(path)) return false;
	if (path.split('/').some((segment) => SKIPPED_SEGMENTS.has(segment))) return false;
	return !settings.exclude.some(
		(prefix) => path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)
	);
}

/** Lines in a file, a final newline not counting as one more. */
export function countLines(contents) {
	if (contents === '') return 0;
	const lines = contents.split(/\r?\n/u).length;
	return contents.endsWith('\n') ? lines - 1 : lines;
}

/**
 * A file's area: the nearest directory holding a package manifest, so a monorepo's
 * packages are areas of their own; `.` for the repository root.
 */
export function areaResolver(paths) {
	const roots = new Set(
		paths
			.filter((path) => MANIFESTS.some((name) => path === name || path.endsWith(`/${name}`)))
			.map((path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.'))
	);
	return (path) => {
		for (
			let dir = path.slice(0, Math.max(0, path.lastIndexOf('/')));
			dir;
			dir = dir.slice(0, Math.max(0, dir.lastIndexOf('/')))
		) {
			if (roots.has(dir)) return dir;
		}
		return '.';
	};
}

/** ISO 8601 week number of a date, in UTC. */
export function isoWeek(date) {
	const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
	day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
	const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
	return Math.ceil(((day - yearStart) / 86_400_000 + 1) / 7);
}

export function rotationArea(areas, date) {
	if (areas.length === 0) throw new Error('No sweep areas: no measured source is tracked.');
	return areas[isoWeek(date) % areas.length];
}

// ── Size and churn ───────────────────────────────────────────────────────────

/**
 * Lines past the threshold, weighted by recent edits: every edit to an oversized file
 * pays for its size again, so the long file people keep changing comes first.
 */
export function sizeScore(lines, churn, threshold) {
	return Math.max(0, lines - threshold) * (1 + churn);
}

export function rankOversized(files, threshold) {
	return files
		.filter((file) => file.lines >= threshold)
		.map((file) => ({ ...file, score: sizeScore(file.lines, file.churn, threshold) }))
		.sort(
			(left, right) =>
				right.score - left.score || right.lines - left.lines || left.path.localeCompare(right.path)
		);
}

/**
 * Whether a pass judged this file cohesive: one job that takes many lines. `verdicts`
 * maps a path to `{ lines, reason }` as recorded then. The verdict lapses once the file
 * has grown by a fifth, because growth is how a second job arrives.
 */
export function isJudgedCohesive(file, verdicts) {
	const verdict = verdicts[file.path];
	return verdict !== undefined && file.lines <= verdict.lines * COHESIVE_REGROWTH;
}

// ── Copies ───────────────────────────────────────────────────────────────────

const TRIVIAL_LINE =
	/^(?:[\])}>,;(:]*|\/\/.*|#.*|\/?\*.*|import\b.*|from\s+\S+\s+import\b.*|use\s.*;|export\s+(?:\*|\{[^}]*\})\s+from\b.*|"""|''')$/u;
const SPECIFIER_LIST_OPEN =
	/^(?:import(?: type)?(?: [\w$]+,)? \{|export(?: type)? \{|from\s+\S+\s+import\s*\()[^})]*$/u;

/**
 * The lines of a file worth comparing, each with its 1-based line number. A wrapped
 * import or re-export list is skipped whole: two files importing the same ten names are
 * not a copy of anything.
 */
export function comparableLines(contents) {
	const kept = [];
	let inSpecifierList = false;
	for (const [index, raw] of contents.split(/\r?\n/u).entries()) {
		const text = raw.trim().replace(/\s+/gu, ' ');
		if (inSpecifierList) {
			if (text.startsWith('}') || text.startsWith(')')) inSpecifierList = false;
		} else if (SPECIFIER_LIST_OPEN.test(text)) inSpecifierList = true;
		else if (!TRIVIAL_LINE.test(text)) kept.push({ text, line: index + 1 });
	}
	return kept;
}

/**
 * Copies shared between files: runs of at least `window` comparable lines that appear,
 * whitespace aside, in two or more files. One group per run, with every file holding
 * it, widest spread first; and the comparable lines each file shares with any other.
 * Renamed identifiers do not match: this finds pasted code, which is what spreads.
 */
export function findClones(sources, window = CLONE_WINDOW) {
	const occurrences = new Map();
	const perFile = sources.map(({ path, contents }) => {
		const lines = comparableLines(contents);
		const keys = [];
		for (let start = 0; start + window <= lines.length; start++) {
			const key = lines
				.slice(start, start + window)
				.map(({ text }) => text)
				.join('\n');
			keys.push(key);
			const holders = occurrences.get(key) ?? new Set();
			holders.add(path);
			occurrences.set(key, holders);
		}
		return { path, lines, keys };
	});
	const groups = new Map();
	const duplicatedLines = new Map();
	for (const { path, lines, keys } of perFile) {
		const covered = new Set();
		let run;
		const close = () => {
			if (!run) return;
			const id = `${run.holders}\n${run.firstKey}`;
			const group = groups.get(id) ?? { files: run.holders.split('\n'), lines: 0, places: [] };
			group.lines = Math.max(group.lines, run.end - run.start + window);
			group.places.push({ path, line: lines[run.start].line });
			groups.set(id, group);
			run = undefined;
		};
		for (const [start, key] of keys.entries()) {
			const holders = occurrences.get(key);
			if (holders.size < 2) {
				close();
				continue;
			}
			for (let offset = 0; offset < window; offset++) covered.add(start + offset);
			const holderKey = [...holders].sort().join('\n');
			if (run && run.holders === holderKey && run.end === start - 1) run.end = start;
			else {
				close();
				run = { holders: holderKey, firstKey: key, start, end: start };
			}
		}
		close();
		if (covered.size > 0) duplicatedLines.set(path, covered.size);
	}
	return {
		groups: [...groups.values()].sort(
			(left, right) =>
				right.files.length - left.files.length ||
				right.lines - left.lines ||
				left.files[0].localeCompare(right.files[0])
		),
		duplicatedLines,
	};
}

// ── Trend ────────────────────────────────────────────────────────────────────

const CORE_MEASURES = [
	['overThreshold', 'files at or over the threshold'],
	['duplicatedLines', 'duplicated lines'],
	['spreadingClones', `copies in ${SPREADING_FILES}+ files`],
];

/** The measures a recording holds: the core three, then the repository's own, by their labels. */
function measuresOf(history) {
	const extra = new Map();
	for (const entry of history)
		for (const [key, label] of Object.entries(entry.labels ?? {})) extra.set(key, label);
	return [...CORE_MEASURES, ...extra];
}

/** The comment `bloat --record` posts: the measures in words, then the machine line. */
export function recordBody({ metrics, area }) {
	return [
		`**Bloat sweep ${metrics.date}** at \`${metrics.head}\`, area \`${area ?? 'none'}\``,
		'',
		...measuresOf([metrics])
			.filter(([key]) => typeof metrics[key] === 'number')
			.map(([key, label]) => `- ${label}: ${metrics[key]}`),
		'',
		`<!-- ${METRICS_MARK} ${JSON.stringify(metrics)} -->`,
	].join('\n');
}

/** The measurements recorded in comment bodies, oldest first; a hand-edited one is skipped. */
export function parseMetrics(bodies) {
	const pattern = new RegExp(`<!-- ${METRICS_MARK} (\\{.*?\\}) -->`, 'u');
	return bodies
		.flatMap((body) => {
			try {
				const metrics = JSON.parse(pattern.exec(body)?.[1] ?? 'null');
				return typeof metrics?.date === 'string' ? [metrics] : [];
			} catch {
				return [];
			}
		})
		.sort((left, right) => left.date.localeCompare(right.date));
}

/** Measures that rose in each of the last passes; a pass that did not record one breaks its run. */
export function worseningMeasures(history, passes = WORSENING_PASSES) {
	const recent = history.slice(-(passes + 1));
	if (recent.length < passes + 1) return [];
	return measuresOf(history)
		.filter(([key]) =>
			recent.every(
				(entry, index) =>
					typeof entry[key] === 'number' && (index === 0 || entry[key] > recent[index - 1][key])
			)
		)
		.map(([key, label]) => ({ key, label, from: recent[0][key], to: recent.at(-1)[key] }));
}

/** The skill keys on this verdict line; change the two together. */
export const NOT_KEEPING_UP = 'Verdict: NOT KEEPING UP.';

export function formatTrend(history, issue) {
	if (history.length === 0) return `No measurements recorded on #${issue} yet.`;
	const measures = measuresOf(history);
	const lines = [`Bloat trend from #${issue}, oldest first:`];
	for (const entry of history)
		lines.push(`  ${entry.date}  ${measures.map(([key]) => entry[key] ?? '-').join('  ')}`);
	lines.push(`  (${measures.map(([, label]) => label).join(' | ')})`, '');
	const worsening = worseningMeasures(history);
	if (worsening.length === 0)
		lines.push(`Verdict: holding. No measure has risen ${WORSENING_PASSES} passes in a row.`);
	else
		lines.push(
			`${NOT_KEEPING_UP} Risen ${WORSENING_PASSES} passes in a row:`,
			...worsening.map(({ label, from, to }) => `  ${label}: ${from} -> ${to}`)
		);
	return lines.join('\n');
}

// ── Reading the checkout ─────────────────────────────────────────────────────

function run(root, command, args, { allowFailure = false, shell = false } = {}) {
	try {
		return execFileSync(command, args, {
			cwd: root,
			encoding: 'utf8',
			maxBuffer: 256 * 1024 * 1024,
			stdio: ['ignore', 'pipe', 'pipe'],
			shell,
		});
	} catch (cause) {
		if (allowFailure) return undefined;
		const detail = cause.stderr?.toString().trim() || cause.message;
		throw new Error(`${command} ${args.join(' ')} failed: ${detail}`);
	}
}

function loadSettings(root) {
	const botcore = join(root, 'botcore.toml');
	if (existsSync(botcore)) return readSettings(readFileSync(botcore, 'utf8'));
	const pyproject = join(root, 'pyproject.toml');
	if (existsSync(pyproject))
		return readSettings(readFileSync(pyproject, 'utf8'), { pyproject: true });
	return readSettings('');
}

function trackedFiles(root) {
	return run(root, 'git', ['ls-files', '-z']).split('\0').filter(Boolean);
}

function churnByPath(root, days) {
	const log = run(root, 'git', ['log', `--since=${days}.days`, '--name-only', '--format=', '-z']);
	const churn = new Map();
	for (const path of log.split(/[\0\n]/u).filter(Boolean))
		churn.set(path, (churn.get(path) ?? 0) + 1);
	return churn;
}

/** Open pull requests by the paths they change; empty when `gh` cannot answer. */
function openPullRequestsByPath(root) {
	const output = run(
		root,
		'gh',
		['pr', 'list', '--state', 'open', '--limit', '200', '--json', 'number,files'],
		{ allowFailure: true }
	);
	const byPath = new Map();
	if (!output) return { byPath, known: false };
	for (const { number, files } of JSON.parse(output))
		for (const { path } of files ?? []) byPath.set(path, [...(byPath.get(path) ?? []), number]);
	return { byPath, known: true };
}

function cohesiveVerdicts(root, settings) {
	const path = join(root, settings.cohesive);
	return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
}

/**
 * The repository's own measures, from `[sweep] measures`: a command printing
 * `{ "measures": [{ "key", "label", "value" }], "lines": ["..."] }`.
 */
function repositoryMeasures(root, settings) {
	if (!settings.measures) return { metrics: {}, labels: {}, lines: [] };
	const output = JSON.parse(run(root, settings.measures, [], { shell: true }));
	const metrics = {};
	const labels = {};
	for (const { key, label, value } of output.measures ?? []) {
		if (typeof key !== 'string' || typeof value !== 'number') continue;
		metrics[key] = value;
		labels[key] = typeof label === 'string' ? label : key;
	}
	return { metrics, labels, lines: Array.isArray(output.lines) ? output.lines : [] };
}

// ── Commands ─────────────────────────────────────────────────────────────────

function measureBloat(root, settings, area) {
	const paths = trackedFiles(root);
	const areaOf = areaResolver(paths);
	const sources = paths
		.filter((path) => isMeasured(path, settings) && existsSync(join(root, path)))
		.map((path) => ({ path, contents: readFileSync(join(root, path), 'utf8') }));
	if (sources.length === 0)
		throw new Error('Measured no source files: check [sweep] extensions and exclude.');
	const churn = churnByPath(root, settings.churnDays);
	const pulls = openPullRequestsByPath(root);
	const openPullRequests = (path) => pulls.byPath.get(path) ?? [];
	const verdicts = cohesiveVerdicts(root, settings);
	const files = sources.map(({ path, contents }) => ({
		path,
		area: areaOf(path),
		lines: countLines(contents),
		churn: churn.get(path) ?? 0,
		openPullRequests: openPullRequests(path),
	}));
	// Fixtures repeat setup by design; a copy there is not a pattern to stop.
	const clones = findClones(sources.filter(({ path }) => !/fixtures?\b/u.test(path)));
	const oversized = rankOversized(files, settings.threshold);
	const inArea = (path) => !area || areaOf(path) === area;
	const candidates = oversized.filter(
		(file) => inArea(file.path) && !isJudgedCohesive(file, verdicts)
	);
	const free = candidates.find((file) => file.openPullRequests.length === 0);
	const repository = repositoryMeasures(root, settings);
	const metrics = {
		date: new Date().toISOString().slice(0, 10),
		head: run(root, 'git', ['rev-parse', '--short', 'HEAD']).trim(),
		threshold: settings.threshold,
		overThreshold: oversized.length,
		largestLines: oversized.reduce((most, file) => Math.max(most, file.lines), 0),
		duplicatedLines: [...clones.duplicatedLines.values()].reduce((sum, count) => sum + count, 0),
		cloneGroups: clones.groups.length,
		spreadingClones: clones.groups.filter((group) => group.files.length >= SPREADING_FILES).length,
		...repository.metrics,
		...(Object.keys(repository.labels).length ? { labels: repository.labels } : {}),
	};
	return {
		metrics,
		area: area ?? free?.area,
		pullRequestsKnown: pulls.known,
		oversized: candidates,
		judgedCohesive: oversized.filter(
			(file) => inArea(file.path) && isJudgedCohesive(file, verdicts)
		),
		clones: clones.groups
			.filter((group) => group.files.some(inArea))
			.map((group) => ({
				...group,
				places: group.places.map((place) => ({
					...place,
					openPullRequests: openPullRequests(place.path),
				})),
			})),
		repositoryLines: repository.lines,
	};
}

const heldBy = (numbers) =>
	numbers.length ? `  [open PR ${numbers.map((number) => `#${number}`).join(', ')}: skip]` : '';

function formatBloat(report, settings, top) {
	const { metrics } = report;
	const lines = [
		`Bloat report @ ${metrics.head} (${metrics.date})`,
		`  area: ${report.area ?? 'none: every oversized file is judged cohesive or has an open pull request'}`,
		`  files at or over ${metrics.threshold} lines: ${metrics.overThreshold} (largest ${metrics.largestLines})`,
		`  duplicated lines: ${metrics.duplicatedLines} in ${metrics.cloneGroups} copies, ${metrics.spreadingClones} of them in ${SPREADING_FILES}+ files`,
		'',
		`Oversized, by lines past the threshold x (1 + commits in ${settings.churnDays} days):`,
		...report.oversized
			.slice(0, top)
			.map(
				(file) =>
					`  ${String(file.lines).padStart(5)} lines ${String(file.churn).padStart(3)} commits  ${file.path}${heldBy(file.openPullRequests)}`
			),
		`  (${report.judgedCohesive.length} more judged cohesive in ${settings.cohesive}, not ranked)`,
		'',
		'Copies, widest spread first:',
		...report.clones
			.slice(0, top)
			.flatMap((group) => [
				`  ${group.files.length} files, ~${group.lines} lines`,
				...group.places.map(
					({ path, line, openPullRequests }) => `      ${path}:${line}${heldBy(openPullRequests)}`
				),
			]),
	];
	if (report.repositoryLines.length)
		lines.push('', 'Repository measures:', ...report.repositoryLines.map((line) => `  ${line}`));
	if (!report.pullRequestsKnown)
		lines.push('', 'Open pull requests were not read (`gh` failed): check candidates by hand.');
	return lines.join('\n');
}

function readHistory(root, issue) {
	return parseMetrics(
		JSON.parse(
			run(root, 'gh', [
				'issue',
				'view',
				String(issue),
				'--json',
				'comments',
				'--jq',
				'[.comments[].body]',
			])
		)
	);
}

function requireTrendIssue(settings) {
	if (settings.trendIssue !== undefined) return settings.trendIssue;
	throw new Error(
		'No trend issue: open one ("Bloat trend") and set `trend_issue` under [sweep] in botcore.toml.'
	);
}

export function main(
	args,
	root = run(process.cwd(), 'git', ['rev-parse', '--show-toplevel']).trim()
) {
	const [command, ...rest] = args;
	const settings = loadSettings(root);
	if (command === 'area' && rest.length === 0) {
		const paths = trackedFiles(root);
		const areaOf = areaResolver(paths);
		const areas = [
			...new Set(paths.filter((path) => isMeasured(path, settings)).map(areaOf)),
		].sort();
		return rotationArea(areas, new Date());
	}
	if (command === 'trend' && rest.length === 0) {
		const issue = requireTrendIssue(settings);
		return formatTrend(readHistory(root, issue), issue);
	}
	if (command !== 'bloat') throw new Error(USAGE);
	const { values } = parseArgs({
		args: rest,
		options: { area: { type: 'string' }, top: { type: 'string' }, record: { type: 'boolean' } },
	});
	const top = values.top === undefined ? 10 : Number(values.top);
	if (!Number.isInteger(top) || top < 1)
		throw new Error(`--top takes a positive whole number.\n${USAGE}`);
	const report = measureBloat(root, settings, values.area);
	if (values.record) {
		const issue = requireTrendIssue(settings);
		run(root, 'gh', ['issue', 'comment', String(issue), '--body', recordBody(report)]);
	}
	return formatBloat(report, settings, top);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		console.log(main(process.argv.slice(2)));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}

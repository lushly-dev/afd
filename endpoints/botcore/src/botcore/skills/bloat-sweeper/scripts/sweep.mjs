#!/usr/bin/env node
/**
 * The bloat sweep's measurements, for the bloat-sweeper skill. Run from inside the
 * repository; it needs Node and git, and `gh` for open pull requests and the trend.
 *
 *   area                      this week's area in the rotation, then the whole rotation
 *   bloat [--area <a>] [--top <n>] [--record]
 *                             rank oversized files and copied code, name the area to work on;
 *                             --record comments the measurement on the trend issue first
 *   trend                     the measurements the `gh` user recorded, and whether deferral
 *                             is keeping up
 *
 * Settings come from botcore.toml (or pyproject.toml's [tool.botcore]): `file_size_warn`
 * is the threshold, `[skills] source_dir` holds the skills Botcore seeds (never measured),
 * and `[sweep]` holds `trend_issue`, `cohesive`, `exclude`, `include_names`, `churn_days`,
 * `extensions` and `measures`. Judgment stays in the skill: whether a long file has a
 * seam, what to extract, and what to do when the trend worsens.
 *
 * Exit: 0 done, 1 usage, configuration or unexpected error (the reason on stderr).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const MEASURES_SCHEMA_VERSION = '1.0';
const MEASURE_IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const MEASURE_DIRECTIONS = new Set(['higher_is_better', 'lower_is_better', 'neutral']);

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
const USAGE =
	'Usage: sweep.mjs area | bloat [--area <name>] [--top <n>] [--record] [--measures-out <file>] [--target <id>] | trend';

// ── Settings ─────────────────────────────────────────────────────────────────

/**
 * `line` up to its comment, and whether it closes an open array: a `#` or `]` inside a
 * quoted string is text, not syntax.
 */
function scanLine(line) {
	let quote;
	let closes = false;
	for (let index = 0; index < line.length; index++) {
		const char = line[index];
		if (quote) {
			if (char === '\\' && quote === '"') index++;
			else if (char === quote) quote = undefined;
		} else if (char === '"' || char === "'") quote = char;
		else if (char === '#') return { text: line.slice(0, index), closes };
		else if (char === ']') closes = true;
	}
	return { text: line, closes };
}

/** A TOML value of the kinds these settings use: an integer, a string, or a list of strings. */
function tomlValue(raw) {
	const text = raw.trim();
	if (/^-?\d[\d_]*$/u.test(text)) return Number(text.replaceAll('_', ''));
	if (text.startsWith('['))
		return [...text.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/gu)].map((m) => m[1] ?? m[2]);
	const quoted = /^"((?:[^"\\]|\\.)*)"|^'([^']*)'/u.exec(text);
	if (quoted) return quoted[1] ?? quoted[2];
	return text;
}

/**
 * The flat keys and the `[sweep]` and `[skills]` tables of a botcore.toml, or of
 * pyproject.toml's `[tool.botcore]`, `[tool.botcore.sweep]` and `[tool.botcore.skills]`.
 * Enough TOML for these settings, not a general parser; Botcore's own loader validates
 * the file.
 */
export function readSettings(text, { pyproject = false } = {}) {
	const top = pyproject ? 'tool.botcore' : '';
	const sweepTable = pyproject ? 'tool.botcore.sweep' : 'sweep';
	const skillsTable = pyproject ? 'tool.botcore.skills' : 'skills';
	const flat = {};
	const sweep = {};
	const skills = {};
	const tables = new Map([
		[top, flat],
		[sweepTable, sweep],
		[skillsTable, skills],
	]);
	let table = '';
	let pending;
	for (const raw of text.split(/\r?\n/u)) {
		const { text: line, closes } = scanLine(raw);
		if (pending) {
			pending.value += ` ${line.trim()}`;
			if (!closes) continue;
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
		const target = tables.get(table);
		if (!target) continue;
		const [, key, value] = pair;
		if (value.trim().startsWith('[') && !scanLine(value).closes) pending = { target, key, value };
		else target[key] = tomlValue(value);
	}
	return {
		threshold: typeof flat.file_size_warn === 'number' ? flat.file_size_warn : 500,
		trendIssue: typeof sweep.trend_issue === 'number' ? sweep.trend_issue : undefined,
		cohesive: typeof sweep.cohesive === 'string' ? sweep.cohesive : 'sweep-cohesive.json',
		exclude: Array.isArray(sweep.exclude) ? sweep.exclude : [],
		includeNames: Array.isArray(sweep.include_names) ? sweep.include_names : [],
		skillsDir: typeof skills.source_dir === 'string' ? skills.source_dir : '.claude/skills',
		churnDays: typeof sweep.churn_days === 'number' ? sweep.churn_days : 90,
		extensions: Array.isArray(sweep.extensions) ? sweep.extensions : DEFAULT_EXTENSIONS,
		measures: typeof sweep.measures === 'string' ? sweep.measures : undefined,
	};
}

// ── What is measured ─────────────────────────────────────────────────────────

/**
 * A file-name pattern as a regular expression: `*` is any run of characters but `/`, `?`
 * one of them, and `**` any directories (`**` + `/` none or several). It matches the whole
 * name, or the whole path when the pattern has a `/`.
 */
export function namePattern(glob) {
	let body = '';
	for (let i = 0; i < glob.length; i += 1) {
		const char = glob[i];
		if (char === '*' && glob[i + 1] === '*') {
			const slash = glob[i + 2] === '/';
			body += slash ? '(?:[^/]*/)*' : '.*';
			i += slash ? 2 : 1;
		} else if (char === '*') body += '[^/]*';
		else if (char === '?') body += '[^/]';
		else body += char.replace(/[\\^$.|+()[\]{}]/u, '\\$&');
	}
	return new RegExp(`${glob.includes('/') ? '^' : '(?:^|/)'}${body}$`, 'u');
}

/**
 * Whether a tracked path is source the sweep measures. `include_names` brings back a
 * name the default skips (`*.stories.*`); skipped directories and `exclude` still win.
 */
export function isMeasured(path, settings) {
	if (!settings.extensions.some((extension) => path.endsWith(extension))) return false;
	if (
		SKIPPED_NAME.test(path) &&
		!(settings.includeNames ?? []).some((glob) => namePattern(glob).test(path))
	)
		return false;
	if (path.split('/').some((segment) => SKIPPED_SEGMENTS.has(segment))) return false;
	return !settings.exclude.some(
		(prefix) => path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)
	);
}

/**
 * Whether a SKILL.md is a copy Botcore seeded: `source: botcore` under its frontmatter's
 * `metadata:`, or at the top level as older copies have it.
 */
export function isSeededSkill(contents) {
	const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(contents)?.[1];
	if (!frontmatter) return false;
	const isBotcore = (value) =>
		value
			.replace(/\s+#.*$/u, '')
			.trim()
			.replace(/^(["'])(.*)\1$/u, '$2') === 'botcore';
	let inMetadata = false;
	let childIndent;
	for (const line of frontmatter.split(/\r?\n/u)) {
		const topLevel = /^([A-Za-z0-9_-]+):(.*)$/u.exec(line);
		if (topLevel) {
			inMetadata = topLevel[1] === 'metadata';
			childIndent = undefined;
			if (topLevel[1] === 'source' && isBotcore(topLevel[2])) return true;
			continue;
		}
		const nested = /^(\s+)([A-Za-z0-9_-]+):(.*)$/u.exec(line);
		if (!inMetadata || !nested) continue;
		// Only metadata's own keys: the first nested line sets their indent.
		childIndent ??= nested[1];
		if (nested[1] === childIndent && nested[2] === 'source' && isBotcore(nested[3])) return true;
	}
	return false;
}

/**
 * The directories, each ending in `/`, of the skills Botcore seeded under `skillsDir`
 * (`[skills] source_dir`). A consumer never edits such a copy, and `skill-seed --update`
 * replaces it, so its scripts are not the repository's bloat. `read` gives a tracked
 * file's contents.
 */
export function seededSkillPrefixes(paths, skillsDir, read) {
	const dir = skillsDir
		.replaceAll('\\', '/')
		.replace(/^(?:\.\/)+/u, '')
		.replace(/\/+$/u, '');
	const prefix = dir === '' || dir === '.' ? '' : `${dir}/`;
	return paths
		.filter((path) => path.startsWith(prefix) && path.endsWith('/SKILL.md'))
		.filter((path) => isSeededSkill(read(path) ?? ''))
		.map((path) => path.slice(0, -'SKILL.md'.length));
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

/**
 * What `area` prints: this week's area alone on the first line, for a script to read,
 * then the whole rotation with this week's marked.
 */
export function formatArea(areas, date) {
	const chosen = rotationArea(areas, date);
	return [
		chosen,
		'',
		`Rotation, one area per ISO week (this is week ${isoWeek(date)}, ${areas.length} areas):`,
		...areas.map((area) => `${area === chosen ? '>' : ' '} ${area}`),
	].join('\n');
}

/** Areas listed in full when `--area` names none of them; past this, `area` lists them. */
const LISTED_AREAS = 12;

/**
 * Refuses an `--area` that holds no measured source, with the likeliest areas meant
 * (those ending in it, then those containing it) and where to find the rest.
 */
export function requireKnownArea(area, areas) {
	if (area === undefined || areas.includes(area)) return;
	const endsWith = areas.filter((known) => area && known.endsWith(`/${area}`));
	const contains = areas.filter(
		(known) => area && known !== '.' && known.includes(area) && !endsWith.includes(known)
	);
	const near = [...endsWith, ...contains].slice(0, 3);
	throw new Error(
		[
			`No measured source in area "${area}".`,
			near.length ? `Did you mean ${near.join(' or ')}?` : '',
			areas.length <= LISTED_AREAS
				? `Areas: ${areas.join(', ')}.`
				: `Run \`sweep.mjs area\` to list all ${areas.length} areas.`,
		]
			.filter(Boolean)
			.join(' ')
	);
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

/**
 * The measures to show: the core three, then the repository's own by their labels. The
 * labels come from this run's `measures` command, never from a recorded comment, so
 * text on the trend issue cannot reach the output.
 */
function measuresOf(labels = {}) {
	return [...CORE_MEASURES, ...Object.entries(labels)];
}

/** The comment `bloat --record` posts: the measures in words, then the machine line. */
export function recordBody({ metrics, area }) {
	return [
		`**Bloat sweep ${metrics.date}** at \`${metrics.head}\`, area \`${area ?? 'none'}\``,
		'',
		...measuresOf(metrics.labels)
			.filter(([key]) => typeof metrics[key] === 'number')
			.map(([key, label]) => `- ${label}: ${metrics[key]}`),
		'',
		`<!-- ${METRICS_MARK} ${JSON.stringify(metrics)} -->`,
	].join('\n');
}

/**
 * Whether a parsed record is one `bloat --record` could have written: an ISO date, a
 * short commit hash, and numbers for every measure. `labels` is read past, not kept.
 */
function isRecording(metrics) {
	if (typeof metrics !== 'object' || metrics === null || Array.isArray(metrics)) return false;
	if (typeof metrics.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(metrics.date)) return false;
	return Object.entries(metrics).every(([key, value]) => {
		if (key === 'date' || key === 'labels') return true;
		if (key === 'head') return typeof value === 'string' && /^[0-9a-f]{4,40}$/u.test(value);
		return typeof value === 'number' && Number.isFinite(value);
	});
}

/**
 * The measurements recorded in comment bodies, oldest first. A record that is not all
 * numbers is dropped whole: a hand-edited or forged comment adds nothing to the trend.
 */
export function parseMetrics(bodies) {
	const pattern = new RegExp(`<!-- ${METRICS_MARK} (\\{.*?\\}) -->`, 'u');
	return bodies
		.flatMap((body) => {
			try {
				const metrics = JSON.parse(pattern.exec(body)?.[1] ?? 'null');
				if (!isRecording(metrics)) return [];
				const { labels: _labels, ...measures } = metrics;
				return [measures];
			} catch {
				return [];
			}
		})
		.sort((left, right) => left.date.localeCompare(right.date));
}

/**
 * The bodies of the comments `login` wrote, given `{ author, body }` per comment. The
 * trend reads only the measurements its own account recorded; anyone else who can
 * comment on the issue could otherwise forge a verdict.
 */
export function recordedBy(comments, login) {
	if (!login) return [];
	return comments.filter((comment) => comment.author === login).map((comment) => comment.body);
}

/** Measures that rose in each of the last passes; a pass that did not record one breaks its run. */
export function worseningMeasures(history, { labels = {}, passes = WORSENING_PASSES } = {}) {
	const recent = history.slice(-(passes + 1));
	if (recent.length < passes + 1) return [];
	return measuresOf(labels)
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

/**
 * The trend table and its verdict. `labels` are the current `measures` command's; a
 * recorded key it no longer reports is left out. `author` is whose comments were read.
 */
export function formatTrend(history, issue, { labels = {}, author } = {}) {
	if (history.length === 0)
		return `No measurements recorded on #${issue}${author ? ` by ${author}` : ''} yet.`;
	const measures = measuresOf(labels);
	const lines = [`Bloat trend from #${issue}, oldest first:`];
	for (const entry of history)
		lines.push(`  ${entry.date}  ${measures.map(([key]) => entry[key] ?? '-').join('  ')}`);
	lines.push(`  (${measures.map(([, label]) => label).join(' | ')})`, '');
	const worsening = worseningMeasures(history, { labels });
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

function readTracked(root, path) {
	const file = join(root, path);
	return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
}

/** `settings` with the skills Botcore seeded under `[skills] source_dir` excluded too. */
function withSeededSkillsExcluded(root, paths, settings) {
	const seeded = seededSkillPrefixes(paths, settings.skillsDir, (path) => readTracked(root, path));
	return { ...settings, exclude: [...settings.exclude, ...seeded] };
}

/** The areas holding measured source, sorted: the rotation, and what `--area` accepts. */
function measuredAreas(paths, settings) {
	const areaOf = areaResolver(paths);
	return [...new Set(paths.filter((path) => isMeasured(path, settings)).map(areaOf))].sort();
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

/** Keys `bloat` records itself; a repository measure cannot take one over. */
const RECORDED_KEYS = new Set([
	'date',
	'head',
	'labels',
	'threshold',
	'overThreshold',
	'largestLines',
	'duplicatedLines',
	'cloneGroups',
	'spreadingClones',
]);

/**
 * The repository's own measures, from `[sweep] measures`: a command printing
 * `{ "measures": [{ "key", "label", "value" }], "lines": ["..."] }`.
 */
function repositoryMeasures(root, settings) {
	if (!settings.measures) return { metrics: {}, labels: {}, meta: {}, lines: [] };
	const output = JSON.parse(run(root, settings.measures, [], { shell: true }));
	const metrics = {};
	const labels = {};
	const meta = {};
	for (const { key, label, value, unit, direction } of output.measures ?? []) {
		if (typeof key !== 'string' || !Number.isFinite(value) || RECORDED_KEYS.has(key)) continue;
		metrics[key] = value;
		labels[key] = typeof label === 'string' && label.trim() ? label : key;
		meta[key] = {
			unit: typeof unit === 'string' && unit.trim() ? unit.trim() : 'count',
			direction: MEASURE_DIRECTIONS.has(direction) ? direction : 'lower_is_better',
		};
	}
	return { metrics, labels, meta, lines: Array.isArray(output.lines) ? output.lines : [] };
}

// ── Commands ─────────────────────────────────────────────────────────────────

function measureBloat(root, settings, area, paths) {
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
		largestMeasuredLines: files.reduce((most, file) => Math.max(most, file.lines), 0),
		cohesiveCount: oversized.filter((file) => isJudgedCohesive(file, verdicts)).length,
		repositoryMeta: repository.meta,
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

/** Build a Health `schema_version = "1.0"` measures document from a bloat report. */
export function toMeasuresDocument(report, { source = 'sweep-bloat', target } = {}) {
	if (target !== undefined && !MEASURE_IDENTIFIER.test(target)) {
		throw new Error(`Invalid measure target identifier: ${target}`);
	}
	if (!MEASURE_IDENTIFIER.test(source)) {
		throw new Error(`Invalid measure source identifier: ${source}`);
	}
	const { metrics } = report;
	const measures = [
		{
			key: 'files_over_warn',
			label: 'Files over size warning',
			value: metrics.overThreshold,
			unit: 'files',
			direction: 'lower_is_better',
		},
		{
			key: 'largest_source_lines',
			label: 'Largest source file',
			value: report.largestMeasuredLines ?? metrics.largestLines,
			unit: 'lines',
			direction: 'lower_is_better',
		},
		{
			key: 'duplicated_lines',
			label: 'Duplicated lines',
			value: metrics.duplicatedLines,
			unit: 'lines',
			direction: 'lower_is_better',
		},
		{
			key: 'clone_groups',
			label: 'Clone groups',
			value: metrics.cloneGroups,
			unit: 'groups',
			direction: 'lower_is_better',
		},
		{
			key: 'spreading_clones',
			label: `Copies in ${SPREADING_FILES}+ files`,
			value: metrics.spreadingClones,
			unit: 'groups',
			direction: 'lower_is_better',
		},
		{
			key: 'cohesive_exemptions',
			label: 'Cohesive size exemptions',
			value: report.cohesiveCount ?? report.judgedCohesive?.length ?? 0,
			unit: 'files',
			direction: 'neutral',
		},
	];
	const usedKeys = new Set(measures.map((row) => row.key));
	for (const [key, label] of Object.entries(metrics.labels ?? {})) {
		const value = metrics[key];
		if (!MEASURE_IDENTIFIER.test(key) || !Number.isFinite(value)) continue;
		if (Math.abs(value) > Number.MAX_SAFE_INTEGER) {
			throw new Error(
				`Repository measure "${key}" value ${value} exceeds Health's safe IEEE-754 integer range.`
			);
		}
		// Namespace repository-custom sweep measures so they never collide with other producers.
		const healthKey = `sweep_custom.${key}`;
		if (usedKeys.has(healthKey)) continue;
		const meta = report.repositoryMeta?.[key];
		measures.push({
			key: healthKey,
			label: typeof label === 'string' && label.trim() ? label : key,
			value,
			unit: meta?.unit ?? 'count',
			direction: meta?.direction ?? 'lower_is_better',
		});
		usedKeys.add(healthKey);
	}
	return {
		schema_version: MEASURES_SCHEMA_VERSION,
		source,
		...(target !== undefined ? { target } : {}),
		measures,
	};
}

const heldBy = (numbers) =>
	numbers.length ? `  [open PR ${numbers.map((number) => `#${number}`).join(', ')}: skip]` : '';

/** The report `bloat` prints: the measures first, the repository's own among them. */
export function formatBloat(report, settings, top) {
	const { metrics } = report;
	const lines = [
		`Bloat report @ ${metrics.head} (${metrics.date})`,
		`  area: ${report.area ?? 'none: every oversized file is judged cohesive or has an open pull request'}`,
		`  files at or over ${metrics.threshold} lines: ${metrics.overThreshold} (largest ${metrics.largestLines})`,
		`  duplicated lines: ${metrics.duplicatedLines} in ${metrics.cloneGroups} copies, ${metrics.spreadingClones} of them in ${SPREADING_FILES}+ files`,
		...Object.entries(metrics.labels ?? {}).map(([key, label]) => `  ${label}: ${metrics[key]}`),
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

/** The measurements the authenticated `gh` user recorded on the trend issue, and who that is. */
function readHistory(root, issue) {
	const author = run(root, 'gh', ['api', 'user', '--jq', '.login'], { allowFailure: true })?.trim();
	if (!author)
		throw new Error(
			'Could not read the authenticated GitHub user (`gh api user`): run `gh auth status`. The trend reads only the measurements its own account recorded.'
		);
	const comments = JSON.parse(
		run(root, 'gh', [
			'issue',
			'view',
			String(issue),
			'--json',
			'comments',
			'--jq',
			'[.comments[] | {author: .author.login, body}]',
		])
	);
	return { author, history: parseMetrics(recordedBy(comments, author)) };
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
	const configured = loadSettings(root);
	if (command === 'trend' && rest.length === 0) {
		const issue = requireTrendIssue(configured);
		const { author, history } = readHistory(root, issue);
		let labels = {};
		let note = '';
		try {
			({ labels } = repositoryMeasures(root, configured));
		} catch (error) {
			const reason = error instanceof Error ? error.message.split('\n')[0] : String(error);
			note = `\n\nThe [sweep] measures command failed (${reason}), so only the core measures are shown.`;
		}
		return formatTrend(history, issue, { labels, author }) + note;
	}
	if (command !== 'area' && command !== 'bloat') throw new Error(USAGE);
	const paths = trackedFiles(root);
	const settings = withSeededSkillsExcluded(root, paths, configured);
	if (command === 'area') {
		if (rest.length > 0) throw new Error(USAGE);
		return formatArea(measuredAreas(paths, settings), new Date());
	}
	const { values } = parseArgs({
		args: rest,
		options: {
			area: { type: 'string' },
			top: { type: 'string' },
			record: { type: 'boolean' },
			'measures-out': { type: 'string' },
			target: { type: 'string' },
		},
	});
	const top = values.top === undefined ? 10 : Number(values.top);
	if (!Number.isInteger(top) || top < 1)
		throw new Error(`--top takes a positive whole number.\n${USAGE}`);
	requireKnownArea(values.area, measuredAreas(paths, settings));
	const report = measureBloat(root, settings, values.area, paths);
	if (values['measures-out'] !== undefined) {
		if (!values['measures-out'].trim()) {
			throw new Error(`--measures-out takes a non-empty file path.\n${USAGE}`);
		}
		const outPath = resolve(values['measures-out']);
		const doc = toMeasuresDocument(report, { target: values.target });
		mkdirSync(dirname(outPath), { recursive: true });
		writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
	}
	if (values.record) {
		const issue = requireTrendIssue(settings);
		run(root, 'gh', ['issue', 'comment', String(issue), '--body', recordBody(report)]);
	}
	return formatBloat(report, settings, top);
}

if (
	process.argv[1] &&
	realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
	try {
		console.log(main(process.argv.slice(2)));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}

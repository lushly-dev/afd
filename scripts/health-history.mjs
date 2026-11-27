#!/usr/bin/env node
/**
 * The dated Health history (#1387 step 8, #2829): runs every measures producer on the checked-out
 * commit, audits the repository with Health and their measures files, and commits the report,
 * named by its UTC date, to a branch of its own. `main` carries none of it.
 *
 *   node scripts/health-history.mjs run --work <dir> [--coverage <dir>] [--base <rev>]
 *       Writes <dir>/measures/<producer>.json and <dir>/report/health-report.json. Every
 *       producer runs; when any fails or writes no measure, the command names each such one,
 *       exits 1 and audits nothing, so no partial report is ever written. The report is then
 *       validated against Health's report-1.3.json.
 *   node scripts/health-history.mjs publish --report <file> [--day <YYYY-MM-DD>]
 *                                           [--source <text>] [--branch <b>] [--remote <r>]
 *                                           [--keep-days <n>]
 *       Commits the report as reports/<day>.json (default: the date of its generated_at) on top
 *       of the branch's current head, replacing a report of the same day and removing reports
 *       older than the retention, then pushes with a lease on the head it read. Nothing is
 *       forced. It needs only Node and git, so the workflow runs it from a sparse checkout.
 *
 * `.github/workflows/health-history.yml` runs both daily. Health keeps its contract: it reads
 * the files and runs no producer; the producers run here. Exit: 0 done, 1 a producer or the
 * audit failed, 2 usage or a git failure.
 */

import { spawnSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BRANCH = 'health-history';
export const KEEP_DAYS = 366;
const REPORTS_DIR = 'reports';
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const GATES = '.claude/skills/maintain-gates/scripts';
const SWEEP = '.claude/skills/sweep-bloat/scripts';

/**
 * The producers, each writing one measures file. `args(out, options)` gives the command; a
 * producer whose input is missing (no coverage directory) fails rather than being left out.
 */
export const PRODUCERS = [
	{
		name: 'bloat',
		command: 'node',
		args: (out) => [`${SWEEP}/sweep.mjs`, 'bloat', '--measures-out', out],
	},
	{
		name: 'cognitive-complexity',
		command: 'node',
		args: (out) => [`${SWEEP}/cognitive-complexity.mjs`, '--measures-out', out],
	},
	{
		name: 'test-counts',
		command: 'node',
		args: (out) => [`${GATES}/report-test-counts.mjs`, '--measures-out', out],
	},
	{
		name: 'test-changes',
		command: 'node',
		args: (out, { base }) => [
			`${GATES}/report-test-changes.mjs`,
			'--base',
			base,
			'--measures-out',
			out,
		],
	},
	{
		name: 'coverage',
		command: 'node',
		args: (out, { coverage }) => [
			`${GATES}/report-coverage-measures.mjs`,
			'--root',
			coverage,
			'--scan',
			'--measures-out',
			out,
		],
		needs: 'coverage',
	},
	{
		name: 'alfred',
		command: 'uv',
		args: (out) => [
			'run',
			'--frozen',
			'--project',
			'alfred',
			'alfred',
			'--workspace',
			ROOT,
			'measures',
			'--out',
			out,
		],
	},
];

/** reports/<date>.json for a UTC day or timestamp (its first ten characters). */
export function reportPath(when) {
	const day = typeof when === 'string' ? when.slice(0, 10) : '';
	if (!DATE.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) {
		throw new Error(`Not a UTC day or timestamp: ${JSON.stringify(when)}`);
	}
	return `${REPORTS_DIR}/${day}.json`;
}

/** Why a producer's measures file cannot be used, or null: it must hold at least one measure. */
export function measuresProblem(file) {
	let document;
	try {
		document = JSON.parse(readFileSync(file, 'utf8'));
	} catch (error) {
		return `its file is not JSON (${error.message})`;
	}
	if (document?.schema_version !== '1.0') return 'its file is not a 1.0 measures file';
	if (!Array.isArray(document.measures) || document.measures.length === 0) {
		return 'it wrote no measures';
	}
	return null;
}

/**
 * Validates a report against Health's report-1.3.json with the Ajv the dashboard builds its
 * validator with. Returns the errors, empty when it is valid.
 */
export function schemaErrors(report, root = ROOT) {
	const require = createRequire(path.join(root, 'endpoints/health-dashboard/package.json'));
	const Ajv2020 = require('ajv/dist/2020').default;
	const schema = JSON.parse(
		readFileSync(
			path.join(root, 'endpoints/health/src/lushly_health/schemas/report-1.3.json'),
			'utf8'
		)
	);
	const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
	return validate(report)
		? []
		: validate.errors.map((error) => `${error.instancePath || '/'} ${error.message}`);
}

/**
 * The report paths to remove: those dated keepDays or more days before `day`. A file under
 * reports/ whose name is not a date is kept, and named, so nothing is removed by a guess.
 */
export function expired(paths, day, keepDays = KEEP_DAYS) {
	if (!Number.isInteger(keepDays) || keepDays < 1)
		throw new Error(`--keep-days must be a positive whole number`);
	const today = Date.parse(`${day}T00:00:00Z`);
	const old = [];
	const unknown = [];
	for (const file of paths) {
		const name = path.posix.basename(file, '.json');
		if (!file.startsWith(`${REPORTS_DIR}/`) || !file.endsWith('.json') || !DATE.test(name)) {
			unknown.push(file);
			continue;
		}
		if ((today - Date.parse(`${name}T00:00:00Z`)) / DAY_MS >= keepDays) old.push(file);
	}
	return { old, unknown };
}

function git(args, { cwd = ROOT, env, input, allowFailure = false } = {}) {
	const result = spawnSync('git', args, {
		cwd,
		env: env ? { ...process.env, ...env } : process.env,
		input,
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
	});
	if (result.status !== 0 && !allowFailure) {
		throw new GitError(
			`git ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`
		);
	}
	return result.status === 0 ? result.stdout.trim() : null;
}

class GitError extends Error {}

const README = `# Health history

Written by \`.github/workflows/health-history.yml\` (\`scripts/health-history.mjs\` on \`main\`),
once a day: \`reports/<YYYY-MM-DD>.json\` is the Health report (schema 1.3) of \`main\` as it stood
when CI's daily run on \`main\` finished, filed under the UTC day that run started, with the
measures of every producer and that run's coverage. Each commit names the commit measured, the
run and the commit the run tested. A second run for the same day replaces its file.

Retention: reports dated ${KEEP_DAYS} days or more before the newest are removed from the tree;
the branch's history keeps them. Nothing else writes this branch, and it is never merged.

Load several in the Health dashboard to compare them.
`;

/**
 * Commits the report to the branch and pushes it. Returns { path, commit, removed, unknown,
 * unchanged }. `day` names the file (default: the report's generated_at); `source` goes in the
 * commit message. `remote` may be a remote name or a path. `head` stands in for the branch head
 * read from the remote, for tests of a lost lease.
 */
export function publish({
	report,
	day: when,
	source,
	branch = BRANCH,
	remote = 'origin',
	keepDays = KEEP_DAYS,
	cwd = ROOT,
	env = {},
	head,
}) {
	const text = readFileSync(report, 'utf8');
	const parsed = JSON.parse(text);
	if (parsed.schema_version !== '1.3') {
		throw new Error(
			`The report's schema_version is ${JSON.stringify(parsed.schema_version)}, not "1.3"`
		);
	}
	if (!Array.isArray(parsed.measures) || parsed.measures.length === 0) {
		throw new Error('The report carries no measures');
	}
	const target = reportPath(when || parsed.generated_at);
	const day = path.posix.basename(target, '.json');

	const listed =
		head === undefined
			? git(['ls-remote', '--heads', remote, `refs/heads/${branch}`], { cwd })
			: head;
	const old = listed ? listed.split(/\s+/)[0] : null;
	if (old) git(['fetch', '--no-tags', '--quiet', remote, `refs/heads/${branch}`], { cwd });

	const scratch = mkdtempSync(path.join(tmpdir(), 'health-history-'));
	try {
		const indexEnv = { ...env, GIT_INDEX_FILE: path.join(scratch, 'index') };
		git(old ? ['read-tree', old] : ['read-tree', '--empty'], { cwd, env: indexEnv });
		const present = (git(['ls-files', '--', REPORTS_DIR], { cwd, env: indexEnv }) || '')
			.split('\n')
			.filter(Boolean);
		const { old: removed, unknown } = expired(present, day, keepDays);
		for (const file of removed)
			git(['update-index', '--force-remove', '--', file], { cwd, env: indexEnv });
		const add = (file, content) => {
			const blob = git(['hash-object', '-w', '--stdin'], { cwd, input: content });
			git(['update-index', '--add', '--cacheinfo', `100644,${blob},${file}`], {
				cwd,
				env: indexEnv,
			});
		};
		add(target, text);
		add('README.md', README);
		const tree = git(['write-tree'], { cwd, env: indexEnv });
		if (old && tree === git(['rev-parse', `${old}^{tree}`], { cwd })) {
			return { path: target, commit: old, removed, unknown, unchanged: true };
		}
		const subject = `health: the report of ${day}${removed.length ? `, ${removed.length} past retention removed` : ''}`;
		const message = source ? ['-m', subject, '-m', `Measured: ${source}.`] : ['-m', subject];
		const commit = git(['commit-tree', tree, ...(old ? ['-p', old] : []), ...message], {
			cwd,
			env,
		});
		git(
			[
				'push',
				'--quiet',
				`--force-with-lease=refs/heads/${branch}:${old ?? ''}`,
				remote,
				`${commit}:refs/heads/${branch}`,
			],
			{
				cwd,
				env,
			}
		);
		return { path: target, commit, removed, unknown, unchanged: false };
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}

/** Runs every producer; returns the measures files written and the producers that failed. */
export function runProducers({ out, coverage, base, producers = PRODUCERS, cwd = ROOT }) {
	mkdirSync(out, { recursive: true });
	const files = [];
	const failed = [];
	for (const producer of producers) {
		const file = path.join(out, `${producer.name}.json`);
		// A file left by an earlier run must not pass for this one's.
		rmSync(file, { force: true });
		if (
			producer.needs === 'coverage' &&
			!(coverage && existsSync(coverage) && statSync(coverage).isDirectory())
		) {
			failed.push({
				name: producer.name,
				reason: `no coverage directory (${coverage ?? 'none given'})`,
			});
			continue;
		}
		const started = Date.now();
		const before = failed.length;
		const result = spawnSync(producer.command, producer.args(file, { coverage, base }), {
			cwd,
			encoding: 'utf8',
			maxBuffer: 64 * 1024 * 1024,
		});
		const seconds = ((Date.now() - started) / 1000).toFixed(1);
		const problem =
			result.status === 0 && existsSync(file) ? measuresProblem(file) : 'it wrote no file';
		if (result.status !== 0) {
			const detail = (result.stderr || result.stdout || result.error?.message || '')
				.trim()
				.split('\n')
				.slice(-5)
				.join(' | ');
			failed.push({
				name: producer.name,
				reason: `exit ${result.status ?? result.signal ?? 'none'}: ${detail}`,
			});
		} else if (problem) {
			failed.push({ name: producer.name, reason: problem });
		} else {
			files.push(file);
		}
		console.error(
			`[health-history] ${producer.name}: ${failed.length > before ? 'failed' : 'ok'} (${seconds}s)`
		);
	}
	return { files, failed };
}

/** The first-parent commit of HEAD as it stood 24 hours ago, or HEAD's parent. */
export function dayBefore(cwd = ROOT) {
	return (
		git(['rev-list', '-1', '--first-parent', '--before=24 hours ago', 'HEAD'], {
			cwd,
			allowFailure: true,
		}) || git(['rev-parse', 'HEAD^'], { cwd })
	);
}

function audit({ work, files }) {
	const reportDir = path.join(work, 'report');
	if (existsSync(reportDir) && readdirSync(reportDir).length) {
		throw new Error(`${reportDir} is not empty; Health never overwrites a report`);
	}
	mkdirSync(reportDir, { recursive: true });
	const args = [
		'run',
		'--frozen',
		'--project',
		'endpoints/health',
		'python',
		'-m',
		'lushly_health',
		'audit',
		'--targets',
		'scripts/health-history/targets.toml',
		'--policy',
		'scripts/health-history/policy.toml',
		...files.flatMap((file) => ['--measures', file]),
		'--output-dir',
		reportDir,
	];
	const result = spawnSync('uv', args, { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
	const report = path.join(reportDir, 'health-report.json');
	if (result.status !== 0 || !existsSync(report))
		throw new Error(`Health's audit failed (exit ${result.status})`);
	return report;
}

/** Whether `candidate` is `root` or under it (another drive, on Windows, is outside). */
export function inside(root, candidate, paths = path) {
	const relative = paths.relative(root, candidate);
	const up = relative === '..' || relative.startsWith(`..${paths.sep}`);
	return !up && !paths.isAbsolute(relative);
}

function options(argv) {
	const values = {};
	for (let i = 0; i < argv.length; i += 2) {
		const flag = argv[i];
		if (!flag.startsWith('--') || i + 1 >= argv.length)
			throw new UsageError(`Unexpected argument ${flag}`);
		values[flag.slice(2)] = argv[i + 1];
	}
	return values;
}

class UsageError extends Error {}

function main(argv) {
	const [command, ...rest] = argv;
	const values = options(rest);
	if (command === 'run') {
		const allowed = new Set(['work', 'coverage', 'base']);
		for (const key of Object.keys(values))
			if (!allowed.has(key)) throw new UsageError(`Unknown option --${key}`);
		if (!values.work) throw new UsageError('run needs --work <dir>');
		const work = path.resolve(values.work);
		if (inside(ROOT, work)) {
			throw new UsageError(
				'--work must be outside the repository: Health writes nowhere inside what it audits'
			);
		}
		const base = values.base ?? dayBefore();
		const { files, failed } = runProducers({
			out: path.join(work, 'measures'),
			coverage: values.coverage && path.resolve(values.coverage),
			base,
		});
		if (failed.length) {
			for (const { name, reason } of failed)
				console.error(`[health-history] producer ${name} failed: ${reason}`);
			console.error(
				`[health-history] ${failed.length} of ${PRODUCERS.length} producers failed; no report was written`
			);
			return 1;
		}
		const report = audit({ work, files });
		const errors = schemaErrors(JSON.parse(readFileSync(report, 'utf8')));
		if (errors.length) {
			for (const error of errors.slice(0, 20)) console.error(`[health-history] ${error}`);
			console.error(`[health-history] the report does not validate against report-1.3.json`);
			rmSync(report, { force: true });
			return 1;
		}
		console.log(report);
		return 0;
	}
	if (command === 'publish') {
		const allowed = new Set(['report', 'day', 'source', 'branch', 'remote', 'keep-days']);
		for (const key of Object.keys(values))
			if (!allowed.has(key)) throw new UsageError(`Unknown option --${key}`);
		if (!values.report) throw new UsageError('publish needs --report <file>');
		const result = publish({
			report: path.resolve(values.report),
			day: values.day,
			source: values.source,
			branch: values.branch ?? BRANCH,
			remote: values.remote ?? 'origin',
			keepDays: values['keep-days'] === undefined ? KEEP_DAYS : Number(values['keep-days']),
		});
		console.log(JSON.stringify(result, null, 2));
		for (const file of result.unknown)
			console.error(`[health-history] kept ${file}: its name is not a date`);
		return 0;
	}
	throw new UsageError(`Unknown command ${command ?? '(none)'}; use run or publish`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		process.exitCode = main(process.argv.slice(2));
	} catch (error) {
		console.error(`[health-history] ${error.message}`);
		process.exitCode = error instanceof UsageError || error instanceof GitError ? 2 : 1;
	}
}

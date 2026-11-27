import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	expired,
	inside,
	measuresProblem,
	publish,
	reportPath,
	runProducers,
	schemaErrors,
} from './health-history.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IDENTITY = {
	GIT_AUTHOR_NAME: 'History Test',
	GIT_AUTHOR_EMAIL: 'history@example.invalid',
	GIT_COMMITTER_NAME: 'History Test',
	GIT_COMMITTER_EMAIL: 'history@example.invalid',
};
const MEASURE = { key: 'files', label: 'Files', value: 1, unit: 'files', direction: 'neutral' };

function git(cwd, ...args) {
	const result = spawnSync('git', args, {
		cwd,
		encoding: 'utf8',
		env: { ...process.env, ...IDENTITY },
	});
	assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
	return result.stdout.trim();
}

function scratch(t) {
	const dir = mkdtempSync(path.join(tmpdir(), 'health-history-test-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

/** A bare remote and a clone with one commit on main, as the job's checkout is. */
function repositories(t) {
	const dir = scratch(t);
	const remote = path.join(dir, 'remote.git');
	const work = path.join(dir, 'work');
	git(dir, 'init', '--quiet', '--bare', remote);
	git(dir, 'init', '--quiet', '-b', 'main', work);
	writeFileSync(path.join(work, 'README.md'), 'main\n');
	git(work, 'add', 'README.md');
	git(work, 'commit', '--quiet', '-m', 'main');
	git(work, 'remote', 'add', 'origin', remote);
	git(work, 'push', '--quiet', 'origin', 'main');
	return { dir, remote, work };
}

let reports = 0;
function report(dir, generatedAt, extra = {}) {
	reports += 1;
	const file = path.join(dir, `report-${reports}.json`);
	const body = { schema_version: '1.3', generated_at: generatedAt, measures: [MEASURE], ...extra };
	writeFileSync(file, `${JSON.stringify(body)}\n`);
	return file;
}

function tree(work, ref) {
	git(work, 'fetch', '--quiet', 'origin', ref);
	return git(work, 'ls-tree', '-r', '--name-only', 'FETCH_HEAD').split('\n');
}

const headOf = (work) =>
	git(work, 'ls-remote', 'origin', 'refs/heads/health-history').split(/\s+/)[0];

/** A fake producer that writes `document` (or nothing) and exits with `code`. */
function producer(name, { document, code = 0, needs } = {}) {
	const write =
		document === undefined
			? ''
			: `require('node:fs').writeFileSync(process.argv[1], ${JSON.stringify(JSON.stringify(document))});`;
	return {
		name,
		needs,
		command: process.execPath,
		args: (file) => ['-e', `${write} process.exit(${code})`, file],
	};
}
const GOOD = { schema_version: '1.0', measures: [MEASURE] };

test('a report is named by a UTC day or by the day of a timestamp', () => {
	assert.equal(reportPath('2026-11-27T17:59:02Z'), 'reports/2026-11-27.json');
	assert.equal(reportPath('2026-11-26'), 'reports/2026-11-26.json');
	assert.throws(() => reportPath('27 Nov 2026'), /Not a UTC day/);
	assert.throws(() => reportPath(undefined), /Not a UTC day/);
});

test('retention removes reports keepDays or more old and keeps what is not a dated report', () => {
	const { old, unknown } = expired(
		[
			'reports/2025-11-26.json',
			'reports/2025-11-27.json',
			'reports/2026-11-26.json',
			'reports/notes.json',
		],
		'2026-11-27',
		366
	);
	assert.deepEqual(old, ['reports/2025-11-26.json']);
	assert.deepEqual(unknown, ['reports/notes.json']);
	assert.deepEqual(expired(['reports/2026-11-26.json'], '2026-11-27', 1).old, [
		'reports/2026-11-26.json',
	]);
	assert.throws(() => expired([], '2026-11-27', 0), /positive whole number/);
});

test('the work folder must be outside the repository', () => {
	const root = path.resolve('repo');
	assert.equal(inside(root, path.join(root, 'tmp')), true);
	assert.equal(inside(root, root), true);
	assert.equal(inside(root, path.join(root, '..history')), true, 'a name starting with ..');
	assert.equal(inside(root, path.resolve('elsewhere')), false);
	assert.equal(inside(root, path.dirname(root)), false);
	const win = path.win32;
	assert.equal(inside(win.join('D:', 'repo'), win.join('C:', 'temp'), win), false);
	assert.equal(inside(win.join('D:', 'repo'), win.join('D:', 'repo', 'tmp'), win), true);
});

test('publish starts the branch, replaces a same-day report and keeps main untouched', (t) => {
	const { dir, work } = repositories(t);
	const main = git(work, 'rev-parse', 'HEAD');

	const first = publish({
		report: report(dir, '2026-11-27T09:00:00Z'),
		remote: 'origin',
		cwd: work,
		env: IDENTITY,
	});
	assert.equal(first.unchanged, false);
	assert.deepEqual(tree(work, 'health-history'), ['README.md', 'reports/2026-11-27.json']);
	assert.equal(git(work, 'rev-list', '--count', 'FETCH_HEAD'), '1');

	const again = publish({
		report: report(dir, '2026-11-27T18:00:00Z', { note: 'later' }),
		remote: 'origin',
		cwd: work,
		env: IDENTITY,
	});
	assert.deepEqual(tree(work, 'health-history'), ['README.md', 'reports/2026-11-27.json']);
	assert.match(git(work, 'show', 'FETCH_HEAD:reports/2026-11-27.json'), /later/);
	assert.equal(git(work, 'rev-parse', 'FETCH_HEAD^'), first.commit, 'builds on the first');
	assert.equal(again.removed.length, 0);

	assert.equal(git(work, 'ls-remote', 'origin', 'refs/heads/main').split(/\s+/)[0], main);
	assert.equal(git(work, 'rev-parse', 'HEAD'), main, 'the checkout is not moved');
	assert.equal(git(work, 'status', '--porcelain'), '');
});

test("publish files the report under the CI run's day and names its source", (t) => {
	const { dir, work } = repositories(t);
	publish({
		report: report(dir, '2026-11-28T00:20:00Z'),
		day: '2026-11-27',
		source: 'main at abc123, CI run 42',
		remote: 'origin',
		cwd: work,
		env: IDENTITY,
	});
	assert.deepEqual(tree(work, 'health-history'), ['README.md', 'reports/2026-11-27.json']);
	assert.match(
		git(work, 'log', '-1', '--format=%B', 'FETCH_HEAD'),
		/Measured: main at abc123, CI run 42\./
	);
});

test('publish removes reports past retention and reports an identical rerun as unchanged', (t) => {
	const { dir, work } = repositories(t);
	for (const day of ['2026-11-01', '2026-11-20']) {
		publish({
			report: report(dir, `${day}T09:00:00Z`),
			remote: 'origin',
			cwd: work,
			env: IDENTITY,
		});
	}
	const latest = report(dir, '2026-11-27T09:00:00Z');
	const result = publish({
		report: latest,
		remote: 'origin',
		keepDays: 10,
		cwd: work,
		env: IDENTITY,
	});
	assert.deepEqual(result.removed, ['reports/2026-11-01.json']);
	assert.deepEqual(tree(work, 'health-history'), [
		'README.md',
		'reports/2026-11-20.json',
		'reports/2026-11-27.json',
	]);

	const head = headOf(work);
	const rerun = publish({
		report: latest,
		remote: 'origin',
		keepDays: 10,
		cwd: work,
		env: IDENTITY,
	});
	assert.equal(rerun.unchanged, true);
	assert.equal(headOf(work), head);
});

test('publish loses its lease, and changes nothing, when the branch moved after it read it', (t) => {
	const { dir, work } = repositories(t);
	const first = publish({
		report: report(dir, '2026-11-26T09:00:00Z'),
		remote: 'origin',
		cwd: work,
		env: IDENTITY,
	});
	publish({
		report: report(dir, '2026-11-27T09:00:00Z'),
		remote: 'origin',
		cwd: work,
		env: IDENTITY,
	});
	const moved = headOf(work);
	assert.throws(
		() =>
			publish({
				report: report(dir, '2026-11-28T09:00:00Z'),
				remote: 'origin',
				cwd: work,
				env: IDENTITY,
				head: first.commit,
			}),
		/git push .* failed/
	);
	assert.equal(headOf(work), moved);
});

test('publish refuses a report of another schema or without measures, and pushes nothing', (t) => {
	const { dir, work } = repositories(t);
	const old = path.join(dir, 'old.json');
	writeFileSync(
		old,
		JSON.stringify({ schema_version: '1.2', generated_at: '2026-11-27T09:00:00Z' })
	);
	assert.throws(
		() => publish({ report: old, remote: 'origin', cwd: work, env: IDENTITY }),
		/not "1.3"/
	);
	const empty = report(dir, '2026-11-27T09:00:00Z', { measures: [] });
	assert.throws(
		() => publish({ report: empty, remote: 'origin', cwd: work, env: IDENTITY }),
		/no measures/
	);
	assert.equal(git(work, 'ls-remote', 'origin', 'refs/heads/health-history'), '');
});

test('the report is checked against Health 1.3, as the dashboard checks it', () => {
	const fixture = JSON.parse(
		readFileSync(
			path.join(ROOT, 'endpoints/health-dashboard/fixtures/reports/with-measures.report.json'),
			'utf8'
		)
	);
	assert.deepEqual(schemaErrors(fixture), []);
	const broken = structuredClone(fixture);
	delete broken.verdict;
	broken.measures[0].direction = 'sideways';
	const errors = schemaErrors(broken);
	assert.ok(
		errors.some((error) => /verdict/.test(error)),
		errors.join('\n')
	);
	assert.ok(
		errors.some((error) => /direction/.test(error)),
		errors.join('\n')
	);
});

test('a measures file must be a 1.0 file with at least one measure', (t) => {
	const dir = scratch(t);
	const file = path.join(dir, 'm.json');
	const problem = (text) => {
		writeFileSync(file, text);
		return measuresProblem(file);
	};
	assert.equal(problem(JSON.stringify(GOOD)), null);
	assert.match(problem('{'), /not JSON/);
	assert.match(problem('{}'), /not a 1.0 measures file/);
	assert.match(problem(JSON.stringify({ schema_version: '1.0', measures: [] })), /no measures/);
});

test('a failing or empty producer is named, the others still run, and no file passes', (t) => {
	const dir = scratch(t);
	const { files, failed } = runProducers({
		out: path.join(dir, 'measures'),
		producers: [
			producer('first', { document: GOOD }),
			producer('broken', { code: 3 }),
			producer('silent'),
			producer('empty', { document: { schema_version: '1.0', measures: [] } }),
			producer('halfway', { document: GOOD, code: 1 }),
			producer('coverage', { document: GOOD, needs: 'coverage' }),
			producer('last', { document: GOOD }),
		],
		coverage: path.join(dir, 'missing'),
		cwd: dir,
	});
	assert.deepEqual(
		files.map((file) => path.basename(file)),
		['first.json', 'last.json']
	);
	assert.deepEqual(
		failed.map(({ name }) => name),
		['broken', 'silent', 'empty', 'halfway', 'coverage']
	);
	const reason = Object.fromEntries(failed.map(({ name, reason }) => [name, reason]));
	assert.match(reason.broken, /^exit 3/);
	assert.match(reason.silent, /wrote no file/);
	assert.match(reason.empty, /wrote no measures/);
	assert.match(reason.halfway, /^exit 1/);
	assert.match(reason.coverage, /no coverage directory/);

	mkdirSync(path.join(dir, 'coverage'));
	const withCoverage = runProducers({
		out: path.join(dir, 'measures'),
		producers: [producer('coverage', { document: GOOD, needs: 'coverage' })],
		coverage: path.join(dir, 'coverage'),
		cwd: dir,
	});
	assert.equal(withCoverage.failed.length, 0);
});

test("a producer that writes nothing fails even when an earlier run's file is there", (t) => {
	const dir = scratch(t);
	const out = path.join(dir, 'measures');
	assert.equal(
		runProducers({ out, producers: [producer('bloat', { document: GOOD })], cwd: dir }).failed
			.length,
		0
	);
	const { files, failed } = runProducers({ out, producers: [producer('bloat')], cwd: dir });
	assert.deepEqual(files, []);
	assert.deepEqual(
		failed.map(({ name }) => name),
		['bloat']
	);
});

test('only the publish job can write, and it runs nothing but the publish script', () => {
	const workflow = readFileSync(path.join(ROOT, '.github/workflows/health-history.yml'), 'utf8');
	const measure = workflow.slice(
		workflow.indexOf('\n  measure:'),
		workflow.indexOf('\n  publish:')
	);
	const publishJob = workflow.slice(workflow.indexOf('\n  publish:'));
	assert.ok(measure.length > 0 && publishJob.length > 0, 'both jobs are there');
	assert.match(
		workflow.slice(0, workflow.indexOf('\njobs:')),
		/\npermissions:\n {2}contents: read\n/
	);
	assert.doesNotMatch(measure, /: write/, 'measure holds no write permission');
	assert.match(measure, /persist-credentials: false/);
	// It runs a commit chosen at run time in the default branch's cache scope: no cache at all.
	assert.doesNotMatch(
		measure,
		/setup-node-pnpm|actions\/cache@|enable-cache: true|\n\s+cache: |rust-cache/
	);
	assert.match(measure, /enable-cache: false/);
	assert.match(measure, /package-manager-cache: false/);
	assert.equal(workflow.match(/: write/g)?.length, 1, 'one write permission in the workflow');
	assert.match(publishJob, /\n {6}contents: write\n/);
	assert.match(
		publishJob,
		/sparse-checkout: \|\n {12}\.nvmrc\n {12}scripts\/health-history\.mjs\n/
	);
	const runs = [...publishJob.matchAll(/\n {8}run: (.*)/g)].map((match) => match[1]);
	assert.deepEqual(runs, ['>-'], 'one run step');
	assert.match(publishJob, /node scripts\/health-history\.mjs publish /);
	assert.doesNotMatch(publishJob, /pnpm|uv |GH_TOKEN|github\.token/);
	// A checkout of a commit chosen at run time would poison the default branch's caches.
	assert.equal(workflow.match(/actions\/checkout@/g)?.length, 2, 'two checkouts');
	assert.doesNotMatch(workflow, /\n\s+ref: /, 'each checks out the workflow commit');
	assert.match(
		workflow,
		/github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/
	);
});

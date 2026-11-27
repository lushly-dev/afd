import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

/** Fixture folders, removed once this file's tests finish so no git fixture outlives the run. */
const temps = [];
after(() => {
	for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});
function tempDir(prefix) {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	temps.push(dir);
	return dir;
}

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'check-doc-lines.mjs');
const POLICY = 'scripts/policy/doc-line-limits.json';
const DOC = 'docs/STATUS.md';

/** A fixture repository: `files` by path, and the policy unless a file replaces it. */
function fixture(policy, files) {
	const root = tempDir('afd-doc-lines-');
	const all = { [POLICY]: JSON.stringify(policy), ...files };
	for (const [path, text] of Object.entries(all)) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), text);
	}
	return root;
}

/** The environment without a hook's `GIT_*` variables, which would point git at this repository. */
const clean = Object.fromEntries(
	Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))
);

/** Runs the check in `root`. CI is unset unless a test sets it: a fixture is no git repository. */
const run = (root, env = {}) =>
	spawnSync(process.execPath, [script], {
		cwd: root,
		encoding: 'utf8',
		env: { ...clean, CI: '', AFD_BASE: '', ...env },
		timeout: 15_000,
	});

/** Git in a fixture: no hooks, no signing, nothing inherited from the caller's repository. */
const git = (root, ...args) =>
	execFileSync(
		'git',
		[
			'-c',
			'user.name=t',
			'-c',
			'user.email=t@example.invalid',
			'-c',
			'commit.gpgsign=false',
			'-c',
			'core.hooksPath=/dev/null',
			...args,
		],
		{
			cwd: root,
			env: clean,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
			timeout: 15_000,
		}
	).trim();

/** Commits the fixture as `main`, so the working tree is compared with it as its merge base. */
function commit(root) {
	git(root, 'init', '-q', '-b', 'main');
	git(root, 'add', '-A');
	git(root, 'commit', '-q', '-m', 'base');
	return root;
}
const write = (root, path, text) => writeFileSync(join(root, path), text);
const save = (root, policy) => write(root, POLICY, JSON.stringify(policy));

const policy = ({ grandfathered = [], capped = [], limit = 50, files = [DOC] } = {}) => ({
	limit,
	files,
	capped,
	grandfathered,
});
/** A table row of exactly `length` characters; `fill` varies its text at the same length. */
const row = (key, length, fill = 'x') => `| ${key} | ${fill.repeat(length - key.length - 7)} |`;
const sha256 = (line) => createHash('sha256').update(line, 'utf8').digest('hex');
/** The grandfathered entry for `row(key, length)`. */
const exempt = (key, length, line = row(key, length)) => ({
	file: DOC,
	startsWith: `| ${key} |`,
	length,
	sha256: sha256(line),
	reason: 'Written before the limit',
});
const cap = (key, max) => ({
	file: DOC,
	startsWith: `| ${key} |`,
	max,
	reason: 'A summary row',
});

test('a document whose lines are within the limit passes and says what it checked', () => {
	const root = fixture(policy(), { [DOC]: `# Status\n\n${row('Step 1', 50)}\n` });
	const result = run(root);
	assert.equal(result.status, 0, result.stderr);
	assert.match(
		result.stdout,
		/1 documents, no line over 50 characters \(0 capped lower, 0 grandfathered\)/
	);
});

test('a line over the limit fails, named by file and line', () => {
	const root = fixture(policy(), {
		[DOC]: `# Status\n\n${row('Step 1', 50)}\n${row('Decision log', 51)}\n`,
	});
	const result = run(root);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /docs\/STATUS\.md:4: 51 characters, over the limit of 50/);
	assert.match(
		result.stderr,
		/give the new entry its own line, and put a record that needs more room in the specification/
	);
	assert.doesNotMatch(result.stderr, /STATUS\.md:3/);
});

test('a prose line counts as a table row does, and CRLF endings are not counted', () => {
	const sentence = `Steps ${'0a, '.repeat(12)}done`;
	const root = fixture(policy(), {
		[DOC]: `# Status\r\n\r\n${row('Step 1', 50)}\r\n${sentence}\r\n`,
	});
	const result = run(root);
	assert.equal(result.status, 1);
	assert.match(result.stderr, new RegExp(`STATUS\\.md:4: ${sentence.length} characters`));
	assert.doesNotMatch(result.stderr, /STATUS\.md:3/);
});

test('length counts characters, not UTF-16 units', () => {
	const line = `| Step | ${'🙂'.repeat(40)} |`;
	assert.equal([...line].length, 51);
	const root = fixture(policy(), { [DOC]: `${line.replace('🙂', '')}\n${line}\n` });
	const result = run(root);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /STATUS\.md:2: 51 characters, over the limit of 50/);
	assert.doesNotMatch(result.stderr, /STATUS\.md:1/);
});

test('a capped summary line fails over its cap, well inside the limit', () => {
	// Loam's phase 6 row listed every merged step at 1,357 characters, under a limit of 2,000.
	const capped = [cap('6. Hosts', 30)];
	const within = run(fixture(policy({ capped }), { [DOC]: `${row('6. Hosts', 30)}\n` }));
	assert.equal(within.status, 0, within.stderr);
	assert.match(within.stdout, /\(1 capped lower, 0 grandfathered\)/);

	const regrown = run(fixture(policy({ capped }), { [DOC]: `${row('6. Hosts', 31)}\n` }));
	assert.equal(regrown.status, 1);
	assert.match(regrown.stderr, /STATUS\.md:1: 31 characters, over this line's cap of 30/);
});

test('a cap must sit below the limit and name one line that exists', () => {
	const pointless = run(
		fixture(policy({ capped: [cap('6. Hosts', 50)] }), { [DOC]: `${row('6. Hosts', 30)}\n` })
	);
	assert.equal(pointless.status, 1);
	assert.match(pointless.stderr, /its "max" of 50 is not below the limit of 50/);

	const gone = run(
		fixture(policy({ capped: [cap('6. Hosts', 30)] }), { [DOC]: `${row('Step 1', 30)}\n` })
	);
	assert.equal(gone.status, 1);
	assert.match(gone.stderr, /no line starts with "\| 6\. Hosts \|"; delete its capped entry/);
});

test('a grandfathered line passes while it stays exactly as recorded', () => {
	const root = fixture(policy({ grandfathered: [exempt('Old step', 80)] }), {
		[DOC]: `# Status\n\n${row('Old step', 80)}\n`,
	});
	const result = run(root);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /1 grandfathered\)/);
});

test('a grandfathered line that grew fails', () => {
	const root = fixture(policy({ grandfathered: [exempt('Old step', 80)] }), {
		[DOC]: `# Status\n\n${row('Old step', 81)}\n`,
	});
	const result = run(root);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /STATUS\.md:3: a grandfathered line grew from 80 to 81 characters/);
});

test('a different line of the same prefix and length does not inherit the exemption', () => {
	const root = fixture(policy({ grandfathered: [exempt('Old step', 80)] }), {
		[DOC]: `${row('Old step', 80, 'y')}\n`,
	});
	const result = run(root);
	assert.equal(result.status, 1);
	assert.match(
		result.stderr,
		/STATUS\.md:1: a grandfathered line was rewritten at the same length/
	);
});

test('a grandfathered line that shrank fails until its record follows it', () => {
	const shorter = row('Old step', 70);
	const root = fixture(policy({ grandfathered: [exempt('Old step', 80)] }), {
		[DOC]: `# Status\n\n${shorter}\n`,
	});
	const result = run(root);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /shrank from 80 to 70 characters/);
	assert.match(
		result.stderr,
		new RegExp(`set its "length" to 70 and its "sha256" to ${sha256(shorter)}`)
	);
});

test('a grandfathered entry is stale once its line is within the limit or gone', () => {
	const within = run(
		fixture(policy({ grandfathered: [exempt('Old step', 80)] }), {
			[DOC]: `# Status\n\n${row('Old step', 50)}\n`,
		})
	);
	assert.equal(within.status, 1);
	assert.match(
		within.stderr,
		/now 50 characters, within the limit of 50; delete its grandfathered/
	);

	const gone = run(
		fixture(policy({ grandfathered: [exempt('Old step', 80)] }), {
			[DOC]: `# Status\n\n${row('Step 1', 50)}\n`,
		})
	);
	assert.equal(gone.status, 1);
	assert.match(gone.stderr, /no line starts with "\| Old step \|"; delete its grandfathered entry/);
});

test('a policy prefix must match one line, and covers no other', () => {
	const two = run(
		fixture(policy({ grandfathered: [exempt('2026-11-17', 80)] }), {
			[DOC]: `${row('2026-11-17', 80)}\n${row('2026-11-17', 90)}\n`,
		})
	);
	assert.equal(two.status, 1);
	assert.match(two.stderr, /2 lines start with "\| 2026-11-17 \|" \(lines 1, 2\)/);

	const other = run(
		fixture(policy({ grandfathered: [exempt('Old step', 80)] }), {
			[DOC]: `${row('Old step', 80)}\n${row('New step', 80)}\n`,
		})
	);
	assert.equal(other.status, 1);
	assert.match(other.stderr, /STATUS\.md:2: 80 characters, over the limit of 50/);
	assert.doesNotMatch(other.stderr, /STATUS\.md:1/);

	const both = run(
		fixture(policy({ grandfathered: [exempt('Old step', 80)], capped: [cap('Old step', 40)] }), {
			[DOC]: `${row('Old step', 80)}\n`,
		})
	);
	assert.equal(both.status, 1);
	assert.match(both.stderr, /STATUS\.md:1: two policy entries match this line/);
});

test('a missing or empty document fails instead of passing unchecked', () => {
	const missing = run(fixture(policy(), {}));
	assert.equal(missing.status, 1);
	assert.match(missing.stderr, /docs\/STATUS\.md: listed in .* but missing/);

	const empty = run(fixture(policy(), { [DOC]: '\n\n' }));
	assert.equal(empty.status, 1);
	assert.match(empty.stderr, /docs\/STATUS\.md: empty, so nothing was checked/);
});

test('a policy that checks nothing, or is malformed, fails', () => {
	const noPolicy = run(tempDir('afd-doc-lines-'));
	assert.equal(noPolicy.status, 1);
	assert.match(noPolicy.stderr, /the policy file is missing/);

	const noFiles = run(fixture(policy({ files: [] }), {}));
	assert.equal(noFiles.status, 1);
	assert.match(noFiles.stderr, /"files" must list at least one document/);

	const { limit: _limit, ...noLimit } = policy();
	const unlimited = run(fixture(noLimit, { [DOC]: '# Status\n' }));
	assert.equal(unlimited.status, 1);
	assert.match(unlimited.stderr, /"limit" must be a positive whole number/);

	for (const key of ['capped', 'grandfathered']) {
		const result = run(fixture({ ...policy(), [key]: {} }, { [DOC]: '# Status\n' }));
		assert.equal(result.status, 1);
		assert.match(result.stderr, new RegExp(`"${key}" must be a list`));
	}

	const doc = { [DOC]: `${row('Old step', 80)}\n` };
	const entry = exempt('Old step', 80);
	const cases = [
		[{ ...entry, file: 'docs/OTHER.md' }, /docs\/OTHER\.md is not one of "files"/],
		[{ ...entry, reason: ' ' }, /needs a "reason"/],
		[{ ...entry, length: undefined }, /needs a whole-number "length"/],
		[{ ...entry, sha256: 'abc' }, /needs the "sha256" of its line's text/],
	];
	for (const [bad, message] of cases) {
		const result = run(fixture(policy({ grandfathered: [bad] }), doc));
		assert.equal(result.status, 1);
		assert.match(result.stderr, message);
	}
});

test('against its merge base, an unchanged or tightened policy passes', () => {
	const doc = `${row('Old step', 80)}\n${row('Older step', 90)}\n${row('Summary', 30)}\n`;
	const root = commit(
		fixture(
			policy({
				grandfathered: [exempt('Old step', 80), exempt('Older step', 90)],
				capped: [cap('Summary', 40)],
			}),
			{ [DOC]: doc }
		)
	);
	assert.equal(run(root, { CI: 'true' }).status, 0, 'unchanged');

	// One line shortened below the limit and its entry deleted, the other shortened and recorded,
	// and the cap lowered.
	write(root, DOC, `${row('Old step', 50)}\n${row('Older step', 70)}\n${row('Summary', 30)}\n`);
	save(root, policy({ grandfathered: [exempt('Older step', 70)], capped: [cap('Summary', 35)] }));
	const result = run(root, { CI: 'true' });
	assert.equal(result.status, 0, result.stderr);
});

test('raising a grandfathered length to let its line grow fails', () => {
	const root = commit(
		fixture(policy({ grandfathered: [exempt('Old step', 80)] }), {
			[DOC]: `${row('Old step', 80)}\n`,
		})
	);
	write(root, DOC, `${row('Old step', 95)}\n`);
	save(root, policy({ grandfathered: [exempt('Old step', 95)] }));
	const result = run(root);
	assert.equal(result.status, 1);
	assert.match(
		result.stderr,
		/the "length" of "\| Old step \|" rose from 80 to 95 since the merge base/
	);
});

test('recording a rewrite of a grandfathered line at the same length fails', () => {
	const root = commit(
		fixture(policy({ grandfathered: [exempt('Old step', 80)] }), {
			[DOC]: `${row('Old step', 80)}\n`,
		})
	);
	const rewritten = row('Old step', 80, 'y');
	write(root, DOC, `${rewritten}\n`);
	save(root, policy({ grandfathered: [exempt('Old step', 80, rewritten)] }));
	const result = run(root);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /the "sha256" of "\| Old step \|" changed since the merge base/);
});

test('grandfathering a line that grew past the limit fails', () => {
	const root = commit(fixture(policy(), { [DOC]: `${row('Decision log', 50)}\n` }));
	write(root, DOC, `${row('Decision log', 60)}\n`);
	save(root, policy({ grandfathered: [exempt('Decision log', 60)] }));
	const result = run(root);
	assert.equal(result.status, 1);
	assert.match(
		result.stderr,
		/"\| Decision log \|" was added to "grandfathered" since the merge base/
	);
});

test('a grandfathered line whose opening words changed keeps its exemption, no longer', () => {
	const root = commit(
		fixture(policy({ grandfathered: [exempt('Old step', 80)] }), {
			[DOC]: `${row('Old step', 80)}\n`,
		})
	);
	write(root, DOC, `${row('Step 4', 78)}\n`);
	save(root, policy({ grandfathered: [exempt('Step 4', 78)] }));
	assert.equal(run(root).status, 0);

	write(root, DOC, `${row('Step 4', 85)}\n`);
	save(root, policy({ grandfathered: [exempt('Step 4', 85)] }));
	const result = run(root);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /"\| Step 4 \|" was added to "grandfathered"/);
});

test('a raised cap, or a cap dropped while its line remains, fails', () => {
	const root = commit(
		fixture(policy({ capped: [cap('Summary', 30)] }), { [DOC]: `${row('Summary', 30)}\n` })
	);
	write(root, DOC, `${row('Summary', 40)}\n`);
	save(root, policy({ capped: [cap('Summary', 40)] }));
	const raised = run(root);
	assert.equal(raised.status, 1);
	assert.match(
		raised.stderr,
		/the "max" of "\| Summary \|" rose from 30 to 40 since the merge base/
	);

	save(root, policy());
	const dropped = run(root);
	assert.equal(dropped.status, 1);
	assert.match(dropped.stderr, /the cap on "\| Summary \|" was removed .* its line is still in/);

	// The row itself removed from the document: its cap goes with it.
	write(root, DOC, `${row('Step 1', 40)}\n`);
	assert.equal(run(root).status, 0);
});

test('a raised limit or a dropped document fails; a new document brings its own long lines', () => {
	const doc = `${row('Step 1', 50)}\n`;
	const root = commit(fixture(policy(), { [DOC]: doc, 'docs/OTHER.md': doc }));

	save(root, policy({ limit: 60 }));
	const raised = run(root);
	assert.equal(raised.status, 1);
	assert.match(raised.stderr, /"limit" rose from 50 to 60 since the merge base/);

	save(root, policy({ files: ['docs/OTHER.md'] }));
	const dropped = run(root);
	assert.equal(dropped.status, 1);
	assert.match(
		dropped.stderr,
		/docs\/STATUS\.md left "files" since the merge base .* but still exists/
	);

	write(root, 'docs/OTHER.md', `${row('Legacy', 70)}\n`);
	const legacy = { ...exempt('Legacy', 70), file: 'docs/OTHER.md' };
	save(root, policy({ files: [DOC, 'docs/OTHER.md'], grandfathered: [legacy] }));
	assert.equal(run(root).status, 0);
});

test('a lowered limit may grandfather the lines it newly covers', () => {
	const root = commit(fixture(policy(), { [DOC]: `${row('Step 1', 45)}\n` }));
	save(root, policy({ grandfathered: [exempt('Step 1', 45)], limit: 40 }));
	const result = run(root);
	assert.equal(result.status, 0, result.stderr);
});

test('with no base to compare, the check notes it locally and fails under CI', () => {
	const root = fixture(policy(), { [DOC]: `${row('Step 1', 50)}\n` });
	const local = run(root);
	assert.equal(local.status, 0, local.stderr);
	assert.match(local.stdout, /note: the policy was not compared with its merge base/);

	const ci = run(root, { CI: 'true' });
	assert.equal(ci.status, 1);
	assert.match(ci.stderr, /the policy was not compared with its merge base: not a git repository/);
});

test("the repository's own policy covers the documents and summary rows it was written for", () => {
	const real = JSON.parse(readFileSync(join(here, 'policy', 'doc-line-limits.json'), 'utf8'));
	assert.ok(real.limit <= 1500, 'the limit only comes down');
	for (const file of [
		'docs/features/active/mail/STATUS.md',
		'docs/features/active/software-factory/STATUS.md',
		'docs/language-parity.md',
		'endpoints/loam/docs/STATUS.md',
		'endpoints/umbel/docs/STATUS.md',
	])
		assert.ok(real.files.includes(file), `${file} is checked`);
	// A status's archive files are checked too, so a frozen line moved there stays frozen.
	for (const dir of ['endpoints/loam/docs', 'endpoints/umbel/docs']) {
		// Its session log is one file per session, each checked without a policy entry of its own.
		assert.ok(real.directories?.includes(`${dir}/sessions`), `${dir}/sessions is checked`);
		const archives = readdirSync(join(here, '..', dir)).filter((name) =>
			/^STATUS\.archive-.*\.md$/.test(name)
		);
		assert.ok(archives.length > 0, `${dir} has archive files`);
		for (const name of archives)
			assert.ok(real.files.includes(`${dir}/${name}`), `${dir}/${name} is checked`);
		// A capped row the index keeps rewritten has its original in an archive: that copy keeps the cap.
		for (const cap of real.capped.filter((entry) => entry.file === `${dir}/STATUS.md`))
			for (const name of archives) {
				const text = readFileSync(join(here, '..', dir, name), 'utf8');
				if (!text.split('\n').some((line) => line.startsWith(cap.startsWith))) continue;
				assert.ok(
					real.capped.some(
						(entry) =>
							entry.file === `${dir}/${name}` &&
							entry.startsWith === cap.startsWith &&
							entry.max <= cap.max
					),
					`${cap.startsWith} is capped in ${dir}/${name} as in ${dir}/STATUS.md`
				);
			}
	}
	for (const start of [
		'| Updated |',
		'| [Decision log](decisions.md) |',
		'| 6. Hosts and distribution |',
	])
		assert.ok(
			real.capped.some((entry) => entry.startsWith === start),
			`${start} is capped`
		);
});

test('a renamed prefix cannot carry a rewritten line of the same length', () => {
	const root = commit(
		fixture(policy({ grandfathered: [exempt('Old step', 80)] }), {
			[DOC]: `${row('Old step', 80)}\n`,
		})
	);
	// The same text under a shorter prefix is the same exemption.
	save(root, policy({ grandfathered: [{ ...exempt('Old step', 80), startsWith: '| Old step' }] }));
	assert.equal(run(root).status, 0);

	// A rewrite at the same length, recorded under that shorter prefix, is not.
	const rewritten = row('Old step', 80, 'y');
	write(root, DOC, `${rewritten}\n`);
	save(
		root,
		policy({
			grandfathered: [{ ...exempt('Old step', 80, rewritten), startsWith: '| Old step' }],
		})
	);
	const result = run(root);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /"\| Old step" was added to "grandfathered" since the merge base/);
});

test('one removed entry is taken over once', () => {
	const root = commit(
		fixture(policy({ grandfathered: [exempt('Old step', 80)] }), {
			[DOC]: `${row('Old step', 80)}\n`,
		})
	);
	write(root, DOC, `${row('Step 4', 70)}\n${row('Step 5', 70)}\n`);
	save(root, policy({ grandfathered: [exempt('Step 4', 70), exempt('Step 5', 70)] }));
	const result = run(root);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /"\| Step 5 \|" was added to "grandfathered"/);
	assert.doesNotMatch(result.stderr, /Step 4/);
});

test('a cap goes once the limit is at or below it', () => {
	const root = commit(
		fixture(policy({ capped: [cap('Summary', 40)] }), { [DOC]: `${row('Summary', 30)}\n` })
	);
	save(root, policy({ limit: 40 }));
	const result = run(root);
	assert.equal(result.status, 0, result.stderr);
});

test('a document deleted from the repository may leave the policy', () => {
	const doc = `${row('Step 1', 50)}\n`;
	const root = commit(
		fixture(policy({ files: [DOC, 'docs/OTHER.md'] }), { [DOC]: doc, 'docs/OTHER.md': doc })
	);
	rmSync(join(root, 'docs/OTHER.md'));
	save(root, policy());
	const result = run(root);
	assert.equal(result.status, 0, result.stderr);
});

test('a policy new on the branch has nothing to be compared with, and passes under CI', () => {
	const doc = `${row('Old step', 80)}\n`;
	const root = commit(fixture(policy(), { [DOC]: `${row('Step 1', 50)}\n` }));
	rmSync(join(root, POLICY));
	git(root, 'commit', '-q', '-am', 'a base without the policy');
	write(root, DOC, doc);
	save(root, policy({ grandfathered: [exempt('Old step', 80)] }));
	const result = run(root, { CI: 'true' });
	assert.equal(result.status, 0, result.stderr);
});

test('AFD_BASE names the base; an all-zero one falls back to main', () => {
	const root = commit(
		fixture(policy({ capped: [cap('Summary', 30)] }), { [DOC]: `${row('Summary', 30)}\n` })
	);
	const base = git(root, 'rev-parse', 'HEAD');
	// A later commit on main raises the cap; against main the tree is unchanged, against the
	// first commit it is looser.
	write(root, DOC, `${row('Summary', 40)}\n`);
	save(root, policy({ capped: [cap('Summary', 40)] }));
	git(root, 'commit', '-q', '-am', 'raise the cap');
	assert.equal(run(root).status, 0);
	assert.equal(run(root, { AFD_BASE: '0'.repeat(40) }).status, 0);

	const result = run(root, { AFD_BASE: base });
	assert.equal(result.status, 1);
	assert.match(result.stderr, /the "max" of "\| Summary \|" rose from 30 to 40/);
});

test('a repository with no base ref is noted locally and fails under CI', () => {
	const root = fixture(policy(), { [DOC]: `${row('Step 1', 50)}\n` });
	git(root, 'init', '-q', '-b', 'topic');
	git(root, 'add', '-A');
	git(root, 'commit', '-q', '-m', 'no main here');
	const local = run(root);
	assert.equal(local.status, 0, local.stderr);
	assert.match(local.stdout, /none of origin\/main, main has a merge base with HEAD/);
	assert.equal(run(root, { CI: 'true' }).status, 1);
});

test('a policy that is not JSON fails, on the branch or at its base', () => {
	const broken = fixture(policy(), { [DOC]: '# Status\n' });
	write(broken, POLICY, '{ "limit": ');
	const now = run(broken);
	assert.equal(now.status, 1);
	assert.match(now.stderr, /doc-line-limits\.json: not JSON/);

	const root = fixture(policy(), { [DOC]: `${row('Step 1', 50)}\n` });
	write(root, POLICY, '{ "limit": ');
	commit(root);
	save(root, policy());
	const atBase = run(root, { CI: 'true' });
	assert.equal(atBase.status, 1);
	assert.match(atBase.stderr, /not compared with its merge base: .* is not JSON/);
});

test('a malformed capped entry fails', () => {
	const doc = { [DOC]: `${row('Summary', 30)}\n` };
	const entry = cap('Summary', 30);
	const cases = [
		[{ ...entry, startsWith: '' }, /needs "file" and a non-empty "startsWith"/],
		[{ ...entry, reason: undefined }, /needs a "reason"/],
		[{ ...entry, max: '30' }, /needs a whole-number "max"/],
	];
	for (const [bad, message] of cases) {
		const result = run(fixture(policy({ capped: [bad] }), doc));
		assert.equal(result.status, 1);
		assert.match(result.stderr, message);
	}
});

const LOG = 'docs/sessions';

test('every .md file in a listed directory is held to the limit, with no exemption', () => {
	const files = {
		[DOC]: `${row('Step 1', 50)}\n`,
		[`${LOG}/2026-11-27-a.md`]: `# A\n\n${row('Short', 50)}\n`,
		[`${LOG}/2026-11-27-b.md`]: `# B\n\n${row('Long', 51)}\n`,
		[`${LOG}/notes.txt`]: `${'x'.repeat(80)}\n`,
		[`${LOG}/deeper/2026-11-27-c.md`]: `${'x'.repeat(80)}\n`,
	};
	const result = run(fixture({ ...policy(), directories: [LOG] }, files));
	assert.equal(result.status, 1);
	assert.match(
		result.stderr,
		/docs\/sessions\/2026-11-27-b\.md:3: 51 characters, over the limit of 50/
	);
	assert.doesNotMatch(result.stderr, /2026-11-27-a\.md|notes\.txt|deeper/);

	const passing = { ...files, [`${LOG}/2026-11-27-b.md`]: `# B\n\n${row('Long', 50)}\n` };
	const ok = run(fixture({ ...policy(), directories: [`${LOG}/`] }, passing));
	assert.equal(ok.status, 0, ok.stderr);
	assert.match(ok.stdout, /3 documents \(2 in 1 directories\), no line over 50 characters/);

	const exemptInLog = { ...exempt('Long', 51), file: `${LOG}/2026-11-27-b.md` };
	const refused = run(
		fixture({ ...policy({ grandfathered: [exemptInLog] }), directories: [LOG] }, files)
	);
	assert.equal(refused.status, 1);
	assert.match(
		refused.stderr,
		/docs\/sessions\/2026-11-27-b\.md is not one of "files"; delete the entry/
	);
});

test('a listed directory that is missing, holds no .md file or is malformed fails', () => {
	const doc = { [DOC]: `${row('Step 1', 50)}\n` };
	const missing = run(fixture({ ...policy(), directories: [LOG] }, doc));
	assert.equal(missing.status, 1);
	assert.match(missing.stderr, /docs\/sessions: listed in "directories" .* but missing/);

	const empty = run(
		fixture({ ...policy(), directories: [LOG] }, { ...doc, [`${LOG}/x.txt`]: 'x\n' })
	);
	assert.equal(empty.status, 1);
	assert.match(empty.stderr, /docs\/sessions: holds no \.md file, so nothing was checked/);

	for (const directories of [LOG, [''], [3]]) {
		const bad = run(fixture({ ...policy(), directories }, doc));
		assert.equal(bad.status, 1);
		assert.match(bad.stderr, /"directories" must be a list of folder paths/);
	}
});

test('a directory may not leave the policy while it exists; a new one may join', () => {
	const files = { [DOC]: `${row('Step 1', 50)}\n`, [`${LOG}/2026-11-27-a.md`]: '# A\n' };
	const root = commit(fixture({ ...policy(), directories: [LOG] }, files));
	assert.equal(run(root, { CI: 'true' }).status, 0, 'unchanged');

	save(root, policy());
	const dropped = run(root);
	assert.equal(dropped.status, 1);
	assert.match(
		dropped.stderr,
		/docs\/sessions left "directories" since the merge base .* but still exists/
	);

	write(root, `${LOG}/2026-11-28-b.md`, '# B\n');
	mkdirSync(join(root, 'docs/other-log'), { recursive: true });
	write(root, 'docs/other-log/2026-11-28-c.md', '# C\n');
	save(root, { ...policy(), directories: [LOG, 'docs/other-log'] });
	const added = run(root, { CI: 'true' });
	assert.equal(added.status, 0, added.stderr);
	assert.match(added.stdout, /4 documents \(3 in 2 directories\)/);
});

test('a file of a listed directory cannot also be listed in files, where it could be exempt', () => {
	const file = `${LOG}/2026-11-27-a.md`;
	const long = row('Long', 80);
	const files = { [DOC]: `${row('Step 1', 50)}\n`, [file]: `${long}\n` };
	const grandfathered = [{ ...exempt('Long', 80), file }];
	for (const directories of [[LOG], [`${LOG}/`]]) {
		const result = run(
			fixture({ ...policy({ files: [DOC, file], grandfathered }), directories }, files)
		);
		assert.equal(result.status, 1);
		assert.match(
			result.stderr,
			/docs\/sessions\/2026-11-27-a\.md is in a folder listed in "directories", whose files have no exemption/
		);
	}
});

test('a folder named like a .md file inside a listed directory is skipped, not read', () => {
	const files = {
		[DOC]: `${row('Step 1', 50)}\n`,
		[`${LOG}/2026-11-27-a.md`]: '# A\n',
		[`${LOG}/folder.md/inner.txt`]: 'x\n',
	};
	const result = run(fixture({ ...policy(), directories: [LOG] }, files));
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /2 documents \(1 in 1 directories\)/);

	const root = run(fixture({ ...policy(), directories: ['/'] }, files));
	assert.equal(root.status, 1);
	assert.match(root.stderr, /"directories" must be a list of folder paths/);
});

test('a directory deleted from the repository may leave the policy', () => {
	const files = { [DOC]: `${row('Step 1', 50)}\n`, [`${LOG}/2026-11-27-a.md`]: '# A\n' };
	const root = commit(fixture({ ...policy(), directories: [LOG] }, files));
	rmSync(join(root, LOG), { recursive: true });
	save(root, policy());
	const result = run(root);
	assert.equal(result.status, 0, result.stderr);
});

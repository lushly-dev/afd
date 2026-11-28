import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	DOOR_ARGV_PATTERNS,
	DOOR_PATTERNS,
	decode,
	globToRegExp,
	names,
	searchable,
	validateManifest,
	writesIn,
} from './check-process.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'check-process.mjs');
const MANIFEST = 'process.json';
/** One tracked file under each default scope glob. */
const BASELINE = {
	'AGENTS.md': '# Agents\n',
	'docs/README.md': '# Docs\n',
	'scripts/README.md': '# Scripts\n',
};

/** The environment without a hook's `GIT_*` variables, which would point git at this repository. */
const clean = Object.fromEntries(
	Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))
);

/** The real manifest: its exclusions are tested below. The patterns are the checker's own. */
const REAL = JSON.parse(
	readFileSync(join(here, '../docs/features/active/factory-gateway/process.json'), 'utf8')
);
const MILESTONES = ['G0', 'G1', 'G2', 'G3', 'G4', 'G5'];
const ISSUE = 'https://github.com/lushly-dev/afd/issues/1550';

/** An allow entry with its reason and issue. */
const allowed = (path, until) => ({ path, until, reason: 'Writes until then.', issue: ISSUE });

/** A manifest with every milestone unlanded, `scope`, no exclusion and the given overrides. */
function manifest({
	milestones = {},
	allow = [],
	exclude = [],
	scope = ['docs/**', 'scripts/**', 'AGENTS.md'],
	repo = 'afd',
} = {}) {
	const none = Object.fromEntries(MILESTONES.map((m) => [m, { landed: false, files: [] }]));
	return {
		version: 2,
		repo,
		milestones: { ...none, ...milestones },
		door: { scope, exclude, allow },
	};
}

/** A git repository holding `files` (tracked) and the manifest; `untracked` stay out of git. */
function fixture(files, { untracked = {}, manifest: m = manifest() } = {}) {
	const root = mkdtempSync(join(tmpdir(), 'afd-process-'));
	const write = (path, text) => {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), text);
	};
	write(MANIFEST, JSON.stringify(m));
	for (const [path, text] of Object.entries({ ...BASELINE, ...files })) write(path, text);
	const git = (...args) => execFileSync('git', args, { cwd: root, env: clean, stdio: 'ignore' });
	git('init', '-q');
	git('add', '-A');
	for (const [path, text] of Object.entries(untracked)) write(path, text);
	return root;
}

/** Runs the check in `root` and returns its exit code and output. */
function run(root, ...args) {
	const manifestArgs = args.includes('--manifest') ? [] : ['--manifest', MANIFEST];
	const result = spawnSync(process.execPath, [script, ...manifestArgs, ...args], {
		cwd: root,
		encoding: 'utf8',
		env: clean,
		timeout: 15_000,
	});
	rmSync(root, { recursive: true, force: true });
	return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

test('passes a repository whose only write is allowed, and says what it read', () => {
	const { status, out } = run(
		fixture(
			{ 'docs/runbook.md': 'Run `gh pr create --fill`.\n', 'scripts/a.mjs': 'export {};\n' },
			{ manifest: manifest({ allow: [allowed('docs/runbook.md', 'G1')] }) }
		)
	);
	assert.equal(status, 0, out);
	assert.match(out, /process: afd's half: 5 files read; 1 hold GitHub writes allowed/);
});

test('refuses a write in a runbook, naming the file, the line and the write', () => {
	const { status, out } = run(fixture({ 'docs/runbook.md': 'One.\nThen `gh issue comment 3`.\n' }));
	assert.equal(status, 1);
	assert.match(out, /docs\/runbook\.md:2: `gh issue comment` is a GitHub write/);
});

test('finds a write in a directory below a ** glob, and in a label call', () => {
	const { status, out } = run(
		fixture({ 'docs/a/b/c/deep.md': 'gh api repos/o/r/labels -f name=x\n' })
	);
	assert.equal(status, 1);
	assert.match(out, /docs\/a\/b\/c\/deep\.md:1: `gh api repos\/o\/r\/labels -f name=x`/);
});

test('refuses an argument-list write, also across lines, in JavaScript and Python', () => {
	const { status, out } = run(
		fixture({
			'scripts/a.mjs': "run('gh', [\n\t'pr',\n\t'merge',\n\tString(n)]);\n",
			'scripts/b.py': 'x = 1\nrun(["gh", "variable", "set", name])\n',
		})
	);
	assert.equal(status, 1);
	assert.match(out, /scripts\/a\.mjs:2: `'pr', 'merge'`/);
	assert.match(out, /scripts\/b\.py:2: `"variable", "set"`/);
});

test('reads code without its comments, but with its strings, docstrings and regular expressions', () => {
	const quiet = run(
		fixture({
			'scripts/a.mjs':
				'// gh pr merge\n/* gh pr create\n */ const a = 1; // gh issue edit\nconst b = a / 2; // gh pr edit\n',
			'scripts/b.py': 'x = 1  # gh pr create\n# gh issue edit\n',
			'scripts/c.yml': 'run: echo ok # gh pr merge\n# gh issue edit\n',
		})
	);
	assert.equal(quiet.status, 0, quiet.out);
	const loud = run(
		fixture({
			'scripts/a.mjs': "const url = 'https://x'; const cmd = 'gh pr merge 3';\n",
			'scripts/b.py': 'BODY = """\ngh issue create --title x\n"""\n',
			'scripts/c.sh': 'echo "# not a comment" && gh pr create --fill\necho a#b gh pr ready 3\n',
			// A command's docstring is its description in the catalog agents read.
			'scripts/d.py': 'def land(n):\n    """Merge it: gh pr merge <n> --squash."""\n',
			'scripts/e.py': 'run(\n    """gh pr edit 3""",\n    shell=True)\n',
			// A `/*` inside a regular expression opens no comment, nor does a quote.
			'scripts/f.mjs':
				"const r = /^\\.claude\\/skills\\/*/;\nconst q = /[\"']/;\nrun('gh', ['pr', 'merge', n]);\n",
			'scripts/g.mjs': 'const t = `https://x // ${n}`; const u = `gh pr comment ${n}`;\n',
			// After `++` a `/` divides: it opens no regular expression that hides the rest.
			'scripts/h.mjs': "const k = n++ / 2 + '/' + 'https://x'; run('gh pr merge 1');\n",
		})
	);
	assert.equal(loud.status, 1);
	assert.match(loud.out, /scripts\/a\.mjs:1: `gh pr merge`/);
	assert.match(loud.out, /scripts\/b\.py:2: `gh issue create`/);
	assert.match(loud.out, /scripts\/c\.sh:1: `gh pr create`/);
	assert.match(loud.out, /scripts\/c\.sh:2: `gh pr ready`/);
	assert.match(loud.out, /scripts\/d\.py:2: `gh pr merge`/);
	assert.match(loud.out, /scripts\/e\.py:2: `gh pr edit`/);
	assert.match(loud.out, /scripts\/f\.mjs:3: `'pr', 'merge'`/);
	assert.match(loud.out, /scripts\/g\.mjs:1: `gh pr comment`/);
	assert.match(loud.out, /scripts\/h\.mjs:1: `gh pr merge`/);
});

test("the checker's patterns refuse each write the gateway serves, and no read", () => {
	const expressions = [...DOOR_PATTERNS, ...DOOR_ARGV_PATTERNS].map((p) => new RegExp(p, 'gu'));
	const writes = [
		'gh issue edit 3 --add-label x',
		'gh issue comment 3 -b hi',
		'gh issue create --title x',
		'gh pr create --fill',
		'gh --repo o/r pr merge 1',
		'gh -R o/r pr merge 1',
		'gh  pr   merge 1',
		'gh pr edit 3 --add-label x',
		'gh pr ready 3',
		'gh pr comment 3 -b hi',
		'gh variable set X --body 1',
		'gh api -X POST repos/o/r/issues/1/comments -f body=x',
		'gh api repos/o/r/issues/1/labels -f labels[]=x',
		'gh api --method PATCH repos/o/r/issues/1 -f state=closed',
		'gh api repos/o/r/statuses/abc -f state=success',
		'gh api repos/o/r/check-runs --input run.json',
		"gh api graphql -f query='mutation { enqueuePullRequest(input: {}) { clientMutationId } }'",
		'gh api graphql -F id=$ID -f query=@enqueue.graphql # enqueuePullRequest',
		'enqueuePullRequest(input: { pullRequestId: $id })',
		'gh api repos/o/r/issues/1/comments \\\n  -f body=x',
		'gh pr \\\n  merge 3',
		'gh api -X post repos/o/r/issues/1/comments',
		'gh api repos/o/r/issues/1/comments -f body=x && gh api -X GET search/issues -f q=x',
		'| `gh api repos/o/r/issues/1/labels -f labels[]=x` | `gh api -X GET search/issues -f q=x` |',
		'mutation { addLabelsToLabelable(input: $i) { clientMutationId } }',
		...[
			'enqueuePullRequest',
			'mergePullRequest',
			'createPullRequest',
			'updatePullRequest',
			'markPullRequestReadyForReview',
			'revertPullRequest',
			'addLabelsToLabelable',
			'removeLabelsFromLabelable',
			'addAssigneesToAssignable',
			'removeAssigneesFromAssignable',
			'addComment',
			'createIssue',
			'updateIssue',
			'updateIssueIssueType',
			'addSubIssue',
			'removeSubIssue',
			'dequeuePullRequest',
			'enablePullRequestAutoMerge',
			'disablePullRequestAutoMerge',
			'clearLabelsFromLabelable',
			'createRef',
			'updateRef',
			'updateRefs',
			'deleteRef',
			'createCommitOnBranch',
			'mergeBranch',
			'updatePullRequestBranch',
		].flatMap((name) => [
			`mutation { ${name}(input: $i) { clientMutationId } }`,
			`mutation M { ${name} { clientMutationId } }`,
			// Without `mutation`, as the gateway writes them: the pattern keeps the names twice.
			`${name}(input: {id: $id}) { clientMutationId }`,
		]),
		'gh api -X PATCH repos/o/r/git/refs/heads/x -f sha=abc -F force=true',
		'gh api repos/o/r/git/refs -f ref=refs/heads/x -f sha=abc',
		'gh api -X DELETE repos/o/r/git/refs/heads/x',
		// The contents endpoint commits to a branch, skipping branch-push's owner-author check.
		'gh api -X PUT repos/o/r/contents/README.md -f message=x -f content=eA==',
		'gh api repos/o/r/contents/a/b.md -f message=x -f content=eA== -f branch=x',
		'gh api --method DELETE repos/o/r/contents/a.md -f message=x -f sha=abc',
		"gh api -X 'PUT' repos/o/r/contents/a.md --input body.json",
		'gh api --method="DELETE" repos/o/r/git/refs/heads/x',
		// The low-level commit writes that pair with a ref update.
		'gh api repos/o/r/git/commits -f message=x -f tree=abc',
		'gh api repos/o/r/git/trees -f base_tree=abc',
		'gh api -X POST repos/o/r/merge-upstream -f branch=main',
		'gh api repos/o/r/branches/x/rename -f new_name=y',
		// A branch name may hold a slash, as the factory's own do.
		'gh api -X POST repos/o/r/branches/t3/x/rename -f new_name=y',
		'gh pr update-branch 5 --rebase',
		'gh -R o/r pr update-branch 5',
		'gh repo sync o/r --branch main',
		"run('gh', ['pr', 'update-branch', n])",
		"run('gh', ['repo', 'sync', fork])",
		"run('gh', ['issue', 'edit', n])",
		'run("gh", ["pr" , "merge"])',
		'run(`gh`, [`variable`, `set`])',
	];
	for (const write of writes)
		assert.equal(writesIn(write, expressions).length > 0, true, `not refused: ${write}`);
	const reads = [
		'gh pr view 3 --json state',
		'gh issue list --label x',
		'gh pr checks 3',
		'gh api repos/o/r/issues/1/comments',
		'gh api repos/o/r/pulls/1 --jq .state',
		"gh api graphql -f query='query { repository { name } }'",
		"run('gh', ['pr', 'view', n])",
		'gh api -X GET search/issues -f q="repo:o/r is:open"',
		'gh api --method get repos/o/r/issues -f state=open',
		'list.map(updateIssue => x); createIssue(title);',
		'Read `addComment` in the schema.',
		'Attach it with `addSubIssue`, and detach it with `removeSubIssue`.',
		'Take it out with the `dequeuePullRequest` mutation, or turn auto-merge off.',
		'gh api repos/o/r/git/refs/heads/main --jq .object.sha',
		'gh api repos/o/r/git/ref/heads/main',
		'gh api repos/o/r/contents/README.md --jq .sha',
		'gh api -X GET repos/o/r/contents/a.md -f ref=main',
		"gh api -X 'GET' repos/o/r/contents/a.md -f ref=main",
		'gh api --method "GET" repos/o/r/contents/a.md -f ref=main',
		'gh api repos/o/r/git/commits/abc --jq .tree.sha',
		'gh api repos/o/r/branches/main/protection',
		'gh api repos/o/r/branches/t3/x/renamed',
		// Without a repository, gh repo sync only updates the local clone.
		'gh repo sync --branch main',
		'Read `createCommitOnBranch` in the schema; `updateRefs` and `deleteRef` too.',
		"gh api graphql -f query='query { repository { pullRequest(number: 1) { isInMergeQueue autoMergeRequest { enabledAt } } } }'",
		"gh api graphql -f query='query { repository { issue(number: 1) { subIssues(first: 5) { totalCount } } } }'",
	];
	for (const read of reads)
		assert.deepEqual(writesIn(read, expressions), [], `refused a read: ${read}`);
});

test('reads a file with a NUL or in UTF-16, and refuses its writes', () => {
	const utf16 = Buffer.concat([
		Buffer.from([0xff, 0xfe]),
		Buffer.from('gh pr merge 1\n', 'utf16le'),
	]);
	assert.match(decode(utf16), /gh pr merge/);
	const be = Buffer.from(utf16.subarray(2)).swap16();
	assert.match(decode(Buffer.concat([Buffer.from([0xfe, 0xff]), be])), /gh pr merge/);
	const { status, out } = run(
		fixture({ 'AGENTS.md': '# Agents\n\0\nRun `gh pr merge 3`.\n', 'docs/utf16.md': utf16 })
	);
	assert.equal(status, 1);
	assert.match(out, /AGENTS\.md:3: `gh pr merge`/);
	assert.match(out, /docs\/utf16\.md:1: `gh pr merge`/);
});

test('a scope whose every file is excluded reads nothing, and fails', () => {
	const exclude = [{ glob: '**/*.test.mjs', reason: 'Tests.' }];
	const { status, out } = run(
		fixture(
			{ 'docs/a.test.mjs': '1\n' },
			{ manifest: manifest({ scope: ['docs/*.test.mjs'], exclude }) }
		)
	);
	assert.equal(status, 1);
	assert.match(out, /door: no file in door\.scope was read/);
});

test('an exclusion cannot silence a scope glob, and fails once it removes nothing', () => {
	const silenced = run(
		fixture(
			{ 'scripts/a.mjs': "run('gh pr merge 1');\n" },
			{ manifest: manifest({ exclude: [{ glob: 'scripts/**', reason: 'Quiet.' }] }) }
		)
	);
	assert.equal(silenced.status, 1);
	assert.match(
		silenced.out,
		/door\.scope glob scripts\/\*\* reads no file: door\.exclude removes each it matches/
	);
	const stale = run(
		fixture({}, { manifest: manifest({ exclude: [{ glob: '**/*.test.mjs', reason: 'Tests.' }] }) })
	);
	assert.equal(stale.status, 1);
	assert.match(
		stale.out,
		/door\.exclude glob \*\*\/\*\.test\.mjs removes no file in door\.scope: delete it/
	);
});

test("another repository's half reads its own scope and allow entries", () => {
	const m = manifest({
		repo: 'lushly',
		scope: ['Ops/**', 'AGENTS.md'],
		allow: [allowed('Ops/allowed.md', 'G1')],
	});
	const { status, out } = run(
		fixture(
			{ 'Ops/ops.md': 'gh pr merge 1\n', 'Ops/allowed.md': 'gh issue edit 1\n' },
			{ manifest: m }
		)
	);
	assert.equal(status, 1);
	assert.match(out, /Ops\/ops\.md:1: `gh pr merge` is a GitHub write/);
	assert.doesNotMatch(out, /allowed\.md|docs\/README/);
});

test('a command is named only as a word of its own', () => {
	assert.ok(names('Call `issue-claim` first.', 'issue-claim'));
	assert.ok(names('Run Issue-Claim.', 'issue-claim'));
	assert.ok(names('the Factory Gateway', 'factory gateway'));
	assert.ok(names('"Bash(gh pr view:*)"', 'gh'));
	assert.ok(!names('node scripts/issue-claim.mjs', 'issue-claim'));
	assert.ok(!names('issue-claims', 'issue-claim'));
	assert.ok(names('{"factory-gateway": {}}', 'gateway'));
	assert.ok(names('mcp__gateway__issue-claim', 'issue-claim'));
	assert.ok(!names('though', 'gh'));
	assert.ok(!names('scripts/review-record.mjs', 'review-record'));
});

test("leaves out the real manifest's exclusions, files outside the scope and untracked files", () => {
	const { status, out } = run(
		fixture(
			{
				'.github/workflows/w.yml': 'run: gh pr merge 1\n',
				'scripts/a.test.mjs': "'gh pr merge'\n",
				'scripts/botcore_factory/gateway/b.py': '["gh", "pr", "merge"]\n',
				'packages/core/c.ts': "'gh pr merge'\n",
			},
			{
				untracked: { 'docs/scratch.md': 'gh pr merge 1\n' },
				manifest: manifest({
					exclude: [
						...REAL.door.exclude.filter((e) => e.glob === '**/*.test.mjs'),
						{ glob: 'scripts/botcore_factory/gateway/**', reason: 'The door.' },
					],
				}),
			}
		)
	);
	assert.equal(status, 0, out);
});

test("the real manifest's exclusions each say why", () => {
	assert.ok(REAL.door.exclude.length > 0);
	for (const { glob, reason } of REAL.door.exclude) assert.ok(reason.length > 20, glob);
});

test('refuses an allowed file once its milestone has landed', () => {
	const { status, out } = run(
		fixture(
			{ 'scripts/claim.mjs': "gh(['issue', 'edit', n]);\n" },
			{
				manifest: manifest({
					milestones: { G1: { landed: true, files: [] } },
					allow: [allowed('scripts/claim.mjs', 'G1')],
				}),
			}
		)
	);
	assert.equal(status, 1);
	assert.match(
		out,
		/scripts\/claim\.mjs:1: `'issue', 'edit'` was allowed until G1, which has landed/
	);
});

test('an allow entry expires once its file holds no write or is gone', () => {
	const { status, out } = run(
		fixture(
			{ 'docs/runbook.md': 'Ask the gateway: `issue-comment`.\n' },
			{
				manifest: manifest({
					allow: [allowed('docs/runbook.md', 'G5'), allowed('docs/gone.md', 'G1')],
				}),
			}
		)
	);
	assert.equal(status, 1);
	assert.match(
		out,
		/docs\/runbook\.md: door\.allow .* holds no write the door refuses: delete its entry/
	);
	assert.match(out, /docs\/gone\.md: door\.allow .* but it is not tracked/);
});

test('a landed milestone needs each listed file to exist and name each command', () => {
	const { status, out } = run(
		fixture(
			{
				'docs/runbook.md': 'Call `Issue-Claim`.\n',
				'docs/paths.md': 'Run `node scripts/issue-claim.mjs`.\n',
			},
			{
				manifest: manifest({
					milestones: {
						G1: {
							landed: true,
							files: [
								{ path: 'docs/runbook.md', names: ['issue-claim', 'pr-status'] },
								{ path: 'docs/missing.md', names: ['pr-merge'] },
								{ path: 'docs/paths.md', names: ['issue-claim'] },
							],
						},
						G2: { landed: false, files: [{ path: 'docs/runbook.md', names: ['review-record'] }] },
					},
				}),
			}
		)
	);
	assert.equal(status, 1);
	assert.match(out, /docs\/runbook\.md: G1 has landed, so this file must name `pr-status`/);
	assert.doesNotMatch(out, /runbook\.md: .*`issue-claim`/);
	assert.match(out, /docs\/paths\.md: G1 has landed, so this file must name `issue-claim`/);
	assert.match(out, /docs\/missing\.md: G1 lists this file, which is not tracked/);
	assert.doesNotMatch(out, /review-record/);
});

test('a milestone not yet landed still needs each listed file tracked, so a rename fails at once', () => {
	const listed = (path) => ({ G3: { landed: false, files: [{ path, names: ['gateway-wait'] }] } });
	const renamed = run(
		fixture(
			{ 'docs/new-name.md': 'Wait.\n' },
			{ manifest: manifest({ milestones: listed('docs/old-name.md') }) }
		)
	);
	assert.equal(renamed.status, 1);
	assert.match(
		renamed.out,
		/docs\/old-name\.md: G3 lists this file, which is not tracked: if it moved, list it by its new path/
	);
	// Followed by the manifest, the same rename passes: G3 has not landed, so no name is asked for.
	const followed = run(
		fixture(
			{ 'docs/new-name.md': 'Wait.\n' },
			{ manifest: manifest({ milestones: listed('docs/new-name.md') }) }
		)
	);
	assert.equal(followed.status, 0, followed.out);
});

test('a scope glob that matches no tracked file fails, so the scan cannot shrink unseen', () => {
	const { status, out } = run(
		fixture({}, { manifest: manifest({ scope: ['AGENTS.md', 'docs/operations/**'] }) })
	);
	assert.equal(status, 1);
	assert.match(out, /door\.scope glob docs\/operations\/\*\* matches no tracked file/);
});

test('refuses a manifest it cannot trust', () => {
	const m = manifest({
		allow: [
			allowed('a', 'G9'),
			allowed('b', 'G1'),
			allowed('b', 'G5'),
			{ path: 'c', until: 'G1', issue: ISSUE },
			{ ...allowed('d', 'G1'), reason: '   ' },
			{ ...allowed('e', 'G1'), issue: 'lushly#2392' },
			{ ...allowed('f', 'G1'), issue: 'https://github.com/lushly-dev/afd/pull/12' },
			{ ...allowed('g', 'G1'), issue: `see ${ISSUE}` },
			{ ...allowed('g2', 'G1'), issue: `${ISSUE} and more` },
			{ ...allowed('h', 'G1'), owner: 'x' },
		],
		exclude: [{ glob: 'x/**' }, { reason: 'No glob.' }],
	});
	m.milestones.G7 = { landed: 'yes', files: [] };
	m.milestones.G2 = { landed: false };
	m.milestones.G3 = { landed: false, files: [], afd: [] };
	delete m.milestones.G4;
	m.lushly = {};
	m.patterns = [];
	m.door.patterns = ['gh pr merge'];
	m.door.argvPatterns = [];
	delete m.door.scope;
	const problems = validateManifest(m).join('\n');
	assert.match(problems, /unknown milestone G7/);
	assert.match(problems, /G7\.landed must be true or false/);
	assert.match(problems, /G2\.files must be a list/);
	assert.match(problems, /G3 has an unknown key "afd"/);
	assert.match(problems, /milestones must hold G4/);
	assert.match(problems, /the manifest has an unknown key "lushly"/);
	assert.match(problems, /the manifest has an unknown key "patterns"/);
	assert.match(problems, /door\.patterns is not read: the patterns are DOOR_PATTERNS/);
	assert.match(problems, /door\.argvPatterns is not read/);
	assert.match(problems, /door\.scope must list/);
	assert.match(problems, /allow\[0\]\.until must name a milestone in the manifest/);
	assert.match(problems, /names b twice/);
	assert.match(problems, /allow\[3\]\.reason must say why/);
	assert.match(problems, /allow\[4\]\.reason must say why/);
	for (const i of [5, 6, 7, 8])
		assert.match(problems, new RegExp(`allow\\[${i}\\]\\.issue must link the GitHub issue`));
	assert.match(problems, /door\.allow\[9\] has an unknown key "owner"/);
	assert.match(problems, /door\.exclude\[0\]\.reason must say why/);
	assert.match(problems, /door\.exclude\[1\] needs a glob/);
	assert.match(validateManifest({ ...manifest(), version: 1 }).join('\n'), /version must be 2/);
	assert.match(validateManifest({ ...manifest(), repo: '' }).join('\n'), /repo must name/);
	const shapes = validateManifest({ version: 2, repo: 'afd', door: { scope: ['a'], allow: {} } });
	assert.match(shapes.join('\n'), /milestones must be an object/);
	assert.match(shapes.join('\n'), /door\.allow must be a list/);
	assert.match(shapes.join('\n'), /door\.exclude must be a list/);
	assert.match(validateManifest('x').join('\n'), /must be a JSON object/);
	assert.deepEqual(validateManifest(manifest()), []);
	const { status, out } = run(fixture({}, { manifest: m }));
	assert.equal(status, 1);
	assert.match(out, /manifest: unknown milestone G7/);
});

test("names a missing manifest, and refuses another repository's half", () => {
	const missing = run(fixture({}), '--manifest', 'nowhere.json');
	assert.equal(missing.status, 2);
	assert.match(
		missing.out,
		/cannot read the manifest nowhere\.json \(ENOENT\); pass this repository's/
	);
	const root = fixture({}, { manifest: manifest({ repo: 'lushly' }) });
	execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/lushly-dev/afd.git'], {
		cwd: root,
		env: clean,
	});
	const wrong = run(root);
	assert.equal(wrong.status, 1);
	assert.match(
		wrong.out,
		/is lushly's half, but this repository is https:\/\/github\.com\/lushly-dev\/afd/
	);
});

test('globs: ** spans directories, also none, and * stays within one', () => {
	assert.ok(globToRegExp('**/AGENTS.md').test('AGENTS.md'));
	assert.ok(globToRegExp('**/AGENTS.md').test('a/b/AGENTS.md'));
	assert.ok(globToRegExp('plugins/*/src/**').test('plugins/p/src/a/b.py'));
	assert.ok(!globToRegExp('plugins/*/src/**').test('plugins/p/q/src/b.py'));
	assert.ok(!globToRegExp('*.md').test('docs/a.md'));
	assert.ok(!globToRegExp('a.md').test('aXmd'));
});

test('masking keeps every line where it was', () => {
	const text = '/* one\ntwo */ x\n// three\ny';
	const masked = searchable('a.ts', text);
	assert.equal(masked.split('\n').length, text.split('\n').length);
	assert.match(masked, /^ +x$/m);
	assert.equal(searchable('a.md', text), text);
});

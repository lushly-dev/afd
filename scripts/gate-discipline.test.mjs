/** The gate-discipline skill's scripts, which Botcore ships to every repository that seeds the skill. */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findings } from '../endpoints/botcore/src/botcore/skills/gate-discipline/scripts/check-test-configs.mjs';
import {
	findSuppressions,
	maskSource,
} from '../endpoints/botcore/src/botcore/skills/gate-discipline/scripts/check-test-quarantine.mjs';
import {
	compareTestFile,
	LANGUAGES,
} from '../endpoints/botcore/src/botcore/skills/gate-discipline/scripts/report-test-changes.mjs';

const scripts = join(
	dirname(fileURLToPath(import.meta.url)),
	'../endpoints/botcore/src/botcore/skills/gate-discipline/scripts'
);
const roots = [];
after(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A git repository holding `files`, none of them committed. */
function fixture(files) {
	const root = mkdtempSync(join(tmpdir(), 'gate-discipline-'));
	roots.push(root);
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
	);
	execFileSync('git', ['init', '-q'], { cwd: root, env });
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), text);
	}
	return root;
}

function run(script, root, ...args) {
	return spawnSync(process.execPath, [join(scripts, script), '--root', root, ...args], {
		encoding: 'utf8',
	});
}

// check-test-configs.mjs

const config = (body) => `export default defineConfig({\n\ttest: {\n${body}\n\t},\n});\n`;

test('test configs: passes when no config allows an empty run', () => {
	const result = run(
		'check-test-configs.mjs',
		fixture({
			'packages/a/vitest.config.ts': config("\t\tinclude: ['src/**/*.test.ts'],"),
			'packages/a/package.json': '{"scripts":{"test":"vitest run"}}',
		})
	);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /passed \(2 configs and launchers\)/);
});

test('test configs: fails on the option in a config, naming the file and line', () => {
	const result = run(
		'check-test-configs.mjs',
		fixture({ 'endpoints/x/packages/web/vitest.config.ts': config('\t\tpassWithNoTests: true,') })
	);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /endpoints\/x\/packages\/web\/vitest\.config\.ts:3: passWithNoTests/);
});

test('test configs: fails on the CLI flag in a test script and a workflow', () => {
	const result = run(
		'check-test-configs.mjs',
		fixture({
			'packages/a/package.json': '{"scripts":{"test":"vitest run --passWithNoTests"}}',
			'.github/workflows/web.yml': 'steps:\n  - run: pnpm exec vitest run --passWithNoTests\n',
		})
	);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /package\.json:1: --passWithNoTests/);
	assert.match(result.stderr, /\.github\/workflows\/web\.yml:2: --passWithNoTests/);
});

test('test configs: reads the flag in a path the caller adds, and only there', () => {
	const files = { 'tools/run-suites.mjs': "spawn('vitest', ['run', '--passWithNoTests']);\n" };
	assert.equal(run('check-test-configs.mjs', fixture(files)).status, 0);
	const result = run('check-test-configs.mjs', fixture(files), 'tools/');
	assert.equal(result.status, 1);
	assert.match(result.stderr, /tools\/run-suites\.mjs:1: --passWithNoTests/);
	// Normalised as git prints paths, and a path that lists nothing fails rather than scanning less.
	assert.equal(run('check-test-configs.mjs', fixture(files), './tools').status, 1);
	const typo = run('check-test-configs.mjs', fixture(files), 'tool/');
	assert.equal(typo.status, 1);
	assert.match(typo.stderr, /tool: git lists no file there/);
});

test('both scripts run their check when started through a symlinked folder', () => {
	const root = fixture({
		'scripts/policy/test-quarantine.json': register([]),
		'src/a.test.ts': "it.only('a', () => {});\n",
		'vitest.config.ts': config('\t\tpassWithNoTests: true,'),
	});
	const copy = join(root, 'skill-scripts');
	cpSync(scripts, copy, { recursive: true });
	const link = join(root, 'linked-scripts');
	symlinkSync(copy, link, 'junction');
	for (const script of ['check-test-quarantine.mjs', 'check-test-configs.mjs']) {
		const result = spawnSync(process.execPath, [join(link, script), '--root', root], {
			encoding: 'utf8',
		});
		assert.equal(result.status, 1, `${script} passed through the link: ${result.stdout}`);
	}
});

test('test configs: ignores files git ignores', () => {
	const result = run(
		'check-test-configs.mjs',
		fixture({
			'.gitignore': 'node_modules/\n',
			'node_modules/dep/vitest.config.ts': config('\t\tpassWithNoTests: true,'),
		})
	);
	assert.equal(result.status, 0, result.stderr);
});

test('test configs: reads the option in every config form, and allows only a literal false', () => {
	for (const file of [
		'vitest.config.mts',
		'vite.config.js',
		'vitest.browser.config.ts',
		'vitest.workspace.ts',
		'vitest.config.e2e.ts',
	]) {
		assert.equal(findings(file, 'passWithNoTests: true').length, 1, file);
	}
	assert.equal(findings('vitest.config.ts', "'passWithNoTests': true,").length, 1);
	assert.equal(findings('vitest.config.ts', '"passWithNoTests":true').length, 1);
	assert.equal(findings('vitest.config.ts', 'test: { passWithNoTests, include },').length, 1);
	assert.equal(findings('vitest.config.ts', 'test: { include, passWithNoTests }').length, 1);
	assert.equal(findings('vitest.config.ts', 'passWithNoTests: !0').length, 1);
	assert.equal(findings('vitest.config.ts', 'passWithNoTests: allowEmpty,').length, 1);
	assert.equal(findings('vitest.config.ts', 'passWithNoTests: false,').length, 0);
	assert.equal(findings('vitest.config.ts', 'vitest run --pass-with-no-tests').length, 1);
	assert.equal(findings('src/notes.ts', 'passWithNoTests: true').length, 0);
});

// check-test-quarantine.mjs

const register = (entries) => JSON.stringify({ quarantined: entries });
const ENTRY = {
	file: 'src/a.test.ts',
	owner: 'maintainer',
	reason: 'Waits on the upstream parser fix before it can pass',
	issue: '#1',
};
const kinds = (text) => findSuppressions(text).map(({ line, kind }) => `${line}:${kind}`);

test('quarantine: finds .only and unconditional skips, and allows conditional ones', () => {
	assert.deepEqual(kinds("it.only('a', () => {});"), ['1:only']);
	assert.deepEqual(kinds("describe.only.each([1])('a %s', () => {});"), ['1:only']);
	assert.deepEqual(kinds("test.describe.only('a', () => {});"), ['1:only']);
	assert.deepEqual(kinds("it.skip('a', () => {});"), ['1:skip']);
	assert.deepEqual(kinds('it.skip(`case ${n}`, async () => {});'), ['1:skip']);
	assert.deepEqual(kinds('it.skip(title, () => {});'), ['1:skip']);
	assert.deepEqual(kinds('it.skip(title, async function () {});'), ['1:skip']);
	assert.deepEqual(kinds("describe.skip.each([1])('a %s', () => {});"), ['1:skip']);
	assert.deepEqual(kinds("it.todo('later');"), ['1:todo']);
	// Playwright: `test.skip()` skips the running test whatever happens.
	assert.deepEqual(kinds('test("a", () => {\n\ttest.skip();\n});'), ['2:skip']);
	assert.deepEqual(kinds("it\n\t.skip('a', () => {});"), ['2:skip']);
	// Playwright's fixme skips as surely as skip does.
	assert.deepEqual(kinds("test.fixme('a', async () => {});"), ['1:fixme']);
	assert.deepEqual(kinds("test.describe.fixme('a', () => {});"), ['1:fixme']);
	assert.deepEqual(kinds('test("a", () => {\n\ttest.fixme();\n});'), ['2:fixme']);
	// A condition that always holds is no condition; type arguments still make a call.
	assert.deepEqual(kinds("test.skip(true, 'flaky');"), ['1:skip']);
	assert.deepEqual(kinds('test.skip(true);'), ['1:skip']);
	assert.deepEqual(kinds('test.skip(!0, "x");'), ['1:skip']);
	assert.deepEqual(kinds("test.skip<Fixtures>('a', async () => {});"), ['1:skip']);
	assert.deepEqual(kinds("test.skip((true), 'x');"), ['1:skip']);
	assert.deepEqual(kinds("it.skipIf(true)('a', () => {});"), ['1:skip']);
	assert.deepEqual(kinds("describe.runIf(false)('a', () => {});"), ['1:skip']);
	assert.deepEqual(kinds("it.runIf(true)('a', () => {});"), []);

	assert.deepEqual(kinds("it.skipIf(process.platform === 'win32')('a', () => {});"), []);
	assert.deepEqual(kinds("describe.runIf(url)('a', () => {});"), []);
	assert.deepEqual(kinds('test.skip(!supported, "Not supported here");'), []);
	assert.deepEqual(kinds('test.skip(\n\t!!process.env.CI,\n\t"Local only",\n);'), []);
	assert.deepEqual(kinds('test.skip(({ browserName }) => browserName === "webkit");'), []);
	assert.deepEqual(kinds('const d = url ? describe : describe.skip;'), []);
	assert.deepEqual(kinds('suite.skipped = true; await test.step("a", fn);'), []);
	assert.deepEqual(kinds('foo.it.only(); myit.only();'), []);
});

test('quarantine: never reads a comment, a string, a template or a regular expression as code', () => {
	assert.deepEqual(kinds("// it.only('a', fn)\n/* it.skip('b', fn) */"), []);
	assert.deepEqual(kinds("const s = \"it.only('a')\"; const t = 'test.skip()';"), []);
	assert.deepEqual(kinds('const t = `it.only(${"it.skip()"})`;'), []);
	assert.deepEqual(kinds("expect(src).toMatch(/it\\.only\\('/);\nit.only('real', fn);"), [
		'2:only',
	]);
	assert.deepEqual(kinds('const ratio = a / b; it.todo("x"); const c = d / e;'), ['1:todo']);
	// A regular expression after a keyword, and a division after a postfix operator.
	assert.deepEqual(kinds("function f(s) { return /x'/.test(s); } it.only('a', fn);"), ['1:only']);
	assert.deepEqual(kinds("const k = typeof /`/;\nit.only('a', fn);"), ['2:only']);
	assert.deepEqual(kinds("let n = a++ / b; it.only('a', fn);"), ['1:only']);
	// A property named like a keyword is an operand, and so is a non-ASCII identifier.
	assert.deepEqual(kinds("const n = x.in / 2; it.only('a', fn);"), ['1:only']);
	assert.deepEqual(kinds("const n = obj.return / 2; it.only('a', fn);"), ['1:only']);
	assert.deepEqual(kinds("const n = ñ / 2; it.only('a', fn);"), ['1:only']);
	const masked = maskSource('const a = "x"; // c\nit.only(`y`);');
	assert.equal(masked.length, 'const a = "x"; // c\nit.only(`y`);'.length);
	assert.equal(masked.split('\n')[1], 'it.only(` `);');
});

test('quarantine: passes a clean suite, and fails a .only and an unregistered skip by file and line', () => {
	const clean = fixture({
		'scripts/policy/test-quarantine.json': register([]),
		'src/a.test.ts': "it.skipIf(!url)('a', () => {});\n",
	});
	const passed = run('check-test-quarantine.mjs', clean);
	assert.equal(passed.status, 0, passed.stderr);
	assert.match(passed.stdout, /passed: 1 test files, 0 quarantined/);

	const failed = run(
		'check-test-quarantine.mjs',
		fixture({
			'scripts/policy/test-quarantine.json': register([]),
			'src/a.test.ts': "\nit.only('a', () => {});\n",
			'src/b.spec.mjs': "describe.skip('b', () => {});\n",
		})
	);
	assert.equal(failed.status, 1);
	assert.match(failed.stderr, /src\/a\.test\.ts:2 uses \.only/);
	assert.match(failed.stderr, /src\/b\.spec\.mjs:1 uses \.skip with no quarantine entry/);
});

test('quarantine: a registered skip passes, a recovered entry fails, and a malformed one fails', () => {
	const files = (skip) => ({
		'scripts/policy/test-quarantine.json': register([ENTRY]),
		'src/a.test.ts': skip ? "it.skip('a', () => {});\n" : "it('a', () => {});\n",
	});
	assert.equal(run('check-test-quarantine.mjs', fixture(files(true))).status, 0);

	const recovered = run('check-test-quarantine.mjs', fixture(files(false)));
	assert.equal(recovered.status, 1);
	assert.match(
		recovered.stderr,
		/src\/a\.test\.ts has no unconditional \.skip or \.todo left; it recovered/
	);

	const malformed = run(
		'check-test-quarantine.mjs',
		fixture({
			'scripts/policy/test-quarantine.json': register([{ ...ENTRY, reason: 'flaky' }]),
			'src/a.test.ts': "it('a', () => {});\n",
		})
	);
	assert.equal(malformed.status, 1);
	assert.match(malformed.stderr, /malformed entry/);

	const notText = run(
		'check-test-quarantine.mjs',
		fixture({
			'scripts/policy/test-quarantine.json': register([{ ...ENTRY, reason: { length: 30 } }]),
			'src/a.test.ts': "it.skip('a', () => {});\n",
		})
	);
	assert.equal(notText.status, 1);
	assert.match(notText.stderr, /malformed entry/);
});

test('quarantine: reads paths as git prints them, so a scoped run still reports a recovered entry', () => {
	const root = fixture({
		'scripts/policy/test-quarantine.json': register([ENTRY]),
		'src/a.test.ts': "it('a', () => {});\n",
	});
	for (const path of ['src', './src', 'src/', 'src\\']) {
		const result = run('check-test-quarantine.mjs', root, path);
		assert.equal(result.status, 1, path);
		assert.match(result.stderr, /it recovered/, path);
	}
});

test('quarantine: fails with no register, with no test file, and takes another register path', () => {
	const noRegister = run(
		'check-test-quarantine.mjs',
		fixture({ 'src/a.test.ts': "it('a', () => {});\n" })
	);
	assert.equal(noRegister.status, 1);
	assert.match(noRegister.stderr, /scripts\/policy\/test-quarantine\.json is missing/);

	const empty = run(
		'check-test-quarantine.mjs',
		fixture({ 'scripts/policy/test-quarantine.json': register([]), 'src/a.ts': '' })
	);
	assert.equal(empty.status, 1);
	assert.match(empty.stderr, /found no test file/);

	const elsewhere = run(
		'check-test-quarantine.mjs',
		fixture({ 'quarantine.json': register([ENTRY]), 'src/a.test.ts': "it.todo('a');\n" }),
		'--register',
		'quarantine.json'
	);
	assert.equal(elsewhere.status, 0, elsewhere.stderr);
});

// report-test-changes.mjs

const language = (name) => LANGUAGES.find((candidate) => candidate.name === name);
const findingKinds = (result) => result.findings.map((finding) => finding.kind);

test('test changes: counts JavaScript tests, assertions, skips and matchers in code only', () => {
	const js = language('JavaScript');
	const before = [
		"describe('s', () => {",
		"\tit('a', () => { expect(a).toBe(1); expect(b).toEqual({}); });",
		"\tit.each([1])('b', (n) => { assert.equal(n, 1); });",
		"\ttest('c', () => { expect(c).toStrictEqual([]); });",
		'});',
		"// it('commented', () => { expect(x).toBe(1); });",
		`const title = "it('in a string', () => expect(y))";`,
	].join('\n');
	assert.deepEqual(js.measure(before), {
		tests: 3,
		assertions: 4,
		skips: 0,
		unconditional: 0,
		exact: 3,
		loose: 0,
	});
	const after = [
		"describe('s', () => {",
		"\tit('a', () => { expect(a).toBeDefined(); });",
		"\tit.skip('b', () => {});",
		'});',
	].join('\n');
	const result = compareTestFile('a.test.ts', js, before, after);
	assert.deepEqual(findingKinds(result), [
		'fewer-tests',
		'fewer-assertions',
		'skip-added',
		'matchers-loosened',
	]);
	assert.match(result.findings[2].detail, /skips 0 → 1, 1 more unconditional/);
	assert.deepEqual(compareTestFile('a.test.ts', js, before, before).findings, []);
	// Asymmetric matchers are values inside an assertion, so tightening one loses nothing.
	assert.equal(
		js.measure('expect(a).toEqual(expect.objectContaining({ n: expect.any(Number) }));').assertions,
		1
	);
	assert.equal(js.measure('expect.soft(a).toBe(1); assert.ok(b); assert(c);').assertions, 3);
});

test('test changes: reports a changed assertion line, but not one only moved or re-wrapped', () => {
	const js = language('JavaScript');
	const before = "it('a', () => { expect(sum(2, 2)).toBe(4); });\n";
	const changed = "it('a', () => { expect(sum(2, 2)).toBe(5); });\n";
	const diff = (removed, added) => ({
		removed: [{ line: 1, text: removed.trim() }],
		added: [{ line: 1, text: added.trim() }],
	});
	const rewritten = compareTestFile('a.test.ts', js, before, changed, diff(before, changed));
	assert.deepEqual(findingKinds(rewritten), ['assertions-rewritten']);
	assert.match(rewritten.findings[0].lines[0].text, /toBe\(4\)/);
	const skipped = before.replace("it('a'", "it.skip('a'");
	assert.deepEqual(
		findingKinds(compareTestFile('a.test.ts', js, before, skipped, diff(before, skipped))),
		['skip-added']
	);
	const wrapped = "it('a', () => {\n\texpect(sum(2, 2)).toBe(4);\n});\n";
	const rewrap = {
		removed: [{ line: 1, text: before.trim() }],
		added: wrapped.split('\n').map((text, index) => ({ line: index + 1, text: text.trim() })),
	};
	assert.deepEqual(compareTestFile('a.test.ts', js, before, wrapped, rewrap).findings, []);
});

test('test changes: sees a whole file or suite skipped', () => {
	const js = language('JavaScript');
	for (const text of [
		"test.describe.skip('s', () => { test('a', () => {}); });",
		"test.describe.only('s', () => { test('a', () => {}); });",
		"describe.skip('s', () => { it('a', () => {}); });",
	])
		assert.equal(js.measure(text).skips, 1, text);
	const python = language('Python');
	for (const text of [
		'pytestmark = pytest.mark.skip(reason="later")\n',
		'pytestmark = [pytest.mark.skipif(sys.platform == "win32", reason="r")]\n',
		'class T(TestCase):\n    def setUp(self):\n        self.skipTest("later")\n',
		'@skip("later")\ndef test_a():\n    pass\n',
		'raise unittest.SkipTest("later")\n',
		'yaml = pytest.importorskip("yaml")\n',
	])
		assert.equal(python.measure(text).skips, 1, text);
	assert.equal(
		language('Rust').measure('#[cfg_attr(windows, ignore)]\n#[test]\nfn a() {}\n').skips,
		1
	);
	assert.equal(language('C++').measure('TEST_CASE("a", "[.slow]") { CHECK(x); }\n').skips, 1);
});

test('test changes: a bare skipIf is an alias, not a test, and a called one is both', () => {
	const js = language('JavaScript');
	const measured = [
		"const linux = it.skipIf(win);\nlinux('a', () => {});",
		"it.skipIf(win)('a', () => {});",
	].map((text) => {
		const { tests, skips } = js.measure(text);
		return [tests, skips];
	});
	assert.deepEqual(measured, [
		[0, 1],
		[1, 1],
	]);
	assert.equal(js.measure("describe.skip('s', () => { it('a', () => {}); });").skips, 1);
	// A conditional skip made unconditional keeps the count but is reported.
	const made = compareTestFile(
		'a.test.ts',
		js,
		"it.skipIf(win)('a', () => {});",
		"it.skip('a', () => {});"
	);
	assert.deepEqual(findingKinds(made), ['skip-added']);
	assert.match(made.findings[0].detail, /skips 1 → 1, 1 more unconditional/);
	for (const [name, from, to] of [
		['Python', '@pytest.mark.skipif(win, reason="r")\n', '@pytest.mark.skip(reason="r")\n'],
		['Rust', '#[cfg_attr(windows, ignore)]\n#[test]\n', '#[ignore]\n#[test]\n'],
	])
		assert.deepEqual(
			findingKinds(compareTestFile('t', language(name), from, to)),
			['skip-added'],
			name
		);
	// Jasmine-style prefixes skip or focus with no condition.
	for (const text of ["xit('a', () => {});", "xdescribe('s', () => {});", "fit('a', () => {});"]) {
		const { skips, unconditional } = js.measure(text);
		assert.deepEqual([skips, unconditional], [1, 1], text);
	}
	assert.equal(js.measure("xit('a', () => {});").tests, 1);
});

test('test changes: counts tests and assertions in Python, Rust, C++ and scenarios', () => {
	const cases = [
		[
			'Python',
			'def test_a():\n    assert x == 1  # pytest.raises(E)\n\n@pytest.mark.skip(reason="r")\ndef test_b():\n    with pytest.raises(E):\n        f()\n',
			{ tests: 2, assertions: 2, skips: 1, unconditional: 1 },
		],
		[
			'Rust',
			'#[test]\nfn a() { assert_eq!(1, 1); } // assert!(x)\n#[tokio::test]\n#[ignore]\nasync fn b() { assert!(ok); }\n',
			{ tests: 2, assertions: 2, skips: 1, unconditional: 1 },
		],
		[
			'C++',
			'TEST_CASE("a") { CHECK(x); REQUIRE_FALSE(y); }\nTEST_CASE("b" * doctest::skip()) { CHECK_EQ(1, 1); } // CHECK(z)\n',
			{ tests: 2, assertions: 3, skips: 1 },
		],
		[
			'Scenario',
			'steps:\n  - command: todo-create\n    expect:\n      success: true\n  - description: x\n    command: todo-list\n# command: not-a-step\n',
			{ tests: 2, assertions: 1, skips: 0 },
		],
	];
	for (const [name, text, expected] of cases)
		assert.deepEqual(language(name).measure(text), expected, name);
	assert.ok(language('Python').owns('tests/test_lane.py', []));
	assert.ok(language('C++').owns('packages/cpp/tests/batch_test.cpp', []));
	assert.ok(!language('C++').owns('packages/cpp/src/batch.cpp', []));
	assert.ok(language('Rust').holds(['#[cfg(test)]\nmod t { #[test] fn a() {} }']));
	assert.ok(!language('Rust').holds(['fn a() {}']));
	assert.ok(language('Scenario').owns('docs/x/scenarios/01-a.scenario.yaml', []));
});

/** A repository with `files` committed on main, then `branch` applied (null deletes) uncommitted. */
function history(files, branch) {
	const root = fixture(files);
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
	);
	const git = (...args) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8' });
	const commit = (message) =>
		git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', message);
	git('add', '-A');
	commit('base');
	git('branch', '-M', 'main');
	git('switch', '-qc', 'work');
	for (const [path, text] of Object.entries(branch)) {
		if (text === null) rmSync(join(root, path));
		else {
			mkdirSync(dirname(join(root, path)), { recursive: true });
			writeFileSync(join(root, path), text);
		}
	}
	return { root, git, commit };
}

const SUITE = "it('a', () => { expect(1).toBe(1); });\nit('b', () => { expect(2).toBe(2); });\n";

test('test changes: reports a branch against its merge base, uncommitted edits included', () => {
	const { root } = history(
		{
			'src/gone.test.ts': SUITE,
			'src/shrunk.test.ts': SUITE,
			'src/kept.test.ts': SUITE,
			'src/__snapshots__/kept.test.ts.snap': 'exports[`a`] = `1`;\n',
			'vitest.config.ts': 'export default { test: { coverage: { thresholds: { lines: 90 } } } };\n',
			'src/app.ts': 'export const a = 1;\n',
		},
		{
			'src/gone.test.ts': null,
			'src/shrunk.test.ts': "it('a', () => { expect(1).toBe(1); });\n",
			'src/kept.test.ts': `${SUITE}it('c', () => { expect(3).toBe(3); });\n`,
			'src/__snapshots__/kept.test.ts.snap': 'exports[`a`] = `2`;\n',
			'vitest.config.ts': 'export default { test: { coverage: { thresholds: { lines: 60 } } } };\n',
			'src/app.ts': 'export const a = 2;\n',
			'src/new.test.ts': "it.skip('new', () => {});\n",
		}
	);
	const result = run('report-test-changes.mjs', root, '--base', 'main', '--json');
	assert.equal(result.status, 0, result.stderr);
	const report = JSON.parse(result.stdout);
	assert.equal(report.head, 'working tree');
	assert.deepEqual(report.findings.map(({ file, kind }) => `${kind} ${file}`).sort(), [
		'config-changed vitest.config.ts',
		'deleted-file src/gone.test.ts',
		'fewer-assertions src/shrunk.test.ts',
		'fewer-tests src/shrunk.test.ts',
		'snapshot-changed src/__snapshots__/kept.test.ts.snap',
	]);
	const changed = report.findings.find((finding) => finding.kind === 'config-changed');
	assert.match(changed.lines[0].text, /lines: 90/);
	assert.deepEqual(report.totals.JavaScript, {
		files: 3,
		before: { tests: 6, assertions: 6, skips: 0 },
		after: { tests: 4, assertions: 4, skips: 0 },
	});
	const markdown = run('report-test-changes.mjs', root, '--base', 'main');
	assert.match(
		markdown.stdout,
		/\*\*Fewer tests\*\* `src\/shrunk\.test\.ts`: tests 2 → 1\n {2}- 2: `it\('b'/
	);
});

test('test changes: compares a renamed file with its old self, and a commit range with --head', () => {
	const big = `${SUITE}it('c', () => { expect(3).toBe(3); });\nit('d', () => { expect(4).toBe(4); });\n`;
	const { root, git, commit } = history({ 'src/old.test.ts': big }, {});
	git('mv', 'src/old.test.ts', 'src/new.test.ts');
	writeFileSync(join(root, 'src/new.test.ts'), big.replace("it('d'", "it.skip('d'"));
	writeFileSync(join(root, 'src/added.test.ts'), SUITE); // a new file only adds
	git('add', '-A');
	commit('rename');
	writeFileSync(join(root, 'src/new.test.ts'), ''); // uncommitted, so --head must ignore it
	const result = run('report-test-changes.mjs', root, '--base', 'main', '--head', 'work', '--json');
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(
		JSON.parse(result.stdout).findings.map(({ file, kind }) => `${kind} ${file}`),
		['skip-added src/old.test.ts → src/new.test.ts']
	);
});

test('test changes: says so when nothing was lost, and fails clearly on a missing base', () => {
	const { root } = history(
		{ 'src/a.test.ts': SUITE },
		{ 'src/a.test.ts': `${SUITE}it('c', () => {});\n` }
	);
	const clean = run('report-test-changes.mjs', root, '--base', 'main');
	assert.equal(clean.status, 0, clean.stderr);
	assert.match(clean.stdout, /Nothing found: no test file deleted, .* \(1 test files compared\)/);
	const missing = run('report-test-changes.mjs', root, '--base', 'origin/nowhere');
	assert.equal(missing.status, 2);
	assert.match(missing.stderr, /Cannot find a merge base .* Fetch the base/);
});

test('test changes: reads from the merge base, nets a move into a new file, and takes literal paths', () => {
	const { root, git, commit } = history(
		{
			'src/both.test.ts': SUITE,
			'app/[id]/page.test.ts': SUITE,
			'app/i/page.test.ts': SUITE,
			'src/__snapshots__/a.snap': 'exports[`a`] = `1`;\n',
			'playwright.config.ts': 'export default { retries: 0 };\n',
			'src/__snapshots__/b.snap': 'exports[`b`] = `\n---\nkept\n`;\n',
		},
		{}
	);
	// Main adds a test after the branch starts: diffed from main itself, it would read as
	// the branch deleting it.
	git('switch', '-q', 'main');
	writeFileSync(join(root, 'src/main-new.test.ts'), SUITE);
	git('add', '-A');
	commit('main moves on');
	git('switch', '-q', 'work');
	// The branch moves test 'b' into a new file and edits only the bracketed path's file.
	writeFileSync(join(root, 'src/both.test.ts'), "it('a', () => { expect(1).toBe(1); });\n");
	writeFileSync(join(root, 'src/moved.test.ts'), "it('b', () => { expect(2).toBe(2); });\n");
	writeFileSync(join(root, 'src/born-skipped.test.ts'), "it.skip('c', () => {});\n");
	// A new file with only a conditional skip runs where it can; a new conftest can drop tests.
	mkdirSync(join(root, 'py'));
	writeFileSync(
		join(root, 'py/test_opt.py'),
		'yaml = pytest.importorskip("yaml")\n\ndef test_a():\n    assert yaml\n'
	);
	writeFileSync(join(root, 'py/conftest.py'), 'collect_ignore_glob = ["test_*.py"]\n');
	writeFileSync(join(root, 'app/[id]/page.test.ts'), "it('a', () => { expect(1).toBe(1); });\n");
	// Read as a glob, `app/[id]` would also match this file and quote its removed line.
	writeFileSync(join(root, 'app/i/page.test.ts'), SUITE.replace("it('b'", "it('b2'"));
	writeFileSync(
		join(root, 'src/__snapshots__/a.snap'),
		'exports[`a`] = `1`;\nexports[`b`] = `2`;\n'
	);
	writeFileSync(join(root, 'playwright.config.ts'), 'export default { retries: 3 };\n');
	// A removed `---` line is content, not a diff header.
	writeFileSync(join(root, 'src/__snapshots__/b.snap'), 'exports[`b`] = `\nkept\n`;\n');
	git('add', '-A');
	commit('work');
	const result = run('report-test-changes.mjs', root, '--base', 'main', '--head', 'work', '--json');
	assert.equal(result.status, 0, result.stderr);
	const report = JSON.parse(result.stdout);
	assert.deepEqual(report.findings.map(({ file, kind }) => `${kind} ${file}`).sort(), [
		'config-changed playwright.config.ts',
		'config-changed py/conftest.py',
		'fewer-assertions app/[id]/page.test.ts',
		'fewer-assertions src/both.test.ts',
		'fewer-tests app/[id]/page.test.ts',
		'fewer-tests src/both.test.ts',
		'skip-added src/born-skipped.test.ts',
		'snapshot-changed src/__snapshots__/b.snap',
	]);
	// Only the bracketed file's own line is quoted, not app/i's.
	const bracket = report.findings.find((finding) => finding.file === 'app/[id]/page.test.ts');
	assert.deepEqual(bracket.lines, [{ line: 2, text: "it('b', () => { expect(2).toBe(2); });" }]);
	// The new file enters the totals, so the move nets out: only app/[id]'s test is gone.
	assert.deepEqual(report.totals.JavaScript, {
		files: 5,
		before: { tests: 6, assertions: 6, skips: 0 },
		after: { tests: 6, assertions: 5, skips: 1 },
	});
	const snapshot = report.findings.find((finding) => finding.kind === 'snapshot-changed');
	assert.equal(snapshot.detail, '1 lines removed, 0 added');
	const configs = report.findings.filter((finding) => finding.kind === 'config-changed');
	assert.deepEqual(
		configs.map(({ detail, lines }) => [detail, lines[0].text]),
		[
			['1 lines removed, 1 added', 'export default { retries: 0 };'],
			['new, 1 lines', 'collect_ignore_glob = ["test_*.py"]'],
		]
	);
});

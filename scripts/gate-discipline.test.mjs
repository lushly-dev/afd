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

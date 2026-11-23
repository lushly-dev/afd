import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
	extractCrossUnitReads,
	stripComments,
	workflowInputProblems,
} from './check-workflow-inputs.mjs';

const repository = join(import.meta.dirname, '..');

function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), 'afd-workflow-inputs-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const files = [];
	const write = (rel, content) => {
		mkdirSync(dirname(join(root, rel)), { recursive: true });
		writeFileSync(join(root, rel), content);
		files.push(rel);
	};
	const listFiles = (_root, dirs) =>
		files.filter((file) => dirs.some((dir) => file === dir || file.startsWith(`${dir}/`)));
	return { root, write, listFiles };
}

test('every path-filtered workflow in this repository covers its cross-unit inputs (#1798)', () => {
	assert.deepEqual(workflowInputProblems(repository), []);
});

test('extractCrossUnitReads catches spec/ literals, joined spec segments, relative parent reads, and CMake paths while ignoring comments', (t) => {
	const { root, write } = fixture(t);
	write('spec/meta-tools.json', '{}\n');
	write('spec/VERSION', '1.0.0\n');
	write('spec/authorization.md', '# doc\n');
	write('scripts/helper.mjs', 'export const ok = true;\n');

	const pyReads = extractCrossUnitReads(
		'python/tests/test_meta.py',
		[
			'"""Docstring citing spec/authorization.md."""',
			'# Comment citing spec/VERSION',
			'META = Path(__file__).resolve().parents[2] / "spec" / "meta-tools.json"',
		].join('\n'),
		{ root, ownDirs: ['python'] }
	);
	assert.deepEqual(pyReads, [
		{ file: 'python/tests/test_meta.py', target: 'spec/meta-tools.json', isDir: false },
	]);

	const jsReads = extractCrossUnitReads(
		'tests/consumers/pkg/verify.mjs',
		[
			'// comment: ../../../spec/authorization.md',
			"import { ok } from '../../../scripts/helper.mjs';",
			'console.log(ok);',
		].join('\n'),
		{ root, ownDirs: ['tests/consumers/pkg'] }
	);
	assert.deepEqual(jsReads, [
		{ file: 'tests/consumers/pkg/verify.mjs', target: 'scripts/helper.mjs', isDir: false },
	]);

	const cmakeReads = extractCrossUnitReads(
		'packages/cpp/tests/CMakeLists.txt',
		[
			'# comment: ${CMAKE_CURRENT_SOURCE_DIR}/../../../spec/authorization.md',
			'set(META "${CMAKE_CURRENT_SOURCE_DIR}/../../../spec/meta-tools.json")',
		].join('\n'),
		{ root, ownDirs: ['packages/cpp'] }
	);
	assert.deepEqual(cmakeReads, [
		{ file: 'packages/cpp/tests/CMakeLists.txt', target: 'spec/meta-tools.json', isDir: false },
	]);

	assert.equal(stripComments('const x = "a//b"; // c', 'a.ts').trim(), 'const x = "a//b";');
});

test('extractCrossUnitReads skips a path git ignores, such as a local Cargo target folder', (t) => {
	const { root, write } = fixture(t);
	// A fixture must not inherit a hook's GIT_DIR, which would point git at this repository.
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([name]) => !/^git_/i.test(name))
	);
	const git = (...args) => execFileSync('git', args, { cwd: root, env, stdio: 'ignore' });
	git('init', '-q');
	write('endpoints/umbel/target/debug/umbel', 'binary\n');
	write('endpoints/gen/schema.json', '{}\n');
	write('scripts/helper.mjs', 'export const ok = true;\n');
	const source = [
		"const target = path.join(__dirname, '../../../endpoints/umbel/target');",
		"const schema = '../../../endpoints/gen/schema.json';",
		"import { ok } from '../../../scripts/helper.mjs';",
	].join('\n');
	const read = () =>
		extractCrossUnitReads('packages/examples/dx/run.ts', source, {
			root,
			ownDirs: ['packages/examples'],
		}).map((entry) => entry.target);

	// Nothing ignored yet: the build folder counts as a read.
	assert.deepEqual(read(), [
		'endpoints/gen/schema.json',
		'endpoints/umbel/target',
		'scripts/helper.mjs',
	]);

	// Ignored output is skipped, but a tracked file under an ignored pattern is still an input.
	writeFileSync(join(root, '.gitignore'), 'endpoints/umbel/target/\nendpoints/gen/\n');
	git('add', '-f', 'endpoints/gen/schema.json');
	assert.deepEqual(read(), ['endpoints/gen/schema.json', 'scripts/helper.mjs']);
});

test('extractCrossUnitReads takes no ignore rules from a repository enclosing a plain folder', (t) => {
	const outer = mkdtempSync(join(tmpdir(), 'afd-workflow-inputs-outer-'));
	t.after(() => rmSync(outer, { recursive: true, force: true }));
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([name]) => !/^git_/i.test(name))
	);
	execFileSync('git', ['init', '-q'], { cwd: outer, env, stdio: 'ignore' });
	writeFileSync(join(outer, '.gitignore'), 'target/\n');
	const root = join(outer, 'plain');
	mkdirSync(join(root, 'endpoints/umbel/target'), { recursive: true });
	const reads = extractCrossUnitReads(
		'packages/examples/dx/run.ts',
		"const target = '../../../endpoints/umbel/target';",
		{ root, ownDirs: ['packages/examples'] }
	);
	assert.deepEqual(
		reads.map((entry) => entry.target),
		['endpoints/umbel/target']
	);
});

test('extractCrossUnitReads and workflowInputProblems resolve CARGO_MANIFEST_DIR and PROJECT_SOURCE_DIR reads (#1798)', (t) => {
	const { root, write, listFiles } = fixture(t);
	write('spec/VERSION', '1.0.0\n');
	write('spec/meta-tools.json', '{}\n');
	write('spec/authorization.json', '{}\n');
	write('spec/vectors/dispatch.json', '{}\n');
	write('packages/examples/todo/spec/commands.schema.json', '{}\n');
	write('packages/rust/Cargo.toml', '[package]\nname = "afd"\n');
	write(
		'packages/rust/tests/dispatch_vectors.rs',
		[
			'//! See `spec/dispatch.md`.',
			'let a = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../spec/vectors/dispatch.json");',
			'let b = concat!(env!("CARGO_MANIFEST_DIR"), "/../../spec/authorization.json");',
		].join('\n')
	);
	write('packages/cpp/CMakeLists.txt', 'cmake_minimum_required(VERSION 3.22)\nproject(afd)\n');
	write(
		'packages/cpp/tests/CMakeLists.txt',
		[
			'cmake_path(SET v NORMALIZE "${PROJECT_SOURCE_DIR}/../../spec/VERSION")',
			'cmake_path(SET todo NORMALIZE "${PROJECT_SOURCE_DIR}/../examples/todo/spec")',
		].join('\n')
	);

	const rustReads = extractCrossUnitReads(
		'packages/rust/tests/dispatch_vectors.rs',
		[
			'//! See `spec/dispatch.md`.',
			'let a = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../spec/vectors/dispatch.json");',
			'let b = concat!(env!("CARGO_MANIFEST_DIR"), "/../../spec/authorization.json");',
		].join('\n'),
		{ root, ownDirs: ['packages/rust'] }
	);
	assert.deepEqual(rustReads, [
		{
			file: 'packages/rust/tests/dispatch_vectors.rs',
			target: 'spec/authorization.json',
			isDir: false,
		},
		{
			file: 'packages/rust/tests/dispatch_vectors.rs',
			target: 'spec/vectors/dispatch.json',
			isDir: false,
		},
	]);

	const cppReads = extractCrossUnitReads(
		'packages/cpp/tests/CMakeLists.txt',
		[
			'cmake_path(SET v NORMALIZE "${PROJECT_SOURCE_DIR}/../../spec/VERSION")',
			'cmake_path(SET todo NORMALIZE "${PROJECT_SOURCE_DIR}/../examples/todo/spec")',
		].join('\n'),
		{ root, ownDirs: ['packages/cpp'] }
	);
	assert.deepEqual(cppReads, [
		{
			file: 'packages/cpp/tests/CMakeLists.txt',
			target: 'packages/examples/todo/spec',
			isDir: true,
		},
		{ file: 'packages/cpp/tests/CMakeLists.txt', target: 'spec/VERSION', isDir: false },
	]);

	const makeWorkflow = (paths) =>
		[
			'name: Test',
			'on:',
			'  push:',
			'    branches: [main]',
			'    paths:',
			...paths.map((p) => `      - '${p}'`),
			'  pull_request:',
			'    branches: [main]',
			'    paths:',
			...paths.map((p) => `      - '${p}'`),
		].join('\n');

	// Excluding spec/vectors/dispatch.json from rust.yml or packages/examples/todo/spec/** from cpp.yml fails.
	write(
		'.github/workflows/rust.yml',
		makeWorkflow(['packages/rust/**', 'spec/**', '!spec/**/*.md', '!spec/vectors/dispatch.json'])
	);
	write('.github/workflows/cpp.yml', makeWorkflow(['packages/cpp/**', 'spec/**', '!spec/**/*.md']));
	const units = {
		'rust.yml': { dirs: ['packages/rust'] },
		'cpp.yml': { dirs: ['packages/cpp'] },
	};
	const suites = [{ workflow: 'rust.yml' }, { workflow: 'cpp.yml' }];

	const problems = workflowInputProblems(root, {
		workflowUnits: units,
		specWorkflows: ['rust.yml', 'cpp.yml'],
		nonWorkflowReads: [],
		scopedDirectoryReads: [],
		suites,
		listFiles,
	});
	assert.ok(
		problems.some((p) => p.includes('rust.yml') && p.includes('spec/vectors/dispatch.json')),
		`expected rust.yml dispatch.json miss, got: ${problems.join('\n')}`
	);
	assert.ok(
		problems.some((p) => p.includes('cpp.yml') && p.includes('packages/examples/todo/spec/')),
		`expected cpp.yml todo/spec miss, got: ${problems.join('\n')}`
	);

	// Covering both passes cleanly.
	write(
		'.github/workflows/rust.yml',
		makeWorkflow(['packages/rust/**', 'spec/**', '!spec/**/*.md'])
	);
	write(
		'.github/workflows/cpp.yml',
		makeWorkflow(['packages/cpp/**', 'spec/**', '!spec/**/*.md', 'packages/examples/todo/spec/**'])
	);
	assert.deepEqual(
		workflowInputProblems(root, {
			workflowUnits: units,
			specWorkflows: ['rust.yml', 'cpp.yml'],
			nonWorkflowReads: [],
			scopedDirectoryReads: [],
			suites,
			listFiles,
		}),
		[]
	);
});

test('workflowInputProblems fails on a planted uncovered read, passes when covered, and invalidates stale exemptions', (t) => {
	const { root, write, listFiles } = fixture(t);
	write('spec/meta-tools.json', '{}\n');
	write('scripts/shared.mjs', 'export const x = 1;\n');
	write(
		'python/tests/test_meta.py',
		'META = Path(__file__).parents[2] / "spec" / "meta-tools.json"\n'
	);
	write('unit/test.mjs', "import '../scripts/shared.mjs';\n");

	const makeWorkflow = (paths) =>
		[
			'name: Test',
			'on:',
			'  push:',
			'    branches: [main]',
			'    paths:',
			...paths.map((p) => `      - '${p}'`),
			'  pull_request:',
			'    branches: [main]',
			'    paths:',
			...paths.map((p) => `      - '${p}'`),
		].join('\n');

	// Planted miss: python.yml omits spec/meta-tools.json and unit.yml omits scripts/shared.mjs.
	write('.github/workflows/python.yml', makeWorkflow(['python/**', 'spec/wire/**']));
	write('.github/workflows/unit.yml', makeWorkflow(['unit/**']));
	const units = {
		'python.yml': { dirs: ['python'] },
		'unit.yml': { dirs: ['unit'] },
	};
	const suites = [{ workflow: 'python.yml' }, { workflow: 'unit.yml' }];

	const missed = workflowInputProblems(root, {
		workflowUnits: units,
		specWorkflows: ['python.yml'],
		nonWorkflowReads: [],
		scopedDirectoryReads: [],
		suites,
		listFiles,
	});
	assert.ok(
		missed.some((p) => p.includes('python.yml') && p.includes('spec/meta-tools.json')),
		`expected python.yml miss, got: ${missed.join('\n')}`
	);
	assert.ok(
		missed.some((p) => p.includes('unit.yml') && p.includes('scripts/shared.mjs')),
		`expected unit.yml miss, got: ${missed.join('\n')}`
	);

	// Covered: both workflows list their inputs, passing cleanly.
	write('.github/workflows/python.yml', makeWorkflow(['python/**', 'spec/**', '!spec/**/*.md']));
	write('.github/workflows/unit.yml', makeWorkflow(['unit/**', 'scripts/shared.mjs']));
	assert.deepEqual(
		workflowInputProblems(root, {
			workflowUnits: units,
			specWorkflows: ['python.yml'],
			nonWorkflowReads: [],
			scopedDirectoryReads: [],
			suites,
			listFiles,
		}),
		[]
	);

	// Stale exemption fails loudly.
	const stale = workflowInputProblems(root, {
		workflowUnits: units,
		specWorkflows: ['python.yml'],
		nonWorkflowReads: [
			{
				workflow: 'unit.yml',
				file: 'unit/test.mjs',
				target: 'spec/meta-tools.json',
				ownerWorkflow: 'python.yml',
				reason: 'stale',
			},
		],
		scopedDirectoryReads: [],
		suites,
		listFiles,
	});
	assert.ok(
		stale.some((p) => p.includes('stale exemption')),
		`expected stale exemption error, got: ${stale.join('\n')}`
	);
});

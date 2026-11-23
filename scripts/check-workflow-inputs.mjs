#!/usr/bin/env node
/**
 * Checks that every path-filtered workflow's `pull_request.paths` (and `push.paths`, when
 * present) covers every cross-unit input its suite's sources read (#1798), and that every
 * language workflow plus Conformance covers non-Markdown files under `spec/**`.
 *
 *   node scripts/check-workflow-inputs.mjs      check .github/workflows; exit 1 on any miss
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchesFilters, readEventPaths, readTrigger, SUITES } from './affected/suites.mjs';

/**
 * Every path-filtered workflow in SUITES mapped to the unit directories its suites live in.
 * Reconciled against SUITES so a new workflow cannot escape this check.
 */
export const WORKFLOW_UNITS = {
	'alfred.yml': { dirs: ['alfred'] },
	'auth-browser.yml': { dirs: ['packages/auth'] },
	'botcore.yml': { dirs: ['endpoints/botcore'] },
	'botcore-factory.yml': { dirs: ['endpoints/botcore/plugins/botcore-factory'] },
	'conformance.yml': {
		dirs: ['packages/examples/todo', 'packages/examples/todo-directclient', 'tests/consumers/afd'],
	},
	'cpp.yml': { dirs: ['packages/cpp'] },
	'fast-af.yml': { dirs: ['foundations/fast-af', 'tests/consumers/fast-af'] },
	'health.yml': { dirs: ['endpoints/health'] },
	'health-dashboard.yml': { dirs: ['endpoints/health-dashboard'] },
	'hosted-fixtures.yml': { dirs: ['scripts/hosted'] },
	'loam.yml': { dirs: ['endpoints/loam'], excludeDirs: ['endpoints/loam/plugins'] },
	'loam-desktop.yml': { dirs: ['endpoints/loam/packages/desktop'] },
	'loam-plugins.yml': { dirs: ['endpoints/loam/plugins'] },
	'python.yml': { dirs: ['python'] },
	'rust.yml': { dirs: ['packages/rust'] },
	'specimen.yml': {
		dirs: [
			'foundations/specimen',
			'integrations/specimen-afd',
			'integrations/specimen-fast-af',
			'endpoints/specimen-cli',
			'tests/consumers/specimen',
		],
	},
	'umbel.yml': { dirs: ['endpoints/umbel'] },
	'violet.yml': {
		dirs: [
			'foundations/violet',
			'integrations/violet-afd',
			'endpoints/violet-cli',
			'endpoints/violet-server',
			'tests/consumers/violet',
		],
	},
};

/**
 * Language workflows and Conformance must cover every non-Markdown file under `spec/**` (#1798).
 */
export const SPEC_WORKFLOWS = ['python.yml', 'rust.yml', 'cpp.yml', 'conformance.yml'];

const SPEC_PROBES = [
	'spec/VERSION',
	'spec/meta-tools.json',
	'spec/authorization.json',
	'spec/protocol-conformance.json',
	'spec/wire/__probe__.json',
	'spec/vectors/__probe__.json',
	'spec/schema/__probe__.json',
];

/**
 * Files sitting inside one workflow's unit tree that are executed only by another workflow.
 * Self-invalidating: fails if the file stops reading the target or if `ownerWorkflow` stops
 * covering it.
 */
export const NON_WORKFLOW_READS = [
	{
		workflow: 'conformance.yml',
		file: 'packages/examples/todo/dx/run-conformance.ts',
		target: 'endpoints/umbel/tests/fixtures/plugins/todo-http',
		ownerWorkflow: 'umbel.yml',
		reason: 'only invoked by test:conformance:umbel in umbel.yml',
	},
	{
		workflow: 'auth-browser.yml',
		file: 'packages/auth/hosted/convex/check.mjs',
		target: 'scripts/release/exec-tool.mjs',
		ownerWorkflow: 'hosted-fixtures.yml',
		reason: 'only invoked by hosted-fixtures.yml',
	},
];

/**
 * Helpers that return an external package root directory while callers read only specific
 * subpaths inside it. Every listed subpath is still checked against both pull_request.paths
 * and push.paths, and the entry fails loudly if the helper stops referencing `target`.
 */
export const SCOPED_DIRECTORY_READS = [
	{
		workflow: 'umbel.yml',
		file: 'endpoints/umbel/plugins/components/tests/support/mod.rs',
		target: 'foundations/fast-af/packages/violet-elements',
		subpaths: [
			'foundations/fast-af/packages/violet-elements/pack',
			'foundations/fast-af/packages/violet-elements/specimen.config.json',
			'foundations/fast-af/packages/violet-elements/package.json',
		],
		reason:
			'fast_af_library() returns the package root; tests read only pack/, specimen.config.json, and package.json',
	},
];

const CODE_FILE = /\.(?:[cm]?[jt]sx?|py|rs|cpp|hpp|c|h|cmake|sh|toml)$/i;
const LAYER_ROOTS = new Set([
	'packages',
	'endpoints',
	'foundations',
	'integrations',
	'tests',
	'scripts',
	'docs',
	'spec',
]);
const SKIP_TARGETS = new Set(['tsconfig.json']);

function isScannedFile(file, excludeDirs = []) {
	if (file.includes('/provenance/') || file.includes('/docs/') || file.endsWith('.lock'))
		return false;
	if (excludeDirs.some((dir) => file === dir || file.startsWith(`${dir}/`))) return false;
	return CODE_FILE.test(file) || file.endsWith('/CMakeLists.txt') || file === 'CMakeLists.txt';
}

/**
 * Strip comments (and Python triple-quoted docstrings) while preserving string literals so prose
 * citations like `// see spec/authorization.md` do not masquerade as file reads.
 */
export function stripComments(text, file) {
	if (file.endsWith('.py')) {
		let out = '';
		for (let i = 0; i < text.length; ) {
			const three = text.slice(i, i + 3);
			if (three === '"""' || three === "'''") {
				const end = text.indexOf(three, i + 3);
				if (end === -1) break;
				out += ' ';
				i = end + 3;
				continue;
			}
			const ch = text[i];
			if (ch === '#') {
				const nl = text.indexOf('\n', i);
				if (nl === -1) break;
				out += '\n';
				i = nl + 1;
				continue;
			}
			if (ch === '"' || ch === "'") {
				let j = i + 1;
				while (j < text.length && text[j] !== ch && text[j] !== '\n') {
					j += text[j] === '\\' ? 2 : 1;
				}
				out += text.slice(i, j + 1);
				i = j + 1;
				continue;
			}
			out += ch;
			i++;
		}
		return out;
	}
	if (
		file.endsWith('.cmake') ||
		file.endsWith('CMakeLists.txt') ||
		file.endsWith('.toml') ||
		file.endsWith('.sh')
	) {
		let out = '';
		for (let i = 0; i < text.length; ) {
			const ch = text[i];
			if (ch === '#') {
				const nl = text.indexOf('\n', i);
				if (nl === -1) break;
				out += '\n';
				i = nl + 1;
				continue;
			}
			if (ch === '"' || ch === "'") {
				let j = i + 1;
				while (j < text.length && text[j] !== ch && text[j] !== '\n') {
					j += text[j] === '\\' ? 2 : 1;
				}
				out += text.slice(i, j + 1);
				i = j + 1;
				continue;
			}
			out += ch;
			i++;
		}
		return out;
	}
	// C-family / JS / TS / Rust
	const isRust = file.endsWith('.rs');
	let out = '';
	for (let i = 0; i < text.length; ) {
		const ch = text[i];
		const next = text[i + 1];
		if (ch === '/' && next === '/') {
			const nl = text.indexOf('\n', i);
			if (nl === -1) break;
			out += '\n';
			i = nl + 1;
			continue;
		}
		if (ch === '/' && next === '*') {
			const end = text.indexOf('*/', i + 2);
			if (end === -1) break;
			out += ' ';
			i = end + 2;
			continue;
		}
		// Rust raw string literals: r"...", r#"..."#, etc.
		if (isRust && ch === 'r' && (next === '"' || next === '#')) {
			let hashes = 0;
			let j = i + 1;
			while (text[j] === '#') {
				hashes++;
				j++;
			}
			if (text[j] === '"') {
				const close = `"${'#'.repeat(hashes)}`;
				const end = text.indexOf(close, j + 1);
				if (end === -1) {
					out += text.slice(i);
					break;
				}
				out += text.slice(i, end + close.length);
				i = end + close.length;
				continue;
			}
		}
		// In Rust, `'` starts a lifetime ('a, 'static) or a single-line char literal, never a path string.
		if (ch === '"' || (!isRust && (ch === "'" || ch === '`'))) {
			const multiline = ch === '`';
			let j = i + 1;
			while (j < text.length && text[j] !== ch && (multiline || text[j] !== '\n')) {
				j += text[j] === '\\' ? 2 : 1;
			}
			out += text.slice(i, j + 1);
			i = j + 1;
			continue;
		}
		out += ch;
		i++;
	}
	return out;
}

function findNearestAncestorDir(file, predicate) {
	let dir = posix.dirname(file);
	while (dir && dir !== '.') {
		if (predicate(dir)) return dir;
		const parent = posix.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

function findCargoManifestDir(root, file) {
	return findNearestAncestorDir(file, (dir) => existsSync(join(root, dir, 'Cargo.toml')));
}

function findCmakeProjectDir(root, file, ownDirs) {
	const found = findNearestAncestorDir(file, (dir) => {
		const cmake = join(root, dir, 'CMakeLists.txt');
		return existsSync(cmake) && /\bproject\s*\(/i.test(readFileSync(cmake, 'utf8'));
	});
	if (found) return found;
	return ownDirs.find((dir) => file === dir || file.startsWith(`${dir}/`)) ?? posix.dirname(file);
}

/**
 * Extract repository-relative paths read outside `ownDirs` from a single source/test/build file.
 */
export function extractCrossUnitReads(file, text, { root, ownDirs }) {
	const cleaned = stripComments(text, file);
	const candidates = new Set();
	const fileDir = posix.dirname(file);
	const cargoDir =
		file.endsWith('.rs') && cleaned.includes('CARGO_MANIFEST_DIR')
			? (findCargoManifestDir(root, file) ??
				ownDirs.find((dir) => file === dir || file.startsWith(`${dir}/`)))
			: null;

	// 1. Direct string literals starting with `spec/` or `../` (or `/../` in Rust concat!(CARGO_MANIFEST_DIR, "/../../...")).
	for (const match of cleaned.matchAll(/['"`](\/?(?:(?:\.\.\/)+|spec\/)[^'"`\s${}()\\]+)['"`]/g)) {
		const raw = match[1].replace(/^\//, '').replace(/[.,;:)]+$/, '');
		if (raw.startsWith('spec/')) {
			candidates.add(posix.normalize(raw));
			continue;
		}
		const fromFile = posix.normalize(posix.join(fileDir, raw));
		if (existsSync(join(root, fromFile))) {
			candidates.add(fromFile);
		} else if (cargoDir) {
			candidates.add(posix.normalize(posix.join(cargoDir, raw)));
		} else {
			candidates.add(fromFile);
		}
	}

	// 2. Multi-segment path joins mentioning `"spec"` followed by literal segments:
	//    e.g. `parents[2] / "spec" / "meta-tools.json"` or `join(..., 'spec', 'wire')`.
	for (const match of cleaned.matchAll(/['"]spec['"]((?:\s*(?:\/|,)\s*['"][^'"\s/\\]+['"])+)/g)) {
		const segments = [...match[1].matchAll(/['"]([^'"\s/\\]+)['"]/g)].map((part) => part[1]);
		if (segments.length > 0) candidates.add(posix.join('spec', ...segments));
	}

	// 3. CMake variable-anchored parent paths like `${PROJECT_SOURCE_DIR}/../../spec/meta-tools.json`
	//    or `${CMAKE_CURRENT_SOURCE_DIR}/../../../spec/meta-tools.json`.
	if (file.endsWith('CMakeLists.txt') || file.endsWith('.cmake')) {
		let projectDir;
		for (const match of cleaned.matchAll(/\$\{([^}]+)\}\/((?:\.\.\/)+[^\s"')]+\b)/g)) {
			const variable = match[1];
			const rel = match[2];
			let base = fileDir;
			if (variable === 'PROJECT_SOURCE_DIR' || variable === 'CMAKE_SOURCE_DIR') {
				if (projectDir === undefined) projectDir = findCmakeProjectDir(root, file, ownDirs);
				base = projectDir;
			}
			candidates.add(posix.normalize(posix.join(base, rel)));
		}
	}

	const reads = [];
	for (const candidate of candidates) {
		const target = candidate.replace(/\/+$/, '');
		if (!target || target === '.' || target.startsWith('..')) continue;
		if (LAYER_ROOTS.has(target) || SKIP_TARGETS.has(target)) continue;
		if (ownDirs.some((dir) => target === dir || target.startsWith(`${dir}/`))) continue;
		const full = join(root, target);
		if (!existsSync(full)) continue;
		const isDir = statSync(full).isDirectory();
		reads.push({ file, target, isDir });
	}
	return reads.sort((a, b) => a.target.localeCompare(b.target));
}

/** Read the `push.paths` list of a workflow, or null when push has no path filter. */
export function readPushPaths(text) {
	return readEventPaths(text, 'push') ?? null;
}

function listTrackedFiles(root, dirs) {
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([name]) => !/^git_/i.test(name))
	);
	const output = execFileSync('git', ['ls-files', '--', ...dirs], {
		cwd: root,
		env,
		encoding: 'utf8',
	});
	return output.split(/\r?\n/).filter(Boolean);
}

function covers(paths, target, isDir) {
	if (paths === null) return true;
	const probe = isDir ? posix.join(target, '__probe__.json') : target;
	return matchesFilters(paths, probe);
}

/**
 * Every uncovered cross-unit input across the repository's path-filtered workflows.
 */
export function workflowInputProblems(
	root,
	{
		workflowUnits = WORKFLOW_UNITS,
		specWorkflows = SPEC_WORKFLOWS,
		nonWorkflowReads = NON_WORKFLOW_READS,
		scopedDirectoryReads = SCOPED_DIRECTORY_READS,
		suites = SUITES,
		listFiles = listTrackedFiles,
	} = {}
) {
	const problems = [];
	const unitWorkflows = Object.keys(workflowUnits).sort();
	if (unitWorkflows.length === 0) {
		problems.push('WORKFLOW_UNITS is empty');
		return problems;
	}

	// Reconcile WORKFLOW_UNITS against SUITES in both directions.
	const suiteWorkflows = new Set(suites.map((suite) => suite.workflow));
	for (const wf of suiteWorkflows) {
		if (!workflowUnits[wf])
			problems.push(`${wf}: listed in scripts/affected/suites.mjs but missing from WORKFLOW_UNITS`);
	}
	for (const wf of unitWorkflows) {
		if (!suiteWorkflows.has(wf))
			problems.push(`${wf}: listed in WORKFLOW_UNITS but missing from scripts/affected/suites.mjs`);
	}

	const triggers = new Map();
	const pushPaths = new Map();
	for (const wf of unitWorkflows) {
		const wfPath = join(root, '.github/workflows', wf);
		if (!existsSync(wfPath)) {
			problems.push(`${wf}: workflow file is missing`);
			continue;
		}
		const text = readFileSync(wfPath, 'utf8');
		const trigger = readTrigger(text);
		if (!trigger) {
			problems.push(`${wf}: has no pull_request trigger`);
			continue;
		}
		triggers.set(wf, trigger);
		pushPaths.set(wf, readPushPaths(text));
	}

	// Check every language workflow + Conformance covers non-Markdown spec/**.
	for (const wf of specWorkflows) {
		const trigger = triggers.get(wf);
		if (!trigger) continue;
		for (const probe of SPEC_PROBES) {
			if (!covers(trigger.paths, probe, false)) {
				problems.push(`${wf}: pull_request.paths does not cover ${probe} (expected spec/**)`);
			}
			const push = pushPaths.get(wf);
			if (push && !covers(push, probe, false)) {
				problems.push(`${wf}: push.paths does not cover ${probe} (expected spec/**)`);
			}
		}
	}

	// Track which exemptions were actually encountered so stale entries fail.
	const seenExemptions = new Set();
	const seenScoped = new Set();

	for (const wf of unitWorkflows) {
		const trigger = triggers.get(wf);
		if (!trigger) continue;
		const { dirs, excludeDirs = [] } = workflowUnits[wf];
		const files = listFiles(root, dirs).filter((file) => isScannedFile(file, excludeDirs));
		if (files.length === 0) {
			problems.push(`${wf}: scanned zero source files under ${dirs.join(', ')}`);
			continue;
		}
		const push = pushPaths.get(wf);
		for (const file of files) {
			const full = join(root, file);
			if (!existsSync(full)) continue;
			const text = readFileSync(full, 'utf8');
			for (const read of extractCrossUnitReads(file, text, { root, ownDirs: dirs })) {
				const exemptionIndex = nonWorkflowReads.findIndex(
					(entry) =>
						entry.workflow === wf && entry.file === read.file && entry.target === read.target
				);
				if (exemptionIndex !== -1) {
					seenExemptions.add(exemptionIndex);
					continue;
				}
				const scopedIndex = scopedDirectoryReads.findIndex(
					(entry) =>
						entry.workflow === wf && entry.file === read.file && entry.target === read.target
				);
				const targets =
					scopedIndex !== -1
						? (() => {
								seenScoped.add(scopedIndex);
								return scopedDirectoryReads[scopedIndex].subpaths.map((subpath) => {
									const subFull = join(root, subpath);
									return {
										target: subpath,
										isDir: existsSync(subFull) && statSync(subFull).isDirectory(),
									};
								});
							})()
						: [{ target: read.target, isDir: read.isDir }];
				for (const item of targets) {
					if (!covers(trigger.paths, item.target, item.isDir)) {
						problems.push(
							`${wf}: ${read.file} reads ${item.target}${item.isDir ? '/' : ''}, which is not covered by pull_request.paths`
						);
					}
					if (push && !covers(push, item.target, item.isDir)) {
						problems.push(
							`${wf}: ${read.file} reads ${item.target}${item.isDir ? '/' : ''}, which is not covered by push.paths`
						);
					}
				}
			}
		}
	}

	// Self-invalidate stale SCOPED_DIRECTORY_READS entries.
	for (let i = 0; i < scopedDirectoryReads.length; i++) {
		const entry = scopedDirectoryReads[i];
		if (!seenScoped.has(i)) {
			problems.push(
				`SCOPED_DIRECTORY_READS: stale entry for ${entry.workflow} (${entry.file} -> ${entry.target}); remove it`
			);
		}
	}

	// Self-invalidate stale NON_WORKFLOW_READS exemptions and confirm ownerWorkflow covers them.
	for (let i = 0; i < nonWorkflowReads.length; i++) {
		const entry = nonWorkflowReads[i];
		if (!seenExemptions.has(i)) {
			problems.push(
				`NON_WORKFLOW_READS: stale exemption for ${entry.workflow} (${entry.file} -> ${entry.target}); remove it`
			);
			continue;
		}
		const ownerTrigger = triggers.get(entry.ownerWorkflow);
		const full = join(root, entry.target);
		const isDir = existsSync(full) && statSync(full).isDirectory();
		if (!ownerTrigger || !covers(ownerTrigger.paths, entry.target, isDir)) {
			problems.push(
				`NON_WORKFLOW_READS: owner workflow ${entry.ownerWorkflow} does not cover ${entry.target} (exempted from ${entry.workflow})`
			);
		}
	}

	return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
	const problems = workflowInputProblems(root);
	for (const problem of problems) console.error(`check-workflow-inputs: ${problem}`);
	if (problems.length > 0) process.exitCode = 1;
	else
		console.log(
			`check-workflow-inputs: ${Object.keys(WORKFLOW_UNITS).length} workflow(s) cover every detected cross-unit input`
		);
}

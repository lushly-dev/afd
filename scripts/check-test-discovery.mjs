#!/usr/bin/env node
/**
 * Every tracked test file must be claimed by an active test runner.
 *
 * The discovery half of the zero-tests guard: `check-test-configs.mjs` refuses runners that pass
 * on zero tests, and this check refuses test files that no active runner ever collects, or a
 * package whose suite no workflow or hook starts.
 *
 * Covers JavaScript/TypeScript (Vitest, Vite, Playwright, Jest, `node --test` and active JS
 * launcher scripts), Python (`pytest`), C++ (CMake/CTest) and Rust (Cargo). Reconciles both ways:
 *
 * - Every tracked test file must be claimed by at least one active runner, or registered under
 *   `unrun` in the policy file (default `scripts/policy/test-discovery.json`) with owner, reason
 *   (at least 20 characters) and tracking issue.
 * - Every active runner must claim at least one tracked test file; a runner whose globs or paths
 *   stopped matching anything fails.
 * - Every `unrun` exemption invalidates itself: if its files disappear or become claimed by an
 *   active runner, the entry fails as stale or recovered so it is deleted rather than left behind.
 * - Custom driver scripts listed under `runners` in the policy file must exist, be invoked by a
 *   workflow, hook or active package script (when CI configs exist), and claim at least one file.
 * - An empty test-file set or empty active-runner set fails: the scanner stopped seeing the suite.
 *
 * Needs only Node and git. Usage:
 *   node check-test-discovery.mjs [--root <dir>] [--register <path>] [<path>...]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maskSource, TEST_FILE } from './check-test-quarantine.mjs';
import {
	CPP_TEST_FILE,
	dirOf,
	expandShellBlock,
	extractLefthookCommands,
	extractQuotedString,
	extractWorkflowCommands,
	findMatching,
	gitPath,
	globToRegExp,
	joinPosix,
	loadPackages,
	parseCargoToml,
	parseCmakeTestSources,
	parseJestConfig,
	parsePlaywrightConfig,
	parsePytestConfig,
	parseVitestConfig,
	readText,
	resolveRelativeJsFile,
	splitTopLevel,
	tokenizeShell,
	under,
} from './discovery-parsers.mjs';

export {
	globToRegExp,
	parseCargoToml,
	parseCmakeTestSources,
	parseJestConfig,
	parsePlaywrightConfig,
	parsePytestConfig,
	parseVitestConfig,
};

export const DEFAULT_REGISTER = 'scripts/policy/test-discovery.json';

const PYTHON_TEST_FILE = /(^|\/)(?:test_[^/]*|[^/]*_test)\.py$/;
const CPP_TEST_PATH = /(^|\/)tests?\/|_test\.(?:cpp|cc|cxx)$/;
const RUST_TEST_ATTR = /#\[(?:[\w:]+::)?test\b/;
const DEFAULT_VITEST_INCLUDE = ['**/*.{test,spec}.?(c|m)[jt]s?(x)'];
const UV_VALUE_FLAGS = new Set([
	'--directory',
	'--extra',
	'--group',
	'--index',
	'--package',
	'--project',
	'--python',
	'--resolution',
	'--with',
	'--with-editable',
	'--with-requirements',
]);
const PYTEST_VALUE_FLAGS = new Set([
	'-c',
	'-k',
	'-m',
	'-n',
	'-o',
	'-p',
	'-W',
	'--asyncio-mode',
	'--basetemp',
	'--confcutdir',
	'--cov',
	'--cov-config',
	'--cov-fail-under',
	'--cov-report',
	'--deselect',
	'--durations',
	'--durations-min',
	'--import-mode',
	'--junitxml',
	'--log-cli-level',
	'--log-level',
	'--maxfail',
	'--numprocesses',
	'--override-ini',
	'--rootdir',
	'--tb',
]);

const CONFIG_NAMES = {
	vitest: [
		'vitest.config.ts',
		'vitest.config.mts',
		'vitest.config.cts',
		'vitest.config.js',
		'vitest.config.mjs',
		'vitest.config.cjs',
		'vite.config.ts',
		'vite.config.mts',
		'vite.config.cts',
		'vite.config.js',
		'vite.config.mjs',
		'vite.config.cjs',
	],
	playwright: [
		'playwright.config.ts',
		'playwright.config.mts',
		'playwright.config.js',
		'playwright.config.mjs',
		'playwright.config.cjs',
	],
	jest: [
		'jest.config.ts',
		'jest.config.mts',
		'jest.config.js',
		'jest.config.mjs',
		'jest.config.cjs',
		'jest.config.json',
	],
};

function listRepoFiles(root) {
	const env = { ...process.env };
	for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
	const out = execFileSync(
		'git',
		['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
		{ cwd: root, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 }
	);
	return out.split('\0').filter((file) => file && existsSync(resolve(root, file)));
}

export function loadRegister(root, registerPath) {
	const full = resolve(root, registerPath);
	if (!existsSync(full)) {
		return {
			runners: [],
			unrun: new Map(),
			issues: [
				`${registerPath} is missing. Create it with {"unrun": []} (and optional "runners": []).`,
			],
		};
	}
	let parsed;
	try {
		parsed = JSON.parse(readFileSync(full, 'utf8'));
	} catch (cause) {
		return {
			runners: [],
			unrun: new Map(),
			issues: [`${registerPath} is not valid JSON: ${cause.message}`],
		};
	}
	const issues = [];
	const runners = [];
	const unrun = new Map();
	const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

	for (const entry of parsed.runners ?? []) {
		const { script, include, exclude } = entry ?? {};
		if (
			!nonEmpty(script) ||
			!Array.isArray(include) ||
			include.length === 0 ||
			!include.every(nonEmpty) ||
			(exclude !== undefined && (!Array.isArray(exclude) || !exclude.every(nonEmpty)))
		) {
			issues.push(
				`${registerPath}: malformed runner entry ${JSON.stringify(entry)}; it needs script and a non-empty include array of globs.`
			);
			continue;
		}
		runners.push({
			script: gitPath(script),
			include: include.map(gitPath),
			exclude: (exclude ?? []).map(gitPath),
		});
	}

	for (const entry of parsed.unrun ?? []) {
		const { path, owner, reason, issue } = entry ?? {};
		if (
			!nonEmpty(path) ||
			!nonEmpty(owner) ||
			!nonEmpty(reason) ||
			reason.trim().length < 20 ||
			!nonEmpty(issue)
		) {
			issues.push(
				`${registerPath}: malformed unrun entry ${JSON.stringify(entry)}; it needs path, owner, a reason of at least 20 characters and a tracking issue.`
			);
			continue;
		}
		const key = gitPath(path);
		if (!key || key === '.') {
			issues.push(
				`${registerPath}: unrun path "${path}" normalizes to the repository root; name a specific file or subdirectory.`
			);
			continue;
		}
		if (unrun.has(key)) issues.push(`${registerPath}: ${path} is listed twice.`);
		unrun.set(key, entry);
	}
	return { runners, unrun, issues };
}

/**
 * Checks that every tracked test file is claimed by an active test runner (or registered in
 * `unrun`), and reconciles in both directions.
 */
export function checkTestDiscovery({
	root = process.cwd(),
	register = DEFAULT_REGISTER,
	paths: given = [],
} = {}) {
	const scopePaths = given.map(gitPath).filter(Boolean);
	const listed = listRepoFiles(root);
	const listedSet = new Set(listed);
	const inScope = (file) => scopePaths.length === 0 || scopePaths.some((p) => under(file, p));

	const policy = loadRegister(root, register);
	const issues = [...policy.issues];
	for (const path of scopePaths) {
		if (!listed.some((file) => under(file, path))) {
			issues.push(`${path}: git lists no file there, so nothing was scanned.`);
		}
	}

	// 1. Collect all tracked test files per language.
	const cargoFiles = listed.filter((f) => posix.basename(f) === 'Cargo.toml');
	const cargoDirs = cargoFiles.map(dirOf).sort((a, b) => b.length - a.length);
	const cargoInfo = new Map();
	for (const cf of cargoFiles) {
		const text = readText(root, cf);
		if (text) cargoInfo.set(dirOf(cf), { file: cf, ...parseCargoToml(text) });
	}
	const ownerCrate = (file) => cargoDirs.find((dir) => under(file, dir));

	const allTestFiles = [];
	const testFilesByLang = { JavaScript: [], Python: [], 'C++': [], Rust: [] };
	const rustUnitTestCrates = new Map();

	for (const file of listed) {
		if (TEST_FILE.test(file)) {
			testFilesByLang.JavaScript.push(file);
			allTestFiles.push({ file, lang: 'JavaScript' });
		} else if (PYTHON_TEST_FILE.test(file)) {
			testFilesByLang.Python.push(file);
			allTestFiles.push({ file, lang: 'Python' });
		} else if (CPP_TEST_FILE.test(file) && CPP_TEST_PATH.test(file)) {
			testFilesByLang['C++'].push(file);
			allTestFiles.push({ file, lang: 'C++' });
		} else if (file.endsWith('.rs')) {
			const crateDir = ownerCrate(file);
			if (crateDir === undefined) continue;
			const rel = crateDir ? file.slice(crateDir.length + 1) : file;
			if (rel.startsWith('tests/')) {
				testFilesByLang.Rust.push(file);
				allTestFiles.push({ file, lang: 'Rust', crateDir, kind: 'integration' });
			} else if (rel.startsWith('src/')) {
				const text = readText(root, file);
				if (text && RUST_TEST_ATTR.test(text)) {
					testFilesByLang.Rust.push(file);
					allTestFiles.push({ file, lang: 'Rust', crateDir, kind: 'unit' });
					const list = rustUnitTestCrates.get(crateDir) ?? [];
					list.push(file);
					rustUnitTestCrates.set(crateDir, list);
				}
			}
		}
	}

	const scopedTests = allTestFiles.filter(({ file }) => inScope(file));
	const scopedTestSet = new Set(scopedTests.map(({ file }) => file));
	const allTestSet = new Set(allTestFiles.map(({ file }) => file));

	// 2. Discover active runners from CI workflows + lefthook.yml (or standalone configs when none exist).
	const { packages, byName, byDir, hasWorkspace } = loadPackages(root, listed, listedSet);
	const workflowFiles = listed.filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f));
	const lefthookFiles = listed.filter((f) => /^lefthook\.ya?ml$/.test(f));
	const hasCI = workflowFiles.length > 0 || lefthookFiles.length > 0;

	const lefthookSections = new Map();
	for (const lh of lefthookFiles) {
		const text = readText(root, lh);
		if (!text) continue;
		for (const entry of extractLefthookCommands(text, lh)) {
			const list = lefthookSections.get(entry.section) ?? [];
			list.push(entry);
			lefthookSections.set(entry.section, list);
		}
	}

	const activeRunners = [];
	const activeVitest = new Map();
	const activePlaywright = new Map();
	const activeJest = new Map();
	const activeNodeTests = new Map();
	const activeDirectJs = new Set();
	const activeJsLaunchers = new Set();
	const activePytest = new Map();
	const activeCargo = new Map();
	const activeCmake = new Set();
	const invokedCustomRunners = new Set();

	const customRunnerScripts = new Set(policy.runners.map((r) => r.script));
	const visitedScripts = new Set();
	const visitedLefthook = new Set();

	const findConfig = (kind, dir, explicit) => {
		if (explicit) {
			const cand = joinPosix(dir, explicit);
			return listedSet.has(cand) ? cand : null;
		}
		for (const name of CONFIG_NAMES[kind]) {
			const cand = joinPosix(dir, name);
			if (listedSet.has(cand)) return cand;
		}
		return null;
	};

	const recordConfigRunner = (map, kind, invokeDir, configRel, extra = {}) => {
		if (configRel) {
			const configFile = findConfig(kind, invokeDir, configRel);
			if (!configFile) {
				issues.push(
					`${joinPosix(invokeDir, configRel)}: explicit ${kind} --config file is not listed by git.`
				);
				return;
			}
			const key = `${invokeDir}|${configFile}|${(extra.explicitFiles ?? []).join(',')}`;
			if (!map.has(key)) map.set(key, { invokeDir, configFile, ...extra });
			return;
		}
		const configFile = findConfig(kind, invokeDir, null);
		const key = `${invokeDir}|${configFile ?? '(default)'}|${(extra.explicitFiles ?? []).join(',')}`;
		if (!map.has(key)) map.set(key, { invokeDir, configFile, ...extra });
	};

	const selectPackagesByFilter = (filters) => {
		const matched = new Set();
		for (const rawFilter of filters) {
			const clean = rawFilter.replace(/^\.{3}|\.{3}$/g, '');
			if (byName.has(clean)) {
				matched.add(byName.get(clean));
				continue;
			}
			const norm = gitPath(clean);
			const re = globToRegExp(norm);
			for (const pkg of packages) if (pkg.dir === norm || re.test(pkg.dir)) matched.add(pkg);
		}
		return [...matched];
	};

	const activatePackageScript = (pkg, scriptName) => {
		if (!pkg?.scripts[scriptName]) return;
		const key = `${pkg.dir}#${scriptName}`;
		if (visitedScripts.has(key)) return;
		visitedScripts.add(key);
		interpretShell(pkg.scripts[scriptName], pkg.dir);
	};

	const activateWorkspaceScript = (scriptName) => {
		for (const pkg of hasWorkspace ? packages.filter((p) => p.workspace) : packages) {
			activatePackageScript(pkg, scriptName);
		}
	};

	const activateLefthookSection = (sectionName) => {
		if (visitedLefthook.has(sectionName)) return;
		visitedLefthook.add(sectionName);
		for (const { cwd, cmd } of lefthookSections.get(sectionName) ?? []) {
			interpretShell(cmd, cwd);
		}
	};

	function interpretShell(block, initialCwd) {
		let cwd = initialCwd;
		for (const segment of expandShellBlock(block)) {
			const tokens = tokenizeShell(segment);
			if (tokens.length === 0) continue;
			for (const tok of tokens) {
				const rel = joinPosix(cwd, tok);
				const rootRel = gitPath(tok);
				if (customRunnerScripts.has(rel)) invokedCustomRunners.add(rel);
				if (customRunnerScripts.has(rootRel)) invokedCustomRunners.add(rootRel);
			}
			let idx = 0;
			while (
				idx < tokens.length &&
				(/^[A-Za-z_]\w*=/.test(tokens[idx]) ||
					['dbus-run-session', 'xvfb-run', '--', '-a', 'npx', 'exec'].includes(tokens[idx]))
			) {
				idx += 1;
			}
			const args = tokens.slice(idx);
			if (args.length === 0) continue;
			const cmd = args[0];
			if (cmd === 'cd' && args[1] && !args[1].includes('$')) cwd = joinPosix(cwd, args[1]);
			else if (cmd === 'lefthook' && args[1] === 'run' && args[2]) activateLefthookSection(args[2]);
			else if (cmd === 'pnpm' || cmd === 'npm' || cmd === 'yarn') parsePackageManager(args, cwd);
			else if (cmd === 'node') parseNode(args.slice(1), cwd);
			else if (cmd === 'vitest') parseVitest(args.slice(1), cwd);
			else if (cmd === 'playwright') parsePlaywright(args.slice(1), cwd);
			else if (cmd === 'jest') parseJest(args.slice(1), cwd);
			else if (['uv', 'pytest', 'python', 'python3'].includes(cmd)) parsePython(args, cwd);
			else if (cmd === 'cargo') parseCargo(args.slice(1), cwd);
			else if (cmd === 'ctest') parseCtest(args.slice(1), cwd);
		}
	}

	function dispatchJsRunner(rest, dirs) {
		for (const tDir of dirs) {
			if (rest[0] === 'vitest') parseVitest(rest.slice(1), tDir);
			else if (rest[0] === 'playwright') parsePlaywright(rest.slice(1), tDir);
			else if (rest[0] === 'jest') parseJest(rest.slice(1), tDir);
		}
	}

	function parsePackageManager(args, cwd) {
		const pm = args[0];
		const filters = [];
		let dir = cwd;
		let recursive = false;
		let isExec = false;
		let i = 1;
		while (i < args.length) {
			const a = args[i];
			if ((a === '-F' || a === '--filter') && args[i + 1]) {
				filters.push(args[++i]);
				i += 1;
			} else if (a.startsWith('--filter=')) {
				filters.push(a.slice('--filter='.length));
				i += 1;
			} else if ((a === '--dir' || a === '-C') && args[i + 1]) {
				const target = args[++i];
				if (!target.includes('$')) dir = joinPosix(cwd, target);
				i += 1;
			} else if (a.startsWith('--dir=')) {
				const target = a.slice('--dir='.length);
				if (!target.includes('$')) dir = joinPosix(cwd, target);
				i += 1;
			} else if (a === '-r' || a === '--recursive') {
				recursive = true;
				i += 1;
			} else if (a === 'exec') {
				isExec = true;
				i += 1;
				break;
			} else if (a === 'run') {
				i += 1;
				break;
			} else if (a.startsWith('-')) i += 1;
			else break;
		}
		const rest = args.slice(i);
		if (rest.length === 0) return;
		const targetPkgs = filters.length > 0 ? selectPackagesByFilter(filters) : [];
		if (isExec) {
			dispatchJsRunner(rest, filters.length > 0 ? targetPkgs.map((p) => p.dir) : [dir]);
			return;
		}
		const scriptName = rest[0];
		if (recursive) {
			activateWorkspaceScript(scriptName);
			return;
		}
		const isDirectBin =
			pm === 'pnpm' &&
			(scriptName === 'vitest' || scriptName === 'playwright' || scriptName === 'jest');
		if (filters.length > 0) {
			for (const pkg of targetPkgs) {
				if (pkg.scripts[scriptName]) activatePackageScript(pkg, scriptName);
				else if (isDirectBin) dispatchJsRunner(rest, [pkg.dir]);
			}
			return;
		}
		const pkg = byDir.get(dir);
		if (pkg?.scripts[scriptName]) activatePackageScript(pkg, scriptName);
		else if (isDirectBin) dispatchJsRunner(rest, [dir]);
	}

	function parseNode(args, cwd) {
		let isNodeTest = false;
		const positionals = [];
		for (let i = 0; i < args.length; i++) {
			if (args[i] === '--test') isNodeTest = true;
			else if (['--test-reporter', '-e', '--eval'].includes(args[i])) i += 1;
			else if (!args[i].startsWith('-')) positionals.push(args[i]);
		}
		if (isNodeTest) {
			const targets = positionals.map(gitPath);
			const key = `${cwd}|${targets.join(',')}`;
			if (!activeNodeTests.has(key)) activeNodeTests.set(key, { cwd, targets });
			return;
		}
		if (positionals.length === 0) return;
		const scriptPath = joinPosix(cwd, positionals[0]);
		if (
			scriptPath === 'scripts/affected.mjs' &&
			((positionals[1] === 'run' && positionals[2] === 'test') || positionals[1] === 'check')
		) {
			activateWorkspaceScript('test');
			return;
		}
		if (listedSet.has(scriptPath)) activeJsLaunchers.add(scriptPath);
	}

	function parseVitest(args, cwd) {
		let configRel = null;
		const explicitFiles = [];
		for (let i = 0; i < args.length; i++) {
			const a = args[i];
			if (a === 'run' || a === '--run') continue;
			if (a === '--config' || a === '-c') configRel = args[++i];
			else if (a.startsWith('--config=')) configRel = a.slice('--config='.length);
			else if (['--reporter', '--project', '--pool', '--maxWorkers'].includes(a)) i += 1;
			else if (!a.startsWith('-') && TEST_FILE.test(a)) explicitFiles.push(joinPosix(cwd, a));
		}
		recordConfigRunner(activeVitest, 'vitest', cwd, configRel, { explicitFiles });
	}

	function parsePlaywright(args, cwd) {
		if (args[0] !== 'test') return;
		let configRel = null;
		for (let i = 1; i < args.length; i++) {
			if (args[i] === '--config' || args[i] === '-c') configRel = args[++i];
			else if (args[i].startsWith('--config=')) configRel = args[i].slice('--config='.length);
		}
		recordConfigRunner(activePlaywright, 'playwright', cwd, configRel);
	}

	function parseJest(args, cwd) {
		let configRel = null;
		for (let i = 0; i < args.length; i++) {
			if (args[i] === '--config' || args[i] === '-c') configRel = args[++i];
			else if (args[i].startsWith('--config=')) configRel = args[i].slice('--config='.length);
		}
		recordConfigRunner(activeJest, 'jest', cwd, configRel);
	}

	function parsePython(args, cwd) {
		let runCwd = cwd;
		let i = 0;
		if (args[0] === 'uv') {
			if (args[1] !== 'run') return;
			i = 2;
			while (i < args.length && args[i].startsWith('-')) {
				const a = args[i];
				if (a.startsWith('--project=') || a.startsWith('--directory=')) {
					const val = a.slice(a.indexOf('=') + 1);
					if (val && !val.includes('$')) runCwd = joinPosix(cwd, val);
					i += 1;
					continue;
				}
				if (UV_VALUE_FLAGS.has(a)) {
					const val = args[++i];
					if ((a === '--project' || a === '--directory') && val && !val.includes('$')) {
						runCwd = joinPosix(cwd, val);
					}
				}
				i += 1;
			}
		}
		if (args[i] === 'python' || args[i] === 'python3') {
			if (args[i + 1] === '-m' && args[i + 2] === 'pytest') i += 3;
			else {
				const script = args[i + 1] ? joinPosix(runCwd, args[i + 1]) : '';
				if (customRunnerScripts.has(script)) invokedCustomRunners.add(script);
				return;
			}
		} else if (args[i] === 'pytest') i += 1;
		else return;

		const paths = [];
		const ignores = [];
		const ignoreGlobs = [];
		for (; i < args.length; i++) {
			const a = args[i];
			if (a === '--ignore' && args[i + 1]) ignores.push(gitPath(args[++i]));
			else if (a.startsWith('--ignore=')) ignores.push(gitPath(a.slice('--ignore='.length)));
			else if (a === '--ignore-glob' && args[i + 1]) ignoreGlobs.push(gitPath(args[++i]));
			else if (a.startsWith('--ignore-glob='))
				ignoreGlobs.push(gitPath(a.slice('--ignore-glob='.length)));
			else if (PYTEST_VALUE_FLAGS.has(a)) i += 1;
			else if (!a.startsWith('-')) paths.push(gitPath(a));
		}
		const key = `${runCwd}|${paths.join(',')}|${ignores.join(',')}|${ignoreGlobs.join(',')}`;
		if (!activePytest.has(key)) activePytest.set(key, { cwd: runCwd, paths, ignores, ignoreGlobs });
	}

	function parseCargo(rawArgs, cwd) {
		const args = rawArgs[0]?.startsWith('+') ? rawArgs.slice(1) : rawArgs;
		if (args[0] !== 'test') return;
		let manifestCwd = cwd;
		let workspace = false;
		let libOnly = false;
		let testsFlag = false;
		let docOrNonTestTarget = false;
		const pkgs = [];
		const excludes = [];
		const onlyTests = [];
		for (let i = 1; i < args.length; i++) {
			const a = args[i];
			if (a === '--') break;
			if (a === '--workspace' || a === '--all') workspace = true;
			else if (a === '--lib') libOnly = true;
			else if (a === '--tests') testsFlag = true;
			else if (['--doc', '--bins', '--examples', '--benches'].includes(a))
				docOrNonTestTarget = true;
			else if (['--bin', '--example', '--bench'].includes(a)) {
				docOrNonTestTarget = true;
				i += 1;
			} else if (/^--(?:bin|example|bench)=/.test(a)) docOrNonTestTarget = true;
			else if (a === '--test' && args[i + 1]) onlyTests.push(args[++i]);
			else if (a.startsWith('--test=')) onlyTests.push(a.slice('--test='.length));
			else if ((a === '-p' || a === '--package') && args[i + 1]) pkgs.push(args[++i]);
			else if (a.startsWith('--package=')) pkgs.push(a.slice('--package='.length));
			else if (a === '--exclude' && args[i + 1]) excludes.push(args[++i]);
			else if (a.startsWith('--exclude=')) excludes.push(a.slice('--exclude='.length));
			else if (a === '--manifest-path' && args[i + 1] && !args[i + 1].includes('$'))
				manifestCwd = dirOf(joinPosix(cwd, args[++i]));
			else if (a.startsWith('--manifest-path=') && !a.includes('$'))
				manifestCwd = dirOf(joinPosix(cwd, a.slice('--manifest-path='.length)));
		}
		if (docOrNonTestTarget && !libOnly && !testsFlag && onlyTests.length === 0) return;
		const key = `${manifestCwd}|${workspace}|${libOnly}|${testsFlag}|${onlyTests.sort().join(',')}|${pkgs.sort().join(',')}|${excludes.sort().join(',')}`;
		if (!activeCargo.has(key)) {
			activeCargo.set(key, {
				cwd: manifestCwd,
				workspace,
				libOnly,
				testsFlag,
				onlyTests,
				packages: pkgs,
				excludes,
			});
		}
	}

	function parseCtest(args, cwd) {
		let dir = cwd;
		for (let i = 0; i < args.length; i++) {
			if (args[i] === '--test-dir' && args[i + 1]) {
				const target = args[++i];
				if (target.includes('$')) return;
				const candidate = joinPosix(cwd, target);
				// Out-of-source build dirs (e.g. `--test-dir build`) hold no tracked CMakeLists.txt.
				if (listedSet.has(joinPosix(candidate, 'CMakeLists.txt'))) dir = candidate;
			}
		}
		if (!dir.includes('$')) activeCmake.add(dir);
	}

	const resolveWorkspaceMembers = (wsDir) => {
		const ws = cargoInfo.get(wsDir);
		if (!ws || ws.members.length === 0) return [wsDir];
		const memberRes = ws.members.map((m) => globToRegExp(joinPosix(wsDir, m)));
		const excludeRes = ws.exclude.map((e) => globToRegExp(joinPosix(wsDir, e)));
		const members = cargoDirs.filter(
			(dir) =>
				under(dir, wsDir) &&
				memberRes.some((re) => re.test(dir)) &&
				!excludeRes.some((re) => re.test(dir))
		);
		if (ws.name && !members.includes(wsDir) && !excludeRes.some((re) => re.test(wsDir))) {
			members.push(wsDir);
		}
		return members;
	};

	if (hasCI) {
		for (const wf of workflowFiles) {
			const text = readText(root, wf);
			if (text)
				for (const { cwd, cmd } of extractWorkflowCommands(text, wf)) interpretShell(cmd, cwd);
		}
		for (const sectionName of lefthookSections.keys()) activateLefthookSection(sectionName);
	} else {
		for (const pkg of packages) {
			for (const name of Object.keys(pkg.scripts)) {
				if (name === 'test' || name.startsWith('test:')) activatePackageScript(pkg, name);
			}
			if (pkg.jest) recordConfigRunner(activeJest, 'jest', pkg.dir, null);
		}
		const coveredCargoMembers = new Set();
		for (const [dir, info] of cargoInfo.entries()) {
			if (info.members.length > 0) {
				for (const member of resolveWorkspaceMembers(dir)) {
					if (member !== dir) coveredCargoMembers.add(member);
				}
			}
		}
		for (const file of listed) {
			const base = posix.basename(file);
			const dir = dirOf(file);
			if (
				/^vitest(\.[\w-]+)?\.config(\.[\w-]+)?\.[cm]?[jt]s$|^vitest\.(workspace|projects)\.[cm]?[jt]s$/.test(
					base
				)
			) {
				const text = readText(root, file);
				if (text && !parseVitestConfig(text, file, root).isStorybook)
					recordConfigRunner(activeVitest, 'vitest', dir, base, { explicitFiles: [] });
			} else if (/^vite(\.[\w-]+)?\.config(\.[\w-]+)?\.[cm]?[jt]s$/.test(base)) {
				const text = readText(root, file);
				const parsed = text ? parseVitestConfig(text, file, root) : null;
				if (parsed?.hasTest && !parsed.isStorybook)
					recordConfigRunner(activeVitest, 'vitest', dir, base, { explicitFiles: [] });
			} else if (/^playwright(\.[\w-]+)?\.config\.[cm]?[jt]s$/.test(base)) {
				recordConfigRunner(activePlaywright, 'playwright', dir, base);
			} else if (/^jest(\.[\w-]+)?\.config\.[cm]?[jt]s$|^jest\.config\.json$/.test(base)) {
				recordConfigRunner(activeJest, 'jest', dir, base);
			} else if (['pyproject.toml', 'pytest.ini', 'tox.ini'].includes(base)) {
				const parsed = parsePytestConfig(readText(root, file) ?? '', base);
				const hasPyUnder = testFilesByLang.Python.some((f) => under(f, dir));
				if (parsed.configured || hasPyUnder) {
					const key = `${dir}|||`;
					if (!activePytest.has(key))
						activePytest.set(key, { cwd: dir, paths: [], ignores: [], ignoreGlobs: [] });
				}
			} else if (base === 'Cargo.toml') {
				if (coveredCargoMembers.has(dir)) continue;
				const ws = Boolean(cargoInfo.get(dir)?.members.length);
				const key = `${dir}|${ws}|false|false|||`;
				if (!activeCargo.has(key))
					activeCargo.set(key, {
						cwd: dir,
						workspace: ws,
						libOnly: false,
						testsFlag: false,
						onlyTests: [],
						packages: [],
						excludes: [],
					});
			} else if (base === 'CMakeLists.txt') {
				const text = readText(root, file);
				if (
					text &&
					/\b(?:add_test|gtest_discover_tests|catch_discover_tests|doctest_discover_tests)\s*\(/i.test(
						text
					)
				) {
					activeCmake.add(dir);
				}
			}
		}
		for (const r of policy.runners) if (listedSet.has(r.script)) invokedCustomRunners.add(r.script);
	}

	// 3. Follow active JS test-launcher scripts (`--test` drivers).
	const launcherQueue = [...activeJsLaunchers];
	const scannedLaunchers = new Set();
	while (launcherQueue.length > 0) {
		const scriptFile = launcherQueue.shift();
		if (scannedLaunchers.has(scriptFile)) continue;
		scannedLaunchers.add(scriptFile);
		const text = readText(root, scriptFile);
		if (!text || !/--test\b/.test(text)) continue;
		const scriptDir = dirOf(scriptFile);
		const masked = maskSource(text);
		const pathCandidates = new Set();
		for (const match of masked.matchAll(/(['"`])[^'"`\n]*\1/g)) {
			const rawLit = text.slice(match.index + 1, match.index + match[0].length - 1);
			if (rawLit && !rawLit.includes('${')) pathCandidates.add(rawLit);
		}
		for (const call of masked.matchAll(/\b(?:join|resolve)\s*\(/g)) {
			const open = call.index + call[0].length - 1;
			const close = findMatching(masked, open, '(', ')');
			if (close === -1) continue;
			const segments = [];
			let offset = 0;
			for (const part of splitTopLevel(masked.slice(open + 1, close), ',')) {
				const rawPart = text.slice(open + 1 + offset, open + 1 + offset + part.length);
				offset += part.length + 1;
				const str = extractQuotedString(rawPart, part);
				if (str !== null) segments.push(str);
			}
			if (segments.length >= 2) pathCandidates.add(segments.join('/'));
		}
		const dirCandidates = new Set(['', scriptDir]);
		for (const value of pathCandidates) {
			const norm = gitPath(value);
			if (norm && !norm.includes(' ') && listed.some((f) => f.startsWith(`${norm}/`)))
				dirCandidates.add(norm);
		}
		const launcherClaimed = new Set();
		for (const value of pathCandidates) {
			const norm = gitPath(value);
			if (!norm || norm.includes(' ')) continue;
			if (TEST_FILE.test(norm)) {
				for (const base of dirCandidates) {
					const candidate = joinPosix(base, norm);
					if (allTestSet.has(candidate)) {
						launcherClaimed.add(candidate);
						activeDirectJs.add(candidate);
					}
				}
			} else if (/\.[cm]?js$/.test(norm)) {
				for (const base of dirCandidates) {
					const candidate = joinPosix(base, norm);
					if (listedSet.has(candidate) && candidate !== scriptFile) launcherQueue.push(candidate);
				}
			}
		}
		if (launcherClaimed.size > 0) {
			activeRunners.push({
				id: scriptFile,
				lang: 'JavaScript',
				claimed: launcherClaimed,
				dir: scriptDir,
			});
		}
	}

	// 4. Resolve claimed files for every active runner.
	const claimedBy = new Map();
	const recordClaim = (file, runnerId) => {
		const set = claimedBy.get(file) ?? new Set();
		set.add(runnerId);
		claimedBy.set(file, set);
	};

	const jsTestFiles = testFilesByLang.JavaScript;

	// 4a. Vitest
	for (const { invokeDir, configFile, explicitFiles } of activeVitest.values()) {
		const runnerId = configFile ?? `${invokeDir || '.'} (vitest default)`;
		if (explicitFiles.length > 0) {
			const claimed = new Set(explicitFiles.filter((f) => allTestSet.has(f)));
			activeRunners.push({
				id: `${runnerId} [${explicitFiles.join(', ')}]`,
				lang: 'JavaScript',
				claimed,
				dir: invokeDir,
			});
			for (const f of claimed) recordClaim(f, runnerId);
			continue;
		}
		const parsed = configFile
			? parseVitestConfig(readText(root, configFile) ?? '', configFile, root)
			: null;
		if (parsed?.isStorybook) continue;
		const collectGlobs = (baseDir, includePatterns, excludePatterns) => {
			const inc = (includePatterns ?? DEFAULT_VITEST_INCLUDE).map(globToRegExp);
			const exc = (excludePatterns ?? []).map(globToRegExp);
			const matches = new Set();
			for (const file of jsTestFiles) {
				if (!under(file, baseDir)) continue;
				const rel = baseDir ? file.slice(baseDir.length + 1) : file;
				if (inc.some((re) => re.test(rel)) && !exc.some((re) => re.test(rel))) matches.add(file);
			}
			return matches;
		};
		const baseDir = parsed?.root ? joinPosix(invokeDir, parsed.root) : invokeDir;
		const claimed = new Set();
		if (parsed?.projects?.length) {
			for (const proj of parsed.projects) {
				if (proj.kind === 'inline') {
					const projDir = proj.root ? joinPosix(baseDir, proj.root) : baseDir;
					for (const f of collectGlobs(projDir, proj.include ?? parsed.include, [
						...parsed.exclude,
						...proj.exclude,
					]))
						claimed.add(f);
				} else if (proj.kind === 'path') {
					const targetGlob = globToRegExp(joinPosix(baseDir, proj.value));
					for (const file of listed) {
						if (!targetGlob.test(file)) continue;
						const pParsed = parseVitestConfig(readText(root, file) ?? '', file, root);
						const pDir = pParsed.root ? joinPosix(dirOf(file), pParsed.root) : dirOf(file);
						for (const f of collectGlobs(pDir, pParsed.include, pParsed.exclude)) claimed.add(f);
					}
				}
			}
		} else {
			for (const f of collectGlobs(baseDir, parsed?.include ?? null, parsed?.exclude ?? []))
				claimed.add(f);
		}
		activeRunners.push({ id: runnerId, lang: 'JavaScript', claimed, dir: baseDir });
		for (const f of claimed) recordClaim(f, runnerId);
	}

	// 4b. Playwright
	for (const { invokeDir, configFile } of activePlaywright.values()) {
		const runnerId = configFile ?? `${invokeDir || '.'} (playwright default)`;
		const parsed = configFile
			? parsePlaywrightConfig(readText(root, configFile) ?? '')
			: { testDir: '.', testMatch: null, testIgnore: [] };
		const testRoot = joinPosix(configFile ? dirOf(configFile) : invokeDir, parsed.testDir);
		const matchesRule = (rule, rel) =>
			rule.kind === 'regex' ? rule.value.test(rel) : globToRegExp(rule.value).test(rel);
		const claimed = new Set();
		for (const file of jsTestFiles) {
			if (!under(file, testRoot)) continue;
			const rel = testRoot ? file.slice(testRoot.length + 1) : file;
			const inc = parsed.testMatch
				? parsed.testMatch.some((r) => matchesRule(r, rel))
				: TEST_FILE.test(rel);
			if (inc && !parsed.testIgnore.some((r) => matchesRule(r, rel))) claimed.add(file);
		}
		activeRunners.push({ id: runnerId, lang: 'JavaScript', claimed, dir: testRoot });
		for (const f of claimed) recordClaim(f, runnerId);
	}

	// 4c. Jest
	for (const { invokeDir, configFile } of activeJest.values()) {
		const runnerId = configFile ?? `${invokeDir || '.'} (jest default)`;
		let parsed = { roots: ['.'], testMatch: null, testPathIgnorePatterns: [] };
		if (configFile?.endsWith('.json')) {
			try {
				const raw = JSON.parse(readText(root, configFile) ?? '{}');
				parsed = {
					roots: (raw.roots ?? ['.']).map((r) => r.replace(/^<rootDir>\/?/, '') || '.'),
					testMatch: raw.testMatch?.map((g) => g.replace(/^<rootDir>\/?/, '')) ?? null,
					testPathIgnorePatterns: raw.testPathIgnorePatterns ?? [],
				};
			} catch {}
		} else if (configFile) {
			parsed = parseJestConfig(readText(root, configFile) ?? '');
		} else if (byDir.get(invokeDir)?.jest) {
			const j = byDir.get(invokeDir).jest;
			parsed = {
				roots: (j.roots ?? ['.']).map((r) => r.replace(/^<rootDir>\/?/, '') || '.'),
				testMatch: j.testMatch?.map((g) => g.replace(/^<rootDir>\/?/, '')) ?? null,
				testPathIgnorePatterns: j.testPathIgnorePatterns ?? [],
			};
		}
		const baseDir = configFile ? dirOf(configFile) : invokeDir;
		const inc = parsed.testMatch?.map(globToRegExp);
		const exc = parsed.testPathIgnorePatterns.map((p) => new RegExp(p));
		const claimed = new Set();
		for (const file of jsTestFiles) {
			if (!parsed.roots.some((r) => under(file, joinPosix(baseDir, r)))) continue;
			const rel = baseDir ? file.slice(baseDir.length + 1) : file;
			if ((!inc || inc.some((re) => re.test(rel))) && !exc.some((re) => re.test(rel)))
				claimed.add(file);
		}
		activeRunners.push({ id: runnerId, lang: 'JavaScript', claimed, dir: baseDir });
		for (const f of claimed) recordClaim(f, runnerId);
	}

	// 4d. Direct `node --test` invocations + JS launchers + transitive static imports between JS test files
	for (const { cwd, targets } of activeNodeTests.values()) {
		const claimed = new Set();
		if (targets.length === 0) {
			for (const file of jsTestFiles) if (under(file, cwd)) claimed.add(file);
		} else {
			for (const target of targets) {
				const resolved = joinPosix(cwd, target);
				if (/[*?{[]/.test(target)) {
					const re = globToRegExp(resolved);
					for (const file of jsTestFiles) if (re.test(file)) claimed.add(file);
				} else if (allTestSet.has(resolved)) {
					claimed.add(resolved);
				} else {
					for (const file of jsTestFiles) if (under(file, resolved)) claimed.add(file);
				}
			}
		}
		const runnerId = `node --test (${cwd || '.'}${targets.length ? ` ${targets.join(' ')}` : ''})`;
		activeRunners.push({ id: runnerId, lang: 'JavaScript', claimed, dir: cwd });
		for (const f of claimed) recordClaim(f, runnerId);
	}
	for (const f of activeDirectJs) recordClaim(f, 'js launcher');
	const importQueue = [...claimedBy.keys()].filter((f) => TEST_FILE.test(f));
	const seenImports = new Set(importQueue);
	while (importQueue.length > 0) {
		const file = importQueue.shift();
		const text = readText(root, file);
		if (!text) continue;
		const masked = maskSource(text);
		for (const match of masked.matchAll(
			/\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?(['"][^'"]+['"])/g
		)) {
			const q = /['"]([^'"]+)['"]\s*$/.exec(
				text.slice(match.index, match.index + match[0].length)
			)?.[1];
			if (!q?.startsWith('.')) continue;
			const target = resolveRelativeJsFile(root, file, q, listedSet);
			if (target && allTestSet.has(target) && !seenImports.has(target)) {
				seenImports.add(target);
				recordClaim(target, `imported by ${file}`);
				importQueue.push(target);
			}
		}
	}

	// 4e. Pytest
	for (const { cwd, paths, ignores, ignoreGlobs } of activePytest.values()) {
		let cfgTestpaths = null;
		let norecursedirs = [];
		for (const cfgName of ['pytest.ini', 'pyproject.toml', 'tox.ini']) {
			const cfgPath = joinPosix(cwd, cfgName);
			if (!listedSet.has(cfgPath)) continue;
			const parsed = parsePytestConfig(readText(root, cfgPath) ?? '', cfgName);
			if (!parsed.configured) continue;
			if (parsed.norecursedirs) norecursedirs = parsed.norecursedirs;
			if (parsed.testpaths?.length) cfgTestpaths = parsed.testpaths;
			break;
		}
		const searchRoots = paths.length > 0 ? paths : (cfgTestpaths ?? ['']);
		const resolvedRoots = searchRoots.map((p) => joinPosix(cwd, p));
		const resolvedIgnores = ignores.map((p) => joinPosix(cwd, p));
		const ignoreGlobRes = ignoreGlobs.map((g) => globToRegExp(joinPosix(cwd, g)));
		const claimed = new Set();
		for (const file of testFilesByLang.Python) {
			if (!resolvedRoots.some((r) => under(file, r))) continue;
			if (resolvedIgnores.some((ig) => under(file, ig))) continue;
			if (ignoreGlobRes.some((re) => re.test(file))) continue;
			const rel = cwd ? file.slice(cwd.length + 1) : file;
			if (norecursedirs.some((nd) => rel.split('/').includes(nd))) continue;
			claimed.add(file);
		}
		const runnerId = `pytest (${cwd || '.'}${paths.length ? ` ${paths.join(' ')}` : ''})`;
		activeRunners.push({ id: runnerId, lang: 'Python', claimed, dir: cwd });
		for (const f of claimed) recordClaim(f, runnerId);
	}

	// 4f. CMake / CTest
	for (const projectDir of activeCmake) {
		const { hasTest, sources } = parseCmakeTestSources(root, projectDir, listedSet);
		const claimed = hasTest ? new Set([...sources].filter((f) => allTestSet.has(f))) : new Set();
		const runnerId = `ctest (${projectDir || '.'})`;
		activeRunners.push({ id: runnerId, lang: 'C++', claimed, dir: projectDir });
		for (const f of claimed) recordClaim(f, runnerId);
	}

	// 4g. Cargo
	const collectRustCrateTests = (crateDir, { libOnly, testsFlag, onlyTests }) => {
		const info = cargoInfo.get(crateDir);
		const claimed = new Set();
		const runAll = !libOnly && !testsFlag && onlyTests.length === 0;
		if (runAll || libOnly || testsFlag) {
			for (const f of rustUnitTestCrates.get(crateDir) ?? []) claimed.add(f);
		}
		if (libOnly && !testsFlag && onlyTests.length === 0) return claimed;

		const crateTests = testFilesByLang.Rust.filter((f) => {
			if (!under(f, crateDir) || ownerCrate(f) !== crateDir) return false;
			return (crateDir ? f.slice(crateDir.length + 1) : f).startsWith('tests/');
		});
		const crateTestSet = new Set(crateTests);
		const entries = [];
		const targetNames = onlyTests.length > 0 ? new Set(onlyTests) : null;
		if (info?.autotests !== false) {
			for (const f of crateTests) {
				const rel = crateDir ? f.slice(crateDir.length + 1) : f;
				const top = /^tests\/([^/]+)\.rs$/.exec(rel);
				const sub = /^tests\/([^/]+)\/main\.rs$/.exec(rel);
				const targetName = top?.[1] ?? sub?.[1];
				if (targetName && (!targetNames || targetNames.has(targetName))) entries.push(f);
			}
		}
		for (const explicit of info?.explicitTests ?? []) {
			const full = joinPosix(crateDir, explicit.path);
			if (crateTestSet.has(full) && (!targetNames || targetNames.has(explicit.name)))
				entries.push(full);
		}
		const queue = [...entries];
		while (queue.length > 0) {
			const file = queue.shift();
			if (claimed.has(file)) continue;
			claimed.add(file);
			const text = readText(root, file);
			if (!text) continue;
			const fDir = dirOf(file);
			const baseName = posix.basename(file, '.rs');
			const searchDirs =
				baseName === 'mod' || baseName === 'main' ? [fDir] : [fDir, joinPosix(fDir, baseName)];
			for (const m of text.matchAll(/#\[path\s*=\s*"([^"]+)"\]/g)) {
				const target = joinPosix(fDir, m[1]);
				if (crateTestSet.has(target) && !claimed.has(target)) queue.push(target);
			}
			const stripped = text.replace(/\/\/[^\n]*/g, '');
			for (const m of stripped.matchAll(/\b(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)\s*;/g)) {
				for (const sDir of searchDirs) {
					for (const cand of [joinPosix(sDir, `${m[1]}.rs`), joinPosix(sDir, `${m[1]}/mod.rs`)]) {
						if (crateTestSet.has(cand) && !claimed.has(cand)) queue.push(cand);
					}
				}
			}
		}
		return claimed;
	};

	for (const run of activeCargo.values()) {
		const excludeSet = new Set(run.excludes);
		const wsInfo = cargoInfo.get(run.cwd);
		const allMembers = resolveWorkspaceMembers(run.cwd);
		let targetCrates = [];
		if (run.packages.length > 0) {
			const want = new Set(run.packages);
			targetCrates = allMembers.filter(
				(dir) => want.has(cargoInfo.get(dir)?.name) && !excludeSet.has(cargoInfo.get(dir)?.name)
			);
		} else if (run.workspace || (wsInfo && !wsInfo.name && wsInfo.members.length > 0)) {
			targetCrates = allMembers.filter((dir) => !excludeSet.has(cargoInfo.get(dir)?.name));
		} else if (wsInfo) {
			targetCrates = [run.cwd];
		}
		const claimed = new Set();
		for (const crateDir of targetCrates) {
			for (const f of collectRustCrateTests(crateDir, run)) claimed.add(f);
		}
		const label = run.packages.length
			? `cargo test (${run.cwd || '.'} -p ${run.packages.join(',')})`
			: `cargo test (${run.cwd || '.'}${run.workspace ? ' --workspace' : ''})`;
		activeRunners.push({ id: label, lang: 'Rust', claimed, dir: run.cwd });
		for (const f of claimed) recordClaim(f, label);
	}

	// 4h. Custom runners declared in policy register
	for (const runner of policy.runners) {
		if (!listedSet.has(runner.script)) {
			issues.push(`${register}: runner script ${runner.script} is not listed by git.`);
			continue;
		}
		if (hasCI && !invokedCustomRunners.has(runner.script)) {
			issues.push(
				`${register}: runner script ${runner.script} is not invoked by any workflow or hook.`
			);
			continue;
		}
		const inc = runner.include.map(globToRegExp);
		const exc = runner.exclude.map(globToRegExp);
		const claimed = new Set();
		for (const { file } of allTestFiles) {
			if (inc.some((re) => re.test(file)) && !exc.some((re) => re.test(file))) {
				claimed.add(file);
				recordClaim(file, runner.script);
			}
		}
		activeRunners.push({ id: runner.script, lang: 'custom', claimed, dir: dirOf(runner.script) });
	}

	// 5. Reconcile in both directions.
	if (scopedTests.length === 0) {
		issues.push('The scan found no test file: it stopped seeing the suite it guards.');
	}
	const scopedRunners =
		scopePaths.length === 0
			? activeRunners
			: activeRunners.filter(
					(r) =>
						[...r.claimed].some((f) => scopedTestSet.has(f)) ||
						(r.dir !== undefined && scopePaths.some((p) => under(r.dir, p)))
				);
	if (scopedRunners.length === 0) {
		issues.push(
			'No active test runner was discovered: check workflow, hook and runner config parsing.'
		);
	}
	for (const runner of scopedRunners) {
		if (runner.claimed.size === 0) {
			issues.push(
				`${runner.id}: active test runner matched no tracked test file; fix its include globs or remove the dead runner.`
			);
		}
	}

	const unrunEntries = [...policy.unrun.entries()];
	const isExempted = (file) => unrunEntries.some(([prefix]) => under(file, prefix));
	let exemptedCount = 0;
	for (const { file, lang } of scopedTests) {
		if (claimedBy.has(file)) continue;
		if (isExempted(file)) {
			exemptedCount += 1;
			continue;
		}
		issues.push(
			`${file} (${lang}): not claimed by any active test runner. Wire it into a runner/workflow, or register {path, owner, reason, issue} under "unrun" in ${register}.`
		);
	}

	for (const [prefix] of unrunEntries) {
		if (scopePaths.length > 0 && !scopePaths.some((p) => under(prefix, p) || under(p, prefix)))
			continue;
		const matching = allTestFiles.filter(({ file }) => under(file, prefix)).map(({ file }) => file);
		if (matching.length === 0) {
			issues.push(
				`${register}: unrun entry "${prefix}" matches no tracked test file; delete or correct the stale entry.`
			);
			continue;
		}
		const recovered = matching.filter((file) => claimedBy.has(file));
		if (recovered.length > 0) {
			const sample = recovered[0];
			const runner = [...claimedBy.get(sample)][0];
			issues.push(
				`${register}: unrun entry "${prefix}" matches ${recovered.length} test file(s) already claimed by ${runner} (e.g. ${sample}); delete or narrow the exemption.`
			);
		}
	}

	return {
		files: scopedTests.length,
		claimed: scopedTests.filter(({ file }) => claimedBy.has(file)).length,
		runners: scopedRunners.length,
		exempted: exemptedCount,
		languages: Object.fromEntries(
			Object.entries(testFilesByLang).map(([lang, files]) => [
				lang,
				files.filter((f) => scopedTestSet.has(f)).length,
			])
		),
		issues,
	};
}

function parseArguments(argv) {
	const options = { paths: [] };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--root') options.root = resolve(argv[++i]);
		else if (argv[i] === '--register') options.register = argv[++i];
		else options.paths.push(argv[i]);
	}
	return options;
}

// Compare real paths: run through a symlinked skills folder, argv names the link while
// import.meta.url names the target, and a plain comparison would skip the check and exit 0.
if (
	process.argv[1] &&
	realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
	try {
		const result = checkTestDiscovery(parseArguments(process.argv.slice(2)));
		if (result.issues.length > 0) {
			console.error(`Test discovery check failed with ${result.issues.length} issue(s):`);
			for (const issue of result.issues) console.error(`- ${issue}`);
			process.exitCode = 1;
		} else {
			console.log(
				`Test discovery check passed: ${result.files} test files (${result.claimed} claimed by ${result.runners} active runners, ${result.exempted} registered unrun).`
			);
		}
	} catch (cause) {
		console.error(cause instanceof Error ? cause.message : String(cause));
		process.exitCode = 1;
	}
}

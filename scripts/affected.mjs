#!/usr/bin/env node
/**
 * Runs workspace tasks only for the packages a change affects (see scripts/affected/scope.mjs).
 *
 *   node scripts/affected.mjs list [--json]           describe the scope
 *   node scripts/affected.mjs run <script> [--no-bail] [-- args]
 *                                                     run a package script over the scope; `build`
 *                                                     also builds the dependencies of the scope
 *   node scripts/affected.mjs gate [--package <name>...] [--path <prefix>...]
 *                                                     CI: write run=true|false to $GITHUB_OUTPUT
 *   node scripts/affected.mjs check [--all]           run the lefthook `check` gate over the scope
 *   node scripts/affected.mjs verify [--list] [--skip-check] [--keep-going]
 *                                                     run `check`, then the local equivalent of every
 *                                                     path-filtered workflow the change would trigger
 *                                                     (scripts/affected/suites.mjs)
 *
 * Scope options (every command):
 *   --all            the whole workspace (also AFD_SCOPE=all)
 *   --base <ref>     diff against the merge base with <ref> (also AFD_BASE); default origin/main
 *   --files <f>...   treat these files as the change, compared with HEAD (pre-commit)
 */
import { execFileSync, execSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_BASES, resolveScope } from './affected/scope.mjs';
import { matchesFilters, readSuiteTrigger, SUITES } from './affected/suites.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const windows = process.platform === 'win32';

export function parseArgs(argv, env = process.env) {
	const options = {
		command: argv[0],
		positional: [],
		all: env.AFD_SCOPE === 'all',
		bases: env.AFD_BASE ? [env.AFD_BASE] : DEFAULT_BASES,
		files: undefined,
		packages: [],
		paths: [],
		noBail: false,
		json: false,
		list: false,
		skipCheck: false,
		keepGoing: false,
		passthrough: [],
	};
	for (let index = 1; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === '--') {
			options.passthrough = argv.slice(index + 1);
			break;
		} else if (arg === '--all') options.all = true;
		else if (arg === '--json') options.json = true;
		else if (arg === '--no-bail') options.noBail = true;
		else if (arg === '--list') options.list = true;
		else if (arg === '--skip-check') options.skipCheck = true;
		else if (arg === '--keep-going') options.keepGoing = true;
		else if (arg === '--base') options.bases = [argv[++index]];
		else if (arg === '--package') options.packages.push(argv[++index]);
		else if (arg === '--path') options.paths.push(argv[++index]);
		else if (arg === '--files') {
			options.files = [];
			while (index + 1 < argv.length && !argv[index + 1].startsWith('--'))
				options.files.push(argv[++index]);
		} else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
		else options.positional.push(arg);
	}
	return options;
}

function describe(scope, selected) {
	if (scope.mode === 'all') return `all ${scope.total} packages: ${scope.reason}`;
	if (selected.length === 0) return `no packages affected (${scope.reason})`;
	return `${selected.length} of ${scope.total} packages (${scope.reason}): ${selected.join(', ')}`;
}

/** pnpm arguments that run `script` over the scope, or null when nothing is selected. */
export function pnpmArgs(scope, script, { noBail = false, passthrough = [] } = {}) {
	const selected = script === 'build' ? scope.build : scope.affected;
	if (selected.length === 0) return null;
	const filters =
		scope.mode === 'all'
			? []
			: selected.flatMap((name) => ['--filter', script === 'build' ? `${name}...` : name]);
	return [
		'-r',
		...filters,
		...(noBail ? ['--no-bail'] : []),
		'run',
		'--if-present',
		script,
		...passthrough,
	];
}

/** Whether a gated workflow must run: whole-workspace scope, a listed path, or a listed package. */
export function gate(scope, { packages, paths }) {
	if (scope.mode === 'all') return { run: true, reason: scope.reason };
	const file = scope.files.find((candidate) => paths.some((path) => candidate.startsWith(path)));
	if (file) return { run: true, reason: `${file} changed` };
	const hit = packages.find((name) => scope.affected.includes(name));
	if (hit)
		return {
			run: true,
			reason: `${hit} is affected (${scope.reasons.get(hit) ?? 'a dependency changed'})`,
		};
	return {
		run: false,
		reason: `none of ${[...packages, ...paths].join(', ')} is affected or changed`,
	};
}

/**
 * The local suite steps a change selects, in order: a suite whose workflow's pull-request path
 * filter matches a changed file, minus the steps whose `Affected units` gate would not pass.
 */
export function planSuites(scope, { root, suites = SUITES, read = readSuiteTrigger } = {}) {
	const plan = [];
	for (const suite of suites) {
		const trigger = read(root, suite);
		if (!trigger) continue;
		// --all has no changed files and selects every suite; a change that selects the whole
		// workspace still triggers only the workflows its files match.
		const every = scope.mode === 'all' && scope.files.length === 0;
		const file =
			every || trigger.paths === null
				? null
				: scope.files.find((candidate) => matchesFilters(trigger.paths, candidate));
		if (!every && trigger.paths !== null && !file) continue;
		const reason = file ? `${file} changed` : scope.reason;
		const gates = new Map();
		for (const step of suite.steps) {
			if (!step.gate) {
				plan.push({ suite, step, reason });
				continue;
			}
			const args = trigger.gates.get(step.gate);
			if (!args) throw new Error(`${suite.workflow} has no gate step with id ${step.gate}`);
			if (!gates.has(step.gate))
				gates.set(step.gate, gate(scope, parseArgs(['gate', ...args], {})));
			const result = gates.get(step.gate);
			if (result.run) plan.push({ suite, step, reason: result.reason });
		}
	}
	return plan;
}

const TOOLS = { cargo: 'cargo', cmake: 'cmake', openssl: 'openssl', uv: 'uv' };

function missingTools(plan) {
	const needed = new Map();
	for (const { suite } of plan)
		for (const tool of suite.tools)
			if (TOOLS[tool]) needed.set(tool, [...(needed.get(tool) ?? []), suite.workflow]);
	const missing = [];
	for (const [tool, workflows] of needed) {
		try {
			execFileSync(windows ? 'where' : 'which', [TOOLS[tool]], { stdio: 'ignore' });
		} catch {
			missing.push(`${tool} (for ${[...new Set(workflows)].join(', ')})`);
		}
	}
	return missing;
}

function runCheck(all) {
	execFileSync('npx', ['lefthook', 'run', 'check'], {
		cwd: root,
		stdio: 'inherit',
		shell: windows,
		env: { ...process.env, AFD_SCOPE: all ? 'all' : (process.env.AFD_SCOPE ?? '') },
	});
}

function verify(scope, options) {
	const plan = planSuites(scope, { root });
	console.error(`[verify] check (ci.yml): ${describe(scope, scope.affected)}`);
	let workflow = null;
	for (const { suite, step, reason } of plan) {
		if (suite.workflow !== workflow) {
			workflow = suite.workflow;
			console.error(`[verify] ${workflow} (${reason})`);
			if (suite.remote) console.error(`           remote only: ${suite.remote}`);
		}
		console.error(`           ${step.cwd ? `(${step.cwd}) ` : ''}${step.run}`);
	}
	if (plan.length === 0) console.error('[verify] no path-filtered workflow is triggered');
	if (options.list) return;
	const missing = missingTools(plan);
	if (missing.length > 0) throw new Error(`missing tools: ${missing.join('; ')}`);

	const results = [];
	const record = (name, action) => {
		const started = Date.now();
		try {
			action();
			results.push({ name, ok: true, seconds: (Date.now() - started) / 1000 });
		} catch (error) {
			results.push({ name, ok: false, seconds: (Date.now() - started) / 1000 });
			if (!options.keepGoing) throw error;
		}
	};
	try {
		if (!options.skipCheck) record('check (ci.yml)', () => runCheck(options.all));
		for (const { suite, step } of plan)
			record(`${suite.workflow}: ${step.run}`, () => {
				console.error(`\n[verify] ${suite.workflow}: ${step.run}`);
				execSync(step.run, { cwd: join(root, step.cwd ?? '.'), stdio: 'inherit' });
			});
	} finally {
		console.error('\n[verify] summary');
		for (const result of results)
			console.error(
				`  ${result.ok ? 'pass' : 'FAIL'}  ${result.seconds.toFixed(0)}s  ${result.name}`
			);
	}
	if (results.some((result) => !result.ok))
		throw Object.assign(new Error('verify failed'), { status: 1 });
}

function main(argv) {
	const options = parseArgs(argv);
	// The lefthook steps diff the branch themselves; a narrower --files scope would disagree.
	if (options.files && ['check', 'verify'].includes(options.command))
		throw new Error(`${options.command} uses the branch diff; --files is for list, run and gate`);
	const scope = resolveScope({
		root,
		all: options.all,
		bases: options.bases,
		files: options.files,
	});
	switch (options.command) {
		case 'list': {
			if (!options.json) {
				console.log(describe(scope, scope.affected));
				if (scope.mode === 'affected')
					for (const name of scope.changed)
						console.log(`  ${name}: ${scope.reasons.get(name) ?? scope.reason}`);
				return;
			}
			const { reasons, ...rest } = scope;
			console.log(JSON.stringify({ ...rest, reasons: Object.fromEntries(reasons) }, null, '\t'));
			return;
		}
		case 'run': {
			const [script] = options.positional;
			if (!script) throw new Error('run needs a package script name');
			const args = pnpmArgs(scope, script, options);
			const selected = script === 'build' ? scope.build : scope.affected;
			console.error(`[affected] ${script}: ${describe(scope, selected)}`);
			if (!args) return;
			execFileSync('pnpm', args, { cwd: root, stdio: 'inherit', shell: windows });
			return;
		}
		case 'gate': {
			if (options.packages.length + options.paths.length === 0)
				throw new Error('gate needs a --package or a --path');
			const result = gate(scope, options);
			console.log(`run=${result.run}: ${result.reason}`);
			if (process.env.GITHUB_OUTPUT)
				appendFileSync(process.env.GITHUB_OUTPUT, `run=${result.run}\n`);
			return;
		}
		case 'check': {
			console.error(`[affected] check: ${describe(scope, scope.affected)}`);
			runCheck(options.all);
			return;
		}
		case 'verify':
			verify(scope, options);
			return;
		default:
			throw new Error('expected list, run, gate, check or verify');
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		main(process.argv.slice(2));
	} catch (error) {
		if (error.status === undefined) console.error(`affected: ${error.message}`);
		process.exitCode = error.status || 1;
	}
}

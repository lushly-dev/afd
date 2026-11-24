#!/usr/bin/env node
/**
 * Runs workspace tasks only for the packages a change affects (see scripts/affected/scope.mjs).
 *
 *   node scripts/affected.mjs list [--json]           describe the scope
 *   node scripts/affected.mjs run <script> [--no-bail] [-- args]
 *                                                     run a package script over the scope; `build`
 *                                                     also builds the dependencies of the scope
 *   node scripts/affected.mjs gate [--package <name>...] [--path <prefix>...] [--except <prefix>...]
 *                                  [--lane <name>...]
 *                                                     CI: write run=true|false to $GITHUB_OUTPUT;
 *                                                     a file under an --except prefix opens no --path;
 *                                                     --lane adds a lane's packages, paths and
 *                                                     inputs (architecture.json `lanes`)
 *   node scripts/affected.mjs trigger <workflow.yml>   CI, on a merge group: write run=true|false to
 *                                                     $GITHUB_OUTPUT, true when a changed file
 *                                                     matches the workflow's own pull_request.paths
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
import { bashCommand } from './release/exec-tool.mjs';
import { defaultTargets, sweep } from './rust-sweep.mjs';
import { buildRecord, currentIdentity, recordPath, writeRecord } from './verify-record.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const windows = process.platform === 'win32';
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });

export function parseArgs(argv, env = process.env) {
	const options = {
		command: argv[0],
		positional: [],
		all: env.AFD_SCOPE === 'all',
		bases: env.AFD_BASE ? [env.AFD_BASE] : DEFAULT_BASES,
		files: undefined,
		packages: [],
		paths: [],
		except: [],
		lanes: [],
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
		else if (arg === '--except') options.except.push(argv[++index]);
		else if (arg === '--lane') options.lanes.push(argv[++index]);
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

/** What `affected.mjs run` (the TypeScript gate) runs over, naming the lane packages its jobs run instead. */
function describeRun(scope, selected) {
	const lane = leftToLanes(scope);
	const left = selected.filter((name) => lane.has(name)).sort();
	const text = describe(
		scope,
		selected.filter((name) => !lane.has(name))
	);
	return left.length === 0 ? text : `${text}; left to their lane's job: ${left.join(', ')}`;
}

/** The packages of the scope's lanes (architecture.json `lanes`), which their own workflow jobs gate. */
const lanePackages = (scope) => new Set((scope.lanes ?? []).flatMap((lane) => lane.packages));

/**
 * The lane packages a scope leaves to their own job: all of them for a change's scope, none for the
 * whole workspace. A change gates a lane by its paths, inputs and imports (`gate --lane`); a global
 * file (the root tsconfig.json, .nvmrc), `check:all` and the daily run reach every package, and no
 * lane job's paths name those files, so there `pnpm check` builds and tests the lane too.
 */
const leftToLanes = (scope) => (scope.mode === 'all' ? new Set() : lanePackages(scope));

/**
 * pnpm arguments that run `script` over the scope, or null when nothing is selected. A change's
 * scope leaves its lane packages out, even as a dependency of a selected package (a devDependency
 * the lane's own paths use): the lane's job builds and tests them (Loam's hosted lane, D162).
 */
export function pnpmArgs(scope, script, { noBail = false, passthrough = [] } = {}) {
	const lane = leftToLanes(scope);
	const selected = (script === 'build' ? scope.build : scope.affected).filter(
		(name) => !lane.has(name)
	);
	if (selected.length === 0) return null;
	const filters =
		scope.mode === 'all'
			? []
			: selected.flatMap((name) => ['--filter', script === 'build' ? `${name}...` : name]);
	return [
		'-r',
		...filters,
		...[...lane].sort().flatMap((name) => ['--filter', `!${name}`]),
		...(noBail ? ['--no-bail'] : []),
		'run',
		'--if-present',
		script,
		...passthrough,
	];
}

/** A gate's packages and paths with each `--lane`'s packages, paths and inputs added; a lane architecture.json lacks fails. */
export function laneGate(scope, { packages = [], paths = [], except = [], lanes = [] }) {
	const added = lanes.map((name) => {
		const lane = (scope.lanes ?? []).find((candidate) => candidate.name === name);
		if (!lane) throw new Error(`architecture.json has no lane named ${name}`);
		return lane;
	});
	return {
		packages: [...packages, ...added.flatMap((lane) => lane.packages)],
		// Its paths, and its inputs: the files outside it that it reads (scripts/check-boundaries.mjs).
		paths: [...paths, ...added.flatMap((lane) => [...lane.paths, ...(lane.inputs ?? [])])],
		except,
	};
}

/** Whether a gated workflow must run: whole-workspace scope, a listed path, or a listed package. */
export function gate(scope, options) {
	const { packages, paths, except } = laneGate(scope, options);
	if (scope.mode === 'all') return { run: true, reason: scope.reason };
	const file = scope.files.find(
		(candidate) =>
			paths.some((path) => candidate.startsWith(path)) &&
			!except.some((prefix) => candidate.startsWith(prefix))
	);
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
 * Whether a change starts a workflow by its own `pull_request.paths`. A merge group starts every
 * workflow whatever its paths, so each asks this of itself. A scope with no file list (no base to
 * diff against, or the whole workspace asked for) runs it: unknown is not unaffected.
 * @param {ReturnType<typeof import('./affected/suites.mjs').readTrigger>} trigger
 */
export function workflowTrigger(scope, trigger) {
	if (!trigger) throw new Error('the workflow has no pull_request trigger to read paths from');
	if (trigger.paths === null)
		return { run: true, reason: 'its pull_request trigger has no path filter' };
	if (scope.mode === 'all' && scope.files.length === 0) return { run: true, reason: scope.reason };
	const file = scope.files.find((candidate) => matchesFilters(trigger.paths, candidate));
	if (file) return { run: true, reason: `${file} changed` };
	return {
		run: false,
		reason: `none of the ${scope.files.length} changed file(s) matches its pull_request.paths`,
	};
}

/**
 * The local suite steps a change selects, in order: a suite whose workflow's pull-request path
 * filter matches a changed file, minus the steps whose `Affected units` gate would not pass or
 * whose `platform` does not match the current host (#2366).
 */
export function planSuites(
	scope,
	{ root, suites = SUITES, read = readSuiteTrigger, platform = process.platform } = {}
) {
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
			if (step.platform && step.platform !== platform) continue;
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

/** What a suite leaves to remote CI on `platform`: its `remote` note plus any steps gated to another platform. */
export function suiteRemoteOnly(suite, platform = process.platform) {
	const skipped = suite.steps
		.filter((step) => step.platform && step.platform !== platform)
		.map((step) => `${step.run} (${step.platform} only)`);
	return [suite.remote, ...skipped].filter(Boolean).join('; ');
}

// The tools verify checks for before it runs anything. `chromium` is not one: no `which` finds
// Playwright's browser, so a missing one fails its step.
const TOOLS = { cargo: 'cargo', cmake: 'cmake', openssl: 'openssl', uv: 'uv' };

/** The tools a plan's steps need, each with the workflows that need it: a step's own, or its suite's. */
export function plannedTools(plan) {
	const needed = new Map();
	for (const { suite, step } of plan)
		for (const tool of step.tools ?? suite.tools)
			needed.set(tool, [...new Set([...(needed.get(tool) ?? []), suite.workflow])]);
	return needed;
}

const SHELL_META = /[&|;<>"'`$%^*?[\]{}()!\r\n]/;

/**
 * How a verify step is launched.
 *
 * - On Windows, `cargo fmt --all ...` passes every workspace file to `rustfmt` on one command line
 *   and hits the OS command-line limit (os error 206) in large workspaces such as Umbel (#1636).
 *   Expand it into one `cargo fmt -p <crate> ...` call per workspace member from `cargo metadata`.
 * - On Windows, a leading `bash <script> [args...]` step resolves a non-WSL `bash.exe` (such as
 *   Git Bash) so `cmd.exe` does not invoke `System32\bash.exe` (the WSL relay) when it precedes
 *   Git Bash on PATH (#2171). Simple `bash <args...>` invocations launch `bash.exe` directly via
 *   `execFileSync` (avoiding `cmd.exe` metacharacter parsing on the resolved path); compound shell
 *   lines quote the resolved executable for `cmd.exe`.
 */
export function stepExecution(
	run,
	{
		platform = process.platform,
		bash = bashCommand,
		cwd = root,
		workspaceCrates = cargoWorkspaceCrates,
	} = {}
) {
	if (platform === 'win32' && /^cargo\s+fmt\b/.test(run) && /\s--all(?:\s|$)/.test(run)) {
		const rest = run.replace(/^cargo\s+fmt\b/, '').trim();
		if (!SHELL_META.test(rest)) {
			const args = rest.split(/\s+/).filter((arg) => arg !== '--all');
			const crates = workspaceCrates(cwd);
			if (crates.length === 0) {
				throw new Error(`cargo metadata in ${cwd} reported no workspace crates`);
			}
			return {
				kind: 'execFiles',
				commands: crates.map((crate) => ({ file: 'cargo', args: ['fmt', '-p', crate, ...args] })),
			};
		}
	}
	if (platform !== 'win32' || !/^bash(?:\s|$)/.test(run)) return { kind: 'shell', command: run };
	const file = bash();
	const rest = run.replace(/^bash\b/, '').trim();
	if (!SHELL_META.test(rest)) {
		return { kind: 'execFile', file, args: rest ? rest.split(/\s+/) : [] };
	}
	if (/["%\r\n]/.test(file))
		throw new Error(`Refusing to pass ${JSON.stringify(file)} through cmd.exe`);
	return { kind: 'shell', command: run.replace(/^bash\b/, () => `"${file}"`) };
}

/** Workspace member package names in `cwd`, from `cargo metadata --no-deps --format-version 1`. */
export function cargoWorkspaceCrates(cwd) {
	const output = execFileSync('cargo', ['metadata', '--no-deps', '--format-version', '1'], {
		cwd,
		encoding: 'utf8',
		maxBuffer: 16 * 1024 * 1024,
	});
	const metadata = JSON.parse(output);
	return (metadata.packages ?? []).map((pkg) => pkg.name).sort();
}

function missingTools(plan) {
	const needed = new Map([...plannedTools(plan)].filter(([tool]) => TOOLS[tool]));
	const missing = [];
	for (const [tool, workflows] of needed) {
		try {
			execFileSync(windows ? 'where' : 'which', [TOOLS[tool]], { stdio: 'ignore' });
		} catch {
			missing.push(`${tool} (for ${workflows.join(', ')})`);
		}
	}
	const bashWorkflows = [
		...new Set(
			plan.filter(({ step }) => /^bash(?:\s|$)/.test(step.run)).map(({ suite }) => suite.workflow)
		),
	];
	if (bashWorkflows.length > 0) {
		try {
			if (windows) bashCommand();
			else execFileSync('which', ['bash'], { stdio: 'ignore' });
		} catch {
			missing.push(`bash (for ${bashWorkflows.join(', ')})`);
		}
	}
	return missing;
}

/**
 * `LEFTHOOK=0` turns lefthook off entirely, `lefthook run check` included, which then exits 0
 * having run nothing. Release sets it so Changesets' push skips the git hooks, so the gate drops it.
 */
export function checkEnvironment(all, environment = process.env) {
	const { LEFTHOOK, LEFTHOOK_EXCLUDE, ...rest } = environment;
	return { ...rest, AFD_SCOPE: all ? 'all' : (environment.AFD_SCOPE ?? '') };
}
function runCheck(all) {
	execFileSync('npx', ['lefthook', 'run', 'check'], {
		cwd: root,
		stdio: 'inherit',
		shell: windows,
		env: checkEnvironment(all),
	});
}

function verify(scope, options) {
	const plan = planSuites(scope, { root });
	console.error(`[verify] check (ci.yml): ${describeRun(scope, scope.affected)}`);
	let workflow = null;
	for (const { suite, step, reason } of plan) {
		if (suite.workflow !== workflow) {
			workflow = suite.workflow;
			console.error(`[verify] ${workflow} (${reason})`);
			const remote = suiteRemoteOnly(suite);
			if (remote) console.error(`           remote only: ${remote}`);
		}
		console.error(`           ${step.cwd ? `(${step.cwd}) ` : ''}${step.run}`);
	}
	if (plan.length === 0) console.error('[verify] no path-filtered workflow is triggered');
	if (options.list) return;
	const missing = missingTools(plan);
	if (missing.length > 0) throw new Error(`missing tools: ${missing.join('; ')}`);
	// Before building Rust, evict what no build has read for days, so a shared CARGO_TARGET_DIR
	// does not grow without bound (scripts/rust-sweep.mjs). A sweep never fails verify.
	if (plannedTools(plan).has('cargo'))
		try {
			for (const line of sweep(defaultTargets(root), { days: 3, maxGb: 60 }))
				console.error(`[verify] rust-sweep: ${line}`);
		} catch (error) {
			console.error(`[verify] rust-sweep: ${error.message}`);
		}

	const before = currentIdentity(git);
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
				const cwd = join(root, step.cwd ?? '.');
				const exec = stepExecution(step.run, { cwd });
				if (exec.kind === 'execFile') execFileSync(exec.file, exec.args, { cwd, stdio: 'inherit' });
				else if (exec.kind === 'execFiles') {
					for (const cmd of exec.commands)
						execFileSync(cmd.file, cmd.args, { cwd, stdio: 'inherit' });
				} else execSync(exec.command, { cwd, stdio: 'inherit' });
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
	// The record lets pre-push accept this exact commit without running its checks again.
	const { record: passed, reason } = buildRecord({
		before,
		after: currentIdentity(git),
		results,
		scope: scope.mode,
		defaultBase: options.bases === DEFAULT_BASES,
	});
	if (passed) {
		writeRecord(recordPath(git, root), passed);
		console.error(`[verify] recorded the pass for ${passed.head}; pre-push will accept it`);
	} else console.error(`[verify] no record for pre-push: ${reason}`);
}

function main(argv) {
	const options = parseArgs(argv);
	// The lefthook steps diff the branch themselves; a narrower --files scope would disagree.
	if (
		options.files &&
		(options.command === 'check' || (options.command === 'verify' && !options.list))
	)
		throw new Error(
			`${options.command} uses the branch diff; --files is for list, run, gate and verify --list`
		);
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
			console.error(`[affected] ${script}: ${describeRun(scope, selected)}`);
			if (!args) return;
			execFileSync('pnpm', args, { cwd: root, stdio: 'inherit', shell: windows });
			return;
		}
		case 'gate': {
			if (options.packages.length + options.paths.length + options.lanes.length === 0)
				throw new Error('gate needs a --package, a --path or a --lane');
			const result = gate(scope, options);
			console.log(`run=${result.run}: ${result.reason}`);
			if (process.env.GITHUB_OUTPUT)
				appendFileSync(process.env.GITHUB_OUTPUT, `run=${result.run}\n`);
			return;
		}
		case 'trigger': {
			const [workflow] = options.positional;
			if (!/^[\w.-]+\.ya?ml$/.test(workflow ?? ''))
				throw new Error('trigger needs a workflow file name, such as rust.yml');
			const trigger = readSuiteTrigger(root, { workflow });
			if (!trigger) throw new Error(`${workflow} has no pull_request trigger`);
			const result = workflowTrigger(scope, trigger);
			console.log(`run=${result.run}: ${result.reason}`);
			if (process.env.GITHUB_OUTPUT)
				appendFileSync(process.env.GITHUB_OUTPUT, `run=${result.run}\n`);
			return;
		}
		case 'check': {
			console.error(`[affected] check: ${describeRun(scope, scope.affected)}`);
			runCheck(options.all);
			return;
		}
		case 'verify':
			verify(scope, options);
			return;
		default:
			throw new Error('expected list, run, gate, trigger, check or verify');
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

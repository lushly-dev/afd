#!/usr/bin/env node
/**
 * Runs software-factory jobs through AFD's TypeScript scenario runner (`ScenarioExecutor` and
 * `CliWrapper` from @lushly-dev/afd-testing) against the `factory` host and a fixture world.
 *
 * Usage: node run.mjs <scenario.yaml>...
 *
 * Each scenario gets its own empty run directory. Its fixture (merged over its `base` by the
 * runner) is applied through a registered `factory` fixture adapter, which calls the harness's
 * `fixture-apply`; every step then runs `factory-cli.mjs call <command> <json> --format json`,
 * which hands it to `python -m botcore_factory.harness`. FACTORY_PYTHON names the interpreter
 * that has botcore-factory installed (default: python). The target is the example repository
 * the fixtures describe, built in the run directory: `repository/botcore.toml` beside this file
 * (its adapter) and AFD's own `.github/labels.json`.
 *
 * Prints one JSON report: each scenario's outcome and every assertion that did not pass. Exit 0
 * when every scenario passed, 1 when one did not, 2 when the runner could not start.
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '../../../../..');
const testingEntry = join(root, 'packages/testing/dist/index.js');

function fail(message) {
	process.stderr.write(`${message}\n`);
	process.exit(2);
}

const files = process.argv.slice(2);
if (files.length === 0) fail('Usage: node run.mjs <scenario.yaml>...');
if (!existsSync(testingEntry)) {
	fail(
		'@lushly-dev/afd-testing is not built. Run: pnpm install --frozen-lockfile && pnpm -F "@lushly-dev/afd-testing..." build'
	);
}

// afd-testing is a workspace package this Python plugin does not depend on through npm, so it
// is loaded from its build output rather than resolved by name.
const testing = await import(pathToFileURL(testingEntry).href);

/** The `factory` fixture adapter: a fixture is applied by the harness, in one call. */
testing.registerAdapter({
	name: 'factory',
	version: '0.1.0',
	cli: { command: 'factory-cli.mjs', inputFormat: 'json-arg', outputFormat: 'json' },
	fixture: {
		async apply(fixture, context) {
			await context.handler('fixture-apply', { fixture });
			return { appliedCommands: [{ command: 'fixture-apply' }] };
		},
		async reset() {},
	},
	commands: { list: () => [] },
	errors: { list: () => [] },
	jobs: { list: () => [] },
});

/** The CLI the runner spawns. POSIX runs it directly, so a temporary copy gets the exec bit. */
function launcher(runDir) {
	const source = join(here, 'factory-cli.mjs');
	if (process.platform === 'win32') return source; // CliWrapper runs a .mjs CLI with Node.
	const copy = join(runDir, 'factory-cli.mjs');
	copyFileSync(source, copy);
	chmodSync(copy, 0o755);
	return copy;
}

function failures(step) {
	return step.assertions
		.filter((assertion) => !assertion.passed)
		.map(({ path, matcher, description }) => ({ path, matcher, description }));
}

/** The example repository the job fixtures describe: its adapter and AFD's labels. */
function exampleRepository(runDir) {
	const repository = join(runDir, 'repository');
	mkdirSync(join(repository, '.github'), { recursive: true });
	copyFileSync(join(here, 'repository', 'botcore.toml'), join(repository, 'botcore.toml'));
	copyFileSync(join(root, '.github', 'labels.json'), join(repository, '.github', 'labels.json'));
	return repository;
}

async function runOne(file) {
	const runDir = mkdtempSync(join(tmpdir(), 'factory-scenario-'));
	try {
		const parsed = await testing.parseScenarioFile(resolve(file));
		if (!parsed.success) return { file, outcome: 'error', error: parsed.error, steps: [] };
		const executor = new testing.ScenarioExecutor({
			cliPath: launcher(runDir),
			cwd: exampleRepository(runDir),
			env: {
				BOTCORE_FACTORY_HARNESS_DIR: join(runDir, 'run'),
				FACTORY_PYTHON: process.env.FACTORY_PYTHON || 'python',
			},
			timeout: 120_000,
			stopOnFailure: false,
		});
		const result = await executor.execute(parsed.scenario);
		return {
			file,
			job: result.jobName,
			outcome: result.outcome,
			error: result.error?.message,
			steps: result.stepResults.map((step, index) => ({
				index,
				command: step.command,
				outcome: step.outcome,
				error: step.error?.message,
				failed: failures(step),
			})),
		};
	} finally {
		rmSync(runDir, { recursive: true, force: true });
	}
}

const scenarios = [];
for (const file of files) scenarios.push(await runOne(file));
process.stdout.write(`${JSON.stringify({ scenarios }, null, 2)}\n`);
process.exitCode = scenarios.every((scenario) => scenario.outcome === 'pass') ? 0 : 1;

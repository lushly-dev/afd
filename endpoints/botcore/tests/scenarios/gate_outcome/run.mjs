#!/usr/bin/env node
/**
 * Runs Botcore's gate outcome jobs (the test effectiveness plan's scenarios) through AFD's
 * TypeScript scenario runner (`ScenarioExecutor` and `CliWrapper` from @lushly-dev/afd-testing),
 * as the factory plugin's `scenarios/run.mjs` runs its jobs.
 *
 * Usage: node run.mjs <scenario.yaml>...
 *
 * Each scenario gets its own empty run directory, which `harness.py prepare` fills with the
 * scenario's world: a git checkout of the invented repository (the working directory of every
 * step) and the recorded GitHub answers. Every step then runs `cli.mjs call <command> <json>
 * --format json`, which hands it to `harness.py call` with the run directory in
 * GATE_OUTCOME_RUN, so the record is the run's own. GATE_OUTCOME_PYTHON names the interpreter
 * that has Botcore installed (default: python).
 *
 * Prints one JSON report: each scenario's outcome and every assertion that did not pass. Exit 0
 * when every scenario passed, 1 when one did not, 2 when the runner could not start.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '../../../../..');
const testingEntry = join(root, 'packages/testing/dist/index.js');
const harness = join(here, 'harness.py');
const python = process.env.GATE_OUTCOME_PYTHON || 'python';

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

// afd-testing is a workspace package Botcore does not depend on through npm, so it is loaded
// from its build output rather than resolved by name.
const testing = await import(pathToFileURL(testingEntry).href);

/** The CLI the runner spawns. POSIX runs it directly, so a temporary copy gets the exec bit. */
function launcher(runDir) {
	const source = join(here, 'cli.mjs');
	if (process.platform === 'win32') return source; // CliWrapper runs a .mjs CLI with Node.
	const copy = join(runDir, 'cli.mjs');
	copyFileSync(source, copy);
	chmodSync(copy, 0o755);
	return copy;
}

function failures(step) {
	return step.assertions
		.filter((assertion) => !assertion.passed)
		.map(({ path, matcher, description }) => ({ path, matcher, description }));
}

async function runOne(file) {
	const runDir = mkdtempSync(join(tmpdir(), 'gate-outcome-scenario-'));
	try {
		const prepared = spawnSync(python, [harness, 'prepare', runDir, basename(file)], {
			encoding: 'utf-8',
			windowsHide: true,
		});
		if (prepared.status !== 0) {
			return {
				file,
				outcome: 'error',
				error: prepared.stderr || prepared.error?.message,
				steps: [],
			};
		}
		const parsed = await testing.parseScenarioFile(resolve(file));
		if (!parsed.success) return { file, outcome: 'error', error: parsed.error, steps: [] };
		const executor = new testing.ScenarioExecutor({
			cliPath: launcher(runDir),
			cwd: join(runDir, 'repository'),
			env: {
				GATE_OUTCOME_RUN: runDir,
				GATE_OUTCOME_HARNESS: harness,
				GATE_OUTCOME_PYTHON: python,
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

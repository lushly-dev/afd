/**
 * @fileoverview Scales JTBD scenarios (01–08: Slice 1 + Slice 2 optional `warnUneven`) executed
 * in-process against `@lushly-dev/violet-afd` through the `app: 'violet'` fixture adapter.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	type CommandResult,
	type ScenarioResult,
	createInProcessExecutor,
	getAdapter,
	parseScenarioFile,
	registerAdapter,
} from '@lushly-dev/afd-testing';
import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeAll, describe, expect, it } from 'vitest';
import { initializeCore, registry } from '../src/index.js';
import { violetAdapter } from './violet-adapter.js';

const SCENARIOS_DIR = fileURLToPath(new URL('.', import.meta.url));
const SCENARIO_FILES = readdirSync(SCENARIOS_DIR)
	.filter((name) => name.endsWith('.scenario.yaml'))
	.sort();

function summarizeFailures(result: ScenarioResult) {
	return result.stepResults
		.filter((step) => step.outcome !== 'pass')
		.map((step) => ({
			step: step.stepId,
			command: step.command,
			error: step.error?.message,
			failed: step.assertions
				.filter((assertion) => !assertion.passed)
				.map((assertion) => ({
					path: assertion.path,
					expected: assertion.expected,
					actual: assertion.actual,
				})),
			got: step.commandResult?.success ? step.commandResult.data : step.commandResult?.error,
		}));
}

function validateOutputSchema(
	command: string,
	result: CommandResult<unknown>,
): CommandResult<unknown> {
	if (result.success) {
		const definition = registry.get(command);
		const parsed = definition?.outputSchema.safeParse(result.data);
		if (parsed && !parsed.success) {
			throw new Error(
				`${command} returned data rejected by its outputSchema: ${parsed.error.message}`,
			);
		}
	}
	return result;
}

describe('Scales scenarios (01–08)', () => {
	beforeAll(() => {
		initializeCore();
		if (!getAdapter('violet')) {
			registerAdapter(violetAdapter);
		}
	});

	it('discovers all 8 Scales scenarios', () => {
		expect(SCENARIO_FILES).toEqual([
			'01-add-between-steps.scenario.yaml',
			'02-retune-ramp-step.scenario.yaml',
			'03-choose-by-purpose.scenario.yaml',
			'04-allow-reasoned-off-ramp.scenario.yaml',
			'05-stay-quiet-when-compliant.scenario.yaml',
			'06-flag-repeated-off-ramp.scenario.yaml',
			'07-refuse-broken-or-leaked-ramp.scenario.yaml',
			'08-warn-uneven-ramp-jumps.scenario.yaml',
		]);
	});

	it.each(SCENARIO_FILES)('%s', async (file) => {
		const parsed = await parseScenarioFile(join(SCENARIOS_DIR, file));
		if (!parsed.success) {
			throw new Error(`${file}: ${parsed.error}`);
		}

		const db = createMemoryDatabase();
		const executor = createInProcessExecutor({
			handler: async (command, input) => {
				const result = (await registry.execute(command, input ?? {}, {
					db,
					actor: 'scenario-runner',
				})) as CommandResult<unknown>;
				return validateOutputSchema(command, result);
			},
			stopOnFailure: false,
		});

		const result = await executor.execute(parsed.scenario);
		expect(summarizeFailures(result)).toEqual([]);
		expect(result.passedSteps).toBe(parsed.scenario.steps.length);
	});
});

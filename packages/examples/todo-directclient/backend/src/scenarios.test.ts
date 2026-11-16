/**
 * @fileoverview Runs the jobs in `scenarios/` through the copilot's DirectClient, in-process,
 * with a fixed clock and seeded random, on an in-memory store. Each file's `job` names the mode
 * its steps run in.
 */

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setStore, TodoStore } from '@afd/example-todo-ts/store';
import {
	fixedClock,
	InProcessExecutor,
	parseScenarioFile,
	seededRandom,
} from '@lushly-dev/afd-testing';
import { describe, expect, it } from 'vitest';
import { Copilot, type CopilotMode } from './copilot.js';
import { createCopilotRegistry } from './registry.js';

const MODE: Record<string, CopilotMode> = {
	'look-without-changing': 'look',
};

const directory = fileURLToPath(new URL('../scenarios/', import.meta.url));
const files = readdirSync(directory).filter((name) => name.endsWith('.scenario.yaml'));

describe('scenarios/', () => {
	it('has the jobs built so far', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	for (const file of files) {
		it(file, async () => {
			const parsed = await parseScenarioFile(directory + file);
			if (!parsed.success) throw new Error(parsed.error);
			const mode = MODE[parsed.scenario.job];
			if (!mode) throw new Error(`Give job ${parsed.scenario.job} a mode in MODE`);

			setStore(new TodoStore());
			const client = new Copilot({
				registry: createCopilotRegistry({}),
				model: { respond: async () => ({ calls: [] }) },
			}).client(mode);
			const executor = new InProcessExecutor({
				handler: (command, input, context) => client.call(command, input ?? {}, context),
				context: { clock: fixedClock('2026-11-15T09:00:00Z'), random: seededRandom(file) },
			});
			const result = await executor.execute(parsed.scenario);

			const failures = result.stepResults
				.filter((step) => step.outcome !== 'pass')
				.map((step) => `${step.stepId}: ${step.error?.message ?? step.outcome}`);
			expect(failures).toEqual([]);
		});
	}
});

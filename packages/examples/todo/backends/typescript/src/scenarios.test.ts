/**
 * @fileoverview Runs the jobs in `scenarios/` against the server's own commands and middleware
 * (approvals and the change history), in-process, with a fixed clock and seeded random.
 */

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDirectRegistry, createMcpServer } from '@lushly-dev/afd-server';
import {
	fixedClock,
	InProcessExecutor,
	parseScenarioFile,
	seededRandom,
} from '@lushly-dev/afd-testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { allCommands } from './commands/index.js';
import { TODO_CONTEXTS } from './contexts.js';
import { createTodoMiddleware, createTodoServerOptions } from './server-options.js';
import { store } from './store/index.js';

/** Jobs that run inside a context: in-process, as an MCP request's `_meta` would name it. */
const ACTIVE_CONTEXT: Record<string, string> = {
	'review-with-reading-commands': 'todo-reading',
};

const directory = fileURLToPath(new URL('../scenarios/', import.meta.url));
const files = readdirSync(directory).filter((name) => name.endsWith('.scenario.yaml'));

beforeEach(() => {
	store.clear();
});

describe('scenarios/', () => {
	it('has the jobs built so far', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	for (const file of files) {
		it(file, async () => {
			const parsed = await parseScenarioFile(directory + file);
			if (!parsed.success) throw new Error(parsed.error);

			const activeContext = ACTIVE_CONTEXT[parsed.scenario.job];
			const server = createMcpServer(createTodoServerOptions({}));
			const registry = createDirectRegistry(allCommands, {
				contexts: TODO_CONTEXTS,
				middleware: createTodoMiddleware({}),
			});
			const executor = new InProcessExecutor({
				handler: (command, input, context) =>
					activeContext
						? registry.execute(command, input ?? {}, context, { activeContext })
						: server.execute(command, input ?? {}, context),
				context: { clock: fixedClock('2026-11-15T09:00:00Z'), random: seededRandom(file) },
			});
			const result = await executor.execute(parsed.scenario);

			const failures = result.stepResults
				.filter((step) => step.outcome !== 'pass')
				.map((step) => ({ step: step.stepId, error: step.error }));
			expect(failures).toEqual([]);
			expect(result.outcome).toBe('pass');
		});
	}
});

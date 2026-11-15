/**
 * The seventeen jobs of the seed library, run as its acceptance tests (`scenarios/`).
 *
 * Fifteen run in process as the steward: the executor's context gives every step a person with
 * the steward's role, in place of the runner's test actor, which the library treats as nobody in
 * particular. The first steps of jobs 12 and 16 expect `CONFIRMATION_REQUIRED`, which an
 * in-process call never returns, so those two run over MCP against a server that enforces
 * confirmations and whose `createContext` gives every call a person with the steward's role
 * (`seed-library.md`, "What a scenario could not express").
 */

import { readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, type McpClient } from '@lushly-dev/afd-client';
import type { Actor, CommandContext, CommandResult } from '@lushly-dev/afd-core';
import {
	createInProcessExecutor,
	getAdapter,
	parseScenarioFile,
	registerAdapter,
	type ScenarioResult,
} from '@lushly-dev/afd-testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createSeedLibraryAdapter } from './adapter.js';
import { createSeedLibrary, type SeedLibrary } from './app.js';
import { createSeedLibraryHandler } from './server.js';

const SCENARIOS = fileURLToPath(new URL('../scenarios/', import.meta.url));
const FILES = readdirSync(SCENARIOS)
	.filter((name) => name.endsWith('.scenario.yaml'))
	.sort();
/** The jobs whose first step needs a server that enforces confirmations. */
const OVER_MCP = new Set([
	'12-retire-a-variety.scenario.yaml',
	'16-clear-a-past-season.scenario.yaml',
]);

/** Who runs every step: a person with the steward's role, as a screen signed in as the steward. */
const STEWARD: Actor = { kind: 'human', id: 'steward', label: 'The steward' };

/** The library the current scenario's fixture is loaded into. */
let library: SeedLibrary;
const tally = { steps: 0, passed: 0 };

beforeAll(() => {
	if (!getAdapter('seed-library')) registerAdapter(createSeedLibraryAdapter(() => library));
});

/** Every step that did not pass, with what it got, so a failure reads without a debugger. */
function failures(result: ScenarioResult) {
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

/** Check a successful result's `data` against the command's `output` schema. */
function checkOutput(command: string, result: CommandResult<unknown>): CommandResult<unknown> {
	if (result.success) {
		const schema = library.commands.find((entry) => entry.name === command)?.outputSchema;
		const parsed = schema ? z.safeParse(schema, result.data) : undefined;
		if (parsed && !parsed.success) {
			throw new Error(
				`${command} returned data its output schema refuses: ${parsed.error.message}`
			);
		}
	}
	return result;
}

async function run(
	file: string,
	handler: (
		command: string,
		input?: Record<string, unknown>,
		context?: CommandContext
	) => Promise<CommandResult<unknown>>
) {
	const parsed = await parseScenarioFile(join(SCENARIOS, file));
	if (!parsed.success) throw new Error(`${file}: ${parsed.error}`);
	const executor = createInProcessExecutor({
		handler: async (command, input, context) =>
			checkOutput(command, await handler(command, input, context)),
		stopOnFailure: false,
		context: { actor: STEWARD, clock: library.clock },
	});
	const result = await executor.execute(parsed.scenario);
	tally.steps += parsed.scenario.steps.length;
	tally.passed += result.passedSteps;
	return { result, steps: parsed.scenario.steps.length };
}

describe('the seed library jobs, in process', () => {
	it.each(FILES.filter((file) => !OVER_MCP.has(file)))('%s', async (file) => {
		library = createSeedLibrary();
		const registry = library.createRegistry();
		const { result, steps } = await run(file, (command, input, context) =>
			registry.execute(command, input ?? {}, context)
		);
		expect(failures(result)).toEqual([]);
		expect(result.passedSteps).toBe(steps);
	});
});

describe('the seed library jobs, over MCP with confirmations enforced', () => {
	const cleanups: Array<() => Promise<void> | void> = [];

	afterEach(async () => {
		for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
	});

	/** Serve the current library to a person with the steward's role, and connect to it. */
	async function serve(): Promise<McpClient> {
		const handler = createSeedLibraryHandler(library, {
			host: '127.0.0.1',
			actor: STEWARD,
		});
		const server = createServer(handler);
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		cleanups.push(async () => {
			handler.dispose();
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		});
		const { port } = server.address() as AddressInfo;
		const client = createClient({
			url: `http://127.0.0.1:${port}/mcp`,
			transport: 'streamable-http',
			autoReconnect: false,
		});
		await client.connect();
		cleanups.push(() => client.disconnect());
		return client;
	}

	it.each([...OVER_MCP])('%s', async (file) => {
		library = createSeedLibrary();
		const client = await serve();
		const { result, steps } = await run(file, (command, input) =>
			client.call(command, input ?? {})
		);
		expect(failures(result)).toEqual([]);
		expect(result.passedSteps).toBe(steps);
	});
});

describe('all seventeen', () => {
	afterAll(() => {
		// Reported for the record: the design counts 113 steps.
		console.error(`[seed-library] ${tally.passed} of ${tally.steps} scenario steps passed`);
	});

	it('ran every file and every step passed', () => {
		expect(FILES).toHaveLength(17);
		expect(tally.steps).toBe(113);
		expect(tally.passed).toBe(113);
	});
});

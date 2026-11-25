/**
 * The bench's result fixtures (`bench/results/`) against the commands they claim to come from:
 * each successful result's `data` must pass its command's `output` schema, and each failure's
 * code must be one the command returns. A screen is built from these files, so a file that
 * drifts from the application would build a screen for an application that does not exist.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createSeedLibrary } from './app.js';

const RESULTS = fileURLToPath(
	new URL('../../../../docs/features/active/agent-first-design/bench/results/', import.meta.url)
);

const files = readdirSync(RESULTS, { recursive: true, encoding: 'utf8' })
	.filter((name) => name.endsWith('.json'))
	.map((name) => join(RESULTS, name))
	.sort();

const { commands } = createSeedLibrary();
const byName = new Map(commands.map((command) => [command.name, command]));

interface WireResult {
	success: boolean;
	data?: unknown;
	error?: { code?: string };
}

/** The file without the keys a screen's fixture loader strips. */
function stripDollarKeys(value: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith('$')));
}

/** What is wrong with one command's result, or an empty list. */
function problems(command: string, result: WireResult): string[] {
	const definition = byName.get(command);
	if (!definition) return [`${command} is not one of the library's commands`];
	if (result.success) {
		const schema = definition.outputSchema;
		if (!schema) return [`${command} declares no output schema`];
		const parsed = z.safeParse(schema, result.data);
		return parsed.success
			? []
			: parsed.error.issues.map((issue) => `data.${issue.path.join('.')}: ${issue.message}`);
	}
	const code = result.error?.code;
	return code && definition.errors?.includes(code)
		? []
		: [`${command} does not return ${code ?? 'a failure without a code'}`];
}

describe('bench result fixtures', () => {
	it('finds the 74 results', () => {
		expect(files).toHaveLength(74);
	});

	it.each(files.map((file) => [relative(RESULTS, file), file]))('%s', (_name, file) => {
		const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
		const command = raw.$command;
		expect(typeof command).toBe('string');
		const result = stripDollarKeys(raw) as unknown as WireResult & {
			results?: Array<{ command: string; result: WireResult }>;
		};
		if (command === 'afd-batch') {
			expect(result.results?.length).toBeGreaterThan(0);
			const found = (result.results ?? []).flatMap((item, index) =>
				problems(item.command, item.result).map((problem) => `results[${index}]: ${problem}`)
			);
			expect(found).toEqual([]);
			return;
		}
		expect(problems(command as string, result)).toEqual([]);
	});
});

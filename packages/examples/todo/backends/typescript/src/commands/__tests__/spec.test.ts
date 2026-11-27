/**
 * @fileoverview Keeps the command list in sync with the shared contract in spec/.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allCommands } from '../index.js';

const schema = JSON.parse(
	readFileSync(new URL('../../../../../spec/commands.schema.json', import.meta.url), 'utf-8')
) as { commands: Record<string, { metadata: Metadata; idempotency?: string }> };

/** What each command declares, the same in every backend. */
interface Metadata {
	mutation: boolean;
	destructive: boolean;
	contexts: string[];
	confirmPrompt?: string;
}

describe('spec/commands.schema.json', () => {
	it('lists exactly the commands this backend defines', () => {
		const defined = allCommands.map((command) => command.name).sort();
		expect(Object.keys(schema.commands).sort()).toEqual(defined);
	});

	it('declares the metadata the spec gives each command', () => {
		for (const command of allCommands) {
			const declared: Metadata = {
				mutation: command.mutation ?? false,
				destructive: command.destructive ?? false,
				contexts: [...(command.contexts ?? [])].sort(),
				...(command.confirmPrompt ? { confirmPrompt: command.confirmPrompt } : {}),
			};
			const expected = schema.commands[command.name]?.metadata;
			expect(declared, command.name).toEqual({
				...expected,
				contexts: [...(expected?.contexts ?? [])].sort(),
			});
		}
	});

	it('declares the idempotency the spec gives each command, and every mutation declares one', () => {
		for (const command of allCommands) {
			expect(command.idempotency, command.name).toBe(schema.commands[command.name]?.idempotency);
			if (command.mutation) expect(command.idempotency, command.name).toBeDefined();
		}
	});

	it('exposes every command to MCP clients', () => {
		for (const command of allCommands) {
			expect(command.expose?.mcp, command.name).toBe(true);
		}
	});
});

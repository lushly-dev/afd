/**
 * @fileoverview Keeps the command list in sync with the shared contract in spec/.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allCommands } from '../index.js';

const schema = JSON.parse(
	readFileSync(new URL('../../../../../spec/commands.schema.json', import.meta.url), 'utf-8')
) as { commands: Record<string, unknown> };

describe('spec/commands.schema.json', () => {
	it('lists exactly the commands this backend defines', () => {
		const defined = allCommands.map((command) => command.name).sort();
		expect(Object.keys(schema.commands).sort()).toEqual(defined);
	});

	it('exposes every command to MCP clients', () => {
		for (const command of allCommands) {
			expect(command.expose?.mcp, command.name).toBe(true);
		}
	});
});

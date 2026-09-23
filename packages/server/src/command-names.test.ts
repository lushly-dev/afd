/**
 * Duplicate and reserved command names are rejected when a server is created.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineCommand } from './schema.js';
import { createMcpHandler, createMcpServer } from './server.js';
import type { McpHandlerOptions } from './server-types.js';

function command(name: string) {
	return defineCommand({
		name,
		description: `Command ${name}`,
		expose: { mcp: true },
		input: z.object({}),
		handler: async () => ({ success: true, data: name }),
	});
}

function create(options: Partial<McpHandlerOptions> & Pick<McpHandlerOptions, 'commands'>) {
	return () => createMcpServer({ name: 'names', version: '1', transport: 'http', ...options });
}

describe('command name checks at server creation', () => {
	it('rejects duplicate names in createMcpServer and createMcpHandler', () => {
		const commands = [command('todo-get'), command('todo-list'), command('todo-get')];
		expect(create({ commands })).toThrow(/Duplicate command name 'todo-get'/);
		expect(() => createMcpHandler({ name: 'names', version: '1', commands })).toThrow(
			/Duplicate command name 'todo-get'/
		);
	});

	it.each(['afd-call', 'afd-batch', 'afd-pipe', 'afd-discover', 'afd-detail'])(
		'rejects the router meta-tool name %s',
		(name) => {
			expect(create({ commands: [command(name)] })).toThrow(
				new RegExp(`'${name}' is reserved: the tool router handles`)
			);
		}
	);

	it.each(['afd-help', 'afd-docs', 'afd-schema'])(
		'rejects %s with bootstrap: true and allows it otherwise',
		(name) => {
			expect(create({ commands: [command(name)], bootstrap: true })).toThrow(
				new RegExp(`'${name}' is reserved: bootstrap: true registers`)
			);
			const server = createMcpServer({
				name: 'names',
				version: '1',
				transport: 'http',
				commands: [command(name)],
			});
			expect(server.getCommands().map((c) => c.name)).toEqual([name]);
		}
	);

	it.each(['afd-context-list', 'afd-context-enter', 'afd-context-exit'])(
		'rejects %s when contexts are configured',
		(name) => {
			expect(create({ commands: [command(name)], contexts: [{ name: 'edit' }] })).toThrow(
				new RegExp(`'${name}' is reserved: contexts registers`)
			);
			expect(create({ commands: [command(name)] })).not.toThrow();
		}
	);

	it('accepts unique, unreserved names', () => {
		expect(
			create({ commands: [command('todo-get'), command('todo-list')], bootstrap: true })
		).not.toThrow();
	});
});

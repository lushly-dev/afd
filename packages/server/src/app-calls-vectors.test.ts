/**
 * Checks app-to-app calls against `spec/vectors/app-calls.json` (`spec/command-metadata.md`,
 * "App-to-app calls"; Loam phase 5, step 0b): an `apps` call on `createAppCallRegistry`, any other
 * on `createDirectRegistry` with the call's interface, the caller a declared context field, as
 * Loam's `caller` is. `createAppCallRegistry` needs `callGrant`, so the `none` cases check that
 * creating one without it throws; it serves no tool surface, so the batches run on the core
 * registry's test only.
 */
import { readFileSync } from 'node:fs';
import { DirectClient } from '@lushly-dev/afd-client';
import type { CommandContext, ExposeOptions } from '@lushly-dev/afd-core';
import { success } from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createAppCallRegistry } from './app-call-registry.js';
import { createDirectRegistry, type DirectCommandRegistry } from './direct-registry.js';
import { createDirectToolSurface } from './direct-tool-surface.js';
import { defineCommand } from './schema.js';

interface Vectors {
	refusal: Record<string, unknown>;
	registry: {
		commands: { name: string; expose: ExposeOptions }[];
		grants: Record<string, string[]>;
	};
	calls: {
		description: string;
		grant: 'grants' | 'none' | 'throws';
		call: {
			name: string;
			interface?: keyof ExposeOptions;
			caller?: string;
			input: Record<string, unknown>;
		};
		expect: { refused?: true; data?: unknown; code?: string };
	}[];
}

const vectors = JSON.parse(
	readFileSync(new URL('../../../spec/vectors/app-calls.json', import.meta.url), 'utf8')
) as Vectors;

const commands = vectors.registry.commands.map(({ name, expose }) =>
	defineCommand({
		name,
		description: `The fixture command ${name}`,
		input: z.strictObject({ by: z.number().int().default(1) }),
		expose,
		handler: async (input) => success({ command: name, by: input.by }),
	})
);

const contextFields = [{ name: 'caller', meta: 'dev.example/caller', schema: z.string() }];

function callGrantFor(grant: 'grants' | 'none' | 'throws') {
	const { grants } = vectors.registry;
	if (grant === 'none') return undefined;
	if (grant === 'throws') {
		return () => {
			throw new Error('the grant store is unreachable');
		};
	}
	return (command: string, context: CommandContext) =>
		typeof context.caller === 'string' && (grants[context.caller]?.includes(command) ?? false);
}

describe('spec/vectors/app-calls.json on createAppCallRegistry and createDirectRegistry', () => {
	for (const item of vectors.calls) {
		const { name, interface: iface, caller, input } = item.call;
		// A call with no interface is a trusted in-process call; a direct registry always has one.
		if (iface === undefined) continue;
		it(`call: ${item.description}`, async () => {
			const callGrant = callGrantFor(item.grant);
			let registry: DirectCommandRegistry;
			if (iface === 'apps') {
				if (callGrant === undefined) {
					expect(() => createAppCallRegistry(commands, { contextFields } as never)).toThrow(
						/needs callGrant/
					);
					return;
				}
				registry = createAppCallRegistry(commands, { contextFields, callGrant });
			} else {
				registry = createDirectRegistry(commands, { interface: iface, contextFields });
			}
			const result = await registry.execute(name, input, caller === undefined ? {} : { caller });
			if (item.expect.refused) {
				expect(result).toEqual({ success: false, error: vectors.refusal });
			} else if (item.expect.code) {
				expect(result.success).toBe(false);
				expect(result.error?.code).toBe(item.expect.code);
			} else {
				expect(result.success).toBe(true);
				expect(result.data).toEqual(item.expect.data);
			}
		});
	}

	it('exposes nothing under the apps interface of createDirectRegistry, which has no grant check', async () => {
		const registry = createDirectRegistry(commands, { interface: 'apps' as 'agent' });
		expect(registry.interface).toBe('apps');
		expect(registry.listCommandNames()).toEqual([]);
		expect(registry.hasCommand('tally-get')).toBe(false);
		const result = await registry.execute('tally-get', {});
		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('COMMAND_NOT_EXPOSED');
	});

	it('serves no tool surface, even from outside the type checker', async () => {
		const registry = createAppCallRegistry(commands, {
			callGrant: () => true,
			...({ tools: createDirectToolSurface(), interface: 'agent' } as object),
		});
		expect(registry.interface).toBe('apps');
		expect(() => registry.listTools()).toThrow(/no tool surface/);
		expect(await registry.execute('afd-call', { command: 'tally-get' })).toEqual({
			success: false,
			error: vectors.refusal,
		});
	});

	it('lists the commands exposed to apps, and answers hasCommand for every name', () => {
		const registry = createAppCallRegistry(commands, { callGrant: () => false });
		expect(registry.listCommandNames()).toEqual(['tally-get']);
		expect(registry.hasCommand('tally-get')).toBe(true);
		expect(registry.hasCommand('tally-nothing')).toBe(true);
	});

	it('gives a DirectClient over it the one refusal for every name, with no names', async () => {
		const client = new DirectClient(createAppCallRegistry(commands, { callGrant: () => false }));
		for (const name of ['tally-get', 'tally-add', 'tally-nothing', 'afd-batch']) {
			const result = await client.call(name, {});
			expect(result, name).toMatchObject({ success: false, error: vectors.refusal });
		}
	});

	it('runs a granted call through the middleware, with apps as its interface', async () => {
		const seen: unknown[] = [];
		const registry = createAppCallRegistry(commands, {
			contextFields,
			callGrant: (command: string, context: CommandContext) =>
				command === 'tally-get' && context.caller === 'checklist',
			middleware: [
				async (name, _input, context, next) => {
					seen.push([name, context.interface, context.caller]);
					return next();
				},
			],
		});
		await registry.execute('tally-get', {}, { caller: 'checklist' });
		await registry.execute('tally-get', {}, { caller: 'hello' });
		// The refusal comes before middleware, so only the granted call reached it.
		expect(seen).toEqual([['tally-get', 'apps', 'checklist']]);
	});
});

/**
 * Checks app-to-app calls on `createDirectRegistry` against `spec/vectors/app-calls.json`
 * (`spec/command-metadata.md`, "App-to-app calls"; Loam phase 5, step 0b). Each case builds one
 * registry for the call's interface, with the caller as a declared context field, as Loam's
 * `caller` is. An `'apps'` registry needs `callGrant`, so the `none` cases check that creating one
 * without it throws; an `'apps'` registry serves no tool surface, so the batches run on the core
 * registry's test only.
 */
import { readFileSync } from 'node:fs';
import type { CommandContext, ExposeOptions } from '@lushly-dev/afd-core';
import { success } from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDirectRegistry, type DirectRegistryOptions } from './direct-registry.js';
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

describe('spec/vectors/app-calls.json on createDirectRegistry', () => {
	for (const item of vectors.calls) {
		const { name, interface: iface, caller, input } = item.call;
		// A call with no interface is a trusted in-process call; a direct registry always has one.
		if (iface === undefined) continue;
		it(`call: ${item.description}`, async () => {
			const callGrant = callGrantFor(item.grant);
			const options: DirectRegistryOptions = { interface: iface, contextFields, callGrant };
			if (iface === 'apps' && callGrant === undefined) {
				expect(() => createDirectRegistry(commands, options)).toThrow(/needs callGrant/);
				return;
			}
			const registry = createDirectRegistry(commands, options);
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

	it('refuses a tool surface on an apps registry', () => {
		expect(() =>
			createDirectRegistry(commands, {
				interface: 'apps',
				callGrant: () => true,
				tools: createDirectToolSurface(),
			})
		).toThrow(/serves no tool surface/);
	});

	it('lists the commands exposed to apps, whatever any caller is granted', () => {
		const registry = createDirectRegistry(commands, {
			interface: 'apps',
			callGrant: () => false,
		});
		expect(registry.listCommandNames()).toEqual(['tally-get']);
		expect(registry.hasCommand('tally-get')).toBe(true);
	});

	it('runs a granted call through the middleware, with apps as its interface', async () => {
		const seen: unknown[] = [];
		const registry = createDirectRegistry(commands, {
			interface: 'apps',
			contextFields,
			callGrant: (command, context) => command === 'tally-get' && context.caller === 'checklist',
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

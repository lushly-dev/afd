/**
 * Checks app-to-app calls on the core registry against `spec/vectors/app-calls.json`
 * (`spec/app-calls.md`; Loam phase 5, step 0b). The core registry does
 * not validate input, so the one case that needs validation (`validates`) runs in the server's
 * `createDirectRegistry` test instead; every other case runs here.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	type CommandContext,
	type CommandDefinition,
	createCommandRegistry,
	defaultExpose,
	type ExposeOptions,
	isExposedTo,
} from './commands.js';
import { ErrorCodes } from './errors.js';
import { success } from './result.js';

interface Expect {
	refused?: true;
	data?: unknown;
	code?: string;
}

interface Vectors {
	gaps: Record<string, string>;
	refusal: Record<string, unknown>;
	exposure: {
		description: string;
		expose: ExposeOptions | null;
		exposed: Record<keyof ExposeOptions, boolean>;
	}[];
	registry: {
		commands: { name: string; expose: ExposeOptions }[];
		grants: Record<string, string[]>;
	};
	calls: {
		description: string;
		grant: 'grants' | 'none' | 'throws';
		validates?: true;
		call: {
			name: string;
			interface?: keyof ExposeOptions;
			caller?: string;
			input: Record<string, unknown>;
		};
		expect: Expect;
	}[];
	batches: {
		description: string;
		grant: 'grants' | 'none' | 'throws';
		caller?: string;
		interface: keyof ExposeOptions;
		items: { command: string; input: Record<string, unknown> }[];
		expect: Expect[];
	}[];
}

const vectors = JSON.parse(
	readFileSync(new URL('../../../spec/vectors/app-calls.json', import.meta.url), 'utf8')
) as Vectors;

function registryFor(grant: 'grants' | 'none' | 'throws') {
	const { grants } = vectors.registry;
	const callGrant =
		grant === 'none'
			? undefined
			: grant === 'throws'
				? () => {
						throw new Error('the grant store is unreachable');
					}
				: (command: string, context: CommandContext) =>
						typeof context.caller === 'string' &&
						(grants[context.caller]?.includes(command) ?? false);
	const registry = createCommandRegistry({ callGrant });
	for (const { name, expose } of vectors.registry.commands) {
		const command: CommandDefinition<{ by?: number }> = {
			name,
			description: `The fixture command ${name}`,
			parameters: [{ name: 'by', type: 'number', description: 'How much', required: false }],
			expose,
			handler: async (input) => success({ command: name, by: input.by ?? 1 }),
		};
		registry.register(command);
	}
	return registry;
}

function check(result: { success: boolean; data?: unknown; error?: unknown }, expected: Expect) {
	if (expected.refused) {
		expect(result).toEqual({ success: false, error: vectors.refusal });
	} else if (expected.code) {
		expect(result.success).toBe(false);
		expect((result.error as { code: string }).code).toBe(expected.code);
	} else {
		expect(result.success).toBe(true);
		expect(result.data).toEqual(expected.data);
	}
}

describe('spec/vectors/app-calls.json on the core registry', () => {
	it('has no language gaps, and its refusal is the catalog code', () => {
		expect(Object.keys(vectors.gaps)).toEqual([]);
		expect(vectors.refusal.code).toBe(ErrorCodes.CALL_NOT_GRANTED);
		expect(defaultExpose.apps).toBeUndefined();
		expect(isExposedTo({ expose: defaultExpose }, 'apps')).toBe(false);
	});

	for (const item of vectors.exposure) {
		it(`exposure: ${item.description}`, () => {
			const command = item.expose === null ? {} : { expose: item.expose };
			for (const [surface, exposed] of Object.entries(item.exposed)) {
				expect(isExposedTo(command, surface as keyof ExposeOptions), surface).toBe(exposed);
			}
		});
	}

	for (const item of vectors.calls.filter((candidate) => !candidate.validates)) {
		it(`call: ${item.description}`, async () => {
			const { name, interface: iface, caller, input } = item.call;
			const context: CommandContext = {
				...(iface !== undefined && { interface: iface }),
				...(caller !== undefined && { caller }),
			};
			check(await registryFor(item.grant).execute(name, input, context), item.expect);
		});
	}

	for (const item of vectors.batches) {
		it(`batch: ${item.description}`, async () => {
			const result = await registryFor(item.grant).executeBatch(
				{ commands: item.items.map(({ command, input }) => ({ command, input })) },
				{ interface: item.interface, ...(item.caller !== undefined && { caller: item.caller }) }
			);
			expect(result.results).toHaveLength(item.expect.length);
			result.results.forEach((entry, index) => {
				check(entry.result, item.expect[index] as Expect);
			});
		});
	}

	it('lists the commands exposed to apps, whatever any caller is granted', () => {
		expect(
			registryFor('none')
				.listByExposure('apps')
				.map((command) => command.name)
		).toEqual(['tally-get']);
	});

	it('refuses a grant that answers anything but true', async () => {
		const registry = createCommandRegistry({
			callGrant: (() => 'yes') as unknown as () => boolean,
		});
		registry.register({
			name: 'tally-get',
			description: 'Read the count',
			parameters: [],
			expose: { apps: true },
			handler: async () => success({}),
		});
		expect(await registry.execute('tally-get', {}, { interface: 'apps' })).toEqual({
			success: false,
			error: vectors.refusal,
		});
	});
});

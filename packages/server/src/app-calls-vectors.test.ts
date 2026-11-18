/**
 * Checks app-to-app calls against `spec/vectors/app-calls.json` (`spec/command-metadata.md`,
 * "App-to-app calls"; Loam phase 5, step 0b): an `apps` call on `createAppCallRegistry`, any other
 * on `createDirectRegistry` with the call's interface, the caller a declared context field, as
 * Loam's `caller` is. `createAppCallRegistry` needs `callGrant`, so the `none` cases check that
 * creating one without it throws; it serves no tool surface, so the batches run on the core
 * registry's test only.
 */
import { readFileSync } from 'node:fs';
import { DirectClient, DirectTransport } from '@lushly-dev/afd-client';
import type { CommandContext, ExposeOptions } from '@lushly-dev/afd-core';
import { MemoryJournalSink, success } from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createAppCallRegistry } from './app-call-registry.js';
import { createDirectRegistry, type DirectCommandRegistry } from './direct-registry.js';
import { createDirectToolSurface } from './direct-tool-surface.js';
import { createJournalMiddleware } from './journal.js';
import { replayJournal } from './journal-replay.js';
import { defineCommand } from './schema.js';
import { createMcpServer } from './server.js';

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

function fixtureCommands(onRun: () => void = () => {}) {
	return vectors.registry.commands.map(({ name, expose }) =>
		defineCommand({
			name,
			description: `The fixture command ${name}`,
			input: z.strictObject({ by: z.number().int().default(1) }),
			expose,
			handler: async (input) => {
				onRun();
				return success({ command: name, by: input.by });
			},
		})
	);
}

const commands = fixtureCommands();

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

	it('refuses the apps interface on createDirectRegistry, which has no grant check', () => {
		expect(() => createDirectRegistry(commands, { interface: 'apps' as 'agent' })).toThrow(
			/createAppCallRegistry/
		);
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

	it('cannot be wrapped by a DirectClient or a DirectTransport, which answer before the check', () => {
		const registry = createAppCallRegistry(commands, { callGrant: () => false });
		expect(() => new DirectClient(registry, { allow: () => false })).toThrow(/own execute/);
		expect(() => new DirectTransport(registry)).toThrow(/own execute/);
	});

	it('refuses an app call on the MCP server, which has no grant check', async () => {
		let ran = 0;
		const counted = fixtureCommands(() => ran++);
		const server = createMcpServer({ name: 'apps', version: '1.0.0', commands: counted });
		expect(await server.execute('tally-get', {}, { interface: 'apps' })).toEqual({
			success: false,
			error: vectors.refusal,
		});
		const pipeline = await server.executePipeline(
			{ steps: [{ command: 'tally-get', input: {} }] },
			{ interface: 'apps' }
		);
		expect(pipeline.steps[0]?.error).toEqual(vectors.refusal);
		expect(ran).toBe(0);
	});

	it('replays an app call only where its grant is checked again', async () => {
		let granted = true;
		let ran = 0;
		const sink = new MemoryJournalSink();
		const counted = fixtureCommands(() => ran++);
		const app = (journal: boolean) =>
			createAppCallRegistry(counted, {
				contextFields,
				callGrant: (command, context) =>
					granted && command === 'tally-get' && context.caller === 'checklist',
				middleware: journal ? [createJournalMiddleware(sink)] : [],
			});
		expect((await app(true).execute('tally-get', {}, { caller: 'checklist' })).success).toBe(true);
		const entries = await sink.read();
		expect(entries[0]?.contextDigest.interface).toBe('apps');
		expect(ran).toBe(1);

		// The grant is gone: the replay is refused by the check, and the handler does not run.
		granted = false;
		const refused = await replayJournal(app(false), entries);
		expect(refused.entries[0]?.replayed).toEqual({ success: false, error: vectors.refusal });
		// A registry with no grant check is refused as a target; so is the MCP server.
		const plain = await replayJournal(createDirectRegistry(counted, { contextFields }), entries);
		expect(plain.entries[0]?.status).toBe('error');
		// Nor can the host's own context replay it as another interface.
		const renamed = await replayJournal(createDirectRegistry(counted, { contextFields }), entries, {
			context: { interface: 'agent' },
		});
		expect(renamed.entries[0]?.status).toBe('error');
		const server = createMcpServer({ name: 'apps', version: '1.0.0', commands: counted });
		const onServer = await replayJournal(server, entries);
		expect(onServer.entries[0]?.status).toBe('error');
		expect(ran).toBe(1);
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

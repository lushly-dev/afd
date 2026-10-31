/**
 * Declared context fields (`spec/context-fields.md`): declaration checks, validation on every
 * in-process call, and what the journal keeps (`spec/journal.md`, "Declared context fields").
 */
import { createContextDigest, fixedClock, MemoryJournalSink, success } from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { type ContextField, checkContextFields } from './context-fields.js';
import { createDirectRegistry } from './direct-registry.js';
import { createJournalMiddleware, MAX_JOURNAL_CONTEXT_BYTES } from './journal.js';
import { replayJournal } from './journal-replay.js';
import { defineCommand } from './schema.js';
import { createMcpServer } from './server.js';

const scope: ContextField = {
	name: 'scope',
	meta: 'dev.example/scope',
	schema: z.object({ project: z.string() }),
	journal: true,
};
const locale: ContextField = {
	name: 'locale',
	meta: 'dev.example/locale',
	schema: z.string().trim(),
};

const echo = defineCommand({
	name: 'scope-echo',
	description: 'Return the declared fields the call sees',
	input: z.object({}),
	handler: async (_input, context) => success({ scope: context?.scope, locale: context?.locale }),
});

describe('context field declarations', () => {
	it.each([
		[{ ...scope, name: '' }, 'non-empty name'],
		[{ ...scope, name: 'actor' }, 'name AFD sets itself'],
		[{ ...scope, name: 'traceId' }, 'name AFD sets itself'],
		[{ ...scope, meta: 'scope' }, 'reverse-DNS prefix'],
		[{ ...scope, meta: 'example/scope' }, 'reverse-DNS prefix'],
		[{ ...scope, meta: 'dev.afd/scope' }, 'reserved meta prefix'],
		[{ ...scope, meta: 'io.modelcontextprotocol/scope' }, 'reserved meta prefix'],
		[{ ...scope, meta: 'dev.mcp.tools/scope' }, 'reserved meta prefix'],
		[{ ...scope, schema: undefined }, 'Zod schema'],
	])('refuses %o', (field, message) => {
		expect(() => checkContextFields([field as ContextField])).toThrow(message);
	});

	it('refuses a name or meta key declared twice', () => {
		expect(() => checkContextFields([scope, { ...locale, name: 'scope' }])).toThrow('twice');
		expect(() => checkContextFields([scope, { ...locale, meta: scope.meta }])).toThrow('twice');
	});

	it('is checked when a server or registry is created', () => {
		const bad = [{ ...scope, name: 'clock' }];
		expect(() => createDirectRegistry([echo], { contextFields: bad })).toThrow(TypeError);
		expect(() =>
			createMcpServer({ name: 'fields', version: '1.0.0', commands: [echo], contextFields: bad })
		).toThrow(TypeError);
	});
});

describe('context field values in process', () => {
	const registry = createDirectRegistry([echo], { contextFields: [scope, locale] });

	it('reach the handler as their schema outputs them', async () => {
		const result = await registry.execute(
			'scope-echo',
			{},
			{
				scope: { project: 'p-1' },
				locale: '  en-GB ',
			}
		);
		expect(result).toMatchObject({
			success: true,
			data: { scope: { project: 'p-1' }, locale: 'en-GB' },
		});
	});

	it('fail the call with VALIDATION_ERROR naming the field and its meta key', async () => {
		const result = await registry.execute('scope-echo', {}, { scope: { project: 42 } });
		expect(result.success).toBe(false);
		expect(result.error).toMatchObject({
			code: 'VALIDATION_ERROR',
			message: "Context field 'scope' is not valid",
			details: { field: 'scope', meta: 'dev.example/scope', errors: [{ path: 'project' }] },
		});
		expect(result.error?.suggestion).toContain('_meta["dev.example/scope"]');
	});

	it('treat null as no value', async () => {
		const result = await registry.execute('scope-echo', {}, { scope: null });
		expect(result).toMatchObject({ success: true, data: { scope: null } });
	});

	it('do not require a field on AFD commands, so a client can discover it first', async () => {
		const help = defineCommand({
			name: 'afd-help',
			description: 'Help',
			input: z.object({}),
			handler: async () => success({ ok: true }),
		});
		const strict = createDirectRegistry([help], { contextFields: [{ ...scope, required: true }] });
		expect((await strict.execute('afd-help', {})).success).toBe(true);
		expect((await strict.execute('afd-help', {}, { scope: { project: 1 } })).success).toBe(false);
	});

	it('fail a call without a required field', async () => {
		const strict = createDirectRegistry([echo], { contextFields: [{ ...scope, required: true }] });
		const result = await strict.execute('scope-echo', {});
		expect(result.error).toMatchObject({
			code: 'VALIDATION_ERROR',
			details: { field: 'scope' },
		});
		expect(result.error?.suggestion).toContain('it is required');
	});
});

describe('the journal and declared fields', () => {
	async function record(context: Record<string, unknown>) {
		const sink = new MemoryJournalSink();
		const registry = createDirectRegistry([echo], {
			contextFields: [scope, locale],
			clock: fixedClock(0),
			middleware: [createJournalMiddleware(sink)],
		});
		await registry.execute('scope-echo', {}, { traceId: 't', ...context });
		const [entry] = await sink.read();
		if (!entry) throw new Error('nothing was recorded');
		return entry;
	}

	it('keeps journaled values in context and leaves the others as key names', async () => {
		const entry = await record({ scope: { project: 'p-1' }, locale: 'en' });
		expect(entry.context).toEqual({ scope: { project: 'p-1' } });
		expect(entry.contextOmitted).toBeUndefined();
		const withoutScope = await createContextDigest({
			traceId: 't',
			interface: 'agent',
			locale: 'en',
		});
		expect(entry.contextDigest.hash).not.toBe(withoutScope.hash);
	});

	it('hashes an entry without journaled values exactly as before', async () => {
		const entry = await record({ locale: 'en' });
		expect(entry.context).toBeUndefined();
		const expected = await createContextDigest({
			traceId: 't',
			interface: 'agent',
			locale: 'en',
			clock: fixedClock(0),
			random: {} as never,
		});
		expect(entry.contextDigest).toEqual(expected);
	});

	it(`names a value over ${MAX_JOURNAL_CONTEXT_BYTES} bytes in contextOmitted instead`, async () => {
		const entry = await record({ scope: { project: 'é'.repeat(2100) } });
		expect(entry.context).toBeUndefined();
		expect(entry.contextOmitted).toEqual(['scope']);
	});

	it('replays a field the target no longer declares without it, with a note', async () => {
		const entry = await record({ scope: { project: 'p-1' } });
		const report = await replayJournal(createDirectRegistry([echo]), [entry]);
		expect(report.entries[0]?.status).toBe('different');
		expect(report.entries[0]?.notes).toEqual([
			"context field 'scope' is no longer declared; replayed without it",
		]);
		const restored = await replayJournal(
			createDirectRegistry([echo], { contextFields: [scope, locale] }),
			[entry]
		);
		expect(restored.entries[0]?.status).toBe('same');
	});
});

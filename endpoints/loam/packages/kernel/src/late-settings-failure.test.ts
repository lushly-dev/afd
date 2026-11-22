/**
 * P4-E10: the limits' defaults hold when `late-settings` fails to load (phase 4 specification, section 11, "fail
 * closed"). The chunk is loaded with the rest of the late load, which fails whole without it, so stage A's journal is
 * what is left to bound: an entry over the default `journalEntryBytes` is kept truncated and marked `unreplayable`.
 */

import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { MemoryJournalSink } from '@lushly-dev/afd-core';
import { defineCommand, success, type ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createKernel, createKernelParts } from './kernel.js';
import { LIMIT_DEFAULTS } from './limits.js';
import { createFixedEnvironment } from './testing.js';

vi.mock('./late/settings.js', () => {
	throw new Error('The late-settings chunk did not load');
});

/** A host's own command, registered at stage A, which takes any text. */
const echo = defineCommand({
	name: 'host-echo',
	description: 'Answers with the length of the text it was given',
	input: z.object({ text: z.string() }),
	async handler(input) {
		return success({ length: input.text.length });
	},
}) as unknown as ZodCommandDefinition;

describe('P4-E10: the late-settings chunk failing to load', () => {
	beforeEach(() => vi.stubGlobal('reportError', vi.fn()));
	afterEach(() => vi.unstubAllGlobals());

	it('keeps the default journalEntryBytes: a larger entry is kept truncated and unreplayable', async () => {
		const journal = new MemoryJournalSink();
		const kernel = await createKernel({
			store: new MemoryAdapter(),
			storeKind: 'memory',
			journal,
			auth: new MockAuthAdapter(),
			environment: createFixedEnvironment(),
			host: 'test',
			commands: [echo],
			boot: { generation: 'empty', workspace: { id: 'personal', name: 'Personal' }, apps: [] },
		});
		// A late name waits for stage B, which fails without the chunk.
		expect((await kernel.call('layout-set', { sidebar: { open: false } })).error?.code).toBe(
			'LATE_COMMANDS_UNAVAILABLE'
		);
		expect(kernel.lateFailure).toMatchObject({ code: 'LATE_COMMANDS_UNAVAILABLE' });
		const small = await kernel.call('host-echo', { text: 'hi' });
		expect(small.success).toBe(true);
		const text = 'x'.repeat(LIMIT_DEFAULTS.journalEntryBytes);
		expect((await kernel.call('host-echo', { text })).data).toEqual({ length: text.length });
		const [first, second] = (await journal.read()).filter((entry) => entry.command === 'host-echo');
		expect(first?.input).toEqual({ text: 'hi' });
		expect(second).toMatchObject({ input: {}, unreplayable: true });
		expect(JSON.stringify(second).length).toBeLessThan(LIMIT_DEFAULTS.journalEntryBytes);
		await kernel.dispose();
	});

	it('holds every limit at its default from boot when stage B fails, with nothing to set them', async () => {
		const parts = await createKernelParts({
			store: new MemoryAdapter(),
			storeKind: 'memory',
			journal: new MemoryJournalSink(),
			auth: new MockAuthAdapter(),
			environment: createFixedEnvironment(),
			host: 'test',
			boot: { generation: 'empty', workspace: { id: 'personal', name: 'Personal' }, apps: [] },
		});
		expect(parts.limits.values()).toEqual(LIMIT_DEFAULTS);
		expect((await parts.kernel.call('layout-set', { sidebar: { open: false } })).error?.code).toBe(
			'LATE_COMMANDS_UNAVAILABLE'
		);
		// Stage B failed whole, so nothing set the workspace's values: the defaults stay in force for every limit.
		expect(parts.kernel.lateFailure).toMatchObject({ code: 'LATE_COMMANDS_UNAVAILABLE' });
		expect(parts.limits.values()).toEqual(LIMIT_DEFAULTS);
		await parts.kernel.dispose();
	});
});

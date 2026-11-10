import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { MemoryJournalSink } from '@lushly-dev/afd-core';
import { defineCommand, success, type ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createKernel } from './kernel.js';
import { SHELL_COMMAND_NAMES } from './shell-command-names.js';
import { createFixedEnvironment } from './testing.js';

// What `readBoot` reads of the empty shell's `deployment.json` (phase 2 specification, 2.2).
const EMPTY_BOOT = {
	generation: 'empty',
	workspace: { id: 'personal', name: 'Personal' },
	apps: [],
};

import type { KernelEventV1, KernelOptionsV3 } from './types.js';

function options(overrides: Partial<KernelOptionsV3> = {}): KernelOptionsV3 {
	return {
		store: new MemoryAdapter(),
		storeKind: 'memory',
		journal: new MemoryJournalSink(),
		auth: new MockAuthAdapter(),
		environment: createFixedEnvironment(),
		host: 'test',
		boot: EMPTY_BOOT,
		...overrides,
	};
}

const BOOT_NAMES = [
	'layout-get',
	'appearance-get',
	'auth-session-get',
	'app-list',
	'scope-get',
	'section-get',
];

describe('stage A and stage B', () => {
	it('holds only the boot commands until stage B runs', async () => {
		const kernel = await createKernel(options());
		expect(kernel.listCommands().map((row) => row.name)).toEqual(BOOT_NAMES);
		expect(await kernel.call('layout-get')).toMatchObject({ success: true });
		expect(kernel.listCommands().map((row) => row.name)).toEqual(BOOT_NAMES);
		await kernel.dispose();
	});

	it('lists every command in order after stage B, once however often it is asked', async () => {
		const kernel = await createKernel(options());
		await Promise.all([kernel.startApps(), kernel.startApps()]);
		await kernel.appsReady;
		expect(kernel.listCommands().map((row) => row.name)).toEqual([...SHELL_COMMAND_NAMES]);
		expect(kernel.agent.listCommands().map((row) => row.name)).toEqual([...SHELL_COMMAND_NAMES]);
		expect(kernel.lateFailure).toBeUndefined();
		await kernel.dispose();
	});

	it('resolves with no wait at all when nothing defers', async () => {
		const kernel = await createKernel(options({ boot: undefined }));
		await kernel.appsReady;
		expect(kernel.listCommands().map((row) => row.name)).toEqual([...SHELL_COMMAND_NAMES]);
		await kernel.startApps();
		await kernel.dispose();
	});

	it('runs a late command called first, on either interface', async () => {
		const kernel = await createKernel(options());
		const result = await kernel.agent.call('shell-info-get');
		expect(result).toMatchObject({ success: true, data: { host: 'test' } });
		await kernel.appsReady;
		expect(await kernel.call('palette-open')).toMatchObject({ success: true });
		await kernel.dispose();
	});

	it('answers a name no stage has as not found, after stage B', async () => {
		const kernel = await createKernel(options());
		const result = await kernel.call('nothing-here');
		expect(result).toMatchObject({ success: false, error: { code: 'COMMAND_NOT_FOUND' } });
		expect(kernel.lateFailure).toBeUndefined();
		await kernel.dispose();
	});

	it('runs calls in the order they were made across the boundary, and journals them so', async () => {
		const journal = new MemoryJournalSink();
		const kernel = await createKernel(options({ journal }));
		const events: KernelEventV1[] = [];
		kernel.subscribe((event) => events.push(event));
		await kernel.call('layout-get');
		// The set waits for the chunk, so the get must wait behind it, as it would with every command loaded.
		const [set, get] = await Promise.all([
			kernel.call('appearance-set', { theme: 'dark' }),
			kernel.call<{ theme: string }>('appearance-get'),
		]);
		expect(set).toMatchObject({ success: true });
		expect(get.data?.theme).toBe('dark');
		expect(events.find((event) => event.command === 'appearance-set')).toMatchObject({
			mutation: true,
			success: true,
		});
		const entries = await journal.read();
		expect(entries.map((entry) => entry.command)).toEqual([
			'layout-get',
			'appearance-set',
			'appearance-get',
		]);
		await kernel.dispose();
	});

	it('refuses a repeated name on stage B when it runs in createKernel', async () => {
		const extra = defineCommand({
			name: 'palette-close',
			description: 'A second command by that name',
			input: z.object({}),
			handler: async () => success(null),
		}) as unknown as ZodCommandDefinition;
		await expect(
			createKernel(options({ boot: undefined, commands: [extra] }))
		).rejects.toMatchObject({ code: 'COMMAND_NAME_DUPLICATE' });
	});

	it('keeps the failure and never rejects when a repeated name is found in the background', async () => {
		const report = vi.fn();
		vi.stubGlobal('reportError', report);
		const extra = defineCommand({
			name: 'palette-close',
			description: 'A second command by that name',
			input: z.object({}),
			handler: async () => success(null),
		}) as unknown as ZodCommandDefinition;
		const kernel = await createKernel(options({ commands: [extra] }));
		await kernel.startApps();
		expect(kernel.lateFailure).toMatchObject({
			code: 'LATE_COMMANDS_UNAVAILABLE',
			retryable: true,
		});
		expect(report).toHaveBeenCalledOnce();
		vi.unstubAllGlobals();
		await kernel.dispose();
	});

	it('settles appsReady on a kernel disposed before stage B ran, and loads nothing after', async () => {
		const kernel = await createKernel(options());
		await kernel.dispose();
		await kernel.appsReady;
		await kernel.startApps();
		expect(kernel.listCommands().map((row) => row.name)).toEqual(BOOT_NAMES);
	});

	it('does not run a waiting call on a kernel disposed meanwhile', async () => {
		const kernel = await createKernel(options());
		const waiting = kernel.call('shell-info-get');
		await kernel.dispose();
		expect(await waiting).toMatchObject({ success: false, error: { code: 'KERNEL_DISPOSED' } });
	});
});

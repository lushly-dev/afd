/**
 * The `late-editor` chunk failing to load (documents specification, Status, deviation 14): `createLateParts`
 * awaits it beside `late-documents`, so the late load fails whole, as either chunk's failure does
 * (`late-failure.test.ts`, `late-documents-failure.test.ts`). The shell reports it and keeps its boot commands:
 * every other name answers `LATE_COMMANDS_UNAVAILABLE`, retryable, and `kernel.lateFailure` holds it.
 */

import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { MemoryJournalSink } from '@lushly-dev/afd-core';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createKernel } from './kernel.js';
import { createFixedEnvironment } from './testing.js';

vi.mock('./late/editor-commands.js', () => {
	throw new Error('The editor chunk did not load');
});

describe('the late-editor chunk failing to load', () => {
	const reported = vi.fn();
	beforeEach(() => vi.stubGlobal('reportError', reported));
	afterEach(() => {
		vi.unstubAllGlobals();
		reported.mockClear();
	});

	it('P2-D5: fails the late load whole, reported, retryable and with the boot commands still running', async () => {
		const kernel = await createKernel({
			store: new MemoryAdapter(),
			storeKind: 'memory',
			journal: new MemoryJournalSink(),
			auth: new MockAuthAdapter(),
			environment: createFixedEnvironment(),
			host: 'test',
			boot: { generation: 'empty', workspace: { id: 'personal', name: 'Personal' }, apps: [] },
		});
		for (const name of ['editor-get', 'document-open', 'project-list', 'layout-set']) {
			expect(await kernel.call(name, {}), name).toMatchObject({
				success: false,
				error: {
					code: 'LATE_COMMANDS_UNAVAILABLE',
					retryable: true,
					suggestion: expect.stringContaining('Reload'),
				},
			});
		}
		expect(kernel.lateFailure).toMatchObject({ code: 'LATE_COMMANDS_UNAVAILABLE' });
		expect(reported).toHaveBeenCalled();
		expect(await kernel.call('layout-get')).toMatchObject({ success: true });
		expect(await kernel.call('app-list')).toMatchObject({ success: true });
		await kernel.dispose();
	});
});

/**
 * The `late-documents` chunk failing to load (documents specification, Status, deviation 9): `createLateParts`
 * awaits it, so the late load fails whole, as the `late` chunk's own failure does (`late-failure.test.ts`).
 * The shell reports it and keeps its boot commands: every other name answers `LATE_COMMANDS_UNAVAILABLE`,
 * retryable, whose suggestion is to reload, and `kernel.lateFailure` holds it for the chrome's notice.
 */

import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { MemoryJournalSink } from '@lushly-dev/afd-core';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createKernel } from './kernel.js';
import { createFixedEnvironment } from './testing.js';

vi.mock('./late/documents.js', () => {
	throw new Error('The documents chunk did not load');
});

describe('the late-documents chunk failing to load', () => {
	const reported = vi.fn();
	beforeEach(() => vi.stubGlobal('reportError', reported));
	afterEach(() => {
		vi.unstubAllGlobals();
		reported.mockClear();
	});

	it('fails the late load whole, reported, retryable and with the boot commands still running', async () => {
		const kernel = await createKernel({
			store: new MemoryAdapter(),
			storeKind: 'memory',
			journal: new MemoryJournalSink(),
			auth: new MockAuthAdapter(),
			environment: createFixedEnvironment(),
			host: 'test',
			boot: { generation: 'empty', workspace: { id: 'personal', name: 'Personal' }, apps: [] },
		});
		for (const name of ['document-get', 'project-list', 'layout-set']) {
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

import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { MemoryJournalSink } from '@lushly-dev/afd-core';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createKernel } from './kernel.js';
import { createFixedEnvironment } from './testing.js';
import type { KernelOptionsV1 } from './types.js';

vi.mock('./late/index.js', () => {
	throw new Error('The chunk did not load');
});

function options(overrides: Partial<KernelOptionsV1> = {}): KernelOptionsV1 {
	return {
		store: new MemoryAdapter(),
		storeKind: 'memory',
		journal: new MemoryJournalSink(),
		auth: new MockAuthAdapter(),
		environment: createFixedEnvironment(),
		host: 'test',
		deferLate: true,
		...overrides,
	};
}

describe('the late chunk failing to load', () => {
	beforeEach(() => vi.stubGlobal('reportError', vi.fn()));
	afterEach(() => vi.unstubAllGlobals());

	it('leaves the boot commands running, and answers every other name retryably', async () => {
		const kernel = await createKernel(options());
		const late = await kernel.call('layout-set', { sidebar: { open: false } });
		expect(late).toMatchObject({
			success: false,
			error: { code: 'LATE_COMMANDS_UNAVAILABLE', retryable: true },
		});
		expect(kernel.lateFailure).toMatchObject({ code: 'LATE_COMMANDS_UNAVAILABLE' });
		expect(await kernel.call('nothing-here')).toMatchObject({
			error: { code: 'LATE_COMMANDS_UNAVAILABLE' },
		});
		expect(await kernel.call('layout-get')).toMatchObject({ success: true });
		expect(await kernel.call('app-list')).toMatchObject({ success: true });
		await kernel.appsReady;
		await kernel.dispose();
	});

	it('still resolves createKernel when it runs inside it', async () => {
		const kernel = await createKernel(options({ deferLate: false }));
		expect(kernel.lateFailure).toMatchObject({ code: 'LATE_COMMANDS_UNAVAILABLE' });
		expect(await kernel.call('appearance-get')).toMatchObject({ success: true });
		await kernel.dispose();
	});

	it('lists each app of a deployment as failed, and never the shell', async () => {
		const kernel = await createKernel(
			options({
				deferLate: false,
				deployment: {
					deployment_version: 1,
					sandbox_origin: null,
					apps: [{ instance: 'hello', app: 'hello', package: 'apps/hello/', order: 10 }],
				} as never,
			})
		);
		const list = await kernel.call<{ apps: Array<{ instance: string; state: string }> }>(
			'app-list'
		);
		expect(list.data?.apps).toMatchObject([{ instance: 'hello', state: 'failed' }]);
		await kernel.dispose();
	});
});

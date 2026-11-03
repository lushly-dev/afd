import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { MemoryJournalSink } from '@lushly-dev/afd-core';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { describe, expect, it, vi } from 'vitest';
import { createKernel } from './kernel.js';
import { createFixedEnvironment } from './testing.js';

const chunk = vi.hoisted(() => {
	let release: () => void = () => {};
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { held, release: () => release() };
});

vi.mock('./late/index.js', async (original) => {
	await chunk.held;
	return original();
});

describe('a call while the late chunk is on its way', () => {
	it('lets a lone boot read through, and queues whatever follows a waiting call', async () => {
		const kernel = await createKernel({
			store: new MemoryAdapter(),
			storeKind: 'memory',
			journal: new MemoryJournalSink(),
			auth: new MockAuthAdapter(),
			environment: createFixedEnvironment(),
			host: 'test',
			deferLate: true,
		});
		const stageB = kernel.startApps();

		expect(await kernel.call('layout-get')).toMatchObject({ success: true });

		const set = kernel.call('appearance-set', { theme: 'dark' });
		const get = kernel.call<{ theme: string }>('appearance-get');
		let got = false;
		void get.then(() => {
			got = true;
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(got).toBe(false);

		chunk.release();
		await stageB;
		expect(await set).toMatchObject({ success: true });
		expect((await get).data?.theme).toBe('dark');
		await kernel.dispose();
	});
});

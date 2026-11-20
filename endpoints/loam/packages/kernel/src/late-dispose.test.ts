/**
 * Phase 4's step 6, merged with step 7: a kernel disposed once the late load's `createLateParts` has resolved, before
 * `loadLate` resumes, installs nothing of it, neither the late parts nor step 6's replay callback (`recordedRun`).
 */

import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { MemoryJournalSink } from '@lushly-dev/afd-core';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { describe, expect, it, vi } from 'vitest';
import { createKernelParts, type KernelPartsInternals } from './kernel.js';
import { createFixedEnvironment } from './testing.js';

/** Called as `createLateParts` resolves, before the kernel's `loadLate` resumes. */
const hooks: { resolved?: () => void } = {};

vi.mock('./late/index.js', async (importOriginal) => {
	const real = (await importOriginal()) as typeof import('./late/index.js');
	return {
		...real,
		createLateParts: async (...args: Parameters<typeof real.createLateParts>) => {
			const parts = await real.createLateParts(...args);
			hooks.resolved?.();
			return parts;
		},
	};
});

describe('the late load disposed after createLateParts resolves', () => {
	it('installs neither the late parts nor the replay callback', async () => {
		const internals: KernelPartsInternals = {};
		const parts = await createKernelParts(
			{
				store: new MemoryAdapter(),
				storeKind: 'memory',
				journal: new MemoryJournalSink(),
				auth: new MockAuthAdapter(),
				environment: createFixedEnvironment(),
				host: 'test',
				boot: { generation: 'empty', workspace: { id: 'personal', name: 'Personal' }, apps: [] },
			},
			internals
		);
		let disposing: Promise<void> | undefined;
		// `dispose` marks the kernel disposed at once, before its own awaits.
		hooks.resolved = () => {
			disposing = parts.kernel.dispose();
		};
		// The first call starts stage B, whose first act is the late load.
		const called = await parts.kernel.call('project-list', {});
		await disposing;
		expect(disposing).toBeDefined();
		expect(internals.recordedRun).toBeUndefined();
		expect(called.success).toBe(false);
		// No late part runs: a reload has no late parts to reload.
		await expect(parts.resetSession()).resolves.toBeUndefined();
		expect(internals.recordedRun).toBeUndefined();
	});
});

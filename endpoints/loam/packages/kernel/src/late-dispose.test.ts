/**
 * Phase 4's step 6, merged with step 7, and #1668: a kernel disposed during stage B's late load or app load installs
 * no late parts, never creates app hosts after disposal, and disposes any app runtime whose load finished in flight.
 */

import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { MemoryJournalSink } from '@lushly-dev/afd-core';
import { type BootProjectionV2, readBoot } from '@lushly-dev/loam-manifest';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKernelParts, type KernelPartsInternals } from './kernel.js';
import {
	createFixedEnvironment,
	createFixturePorts,
	PROBE_MANIFEST,
	probeDefinition,
	probeDeployment,
} from './testing.js';

/** Hooks around stage B's async boundaries (`createLateParts` and `loadApps`). */
const hooks: {
	lateResolved?: () => void;
	loadAppsCalled?: () => Promise<void> | void;
	loadAppsCount: number;
	disposedRuntimes: number;
} = {
	loadAppsCount: 0,
	disposedRuntimes: 0,
};

vi.mock('./late/index.js', async (importOriginal) => {
	const real = (await importOriginal()) as typeof import('./late/index.js');
	return {
		...real,
		createLateParts: async (...args: Parameters<typeof real.createLateParts>) => {
			const parts = await real.createLateParts(...args);
			hooks.lateResolved?.();
			return parts;
		},
	};
});

vi.mock('./apps/index.js', async (importOriginal) => {
	const real = (await importOriginal()) as typeof import('./apps/index.js');
	return {
		...real,
		loadApps: async (...args: Parameters<typeof real.loadApps>) => {
			hooks.loadAppsCount += 1;
			await hooks.loadAppsCalled?.();
			const runtime = await real.loadApps(...args);
			const realDispose = runtime.dispose.bind(runtime);
			return {
				...runtime,
				dispose: async () => {
					hooks.disposedRuntimes += 1;
					await realDispose();
				},
			};
		},
	};
});

afterEach(() => {
	hooks.lateResolved = undefined;
	hooks.loadAppsCalled = undefined;
	hooks.loadAppsCount = 0;
	hooks.disposedRuntimes = 0;
});

const probeBoot = readBoot(probeDeployment()) as BootProjectionV2;

describe('stage B disposed during late load or app load (#1668)', () => {
	it('installs neither the late parts nor the replay callback, and creates no app host when disposed during loadLate', async () => {
		const internals: KernelPartsInternals = {};
		const appsLoader = vi.fn(async () => ({
			deployment: probeDeployment(),
			ports: createFixturePorts({
				'apps/probe/': { manifest: PROBE_MANIFEST, definition: probeDefinition() },
			}),
		}));
		const parts = await createKernelParts(
			{
				store: new MemoryAdapter(),
				storeKind: 'memory',
				journal: new MemoryJournalSink(),
				auth: new MockAuthAdapter(),
				environment: createFixedEnvironment(),
				host: 'test',
				boot: probeBoot,
				appsLoader,
			},
			internals
		);
		let disposing: Promise<void> | undefined;
		// `dispose` marks the kernel disposed at once, before its own awaits.
		hooks.lateResolved = () => {
			disposing = parts.kernel.dispose();
		};
		// The first call starts stage B, whose first act is the late load.
		const called = await parts.kernel.call('project-list', {});
		await disposing;
		expect(disposing).toBeDefined();
		expect(internals.recordedRun).toBeUndefined();
		expect(called.success).toBe(false);
		expect(appsLoader).not.toHaveBeenCalled();
		expect(hooks.loadAppsCount).toBe(0);
		// No late part runs: a reload has no late parts to reload.
		await expect(parts.resetSession()).resolves.toBeUndefined();
		expect(internals.recordedRun).toBeUndefined();
	});

	it('creates no app host when disposed while readApps (appsLoader) is held', async () => {
		let releaseLoader!: () => void;
		const loaderHeld = new Promise<void>((resolve) => {
			releaseLoader = resolve;
		});
		let enteredLoader!: () => void;
		const loaderEntered = new Promise<void>((resolve) => {
			enteredLoader = resolve;
		});
		const appsLoader = vi.fn(async () => {
			enteredLoader();
			await loaderHeld;
			return {
				deployment: probeDeployment(),
				ports: createFixturePorts({
					'apps/probe/': { manifest: PROBE_MANIFEST, definition: probeDefinition() },
				}),
			};
		});
		const parts = await createKernelParts({
			store: new MemoryAdapter(),
			storeKind: 'memory',
			journal: new MemoryJournalSink(),
			auth: new MockAuthAdapter(),
			environment: createFixedEnvironment(),
			host: 'test',
			boot: probeBoot,
			appsLoader,
		});
		const stageB = parts.kernel.startApps();
		await loaderEntered;
		await parts.kernel.dispose();
		releaseLoader();
		await stageB;
		expect(appsLoader).toHaveBeenCalledTimes(1);
		expect(hooks.loadAppsCount).toBe(0);
	});

	it('disposes the newly created app runtime when disposed while loadApps is in flight', async () => {
		let releaseLoad!: () => void;
		const loadHeld = new Promise<void>((resolve) => {
			releaseLoad = resolve;
		});
		let enteredLoad!: () => void;
		const loadEntered = new Promise<void>((resolve) => {
			enteredLoad = resolve;
		});
		hooks.loadAppsCalled = async () => {
			enteredLoad();
			await loadHeld;
		};
		const parts = await createKernelParts({
			store: new MemoryAdapter(),
			storeKind: 'memory',
			journal: new MemoryJournalSink(),
			auth: new MockAuthAdapter(),
			environment: createFixedEnvironment(),
			host: 'test',
			boot: probeBoot,
			appsLoader: async () => ({
				deployment: probeDeployment(),
				ports: createFixturePorts({
					'apps/probe/': { manifest: PROBE_MANIFEST, definition: probeDefinition() },
				}),
			}),
		});
		const stageB = parts.kernel.startApps();
		await loadEntered;
		await parts.kernel.dispose();
		releaseLoad();
		await stageB;
		expect(hooks.loadAppsCount).toBe(1);
		expect(hooks.disposedRuntimes).toBe(1);
	});
});

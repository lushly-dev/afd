/**
 * @fileoverview Loam's scenario seeds (phase 4 specification, Jobs and scenarios; phase 5 specification, the same):
 * each builds a fresh kernel before a file runs. A file names its seed with a `seed:<name>` tag; the default is
 * `p5-base`.
 *
 * What `p5-base` holds in phase 5's step 1, and what waits:
 *
 * - a `local` workspace, whose one person is an owner, with projects Atlas (slug `atlas`) and Beacon (slug
 *   `beacon`), as phase 4's `p4-base` has them, with the ids `project-create` gives (`p4-base` will fix them);
 * - the copilot on the test provider (`kind = "test"`), its scripts `model-scripts.ts`, run in this process over
 *   real `MessagePort`s through the kernel's own port halves;
 * - **not yet**: `p4-base`'s apps, tally's count and its checklist document (phase 4's step 1 builds `p4-base`); the
 *   autonomy rows (phase 4's steps 6 and 8); `mailfix` mounted, whose `labels` and `approvals` entry keys are steps 4
 *   and 5's, and `mailfixapp` with its `calls` grant (step 4). The `mailfix` server itself is `mailfix.ts`.
 *
 * `p5-no-provider` is `p5-base` with no `[copilot]` table.
 */

import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { MemoryJournalSink } from '@lushly-dev/afd-core';
import { createInProcessLauncher } from '@lushly-dev/loam-copilot';
import { createTestProvider, type TestProviderV1 } from '@lushly-dev/loam-copilot/test-provider';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { type CopilotHostV1, createCopilotHost } from '../src/copilot/host.js';
import type { CopilotProviderV1 } from '../src/copilot/types.js';
import { createKernel } from '../src/kernel.js';
import { createFixedEnvironment } from '../src/testing.js';
import type { LoamKernelV5 } from '../src/types.js';
import { MODEL_SCRIPTS } from './model-scripts.js';

export interface SeededKernel {
	kernel: LoamKernelV5;
	journal: MemoryJournalSink;
	/** The copilot's host and the test provider, when the seed configures one. */
	copilot?: { host: CopilotHostV1; provider: TestProviderV1 };
	dispose(): Promise<void>;
}

/** The test provider as `[copilot]` would name it. */
export const TEST_PROVIDER: CopilotProviderV1 = { id: 'test', kind: 'test', model: 'scripted' };

async function seed(options: { provider: boolean }): Promise<SeededKernel> {
	const journal = new MemoryJournalSink();
	const provider = createTestProvider({ scripts: MODEL_SCRIPTS });
	const launcher = createInProcessLauncher();
	const host = createCopilotHost({
		launcher,
		transport: {
			async send(_provider, body, signal) {
				return provider.send(body, signal);
			},
		},
	});
	const kernel = await createKernel({
		store: new MemoryAdapter(),
		storeKind: 'memory',
		journal,
		auth: new MockAuthAdapter(),
		environment: createFixedEnvironment(),
		host: 'test',
		...(options.provider
			? {
					copilot: {
						providers: [TEST_PROVIDER],
						default: TEST_PROVIDER.id,
						runner: host,
						takeRunId: (session) => host.takeRunId(session),
					},
				}
			: {}),
	});
	for (const [name, slug] of [
		['Atlas', 'atlas'],
		['Beacon', 'beacon'],
	] as const) {
		const made = await kernel.call('project-create', { name, slug });
		if (!made.success) throw new Error(`p5-base: ${JSON.stringify(made.error)}`);
	}
	return {
		kernel,
		journal,
		...(options.provider ? { copilot: { host, provider } } : {}),
		async dispose() {
			host.reset();
			await kernel.dispose();
		},
	};
}

export const SEEDS: Readonly<Record<string, () => Promise<SeededKernel>>> = Object.freeze({
	'p5-base': () => seed({ provider: true }),
	'p5-no-provider': () => seed({ provider: false }),
});

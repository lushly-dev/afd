/**
 * @fileoverview Loam's scenario seeds (phase 4 specification, Jobs and scenarios; phase 5 specification, the same):
 * each builds a fresh kernel before a file runs. A file names its seed with a `seed:<name>` tag; the default is its
 * phase's, `p4-base` or `p5-base`.
 *
 * What `p4-base` holds since phase 4's step 2, and what waits:
 *
 * - a `local` workspace, signed in as one person (`mock-user-ada@example.com`), who is therefore an owner;
 * - projects `prj_atlas` (slug `atlas`) and `prj_beacon` (slug `beacon`), both created by that person, written to the
 *   store before the kernel starts, so their ids are fixed;
 * - the apps hello, tally, checklist and console, enabled for both projects (no project disables an app), loaded from
 *   their sources through fixture ports (`apps.ts` says why);
 * - tally's count at 3, at workspace level, through its own `tally-add`;
 * - the checklist `doc_checklist0000001` in Atlas, empty, written to the store before the kernel starts, as the
 *   projects are, so its id is fixed;
 * - **not yet**: hello's experiment `hello.inspector-v2`, step 9's.
 *
 * What `p5-base` holds in phase 5's step 1, and what waits:
 *
 * - a `local` workspace, whose one person is an owner, with projects Atlas (slug `atlas`) and Beacon (slug
 *   `beacon`), as phase 4's `p4-base` has them, with the ids `project-create` gives (`p4-base` fixes its own as `prj_atlas` and `prj_beacon`);
 * - the copilot on the test provider (`kind = "test"`), its scripts `model-scripts.ts`, run in this process over
 *   real `MessagePort`s through the kernel's own port halves;
 * - **not yet**: `p4-base`'s apps, tally's count and its document (phase 4's step 2 seeds them in `p4-base`); the
 *   autonomy rows (phase 4's steps 6 and 8); `mailfix` mounted, whose `labels` and `approvals` entry keys are steps 4
 *   and 5's, and `mailfixapp` with its `calls` grant (step 4). The `mailfix` server itself is `mailfix.ts`.
 *
 * `p5-no-provider` is `p5-base` with no `[copilot]` table.
 */

import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { MemoryJournalSink } from '@lushly-dev/afd-core';
import { createInProcessLauncher } from '@lushly-dev/loam-copilot';
import { createTestProvider, type TestProviderV1 } from '@lushly-dev/loam-copilot/test-provider';
import { type DataAdapter, MemoryAdapter } from '@lushly-dev/local-db';
import { type CopilotHostV1, createCopilotHost } from '../src/copilot/host.js';
import type { CopilotProviderV1 } from '../src/copilot/types.js';
import { createKernel } from '../src/kernel.js';
import { DOCUMENT_TABLE, documentContentKey } from '../src/late/document-types.js';
import type { ProjectV1 } from '../src/scope/records.js';
import { scopeKeyOf, storeRecordId } from '../src/scope/store-id.js';
import { createFixedEnvironment } from '../src/testing.js';
import type { LoamKernelV5 } from '../src/types.js';
import { seedApps } from './apps.js';
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

/** `p4-base`'s one person, an owner of the `local` workspace (phase 4 specification, Jobs and scenarios). */
export const P4_PERSON = 'mock-user-ada@example.com';

/** A project as `project-create` writes it, with a fixed id, created by {@link P4_PERSON}. */
const project = (id: string, slug: string, name: string, at: number): ProjectV1 => ({
	id,
	workspace: 'personal',
	slug,
	name,
	icon: 'system/folder',
	status: 'active',
	access: { mode: 'workspace' },
	memberEpoch: 0,
	createdAt: at,
	updatedAt: at,
	createdBy: P4_PERSON,
	updatedBy: P4_PERSON,
});

/** `p4-base`'s projects, by fixed id (phase 4 specification: `project` in inputs is the project's id). */
export const P4_PROJECTS: readonly ProjectV1[] = Object.freeze([
	project('prj_atlas', 'atlas', 'Atlas', 1),
	project('prj_beacon', 'beacon', 'Beacon', 2),
]);

/** `p4-base`'s apps, in rail order, enabled for both projects. */
export const P4_APPS: readonly string[] = Object.freeze(['hello', 'tally', 'checklist', 'console']);

/** The count `p4-base` holds, read by its app's own query: kept here, since no source under `src/` names a second app. */
export const P4_COUNT = Object.freeze({ command: 'tally-get', total: 3 });

/** `p4-base`'s checklist in Atlas, by fixed id. */
export const P4_DOCUMENT = 'doc_checklist0000001';

/** The checklist's record and its empty content, as `document-create` writes them from the blank template. */
function checklistWrites(binding: unknown): Array<{ method: 'PUT'; path: string; body: unknown }> {
	const scope = { workspace: 'personal', project: 'prj_atlas' };
	const key = documentContentKey(P4_DOCUMENT);
	const at = 3;
	return [
		{
			method: 'PUT',
			path: `/${DOCUMENT_TABLE}/${P4_DOCUMENT}`,
			body: {
				id: P4_DOCUMENT,
				workspace: 'personal',
				type: 'checklist',
				instance: 'checklist',
				title: 'Launch checklist',
				scope,
				scopeKey: scopeKeyOf(scope),
				owner: P4_PERSON,
				tags: [],
				status: 'active',
				trashedAt: null,
				trashedFrom: null,
				contentVersion: 1,
				binding,
				epoch: 0,
				createdAt: at,
				updatedAt: at,
				createdBy: P4_PERSON,
				updatedBy: P4_PERSON,
			},
		},
		{
			method: 'PUT',
			path: `/app-checklist/${encodeURIComponent(storeRecordId(scope, key))}`,
			body: {
				id: storeRecordId(scope, key),
				key,
				value: { items: [] },
				app: 'checklist',
				instance: 'checklist',
				workspace: 'personal',
				actor: null,
				updatedAt: at,
				scope,
				scopeKey: scopeKeyOf(scope),
			},
		},
	];
}

async function p4Base(): Promise<SeededKernel> {
	const served = await seedApps();
	const type = (served.manifests.checklist?.ui?.documents ?? []).find(
		(declared) => declared.id === 'checklist'
	);
	if (!type) throw new Error('p4-base: checklist declares no `checklist` type');
	const store: DataAdapter = new MemoryAdapter();
	const { summary } = await store.batch([
		...P4_PROJECTS.map((record) => ({
			method: 'PUT' as const,
			path: `/project/${record.id}`,
			body: record,
		})),
		...checklistWrites(type.binding),
	]);
	if (summary.failed > 0) throw new Error('p4-base: the store refused the seed');
	const journal = new MemoryJournalSink();
	const kernel = await createKernel({
		store,
		storeKind: 'memory',
		journal,
		auth: new MockAuthAdapter(),
		environment: createFixedEnvironment(),
		host: 'test',
		deployment: {
			deployment_version: 2,
			generation: 'p4-base',
			workspace: { id: 'personal', name: 'Personal' },
			sandbox_origin: 'https://sandbox.loam.test',
			apps: served.apps,
		},
		ports: served.ports,
	});
	const steps: Array<[string, unknown]> = [
		[
			'auth-sign-in',
			{ method: 'credentials', email: P4_PERSON.slice('mock-user-'.length), password: 'x' },
		],
		['tally-add', { by: 3 }],
	];
	for (const [command, input] of steps) {
		const done = await kernel.call(command, input);
		if (!done.success) throw new Error(`p4-base: ${command}: ${JSON.stringify(done.error)}`);
	}
	return { kernel, journal, dispose: () => kernel.dispose() };
}

export const SEEDS: Readonly<Record<string, () => Promise<SeededKernel>>> = Object.freeze({
	'p4-base': p4Base,
	'p5-base': () => seed({ provider: true }),
	'p5-no-provider': () => seed({ provider: false }),
});

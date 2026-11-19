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
 * - the four apps of its seed file, `docs/phases/4-settings/scenarios/p4-base.seed.json`, enabled for both projects
 *   (no project disables an app), loaded from their sources through fixture ports (`apps.ts` says why);
 * - the file's documents, written to the store before the kernel starts, as the projects are, so their ids are fixed,
 *   and its calls, run after sign-in: the specification's count of 3 and its document in Atlas;
 * - **not yet**: hello's experiment `hello.inspector-v2`, step 9's.
 *
 * The seed file names the apps, so this file names none: the shell's sources name no app or document type.
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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { MemoryJournalSink } from '@lushly-dev/afd-core';
import { createInProcessLauncher } from '@lushly-dev/loam-copilot';
import { createTestProvider, type TestProviderV1 } from '@lushly-dev/loam-copilot/test-provider';
import type { ManifestV2 } from '@lushly-dev/loam-manifest';
import { type DataAdapter, MemoryAdapter } from '@lushly-dev/local-db';
import { type CopilotHostV1, createCopilotHost } from '../src/copilot/host.js';
import type { CopilotProviderV1 } from '../src/copilot/types.js';
import { createKernel } from '../src/kernel.js';
import { DOCUMENT_TABLE, documentContentKey } from '../src/late/document-types.js';
import type { ProjectV1 } from '../src/scope/records.js';
import { scopeKeyOf, storeRecordId } from '../src/scope/store-id.js';
import { createFixedEnvironment } from '../src/testing.js';
import type { LoamKernelV5 } from '../src/types.js';
import { LOAM, type SeedAppV1, seedApps } from './apps.js';
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

/** What a seed file holds beyond the workspace, the person and the projects (`p4-base.seed.json`). */
export interface SeedFileV1 {
	apps: SeedAppV1[];
	documents: Array<{
		id: string;
		instance: string;
		type: string;
		title: string;
		project?: string;
		content: unknown;
	}>;
	calls: Array<{ command: string; input: unknown }>;
	/** What the seed's own test asserts: each call's `data`, matched as a subset, in the project named if any. */
	checks: Array<{ command: string; input: unknown; project?: string; data: unknown }>;
}

/** `p4-base`'s seed file, beside phase 4's scenarios, which names the apps and their records. */
export const P4_SEED: SeedFileV1 = JSON.parse(
	readFileSync(join(LOAM, 'docs/phases/4-settings/scenarios/p4-base.seed.json'), 'utf8')
);

/**
 * A document's record and its content, as `document-create` writes them (`recordOf` and its `AppStoreRecord` in
 * `src/late/documents.ts`), by the seed's person; kept equal to that shape by hand, and read back by the seed's test.
 */
function documentWrites(
	document: SeedFileV1['documents'][number],
	manifests: Record<string, ManifestV2>
): Array<{ method: 'PUT'; path: string; body: unknown }> {
	const manifest = manifests[document.instance];
	const type = (manifest?.ui?.documents ?? []).find((declared) => declared.id === document.type);
	if (!manifest || !type)
		throw new Error(`p4-base: no type '${document.type}' in '${document.instance}'`);
	const scope = {
		workspace: 'personal',
		...(document.project !== undefined ? { project: document.project } : {}),
	};
	const key = documentContentKey(document.id);
	const at = 3;
	return [
		{
			method: 'PUT',
			path: `/${DOCUMENT_TABLE}/${document.id}`,
			body: {
				id: document.id,
				workspace: 'personal',
				type: document.type,
				instance: document.instance,
				title: document.title,
				scope,
				scopeKey: scopeKeyOf(scope),
				owner: P4_PERSON,
				tags: [],
				status: 'active',
				trashedAt: null,
				trashedFrom: null,
				contentVersion: type.content_version ?? 1,
				binding: { ...type.binding },
				epoch: 0,
				createdAt: at,
				updatedAt: at,
				createdBy: P4_PERSON,
				updatedBy: P4_PERSON,
			},
		},
		{
			method: 'PUT',
			path: `/app-${document.instance}/${encodeURIComponent(storeRecordId(scope, key))}`,
			body: {
				id: storeRecordId(scope, key),
				key,
				value: document.content,
				app: manifest.plugin.id,
				instance: document.instance,
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
	const served = await seedApps(P4_SEED.apps);
	const store: DataAdapter = new MemoryAdapter();
	const { summary } = await store.batch([
		...P4_PROJECTS.map((record) => ({
			method: 'PUT' as const,
			path: `/project/${record.id}`,
			body: record,
		})),
		...P4_SEED.documents.flatMap((document) => documentWrites(document, served.manifests)),
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
	const steps = [
		{
			command: 'auth-sign-in',
			input: { method: 'credentials', email: P4_PERSON.slice('mock-user-'.length), password: 'x' },
		},
		...P4_SEED.calls,
	];
	for (const { command, input } of steps) {
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

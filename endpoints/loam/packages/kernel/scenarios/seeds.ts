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
 * - hello's experiment `hello.inspector-v2`, `visible`, ending `2027-03-01`, from hello's own manifest (step 9).
 *
 * The seed file names the apps, so this file names none: the shell's sources name no app or document type.
 *
 * What `p5-base` holds from phase 5's step 3, and what waits:
 *
 * - `p4-base` whole: its `local` workspace and one person, an owner, its projects `prj_atlas` and `prj_beacon`, its
 *   four apps, tally's count of 3 and its documents;
 * - the copilot on the test provider (`kind = "test"`), its scripts `model-scripts.ts`, run in this process over
 *   real `MessagePort`s through the kernel's own port halves;
 * - the autonomy rows (6.1): workspace `act` for the shell's `project-create` and `document-create` and for
 *   `tally-add`, `suggest` for `tally-reset`, and from step 4 `act` for `mailfix-thread-archive` and
 *   `mailfix-draft-create`;
 * - from step 4, `mailfix` mounted in this process (`mailfix-mount.ts`) with `labels = "per-part"`, its reads acting by
 *   6.1's default, and `mailfixapp` with its `calls` grant (7.5);
 * - from step 5, `mailfix`'s `approvals = "shell"`, with `mailfix-draft-show` as the send's preview, its transport playing
 *   AFD's approver carrier (7.2). The `mailfix` server itself is `mailfix.ts`.
 *
 * `p5-two-mounts` is `p5-base` with a second `mailfix`, `mailfixb`, whose entry says `labels = "whole"` (P5-A4).
 *
 * `p5-no-provider` is `p5-base` with no `[copilot]` table.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { MemoryJournalSink } from '@lushly-dev/afd-core';
import { createInProcessLauncher } from '@lushly-dev/loam-copilot';
import type { ModelScriptV1, TestProviderV1 } from '@lushly-dev/loam-copilot/test-provider';
import type { ManifestV2, ProjectionV4 } from '@lushly-dev/loam-manifest';
import { type DataAdapter, MemoryAdapter } from '@lushly-dev/local-db';
import { type CopilotHostV1, createCopilotHost } from '../src/copilot/host.js';
import type { CopilotOptionsV1, CopilotProviderV1 } from '../src/copilot/types.js';
import { DOCUMENT_TABLE, documentContentKey } from '../src/documents/document-types.js';
import { createKernel } from '../src/kernel.js';
import type { ProjectV1 } from '../src/scope/records.js';
import { scopeKeyOf, storeRecordId } from '../src/scope/store-id.js';
import { createFixedEnvironment } from '../src/testing.js';
import type { KernelPorts, LoamKernel } from '../src/types.js';
import { LOAM, type SeedAppV1, seedApps } from './apps.js';
import { P5_AUTONOMY } from './host-seed.js';
import {
	MAILFIX_MANIFEST,
	MAILFIXAPP_DEFINITION,
	MAILFIXAPP_MANIFEST,
	mailfixEntry,
	mountedMailfix,
} from './mailfix-mount.js';
import { createScenarioProvider } from './model-scripts.js';

export interface SeededKernel {
	kernel: LoamKernel;
	journal: MemoryJournalSink;
	/** The workspace's store, for a test to read what was kept. */
	store?: DataAdapter;
	/** `mailfix`, when the seed mounts it: its server and transport, for a test to read what it was sent. */
	mailfix?: ReturnType<typeof mountedMailfix>;
	/** The projection and ports the kernel was made with, for a replay of its journal. */
	deployment?: ProjectionV4;
	ports?: KernelPorts;
	/** `mailfixb`, a second `mailfix` whose entry says `labels = "whole"`, when the seed mounts it. */
	mailfixb?: ReturnType<typeof mountedMailfix>;
	/** The copilot's host and the test provider, when the seed configures one. */
	copilot?: { host: CopilotHostV1; provider: TestProviderV1 };
	dispose(): Promise<void>;
}

/** The test provider as `[copilot]` would name it. */
export const TEST_PROVIDER: CopilotProviderV1 = { id: 'test', kind: 'test', model: 'scripted' };

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

async function p4Base(
	extra: {
		copilot?: CopilotOptionsV1;
		mailfix?: ReturnType<typeof mountedMailfix>;
		mailfixb?: ReturnType<typeof mountedMailfix>;
		/** Keys over `mailfix`'s entry, for a test of another `approvals` or preview (7.2). */
		mailfixEntry?: Record<string, unknown>;
	} = {}
): Promise<SeededKernel> {
	const { mailfix, mailfixb } = extra;
	const served = await seedApps(P4_SEED.apps, {
		...(mailfix ? MAILFIX_PACKAGES : {}),
		...(mailfixb ? { 'apps/mailfixb/': { manifest: MAILFIX_MANIFEST } } : {}),
	});
	const mounts: Record<string, ReturnType<typeof mountedMailfix> | undefined> = {
		mailfix,
		mailfixb,
	};
	const ports = mailfix
		? {
				...served.ports,
				async mountTransport(entry: { instance: string }) {
					const mounted = mounts[entry.instance];
					if (!mounted) throw new Error(`No transport for ${entry.instance}`);
					return mounted.transport;
				},
			}
		: served.ports;
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
	const deployment = {
		deployment_version: 2,
		generation: 'p4-base',
		workspace: { id: 'personal', name: 'Personal' },
		sandbox_origin: 'https://sandbox.loam.test',
		apps: [
			...served.apps,
			...(mailfix
				? [
						{ ...mailfixEntry(900), ...extra.mailfixEntry },
						{
							instance: 'mailfixapp',
							app: 'mailfixapp',
							package: 'apps/mailfixapp/',
							order: 910,
						},
					]
				: []),
			...(mailfixb ? [mailfixEntry(920, 'whole', 'mailfixb')] : []),
		] as never,
	} as ProjectionV4;
	const kernel = await createKernel({
		store,
		storeKind: 'memory',
		journal,
		auth: new MockAuthAdapter(),
		environment: createFixedEnvironment(),
		host: 'test',
		...(extra.copilot ? { copilot: extra.copilot } : {}),
		deployment,
		ports,
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
	return {
		kernel,
		journal,
		store,
		...(mailfix ? { mailfix } : {}),
		...(mailfixb ? { mailfixb } : {}),
		deployment,
		ports,
		dispose: () => kernel.dispose(),
	};
}

/** `mailfix`'s and `mailfixapp`'s packages, as the fixture ports serve them. */
const MAILFIX_PACKAGES = {
	'apps/mailfix/': { manifest: MAILFIX_MANIFEST },
	'apps/mailfixapp/': { manifest: MAILFIXAPP_MANIFEST, definition: MAILFIXAPP_DEFINITION },
};

/**
 * `p5-base` from phase 5's step 3: `p4-base` (its workspace, person, projects, apps and documents) with the copilot on
 * the test provider, and the autonomy rows the specification's seed names that exist before step 4's `mailfix`:
 * workspace `act` for the shell's `project-create` and `document-create` and for `tally-add`, and `suggest` for
 * `tally-reset`, each the person's own write, in `local` mode an owner's.
 */
export async function p5Base(options: {
	provider: boolean;
	mailfixb?: boolean;
	/** A unit test's own scripts, beside the scenarios'. */
	scripts?: Record<string, ModelScriptV1>;
	/** The unit composer's answer (7.3). Default: `echo-unit`. */
	compose?: (text: string) => string;
	/**
	 * `mailfix` and its transport, for a test that changes what it answers, or one whose server names no approver
	 * (`mountedMailfix({ approver: false })`, 7.2). Default: a fresh one.
	 */
	mailfix?: ReturnType<typeof mountedMailfix>;
	/** Keys over `mailfix`'s entry, for a test of another `approvals` or preview (7.2). */
	mailfixEntry?: Record<string, unknown>;
}): Promise<SeededKernel> {
	const provider = createScenarioProvider({
		...(options.scripts ? { extra: options.scripts } : {}),
		...(options.compose ? { compose: options.compose } : {}),
	});
	const host = createCopilotHost({
		launcher: createInProcessLauncher(),
		transport: {
			async send(_provider, body, signal) {
				return provider.send(body, signal);
			},
		},
	});
	const seeded = await p4Base({
		mailfix: options.mailfix ?? mountedMailfix(),
		...(options.mailfixEntry ? { mailfixEntry: options.mailfixEntry } : {}),
		...(options.mailfixb ? { mailfixb: mountedMailfix() } : {}),
		...(options.provider
			? {
					copilot: {
						providers: [TEST_PROVIDER],
						default: TEST_PROVIDER.id,
						runner: host,
						takeRunId: (session: string) => host.takeRunId(session),
					},
				}
			: {}),
	});
	// `mailfix`'s discovery, as boot starts it, settled before its rows name its commands.
	for (const instance of options.mailfixb ? ['mailfix', 'mailfixb'] : ['mailfix']) {
		const found = await seeded.kernel.call('app-instance-refresh', { instance });
		if (!found.success) throw new Error(`p5-base: ${instance}: ${JSON.stringify(found.error)}`);
	}
	for (const [instance, command, mode] of P5_AUTONOMY) {
		const set = await seeded.kernel.call('autonomy-set', {
			level: 'workspace',
			instance,
			command,
			mode,
		});
		if (!set.success) throw new Error(`p5-base: ${JSON.stringify(set.error)}`);
	}
	return {
		...seeded,
		...(options.provider ? { copilot: { host, provider } } : {}),
		async dispose() {
			host.reset();
			await seeded.dispose();
		},
	};
}

export const SEEDS: Readonly<Record<string, () => Promise<SeededKernel>>> = Object.freeze({
	'p4-base': p4Base,
	'p5-base': () => p5Base({ provider: true }),
	'p5-no-provider': () => p5Base({ provider: false }),
	'p5-two-mounts': () => p5Base({ provider: true, mailfixb: true }),
});

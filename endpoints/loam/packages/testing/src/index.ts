/**
 * @fileoverview `@lushly-dev/loam-testing`: the test kit an app's own tests use (phase 1 specification,
 * 5.2). It boots a headless kernel with only the app, over the ports the kernel's own tests use, so a
 * view's handlers run in process. Affordance grading is phase 7 (D49).
 *
 * Importing this module watches the global element registry, which is why a test imports it before
 * the app: a module's top level must not touch the DOM or the global registry (5.1).
 */

import type { JournalEntry, MemoryJournalSink } from '@lushly-dev/afd-core';
import {
	type AppDetailV1,
	type AppPortV2,
	LoamKernelError,
	type LoamKernelV2,
} from '@lushly-dev/loam-kernel';
import {
	createFixturePorts,
	createSeededRandom,
	createSteppingClock,
	createTestKernel,
	type ReplayKernelResult,
	replayKernel,
} from '@lushly-dev/loam-kernel/testing';
import type { AppDefinitionV1, ManifestV2 } from '@lushly-dev/loam-sdk';
import { type RegistryScope, watchGlobalRegistry } from './global-registry.js';

const SANDBOX_ORIGIN = 'https://sandbox.loam.test';

/** The names defined in the global registry since the kit last looked. */
const definedGlobally: string[] = [];

watchGlobalRegistry(globalThis as RegistryScope, definedGlobally);

/** Fails, once, for what was defined globally since the last look. */
function refuseGlobalDefinitions(): void {
	const names = definedGlobally.splice(0);
	if (names.length === 0) return;
	throw new LoamKernelError({
		code: 'APP_GLOBAL_ELEMENT',
		message: `Importing the app defined ${names.map((name) => `\`${name}\``).join(', ')} in the global registry`,
		suggestion:
			"Top-level code must not touch the DOM or the global registry: define the app's elements in `activate`, in `context.registry`",
	});
}

/** A definition, or how to import one, so the kit watches that import alone. */
export type AppDefinitionSource =
	| AppDefinitionV1
	| (() => Promise<AppDefinitionV1 | { default: AppDefinitionV1 }>);

export interface AppTestKernelOptions {
	/** A packed or scaffolded manifest: `readAppManifest` from `@lushly-dev/loam-cli` reads one. */
	manifest: ManifestV2;
	definition: AppDefinitionSource;
	/** Keep only these of the manifest's grants, to test the app without the others. */
	grants?: readonly string[];
	/** The deployment entry's `config`. */
	config?: Record<string, unknown>;
	/**
	 * Run in a project: the kit creates it, with this slug, and makes it active, so `port` and every call
	 * without a scope run there (phase 2 specification, 11.3). Both are journaled, so `replay` holds them.
	 */
	scope?: { project?: string };
}

export interface AppTestKernel {
	kernel: LoamKernelV2;
	port: AppPortV2;
	journal: MemoryJournalSink;
	/** Replay everything journaled so far on a fresh kernel; it throws on any difference. */
	replay(): Promise<ReplayKernelResult>;
}

async function definitionOf(source: AppDefinitionSource): Promise<AppDefinitionV1> {
	if (typeof source !== 'function') return source;
	const imported = await source();
	return 'default' in imported ? imported.default : imported;
}

/**
 * Boot a headless kernel with only the app. Scenarios run through `kernel.call` and `kernel.agent.call`,
 * and the layout through the view-state commands, as a person's and an agent's calls do.
 *
 * @throws LoamKernelError `APP_GLOBAL_ELEMENT` when importing the definition defined a global element;
 *   the manifest's own refusal when the kernel refuses the app
 */
export async function createAppTestKernel(options: AppTestKernelOptions): Promise<AppTestKernel> {
	const definition = await definitionOf(options.definition);
	refuseGlobalDefinitions();

	// Kernel interface 2 holds a `ManifestV2` as the reader returns it (phase 2 specification, 8.1).
	const manifest =
		options.grants === undefined
			? options.manifest
			: {
					...options.manifest,
					grants: options.manifest.grants?.filter((grant) => options.grants?.includes(grant.name)),
				};
	const { kind, id } = manifest.plugin;
	if (kind === 'mounted') {
		throw new LoamKernelError({
			code: 'MOUNT_TRANSPORT_UNAVAILABLE',
			message: 'The test kit runs native and view apps, and a mounted app has no handler here',
			suggestion: 'Test a mounted manifest with `loam app check`',
		});
	}
	const directory = `apps/${id}/`;
	const deployment = {
		deployment_version: 2 as const,
		generation: 'test',
		workspace: { id: 'personal', name: 'Personal' },
		sandbox_origin: kind === 'view' ? SANDBOX_ORIGIN : null,
		apps: [
			{
				instance: id,
				app: id,
				package: directory,
				...(options.config !== undefined ? { config: options.config } : {}),
			},
		],
	};
	const files: Record<string, string> = Object.fromEntries(
		[
			manifest.view?.handlers,
			...(manifest.ui?.resources ?? []).map((resource) => resource.path),
		].flatMap((path) => (path === undefined ? [] : [[path, '<!doctype html>']]))
	);
	const ports = () => createFixturePorts({ [directory]: { manifest, definition, files } });

	const { kernel, journal } = await createTestKernel({
		deployment,
		ports: ports(),
		clock: createSteppingClock(),
		random: createSeededRandom(id),
	});
	if (options.scope?.project !== undefined) {
		const slug = options.scope.project;
		const created = await kernel.call<{ id: string }>('project-create', { name: slug, slug });
		const set = created.data
			? await kernel.call('scope-set', { project: created.data.id })
			: created;
		if (!set.success) {
			await kernel.dispose();
			throw new LoamKernelError({
				code: 'VALIDATION_ERROR',
				message: `The kit could not open the project '${slug}': ${set.error?.message ?? ''}`,
				suggestion: 'Give `scope.project` a project slug, such as atlas',
			});
		}
	}
	let port: AppPortV2;
	try {
		port = kernel.appPort(id);
	} catch {
		// Only a refused app has no port. The journal is thrown away with this kernel.
		const { data } = await kernel.call<AppDetailV1>('app-get', { instance: id });
		await kernel.dispose();
		throw new LoamKernelError({
			code: (data?.error?.code ?? 'APP_NOT_READY') as 'APP_NOT_READY',
			message: data?.error?.message ?? `The kernel refused the app '${id}'`,
			suggestion: data?.error?.suggestion ?? 'Run `loam app check`',
			...(data?.error?.details !== undefined ? { details: data.error.details } : {}),
		});
	}
	return {
		kernel,
		port,
		journal,
		async replay() {
			const entries: JournalEntry[] = await journal.read();
			return replayKernel(entries, { deployment, ports: ports() });
		},
	};
}

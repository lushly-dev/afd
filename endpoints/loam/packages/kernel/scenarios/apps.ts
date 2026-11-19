/**
 * @fileoverview `p4-base`'s apps (phase 4 specification, Jobs and scenarios): hello, tally and checklist from their
 * own sources, and a `console` instance, served to the kernel through fixture ports, as `createAppTestKernel` serves
 * one app.
 *
 * **Why from source, at run time.** The kernel's package cannot depend on the apps, nor on `@lushly-dev/loam-cli`
 * whose reader packs a manifest: each app's tests depend on `@lushly-dev/loam-testing`, which depends on the kernel,
 * and the CLI on `@lushly-dev/loam-theme`, whose tests depend on the kernel, so either edge is a cycle (step 1's
 * record). So this file imports the CLI's `readAppManifest` and each app's definition by path, as the scenario test
 * runs, with specifiers the type checker does not follow: no package edge, no build of an app needed first, and each
 * manifest checked by the same reader `app pack` uses. Nothing in `src/` names an app (`second-app.test.ts`).
 */

import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ManifestV2 } from '@lushly-dev/loam-manifest';
import type { AppDefinitionV1 } from '@lushly-dev/loam-sdk';
import { defineApp, success } from '@lushly-dev/loam-sdk';
import { createFixturePorts, type FixturePorts } from '../src/testing.js';

const LOAM = fileURLToPath(new URL('../../../', import.meta.url));

/** An import the type checker does not follow: a path computed at run time. */
const load = <T>(path: string): Promise<T> => import(pathToFileURL(join(LOAM, path)).href);

/** One app `p4-base` serves: its instance, the manifest the CLI packs, and its definition's module. */
interface SeedApp {
	instance: string;
	dir: string;
	manifest?: string;
	module: string;
}

const APPS: readonly SeedApp[] = [
	{
		instance: 'hello',
		dir: 'apps/hello',
		manifest: 'manifests/native.toml',
		module: 'src/native.ts',
	},
	{ instance: 'tally', dir: 'apps/tally', module: 'src/native.ts' },
	{ instance: 'checklist', dir: 'apps/checklist', module: 'src/app.ts' },
];

/**
 * `console`: the instance a step's `[caller: <instance>, inactive]` makes active, so the caller is neither the active
 * app nor the active tab's owner. No app package is named console, so it is a native app with one query and no
 * surface of its own, which the shell renders with the console (phase 1 specification, 7.7).
 */
export const CONSOLE_MANIFEST: ManifestV2 = {
	manifest_version: 2,
	protocol: 1,
	plugin: {
		id: 'console',
		title: 'Console',
		version: '0.1.0',
		description: 'A plain app the shell renders with its console, for the scenarios.',
		kind: 'native',
		domains: ['console'],
	},
	native: { entry: 'dist/native.js' },
	app: { scope_levels: ['workspace', 'project'] },
	commands: [
		{
			name: 'console-ping',
			title: 'Ping',
			description: 'Answer pong, to show the console app runs.',
			effects: ['inspect'],
			input_schema: { type: 'object', properties: {}, additionalProperties: false },
		},
	],
} as unknown as ManifestV2;

const CONSOLE_DEFINITION: AppDefinitionV1 = defineApp({
	sdk: 1,
	handlers: { 'console-ping': async () => success({ pong: true }) },
});

/** The deployment's entries and the ports that serve them. */
export interface SeedDeployment {
	apps: Array<{ instance: string; app: string; package: string; order: number }>;
	ports: FixturePorts;
	manifests: Record<string, ManifestV2>;
}

/** Read each app's manifest and import its definition, then serve them all. */
export async function seedApps(): Promise<SeedDeployment> {
	const { readAppManifest } = await load<{
		readAppManifest(dir: string, manifest?: string): Promise<ManifestV2>;
	}>('packages/cli/src/app-check.ts');
	const packages: Parameters<typeof createFixturePorts>[0] = {};
	const manifests: Record<string, ManifestV2> = {};
	const apps: SeedDeployment['apps'] = [];
	for (const [index, app] of APPS.entries()) {
		const manifest = await readAppManifest(join(LOAM, app.dir), app.manifest);
		const imported = await load<{ default: AppDefinitionV1 }>(`${app.dir}/${app.module}`);
		const files = Object.fromEntries(
			[manifest.view?.handlers, ...(manifest.ui?.resources ?? []).map((resource) => resource.path)]
				.filter((path): path is string => path !== undefined)
				.map((path) => [path, '<!doctype html>'])
		);
		packages[`apps/${app.instance}/`] = { manifest, definition: imported.default, files };
		manifests[app.instance] = manifest;
		apps.push({
			instance: app.instance,
			app: manifest.plugin.id,
			package: `apps/${app.instance}/`,
			order: (index + 1) * 10,
		});
	}
	packages['apps/console/'] = { manifest: CONSOLE_MANIFEST, definition: CONSOLE_DEFINITION };
	manifests.console = CONSOLE_MANIFEST;
	apps.push({ instance: 'console', app: 'console', package: 'apps/console/', order: 40 });
	return { apps, ports: createFixturePorts(packages), manifests };
}

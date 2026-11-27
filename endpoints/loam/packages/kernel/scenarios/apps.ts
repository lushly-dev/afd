/**
 * @fileoverview A seed's apps (phase 4 specification, Jobs and scenarios): each app its seed file lists, from its own
 * source, and the runner's `console` fixture, served to the kernel through fixture ports, as `createAppTestKernel`
 * serves one app. The seed file names the apps (`docs/phases/4-settings/scenarios/p4-base.seed.json`), so nothing
 * here does: the shell's sources name no app or document type (P2-E13's E5, P2-D2).
 *
 * **Why from source, at run time.** The kernel's package cannot depend on the apps, nor on `@lushly-dev/loam-cli`
 * whose reader packs a manifest: each app's tests depend on `@lushly-dev/loam-testing`, which depends on the kernel,
 * and the CLI on `@lushly-dev/loam-theme`, whose tests depend on the kernel, so either edge is a cycle (step 1's
 * record). So this file imports the CLI's `readAppManifest` and each app's definition by path, as the scenario test
 * runs, with specifiers the type checker does not follow: no package edge, no build of an app needed first, and each
 * manifest checked by the same reader `app pack` uses.
 */

import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ManifestV3 } from '@lushly-dev/loam-manifest';
import type { AppDefinitionV1 } from '@lushly-dev/loam-sdk';
import { defineApp, success } from '@lushly-dev/loam-sdk';
import { createFixturePorts, type FixturePorts } from '../src/testing.js';

/** `endpoints/loam/`, which a seed file's paths are relative to. */
export const LOAM = fileURLToPath(new URL('../../../', import.meta.url));

/** An import the type checker does not follow: a path computed at run time. */
const load = <T>(path: string): Promise<T> => import(pathToFileURL(join(LOAM, path)).href);

/** One app a seed file lists: from its source, or the runner's fixture by name. */
export type SeedAppV1 =
	| {
			instance: string;
			dir: string;
			manifest?: string;
			module: string;
	  }
	| { instance: string; fixture: 'console' };

/**
 * `console`: the instance a step's `[caller: <instance>, inactive]` makes active, so the caller is neither the active
 * app nor the active tab's owner. No app package is named console, so it is a native app with one query and no
 * surface of its own, which the shell renders with the console (phase 1 specification, 7.7).
 */
export const CONSOLE_MANIFEST: ManifestV3 = {
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
} as unknown as ManifestV3;

const CONSOLE_DEFINITION: AppDefinitionV1 = defineApp({
	sdk: 1,
	handlers: { 'console-ping': async () => success({ pong: true }) },
});

/** The deployment's entries and the ports that serve them. */
export interface SeedDeployment {
	apps: Array<{ instance: string; app: string; package: string; order: number }>;
	ports: FixturePorts;
	manifests: Record<string, ManifestV3>;
}

/** Read each app's manifest and import its definition, then serve them all, in the listed order. */
export async function seedApps(
	listed: readonly SeedAppV1[],
	extra: Parameters<typeof createFixturePorts>[0] = {},
	/** A seed's own change to an app's manifest as read, by instance: `p5-base`'s milestone B overlay (`seeds.ts`). */
	overlay: Readonly<Record<string, (manifest: ManifestV3) => ManifestV3>> = {}
): Promise<SeedDeployment> {
	const { readAppManifest } = await load<{
		readAppManifest(dir: string, manifest?: string): Promise<ManifestV3>;
	}>('packages/cli/src/app-check.ts');
	const packages: Parameters<typeof createFixturePorts>[0] = { ...extra };
	const manifests: Record<string, ManifestV3> = {};
	const apps: SeedDeployment['apps'] = [];
	for (const [index, app] of listed.entries()) {
		const directory = `apps/${app.instance}/`;
		if ('fixture' in app) {
			packages[directory] = { manifest: CONSOLE_MANIFEST, definition: CONSOLE_DEFINITION };
			manifests[app.instance] = CONSOLE_MANIFEST;
		} else {
			const read = await readAppManifest(join(LOAM, app.dir), app.manifest);
			const manifest = overlay[app.instance]?.(structuredClone(read)) ?? read;
			const definition = (await load<{ default: AppDefinitionV1 }>(`${app.dir}/${app.module}`))
				.default;
			const files = Object.fromEntries(
				[
					manifest.view?.handlers,
					...(manifest.ui?.resources ?? []).map((resource) => resource.path),
				]
					.filter((path): path is string => path !== undefined)
					.map((path) => [path, '<!doctype html>'])
			);
			packages[directory] = { manifest, definition, files };
			manifests[app.instance] = manifest;
		}
		apps.push({
			instance: app.instance,
			app: (manifests[app.instance] as ManifestV3).plugin.id,
			package: directory,
			order: (index + 1) * 10,
		});
	}
	return { apps, ports: createFixturePorts(packages), manifests };
}

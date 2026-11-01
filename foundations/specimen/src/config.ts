import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { readManifest } from './manifest.js';
import type { ComponentSchema } from './plugin.js';
import { type Discovery, discoverStories } from './stories.js';
import type { BenchConfig, BenchOptions, SpecimenContext, SpecimenEntry } from './types.js';
import { parseConfig, parseContext } from './validate.js';

export const defaultContext: SpecimenContext = {
	viewport: { width: 1280, height: 720 },
	theme: 'light',
	locale: 'en-US',
	reducedMotion: 'no-preference',
	motion: 'natural',
};
export function resolveContext(value: Partial<SpecimenContext> = {}): SpecimenContext {
	return parseContext({ ...defaultContext, ...value }) as SpecimenContext;
}
export interface LoadedConfig {
	root: string;
	file: string;
	config: BenchConfig;
	/** Native specimens and discovered stories, in that order. */
	entries: SpecimenEntry[];
	modules: Record<string, string>;
	digest: string;
	/** CSF compatibility mode: what discovery found, including its problems. */
	stories?: { discovery: Discovery; preview?: string };
	/** Plugin modules, in configuration order. */
	plugins: string[];
	/** Component schemas from the configured custom elements manifest, by tag. */
	schemas: Record<string, ComponentSchema>;
}
export const digest = (value: string | Uint8Array): string =>
	createHash('sha256').update(value).digest('hex');
/** The module id the project annotations (a retained story's preview) are bundled under. */
export const PREVIEW_MODULE = '$preview';
/** Plugin modules are bundled as `$plugin:0`, `$plugin:1`, … in configuration order. */
export const PLUGIN_MODULE = '$plugin:';

/** What the page bundles: every entry's module, and the project annotations when stories have them. */
export function bundled(config: LoadedConfig): {
	entries: SpecimenEntry[];
	modules: Record<string, string>;
} {
	return {
		entries: config.entries,
		modules: {
			...config.modules,
			...(config.stories?.preview ? { [PREVIEW_MODULE]: config.stories.preview } : {}),
			...Object.fromEntries(
				config.plugins.map((path, index) => [`${PLUGIN_MODULE}${index}`, path])
			),
		},
	};
}

function inside(root: string, path: string, label: string): string {
	const relativePath = relative(root, path);
	if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath))
		throw new Error(`Specimen module escapes the configured root: ${label}`);
	return path;
}

export async function loadConfig(options: BenchOptions): Promise<LoadedConfig> {
	const root = await realpath(options.root);
	const file = resolve(root, options.configFile ?? 'specimen.config.json');
	const text = await readFile(file, 'utf8');
	const config = parseConfig(JSON.parse(text));
	const modules: Record<string, string> = {};
	const entries: SpecimenEntry[] = [];
	for (const entry of config.specimens ?? []) {
		if (Object.hasOwn(modules, entry.id)) throw new Error(`Duplicate specimen id: ${entry.id}`);
		modules[entry.id] = inside(
			root,
			await realpath(resolve(dirname(file), entry.module)),
			entry.module
		);
		entries.push(entry);
	}
	let stories: LoadedConfig['stories'];
	if (config.stories) {
		const discovery = await discoverStories(root, dirname(file), config);
		for (const entry of discovery.entries) {
			if (Object.hasOwn(modules, entry.id)) {
				discovery.errors.push({
					importPath: entry.module,
					exportName: entry.exportName,
					code: 'DUPLICATE_ID',
					message: `Duplicate specimen id '${entry.id}': a native specimen and ${entry.module}#${entry.exportName}`,
				});
				continue;
			}
			modules[entry.id] = inside(root, resolve(root, entry.module), entry.module);
			entries.push(entry);
		}
		stories = {
			discovery,
			...(config.preview === undefined
				? {}
				: {
						preview: inside(
							root,
							await realpath(resolve(dirname(file), config.preview)),
							config.preview
						),
					}),
		};
	}
	const plugins: string[] = [];
	for (const plugin of config.plugins ?? [])
		plugins.push(inside(root, await realpath(resolve(dirname(file), plugin)), plugin));
	let schemas: Record<string, ComponentSchema> = {};
	if (config.manifest) {
		const manifest = inside(
			root,
			await realpath(resolve(dirname(file), config.manifest)),
			config.manifest
		);
		schemas = Object.fromEntries(readManifest(JSON.parse(await readFile(manifest, 'utf8'))));
	}
	return {
		root,
		file,
		config,
		entries,
		modules,
		digest: digest(text),
		plugins,
		schemas,
		...(stories ? { stories } : {}),
	};
}

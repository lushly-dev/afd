import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { BenchConfig, BenchOptions, SpecimenContext } from './types.js';
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
	modules: Record<string, string>;
	digest: string;
}
export const digest = (value: string | Uint8Array): string =>
	createHash('sha256').update(value).digest('hex');
export async function loadConfig(options: BenchOptions): Promise<LoadedConfig> {
	const root = await realpath(options.root);
	const file = resolve(root, options.configFile ?? 'specimen.config.json');
	const text = await readFile(file, 'utf8');
	const config = parseConfig(JSON.parse(text));
	const modules: Record<string, string> = {};
	for (const entry of config.specimens) {
		if (Object.hasOwn(modules, entry.id)) throw new Error(`Duplicate specimen id: ${entry.id}`);
		const modulePath = await realpath(resolve(dirname(file), entry.module));
		const relativePath = relative(root, modulePath);
		if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath))
			throw new Error(`Specimen module escapes the configured root: ${entry.module}`);
		modules[entry.id] = modulePath;
	}
	return { root, file, config, modules, digest: digest(text) };
}

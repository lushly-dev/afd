import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { contextSchema } from './schema.js';
import type { BenchConfig, BenchOptions, SpecimenContext } from './types.js';

const entrySchema = z.strictObject({
	id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
	title: z.string().min(1),
	module: z.string().min(1),
	exportName: z.string().min(1),
	component: z
		.string()
		.regex(/^[a-z][a-z0-9]*-[a-z0-9-]+$/)
		.optional(),
});
export const configSchema = z.strictObject({ specimens: z.array(entrySchema).min(1) });
export const defaultContext: SpecimenContext = {
	viewport: { width: 1280, height: 720 },
	theme: 'light',
	locale: 'en-US',
	reducedMotion: 'no-preference',
	motion: 'natural',
};
export function resolveContext(value: Partial<SpecimenContext> = {}): SpecimenContext {
	return contextSchema.parse({ ...defaultContext, ...value });
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
	const config = configSchema.parse(JSON.parse(text));
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

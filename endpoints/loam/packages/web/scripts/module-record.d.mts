import type { Plugin } from 'vite';

export function bundleModules(
	outputs: ReadonlyArray<
		| { type: 'chunk'; moduleIds: readonly string[] }
		| { type: 'asset'; originalFileNames?: readonly string[] }
	>,
	root: string
): string[];
export function relativeTo(base: string, path: string): string;
export function writeModuleRecord(
	file: string,
	resolveFrom: string,
	modules: readonly string[]
): void;
export function recordModules(file: string, root: string): Plugin;

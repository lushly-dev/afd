/**
 * `@lushly-dev/specimen-afd-runner` (the browser plugin entry) must stay free of
 * Node.js built-ins and Node-only dependencies (yaml, zod, afd-server, Specimen Node core).
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

interface EsbuildMessage {
	text: string;
}

interface EsbuildResolveResult {
	path?: string;
	errors?: EsbuildMessage[];
}

interface EsbuildPluginBuild {
	onResolve(
		options: { filter: RegExp },
		callback: (args: { path: string }) => EsbuildResolveResult
	): void;
}

interface EsbuildResult {
	errors: EsbuildMessage[];
	metafile?: {
		inputs: Record<string, { imports: { path: string }[] }>;
	};
	outputFiles?: { contents: Uint8Array }[];
}

interface EsbuildApi {
	build(options: Record<string, unknown>): Promise<EsbuildResult>;
}

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_NAME = '@lushly-dev/specimen-afd-runner';

const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
	private?: boolean;
	exports: Record<string, string | { types: string; import: string }>;
};

async function loadEsbuild(): Promise<EsbuildApi> {
	const require = createRequire(import.meta.url);
	const bases = [import.meta.url, require.resolve('vitest/package.json')];
	for (const base of bases) {
		try {
			const entry = createRequire(base).resolve('esbuild');
			return (await import(pathToFileURL(entry).href)) as EsbuildApi;
		} catch {
			// Try the next resolution base.
		}
	}
	throw new Error('esbuild is not resolvable via vitest.');
}

const selfReference = {
	name: 'specimen-afd-runner-self-reference',
	setup(build: EsbuildPluginBuild) {
		build.onResolve({ filter: /^@lushly-dev\/specimen-afd-runner(\/.*)?$/ }, (args) => {
			const subpath = `.${args.path.slice(PACKAGE_NAME.length)}`;
			const entry = manifest.exports[subpath];
			if (!entry) {
				return { errors: [{ text: `package.json has no "${subpath}" export` }] };
			}
			if (typeof entry === 'string') {
				return { path: join(packageRoot, entry) };
			}
			const source = entry.import.replace(/^\.\/dist\//, './src/').replace(/\.js$/, '.ts');
			return { path: join(packageRoot, source) };
		});
	},
};

async function bundleForBrowser(
	specifier: string,
	options: Record<string, unknown> = {}
): Promise<EsbuildResult> {
	const esbuild = await loadEsbuild();
	try {
		return await esbuild.build({
			stdin: {
				contents: `export * from '${specifier}';`,
				resolveDir: packageRoot,
				sourcefile: 'browser-entry.js',
			},
			bundle: true,
			platform: 'browser',
			format: 'esm',
			write: false,
			metafile: true,
			logLevel: 'silent',
			plugins: [selfReference],
			...options,
		});
	} catch (error) {
		const errors = (error as { errors?: EsbuildMessage[] }).errors;
		if (!errors) throw error;
		return { errors };
	}
}

describe('@lushly-dev/specimen-afd-runner browser boundary', () => {
	it('is private and exposes separate browser and Node job-source entries', () => {
		expect(manifest.private).toBe(true);
		expect(manifest.exports['.']).toEqual({
			types: './dist/index.d.ts',
			import: './dist/index.js',
		});
		expect(manifest.exports['./job-source']).toEqual({
			types: './dist/job-source.d.ts',
			import: './dist/job-source.js',
		});
	});

	it('bundles the root plugin entry for platform: browser with zero Node built-ins', async () => {
		const result = await bundleForBrowser(PACKAGE_NAME);
		expect(result.errors.map((m) => m.text)).toEqual([]);

		const inputs = Object.keys(result.metafile?.inputs ?? {});
		expect(inputs.some((p) => p.endsWith('src/index.ts'))).toBe(true);
		expect(inputs.some((p) => p.endsWith('src/runner.ts'))).toBe(true);
		expect(inputs.some((p) => p.endsWith('src/driver.ts'))).toBe(true);

		expect(inputs.filter((p) => /^node:/.test(p))).toEqual([]);
		expect(inputs.filter((p) => /\/(yaml|zod|afd-server)\//.test(p))).toEqual([]);
		expect(inputs.filter((p) => /foundations\/specimen\/dist\//.test(p))).toEqual([]);
	});

	it('executes the bundled browser plugin end-to-end', async () => {
		const result = await bundleForBrowser(PACKAGE_NAME, {
			stdin: {
				contents: `
					import { afdRunner } from '${PACKAGE_NAME}';
					const plugin = afdRunner();
					const el = {
						localName: 'notes-app',
						call: async (name, input) => ({ success: true, data: { name, input } }),
					};
					const runnerOut = await plugin.runners.afd.run(el, 'note-create', { title: 'Bundled' });
					const driverOut = await plugin.jobDrivers.afd.run({
						element: el,
						targets: {},
						entry: {
							id: 'smoke',
							title: 'Smoke',
							module: './a.ts',
							exportName: 'A',
							job: { scenario: './s.yaml', target: 'app', captures: [] },
						},
						context: {
							viewport: { width: 800, height: 600 },
							theme: 'light',
							locale: 'en-US',
							motion: 'settled',
							reducedMotion: 'no-preference',
						},
						scenario: {
							job: 'smoke',
							steps: [{ step: 1, description: 'Create', command: 'note-create', input: { title: 'Hi' }, expect: { success: true } }],
						},
						capturePlan: [{ key: 'smoke/1', name: 'created', step: 1, after: 'Create', before: [] }],
						signal: new AbortController().signal,
						runCommand: async (_runner, _target, name, input) => el.call(name, input),
						runActions: async () => 0,
						captureStep: async () => ({ screenshot: null }),
						advanceClock: () => {},
					});
					console.log(JSON.stringify({ id: plugin.id, runnerOut, driverOut }));
				`,
				resolveDir: packageRoot,
				sourcefile: 'browser-smoke.js',
			},
		});

		expect(result.errors.map((m) => m.text)).toEqual([]);
		const code = new TextDecoder().decode(result.outputFiles?.[0]?.contents);
		const output = JSON.parse(
			execFileSync(process.execPath, ['--input-type=module'], { input: code, encoding: 'utf8' })
		) as {
			id: string;
			runnerOut: { success: boolean; data: { name: string } };
			driverOut: { status: string; steps: Array<{ status: string }> };
		};

		expect(output.id).toBe('afd-runner');
		expect(output.runnerOut.success).toBe(true);
		expect(output.runnerOut.data.name).toBe('note-create');
		expect(output.driverOut.status).toBe('passed');
		expect(output.driverOut.steps.map((s) => s.status)).toEqual(['passed']);
	});
});

/**
 * @fileoverview `@lushly-dev/afd-testing/browser` must stay free of Node.js built-ins.
 *
 * Bundles an entry that imports `@lushly-dev/afd-testing/browser` with esbuild for
 * `platform: 'browser'`. The bundle fails if anything in its module graph imports
 * a Node.js built-in (`node:fs`, `node:path`, `node:child_process`, etc.) or pulls
 * in Node-only loaders. Also verifies the bundled ESM executes end-to-end.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as browser from './browser.js';
import * as root from './index.js';

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
		outputs: Record<string, { inputs: Record<string, { bytesInOutput: number }> }>;
	};
	outputFiles?: { contents: Uint8Array }[];
}

interface EsbuildApi {
	build(options: Record<string, unknown>): Promise<EsbuildResult>;
}

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_NAME = '@lushly-dev/afd-testing';

interface ExportConditions {
	types: string;
	import: string;
}

const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
	exports: Record<string, ExportConditions>;
};

/**
 * esbuild is installed through vite (vitest). Resolve it from vitest's real
 * location where pnpm hoisting exposes it.
 */
async function loadEsbuild(): Promise<EsbuildApi> {
	const require = createRequire(import.meta.url);
	const bases = [import.meta.url, require.resolve('vitest/package.json')];
	for (const base of bases) {
		try {
			const entry = createRequire(base).resolve('esbuild');
			return (await import(pathToFileURL(entry).href)) as EsbuildApi;
		} catch {
			// Try the next base.
		}
	}
	throw new Error(
		'esbuild is not resolvable. It normally comes with vite; add it as a devDependency.'
	);
}

/**
 * Resolve `@lushly-dev/afd-testing[/subpath]` through package.json `exports`,
 * mapped to TypeScript source so the test does not depend on a stale dist build.
 */
const selfReference = {
	name: 'afd-testing-self-reference',
	setup(build: EsbuildPluginBuild) {
		build.onResolve({ filter: /^@lushly-dev\/afd-testing(\/.*)?$/ }, (args) => {
			const subpath = `.${args.path.slice(PACKAGE_NAME.length)}`;
			const target = manifest.exports[subpath]?.import;
			if (!target) {
				return { errors: [{ text: `package.json has no "${subpath}" export` }] };
			}
			const source = target.replace(/^\.\/dist\//, './src/').replace(/\.js$/, '.ts');
			return { path: join(packageRoot, source) };
		});
	},
};

const NODE_ONLY_CORE = /core\/dist\/(index\.js|platform\.js|connectors\/|journal-file\.js)/;

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

describe('@lushly-dev/afd-testing/browser', () => {
	it('declares the subpath with the same conditions as the root export', () => {
		expect(manifest.exports['./browser']).toEqual({
			types: './dist/browser.d.ts',
			import: './dist/browser.js',
		});
		expect(Object.keys(manifest.exports['.'] ?? {})).toEqual(['types', 'import']);
	});

	it('re-exports the exact same runtime bindings as the root entry', () => {
		expect(browser.runScenario).toBe(root.runScenario);
		expect(browser.evaluateStep).toBe(root.evaluateStep);
		expect(browser.evaluateResult).toBe(root.evaluateResult);
		expect(browser.applyFixture).toBe(root.applyFixture);
		expect(browser.resolveStepReferences).toBe(root.resolveStepReferences);
		expect(browser.StepReferenceError).toBe(root.StepReferenceError);

		const rootExports = new Map(Object.entries(root));
		for (const [name, value] of Object.entries(browser)) {
			expect(rootExports.get(name), name).toBe(value);
		}
	});

	it('bundles for the browser with no Node built-ins or file-system loaders', async () => {
		const result = await bundleForBrowser(`${PACKAGE_NAME}/browser`);

		expect(result.errors.map((message) => message.text)).toEqual([]);
		const inputs = Object.keys(result.metafile?.inputs ?? {});
		expect(inputs.some((input) => input.endsWith('src/browser.ts'))).toBe(true);
		expect(inputs.some((input) => input.endsWith('src/runner/scenario-runner.ts'))).toBe(true);
		expect(inputs.some((input) => input.endsWith('src/runner/evaluator.ts'))).toBe(true);
		expect(inputs.some((input) => input.endsWith('src/runner/fixture-applier.ts'))).toBe(true);
		expect(inputs.some((input) => input.endsWith('src/runner/step-references.ts'))).toBe(true);

		expect(inputs.filter((input) => /^node:/.test(input))).toEqual([]);
		expect(
			inputs.filter((input) => /src\/runner\/(fixture-loader|sandbox|cli-wrapper)\.ts$/.test(input))
		).toEqual([]);
		expect(inputs.filter((input) => NODE_ONLY_CORE.test(input))).toEqual([]);
		expect(inputs.filter((input) => /\/(yaml|zod|afd-server)\//.test(input))).toEqual([]);
	});

	it('the root entry, by contrast, cannot be bundled for the browser', async () => {
		const result = await bundleForBrowser(PACKAGE_NAME);

		const texts = result.errors.map((message) => message.text).join('\n');
		expect(texts).toMatch(/node:(fs|path|child_process)/);
	});

	it('runs scenarios, fixtures, step references and awaited hooks from the browser bundle', async () => {
		const result = await bundleForBrowser(`${PACKAGE_NAME}/browser`, {
			stdin: {
				contents: `
					import {
						applyFixture,
						evaluateResult,
						evaluateStep,
						resolveStepReferences,
						runScenario,
						success,
					} from '${PACKAGE_NAME}/browser';

					const events = [];
					const scenario = {
						name: 'Browser bundle smoke',
						description: 'Runs in-page scenario loop',
						job: 'browser-smoke',
						tags: [],
						steps: [
							{
								description: 'Create item',
								command: 'item-create',
								input: { title: 'Draft' },
								expect: { success: true, data: { id: 'item-1' } },
							},
							{
								description: 'Read item',
								command: 'item-get',
								input: { id: '\${{ steps[0].data.id }}' },
								expect: { success: true, data: { id: 'item-1' } },
							},
						],
					};

					const resolved = resolveStepReferences(
						{ id: '\${{ steps[0].data.id }}' },
						[success({ id: 'item-1' })]
					);
					const evalCheck = evaluateResult(success({ ok: true }), { success: true, data: { ok: true } });

					const outcome = await runScenario(scenario, {
						stopOnFailure: true,
						setup: async (signal) => {
							const applied = await applyFixture(
								{ app: 'custom', setup: [{ command: 'seed-reset' }] },
								async (cmd) => {
									events.push('fixture:' + cmd);
									return success({ cleared: true });
								},
								{ signal }
							);
							return applied.success ? {} : { error: applied.error };
						},
						beforeStep: async (step, stepId) => {
							await Promise.resolve();
							events.push('before:' + stepId + ':' + step.command);
						},
						runStep: async (step, stepId) => {
							events.push('run:' + stepId + ':' + step.command + ':' + JSON.stringify(step.input));
							return evaluateStep(step, stepId, success({ id: 'item-1' }), 1);
						},
						afterStep: async (step, stepResult) => {
							await Promise.resolve();
							events.push('after:' + stepResult.stepId + ':' + stepResult.outcome);
						},
					});

					console.log(JSON.stringify({ resolved, evalPassed: evalCheck.passed, outcome: outcome.outcome, events }));
				`,
				resolveDir: packageRoot,
				sourcefile: 'browser-smoke.js',
			},
		});

		expect(result.errors.map((message) => message.text)).toEqual([]);
		const code = new TextDecoder().decode(result.outputFiles?.[0]?.contents);
		const printed = JSON.parse(
			execFileSync(process.execPath, ['--input-type=module'], { input: code, encoding: 'utf8' })
		) as {
			resolved: { id: string };
			evalPassed: boolean;
			outcome: string;
			events: string[];
		};

		expect(printed.resolved).toEqual({ id: 'item-1' });
		expect(printed.evalPassed).toBe(true);
		expect(printed.outcome).toBe('pass');
		expect(printed.events).toEqual([
			'fixture:seed-reset',
			'before:step-1:item-create',
			'run:step-1:item-create:{"title":"Draft"}',
			'after:step-1:pass',
			'before:step-2:item-get',
			'run:step-2:item-get:{"id":"item-1"}',
			'after:step-2:pass',
		]);
	});
});
